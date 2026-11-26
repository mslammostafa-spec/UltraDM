import type { Category, Download } from "./ipc";

export const CATEGORY_LABEL: Record<Exclude<Category, "all">, string> = {
  video: "فيديو", audio: "صوت", archive: "مضغوط", software: "برامج",
  document: "مستندات", torrent: "تورنت",
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/ث`;
}

export function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}س ${String(m).padStart(2, "0")}د`;
  if (m > 0) return `${m}د ${String(sec).padStart(2, "0")}ث`;
  return `${sec}ث`;
}

const EXT_CATEGORY: Record<string, Exclude<Category, "all">> = {
  mp4: "video", mkv: "video", avi: "video", mov: "video", webm: "video", flv: "video", wmv: "video", m4v: "video", mpg: "video", mpeg: "video", ts: "video",
  mp3: "audio", flac: "audio", wav: "audio", aac: "audio", ogg: "audio", m4a: "audio", wma: "audio", opus: "audio",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
  tgz: "archive", bz2: "archive", tbz2: "archive", xz: "archive", txz: "archive",
  zst: "archive", br: "archive", lzma: "archive", lz4: "archive", lzh: "archive",
  lha: "archive", cab: "archive", wim: "archive", ace: "archive", arj: "archive", iso: "archive",
  exe: "software", msi: "software", apk: "software", appx: "software", msix: "software",
  pdf: "document", doc: "document", docx: "document", xls: "document", xlsx: "document",
  ppt: "document", pptx: "document", txt: "document", epub: "document",
  torrent: "torrent",
};

export function categoryFromName(name: string): Exclude<Category, "all"> {
  if (name.startsWith("magnet:")) return "torrent";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CATEGORY[ext] ?? "software";
}

export function fileNameFromUrl(url: string): string {
  if (url.startsWith("magnet:")) {
    const dn = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("dn");
    return dn ?? "تورنت بدون اسم";
  }
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last ?? u.hostname);
  } catch {
    return url;
  }
}

/** بيانات عرض تُستخدم في معاينة المتصفح فقط، لا في نسخة سطح المكتب. */
export function previewSizeFor(nameOrUrl: string): number {
  let h = 0;
  for (let i = 0; i < nameOrUrl.length; i++) h = (h * 31 + nameOrUrl.charCodeAt(i)) >>> 0;
  return 120e6 + (h % 1800) * 1e6;
}

export function previewDownloads(): Download[] {
  const rows: Array<[string, number, number, number, number, Download["status"]]> = [
    ["Ubuntu.24.04.LTS.Desktop.amd64.iso", 5.2e9, 68.4, 11.4e6, 16, "downloading"],
    ["محرر-الفيديو-الاحترافي-2026.exe", 890e6, 100, 24e6, 8, "done"],
    ["ملحقة-الوثائق-المالية.zip", 214e6, 42.1, 3.2e6, 4, "downloading"],
    ["مؤتمر-الذكاء-الاصطناعي-اليوم-الأول.mkv", 3.8e9, 12.9, 6.8e6, 12, "downloading"],
    ["أرشيف-الصوتيات-الفصل-الرابع.flac", 1.1e9, 0, 0, 0, "paused"],
    ["تقرير-الربع-الثالث.pdf", 18e6, 100, 2.1e6, 2, "done"],
    ["حزمة-خطوط-التصميم.torrent", 640e6, 77.5, 4.4e6, 32, "downloading"],
    ["حزمة-الأدوات-المكتبية.msi", 1.4e9, 0, 0, 0, "queued"],
    ["نسخة-احتياطية-ليلية.tar.gz", 5.5e9, 0, 0, 0, "scheduled"],
    ["خلاصة-البودكاست-الحصري.mp3", 96e6, 0, 0, 0, "error"],
    ["كتيب-الاستخدام-الرسمي.pdf", 4.2e6, 100, 1.2e6, 1, "done"],
  ];
  return rows.map(([name, size, progress, peak, threads, status], i) => ({
    id: `preview-${i}`,
    name,
    category: categoryFromName(name),
    sizeBytes: size,
    progress,
    speedBps: 0,
    peakSpeedBps: peak,
    etaSeconds: null,
    threads,
    status,
  }));
}
