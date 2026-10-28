import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Connection types
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

// ---------------------------------------------------------------------------
// Video Composition & Pan Limits types
// ---------------------------------------------------------------------------

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

export interface PanLimitsRequestPayload {
  source_width: number;
  source_height: number;
  canvas_width: number;
  canvas_height: number;
  zoom: number;
  crop?: CropPayload | null;
}

export interface PanLimitsResponsePayload {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
  visible_width: number;
  visible_height: number;
  x_locked: boolean;
  y_locked: boolean;
}

// ---------------------------------------------------------------------------
// Video Settings types (OBS base and output canvas)
// ---------------------------------------------------------------------------

export interface ObsVideoSettingsPayload {
  base_width: number;
  base_height: number;
  output_width: number;
  output_height: number;
  fps_numerator: number;
  fps_denominator: number;
}

// ---------------------------------------------------------------------------
// Streaming & Health types
// ---------------------------------------------------------------------------

export interface StreamStatusPayload {
  active: boolean;
  reconnecting: boolean;
  timecode: string | null;
  duration_seconds: number;
  congestion: number;
  bytes_sent: number;
  kbits_per_sec: number | null;
  dropped_frames: number;
  total_frames: number;

  // Performance and Render Metrics
  cpu_usage: number;
  memory_usage_mb: number;
  active_fps: number;
  render_skipped_frames: number;
  render_total_frames: number;
  average_frame_render_time_ms: number;
}

export interface StreamConfigPayload {
  obs_config: ObsConnectionConfig;
  server: string;
  stream_key: string;
}

export interface StartProfileStreamPayload {
  obs_config: ObsConnectionConfig;
  profile_id: string;
}

// ---------------------------------------------------------------------------
// Profile Management types
// ---------------------------------------------------------------------------

export interface QualitySettings {
  output_width: number;
  output_height: number;
  fps: number;
  video_bitrate_kbps: number;
  audio_bitrate_kbps: number;
  encoder: string;
  rate_control: string;
  keyframe_interval_sec: number;
}

export interface ProfileCompositionConfig {
  scene_name: string;
  source_name: string;
  canvas_width: number;
  canvas_height: number;
}

export interface AdaptationConfig {
  enabled: boolean;
  min_bitrate_kbps: number;
  max_bitrate_kbps: number;
  step_down_kbps: number;
  step_up_kbps: number;
  down_congestion_threshold: number;
  cooldown_seconds: number;
}

export interface ProfileSummaryDto {
  id: string;
  name: string;
  service_type: string;
  server_url: string;
  has_credential: boolean;
  quality: QualitySettings;
  composition: ProfileCompositionConfig;
  adaptation: AdaptationConfig;
}

export interface CreateProfilePayload {
  name: string;
  service_type?: string;
  server_url?: string;
  stream_key?: string;
  preset?: string;
}

export interface UpdateProfilePayload {
  id: string;
  name: string;
  service_type: string;
  server_url: string;
  quality: QualitySettings;
  composition: ProfileCompositionConfig;
  adaptation: AdaptationConfig;
}

// ---------------------------------------------------------------------------
// Connection commands
// ---------------------------------------------------------------------------

export async function testObsConnection(
  config: ObsConnectionConfig
): Promise<ObsConnectionStatus> {
  return invoke<ObsConnectionStatus>("test_obs_connection", { config });
}

export async function listScenes(
  obsConfig: ObsConnectionConfig
): Promise<string[]> {
  return invoke<string[]>("list_scenes", { obsConfig });
}

// ---------------------------------------------------------------------------
// Video composition & geometry commands
// ---------------------------------------------------------------------------

export async function calculatePanLimits(
  payload: PanLimitsRequestPayload
): Promise<PanLimitsResponsePayload> {
  return invoke<PanLimitsResponsePayload>("calculate_pan_limits", { payload });
}

export async function applyVideoComposition(
  payload: ApplyCompositionPayload
): Promise<void> {
  return invoke<void>("apply_video_composition", { payload });
}

// ---------------------------------------------------------------------------
// OBS video settings commands (resolution / fps staging)
// ---------------------------------------------------------------------------

export async function getObsVideoSettings(
  obsConfig: ObsConnectionConfig
): Promise<ObsVideoSettingsPayload> {
  return invoke<ObsVideoSettingsPayload>("get_obs_video_settings", { obsConfig });
}

export async function setObsVideoSettings(
  obsConfig: ObsConnectionConfig,
  settings: ObsVideoSettingsPayload
): Promise<void> {
  return invoke<void>("set_obs_video_settings", { obsConfig, settings });
}

// ---------------------------------------------------------------------------
// Streaming control commands
// ---------------------------------------------------------------------------

export async function getStreamStatus(
  obsConfig: ObsConnectionConfig
): Promise<StreamStatusPayload> {
  return invoke<StreamStatusPayload>("get_stream_status", { obsConfig });
}

export async function startStream(payload: StreamConfigPayload): Promise<void> {
  return invoke<void>("start_stream", { payload });
}

export async function startProfileStream(
  payload: StartProfileStreamPayload
): Promise<void> {
  return invoke<void>("start_profile_stream", { payload });
}

export async function stopStream(
  obsConfig: ObsConnectionConfig
): Promise<void> {
  return invoke<void>("stop_stream", { obsConfig });
}

export async function setStreamKey(
  payload: StreamConfigPayload
): Promise<void> {
  return invoke<void>("set_stream_key", { payload });
}

// ---------------------------------------------------------------------------
// Profile & Credential Management commands
// ---------------------------------------------------------------------------

export async function listProfiles(): Promise<ProfileSummaryDto[]> {
  return invoke<ProfileSummaryDto[]>("list_profiles");
}

export async function getActiveProfile(): Promise<ProfileSummaryDto | null> {
  return invoke<ProfileSummaryDto | null>("get_active_profile");
}

export async function setActiveProfile(id: string): Promise<ProfileSummaryDto> {
  return invoke<ProfileSummaryDto>("set_active_profile", { id });
}

export async function createProfile(
  payload: CreateProfilePayload
): Promise<ProfileSummaryDto> {
  return invoke<ProfileSummaryDto>("create_profile", { payload });
}

export async function updateProfile(
  payload: UpdateProfilePayload
): Promise<ProfileSummaryDto> {
  return invoke<ProfileSummaryDto>("update_profile", { payload });
}

export async function duplicateProfile(id: string): Promise<ProfileSummaryDto> {
  return invoke<ProfileSummaryDto>("duplicate_profile", { id });
}

export async function deleteProfile(id: string): Promise<void> {
  return invoke<void>("delete_profile", { id });
}

export async function getProfileStreamKey(id: string): Promise<string | null> {
  return invoke<string | null>("get_profile_stream_key", { id });
}

export async function setProfileStreamKey(
  id: string,
  streamKey: string
): Promise<void> {
  return invoke<void>("set_profile_stream_key", { id, streamKey });
}
