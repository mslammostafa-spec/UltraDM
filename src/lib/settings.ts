import { invoke, isTauri } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS, type Settings } from "./themes";

export { DEFAULT_SETTINGS, type Settings } from "./themes";

/** تحميل الإعدادات من settings.json عبر Rust، أو من التخزين المحلي في المعاينة. */
export async function loadSettings(): Promise<Settings> {
  try {
    if (isTauri()) {
      const raw = await invoke<string | null>("load_settings");
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      return DEFAULT_SETTINGS;
    }
  } catch {
    // تعذر القراءة: نستخدم الافتراضي
  }
  try {
    const raw = localStorage.getItem("ultradm.settings");
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // تجاهل
  }
  return DEFAULT_SETTINGS;
}

/** حفظ الإعدادات في settings.json عبر Rust (أو التخزين المحلي في المعاينة). */
export async function saveSettings(s: Settings): Promise<void> {
  const json = JSON.stringify(s, null, 2);
  try {
    if (isTauri()) {
      await invoke("save_settings", { json });
      return;
    }
  } catch (e) {
    throw e;
  }
  localStorage.setItem("ultradm.settings", json);
}
