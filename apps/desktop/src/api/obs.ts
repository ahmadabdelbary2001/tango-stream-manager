import { invoke } from "@tauri-apps/api/core";

// ===========================================================================
// Tango Stream Manager — frontend API layer
//
// Two adapters share one contract:
//   1. Native  — the existing Tauri commands (unchanged command names + payload
//                casing). Used whenever the page runs inside the Tauri shell.
//   2. Preview — a deterministic browser simulation, used only when no Tauri
//                runtime is present. It is isolated at the bottom of this file
//                and every result it produces is reported as simulated.
//
// The UI never checks the environment itself: it calls these functions and
// reads `isSimulatedResult` / `SIMULATION_MODE` to label activity honestly.
// ===========================================================================

// ---------------------------------------------------------------------------
// Runtime environment
// ---------------------------------------------------------------------------

/** True only inside the Tauri webview, where the native commands exist. */
export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const candidate = window as unknown as Record<string, unknown>;
  return (
    "__TAURI_INTERNALS__" in candidate || "__TAURI__" in candidate
  );
}

/** Whether this session is running the browser preview adapter. */
export const SIMULATION_MODE = !isTauriRuntime();

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

export interface VideoDimensionsPayload {
  width: number;
  height: number;
}

export interface AppliedCompositionPayload {
  applied_pan_x: number;
  applied_pan_y: number;
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

export interface AppliedObsQualitySettingsPayload {
  output_mode: string;
  video_settings: ObsVideoSettingsPayload;
  video_bitrate_kbps: number;
  audio_bitrate_kbps: number;
  encoder: string;
  rate_control: string;
  keyframe_interval_sec: number;
}

export interface ObsStreamingOutputOptionsPayload {
  rescale_output_enabled: boolean;
  rescale_output_width: number;
  rescale_output_height: number;
  rescale_filter: string;
  dynamic_bitrate_enabled: boolean;
}

export interface ObsStreamingOutputSettingsPayload
  extends ObsStreamingOutputOptionsPayload {
  output_mode: string;
}

export interface ObsLocalSilentModePayload {
  source_name: string;
  enabled: boolean;
  restore_monitor_type: string | null;
}

export interface ObsLocalSilentModeResultPayload {
  source_name: string;
  silent_mode_enabled: boolean;
  current_monitor_type: string;
  restore_monitor_type: string | null;
  input_muted: boolean;
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
  rescale_output_enabled: boolean;
  rescale_output_width: number;
  rescale_output_height: number;
  rescale_filter: string;
  dynamic_bitrate_enabled: boolean;
}

export interface ProfileObsConnection {
  host: string;
  port: number;
}

export interface ProfileCompositionConfig {
  scene_name: string;
  source_name: string;
  canvas_width: number;
  canvas_height: number;
  source_path: string;
  source_width: number;
  source_height: number;
  zoom: number;
  pan_x: number;
  pan_y: number;
  has_crop: boolean;
  crop: CropPayload | null;
  silent_mode_enabled: boolean;
  silent_mode_source_name: string;
  silent_mode_restore_monitor_type: string;
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
  obs_connection: ProfileObsConnection;
  has_obs_password: boolean;
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
  obs_connection: ProfileObsConnection;
  quality: QualitySettings;
  composition: ProfileCompositionConfig;
  adaptation: AdaptationConfig;
}

// ---------------------------------------------------------------------------
// Presets and shared vocabulary (display-level, no geometry or validation)
// ---------------------------------------------------------------------------

export type QualityPresetKey = "balanced" | "low" | "very_low";

export const ENCODER_OPTIONS = [
  "x264",
  "nvenc",
  "qsv",
  "amd",
] as const;

export const RATE_CONTROL_OPTIONS = ["CBR", "VBR", "CQP"] as const;

export const RESCALE_FILTER_OPTIONS = [
  "bicubic",
  "bilinear",
  "lanczos",
  "area",
] as const;

export const VOICE_MONITOR_TYPES = [
  "OBS_MONITORING_TYPE_NONE",
  "OBS_MONITORING_TYPE_MONITOR_ONLY",
  "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT",
] as const;

/** Profile-level quality presets. Ranges stay within Simple Output limits. */
export const QUALITY_PRESETS: Record<
  QualityPresetKey,
  Pick<
    QualitySettings,
    | "output_width"
    | "output_height"
    | "fps"
    | "video_bitrate_kbps"
    | "audio_bitrate_kbps"
    | "encoder"
    | "rate_control"
    | "keyframe_interval_sec"
  >
> = {
  balanced: {
    output_width: 720,
    output_height: 1280,
    fps: 30,
    video_bitrate_kbps: 3000,
    audio_bitrate_kbps: 160,
    encoder: "x264",
    rate_control: "CBR",
    keyframe_interval_sec: 2,
  },
  low: {
    output_width: 540,
    output_height: 960,
    fps: 30,
    video_bitrate_kbps: 1800,
    audio_bitrate_kbps: 128,
    encoder: "x264",
    rate_control: "CBR",
    keyframe_interval_sec: 2,
  },
  very_low: {
    output_width: 360,
    output_height: 640,
    fps: 25,
    video_bitrate_kbps: 900,
    audio_bitrate_kbps: 96,
    encoder: "x264",
    rate_control: "CBR",
    keyframe_interval_sec: 3,
  },
};

export const PRESET_LABELS: Record<QualityPresetKey, string> = {
  balanced: "Balanced · 720×1280 · 3.0 Mbps",
  low: "Low bandwidth · 540×960 · 1.8 Mbps",
  very_low: "Very low · 360×640 · 0.9 Mbps",
};

export function isQualityPresetKey(value: string): value is QualityPresetKey {
  return value === "balanced" || value === "low" || value === "very_low";
}

// ---------------------------------------------------------------------------
// Connection commands
// ---------------------------------------------------------------------------

export async function testObsConnection(
  config: ObsConnectionConfig,
): Promise<ObsConnectionStatus> {
  if (SIMULATION_MODE) return preview.testObsConnection(config);
  return invoke<ObsConnectionStatus>("test_obs_connection", { config });
}

export async function listScenes(
  obsConfig: ObsConnectionConfig,
): Promise<string[]> {
  if (SIMULATION_MODE) return preview.listScenes(obsConfig);
  return invoke<string[]>("list_scenes", { obsConfig });
}

// ---------------------------------------------------------------------------
// Video composition & geometry commands
// ---------------------------------------------------------------------------

export async function calculatePanLimits(
  payload: PanLimitsRequestPayload,
): Promise<PanLimitsResponsePayload> {
  if (SIMULATION_MODE) return preview.calculatePanLimits(payload);
  return invoke<PanLimitsResponsePayload>("calculate_pan_limits", { payload });
}

export async function probeVideoDimensions(
  sourcePath: string,
): Promise<VideoDimensionsPayload> {
  if (SIMULATION_MODE) return preview.probeVideoDimensions(sourcePath);
  return invoke<VideoDimensionsPayload>("probe_video_dimensions", {
    sourcePath,
  });
}

export async function applyVideoComposition(
  payload: ApplyCompositionPayload,
): Promise<AppliedCompositionPayload> {
  if (SIMULATION_MODE) return preview.applyVideoComposition(payload);
  return invoke<AppliedCompositionPayload>("apply_video_composition", {
    payload,
  });
}

// ---------------------------------------------------------------------------
// OBS video settings commands (resolution / fps staging)
// ---------------------------------------------------------------------------

export async function getObsVideoSettings(
  obsConfig: ObsConnectionConfig,
): Promise<ObsVideoSettingsPayload> {
  if (SIMULATION_MODE) return preview.getObsVideoSettings(obsConfig);
  return invoke<ObsVideoSettingsPayload>("get_obs_video_settings", {
    obsConfig,
  });
}

export async function setObsVideoSettings(
  obsConfig: ObsConnectionConfig,
  settings: ObsVideoSettingsPayload,
): Promise<void> {
  if (SIMULATION_MODE) return preview.setObsVideoSettings(obsConfig, settings);
  return invoke<void>("set_obs_video_settings", { obsConfig, settings });
}

export async function applyObsQualitySettings(
  obsConfig: ObsConnectionConfig,
  settings: ObsVideoSettingsPayload,
  quality: QualitySettings,
): Promise<AppliedObsQualitySettingsPayload> {
  if (SIMULATION_MODE) {
    return preview.applyObsQualitySettings(obsConfig, settings, quality);
  }
  return invoke<AppliedObsQualitySettingsPayload>(
    "apply_obs_quality_settings",
    { obsConfig, settings, quality },
  );
}

export async function getObsStreamingOutputSettings(
  obsConfig: ObsConnectionConfig,
): Promise<ObsStreamingOutputSettingsPayload> {
  if (SIMULATION_MODE) return preview.getObsStreamingOutputSettings(obsConfig);
  return invoke<ObsStreamingOutputSettingsPayload>(
    "get_obs_streaming_output_settings",
    { obsConfig },
  );
}

export async function applyObsStreamingOutputSettings(
  obsConfig: ObsConnectionConfig,
  settings: ObsStreamingOutputOptionsPayload,
): Promise<ObsStreamingOutputSettingsPayload> {
  if (SIMULATION_MODE) {
    return preview.applyObsStreamingOutputSettings(obsConfig, settings);
  }
  return invoke<ObsStreamingOutputSettingsPayload>(
    "apply_obs_streaming_output_options",
    { obsConfig, settings },
  );
}

export async function setObsLocalSilentMode(
  obsConfig: ObsConnectionConfig,
  payload: ObsLocalSilentModePayload,
): Promise<ObsLocalSilentModeResultPayload> {
  if (SIMULATION_MODE) return preview.setObsLocalSilentMode(obsConfig, payload);
  return invoke<ObsLocalSilentModeResultPayload>("set_obs_local_silent_mode", {
    obsConfig,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Streaming control commands
// ---------------------------------------------------------------------------

export async function getStreamStatus(
  obsConfig: ObsConnectionConfig,
): Promise<StreamStatusPayload> {
  if (SIMULATION_MODE) return preview.getStreamStatus(obsConfig);
  return invoke<StreamStatusPayload>("get_stream_status", { obsConfig });
}

export async function startStream(
  payload: StreamConfigPayload,
): Promise<void> {
  if (SIMULATION_MODE) {
    throw new Error(
      "The preview adapter only supports profile-based starts. The desktop build provides start_stream.",
    );
  }
  return invoke<void>("start_stream", { payload });
}

export async function startProfileStream(
  payload: StartProfileStreamPayload,
): Promise<void> {
  if (SIMULATION_MODE) return preview.startProfileStream(payload);
  return invoke<void>("start_profile_stream", { payload });
}

export async function stopStream(
  obsConfig: ObsConnectionConfig,
): Promise<void> {
  if (SIMULATION_MODE) return preview.stopStream(obsConfig);
  return invoke<void>("stop_stream", { obsConfig });
}

export async function setStreamKey(
  payload: StreamConfigPayload,
): Promise<void> {
  if (SIMULATION_MODE) {
    throw new Error(
      "Preview adapter stores keys per profile; use setProfileStreamKey.",
    );
  }
  return invoke<void>("set_stream_key", { payload });
}

// ---------------------------------------------------------------------------
// Profile & Credential Management commands
// ---------------------------------------------------------------------------

export async function listProfiles(): Promise<ProfileSummaryDto[]> {
  if (SIMULATION_MODE) return preview.listProfiles();
  return invoke<ProfileSummaryDto[]>("list_profiles");
}

export async function getActiveProfile(): Promise<ProfileSummaryDto | null> {
  if (SIMULATION_MODE) return preview.getActiveProfile();
  return invoke<ProfileSummaryDto | null>("get_active_profile");
}

export async function setActiveProfile(
  id: string,
): Promise<ProfileSummaryDto> {
  if (SIMULATION_MODE) return preview.setActiveProfile(id);
  return invoke<ProfileSummaryDto>("set_active_profile", { id });
}

export async function createProfile(
  payload: CreateProfilePayload,
): Promise<ProfileSummaryDto> {
  if (SIMULATION_MODE) return preview.createProfile(payload);
  return invoke<ProfileSummaryDto>("create_profile", { payload });
}

export async function updateProfile(
  payload: UpdateProfilePayload,
): Promise<ProfileSummaryDto> {
  if (SIMULATION_MODE) return preview.updateProfile(payload);
  return invoke<ProfileSummaryDto>("update_profile", { payload });
}

export async function duplicateProfile(
  id: string,
): Promise<ProfileSummaryDto> {
  if (SIMULATION_MODE) return preview.duplicateProfile(id);
  return invoke<ProfileSummaryDto>("duplicate_profile", { id });
}

export async function deleteProfile(id: string): Promise<void> {
  if (SIMULATION_MODE) return preview.deleteProfile(id);
  return invoke<void>("delete_profile", { id });
}

export async function getProfileStreamKey(
  id: string,
): Promise<string | null> {
  if (SIMULATION_MODE) return preview.getProfileStreamKey(id);
  return invoke<string | null>("get_profile_stream_key", { id });
}

export async function setProfileStreamKey(
  id: string,
  streamKey: string,
): Promise<void> {
  if (SIMULATION_MODE) return preview.setProfileStreamKey(id, streamKey);
  return invoke<void>("set_profile_stream_key", { id, streamKey });
}

export async function getProfileObsPassword(
  id: string,
): Promise<string | null> {
  if (SIMULATION_MODE) return preview.getProfileObsPassword(id);
  return invoke<string | null>("get_profile_obs_password", { id });
}

export async function setProfileObsPassword(
  id: string,
  password: string,
): Promise<void> {
  if (SIMULATION_MODE) return preview.setProfileObsPassword(id, password);
  return invoke<void>("set_profile_obs_password", { id, password });
}

/* ===========================================================================
 * PREVIEW ADAPTER — browser only
 *
 * Activated strictly when `SIMULATION_MODE` is true (no Tauri runtime). It
 * implements the same contract with deterministic fake data so the workspace
 * can be explored in a browser. It never touches native state and it can never
 * mask a genuine failure inside the desktop application.
 * ======================================================================== */

// --- deterministic pseudo-randomness -------------------------------------

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function noise(seed: string, t: number, amplitude: number): number {
  const base = Math.sin(hashString(seed) % 997 + t * 1.7) * 0.5 + 0.5;
  return base * amplitude;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- simulated geometry (mirrors the Rust composition contract) ----------
// Kept here so components never re-implement geometry.

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function simulatedPanLimits(
  payload: PanLimitsRequestPayload,
): PanLimitsResponsePayload {
  const { source_width, source_height, canvas_width, canvas_height } = payload;
  const zoom = Number.isFinite(payload.zoom) && payload.zoom > 0 ? payload.zoom : 1;
  const crop = payload.crop;
  const left = crop ? clamp(crop.left, 0, 0.9) : 0;
  const top = crop ? clamp(crop.top, 0, 0.9) : 0;
  const right = crop ? clamp(crop.right, 0, 0.9 - left) : 0;
  const bottom = crop ? clamp(crop.bottom, 0, 0.9 - top) : 0;

  const usableWidth = source_width * (1 - left - right);
  const usableHeight = source_height * (1 - top - bottom);

  if (
    !Number.isFinite(usableWidth) ||
    !Number.isFinite(usableHeight) ||
    usableWidth <= 0 ||
    usableHeight <= 0 ||
    canvas_width <= 0 ||
    canvas_height <= 0
  ) {
    return {
      min_x: 0,
      max_x: 0,
      min_y: 0,
      max_y: 0,
      visible_width: 0,
      visible_height: 0,
      x_locked: true,
      y_locked: true,
    };
  }

  // Centered Fill/Cover: scale until the source covers the canvas, then zoom.
  const coverScale = Math.max(
    canvas_width / usableWidth,
    canvas_height / usableHeight,
  );
  const scale = coverScale * zoom;

  const displayedWidth = usableWidth * scale;
  const displayedHeight = usableHeight * scale;

  const overflowX = Math.max(0, (displayedWidth - canvas_width) / 2);
  const overflowY = Math.max(0, (displayedHeight - canvas_height) / 2);

  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    min_x: round(-overflowX),
    max_x: round(overflowX),
    min_y: round(-overflowY),
    max_y: round(overflowY),
    visible_width: Math.round(canvas_width / scale),
    visible_height: Math.round(canvas_height / scale),
    x_locked: overflowX <= 0.5,
    y_locked: overflowY <= 0.5,
  };
}

// --- simulated store -----------------------------------------------------

const defaultQuality: QualitySettings = {
  ...QUALITY_PRESETS.balanced,
  rescale_output_enabled: false,
  rescale_output_width: 720,
  rescale_output_height: 1280,
  rescale_filter: "bicubic",
  dynamic_bitrate_enabled: false,
};

const defaultAdaptation: AdaptationConfig = {
  enabled: false,
  min_bitrate_kbps: 1200,
  max_bitrate_kbps: 4000,
  step_down_kbps: 400,
  step_up_kbps: 200,
  down_congestion_threshold: 0.35,
  cooldown_seconds: 15,
};

function defaultComposition(
  overrides: Partial<ProfileCompositionConfig> = {},
): ProfileCompositionConfig {
  return {
    scene_name: "Tango Scene",
    source_name: "Tango Video",
    canvas_width: 720,
    canvas_height: 1280,
    source_path: "",
    // Unverified placeholder geometry: values are only confirmed once the user
    // detects them with ffprobe or types them explicitly.
    source_width: 568,
    source_height: 762,
    zoom: 1,
    pan_x: 0,
    pan_y: 0,
    has_crop: false,
    crop: { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 },
    silent_mode_enabled: false,
    silent_mode_source_name: "",
    silent_mode_restore_monitor_type: "",
    ...overrides,
  };
}

interface SimProfileRecord {
  profile: ProfileSummaryDto;
  obsPassword: string | null;
  streamKey: string | null;
}

const simStore: {
  profiles: SimProfileRecord[];
  activeId: string | null;
  scenes: Record<string, string[]>;
  outputMode: "simple" | "advanced";
  monitorTypes: Record<string, string>;
  stream: {
    active: boolean;
    startedAt: number | null;
    bitrateKbps: number;
    profileId: string | null;
  };
  nextId: number;
} = {
  profiles: [],
  activeId: null,
  scenes: {
    "127.0.0.1:4455": ["Tango Scene", "Interview Close", "Intermission", "Practice Room"],
    "10.2.0.2:4455": ["Remote Stage", "Tango Scene"],
  },
  outputMode: "advanced",
  monitorTypes: {
    "Tango Video": "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT",
    Microphone: "OBS_MONITORING_TYPE_MONITOR_ONLY",
  },
  stream: { active: false, startedAt: null, bitrateKbps: 3000, profileId: null },
  nextId: 4,
};

function seedSimulation() {
  const seeds: Array<{
    id: string;
    name: string;
    service: string;
    server: string;
    credential: boolean;
    host: string;
    port: number;
    preset: QualityPresetKey;
    scene: string;
    source: string;
    asset: string;
    dimensions: [number, number];
    canvas: [number, number];
  }> = [
    {
      id: "prof-studio-a",
      name: "Tango · Studio A",
      service: "tango",
      server: "rtmp://ingest.tango.example/live",
      credential: true,
      host: "127.0.0.1",
      port: 4455,
      preset: "balanced",
      scene: "Tango Scene",
      source: "Tango Video",
      asset: "C:\\Media\\tango_session_final.mp4",
      dimensions: [568, 762],
      canvas: [720, 1280],
    },
    {
      id: "prof-milonga",
      name: "Tango · Milonga Night",
      service: "tango",
      server: "rtmp://ingest.tango.example/live",
      credential: true,
      host: "127.0.0.1",
      port: 4455,
      preset: "low",
      scene: "Interview Close",
      source: "Tango Video",
      asset: "D:\\Footage\\milonga_wide.mp4",
      dimensions: [1280, 720],
      canvas: [720, 1280],
    },
    {
      id: "prof-rtmp-backup",
      name: "Custom RTMP · Backup",
      service: "custom",
      server: "rtmp://backup.example.net/app",
      credential: false,
      host: "10.2.0.2",
      port: 4455,
      preset: "very_low",
      scene: "Remote Stage",
      source: "Tango Video",
      asset: "E:\\Archive\\rehearsal_01.mov",
      dimensions: [1080, 1920],
      canvas: [720, 1280],
    },
  ];

  simStore.profiles = seeds.map((seed) => {
    const preset = QUALITY_PRESETS[seed.preset];
    const profile: ProfileSummaryDto = {
      id: seed.id,
      name: seed.name,
      service_type: seed.service,
      server_url: seed.server,
      has_credential: seed.credential,
      obs_connection: { host: seed.host, port: seed.port },
      has_obs_password: seed.host === "127.0.0.1",
      quality: {
        ...defaultQuality,
        ...preset,
        output_width: seed.canvas[0],
        output_height: seed.canvas[1],
        rescale_output_width: seed.canvas[0],
        rescale_output_height: seed.canvas[1],
      },
      composition: defaultComposition({
        scene_name: seed.scene,
        source_name: seed.source,
        source_path: seed.asset,
        source_width: seed.dimensions[0],
        source_height: seed.dimensions[1],
        canvas_width: seed.canvas[0],
        canvas_height: seed.canvas[1],
      }),
      adaptation: { ...defaultAdaptation },
    };
    return {
      profile,
      obsPassword: seed.host === "127.0.0.1" ? "demo-preview-pass" : null,
      streamKey: seed.credential ? `demo-${seed.id}-stream-key` : null,
    };
  });
  simStore.activeId = simStore.profiles[0]?.profile.id ?? null;
}

seedSimulation();

const NOT_CONNECTED =
  "Not connected to OBS. Preview adapter is offline until you connect.";

function simRecord(id: string): SimProfileRecord {
  const record = simStore.profiles.find((item) => item.profile.id === id);
  if (!record) {
    throw new Error(`Profile "${id}" was not found.`);
  }
  return record;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function simConnectionKey(config: ObsConnectionConfig): string {
  return `${config.host}:${config.port}`;
}

/** Preview: remote hosts are unreachable by design, localhost connects. */
function assertSimConnected(config: ObsConnectionConfig) {
  const isLocal =
    config.host === "127.0.0.1" ||
    config.host === "localhost" ||
    config.host === "::1";
  if (!isLocal) {
    throw new Error(
      `Preview adapter cannot reach ${simConnectionKey(config)}. ` +
        "Only localhost OBS endpoints are simulated; the desktop build connects to real remote hosts.",
    );
  }
}

function simStatus(): StreamStatusPayload {
  const { active, startedAt, bitrateKbps } = simStore.stream;
  if (!active || startedAt === null) {
    return {
      active: false,
      reconnecting: false,
      timecode: null,
      duration_seconds: 0,
      congestion: 0,
      bytes_sent: 0,
      kbits_per_sec: null,
      dropped_frames: 0,
      total_frames: 0,
      cpu_usage: 0,
      memory_usage_mb: 0,
      active_fps: 0,
      render_skipped_frames: 0,
      render_total_frames: 0,
      average_frame_render_time_ms: 0,
    };
  }

  const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
  const quality = simStore.profiles.find(
    (item) => item.profile.id === simStore.stream.profileId,
  )?.profile.quality;
  const fps = quality?.fps ?? 30;
  const congestion = Math.min(0.92, noise("congestion", elapsed, 0.22));
  const drift = noise("bitrate", elapsed, 160) - 80;
  const totalFrames = Math.floor(elapsed * fps);
  const dropped = Math.floor(elapsed * (0.02 + congestion * 0.35));
  const skipped = Math.floor(elapsed * 0.12);
  const renderTotal = totalFrames + skipped;

  return {
    active: true,
    reconnecting: congestion > 0.85,
    timecode: formatTimecode(elapsed),
    duration_seconds: Math.floor(elapsed),
    congestion,
    bytes_sent: Math.floor((elapsed * bitrateKbps * 1000) / 8),
    kbits_per_sec: Math.round(Math.max(400, bitrateKbps + drift)),
    dropped_frames: dropped,
    total_frames: totalFrames,
    cpu_usage: 18 + noise("cpu", elapsed, 14),
    memory_usage_mb: 412 + noise("mem", elapsed, 46),
    active_fps: fps - noise("fps", elapsed, 0.8),
    render_skipped_frames: skipped,
    render_total_frames: renderTotal,
    average_frame_render_time_ms: 4.6 + noise("render", elapsed, 2.1),
  };
}

function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

// --- preview implementations --------------------------------------------

const preview = {
  async testObsConnection(
    config: ObsConnectionConfig,
  ): Promise<ObsConnectionStatus> {
    await delay(420);
    if (!config.host.trim()) {
      return {
        connected: false,
        obs_version: null,
        obs_web_socket_version: null,
        rpc_version: null,
        error_message: "Host is empty. Enter the OBS hostname or IP address.",
      };
    }
    if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
      return {
        connected: false,
        obs_version: null,
        obs_web_socket_version: null,
        rpc_version: null,
        error_message: `Port ${config.port} is outside the valid range 1–65535.`,
      };
    }
    if (config.host.startsWith("10.2.0.2")) {
      return {
        connected: false,
        obs_version: null,
        obs_web_socket_version: null,
        rpc_version: null,
        error_message:
          "connection timed out (os error 10060) after 5000ms. The host did not answer on port " +
          `${config.port}. Check that the machine is reachable, OBS WebSocket is enabled, and the firewall allows the port.`,
      };
    }
    if (config.host === "bad-auth.local") {
      return {
        connected: false,
        obs_version: null,
        obs_web_socket_version: null,
        rpc_version: null,
        error_message:
          "Authentication failed: the stored OBS password was rejected. Re-enter the password configured in OBS → Tools → WebSocket Server Settings.",
      };
    }
    assertSimConnected(config);
    return {
      connected: true,
      obs_version: "31.0.1",
      obs_web_socket_version: "5.5.2",
      rpc_version: 1,
      error_message: null,
    };
  },

  async listScenes(config: ObsConnectionConfig): Promise<string[]> {
    await delay(260);
    assertSimConnected(config);
    return [...(simStore.scenes[simConnectionKey(config)] ?? [])];
  },

  async calculatePanLimits(
    payload: PanLimitsRequestPayload,
  ): Promise<PanLimitsResponsePayload> {
    await delay(60);
    return simulatedPanLimits(payload);
  },

  async probeVideoDimensions(
    sourcePath: string,
  ): Promise<VideoDimensionsPayload> {
    await delay(760);
    const trimmed = sourcePath.trim();
    if (!trimmed) {
      throw new Error("No media file selected. Enter a local video path first.");
    }
    if (!/\.[a-z0-9]{2,5}$/i.test(trimmed)) {
      throw new Error(
        `"${trimmed}" does not look like a media file. Select a video such as .mp4, .mov or .mkv.`,
      );
    }
    if (/missing|corrupt/i.test(trimmed)) {
      throw new Error(
        `ffprobe could not read a video stream from "${trimmed}". The file may be missing, unsupported or audio-only.`,
      );
    }
    // Deterministic per path, with the documented sample file kept at 568×762.
    const seed = hashString(trimmed.toLowerCase());
    const known: Array<[number, number]> = [
      [568, 762],
      [1080, 1920],
      [1280, 720],
      [720, 1280],
    ];
    const [width, height] = trimmed.toLowerCase().includes("tango_session_final")
      ? known[0]
      : known[seed % known.length];
    return { width, height };
  },

  async applyVideoComposition(
    payload: ApplyCompositionPayload,
  ): Promise<AppliedCompositionPayload> {
    await delay(340);
    assertSimConnected(payload.obs_config);
    const scenes = simStore.scenes[simConnectionKey(payload.obs_config)] ?? [];
    if (!scenes.includes(payload.scene_name)) {
      throw new Error(
        `Scene "${payload.scene_name}" was not found in the connected OBS instance.`,
      );
    }
    if (!payload.source_name.trim()) {
      throw new Error("Source name is empty. Choose the media source to transform.");
    }
    const limits = simulatedPanLimits(payload);
    return {
      applied_pan_x: clamp(payload.pan_x, limits.min_x, limits.max_x),
      applied_pan_y: clamp(payload.pan_y, limits.min_y, limits.max_y),
    };
  },

  async getObsVideoSettings(
    config: ObsConnectionConfig,
  ): Promise<ObsVideoSettingsPayload> {
    await delay(240);
    assertSimConnected(config);
    const active =
      simStore.profiles.find((item) => item.profile.id === simStore.activeId)
        ?.profile ?? simStore.profiles[0]?.profile;
    return {
      base_width: active?.composition.canvas_width ?? 720,
      base_height: active?.composition.canvas_height ?? 1280,
      output_width: active?.quality.output_width ?? 720,
      output_height: active?.quality.output_height ?? 1280,
      fps_numerator: active?.quality.fps ?? 30,
      fps_denominator: 1,
    };
  },

  async setObsVideoSettings(
    config: ObsConnectionConfig,
    _settings: ObsVideoSettingsPayload,
  ): Promise<void> {
    await delay(200);
    assertSimConnected(config);
  },

  async applyObsQualitySettings(
    config: ObsConnectionConfig,
    settings: ObsVideoSettingsPayload,
    quality: QualitySettings,
  ): Promise<AppliedObsQualitySettingsPayload> {
    await delay(520);
    assertSimConnected(config);
    if (simStore.outputMode === "simple" && quality.rate_control === "CQP") {
      throw new Error(
        "CQP rate control is not available in Simple Output mode. Switch OBS to Advanced Output, or use CBR.",
      );
    }
    simStore.stream.bitrateKbps = quality.video_bitrate_kbps;
    return {
      output_mode: simStore.outputMode,
      video_settings: settings,
      video_bitrate_kbps: quality.video_bitrate_kbps,
      audio_bitrate_kbps: quality.audio_bitrate_kbps,
      encoder: quality.encoder,
      rate_control: quality.rate_control,
      keyframe_interval_sec: quality.keyframe_interval_sec,
    };
  },

  async getObsStreamingOutputSettings(
    config: ObsConnectionConfig,
  ): Promise<ObsStreamingOutputSettingsPayload> {
    await delay(230);
    assertSimConnected(config);
    const active =
      simStore.profiles.find((item) => item.profile.id === simStore.activeId)
        ?.profile ?? simStore.profiles[0]?.profile;
    return {
      output_mode: simStore.outputMode,
      rescale_output_enabled: active?.quality.rescale_output_enabled ?? false,
      rescale_output_width: active?.quality.rescale_output_width ?? 720,
      rescale_output_height: active?.quality.rescale_output_height ?? 1280,
      rescale_filter: active?.quality.rescale_filter ?? "bicubic",
      dynamic_bitrate_enabled: active?.quality.dynamic_bitrate_enabled ?? false,
    };
  },

  async applyObsStreamingOutputSettings(
    config: ObsConnectionConfig,
    settings: ObsStreamingOutputOptionsPayload,
  ): Promise<ObsStreamingOutputSettingsPayload> {
    await delay(430);
    assertSimConnected(config);
    if (settings.rescale_output_enabled && simStore.outputMode !== "advanced") {
      throw new Error(
        "Rescale Output is only available with Advanced Output. OBS Output Mode was left unchanged — switch it manually to Advanced if you need rescaling.",
      );
    }
    return { ...settings, output_mode: simStore.outputMode };
  },

  async setObsLocalSilentMode(
    config: ObsConnectionConfig,
    payload: ObsLocalSilentModePayload,
  ): Promise<ObsLocalSilentModeResultPayload> {
    await delay(380);
    assertSimConnected(config);
    const source = payload.source_name.trim();
    if (!source) {
      throw new Error(
        "No audio source selected. Silent Mode needs the exact OBS source name.",
      );
    }
    if (/missing|not found/i.test(source)) {
      throw new Error(
        `OBS source "${source}" was not found. Silent Mode only changes monitoring for an existing source.`,
      );
    }
    const current = simStore.monitorTypes[source] ?? "OBS_MONITORING_TYPE_NONE";

    if (payload.enabled) {
      const original = payload.restore_monitor_type ?? current;
      simStore.monitorTypes[source] = "OBS_MONITORING_TYPE_NONE";
      return {
        source_name: source,
        silent_mode_enabled: true,
        current_monitor_type: "OBS_MONITORING_TYPE_NONE",
        restore_monitor_type: original,
        input_muted: false,
      };
    }

    if (!payload.restore_monitor_type) {
      throw new Error(
        `No saved monitor type for "${source}". The previous monitoring state is unknown, so it will not be guessed — set monitoring manually in OBS.`,
      );
    }
    simStore.monitorTypes[source] = payload.restore_monitor_type;
    return {
      source_name: source,
      silent_mode_enabled: false,
      current_monitor_type: payload.restore_monitor_type,
      restore_monitor_type: null,
      input_muted: false,
    };
  },

  async getStreamStatus(config: ObsConnectionConfig): Promise<StreamStatusPayload> {
    await delay(180);
    assertSimConnected(config);
    return simStatus();
  },

  async startProfileStream(
    payload: StartProfileStreamPayload,
  ): Promise<void> {
    await delay(900);
    assertSimConnected(payload.obs_config);
    const record = simRecord(payload.profile_id);
    if (!record.streamKey) {
      throw new Error(
        `No stream key stored for "${record.profile.name}". Save credentials before going live.`,
      );
    }
    if (!record.profile.server_url.trim()) {
      throw new Error(
        `No destination server set for "${record.profile.name}". Enter an RTMP server URL first.`,
      );
    }
    if (simStore.stream.active) {
      throw new Error("A stream is already running. Stop it before starting again.");
    }
    simStore.stream = {
      active: true,
      startedAt: Date.now(),
      bitrateKbps: record.profile.quality.video_bitrate_kbps,
      profileId: payload.profile_id,
    };
  },

  async stopStream(config: ObsConnectionConfig): Promise<void> {
    await delay(700);
    assertSimConnected(config);
    if (!simStore.stream.active) {
      throw new Error("No stream is currently running.");
    }
    simStore.stream = { active: false, startedAt: null, bitrateKbps: 3000, profileId: null };
  },

  async listProfiles(): Promise<ProfileSummaryDto[]> {
    await delay(280);
    return simStore.profiles.map((record) => clone(record.profile));
  },

  async getActiveProfile(): Promise<ProfileSummaryDto | null> {
    await delay(180);
    if (!simStore.activeId) return null;
    const record = simStore.profiles.find(
      (item) => item.profile.id === simStore.activeId,
    );
    return record ? clone(record.profile) : null;
  },

  async setActiveProfile(id: string): Promise<ProfileSummaryDto> {
    await delay(240);
    const record = simRecord(id);
    simStore.activeId = id;
    if (simStore.stream.active && simStore.stream.profileId !== id) {
      throw new Error(
        `Cannot switch to "${record.profile.name}" while a stream is live for another profile. Stop the broadcast first.`,
      );
    }
    return clone(record.profile);
  },

  async createProfile(payload: CreateProfilePayload): Promise<ProfileSummaryDto> {
    await delay(330);
    const name = payload.name.trim();
    if (!name) throw new Error("Profile name cannot be empty.");
    if (
      simStore.profiles.some(
        (item) => item.profile.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new Error(`A profile named "${name}" already exists.`);
    }
    const presetKey = payload.preset && isQualityPresetKey(payload.preset)
      ? payload.preset
      : "balanced";
    const preset = QUALITY_PRESETS[presetKey];
    const id = `prof-preview-${simStore.nextId}`;
    simStore.nextId += 1;

    const profile: ProfileSummaryDto = {
      id,
      name,
      service_type: payload.service_type ?? "tango",
      server_url:
        payload.server_url ??
        (payload.service_type === "custom"
          ? ""
          : "rtmp://ingest.tango.example/live"),
      has_credential: Boolean(payload.stream_key),
      obs_connection: { host: "127.0.0.1", port: 4455 },
      has_obs_password: false,
      quality: { ...defaultQuality, ...preset },
      composition: defaultComposition(),
      adaptation: { ...defaultAdaptation },
    };
    simStore.profiles.push({
      profile,
      obsPassword: null,
      streamKey: payload.stream_key ?? null,
    });
    return clone(profile);
  },

  async updateProfile(payload: UpdateProfilePayload): Promise<ProfileSummaryDto> {
    await delay(420);
    const record = simRecord(payload.id);
    const name = payload.name.trim();
    if (!name) throw new Error("Profile name cannot be empty.");
    if (
      simStore.profiles.some(
        (item) =>
          item.profile.id !== payload.id &&
          item.profile.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new Error(`A profile named "${name}" already exists.`);
    }
    record.profile = {
      ...record.profile,
      name,
      service_type: payload.service_type,
      server_url: payload.server_url,
      obs_connection: payload.obs_connection,
      quality: payload.quality,
      composition: payload.composition,
      adaptation: payload.adaptation,
    };
    return clone(record.profile);
  },

  async duplicateProfile(id: string): Promise<ProfileSummaryDto> {
    await delay(360);
    const record = simRecord(id);
    const baseName = `${record.profile.name} copy`;
    let name = baseName;
    let suffix = 2;
    while (
      simStore.profiles.some(
        (item) => item.profile.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      name = `${baseName} ${suffix}`;
      suffix += 1;
    }
    const newId = `prof-preview-${simStore.nextId}`;
    simStore.nextId += 1;
    const copy: ProfileSummaryDto = {
      ...clone(record.profile),
      id: newId,
      name,
      // Credentials stay isolated: the copy carries its own references.
      has_credential: false,
    };
    simStore.profiles.push({ profile: copy, obsPassword: null, streamKey: null });
    return clone(copy);
  },

  async deleteProfile(id: string): Promise<void> {
    await delay(300);
    simRecord(id);
    if (simStore.stream.active && simStore.stream.profileId === id) {
      throw new Error("Stop the active broadcast before deleting its profile.");
    }
    simStore.profiles = simStore.profiles.filter(
      (item) => item.profile.id !== id,
    );
    if (simStore.activeId === id) {
      simStore.activeId = simStore.profiles[0]?.profile.id ?? null;
    }
  },

  async getProfileStreamKey(id: string): Promise<string | null> {
    await delay(160);
    return simRecord(id).streamKey;
  },

  async setProfileStreamKey(id: string, streamKey: string): Promise<void> {
    await delay(300);
    const record = simRecord(id);
    if (!streamKey.trim()) {
      throw new Error("Stream key cannot be empty.");
    }
    record.streamKey = streamKey.trim();
    record.profile.has_credential = true;
  },

  async getProfileObsPassword(id: string): Promise<string | null> {
    await delay(160);
    return simRecord(id).obsPassword;
  },

  async setProfileObsPassword(id: string, password: string): Promise<void> {
    await delay(280);
    const record = simRecord(id);
    record.obsPassword = password;
    record.profile.has_obs_password = Boolean(password);
  },
};

export { NOT_CONNECTED as PREVIEW_NOT_CONNECTED_MESSAGE };
