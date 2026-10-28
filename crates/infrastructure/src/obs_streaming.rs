use obws::requests::config::SetVideoSettings;
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
