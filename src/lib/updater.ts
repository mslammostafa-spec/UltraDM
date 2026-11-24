// التحقق من التحديثات عبر المحدِّث الرسمي (GitHub Releases latest.json).
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateStatus {
  current: string;
  available: string | null;
  notes: string | null;
  installed: boolean;
  error?: string;
}

export async function currentVersion(): Promise<string> {
  try {
    const info = await invoke<{ version: string }>("app_info");
    return info.version;
  } catch {
    return "1.0.0";
  }
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const current = await currentVersion();
  try {
    const update: Update | null = await check();
    if (!update) return { current, available: null, notes: null, installed: false };
    return {
      current,
      available: update.version,
      notes: update.body ?? null,
      installed: false,
    };
  } catch (e) {
    return { current, available: null, notes: null, installed: false, error: String(e) };
  }
}

export async function installUpdate(_update: Update | null): Promise<boolean> {
  // يجري الفحص من جديد لأن كائن Update لا يبقى صالحًا عبر الجلسات، ثم يثبّت ويعيد التشغيل.
  const update = await check();
  if (!update) return false;
  await update.downloadAndInstall();
  await relaunch();
  return true;
}

export { type Update };
