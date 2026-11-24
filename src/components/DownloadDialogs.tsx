import { useEffect, useMemo, useReducer, useState } from "react";
import {
  Film, Music, FileArchive, Package, FileText, Magnet, FolderOpen, Info, Gauge,
} from "lucide-react";
import type { Category } from "../lib/ipc";
import { formatBytes, defaultPathFor } from "../lib/format";
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface StartConfig {
  url: string;
  savePath: string;
  threads: number;
  category: Category;
  description?: string | null;
}

interface ProbeResult {
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  size_bytes: number | null;
  formats: { id: string; height: number | null; size_bytes: number | null; ext: string }[];
}

async function mediaDownload(args: {
  url: string;
  output_dir: string;
  format_id: string | null;
  container: string | null;
  audio_only: boolean;
}): Promise<void> {
  if (!isTauri()) throw new Error("المعاينة فقط");
  const t = await import("@tauri-apps/api/core");
  await t.invoke("media_download", args);
}

async function mediaProbe(url: string): Promise<ProbeResult> {
  if (!isTauri()) throw new Error("المعاينة فقط");
  const t = await import("@tauri-apps/api/core");
  return await t.invoke<ProbeResult>("media_probe", { url });
}

const CATEGORIES: { id: Exclude<Category, "all">; label: string; icon: typeof Film }[] = [
  { id: "video", label: "فيديو", icon: Film },
  { id: "audio", label: "صوت", icon: Music },
  { id: "archive", label: "مضغوط", icon: FileArchive },
  { id: "software", label: "برامج", icon: Package },
  { id: "document", label: "مستندات", icon: FileText },
  { id: "torrent", label: "تورنت", icon: Magnet },
];

export function DownloadInfoDialog({
  initialUrl,
  isTorrent,
  onClose,
  onStart,
  onLater,
}: {
  initialUrl: string;
  isTorrent: boolean;
  onClose: () => void;
  onStart: (cfg: StartConfig) => void;
  onLater: (cfg: StartConfig) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [savePath, setSavePath] = useState("");
  const [threads, setThreads] = useState(8);
  const [category, setCategory] = useState<Exclude<Category, "all">>(isTorrent ? "torrent" : "video");
  const [description, setDescription] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [fmt, setFmt] = useState<string | null>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  const [container, setContainer] = useState<string | null>(null);
  const torrent = isTorrent || url.startsWith("magnet:") || /\.torrent([?#]|$)/i.test(url);

  const defaultPathFor = useMemo(() => makeDefaultPathFor(), []);

  const doProbe = async () => {
    setProbing(true);
    setProbeErr(null);
    try {
      if (!torrent) {
        const p = await mediaProbe(url.trim());
        setProbe(p);
        if (p.formats.length > 0) setFmt(p.formats[p.formats.length - 1].id);
      }
    } catch (e) {
      if (!t.ytdlp) throw new Error("yt-dlp غير مثبَّت — ثبّته ثم أعد المحاولة");
      setProbeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  const cfg = (): StartConfig => ({
    url: url.trim(),
    savePath: savePath.trim() || defaultPathFor(category),
    threads,
    category,
    description: description.trim() || null,
  });

  const start = () => {
    if (torrent) return onStart(cfg());
    void (async () => {
      try {
        await mediaDownload({
          url: url.trim(),
          output_dir: savePath.trim() || defaultPathFor(category),
          format_id: audioOnly ? null : fmt,
          container,
          audio_only: audioOnly,
        });
        onStart(cfg());
      } catch (e) {
        setProbeErr(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  return null;
}

function makeDefaultPathFor() {
  return (_c: Exclude<Category, "all">) => "";
}

export function DownloadProgressDialog({ download, onClose, onPauseResume, onCancel }: {
  download: import("../lib/ipc").Download;
  onClose: () => void;
  onPauseResume: () => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useReducer((s: string, a: string) => a, "status");
  const tabs = [
    { id: "status", label: "الحالة", icon: Gauge },
    { id: "info", label: "معلومات", icon: Info },
    { id: "save", label: "الحفظ", icon: FolderOpen },
  ];
  const TabIcon = tabs.find((t) => t.id === tab)?.icon ?? Gauge;
  const label = tabs.find((t) => t.id === tab)?.label ?? "";
  useEffect(() => {
    // لا شيء حالياً: التقدم يأتي عبر props.
  }, [download]);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(0,0,0,.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-3xl border overflow-hidden"
        style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 pt-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="h-9 px-3 rounded-xl text-[12.5px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              style={{
                background: tab === t.id ? "var(--surface-2)" : "transparent",
                color: "var(--text)",
              }}
            >
              <TabIcon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
