//! 端口探测:固定参考端口被占用则在 59900–59999 段顺延。

use std::net::TcpListener;

/// 尝试在 127.0.0.1 绑定该端口以判断是否空闲。
pub fn is_port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// 在 [start, end] 段内找一个空闲端口(跳过 skip 中的)。
pub fn find_free_port(start: u16, end: u16, skip: &[u16]) -> Option<u16> {
    (start..=end).find(|p| !skip.contains(p) && is_port_free(*p))
}

/// 为 api/engine 分配两个互不相同的空闲端口:优先用参考端口,占用则段内顺延。
pub fn allocate(api_pref: u16, engine_pref: u16, start: u16, end: u16) -> Option<(u16, u16)> {
    let api = if is_port_free(api_pref) {
        api_pref
    } else {
        find_free_port(start, end, &[])?
    };
    let engine = if engine_pref != api && is_port_free(engine_pref) {
        engine_pref
    } else {
        find_free_port(start, end, &[api])?
    };
    Some((api, engine))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn occupied_port_is_not_free() {
        let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        assert!(!is_port_free(port));
        drop(l);
        assert!(is_port_free(port));
    }

    #[test]
    fn find_free_returns_port_in_range() {
        // 注:可绑定性是瞬时的(并行测试会争用同段端口),此处只断言落在段内。
        let p = find_free_port(59900, 59999, &[]).expect("a free port in range");
        assert!((59900..=59999).contains(&p));
    }

    #[test]
    fn allocate_returns_two_distinct_free_ports() {
        let (a, e) = allocate(59914, 59915, 59900, 59999).unwrap();
        assert_ne!(a, e);
        assert!((59900..=59999).contains(&a) || a == 59914);
    }

    #[test]
    fn allocate_falls_back_when_preferred_taken() {
        // 占用一个段内端口,作为 api 首选 → 应顺延到别的空闲端口。
        let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let taken = l.local_addr().unwrap().port();
        let (a, e) = allocate(taken, 0, 59900, 59999).unwrap();
        assert_ne!(a, taken);
        assert_ne!(a, e);
    }
}
