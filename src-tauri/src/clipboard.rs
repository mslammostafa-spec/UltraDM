use arboard::Clipboard;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// هل النص المنسوخ رابط تحميل (ملف مباشر أو magnet أو .torrent)؟
pub fn is_download_url(s: &str) -> bool {
    let s = s.trim();
    if s.starts_with("magnet:?") {
        return true;
    }
    if !(s.starts_with("http://") || s.starts_with("https://")) || s.len() > 2048 || s.contains(char::is_whitespace) {
        return false;
    }
    let path = s.split(['?', '#']).next().unwrap_or("");
    let last = path.rsplit('/').next().unwrap_or("").to_ascii_lowercase();
    let page = [".html", ".htm", ".php", ".asp", ".aspx", ".jsp"];
    let file_like = last.contains('.') && !page.iter().any(|ext| last.ends_with(ext));
    file_like || s.contains("/download") || s.contains("dl=")
}

/// خيط نظام خفيف يقرأ الحافظة كل 150 ملّي ثانية ويرسل `clipboard://link` للواجهة.
pub fn spawn_watcher(app: AppHandle) {
    std::thread::Builder::new()
        .name("ultradm-clipboard".into())
        .spawn(move || {
            let Ok(mut clipboard) = Clipboard::new() else { return };
            let mut last = clipboard.get_text().unwrap_or_default();
            loop {
                std::thread::sleep(Duration::from_millis(150));
                let Ok(text) = clipboard.get_text() else { continue };
                if text == last {
                    continue;
                }
                last = text;
                if is_download_url(&last) {
                    let _ = app.emit("clipboard://link", last.trim().to_string());
                }
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::is_download_url;

    #[test]
    fn detects_download_links_only() {
        assert!(is_download_url("https://x.com/files/setup.exe"));
        assert!(is_download_url("magnet:?xt=urn:btih:abc"));
        assert!(is_download_url("https://x.com/download?id=5"));
        assert!(is_download_url("https://x.com/a/movie.torrent"));
        assert!(!is_download_url("https://x.com/page"));
        assert!(!is_download_url("https://x.com/index.html"));
        assert!(!is_download_url("hello world"));
        assert!(!is_download_url("ftp://x/f.bin"));
    }
}
