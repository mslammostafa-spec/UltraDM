import { useMemo } from "react";
import { Pause, Square, FolderOpen } from "lucide-react";
import type { Download } from "../lib/ipc";
import { formatBytes, formatEta, formatSpeed } from "../lib/format";

/**
 * بطاقات التحميل المقسّمة — شرائح متوهجة تمثل مسارات الاتصال المتوازية (حتى 32).
 */
export default function DownloadCards({
  rows, selected, onToggle, onOpenFolder,
}: {
  rows: Download[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpenFolder: (d: Download) => void;
}) {
  const active = useMemo(
    () => rows.filter((d) => d.status === "downloading" || d.status === "queued" || d.status === "scheduled").slice(0, 4),
    [rows],
  );

  if (active.length === 0) {
    return (
      <div
        className="rounded-2xl h-[120px] grid place-items-center text-[13px]"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)" }}
      >
        لا توجد تحميلات نشطة حاليًا.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {active.map((d) => {
        const isSel = selected.has(d.id);
        const segments = Math.min(32, Math.max(1, d.threads));
        return (
          <div
            key={d.id}
            onClick={() => onToggle(d.id)}
            role="button"
            tabIndex={0}
            aria-pressed={isSel}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(d.id); } }}
            className="rounded-2xl p-4 cursor-pointer transition-all duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2"
            style={{
              background: "var(--surface)",
              border: `1px solid ${isSel ? "var(--color-accent)" : "var(--border)"}`,
              boxShadow: isSel ? "var(--shadow-2)" : "var(--shadow-1)",
              outlineColor: "var(--color-accent)",
            }}
          >
            <div className="flex items-center gap-3">
              {/* أدوات التحكم */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`إيقاف مؤقت ${d.name}`}
                  className="grid place-items-center w-8 h-8 rounded-lg cursor-pointer transition-colors hover:brightness-125"
                  style={{ background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" }}
                >
                  <Pause size={14} />
                </button>
                <button
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`إلغاء ${d.name}`}
                  className="grid place-items-center w-8 h-8 rounded-lg cursor-pointer transition-colors hover:brightness-125"
                  style={{ background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" }}
                >
                  <Square size={12} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenFolder(d); }}
                  aria-label={`فتح مجلد ${d.name}`}
                  className="grid place-items-center w-8 h-8 rounded-lg cursor-pointer transition-colors hover:brightness-125"
                  style={{ background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" }}
                >
                  <FolderOpen size={14} />
                </button>
              </div>

              {/* شرائح التقدم */}
              <div
                className="flex-1 flex items-center gap-[3px] h-6 min-w-0"
                role="progressbar"
                aria-valuenow={Math.round(d.progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`تقدم ${d.name}`}
              >
                {Array.from({ length: segments }, (_, i) => {
                  const segFraction = 1 / segments;
                  const filled = d.progress / 100 >= segFraction * (i + 1);
                  const partial = !filled && d.progress / 100 > segFraction * i;
                  return (
                    <span
                      key={i}
                      className="flex-1 h-[14px] rounded-[3px] transition-all duration-500"
                      style={{
                        background: filled
                          ? "linear-gradient(180deg, var(--color-accent), var(--color-accent-strong))"
                          : partial
                            ? `linear-gradient(90deg, var(--color-accent) ${((d.progress / 100 - segFraction * i) / segFraction) * 100}%, var(--surface-2) ${((d.progress / 100 - segFraction * i) / segFraction) * 100}%)`
                            : "var(--surface-2)",
                        boxShadow: filled ? "0 0 8px color-mix(in srgb, var(--color-accent) 45%, transparent)" : undefined,
                        opacity: filled ? 1 : partial ? 1 : 0.55,
                      }}
                    />
                  );
                })}
              </div>

              <div className="text-left shrink-0 tabular-nums text-[12px] font-bold" style={{ color: "var(--color-accent)" }}>
                {Math.round(d.progress)}%
              </div>
            </div>

            {/* الاسم والتفاصيل */}
            <div className="flex items-center justify-between mt-2.5 min-w-0">
              <span className="truncate text-[14px] font-bold" title={d.name} style={{ color: "var(--text)" }}>
                {d.name}
              </span>
              <span className="shrink-0 ms-4 text-[11.5px] tabular-nums" style={{ color: "var(--muted)" }}>
                {formatBytes(d.progress / 100 * d.sizeBytes)} من {formatBytes(d.sizeBytes)}
                {"  |  "}{d.threads} مسار
                {"  |  "}{formatSpeed(d.speedBps)}
                {d.etaSeconds != null && d.status === "downloading" ? `  |  متبقٍ ${formatEta(d.etaSeconds)}` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
