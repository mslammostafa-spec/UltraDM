import { useEffect, useRef, useState } from "react";
import { X, Link, Magnet, Upload } from "lucide-react";
import { MAX_THREADS, type Category } from "../lib/ipc";
import { categoryFromName, fileNameFromUrl } from "../lib/format";

export function Modal({
  title, onClose, children, wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // تركيز أول حقل إدخال داخل النافذة عند الفتح (بديل autoFocus الصريح).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 animate-in cursor-default"
        style={{ animation: "fade 150ms ease-out" }}
      />
      <div
        ref={bodyRef}
        className={`relative w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-3xl p-6 shadow-xl max-h-[90vh] overflow-auto`}
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-2)", animation: "rise 200ms ease-out" }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-bold text-[18px] tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="grid place-items-center w-9 h-9 rounded-xl hover:brightness-95 cursor-pointer"
            style={{ background: "var(--surface-2)" }}
          >
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ThreadsPicker({
  value, onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-[12.5px] font-semibold mb-2">
        <label htmlFor="threads">عدد الخيوط النشطة</label>
        <span className="tabular-nums" style={{ color: "var(--ok)" }}>{value} / {MAX_THREADS}</span>
      </div>
      <input
        id="threads"
        type="range"
        min={1}
        max={MAX_THREADS}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)] cursor-pointer"
      />
      <div className="flex gap-1.5 mt-2">
        {[1, 8, 16, 32].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className="flex-1 h-8 rounded-lg text-[12px] font-bold cursor-pointer transition-all hover:brightness-105"
            style={{ background: value === n ? "var(--color-accent)" : "var(--surface-2)", color: value === n ? "#06231a" : "var(--text)" }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AddLinkDialog({
  onClose, onSubmit,
}: {
  onClose: () => void;
  onSubmit: (url: string, threads: number) => void;
}) {
  const [url, setUrl] = useState("");
  const [threads, setThreads] = useState(8);
  const name = url.trim() ? fileNameFromUrl(url) : "";

  return (
    <Modal title="إضافة رابط تحميل" onClose={onClose}>
      <div className="flex items-center gap-2 rounded-xl h-12 px-3 mb-2" style={{ background: "var(--surface-2)" }}>
        <Link size={16} style={{ color: "var(--muted)" }} />
        <input

          dir="ltr"
          placeholder="https://example.com/file.zip"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 bg-transparent outline-none text-[13.5px] placeholder:opacity-50"
          style={{ color: "var(--text)" }}
        />
      </div>
      {name && (
        <p className="text-[12px] mb-2" style={{ color: "var(--muted)" }}>
          سيُصنَّف تلقائيًا: <b style={{ color: "var(--text)" }}>{name}</b> — {categoryFromName(name)}
        </p>
      )}
      <div className="my-5">
        <ThreadsPicker value={threads} onChange={setThreads} />
      </div>
      <button
        onClick={() => onSubmit(url.trim(), threads)}
        disabled={!url.trim()}
        className="w-full h-11 rounded-xl font-bold text-[14px] transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-40 cursor-pointer"
        style={{ background: "var(--color-accent)", color: "#06231a" }}
      >
        بدء التحميل
      </button>
    </Modal>
  );
}

export function AddTorrentDialog({
  onClose, onSubmit,
}: {
  onClose: () => void;
  onSubmit: (url: string, threads: number) => void;
}) {
  const [url, setUrl] = useState("");
  const [threads, setThreads] = useState(16);

  return (
    <Modal title="إضافة تورنت" onClose={onClose}>
      <div className="flex items-center gap-2 rounded-xl h-12 px-3 mb-3" style={{ background: "var(--surface-2)" }}>
        <Magnet size={16} style={{ color: "var(--color-torrent)" }} />
        <input

          dir="ltr"
          placeholder="magnet:?xt=urn:btih:… أو رابط .torrent"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 bg-transparent outline-none text-[13.5px] placeholder:opacity-50"
          style={{ color: "var(--text)" }}
        />
      </div>
      <label
        className="flex items-center justify-center gap-2 rounded-xl h-11 mb-5 text-[13px] font-semibold cursor-pointer border border-dashed transition-colors hover:brightness-105"
        style={{ borderColor: "var(--border)", color: "var(--muted)" }}
      >
        <Upload size={15} />
        أو اختر ملف .torrent من الجهاز
        <input type="file" accept=".torrent" className="sr-only"
               onChange={(e) => setUrl(e.target.files?.[0]?.name ? `file://${e.target.files[0].name}` : "")} />
      </label>
      <div className="mb-5">
        <ThreadsPicker value={threads} onChange={setThreads} />
      </div>
      <button
        onClick={() => onSubmit(url.trim(), threads)}
        disabled={!url.trim()}
        className="w-full h-11 rounded-xl font-bold text-[14px] transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-40 cursor-pointer"
        style={{ background: "var(--color-torrent)", color: "#0a1430" }}
      >
        إضافة التورنت
      </button>
    </Modal>
  );
}

export interface ScheduleRule {
  id: number;
  start: string;
  end: string;
  days: string;
}

export function SchedulerDialog({
  onClose, rules, setRules,
}: {
  onClose: () => void;
  rules: ScheduleRule[];
  setRules: (r: ScheduleRule[]) => void;
}) {
  const addRule = () => {
    setRules([...rules, { id: Date.now(), start: "02:00", end: "08:00", days: "يوميًا" }]);
  };

  return (
    <Modal title="جدولة التحميلات" onClose={onClose}>
      <p className="text-[12.5px] mb-4" style={{ color: "var(--muted)" }}>
        حدّد نوافذ زمنية يُسمح فيها بالتحميل تلقائيًا — مثالي للتوقيتات الليلية.
      </p>
      <div className="flex flex-col gap-2.5 mb-5 max-h-56 overflow-auto">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-xl h-12 px-3" style={{ background: "var(--surface-2)" }}>
            <input type="time" value={r.start} aria-label="بداية"
                   onChange={(e) => setRules(rules.map((x) => x.id === r.id ? { ...x, start: e.target.value } : x))}
                   className="bg-transparent outline-none text-[13px] tabular-nums w-24 cursor-pointer" style={{ color: "var(--text)" }} />
            <span style={{ color: "var(--muted)" }}>←</span>
            <input type="time" value={r.end} aria-label="نهاية"
                   onChange={(e) => setRules(rules.map((x) => x.id === r.id ? { ...x, end: e.target.value } : x))}
                   className="bg-transparent outline-none text-[13px] tabular-nums w-24 cursor-pointer" style={{ color: "var(--text)" }} />
            <span className="flex-1" />
            <select value={r.days} aria-label="الأيام"
                    onChange={(e) => setRules(rules.map((x) => x.id === r.id ? { ...x, days: e.target.value } : x))}
                    className="bg-transparent outline-none text-[12.5px] cursor-pointer" style={{ color: "var(--ok)" }}>
              {["يوميًا", "أيام العمل", "الويكند"].map((d) => <option key={d} style={{ color: "#111" }}>{d}</option>)}
            </select>
            <button aria-label="حذف القاعدة" onClick={() => setRules(rules.filter((x) => x.id !== r.id))}
                    className="text-[#e5484d] font-bold px-1 cursor-pointer">✕</button>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="text-center text-[12.5px] py-4" style={{ color: "var(--muted)" }}>لا توجد قواعد بعد.</p>
        )}
      </div>
      <button
        onClick={addRule}
        className="w-full h-11 rounded-xl font-bold text-[14px] transition-all hover:brightness-105 cursor-pointer"
        style={{ background: "var(--color-accent)", color: "#06231a" }}
      >
        إضافة نافذة زمنية
      </button>
    </Modal>
  );
}

export type { Category };
