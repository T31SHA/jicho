// JichoBot runs without a console window: Kito is the whole UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    jichobot_lib::run()
}
