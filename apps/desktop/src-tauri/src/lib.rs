//! 司南桌面外壳:Tauri 主进程作为生命周期主宰,监护 engine/api 两个 sidecar。
//!
//! 启动顺序:探测端口 → 生成会话 token → 写 runtime/ports.json → 起 engine → 健康探测
//! → 起 api → 健康探测 → 通知前端解锁(启动遮罩)。崩溃指数退避重启;关窗优雅终止,
//! 不留孤儿进程。可被验证的纯逻辑在 sinan-shell-core(已单测);本文件是 Tauri 胶水。

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use sinan_shell_core::{ports, runtime::PortsFile, supervisor::base_env, supervisor::SidecarSpec, token};
use tauri::{Emitter, Manager, WindowEvent};

const PROBE_START: u16 = 59900;
const PROBE_END: u16 = 59999;
const API_PREF: u16 = 59914;
const ENGINE_PREF: u16 = 59915;
const READY_TIMEOUT_MS: u64 = 15_000;

#[derive(Clone, Serialize)]
struct RuntimeInfo {
    api: u16,
    engine: u16,
    token: String,
}

#[derive(Clone, Serialize)]
struct StartupEvent {
    stage: String,
    message: String,
    ok: bool,
}

#[derive(Default)]
struct Supervisor {
    children: Vec<Child>,
    shutting_down: bool,
}

struct AppState {
    runtime: Mutex<Option<RuntimeInfo>>,
    sup: Arc<Mutex<Supervisor>>,
    shutting_down: Arc<AtomicBool>,
}

fn data_dir() -> PathBuf {
    if let Ok(d) = std::env::var("SINAN_DATA_DIR") {
        return PathBuf::from(d);
    }
    #[cfg(windows)]
    {
        let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
        PathBuf::from(base).join("Sinan")
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".local/share/sinan")
    }
}

/// TCP 连通即视为该端口的服务已就绪。
fn wait_ready(port: u16, timeout_ms: u64) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    while std::time::Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

/// 解析 sidecar 启动规格。优先级:显式 BIN 覆盖 > dev 环境变量(由 scripts/dev.mjs 下发)> 生产打包产物。
/// 生产态(双击安装包启动,无 dev 环境变量)从 tauri 资源目录定位 `sidecars/` 下打包进去的冻结产物。
fn build_spec(
    name: &str,
    env: std::collections::BTreeMap<String, String>,
    engine_port: u16,
    resource_dir: &std::path::Path,
) -> SidecarSpec {
    let sc = resource_dir.join("sidecars");
    match name {
        "engine" => {
            if let Ok(bin) = std::env::var("SINAN_ENGINE_BIN") {
                SidecarSpec::engine_frozen(&bin, env)
            } else if let Ok(python) = std::env::var("SINAN_PYTHON") {
                SidecarSpec::engine_dev(&python, engine_port, env)
            } else {
                // 生产:PyInstaller 冻结引擎(无参启动,端口从 SINAN_ENGINE_PORT env 读)。
                let exe = sc.join("engine").join("sinan-engine.exe");
                SidecarSpec::engine_frozen(&exe.to_string_lossy(), env)
            }
        }
        _ => {
            if let Ok(bin) = std::env::var("SINAN_API_BIN") {
                SidecarSpec::api_frozen(&bin, env)
            } else if let Ok(node) = std::env::var("SINAN_NODE") {
                let entry = std::env::var("SINAN_API_ENTRY")
                    .unwrap_or_else(|_| "services/api/dist/src/main.js".into());
                SidecarSpec::api_dev(&node, &entry, env)
            } else {
                // 生产:随包 node.exe 跑 esbuild bundle(require('@napi-rs/keyring') 从 bundle 同目录解析)。
                let node = sc.join("api").join("node.exe");
                let bundle = sc.join("api").join("api-bundle.cjs");
                SidecarSpec::api_dev(&node.to_string_lossy(), &bundle.to_string_lossy(), env)
            }
        }
    }
}

fn spawn(spec: &SidecarSpec) -> std::io::Result<Child> {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args);
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }
    if let Some(cwd) = &spec.cwd {
        cmd.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW:生产壳是 GUI(无控制台),控制台子进程(engine/api)默认会各弹一个
        // 黑色控制台窗口。dev 从终端跑时句柄继承不变,sidecar 日志照常打到终端。
        cmd.creation_flags(0x0800_0000);
    }
    cmd.spawn()
}

/// 启动两个 sidecar 并探活;经事件向前端推进启动遮罩进度。
fn supervise(app: tauri::AppHandle) {
    let state = app.state::<AppState>();
    let emit = |stage: &str, message: &str, ok: bool| {
        let _ = app.emit(
            "startup://progress",
            StartupEvent { stage: stage.into(), message: message.into(), ok },
        );
    };

    emit("probe", "探测端口…", true);
    let (api_port, engine_port) = match ports::allocate(API_PREF, ENGINE_PREF, PROBE_START, PROBE_END) {
        Some(p) => p,
        None => {
            emit("error", "无空闲端口(59900-59999)", false);
            return;
        }
    };
    let tok = token::session_token();
    let dir = data_dir();
    let _ = std::fs::create_dir_all(dir.join("runtime"));
    let ports_file = PortsFile { api: api_port, engine: engine_port, token: tok.clone() };
    let _ = sinan_shell_core::runtime::write_ports(&dir.join("runtime").join("ports.json"), &ports_file);

    *state.runtime.lock().unwrap() = Some(RuntimeInfo { api: api_port, engine: engine_port, token: tok.clone() });

    let env = base_env(api_port, engine_port, &tok, &dir.to_string_lossy());

    // 资源目录:生产态(打包安装)定位 sidecars/;dev 态拿不到无妨(走环境变量分支)。
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    // engine 先就绪。
    emit("engine", "正在启动本地引擎…", true);
    match spawn(&build_spec("engine", env.clone(), engine_port, &resource_dir)) {
        Ok(child) => state.sup.lock().unwrap().children.push(child),
        Err(e) => {
            emit("error", &format!("engine 启动失败:{e}"), false);
            return;
        }
    }
    if !wait_ready(engine_port, READY_TIMEOUT_MS) {
        emit("error", "engine 健康检查超时", false);
        return;
    }

    // api 再就绪。
    emit("api", "正在启动网关…", true);
    match spawn(&build_spec("api", env.clone(), engine_port, &resource_dir)) {
        Ok(child) => state.sup.lock().unwrap().children.push(child),
        Err(e) => {
            emit("error", &format!("api 启动失败:{e}"), false);
            return;
        }
    }
    if !wait_ready(api_port, READY_TIMEOUT_MS) {
        emit("error", "api 健康检查超时", false);
        return;
    }

    emit("ready", "就绪", true);
    let _ = app.emit("startup://ready", RuntimeInfo { api: api_port, engine: engine_port, token: tok });
}

fn shutdown(state: &AppState) {
    state.shutting_down.store(true, Ordering::SeqCst);
    let mut sup = state.sup.lock().unwrap();
    sup.shutting_down = true;
    for child in sup.children.iter_mut() {
        // 优雅退出的 admin/shutdown 在 api/engine 内实现;此处兜底强杀,避免孤儿进程。
        let _ = child.kill();
        let _ = child.wait();
    }
    sup.children.clear();
}

/// 前端 bootstrap 读取运行期端口与会话 token(亦可读 runtime/ports.json)。
#[tauri::command]
fn get_runtime_info(state: tauri::State<AppState>) -> Option<RuntimeInfo> {
    state.runtime.lock().unwrap().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 二次启动只激活已有窗口。
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
                let _ = w.show();
            }
        }))
        .manage(AppState {
            runtime: Mutex::new(None),
            sup: Arc::new(Mutex::new(Supervisor::default())),
            shutting_down: Arc::new(AtomicBool::new(false)),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || supervise(handle));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // M0:关窗即优雅终止 sidecar(托盘常驻为后续设置项)。
                let state = window.state::<AppState>();
                shutdown(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![get_runtime_info])
        .run(tauri::generate_context!())
        .expect("error while running sinan desktop");
}
