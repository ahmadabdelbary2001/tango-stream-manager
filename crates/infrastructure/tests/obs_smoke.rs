//! Manual smoke test against a real OBS instance.
//!
//! Requirements:
//! - OBS Studio running with obs-websocket enabled
//! - The scene/source named below already exist
//!
//! Environment:
//! - OBS_WS_HOST      (default: 127.0.0.1)
//! - OBS_WS_PORT      (default: 4455)
//! - OBS_WS_PASSWORD  (required)
//! - OBS_TEST_SCENE   (default: "Tango Scene")
//! - OBS_TEST_SOURCE  (default: "Tango Video")
//!
//! Run with:
//!   cargo test -p infrastructure --test obs_smoke -- --ignored --nocapture

use domain::{CropRegion, MediaAssetId, VideoComposition, VideoSource, VideoTransform};
use infrastructure::ObsVideoOutput;
use ports::{FrameSize, VideoOutputPort, VideoOutputRequest};

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[test]
#[ignore = "requires a running OBS instance"]
fn applies_crop_against_real_obs() {
    let host = env_or("OBS_WS_HOST", "127.0.0.1");
    let port: u16 = env_or("OBS_WS_PORT", "4455")
        .parse()
        .expect("invalid OBS_WS_PORT");

    let password = std::env::var("OBS_WS_PASSWORD").expect("OBS_WS_PASSWORD env var must be set");

    let scene_name = env_or("OBS_TEST_SCENE", "Tango Scene");
    let source_name = env_or("OBS_TEST_SOURCE", "Tango Video");

    let source_size = FrameSize::new(568, 762).unwrap();
    let canvas_size = FrameSize::new(720, 1280).unwrap();

    // Crop 10% off each side. Amount cropped, not kept-region bounds.
    // Valid because 0.10 + 0.10 < 1.0 on both axes.
    let crop = CropRegion::new(0.10, 0.10, 0.10, 0.10).expect("invalid crop region");

    let composition = VideoComposition {
        source: VideoSource::Original {
            asset_id: MediaAssetId("obs-smoke-video".into()),
        },
        crop: Some(crop),
        transform: VideoTransform::default(),
    };

    let request = VideoOutputRequest::new(
        scene_name.clone(),
        source_name.clone(),
        "E:\\smoke.mp4",
        source_size,
        canvas_size,
        composition,
    );

    let mut output = ObsVideoOutput::new(&host, port, Some(password))
        .expect("failed to construct ObsVideoOutput");

    output
        .apply_video_composition(&request)
        .expect("apply_video_composition failed");

    eprintln!(
        "[OK] Applied 10% crop to scene='{}' source='{}'. Verify in OBS UI.",
        scene_name, source_name
    );
}
