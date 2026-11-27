// هذا المشروع وحداته منطق حسابي/شبكي: تحويلات u64→f64 للسرعة والتقدم تفقد دقة
// فوق 2⁵³ بايت فقط (بلا معنى عملي)، وتحويلات u64→usize محكومة بأرقام أجزاء
// (بحد 32 خيطًا) وحجم كاش الذاكرة. توقيعات tauri::command تفرض تمرير القيمة،
// وهذه الصلاحيات تُبقي تقرير clippy Pedantic قابلًا للقراءة دون كلفة فعلية.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::needless_pass_by_value, // توقيعات tauri::command تفرض القيمة (State/String)
    clippy::items_after_statements, // use محلي قبل حلقة تنزيل مقصود
    clippy::too_many_lines
)]

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::{Emitter, Manager};

pub mod clipboard;
pub mod download;
pub mod extension;
pub mod media;
pub mod register;
pub mod scheduler;
pub mod settings;
pub mod torrent;

const MAX_THREADS: u32 = 32;

/// توسيع متغيرات بيئة ويندوز بصيغة %NAME% (مثل %USERNAME% و %USERPROFILE%)
/// في مسارات قد تكون حُفظت نصًا حرفيًا. أي متغير غير موجود يُترك كما هو.
/// (أسماء متغيرات ويندوز غير حساسة لحالة الأحرف، لذا نجرّب الاسم كما هو ثم
/// بأحرف كبيرة.)
#[must_use]
pub fn expand_env_vars(path: &str) -> String {
    if !path.contains('%') {
        return path.to_string();
    }
    let mut out = String::with_capacity(path.len());
    let bytes = path.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(end_rel) = path[i + 1..].find('%') {
                let name = &path[i + 1..i + 1 + end_rel];
                if !name.is_empty() && !name.contains('%') {
                    let value = std::env::var(name)
                        .or_else(|_| std::env::var(name.to_uppercase()))
                        .unwrap_or(path[i..i + end_rel + 2].to_string());
                    out.push_str(&value);
                    i += end_rel + 2;
                    continue;
                }
            }
        }
        let ch = path[i..].chars().next().unwrap_or('%');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// أمر للواجهة: يعيد المسار بعد توسيع متغيرات البيئة (وإن كان فارغًا يعيد
/// مجلد التنزيلات الحقيقي للمستخدم).
#[tauri::command]
fn expand_path(path: String) -> String {
    let expanded = expand_env_vars(path.trim());
    if expanded.is_empty() {
        return dirs::download_dir()
            .or_else(dirs::home_dir)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
    }
    expanded
}

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
#[allow(dead_code)] // جزء من زوج cfg-mirror: يُستدعى على ويندوز فقط
fn run_power_command(_program: &str, _args: &[&str]) -> Result<(), String> {
    Err("إجراءات الطاقة متاحة على ويندوز فقط".into())
}

/// تنفيذ أوامر الطاقة: إغلاق وسكون أصليان عبر windows-sys، مع حدث
/// <power://action> لإخبار الواجهة بما حدث.
#[tauri::command]
fn shutdown_device(app: tauri::AppHandle, seconds: Option<u32>) -> Result<(), String> {
    let secs = seconds.unwrap_or(30);
    shutdown_device_impl(secs)?;
    let _ = app.emit("power://action", serde_json::json!({ "action": "shutdown", "seconds": secs }));
    Ok(())
}

#[cfg(target_os = "windows")]
fn shutdown_device_impl(seconds: u32) -> Result<(), String> {
    run_power_command("shutdown", &["/s", "/t", &seconds.to_string()])
}

#[cfg(not(target_os = "windows"))]
fn shutdown_device_impl(_seconds: u32) -> Result<(), String> {
    Err("إجراءات الطاقة متاحة على ويندوز فقط".into())
}

/// إلغاء إيقاف التشغيل المجدول (shutdown /a).
#[tauri::command]
fn cancel_shutdown(app: tauri::AppHandle) -> Result<(), String> {
    cancel_shutdown_impl()?;
    let _ = app.emit("power://action", serde_json::json!({ "action": "cancel" }));
    Ok(())
}

#[cfg(target_os = "windows")]
fn cancel_shutdown_impl() -> Result<(), String> {
    run_power_command("shutdown", &["/a"])
}

#[cfg(not(target_os = "windows"))]
fn cancel_shutdown_impl() -> Result<(), String> {
    Err("إجراءات الطاقة متاحة على ويندوز فقط".into())
}

/// سكون أصلي: SetSuspendState(false, false, false) عبر windows-sys
/// (بدل rundll32) من داخل `spawn_blocking` لأنه استدعاء حاجب.
#[tauri::command]
async fn sleep_device(app: tauri::AppHandle) -> Result<(), String> {
    let r = tauri::async_runtime::spawn_blocking(sleep_device_impl)
        .await
        .map_err(|e| format!("فشل تنفيذ السكون: {e}"))?;
    r?;
    let _ = app.emit("power://action", serde_json::json!({ "action": "sleep" }));
    Ok(())
}

#[cfg(target_os = "windows")]
fn sleep_device_impl() -> Result<(), String> {
    #[link(name = "powrprof")]
    unsafe extern "system" {
        pub fn SetSuspendState(Hibernate: i32, ForceCritical: i32, DisableWakeEvent: i32) -> i32;
    }
    let ok = unsafe { SetSuspendState(0, 0, 0) };
    if ok == 0 {
        Err("تعذّر إدخال الجهاز في وضع السكون (SetSuspendState فشل)".into())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn sleep_device_impl() -> Result<(), String> {
    Err("إجراءات الطاقة متاحة على ويندوز فقط".into())
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

/// منتقي ملفات أصلي لملف .torrent (بدون اعتماديات إضافية):
/// PowerShell `OpenFileDialog` على ويندوز، وخطأ عربي واضح في غير ذلك.
#[tauri::command]
fn pick_torrent_file() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile", "-Command",
                "Add-Type -AssemblyName System.Windows.Forms | Out-Null; \
                 $d = New-Object System.Windows.Forms.OpenFileDialog; \
                 $d.Filter = 'Torrent (*.torrent)|*.torrent'; \
                 if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.FileName) }",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("تعذّر فتح منتقي الملفات: {e}"))?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(if s.is_empty() { None } else { Some(s) })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("منتقي الملفات متاح على ويندوز فقط — الصق رابط .torrent يدويًا".into())
    }
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
                dir = pb.parent().map(std::path::Path::to_path_buf).unwrap_or(pb);
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
    let mut p = AUX_PENDING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
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
/// يقبل later: true (أضف للقائمة دون بدء) ويوجّه magnet وروابط .torrent
/// إلى محرك التورنت، ويعيد خطأ عربيًا واضحًا عند الفشل.
#[tauri::command]
async fn add_download_from_aux(
    app: tauri::AppHandle,
    cfg: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
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
    let later = cfg.get("later").and_then(serde_json::Value::as_bool).unwrap_or(false);
    // magnet و .torrent من مسار ملف محلي → محرك التورنت.
    let is_torrent = lower.starts_with("magnet:")
        || (lower.starts_with("file://") && lower.ends_with(".torrent"));
    if is_torrent {
        let torrents = app.state::<torrent::TorrentHandle>();
        let snap = torrent::torrent_add(
            app.clone(),
            torrents,
            url,
            cfg.get("savePath").and_then(|v| v.as_str()).map(String::from),
        )
        .await?;
        if later {
            // أضِف دون بدء: أوقف فور الإضافة.
            let torrents = app.state::<torrent::TorrentHandle>();
            let _ = torrent::torrent_pause(torrents, snap.id).await;
        }
        return Ok(serde_json::json!({ "kind": "torrent", "id": snap.id }));
    }
    let snap = download::engine_add(
        app.clone(),
        app.state::<download::EngineHandle>(),
        url,
        cfg.get("savePath").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        cfg.get("threads").and_then(serde_json::Value::as_u64).unwrap_or(8) as u32,
        cfg.get("category").and_then(|v| v.as_str()).unwrap_or("software").to_string(),
        cfg.get("description").and_then(|v| v.as_str()).map(std::string::ToString::to_string),
    )
    .await?;
    if later {
        let state = app.state::<download::EngineHandle>();
        download::engine_pause(app.clone(), state, snap.id.clone()).await?;
    }
    Ok(serde_json::json!({ "kind": "download", "id": snap.id }))
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
/// مضيف Native Messaging حقيقي: حلقة stdin بطول-بادئة (u32 little-endian)
/// مع JSON، تُمرَّر كل رسالة إلى خادم البرنامج المحلي عبر POST /native
/// وتُكتَب إجابته على stdout بنفس التأطير. لا واجهة رسومية هنا.
///
/// البرنامج مغلق؟ تُعاد رسالة تشخيص واضحة بدل انقطاع صامت.
pub fn native_host_main() {
    use std::io::{Read, Write};

    let mut stdin = std::io::stdin().lock();
    let mut stdout = std::io::stdout().lock();
    loop {
        // قراءة طول الرسالة (4 بايت LE) ثم جسمها.
        let mut len_buf = [0u8; 4];
        if stdin.read_exact(&mut len_buf).is_err() {
            break; // أغلق المتصفح القناة: خروج نظيف.
        }
        let len = u32::from_le_bytes(len_buf) as usize;
        if len == 0 || len > 4 * 1024 * 1024 {
            break;
        }
        let mut msg = vec![0u8; len];
        if stdin.read_exact(&mut msg).is_err() {
            break;
        }
        let raw = String::from_utf8_lossy(&msg).to_string();

        // توجيه الرسالة إلى الخادم المحلي: يرسل نفس النص عبر HTTP خام
        // (بلا اعتماديات إضافية) ويقرأ الجواب كاملًا.
        let reply = post_local(&raw).unwrap_or_else(|| {
            serde_json::json!({
                "type": "error",
                "code": "app-closed",
                "message": "برنامج UltraDM غير مفتوح — افتحه أولًا ثم أعد المحاولة"
            })
            .to_string()
        });

        let bytes = reply.as_bytes();
        if stdout.write_all(&(bytes.len() as u32).to_le_bytes()).is_err() {
            break;
        }
        if stdout.write_all(bytes).is_err() || stdout.flush().is_err() {
            break;
        }
    }
}

/// POST خام إلى 127.0.0.1:24580/native — يُعيد جسم الجواب عند نجاح 200 فقط.
fn post_local(body: &str) -> Option<String> {
    use std::io::{Read, Write};
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", 24580)).ok()?;
    stream.set_read_timeout(Some(std::time::Duration::from_secs(120))).ok()?;
    stream.set_write_timeout(Some(std::time::Duration::from_secs(10))).ok()?;
    let req = format!(
        "POST /native HTTP/1.1\r\nHost: 127.0.0.1:24580\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(req.as_bytes()).ok()?;
    let mut resp = Vec::new();
    stream.read_to_end(&mut resp).ok()?;
    let text = String::from_utf8_lossy(&resp);
    let body = {
        let (_, body) = text.split_once("\r\n\r\n")?;
        body.to_string()
    };
    let status_ok = text.lines().next()?.contains(" 200 ");
    if status_ok { Some(body) } else { None }
}

pub fn run() {
    let silent = std::env::args().any(|a| a == "--ultradm-silent");    tauri::Builder::default()
        // نسخة واحدة فقط: أي تشغيل ثانٍ (أو رابط من المتصفح) يعيد النافذة
        // المفتوحة إلى المقدمة بدل فتح نسخة جديدة بأيقونة ثانية في شريط المهام.
        // استثناء حاسم: الإطلاق في وضع --native-host من المتصفح يجب ألا
        // يُظهر النافذة إطلاقًا — وإلا أعاد البرنامج فتح نفسه بعد كل إغلاق
        // كلما استخدمت الإضافة القناة الأصلية.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|a| a == "--native-host" || a == "--ultradm-silent") {
                return;
            }
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
                items: StdMutex::new(std::collections::HashMap::new()),
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
                        .app_data_dir().map_or_else(|_| std::path::PathBuf::from("."), |d| d.join("torrents"));
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

            // المجدول التلقائي للطابور: تُحمَّل القواعد من settings.json لتصمد
            // بعد إعادة التشغيل (كانت في الذاكرة فقط وتُمسح عند الإغلاق).
            {
                let rules = scheduler::load_rules_from_disk(&handle);
                let sched = Arc::new(scheduler::Scheduler {
                    rules: std::sync::Mutex::new(rules),
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
            // زر X ينهي التطبيق بالكامل — لم يعد يُخفي النافذة: كان الإخفاء
            // مع إطلاق عملية المضيف من المتصفح يعطي إحساس «العودة من نفسه».
            // الإخفاء إلى شريط النظام متاح من قائمة أيقونة الشريط.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle().clone();
                exit_app(app);
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
            pick_torrent_file,
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
            quit_app,
            expand_path
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
        assert_ne!(info.version, "");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn power_commands_are_disabled_off_windows() {
        assert!(shutdown_device_impl(30).is_err());
        assert!(sleep_device_impl().is_err());
        assert!(cancel_shutdown_impl().is_err());
    }

    #[test]
    fn expand_env_vars_expands_and_preserves_unknown() {
        std::env::set_var("ULTRADM_TEST_USER", "sami");
        assert_eq!(expand_env_vars("C:\\Users\\%ULTRADM_TEST_USER%"), "C:\\Users\\sami");
        // متغير غير موجود يبقى حرفيًا؛ واسم صغير يُجرَّب بأحرف كبيرة.
        assert_eq!(expand_env_vars("%no_such_var_x%"), "%no_such_var_x%");
        assert_eq!(expand_env_vars("%ultradm_test_user%\\Downloads"), "sami\\Downloads");
        // بلا متغيرات: يبقى كما هو، والنص غير المكتمل يبقى حرفيًا.
        assert_eq!(expand_env_vars("C:\\Downloads"), "C:\\Downloads");
        assert_eq!(expand_env_vars("100% done"), "100% done");
    }
}
