//! 司南外壳核心逻辑,与 Tauri 运行时解耦,便于快速单测。
//! 端口探测顺延、会话随机 token、sidecar 进程规格、runtime/ports.json 读写。

pub mod ports;
pub mod runtime;
pub mod supervisor;
pub mod token;
