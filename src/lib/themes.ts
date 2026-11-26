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
    id: "glass-emerald-cyan",
    name: "الزمردي السيان",
    desc: "التصميم الزجاجي المعتمد: زمردي متوهج مع سيان (الافتراضي)",
    dark: true,
    swatch: ["#04120d", "#34d399", "#22d3ee"],
    vars: {
      bg: "#030d09", surface: "#071710", surface2: "#0b2418", text: "#e9fff5",
      muted: "#8bb8a5", border: "#12362a", accent: "#34d399", accentStrong: "#10b981",
      torrent: "#22d3ee", ok: "#34d399",
      shadow1: "0 1px 2px rgba(0,0,0,.5)", shadow2: "0 12px 36px rgba(52,211,153,.2)",
    },
  },
  {
    id: "glass-teal-lagoon",
    name: "Glass Teal Lagoon",
    desc: "زجاجي فيروزي شفاف بلمسة بحرية هادئة",
    dark: true,
    swatch: ["#03181c", "#2dd4bf", "#67e8f9"],
    vars: {
      bg: "#021114", surface: "#052025", surface2: "#0a2f34", text: "#e0f7f5",
      muted: "#84b0ad", border: "#12444a", accent: "#2dd4bf", accentStrong: "#14b8a6",
      torrent: "#67e8f9", ok: "#4ade80",
      shadow1: "0 1px 2px rgba(0,0,0,.55)", shadow2: "0 12px 36px rgba(45,212,191,.18)",
    },
  },
  {
    id: "glass-violet-crystal",
    name: "Glass Violet Crystal",
    desc: "زجاجي بنفسجي كريستالي متوهج وشفاف",
    dark: true,
    swatch: ["#12061f", "#a855f7", "#d8b4fe"],
    vars: {
      bg: "#0c0418", surface: "#150a2a", surface2: "#1f1240", text: "#f2eaff",
      muted: "#a98fc9", border: "#33205c", accent: "#a855f7", accentStrong: "#9333ea",
      torrent: "#d8b4fe", ok: "#4ade80",
      shadow1: "0 1px 2px rgba(0,0,0,.55)", shadow2: "0 12px 36px rgba(168,85,247,.2)",
    },
  },
  {
    id: "glass-smoky-silver",
    name: "Glass Smoky Silver",
    desc: "زجاجي رمادي دخاني شفاف بلمسة فضية",
    dark: true,
    swatch: ["#121417", "#c0c8d4", "#8ab4f8"],
    vars: {
      bg: "#0d0f12", surface: "#16191d", surface2: "#1f242a", text: "#e9edf3",
      muted: "#98a2ae", border: "#2d343d", accent: "#c0c8d4", accentStrong: "#8ab4f8",
      torrent: "#8ab4f8", ok: "#6cc576",
      shadow1: "0 1px 2px rgba(0,0,0,.55)", shadow2: "0 12px 36px rgba(138,180,248,.14)",
    },
  },
  {
    id: "glass-rose-blush",
    name: "Glass Rose Blush",
    desc: "زجاجي وردي فاتح أنيق وناعم (نهاري)",
    dark: false,
    swatch: ["#fdf3f5", "#f43f5e", "#fbcfe8"],
    vars: {
      bg: "#fbf1f3", surface: "#ffffff", surface2: "#f9e8ec", text: "#2b1a20",
      muted: "#8a6b74", border: "#f0dae0", accent: "#f43f5e", accentStrong: "#e11d48",
      torrent: "#ec4899", ok: "#0f8a5f",
      shadow1: "0 1px 2px rgba(70,30,40,.07)", shadow2: "0 12px 32px rgba(244,63,94,.12)",
    },
  },
  {
    id: "glass-amber-ember",
    name: "Glass Amber Ember",
    desc: "زجاجي كهرماني دافئ بوهج جمرات الليل",
    dark: true,
    swatch: ["#1c1103", "#f59e0b", "#fcd34d"],
    vars: {
      bg: "#150d02", surface: "#221604", surface2: "#31210a", text: "#fdf1dc",
      muted: "#c2a280", border: "#4a3312", accent: "#f59e0b", accentStrong: "#d97706",
      torrent: "#fcd34d", ok: "#a3e635",
      shadow1: "0 1px 2px rgba(0,0,0,.55)", shadow2: "0 12px 36px rgba(245,158,11,.18)",
    },
  },
];

export const DEFAULT_THEME_ID = "glass-emerald-cyan";

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
