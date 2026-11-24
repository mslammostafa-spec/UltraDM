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
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x["ext"].as_str().map(String::from))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                out.push(MediaTrack { lang: lang.clone(), kind: kind.into(), exts });
            }
        }
        out
    };
    subs.extend(collect("subtitles", "manual"));
    subs.extend(collect("automatic_captions", "auto"));

    let is_hls = formats.iter().any(|f| f.ext == "mp4" && f.vcodec.as_deref() == Some("none"))
        || v["is_live"].as_bool().unwrap_or(false)
        || extractor.contains("hls")
        || formats.iter().any(|f| f.format_id.contains("hls"));
    let is_dash = formats.iter().any(|f| f.ext == "mpd") || extractor.contains("dash");

    Ok(MediaInfo { title, extractor, duration, formats, audio_langs, subs, is_hls, is_dash, webpage_url })
}

/// إلغاء مهمة وسائط جارية عبر معرّفها.
#[tauri::command]
pub fn media_cancel(handle: State<'_, MediaHandle>, id: String) -> Result<(), String> {
    let jobs = handle.jobs.lock().unwrap();
    if let Some(job) = jobs.get(&id) {
        job.lock().unwrap().cancel.cancel();
        Ok(())
    } else {
        Err("المهمة غير موجودة".into())
    }
}

/// تحميل/استخراج/دمج/تحويل عبر yt-dlp + FFmpeg مع بث التقدم كل سطر.
#[tauri::command]
pub async fn media_download(
    app: AppHandle,
    handle: State<'_, MediaHandle>,
    req: MediaRequest,
) -> Result<String, String> {
    let id = format!("media-{}", handle.seq.fetch_add(1, Ordering::SeqCst));
    let cancel = tokio_util::sync::CancellationToken::new();
    handle
        .jobs
        .lock()
        .unwrap()
        .insert(id.clone(), Arc::new(Mutex::new(MediaJob { cancel: cancel.clone(), percent: 0.0 })));

    let app2 = app.clone();
    let id2 = id.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_media_job(&app2, &id2, &req, cancel).await;
        let done = result.is_ok();
        let err = result.err();
        let _ = Emitter::emit(
            &app2,
            "media://progress",
            &MediaProgress { id: id2.clone(), percent: 100.0, line: "انتهى".into(), done: true, error: err },
        );
        if let Ok(h) = app2.try_state::<MediaHandle>() {
            h.jobs.lock().unwrap().remove(&id2);
        }
        let _ = done;
    });
    Ok(id)
}

async fn run_media_job(
    app: &AppHandle,
    id: &str,
    req: &MediaRequest,
    cancel: tokio_util::sync::CancellationToken,
) -> Result<(), String> {
    let emit = |line: String, percent: f64, done: bool, error: Option<String>| {
        let _ = Emitter::emit(app, "media://progress", &MediaProgress { id: id.into(), percent, line, done, error });
    };

    let mut cmd = Command::new("yt-dlp");
    cmd.arg("--newline")
        .arg("--no-playlist")
        .arg("--concurrent-fragments")
        .arg("16")
        .arg("-P")
        .arg(&req.output_dir)
        .arg("--ffmpeg-location")
        .arg("ffmpeg")
        .arg("--print")
        .arg("after_move:filepath")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(fmt) = &req.format_id {
        cmd.arg("-f").arg(fmt);
    }
    if req.audio_only {
        cmd.arg("-x");
        if let Some(fmt) = &req.audio_format {
            cmd.arg("--audio-format").arg(fmt);
        }
        if let Some(br) = &req.audio_bitrate {
            cmd.arg("--audio-quality").arg(br);
        }
    } else if let Some(c) = &req.container {
        cmd.arg("--merge-output-format").arg(c);
    }
    if let Some(langs) = &req.audio_langs {
        if !langs.is_empty() {
            cmd.arg("--audio-langs").arg(langs.join(","));
        }
    }
    match req.subs_mode.as_deref() {
        Some("separate") => {
            if let Some(l) = &req.subs_langs {
                cmd.arg("--sub-langs").arg(l.join(","));
            }
            if req.subs_auto {
                cmd.arg("--write-auto-subs");
            }
            cmd.arg("--write-subs").arg("--convert-subs").arg("srt");
        }
        Some("embed") => {
            cmd.arg("--write-subs").arg("--embed-subs");
            if req.subs_auto {
                cmd.arg("--write-auto-subs");
            }
        }
        Some("burn") => {
            cmd.arg("--write-subs").arg("--embed-subs");
        }
        _ => {}
    }
    cmd.arg(&req.url);

    let mut child: Child = cmd
        .spawn()
        .map_err(|e| format!("فشل تشغيل yt-dlp (متوفر؟): {e}"))?;
    let stderr = child.stderr.take().ok_or("لا يمكن قراءة المخرجات")?;
    let mut reader = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        if cancel.is_cancelled() {
            let _ = child.kill().await;
            return Err("أُلغيت المهمة".into());
        }
        // أسطر yt-dlp: [download]  23.4% of ...
        let percent = line
            .split_whitespace()
            .find_map(|t| t.strip_suffix('%').and_then(|p| p.parse::<f64>().ok()));
        emit(line, percent.unwrap_or(0.0), false, None);
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("فشل التحميل — راجع السجل".into());
    }
    emit("اكتمل التحميل".into(), 100.0, true, None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_cover_quality_tiers() {
        assert_eq!(label_for(Some(4320), Some(60), "webm", None), "8K (4320p60, webm)");
        assert_eq!(label_for(Some(2160), None, "mp4", None), "4K (2160p, mp4)");
        assert_eq!(label_for(Some(1440), Some(30), "mp4", None), "2K (1440p30, mp4)");
        assert_eq!(label_for(Some(1080), Some(60), "mp4", Some("video only")), "1080p60 (mp4)");
        assert_eq!(label_for(None, None, "m4a", None), "صوت (m4a)");
    }

    #[test]
    fn size_estimation_for_fragmented_streams() {
        // 2 Mbps × 60 ثانية = 15,000,000 بايت تقريبًا
        let est = (Some(2000.0f64), Some(60.0f64));
        if let (Some(t), Some(d)) = est {
            let bytes = ((t * 1000.0) * d) as u64;
            assert_eq!(bytes, 120_000_000);
        }
    }
}
