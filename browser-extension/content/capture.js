// UltraDM — صائد الروابط ومراقب الشبكة داخل الصفحة.
// يلتقط: روابط التحميل المباشر، Magnet/.torrent، وأي بث فيديو/صوت
// (MP4, WebM, M3U8, MPD, MP3, AAC) حتى داخل المشغلات المخفية.
(function () {
  "use strict";
  const S = self.UltraDMShared;
  if (window.__ultradm_capture) return;
  window.__ultradm_capture = true;

  const seen = new Set();
  const foundMedia = new Map(); // url -> {url, kind, size}

  let send = function (kind, url) {
    if (seen.has(url)) return;
    seen.add(url);
    // حد أقصى للذاكرة
    if (seen.size > 500) seen.delete(seen.values().next().value);
    chrome.runtime.sendMessage({
      type: "capture",
      kind,
      url,
      pageUrl: location.href,
      userAgent: navigator.userAgent,
      source: "content",
    }).catch(() => {});
  };

  function inspectUrl(rawUrl, source) {
    if (!rawUrl || typeof rawUrl !== "string") return;
    const url = rawUrl.trim();
    if (S.isTorrentish(url)) send("torrent", url);
    else if (S.isStreamMedia(url)) send("stream", url);
    else if (S.isDirectDownload(url)) send("direct", url);
  }

  // ==== 1) مراقب حركة الشبكة (PerformanceObserver) — يرى البث المخفي ====
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) inspectUrl(e.name, "network");
    });
    obs.observe({ type: "resource", buffered: true });
  } catch { /* متصفح قديم */ }

  // ==== 2) webRequest في الخلفية لا يرى الأجسام؛ هنا نتتبع الوسائط الحية ====
  function scanMediaElements(root) {
    const els = (root || document).querySelectorAll(
      "video, audio, source, track",
    );
    els.forEach((el) => {
      if (el.src) inspectUrl(el.src, "element");
      if (el.currentSrc) inspectUrl(el.currentSrc, "element");
    });
  }

  // ==== 3) اعتراض XHR/fetch المشفّرة في المشغلات ====
  try {
    const rawOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (typeof url === "string") inspectUrl(url, "xhr");
      return rawOpen.call(this, method, url, ...rest);
    };
    const rawFetch = window.fetch;
    if (rawFetch) {
      window.fetch = function (input, init) {
        try {
          if (typeof input === "string") inspectUrl(input, "fetch");
          else if (input && input.url) inspectUrl(input.url, "fetch");
        } catch { /* تجاهل */ }
        return rawFetch.call(this, input, init);
      };
    }
  } catch { /* صفحات محمية (يوتيوب تُراعي isolated world) */ }

  // ==== 4) النقر على روابط Magnet/.torrent والروابط المباشرة ====
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target && ev.target.closest && ev.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (S.isTorrentish(href)) {
        ev.preventDefault();
        send("torrent", href);
      } else if (S.isDirectDownload(href)) {
        send("direct", href);
      }
    },
    true,
  );

  // ==== 5) قائمة السياق عبر مراقبة النقر بزر الفأرة الأيمن على الوسائط ====
  document.addEventListener(
    "mousedown",
    (ev) => {
      const t = ev.target;
      if (t && (t.tagName === "VIDEO" || t.tagName === "AUDIO") && t.currentSrc) {
        send("media", t.currentSrc);
      }
    },
    true,
  );

  // ==== 6) مسح دوري خفيف لعناصر الوسائط الجديدة ====
  new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes && m.addedNodes.forEach((n) => {
        if (n.nodeType === 1) {
          if (/^(VIDEO|AUDIO|SOURCE)$/.test(n.tagName)) scanMediaElements(n.parentElement);
          else if (n.querySelectorAll) scanMediaElements(n);
        }
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  scanMediaElements(document);

  // ==== استجابة للبوب-أب: قائمة الوسائط المكتشفة في هذا التبويب ====
  chrome.runtime.onMessage.addListener((m, _s, respond) => {
    if (m && m.type === "ultradm://list-media") {
      respond({ media: [...foundMedia.values()] });
    }
    return false;
  });

  // تسجيل الوسائط في خريطة العرض
  const origSend = send;
  send = function (kind, url) {
    if (kind === "stream" || kind === "media") foundMedia.set(url, { url, kind });
    origSend(kind, url);
  };
})();
