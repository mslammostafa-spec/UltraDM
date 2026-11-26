import { invoke, isTauri } from "@tauri-apps/api/core";

export type Category =
  | "all"
  | "video"
  | "audio"
  | "archive"
  | "software"
  | "document"
  | "torrent";

export type Status =
  | "downloading" | "paused" | "queued" | "scheduled" | "done" | "error";

// شجرة التصفية في الشريط الجانبي: الكل، تصنيف، حالة، سجل أو محذوفات.
export type ViewFilter =
  | { kind: "all" }
  | { kind: "category"; value: Exclude<Category, "all"> }
  | { kind: "status"; value: Status }
  | { kind: "history" }
  | { kind: "deleted" };

export const FILTER_ALL = "all";

export function filterId(f: ViewFilter): string {
  switch (f.kind) {
    case "all": return "all";
    case "history": return "history";
    case "deleted": return "deleted";
    case "category": return `cat:${f.value}`;
    default: return `status:${f.value}`;
  }
}

export function parseFilterId(id: string): ViewFilter {
  if (id === "all" || id === "history" || id === "deleted") return { kind: id };
  const [kind, value] = id.split(":");
  if (kind === "cat") return { kind: "category", value: value as Exclude<Category, "all"> };
  if (kind === "status") return { kind: "status", value: value as Status };
  return { kind: "all" };
}

export function matchesFilter(d: Download, f: ViewFilter): boolean {
  switch (f.kind) {
    case "all": return true;
    case "category": return d.category === f.value;
    case "status": return d.status === f.value;
    case "history": return d.status === "done";
    case "deleted": return true;
  }
}

export interface Download {
  id: string;
  name: string;
  category: Exclude<Category, "all">;
  sizeBytes: number;
  progress: number;
  speedBps: number;
  peakSpeedBps: number;
  etaSeconds: number | null;
  threads: number;
  status: Status;
  description?: string;
  savePath?: string;
}

export type AfterFinish = "none" | "shutdown" | "sleep" | "quit";

export const MAX_THREADS = 32;

export const inDesktop = (): boolean => isTauri();

export async function shutdownDevice(): Promise<void> {
  await invoke("shutdown_device");
}

export async function sleepDevice(): Promise<void> {
  await invoke("sleep_device");
}

export async function exitApp(): Promise<void> {
  await invoke("quit_app");
}

export async function runAfterFinish(action: AfterFinish): Promise<void> {
  if (action === "shutdown") return shutdownDevice();
  if (action === "sleep") return sleepDevice();
  if (action === "quit") return exitApp();
}

// ─── محرك التحميل في Rust ───

export async function engineAdd(input: {
  url: string;
  savePath: string;
  threads: number;
  category: string;
  description?: string | null;
}): Promise<Download> {
  const s = await invoke<EngineSnapshot>("engine_add", {
    url: input.url,
    savePath: input.savePath,
    threads: input.threads,
    category: input.category,
    description: input.description ?? null,
  });
  return snapshotToDownload(s);
}

export async function enginePause(id: string): Promise<void> {
  await invoke("engine_pause", { id });
}

export async function engineResume(id: string): Promise<void> {
  await invoke("engine_resume", { id });
}

export async function engineCancel(id: string): Promise<void> {
  await invoke("engine_cancel", { id });
}

export async function engineSetSpeedLimit(maxBps: number): Promise<void> {
  await invoke("engine_set_speed_limit", { maxBps });
}

export async function engineList(): Promise<Download[]> {
  const items = await invoke<EngineSnapshot[]>("engine_list");
  return items.map(snapshotToDownload);
}

// ——— تورنت ———

export interface TorrentSnapshot {
  id: number;
  name: string;
  total_bytes: number;
  downloaded_bytes: number;
  down_bps: number;
  up_bps: number;
  progress: number;
  peers: number;
  state: string;
  error: string | null;
}

export async function torrentAdd(url: string, outputFolder?: string): Promise<TorrentSnapshot> {
  return invoke<TorrentSnapshot>("torrent_add", { url, outputFolder: outputFolder ?? null });
}

export async function torrentList(): Promise<TorrentSnapshot[]> {
  return invoke<TorrentSnapshot[]>("torrent_list");
}

export async function torrentPause(id: number): Promise<void> {
  await invoke("torrent_pause", { id });
}

/** التحقق من بصمة SHA-256 لملف تورنت مكتمل (الملف الأول غير الفارغ). */
export async function torrentVerifySha256(id: number, expectedHex: string): Promise<boolean> {
  return invoke<boolean>("torrent_verify_sha256", { id, expectedHex: expectedHex });
}

export async function torrentResume(id: number): Promise<void> {
  await invoke("torrent_resume", { id });
}

export async function torrentRemove(id: number, deleteFiles: boolean): Promise<void> {
  await invoke("torrent_remove", { id, deleteFiles });
}

// ——— مجدول ———

export interface ScheduleRule {
  id: number;
  start: string;
  end: string;
  kind: "daily" | "weekdays" | "weekend";
}

export async function schedulerSetRules(rules: ScheduleRule[]): Promise<void> {
  await invoke("scheduler_set_rules", { rules });
}

// ——— تسجيل التورنت + الطاقة ———

export async function registerTorrentHandler(): Promise<void> {
  await invoke("register_torrent_handler");
}

export type PowerAction = "shutdown" | "sleep" | "quit";

export async function requestPower(action: PowerAction): Promise<void> {
  if (action === "quit") {
    await invoke("exit_app");
    return;
  }
  await invoke(action === "shutdown" ? "shutdown_device" : "sleep_device");
}

export async function cancelShutdown(): Promise<void> {
  await invoke("cancel_shutdown");
}

export async function openPath(path: string): Promise<void> {
  await invoke("open_path", { path });
}

export async function diskFree(path?: string): Promise<number> {
  return await invoke<number>("disk_free", { path: path ?? null });
}

interface EngineSnapshot {
  id: string;
  url: string;
  file_path: string;
  name: string;
  category: string;
  size: number;
  downloaded: number;
  progress: number;
  speed_bps: number;
  peak_speed_bps: number;
  eta_seconds: number | null;
  threads: number;
  status: string;
  description: string | null;
  error: string | null;
  chunks: Array<{
    index: number;
    start: number;
    end: number;
    downloaded: number;
    phase: string;
  }>;
}

function snapshotToDownload(s: EngineSnapshot): Download {
  return {
    id: s.id,
    name: s.name,
    category: (s.category || "software") as Download["category"],
    sizeBytes: s.size,
    progress: s.progress,
    speedBps: s.speed_bps,
    peakSpeedBps: s.peak_speed_bps,
    etaSeconds: s.eta_seconds,
    threads: s.threads,
    status: s.status as Download["status"],
    description: s.description ?? undefined,
    savePath: s.file_path,
  };
}
