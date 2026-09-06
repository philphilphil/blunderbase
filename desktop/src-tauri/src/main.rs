// Without this the release exe is a console-subsystem binary and Windows opens a terminal
// window next to the app; a debug build keeps the console so `cargo run` still prints.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    blunderbase_desktop_lib::run();
}
