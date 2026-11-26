import { useMemo, useState } from "react";
import {
  LayoutGrid, Film, Music, FileArchive, Package, FileText, Magnet, HardDriveDownload,
  ChevronDown, Loader, Download, Pause, Check, AlertTriangle, CalendarClock, History,
  Trash2, FolderOpen,
} from "lucide-react";
import type { Category, Download as Dl, Status } from "../lib/ipc";

type Icon = typeof LayoutGrid;

const CATS: Array<{ id: Exclude<Category, "all">; label: string; icon: Icon }> = [
  { id: "software", label: "برامج", icon: Package },
  { id: "archive", label: "مضغوط", icon: FileArchive },
  { id: "audio", label: "صوتيات", icon: Music },
  { id: "video", label: "فيديو", icon: Film },
  { id: "document", label: "مستندات", icon: FileText },
  { id: "torrent", label: "تورنت", icon: Magnet },
];

const STATUSES: Array<{ id: Status; label: string; icon: Icon; color: string }> = [
  { id: "downloading", label: "قيد التحميل", icon: Loader, color: "var(--ok)" },
  { id: "queued", label: "في طابور الانتظار", icon: Download, color: "var(--muted)" },
  { id: "scheduled", label: "مجدولة", icon: CalendarClock, color: "var(--muted)" },
  { id: "error", label: "فشل / خطأ", icon: AlertTriangle, color: "#d1343a" },
  { id: "paused", label: "متوقفة مؤقتاً", icon: Pause, color: "var(--muted)" },
  { id: "done", label: "مكتملة", icon: Check, color: "var(--ok)" },
];

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      size={15}
      aria-hidden
      className="transition-transform duration-200 ease-out"
      style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", color: "var(--muted)" }}
    />
  );
}

function Badge({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className="text-[11px] tabular-nums rounded-full px-2 py-0.5 min-w-6 text-center font-bold"
      style={{
        background: active ? "var(--color-accent)" : "var(--surface-2)",
        color: active ? "#06231a" : "var(--muted)",
      }}
    >
      {n}
    </span>
  );
}

function Row({
  id, label, icon: Icon, count, depth, active, iconColor, onClick,
}: {
  id: string;
  label: string;
  icon: Icon;
  count: number;
  depth: 0 | 1;
  active: boolean;
  iconColor?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      data-filter={id}
      className="group flex items-center gap-2.5 rounded-xl text-[14px] transition-all duration-200 ease-out cursor-pointer
                 focus-visible:outline-2 focus-visible:-outline-offset-2 hover:translate-x-[-2px]"
      style={{
        height: depth === 0 ? 44 : 36,
        paddingInlineStart: depth === 0 ? 12 : 30,
        paddingInlineEnd: 12,
        marginInlineStart: depth === 1 ? 10 : 0,
        width: depth === 1 ? "calc(100% - 10px)" : "100%",
        background: active ? "var(--surface-2)" : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        fontWeight: active ? 700 : depth === 0 ? 600 : 500,
        fontSize: depth === 0 ? 14 : 13,
        outlineColor: "var(--color-accent)",
        boxShadow: active ? "inset 0 0 0 1px var(--border)" : undefined,
      }}
    >
      <Icon
        size={depth === 0 ? 19 : 16}
        strokeWidth={active ? 2.3 : 1.9}
        style={{ color: iconColor ?? (active ? "var(--color-accent-strong)" : "var(--muted)") }}
      />
      <span className="flex-1 text-right truncate">{label}</span>
      <Badge n={count} active={active} />
    </button>
  );
}

function Section({
  label, icon: Icon, count, open, onToggle, children,
}: {
  label: string;
  icon: Icon;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={open}
        data-section={label}
        className="group flex items-center gap-2.5 rounded-xl px-3 h-10 w-full text-[14px] font-semibold cursor-pointer
                   focus-visible:outline-2 focus-visible:-outline-offset-2 hover:translate-x-[-2px] transition-all duration-200 ease-out"
        style={{ color: "var(--text)", outlineColor: "var(--color-accent)" }}
      >
        <Chevron open={open} />
        <Icon size={18} strokeWidth={2} style={{ color: "var(--muted)" }} />
        <span className="flex-1 text-right truncate">{label}</span>
        <Badge n={count} active={false} />
      </button>
      {open && (
        <div
          className="flex flex-col gap-0.5 mt-0.5 mb-1 border-r pr-0 mr-4"
          style={{ borderColor: "var(--border)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  active, onSelect, downloads, deletedCount,
}: {
  active: string;
  onSelect: (id: string) => void;
  downloads: Dl[];
  deletedCount: number;
}) {
  const [catsOpen, setCatsOpen] = useState(true);
  const [statusOpen, setStatusOpen] = useState(true);

  const catCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of downloads) m.set(d.category, (m.get(d.category) ?? 0) + 1);
    return m;
  }, [downloads]);
  const statusCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of downloads) m.set(d.status, (m.get(d.status) ?? 0) + 1);
    return m;
  }, [downloads]);

  const go = (id: string) => onSelect(id);
  const doneCount = statusCount.get("done") ?? 0;

  return (
    <nav
      aria-label="تصفية التحميلات"
      className="w-[232px] shrink-0 flex flex-col gap-0.5 p-4 border-l overflow-y-auto"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-2.5 px-2 pb-5 pt-1">
        <div
          className="grid place-items-center w-10 h-10 rounded-2xl text-[#06231a]"
          style={{
            background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-strong))",
            boxShadow: "var(--shadow-1)",
          }}
        >
          <HardDriveDownload size={22} strokeWidth={2.2} />
        </div>
        <div>
          <div className="font-display font-bold text-[17px] tracking-tight leading-4">UltraDM</div>
          <div className="text-[11px]" style={{ color: "var(--muted)" }}>مدير التحميلات المتطور</div>
        </div>
      </div>

      <div>
        <Row
          id="all" label="جميع التحميلات" icon={LayoutGrid}
          count={downloads.length} depth={0} active={active === "all"}
          onClick={() => go("all")}
        />
      </div>

      <div>
        <Section
          label="التصنيفات" icon={FolderOpen} count={downloads.length}
          open={catsOpen} onToggle={() => setCatsOpen((o) => !o)}
        >
          {CATS.map((c) => (
            <Row
              key={c.id}
              id={`cat:${c.id}`} label={c.label} icon={c.icon}
              count={catCount.get(c.id) ?? 0} depth={1}
              active={active === `cat:${c.id}`}
              onClick={() => go(`cat:${c.id}`)}
            />
          ))}
        </Section>

        <Section
          label="الحالة" icon={Loader} count={downloads.length}
          open={statusOpen} onToggle={() => setStatusOpen((o) => !o)}
        >
          {STATUSES.map((s) => (
            <Row
              key={s.id}
              id={`status:${s.id}`} label={s.label} icon={s.icon}
              count={statusCount.get(s.id) ?? 0} depth={1}
              active={active === `status:${s.id}`}
              iconColor={s.color}
              onClick={() => go(`status:${s.id}`)}
            />
          ))}
        </Section>

        <Row
          id="history" label="السجل" icon={History}
          count={doneCount} depth={0} active={active === "history"}
          onClick={() => go("history")}
        />
        <Row
          id="deleted" label="المحذوفات" icon={Trash2}
          count={deletedCount} depth={0} active={active === "deleted"}
          iconColor={active === "deleted" ? "#e5484d" : undefined}
          onClick={() => go("deleted")}
        />
      </div>

      <div className="mt-auto px-2 text-[11px] leading-5 pt-4" style={{ color: "var(--muted)" }}>
        <div className="font-display font-bold" style={{ color: "var(--text)" }}>
          {statusCount.get("downloading") ?? 0} تحميل نشط
        </div>
        <div>
          {downloads
            .filter((d) => d.status === "downloading")
            .reduce((s, d) => s + d.threads, 0)} خيط نشط عبر {" "}
          {downloads.filter((d) => d.status === "downloading").length} تحميلات
        </div>
      </div>
    </nav>
  );
}
