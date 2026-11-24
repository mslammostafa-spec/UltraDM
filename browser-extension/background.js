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
let theme = { id: "cyber-glass-blue", accent: "#3b82f6", glow: "#8b5cf6" };
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
  if (wsReady && ws && ws.send(JSON.stringify(payload))) return true;
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
  const acc = S.THEME_ACCENTS[t.id] || S.THEME_ACCENTS["cyber-glass-blue"];
  theme = {
    id: t.id,
    accent: acc.accent,
    glow: acc.glow,
  };
  chrome.storage.local.set({ theme });
  broadcast({ type: "ultradm://theme", theme });
}

function connectWs() {
  if (!enabled) return;
  try {
    ws = new WebSocket(S.WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    wsReady = true;
    setStatus("online");
    ws.send(JSON.stringify({ type: "hello", extension: "ultradm", version: "1.0.0" }));
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "theme") applyTheme(msg);
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
      /* تجاهل */
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

function cookiesFor(url) {
  return new Promise((resolve) => {
    if (isMagnet(url)) return resolve([]);
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

  const payload = {
    type: "capture",
    kind: m.kind || (isTorrentish(url) ? "torrent" : isStreamMedia(url) ? "stream" : isDirectDownload(url) ? "direct" : "media"),
    url,
    pageUrl: m.pageUrl || "",
    fileName: m.fileName || fileNameFromUrl(url),
    userAgent: await getUserAgent(),
    cookies: await cookiesFor(url),
  };
  const ok = deliver(payload);
  if (ok) chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "UltraDM",
    message: "أُرسل الرابط إلى البرنامج: " + url.slice(0, 80),
  });
  return { ok };
}

async function getUserAgent() {
  try {
    const info = await chrome.runtime.getPlatformInfo();
    return navigator.userAgent + " (" + info.os + ")";
  } catch {
    return navigator.userAgent;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "capture") {
    handleCapture(msg).then(sendResponse);
    return true;
  }
  if (msg?.type === "ultradm://get-state") {
    sendResponse({ status, enabled, theme });
    return;
  }
  if (msg?.type === "ultradm://set-enabled") {
    enabled = msg.enabled;
    chrome.storage.local.set({ enabled });
    updateBadge();
    if (enabled) connectWs();
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === "ultradm://probe-url") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return sendResponse({ media: [] });
      try {
        const r = await chrome.tabs.sendMessage(tab.id, { type: "ultradm://list-media" });
        sendResponse(r || { media: [] });
      } catch {
        sendResponse({ media: [] });
      }
    });
    return true;
  }
});

chrome.storage.local.get(["enabled", "theme"], (d) => {
  if (typeof d.enabled === "boolean") enabled = d.enabled;
  if (d.theme) theme = d.theme;
  updateBadge();
  connectWs();
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!enabled) return;
    const ct = (details.responseHeaders || []).find((h) => h.name.toLowerCase() === "content-type");
    const v = (ct?.value || "").toLowerCase();
    if (v.includes("mpegurl") || v.includes("dash+xml") || v.includes("video/") || v.includes("audio/")) {
      handleCapture({ kind: "stream", url: details.url, pageUrl: details.initiator || "" });
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"],
);
