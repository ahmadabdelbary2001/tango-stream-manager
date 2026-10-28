use domain::VideoComposition;
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
///
/// The application knows about a generic video output.
/// It does not know whether the implementation is OBS,
/// another renderer, or a test fake.
pub trait VideoOutputPort {
    fn apply_video_composition(
        &mut self,
        request: &VideoOutputRequest,
    ) -> Result<(), VideoOutputError>;
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
}

/// Live stream status as reported by the streaming backend.
#[derive(Debug, Clone, PartialEq)]
pub struct StreamStatus {
    /// Whether the stream is currently active.
    pub active: bool,
    /// Timecode elapsed since stream start (HH:MM:SS.mmm), if active.
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
///
/// Sync wrappers are used here; the OBS infrastructure adapter uses its
/// internal Tokio runtime to fulfil these contracts.
pub trait StreamingPort {
    /// Query the current live stream status.
    fn get_stream_status(&self) -> Result<StreamStatus, StreamingError>;

    /// Update the RTMP service settings (server + key) and start the stream.
    ///
    /// If the stream is already active this is a no-op (returns `Ok(())`).
    fn start_stream(&self, config: &StreamConfig) -> Result<(), StreamingError>;

    /// Stop the active stream gracefully.
    ///
    /// If the stream is already stopped this is a no-op (returns `Ok(())`).
    fn stop_stream(&self) -> Result<(), StreamingError>;

    /// Update the RTMP stream key without starting/stopping the stream.
    fn set_stream_key(&self, config: &StreamConfig) -> Result<(), StreamingError>;
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
