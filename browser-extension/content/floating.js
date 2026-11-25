// UltraDM — الزر العائم فوق مشغلات الفيديو والصوت.
// يدعم يوتيوب وفيسبوك وإنستغرام وتيك توك وإكس/تويتر وريديت وغيرها،
// ويستخدم ألوان الثيم المختار في UltraDM (يتزامن عبر قناة WebSocket).
(function () {
  "use strict";
  const S = self.UltraDMShared;
  if (window.__ultradm_floating) return;
  window.__ultradm_floating = true;

  let theme = { accent: "#34d399", glow: "#22d3ee" };
  let lastLabel = "تحميل عبر UltraDM";

  chrome.storage.local.get(["theme"], (s) => {
    if (s.theme && s.theme.accent) theme = s.theme;
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === "ultradm://theme" && m.theme) theme = m.theme;
    if (m.type === "ultradm://status") {
      lastLabel = m.status === "online" ? "تحميل عبر UltraDM" : "UltraDM غير متصل";
      document.querySelectorAll(".ultradm-fab").forEach(hydrate);
    }
  });

  const HEX_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">' +
    '<defs><linearGradient id="ultradm-hex" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#22d3ee"/></linearGradient></defs>' +
    '<path d="M12 2l8.66 5v10L12 22l-8.66-5V7z" stroke="url(#ultradm-hex)" stroke-width="1.8"/>' +
    '<path d="M12 7v7m-3-4 3 3 3-3" stroke="url(#ultradm-hex)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const MEDIA_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|facebook\.com|fb\.watch|instagram\.com|tiktok\.com|twitter\.com|x\.com|reddit\.com|vimeo\.com|dailymotion\.com|twitch\.tv)$/i;

  function hydrate(btn) {
    btn.style.setProperty("--ultradm-accent", theme.accent);
    btn.style.setProperty("--ultradm-glow", theme.glow);
    const label = btn.querySelector(".ultradm-fab-label");
    if (label) label.textContent = lastLabel;
    btn.title = lastLabel;
    btn.setAttribute("aria-label", lastLabel);
  }

  function openInUltraDM(url, pageUrl, btn) {
    chrome.runtime.sendMessage({
      type: "capture",
      kind: "media",
      url,
      pageUrl: pageUrl || location.href,
      userAgent: navigator.userAgent,
      source: "floating-button",
    }).catch(() => {});
    flash(btn, "جارٍ الإرسال…");
  }

  function flash(btn, text) {
    const label = btn.querySelector(".ultradm-fab-label");
    const old = label ? label.textContent : btn.title;
    if (label) label.textContent = text;
    btn.title = text;
    btn.setAttribute("data-visible", "");
    setTimeout(() => {
      if (label) label.textContent = old;
      btn.title = old;
      btn.removeAttribute("data-visible");
    }, 1800);
  }

  // يبحث عن أقرب مشغل وسائط لنقطة تركيز في الصفحة.
  function currentMediaUrl(container) {
    const v = container.querySelector("video, audio");
    if (v && (v.currentSrc || v.src)) return v.currentSrc || v.src;
    // يوتيوب: استخرج معرّف الفيديو من الرابط وأرسله كطلب جودات.
    const m = location.href.match(
      /(?:youtube\.com\/(?:watch\?.*v=|shorts\/)|youtu\.be\/)([\w-]{11})/i,
    );
    if (m && location.hostname.includes("youtube")) return "https://www.youtube.com/watch?v=" + m[1];
    // تيك توك / إنستغرام / إكس: أرسل رابط الصفحة ليحللها yt-dlp في UltraDM.
    if (MEDIA_HOSTS.test(location.hostname)) return location.href;
    return null;
  }

  function buttonFor(container) {
    if (container.querySelector(":scope > .ultradm-fab")) return null;
    const btn = document.createElement("button");
    btn.className = "ultradm-fab";
    hydrate(btn);
    btn.innerHTML = HEX_SVG + '<span class="ultradm-fab-label"></span>';
    hydrate(btn);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const url = currentMediaUrl(container);
      if (url) openInUltraDM(url, pageUrl, btn);
    });
    return btn;
  }

  // حاويات المشغلات المعروفة + أي عنصر video/audio عام.
  function attach() {
    // 1) عناصر وسائط عامة
    document.querySelectorAll("video, audio").forEach((el) => {
      if (!el.parentElement) return;
      const btn = buttonFor(el.parentElement);
      if (btn) el.parentElement.appendChild(btn);
    });
    // 2) حاويات يوتيوب
    const yt = document.querySelector("ytd-player, #movie_player, .html5-video-player");
    if (yt) {
      const btn = buttonFor(yt);
      if (btn) yt.appendChild(btn);
    }
    // 3) حاويات المنصات الأخرى (مؤشر على أقرب عنصر وسائط)
    document
      .querySelectorAll(
        '[data-testid="video-player"], [class*="player"], [class*="Player"]',
      )
      .forEach((c) => {
        if (!c.querySelector("video, audio")) return;
        if (c.querySelector(":scope > .ultradm-fab")) return;
        const btn = buttonFor(c);
        if (btn) c.appendChild(btn);
      });
  }

  const mo = new MutationObserver(() => attach());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  attach();
  setInterval(attach, 3000); // المشغلات الديناميكية (SPA)
})();
