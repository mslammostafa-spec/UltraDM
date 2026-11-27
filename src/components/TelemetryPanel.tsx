import { useEffect, useState } from "react";
import { Zap, CheckCircle2, CircleDot } from "lucide-react";
import { diskFree } from "../lib/ipc";
import { formatSpeed } from "../lib/format";

/**
 * اللوحة الجانبية اليسرى: مخطط النطاق الترددي، سرعة الكتابة على القرص + المساحة الحرة،
 * سجل التحميلات الزمني، وأزرار التحكم الجماعي.
 */
export default function TelemetryPanel({
  history, totalBps, peakBps, historyRows, onResumeAll, onPauseAll, onOpenSettings,
}: {
  history: Array<{ t: number; bps: number }>;
  totalBps: number;
  peakBps: number;
  historyRows: Array<{ id: string; name: string; meta: string }>;
  onResumeAll: () => void;
  onPauseAll: () => void;
  onOpenSettings: () => void;
}) {
  const [freeBytes, setFreeBytes] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => diskFree().then((v) => { if (alive) setFreeBytes(v); }).catch(() => {});
    void load();
    const iv = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const fmtFree = (b: number | null) => {
    if (b == null) return "—";
    const gb = b / (1024 * 1024 * 1024);
    return gb >= 10 ? `${gb.toFixed(1)} GB` : `${gb.toFixed(2)} GB`;
  };

  const PLAY = "▶";
  return (
    <aside
      aria-label="القياسات والسجل"
      className="w-[230px] max-w-[38vw] shrink-0 flex flex-col gap-3 p-4 overflow-y-auto"
      style={{ background: "var(--surface)", borderInlineEnd: "1px solid var(--border)" }}
    >
      {/* مخطط النطاق الترددي */}
      <section
        className="rounded-2xl p-3"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        aria-label="مخطط النطاق الترددي"
      >
        <div className="text-[12.5px] font-bold mb-2" style={{ color: "var(--text)" }}>مخطط النطاق الترددي</div>
        <MiniWave history={history} />
      </section>

      {/* سرعة الكتابة على القرص */}
      <section
        className="rounded-2xl p-3"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        aria-label="سرعة الكتابة على القرص"
      >
        <div className="text-[12.5px] font-bold" style={{ color: "var(--text)" }}>سرعة الكتابة على القرص</div>
        <div className="font-display text-[22px] font-extrabold tabular-nums mt-1" style={{ color: "var(--color-accent)" }}>
          {formatSpeed(totalBps)}
        </div>
        <div className="text-[11px] tabular-nums mt-0.5" style={{ color: "var(--muted)" }}>
          المساحة الحرة: {fmtFree(freeBytes)}
        </div>
        <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: "var(--border)" }} aria-hidden>
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.min(100, (totalBps / Math.max(1, peakBps)) * 100)}%`,
              background: "linear-gradient(90deg, var(--color-accent), var(--color-accent-strong))",
            }}
          />
        </div>
      </section>

      {/* سجل التحميلات الزمني */}
      <section
        className="rounded-2xl p-3 flex-1 min-h-[120px]"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        aria-label="سجل التحميلات"
      >
        <div className="text-[12.5px] font-bold mb-2" style={{ color: "var(--text)" }}>سجل التحميلات الزمني</div>
        <ul className="flex flex-col gap-2">
          {historyRows.length === 0 && (
            <li className="text-[11.5px]" style={{ color: "var(--muted)" }}>لا يوجد سجل بعد.</li>
          )}
          {historyRows.slice(0, 3).map((r) => (
            <li key={r.id} className="flex items-start gap-2 min-w-0">
              <CircleDot size={13} className="mt-0.5 shrink-0" style={{ color: "var(--color-accent)" }} />
              <div className="min-w-0">
                <div className="text-[12px] font-semibold truncate" style={{ color: "var(--text)" }}>{r.name}</div>
                <div className="text-[10.5px] tabular-nums" style={{ color: "var(--muted)" }}>{r.meta}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* التحكم الجماعي */}
      <div className="flex flex-col gap-2">
        <button
          onClick={onResumeAll}
          className="h-10 rounded-xl text-[13px] font-bold cursor-pointer transition-all hover:brightness-110 focus-visible:outline-2 focus-visible:-outline-offset-2"
          style={{ background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)", outlineColor: "var(--color-accent)" }}
        >
          {PLAY} استئناف الكل
        </button>
        <button
          onClick={onPauseAll}
          className="h-10 rounded-xl text-[13px] font-bold cursor-pointer transition-all hover:brightness-110 focus-visible:outline-2 focus-visible:-outline-offset-2"
          style={{ background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)", outlineColor: "var(--color-accent)" }}
        >
          ⏸ إيقاف الكل
        </button>
        <button
          onClick={onOpenSettings}
          className="h-10 rounded-xl text-[13px] font-bold cursor-pointer transition-all hover:brightness-110 focus-visible:outline-2 focus-visible:-outline-offset-2"
          style={{ background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)", outlineColor: "var(--color-accent)" }}
        >
          <Zap size={13} className="inline me-1.5 -mt-0.5" />
          إعدادات إضافة المتصفح
        </button>
        <div className="flex items-center gap-1.5 mt-1 px-1 text-[11px] font-semibold" style={{ color: "var(--ok)" }}>
          <CheckCircle2 size={12} />
          تمت المزامنة مع المتصفح
        </div>
      </div>
    </aside>
  );
}

function MiniWave({ history }: { history: Array<{ t: number; bps: number }> }) {
  const W = 190;
  const H = 56;
  const pts = history.slice(-40);
  const max = Math.max(1, ...pts.map((p) => p.bps));
  const step = W / Math.max(1, pts.length - 1);
  const d = pts.length >= 2
    ? pts.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(H - (p.bps / max) * (H - 6) - 3).toFixed(1)}`).join(" ")
    : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[56px]" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            style={{ filter: "drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 60%, transparent))" }} />
    </svg>
  );
}
