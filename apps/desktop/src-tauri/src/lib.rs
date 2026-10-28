use std::path::PathBuf;
use std::sync::Arc;

use domain::{
    AdaptationConfig, CropRegion, MediaAssetId, ProfileCompositionConfig, QualityPresetKind,
    QualitySettings, StreamingProfile, StreamingServiceType, VideoComposition, VideoSource,
    VideoTransform,
};
use infrastructure::{FileProfileRepository, KeyringCredentialStore, ObsVideoOutput};
use ports::{
    CredentialStorePort, FrameSize, ObsVideoSettings, ProfileRepositoryPort, StreamConfig,
    VideoOutputRequest,
};
use serde::{Deserialize, Serialize};
use tauri::State;
use video_composition::Size as VcSize;

// ---------------------------------------------------------------------------
// App State
// ---------------------------------------------------------------------------

pub struct AppState {
    pub profile_repo: Arc<FileProfileRepository>,
    pub credential_store: Arc<KeyringCredentialStore>,
}

fn get_storage_path() -> PathBuf {
    if let Ok(app_data) = std::env::var("APPDATA") {
        PathBuf::from(app_data)
            .join("tango-stream-manager")
            .join("profiles.json")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home)
            .join(".config")
            .join("tango-stream-manager")
            .join("profiles.json")
    } else {
        PathBuf::from("profiles.json")
    }
}

// ---------------------------------------------------------------------------
// Connection payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsConnectionConfig {
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
}

impl Default for ObsConnectionConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 4455,
            password: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsConnectionStatus {
    pub connected: bool,
    pub obs_version: Option<String>,
    pub obs_web_socket_version: Option<String>,
    pub rpc_version: Option<u32>,
    pub error_message: Option<String>,
}

// ---------------------------------------------------------------------------
// Video Composition & Pan Limits Payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CropPayload {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyCompositionPayload {
    pub obs_config: ObsConnectionConfig,
    pub scene_name: String,
    pub source_name: String,
    pub source_path: String,
    pub source_width: u32,
    pub source_height: u32,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub zoom: f64,
    pub pan_x: f64,
    pub pan_y: f64,
    pub crop: Option<CropPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanLimitsRequestPayload {
    pub source_width: u32,
    pub source_height: u32,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub zoom: f64,
    pub crop: Option<CropPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanLimitsResponsePayload {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
    pub visible_width: f64,
    pub visible_height: f64,
    pub x_locked: bool,
    pub y_locked: bool,
}

// ---------------------------------------------------------------------------
// Video Settings Payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsVideoSettingsPayload {
    pub base_width: u32,
    pub base_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub fps_numerator: u32,
    pub fps_denominator: u32,
}

// ---------------------------------------------------------------------------
// Streaming & Health Payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamStatusPayload {
    pub active: bool,
    pub reconnecting: bool,
    pub timecode: Option<String>,
    pub duration_seconds: u64,
    pub congestion: f32,
    pub bytes_sent: u64,
    pub kbits_per_sec: Option<u64>,
    pub dropped_frames: u64,
    pub total_frames: u64,

    // Performance and Render Metrics
    pub cpu_usage: f64,
    pub memory_usage_mb: f64,
    pub active_fps: f64,
    pub render_skipped_frames: u64,
    pub render_total_frames: u64,
    pub average_frame_render_time_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamConfigPayload {
    pub obs_config: ObsConnectionConfig,
    pub server: String,
    pub stream_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartProfileStreamPayload {
    pub obs_config: ObsConnectionConfig,
    pub profile_id: String,
}

// ---------------------------------------------------------------------------
// Profile Management Payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileSummaryDto {
    pub id: String,
    pub name: String,
    pub service_type: String,
    pub server_url: String,
    pub has_credential: bool,
    pub quality: QualitySettings,
    pub composition: ProfileCompositionConfig,
    pub adaptation: AdaptationConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProfilePayload {
    pub name: String,
    pub service_type: Option<String>,
    pub server_url: Option<String>,
    pub stream_key: Option<String>,
    pub preset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProfilePayload {
    pub id: String,
    pub name: String,
    pub service_type: String,
    pub server_url: String,
    pub quality: QualitySettings,
    pub composition: ProfileCompositionConfig,
    pub adaptation: AdaptationConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoDimensionsPayload {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppliedCompositionPayload {
    pub applied_pan_x: f64,
    pub applied_pan_y: f64,
}

// ---------------------------------------------------------------------------
// Helper: build ObsVideoOutput from connection config
// ---------------------------------------------------------------------------

fn make_output(config: &ObsConnectionConfig) -> Result<ObsVideoOutput, String> {
    ObsVideoOutput::new(&config.host, config.port, config.password.clone())
        .map_err(|e| format!("Failed to initialize OBS adapter: {e}"))
}

// ---------------------------------------------------------------------------
// Tauri commands — connection & scenes
// ---------------------------------------------------------------------------

#[tauri::command]
async fn test_obs_connection(config: ObsConnectionConfig) -> ObsConnectionStatus {
    let output = match make_output(&config) {
        Ok(o) => o,
        Err(e) => {
            return ObsConnectionStatus {
                connected: false,
                obs_version: None,
                obs_web_socket_version: None,
                rpc_version: None,
                error_message: Some(e),
            };
        }
    };

    match output.test_connection_async().await {
        Ok(info) => ObsConnectionStatus {
            connected: true,
            obs_version: Some(info.obs_version),
            obs_web_socket_version: Some(info.obs_web_socket_version),
            rpc_version: Some(info.rpc_version),
            error_message: None,
        },
        Err(err) => ObsConnectionStatus {
            connected: false,
            obs_version: None,
            obs_web_socket_version: None,
            rpc_version: None,
            error_message: Some(err.to_string()),
        },
    }
}

#[tauri::command]
async fn list_scenes(obs_config: ObsConnectionConfig) -> Result<Vec<String>, String> {
    let output = make_output(&obs_config)?;
    output.list_scenes_async().await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri command — detect real media dimensions through ffprobe
// ---------------------------------------------------------------------------

#[tauri::command]
async fn probe_video_dimensions(source_path: String) -> Result<VideoDimensionsPayload, String> {
    let trimmed_path = source_path.trim();
    if trimmed_path.is_empty() {
        return Err("Enter a video file path first.".into());
    }

    let path = PathBuf::from(trimmed_path);
    if !path.is_file() {
        return Err("The selected video path does not point to an existing file.".into());
    }

    let output = tokio::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=s=x:p=0",
        ])
        .arg(&path)
        .output()
        .await
        .map_err(|_| "ffprobe was not found in PATH. Install FFmpeg and make ffprobe available, or enter the source dimensions manually.".to_string())?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "ffprobe could not read video metadata from this file.".into()
        } else {
            format!("ffprobe could not read video metadata: {detail}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let dimension_line = stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| "No video stream was found in the selected file.".to_string())?;
    let (width_text, height_text) = dimension_line
        .trim()
        .split_once('x')
        .ok_or_else(|| "ffprobe returned an unexpected video-dimensions format.".to_string())?;
    let width = width_text
        .parse::<u32>()
        .map_err(|_| "Could not parse the video width returned by ffprobe.".to_string())?;
    let height = height_text
        .parse::<u32>()
        .map_err(|_| "Could not parse the video height returned by ffprobe.".to_string())?;

    if width == 0 || height == 0 {
        return Err("The video dimensions must be greater than zero.".into());
    }

    Ok(VideoDimensionsPayload { width, height })
}

// ---------------------------------------------------------------------------
// Tauri commands — video composition & geometry
// ---------------------------------------------------------------------------

#[tauri::command]
fn calculate_pan_limits(
    payload: PanLimitsRequestPayload,
) -> Result<PanLimitsResponsePayload, String> {
    let source_size = VcSize::new(payload.source_width as f64, payload.source_height as f64);
    let canvas_size = VcSize::new(payload.canvas_width as f64, payload.canvas_height as f64);

    let visible_size = match payload.crop {
        Some(c) => video_composition::calculate_visible_source_size(
            source_size,
            c.left,
            c.top,
            c.right,
            c.bottom,
        )
        .map_err(|e| e.to_string())?,
        None => source_size,
    };

    let limits = video_composition::calculate_safe_canvas_pan_limits(
        visible_size,
        canvas_size,
        payload.zoom,
    )
    .map_err(|e| e.to_string())?;

    let x_locked = (limits.max_x - limits.min_x).abs() < 1e-4;
    let y_locked = (limits.max_y - limits.min_y).abs() < 1e-4;

    Ok(PanLimitsResponsePayload {
        min_x: limits.min_x,
        max_x: limits.max_x,
        min_y: limits.min_y,
        max_y: limits.max_y,
        visible_width: visible_size.width,
        visible_height: visible_size.height,
        x_locked,
        y_locked,
    })
}

#[tauri::command]
async fn apply_video_composition(
    payload: ApplyCompositionPayload,
) -> Result<AppliedCompositionPayload, String> {
    let source_size = FrameSize::new(payload.source_width, payload.source_height)
        .ok_or_else(|| "Source width and height must be greater than zero".to_string())?;
    let canvas_size = FrameSize::new(payload.canvas_width, payload.canvas_height)
        .ok_or_else(|| "Canvas width and height must be greater than zero".to_string())?;

    let source_path = payload.source_path.trim();
    if source_path.is_empty() {
        return Err("Choose a video file before applying composition.".into());
    }
    if !PathBuf::from(source_path).is_file() {
        return Err("The video file path does not point to an existing file.".into());
    }
    if !payload.pan_x.is_finite() || !payload.pan_y.is_finite() {
        return Err("Pan X and Pan Y must be finite numbers.".into());
    }

    // Use the same integer crop rounding that OBS uses before deriving safe Pan limits.
    let visible_size = match payload.crop.as_ref() {
        Some(c) => video_composition::calculate_visible_source_size(
            VcSize::new(payload.source_width as f64, payload.source_height as f64),
            c.left,
            c.top,
            c.right,
            c.bottom,
        )
        .map_err(|e| format!("Invalid crop region: {e}"))?,
        None => VcSize::new(payload.source_width as f64, payload.source_height as f64),
    };

    let limits = video_composition::calculate_safe_canvas_pan_limits(
        visible_size,
        VcSize::new(payload.canvas_width as f64, payload.canvas_height as f64),
        payload.zoom,
    )
    .map_err(|e| format!("Unable to calculate safe Pan limits: {e}"))?;
    let safe_pan = limits.clamp(payload.pan_x, payload.pan_y);

    let crop = match payload.crop {
        Some(c) => Some(
            CropRegion::new(c.left, c.top, c.right, c.bottom)
                .ok_or_else(|| "Invalid crop region boundaries".to_string())?,
        ),
        None => None,
    };

    let composition = VideoComposition {
        source: VideoSource::Original {
            asset_id: MediaAssetId(payload.source_name.clone()),
        },
        crop,
        transform: VideoTransform {
            zoom: payload.zoom,
            pan_x: safe_pan.x,
            pan_y: safe_pan.y,
        },
    };

    let request = VideoOutputRequest::new(
        payload.scene_name,
        payload.source_name,
        source_path.to_string(),
        source_size,
        canvas_size,
        composition,
    );

    let output = make_output(&payload.obs_config)
        .map_err(|e| format!("Failed to create OBS output: {e}"))?;

    output
        .apply_video_composition_async(&request)
        .await
        .map_err(|e| e.to_string())?;

    Ok(AppliedCompositionPayload {
        applied_pan_x: safe_pan.x,
        applied_pan_y: safe_pan.y,
    })
}

// ---------------------------------------------------------------------------
// Tauri commands — OBS video settings (resolution / fps)
// ---------------------------------------------------------------------------

#[tauri::command]
async fn get_obs_video_settings(
    obs_config: ObsConnectionConfig,
) -> Result<ObsVideoSettingsPayload, String> {
    let output = make_output(&obs_config)?;
    let vs = output
        .get_video_settings_async()
        .await
        .map_err(|e| e.to_string())?;

    Ok(ObsVideoSettingsPayload {
        base_width: vs.base_width,
        base_height: vs.base_height,
        output_width: vs.output_width,
        output_height: vs.output_height,
        fps_numerator: vs.fps_numerator,
        fps_denominator: vs.fps_denominator,
    })
}

#[tauri::command]
async fn set_obs_video_settings(
    obs_config: ObsConnectionConfig,
    settings: ObsVideoSettingsPayload,
) -> Result<(), String> {
    let output = make_output(&obs_config)?;
    let domain_settings = ObsVideoSettings {
        base_width: settings.base_width,
        base_height: settings.base_height,
        output_width: settings.output_width,
        output_height: settings.output_height,
        fps_numerator: settings.fps_numerator,
        fps_denominator: settings.fps_denominator,
    };
    output
        .set_video_settings_async(&domain_settings)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands — streaming control & live metrics
// ---------------------------------------------------------------------------

#[tauri::command]
async fn get_stream_status(obs_config: ObsConnectionConfig) -> Result<StreamStatusPayload, String> {
    let output = make_output(&obs_config)?;
    let status = output
        .get_extended_stream_status_async()
        .await
        .map_err(|e| e.to_string())?;

    Ok(StreamStatusPayload {
        active: status.active,
        reconnecting: status.reconnecting,
        timecode: status.timecode,
        duration_seconds: status.duration_seconds,
        congestion: status.congestion,
        bytes_sent: status.bytes_sent,
        kbits_per_sec: status.kbits_per_sec,
        dropped_frames: status.dropped_frames,
        total_frames: status.total_frames,
        cpu_usage: status.cpu_usage,
        memory_usage_mb: status.memory_usage_mb,
        active_fps: status.active_fps,
        render_skipped_frames: status.render_skipped_frames,
        render_total_frames: status.render_total_frames,
        average_frame_render_time_ms: status.average_frame_render_time_ms,
    })
}

#[tauri::command]
async fn start_stream(payload: StreamConfigPayload) -> Result<(), String> {
    let output = make_output(&payload.obs_config)?;
    let config =
        StreamConfig::new(&payload.server, &payload.stream_key).map_err(|e| e.to_string())?;

    output
        .start_stream_async(&config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_profile_stream(
    payload: StartProfileStreamPayload,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let profile = state
        .profile_repo
        .get_profile(&payload.profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("profile '{}' not found", payload.profile_id))?;

    if profile.server_url.trim().is_empty() {
        return Err(
            "Profile RTMP Server URL is empty. Please enter your ingest URL from Tango Web Desk."
                .into(),
        );
    }

    let stream_key = state
        .credential_store
        .get_credential(&profile.credential_ref)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No stream key saved for this profile. Please enter your stream key.".to_string()
        })?;

    if stream_key.trim().is_empty() {
        return Err("Profile stream key is empty.".into());
    }

    let output = make_output(&payload.obs_config)?;
    let config = StreamConfig::new(&profile.server_url, &stream_key).map_err(|e| e.to_string())?;

    output
        .start_stream_async(&config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_stream(obs_config: ObsConnectionConfig) -> Result<(), String> {
    let output = make_output(&obs_config)?;
    output.stop_stream_async().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_stream_key(payload: StreamConfigPayload) -> Result<(), String> {
    let output = make_output(&payload.obs_config)?;
    let config =
        StreamConfig::new(&payload.server, &payload.stream_key).map_err(|e| e.to_string())?;

    output
        .set_stream_key_async(&config)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands — profile & credential management
// ---------------------------------------------------------------------------

fn to_profile_summary(
    profile: StreamingProfile,
    credential_store: &KeyringCredentialStore,
) -> ProfileSummaryDto {
    let has_credential = credential_store
        .get_credential(&profile.credential_ref)
        .map(|opt| opt.is_some())
        .unwrap_or(false);

    let service_type = match profile.service_type {
        StreamingServiceType::Tango => "tango".to_string(),
        StreamingServiceType::CustomRtmp => "custom_rtmp".to_string(),
    };

    ProfileSummaryDto {
        id: profile.id,
        name: profile.name,
        service_type,
        server_url: profile.server_url,
        has_credential,
        quality: profile.quality,
        composition: profile.composition,
        adaptation: profile.adaptation,
    }
}

#[tauri::command]
fn list_profiles(state: State<'_, AppState>) -> Result<Vec<ProfileSummaryDto>, String> {
    let profiles = state
        .profile_repo
        .list_profiles()
        .map_err(|e| e.to_string())?;
    Ok(profiles
        .into_iter()
        .map(|p| to_profile_summary(p, &state.credential_store))
        .collect())
}

#[tauri::command]
fn get_active_profile(state: State<'_, AppState>) -> Result<Option<ProfileSummaryDto>, String> {
    let active_id = state
        .profile_repo
        .get_active_profile_id()
        .map_err(|e| e.to_string())?;

    match active_id {
        Some(id) => {
            let profile = state
                .profile_repo
                .get_profile(&id)
                .map_err(|e| e.to_string())?;
            Ok(profile.map(|p| to_profile_summary(p, &state.credential_store)))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn set_active_profile(id: String, state: State<'_, AppState>) -> Result<ProfileSummaryDto, String> {
    state
        .profile_repo
        .set_active_profile_id(&id)
        .map_err(|e| e.to_string())?;

    let profile = state
        .profile_repo
        .get_profile(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("profile '{id}' not found"))?;

    Ok(to_profile_summary(profile, &state.credential_store))
}

#[tauri::command]
fn create_profile(
    payload: CreateProfilePayload,
    state: State<'_, AppState>,
) -> Result<ProfileSummaryDto, String> {
    if payload.name.trim().is_empty() {
        return Err("Profile name cannot be empty".into());
    }

    let id = format!(
        "prof_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let mut profile = StreamingProfile::new(&id, payload.name.trim());

    if let Some(st) = payload.service_type {
        profile.service_type = if st == "custom_rtmp" {
            StreamingServiceType::CustomRtmp
        } else {
            StreamingServiceType::Tango
        };
    }

    if let Some(url) = payload.server_url {
        profile.server_url = url.trim().to_string();
    }

    if let Some(preset) = payload.preset {
        match preset.as_str() {
            "low_bandwidth" => profile.quality = QualityPresetKind::LowBandwidth.settings(),
            "very_low_bandwidth" => {
                profile.quality = QualityPresetKind::VeryLowBandwidth.settings()
            }
            _ => profile.quality = QualityPresetKind::Balanced.settings(),
        }
    }

    state
        .profile_repo
        .save_profile(&profile)
        .map_err(|e| e.to_string())?;

    if let Some(key) = payload.stream_key {
        if !key.trim().is_empty() {
            let _ = state
                .credential_store
                .set_credential(&profile.credential_ref, key.trim());
        }
    }

    Ok(to_profile_summary(profile, &state.credential_store))
}

#[tauri::command]
fn update_profile(
    payload: UpdateProfilePayload,
    state: State<'_, AppState>,
) -> Result<ProfileSummaryDto, String> {
    let mut profile = state
        .profile_repo
        .get_profile(&payload.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("profile '{}' not found", payload.id))?;

    profile.name = payload.name.trim().to_string();
    profile.service_type = if payload.service_type == "custom_rtmp" {
        StreamingServiceType::CustomRtmp
    } else {
        StreamingServiceType::Tango
    };
    profile.server_url = payload.server_url.trim().to_string();
    profile.quality = payload.quality;
    profile.composition = payload.composition;
    profile.adaptation = payload.adaptation;

    state
        .profile_repo
        .save_profile(&profile)
        .map_err(|e| e.to_string())?;

    Ok(to_profile_summary(profile, &state.credential_store))
}

#[tauri::command]
fn duplicate_profile(id: String, state: State<'_, AppState>) -> Result<ProfileSummaryDto, String> {
    let profile = state
        .profile_repo
        .get_profile(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("profile '{id}' not found"))?;

    let new_id = format!(
        "prof_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let new_name = format!("{} (Copy)", profile.name);
    let duplicated = profile.duplicate(&new_id, &new_name);

    // If original had a secret, copy it securely to the new profile's credential reference
    if let Ok(Some(secret)) = state
        .credential_store
        .get_credential(&profile.credential_ref)
    {
        let _ = state
            .credential_store
            .set_credential(&duplicated.credential_ref, &secret);
    }

    state
        .profile_repo
        .save_profile(&duplicated)
        .map_err(|e| e.to_string())?;

    Ok(to_profile_summary(duplicated, &state.credential_store))
}

#[tauri::command]
fn delete_profile(id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(Some(p)) = state.profile_repo.get_profile(&id) {
        let _ = state.credential_store.delete_credential(&p.credential_ref);
    }
    state
        .profile_repo
        .delete_profile(&id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_profile_stream_key(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let profile = state
        .profile_repo
        .get_profile(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("profile '{id}' not found"))?;

    state
        .credential_store
        .get_credential(&profile.credential_ref)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_profile_stream_key(
    id: String,
    stream_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let profile = state
        .profile_repo
        .get_profile(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("profile '{id}' not found"))?;

    if stream_key.trim().is_empty() {
        state
            .credential_store
            .delete_credential(&profile.credential_ref)
            .map_err(|e| e.to_string())?;
    } else {
        state
            .credential_store
            .set_credential(&profile.credential_ref, stream_key.trim())
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri app entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let storage_path = get_storage_path();
    let profile_repo = Arc::new(FileProfileRepository::new(storage_path));
    let credential_store = Arc::new(KeyringCredentialStore::default());

    let app_state = AppState {
        profile_repo,
        credential_store,
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            test_obs_connection,
            list_scenes,
            probe_video_dimensions,
            calculate_pan_limits,
            apply_video_composition,
            get_obs_video_settings,
            set_obs_video_settings,
            get_stream_status,
            start_stream,
            start_profile_stream,
            stop_stream,
            set_stream_key,
            list_profiles,
            get_active_profile,
            set_active_profile,
            create_profile,
            update_profile,
            duplicate_profile,
            delete_profile,
            get_profile_stream_key,
            set_profile_stream_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
