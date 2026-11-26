import { useState } from "react";
import {
  X, Link2, Magnet, Pause, Play, Trash2, CalendarClock, Moon, Sun, Undo2,
  Settings, RefreshCw, Info, Minimize2,
} from "lucide-react";
import { inDesktop, exitApp } from "../lib/ipc";
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
  const flash = (k: string) => {
    setPulse(k);
    setTimeout(() => setPulse(""), 300);
  };
  const desktop = inDesktop();

  const apiMax = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    await w.toggleMaximize();
    void w.isMaximized();
  };

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={() => { if (desktop) apiMax(); }}
      className="relative z-50 flex items-center gap-2 px-4 h-16 border-b shrink-0 select-none pointer-events-auto"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      {/* زر X: إنهاء حقيقي للبرنامج (يخرج من التطبيق بالكامل).
          زر الشريط المجاور يخفي النافذة إلى شريط النظام بدلاً منه. */}
      {desktop && (
        <button
          data-tauri-drag-region="false"
          className="w-11 h-11 shrink-0 z-50 pointer-events-auto grid place-items-center cursor-pointer transition-colors duration-150 hover:!bg-[#e5484d] hover:!text-white"
          style={{ color: "var(--muted)" }}
          aria-label="إنهاء البرنامج" title="إنهاء البرنامج"
          onClick={() => { void exitApp(); }}
        >
          <X size={16} />
        </button>
      )}
      {desktop && (
        <button
          data-tauri-drag-region="false"
          className="w-11 h-11 shrink-0 z-50 pointer-events-auto grid place-items-center cursor-pointer transition-colors duration-150 hover:!bg-[var(--surface-2)]"
          style={{ color: "var(--muted)" }}
          aria-label="إخفاء إلى شريط النظام" title="إخفاء إلى شريط النظام"
          onClick={async () => {
            try {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              await getCurrentWindow().hide();
            } catch { /* غير مكتبي */ }
          }}
        >
          <Minimize2 size={16} />
        </button>
      )}

      {/* منطقة الأزرار: مستثناة تماماً من السحب — كل نقرة تعمل ولا تُكبّر النافذة. */}
      <div
        className="flex items-center gap-2 h-full"
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
      <div data-tauri-drag-region="false" className="flex items-center gap-2">
        <ToolbarButton variant="primary" label="إضافة رابط تحميل" onClick={() => { flash("link"); onAddLink(); }}>
          <Link2 size={17} />
          <span className="hidden min-[1100px]:inline">إضافة رابط</span>
        </ToolbarButton>

        <ToolbarButton variant="torrent" label="إضافة ملف أو رابط تورنت" onClick={() => { flash("torrent"); onAddTorrent(); }}>
          <Magnet size={17} />
          <span className="hidden min-[1100px]:inline">تورنت</span>
        </ToolbarButton>
      </div>

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

      <div data-tauri-drag-region="false">
        <ToolbarButton label="الجدولة" onClick={onScheduler}>
          <CalendarClock size={16} />
          <span className="hidden min-[1200px]:inline">الجدولة</span>
        </ToolbarButton>
      </div>

      <div className="flex-1" />

      <div data-tauri-drag-region="false" className="flex items-center gap-2">
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
      </div>
      </div>
    </header>
  );
}
