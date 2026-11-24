import { invoke, isTauri } from "@tauri-apps/api/core";

export interface MediaFormat {
  format_id: string;
  ext: string;
  height: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  size: number | null;
  tbr: number | null;
  lang: string | null;
  label: string;
}

export interface MediaTrack {
  lang: string;
  kind: "manual" | "auto";
  exts: string[];
}

export interface MediaInfo {
  title: string;
  extractor: string;
  duration: number | null;
  formats: MediaFormat[];
  audio_langs: string[];
  subs: MediaTrack[];
  is_hls: boolean;
  is_dash: boolean;
  webpage_url: string;
}

export interface MediaRequest {
  url: string;
  output_dir: string;
  format_id?: string | null;
  container?: string | null;
  audio_only?: boolean;
  audio_format?: string | null;
  audio_bitrate?: string | null;
  audio_langs?: string[] | null;
  subs_langs?: string[] | null;
  subs_auto?: boolean;
  subs_mode?: "none" | "separate" | "embed" | "burn";
}

export type MediaProgressEvt = {
  id: string;
  percent: number;
  line: string;
  done: boolean;
  error: string | null;
};

export async function mediaCheck(): Promise<{ ytdlp: boolean; ffmpeg: boolean; ytdlp_version: string | null; ffmpeg_version: string | null }> {
  if (!isTauri()) return { ytdlp: false, ffmpeg: false, ytdlp_version: null, ffmpeg_version: null };
  try {
    return await invoke("media_check");
  } catch {
    return { ytdlp: false, ffmpeg: false, ytdlp_version: null, ffmpeg_version: null };
  }
}

export async function mediaProbe(url: string): Promise<MediaInfo> {
  return await invoke("media_probe", { url });
}

export async function mediaDownload(req: MediaRequest): Promise<string> {
  return await invoke("media_download", { req });
}

export async function mediaCancel(id: string): Promise<void> {
  if (isTauri()) await invoke("media_cancel", { id }).catch(() => {});
}
