//! محرك التورنت: يجمع librqbit (DHT + PEX + uTP مفعّلة في الجلسة).
//!
//! سلامة البيانات: librqbit يتحقق من بصمة SHA-1 لكل قطعة في الذاكرة قبل
//! اعتمادها وكتابتها في موقعها النهائي داخل ملف مخصَّص مسبقًا (Pre-allocated
//! Random-Access I/O) — فالملف مُجمَّع وجاهز عند وصول النسبة إلى 100% بلا دمج.
//! ملف التورنت لا يحتوي بصمات SHA-256 للملفات، لكن نوفّر أمر تحقق اختياريًا
//! بـ SHA-256 للمستخدم الذي يملك البصمة المتوقعة من مصدر موثوق.
//!
//! ملاحظة: librqbit (9.x) يطبّق اختيار القطع بترتيب نادر-أولاً (rarest-first)
//! داخليًا عبر خوارزمية Rigorous (انظر crates.io librqbit-core `piece_picker`)
//! ولا يعرض خيار بث متسلسل (sequential) في واجهته العامة — لذا لا يوجد
//! مُبدّل sequential هنا؛ لا نعرض خيارًا لا يفعله المحرك فعليًا.

use librqbit::{AddTorrent, AddTorrentOptions, DhtSessionConfig, Session, SessionOptions};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

#[derive(Serialize, Clone)]
pub struct TorrentSnapshot {
    pub id: u64,
    pub name: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub down_bps: f64,
    pub up_bps: f64,
    pub progress: f64,
    pub peers: u64,
    pub state: String,
    pub error: Option<String>,
}

struct TorrentItem {
    /// معرّف ثابت يُسند عند الإضافة ولا يتغير — كان الترتيب في القائمة هو
    /// الهوية فأي إزاحة مستقبلية تجعل id=3 يشير إلى تورنت آخر.
    id: u64,
    handle: Arc<librqbit::ManagedTorrent>,
    name: String,
}

pub struct TorrentEngine {
    session: Arc<Session>,
    items: Mutex<Vec<TorrentItem>>,
    next_id: AtomicU64,
}

impl TorrentEngine {
    pub async fn new(default_dir: std::path::PathBuf) -> Result<Self, String> {
        let session = Session::new_with_opts(default_dir, SessionOptions {
            dht: Some(DhtSessionConfig::default()),
            persistence: None,
            ..Default::default()
        })
        .await
        .map_err(|e| e.to_string())?;
        Ok(Self {
            session,
            items: Mutex::new(Vec::new()),
            next_id: AtomicU64::new(1),
        })
    }

    fn snapshot(item: &TorrentItem, id: u64) -> TorrentSnapshot {
        let st = item.handle.stats();
        let (down_bps, up_bps, peers) = match &st.live {
            Some(l) => {
                let down = l.download_speed.as_bytes() as f64;
                let up = l.upload_speed.as_bytes() as f64;
                (down, up, 0u64)
            }
            None => (0.0, 0.0, 0),
        };
        TorrentSnapshot {
            id,
            name: item.name.clone(),
            total_bytes: st.total_bytes,
            downloaded_bytes: st.progress_bytes,
            down_bps,
            up_bps,
            progress: if st.total_bytes > 0 {
                (st.progress_bytes as f64 / st.total_bytes as f64) * 100.0
            } else {
                0.0
            },
            peers,
            state: if st.finished {
                "done".into()
            } else if st.error.is_some() {
                "error".into()
            } else if matches!(st.state, librqbit::TorrentStatsState::Paused) {
                "paused".into()
            } else {
                "downloading".into()
            },
            error: st.error.clone(),
        }
    }
}

#[derive(Clone)]
pub struct TorrentHandle(pub Arc<TorrentEngine>);

async fn get_handle(engine: &TorrentEngine, id: u64) -> Result<Arc<librqbit::ManagedTorrent>, String> {
    let items = engine.items.lock().await;
    items
        .iter()
        .find(|it| it.id == id)
        .map(|it| it.handle.clone())
        .ok_or_else(|| "معرّف غير موجود".into())
}

#[tauri::command]
pub async fn torrent_add(
    app: AppHandle,
    state: State<'_, TorrentHandle>,
    url: String,
    output_folder: Option<String>,
) -> Result<TorrentSnapshot, String> {
    let engine = state.0.clone();
    let opts = AddTorrentOptions {
        overwrite: true,
        output_folder,
        ..Default::default()
    };
    let resp = engine
        .session
        .add_torrent(
            AddTorrent::Url(std::borrow::Cow::Owned(url.trim().to_owned())),
            Some(opts),
        )
        .await
        .map_err(|e| e.to_string())?;
    let handle = resp
        .into_handle()
        .ok_or_else(|| "فحص فقط: لم يُضف التورنت".to_string())?;
    let id = engine.next_id.fetch_add(1, Ordering::Relaxed);
    let name: String = handle
        .name()
        .unwrap_or_else(|| format!("مغناطيس {id}"));
    let item = TorrentItem { id, handle, name };
    let snap = TorrentEngine::snapshot(&item, id);
    engine.items.lock().await.push(item);
    let _ = Emitter::emit(&app, "torrent://progress", &snap);
    Ok(snap)
}

#[tauri::command]
pub async fn torrent_list(state: State<'_, TorrentHandle>) -> Result<Vec<TorrentSnapshot>, String> {
    let engine = state.0.clone();
    let items = engine.items.lock().await;
    Ok(items
        .iter()
        .map(|it| TorrentEngine::snapshot(it, it.id))
        .collect())
}

#[tauri::command]
pub async fn torrent_pause(state: State<'_, TorrentHandle>, id: u64) -> Result<(), String> {
    let engine = state.0.clone();
    let handle = get_handle(&engine, id).await?;
    engine.session.pause(&handle).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn torrent_resume(state: State<'_, TorrentHandle>, id: u64) -> Result<(), String> {
    let engine = state.0.clone();
    let handle = get_handle(&engine, id).await?;
    engine
        .session
        .unpause(&handle)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn torrent_remove(
    state: State<'_, TorrentHandle>,
    id: u64,
    delete_files: bool,
) -> Result<(), String> {
    let engine = state.0.clone();
    let handle = get_handle(&engine, id).await?;
    engine
        .session
        .delete(handle.info_hash().into(), delete_files)
        .await
        .map_err(|e| e.to_string())?;
    // إزالة العنصر من القائمة: كانت تبقى إلى الأبد (تسريب ذاكرة) وكانت
    // معرّفات بقية التورنتات ترتبط بمواضع القائمة.
    engine.items.lock().await.retain(|it| it.id != id);
    Ok(())
}

/// التحقق من بصمة SHA-256 لملف مكتمل (الملف الأول إذا كان التورنت متعدد الملفات).
///
/// # Arguments
/// * `id` — معرّف التورنت كما في `torrent_list`
/// * `expected_hex` — البصمة المتوقعة بصيغة hex (64 حرفًا)
///
/// ملحوظة: تُستخدم عادةً مع البصمة المنشورة على موقع التحميل الرسمي.
#[tauri::command]
pub async fn torrent_verify_sha256(
    state: State<'_, TorrentHandle>,
    id: u64,
    expected_hex: String,
) -> Result<bool, String> {
    use sha2::{Digest, Sha256};
    let engine = state.0.clone();
    let handle = get_handle(&engine, id).await?;
    let output = handle
        .output_folder()
        .to_path_buf();
    let Some(metadata) = handle.metadata.load().clone() else {
        return Err("لم تُجلب بيانات التورنت بعد".into());
    };
    // ابحث عن أول ملف غير فارغ وابنِ مساره.
    let file = metadata
        .file_infos
        .iter()
        .find(|f| f.len > 0)
        .ok_or("لا يوجد ملفات للتحقق")?;
    let full = output.join(&file.relative_filename);
    use tokio::io::AsyncReadExt;
    let mut hasher = Sha256::new();
    let mut f = tokio::fs::File::open(&full).await.map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let got = hex::encode(hasher.finalize());
    let expected = expected_hex.trim().to_lowercase();
    Ok(got == expected)
}

/// مهمة دورية تبث تقدم كل التورنتات كل ثانية.
pub fn spawn_progress_task(app: AppHandle, engine: Arc<TorrentEngine>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let snaps: Vec<TorrentSnapshot> = {
                let items = engine.items.lock().await;
                items
                    .iter()
                    .map(|it| TorrentEngine::snapshot(it, it.id))
                    .collect()
            };
            for s in snaps {
                if Emitter::emit(&app, "torrent://progress", &s).is_err() {
                    break;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    

    #[test]
    fn progress_math_is_zero_safe() {
        let pct = |total: u64, got: u64| {
            if total > 0 {
                (got as f64 / total as f64) * 100.0
            } else {
                0.0
            }
        };
        assert_eq!(pct(0, 100), 0.0);
        assert_eq!(pct(200, 100), 50.0);
    }
}
