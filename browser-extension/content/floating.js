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

  // ——— قناة واحدة مع UltraDM: رسائل إلى Service Worker (وهو مالك قناة
  // WebSocket) — لا اتصال مباشر من صفحة الصورة الإضافية (المحتوى) ———

  async function probeFormats(url) {
    try {
      const res = await chrome.runtime.sendMessage({ type: "ULTRADM_PROBE", url });
      return res && res.ok ? res : { ok: false, code: res && res.code, message: res && res.message };
    } catch {
      return { ok: false, code: "app-offline", message: "تعذّر الاتصال ببرنامج UltraDM — افتحه وتأكد من تشغيله" };
    }
  }

  async function startDownload(url, fmt) {
    const msg = { type: "download", url };
    if (fmt.audioOnly) {
      msg.audio_only = true;
      msg.audio_format = fmt.audioFormat;
    } else if (fmt.id && fmt.id !== "best") {
      msg.format_id = fmt.id;
    }
    // القناة الأساسية: WebSocket عبر الـService Worker.
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
  // Native Messaging أولًا عبر Service Worker (لا يحجبه بريف)، ثم WebSocket، ثم POST /add.
  if (await startDownload(url, fmt)) return true;
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
      return false;
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
      it.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        it.classList.add("sending");
        it.querySelector(".ultradm-menu-q").textContent = "جارٍ الإرسال…";
        const ok = await directDownload(url, f);
        closeMenus();
        flash(btn, ok ? "بدأ التحميل في UltraDM ✓" : "تعذّر إرسال التحميل");
      });
      // نصوص الجودات تأتي من yt-dlp (عناوين غير مُهرَّبة): textContent فقط
      // — innerHTML هنا يعني إمكانية حقن HTML في سياق سكربت المحتوى.
      const q = document.createElement("span");
      q.className = "ultradm-menu-q";
      q.textContent = f.label + (f.ext ? " (" + f.ext + ")" : "");
      it.appendChild(q);
      if (f.size) {
        const sz = document.createElement("span");
        sz.className = "ultradm-menu-size";
        sz.textContent = fmtSize(f.size);
        it.appendChild(sz);
      }
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
    if (!cached || !cached.ok || !Array.isArray(cached.formats) || !cached.formats.length) {
      // رسالة صادقة: نعرف الفرق بين "البرنامج مغلق" و"yt-dlp فشل على هذا الرابط".
      flash(btn, (cached && cached.message) || "تعذّر جلب الجودات — افتح UltraDM");
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
    const raw = v && (v.currentSrc || v.src);
    // تجاهل الروابط المؤقتة blob:/mediastream: — على يوتيوب تكون دائمًا قيمة
    // الوسيط فكانت تُعاد قبل الوصول لمنطق استخراج رابط الفيديو الحقيقي
    // ويفشل yt-dlp ("تعذّر جلب الجودات"). كبسولة يوتيوب تستخدم رابط الصفحة
    // فتعمل — هذا هو الفرق بين الزرين.
    if (raw && !/^(blob:|mediastream:|data:)/i.test(raw)) return raw;
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
      void openQualityMenu(btn, url);
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
      "position:fixed !important;z-index:2147483647 !important;pointer-events:auto !important;top:auto;left:auto;right:auto;bottom:auto;";
    cap.dir = "rtl";
    hydrate(cap);
    cap.innerHTML =
      HEX_SVG +
      '<span class="ultradm-fab-label" style="font-size:12px;padding:0 2px">تحميل ▾</span>';
    cap.setAttribute("data-visible", ""); // الكبسولة مرئية دائمًا (الصنف الأساسي يبدأ بـ opacity:0)
    cap.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // جلب الجودات فورًا وعرض القائمة المنسدلة فوق الفيديو — بحالة فورية
      // على الكبسولة نفسها («جارٍ جلب الجودات…») قبل وصول الرد.
      const label = cap.querySelector(".ultradm-fab-label");
      const setLabel = (t) => { if (label) label.textContent = t; };
      setLabel("جارٍ جلب الجودات…");
      cap.classList.add("loading");
      const url = ytPageUrl() || location.href;
      const res = await probeFormats(url);
      cap.classList.remove("loading");
      if (res && res.ok && Array.isArray(res.formats) && res.formats.length) {
        setLabel("تحميل ▾");
        buildMenu(cap, res.title, res.formats, url, cap);
        return;
      }
      // فشل الجلب: اشرح السبب ثم أرسل الرابط إلى UltraDM كخطة بديلة.
      setLabel((res && res.message) || "تعذّر جلب الجودات");
      setTimeout(() => setLabel("جارٍ الإرسال لـ UltraDM…"), 1800);
      try {
        await chrome.runtime.sendMessage({ type: "ULTRADM_DOWNLOAD", url, title: document.title });
        setLabel("تم الإرسال لـ UltraDM ✓");
      } catch {
        setLabel("افتح UltraDM أولاً");
      }
      setTimeout(() => setLabel("تحميل ▾"), 2500);
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

  // ——— حلقة ربط خفيفة ———
  // MutationObserver على شجرة يوتيوب الكاملة يطلق مئات المرات في الدقيقة
  // (يوتيوب يغيّر DOM باستمرار) وكل استدعاء يمسح الصفحة كلها — debounce
  // يقلّص العمل إلى فحص واحد كل 500 مهلة على الأكثر.
  let attachTimer = null;
  function scheduleAttach() {
    if (attachTimer) return;
    attachTimer = setTimeout(() => {
      attachTimer = null;
      attach();
    }, 500);
  }
  const mo = new MutationObserver(scheduleAttach);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  attach();
  setInterval(attach, 3000); // المشغلات الديناميكية (SPA)
})();
