use domain::QualitySettings;
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

impl ObsVideoOutput {
    // ------------------------------------------------------------------
    // Async streaming helpers (called by Tauri commands directly)
    // ------------------------------------------------------------------

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
