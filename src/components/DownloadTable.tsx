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
    <div className="flex-1 min-h-0 overflow-auto" style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
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
          <tr style={{ background: "var(--surface-2)", borderTopLeftRadius: "12px", borderTopRightRadius: "12px" }}>
            <th className="h-11 px-3 text-right font-semibold text-[12px] border-b whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <input type="checkbox" className="w-4 h-4" />
            </th>
            <th className="h-11 px-3 text-right font-semibold text-[12px] border-b whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)", borderTopLeftRadius: "12px" }}>اسم الملف</th>
            <th className="h-11 px-3 text-right font-semibold text-[12px] border-b whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>النوع</th>
            <th className="h-11 px-3 text-right font-semibold text-[12px] border-b whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)", borderTopRightRadius: "12px" }}>الحجم</th>
            <th className="h-11 px-3 text-right font-semibold text-[12px] border-b whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>التقدم</th>
            <th className="h-11 px-3 text-right font-semibold text-[12px] border-b whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>السرعة</th>
            <th className="h-11 px-3 text-right font-semibold text-[12px] border-b whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)", borderTopRightRadius: "12px" }}>المتبقي</th>
            <th className="h-11 px-3 text-right font-semibold text-[12px] border-b whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)", borderTopRightRadius: "12px" }}>الحالة</th>
            <th className="h-11 px-3 text-right font-semibold text-[12px] border-b whitespace-nowrap" style={{ borderColor: "var(--border)", color: "var(--muted)", borderTopRightRadius: "12px" }}>
              <button className="text-[12px] font-semibold" style={{ color: "var(--color-accent)", cursor: "pointer" }} onClick={() => {}}>تحديد الكل</button>
            </th>
          </tr>
        </thead>
      </table>
    </div>
  );
}