#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // وضع مضيف Native Messaging: يُشغَّل من المتصفح عبر manifest
    // (b"args": ["--native-host"]) — يقرأ رسائل المتصفح من stdin ويُجيب على
    // stdout، ويوجّهها إلى خادم البرنامج المحلي. لا واجهة رسومية هنا.
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--native-host") {
        ultradm_lib::native_host_main();
        return;
    }
    ultradm_lib::run();
}
