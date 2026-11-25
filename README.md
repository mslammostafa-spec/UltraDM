# UltraDM

**UltraDM** is a fast, lightweight download manager for Windows, built with **Tauri 2 (Rust)** for the backend and **React + TypeScript + TailwindCSS v4** for the UI. It ships with an Arabic, right-to-left first interface, dark and light themes, and a companion browser extension that sends downloads from Chrome, Edge and Brave straight into the app.

> مدير تحميلات لسطح المكتب (ويندوز) مبني بـ Tauri 2 + Rust للخلفية و React + TypeScript + TailwindCSS v4 للواجهة، بواجهة عربية من اليمين إلى اليسار تدعم الوضعين الليلي والنهاري، مع إضافة متصفح ترسل التحميلات من Chrome وEdge وBrave مباشرة إلى البرنامج.

## What it does / ماذا يفعل البرنامج

- **Multi-threaded HTTP downloads** — up to 32 threads per file with live speed graph, per-file progress, remaining-time estimate and pause/resume.
- **Torrent support** — add `.torrent` files / magnet links and download through the built-in Rust engine.
- **Clipboard capture** — copies of direct links or magnets are detected automatically and offered as new downloads.
- **Category sidebar** — All, Video, Audio, Archives, Programs, Documents, Torrents.
- **Scheduling & post-download actions** — queue a download for later, then shut down, sleep or close the app when everything finishes.
- **Browser extension** — the Windows installer registers a Native Messaging host and force-installs the extension in Chrome, Edge and Brave, so "Download with UltraDM" works from the first install.
- **Tray icon with quick exit menu**, window minimised to tray.
- **Tiny footprint** — release profile tuned (`opt-level = "z"`, fat LTO, stripped) and the system WebView2 used for the UI keeps idle memory low.

## Download / التحميل

Grab the latest installer from [Releases](https://github.com/mslammostafa-spec/UltraDM/releases):

- `UltraDM_1.0.0_x64-setup.exe` — NSIS installer (recommended)
- `UltraDM_1.0.0_x64_en-US.msi` — MSI package

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

The installers are not code-signed yet; Windows SmartScreen may show a warning — choose **More info → Run anyway**.

## Building from source / البناء من الكود المصدري

Prerequisites: **Node.js 20+**, **npm**, **Rust (MSVC toolchain on Windows)**. WebView2 is embedded in the installer via `embedBootstrapper`.

```bash
npm install
npm run tauri dev     # development mode / وضع التطوير
npm run tauri build   # Windows installer (NSIS + MSI) in src-tauri/target/release/bundle
```

`npm run build` compiles the front-end only (Vite production bundle in `dist/`).

## Project structure / البنية

| Path | What it is |
| --- | --- |
| `src/` | React UI: sidebar categories, top bar (add link/torrent, pause, resume, delete, schedule, theme), downloads table, live speed chart, post-download action bar |
| `src-tauri/src/` | Rust backend: `download.rs` (HTTP engine), `torrent.rs` (torrent engine), `clipboard.rs` (link capture), `scheduler.rs`, `settings.rs`, `media.rs`, `register.rs`, `extension.rs` (browser-extension integration), power/tray commands |
| `browser-extension/` | Manifest V3 extension (background service worker, content scripts, popup) |
| `src-tauri/installer-hooks.nsh` | NSIS hooks: Native Messaging host registration + per-browser extension force-install keys |
| `.github/workflows/release.yml` | CI that builds and publishes the Windows installers on the `v*` tag |

## Security

Please report vulnerabilities responsibly — see [SECURITY.md](SECURITY.md). / للإبلاغ عن ثغرة أمنية راجع ملف SECURITY.md.

## License

Released under the [MIT License](LICENSE).
