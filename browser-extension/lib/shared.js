// UltraDM — أدوات مشتركة (كلاسيكية تعمل في الـService Worker وسكربتات الصفحات).
// تُعرَّض ككائن عام self.UltraDMShared.
(function () {
  "use strict";

  const shared = {
    WS_URL: "ws://127.0.0.1:24580/ultradm",
    NATIVE_HOST: "com.ultradm.bridge",

    // ثيمات UltraDM: نفس معرّفات src/lib/themes.ts — يستخدمها الزر العائم.
    THEME_ACCENTS: {
      "glass-emerald-cyan": { accent: "#34d399", glow: "#22d3ee" },
      "glass-teal-lagoon": { accent: "#2dd4bf", glow: "#67e8f9" },
      "glass-violet-crystal": { accent: "#a855f7", glow: "#d8b4fe" },
      "glass-smoky-silver": { accent: "#c0c8d4", glow: "#8ab4f8" },
      "glass-rose-blush": { accent: "#f43f5e", glow: "#fbcfe8" },
      "glass-amber-ember": { accent: "#f59e0b", glow: "#fcd34d" },
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
