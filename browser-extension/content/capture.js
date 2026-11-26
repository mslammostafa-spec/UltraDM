// UltraDM — الالتقاط داخل الصفحة (بدءًا من v1.1.4: بلا أي اعتراض تلقائي).
// الإرسال التلقائي محظور تمامًا؛ الوحيد الملتقط عند النقر هو روابط
// Magnet و.torrent (نية تحميل صريحة). يوتيوب يُرسل رابط الصفحة الحقيقي دائمًا.
(function () {
  "use strict";
  const S = self.UltraDMShared;
  if (window.__ultradm_capture) return;
  window.__ultradm_capture = true;

  const seen = new Set();
  const foundMedia = new Map(); // url -> {url, kind} (للعرض في البوب-أب فقط)

  function send(kind, url) {
    if (!url || typeof url !== "string") return;
    url = url.trim();
    // حظر نهائي: blob:/mediastream:/data: وملفات النظام الخلفية.
    if (S.isBlockedUrl(url)) return;
    // يوتيوب: أرسل رابط صفحة الفيديو الحقيقي بدلًا من أي مصدر داخلي.
    const yt = youtubeUrl();
    if (yt) url = yt;
    if (seen.has(url)) return;
    seen.add(url);
    if (seen.size > 500) seen.delete(seen.values().next().value);
    chrome.runtime.sendMessage({
      type: "capture",
      kind,
      url,
      pageUrl: location.href,
      userAgent: navigator.userAgent,
      source: "content",
    }).catch(() => {});
  }

  // رابط صفحة فيديو يوتيوب الحقيقي إن كانت الصفحة يوتيوب.
  function youtubeUrl() {
    const m = location.href.match(
      /(?:youtube\.com\/(?:watch\?.*?v=|shorts\/)|youtu\.be\/)([\w-]{11})/i,
    );
    if (!m) return null;
    return "https://www.youtube.com/watch?v=" + m[1];
  }

  // ==== الالتقاط الوحيد: نقر صريح على Magnet / .torrent ====
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target && ev.target.closest && ev.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (S.isTorrentish(href)) {
        ev.preventDefault();
        send("torrent", href);
      }
    },
    true,
  );

  // ==== تسجيل الوسائط الحية للبوب-أب فقط (بلا أي إرسال) ====
  function registerMedia(root) {
    (root || document).querySelectorAll("video, audio, source").forEach((el) => {
      const src = el.currentSrc || el.src;
      if (!src || S.isBlockedUrl(src)) return;
      foundMedia.set(src, { url: src, kind: "media" });
    });
  }

  new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes && m.addedNodes.forEach((n) => {
        if (n.nodeType === 1) registerMedia(n.parentElement);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  registerMedia(document);

  // ==== استجابة للبوب-أب: قائمة الوسائط المكتشفة في هذا التبويب ====
  chrome.runtime.onMessage.addListener((m, _s, respond) => {
    if (m && m.type === "ultradm://list-media") {
      respond({ media: [...foundMedia.values()] });
    }
    return false;
  });

  // للبوب-أب والزر العائم: إرسال صريح عند طلب المستخدم.
  window.__ultradm_send = send;
  window.__ultradm_youtube_url = youtubeUrl;
})();
