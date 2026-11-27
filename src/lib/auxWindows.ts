// نوافذ Tauri مستقلة لمعلومات التحميل وتقدّمه (مثل IDM) — تُفتح فوق المتصفح
// بحجم مدمج، بلا إجبار النافذة الرئيسية على الظهور.
import { isTauri } from "@tauri-apps/api/core";

export type AuxWindowKind = "info" | "progress";

export const AUX_QUERY_KEY = "ultradmWindow";

export function auxWindowKindFromUrl(): AuxWindowKind | null {
  const p = new URLSearchParams(window.location.search).get(AUX_QUERY_KEY);
  return p === "info" || p === "progress" ? p : null;
}

/** فتح نافذة مساعدة مستقلة (640x540، دائمًا في المقدمة فوق المتصفح). */
export async function openAuxWindow(kind: AuxWindowKind, payload?: unknown): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { emit } = await import("@tauri-apps/api/event");
  const label = `ultradm-${kind}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    if (payload !== undefined) await emit(`aux://${kind}`, payload);
    return;
  }
  const win = new WebviewWindow(label, {
    url: `index.html?${AUX_QUERY_KEY}=${kind}`,
    title: kind === "info" ? "معلومات التحميل — الفتح" : "تقدّم التحميل — الفتح",
    width: 640,
    height: 540,
    center: true,
    alwaysOnTop: true,
    resizable: true,
    minWidth: 460,
    minHeight: 420,
  });
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 4000);
    win.once("tauri://created", () => { clearTimeout(t); resolve(); });
    win.once("tauri://error", () => { clearTimeout(t); resolve(); });
  });
  if (payload !== undefined) await emit(`aux://${kind}`, payload);
}
