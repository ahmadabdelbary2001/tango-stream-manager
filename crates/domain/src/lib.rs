pub mod adaptation;
pub mod media;
pub mod profile;
pub mod video;

pub use adaptation::{AdaptationAction, AdaptiveBitrateController};
pub use media::{MediaAsset, MediaAssetId, MediaVariant, MediaVariantId};
pub use profile::{
    AdaptationConfig, ProfileCompositionConfig, QualityPresetKind, QualitySettings,
    StreamingProfile, StreamingServiceType,
};
pub use video::{
    AspectRatio, CropRegion, VideoComposition, VideoCompositionDraft, VideoSource, VideoTransform,
};
