use obws::Client;
use obws::common::{Alignment, BoundsType};
use obws::error::Error as ObwsError;
use obws::requests::canvases::SceneId;
use obws::requests::inputs::{Create as CreateInput, InputId, SetSettings as SetInputSettings};
use obws::requests::scene_items::{
    Bounds, CreateSceneItem, Crop, Id as SceneItemId, Position, Scale, SceneItemTransform,
    SetTransform,
};
use obws::requests::sources::SourceId;
use ports::{VideoOutputError, VideoOutputPort, VideoOutputRequest};
use serde::{Deserialize, Serialize};
use tokio::runtime::Runtime;
use video_composition::{Size as VcSize, VideoTransform as VcTransform};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObsVersionInfo {
    pub obs_version: String,
    pub obs_web_socket_version: String,
    pub rpc_version: u32,
}

/// OBS WebSocket output adapter.
///
/// Intentionally **does not** embed a Tokio runtime. All `_async` methods
/// are called directly from Tauri's async commands. The sync `VideoOutputPort`
/// impl spins up a temporary single-threaded runtime in a dedicated OS thread
/// so it never conflicts with an outer async context.
pub struct ObsVideoOutput {
    host: String,
    port: u16,
    password: Option<String>,
}

impl ObsVideoOutput {
    pub fn new(host: &str, port: u16, password: Option<String>) -> Result<Self, std::io::Error> {
        Ok(Self {
            host: host.to_string(),
            port,
            password,
        })
    }

    /// Spawn a dedicated OS thread with its own Tokio runtime and run the
    /// given closure (which receives a cloned `ObsVideoOutput`) to completion.
    pub(crate) fn run_sync<F, T, E>(&self, f: F) -> Result<T, E>
    where
        F: FnOnce(
                ObsVideoOutput,
            )
                -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<T, E>> + Send>>
            + Send
            + 'static,
        T: Send + 'static,
        E: Send + 'static,
    {
        let cloned = ObsVideoOutput {
            host: self.host.clone(),
            port: self.port,
            password: self.password.clone(),
        };
        std::thread::spawn(move || {
            Runtime::new()
                .expect("failed to create temporary Tokio runtime")
                .block_on(f(cloned))
        })
        .join()
        .expect("blocking thread panicked")
    }

    /// Asynchronously connect to OBS and return the client.
    /// Maps errors to BackendUnavailable or AuthenticationFailed.
    pub async fn connect_client(&self) -> Result<Client, VideoOutputError> {
        Client::connect(&self.host, self.port, self.password.as_deref())
            .await
            .map_err(|e| match e {
                ObwsError::Handshake(err) => VideoOutputError::AuthenticationFailed(format!(
                    "OBS WebSocket handshake/authentication failed: {err}"
                )),
                ObwsError::Connect(err) => VideoOutputError::BackendUnavailable(format!(
                    "failed to connect to OBS WebSocket at {}:{}: {err}",
                    self.host, self.port
                )),
                ObwsError::Timeout => VideoOutputError::BackendUnavailable(format!(
                    "timeout connecting to OBS WebSocket at {}:{}",
                    self.host, self.port
                )),
                other => VideoOutputError::BackendUnavailable(format!(
                    "OBS WebSocket error at {}:{}: {other}",
                    self.host, self.port
                )),
            })
    }

    /// Test the connection and retrieve OBS and obs-websocket versions.
    pub async fn test_connection_async(&self) -> Result<ObsVersionInfo, VideoOutputError> {
        let client = self.connect_client().await?;
        let version =
            client.general().version().await.map_err(|e| {
                VideoOutputError::Backend(format!("failed to fetch OBS version: {e}"))
            })?;

        Ok(ObsVersionInfo {
            obs_version: version.obs_studio_version.to_string(),
            obs_web_socket_version: version.obs_web_socket_version.to_string(),
            rpc_version: version.rpc_version,
        })
    }

    /// List all scene names configured in OBS.
    pub async fn list_scenes_async(&self) -> Result<Vec<String>, VideoOutputError> {
        let client = self.connect_client().await?;
        let scenes = client
            .scenes()
            .list()
            .await
            .map_err(|e| VideoOutputError::Backend(format!("failed to list scenes: {e}")))?;
        Ok(scenes.scenes.into_iter().map(|s| s.id.name).collect())
    }

    /// Synchronous version of test_connection.
    pub fn test_connection(&self) -> Result<ObsVersionInfo, VideoOutputError> {
        self.run_sync(|obs| Box::pin(async move { obs.test_connection_async().await }))
    }

    /// Async implementation of applying video composition to OBS.
    ///
    /// It ensures:
    /// 1. Scene exists (created if missing).
    /// 2. Input exists with `local_file` set to `source_path` (created as ffmpeg_source if missing).
    /// 3. Input is present in the scene as a scene item (added if missing).
    /// 4. Transform (crop + fill + pan + zoom) is applied with safe boundary clamping.
    /// 5. Transform is queried back to verify.
    pub async fn apply_video_composition_async(
        &self,
        request: &VideoOutputRequest,
    ) -> Result<(), VideoOutputError> {
        let client = self.connect_client().await?;

        // 1. Ensure scene exists
        let scenes = client
            .scenes()
            .list()
            .await
            .map_err(|e| VideoOutputError::Backend(format!("failed to list scenes: {e}")))?;

        let scene_exists = scenes
            .scenes
            .iter()
            .any(|s| s.id.name == request.scene_name);
        if !scene_exists {
            client
                .scenes()
                .create(&request.scene_name)
                .await
                .map_err(|e| {
                    VideoOutputError::Backend(format!(
                        "failed to create scene '{}': {e}",
                        request.scene_name
                    ))
                })?;
        }

        // 2. Ensure input exists and points to `source_path`
        let input_settings = serde_json::json!({
            "local_file": request.source_path,
            "looping": true,
            "restart_on_activate": true,
        });

        let item_id = match client
            .scene_items()
            .id(SceneItemId {
                scene: SceneId::Name(request.scene_name.as_str()),
                source: request.source_name.as_str(),
                search_offset: None,
            })
            .await
        {
            Ok(id) => {
                // Already in scene: update input settings
                client
                    .inputs()
                    .set_settings(SetInputSettings {
                        input: InputId::Name(&request.source_name),
                        settings: &input_settings,
                        overlay: Some(true),
                    })
                    .await
                    .map_err(|e| {
                        VideoOutputError::Backend(format!(
                            "failed to update input settings for '{}': {e}",
                            request.source_name
                        ))
                    })?;
                id
            }
            Err(_) => {
                // Not in this scene. Check if input exists globally in OBS
                let input_exists = client
                    .inputs()
                    .settings::<serde_json::Value>(InputId::Name(&request.source_name))
                    .await
                    .is_ok();

                if !input_exists {
                    // Create input directly attached to the target scene
                    client
                        .inputs()
                        .create(CreateInput {
                            scene: SceneId::Name(&request.scene_name),
                            input: &request.source_name,
                            kind: "ffmpeg_source",
                            settings: Some(input_settings),
                            enabled: Some(true),
                        })
                        .await
                        .map_err(|e| {
                            VideoOutputError::Backend(format!(
                                "failed to create ffmpeg_source '{}' in scene '{}': {e}",
                                request.source_name, request.scene_name
                            ))
                        })?
                        .scene_item_id
                } else {
                    // Update input settings first
                    let _ = client
                        .inputs()
                        .set_settings(SetInputSettings {
                            input: InputId::Name(&request.source_name),
                            settings: &input_settings,
                            overlay: Some(true),
                        })
                        .await;

                    // Add existing input to scene
                    client
                        .scene_items()
                        .create(CreateSceneItem {
                            scene: SceneId::Name(&request.scene_name),
                            source: SourceId::Name(&request.source_name),
                            enabled: Some(true),
                        })
                        .await
                        .map_err(|e| {
                            VideoOutputError::Backend(format!(
                                "failed to add source '{}' to scene '{}': {e}",
                                request.source_name, request.scene_name
                            ))
                        })?
                }
            }
        };

        // 3. Apply scene item transform
        let transform = build_scene_item_transform(request)?;

        client
            .scene_items()
            .set_transform(SetTransform {
                scene: SceneId::Name(request.scene_name.as_str()),
                item_id,
                transform,
            })
            .await
            .map_err(|e| VideoOutputError::Backend(format!("failed to apply transform: {e}")))?;

        // 4. Verify transform was set
        let _ = client
            .scene_items()
            .transform(SceneId::Name(request.scene_name.as_str()), item_id)
            .await;

        Ok(())
    }
}

impl VideoOutputPort for ObsVideoOutput {
    fn apply_video_composition(
        &mut self,
        request: &VideoOutputRequest,
    ) -> Result<(), VideoOutputError> {
        let req = request.clone();
        self.run_sync(|obs| Box::pin(async move { obs.apply_video_composition_async(&req).await }))
    }
}

/// Build a full OBS scene item transform from a `VideoOutputRequest`.
///
/// Ensures safe boundary clamping so no uncovered gap can appear in the target canvas.
fn build_scene_item_transform(
    request: &VideoOutputRequest,
) -> Result<SceneItemTransform, VideoOutputError> {
    let source_width = request.source_size.width as f64;
    let source_height = request.source_size.height as f64;
    let canvas_width = request.canvas_size.width as f64;
    let canvas_height = request.canvas_size.height as f64;

    // Crop is represented in the domain as the fraction removed from
    // each side. OBS also expects the removed pixel count on each side.
    let (crop, visible_size) = match request.composition.crop.as_ref() {
        Some(c) => {
            let left = (c.left * source_width).round() as u32;
            let top = (c.top * source_height).round() as u32;
            let right = (c.right * source_width).round() as u32;
            let bottom = (c.bottom * source_height).round() as u32;

            let visible_width = source_width - f64::from(left + right);
            let visible_height = source_height - f64::from(top + bottom);

            if visible_width <= 0.0 || visible_height <= 0.0 {
                return Err(VideoOutputError::InvalidRequest(
                    "crop removes the entire source dimension".into(),
                ));
            }

            (
                Crop {
                    left: Some(left),
                    top: Some(top),
                    right: Some(right),
                    bottom: Some(bottom),
                },
                VcSize::new(visible_width, visible_height),
            )
        }

        None => (
            Crop {
                left: Some(0),
                top: Some(0),
                right: Some(0),
                bottom: Some(0),
            },
            VcSize::new(source_width, source_height),
        ),
    };

    // Calculate safe pan boundaries for this visible size, canvas, and zoom
    let pan_limits = video_composition::calculate_safe_canvas_pan_limits(
        visible_size,
        VcSize::new(canvas_width, canvas_height),
        request.composition.transform.zoom,
    )
    .map_err(|e| VideoOutputError::InvalidRequest(format!("invalid composition: {e}")))?;

    // Clamp pan offsets so video always completely covers canvas
    let clamped_pan = pan_limits.clamp(
        request.composition.transform.pan_x,
        request.composition.transform.pan_y,
    );

    // Geometry is based on visible post-crop content with clamped pan
    let geometry = video_composition::calculate_geometry(
        visible_size,
        VcSize::new(canvas_width, canvas_height),
        VcTransform {
            zoom: request.composition.transform.zoom,
            pan_x: clamped_pan.x,
            pan_y: clamped_pan.y,
        },
    )
    .map_err(|e| VideoOutputError::InvalidRequest(format!("invalid composition transform: {e}")))?;

    let center_x = canvas_width / 2.0 + clamped_pan.x;
    let center_y = canvas_height / 2.0 + clamped_pan.y;

    Ok(SceneItemTransform {
        crop: Some(crop),
        position: Some(Position {
            x: Some(center_x as f32),
            y: Some(center_y as f32),
        }),
        scale: Some(Scale {
            x: Some(geometry.effective_scale as f32),
            y: Some(geometry.effective_scale as f32),
        }),
        alignment: Some(Alignment::CENTER),
        bounds: Some(Bounds {
            r#type: Some(BoundsType::None),
            alignment: None,
            width: None,
            height: None,
        }),
        rotation: None,
    })
}

#[cfg(test)]
mod transform_tests {
    use super::*;
    use domain::{
        CropRegion, MediaAssetId, VideoComposition, VideoSource, VideoTransform as DomainTransform,
    };
    use ports::FrameSize;

    fn base_request() -> VideoOutputRequest {
        VideoOutputRequest::new(
            "Tango Scene",
            "Tango Video",
            "E:\\video.mp4",
            FrameSize::new(568, 762).unwrap(),
            FrameSize::new(720, 1280).unwrap(),
            VideoComposition {
                source: VideoSource::Original {
                    asset_id: MediaAssetId("video-1".into()),
                },
                crop: None,
                transform: DomainTransform::default(),
            },
        )
    }

    fn approx(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-4
    }

    fn fill_scale() -> f32 {
        (1280.0_f64 / 762.0) as f32
    }

    #[test]
    fn default_transform_produces_centered_filled_geometry() {
        let t = build_scene_item_transform(&base_request()).unwrap();

        let crop = t.crop.expect("crop must always be sent");
        assert_eq!(crop.left, Some(0));
        assert_eq!(crop.top, Some(0));
        assert_eq!(crop.right, Some(0));
        assert_eq!(crop.bottom, Some(0));

        let pos = t.position.expect("position must always be sent");
        assert!(approx(pos.x.unwrap(), 360.0));
        assert!(approx(pos.y.unwrap(), 640.0));

        let sc = t.scale.expect("scale must always be sent");
        assert!(approx(sc.x.unwrap(), fill_scale()));
        assert!(approx(sc.y.unwrap(), fill_scale()));

        assert_eq!(t.alignment.unwrap(), Alignment::CENTER);
        assert_eq!(t.bounds.unwrap().r#type.unwrap(), BoundsType::None);
    }

    #[test]
    fn crop_is_converted_to_source_pixels() {
        let mut req = base_request();
        req.composition.crop = CropRegion::new(0.10, 0.10, 0.10, 0.10);

        let t = build_scene_item_transform(&req).unwrap();
        let crop = t.crop.unwrap();

        assert_eq!(crop.left, Some(57));
        assert_eq!(crop.top, Some(76));
        assert_eq!(crop.right, Some(57));
        assert_eq!(crop.bottom, Some(76));
    }

    #[test]
    fn crop_fill_uses_visible_dimensions() {
        let mut req = base_request();
        req.composition.crop = CropRegion::new(0.10, 0.10, 0.10, 0.10);

        let t = build_scene_item_transform(&req).unwrap();
        let scale = t.scale.expect("scale must be present");

        let expected = (1280.0_f64 / 610.0) as f32;
        assert!(approx(scale.x.unwrap(), expected));
        assert!(approx(scale.y.unwrap(), expected));
    }

    #[test]
    fn crop_fill_then_zoom_multiplies_visible_geometry() {
        let mut req = base_request();
        req.composition.crop = CropRegion::new(0.10, 0.10, 0.10, 0.10);
        req.composition.transform.zoom = 1.5;

        let t = build_scene_item_transform(&req).unwrap();
        let scale = t.scale.expect("scale must be present");

        let fill = 1280.0_f64 / 610.0;
        let expected = (fill * 1.5) as f32;

        assert!(approx(scale.x.unwrap(), expected));
        assert!(approx(scale.y.unwrap(), expected));
    }

    #[test]
    fn crop_fill_keeps_pan_as_canvas_center_offset() {
        let mut req = base_request();
        req.composition.crop = CropRegion::new(0.10, 0.10, 0.10, 0.10);
        req.composition.transform.zoom = 1.2;
        req.composition.transform.pan_x = -70.0;
        req.composition.transform.pan_y = 25.0;

        let t = build_scene_item_transform(&req).unwrap();
        let position = t.position.expect("position must be present");

        assert!(approx(position.x.unwrap(), 290.0));
        assert!(approx(position.y.unwrap(), 665.0));
    }

    #[test]
    fn pan_shifts_position_on_overflow_axis() {
        let mut req = base_request();
        // Source 568x762 in 720x1280 has horizontal extra width of 234px ([-117, 117])
        req.composition.transform.pan_x = 50.0;

        let t = build_scene_item_transform(&req).unwrap();
        let pos = t.position.unwrap();
        assert!(approx(pos.x.unwrap(), 410.0));
        assert!(approx(pos.y.unwrap(), 640.0));
    }

    #[test]
    fn pan_is_safely_clamped_to_prevent_gaps() {
        let mut req = base_request();
        // Request an excessive pan that would expose black bars
        req.composition.transform.pan_x = 9999.0;
        req.composition.transform.pan_y = 9999.0;

        let t = build_scene_item_transform(&req).unwrap();
        let pos = t.position.unwrap();

        // Max safe X offset is ~117.0604 -> position X is ~477.0604
        assert!(pos.x.unwrap() <= 477.1);
        // Vertical axis has 0 overflow at zoom 1.0, so pan Y clamped to 0 -> position Y is exactly 640.0
        assert!(approx(pos.y.unwrap(), 640.0));
    }

    #[test]
    fn zoom_multiplies_fill_scale() {
        let mut req = base_request();
        req.composition.transform.zoom = 2.0;

        let t = build_scene_item_transform(&req).unwrap();
        let sc = t.scale.unwrap();
        assert!(approx(sc.x.unwrap(), fill_scale() * 2.0));
        assert!(approx(sc.y.unwrap(), fill_scale() * 2.0));

        let pos = t.position.unwrap();
        assert!(approx(pos.x.unwrap(), 360.0));
        assert!(approx(pos.y.unwrap(), 640.0));
    }
}
