import { useMemo } from "react";

/**
 * العداد النصف دائري الكبير لسرعة التحميل — زجاجي متوهج بنمط التصميم المعتمد.
 * يعرض السرعة الحالية بالمنتصف، وأقصى سرعة مضاهة، والذروة اليومية أسفله.
 */
export default function SpeedGauge({
  bps, peakBps, label = "سرعة التحميل الحالية",
}: {
  bps: number;
  peakBps: number;
  label?: string;
}) {
  const MB = 1024 * 1024;
  const mbps = bps / MB;

  // المقياس: 0 → 160 MB/s (خطوة 20)، ويتمدد تلقائيًا إذا تجاوزت السرعة الذروة.
  const scaleMax = Math.max(160, Math.ceil((mbps * 1.25) / 20) * 20);
  const fraction = Math.min(1, mbps / scaleMax);

  // قوس نصف دائري: من 180° (يسار) إلى 0° (يمين).
  const R = 118;
  const CX = 140;
  const CY = 140;
  const CIRC = Math.PI * R; // نصف محيط

  const ticks = useMemo(() => {
    const step = scaleMax / 8;
    return Array.from({ length: 9 }, (_, i) => {
      const v = i * step;
      const ang = Math.PI - (i / 8) * Math.PI;
      return {
        v: Math.round(v),
        x1: CX + Math.cos(ang) * (R + 8),
        y1: CY - Math.sin(ang) * (R + 8),
        x2: CX + Math.cos(ang) * (R + 16),
        y2: CY - Math.sin(ang) * (R + 16),
        lx: CX + Math.cos(ang) * (R + 28),
        ly: CY - Math.sin(ang) * (R + 28) + 4,
      };
    });
  }, [scaleMax]);

  const value = mbps >= 100 ? mbps.toFixed(1) : mbps.toFixed(1);

  return (
    <div
      className="relative rounded-3xl p-6 flex flex-col items-center overflow-hidden"
      style={{
        background:
          "linear-gradient(160deg, color-mix(in srgb, var(--surface-2) 88%, transparent), color-mix(in srgb, var(--surface) 70%, transparent))",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-2)",
        width: 300,
      }}
      role="img"
      aria-label={`${label}: ${value} ميجابايت في الثانية`}
    >
      <svg viewBox="0 0 280 168" className="w-full" aria-hidden>
        <defs>
          <linearGradient id="gauge-arc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-accent-strong)" />
            <stop offset="55%" stopColor="var(--color-accent)" />
            <stop offset="100%" stopColor="var(--color-accent-strong)" />
          </linearGradient>
          <filter id="gauge-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* المسار الخامل */}
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {/* القوس المتوهج */}
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke="url(#gauge-arc)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${fraction * CIRC} ${CIRC}`}
          filter="url(#gauge-glow)"
          style={{ transition: "stroke-dasharray 500ms ease-out" }}
        />
        {/* علامات التدريج */}
        {ticks.map((t) => (
          <g key={t.v}>
            <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                  stroke="var(--border)" strokeWidth="2" strokeLinecap="round" />
            <text x={t.lx} y={t.ly} textAnchor="middle" fontSize="9.5"
                  fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {t.v}
            </text>
          </g>
        ))}
      </svg>

      <div className="-mt-[74px] flex flex-col items-center pb-1">
        <div
          className="font-display font-extrabold tabular-nums leading-none text-[40px]"
          style={{ color: "var(--text)", textShadow: "0 0 24px color-mix(in srgb, var(--color-accent) 55%, transparent)" }}
        >
          {value}
        </div>
        <div className="text-[13px] font-bold mt-1" style={{ color: "var(--color-accent)" }}>
          MB/s
        </div>
      </div>

      <div className="mt-3 text-center leading-tight pb-1">
        <div className="text-[13.5px] font-bold" style={{ color: "var(--text)" }}>{label}</div>
        <div className="text-[11.5px] mt-0.5 tabular-nums" style={{ color: "var(--muted)" }}>
          أقصى سرعة: {Math.round(peakBps / MB)} MB/s
        </div>
      </div>
    </div>
  );
}
