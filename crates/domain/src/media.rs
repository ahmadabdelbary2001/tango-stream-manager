use serde::{Deserialize, Serialize};

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
)]
pub struct MediaAssetId(pub String);

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
)]
pub struct MediaVariantId(pub String);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaAsset {
    pub id: MediaAssetId,
    pub name: String,
    pub path: String,

    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaVariant {
    pub id: MediaVariantId,

    pub source_asset_id: MediaAssetId,

    pub name: String,
    pub path: String,

    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
}