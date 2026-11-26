import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import SpeedGauge from "./components/SpeedGauge";
import DownloadCards from "./components/DownloadCards";
import TelemetryPanel from "./components/TelemetryPanel";

import SpeedChart, { type Sample } from "./components/SpeedChart";
import BottomBar from "./components/BottomBar";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2.5 text-center"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      <div className="text-[11px]" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="text-[14px] font-extrabold tabular-nums mt-0.5" style={{ color: "var(--text)" }}>{value}</div>
    </div>
  );
}
import { SchedulerDialog, type ScheduleRule } from "./components/Dialogs";
import { DownloadInfoDialog, DownloadProgressDialog, type StartConfig } from "./components/DownloadDialogs";
import SettingsDialog from "./components/SettingsDialog";
import AboutDialog from "./components/AboutDialog";
import type { UpdateStatus } from "./lib/updater";
import { ListFilter } from "lucide-react";
import { inDesktop, engineAdd, enginePause, engineResume, engineCancel, registerTorrentHandler, requestPower, runAfterFinish, matchesFilter, parseFilterId, openPath, type AfterFinish, type Download } from "./lib/ipc";
import { DEFAULT_SETTINGS, applyTheme, type Settings } from "./lib/themes";
import { loadSettings, saveSettings } from "./lib/settings";
import { fileNameFromUrl, previewDownloads, previewSizeFor } from "./lib/format";

interface EngineSnapshotLike {
  id: string;
  size: number;
  progress: number;
  speed_bps: number;
  peak_speed_bps: number;
  eta_seconds: number | null;
  threads: number;
  status: string;
}

const THEME_KEY = "ultradm.theme";
const PREVIEW = !inDesktop();

function initialDark(): boolean {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [about, setAbout] = useState<{ status: UpdateStatus | null } | null>(null);
  const [dark, setDark] = useState(initialDark);
  const [active, setActive] = useState<string>("all");
  const [downloads, setDownloads] = useState<Download[]>(() => (PREVIEW ? previewDownloads() : []));
  const [deleted, setDeleted] = useState<Download[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [history, setHistory] = useState<Sample[]>([]);
  const [after, setAfter] = useState<AfterFinish>("none");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "link" | "torrent" | "scheduler">(null);
  const [info, setInfo] = useState<null | { url: string; torrent: boolean }>(null);
  const [progressId, setProgressId] = useState<string | null>(null);
  const [rules, setRules] = useState<ScheduleRule[]>([
    { id: 1, start: "02:00", end: "08:00", days: "يوميًا" },
  ]);
  const hadActive = useRef(false);

  // تحميل الإعدادات المحفوظة عند البدء ثم تطبيق الثيم منها ودفع إعدادات
  // حماية SSD إلى محرك الخلفية.
  useEffect(() => {
    loadSettings().then(async (s) => {
      setSettings(s);
      const t = applyTheme(s.theme);
      setDark(t.dark);
      try {
        const { isTauri } = await import("@tauri-apps/api/core");
        if (isTauri()) {
          await invoke("engine_set_cache_config", {
            ramFirst: s.ssdProtection,
            ramFullLimitBytes: Math.round(s.ramFullLimitGB * 1024 * 1024 * 1024),
          });
        }
      } catch {
        // المعاينة الويب ليست تطبيق سطح المكتب
      }
    });
  }, []);

  // حفظ الثيم الليلي/النهاري الفوري (سريع)؛ الحفظ الدائم يتم بزر "حفظ وإغلاق".
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  const handleSaveSettings = async (s: Settings) => {
    setSettings(s);
    const t = applyTheme(s.theme);
    setDark(t.dark);
    await saveSettings(s);
    setSettingsOpen(false);
  };

  // فتح "معلومات التحميل" في نافذة مستقلة على سطح المكتب (فوق المتصفح)؛
  // وفي المعاينة الويبية تبقى داخل النافذة الرئيسية.
  const openInfo = (url: string, torrent: boolean) => {
    if (!PREVIEW) {
      import("./lib/auxWindows")
        .then(({ openAuxWindow }) => openAuxWindow("info", { url, torrent }))
        .catch(() => setInfo({ url, torrent }));
      return;
    }
    setInfo({ url, torrent });
  };

  // سطح المكتب: تقدّم لحظي من محرك Rust عبر حدث download://progress.
  useEffect(() => {
    if (PREVIEW) return;
    let un: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      const p1 = listen<EngineSnapshotLike>("download://progress", (e) => {
        const s = e.payload;
        setDownloads((ds) => {
          const i = ds.findIndex((d) => d.id === s.id);
          if (i === -1) return ds;
          const next = [...ds];
          next[i] = {
            ...next[i],
            sizeBytes: s.size,
            progress: s.progress,
            speedBps: s.speed_bps,
            peakSpeedBps: Math.max(s.peak_speed_bps, next[i].peakSpeedBps),
            etaSeconds: s.eta_seconds,
            threads: s.threads,
            status: s.status as Download["status"],
          };
          return next;
        });
      });
      const p2 = listen<string>("clipboard://link", (e) => {
        openInfo(e.payload, e.payload.startsWith("magnet:?"));
      });
      // التقطت إضافة المتصفح رابطًا: افتح نافذة "معلومات التحميل" فورًا.
      const p3 = listen<{ url: string; kind?: string | null }>("extension://capture", (e) => {
        const u = e.payload.url;
        openInfo(u, u.startsWith("magnet:?") || /\.torrent([?#]|$)/i.test(u));
      });
      Promise.all([p1, p2, p3]).then(([u1, u2, u3]) => {
        un = () => {
          u1();
          u2();
          u3();
        };
      });
    });
    return () => un?.();
  }, []);

  // معاينة المتصفح فقط: محاكاة التقدم والسرعة لعرض الواجهة حية.
  // في نسخة سطح المكتب تأتي هذه القيم من محرك التحميل في Rust عند ربطه.
  useEffect(() => {
    if (!PREVIEW) return;
    const t = setInterval(() => {
      setDownloads((ds) => {
        const next = ds.map((d) => {
          if (d.status !== "downloading") return { ...d, speedBps: 0, etaSeconds: null };
          const speed = d.peakSpeedBps * (0.6 + Math.random() * 0.4);
          const remaining = d.sizeBytes * (1 - d.progress / 100);
          const got = Math.min(remaining, speed);
          const progress = Math.min(100, d.progress + (got / d.sizeBytes) * 100);
          const done = progress >= 100;
          return {
            ...d,
            progress,
            speedBps: done ? 0 : speed,
            etaSeconds: done ? null : (remaining - got) / speed,
            status: done ? ("done" as const) : d.status,
          };
        });
        const total = next.reduce((s, d) => s + d.speedBps, 0);
        setHistory((h) => [...h, { t: Date.now(), bps: total }].slice(-90));
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const anyDownloading = downloads.some((d) => d.status === "downloading" || d.status === "queued");

  useEffect(() => {
    if (anyDownloading) {
      hadActive.current = true;
      return;
    }
    if (!hadActive.current || after === "none") return;
    hadActive.current = false;
    if (PREVIEW) {
      setMessage("انتهت التحميلات — يُنفَّذ الإجراء في نسخة سطح المكتب فقط");
      return;
    }
    if (after === "shutdown" || after === "sleep") {
      // عدّاد تنازلي 30 ثانية للسلامة مع إمكانية الإلغاء.
      setCountdown(30);
      return;
    }
    runAfterFinish(after).catch((e) => setMessage(String(e)));
  }, [anyDownloading, after]);

  // العد التنازلي للطاقة: عند الصفر ينفّذ الأمر.
  useEffect(() => {
    if (countdown == null) return;
    if (countdown <= 0) {
      setCountdown(null);
      if (after === "shutdown") requestPower("shutdown").catch((e) => setMessage(String(e)));
      else if (after === "sleep") requestPower("sleep").catch((e) => setMessage(String(e)));
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c == null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, after]);

  // تسجيل البرنامج كمستقبل magnet/.torrent في ويندوز.
  useEffect(() => {
    if (PREVIEW) return;
    registerTorrentHandler().catch(() => {});
  }, []);

  const activeFilter = useMemo(() => parseFilterId(active), [active]);
  const inTrash = activeFilter.kind === "deleted";

  const rows = useMemo(() => {
    if (activeFilter.kind === "deleted") return deleted;
    return downloads.filter((d) => matchesFilter(d, activeFilter));
  }, [downloads, deleted, activeFilter]);

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const selectAll = useCallback(
    (checked: boolean) => setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set()),
    [rows],
  );
  void selectAll;

  const addDownload = async (cfg: StartConfig, later: boolean, torrent: boolean) => {
    const name = fileNameFromUrl(cfg.url);
    setDialog(null);
    setInfo(null);
    if (PREVIEW) {
      const id = `dl-${Date.now()}`;
      setDownloads((ds) => [
        ...ds,
        {
          id,
          name,
          category: torrent ? "torrent" : cfg.category,
          sizeBytes: previewSizeFor(name),
          progress: 0,
          speedBps: 0,
          peakSpeedBps: 0,
          etaSeconds: null,
          threads: cfg.threads,
          status: later ? "paused" : "downloading",
          description: cfg.description,
          savePath: cfg.savePath,
        },
      ]);
      if (later) setMessage(`أُجِّل لاحقًا: ${name}`);
      else setProgressId(id);
      return;
    }
    try {
      const dl = await engineAdd({
        url: cfg.url,
        savePath: cfg.savePath,
        threads: cfg.threads,
        category: torrent ? "torrent" : cfg.category,
        description: cfg.description ?? null,
      });
      setDownloads((ds) => [...ds.filter((d) => d.id !== dl.id), dl]);
      if (later) {
        await enginePause(dl.id);
        setMessage(`أُجِّل لاحقًا: ${dl.name}`);
      } else {
        setProgressId(dl.id);
      }
    } catch (e) {
      setMessage(`فشل إضافة التحميل: ${String(e)}`);
    }
  };

  const pauseSelected = () => {
    if (PREVIEW) return setStatus(["downloading", "queued"], "paused");
    selectedRows.filter((d) => d.status === "downloading" || d.status === "queued").forEach((d) => enginePause(d.id).catch(() => {}));
    setStatus(["downloading", "queued"], "paused");
  };

  const resumeSelected = () => {
    if (PREVIEW) return setStatus(["paused", "error"], "downloading");
    selectedRows.filter((d) => d.status === "paused" || d.status === "error").forEach((d) => engineResume(d.id).catch(() => {}));
    setStatus(["paused", "error"], "downloading");
  };

  const deleteSel = () => {
    if (!inTrash) {
      if (!PREVIEW) selectedRows.forEach((d) => engineCancel(d.id).catch(() => {}));
      setDownloads((ds) => ds.filter((d) => !selected.has(d.id)));
      setDeleted((ds) => [...selectedRows, ...ds]);
      setSelected(new Set());
      return;
    }
    setDeleted((ds) => ds.filter((d) => !selected.has(d.id)));
    setSelected(new Set());
  };

  const restoreSel = () => {
    const back = deleted.filter((d) => selected.has(d.id));
    if (back.length === 0) return;
    setDeleted((ds) => ds.filter((d) => !selected.has(d.id)));
    setDownloads((ds) => [...back, ...ds]);
    setSelected(new Set());
  };

  const progressDownload = progressId ? downloads.find((d) => d.id === progressId) : null;

  const setStatus = (from: Download["status"][], to: Download["status"]) =>
    setDownloads((ds) =>
      ds.map((d) => (selected.has(d.id) && from.includes(d.status) ? { ...d, status: to } : d)),
    );

  const selectedRows = (inTrash ? deleted : downloads).filter((d) => selected.has(d.id));
  const SidebarIcon = ListFilter;

  // إحصاءات لوحة السرعة الرئيسية (مشتقة من الصفوف النشطة).
  const activeRows = downloads.filter((d) => d.status === "downloading");
  const totalBps = activeRows.reduce((a, d) => a + d.speedBps, 0);
  const peakTotalBps = downloads.reduce((a, d) => a + d.peakSpeedBps, 0);
  const totalBytes = downloads.reduce((a, d) => a + (d.sizeBytes * d.progress) / 100, 0);
  const remainingBytes = downloads.reduce((a, d) => a + d.sizeBytes * (1 - d.progress / 100), 0);
  const etaSeconds = totalBps > 0 && remainingBytes > 0 ? remainingBytes / totalBps : null;
  const avgBps = activeRows.length > 0 ? totalBps / activeRows.length : 0;
  const historyRows = useMemo(
    () =>
      downloads
        .slice()
        .sort((a, b) => (b.etaSeconds ?? Infinity) - (a.etaSeconds ?? Infinity))
        .slice(0, 3)
        .map((d) => ({
          id: d.id,
          name: d.name,
          meta: `${Math.round(d.progress)}٪ · ${d.threads} مسار`,
        })),
    [downloads],
  );
  const fmtBytes = (b: number) => {
    if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
    if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024).toFixed(0)} KB`;
  };
  const fmtSpeed = (b: number) => `${fmtBytes(b)}/s`;
  const fmtEta = (s: number | null) => {
    if (s == null || !isFinite(s)) return "—";
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return m >= 60 ? `${Math.floor(m / 60)} س ${m % 60} د` : `${m} د ${sec} ث`;
  };

  return (
    <div className="h-full flex min-w-0 overflow-x-hidden" style={{ background: "var(--bg)" }}>
      {/* على الشاشات الصغيرة يصبح الشريط الجانبي منزلاً يُفتح من زر عائم */}
      <div className="max-lg:hidden">
        <Sidebar
          active={active}
          onSelect={setActive}
          downloads={downloads}
          deletedCount={deleted.length}
        />
      </div>
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,.45)" }}
          onClick={() => setSidebarOpen(false)}
        >
          <div
            id="drawer"
            className="h-full w-[262px] max-w-[85vw] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar
              active={active}
              onSelect={(id) => {
                setActive(id);
                setSidebarOpen(false);
              }}
              downloads={downloads}
              deletedCount={deleted.length}
            />
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        <Toolbar
          dark={dark}
          onToggleTheme={() => setDark((d) => !d)}
          onAddLink={() => openInfo("", false)}
          onAddTorrent={() => openInfo("", true)}
          onScheduler={() => setDialog("scheduler")}
          onPause={pauseSelected}
          onResume={inTrash ? restoreSel : resumeSelected}
          onDelete={deleteSel}
          trash={inTrash}
          onOpenSettings={() => setSettingsOpen(true)}
          onAbout={(st) => setAbout({ status: st })}
          canPause={selectedRows.some((d) => d.status === "downloading" || d.status === "queued")}
          canResume={inTrash ? selectedRows.length > 0 : selectedRows.some((d) => d.status === "paused" || d.status === "error")}
          canDelete={selectedRows.length > 0}
        />

        {/* لوحة السرعة الرئيسية: العداد + المخطط الموجي + بطاقات الإحصاء */}
        <section
          aria-label="لوحة سرعة التحميل"
          className="mx-4 mt-4 rounded-3xl p-5 flex flex-wrap items-center gap-6"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-1)" }}
        >
          <SpeedGauge bps={totalBps} peakBps={peakTotalBps} />

          <div
            className="flex-1 min-w-[240px] rounded-2xl p-4"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-[12.5px] font-bold rounded-full px-3 py-1"
                style={{ background: "var(--color-accent)", color: "#06231a" }}
              >
                32 مسار نشط
              </span>
            </div>
            <SpeedChart history={history} />
            <div className="grid grid-cols-3 gap-3 mt-3">
              <StatCard label="البيانات المستلمة" value={fmtBytes(totalBytes)} />
              <StatCard label="الوقت المتبذر" value={fmtEta(etaSeconds)} />
              <StatCard label="السرعة المتوسطبة" value={`${fmtSpeed(avgBps)}`} />
            </div>
          </div>
        </section>

        {/* بطاقات التحميل المقسّمة */}
        <section className="flex-1 min-h-0 overflow-y-auto px-4 py-4" aria-label="التحميلات النشطة">
          <DownloadCards
            rows={rows}
            selected={selected}
            onToggle={toggle}
            onOpenFolder={(d) => {
              const p = d.savePath;
              if (!p) return;
              openPath(p).catch(() => setMessage("تعذّر فتح المجلد."));
            }}
          />
        </section>

        <BottomBar
          action={after}
          onAction={setAfter}
          message={message}
          countdown={countdown}
          onCancelCountdown={() => setCountdown(null)}
        />
      </main>

      <TelemetryPanel
        history={history}
        totalBps={totalBps}
        peakBps={peakTotalBps}
        historyRows={historyRows}
        onResumeAll={() => {
          if (PREVIEW) return setStatus(["paused", "error"], "downloading");
          selectedRows.filter((d) => d.status === "paused" || d.status === "error").forEach((d) => engineResume(d.id).catch(() => {}));
          setStatus(["paused", "error"], "downloading");
        }}
        onPauseAll={() => {
          if (PREVIEW) return setStatus(["downloading", "queued"], "paused");
          selectedRows.filter((d) => d.status === "downloading" || d.status === "queued").forEach((d) => enginePause(d.id).catch(() => {}));
          setStatus(["downloading", "queued"], "paused");
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {dialog === "scheduler" && (
        <SchedulerDialog onClose={() => setDialog(null)} rules={rules} setRules={setRules} />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      )}
      {about && (
        <AboutDialog
          status={about.status}
          onClose={() => setAbout(null)}
        />
      )}
      <button
        onClick={() => setSidebarOpen(true)}
        aria-label="فتح التصفية"
        className="lg:hidden fixed z-30 bottom-24 ltr:left-4 rtl:right-4 w-12 h-12 rounded-2xl grid place-items-center cursor-pointer"
        style={{
          background: "var(--color-accent)",
          color: "#06231a",
          boxShadow: "var(--shadow-2, 0 8px 24px rgba(0,0,0,.25))",
        }}
      >
        <SidebarIcon />
      </button>
      {info && (
        <DownloadInfoDialog
          initialUrl={info.url}
          isTorrent={info.torrent}
          onClose={() => setInfo(null)}
          onStart={(cfg) => addDownload(cfg, false, info.torrent)}
          onLater={(cfg) => addDownload(cfg, true, info.torrent)}
        />
      )}
      {/* النسخة المكتبية: نافذة مستقلة تظهر فوق المتصفح — لا يوجد ما يُعرض هنا. */}
      {info && !PREVIEW && null}
      {progressDownload && (
        <DownloadProgressDialog
          download={progressDownload}
          onClose={() => setProgressId(null)}
          onPauseResume={() => {
            if (PREVIEW) {
              setDownloads((ds) =>
                ds.map((d) =>
                  d.id === progressDownload.id
                    ? { ...d, status: d.status === "downloading" ? "paused" : "downloading" }
                    : d,
                ),
              );
              return;
            }
            if (progressDownload.status === "downloading" || progressDownload.status === "queued") {
              enginePause(progressDownload.id).catch(() => {});
            } else {
              engineResume(progressDownload.id).catch(() => {});
            }
          }}
          onCancel={() => {
            if (!PREVIEW) engineCancel(progressDownload.id).catch(() => {});
            setDownloads((ds) => ds.filter((d) => d.id !== progressDownload.id));
            setProgressId(null);
          }}
        />
      )}
    </div>
  );
}
