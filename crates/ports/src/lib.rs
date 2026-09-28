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
}
