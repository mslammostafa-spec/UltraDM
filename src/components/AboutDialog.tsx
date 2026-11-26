import { X, RefreshCw, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { checkForUpdates, installUpdate, type UpdateStatus } from "../lib/updater";

// نافذة «حول البرنامج»: الإصدار، النظام، والتحقق من التحديثات عبر GitHub Releases.
export default function AboutDialog({
  status, onClose,
}: {
  status: UpdateStatus | null;
  onClose: () => void;
}) {
  const initial = status ?? { current: "", available: null, notes: null, installed: false, checked: false } as UpdateStatus & { checked?: boolean };
  const state = initial.available ? "update" : initial.error ? "error" : initial.current ? "latest" : "idle";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 cursor-default"
      />
      <div
        className="relative w-full max-w-md rounded-2xl border shadow-2xl p-6 space-y-4"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
            <img src="/icons/ultradm.svg" alt="" className="w-6 h-6" />
            حول UltraDM
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10"
            aria-label="إغلاق"
          >
            <X size={16} style={{ color: "var(--text)" }} />
          </button>
        </div>

        <div className="rounded-xl border p-4 space-y-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
          <div className="flex justify-between">
            <span className="opacity-70">الإصدار الحالي</span>
            <span className="font-mono">{initial.current || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-70">المحرك</span>
            <span>32 خيطًا متزامنًا + تورنت (librqbit)</span>
          </div>

          {state === "update" && (
            <div className="mt-3 rounded-lg p-3 space-y-2" style={{ background: "rgba(16,185,129,0.12)" }}>
              <div className="flex items-center gap-2 font-semibold">
                <Download size={15} />
                تحديث جديد متاح: الإصدار {initial.available}
              </div>
              {initial.notes && <p className="text-xs opacity-80 whitespace-pre-line">{initial.notes}</p>}
              <button
                className="w-full mt-1 py-2 rounded-lg font-semibold text-white flex items-center justify-center gap-2"
                style={{ background: "var(--accent)" }}
                onClick={async () => {
                  const fresh = await checkForUpdates();
                  if (fresh.available) await installUpdate(null);
                }}
              >
                <RefreshCw size={15} /> التحميل والتثبيت الآن
              </button>
            </div>
          )}
          {state === "latest" && (
            <div className="mt-3 rounded-lg p-3 flex items-center gap-2 text-sm" style={{ background: "rgba(16,185,129,0.12)" }}>
              <CheckCircle2 size={15} /> أنت تستخدم أحدث إصدار.
            </div>
          )}
          {state === "error" && (
            <div className="mt-3 rounded-lg p-3 flex items-center gap-2 text-sm" style={{ background: "rgba(239,68,68,0.12)" }}>
              <AlertTriangle size={15} /> تعذّر التحقق من التحديثات: {initial.error}
            </div>
          )}
          {state === "idle" && (
            <button
              className="w-full mt-3 py-2 rounded-lg font-semibold text-white flex items-center justify-center gap-2"
              style={{ background: "var(--accent)" }}
              onClick={async () => {
                await checkForUpdates();
              }}
            >
              <RefreshCw size={15} /> التحقق من التحديثات
            </button>
          )}
        </div>

        <p className="text-xs text-center opacity-60" style={{ color: "var(--text)" }}>
          UltraDM — مدير تحميل فائق السرعة · رخصة MIT
        </p>
      </div>
    </div>
  );
}
