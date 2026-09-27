use domain::{
    CropRegion,
    VideoComposition,
    VideoCompositionDraft,
    VideoTransform,
};

use thiserror::Error;

use video_composition::{
    preview_to_source,
    CompositionError,
    Rect,
    Size,
    VideoTransform as MathVideoTransform,
};

#[derive(Debug, Clone)]
pub struct ApplyVideoCropCommand {
    pub draft: VideoCompositionDraft,
    pub source_size: Size,
    pub canvas_size: Size,
    pub crop_frame: Rect,
}

#[derive(Debug, Error)]
pub enum ApplyVideoCropError {
    #[error("crop mode is not active")]
    CropModeNotActive,

    #[error(
        "crop frame aspect ratio does not match the selected crop aspect ratio"
    )]
    CropAspectRatioMismatch,

    #[error("calculated crop region is invalid")]
    InvalidCropRegion,

    #[error(transparent)]
    Composition(#[from] CompositionError),
}

pub struct ApplyVideoCrop;

impl ApplyVideoCrop {
    pub fn execute(
        command: ApplyVideoCropCommand,
    ) -> Result<VideoComposition, ApplyVideoCropError> {
        let aspect_ratio = command
            .draft
            .crop_aspect_ratio
            .ok_or(
                ApplyVideoCropError::CropModeNotActive
            )?;

        let frame_ratio =
            command.crop_frame.width
                / command.crop_frame.height;

        let expected_ratio =
            aspect_ratio.value();

        const EPSILON: f64 = 1e-6;

        if !frame_ratio.is_finite()
            || (frame_ratio - expected_ratio).abs()
                > EPSILON
        {
            return Err(
                ApplyVideoCropError::CropAspectRatioMismatch,
            );
        }

        let math_transform =
            MathVideoTransform::new(
                command.draft.transform.zoom,
                command.draft.transform.pan_x,
                command.draft.transform.pan_y,
            );

        let result = preview_to_source(
            command.source_size,
            command.canvas_size,
            math_transform,
            command.crop_frame,
        )?;

        let source = command.source_size;

        let crop = CropRegion::new(
            result.crop.left / source.width,
            result.crop.top / source.height,
            result.crop.right / source.width,
            result.crop.bottom / source.height,
        )
        .ok_or(
            ApplyVideoCropError::InvalidCropRegion
        )?;

        Ok(VideoComposition {
            source: command.draft.source,
            crop: Some(crop),

            // Crop has now been committed.
            // Runtime pan/zoom starts again from neutral.
            transform: VideoTransform::default(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use domain::{
        AspectRatio,
        MediaAssetId,
        VideoSource,
    };

    fn source_size() -> Size {
        Size::new(568.0, 762.0)
    }

    fn canvas_size() -> Size {
        Size::new(720.0, 1280.0)
    }

    fn crop_frame() -> Rect {
        Rect::new(
            180.0,
            160.0,
            360.0,
            640.0,
        )
    }

    fn draft() -> VideoCompositionDraft {
        VideoCompositionDraft {
            source: VideoSource::Original {
                asset_id: MediaAssetId(
                    "video-1".into()
                ),
            },

            crop_aspect_ratio:
                Some(
                    AspectRatio::new(
                        720,
                        1280,
                    )
                    .unwrap(),
                ),

            transform: domain::VideoTransform {
                zoom: 1.2,
                pan_x: -70.0,
                pan_y: 25.0,
            },
        }
    }

    #[test]
    fn applies_crop_and_normalizes_source_coordinates() {
        let command =
            ApplyVideoCropCommand {
                draft: draft(),
                source_size:
                    source_size(),
                canvas_size:
                    canvas_size(),
                crop_frame:
                    crop_frame(),
            };

        let composition =
            ApplyVideoCrop::execute(
                command
            )
            .unwrap();

        let crop =
            composition.crop.unwrap();

        assert!(
            (crop.left
                - 0.4039255061619718)
                .abs()
                < 0.0001
        );

        assert!(
            (crop.top
                - 0.17122395833333334)
                .abs()
                < 0.0001
        );

        assert!(
            (crop.right
                - 0.28164887764084506)
                .abs()
                < 0.0001
        );

        assert!(
            (crop.bottom
                - 0.412109375)
                .abs()
                < 0.0001
        );

        assert_eq!(
            composition.transform,
            VideoTransform::default()
        );
    }

    #[test]
    fn crop_requires_crop_mode() {
        let mut draft = draft();

        draft.crop_aspect_ratio = None;

        let command =
            ApplyVideoCropCommand {
                draft,
                source_size:
                    source_size(),
                canvas_size:
                    canvas_size(),
                crop_frame:
                    crop_frame(),
            };

        let error =
            ApplyVideoCrop::execute(
                command
            )
            .unwrap_err();

        assert!(matches!(
            error,
            ApplyVideoCropError::CropModeNotActive
        ));
    }

    #[test]
    fn crop_frame_must_match_selected_aspect_ratio() {
        let mut draft = draft();

        draft.crop_aspect_ratio =
            Some(
                AspectRatio::new(
                    16,
                    9,
                )
                .unwrap(),
            );

        let command =
            ApplyVideoCropCommand {
                draft,
                source_size:
                    source_size(),
                canvas_size:
                    canvas_size(),
                crop_frame:
                    crop_frame(),
            };

        let error =
            ApplyVideoCrop::execute(
                command
            )
            .unwrap_err();

        assert!(matches!(
            error,
            ApplyVideoCropError::CropAspectRatioMismatch
        ));
    }
}