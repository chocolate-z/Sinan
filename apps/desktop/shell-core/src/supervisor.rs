//! sidecar 进程规格:engine 先就绪 → api 再就绪。会话 token + 端口经环境变量下发。

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub struct SidecarSpec {
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub cwd: Option<String>,
}

/// 两个 sidecar 共享的环境变量(端口 + 会话 token + 数据目录)。
pub fn base_env(api_port: u16, engine_port: u16, token: &str, data_dir: &str) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    m.insert("SINAN_API_PORT".into(), api_port.to_string());
    m.insert("SINAN_ENGINE_PORT".into(), engine_port.to_string());
    m.insert("SINAN_IPC_TOKEN".into(), token.to_string());
    m.insert("SINAN_DATA_DIR".into(), data_dir.to_string());
    m
}

impl SidecarSpec {
    /// 开发期 engine:python -m uvicorn(冻结分发时换为 PyInstaller 单可执行)。
    pub fn engine_dev(python: &str, engine_port: u16, env: BTreeMap<String, String>) -> Self {
        SidecarSpec {
            name: "engine".into(),
            program: python.into(),
            args: vec![
                "-m".into(),
                "uvicorn".into(),
                "sinan.app:app".into(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                engine_port.to_string(),
            ],
            env,
            cwd: None,
        }
    }

    /// 冻结分发期 engine:PyInstaller 单可执行(externalBin 注入)。
    pub fn engine_frozen(exe: &str, env: BTreeMap<String, String>) -> Self {
        SidecarSpec { name: "engine".into(), program: exe.into(), args: vec![], env, cwd: None }
    }

    /// 开发期 api:node dist/src/main.js(冻结期换为 Node SEA 单可执行)。
    pub fn api_dev(node: &str, entry: &str, env: BTreeMap<String, String>) -> Self {
        SidecarSpec {
            name: "api".into(),
            program: node.into(),
            args: vec![entry.into()],
            env,
            cwd: None,
        }
    }

    pub fn api_frozen(exe: &str, env: BTreeMap<String, String>) -> Self {
        SidecarSpec { name: "api".into(), program: exe.into(), args: vec![], env, cwd: None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_env_carries_ports_and_token() {
        let env = base_env(59914, 59915, "deadbeef", "/data/Sinan");
        assert_eq!(env.get("SINAN_API_PORT").unwrap(), "59914");
        assert_eq!(env.get("SINAN_ENGINE_PORT").unwrap(), "59915");
        assert_eq!(env.get("SINAN_IPC_TOKEN").unwrap(), "deadbeef");
        assert_eq!(env.get("SINAN_DATA_DIR").unwrap(), "/data/Sinan");
    }

    #[test]
    fn engine_dev_spec_builds_uvicorn_command() {
        let env = base_env(59914, 59915, "t", "d");
        let spec = SidecarSpec::engine_dev("python", 59915, env);
        assert_eq!(spec.name, "engine");
        assert!(spec.args.contains(&"uvicorn".to_string()));
        assert!(spec.args.contains(&"sinan.app:app".to_string()));
        assert!(spec.args.contains(&"59915".to_string()));
    }

    #[test]
    fn api_dev_spec_runs_entry() {
        let env = base_env(59914, 59915, "t", "d");
        let spec = SidecarSpec::api_dev("node", "dist/src/main.js", env);
        assert_eq!(spec.name, "api");
        assert_eq!(spec.program, "node");
        assert_eq!(spec.args, vec!["dist/src/main.js".to_string()]);
    }
}
