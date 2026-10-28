import { invoke } from "@tauri-apps/api/core";

export interface ObsConnectionConfig {
  host: string;
  port: number;
  password?: string | null;
}

export interface ObsConnectionStatus {
  connected: boolean;
  obs_version: string | null;
  obs_web_socket_version: string | null;
  rpc_version: number | null;
  error_message: string | null;
}

export interface CropPayload {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ApplyCompositionPayload {
  obs_config: ObsConnectionConfig;
  scene_name: string;
  source_name: string;
  source_path: string;
  source_width: number;
  source_height: number;
  canvas_width: number;
  canvas_height: number;
  zoom: number;
  pan_x: number;
  pan_y: number;
  crop?: CropPayload | null;
}

/**
 * Test connection to OBS Studio via obs-websocket 5.x.
 * Returns connected status, version information, or friendly error message.
 */
export async function testObsConnection(
  config: ObsConnectionConfig
): Promise<ObsConnectionStatus> {
  return invoke<ObsConnectionStatus>("test_obs_connection", { config });
}

/**
 * Apply video composition to OBS Studio.
 * Idempotently creates scene and ffmpeg_source if missing, sets local_file, and applies transform.
 */
export async function applyVideoComposition(
  payload: ApplyCompositionPayload
): Promise<void> {
  return invoke<void>("apply_video_composition", { payload });
}
