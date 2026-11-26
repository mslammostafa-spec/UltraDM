// UltraDM — Service Worker: يحافظ على قناة فائقة السرعة مع برنامج UltraDM
// (WebSocket محلي أولًا، وNative Messaging كبديل) ويرسل الروابط المُلتقطة
// مع الـCookies والـUser-Agent.

importScripts("lib/shared.js");

const S = self.UltraDMShared;
const RECONNECT_MS = 1500;
const DEDUPE_TTL_MS = 10_000;
const sent = new Map(); // url -> ts

let ws = null;
let wsReady = false;
let reconnectTimer = null;
let nativeFallback = false;
let status = "connecting"; // connecting | online | offline
let theme = { id: "glass-emerald-cyan", accent: "#34d399", glow: "#22d3ee" };
let enabled = true;

function setStatus(s) {
  status = s;
  broadcast({ type: "ultradm://status", status: s, theme });
  updateBadge();
}

function updateBadge() {
  const text = enabled && status === "online" ? "" : (enabled ? "!" : "–");
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({
    color: enabled ? "#d97706" : "#6b7280",
  });
}

function broadcast(msg) {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (t.url && /^https?:/i.test(t.url)) {
        chrome.tabs.sendMessage(t.id, msg).catch(() => {});
      }
    }
  });
}

function dedupe(url) {
  const now = Date.now();
  for (const [u, ts] of sent) if (now - ts > DEDUPE_TTL_MS) sent.delete(u);
  if (sent.has(url)) return false;
  sent.set(url, now);
  return true;
}

function deliver(payload) {
  // الأولوية لقناة WebSocket (سرعة فائقة)، وNative Messaging بديل عند غيابها.
  // ملاحظة: ws.send() تُعيد undefined دائمًا؛ النجاح هو وجود القناة في حالة OPEN.
  if (wsReady && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      // القناة انقطعت للتو — جرّب القناة البديلة.
    }
  }
  return sendNative(payload);
}

function sendNative(payload) {
  try {
    chrome.runtime.sendNativeMessage(
      S.NATIVE_HOST,
      payload,
      (reply) => {
        if (chrome.runtime.lastError) {
          nativeFallback = false;
          return;
        }
        nativeFallback = true;
        if (reply && reply.type === "theme") applyTheme(reply);
      },
    );
    return nativeFallback;
  } catch {
    return false;
  }
}

function applyTheme(t) {
  if (!t || !t.id) return;
  const acc = S.THEME_ACCENTS[t.id] || S.THEME_ACCENTS["glass-emerald-cyan"];
  theme = {
    id: t.id,
    accent: acc.accent,
    glow: acc.glow,
  };
  chrome.storage.local.set({ theme });
  broadcast({ type: "ultradm://theme", theme });
}

// ==== قناة WebSocket ====

async function connectWs() {
  if (!enabled) return;
  // أغلق أي اتصال سابق أولًا لمنع تداخل الاتصالات.
  if (ws) {
    try { ws.onclose = null; ws.close(); } catch { /* قد يكون مغلقاً بالفعل */ }
    ws = null;
  }
  // فحص صامت عبر /health قبل فتح الـWebSocket حتى لا يُسجّل المتصفح
  // أخطاء "WebSocket connection failed" عندما يكون البرنامج مغلقاً.
  let appUp = false;
  try {
    const r = await fetch(S.HTTP_URL + "/health", { cache: "no-store" });
    appUp = r.ok;
  } catch {
    appUp = false; // البرنامج مغلق — لا محاولة اتصال ولا ضجيج في السجل.
  }
  if (!appUp) {
    setStatus("offline");
    scheduleReconnect();
    return;
  }
  let socket;
  try {
    socket = new WebSocket(S.WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;
  socket.onopen = () => {
    wsReady = true;
    setStatus("online");
    // اطلب الثيم الحالي من البرنامج ومرّر الإعدادات (فقط عندما تكون القناة OPEN فعلًا).
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "hello", extension: "ultradm", version: "1.1.5" }));
    }
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "theme") {
        // Service Worker بلا DOM: لا تُطبّق الثيم هنا — احفظه في
        // chrome.storage.local ومرّره للتبويبات بأمان.
        const acc = S.THEME_ACCENTS[msg.id] || S.THEME_ACCENTS["glass-emerald-cyan"];
        theme = { id: msg.id, accent: acc.accent, glow: acc.glow };
        chrome.storage.local.set({ ultradmTheme: msg });
        broadcast({ type: "ultradm://theme", theme });
      }
      if (msg.type === "pong") return;
      if (msg.type === "captured" && msg.url) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "UltraDM",
          message: "بدأ التحميل: " + msg.url.slice(0, 80),
        });
      }
    } catch {
      /* رسائل غير صالحة تُتجاهل */
    }
  };
  ws.onclose = () => {
    wsReady = false;
    setStatus("offline");
    scheduleReconnect();
  };
  ws.onerror = () => {
    try { ws.close(); } catch { /* مُعالجة في onclose */ }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, RECONNECT_MS);
}

// ==== الالتقاط من سكربتات المحتوى ====

function cookiesFor(url) {
  return new Promise((resolve) => {
    if (S.isMagnet(url)) return resolve([]);
    try {
      const u = new URL(url);
      chrome.cookies.getAll({ url: u.origin }, (c) => resolve(c || []));
    } catch {
      resolve([]);
    }
  });
}

async function handleCapture(m) {
  if (!enabled) return { ok: false, reason: "disabled" };
  const url = m.url;
  if (!url || !dedupe(url)) return { ok: false, reason: "duplicate" };
  // حظر نهائي: blob:/mediastream:/data: وملفات النظام الخلفية (.webmanifest/.json/...).
  if (S.isBlockedUrl(url)) return { ok: false, reason: "blocked-url" };

  const payload = {
    type: "capture",
    kind: m.kind, // direct | torrent | media | stream
    url,
    pageUrl: m.pageUrl || "",
    fileName: m.fileName || S.fileNameFromUrl(url),
    userAgent: m.userAgent || "",
    referer: m.pageUrl || "",
    cookies: await cookiesFor(url),
    source: m.source || "content",
  };

  // Magnet يمر عبر Native Messaging دائمًا (لا يمكن إرساله عبر HTTP).
  const ok = payload.kind === "torrent" ? sendNative(payload) || deliver(payload) : deliver(payload);
  return { ok: Boolean(ok), transport: ok ? (wsReady ? "ws" : "native") : "none" };
}

chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
  if (m.type === "capture") {
    handleCapture(m).then(sendResponse);
    return true; // استجابة غير متزامنة
  }
  if (m.type === "ultradm://get-state") {
    sendResponse({ status, theme, enabled });
    return false;
  }
  if (m.type === "ultradm://set-enabled") {
    enabled = !!m.enabled;
    chrome.storage.local.set({ enabled });
    updateBadge();
    if (enabled) { setStatus("connecting"); connectWs(); }
    else { setStatus("offline"); try { ws && ws.close(); } catch {} }
    sendResponse({ ok: true });
    return false;
  }
  if (m.type === "ultradm://probe-url") {
    // من البوب-أب: احصل على وسائط التبويب الحالي من السكربتات ثم أرسلها.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs[0];
      if (t) chrome.tabs.sendMessage(t.id, { type: "ultradm://list-media" }, (r) => {
        sendResponse(r || { media: [] });
      });
    });
    return true;
  }
  return false;
});

chrome.storage.local.get(["theme", "enabled"], (s) => {
  if (s.theme) theme = s.theme;
  if (typeof s.enabled === "boolean") enabled = s.enabled;
  updateBadge();
  connectWs();
});

// إنذار كل 25 ثانية يُبقي الـService Worker حياً ويعيد المحاولة بهدوء
// (الفحص عبر /health صامت تماماً حين يكون البرنامج مغلقاً).
chrome.alarms.create("ultradm-keepalive", { periodInMinutes: 25 / 60 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "ultradm-keepalive" && enabled && (!ws || ws.readyState !== WebSocket.OPEN)) {
    connectWs();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  connectWs();
  // قائمة النقر الأيمن: "تحميل عبر UltraDM" على أي رابط أو مشغل وسائط.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "ultradm-download",
      title: "تحميل عبر UltraDM",
      contexts: ["link", "video", "audio"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, _tab) => {
  const url = info.linkUrl || info.srcUrl || info.frameUrl || info.pageUrl;
  if (!url) return;
  handleCapture({
    type: "capture",
    kind: url.toLowerCase().startsWith("magnet:") ? "torrent" : "direct",
    url,
    pageUrl: info.pageUrl || url,
    userAgent: "",
    source: "context-menu",
  }).catch(() => {});
});

// ==== الالتقاط التلقائي الوحيد: تنزيل حقيقي بدأه المستخدم في المتصفح ====
// (chrome.downloads.onCreated) — بلا أي webRequest/fetch/XHR interception.
const DOWNLOAD_EXT_RE =
  /\.(zip|rar|7z|tar|gz|xz|bz2|iso|img|exe|msi|dmg|apk|pdf|mp4|mkv|avi|webm|mov|mp3|m4a|flac|wav|aac|ogg|opus|torrent|nzb|docx?|xlsx?|pptx?|epub)([?#]|$)/i;

// أنواع MIME الدالة على ملف تحميل حقيقي.
const DOWNLOAD_MIME_RE =
  /^(application\/(x-bittorrent|octet-stream|zip|x-7z-compressed|x-rar-compressed|pdf|vnd\.android\.package-archive)|video\/|audio\/)/i;

chrome.downloads.onCreated.addListener((item) => {
  if (!enabled || !item || !item.url) return;
  const url = item.url.trim();
  // حظر قاطع فقط: بروتوكولات داخلية وملفات نظام/صفحات (حسب المواصفة).
  if (S.isBlockedUrl(url)) return;
  if (!/^(https?|magnet):/i.test(url)) return;
  const mime = item.mime || "";
  const byExt = DOWNLOAD_EXT_RE.test(url);
  const byMime = DOWNLOAD_MIME_RE.test(mime);
  if (!byExt && !byMime && !url.toLowerCase().startsWith("magnet:")) return;
  // الحجم غير المعروف (-1) يظهر غالبًا في البث — اقبله إن كان بالامتداد المسموح.
  handleCapture({
    type: "capture",
    kind: "direct",
    url,
    pageUrl: item.referrer && /^https?:/i.test(item.referrer) ? item.referrer : item.url,
    userAgent: "",
    source: "downloads-api",
  }).catch(() => {});
});
