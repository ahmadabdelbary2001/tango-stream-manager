use domain::VideoComposition;
use ports::{FrameSize, VideoOutputError, VideoOutputPort, VideoOutputRequest};
use thiserror::Error;

/// Applies a committed `VideoComposition` to a video output backend.
///
/// The application knows only about the `VideoOutputPort` boundary.
/// It has no knowledge of OBS, WebSocket, or scene item transforms.
pub struct ApplyVideoComposition<'a, P: VideoOutputPort> {
    output: &'a mut P,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ApplyVideoCompositionCommand {
    pub scene_name: String,
    pub source_name: String,
    pub source_path: String,
    pub source_size: FrameSize,
    pub canvas_size: FrameSize,
    pub composition: VideoComposition,
}

#[derive(Debug, Error)]
pub enum ApplyVideoCompositionError {
    #[error("video output failed: {0}")]
    Output(#[from] VideoOutputError),
}

impl<'a, P: VideoOutputPort> ApplyVideoComposition<'a, P> {
    pub fn new(output: &'a mut P) -> Self {
        Self { output }
    }

    pub fn execute(
        &mut self,
        command: ApplyVideoCompositionCommand,
    ) -> Result<(), ApplyVideoCompositionError> {
        let request = VideoOutputRequest::new(
            command.scene_name,
            command.source_name,
            command.source_path,
            command.source_size,
            command.canvas_size,
            command.composition,
        );

        self.output.apply_video_composition(&request)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{CropRegion, MediaAssetId, VideoSource, VideoTransform};

    #[derive(Default)]
    struct FakeOutput {
        last_scene: Option<String>,
        last_source: Option<String>,
        last_crop: Option<Option<CropRegion>>,
        last_zoom: Option<f64>,
        next_error: Option<VideoOutputError>,
    }

    impl VideoOutputPort for FakeOutput {
        fn apply_video_composition(
            &mut self,
            request: &VideoOutputRequest,
        ) -> Result<(), VideoOutputError> {
            self.last_scene = Some(request.scene_name.clone());
            self.last_source = Some(request.source_name.clone());
            self.last_crop = Some(request.composition.crop.clone());
            self.last_zoom = Some(request.composition.transform.zoom);

            match self.next_error.take() {
                Some(err) => Err(err),
                None => Ok(()),
            }
        }
    }

    fn command() -> ApplyVideoCompositionCommand {
        ApplyVideoCompositionCommand {
            scene_name: "Tango Scene".into(),
            source_name: "Tango Video".into(),
            source_path: "E:\\video.mp4".into(),
            source_size: FrameSize::new(568, 762).unwrap(),
            canvas_size: FrameSize::new(720, 1280).unwrap(),
            composition: VideoComposition {
                source: VideoSource::Original {
                    asset_id: MediaAssetId("video-1".into()),
                },
                crop: CropRegion::new(0.10, 0.0, 0.10, 0.0),
                transform: VideoTransform {
                    zoom: 1.5,
                    pan_x: 20.0,
                    pan_y: -15.0,
                },
            },
        }
    }

    #[test]
    fn forwards_request_fields_to_output_port() {
        let mut output = FakeOutput::default();
        let mut use_case = ApplyVideoComposition::new(&mut output);

        use_case.execute(command()).expect("apply must succeed");

        assert_eq!(output.last_scene.as_deref(), Some("Tango Scene"));
        assert_eq!(output.last_source.as_deref(), Some("Tango Video"));
        assert_eq!(output.last_zoom, Some(1.5));
        assert!(output.last_crop.unwrap().is_some());
    }

    #[test]
    fn propagates_output_errors() {
        let mut output = FakeOutput {
            next_error: Some(VideoOutputError::BackendUnavailable("boom".into())),
            ..Default::default()
        };
        let mut use_case = ApplyVideoComposition::new(&mut output);

        let err = use_case.execute(command()).expect_err("must fail");

        match err {
            ApplyVideoCompositionError::Output(VideoOutputError::BackendUnavailable(msg)) => {
                assert_eq!(msg, "boom");
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }
}
