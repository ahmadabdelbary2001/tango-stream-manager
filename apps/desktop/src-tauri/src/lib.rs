use domain::{CropRegion, MediaAssetId, VideoComposition, VideoSource, VideoTransform};
use infrastructure::ObsVideoOutput;
use ports::{FrameSize, StreamConfig, VideoOutputRequest};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Shared connection config
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

// ---------------------------------------------------------------------------
// Video composition payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsConnectionStatus {
    pub connected: bool,
    pub obs_version: Option<String>,
    pub obs_web_socket_version: Option<String>,
    pub rpc_version: Option<u32>,
    pub error_message: Option<String>,
}

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

// ---------------------------------------------------------------------------
// Streaming payloads
// ---------------------------------------------------------------------------

/// Stream status returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamStatusPayload {
    pub active: bool,
    pub timecode: Option<String>,
    pub kbits_per_sec: Option<u64>,
    pub dropped_frames: Option<u64>,
    pub total_frames: Option<u64>,
}

/// Payload used to configure and (optionally) start a stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamConfigPayload {
    pub obs_config: ObsConnectionConfig,
    /// RTMP server URL, e.g. `rtmp://live.twitch.tv/live`
    pub server: String,
    /// Stream key (secret)
    pub stream_key: String,
}

// ---------------------------------------------------------------------------
// Helper: build ObsVideoOutput from connection config
// ---------------------------------------------------------------------------

fn make_output(config: &ObsConnectionConfig) -> Result<ObsVideoOutput, String> {
    ObsVideoOutput::new(&config.host, config.port, config.password.clone())
        .map_err(|e| format!("Failed to initialise OBS adapter: {e}"))
}

// ---------------------------------------------------------------------------
// Tauri commands — connection
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
// Tauri commands — video composition
// ---------------------------------------------------------------------------

#[tauri::command]
async fn apply_video_composition(payload: ApplyCompositionPayload) -> Result<(), String> {
    let source_size = FrameSize::new(payload.source_width, payload.source_height)
        .ok_or_else(|| "Source width and height must be greater than zero".to_string())?;

    let canvas_size = FrameSize::new(payload.canvas_width, payload.canvas_height)
        .ok_or_else(|| "Canvas width and height must be greater than zero".to_string())?;

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
            pan_x: payload.pan_x,
            pan_y: payload.pan_y,
        },
    };

    let request = VideoOutputRequest::new(
        payload.scene_name,
        payload.source_name,
        payload.source_path,
        source_size,
        canvas_size,
        composition,
    );

    let output =
        make_output(&payload.obs_config).map_err(|e| format!("Failed to create OBS output: {e}"))?;

    output
        .apply_video_composition_async(&request)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands — streaming control
// ---------------------------------------------------------------------------

#[tauri::command]
async fn get_stream_status(obs_config: ObsConnectionConfig) -> Result<StreamStatusPayload, String> {
    let output = make_output(&obs_config)?;
    let status = output
        .get_stream_status_async()
        .await
        .map_err(|e| e.to_string())?;

    Ok(StreamStatusPayload {
        active: status.active,
        timecode: status.timecode,
        kbits_per_sec: status.kbits_per_sec,
        dropped_frames: status.dropped_frames,
        total_frames: status.total_frames,
    })
}

#[tauri::command]
async fn start_stream(payload: StreamConfigPayload) -> Result<(), String> {
    let output = make_output(&payload.obs_config)?;

    let config = StreamConfig::new(&payload.server, &payload.stream_key)
        .map_err(|e| e.to_string())?;

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

    let config = StreamConfig::new(&payload.server, &payload.stream_key)
        .map_err(|e| e.to_string())?;

    output
        .set_stream_key_async(&config)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri app entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            test_obs_connection,
            list_scenes,
            apply_video_composition,
            get_stream_status,
            start_stream,
            stop_stream,
            set_stream_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
