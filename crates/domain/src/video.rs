use serde::{Deserialize, Serialize};

use crate::{
    MediaAssetId,
    MediaVariantId,
};

/// An aspect ratio represented as a simplified integer ratio.
///
/// Examples:
/// - 720x1280 -> 9:16
/// - 1920x1080 -> 16:9
/// - 1080x1080 -> 1:1
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
)]
pub struct AspectRatio {
    pub width: u32,
    pub height: u32,
}

impl AspectRatio {
    pub fn new(
        width: u32,
        height: u32,
    ) -> Option<Self> {
        if width == 0 || height == 0 {
            return None;
        }

        let divisor = gcd(width, height);

        Some(Self {
            width: width / divisor,
            height: height / divisor,
        })
    }

    pub fn value(self) -> f64 {
        self.width as f64
            / self.height as f64
    }
}

fn gcd(
    mut a: u32,
    mut b: u32,
) -> u32 {
    while b != 0 {
        let remainder = a % b;
        a = b;
        b = remainder;
    }

    a
}

/// Identifies which media resource is used by a composition.
///
/// Original asset:
///     video1.mp4
///
/// Variant:
///     a previously prepared/cropped version of that asset.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
)]
pub enum VideoSource {
    Original {
        asset_id: MediaAssetId,
    },

    Variant {
        asset_id: MediaAssetId,
        variant_id: MediaVariantId,
    },
}

/// Crop region in normalized source coordinates.
///
/// All values are in the range [0, 1].
///
/// Example:
///
/// left   = 0.1
/// top    = 0.0
/// right  = 0.1
/// bottom = 0.0
///
/// means 10% cropped from both left and right.
///
/// We deliberately do NOT store OBS pixel crop values here.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Serialize,
    Deserialize,
)]
pub struct CropRegion {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

impl CropRegion {
    pub fn new(
        left: f64,
        top: f64,
        right: f64,
        bottom: f64,
    ) -> Option<Self> {
        let region = Self {
            left,
            top,
            right,
            bottom,
        };

        if region.is_valid() {
            Some(region)
        } else {
            None
        }
    }

    pub fn is_valid(self) -> bool {
        self.left >= 0.0
            && self.left <= 1.0
            && self.top >= 0.0
            && self.top <= 1.0
            && self.right >= 0.0
            && self.right <= 1.0
            && self.bottom >= 0.0
            && self.bottom <= 1.0
            && self.left + self.right < 1.0
            && self.top + self.bottom < 1.0
    }
}

/// User-controlled runtime transform.
///
/// Rotation is intentionally absent from the model.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Serialize,
    Deserialize,
)]
pub struct VideoTransform {
    /// 1.0 = normal size.
    ///
    /// Values greater than 1.0 zoom into the video.
    pub zoom: f64,

    /// Horizontal offset relative to the canvas center.
    pub pan_x: f64,

    /// Vertical offset relative to the canvas center.
    pub pan_y: f64,
}

impl Default for VideoTransform {
    fn default() -> Self {
        Self {
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
        }
    }
}

/// The committed runtime composition.
///
/// This is what a streaming session actually uses.
///
/// `crop = None` means the original/selected media is used
/// without a runtime crop.
///
/// `transform` always exists because zoom/pan are optional
/// values with a neutral default.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
)]
pub struct VideoComposition {
    pub source: VideoSource,

    pub crop: Option<CropRegion>,

    pub transform: VideoTransform,
}

/// Temporary editor state.
///
/// This is intentionally NOT the committed composition.
///
/// The crop aspect ratio is selected first, while the user
/// can still move/zoom the video underneath the crop frame.
///
/// The actual CropRegion is calculated only when the user
/// presses "Apply Crop".
#[derive(
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
)]
pub struct VideoCompositionDraft {
    pub source: VideoSource,

    /// None means Crop mode is not active.
    pub crop_aspect_ratio: Option<AspectRatio>,

    pub transform: VideoTransform,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aspect_ratio_720x1280_becomes_9x16() {
        let ratio =
            AspectRatio::new(720, 1280)
                .unwrap();

        assert_eq!(
            ratio,
            AspectRatio {
                width: 9,
                height: 16,
            }
        );
    }

    #[test]
    fn aspect_ratio_1920x1080_becomes_16x9() {
        let ratio =
            AspectRatio::new(1920, 1080)
                .unwrap();

        assert_eq!(
            ratio,
            AspectRatio {
                width: 16,
                height: 9,
            }
        );
    }

    #[test]
    fn zero_aspect_ratio_is_invalid() {
        assert!(
            AspectRatio::new(0, 1280)
                .is_none()
        );

        assert!(
            AspectRatio::new(720, 0)
                .is_none()
        );
    }

    #[test]
    fn valid_crop_region_is_accepted() {
        let crop =
            CropRegion::new(
                0.1,
                0.0,
                0.1,
                0.0,
            )
            .unwrap();

        assert!(crop.is_valid());
    }

    #[test]
    fn crop_region_cannot_remove_entire_axis() {
        assert!(
            CropRegion::new(
                0.5,
                0.0,
                0.5,
                0.0,
            )
            .is_none()
        );

        assert!(
            CropRegion::new(
                0.0,
                0.5,
                0.0,
                0.5,
            )
            .is_none()
        );
    }

    #[test]
    fn default_transform_is_neutral() {
        assert_eq!(
            VideoTransform::default(),
            VideoTransform {
                zoom: 1.0,
                pan_x: 0.0,
                pan_y: 0.0,
            }
        );
    }

    #[test]
    fn draft_can_represent_crop_mode_without_committing_crop() {
        let draft =
            VideoCompositionDraft {
                source:
                    VideoSource::Original {
                        asset_id:
                            MediaAssetId(
                                "video-1".into(),
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

                transform:
                    VideoTransform {
                        zoom: 1.2,
                        pan_x: -70.0,
                        pan_y: 25.0,
                    },
            };

        assert_eq!(
            draft
                .crop_aspect_ratio
                .unwrap(),
            AspectRatio {
                width: 9,
                height: 16,
            }
        );

        assert_eq!(
            draft.transform.zoom,
            1.2
        );

        assert_eq!(
            draft.transform.pan_x,
            -70.0
        );
    }
}