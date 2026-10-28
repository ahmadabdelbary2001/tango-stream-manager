import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Streaming types
// ---------------------------------------------------------------------------

export interface StreamStatus {
  active: boolean;
  timecode: string | null;
  kbits_per_sec: number | null;
  dropped_frames: number | null;
  total_frames: number | null;
}

export interface StreamConfigPayload {
  obs_config: ObsConnectionConfig;
  /** RTMP server URL, e.g. rtmp://live.twitch.tv/live */
  server: string;
  /** Stream key (secret) */
  stream_key: string;
}

// ---------------------------------------------------------------------------
// Connection commands
// ---------------------------------------------------------------------------

/**
 * Test connection to OBS Studio via obs-websocket 5.x.
 * Returns connected status, version information, or a friendly error message.
 */
export async function testObsConnection(
  config: ObsConnectionConfig
): Promise<ObsConnectionStatus> {
  return invoke<ObsConnectionStatus>("test_obs_connection", { config });
}

/**
 * Retrieve list of all scenes from OBS Studio.
 */
export async function listScenes(
  obsConfig: ObsConnectionConfig
): Promise<string[]> {
  return invoke<string[]>("list_scenes", { obsConfig });
}

// ---------------------------------------------------------------------------
// Video composition commands
// ---------------------------------------------------------------------------

/**
 * Apply video composition to OBS Studio.
 * Idempotently creates scene and ffmpeg_source if missing, sets local_file,
 * and applies crop + zoom + pan transform.
 */
export async function applyVideoComposition(
  payload: ApplyCompositionPayload
): Promise<void> {
  return invoke<void>("apply_video_composition", { payload });
}

// ---------------------------------------------------------------------------
// Streaming control commands
// ---------------------------------------------------------------------------

/**
 * Query the current live stream status from OBS.
 */
export async function getStreamStatus(
  obsConfig: ObsConnectionConfig
): Promise<StreamStatus> {
  return invoke<StreamStatus>("get_stream_status", { obsConfig });
}

/**
 * Set the RTMP stream key (and server) in OBS, then start streaming.
 * Idempotent: no-op if already live.
 */
export async function startStream(payload: StreamConfigPayload): Promise<void> {
  return invoke<void>("start_stream", { payload });
}

/**
 * Stop the active OBS stream gracefully.
 * Idempotent: no-op if already stopped.
 */
export async function stopStream(
  obsConfig: ObsConnectionConfig
): Promise<void> {
  return invoke<void>("stop_stream", { obsConfig });
}

/**
 * Update the RTMP stream key in OBS without starting or stopping the stream.
 */
export async function setStreamKey(
  payload: StreamConfigPayload
): Promise<void> {
  return invoke<void>("set_stream_key", { payload });
}
