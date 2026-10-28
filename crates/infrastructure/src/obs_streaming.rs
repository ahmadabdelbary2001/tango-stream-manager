use domain::QualitySettings;
use obws::common::MonitorType;
use obws::requests::config::SetVideoSettings;
use obws::requests::profiles::SetParameter;
use ports::{
    ExtendedStreamStatus, ObsVideoSettings, StreamConfig, StreamStatus, StreamingError,
    StreamingPort,
};
use serde::Serialize;

use crate::ObsVideoOutput;

/// RTMP custom stream service settings payload for OBS WebSocket.
#[derive(Debug, Serialize)]
struct RtmpCustomSettings<'a> {
    server: &'a str,
    key: &'a str,
}

/// OBS streaming-output and network settings as read from the active OBS profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObsStreamingOutputOptions {
    pub output_mode: String,
    pub rescale_output_enabled: bool,
    pub rescale_output_width: u32,
    pub rescale_output_height: u32,
    pub rescale_filter: String,
    pub dynamic_bitrate_enabled: bool,
}

/// Result of changing an input's local OBS audio-monitoring route.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObsLocalSilentModeResult {
    pub source_name: String,
    pub silent_mode_enabled: bool,
    pub current_monitor_type: String,
    pub restore_monitor_type: Option<String>,
    pub input_muted: bool,
}

impl ObsVideoOutput {
    // ------------------------------------------------------------------
    // Async streaming helpers (called by Tauri commands directly)
    // ------------------------------------------------------------------

    async fn output_read_profile_parameter(
        client: &obws::Client,
        category: &str,
        name: &str,
    ) -> Result<Option<String>, StreamingError> {
        client
            .profiles()
            .parameter(category, name)
            .await
            .map(|parameter| parameter.value.or(parameter.default_value))
            .map_err(|error| {
                StreamingError::Backend(format!(
                    "failed to read OBS profile parameter {category}.{name}: {error}"
                ))
            })
    }

    async fn output_write_profile_parameter(
        client: &obws::Client,
        category: &str,
        name: &str,
        value: Option<&str>,
    ) -> Result<(), StreamingError> {
        client
            .profiles()
            .set_parameter(SetParameter {
                category,
                name,
                value,
            })
            .await
            .map_err(|error| {
                StreamingError::Backend(format!(
                    "failed to write OBS profile parameter {category}.{name}: {error}"
                ))
            })
    }

    async fn output_rollback_parameters(
        client: &obws::Client,
        previous: &[(&str, &str, Option<String>)],
    ) {
        for (category, name, value) in previous {
            if let Err(error) =
                Self::output_write_profile_parameter(client, category, name, value.as_deref()).await
            {
                eprintln!("OBS output-options rollback failed for {category}.{name}: {error}");
            }
        }
    }

    fn parse_obs_bool(value: Option<String>, key: &str) -> Result<bool, StreamingError> {
        let Some(value) = value else {
            return Ok(false);
        };
        let normalized = value.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "true" | "1" | "yes" => Ok(true),
            "false" | "0" | "no" | "" => Ok(false),
            other => Err(StreamingError::Backend(format!(
                "OBS returned an unexpected boolean for {key}: '{other}'"
            ))),
        }
    }

    fn rescale_filter_id(name: &str) -> Result<u32, StreamingError> {
        match name.trim().to_ascii_lowercase().as_str() {
            "point" => Ok(1),
            "bicubic" => Ok(2),
            "bilinear" => Ok(3),
            "lanczos" => Ok(4),
            "area" => Ok(5),
            other => Err(StreamingError::Backend(format!(
                "Unsupported OBS rescale filter '{other}'. Choose Point, Bicubic, Bilinear, Lanczos, or Area."
            ))),
        }
    }

    fn rescale_filter_name(id: u32) -> Option<&'static str> {
        match id {
            1 => Some("point"),
            2 => Some("bicubic"),
            3 => Some("bilinear"),
            4 => Some("lanczos"),
            5 => Some("area"),
            _ => None,
        }
    }

    async fn read_streaming_output_options(
        client: &obws::Client,
    ) -> Result<ObsStreamingOutputOptions, StreamingError> {
        let mode = Self::output_read_profile_parameter(client, "Output", "Mode")
            .await?
            .unwrap_or_else(|| "Simple".to_string());
        let dynamic_bitrate = Self::parse_obs_bool(
            Self::output_read_profile_parameter(client, "Output", "DynamicBitrate").await?,
            "Output.DynamicBitrate",
        )?;
        let filter_text = Self::output_read_profile_parameter(client, "AdvOut", "RescaleFilter")
            .await?
            .unwrap_or_else(|| "0".to_string());
        let filter_id = filter_text.trim().parse::<u32>().unwrap_or(0);
        let filter_name = Self::rescale_filter_name(filter_id)
            .unwrap_or("lanczos")
            .to_string();
        let rescale_enabled = filter_id != 0;
        let rescale_resolution =
            Self::output_read_profile_parameter(client, "AdvOut", "RescaleRes").await?;
        let fallback_video = client.config().video_settings().await.map_err(|error| {
            StreamingError::Backend(format!(
                "failed to read current video settings while reading streaming output options: {error}"
            ))
        })?;
        let parsed = rescale_resolution.as_deref().and_then(|value| {
            let (width, height) = value.split_once('x')?;
            let width = width.trim().parse::<u32>().ok()?;
            let height = height.trim().parse::<u32>().ok()?;
            if width == 0 || height == 0 {
                None
            } else {
                Some((width, height))
            }
        });
        let (width, height) =
            parsed.unwrap_or((fallback_video.output_width, fallback_video.output_height));

        Ok(ObsStreamingOutputOptions {
            output_mode: mode,
            rescale_output_enabled: rescale_enabled,
            rescale_output_width: width.max(1),
            rescale_output_height: height.max(1),
            rescale_filter: filter_name,
            dynamic_bitrate_enabled: dynamic_bitrate,
        })
    }

    /// Read OBS streaming rescale and dynamic bitrate settings from the active OBS profile.
    pub async fn get_streaming_output_options_async(
        &self,
    ) -> Result<ObsStreamingOutputOptions, StreamingError> {
        let client = self
            .connect_client()
            .await
            .map_err(|error| StreamingError::BackendUnavailable(error.to_string()))?;
        Self::read_streaming_output_options(&client).await
    }

    /// Apply and verify OBS streaming rescale and dynamic bitrate settings.
    /// Rescale Output is available only for Advanced Output; DynamicBitrate is supported in either mode.
    pub async fn apply_streaming_output_options_async(
        &self,
        rescale_output_enabled: bool,
        rescale_output_width: u32,
        rescale_output_height: u32,
        rescale_filter: &str,
        dynamic_bitrate_enabled: bool,
    ) -> Result<ObsStreamingOutputOptions, StreamingError> {
        let status = self.get_stream_status_async().await?;
        if status.active {
            return Err(StreamingError::ActiveStreamConflict(
                "Stop the live stream before changing Rescale Output or Dynamic Bitrate settings."
                    .into(),
            ));
        }

        let client = self
            .connect_client()
            .await
            .map_err(|error| StreamingError::BackendUnavailable(error.to_string()))?;
        let mode = Self::output_read_profile_parameter(&client, "Output", "Mode")
            .await?
            .unwrap_or_else(|| "Simple".to_string());

        // In Simple mode, leave the saved Advanced-Output rescale fields untouched but
        // still permit applying Dynamic Bitrate. The UI reports that rescaling was skipped.
        if rescale_output_enabled
            && (!(2..=8192).contains(&rescale_output_width)
                || !(2..=8192).contains(&rescale_output_height))
        {
            return Err(StreamingError::Backend(
                "Rescale width and height must each be between 2 and 8192 pixels.".into(),
            ));
        }

        let filter_id = if rescale_output_enabled {
            Self::rescale_filter_id(rescale_filter)?
        } else {
            0
        };
        let dynamic_text = if dynamic_bitrate_enabled {
            "true"
        } else {
            "false"
        };
        let filter_text = filter_id.to_string();
        let rescale_text = format!("{rescale_output_width}x{rescale_output_height}");

        let mut previous: Vec<(&str, &str, Option<String>)> = vec![(
            "Output",
            "DynamicBitrate",
            Self::output_read_profile_parameter(&client, "Output", "DynamicBitrate").await?,
        )];
        if mode == "Advanced" {
            previous.push((
                "AdvOut",
                "RescaleFilter",
                Self::output_read_profile_parameter(&client, "AdvOut", "RescaleFilter").await?,
            ));
            previous.push((
                "AdvOut",
                "RescaleRes",
                Self::output_read_profile_parameter(&client, "AdvOut", "RescaleRes").await?,
            ));
        }

        let mut updates: Vec<(&str, &str, String)> =
            vec![("Output", "DynamicBitrate", dynamic_text.to_string())];
        if mode == "Advanced" {
            updates.push(("AdvOut", "RescaleFilter", filter_text));
            updates.push(("AdvOut", "RescaleRes", rescale_text));
        }
        for (category, name, value) in updates {
            if let Err(error) =
                Self::output_write_profile_parameter(&client, category, name, Some(value.as_str()))
                    .await
            {
                Self::output_rollback_parameters(&client, &previous).await;
                return Err(StreamingError::Backend(format!(
                    "Could not apply {category}.{name}; rollback of previous output settings was attempted. {error}"
                )));
            }
        }

        let actual = match Self::read_streaming_output_options(&client).await {
            Ok(value) => value,
            Err(error) => {
                Self::output_rollback_parameters(&client, &previous).await;
                return Err(StreamingError::Backend(format!(
                    "OBS accepted the output-option writes but read-back verification failed; rollback was attempted. {error}"
                )));
            }
        };
        let dynamic_matches = actual.dynamic_bitrate_enabled == dynamic_bitrate_enabled;
        let rescale_matches = if mode == "Advanced" {
            actual.rescale_output_enabled == rescale_output_enabled
                && actual.rescale_output_width == rescale_output_width
                && actual.rescale_output_height == rescale_output_height
                && (!rescale_output_enabled
                    || actual.rescale_filter == rescale_filter.trim().to_ascii_lowercase())
        } else {
            // Rescale is an Advanced Output-only option and is intentionally not changed in Simple mode.
            true
        };
        if !(dynamic_matches && rescale_matches) {
            Self::output_rollback_parameters(&client, &previous).await;
            return Err(StreamingError::Backend(
                "OBS did not return all requested streaming output/network values during read-back verification. Rollback was attempted; inspect OBS Settings → Output and Settings → Advanced → Network.".into(),
            ));
        }

        Ok(actual)
    }
    fn monitor_type_to_api(value: &MonitorType) -> Result<&'static str, StreamingError> {
        match value {
            MonitorType::None => Ok("OBS_MONITORING_TYPE_NONE"),
            MonitorType::MonitorOnly => Ok("OBS_MONITORING_TYPE_MONITOR_ONLY"),
            MonitorType::MonitorAndOutput => Ok("OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT"),
            _ => Err(StreamingError::Backend(
                "OBS returned an unsupported audio monitoring type; refusing to change it.".into(),
            )),
        }
    }

    fn parse_monitor_type(value: &str) -> Result<MonitorType, StreamingError> {
        match value.trim() {
            "OBS_MONITORING_TYPE_NONE" => Ok(MonitorType::None),
            "OBS_MONITORING_TYPE_MONITOR_ONLY" => Ok(MonitorType::MonitorOnly),
            "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT" => Ok(MonitorType::MonitorAndOutput),
            other => Err(StreamingError::Backend(format!(
                "Unsupported saved OBS audio monitoring type '{other}'. The saved setting was not applied."
            ))),
        }
    }

    /// Disable only local OBS monitoring for one input. This deliberately leaves
    /// the input's mute state untouched so its audio can remain in the stream mix.
    /// The previous monitor type is returned and must be supplied when disabling
    /// silent mode to restore the user's prior OBS monitoring configuration.
    pub async fn set_local_silent_mode_async(
        &self,
        source_name: &str,
        enabled: bool,
        restore_monitor_type: Option<&str>,
    ) -> Result<ObsLocalSilentModeResult, StreamingError> {
        let source_name = source_name.trim();
        if source_name.is_empty() {
            return Err(StreamingError::Backend(
                "Enter the OBS Source Name before changing local silent mode.".into(),
            ));
        }

        let restore_target = if enabled {
            None
        } else {
            Some(Self::parse_monitor_type(restore_monitor_type.ok_or_else(|| {
                StreamingError::Backend(
                    "The previous OBS monitor type is missing; refusing to guess a restoration value.".into(),
                )
            })?)?)
        };

        let client = self
            .connect_client()
            .await
            .map_err(|error| StreamingError::BackendUnavailable(error.to_string()))?;

        let current = client
            .inputs()
            .audio_monitor_type(source_name)
            .await
            .map_err(|error| StreamingError::Backend(format!(
                "Could not read the OBS audio-monitoring type for input '{source_name}': {error}"
            )))?;
        let current_text = Self::monitor_type_to_api(&current)?.to_string();
        let input_muted = client.inputs().muted(source_name).await.map_err(|error| {
            StreamingError::Backend(format!(
                "Could not read the mute state for OBS input '{source_name}': {error}"
            ))
        })?;

        let (target_type, saved_restore_type) = if enabled {
            (MonitorType::None, Some(current_text))
        } else {
            (
                restore_target.expect("restore target is present when disabling"),
                None,
            )
        };

        if let Err(error) = client
            .inputs()
            .set_audio_monitor_type(source_name, target_type.clone())
            .await
        {
            let _ = client
                .inputs()
                .set_audio_monitor_type(source_name, current.clone())
                .await;
            return Err(StreamingError::Backend(format!(
                "Could not set OBS audio monitoring for '{source_name}'; restoration of the prior value was attempted: {error}"
            )));
        }

        let actual = match client.inputs().audio_monitor_type(source_name).await {
            Ok(value) => value,
            Err(error) => {
                let _ = client
                    .inputs()
                    .set_audio_monitor_type(source_name, current.clone())
                    .await;
                return Err(StreamingError::Backend(format!(
                    "OBS accepted the monitoring change for '{source_name}', but verification failed; restoration was attempted: {error}"
                )));
            }
        };
        let actual_text = Self::monitor_type_to_api(&actual)?.to_string();
        let expected_text = Self::monitor_type_to_api(&target_type)?;
        if actual_text != expected_text {
            let _ = client
                .inputs()
                .set_audio_monitor_type(source_name, current.clone())
                .await;
            return Err(StreamingError::Backend(format!(
                "OBS did not confirm the requested audio monitoring mode for '{source_name}'. The previous setting was restored where possible."
            )));
        }

        Ok(ObsLocalSilentModeResult {
            source_name: source_name.to_string(),
            silent_mode_enabled: enabled,
            current_monitor_type: actual_text,
            restore_monitor_type: saved_restore_type,
            input_muted,
        })
    }
    pub async fn get_stream_status_async(&self) -> Result<StreamStatus, StreamingError> {
        let client = self
            .connect_client()
            .await
            .map_err(|e| StreamingError::BackendUnavailable(e.to_string()))?;

        let status =
            client.streaming().status().await.map_err(|e| {
                StreamingError::Backend(format!("failed to query stream status: {e}"))
            })?;

        // Timecode is a `time::Duration` — format as HH:MM:SS
        let timecode_str = if status.active {
            let total_secs = status.timecode.whole_seconds();
            let h = total_secs / 3600;
            let m = (total_secs % 3600) / 60;
            let s = total_secs % 60;
            Some(format!("{h:02}:{m:02}:{s:02}"))
        } else {
            None
        };

        // Estimate kbps from bytes if no dedicated field is available.
        let kbits_per_sec = if status.timecode.whole_seconds() > 0 {
            Some(status.bytes * 8 / (status.timecode.whole_seconds() as u64 + 1) / 1000)
        } else {
            None
        };

        Ok(StreamStatus {
            active: status.active,
            timecode: timecode_str,
            kbits_per_sec,
            dropped_frames: Some(status.skipped_frames as u64),
            total_frames: Some(status.total_frames as u64),
        })
    }

    pub async fn get_extended_stream_status_async(
        &self,
    ) -> Result<ExtendedStreamStatus, StreamingError> {
        let client = self
            .connect_client()
            .await
            .map_err(|e| StreamingError::BackendUnavailable(e.to_string()))?;

        let stream_status =
            client.streaming().status().await.map_err(|e| {
                StreamingError::Backend(format!("failed to query stream status: {e}"))
            })?;

        let timecode_str = if stream_status.active {
            let total_secs = stream_status.timecode.whole_seconds();
            let h = total_secs / 3600;
            let m = (total_secs % 3600) / 60;
            let s = total_secs % 60;
            Some(format!("{h:02}:{m:02}:{s:02}"))
        } else {
            None
        };

        let duration_secs = stream_status.duration.whole_seconds().max(0) as u64;

        let kbits_per_sec = if duration_secs > 0 {
            Some(stream_status.bytes * 8 / duration_secs / 1000)
        } else {
            None
        };

        // General OBS performance and rendering stats
        let stats_res = client.general().stats().await;

        let (cpu_usage, memory_usage_mb, active_fps, render_skipped, render_total, avg_render_time) =
            match stats_res {
                Ok(s) => (
                    s.cpu_usage,
                    s.memory_usage,
                    s.active_fps,
                    s.render_skipped_frames as u64,
                    s.render_total_frames as u64,
                    s.average_frame_render_time,
                ),
                Err(_) => (0.0, 0.0, 0.0, 0, 0, 0.0),
            };

        Ok(ExtendedStreamStatus {
            active: stream_status.active,
            reconnecting: stream_status.reconnecting,
            timecode: timecode_str,
            duration_seconds: duration_secs,
            congestion: stream_status.congestion,
            bytes_sent: stream_status.bytes,
            kbits_per_sec,
            dropped_frames: stream_status.skipped_frames as u64,
            total_frames: stream_status.total_frames as u64,
            cpu_usage,
            memory_usage_mb,
            active_fps,
            render_skipped_frames: render_skipped,
            render_total_frames: render_total,
            average_frame_render_time_ms: avg_render_time,
        })
    }

    pub async fn get_video_settings_async(&self) -> Result<ObsVideoSettings, StreamingError> {
        let client = self
            .connect_client()
            .await
            .map_err(|e| StreamingError::BackendUnavailable(e.to_string()))?;

        let vs =
            client.config().video_settings().await.map_err(|e| {
                StreamingError::Backend(format!("failed to fetch video settings: {e}"))
            })?;

        Ok(ObsVideoSettings {
            base_width: vs.base_width,
            base_height: vs.base_height,
            output_width: vs.output_width,
            output_height: vs.output_height,
            fps_numerator: vs.fps_numerator,
            fps_denominator: vs.fps_denominator,
        })
    }

    pub async fn set_video_settings_async(
        &self,
        settings: &ObsVideoSettings,
    ) -> Result<(), StreamingError> {
        // Safe live guard: OBS rejects video settings changes while stream/record output is active.
        let status = self.get_stream_status_async().await?;
        if status.active {
            return Err(StreamingError::ActiveStreamConflict(
                "OBS does not allow changing video canvas or output dimensions while live streaming. Stop the stream first to apply these settings.".into(),
            ));
        }

        let client = self
            .connect_client()
            .await
            .map_err(|e| StreamingError::BackendUnavailable(e.to_string()))?;

        let req = SetVideoSettings {
            base_width: Some(settings.base_width),
            base_height: Some(settings.base_height),
            output_width: Some(settings.output_width),
            output_height: Some(settings.output_height),
            fps_numerator: Some(settings.fps_numerator),
            fps_denominator: Some(settings.fps_denominator),
        };

        client.config().set_video_settings(req).await.map_err(|e| {
            StreamingError::Backend(format!("failed to apply OBS video settings: {e}"))
        })?;

        Ok(())
    }

    async fn quality_read_profile_parameter(
        client: &obws::Client,
        category: &str,
        name: &str,
    ) -> Result<Option<String>, StreamingError> {
        client
            .profiles()
            .parameter(category, name)
            .await
            .map(|parameter| parameter.value)
            .map_err(|error| {
                StreamingError::Backend(format!(
                    "failed to read OBS profile parameter {category}.{name}: {error}"
                ))
            })
    }

    async fn quality_write_profile_parameter(
        client: &obws::Client,
        category: &str,
        name: &str,
        value: Option<&str>,
    ) -> Result<(), StreamingError> {
        client
            .profiles()
            .set_parameter(SetParameter {
                category,
                name,
                value,
            })
            .await
            .map_err(|error| {
                StreamingError::Backend(format!(
                    "failed to write OBS profile parameter {category}.{name}: {error}"
                ))
            })
    }

    async fn quality_rollback_simple_output(
        client: &obws::Client,
        previous: &[(&str, Option<String>)],
    ) {
        for (name, value) in previous {
            if let Err(error) = Self::quality_write_profile_parameter(
                client,
                "SimpleOutput",
                name,
                value.as_deref(),
            )
            .await
            {
                eprintln!("OBS quality rollback failed for SimpleOutput.{name}: {error}");
            }
        }
    }

    fn resolve_simple_stream_encoder(
        configured_encoder: &str,
        current_encoder: Option<String>,
    ) -> Result<String, StreamingError> {
        let normalized = configured_encoder.trim().to_ascii_lowercase();
        let mapped = match normalized.as_str() {
            "" | "auto" => current_encoder.unwrap_or_else(|| "x264".to_string()),
            "obs_x264" | "x264" => "x264".to_string(),
            "jim_nvenc" | "h264_nvenc" | "ffmpeg_nvenc" | "nvenc" => "nvenc".to_string(),
            "jim_qsv" | "h264_qsv" | "qsv" => "qsv".to_string(),
            "amd" | "amd_h264" | "h264_texture_amf" => "amd".to_string(),
            "apple" | "apple_h264" | "vt_h264_hw" => "apple_h264".to_string(),
            other => {
                return Err(StreamingError::Backend(format!(
                    "Encoder '{other}' is not supported by Tango Stream Manager's OBS Simple Output integration. Choose x264, NVENC, QSV, AMD H.264, Apple H.264, or auto."
                )));
            }
        };

        Ok(mapped)
    }

    /// Apply quality settings supported by OBS Simple Output.
    ///
    /// obs-websocket SetProfileParameter edits the OBS profile configuration. In modern OBS,
    /// Advanced Output encoder values are loaded from streamEncoder.json and cannot be safely
    /// applied through those profile parameters, so Advanced mode is deliberately rejected.
    pub async fn apply_quality_settings_async(
        &self,
        video_settings: &ObsVideoSettings,
        quality: &QualitySettings,
    ) -> Result<String, StreamingError> {
        let status = self.get_stream_status_async().await?;
        if status.active {
            return Err(StreamingError::ActiveStreamConflict(
                "Stop the live stream before applying video or encoder quality settings.".into(),
            ));
        }

        if !(100..=100_000).contains(&quality.video_bitrate_kbps) {
            return Err(StreamingError::Backend(
                "Video bitrate must be between 100 and 100000 Kbps.".into(),
            ));
        }
        if !(64..=320).contains(&quality.audio_bitrate_kbps) {
            return Err(StreamingError::Backend(
                "Audio bitrate must be between 64 and 320 Kbps for this Simple Output workflow."
                    .into(),
            ));
        }
        if !quality.rate_control.eq_ignore_ascii_case("CBR") {
            return Err(StreamingError::Backend(
                "OBS Simple Output uses CBR in this workflow. Set the profile rate control to CBR before applying.".into(),
            ));
        }
        if quality.keyframe_interval_sec != 2 {
            return Err(StreamingError::Backend(
                "OBS Simple Output uses a 2-second keyframe interval in this workflow. Set the profile keyframe interval to 2 seconds before applying.".into(),
            ));
        }
        if video_settings.base_width == 0
            || video_settings.base_height == 0
            || video_settings.output_width == 0
            || video_settings.output_height == 0
            || video_settings.fps_numerator == 0
            || video_settings.fps_denominator == 0
        {
            return Err(StreamingError::Backend(
                "Video dimensions and FPS numerator/denominator must all be greater than zero."
                    .into(),
            ));
        }

        let client = self
            .connect_client()
            .await
            .map_err(|error| StreamingError::BackendUnavailable(error.to_string()))?;

        let mode_parameter = client
            .profiles()
            .parameter("Output", "Mode")
            .await
            .map_err(|error| {
                StreamingError::Backend(format!(
                    "could not determine the OBS Output Mode safely: {error}"
                ))
            })?;
        let mode = mode_parameter
            .value
            .or(mode_parameter.default_value)
            .unwrap_or_default();

        if mode != "Simple" {
            return Err(StreamingError::Backend(format!(
                "OBS Output Mode is '{mode}', not 'Simple'. This integration intentionally refuses Advanced Output because current OBS versions store its live encoder settings in streamEncoder.json, which SetProfileParameter does not reliably update. In OBS open Settings → Output → Output Mode, select Simple, click Apply, and retry. No quality settings were changed."
            )));
        }

        let encoder_parameter = client
            .profiles()
            .parameter("SimpleOutput", "StreamEncoder")
            .await
            .map_err(|error| {
                StreamingError::Backend(format!(
                    "could not read the current Simple Output encoder: {error}"
                ))
            })?;
        let current_encoder = encoder_parameter.value.or(encoder_parameter.default_value);
        let desired_encoder =
            Self::resolve_simple_stream_encoder(&quality.encoder, current_encoder)?;

        // Snapshot the parameters so a later failure can best-effort restore the old values.
        let previous = vec![
            (
                "VBitrate",
                Self::quality_read_profile_parameter(&client, "SimpleOutput", "VBitrate").await?,
            ),
            (
                "ABitrate",
                Self::quality_read_profile_parameter(&client, "SimpleOutput", "ABitrate").await?,
            ),
            (
                "StreamEncoder",
                Self::quality_read_profile_parameter(&client, "SimpleOutput", "StreamEncoder")
                    .await?,
            ),
        ];

        let old_video = client.config().video_settings().await.map_err(|error| {
            StreamingError::Backend(format!(
                "failed to read current OBS video settings before applying quality: {error}"
            ))
        })?;

        let video_bitrate = quality.video_bitrate_kbps.to_string();
        let audio_bitrate = quality.audio_bitrate_kbps.to_string();
        let requested_parameters = [
            ("VBitrate", video_bitrate.as_str()),
            ("ABitrate", audio_bitrate.as_str()),
            ("StreamEncoder", desired_encoder.as_str()),
        ];

        for (name, value) in requested_parameters {
            if let Err(error) =
                Self::quality_write_profile_parameter(&client, "SimpleOutput", name, Some(value))
                    .await
            {
                Self::quality_rollback_simple_output(&client, &previous).await;
                return Err(StreamingError::Backend(format!(
                    "Could not apply Simple Output parameter {name}; rollback of previous quality values was attempted. {error}"
                )));
            }
        }

        let video_request = SetVideoSettings {
            base_width: Some(video_settings.base_width),
            base_height: Some(video_settings.base_height),
            output_width: Some(video_settings.output_width),
            output_height: Some(video_settings.output_height),
            fps_numerator: Some(video_settings.fps_numerator),
            fps_denominator: Some(video_settings.fps_denominator),
        };

        if let Err(error) = client.config().set_video_settings(video_request).await {
            Self::quality_rollback_simple_output(&client, &previous).await;
            return Err(StreamingError::Backend(format!(
                "OBS rejected video settings after the quality parameters were written; rollback of quality parameters was attempted. {error}"
            )));
        }

        // Read every changed value back from OBS rather than reporting success just because
        // the SetProfileParameter/SetVideoSettings requests returned successfully.
        let read_video = match client.config().video_settings().await {
            Ok(settings) => settings,
            Err(error) => {
                Self::quality_rollback_simple_output(&client, &previous).await;
                let restore_video = SetVideoSettings {
                    base_width: Some(old_video.base_width),
                    base_height: Some(old_video.base_height),
                    output_width: Some(old_video.output_width),
                    output_height: Some(old_video.output_height),
                    fps_numerator: Some(old_video.fps_numerator),
                    fps_denominator: Some(old_video.fps_denominator),
                };
                let _ = client.config().set_video_settings(restore_video).await;
                return Err(StreamingError::Backend(format!(
                    "Settings were sent to OBS but read-back verification failed. Rollback of prior quality/video settings was attempted: {error}"
                )));
            }
        };

        let read_video_bitrate =
            match Self::quality_read_profile_parameter(&client, "SimpleOutput", "VBitrate").await {
                Ok(value) => value,
                Err(error) => {
                    Self::quality_rollback_simple_output(&client, &previous).await;
                    let restore_video = SetVideoSettings {
                        base_width: Some(old_video.base_width),
                        base_height: Some(old_video.base_height),
                        output_width: Some(old_video.output_width),
                        output_height: Some(old_video.output_height),
                        fps_numerator: Some(old_video.fps_numerator),
                        fps_denominator: Some(old_video.fps_denominator),
                    };
                    let _ = client.config().set_video_settings(restore_video).await;
                    return Err(error);
                }
            };
        let read_audio_bitrate =
            match Self::quality_read_profile_parameter(&client, "SimpleOutput", "ABitrate").await {
                Ok(value) => value,
                Err(error) => {
                    Self::quality_rollback_simple_output(&client, &previous).await;
                    let restore_video = SetVideoSettings {
                        base_width: Some(old_video.base_width),
                        base_height: Some(old_video.base_height),
                        output_width: Some(old_video.output_width),
                        output_height: Some(old_video.output_height),
                        fps_numerator: Some(old_video.fps_numerator),
                        fps_denominator: Some(old_video.fps_denominator),
                    };
                    let _ = client.config().set_video_settings(restore_video).await;
                    return Err(error);
                }
            };
        let read_encoder =
            match Self::quality_read_profile_parameter(&client, "SimpleOutput", "StreamEncoder")
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    Self::quality_rollback_simple_output(&client, &previous).await;
                    let restore_video = SetVideoSettings {
                        base_width: Some(old_video.base_width),
                        base_height: Some(old_video.base_height),
                        output_width: Some(old_video.output_width),
                        output_height: Some(old_video.output_height),
                        fps_numerator: Some(old_video.fps_numerator),
                        fps_denominator: Some(old_video.fps_denominator),
                    };
                    let _ = client.config().set_video_settings(restore_video).await;
                    return Err(error);
                }
            };

        let video_matches = read_video.base_width == video_settings.base_width
            && read_video.base_height == video_settings.base_height
            && read_video.output_width == video_settings.output_width
            && read_video.output_height == video_settings.output_height
            && read_video.fps_numerator == video_settings.fps_numerator
            && read_video.fps_denominator == video_settings.fps_denominator;
        let bitrate_matches = read_video_bitrate.as_deref() == Some(video_bitrate.as_str());
        let audio_matches = read_audio_bitrate.as_deref() == Some(audio_bitrate.as_str());
        let encoder_matches = read_encoder.as_deref() == Some(desired_encoder.as_str());

        if !(video_matches && bitrate_matches && audio_matches && encoder_matches) {
            Self::quality_rollback_simple_output(&client, &previous).await;
            let restore_video = SetVideoSettings {
                base_width: Some(old_video.base_width),
                base_height: Some(old_video.base_height),
                output_width: Some(old_video.output_width),
                output_height: Some(old_video.output_height),
                fps_numerator: Some(old_video.fps_numerator),
                fps_denominator: Some(old_video.fps_denominator),
            };
            let _ = client.config().set_video_settings(restore_video).await;
            return Err(StreamingError::Backend(
                "OBS did not return all requested values during verification. Rollback of prior quality/video settings was attempted; inspect OBS Settings → Output and Video.".into(),
            ));
        }

        Ok(desired_encoder)
    }
    pub async fn set_stream_key_async(&self, config: &StreamConfig) -> Result<(), StreamingError> {
        let client = self
            .connect_client()
            .await
            .map_err(|e| StreamingError::BackendUnavailable(e.to_string()))?;

        let settings = RtmpCustomSettings {
            server: &config.server,
            key: &config.stream_key,
        };

        client
            .config()
            .set_stream_service_settings("rtmp_custom", &settings)
            .await
            .map_err(|e| {
                StreamingError::Backend(format!("failed to set stream service settings: {e}"))
            })?;

        Ok(())
    }

    pub async fn start_stream_async(&self, config: &StreamConfig) -> Result<(), StreamingError> {
        let status = self.get_stream_status_async().await?;
        if status.active {
            return Ok(());
        }

        self.set_stream_key_async(config).await?;

        let client = self
            .connect_client()
            .await
            .map_err(|e| StreamingError::BackendUnavailable(e.to_string()))?;

        client
            .streaming()
            .start()
            .await
            .map_err(|e| StreamingError::Backend(format!("failed to start stream: {e}")))?;

        Ok(())
    }

    pub async fn stop_stream_async(&self) -> Result<(), StreamingError> {
        let status = self.get_stream_status_async().await?;
        if !status.active {
            return Ok(());
        }

        let client = self
            .connect_client()
            .await
            .map_err(|e| StreamingError::BackendUnavailable(e.to_string()))?;

        client
            .streaming()
            .stop()
            .await
            .map_err(|e| StreamingError::Backend(format!("failed to stop stream: {e}")))?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Sync StreamingPort impl — runs async methods in a dedicated OS thread.
// ---------------------------------------------------------------------------

impl StreamingPort for ObsVideoOutput {
    fn get_stream_status(&self) -> Result<StreamStatus, StreamingError> {
        self.run_sync(|obs| Box::pin(async move { obs.get_stream_status_async().await }))
    }

    fn get_extended_stream_status(&self) -> Result<ExtendedStreamStatus, StreamingError> {
        self.run_sync(|obs| Box::pin(async move { obs.get_extended_stream_status_async().await }))
    }

    fn get_video_settings(&self) -> Result<ObsVideoSettings, StreamingError> {
        self.run_sync(|obs| Box::pin(async move { obs.get_video_settings_async().await }))
    }

    fn set_video_settings(&self, settings: &ObsVideoSettings) -> Result<(), StreamingError> {
        let s = settings.clone();
        self.run_sync(|obs| Box::pin(async move { obs.set_video_settings_async(&s).await }))
    }

    fn start_stream(&self, config: &StreamConfig) -> Result<(), StreamingError> {
        let cfg = config.clone();
        self.run_sync(|obs| Box::pin(async move { obs.start_stream_async(&cfg).await }))
    }

    fn stop_stream(&self) -> Result<(), StreamingError> {
        self.run_sync(|obs| Box::pin(async move { obs.stop_stream_async().await }))
    }

    fn set_stream_key(&self, config: &StreamConfig) -> Result<(), StreamingError> {
        let cfg = config.clone();
        self.run_sync(|obs| Box::pin(async move { obs.set_stream_key_async(&cfg).await }))
    }
}
