use domain::{StreamingProfile, VideoComposition};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameSize {
    pub width: u32,
    pub height: u32,
}

impl FrameSize {
    pub fn new(width: u32, height: u32) -> Option<Self> {
        if width == 0 || height == 0 {
            return None;
        }

        Some(Self { width, height })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VideoOutputRequest {
    pub scene_name: String,
    pub source_name: String,
    pub source_path: String,

    pub source_size: FrameSize,
    pub canvas_size: FrameSize,

    pub composition: VideoComposition,
}

impl VideoOutputRequest {
    pub fn new(
        scene_name: impl Into<String>,
        source_name: impl Into<String>,
        source_path: impl Into<String>,
        source_size: FrameSize,
        canvas_size: FrameSize,
        composition: VideoComposition,
    ) -> Self {
        Self {
            scene_name: scene_name.into(),
            source_name: source_name.into(),
            source_path: source_path.into(),
            source_size,
            canvas_size,
            composition,
        }
    }
}

#[derive(Debug, Error)]
pub enum VideoOutputError {
    #[error("video output request is invalid: {0}")]
    InvalidRequest(String),

    #[error("video output backend is unavailable: {0}")]
    BackendUnavailable(String),

    #[error("authentication with video output backend failed: {0}")]
    AuthenticationFailed(String),

    #[error("video output backend failed: {0}")]
    Backend(String),
}

/// Output boundary used by the application layer.
pub trait VideoOutputPort {
    fn apply_video_composition(
        &mut self,
        request: &VideoOutputRequest,
    ) -> Result<(), VideoOutputError>;
}

// ---------------------------------------------------------------------------
// OBS Video Settings & Statistics Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObsVideoSettings {
    pub base_width: u32,
    pub base_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub fps_numerator: u32,
    pub fps_denominator: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExtendedStreamStatus {
    pub active: bool,
    pub reconnecting: bool,
    pub timecode: Option<String>,
    pub duration_seconds: u64,
    pub congestion: f32,
    pub bytes_sent: u64,
    pub kbits_per_sec: Option<u64>,
    pub dropped_frames: u64,
    pub total_frames: u64,

    // Rendering / Engine metrics
    pub cpu_usage: f64,
    pub memory_usage_mb: f64,
    pub active_fps: f64,
    pub render_skipped_frames: u64,
    pub render_total_frames: u64,
    pub average_frame_render_time_ms: f64,
}

// ---------------------------------------------------------------------------
// Streaming Port
// ---------------------------------------------------------------------------

/// Error type for streaming operations.
#[derive(Debug, Error)]
pub enum StreamingError {
    #[error("streaming backend is unavailable: {0}")]
    BackendUnavailable(String),

    #[error("authentication with streaming backend failed: {0}")]
    AuthenticationFailed(String),

    #[error("streaming operation failed: {0}")]
    Backend(String),

    #[error("stream key is invalid: {0}")]
    InvalidStreamKey(String),

    #[error("cannot modify settings while stream is active: {0}")]
    ActiveStreamConflict(String),
}

/// Live stream status as reported by the streaming backend.
#[derive(Debug, Clone, PartialEq)]
pub struct StreamStatus {
    /// Whether the stream is currently active.
    pub active: bool,
    /// Timecode elapsed since stream start (HH:MM:SS), if active.
    pub timecode: Option<String>,
    /// Current output bitrate in Kbps, if available.
    pub kbits_per_sec: Option<u64>,
    /// Number of dropped frames, if available.
    pub dropped_frames: Option<u64>,
    /// Total frames output, if available.
    pub total_frames: Option<u64>,
}

/// Configuration needed to start or update an RTMP stream.
#[derive(Debug, Clone, PartialEq)]
pub struct StreamConfig {
    /// The RTMP server URL, e.g. `rtmp://live.twitch.tv/live`.
    pub server: String,
    /// The stream key (secret). Never logged.
    pub stream_key: String,
}

impl StreamConfig {
    /// Validate that neither `server` nor `stream_key` is empty.
    pub fn new(
        server: impl Into<String>,
        stream_key: impl Into<String>,
    ) -> Result<Self, StreamingError> {
        let server = server.into();
        let stream_key = stream_key.into();

        if server.trim().is_empty() {
            return Err(StreamingError::InvalidStreamKey(
                "RTMP server URL cannot be empty".into(),
            ));
        }
        if stream_key.trim().is_empty() {
            return Err(StreamingError::InvalidStreamKey(
                "stream key cannot be empty".into(),
            ));
        }

        Ok(Self { server, stream_key })
    }
}

/// Streaming boundary port — implemented by the OBS adapter (or test fakes).
pub trait StreamingPort {
    /// Query the current live stream status.
    fn get_stream_status(&self) -> Result<StreamStatus, StreamingError>;

    /// Query comprehensive stream health and render engine statistics.
    fn get_extended_stream_status(&self) -> Result<ExtendedStreamStatus, StreamingError>;

    /// Retrieve current OBS canvas base and output dimensions and framerate.
    fn get_video_settings(&self) -> Result<ObsVideoSettings, StreamingError>;

    /// Configure OBS canvas and stream output dimensions and framerate.
    ///
    /// Must fail with `ActiveStreamConflict` if called while streaming is active.
    fn set_video_settings(&self, settings: &ObsVideoSettings) -> Result<(), StreamingError>;

    /// Update the RTMP service settings (server + key) and start the stream.
    fn start_stream(&self, config: &StreamConfig) -> Result<(), StreamingError>;

    /// Stop the active stream gracefully.
    fn stop_stream(&self) -> Result<(), StreamingError>;

    /// Update the RTMP stream key without starting/stopping the stream.
    fn set_stream_key(&self, config: &StreamConfig) -> Result<(), StreamingError>;
}

// ---------------------------------------------------------------------------
// Streaming Profile Repository Port
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum ProfileStorageError {
    #[error("failed to read profile storage: {0}")]
    ReadError(String),

    #[error("failed to write profile storage: {0}")]
    WriteError(String),

    #[error("profile serialization failed: {0}")]
    SerializationError(String),

    #[error("profile not found: {0}")]
    NotFound(String),
}

pub trait ProfileRepositoryPort: Send + Sync {
    fn list_profiles(&self) -> Result<Vec<StreamingProfile>, ProfileStorageError>;
    fn get_profile(&self, id: &str) -> Result<Option<StreamingProfile>, ProfileStorageError>;
    fn save_profile(&self, profile: &StreamingProfile) -> Result<(), ProfileStorageError>;
    fn delete_profile(&self, id: &str) -> Result<bool, ProfileStorageError>;
    fn get_active_profile_id(&self) -> Result<Option<String>, ProfileStorageError>;
    fn set_active_profile_id(&self, id: &str) -> Result<(), ProfileStorageError>;
}

// ---------------------------------------------------------------------------
// Secure Credential Storage Port
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("secure credential store is unavailable: {0}")]
    Unavailable(String),

    #[error("failed to access credential store: {0}")]
    StorageError(String),

    #[error("credential key reference is invalid: {0}")]
    InvalidReference(String),
}

pub trait CredentialStorePort: Send + Sync {
    fn get_credential(&self, key_ref: &str) -> Result<Option<String>, CredentialError>;
    fn set_credential(&self, key_ref: &str, secret: &str) -> Result<(), CredentialError>;
    fn delete_credential(&self, key_ref: &str) -> Result<(), CredentialError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{MediaAssetId, VideoSource, VideoTransform};

    fn composition() -> VideoComposition {
        VideoComposition {
            source: VideoSource::Original {
                asset_id: MediaAssetId("video-1".into()),
            },
            crop: None,
            transform: VideoTransform::default(),
        }
    }

    #[test]
    fn frame_size_rejects_zero_dimensions() {
        assert!(FrameSize::new(0, 1280).is_none());
        assert!(FrameSize::new(720, 0).is_none());
    }

    #[test]
    fn frame_size_accepts_valid_dimensions() {
        assert_eq!(
            FrameSize::new(720, 1280),
            Some(FrameSize {
                width: 720,
                height: 1280,
            })
        );
    }

    #[test]
    fn output_request_preserves_composition() {
        let source_size = FrameSize::new(568, 762).unwrap();
        let canvas_size = FrameSize::new(720, 1280).unwrap();

        let request = VideoOutputRequest::new(
            "Tango Scene",
            "Tango Video",
            "E:\\video.mp4",
            source_size,
            canvas_size,
            composition(),
        );

        assert_eq!(request.scene_name, "Tango Scene");
        assert_eq!(request.source_name, "Tango Video");
        assert_eq!(request.source_size, source_size);
        assert_eq!(request.canvas_size, canvas_size);
    }

    #[test]
    fn stream_config_rejects_empty_server() {
        assert!(StreamConfig::new("", "my-key").is_err());
    }

    #[test]
    fn stream_config_rejects_empty_key() {
        assert!(StreamConfig::new("rtmp://live.twitch.tv/live", "").is_err());
    }

    #[test]
    fn stream_config_accepts_valid_inputs() {
        let cfg = StreamConfig::new("rtmp://live.twitch.tv/live", "abc123").unwrap();
        assert_eq!(cfg.server, "rtmp://live.twitch.tv/live");
        assert_eq!(cfg.stream_key, "abc123");
    }
}
