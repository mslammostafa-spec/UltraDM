// UltraDM — الزر العائم فوق مشغلات الفيديو والصوت مع قائمة الجودات والصيغ.
// يدعم يوتيوب وفيسبوك وإنستغرام وتيك توك وإكس/تويتر وريديت وغيرها،
// يستعلم عن الجودات عبر yt-dlp داخل UltraDM (قناة WebSocket)، ويعرض
// قائمة زجاجية منسدلة تحت الزر، ثم يرسل الجودة المختارة للتحميل فورًا.
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

  // ——— قناة WebSocket مع UltraDM: استعلام الجودات (probe) وبدء التحميل ———
  let ws = null;
  let wsSeq = 0;
  const wsWaiters = new Map();

  function wsSend(msg, timeoutMs) {
    return new Promise((resolve) => {
      const id = "r" + ++wsSeq;
      const wait = { resolve, timer: setTimeout(() => {
        wsWaiters.delete(id);
        resolve(null);
      }, timeoutMs || 20000) };
      wsWaiters.set(id, wait);
      msg.id = id;
      const send = () => ws.send(JSON.stringify(msg));
      if (ws && ws.readyState === 1) send();
      else {
        openWs(() => {
          if (ws && ws.readyState === 1) send();
          else {
            clearTimeout(wait.timer);
            wsWaiters.delete(id);
            resolve(null);
          }
        });
      }
    });
  }

  function openWs(ready) {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) { ready && ready(); return; }
    try { ws = new WebSocket("ws://127.0.0.1:24580/ultradm"); } catch { return; }
    ws.onopen = () => ready && ready();
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && wsWaiters.has(m.id)) {
        const w = wsWaiters.get(m.id);
        clearTimeout(w.timer);
        wsWaiters.delete(m.id);
        w.resolve(m);
      }
    };
    ws.onerror = () => {};
  }

  async function probeFormats(url) {
    const res = await wsSend({ type: "probe", url }, 25000);
    return res && res.type === "formats" ? res : null;
  }

  async function startDownload(url, fmt) {
    const msg = { type: "download", url };
    if (fmt.audioOnly) {
      msg.audio_only = true;
      msg.audio_format = fmt.audioFormat;
    } else if (fmt.id && fmt.id !== "best") {
      msg.format_id = fmt.id;
    }
    // القناة الأساسية: WebSocket المباشر. البديل: رسالة ULTRADM_DOWNLOAD إلى
    // الـService Worker (وهو الذي يعرف حالة الاتصال ويعيد المحاولة بصمت).
    try {
      const res = await wsSend(msg, 15000);
      if (res && res.type === "download-started") return true;
    } catch { /* جرّب القناة البديلة */ }
    try {
      const res = await chrome.runtime.sendMessage({ type: "ULTRADM_DOWNLOAD", ...msg });
      return !!(res && res.ok);
    } catch {
      return false;
    }
  }

  // ——— القائمة الزجاجية المنسدلة ———
  function closeMenus() {
    document.querySelectorAll(".ultradm-menu").forEach((m) => m.remove());
  }
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest || !ev.target.closest(".ultradm-menu, .ultradm-fab")) closeMenus();
  }, true);

  function fmtSize(bytes) {
    if (!bytes) return "";
    const u = ["بايت", "كيلوبايت", "ميغابايت", "غيغابايت"];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return " · " + (i ? n.toFixed(1) : n) + " " + u[i];
  }

  async function directDownload(url, fmt) {
    const data = {
      url,
      quality: fmt.label || fmt.id,
      audio_only: !!fmt.audioOnly,
      format_id: fmt.id
    };
    try {
      const res = await fetch("http://127.0.0.1:24580/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      return res.ok;
    } catch {
      return startDownload(url, fmt);
    }
  }

  function buildMenu(anchor, title, formats, url, btn) {
    closeMenus();
    const menu = document.createElement("div");
    menu.className = "ultradm-menu";
    menu.dir = "rtl";
    menu.style.setProperty("--ultradm-accent", theme.accent);
    menu.style.setProperty("--ultradm-glow", theme.glow);
    const head = document.createElement("div");
    head.className = "ultradm-menu-head";
    head.textContent = title ? "جودات التحميل — " + title : "جودات التحميل";
    menu.appendChild(head);
    formats.forEach((f) => {
      const it = document.createElement("button");
      it.className = "ultradm-menu-item";
      it.type = "button";
      it.innerHTML =
        '<span class="ultradm-menu-q">' + f.label + (f.ext ? " (" + f.ext + ")" : "") + "</span>" +
        (f.size ? '<span class="ultradm-menu-size">' + fmtSize(f.size) + "</span>" : "");
      it.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        it.classList.add("sending");
        it.querySelector(".ultradm-menu-q").textContent = "جارٍ الإرسال…";
        const ok = await directDownload(url, f);
        closeMenus();
        flash(btn, ok ? "بدأ التحميل في UltraDM ✓" : "تعذّر إرسال التحميل");
      });
      menu.appendChild(it);
    });
    document.body.appendChild(menu);
    // ضع القائمة تحت الزر مع قلبها في صفحات RTL (مثل يوتيوب العربي).
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth || 260;
    const mh = menu.offsetHeight || 200;
    let left = r.left + r.width / 2 - mw / 2;
    left = Math.max(8, Math.min(left, innerWidth - mw - 8));
    let top = r.bottom + 6;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  async function openQualityMenu(btn, url) {
    btn.classList.add("loading");
    const cached = await probeFormats(url);
    btn.classList.remove("loading");
    if (!cached || !Array.isArray(cached.formats) || !cached.formats.length) {
      flash(btn, "تعذّر جلب الجودات — افتح UltraDM");
      return;
    }
    buildMenu(btn, cached.title, cached.formats, url, btn);
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
      if (!url) { flash(btn, "لا يوجد فيديو في هذه الصفحة"); return; }
      openQualityMenu(btn, url);
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

  // ——— كبسولة يوتيوب الزجاجية (الزاوية العلوية اليسرى للمشغل) ———
  const YT_QUALITIES = [
    { label: "فيديو 1080p (Full HD - MP4)", id: "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=1080]" },
    { label: "فيديو 720p (HD - MP4)", id: "bestvideo[height<=720][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=720]" },
    { label: "فيديو 480p (SD - MP4)", id: "bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=480]" },
    { label: "فيديو 360p (MP4)", id: "bestvideo[height<=360][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=360]" },
    { label: "صوت فقط (MP3 / M4A)", audioOnly: true, audioFormat: "mp3" },
  ];

  function ytPageUrl() {
    const m = location.href.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/)|youtu\.be\/)([\w-]{11})/i);
    return m ? "https://www.youtube.com/watch?v=" + m[1] : null;
  }

  function ytCapsule(player) {
    if (!player || document.querySelector(".ultradm-yt-capsule")) return;
    const url = ytPageUrl();
    if (!url) return;
    const cap = document.createElement("button");
    cap.type = "button";
    cap.className = "ultradm-fab ultradm-yt-capsule";
    // مثبّتة على documentElement (لا داخل المشغل) حتى لا تختفي عند إعادة
    // بناء شجرة المشغل، وموضعها ديناميكي أسفل يمين المشغل بحجم مضغوط.
    cap.style.cssText =
      "position:fixed;z-index:2147483646;top:auto;left:auto;right:auto;bottom:auto;";
    cap.dir = "rtl";
    hydrate(cap);
    cap.innerHTML =
      HEX_SVG +
      '<span class="ultradm-fab-label" style="font-size:12px;padding:0 2px">تحميل ▾</span>';
    cap.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const formats = YT_QUALITIES.map((q) => ({
        label: q.label,
        id: q.id,
        audioOnly: q.audioOnly,
        audioFormat: q.audioFormat,
        ext: q.audioOnly ? "mp3" : "mp4"
      }));
      buildMenu(cap, "UltraDM", formats, url, cap);
    });
    document.documentElement.appendChild(cap);
    // موضع ديناميكي: داخل حدود المشغل الحالية، الزاوية العلوية اليسرى.
    const place = () => {
      // أخفِها في التبويبات غير المرئية أو حين يكون المشغل صغيرًا جدًا.
      if (document.hidden || document.visibilityState === "hidden") {
        cap.style.display = "none";
        return;
      }
      const r = player.getBoundingClientRect();
      if (r.width < 80 || r.bottom < 0 || r.top > innerHeight) {
        cap.style.display = "none";
        return;
      }
      cap.style.display = "";
      cap.style.left = Math.max(8, Math.min(r.left + 12, innerWidth - 140)) + "px";
      cap.style.top = Math.max(8, r.top + 12) + "px";
    };
    place();
    addEventListener("resize", place, { passive: true });
    addEventListener("scroll", place, { passive: true, capture: true });
    document.addEventListener("visibilitychange", place, { passive: true });
    // تحديث الموضع مع تغيّر حجم المشغل (ملء الشاشة، تكبير/تصغير) وتنقل يوتيوب.
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(place).observe(player);
    }
    document.addEventListener("yt-navigate-finish", place, { passive: true });
  }

  const attachYt = () => {
    const yt = document.querySelector("#movie_player, ytd-player, .html5-video-player");
    if (yt) ytCapsule(yt);
  };
  const prevAttach = attach;
  attach = function () { prevAttach(); attachYt(); };

  const mo = new MutationObserver(() => attach());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  attach();
  setInterval(attach, 3000); // المشغلات الديناميكية (SPA)
})();
