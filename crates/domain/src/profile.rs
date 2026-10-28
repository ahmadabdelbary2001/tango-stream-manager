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
            },
        }
    }
}

/// Scene, source, and canvas geometry preferences for a profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileCompositionConfig {
    pub scene_name: String,
    pub source_name: String,
    pub canvas_width: u32,
    pub canvas_height: u32,
}

impl Default for ProfileCompositionConfig {
    fn default() -> Self {
        Self {
            scene_name: "Tango Scene".into(),
            source_name: "Tango Video".into(),
            canvas_width: 720,
            canvas_height: 1280,
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
    /// Stable credential key reference for OS credential vault (e.g. "tsm_profile_<id>")
    pub credential_ref: String,
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
