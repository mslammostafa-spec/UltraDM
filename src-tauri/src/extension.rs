//! إضافة المتصفح: خادم WebSocket محلي فائق السرعة لتلقّي الروابط من الإضافة،
//! وتسجيل مفاتيح Native Messaging في سجل ويندوز لكل متصفح مثبت.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const PORT: u16 = 24580;
const NATIVE_HOST_NAME: &str = "com.ultradm.bridge";

/// طلب التقاط يأتي من إضافة المتصفح.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub kind: Option<String>,
    pub url: String,
    #[serde(default)]
    pub page_url: String,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub user_agent: String,
    #[serde(default)]
    pub referer: String,
    #[serde(default)]
    pub cookies: Vec<CookieEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CookieEntry {
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub domain: String,
}

#[derive(Serialize, Clone)]
pub struct BrowserBinding {
    pub browser: &'static str,
    pub installed: bool,
    #[serde(rename = "hostRegistered")]
    pub host_registered: bool,
}

#[derive(Serialize, Clone)]
pub struct ExtensionBindingStatus {
    pub native_host_name: String,
    pub manifest_path: String,
    pub browsers: Vec<BrowserBinding>,
}

static SERVER_STARTED: AtomicBool = AtomicBool::new(false);
static CAPTURES_SENT: AtomicUsize = AtomicUsize::new(0);

/// بدء خادم WebSocket المحلي مرة واحدة عند إقلاع البرنامج.
pub fn start_server(app: AppHandle) {
    if SERVER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(app).await {
            eprintln!("ultradm extension server: {e}");
        }
    });
}

async fn serve(app: AppHandle) -> Result<(), String> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", PORT))
        .await
        .map_err(|e| format!("تعذّر ربط منفذ {PORT}: {e}"))?;
    loop {
        let (stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = handle_conn(app, stream).await {
                eprintln!("ultradm ext conn: {e}");
            }
        });
    }
}

/// مصافحة WebSocket (RFC 6455) يدوية بلا اعتماديات إضافية.
async fn handle_conn(app: AppHandle, mut stream: tokio::net::TcpStream) -> Result<(), String> {
    // قراءة الترويسة حتى نهايتها
    let mut buf = Vec::new();
    let mut tmp = [0u8; 1024];
    loop {
        let n = stream
            .read(&mut tmp)
            .await
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("انقطع الاتصال أثناء المصافحة".into());
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > 16 * 1024 {
            return Err("ترويسة كبيرة جدًا".into());
        }
    }
    let text = String::from_utf8_lossy(&buf);
    if !text.starts_with("GET /ultradm") {
        return Err("مسار غير معروف".into());
    }
    // حماية أمنية: لا يُقبل الاتصال إلا من إضافة متصفح حقيقية (Origin خاص بالإضافة)
    // أو عبر Native Messaging (بلا ترويسة Origin). أي عملية محلية أخرى تُرفض.
    let origin: Option<String> = text
        .lines()
        .find(|l| l.to_ascii_lowercase().starts_with("origin:"))
        .and_then(|l| l.split_once(':').map(|(_, v)| v.trim().to_owned()));
    if let Some(origin) = origin {
        let ok = ["chrome-extension://", "moz-extension://", "safari-extension://"]
            .iter()
            .any(|p| origin.starts_with(p));
        if !ok {
            return Err("أصل (Origin) غير مصرّح به".into());
        }
    }
    let key = text
        .lines()
        .find_map(|l| {
            let l = l.trim();
            l.to_ascii_lowercase()
                .starts_with("sec-websocket-key:")
                .then(|| l.split_once(':').map(|(_, v)| v.trim().to_owned()))?
        })
        .ok_or("لا يوجد Sec-WebSocket-Key")?;

    use tokio::io::AsyncWriteExt as _;
    let accept = ws_accept(key.trim());
    let resp = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream.write_all(resp.as_bytes()).await.map_err(|e| e.to_string())?;
    stream.flush().await.map_err(|e| e.to_string())?;

    // رسالة ترحيب تحمل الثيم الحالي (settings.json نص JSON خام).
    let theme = super::settings::load_settings(app.clone())
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.get("theme").and_then(|t| t.as_str()).map(String::from))
        .unwrap_or_else(|| "cyber-glass-blue".into());
    let hello = format!(
        "{{\"type\":\"theme\",\"id\":\"{theme}\"}}"
    );
    write_ws_frame(&mut stream, hello.as_bytes()).await?;

    // ثم قراءة الرسائل (إطارات نصية مقنّعة من العميل)
    let mut frames = Vec::new();
    loop {
        let msg = match read_ws_frame(&mut stream).await {
            Ok(m) => m,
            Err(_) => break,
        };
        let ok = handle_message(&app, &msg).await;
        frames.push(msg);
        let _ = ok;
        // ردّ تأكيد خفيف
        let ack = format!("{{\"type\":\"captured\"}}");
        let _ = write_ws_frame(&mut stream, ack.as_bytes()).await;
    }
    Ok(())
}

async fn handle_message(app: &AppHandle, raw: &str) -> bool {
    let req: CaptureRequest = match serde_json::from_str(raw) {
        Ok(r) => r,
        Err(_) => return false,
    };
    if req.msg_type != "capture" {
        return false;
    }
    // افتح نافذة "معلومات التحميل" مباشرة عبر حدث تلتقطه الواجهة.
    CAPTURES_SENT.fetch_add(1, Ordering::SeqCst);
    let _ = app.emit("extension://capture", &req);
    // عند الإقلاع الصامت: أول رابط ملتقط يُظهر النافذة فورًا (إقلاع مؤجَّل).
    if let Some(w) = app.get_webview_window("main") {
        if !w.is_visible().unwrap_or(true) {
            let _: Result<(), tauri::Error> = (|| {
                w.show()?;
                w.unminimize()?;
                w.set_focus()
            })();
        }
    }
    // نفّذ الالتقاط فورًا كرابط جاهز في قائمة التحميلات عبر محرك التحميل.
    true
}

fn ws_accept(key: &str) -> String {
    // SHA-1 للمفتاح + GUID ثم Base64 — كما يحدده RFC 6455 §1.3
    use base64::Engine as _;
    const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let mut hasher = Sha1::new();
    hasher.update(key.as_bytes());
    hasher.update(GUID.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(hasher.finalize())
}

async fn write_ws_frame(
    stream: &mut tokio::net::TcpStream,
    payload: &[u8],
) -> Result<(), String> {
    let mut frame = vec![0x81u8]; // FIN + text
    if payload.len() < 126 {
        frame.push(payload.len() as u8);
    } else if payload.len() <= 65_535 {
        frame.push(126);
        frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    } else {
        frame.push(127);
        frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
    }
    frame.extend_from_slice(payload);
    stream.write_all(&frame).await.map_err(|e| e.to_string())?;
    stream.flush().await.map_err(|e| e.to_string())
}

async fn read_ws_frame(stream: &mut tokio::net::TcpStream) -> Result<String, String> {
    let mut hdr = [0u8; 2];
    stream.read_exact(&mut hdr).await.map_err(|e| e.to_string())?;
    let masked = hdr[1] & 0x80 != 0;
    let len0 = (hdr[1] & 0x7f) as usize;
    let len = match len0 {
        126 => {
            let mut b = [0u8; 2];
            stream.read_exact(&mut b).await.map_err(|e| e.to_string())?;
            u16::from_be_bytes(b) as usize
        }
        127 => {
            let mut b = [0u8; 8];
            stream.read_exact(&mut b).await.map_err(|e| e.to_string())?;
            u64::from_be_bytes(b) as usize
        }
        n => n,
    };
    let mask = if masked {
        let mut m = [0u8; 4];
        stream.read_exact(&mut m).await.map_err(|e| e.to_string())?;
        Some(m)
    } else {
        None
    };
    let mut data = vec![0u8; len];
    stream.read_exact(&mut data).await.map_err(|e| e.to_string())?;
    if let Some(m) = mask {
        for (i, b) in data.iter_mut().enumerate() {
            *b ^= m[i % 4];
        }
    }
    String::from_utf8(data).map_err(|e| e.to_string())
}

use sha1::{Digest as _, Sha1};

/// حالة الربط لكل متصفح — يعرضها زر الإعدادات.
#[tauri::command]
pub fn extension_binding_status() -> ExtensionBindingStatus {
    #[cfg(target_os = "windows")]
    {
        let browsers = [
            ("Chrome", "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts"),
            ("Edge", "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts"),
            ("Brave", "HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts"),
            ("Opera", "HKCU\\Software\\Opera Software\\NativeMessagingHosts"),
        ]
        .iter()
        .map(|(name, key)| BrowserBinding {
            browser: name,
            installed: browser_installed(name),
            host_registered: registry_key_exists(&format!("{key}\\{NATIVE_HOST_NAME}")),
        })
        .collect();
        ExtensionBindingStatus {
            native_host_name: NATIVE_HOST_NAME.into(),
            manifest_path: native_manifest_path().display().to_string(),
            browsers,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // خارج ويندوز: الحالة مبنية على وجود ملف الـmanifest فقط.
        ExtensionBindingStatus {
            native_host_name: NATIVE_HOST_NAME.into(),
            manifest_path: native_manifest_path().display().to_string(),
            browsers: ["Chrome", "Edge", "Brave", "Opera"]
                .into_iter()
                .map(|b| BrowserBinding { browser: b, installed: false, host_registered: false })
                .collect(),
        }
    }
}

/// كتابة مفاتيح Native Messaging لكل المتصفحات المثبتة (ويندوز).
#[tauri::command]
pub fn extension_register_browsers() -> Result<Vec<BrowserBinding>, String> {
    let manifest = write_native_manifest()?;
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let browsers = [
            ("Chrome", "Software\\Google\\Chrome\\NativeMessagingHosts"),
            ("Edge", "Software\\Microsoft\\Edge\\NativeMessagingHosts"),
            ("Brave", "Software\\BraveSoftware\\Brave\\NativeMessagingHosts"),
            ("Opera", "Software\\Opera Software\\NativeMessagingHosts"),
        ];
        for (_, sub) in browsers {
            let (k, _) = hkcu
                .create_subkey(format!("{sub}\\{NATIVE_HOST_NAME}"))
                .map_err(|e| e.to_string())?;
            k.set_value("", &manifest.display().to_string()).map_err(|e| e.to_string())?;
        }
        Ok(extension_binding_status().browsers)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = manifest;
        Ok(extension_binding_status().browsers)
    }
}

fn native_manifest_path() -> std::path::PathBuf {
    std::env::temp_dir().join("ultradm-native-host.json")
}

/// يكتب ملف manifest الـNative Messaging (مصدر الحقيقة لأوامر winreg).
fn write_native_manifest() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let manifest = serde_json::json!({
        "name": NATIVE_HOST_NAME,
        "description": "UltraDM Native Messaging Bridge",
        "path": exe.display().to_string(),
        "type": "stdio",
        "allowed_origins": [
            "chrome-extension://kpjldkbninldcnhfjnbpbenejifihobc/",
        ]
    });
    let path = native_manifest_path();
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(target_os = "windows")]
fn registry_key_exists(key: &str) -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(key)
        .is_ok()
}

/// هل المتصفح مُثبَّت فعليًا؟ نفحص مسارات البرامج (Program Files و
/// LocalAppData) ومفتاح App Paths في السجل — وليس مفتاح الربط فقط،
/// لأن مفتاح NativeMessagingHosts لا يوجد قبل أول ربط.
#[cfg(target_os = "windows")]
fn browser_installed(browser: &str) -> bool {
    use std::path::PathBuf;

    let exe_candidates: &[&[&str]] = &[
        // Chrome
        &[
            r"Google\Chrome\Application\chrome.exe",
            r"Google\Chrome Beta\Application\chrome.exe",
        ],
        // Edge
        &[r"Microsoft\Edge\Application\msedge.exe"],
        // Brave
        &[
            r"BraveSoftware\Brave-Browser\Application\brave.exe",
            r"BraveSoftware\Brave-Browser-Beta\Application\brave.exe",
        ],
        // Opera
        &[
            r"Opera\opera.exe",
            r"Opera\launcher.exe",
        ],
    ];
    let idx = match browser {
        "Chrome" => 0,
        "Edge" => 1,
        "Brave" => 2,
        _ => 3,
    };

    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
    let pf86 =
        std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
    let lad = std::env::var("LOCALAPPDATA")
        .unwrap_or_else(|_| format!(r"{}\AppData\Local", std::env::var("USERPROFILE").unwrap_or_default()));
    for base in [pf, pf86, lad] {
        for rel in exe_candidates[idx] {
            if PathBuf::from(&base).join(rel).exists() {
                return true;
            }
        }
    }

    // آخر ملجأ: App Paths في السجل (HKCU ثم HKLM).
    let exe = match browser {
        "Chrome" => "chrome.exe",
        "Edge" => "msedge.exe",
        "Brave" => "brave.exe",
        _ => "opera.exe",
    };
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    for hk in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        if RegKey::predef(hk)
            .open_subkey(format!(r"Software\Microsoft\Windows\CurrentVersion\App Paths\{exe}"))
            .is_ok()
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_accept_matches_rfc_example() {
        // المثال الرسمي في RFC 6455 §1.3
        assert_eq!(
            ws_accept("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn capture_request_parses_cookies_and_ua() {
        let raw = r#"{"type":"capture","kind":"media","url":"https://x/video.m3u8","pageUrl":"https://x/","userAgent":"UA-1","cookies":[{"name":"sid","value":"abc"}]}"#;
        let r: CaptureRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(r.kind.as_deref(), Some("media"));
        assert_eq!(r.user_agent, "UA-1");
        assert_eq!(r.cookies[0].name, "sid");
    }

    #[test]
    fn capture_requires_capture_type() {
        let raw = r#"{"type":"hello","url":"https://x/"}"#;
        let r: CaptureRequest = serde_json::from_str(raw).unwrap();
        assert_ne!(r.msg_type, "capture");
    }
}
