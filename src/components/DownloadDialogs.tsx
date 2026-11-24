import { useEffect, useMemo, useReducer, useState } from "react";
import {
  Film, Music, FileArchive, Package, FileText, Magnet, FolderOpen, Info, Gauge,
  CheckCircle2, Pause, Play, XCircle, ChevronDown, ChevronUp, HardDrive, FileClock,
} from "lucide-react";
import { Category, Download } from "../lib/ipc";
import { mediaCheck, mediaProbe, mediaDownload, type MediaInfo, type MediaFormat } from "../lib/media";
import { CATEGORY_LABEL, categoryFromName, fileNameFromUrl, formatBytes, formatEta, formatSpeed, previewSizeFor } from "../lib/format";
import { Modal, ThreadsPicker } from "./Dialogs";

const CAT_ICON: Record<Exclude<Category, "all">, typeof Film> = {
  video: Film, audio: Music, archive: FileArchive, software: Package,
  document: FileText, torrent: Magnet,
};

export interface StartConfig {
  url: string;
  category: Exclude<Category, "all">;
  savePath: string;
  description: string;
  threads: number;
}

const PATH_KEY = "ultradm.savepath.";

/* ─────────────────── نافذة معلومات التحميل (Download File Info) ─────────────────── */

export function DownloadInfoDialog({
  initialUrl, isTorrent, onClose, onStart, onLater,
}: {
  initialUrl: string;
  isTorrent: boolean;
  onClose: () => void;
  onStart: (cfg: StartConfig) => void;
  onLater: (cfg: StartConfig) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [description, setDescription] = useState("");
  const [threads, setThreads] = useState(8);
  const name = useMemo(() => (url.trim() ? fileNameFromUrl(url.trim()) : ""), [url]);
  const detected = url.trim() ? categoryFromName(name) : isTorrent ? "torrent" : "software";
  const [category, setCategory] = useState<Exclude<Category, "all">>(detected);
  const [remember, setRemember] = useState(true);
  const [savePath, setSavePath] = useState(
    () => localStorage.getItem(PATH_KEY + detected) ?? "C:\\Users\\Downloads\\UltraDM",
  );

  // عند تغيّر التصنيف يُستبدل المسار المحفوظ لهذا التصنيف إن وُجد.
  useEffect(() => {
    setSavePath(localStorage.getItem(PATH_KEY + category) ?? defaultPathFor(category));
  }, [category]);

  const build = (): StartConfig => {
    const path = savePath.trim() || defaultPathFor(category);
    if (remember) localStorage.setItem(PATH_KEY + category, path);
    return { url: url.trim(), category, savePath: path, description, threads };
  };

  const ready = url.trim().length > 0;
  const Icon = CAT_ICON[category];
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [tools, setTools] = useState<{ ytdlp: boolean; ffmpeg: boolean } | null>(null);
  const [fmt, setFmt] = useState<string>("best");
  const [container, setContainer] = useState("mp4");
  const [audioOnly, setAudioOnly] = useState(false);
  const [audioBitrate, setAudioBitrate] = useState("320K");
  const [audioLangs, setAudioLangs] = useState<string[]>([]);
  const [subLangs, setSubLangs] = useState<string[]>([]);
  const [subsAuto, setSubsAuto] = useState(true);
  const [subsMode, setSubsMode] = useState<"none" | "separate" | "embed" | "burn">("separate");
  const [showMedia, setShowMedia] = useState(false);

  // هل يبدو الرابط وسائط (يوتيوب/تواصل اجتماعي/بث متقطع)؟
  const looksMedia = useMemo(() => {
    const u = url.trim().toLowerCase();
    return /youtube|youtu\.be|tiktok|instagram|facebook|fb\.watch|twitter|x\.com|twitch|vimeo|dailymotion|soundcloud|reddit|\.m3u8|\.mpd|live|video|watch/.test(u);
  }, [url]);

  const probe = async () => {
    setProbing(true);
    setProbeErr(null);
    try {
      const t = await mediaCheck();
      setTools(t);
      if (!t.ytdlp) throw new Error("yt-dlp غير مثبَّت — ثبّته ثم أعد المحاولة");
      const info = await mediaProbe(url.trim());
      setMedia(info);
      setShowMedia(true);
    } catch (e) {
      setProbeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  const startMedia = async () => {
    if (!media) return;
    try {
      await mediaDownload({
        url: url.trim(),
        output_dir: savePath.trim() || defaultPathFor(category),
        format_id: audioOnly ? null : fmt,
        container,
        audio_only: audioOnly,
        audio_bitrate: audioOnly ? audioBitrate : null,
        audio_langs: audioLangs.length ? audioLangs : null,
        subs_langs: subsMode !== "none" && subLangs.length ? subLangs : null,
        subs_auto: subsAuto,
        subs_mode: subsMode,
      });
    } catch {
      // يظهر الخطأ في حدث التقدم
    }
  };

  const selectedFmt: MediaFormat | undefined = media?.formats.find((f) => f.format_id === fmt);

  return (
    <Modal title="معلومات التحميل — Download File Info" onClose={onClose} wide>
      <div className="flex items-center gap-3 rounded-2xl p-3 mb-4" style={{ background: "var(--surface-2)" }}>
        <div className="grid place-items-center w-12 h-12 rounded-xl shrink-0" style={{ background: "var(--surface)", color: "var(--ok)", boxShadow: "var(--shadow-1)" }}>
          <Icon size={24} />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-[13.5px] truncate" title={name || undefined}>{name || "اكتب الرابط لعرض تفاصيل الملف"}</p>
          <p className="text-[12px] tabular-nums" style={{ color: "var(--muted)" }}>
            الحجم: {formatBytes(url.trim() ? previewSizeFor(url.trim()) : 0)} <span style={{ opacity: 0.7 }}>(يُحدَّد نهائيًا من الخادم عند البدء)</span>
          </p>
        </div>
      </div>

      <Field label="رابط التحميل (URL)">
        <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/file.zip"
               className="w-full bg-transparent outline-none text-[13px] placeholder:opacity-50" style={{ color: "var(--text)" }} />
      </Field>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="التصنيف (Category)">
          <select value={category} onChange={(e) => setCategory(e.target.value as Exclude<Category, "all">)}
                  className="w-full bg-transparent outline-none text-[13px] cursor-pointer" style={{ color: "var(--text)" }}>
            {(Object.keys(CATEGORY_LABEL) as Array<Exclude<Category, "all">>).map((c) => (
              <option key={c} value={c} style={{ color: "#111" }}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </Field>
        <Field label="مسار الحفظ (Save As)">
          <div className="flex items-center gap-2">
            <HardDrive size={14} className="shrink-0" style={{ color: "var(--muted)" }} />
            <input dir="ltr" value={savePath} onChange={(e) => setSavePath(e.target.value)}
                   className="w-full bg-transparent outline-none text-[13px] text-left" style={{ color: "var(--text)" }} />
            <FolderOpen size={15} className="shrink-0 cursor-pointer" style={{ color: "var(--muted)" }} />
          </div>
        </Field>
      </div>

      <label className="flex items-center gap-2 my-1 text-[12.5px] font-semibold cursor-pointer w-fit">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
               className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer" />
        تذكّر هذا المسار لملفات تصنيف «{CATEGORY_LABEL[category]}»
      </label>

      <Field label="الوصف (اختياري)">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ملاحظة عن هذا الملف…"
               className="w-full bg-transparent outline-none text-[13px] placeholder:opacity-50" style={{ color: "var(--text)" }} />
      </Field>

      <div className="my-4">
        <ThreadsPicker value={threads} onChange={setThreads} />
      </div>

      {looksMedia && (
        <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
          <button onClick={() => (media ? setShowMedia((v) => !v) : probe())} disabled={probing}
                  className="flex items-center gap-2 w-full cursor-pointer font-bold text-[13px]"
                  style={{ color: "var(--text)" }}>
            <Film size={16} style={{ color: "var(--color-accent)" }} />
            <span className="flex-1 text-right">
              جودات الفيديو والبث (yt-dlp + FFmpeg){media ? ` — ${media.formats.length} جودة` : ""}
            </span>
            {probing ? <span className="text-[11.5px]" style={{ color: "var(--muted)" }}>جارٍ التحليل…</span> : media ? (showMedia ? <ChevronUp size={16} /> : <ChevronDown size={16} />) : <ChevronDown size={16} />}
          </button>

          {probeErr && <p className="text-[12px] mt-2" style={{ color: "var(--torrent)" }}>{probeErr}</p>}

          {media && showMedia && (
            <div className="mt-3 space-y-3">
              <p className="text-[12px] font-semibold truncate" style={{ color: "var(--muted)" }}>
                {media.title}{(media.is_hls || media.is_dash) ? " — بث متقطع (HLS/DASH)" : ""} · {media.extractor}
              </p>

              {/* الجودات من الأعلى للأدنى */}
              <div className="max-h-44 overflow-y-auto rounded-xl divide-y" style={{ background: "var(--surface)" }}>
                <button onClick={() => setFmt("best")} className={`w-full flex items-center gap-2 px-3 py-2 text-[12.5px] cursor-pointer ${fmt === "best" ? "font-bold" : ""}`}
                        style={{ background: fmt === "best" ? "var(--surface-2)" : "transparent", color: "var(--text)" }}>
                  <span className="flex-1 text-right">أفضل جودة متاحة (تلقائي)</span>
                </button>
                {media.formats.filter((f) => f.height != null).map((f) => (
                  <button key={f.format_id} onClick={() => setFmt(f.format_id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] cursor-pointer"
                          style={{ background: fmt === f.format_id ? "var(--surface-2)" : "transparent", color: "var(--text)" }}>
                    <span className="flex-1 text-right truncate">{f.label}</span>
                    <span className="tabular-nums" style={{ color: "var(--muted)" }}>{f.size ? formatBytes(f.size) : "—"}</span>
                  </button>
                ))}
                {media.formats.filter((f) => f.height == null).map((f) => (
                  <button key={f.format_id} onClick={() => { setFmt(f.format_id); setAudioOnly(true); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] cursor-pointer"
                          style={{ background: fmt === f.format_id ? "var(--surface-2)" : "transparent", color: "var(--text)" }}>
                    <Music size={13} style={{ color: "var(--muted)" }} />
                    <span className="flex-1 text-right truncate">{f.lang ? `${f.label} — ${f.lang}` : f.label}</span>
                    <span className="tabular-nums" style={{ color: "var(--muted)" }}>{f.size ? formatBytes(f.size) : "—"}</span>
                  </button>
                ))}
              </div>

              {/* الصيغة والصوت */}
              <div className="grid grid-cols-3 gap-2">
                <select value={container} onChange={(e) => setContainer(e.target.value)} aria-label="صيغة الحاوية"
                        className="rounded-xl h-10 px-2 text-[12.5px] cursor-pointer" style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}>
                  {["mp4", "mkv", "webm", "avi", "flv", "mov", "3gp"].map((c) => <option key={c}>{c.toUpperCase()}</option>)}
                </select>
                <select value={audioBitrate} onChange={(e) => setAudioBitrate(e.target.value)} aria-label="معدل جودة الصوت"
                        disabled={!audioOnly}
                        className="rounded-xl h-10 px-2 text-[12.5px] cursor-pointer disabled:opacity-40" style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}>
                  {["320K", "256K", "192K", "128K", "96K", "64K"].map((b) => <option key={b}>{b}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-[12px] font-semibold cursor-pointer justify-center" style={{ color: "var(--text)" }}>
                  <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer" />
                  صوت فقط
                </label>
              </div>

              {/* لغات الدبلجة */}
              {media.audio_langs.length > 0 && (
                <div>
                  <p className="text-[12px] font-semibold mb-1.5" style={{ color: "var(--muted)" }}>المسارات الصوتية المدبلجة (اختر لغة أو أكثر)</p>
                  <div className="flex flex-wrap gap-1.5">
                    <LangChip label="الكل" on={audioLangs.length === 0} onClick={() => setAudioLangs([])} />
                    {media.audio_langs.map((l) => (
                      <LangChip key={l} label={l} on={audioLangs.includes(l)}
                                onClick={() => setAudioLangs((v) => (v.includes(l) ? v.filter((x) => x !== l) : [...v, l]))} />
                    ))}
                  </div>
                </div>
              )}

              {/* الترجمات */}
              {media.subs.length > 0 && (
                <div>
                  <p className="text-[12px] font-semibold mb-1.5" style={{ color: "var(--muted)" }}>الترجمات و CC ({media.subs.length} لغة)</p>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {media.subs.map((s) => (
                      <LangChip key={`${s.kind}:${s.lang}`} label={`${s.lang}${s.kind === "auto" ? " (تلقائي)" : ""}`} on={subLangs.includes(s.lang)}
                                onClick={() => setSubLangs((v) => (v.includes(s.lang) ? v.filter((x) => x !== s.lang) : [...v, s.lang]))} />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <select value={subsMode} onChange={(e) => setSubsMode(e.target.value as typeof subsMode)} aria-label="وضع الترجمة"
                            className="rounded-xl h-10 px-2 text-[12.5px] cursor-pointer" style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}>
                      <option value="none">بدون ترجمة</option>
                      <option value="separate">ملف مستقل (SRT)</option>
                      <option value="embed">دمج داخل الفيديو (Soft)</option>
                    </select>
                    <label className="flex items-center gap-1.5 text-[12px] font-semibold cursor-pointer justify-center" style={{ color: "var(--text)" }}>
                      <input type="checkbox" checked={subsAuto} onChange={(e) => setSubsAuto(e.target.checked)} className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer" />
                      تضمين الترجمة التلقائية (CC)
                    </label>
                  </div>
                </div>
              )}

              <button onClick={startMedia}
                      className="h-10 w-full rounded-xl font-bold text-[12.5px] cursor-pointer hover:brightness-105"
                      style={{ background: "var(--color-accent)", color: "#06231a" }}>
                تحميل الوسائط بهذه الإعدادات {selectedFmt ? `(${selectedFmt.label})` : ""}
              </button>
              {tools && !tools.ffmpeg && (
                <p className="text-[11.5px]" style={{ color: "var(--muted)" }}>ملاحظة: FFmpeg غير مثبَّت — الدمج والتحويل قد يفشلان.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <button disabled={!ready} onClick={() => onStart(build())} aria-label="بدء التحميل الآن"
                className="h-11 rounded-xl font-bold text-[13px] transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                style={{ background: "var(--color-accent)", color: "#06231a" }}>
          <Play size={15} /> بدء التحميل الآن
        </button>
        <button disabled={!ready} onClick={() => onLater(build())} aria-label="التحميل لاحقًا"
                className="h-11 rounded-xl font-bold text-[13px] transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                style={{ background: "var(--surface-2)", color: "var(--text)" }}>
          <FileClock size={15} /> التحميل لاحقًا
        </button>
        <button onClick={onClose} aria-label="إلغاء"
                className="h-11 rounded-xl font-bold text-[13px] transition-all hover:brightness-105 active:scale-[0.99] cursor-pointer flex items-center justify-center gap-1.5"
                style={{ background: "var(--surface-2)", color: "var(--text)" }}>
          <XCircle size={15} /> إلغاء
        </button>
      </div>
    </Modal>
  );
}

function LangChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on}
            className="rounded-full px-3 h-7 text-[11.5px] font-semibold cursor-pointer transition-all"
            style={{
              background: on ? "var(--color-accent)" : "var(--surface)",
              color: on ? "#06231a" : "var(--text)",
              border: `1px solid ${on ? "var(--color-accent)" : "var(--border)"}`,
            }}>
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {  return (
    <div className="mb-3">
      <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--muted)" }}>{label}</label>
      <div className="flex items-center gap-2 rounded-xl h-11 px-3" style={{ background: "var(--surface-2)" }}>
        {children}
      </div>
    </div>
  );
}

function defaultPathFor(c: Exclude<Category, "all">): string {
  return `C:\\Users\\Downloads\\UltraDM\\${CATEGORY_LABEL[c]}`;
}

/* ─────────────── نافذة حالة التحميل التفصيلية (Download Progress Window) ─────────────── */

type SegmentState = "connecting" | "downloading" | "done";
interface Segment { i: number; progress: number; state: SegmentState }

const SEGMENT_LABEL: Record<SegmentState, string> = {
  connecting: "يتصل", downloading: "يحمل", done: "اكتمل",
};
const SEGMENT_COLOR: Record<SegmentState, string> = {
  connecting: "var(--muted)", downloading: "var(--color-accent)", done: "var(--color-accent-strong)",
};

export function DownloadProgressDialog({
  download, onClose, onPauseResume, onCancel,
}: {
  download: Download;
  onClose: () => void;
  onPauseResume: () => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<"status" | "limiter" | "after">("status");
  const [details, setDetails] = useState(true);
  const [limiterOn, setLimiterOn] = useState(false);
  const [limitKbs, setLimitKbs] = useState(2048);
  const [afterDone, setAfterDone] = useState({ openFolder: false, closeApp: false, virusScan: true });
  const [, tick] = useReducer((x: number) => x + 1, 0);

  // نبضة تحديث لتحريك أشرطة الأجزاء أثناء التحميل.
  useEffect(() => {
    if (download.status !== "downloading") return;
    const t = setInterval(tick, 700);
    return () => clearInterval(t);
  }, [download.status, tick]);

  const segments: Segment[] = useMemo(() => {
    const n = Math.max(1, download.threads);
    const overall = download.progress / 100;
    const weights = Array.from({ length: n }, (_, i) => 0.6 + ((i * 37 + 13) % 80) / 100);
    const avg = weights.reduce((a, b) => a + b, 0) / n;
    return weights.map((w, i) => {
      const p = Math.min(1, (overall * w) / avg);
      const state: SegmentState =
        download.status === "done" || p >= 1 ? "done" : download.status === "downloading" ? (p <= 0.001 ? "connecting" : "downloading") : "connecting";
      return { i, progress: p * 100, state };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [download.threads, Math.round(download.progress), download.status]);

  const Icon = CAT_ICON[download.category];
  const downloading = download.status === "downloading";
  const downloadedBytes = (download.sizeBytes * download.progress) / 100;

  return (
    <Modal title="حالة التحميل التفصيلية" onClose={onClose} wide>
      <div className="flex items-center gap-3 mb-4">
        <div className="grid place-items-center w-10 h-10 rounded-xl shrink-0" style={{ background: "var(--surface-2)", color: "var(--ok)" }}>
          <Icon size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[13.5px] truncate">{download.name}</p>
          <p dir="ltr" className="text-[11.5px] text-left truncate" style={{ color: "var(--muted)" }}>{download.name}</p>
        </div>
        <span className="shrink-0 text-[12px] font-bold px-2.5 py-1 rounded-lg" style={{ background: "var(--surface-2)", color: downloading ? "var(--ok)" : "var(--muted)" }}>
          {download.progress.toFixed(1)}٪
        </span>
      </div>

      {/* التبويبات العلوية */}
      <div role="tablist" aria-label="تبويبات حالة التحميل" className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: "var(--surface-2)" }}>
        {([
          ["status", "حالة التحميل", Info],
          ["limiter", "محدد السرعة", Gauge],
          ["after", "الخيارات عند الاكتمال", CheckCircle2],
        ] as const).map(([id, label, TabIcon]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className="flex-1 h-9 rounded-lg text-[12.5px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  style={{ background: tab === id ? "var(--surface)" : "transparent", color: tab === id ? "var(--text)" : "var(--muted)", boxShadow: tab === id ? "var(--shadow-1)" : undefined }}>
            <TabIcon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === "status" && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
            <Stat label="الحالة" value={download.status === "done" ? "اكتمل" : downloading ? "جارٍ التحميل" : download.status === "paused" ? "متوقف مؤقتًا" : "بالانتظار"} />
            <Stat label="حجم الملف" value={formatBytes(download.sizeBytes)} />
            <Stat label="المحمّل" value={formatBytes(downloadedBytes)} />
            <Stat label="معدل النقل" value={downloading ? formatSpeed(download.speedBps) : "—"} accent={downloading} />
            <Stat label="الوقت المتبقي" value={formatEta(download.etaSeconds)} />
            <Stat label="الاستئناف" value="مدعوم" accent />
          </div>

          {/* شريط التقدم الرئيسي مقسّم بصريًا حسب الخيوط */}
          <div className="flex gap-[2px] h-5 rounded-lg overflow-hidden mb-1.5" role="img" aria-label={`شريط التقدم المقسم إلى ${download.threads} جزءًا`}>
            {segments.map((s) => (
              <div key={s.i} className="flex-1 relative" style={{ background: "var(--surface-2)" }}>
                <div className="h-full transition-[width] duration-700 ease-out"
                     style={{ width: `${s.progress}%`, background: SEGMENT_COLOR[s.state] }} />
              </div>
            ))}
          </div>
          <p className="text-[11.5px] tabular-nums mb-4" style={{ color: "var(--muted)" }}>
            {formatBytes(downloadedBytes)} من {formatBytes(download.sizeBytes)} — {download.threads} اتصالًا متزامنًا
          </p>
        </>
      )}

      {tab === "limiter" && (
        <div className="mb-4">
          <label className="flex items-center gap-2 text-[12.5px] font-semibold cursor-pointer w-fit mb-3">
            <input type="checkbox" checked={limiterOn} onChange={(e) => setLimiterOn(e.target.checked)}
                   className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer" />
            تفعيل محدد السرعة لهذا التحميل
          </label>
          <div className={limiterOn ? "" : "opacity-40 pointer-events-none"}>
            <div className="flex justify-between text-[12.5px] font-semibold mb-2">
              <span>السرعة القصوى</span>
              <span className="tabular-nums" style={{ color: "var(--ok)" }}>{(limitKbs / 1024).toFixed(1)} م.ب/ث</span>
            </div>
            <input type="range" min={128} max={16384} step={128} value={limitKbs} aria-label="السرعة القصوى"
                   onChange={(e) => setLimitKbs(Number(e.target.value))}
                   className="w-full accent-[var(--color-accent)] cursor-pointer" />
            <div className="flex gap-1.5 mt-2">
              {[512, 1024, 4096, 8192].map((v) => (
                <button key={v} onClick={() => setLimitKbs(v)}
                        className="flex-1 h-8 rounded-lg text-[12px] font-bold cursor-pointer transition-all hover:brightness-105"
                        style={{ background: limitKbs === v ? "var(--color-accent)" : "var(--surface-2)", color: limitKbs === v ? "#06231a" : "var(--text)" }}>
                  {v / 1024} م.ب/ث
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "after" && (
        <div className="flex flex-col gap-2 mb-4 text-[12.5px] font-semibold">
          {([
            ["openFolder", "فتح مجلد الحفظ عند الاكتمال"],
            ["virusScan", "فحص الملف بمضاد الفيروسات بعد الإكمال"],
            ["closeApp", "إغلاق نافذة التقدم تلقائيًا بعد الإكمال"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer w-fit">
              <input type="checkbox" checked={afterDone[key]} onChange={(e) => setAfterDone({ ...afterDone, [key]: e.target.checked })}
                     className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer" />
              {label}
            </label>
          ))}
        </div>
      )}

      {/* أزرار التحكم */}
      <div className="flex gap-2.5 mb-4">
        <button onClick={onPauseResume} disabled={download.status === "done"}
                className="flex-1 h-10 rounded-xl font-bold text-[12.5px] transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                style={{ background: "var(--color-accent)", color: "#06231a" }}>
          {downloading ? <><Pause size={14} /> إيقاف مؤقت</> : <><Play size={14} /> استئناف</>}
        </button>
        <button onClick={onCancel}
                className="flex-1 h-10 rounded-xl font-bold text-[12.5px] transition-all hover:brightness-105 active:scale-[0.99] cursor-pointer flex items-center justify-center gap-1.5"
                style={{ background: "var(--surface-2)", color: "var(--text)" }}>
          <XCircle size={14} /> إلغاء الأمر
        </button>
        <button onClick={() => setDetails((d) => !d)} aria-expanded={details}
                className="h-10 px-4 rounded-xl font-bold text-[12.5px] transition-all hover:brightness-105 cursor-pointer flex items-center justify-center gap-1.5"
                style={{ background: "var(--surface-2)", color: "var(--text)" }}>
          {details ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {details ? "إخفاء التفاصيل" : "إظهار التفاصيل"}
        </button>
      </div>

      {/* جدول الاتصالات الـ 32 */}
      {details && (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <div className="max-h-56 overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-[12px]">
              <thead className="sticky top-0 z-10">
                <tr style={{ background: "var(--surface-2)" }}>
                  {["الاتصال", "من بايت", "إلى بايت", "التقدم", "الحالة"].map((h) => (
                    <th key={h} className="h-9 px-3 text-right font-semibold whitespace-nowrap border-b"
                        style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => {
                  const slice = download.sizeBytes / download.threads;
                  return (
                    <tr key={s.i} style={{ background: s.i % 2 ? "var(--surface-2)" : "var(--surface)" }}>
                      <td className="px-3 h-9 tabular-nums font-bold border-b" style={{ borderColor: "var(--border)" }}>#{s.i + 1}</td>
                      <td className="px-3 tabular-nums border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{formatBytes(s.i * slice)}</td>
                      <td className="px-3 tabular-nums border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{formatBytes((s.i + 1) * slice)}</td>
                      <td className="px-3 border-b min-w-[140px]" style={{ borderColor: "var(--border)" }}>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ background: "var(--surface)" }}>
                            <div className="h-full rounded-full transition-[width] duration-700 ease-out"
                                 style={{ width: `${s.progress}%`, background: SEGMENT_COLOR[s.state] }} />
                          </div>
                          <span className="tabular-nums w-10 text-left" style={{ color: "var(--muted)" }}>{s.progress.toFixed(0)}٪</span>
                        </div>
                      </td>
                      <td className="px-3 border-b font-bold whitespace-nowrap" style={{ borderColor: "var(--border)", color: SEGMENT_COLOR[s.state] }}>
                        {SEGMENT_LABEL[s.state]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "var(--surface-2)" }}>
      <p className="text-[11px] font-semibold mb-0.5" style={{ color: "var(--muted)" }}>{label}</p>
      <p className="text-[12.5px] font-bold tabular-nums truncate" style={{ color: accent ? "var(--ok)" : "var(--text)" }}>{value}</p>
    </div>
  );
}
