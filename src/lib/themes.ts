export interface Theme {
  id: string;
  name: string;
  desc: string;
  dark: boolean;
  swatch: [string, string, string]; // معاينة لونية: خلفية، أساسي، مميز
  vars: {
    bg: string;
    surface: string;
    surface2: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentStrong: string;
    torrent: string;
    ok: string;
    shadow1: string;
    shadow2: string;
  };
}

export const THEMES: Theme[] = [
  {
    id: "cyber-glass",
    name: "Cyber Glass Blue",
    desc: "زجاجي داكن مع أزرق سماوي وبنفسجي متوهج",
    dark: true,
    swatch: ["#0a0f1e", "#38bdf8", "#a78bfa"],
    vars: {
      bg: "#070b18", surface: "#0d1426", surface2: "#141d36", text: "#e6edf7",
      muted: "#8b9bb8", border: "#1e2a4a", accent: "#38bdf8", accentStrong: "#818cf8",
      torrent: "#22d3ee", ok: "#34d399",
      shadow1: "0 1px 2px rgba(0,0,0,.5)", shadow2: "0 12px 36px rgba(56,189,248,.18)",
    },
  },
  {
    id: "obsidian-gold",
    name: "Obsidian Gold & Crimson",
    desc: "أسود عميق OLED مع ذهبي وأحمر قرمزي",
    dark: true,
    swatch: ["#000000", "#e6b450", "#d1343a"],
    vars: {
      bg: "#000000", surface: "#0b0b0d", surface2: "#161519", text: "#f2ecdf",
      muted: "#9b937f", border: "#26241f", accent: "#e6b450", accentStrong: "#c9963a",
      torrent: "#d1343a", ok: "#7fb069",
      shadow1: "0 1px 2px rgba(0,0,0,.7)", shadow2: "0 12px 36px rgba(230,180,80,.14)",
    },
  },
  {
    id: "emerald-luxury",
    name: "Emerald Luxury",
    desc: "أخضر زمردي داكن مع لمسات ذهبية فاخرة",
    dark: true,
    swatch: ["#04160f", "#10b981", "#d4af6a"],
    vars: {
      bg: "#020c08", surface: "#071710", surface2: "#0d2419", text: "#e4f2ea",
      muted: "#87a89a", border: "#16352a", accent: "#10b981", accentStrong: "#0d9668",
      torrent: "#d4af6a", ok: "#4ade80",
      shadow1: "0 1px 2px rgba(0,0,0,.5)", shadow2: "0 12px 36px rgba(16,185,129,.16)",
    },
  },
  {
    id: "frost-light",
    name: "Pure Frost Light",
    desc: "نهاري زجاجي أبيض نظيف مع أزرق سماوي",
    dark: false,
    swatch: ["#f5f9fc", "#0ea5e9", "#e2f2fb"],
    vars: {
      bg: "#f3f8fb", surface: "#ffffff", surface2: "#ebf3f8", text: "#16222b",
      muted: "#5c7080", border: "#dce8ef", accent: "#0ea5e9", accentStrong: "#0284c7",
      torrent: "#06b6d4", ok: "#0f8a5f",
      shadow1: "0 1px 2px rgba(22,40,53,.07)", shadow2: "0 12px 32px rgba(2,132,199,.12)",
    },
  },
  {
    id: "neon-cyberpunk",
    name: "Neon Cyberpunk",
    desc: "بنفسجي نيون داكن مع وردي ومؤثرات مستقبلية",
    dark: true,
    swatch: ["#0d0217", "#c026d3", "#f0abfc"],
    vars: {
      bg: "#0a0114", surface: "#150426", surface2: "#210a38", text: "#f3e8ff",
      muted: "#a684c2", border: "#331250", accent: "#e879f9", accentStrong: "#c026d3",
      torrent: "#22d3ee", ok: "#4ade80",
      shadow1: "0 1px 2px rgba(0,0,0,.6)", shadow2: "0 12px 36px rgba(232,121,249,.2)",
    },
  },
  {
    id: "arctic-nord",
    name: "Arctic Nord",
    desc: "أزرق ثلجي هادئ ومريح للعين من ألوان الشمال",
    dark: true,
    swatch: ["#2e3440", "#88c0d0", "#5e81ac"],
    vars: {
      bg: "#242933", surface: "#2e3440", surface2: "#3b4252", text: "#eceff4",
      muted: "#9aa5b8", border: "#434c5e", accent: "#88c0d0", accentStrong: "#5e81ac",
      torrent: "#81a1c1", ok: "#a3be8c",
      shadow1: "0 1px 2px rgba(0,0,0,.4)", shadow2: "0 12px 32px rgba(136,192,208,.14)",
    },
  },
  {
    id: "sunset-synthwave",
    name: "Sunset Synthwave",
    desc: "تدرجات الغروب البرتقالية والبنفسجية الدافئة",
    dark: true,
    swatch: ["#1c0b2e", "#fb923c", "#c084fc"],
    vars: {
      bg: "#140723", surface: "#1f0e33", surface2: "#2b1545", text: "#f5ecff",
      muted: "#b095c9", border: "#3d2260", accent: "#fb923c", accentStrong: "#f97316",
      torrent: "#c084fc", ok: "#fb7185",
      shadow1: "0 1px 2px rgba(0,0,0,.5)", shadow2: "0 12px 36px rgba(251,146,60,.18)",
    },
  },
  {
    id: "midnight-royal",
    name: "Midnight Royal",
    desc: "أزرق ملكي ليلي عميق مع فضي لامع",
    dark: true,
    swatch: ["#0a1030", "#3b82f6", "#cbd5e1"],
    vars: {
      bg: "#060b24", surface: "#0c1334", surface2: "#131d4a", text: "#eef2ff",
      muted: "#94a3d0", border: "#1e2a5e", accent: "#3b82f6", accentStrong: "#2563eb",
      torrent: "#cbd5e1", ok: "#34d399",
      shadow1: "0 1px 2px rgba(0,0,0,.55)", shadow2: "0 12px 36px rgba(59,130,246,.2)",
    },
  },
  {
    id: "matrix-hacker",
    name: "Matrix Hacker",
    desc: "أسود حالك مع أخضر رقمي ساطع",
    dark: true,
    swatch: ["#000000", "#22ff88", "#0f3"],
    vars: {
      bg: "#000000", surface: "#050805", surface2: "#0b140c", text: "#d2ffd2",
      muted: "#5f9b6a", border: "#152a17", accent: "#22ff88", accentStrong: "#00cc5f",
      torrent: "#22ff88", ok: "#22ff88",
      shadow1: "0 1px 2px rgba(0,0,0,.8)", shadow2: "0 12px 36px rgba(34,255,136,.15)",
    },
  },
  {
    id: "graphite",
    name: "Minimalist Graphite",
    desc: "رمادي معدني احترافي أنيق وبسيط",
    dark: true,
    swatch: ["#1b1d21", "#a8b0ba", "#e5484d"],
    vars: {
      bg: "#141619", surface: "#1b1d21", surface2: "#25282d", text: "#e8eaed",
      muted: "#9aa1ab", border: "#32363d", accent: "#a8b0ba", accentStrong: "#828b97",
      torrent: "#e5484d", ok: "#6cc576",
      shadow1: "0 1px 2px rgba(0,0,0,.5)", shadow2: "0 12px 32px rgba(0,0,0,.35)",
    },
  },
];

export const DEFAULT_THEME_ID = "emerald-luxury";

export function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES.find((x) => x.id === DEFAULT_THEME_ID)!;
  const r = document.documentElement;
  const v = t.vars;
  r.classList.toggle("dark", t.dark);
  r.style.setProperty("--bg", v.bg);
  r.style.setProperty("--surface", v.surface);
  r.style.setProperty("--surface-2", v.surface2);
  r.style.setProperty("--text", v.text);
  r.style.setProperty("--muted", v.muted);
  r.style.setProperty("--border", v.border);
  r.style.setProperty("--color-accent", v.accent);
  r.style.setProperty("--color-accent-strong", v.accentStrong);
  r.style.setProperty("--color-torrent", v.torrent);
  r.style.setProperty("--ok", v.ok);
  r.style.setProperty("--shadow-1", v.shadow1);
  r.style.setProperty("--shadow-2", v.shadow2);
  r.dataset.theme = t.id;
  r.style.colorScheme = t.dark ? "dark" : "light";
  return t;
}

export interface Settings {
  theme: string;
  afterFinish: "none" | "shutdown" | "sleep" | "exit";
  threads: number;
  ssdProtection: boolean;
  ramFullLimitGB: number;
  autoStart: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME_ID,
  afterFinish: "none",
  threads: 32,
  ssdProtection: true,
  ramFullLimitGB: 4,
  autoStart: false,
};
