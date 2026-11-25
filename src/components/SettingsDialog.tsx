import { useState } from "react";
import { X, Check, Save, Palette, HardDrive, MemoryStick, Power, Puzzle } from "lucide-react";
import { THEMES, type Settings } from "../lib/themes";
import { invoke, isTauri } from "@tauri-apps/api/core";

type BrowserBinding = {
  browser: string;
  installed: boolean;
  hostRegistered: boolean;
};

type ExtensionStatus = {
  native_host_name: string;
  manifest_path: string;
  browsers: BrowserBinding[];
};

const RAM_LIMITS = [0.5, 1, 2, 4, 8, 16];

function Swatch({ colors, active }: { colors: [string, string, string]; active: boolean }) {
  const [bg, accent, extra] = colors;
  return (
    <div
      className="relative h-16 rounded-xl overflow-hidden shrink-0 border"
      style={{
        background: bg,
        borderColor: active ? accent : "var(--border)",
        boxShadow: active ? `0 0 0 2px ${accent}` : "var(--shadow-1)",
      }}
      aria-hidden
    >
      <div className="absolute top-2 bottom-2 ltr:left-2 rtl:right-2 w-8 rounded-md" style={{ background: `${accent}33`, border: `1px solid ${accent}55` }} />
      <div className="absolute top-3 h-1.5 rounded-full" style={{ background: accent, insetInlineStart: "2.6rem", width: "38%" }} />
      <div className="absolute top-6 h-1.5 rounded-full opacity-70" style={{ background: accent, insetInlineStart: "2.6rem", width: "26%" }} />
      <div className="absolute bottom-2.5 h-2 w-2 rounded-full" style={{ background: extra, insetInlineEnd: 10 }} />
    </div>
  );
}

export default function SettingsDialog({
  settings, onClose, onSave,
}: {
  settings: Settings;
  onClose: () => void;
  onSave: (s: Settings) => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [ext, setExt] = useState<ExtensionStatus | null>(null);
  const [extBusy, setExtBusy] = useState(false);
  const [extMsg, setExtMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadExt = () =>
    invoke<ExtensionStatus>("extension_binding_status")
      .then(setExt)
      .catch(() => setExt(null));

  const registerExt = async () => {
    setExtBusy(true);
    setExtMsg(null);
    try {
      const r = await invoke<BrowserBinding[]>("extension_register_browsers");
      setExt((s) => (s ? { ...s, browsers: r } : s));
      const linked = r.filter((b) => b.hostRegistered).length;
      setExtMsg({
        ok: true,
        text: linked > 0
          ? `تم تثبيت الربط بنجاح لـ ${linked} متصفح.`
          : "تم تسجيل المضيف، لكن لم يُكتشف أي متصفح مثبّت.",
      });
    } catch (e) {
      setExtMsg({ ok: false, text: `فشل تثبيت الربط: ${String(e)}` });
    } finally {
      setExtBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      if (isTauri()) {
        try {
          await invoke("engine_set_cache_config", {
            ramFirst: draft.ssdProtection,
            ramFullLimitBytes: Math.round(draft.ramFullLimitGB * 1024 * 1024 * 1024),
          });
          await invoke("register_autostart", { enable: draft.autoStart });
        } catch {
          // الأوامر غير متاحة في بعض البيئات؛ الإعدادات محفوظة على أي حال
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleRow = (
    icon: React.ReactNode, title: string, desc: string, key: "ssdProtection" | "autoStart",
  ) => (
    <button
      onClick={() => setDraft((s) => ({ ...s, [key]: !s[key] }))}
      aria-pressed={draft[key]}
      className="flex items-center gap-3 w-full rounded-2xl border p-4 text-right cursor-pointer transition-all duration-150 hover:brightness-105"
      style={{
        borderColor: draft[key] ? "var(--color-accent)" : "var(--border)",
        background: "var(--surface)",
        boxShadow: draft[key] ? `0 0 0 1px var(--color-accent), var(--shadow-1)` : "var(--shadow-1)",
      }}
    >
      <span className="w-9 h-9 grid place-items-center rounded-xl shrink-0" style={{ background: "var(--surface-2)", color: "var(--color-accent)" }}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-[13.5px]" style={{ color: "var(--text)" }}>{title}</span>
        <span className="block text-[12px] leading-5" style={{ color: "var(--muted)" }}>{desc}</span>
      </span>
      {draft[key] && <Check size={18} style={{ color: "var(--color-accent)" }} />}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(0,0,0,.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="الإعدادات"
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-3xl border overflow-hidden"
        style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center gap-3 px-6 h-16 border-b shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
          data-tauri-drag-region
        >
          <Palette size={20} style={{ color: "var(--color-accent)" }} />
          <h2 className="font-display font-bold text-[17px] flex-1" style={{ color: "var(--text)" }}>الإعدادات والمظهر</h2>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-9 h-9 grid place-items-center rounded-xl cursor-pointer hover:brightness-110"
            style={{ background: "var(--surface)", color: "var(--muted)" }}
          >
            <X size={17} />
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5 flex-1">
          <div className="text-[13px] font-semibold mb-3" style={{ color: "var(--muted)" }}>اختر الثيم — يُطبَّق فوراً</div>
          <div className="grid grid-cols-1 min-[560px]:grid-cols-2 gap-3">
            {THEMES.map((t) => {
              const active = draft.theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setDraft((s) => ({ ...s, theme: t.id }))}
                  aria-pressed={active}
                  className="flex flex-col gap-2 rounded-2xl border p-3 text-right cursor-pointer transition-all duration-150 hover:brightness-105
                             focus-visible:outline-2 focus-visible:-outline-offset-2"
                  style={{
                    borderColor: active ? t.vars.accent : "var(--border)",
                    background: active ? "var(--surface-2)" : "var(--surface)",
                    boxShadow: active ? `0 0 0 1px ${t.vars.accent}, var(--shadow-1)` : "var(--shadow-1)",
                    outlineColor: "var(--color-accent)",
                  }}
                >
                  <Swatch colors={t.swatch} active={active} />
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[14px]" style={{ color: "var(--text)" }}>{t.name}</span>
                    {active && <Check size={16} style={{ color: t.vars.accent }} />}
                  </div>
                  <span className="text-[12px] leading-5" style={{ color: "var(--muted)" }}>{t.desc}</span>
                </button>
              );
            })}
          </div>

          <div className="text-[13px] font-semibold mt-6 mb-3" style={{ color: "var(--muted)" }}>حماية SSD والأداء</div>
          <div className="grid grid-cols-1 gap-3">
            {toggleRow(
              <HardDrive size={18} />,
              "وضع حماية SSD (Zero-Wear)",
              "تحميل الملفات الصغيرة كاملة في الذاكرة ثم كتابتها كتابة تسلسلية واحدة — دورة كتابة واحدة لكل ملف",
              "ssdProtection",
            )}
            {toggleRow(
              <Power size={18} />,
              "البدء التلقائي مع ويندوز",
              "تشغيل UltraDM في الخلفية عند إقلاع النظام (أيقونة شريط النظام)",
              "autoStart",
            )}
            <div
              className="flex items-center gap-3 rounded-2xl border p-4"
              style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-1)" }}
            >
              <span className="w-9 h-9 grid place-items-center rounded-xl shrink-0" style={{ background: "var(--surface-2)", color: "var(--color-accent)" }}>
                <MemoryStick size={18} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-[13.5px]" style={{ color: "var(--text)" }}>حد التحميل الكامل في الذاكرة</span>
                <span className="block text-[12px] leading-5" style={{ color: "var(--muted)" }}>
                  الملفات الأصغر من هذا الحجم تُحمَّل في RAM كاملةً (التراجع للقرص تلقائياً فوق 75% استخدام ذاكرة)
                </span>
              </span>
              <select
                dir="ltr"
                value={draft.ramFullLimitGB}
                onChange={(e) => setDraft((s) => ({ ...s, ramFullLimitGB: Number(e.target.value) }))}
                className="rounded-xl h-10 px-3 text-[13px] font-semibold cursor-pointer"
                style={{ background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" }}
                aria-label="حد الذاكرة الكاملة"
              >
                {RAM_LIMITS.map((gb) => (
                  <option key={gb} value={gb}>{gb} GB</option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-[13px] font-semibold mt-6 mb-3" style={{ color: "var(--muted)" }}>إضافة المتصفح — ربط Chrome وEdge وBrave وOpera</div>
          <div
            className="rounded-2xl border p-4"
            style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-1)" }}
            onFocus={loadExt}
            onMouseEnter={loadExt}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="w-9 h-9 grid place-items-center rounded-xl shrink-0" style={{ background: "var(--surface-2)", color: "var(--color-accent)" }}>
                <Puzzle size={18} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-[13.5px]" style={{ color: "var(--text)" }}>حالة الربط مع المتصفحات</span>
                <span className="block text-[12px] leading-5" style={{ color: "var(--muted)" }}>
                  {ext ? `مضيف الرسائل: ${ext.native_host_name}` : "حمّل الحالة لعرض الربط مع كل متصفح"}
                </span>
              </span>
              <button
                onClick={registerExt}
                disabled={extBusy}
                className="rounded-xl h-10 px-4 text-[12.5px] font-semibold cursor-pointer hover:brightness-110 disabled:opacity-50"
                style={{ background: "var(--color-accent)", color: "var(--bg)" }}
              >
                {extBusy ? "جارٍ التثبيت…" : "تثبيت الربط تلقائياً"}
              </button>
            </div>
            {extMsg && (
              <div
                role="status"
                className="rounded-xl border px-3 py-2 text-[12px] font-semibold mb-3"
                style={{
                  borderColor: extMsg.ok ? "var(--color-accent)" : "#ef4444",
                  color: extMsg.ok ? "var(--color-accent)" : "#ef4444",
                  background: "var(--surface-2)",
                }}
              >
                {extMsg.text}
              </div>
            )}
            {ext && (
              <ul className="grid grid-cols-2 min-[560px]:grid-cols-4 gap-2">
                {ext.browsers.map((b) => (
                  <li
                    key={b.browser}
                    className="rounded-xl border px-3 py-2 text-[12px] flex items-center gap-2"
                    style={{ borderColor: b.hostRegistered ? "var(--color-accent)" : "var(--border)" }}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: b.hostRegistered ? "#34d399" : b.installed ? "#fbbf24" : "var(--muted)" }}
                      aria-hidden
                    />
                    <span style={{ color: "var(--text)" }}>{b.browser}</span>
                    <span className="ms-auto" style={{ color: "var(--muted)" }}>
                      {b.hostRegistered ? "مرتبط" : b.installed ? "غير مرتبط" : "غير مثبت"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer
          className="flex items-center gap-3 px-6 py-4 border-t shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
        >
          <span className="text-[12px] flex-1" style={{ color: "var(--muted)" }}>
            يُحفظ الإعداد في ملف settings.json على القرص عبر الخلفية
          </span>
          <button
            onClick={onClose}
            className="rounded-xl h-11 px-5 text-[13px] font-semibold cursor-pointer hover:brightness-105"
            style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
          >
            إلغاء
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl h-11 px-5 text-[13px] font-bold cursor-pointer hover:brightness-105
                       disabled:opacity-50 disabled:pointer-events-none"
            style={{ background: "var(--color-accent)", color: "var(--bg)", boxShadow: "var(--shadow-1)" }}
          >
            <Save size={16} />
            حفظ وإغلاق (Save & Close)
          </button>
        </footer>
      </div>
    </div>
  );
}
