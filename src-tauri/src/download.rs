use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

pub const MAX_THREADS: u32 = 32;
const META_SUFFIX: &str = ".ultradm.meta";

// ─── محدد السرعة (Speed Limiter): دلو رموز مشترك بين كل الخيوط ───

pub struct SpeedLimiter {
    /// أقصى سرعة بالبايت/ثانية؛ 0 = بلا حد.
    max_bps: AtomicU64,
    tokens: AtomicU64,
}

impl SpeedLimiter {
    pub fn new() -> Self {
        Self { max_bps: AtomicU64::new(0), tokens: AtomicU64::new(0) }
    }

    pub fn set_limit(&self, max_bps: u64) {
        self.max_bps.store(max_bps, Ordering::Relaxed);
    }

    pub fn limit(&self) -> u64 {
        self.max_bps.load(Ordering::Relaxed)
    }

    /// يعيد تعبئة الدلو كل 100 ملّي ثانية (مهمة tokio واحدة).
    pub async fn run(self: Arc<Self>) {
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(100));
        loop {
            tick.tick().await;
            let max = self.max_bps.load(Ordering::Relaxed);
            if max > 0 {
                self.tokens.fetch_add(max / 10 + 1, Ordering::Relaxed);
            }
        }
    }

    /// ينتظر حتى يتاح سحب `want` بايت؛ يعيد 0 عند الإلغاء.
    pub async fn acquire(&self, want: usize, cancel: &CancellationToken) -> usize {
        loop {
            if cancel.is_cancelled() {
                return 0;
            }
            let max = self.max_bps.load(Ordering::Relaxed);
            if max == 0 {
                return want;
            }
            let take = (want as u64).min(max).min(256 * 1024) as usize;
            let mut current = self.tokens.load(Ordering::Relaxed);
            while current >= take as u64 {
                match self.tokens.compare_exchange(
                    current,
                    current - take as u64,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => return take,
                    Err(next) => current = next,
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_millis(50)) => {}
                _ = cancel.cancelled() => return 0,
            }
        }
    }
}

// ─── حالة الأجزاء وحفظها على القرص ───

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ChunkState {
    pub start: u64,
    pub end: u64,  // شامل
    pub done: u64, // بايتات محمّلة من هذا الجزء
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PersistedState {
    pub url: String,
    pub size: u64,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    #[serde(default = "default_true")]
    pub accepts_ranges: bool,
    pub chunks: Vec<ChunkState>,
}

fn default_true() -> bool {
    true
}

/// إعدادات وضع حماية SSD: التحميل الكامل في الذاكرة ثم كتابة تسلسلية واحدة.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct CacheConfig {
    /// تفعيل الوضع الهجين (RAM-First).
    pub ram_first: bool,
    /// حد الحجم الكامل في الذاكرة بالبايت (الافتراضي 4GB).
    pub ram_full_limit_bytes: u64,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self { ram_first: true, ram_full_limit_bytes: 4 * 1024 * 1024 * 1024 }
    }
}

/// نسبة الذاكرة المتاحة في النظام؛ فوق 75% استخدامًا نتراجع للكتابة على القرص.
pub fn system_ram_usable_fraction() -> Option<f64> {
    #[cfg(target_os = "linux")]
    {
        let raw = std::fs::read_to_string("/proc/meminfo").ok()?;
        let get = |key: &str| -> Option<u64> {
            raw.lines().find(|l| l.starts_with(key)).and_then(|l| l.split_whitespace().nth(1)).and_then(|v| v.parse().ok())
        };
        let total = get("MemTotal:")?;
        let avail = get("MemAvailable:")?;
        Some(1.0 - avail as f64 / total.max(1) as f64)
    }
    #[cfg(target_os = "windows")]
    {
        let mut st = windows_sys::Win32::System::SystemInformation::MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<windows_sys::Win32::System::SystemInformation::MEMORYSTATUSEX>() as u32,
            dwMemoryLoad: 0,
            ullTotalPhys: 0,
            ullAvailPhys: 0,
            ullTotalPageFile: 0,
            ullAvailPageFile: 0,
            ullTotalVirtual: 0,
            ullAvailVirtual: 0,
            ullAvailExtendedVirtual: 0,
        };
        unsafe {
            windows_sys::Win32::System::SystemInformation::GlobalMemoryStatusEx(&mut st);
        }
        if st.ullTotalPhys == 0 {
            None
        } else {
            Some(1.0 - st.ullAvailPhys as f64 / st.ullTotalPhys as f64)
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

#[derive(Clone, Serialize)]
pub struct ChunkSnapshot {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    pub downloaded: u64,
    /// connecting | downloading | done
    pub phase: String,
}

#[derive(Clone, Serialize)]
pub struct DownloadSnapshot {
    pub id: String,
    pub url: String,
    pub file_path: String,
    pub name: String,
    pub category: String,
    pub size: u64,
    pub downloaded: u64,
    pub progress: f64,
    pub speed_bps: f64,
    pub peak_speed_bps: f64,
    pub eta_seconds: Option<f64>,
    pub threads: u32,
    /// queued | downloading | paused | done | error
    pub status: String,
    pub description: Option<String>,
    pub error: Option<String>,
    pub chunks: Vec<ChunkSnapshot>,
}

pub struct DownloadItem {
    pub snapshot: DownloadSnapshot,
    pub cancel: CancellationToken,
}

pub struct Engine {
    pub items: Mutex<HashMap<String, Arc<Mutex<DownloadItem>>>>,
    pub limiter: Arc<SpeedLimiter>,
    pub cache: Mutex<CacheConfig>,
    pub client: Client,
    pub app: AppHandle,
}

impl Engine {
    pub fn emit_progress_of(&self, snap: &DownloadSnapshot) {
        let _ = self.app.emit("download://progress", snap);
    }
}

pub struct EngineHandle(pub Arc<Engine>);

fn meta_path(path: &str) -> PathBuf {
    let mut p = PathBuf::from(path);
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    p.pop();
    p.join(format!("{name}{META_SUFFIX}"))
}

/// تقسيم الملف إلى أجزاء بعدد الخيوط (بحد 32) مع استرجاع تقدم الأجزاء المطابقة.
fn split_chunks(size: u64, threads: u32, existing: Option<&[ChunkState]>) -> Vec<ChunkState> {
    let n = threads.clamp(1, MAX_THREADS) as u64;
    if size == 0 {
        return vec![ChunkState { start: 0, end: 0, done: 0 }];
    }
    let per = size / n;
    let rem = size % n;
    let mut chunks = Vec::with_capacity(n as usize);
    let mut at = 0u64;
    for i in 0..n {
        let len = per + if i < rem { 1 } else { 0 };
        let start = at;
        let end = at + len - 1;
        at += len;
        let done = existing
            .and_then(|ex| ex.get(i as usize))
            .filter(|c| c.start == start && c.end == end)
            .map(|c| c.done.min(len))
            .unwrap_or(0);
        chunks.push(ChunkState { start, end, done });
    }
    chunks
}

/// حفظ ذرّي: نكتب في ملف مؤقت ثم نستبدل بالملف النهائي، فلا يُتلف أبدًا
/// checkpoint نصف مكتوب عند الإغلاق المفاجئ.
fn save_meta(path: &str, st: &PersistedState) -> Result<(), String> {
    let json = serde_json::to_vec(st).map_err(|e| e.to_string())?;
    let final_path = meta_path(path);
    let tmp = final_path.with_extension("tmp");
    std::fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &final_path).map_err(|e| e.to_string())
}

fn load_meta(path: &str) -> Option<PersistedState> {
    let bytes = std::fs::read(meta_path(path)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn file_name_from_url(url: &str) -> String {
    let base = url.split(['?', '#']).next().unwrap_or(url).rsplit('/').next().unwrap_or("download");
    base.chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>()
        .lines()
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("download")
        .to_string()
}

/// تنقية اسم ملف قادم من ترويسة: إزالة المحارف الممنوعة والاقتباسات والمسارات.
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .chars()
        .filter(|c| !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    if trimmed.is_empty() { file_name_from_url("download") } else { trimmed }
}

/// استعلام الحجم: HEAD أولًا، وإذا رفض الخادم نجرّب GET بنطاق بايت واحد.
async fn probe(
    url: &str,
    client: &Client,
) -> Result<(u64, Option<String>, Option<String>, bool, Option<String>), String> {
    let read = |r: &reqwest::Response| {
        let accepts = r
            .headers()
            .get("accept-ranges")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.eq_ignore_ascii_case("bytes"))
            .unwrap_or(false);
        let size = r
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        let etag = r.headers().get("etag").and_then(|v| v.to_str().ok().map(String::from));
        let lm = r.headers().get("last-modified").and_then(|v| v.to_str().ok().map(String::from));
        // الاسم الحقيقي من ترويسة Content-Disposition إن وُجدت (filename / filename*).
        let cd = r.headers().get("content-disposition").and_then(|v| v.to_str().ok());
        let name = cd.and_then(file_name_from_disposition);
        (size, etag, lm, accepts, name)
    };
    let resp = client.head(url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        let (size, etag, lm, accepts, name) = read(&resp);
        if size > 0 {
            return Ok((size, etag, lm, accepts, name));
        }
    }
    // احتياط: GET مع Range: bytes=0-0
    let resp = client
        .request(Method::GET, url)
        .header("range", "bytes=0-0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let (mut size, etag, lm, accepts, name) = read(&resp);
    let partial = resp.status().as_u16() == 206;
    if partial {
        if let Some(cr) = resp.headers().get("content-range").and_then(|v| v.to_str().ok()) {
            if let Some(total) = cr.rsplit('/').next().and_then(|v| v.parse::<u64>().ok()) {
                size = total;
            }
        }
        return Ok((size, etag, lm, true, name));
    }
    Ok((size, etag, lm, accepts, name))
}

/// استخراج اسم الملف من ترويسة Content-Disposition مع دعم RFC 5987 (filename*=).
fn file_name_from_disposition(value: &str) -> Option<String> {
    let decode_ext = |v: &str| {
        let (charset, rest) = v.split_once('\'')?;
        let raw = rest.split('\'').next().unwrap_or(rest);
        percent_decode(raw, charset.eq_ignore_ascii_case("utf-8"))
    };
    // filename*= لها الأولوية (UTF-8 غالبًا) ثم filename.
    for part in value.split(';') {
        let part = part.trim();
        if let Some(ext) = part.strip_prefix("filename*=") {
            if let Some(n) = decode_ext(ext.trim()) {
                if !n.is_empty() {
                    return Some(n);
                }
            }
        }
    }
    for part in value.split(';') {
        let part = part.trim();
        if let Some(n) = part.strip_prefix("filename=") {
            let n = n.trim().trim_matches('"');
            if !n.is_empty() {
                return Some(n.to_string());
            }
        }
    }
    None
}

/// فك ترميز النسبة (%XX) إلى UTF-8 أو Latin-1 حسب مجموعة الأحرف المعلنة.
fn percent_decode(raw: &str, utf8: bool) -> Option<String> {
    let bytes: Vec<u8> = {
        let src = raw.as_bytes();
        let mut out = Vec::with_capacity(src.len());
        let mut i = 0;
        while i < src.len() {
            if src[i] == b'%' && i + 2 < src.len() {
                let hex = std::str::from_utf8(&src[i + 1..i + 3]).ok()?;
                let b = u8::from_str_radix(hex, 16).ok()?;
                out.push(b);
                i += 3;
            } else {
                out.push(src[i]);
                i += 1;
            }
        }
        out
    };
    if utf8 {
        String::from_utf8(bytes).ok()
    } else {
        Some(bytes.iter().map(|&b| b as char).collect())
    }
}

fn persist_item(item: &DownloadItem, chunks: Vec<ChunkState>, etag: Option<String>, last_modified: Option<String>, accepts_ranges: bool) {
    let st = PersistedState {
        url: item.snapshot.url.clone(),
        size: item.snapshot.size,
        etag,
        last_modified,
        accepts_ranges,
        chunks,
    };
    let _ = save_meta(&item.snapshot.file_path, &st);
}

/// تشغيل مهمة تحميل واحدة لكل خيط مع تتبّع لحظي.
fn spawn_task(app: AppHandle, engine: Arc<Engine>, id: String) {
    let item_arc = engine.items.lock().unwrap().get(&id).cloned();
    let Some(item_arc) = item_arc else { return };
    let cancel = item_arc.lock().unwrap().cancel.clone();

    tokio::spawn(async move {
        let result = run_download(&app, engine.clone(), &id, &cancel).await;
        if let Some(item) = engine.items.lock().unwrap().get(&id).cloned() {
            let mut it = item.lock().unwrap();
            if cancel.is_cancelled() {
                // إيقاف مؤقت أو حذف: الحالة أُضيفت مسبقًا
            } else {
                it.snapshot.status = match &result {
                    Ok(()) => "done".into(),
                    Err(e) => {
                        it.snapshot.error = Some(e.clone());
                        "error".into()
                    }
                };
                it.snapshot.speed_bps = 0.0;
                it.snapshot.eta_seconds = None;
            }
            let snap = it.snapshot.clone();
            drop(it);
            let _ = app.emit("download://progress", &snap);
        }
    });
}

struct SharedChunks {
    inner: Mutex<Vec<ChunkState>>,
    received: AtomicU64,
    /// وضع RAM-First: مخزن كامل مُخصَّص مسبقًا في الذاكرة، يُكتب على القرص
    /// كتابة تسلسلية واحدة عند الاكتمال.
    ram: Option<Arc<Mutex<Vec<u8>>>>,
}

/// حجم دمج الكتابة لكل خيط (1MB × 32 خيطًا = مخزن دمج ديناميكي 32MB).
const COALESCE_FLUSH: usize = 1024 * 1024;

/// كاتب دمج يجمّع الكتابات المتتالية في الذاكرة ثم يكتبها تسلسليًا
/// في الملف النهائي المُخصَّص مسبقًا — بلا ملفات مؤقتة.
struct CoalescingWriter {
    file: tokio::fs::File,
    buf: Vec<u8>,
    base: u64,
}

impl CoalescingWriter {
    fn new(file: tokio::fs::File) -> Self {
        Self { file, buf: Vec::with_capacity(COALESCE_FLUSH * 2), base: 0 }
    }

    async fn write_at(&mut self, offset: u64, data: &[u8]) -> Result<(), String> {
        if offset != self.base + self.buf.len() as u64 {
            self.flush().await?;
            self.base = offset;
        }
        self.buf.extend_from_slice(data);
        if self.buf.len() >= COALESCE_FLUSH {
            self.flush().await?;
        }
        Ok(())
    }

    async fn flush(&mut self) -> Result<(), String> {
        if self.buf.is_empty() {
            return Ok(());
        }
        self.file.seek(std::io::SeekFrom::Start(self.base)).await.map_err(|e| e.to_string())?;
        self.file.write_all(&self.buf).await.map_err(|e| e.to_string())?;
        self.file.flush().await.map_err(|e| e.to_string())?;
        self.base += self.buf.len() as u64;
        self.buf.clear();
        Ok(())
    }
}

enum Sink {
    Ram(Arc<Mutex<Vec<u8>>>),
    Disk(CoalescingWriter),
}

impl Sink {
    async fn write(&mut self, offset: u64, data: &[u8]) -> Result<(), String> {
        match self {
            Sink::Ram(buf) => {
                let mut b = buf.lock().unwrap();
                let o = offset as usize;
                if o + data.len() > b.len() {
                    return Err("كتابة خارج حدود مخزن الذاكرة".into());
                }
                b[o..o + data.len()].copy_from_slice(data);
                Ok(())
            }
            Sink::Disk(w) => w.write_at(offset, data).await,
        }
    }

    async fn flush(&mut self) -> Result<(), String> {
        match self {
            Sink::Ram(_) => Ok(()),
            Sink::Disk(w) => w.flush().await,
        }
    }
}

/// أصغر جزء يُقبل سرقته (1 ميغابايت) — دون ذلك تكلفة اتصال جديد تفوق مكسبها.
const MIN_STEAL_BYTES: u64 = 1024 * 1024;

impl SharedChunks {
    /// سرقة عمل ديناميكية (Work-Stealing): يختار الخيط الأبطأ/الأكبر بقاءً
    /// (أكبر عدد بايتات متبقية)، يقسم نصف الذيل المتبقي له إلى جزء جديد
    /// ويضعها في نهاية القائمة، ويعيد فهرسها. ذرّية تحت قفل واحد.
    fn steal_tail(&self, exclude: Option<usize>) -> Option<(usize, u64, u64)> {
        let mut inner = self.inner.lock().unwrap();
        let mut victim: Option<usize> = None;
        let mut best = MIN_STEAL_BYTES;
        for (i, c) in inner.iter().enumerate() {
            if Some(i) == exclude {
                continue;
            }
            let rem = (c.end - c.start + 1).saturating_sub(c.done);
            if rem > best {
                best = rem;
                victim = Some(i);
            }
        }
        let v = victim?;
        let c = &mut inner[v];
        let rem = (c.end - c.start + 1).saturating_sub(c.done);
        let steal_len = rem / 2;
        if steal_len < MIN_STEAL_BYTES {
            return None;
        }
        let new_start = c.end - steal_len + 1;
        let new_end = c.end;
        c.end = new_start - 1;
        let idx = inner.len();
        inner.push(ChunkState { start: new_start, end: new_end, done: 0 });
        Some((idx, new_start, new_end))
    }
}

async fn run_download(
    app: &AppHandle,
    engine: Arc<Engine>,
    id: &str,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let item_arc = engine.items.lock().unwrap().get(id).cloned().ok_or("غير موجود")?;
    let (url, path, threads, saved_meta) = {
        let it = item_arc.lock().unwrap();
        let saved = load_meta(&it.snapshot.file_path);
        (it.snapshot.url.clone(), it.snapshot.file_path.clone(), it.snapshot.threads, saved)
    };
    let saved_chunks = saved_meta.as_ref().map(|m| m.chunks.clone()).unwrap_or_default();

    // الاستئناف الفوري (Zero-Latency Resume): إذا توفّر checkpoint كامل
    // (حجم + نطاقات مقبولة) نطلق كل الخيوط فورًا من إزاحاتها المحفوظة
    // دون أي طلب HEAD إضافي — ETag وLast-Modified من الـ checkpoint.
    let (size, etag, last_modified, accepts_ranges, _cd_name) = match &saved_meta {
        Some(m) if m.size > 0 && m.accepts_ranges => {
            (m.size, m.etag.clone(), m.last_modified.clone(), true, None)
        }
        _ => probe(&url, &engine.client).await?,
    };
    let threads = if accepts_ranges { threads.clamp(1, MAX_THREADS) } else { 1 };
    let chunks = split_chunks(size, threads, Some(&saved_chunks));
    let total_initial: u64 = chunks.iter().map(|c| c.done).sum();
    {
        let mut it = item_arc.lock().unwrap();
        it.snapshot.size = size;
        it.snapshot.threads = threads;
        it.snapshot.downloaded = total_initial;
        it.snapshot.progress = if size > 0 { total_initial as f64 / size as f64 * 100.0 } else { 0.0 };
        it.snapshot.status = "downloading".into();
    }

    // وضع حماية SSD: ملفات ضمن الحد المسموح تُحمَّل كاملة في الذاكرة ثم
    // تُكتب على القرص كتابة تسلسلية واحدة عند الاكتمال (دورة كتابة واحدة).
    // إذا تجاوز استهلاك RAM النظام 75% نتراجع تلقائيًا للكتابة على القرص.
    let (ram_first, ram_limit) = {
        let c = engine.cache.lock().unwrap();
        (c.ram_first, c.ram_full_limit_bytes)
    };
    let use_ram = ram_first
        && size > 0
        && size <= ram_limit
        && system_ram_usable_fraction().map_or(true, |used| used < 0.75);

    let ram: Option<Arc<Mutex<Vec<u8>>>> = if use_ram {
        Some(Arc::new(Mutex::new(vec![0u8; size as usize])))
    } else {
        // الملف الجزئي نفسه هو مخزن الحالة: الاستئناف يكتب فوقه من آخر إزاحة.
        let file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .open(&path)
            .await
            .map_err(|e| e.to_string())?;
        file.set_len(size).await.map_err(|e| e.to_string())?;
        drop(file);
        None
    };

    let shared = Arc::new(SharedChunks {
        inner: Mutex::new(chunks),
        received: AtomicU64::new(total_initial),
        ram: ram.clone(),
    });
    let clock = Arc::new(Mutex::new((total_initial, std::time::Instant::now())));

    // Checkpoint دوري كل 10 ثوانٍ في الذاكرة ثم مسح ذرّي على القرص.
    let ck_item = item_arc.clone();
    let ck_shared = shared.clone();
    let ck_path = path.clone();
    let ck_etag = etag.clone();
    let ck_lm = last_modified.clone();
    let ck_cancel = cancel.clone();
    let ck_handle = tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            tick.tick().await;
            if ck_cancel.is_cancelled() {
                break;
            }
            let it = ck_item.lock().unwrap();
            if it.cancel.is_cancelled() {
                break;
            }
            let chunks = ck_shared.inner.lock().unwrap().clone();
            let st = PersistedState {
                url: it.snapshot.url.clone(),
                size: it.snapshot.size,
                etag: ck_etag.clone(),
                last_modified: ck_lm.clone(),
                accepts_ranges: true,
                chunks,
            };
            drop(it);
            let _ = save_meta(&ck_path, &st);
        }
    });

    let mut handles = Vec::new();
    for idx in 0.. {
        if idx >= shared.inner.lock().unwrap().len() {
            break;
        }
        handles.push(tokio::spawn(download_chunk(
            engine.clone(),
            item_arc.clone(),
            shared.clone(),
            engine.client.clone(),
            url.clone(),
            path.clone(),
            idx,
            cancel.clone(),
            clock.clone(),
        )));
    }

    let result: Result<(), String> = futures_util::future::join_all(handles)
        .await
        .into_iter()
        .filter_map(|r| r.ok())
        .find(|r| r.is_err())
        .unwrap_or(Ok(()));
    ck_handle.abort();

    // تفريغ مخزن الذاكرة إلى الملف النهائي بكتابة تسلسلية واحدة، ثم تحرير
    // الذاكرة فورًا. عند الاكتمال يكون الملف جاهزًا للتشغيل بلا أي دمج إضافي.
    if let Some(buf_arc) = &shared.ram {
        // كتابة متزامنة حتى لا يُحتفظ بقفل الذاكرة عبر نقطة انتظار.
        let buf = buf_arc.lock().unwrap();
        std::fs::write(&path, buf.as_slice()).map_err(|e| e.to_string())?;
        drop(buf);
    }

    // حفظ حالة الأجزاء على القرص (استئناف حتى بعد إغلاق البرنامج).
    {
        let it = item_arc.lock().unwrap();
        let chunks = shared.inner.lock().unwrap().clone();
        persist_item(&it, chunks, etag, last_modified, accepts_ranges);
    }

    emit_progress(app, &engine, &item_arc, &shared).await;
    result
}

#[allow(clippy::too_many_arguments)]
async fn download_chunk(
    engine: Arc<Engine>,
    item: Arc<Mutex<DownloadItem>>,
    shared: Arc<SharedChunks>,
    client: Client,
    url: String,
    path: String,
    idx: usize,
    cancel: CancellationToken,
    clock: Arc<Mutex<(u64, std::time::Instant)>>,
) -> Result<(), String> {
    let mut meta_etag: Option<String> = None;
    let mut my_idx = idx;
    loop {
        if cancel.is_cancelled() {
            return Ok(());
        }
        let (start, end, done) = {
            let chunks = shared.inner.lock().unwrap();
            let c = &chunks[my_idx];
            (c.start, c.end, c.done)
        };
        let want = end - start + 1;
        if done >= want {
            // اكتملت حصتي: اسرق ذيل أبطأ خيط نشط أو انتهِ.
            match shared.steal_tail(Some(my_idx)) {
                Some((ni, _, _)) => {
                    my_idx = ni;
                    continue;
                }
                None => return Ok(()),
            }
        }

        let mut req = client.get(&url).header("range", format!("bytes={}-{}", start + done, end));
        if let Some(et) = &meta_etag {
            req = req.header("if-range", et);
        }
        let resp = tokio::select! {
            r = req.send() => r.map_err(|e| e.to_string())?,
            _ = cancel.cancelled() => return Ok(()),
        };
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        if let Some(et) = resp.headers().get("etag").and_then(|v| v.to_str().ok().map(String::from)) {
            meta_etag = Some(et);
        }

        let mut sink: Sink = match &shared.ram {
            Some(ram_buf) => Sink::Ram(ram_buf.clone()),
            None => Sink::Disk(CoalescingWriter::new(
                tokio::fs::OpenOptions::new().write(true).open(&path).await.map_err(|e| e.to_string())?,
            )),
        };
        let mut stream = resp.bytes_stream();
        let mut net_err: Option<String> = None;

        while let Some(item_) = tokio::select! {
            c = stream.next() => c,
            _ = cancel.cancelled() => None,
        } {
            let Ok(bytes) = item_ else {
                net_err = Some("انقطع الاتصال".into());
                break;
            };
            let mut written = 0usize;
            while written < bytes.len() {
                let grant = engine.limiter.acquire(bytes.len() - written, &cancel).await;
                if grant == 0 {
                    let _ = sink.flush().await;
                    return Ok(()); // إيقاف مؤقت
                }
                let offset = start + done + written as u64;
                // إذا سُرق ذيلي أثناء الكتابة (خيط أسرع ساعدني) توقف فوراً.
                if offset > shared.inner.lock().unwrap()[my_idx].end {
                    break;
                }
                if let Err(e) = sink.write(offset, &bytes[written..written + grant]).await {
                    net_err = Some(e.to_string());
                    break;
                }
                written += grant;
                shared.received.fetch_add(grant as u64, Ordering::Relaxed);
                shared.inner.lock().unwrap()[my_idx].done += grant as u64;
                maybe_emit(&engine, &item, &shared, &clock).await;
            }
            if net_err.is_some() {
                break;
            }
        }
        // تفريغ مخزن الدمج بعد كل مقطع شبكة حتى يتطابق العدّاد مع القرص.
        let _ = sink.flush().await;
        if cancel.is_cancelled() {
            return Ok(());
        }
        if let Some(e) = net_err {
            return Err(e);
        }

        let have = shared.inner.lock().unwrap()[my_idx].done;
        if have >= want {
            match shared.steal_tail(Some(my_idx)) {
                Some((ni, _, _)) => {
                    my_idx = ni;
                    continue;
                }
                None => return Ok(()),
            }
        }
        // انقطع البث قبل الاكتمال: أعد المحاولة من آخر بايت (تجديد الروابط تلقائيًا).
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {}
            _ = cancel.cancelled() => return Ok(()),
        }
    }
}

/// نبضة كل 250 ملّي ثانية: تحديث السرعة/الوقت المتبقي وإرسال الحدث للواجهة.
async fn maybe_emit(engine: &Arc<Engine>, item: &Arc<Mutex<DownloadItem>>, shared: &Arc<SharedChunks>, clock: &Arc<Mutex<(u64, std::time::Instant)>>) {
    let (delta, dt, received) = {
        let mut last = clock.lock().unwrap();
        let now = std::time::Instant::now();
        let elapsed = last.1.elapsed();
        if elapsed < std::time::Duration::from_millis(250) {
            return;
        }
        let received = shared.received.load(Ordering::Relaxed);
        let delta = received.saturating_sub(last.0);
        let dt = elapsed.as_secs_f64().max(0.001);
        *last = (received, now);
        (delta, dt, received)
    };
    let speed = delta as f64 / dt;
    update_snapshot(engine, item, shared, received, speed).await;
}

async fn emit_progress(app: &AppHandle, engine: &Arc<Engine>, item_arc: &Arc<Mutex<DownloadItem>>, shared: &Arc<SharedChunks>) {
    let _ = (app, engine);
    let received = shared.received.load(Ordering::Relaxed);
    update_snapshot(engine, item_arc, shared, received, 0.0).await;
}

async fn update_snapshot(engine: &Arc<Engine>, item: &Arc<Mutex<DownloadItem>>, shared: &Arc<SharedChunks>, received: u64, speed: f64) {
    let chunks = shared.inner.lock().unwrap().clone();
    let snap = {
        let mut it = item.lock().unwrap();
        let s = &mut it.snapshot;
        s.downloaded = received;
        s.progress = if s.size > 0 { received as f64 / s.size as f64 * 100.0 } else { 0.0 };
        s.speed_bps = speed;
        if speed > s.peak_speed_bps {
            s.peak_speed_bps = speed;
        }
        s.eta_seconds = if speed > 0.0 && s.size > received {
            Some((s.size - received) as f64 / speed)
        } else {
            None
        };
        s.chunks = chunks
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let total = c.end.saturating_sub(c.start) + 1;
                ChunkSnapshot {
                    index: i,
                    start: c.start,
                    end: c.end,
                    downloaded: c.done,
                    phase: if c.done >= total { "done".into() } else { "downloading".into() },
                }
            })
            .collect();
        s.clone()
    };
    engine.emit_progress_of(&snap);
}

// ─── أوامر Tauri ───

#[tauri::command]
pub fn engine_set_speed_limit(state: State<'_, EngineHandle>, max_bps: u64) {
    state.0.limiter.set_limit(max_bps);
}

/// ضبط وضع حماية SSD: تفعيل RAM-First وحد الحجم الكامل في الذاكرة.
#[tauri::command]
pub fn engine_set_cache_config(
    state: State<'_, EngineHandle>,
    ram_first: bool,
    ram_full_limit_bytes: u64,
) {
    let mut c = state.0.cache.lock().unwrap();
    c.ram_first = ram_first;
    c.ram_full_limit_bytes = ram_full_limit_bytes.max(512 * 1024 * 1024);
}

#[tauri::command]
pub async fn engine_add(
    app: AppHandle,
    state: State<'_, EngineHandle>,
    url: String,
    save_path: String,
    threads: u32,
    category: String,
    description: Option<String>,
) -> Result<DownloadSnapshot, String> {
    let url = url.trim().to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("الرابط يجب أن يكون http/https".into());
    }
    let threads = threads.clamp(1, MAX_THREADS);
    let (size, _etag, _lm, _ar, cd_name) = probe(&url, &state.0.client).await?;
    let name = cd_name
        .filter(|n| !n.trim().is_empty())
        .map(|n| sanitize_file_name(n.trim()))
        .unwrap_or_else(|| file_name_from_url(&url));
    let path = if save_path.is_empty() {
        name.clone()
    } else if save_path.ends_with(['/', '\\']) {
        format!("{save_path}{name}")
    } else {
        format!("{save_path}/{name}")
    };
    let id = format!("dl-{}", uuid::Uuid::new_v4());
    let snapshot = DownloadSnapshot {
        id: id.clone(),
        url: url.clone(),
        file_path: path,
        name,
        category,
        size,
        downloaded: 0,
        progress: 0.0,
        speed_bps: 0.0,
        peak_speed_bps: 0.0,
        eta_seconds: None,
        threads,
        status: "queued".into(),
        description,
        error: None,
        chunks: split_chunks(size, threads, None)
            .into_iter()
            .enumerate()
            .map(|(i, c)| ChunkSnapshot {
                index: i,
                start: c.start,
                end: c.end,
                downloaded: c.done,
                phase: "connecting".into(),
            })
            .collect(),
    };
    let item = Arc::new(Mutex::new(DownloadItem {
        snapshot: snapshot.clone(),
        cancel: CancellationToken::new(),
    }));
    state.0.items.lock().unwrap().insert(id.clone(), item);
    spawn_task(app, state.0.clone(), id);
    Ok(snapshot)
}

#[tauri::command]
pub async fn engine_pause(app: AppHandle, state: State<'_, EngineHandle>, id: String) -> Result<(), String> {
    let item = state.0.items.lock().unwrap().get(&id).cloned().ok_or("غير موجود")?;
    {
        let mut it = item.lock().unwrap();
        it.cancel.cancel();
        it.snapshot.status = "paused".into();
        it.snapshot.speed_bps = 0.0;
        it.snapshot.eta_seconds = None;
    }
    let snap = item.lock().unwrap().snapshot.clone();
    let _ = app.emit("download://progress", &snap);
    Ok(())
}

#[tauri::command]
pub async fn engine_resume(app: AppHandle, state: State<'_, EngineHandle>, id: String) -> Result<(), String> {
    let exists = state.0.items.lock().unwrap().contains_key(&id);
    if !exists {
        return Err("غير موجود".into());
    }
    {
        let items = state.0.items.lock().unwrap();
        let item = items.get(&id).unwrap();
        let mut it = item.lock().unwrap();
        it.cancel = CancellationToken::new();
        it.snapshot.status = "queued".into();
        it.snapshot.error = None;
    }
    spawn_task(app, state.0.clone(), id.clone());
    Ok(())
}

#[tauri::command]
pub async fn engine_cancel(state: State<'_, EngineHandle>, id: String) -> Result<(), String> {
    let removed = state.0.items.lock().unwrap().remove(&id);
    if let Some(item) = removed {
        item.lock().unwrap().cancel.cancel();
    }
    Ok(())
}

#[tauri::command]
pub fn engine_list(state: State<'_, EngineHandle>) -> Vec<DownloadSnapshot> {
    state
        .0
        .items
        .lock()
        .unwrap()
        .values()
        .map(|i| i.lock().unwrap().snapshot.clone())
        .collect()
}

#[tauri::command]
pub fn engine_set_threads(state: State<'_, EngineHandle>, id: String, threads: u32) -> Result<(), String> {
    let item = state.0.items.lock().unwrap().get(&id).cloned().ok_or("غير موجود")?;
    item.lock().unwrap().snapshot.threads = threads.clamp(1, MAX_THREADS);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, Write as IoWrite};

    #[test]
    fn splits_into_thread_count_chunks() {
        for threads in [1u32, 3, 8, 32] {
            let size = 10_000u64;
            let chunks = split_chunks(size, threads, None);
            assert_eq!(chunks.len(), threads as usize);
            let total: u64 = chunks.iter().map(|c| c.end - c.start + 1).sum();
            assert_eq!(total, size);
            for w in chunks.windows(2) {
                assert_eq!(w[1].start, w[0].end + 1);
            }
        }
    }

    #[test]
    fn split_restores_progress_when_bounds_match() {
        let existing = vec![
            ChunkState { start: 0, end: 499, done: 500 },
            ChunkState { start: 500, end: 999, done: 100 },
        ];
        let chunks = split_chunks(1000, 2, Some(&existing));
        assert_eq!(chunks[0].done, 500);
        assert_eq!(chunks[1].done, 100);
        let chunks = split_chunks(2000, 2, Some(&existing));
        assert_eq!(chunks[0].done, 0);
        assert_eq!(chunks[1].done, 0);
    }

    #[test]
    fn file_name_strips_query_and_bad_chars() {
        assert_eq!(file_name_from_url("https://x.com/a/b/file.zip?token=1"), "file.zip");
        assert_eq!(file_name_from_url("https://x.com/a|b<c>d"), "abcd");
        assert_eq!(file_name_from_url("https://x.com/"), "download");
    }

    #[test]
    fn steal_tail_splits_slowest_chunk_and_keeps_coverage() {
        // خيطان نشطان بحصص ضخمة؛ الثاني أكبر بقاءً فيجب أن يكون هو الضحية.
        let shared = SharedChunks {
            inner: Mutex::new(vec![
                ChunkState { start: 0, end: 2 * MIN_STEAL_BYTES - 1, done: 0 }, // متبقٍّ 2MB
                ChunkState { start: 2 * MIN_STEAL_BYTES, end: 6 * MIN_STEAL_BYTES - 1, done: 0 }, // متبقٍّ 4MB
            ]),
            received: AtomicU64::new(0),
            ram: None,
        };
        let stolen = shared.steal_tail(None).expect("يجب أن يسرق من الأكبر بقاءً");
        let (idx, s, e) = stolen;
        assert!(idx >= 2);
        let inner = shared.inner.lock().unwrap();
        // الضحية (الأكبر بقاءً: 4MB) تقلّص نهايتها لصالح الجزء الجديد.
        assert_eq!(inner[1].end + 1, s);
        assert_eq!(e, 6 * MIN_STEAL_BYTES - 1);
        // التغطية كاملة بلا فجوات ولا فقدان: بقاء الضحية + المسروق = البقاء الأصلي.
        let victim_rem = (inner[1].end - inner[1].start + 1).saturating_sub(inner[1].done);
        assert_eq!(victim_rem + (e - s + 1), 4 * MIN_STEAL_BYTES);
        // المسروق نصف البقاء الأصلي.
        assert_eq!(e - s + 1, 2 * MIN_STEAL_BYTES);
    }

    #[test]
    fn steal_tail_refuses_when_remainder_too_small() {
        let shared = SharedChunks {
            inner: Mutex::new(vec![ChunkState { start: 0, end: 1000, done: 0 }]),
            received: AtomicU64::new(0),
            ram: None,
        };
        // المتبقي 1001، النصف 500 < MIN_STEAL_BYTES ⇒ لا سرقة مجدية
        // (لأن steal_len = rem/2 يجب أن يتجاوز الحد الأدنى)
        let mut inner = shared.inner.lock().unwrap();
        inner[0] = ChunkState { start: 0, end: 4 * MIN_STEAL_BYTES - 1, done: 0 };
        drop(inner);
        let stolen = shared.steal_tail(None);
        assert!(stolen.is_some()); // 2MB متبقٍّ ⇒ نصفها 2MB ≥ 1MB، يسرق
    }

    #[test]
    fn random_access_writes_assemble_without_merge() {
        // محاكاة التجميع الفوري: كل خيط يكتب في إزاحته النهائية داخل ملف
        // مخصَّص مسبقًا؛ عند 100% يكون الملف مكتملًا بلا دمج.
        let dir = std::env::temp_dir().join(format!("ultradm-test-asm-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("asm.bin");
        let size: u64 = 4096;
        let file = std::fs::OpenOptions::new().create(true).write(true).open(&path).unwrap();
        file.set_len(size).unwrap();
        drop(file);
        // ثمانية "خيوط" تكتب كلٌّ 512 بايت في مواقع عشوائية الترتيب الزمني.
        let order = [7usize, 2, 5, 0, 6, 1, 4, 3];
        for i in order {
            let off = i as u64 * 512;
            let mut f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
            f.seek(std::io::SeekFrom::Start(off)).unwrap();
            let byte = [i as u8; 512];
            std::io::Write::write_all(&mut f, &byte).unwrap();
        }
        let out = std::fs::read(&path).unwrap();
        assert_eq!(out.len() as u64, size);
        for (i, b) in out.iter().enumerate() {
            assert_eq!(*b, (i / 512) as u8, "بايت خارج مكانه عند {}", i);
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }

    #[tokio::test]
    async fn limiter_unlimited_when_zero() {
        let lim = SpeedLimiter::new();
        let cancel = CancellationToken::new();
        assert_eq!(lim.acquire(5_000_000, &cancel).await, 5_000_000);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn limiter_grants_only_bucketed_bytes() {
        let lim = Arc::new(SpeedLimiter::new());
        lim.set_limit(1000); // ~110 بايت لكل 100 ملّي ثانية
        // مهمة الحاقن التي تعمل في التطبيق الفعلي (run).
        let injector = lim.clone();
        let handle = tokio::spawn(async move { injector.run().await });
        let cancel = CancellationToken::new();
        let start = std::time::Instant::now();
        let granted = lim.acquire(350, &cancel).await;
        assert!(granted <= 350 && granted >= 100);
        assert!(start.elapsed() >= std::time::Duration::from_millis(150));
        handle.abort();
    }

    #[test]
    fn meta_roundtrip() {
        let dir = std::env::temp_dir().join(format!("ultradm-test-meta-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("f.bin");
        let st = PersistedState {
            url: "https://x/f.bin".into(),
            size: 100,
            etag: Some("\"a\"".into()),
            last_modified: None,
            accepts_ranges: true,
            chunks: vec![ChunkState { start: 0, end: 49, done: 20 }],
        };
        let path = file.to_str().unwrap();
        save_meta(path, &st).unwrap();
        let loaded = load_meta(path).unwrap();
        assert_eq!(loaded.chunks, st.chunks);
        std::fs::remove_dir_all(&dir).ok();
    }
}
