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
    // إنهاء قاطع ومضمون: يوقف المهام ويغلق العملية حتى لو علّق شيءًا.
    app.exit(0);
    std::process::exit(0);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    exit_app(app);
}

/// فتح مجلد الملف المحفوظ في مدير ملفات النظام (وتحديد الملف على ويندوز).
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("المسار غير موجود: {path}"));
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        if p.is_file() {
            // explorer /select يُبرز الملف داخل مجلده.
            std::process::Command::new("explorer.exe")
                .arg(format!("/select,{}", p.display()))
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("explorer.exe")
                .arg(&p)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let program = if p.is_file() { "open" } else { "open" };
        std::process::Command::new(program)
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = p;
        Err("غير مدعوم على هذا النظام".into())
    }
}

/// المساحة الحرة للقرص الذي يحتوي المسار (بالبايت) — لبطاقة "سرعة الكتابة على القرص".
#[tauri::command]
fn disk_free(path: Option<String>) -> Result<u64, String> {
    let target = match path {
        Some(p) if !p.is_empty() => {
            let pb = std::path::PathBuf::from(&p);
            let mut dir = pb.clone();
            if pb.is_file() {
                dir = pb.parent().map(|x| x.to_path_buf()).unwrap_or(pb);
            }
            dir
        }
        _ => dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/")),
    };
    free_space_of(&target)
}

fn free_space_of(dir: &std::path::Path) -> Result<u64, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = dir
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut free: u64 = 0;
        let ok = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), std::ptr::null_mut(), std::ptr::null_mut(), &mut free)
        };
        if ok == 0 {
            return Err("فشل قياس المساحة الحرة".into());
        }
        Ok(free)
    }
    #[cfg(not(target_os = "windows"))]
    {
        // statfs عبر libc: المسموح كتابته (f_bavail) × حجم الكتلة.
        #[repr(C)]
        struct StatFs {
            f_type: i64,
            f_bsize: i64,
            f_blocks: u64,
            f_bfree: u64,
            f_bavail: u64,
            // بقية الحقول لا تهمّنا؛ حجم البنية يجب أن يكفي النظام.
            _pad: [u64; 15],
        }
        extern "C" {
            fn statfs(path: *const u8, buf: *mut StatFs) -> i32;
        }
        let mut buf = StatFs {
            f_type: 0, f_bsize: 0, f_blocks: 0, f_bfree: 0, f_bavail: 0,
            _pad: [0; 15],
        };
        let c = dir.as_os_str().to_string_lossy();
        let mut bytes = c.as_bytes().to_vec();
        bytes.push(0);
        let rc = unsafe { statfs(bytes.as_ptr(), &mut buf) };
        if rc != 0 {
            return Err("فشل قياس المساحة الحرة".into());
        }
        Ok(buf.f_bavail.saturating_mul(buf.f_bsize as u64))
    }
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        max_threads: MAX_THREADS,
    }
}

/// بيانات معلّقة لنوافذ المساعدة (المعلومات/التقدّم).
#[derive(Clone, serde::Serialize)]
pub struct AuxPayload {
    pub kind: String,
    pub url: Option<String>,
    pub torrent: Option<bool>,
    pub download: Option<serde_json::Value>,
}

static AUX_PENDING: std::sync::Mutex<AuxPayload> = std::sync::Mutex::new(AuxPayload {
    kind: String::new(),
    url: None,
    torrent: None,
    download: None,
});

/// نافذة مساعدة جاهزة: أعد بياناتها المعلّقة (إن وُجدت) ثم امسحها.
#[tauri::command]
fn aux_ready(kind: String) -> Option<AuxPayload> {
    let mut p = AUX_PENDING.lock().unwrap_or_else(|e| e.into_inner());
    if p.kind == kind {
        Some(std::mem::replace(
            &mut *p,
            AuxPayload { kind: String::new(), url: None, torrent: None, download: None },
        ))
    } else {
        None
    }
}

/// إضافة تحميل من نافذة المساعدة المستقلة (معلومات التحميل).
#[tauri::command]
async fn add_download_from_aux(
    app: tauri::AppHandle,
    state: tauri::State<'_, download::EngineHandle>,
    cfg: serde_json::Value,
) -> Result<download::DownloadSnapshot, String> {
    let url = cfg
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "رابط مفقود".to_string())?
        .to_string();
    // رفض قاطع للروابط الداخلية (blob:/data:) بعبارة عربية واضحة.
    let lower = url.trim().to_lowercase();
    if lower.starts_with("blob:") || lower.starts_with("data:") {
        return Err(
            "لا يمكن تحميل روابط blob الداخلية — افتح الرابط الأصلي للملف وأعد المحاولة".into(),
        );
    }
    download::engine_add(
        app,
        state,
        url,
        cfg.get("savePath").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        cfg.get("threads").and_then(|v| v.as_u64()).unwrap_or(8) as u32,
        cfg.get("category").and_then(|v| v.as_str()).unwrap_or("software").to_string(),
        cfg.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
    )
    .await
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
        // نسخة واحدة فقط: أي تشغيل ثانٍ (أو رابط من المتصفح) يعيد النافذة
        // المفتوحة إلى المقدمة بدل فتح نسخة جديدة بأيقونة ثانية في شريط المهام.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
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
            aux_ready,
            add_download_from_aux,
            download::engine_add,
            download::engine_pause,
            download::engine_resume,
            download::engine_cancel,
            download::engine_list,
            download::engine_set_threads,
            download::engine_set_speed_limit,
            open_path,
            disk_free,
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
            media::media_install_tools,
            media::media_probe,
            media::media_download,
            media::media_cancel,
            scheduler::scheduler_set_rules,
            extension::extension_binding_status,
            extension::extension_register_browsers,
            cancel_shutdown,
            quit_app
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
