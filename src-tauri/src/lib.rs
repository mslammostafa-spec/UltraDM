use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::Manager;

pub mod clipboard;
pub mod download;
pub mod extension;
pub mod media;
pub mod register;
pub mod scheduler;
pub mod settings;
pub mod torrent;

const MAX_THREADS: u32 = 32;

#[derive(Serialize)]
pub struct AppInfo {
    pub version: &'static str,
    pub os: &'static str,
    pub max_threads: u32,
}

#[cfg(target_os = "windows")]
fn run_power_command(program: &str, args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn run_power_command(_program: &str, _args: &[&str]) -> Result<(), String> {
    Err("إجراءات الطاقة متاحة على ويندوز فقط".into())
}

/// إغلاق الجهاز بعد مهلة 30 ثانية للسلامة (يمكن إلغاؤها بالأمر shutdown /a).
#[tauri::command]
fn shutdown_device() -> Result<(), String> {
    run_power_command("shutdown", &["/s", "/t", "30"])
}

/// إلغاء إيقاف التشغيل المجدول (shutdown /a).
#[tauri::command]
fn cancel_shutdown() -> Result<(), String> {
    cancel_shutdown_impl()
}

#[cfg(target_os = "windows")]
fn cancel_shutdown_impl() -> Result<(), String> {
    run_power_command("shutdown", &["/a"])
}

#[cfg(not(target_os = "windows"))]
fn cancel_shutdown_impl() -> Result<(), String> {
    Err("إجراءات الطاقة متاحة على ويندوز فقط".into())
}

#[tauri::command]
fn sleep_device() -> Result<(), String> {
    run_power_command("rundll32.exe", &["powrprof.dll,SetSuspendState", "0,1,0"])
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        max_threads: MAX_THREADS,
    }
}

/// أولوية منخفضة للعملية على ويندوز (تحت المعيار) حتى لا يبطئ الإقلاع الصامت النظام.
#[cfg(target_os = "windows")]
fn lower_process_priority() {
    use windows_sys::Win32::System::Threading::{
        SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS, PROCESS_MODE_BACKGROUND_BEGIN,
    };
    unsafe {
        let _ = SetPriorityClass(std::process::id() as _, BELOW_NORMAL_PRIORITY_CLASS);
        let _ = SetPriorityClass(std::process::id() as _, PROCESS_MODE_BACKGROUND_BEGIN);
    }
}

#[cfg(not(target_os = "windows"))]
fn lower_process_priority() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let silent = std::env::args().any(|a| a == "--ultradm-silent");
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--ultradm-silent"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            use download::{Engine, EngineHandle, SpeedLimiter};
            use std::sync::Arc;
            use std::sync::Mutex as StdMutex;
            use tauri::Emitter;

            let handle = app.handle().clone();
            // إقلاع صامت مؤجَّل: عند بدء التشغيل مع النظام تبقى النافذة مخفيّة
            // ويعمل محرك الالتقاط الخلفي فقط بأولوية منخفضة حتى يُطلب الإظهار.
            if silent {
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
                lower_process_priority();
            }
            extension::start_server(handle.clone());
            let engine = Arc::new(Engine {
                items: StdMutex::new(Default::default()),
                limiter: Arc::new(SpeedLimiter::new()),
                client: reqwest::Client::builder()
                    .user_agent("UltraDM/1.0")
                    .tcp_nodelay(true)
                    .timeout(std::time::Duration::from_secs(30))
                    .read_timeout(std::time::Duration::from_secs(30))
                    .pool_idle_timeout(std::time::Duration::from_secs(60))
                    .build()
                    .map_err(|e| e.to_string())?,
                cache: StdMutex::new(download::CacheConfig::default()),
                app: handle.clone(),
            });
            app.manage(EngineHandle(engine.clone()));
            app.manage(media::MediaHandle::default());
            tauri::async_runtime::spawn(engine.limiter.clone().run());
            // مراقب الحافظة: يلتقط أي رابط تحميل يُنسخ فورًا.
            clipboard::spawn_watcher(handle.clone());
            let _ = Emitter::emit(&handle, "engine://ready", ());

            // محرك التورنت (librqbit: DHT + PEX + uTP) يُنشأ في مهمة مستقلة.
            {
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let dir = handle
                        .path()
                        .app_data_dir()
                        .map(|d| d.join("torrents"))
                        .unwrap_or_else(|_| std::path::PathBuf::from("."));
                    match torrent::TorrentEngine::new(dir).await {
                        Ok(engine) => {
                            let engine = Arc::new(engine);
                            handle.manage(torrent::TorrentHandle(engine.clone()));
                            torrent::spawn_progress_task(handle.clone(), engine);
                            let _ = Emitter::emit(&handle, "torrent://ready", ());
                        }
                        Err(e) => {
                            eprintln!("تعذّر تشغيل محرك التورنت: {e}");
                            let _ = Emitter::emit(&handle, "torrent://unavailable", e);
                        }
                    }
                });
            }

            // المجدول التلقائي للطابور.
            {
                let sched = Arc::new(scheduler::Scheduler {
                    rules: std::sync::Mutex::new(Vec::new()),
                });
                handle.manage(sched.clone());
                scheduler::spawn_scheduler(handle.clone(), sched);
            }


            let show = MenuItem::with_id(app, "show", "إظهار UltraDM", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "إنهاء UltraDM", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = tauri::tray::TrayIconBuilder::with_id("ultradm-tray")
                .menu(&menu)
                .tooltip("UltraDM")
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    } else if event.id() == "show" {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // زر X يُخفي النافذة إلى شريط النظام بدل الإنهاء؛
            // الإنهاء الحقيقي من قائمة أيقونة الشريط فقط.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            shutdown_device,
            sleep_device,
            exit_app,
            app_info,
            download::engine_add,
            download::engine_pause,
            download::engine_resume,
            download::engine_cancel,
            download::engine_list,
            download::engine_set_threads,
            download::engine_set_speed_limit,
            settings::load_settings,
            settings::save_settings,
            torrent::torrent_add,
            torrent::torrent_list,
            torrent::torrent_pause,
            torrent::torrent_verify_sha256,
            torrent::torrent_resume,
            torrent::torrent_remove,
            register::register_torrent_handler,
            register::register_autostart,
            download::engine_set_cache_config,
            media::media_check,
            media::media_probe,
            media::media_download,
            media::media_cancel,
            scheduler::scheduler_set_rules,
            extension::extension_binding_status,
            extension::extension_register_browsers,
            cancel_shutdown
        ])
        .run(tauri::generate_context!())
        .expect("خطأ في تشغيل UltraDM");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_thread_cap() {
        let info = app_info();
        assert_eq!(info.max_threads, 32);
        assert!(!info.version.is_empty());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn power_commands_are_disabled_off_windows() {
        assert!(shutdown_device().is_err());
        assert!(sleep_device().is_err());
    }
}
