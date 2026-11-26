import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import InfoWindow from "./InfoWindow";
import ProgressWindow from "./ProgressWindow";
import "./index.css";

// نوافذ المساعدة المستقلة: كل نافذة Tauri ثانوية تُصيّر مكوّنها الخاص.
const kind = new URLSearchParams(window.location.search).get("ultradmWindow");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {kind === "info" ? (
      <InfoWindow />
    ) : kind === "progress" ? (
      <ProgressWindow />
    ) : (
      <App />
    )}
  </StrictMode>,
);
