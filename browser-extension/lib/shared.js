// UltraDM — أدوات مشتركة (كلاسيكية تعمل في الـService Worker وسكربتات الصفحات).
// تُعرَّض ككائن عام self.UltraDMShared.
(function () {
  "use strict";

  const shared = {
    WS_URL: "ws://127.0.0.1:24580/ultradm",
    NATIVE_HOST: "com.ultradm.bridge",

    // ثيمات UltraDM: نفس معرّفات src/lib/themes.ts — يستخدمها الزر العائم.
    THEME_ACCENTS: {
      "cyber-glass-blue": { accent: "#3b82f6", glow: "#8b5cf6" },
      "obsidian-gold-crimson": { accent: "#d4af37", glow: "#dc2643" },
      "emerald-luxury": { accent: "#10b981", glow: "#d4af37" },
      "pure-frost-light": { accent: "#0284c7", glow: "#22d3ee" },
      "neon-cyberpunk": { accent: "#e935ff", glow: "#22d3ee" },
      "arctic-nord": { accent: "#88c0d0", glow: "#5e81ac" },
      "sunset-synthwave": { accent: "#fb7185", glow: "#fbbf24" },
      "midnight-royal": { accent: "#818cf8", glow: "#c0caf5" },
      "matrix-hacker": { accent: "#22ff88", glow: "#00ff41" },
      "minimalist-graphite": { accent: "#64748b", glow: "#94a3b8" },
    },

    FILE_EXT_RE:
      /\.(exe|msi|zip|rar|7z|tar|gz|xz|bz2|iso|dmg|apk|mp4|mkv|avi|webm|mov|flv|wmv|3gp|m4v|mp3|flac|wav|aac|ogg|oga|m4a|wma|opus|aiff|alac|ac3|dts|amr|pdf|doc|docx|xls|xlsx|ppt|pptx|epub|torrent)([?#]|$)/i,

    STREAM_URL_RE: /\.(m3u8|mpd|mp4|webm|mp3|aac|m4a)([?#]|$)/i,
    STREAM_QUERY_RE:
      /(m3u8|mpd|\.mp4|\.webm|\.mp3|\.aac|type=video|type=audio|mime=video|mime=audio)/i,

    isMagnet(u) {
      return typeof u === "string" && u.toLowerCase().startsWith("magnet:?");
    },
    isTorrentFile(u) {
      return typeof u === "string" && /\.torrent([?#]|$)/i.test(u);
    },
    isTorrentish(u) {
      return shared.isMagnet(u) || shared.isTorrentFile(u);
    },
    isDirectDownload(u) {
      if (!u || !/^https?:/i.test(u)) return false;
      return shared.FILE_EXT_RE.test(u);
    },
    isStreamMedia(u) {
      if (!u || !/^https?:/i.test(u)) return false;
      return shared.STREAM_URL_RE.test(u) || shared.STREAM_QUERY_RE.test(u);
    },
    fileNameFromUrl(u) {
      try {
        const p = new URL(u).pathname.split("/").filter(Boolean);
        return decodeURIComponent(p[p.length - 1] || "download");
      } catch {
        return "download";
      }
    },
  };

  self.UltraDMShared = shared;
})();
