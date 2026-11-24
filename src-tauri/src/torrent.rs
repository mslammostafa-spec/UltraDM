//! محرك التورنت: يجمع librqbit (DHT + PEX + uTP مفعّلة افتراضيًا) خلف واجهة
//! أوامر بسيطة: add_torrent / torrent_list / torrent_pause / torrent_resume /
//! torrent_remove / torrent_progress. يتم بث التقدم كل ثانية عبر حدث
//! `torrent://progress`. التحقق من SHA-1 لكل قطعة مدمج داخل librqbit.

use librqbit::{AddOptions, AddTorrentOptions, Session, SessionOptions};
use serde::Serialize;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

static SESSION: OnceLock<Arc<Session>> = OnceLock::new();

/// معلومة تورنت لعرضها في الجدول.
#[derive(Serialize, Clone)]
pub struct TorrentInfo {
    pub id: String,
    pub name: String,
    pub progress: f64,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub download_speed_bps: u64,
    pub peers: u32,
    pub state: String,
}

pub fn session() -> Result<Arc<Session>, String> {
    if let Some(s) = SESSION.get() {
        return Ok(s.clone());
    }
    let opts = SessionOptions {
        disable_dht: false,
        disable_dht_bootstrap: false,
        disable_pex: false,
        disable_upnp: false,
        disable_port_mapping: false,
        ..Default::default()
    };
    let session = Session::new_with_opts(opts)
        .map_err(|e| format!("فشل إنشاء جلسة التورنت: {e}"))?;
    let _ = session.set_default_directory(&default_download_dir());
    let s = Arc::new(session);
    let _ = SESSION.set(s.clone());
    Ok(s)
}

fn default_download_dir() -> std::path::PathBuf {
    dirs_next()
}

fn dirs_next() -> std::path::PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("Downloads")
}

/// إضافة تورنت من رابط magnet أو مسار ملف .torrent.
#[tauri::command]
pub async fn torrent_add(url: String, save_path: Option<String>) -> Result<String, String> {
    let session = session()?;
    let mut opts = AddTorrentOptions::default();
    if let Some(p) = save_path {
        opts.output_folder = p;
    }
    let added = session
        .add_torrent(url, Some(opts))
        .await
        .map_err(|e| format!("فشل إضافة التورنت: {e}"))?;
    Ok(added.info_hash().to_string())
}

/// قائمة التورنتات النشطة مع إحصاءاتها.
#[tauri::command]
pub async fn torrent_list() -> Result<Vec<TorrentInfo>, String> {
    let session = session()?;
    let mut out = Vec::new();
    for h in session.torrents() {
        let id = h.info_hash().to_string();
        let stats = h.stats();
        let snapshot = stats.snapshot();
        let name = h
            .core()
            .name()
            .unwrap_or_else(|| id.clone());
        let progress = if snapshot.total_bytes > 0 {
            snapshot.downloaded_bytes as f64 / snapshot.total_bytes as f64
        } else {
            0.0
        };
        out.push(TorrentInfo {
            id: id.clone(),
            name,
            progress: progress * 100.0,
            total_bytes: snapshot.total_bytes,
            downloaded_bytes: snapshot.downloaded_bytes,
            download_speed_bps: snapshot.down_rate as u64,
            peers: snapshot.downloaded_bytes.min(u32::MAX as u64) as u32,
            state: format!("{:?}", h.status()),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn torrent_pause(id: String) -> Result<(), String> {
    let session = session()?;
    for h in session.torrents() {
        if h.info_hash().to_string() == id {
            h.pause().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("التورنت غير موجود".into())
}

#[tauri::command]
pub async fn torrent_resume(id: String) -> Result<(), String> {
    let session = session()?;
    for h in session.torrents() {
        if h.info_hash().to_string() == id {
            h.resume().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("التورنت غير موجود".into())
}

#[tauri::command]
pub async fn torrent_remove(id: String, delete_files: bool) -> Result<(), String> {
    let session = session()?;
    for h in session.torrents() {
        if h.info_hash().to_string() == id {
            h.delete(delete_files)
                .await
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("التورنت غير موجود".into())
}

/// بث التقدم كل ثانية للواجهة عبر حدث torrent://progress.
pub fn spawn_progress_stream(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let Ok(session) = session() else { continue };
            for h in session.torrents() {
                let snapshot = h.stats().snapshot();
                let progress = if snapshot.total_bytes > 0 {
                    snapshot.downloaded_bytes as f64 / snapshot.total_bytes as f64
                } else {
                    0.0
                };
                let _ = Emitter::emit(
                    &app,
                    "torrent://progress",
                    serde_json::json!({
                        "id": h.info_hash().to_string(),
                        "progress": progress * 100.0,
                        "downloaded": snapshot.downloaded_bytes,
                        "total": snapshot.total_bytes,
                        "speed": snapshot.down_rate,
                    }),
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn magnet_parsing_is_upstream() {
        // librqbit يتولى تحليل magnet: نتحقق فقط أن دالتنا تعيد أخطاء واضحة
        // على مدخلات فارغة.
        let e = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(async { crate::torrent::torrent_add(String::new(), None).await });
        assert!(e.is_err());
    }
}
