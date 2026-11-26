// نافذة "معلومات التحميل" المستقلة (تفتح فوق المتصفح مباشرة).
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DownloadInfoDialog, type StartConfig } from "./components/DownloadDialogs";
import { invoke, isTauri } from "@tauri-apps/api/core";

export default function InfoWindow() {
  const [payload, setPayload] = useState<{ url: string; torrent?: boolean } | null>(null);

  useEffect(() => {
    // نفس ثيم النافذة الرئيسية (من localStorage المشترك بين نوافذ التطبيق).
    import("./lib/themes").then(({ applyTheme }) => {
      applyTheme(localStorage.getItem("ultradm.theme") || "glass-emerald-cyan");
    });
    if (!isTauri()) return;
    const un = listen<{ url: string; torrent?: boolean }>("aux://info", (e) =>
      setPayload(e.payload),
    );
    // النافذة الرئيسية تسأل عند الفتح إن كانت هناك بيانات معلّقة.
    invoke("aux_ready", { kind: "info" }).catch(() => {});
    return () => { un.then((f) => f()); };
  }, []);

  const close = () => {
    if (isTauri()) getCurrentWindow().hide();
  };

  if (!payload) return null;
  return (
    <div className="min-h-screen flex items-center justify-center">
      <DownloadInfoDialog
        initialUrl={payload.url}
        isTorrent={!!payload.torrent}
        onClose={close}
        onStart={(cfg: StartConfig) => {
          invoke("add_download_from_aux", { cfg: { ...cfg, later: false } }).catch(() => {});
          close();
        }}
        onLater={(cfg: StartConfig) => {
          invoke("add_download_from_aux", { cfg: { ...cfg, later: true } }).catch(() => {});
          close();
        }}
      />
    </div>
  );
}
