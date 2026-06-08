//! runtime/ports.json:把最终端口与会话 token 下发给前端 bootstrap。
//! 零外部 crate:固定 3 字段,手写最小 JSON 序列化/解析(token 为 hex,无需转义)。

use std::fs;
use std::io;
use std::path::Path;

#[derive(Debug, PartialEq, Clone)]
pub struct PortsFile {
    pub api: u16,
    pub engine: u16,
    pub token: String,
}

impl PortsFile {
    pub fn to_json(&self) -> String {
        format!(
            "{{\n  \"api\": {},\n  \"engine\": {},\n  \"token\": \"{}\"\n}}\n",
            self.api, self.engine, self.token
        )
    }

    /// 解析本模块自己产出的 ports.json(容错于空白)。
    pub fn from_json(s: &str) -> Option<PortsFile> {
        let api = extract_number(s, "api")? as u16;
        let engine = extract_number(s, "engine")? as u16;
        let token = extract_string(s, "token")?;
        Some(PortsFile { api, engine, token })
    }
}

fn extract_number(s: &str, key: &str) -> Option<u64> {
    let pat = format!("\"{key}\"");
    let idx = s.find(&pat)?;
    let after = &s[idx + pat.len()..];
    let colon = after.find(':')?;
    let rest = after[colon + 1..].trim_start();
    let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    rest[..end].parse().ok()
}

fn extract_string(s: &str, key: &str) -> Option<String> {
    let pat = format!("\"{key}\"");
    let idx = s.find(&pat)?;
    let after = &s[idx + pat.len()..];
    let colon = after.find(':')?;
    let rest = &after[colon + 1..];
    let q1 = rest.find('"')?;
    let rest2 = &rest[q1 + 1..];
    let q2 = rest2.find('"')?;
    Some(rest2[..q2].to_string())
}

pub fn write_ports(path: &Path, p: &PortsFile) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, p.to_json())
}

pub fn read_ports(path: &Path) -> io::Result<PortsFile> {
    let data = fs::read_to_string(path)?;
    PortsFile::from_json(&data)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "bad ports.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn json_roundtrip_in_memory() {
        let p = PortsFile { api: 59914, engine: 59915, token: "deadbeef00".into() };
        let parsed = PortsFile::from_json(&p.to_json()).unwrap();
        assert_eq!(p, parsed);
    }

    #[test]
    fn file_roundtrip() {
        let dir = env::temp_dir().join(format!("sinan_ports_{}", std::process::id()));
        let path = dir.join("runtime").join("ports.json");
        let p = PortsFile { api: 60001, engine: 60002, token: "abc123".into() };
        write_ports(&path, &p).unwrap();
        assert_eq!(read_ports(&path).unwrap(), p);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_tolerant_whitespace() {
        let s = r#"{ "api":1 , "engine" : 2 ,  "token" :  "zz"  }"#;
        let p = PortsFile::from_json(s).unwrap();
        assert_eq!(p, PortsFile { api: 1, engine: 2, token: "zz".into() });
    }
}
