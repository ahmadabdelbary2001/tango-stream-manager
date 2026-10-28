use serde::{Deserialize, Serialize};

/// Supported streaming service destination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StreamingServiceType {
    /// Official Tango live broadcast via Tango Web Desk ingest
    Tango,
    /// Generic or custom RTMP streaming endpoint
    CustomRtmp,
}

impl Default for StreamingServiceType {
    fn default() -> Self {
        Self::Tango
    }
}

fn default_rescale_output_width() -> u32 {
    720
}
fn default_rescale_output_height() -> u32 {
    1280
}
fn default_rescale_filter() -> String {
    "lanczos".to_string()
}

/// Encoding and video/audio quality settings for a streaming profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualitySettings {
    /// Encoded stream output width (e.g. 720, 1080)
    pub output_width: u32,
    /// Encoded stream output height (e.g. 1280, 1920)
    pub output_height: u32,
    /// Output framerate in frames per second (e.g. 30, 60)
    pub fps: u32,
    /// Target video bitrate in Kbps (e.g. 2500, 1500, 800)
    pub video_bitrate_kbps: u32,
    /// Target audio bitrate in Kbps (e.g. 128, 96, 64)
    pub audio_bitrate_kbps: u32,
    /// Encoder selection (e.g. "obs_x264", "jim_nvenc", "h264_nvenc", "apple", "auto")
    pub encoder: String,
    /// Rate control (CBR recommended for RTMP streaming)
    pub rate_control: String,
    /// Keyframe interval in seconds (default 2s for RTMP)
    pub keyframe_interval_sec: u32,
    /// Whether Advanced Output streaming rescales the encoded stream.
    #[serde(default)]
    pub rescale_output_enabled: bool,
    /// Streaming rescale width in Advanced Output mode.
    #[serde(default = "default_rescale_output_width")]
    pub rescale_output_width: u32,
    /// Streaming rescale height in Advanced Output mode.
    #[serde(default = "default_rescale_output_height")]
    pub rescale_output_height: u32,
    /// OBS downscale filter: point, bicubic, bilinear, lanczos, or area.
    #[serde(default = "default_rescale_filter")]
    pub rescale_filter: String,
    /// OBS network option: dynamically reduce bitrate during congestion.
    #[serde(default)]
    pub dynamic_bitrate_enabled: bool,
}

impl Default for QualitySettings {
    fn default() -> Self {
        // Standard Balanced starting recommendation for portrait mobile streaming (720x1280 @ 30fps)
        Self {
            output_width: 720,
            output_height: 1280,
            fps: 30,
            video_bitrate_kbps: 2500,
            audio_bitrate_kbps: 128,
            encoder: "obs_x264".into(),
            rate_control: "CBR".into(),
            keyframe_interval_sec: 2,
            rescale_output_enabled: false,
            rescale_output_width: 720,
            rescale_output_height: 1280,
            rescale_filter: "lanczos".into(),
            dynamic_bitrate_enabled: false,
        }
    }
}

/// Quality presets as starting recommendations (not hard-coded Tango limits).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QualityPresetKind {
    Balanced,
    LowBandwidth,
    VeryLowBandwidth,
}

impl QualityPresetKind {
    pub fn settings(self) -> QualitySettings {
        match self {
            Self::Balanced => QualitySettings {
                output_width: 720,
                output_height: 1280,
                fps: 30,
                video_bitrate_kbps: 2500,
                audio_bitrate_kbps: 128,
                encoder: "obs_x264".into(),
                rate_control: "CBR".into(),
                keyframe_interval_sec: 2,
                rescale_output_enabled: false,
                rescale_output_width: 720,
                rescale_output_height: 1280,
                rescale_filter: "lanczos".into(),
                dynamic_bitrate_enabled: false,
            },
            Self::LowBandwidth => QualitySettings {
                output_width: 720,
                output_height: 1280,
                fps: 30,
                video_bitrate_kbps: 1500,
                audio_bitrate_kbps: 96,
                encoder: "obs_x264".into(),
                rate_control: "CBR".into(),
                keyframe_interval_sec: 2,
                rescale_output_enabled: false,
                rescale_output_width: 720,
                rescale_output_height: 1280,
                rescale_filter: "lanczos".into(),
                dynamic_bitrate_enabled: false,
            },
            Self::VeryLowBandwidth => QualitySettings {
                output_width: 540,
                output_height: 960,
                fps: 25,
                video_bitrate_kbps: 800,
                audio_bitrate_kbps: 64,
                encoder: "obs_x264".into(),
                rate_control: "CBR".into(),
                keyframe_interval_sec: 2,
                rescale_output_enabled: false,
                rescale_output_width: 720,
                rescale_output_height: 1280,
                rescale_filter: "lanczos".into(),
                dynamic_bitrate_enabled: false,
            },
        }
    }
}

/// Non-secret OBS WebSocket connection settings owned by one profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProfileObsConnection {
    pub host: String,
    pub port: u16,
}

impl Default for ProfileObsConnection {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 4455,
        }
    }
}

/// Crop region saved with a profile. Values are normalized fractions from 0.0 to 1.0.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ProfileCropConfig {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

/// Scene, media source, canvas, and composition values owned by one profile.
/// serde(default) keeps profile files created by older application versions loadable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProfileCompositionConfig {
    pub scene_name: String,
    pub source_name: String,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub source_path: String,
    pub source_width: u32,
    pub source_height: u32,
    pub zoom: f64,
    pub pan_x: f64,
    pub pan_y: f64,
    pub has_crop: bool,
    pub crop: Option<ProfileCropConfig>,
    /// Whether local OBS audio monitoring is disabled for the saved source.
    pub silent_mode_enabled: bool,
    /// OBS input whose previous monitor type is saved while silent mode is active.
    pub silent_mode_source_name: String,
    /// OBS monitor type to restore when silent mode is disabled.
    pub silent_mode_restore_monitor_type: String,
}

impl Default for ProfileCompositionConfig {
    fn default() -> Self {
        Self {
            scene_name: "Tango Scene".into(),
            source_name: "Tango Video".into(),
            canvas_width: 720,
            canvas_height: 1280,
            source_path: String::new(),
            source_width: 568,
            source_height: 762,
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
            has_crop: false,
            crop: Some(ProfileCropConfig {
                left: 0.1,
                top: 0.1,
                right: 0.1,
                bottom: 0.1,
            }),
            silent_mode_enabled: false,
            silent_mode_source_name: String::new(),
            silent_mode_restore_monitor_type: "OBS_MONITORING_TYPE_NONE".into(),
        }
    }
}

/// Adaptive bitrate controller preferences.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdaptationConfig {
    pub enabled: bool,
    pub min_bitrate_kbps: u32,
    pub max_bitrate_kbps: u32,
    pub step_down_kbps: u32,
    pub step_up_kbps: u32,
    pub down_congestion_threshold: f32,
    pub cooldown_seconds: u32,
}

impl Default for AdaptationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            min_bitrate_kbps: 800,
            max_bitrate_kbps: 3500,
            step_down_kbps: 300,
            step_up_kbps: 150,
            down_congestion_threshold: 0.25,
            cooldown_seconds: 15,
        }
    }
}

/// A Tango Stream Manager profile.
///
/// NOTE: Non-sensitive profile data is stored in the profile repository.
/// Secrets (stream keys) are NEVER stored in this struct or on disk in plaintext;
/// they are keyed securely in the OS credential store under `credential_ref`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreamingProfile {
    pub id: String,
    pub name: String,
    pub service_type: StreamingServiceType,
    pub server_url: String,
    /// Stable credential key reference for the profile stream key.
    pub credential_ref: String,
    /// OBS host and port are profile-owned; its password remains in the OS credential vault.
    #[serde(default)]
    pub obs_connection: ProfileObsConnection,
    pub quality: QualitySettings,
    pub composition: ProfileCompositionConfig,
    pub adaptation: AdaptationConfig,
    pub created_at: u64,
    pub updated_at: u64,
}

impl StreamingProfile {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        let id = id.into();
        let name = name.into();
        let credential_ref = format!("tsm_profile_{id}");
        Self {
            id,
            name,
            service_type: StreamingServiceType::Tango,
            server_url: String::new(),
            credential_ref,
            obs_connection: ProfileObsConnection::default(),
            quality: QualitySettings::default(),
            composition: ProfileCompositionConfig::default(),
            adaptation: AdaptationConfig::default(),
            created_at: 0,
            updated_at: 0,
        }
    }

    /// Duplicate this profile with a new ID and name.
    pub fn duplicate(&self, new_id: impl Into<String>, new_name: impl Into<String>) -> Self {
        let id = new_id.into();
        let credential_ref = format!("tsm_profile_{id}");
        Self {
            id,
            name: new_name.into(),
            service_type: self.service_type,
            server_url: self.server_url.clone(),
            credential_ref,
            obs_connection: self.obs_connection.clone(),
            quality: self.quality.clone(),
            composition: self.composition.clone(),
            adaptation: self.adaptation.clone(),
            created_at: 0,
            updated_at: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_profile_uses_tango_service_and_isolated_credential_ref() {
        let p1 = StreamingProfile::new("prof-1", "My Tango Stream");
        let p2 = StreamingProfile::new("prof-2", "Secondary Stream");

        assert_eq!(p1.service_type, StreamingServiceType::Tango);
        assert_eq!(p1.credential_ref, "tsm_profile_prof-1");
        assert_eq!(p2.credential_ref, "tsm_profile_prof-2");
        assert_ne!(p1.credential_ref, p2.credential_ref);
    }

    #[test]
    fn duplicate_profile_generates_isolated_credential_ref() {
        let p = StreamingProfile::new("original-id", "Original");
        let dup = p.duplicate("copy-id", "Original Copy");

        assert_eq!(dup.id, "copy-id");
        assert_eq!(dup.name, "Original Copy");
        assert_eq!(dup.credential_ref, "tsm_profile_copy-id");
        assert_ne!(p.credential_ref, dup.credential_ref);
    }

    #[test]
    fn presets_preserve_portrait_aspect_ratio() {
        for preset in [
            QualityPresetKind::Balanced,
            QualityPresetKind::LowBandwidth,
            QualityPresetKind::VeryLowBandwidth,
        ] {
            let s = preset.settings();
            assert!(
                s.output_height > s.output_width,
                "preset must be portrait for mobile/Tango"
            );
            assert!(s.video_bitrate_kbps > 0);
            assert!(s.fps > 0);
        }
    }
}
