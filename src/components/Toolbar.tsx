import { useState } from "react";
import {
  Link2, Magnet, Pause, Play, Trash2, CalendarClock, Moon, Sun, Undo2,
  Settings, Minus, Square, X, Copy, RefreshCw, Info,
} from "lucide-react";
import { inDesktop } from "../lib/ipc";
import { checkForUpdates, type UpdateStatus } from "../lib/updater";

export function ToolbarButton({
  onClick, disabled, children, variant = "ghost", label,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: "ghost" | "primary" | "torrent" | "danger";
  label: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    ghost: { background: "var(--surface-2)", color: "var(--text)" },
    primary: { background: "var(--color-accent)", color: "#06231a" },
    torrent: { background: "var(--color-torrent)", color: "#0a1430" },
    danger: { background: "var(--surface-2)", color: "#e5484d" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex items-center gap-2 rounded-xl h-10 px-3.5 text-[13px] font-semibold transition-all duration-150 ease-out
                 hover:brightness-105 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none
                 focus-visible:outline-2 focus-visible:-outline-offset-2 cursor-pointer"
      style={{ ...styles[variant], outlineColor: "var(--color-accent)", boxShadow: "var(--shadow-1)" }}
    >
      {children}
    </button>
  );
}

function WindowControls({ maximized, onMax }: { maximized: boolean; onMax: () => void }) {
  const btn = "w-11 h-11 grid place-items-center cursor-pointer transition-colors duration-150";
  const click = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const api = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  };
  return (
    <div className="flex items-center h-full" style={{ color: "var(--muted)" }}>
      <button className={btn} aria-label="تصغير" title="تصغير" onClick={click(() => api().then((w) => w.minimize()))}>
        <Minus size={15} />
      </button>
      <button className={btn} aria-label={maximized ? "استعادة" : "تكبير"} title={maximized ? "استعادة" : "تكبير"} onClick={click(onMax)}>
        {maximized ? <Copy size={13} /> : <Square size={12} />}
      </button>
      <button
        className={`${btn} hover:!bg-[#e5484d] hover:!text-white`}
        aria-label="إغلاق" title="إغلاق"
        onClick={click(() => api().then((w) => w.close()))}
      >
        <X size={16} />
      </button>
    </div>
  );
}

export default function Toolbar({
  onAddLink, onAddTorrent, onPause, onResume, onDelete, onScheduler, onToggleTheme, dark,
  canPause, canResume, canDelete, trash = false, onOpenSettings, onAbout,
}: {
  onAddLink: () => void;
  onAddTorrent: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onScheduler: () => void;
  onToggleTheme: () => void;
  dark: boolean;
  canPause: boolean;
  canResume: boolean;
  canDelete: boolean;
  trash?: boolean;
  onOpenSettings: () => void;
  onAbout: (status: UpdateStatus | null) => void;
}) {
  const [pulse, setPulse] = useState("");
  const [maximized, setMaximized] = useState(false);
  const flash = (k: string) => {
    setPulse(k);
    setTimeout(() => setPulse(""), 300);
  };
  const desktop = inDesktop();

  const apiMax = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    await w.toggleMaximize();
    setMaximized(await w.isMaximized());
  };

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={() => { if (desktop) apiMax(); }}
      className="flex items-center gap-2 px-4 h-16 border-b shrink-0 select-none"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <ToolbarButton variant="primary" label="إضافة رابط تحميل" onClick={() => { flash("link"); onAddLink(); }}>
        <Link2 size={17} />
        <span className="hidden min-[1100px]:inline">إضافة رابط</span>
      </ToolbarButton>

      <ToolbarButton variant="torrent" label="إضافة ملف أو رابط تورنت" onClick={() => { flash("torrent"); onAddTorrent(); }}>
        <Magnet size={17} />
        <span className="hidden min-[1100px]:inline">تورنت</span>
      </ToolbarButton>

      <div className="w-px h-7 mx-1" style={{ background: "var(--border)" }} />

      {!trash && (
        <ToolbarButton label="إيقاف مؤقت" disabled={!canPause} onClick={() => { flash("pause"); onPause(); }}>
          <Pause size={16} className={pulse === "pause" ? "animate-pulse" : ""} />
        </ToolbarButton>
      )}
      {trash ? (
        <ToolbarButton label="استعادة المحدد" disabled={!canResume} onClick={() => { flash("resume"); onResume(); }}>
          <Undo2 size={16} className={pulse === "resume" ? "animate-pulse" : ""} />
        </ToolbarButton>
      ) : (
        <ToolbarButton label="استئناف" disabled={!canResume} onClick={() => { flash("resume"); onResume(); }}>
          <Play size={16} className={pulse === "resume" ? "animate-pulse" : ""} />
        </ToolbarButton>
      )}
      <ToolbarButton variant="danger" label={trash ? "مسح نهائي" : "حذف"} disabled={!canDelete} onClick={onDelete}>
        <Trash2 size={16} />
      </ToolbarButton>

      <div className="w-px h-7 mx-1" style={{ background: "var(--border)" }} />

      <ToolbarButton label="الجدولة" onClick={onScheduler}>
        <CalendarClock size={16} />
        <span className="hidden min-[1200px]:inline">الجدولة</span>
      </ToolbarButton>

      <div className="flex-1" />

      <ToolbarButton label={dark ? "الوضع النهاري" : "الوضع الليلي"} onClick={onToggleTheme}>
        {dark ? <Sun size={17} /> : <Moon size={17} />}
      </ToolbarButton>
      <ToolbarButton
        label="التحقق من التحديثات"
        onClick={async () => {
          const st: UpdateStatus = await checkForUpdates();
          onAbout(st);
        }}
      >
        <RefreshCw size={16} />
      </ToolbarButton>
      <ToolbarButton label="حول البرنامج" onClick={() => onAbout(null)}>
        <Info size={16} />
      </ToolbarButton>
      <ToolbarButton label="الإعدادات والمظهر" onClick={onOpenSettings}>
        <Settings size={17} />
      </ToolbarButton>
      {desktop && (
        <div className="ms-auto self-stretch flex items-stretch" style={{ marginInlineStart: "auto" }}>
          <WindowControls maximized={maximized} onMax={() => apiMax()} />
        </div>
      )}
    </header>
  );
}
