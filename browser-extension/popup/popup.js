// الفتح — البوب-أب: حالة الاتصال، تشغيل/إيقاف، وقائمة وسائط الصفحة.
const $ = (id) => document.getElementById(id);

function renderState(state) {
  const el = $("status");
  el.textContent =
    state.status === "online"
      ? "متصل بـ الفتح (WebSocket)"
      : state.status === "connecting"
        ? "جارٍ الاتصال…"
        : state.enabled
          ? "غير متصل — شغّل برنامج الفتح"
          : "الاصطياد موقوف";
  el.classList.toggle("online", state.status === "online");
  el.classList.toggle("offline", state.status !== "online" && state.enabled);
  $("enabled").checked = state.enabled;
  $("toggle").textContent = state.enabled ? "⏸" : "▶";
  if (state.theme && state.theme.accent) {
    document.documentElement.style.setProperty("--accent", state.theme.accent);
  }
}

chrome.runtime.sendMessage({ type: "ultradm://get-state" }, renderState);

$("toggle").addEventListener("click", () => {
  chrome.runtime.sendMessage(
    { type: "ultradm://get-state" },
    (s) =>
      chrome.runtime.sendMessage(
        { type: "ultradm://set-enabled", enabled: !s.enabled },
        () => chrome.runtime.sendMessage({ type: "ultradm://get-state" }, renderState),
      ),
  );
});

$("enabled").addEventListener("change", (e) => {
  chrome.runtime.sendMessage(
    { type: "ultradm://set-enabled", enabled: e.target.checked },
    () => chrome.runtime.sendMessage({ type: "ultradm://get-state" }, renderState),
  );
});

$("probe").addEventListener("click", () => {
  const list = $("media");
  list.innerHTML = '<li class="empty">جارٍ الفحص…</li>';
  chrome.runtime.sendMessage({ type: "ultradm://probe-url" }, (r) => {
    const media = (r && r.media) || [];
    list.innerHTML = "";
    if (!media.length) {
      list.innerHTML = '<li class="empty">لا توجد وسائط مكتشفة بعد — شغّل أي فيديو ثم أعد الفحص.</li>';
      return;
    }
    for (const m of media) {
      const li = document.createElement("li");
      li.textContent = m.url;
      li.title = "إرسال إلى الفتح";
      li.addEventListener("click", () =>
        chrome.runtime.sendMessage({
          type: "capture",
          kind: m.kind,
          url: m.url,
          pageUrl: location.href,
          source: "popup",
        }),
      );
      list.appendChild(li);
    }
  });
});
