//! 会话随机 token:每次启动用 OS CSPRNG 生成 32 字节,作为 X-Sinan-Token / X-Sinan-Internal。
//! 零外部 crate:Windows 走 BCryptGenRandom,Unix 读 /dev/urandom。

/// 字节切片转十六进制串。
pub fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

#[cfg(windows)]
#[link(name = "bcrypt")]
unsafe extern "system" {
    fn BCryptGenRandom(
        h_algorithm: *mut core::ffi::c_void,
        pb_buffer: *mut u8,
        cb_buffer: u32,
        dw_flags: u32,
    ) -> i32;
}

#[cfg(windows)]
const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x0000_0002;

/// 用 OS CSPRNG 填充 32 字节。
pub fn os_random_32() -> [u8; 32] {
    let mut buf = [0u8; 32];
    #[cfg(windows)]
    unsafe {
        let status = BCryptGenRandom(
            core::ptr::null_mut(),
            buf.as_mut_ptr(),
            buf.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        );
        assert_eq!(status, 0, "BCryptGenRandom failed: {status}");
    }
    #[cfg(unix)]
    {
        use std::io::Read;
        let mut f = std::fs::File::open("/dev/urandom").expect("open /dev/urandom");
        f.read_exact(&mut buf).expect("read /dev/urandom");
    }
    buf
}

/// 生成 64 字符十六进制会话 token。
pub fn session_token() -> String {
    to_hex(&os_random_32())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_hex_pads_each_byte() {
        assert_eq!(to_hex(&[0x00, 0x0f, 0xff, 0xa5]), "000fffa5");
    }

    #[test]
    fn token_is_64_hex_chars_and_unique() {
        let a = session_token();
        let b = session_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "two tokens must differ");
    }
}
