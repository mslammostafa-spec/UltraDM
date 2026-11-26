import { Power, MoonStar, LogOut, ShieldCheck, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { AfterFinish } from "../lib/ipc";

const OPTIONS: Array<{
  id: AfterFinish;
  label: string;
  hint: string;
  icon: typeof Power;
}> = [
  { id: "none", label: "بدون إجراء", hint: "يبقى البرنامج مفتوحًا", icon: ShieldCheck },
  { id: "shutdown", label: "إغلاق الجهاز", hint: "يُغلق ويندوز بعد عدّاد 30 ثانية", icon: Power },
  { id: "sleep", label: "وضع السكون", hint: "يُدخل الجهاز في السكون", icon: MoonStar },
  { id: "quit", label: "إغلاق البرنامج", hint: "يُنهي UltraDM فقط", icon: LogOut },
];

export default function BottomBar({
  action, onAction, message, countdown, onCancelCountdown,
}: {
  action: AfterFinish;
  onAction: (a: AfterFinish) => void;
  message: string | null;
  countdown?: number | null;
  onCancelCountdown?: () => void;
}) {
  return (
    <footer
      className="shrink-0 min-h-14 px-4 py-2 border-t flex flex-wrap items-center gap-x-2 gap-y-1.5"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <span className="text-[12px] font-semibold ml-1 whitespace-nowrap" style={{ color: "var(--muted)" }}>
        عند انتهاء جميع التحميلات:
      </span>
      <div role="radiogroup" aria-label="الإجراء بعد انتهاء التحميلات" className="flex flex-wrap items-center gap-1.5">
        {OPTIONS.map(({ id, label, hint, icon: Icon }) => {
          const on = action === id;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={on}
              onClick={() => onAction(id)}
              title={hint}
              className="shrink-0 flex items-center gap-1.5 h-auto min-h-9 py-1.5 px-2 sm:px-3 rounded-xl text-[12.5px] leading-[1.8] font-semibold whitespace-nowrap transition-all duration-150
                         hover:brightness-105 active:scale-[0.97] focus-visible:outline-2 focus-visible:-outline-offset-2 cursor-pointer"
              style={{
                background: on ? "var(--color-accent)" : "var(--surface-2)",
                color: on ? "#06231a" : "var(--text)",
                boxShadow: on ? "var(--shadow-1)" : undefined,
                outlineColor: "var(--color-accent)",
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex-1" />
      {countdown != null && countdown >= 0 && (
        <span
          role="alert"
          className="flex items-center gap-2 text-[12.5px] font-bold rounded-xl px-3 py-1.5"
          style={{ background: "#e5484d22", color: "#e5484d" }}
        >
          {action === "shutdown" ? "إغلاق الجهاز خلال" : "السكون خلال"} {countdown} ثانية
          {onCancelCountdown && (
            <button
              onClick={onCancelCountdown}
              aria-label="إلغاء العد التنازلي"
              className="grid place-items-center w-6 h-6 rounded-lg cursor-pointer hover:brightness-125"
              style={{ background: "#e5484d33" }}
            >
              <X size={13} />
            </button>
          )}
        </span>
      )}
      {message && (
        <span role="status" className="text-[12px] font-semibold truncate" style={{ color: "var(--muted)" }}>
          {message}
        </span>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={async () => {
            try { await invoke("quit_app"); } catch { /* ... */ }
          }}
          className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-[12.5px] font-bold transition-all duration-150 hover:bg-[#e5484d22] hover:text-[#e5484d] cursor-pointer"
        >
          <LogOut size={15} />
          إغلاق البرنامج
        </button>
      </div>
    </footer>
  );
}
