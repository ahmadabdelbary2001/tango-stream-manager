use ports::{StreamConfig, StreamStatus, StreamingError, StreamingPort};
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

        let status = client
            .streaming()
            .status()
            .await
            .map_err(|e| StreamingError::Backend(format!("failed to query stream status: {e}")))?;

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
        // (OBS WebSocket does not expose kbps directly in obws 0.15 status.)
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
        // Check if already streaming — idempotent guard.
        let status = self.get_stream_status_async().await?;
        if status.active {
            return Ok(());
        }

        // Apply RTMP key/server before starting.
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
        // Idempotent: no-op if already stopped.
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
// Sync StreamingPort impl — delegates to Tokio runtime.
// ---------------------------------------------------------------------------

impl StreamingPort for ObsVideoOutput {
    fn get_stream_status(&self) -> Result<StreamStatus, StreamingError> {
        self.block_on(self.get_stream_status_async())
    }

    fn start_stream(&self, config: &StreamConfig) -> Result<(), StreamingError> {
        self.block_on(self.start_stream_async(config))
    }

    fn stop_stream(&self) -> Result<(), StreamingError> {
        self.block_on(self.stop_stream_async())
    }

    fn set_stream_key(&self, config: &StreamConfig) -> Result<(), StreamingError> {
        self.block_on(self.set_stream_key_async(config))
    }
}
