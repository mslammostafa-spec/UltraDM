import { useMemo, useRef, useEffect } from "react";
import { Activity, TrendingUp, Gauge } from "lucide-react";
import { formatSpeed } from "../lib/format";

const W = 600;
const H = 120;
const POINTS = 90;

export interface Sample {
  t: number;
  bps: number;
}

/** منحنى بيزييه ناعم (Catmull-Rom محوّل إلى Bézier) عبر النقاط. */
function smoothPath(coords: ReadonlyArray<readonly [number, number]>): string {
  if (coords.length < 2) return "";
  let d = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export default function SpeedChart({ history }: { history: Sample[] }) {
  const pathRef = useRef<SVGPathElement>(null);

  const { line, area, peak, avg } = useMemo(() => {
    const recent = history.slice(-POINTS);
    const pts = recent.length >= 2 ? recent : [{ t: 0, bps: 0 }, { t: 1, bps: 0 }];
    const max = Math.max(1, ...pts.map((p) => p.bps));
    const step = W / (Math.max(pts.length, POINTS) - 1);
    const offset = (Math.max(pts.length, POINTS) - pts.length) * step;
    const coords = pts.map((p, i) => {
      const x = offset + i * step;
      const y = H - (p.bps / max) * (H - 14) - 4;
      return [x, y] as const;
    });
    const d = smoothPath(coords);
    const sum = recent.reduce((s, p) => s + p.bps, 0);
    return {
      line: d,
      area: d
        ? `${d} L${coords[coords.length - 1][0].toFixed(1)},${H} L${coords[0][0].toFixed(1)},${H} Z`
        : "",
      peak: Math.max(0, ...recent.map((p) => p.bps)),
      avg: recent.length ? sum / recent.length : 0,
    };
  }, [history]);

  useEffect(() => {
    pathRef.current?.style.setProperty("d", line);
  }, [line]);

  const current = history.at(-1)?.bps ?? 0;

  return (
    <section
      className="shrink-0 h-[150px] px-4 py-2.5 border-t flex flex-col"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      aria-label="رسم بياني حي للسرعة"
    >
      <div className="flex items-center gap-3 mb-1 text-[12px] whitespace-nowrap min-w-0 overflow-hidden">
        <Activity size={15} style={{ color: "var(--color-accent)" }} />
        <span className="flex items-center gap-1.5 shrink-0">
          <Gauge size={13} style={{ color: "var(--muted)" }} />
          <span className="shrink-0" style={{ color: "var(--muted)" }}>الحالية</span>
          <span className="tabular-nums font-bold" style={{ color: "var(--color-accent)" }}>{formatSpeed(current)}</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <TrendingUp size={13} style={{ color: "var(--muted)" }} />
          <span className="shrink-0" style={{ color: "var(--muted)" }}>المتوسط</span>
          <span className="tabular-nums font-semibold" style={{ color: "var(--text)" }}>{formatSpeed(avg)}</span>
        </span>
        <span className="tabular-nums ms-auto shrink-0 whitespace-nowrap" style={{ color: "var(--muted)" }}>
          الذروة: <b style={{ color: "var(--text)" }}>{formatSpeed(peak)}</b>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="flex-1 w-full"
        role="img"
        aria-label="مخطط السرعة عبر الزمن"
      >
        <defs>
          <linearGradient id="speed-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.45" />
            <stop offset="60%" stopColor="var(--color-accent-strong)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="speed-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-accent)" />
            <stop offset="100%" stopColor="var(--color-accent-strong)" />
          </linearGradient>
          <filter id="speed-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f}
                stroke="var(--border)" strokeWidth="1" strokeDasharray="4 6" />
        ))}
        <path d={area} fill="url(#speed-fill)" />
        <path ref={pathRef} d={line} fill="none"
              stroke="url(#speed-line)" strokeWidth="2.5"
              strokeLinejoin="round" strokeLinecap="round"
              filter="url(#speed-glow)"
              style={{ transition: "d 400ms ease-out" }} />
      </svg>
    </section>
  );
}
