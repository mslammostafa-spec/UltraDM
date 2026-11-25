//! تكامل yt-dlp و FFmpeg: تحليل روابط الفيديو/الصوت/البث المباشر
//! (أكثر من 1700 موقع + M3U8/MPD) واستخراج الجودات والمسارات الصوتية
//! والترجمات، ثم التحميل والدمج والتحويل عبر FFmpeg.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

/// حالة أداة خارجية: هل مُثبَّتة وأي إصدار.
#[derive(Serialize)]
pub struct ToolStatus {
    pub ytdlp: bool,
    pub ffmpeg: bool,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct MediaFormat {
    pub format_id: String,
    pub ext: String,
    pub height: Option<u32>,
    pub fps: Option<u32>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub size: Option<u64>,
    pub tbr: Option<f64>,
    pub lang: Option<String>,
    pub label: String,
}

#[derive(Serialize, Clone)]
pub struct MediaTrack {
    pub lang: String,
    pub kind: String, // manual | auto
    pub exts: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct MediaInfo {
    pub title: String,
    pub extractor: String,
    pub duration: Option<f64>,
    pub formats: Vec<MediaFormat>,
    pub audio_langs: Vec<String>,
    pub subs: Vec<MediaTrack>,
    pub is_hls: bool,
    pub is_dash: bool,
    pub webpage_url: String,
}

#[derive(Clone, Serialize)]
pub struct MediaProgress {
    pub id: String,
    pub percent: f64,
    pub line: String,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct MediaRequest {
    pub url: String,
    pub output_dir: String,
    #[serde(default)]
    pub format_id: Option<String>,
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default)]
    pub audio_only: bool,
    #[serde(default)]
    pub audio_format: Option<String>,
    #[serde(default)]
    pub audio_bitrate: Option<String>,
    #[serde(default)]
    pub audio_langs: Option<Vec<String>>,
    #[serde(default)]
    pub subs_langs: Option<Vec<String>>,
    #[serde(default)]
    pub subs_auto: bool,
    #[serde(default)]
    pub subs_mode: Option<String>, // none | separate | embed | burn
}

struct MediaJob {
    cancel: tokio_util::sync::CancellationToken,
    percent: f64,
}

pub struct MediaHandle {
    pub jobs: Mutex<HashMap<String, Arc<Mutex<MediaJob>>>>,
    pub seq: AtomicU64,
}

impl Default for MediaHandle {
    fn default() -> Self {
        Self { jobs: Mutex::new(HashMap::new()), seq: AtomicU64::new(1) }
    }
}

fn run_capture(cmd: &mut std::process::Command) -> Result<String, String> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// فحص توفّر yt-dlp و FFmpeg وإصداريهما.
#[tauri::command]
pub fn media_check() -> ToolStatus {
    let ytdlp = run_capture(std::process::Command::new("yt-dlp").arg("--version").stdout(Stdio::piped()).stderr(Stdio::null()));
    let ffmpeg = run_capture(std::process::Command::new("ffmpeg").arg("-version").stdout(Stdio::piped()).stderr(Stdio::null()));
    let first = |s: String| s.lines().next().map(String::from);
    ToolStatus {
        ytdlp: ytdlp.is_ok(),
        ffmpeg: ffmpeg.is_ok(),
        ytdlp_version: ytdlp.ok().and_then(first),
        ffmpeg_version: ffmpeg.ok().and_then(first),
    }
}

fn label_for(height: Option<u32>, fps: Option<u32>, ext: &str, note: Option<&str>) -> String {
    match height {
        Some(h) => {
            let name = match h {
                4320 => "8K",
                2560 => "2.5K",
                2160 => "4K",
                1440 => "2K",
                _ => "",
            };
            let f = fps.filter(|f| *f >= 50).map(|f| format!("{f}")).unwrap_or_default();
            let extra = note.filter(|n| !n.is_empty() && *n != "video only").map(|n| format!(" — {n}")).unwrap_or_default();
            if name.is_empty() {
                format!("{h}p{f} ({ext}){extra}")
            } else {
                format!("{name} ({h}p{f}, {ext}){extra}")
            }
        }
        None => format!("صوت ({ext})"),
    }
}

fn s_opt(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().filter(|s| !s.is_empty() && *s != "none").map(String::from)
}

/// تحليل الرابط عبر yt-dlp -J: كل الجودات من الأعلى للأدنى، لغات الصوت،
/// ولغات الترجمة (اليدوية والمولَّدة تلقائيًا).
#[tauri::command]
pub async fn media_probe(url: String) -> Result<MediaInfo, String> {
    let url_arg = url.clone();
    let out = tokio::task::spawn_blocking(move || {
        run_capture(
            std::process::Command::new("yt-dlp")
                .arg("-J")
                .arg("--no-playlist")
                .arg(&url_arg)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped()),
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    let v: serde_json::Value = serde_json::from_str(&out).map_err(|e| format!("تحليل JSON: {e}"))?;
    let title = v["title"].as_str().unwrap_or("بدون عنوان").to_string();
    let extractor = v["extractor_key"].as_str().or(v["extractor"].as_str()).unwrap_or("").to_string();
    let duration = v["duration"].as_f64();
    let webpage_url = v["webpage_url"].as_str().unwrap_or(&url).to_string();

    let mut formats: Vec<MediaFormat> = Vec::new();
    if let Some(list) = v["formats"].as_array() {
        for f in list {
            let id = f["format_id"].as_str().unwrap_or_default().to_string();
            if id.is_empty() {
                continue;
            }
            let vcodec = s_opt(f, "vcodec");
            let acodec = s_opt(f, "acodec");
            let height = f["height"].as_u64().map(|h| h as u32);
            let fps = f["fps"].as_u64().map(|h| h as u32);
            let ext = f["ext"].as_str().unwrap_or("?").to_string();
            let size = f["filesize"].as_u64().or(f["filesize_approx"].as_u64());
            let tbr = f["tbr"].as_f64();
            let lang = f["language"].as_str().map(String::from);
            let note = f["format_note"].as_str().unwrap_or("");
            // تقدير الحجم لمقاطع البث (HLS) من معدل البت والمدة.
            let size = size.or_else(|| match (tbr, duration) {
                (Some(t), Some(d)) if t > 0.0 => Some(((t * 1000.0) * d) as u64),
                _ => None,
            });
            let label = label_for(height, fps, &ext, Some(note));
            formats.push(MediaFormat { format_id: id, ext, height, fps, vcodec, acodec, size, tbr, lang, label });
        }
    }
    // الأعلى دقةً أولًا ثم الأعلى إطارًا ثم الأعلى معدل بت.
    formats.sort_by(|a, b| {
        let ka = (a.height.unwrap_or(0), a.fps.unwrap_or(0));
        let kb = (b.height.unwrap_or(0), b.fps.unwrap_or(0));
        kb.cmp(&ka).then(b.tbr.partial_cmp(&a.tbr).unwrap_or(std::cmp::Ordering::Equal))
    });

    // لغات الصوت من الصيغ ذات acodec فعّال.
    let mut audio_langs: Vec<String> = Vec::new();
    if let Some(list) = v["formats"].as_array() {
        for f in list {
            let ac = f["acodec"].as_str().unwrap_or("none");
            if ac == "none" {
                continue;
            }
            if let Some(l) = f["language"].as_str() {
                if !l.is_empty() && !audio_langs.iter().any(|x| x == l) {
                    audio_langs.push(l.to_string());
                }
            }
        }
    }
    audio_langs.sort();

    // الترجمات اليدوية والمولدة تلقائيًا (كل اللغات دون استثناء).
    let mut subs: Vec<MediaTrack> = Vec::new();
    let collect = |key: &str, kind: &str| -> Vec<MediaTrack> {
        let mut out = Vec::new();
        if let Some(map) = v[key].as_object() {
            for (lang, variants) in map {
                let exts: Vec<String> = variants
                    .as_array()
                    .map(|a| a.iter().filter_map(|x| x["ext"].as_str().map(String::from)).collect())
                    .unwrap_or_default();
                out.push(MediaTrack { lang: lang.clone(), kind: kind.into(), exts });
            }
        }
        out
    };
    subs.extend(collect("subtitles", "manual"));
    subs.extend(collect("automatic_captions", "auto"));
    subs.sort_by(|a, b| a.lang.cmp(&b.lang).then(a.kind.cmp(&b.kind)));

    let is_hls = url.contains(".m3u8") || out.contains("m3u8");
    let is_dash = url.contains(".mpd") || out.contains("\"protocol\": \"http_dash_segments\"") || out.contains("dash");
    Ok(MediaInfo {
        title,
        extractor,
        duration,
        formats,
        audio_langs,
        subs,
        is_hls,
        is_dash,
        webpage_url,
    })
}

/// بناء وسيطات yt-dlp من طلب المستخدم.
pub fn build_args(req: &MediaRequest) -> Vec<String> {
    let mut a = vec![
        "--no-playlist".into(),
        "--newline".into(),
        "--no-part".into(),
        "--concurrent-fragments".into(), "16".into(), // بث متقطع: تجزئة متوازية
        "-o".into(),
        format!("{}/%(title)s.%(ext)s", req.output_dir.trim_end_matches('/').trim()),
    ];
    if let Some(f) = &req.format_id {
        if f != "best" {
            a.extend(["-f".into(), f.clone()]);
        }
    }
    let mode = req.subs_mode.clone().unwrap_or_else(|| "none".into());
    if let Some(container) = &req.container {
        if req.audio_only {
            a.extend(["-x".into(), "--audio-format".into(), container.clone()]);
            if let Some(b) = &req.audio_bitrate {
                a.extend(["--audio-quality".into(), b.clone()]);
            }
        } else {
            a.extend(["--merge-output-format".into(), container.clone()]);
        }
    }
    if let Some(langs) = &req.audio_langs {
        if !langs.is_empty() {
            a.extend(["--audio-langs".into(), langs.join(",")]);
        }
    }
    if let Some(langs) = &req.subs_langs {
        if !langs.is_empty() && mode != "none" {
            a.push("--write-subs".into());
            if req.subs_auto {
                a.push("--write-auto-subs".into());
            }
            if mode == "embed" {
                a.push("--embed-subs".into());
            } else {
                a.push("--no-embed-subs".into());
            }
            a.push("--sub-langs".into());
            a.push(langs.join(","));
            if mode == "separate" {
                a.extend(["--convert-subs".into(), "srt".into()]);
            }
        }
    }
    if mode == "embed" {
        a.push("--embed-metadata".into());
    }
    a.push(req.url.clone());
    a
}

/// استخراج النسبة المئوية من سطر تقدم yt-dlp بصيغة --newline.
pub fn parse_percent(line: &str) -> Option<f64> {
    let i = line.find('%')?;
    let start = line[..i].rfind(|c: char| c.is_whitespace() || c == '[')? + 1;
    line[start..i].trim().parse().ok()
}

/// بدء تحميل وسائط عبر yt-dlp (مع FFmpeg للدمج/التحويل).
#[tauri::command]
pub async fn media_download(app: AppHandle, state: State<'_, MediaHandle>, req: MediaRequest) -> Result<String, String> {
    let id = format!("m{}", state.seq.fetch_add(1, Ordering::Relaxed));
    let args = build_args(&req);
    let mut child = Command::new("yt-dlp")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("تشغيل yt-dlp: {e} (تأكد من تثبيته في PATH)"))?;

    let stdout = child.stdout.take().ok_or("لا يوجد stdout")?;
    let cancel = tokio_util::sync::CancellationToken::new();
    let job = Arc::new(Mutex::new(MediaJob { cancel: cancel.clone(), percent: 0.0 }));
    state.jobs.lock().unwrap().insert(id.clone(), job.clone());

    // قراءة التقدم سطرًا بسطر وبثّه للواجهة.
    let job2 = job.clone();
    let id2 = id.clone();
    let app2 = app.clone();
    tokio::spawn(async move {
        let mut child: Child = child;
        let mut lines = BufReader::new(stdout).lines();
        let mut last_line: Option<String> = None;
        loop {
            let next = tokio::select! {
                l = lines.next_line() => l,
                _ = cancel.cancelled() => {
                    let _ = child.kill().await;
                    break;
                }
            };
            let Ok(Some(line)) = next else { break };
            if let Some(p) = parse_percent(&line) {
                job2.lock().unwrap().percent = p;
                let _ = app2.emit("media://progress", MediaProgress { id: id2.clone(), percent: p, line: line.clone(), done: false, error: None });
            }
            last_line = Some(line);
        }
        let done = child.wait().await.map(|s| s.success()).unwrap_or(false);
        let err = if done { None } else { Some(last_line.clone().unwrap_or_else(|| "أُلغي".into())) };
        let percent = if done { 100.0 } else { job2.lock().unwrap().percent };
        let _ = app2.emit("media://progress", MediaProgress { id: id2.clone(), percent, line: last_line.unwrap_or_default(), done: true, error: err });
    });
    Ok(id)
}

/// إلغاء تحميل وسائط جارٍ.
#[tauri::command]
pub fn media_cancel(state: State<'_, MediaHandle>, id: String) {
    if let Some(job) = state.jobs.lock().unwrap().remove(&id) {
        job.lock().unwrap().cancel.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_use_named_qualities() {
        assert_eq!(label_for(Some(2160), Some(30), "mp4", Some("video only")), "4K (2160p, mp4)");
        assert_eq!(label_for(Some(1080), Some(60), "webm", Some("1080p60 HDR")), "1080p60 (webm) — 1080p60 HDR");
        assert_eq!(label_for(Some(1080), Some(60), "mp4", None), "1080p60 (mp4)");
        assert_eq!(label_for(Some(140), None, "m4a", None), "140p (m4a)");
        assert_eq!(label_for(None, None, "m4a", None), "صوت (m4a)");
    }

    #[test]
    fn parses_ytdlp_progress_lines() {
        assert_eq!(parse_percent("[download]  42.7% of 12.34MiB"), Some(42.7));
        assert_eq!(parse_percent("[download] 100% of 1.00MiB"), Some(100.0));
        assert_eq!(parse_percent("[download] Destination: x.mp4"), None);
    }

    #[test]
    fn args_cover_streaming_and_subs() {
        let req = MediaRequest {
            url: "https://x/live.m3u8".into(),
            output_dir: "C:/D/".into(),
            format_id: Some("137+140".into()),
            container: Some("mkv".into()),
            audio_only: false,
            audio_format: None,
            audio_bitrate: None,
            audio_langs: Some(vec!["ara".into(), "eng".into()]),
            subs_langs: Some(vec!["all".into()]),
            subs_auto: true,
            subs_mode: Some("separate".into()),
        };
        let a = build_args(&req);
        assert!(a.contains(&"--concurrent-fragments".into()));
        assert!(a.contains(&"16".into()));
        assert!(a.contains(&"137+140".into()));
        assert!(a.contains(&"--sub-langs".into()));
        assert!(a.contains(&"all".into()));
        assert!(a.contains(&"--audio-langs".into()));
        assert!(a.contains(&"ara,eng".into()));
        assert!(a.contains(&"--convert-subs".into()));
        assert!(a.contains(&"https://x/live.m3u8".into()));
        assert_eq!(a.last().unwrap(), "https://x/live.m3u8");
    }

    #[test]
    fn audio_extraction_uses_bitrate() {
        let req = MediaRequest {
            url: "https://x/watch?v=1".into(),
            output_dir: "/tmp".into(),
            format_id: None,
            container: Some("mp3".into()),
            audio_only: true,
            audio_format: None,
            audio_bitrate: Some("320K".into()),
            audio_langs: None,
            subs_langs: None,
            subs_auto: false,
            subs_mode: Some("none".into()),
        };
        let a = build_args(&req);
        assert!(a.contains(&"-x".into()));
        assert!(a.contains(&"mp3".into()));
        assert!(a.contains(&"320K".into()));
    }
}
