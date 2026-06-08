// 防止 Windows release 构建弹出多余控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sinan_desktop_lib::run()
}
