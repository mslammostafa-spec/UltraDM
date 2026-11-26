// نافذة "تقدّم التحميل" المستقلة — تظهر لحظة بدء أي تحميل (مثل IDM).
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { DownloadProgressDialog } from "./components/DownloadDialogs";
import type { Download } from "./lib/ipc";

export default function ProgressWindow() {
  const [download, setDownload] = useState<Download | null>(null);

  useEffect(() => {
    // نفس ثيم النافذة الرئيسية.
    void import("./lib/themes").then(({ applyTheme }) => {
      applyTheme(localStorage.getItem("ultradm.theme") || "glass-emerald-cyan");
    });
    if (!isTauri()) return;
    const un1 = listen<Download>("aux://progress", (e) => setDownload(e.payload));
    const un2 = listen<Download>("download://progress", (e) => {
      setDownload((d) =>
        d && d.id === e.payload.id ? { ...d, ...e.payload, status: e.payload.status as Download["status"] } : d,
      );
    });
    invoke("aux_ready", { kind: "progress" }).catch(() => {});
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, []);

  if (!download) return null;
  return (
    <div className="min-h-screen flex items-center justify-center">
      <DownloadProgressDialog
        download={download}
        onClose={() => { if (isTauri()) getCurrentWindow().hide(); }}
        onPauseResume={() => {
          const cmd = download.status === "paused" ? "engine_resume" : "engine_pause";
          invoke(cmd, { id: download.id }).catch(() => {});
        }}
        onCancel={() => invoke("engine_cancel", { id: download.id }).catch(() => {})}
      />
    </div>
  );
}
