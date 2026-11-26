import {
  Film, Music, FileArchive, Package, FileText, Magnet, Pause, Check, AlertTriangle,
  Download as DownloadIcon, Loader,
} from "lucide-react";
import type { Category, Download, Status } from "../lib/ipc";
import { formatBytes, formatEta, formatSpeed } from "../lib/format";

const CAT_LABEL: Record<Exclude<Category, "all">, string> = {
  video: "فيديو", audio: "صوت", archive: "مضغوط", software: "برامج",
  document: "مستندات", torrent: "تورنت",
};

const CAT_ICON: Record<Exclude<Category, "all">, typeof Film> = {
  video: Film, audio: Music, archive: FileArchive, software: Package,
  document: FileText, torrent: Magnet,
};

const STATUS: Record<Status, { label: string; icon: typeof Pause; color: string }> = {
  downloading: { label: "جارٍ التحميل", icon: Loader, color: "var(--ok)" },
  paused: { label: "متوقف", icon: Pause, color: "var(--muted)" },
  queued: { label: "بالانتظار", icon: DownloadIcon, color: "var(--muted)" },
  scheduled: { label: "مجدول", icon: DownloadIcon, color: "var(--muted)" },
  done: { label: "تم", icon: Check, color: "var(--ok)" },
  error: { label: "خطأ", icon: AlertTriangle, color: "#d1343a" },
};

export default function DownloadTable({
  rows, selected, onToggle, onSelectAll, onAdd,
}: {
  rows: Download[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (checked: boolean) => void;
  onAdd: () => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="flex-1 min-h-0 overflow-auto" style={{ background: "var(--bg)" }}>
      <table className="w-full min-w-[960px] border-separate border-spacing-0 text-[13px] table-fixed">
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-[88px]" />
          <col className="w-[92px]" />
          <col className="w-[180px]" />
          <col className="w-[96px]" />
          <col className="w-[110px]" />
          <col className="w-[84px]" />
          <col className="w-[92px]" />
          <col className="w-[110px]" />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr style={{ background: "var(--surface-2)" }}>
            {[
              { key: "check", th: <input type="checkbox" aria-label="تحديد الكل" className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer" checked={allChecked} onChange={(e) => onSelectAll(e.target.checked)} /> },
              { key: "name", th: "اسم الملف" },
              { key: "cat", th: "النوع" },
              { key: "size", th: "الحجم" },
              { key: "prog", th: "التقدم" },
              { key: "speed", th: "أقصى سرعة" },
              { key: "live", th: "السرعة الحالية" },
              { key: "eta", th: "المتبقي" },
              { key: "thr", th: "الخيوط" },
            ].map(({ key, th }) => (
              <th
                key={key}
                className="h-11 px-3 text-right font-semibold text-[12px] border-b whitespace-nowrap"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                {th}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const CatIcon = CAT_ICON[d.category];
            const st = STATUS[d.status];
            const StIcon = st.icon;
            const isSel = selected.has(d.id);
            return (
              <tr
                key={d.id}
                onClick={() => onToggle(d.id)}
                className="cursor-pointer transition-colors duration-150"
                style={{ background: isSel ? "var(--surface-2)" : "var(--surface)" }}
              >
                <td className="px-3 h-14 border-b" style={{ borderColor: "var(--border)" }}>
                  <input
                    type="checkbox"
                    aria-label={`تحديد ${d.name}`}
                    className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
                    checked={isSel}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggle(d.id)}
                  />
                </td>
                <td className="px-3 border-b overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="grid place-items-center w-8 h-8 rounded-lg shrink-0"
                         style={{ background: "var(--surface-2)", color: "var(--ok)" }}>
                      <CatIcon size={16} />
                    </div>
                    <span className="truncate font-semibold min-w-0" title={d.name}>{d.name}</span>
                  </div>
                </td>
                <td className="px-3 border-b whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  {CAT_LABEL[d.category]}
                </td>
                <td className="px-3 border-b tabular-nums whitespace-nowrap overflow-hidden text-ellipsis" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  {formatBytes(d.sizeBytes)}
                </td>
                <td className="px-3 border-b min-w-0 overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-2 flex-1 min-w-0 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
                      <div
                        className="h-full rounded-full transition-[width] duration-500 ease-out"
                        style={{
                          width: `${d.progress}%`,
                          background: d.status === "done"
                            ? "var(--color-accent-strong)"
                            : "linear-gradient(90deg, var(--color-accent), var(--color-accent-strong))",
                        }}
                      />
                    </div>
                    <span className="tabular-nums text-[12px] w-12 text-left font-semibold">
                      {d.progress.toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="px-3 border-b tabular-nums whitespace-nowrap" style={{ borderColor: "var(--border)" }}>
                  {formatSpeed(d.peakSpeedBps)}
                </td>
                <td className="px-3 border-b tabular-nums whitespace-nowrap font-semibold" style={{ borderColor: "var(--border)", color: d.speedBps > 0 ? "var(--ok)" : "var(--muted)" }}>
                  {d.status === "downloading" ? formatSpeed(d.speedBps) : "—"}
                </td>
                <td className="px-3 border-b tabular-nums whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  {formatEta(d.etaSeconds)}
                </td>
                <td className="px-3 border-b" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-1.5">
                    <div className="flex gap-[2px] items-end h-4" aria-hidden>
                      {Array.from({ length: 8 }, (_, i) => (
                        <span
                          key={i}
                          className="w-[3px] rounded-sm transition-all duration-300"
                          style={{
                            height: `${30 + ((d.threads * 7 + i * 13) % 70)}%`,
                            background: i < Math.ceil(d.threads / 4) ? "var(--color-accent)" : "var(--border)",
                          }}
                        />
                      ))}
                    </div>
                    <span className="tabular-nums text-[12px] font-semibold">{d.threads}</span>
                  </div>
                </td>
                <td className="px-3 border-b whitespace-nowrap" style={{ borderColor: "var(--border)" }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: st.color }}>
                    <StIcon size={14} className={d.status === "downloading" ? "animate-spin [animation-duration:2.5s]" : ""} />
                    {st.label}
                  </span>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="h-40 text-center" style={{ color: "var(--muted)" }}>
                <div className="flex flex-col items-center gap-3">
                  <span>لا توجد تحميلات في هذا التصنيف بعد.</span>
                  <button
                    onClick={onAdd}
                    className="h-9 px-4 rounded-xl text-[13px] font-bold cursor-pointer transition-all hover:brightness-105 focus-visible:outline-2 focus-visible:-outline-offset-2"
                    style={{ background: "var(--color-accent)", color: "#06231a", outlineColor: "var(--color-accent)" }}
                  >
                    أضف أول رابط تحميل
                  </button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
