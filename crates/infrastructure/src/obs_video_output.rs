use obws::Client;
use obws::common::{Alignment, BoundsType};
use obws::requests::canvases::SceneId;
use obws::requests::scene_items::{
    Bounds, Crop, Id as SceneItemId, Position, Scale, SceneItemTransform, SetTransform,
};
use ports::{VideoOutputError, VideoOutputPort, VideoOutputRequest};
use tokio::runtime::Runtime;
use video_composition::{Size as VcSize, VideoTransform as VcTransform};

pub struct ObsVideoOutput {
    runtime: Runtime,
    host: String,
    port: u16,
    password: Option<String>,
}

impl ObsVideoOutput {
    pub fn new(host: &str, port: u16, password: Option<String>) -> Result<Self, std::io::Error> {
        let runtime = Runtime::new()?;
        Ok(Self {
            runtime,
            host: host.to_string(),
            port,
            password,
        })
    }
}

impl VideoOutputPort for ObsVideoOutput {
    fn apply_video_composition(
        &mut self,
        request: &VideoOutputRequest,
    ) -> Result<(), VideoOutputError> {
        self.runtime.block_on(async {
            let client = Client::connect(&self.host, self.port, self.password.as_deref())
                .await
                .map_err(|e| {
                    VideoOutputError::BackendUnavailable(format!(
                        "failed to connect to OBS WebSocket at {}:{}: {e}",
                        self.host, self.port
                    ))
                })?;

            let item_request = SceneItemId {
                scene: SceneId::Name(request.scene_name.as_str()),
                source: request.source_name.as_str(),
                search_offset: None,
            };

            let item_id = client.scene_items().id(item_request).await.map_err(|e| {
                VideoOutputError::Backend(format!(
                    "failed to resolve scene item scene='{}' source='{}': {e}",
                    request.scene_name, request.source_name
                ))
            })?;

            let transform = build_scene_item_transform(request)?;

            client
                .scene_items()
                .set_transform(SetTransform {
                    scene: SceneId::Name(request.scene_name.as_str()),
                    item_id,
                    transform,
                })
                .await
                .map_err(|e| {
                    VideoOutputError::Backend(format!("failed to apply transform: {e}"))
                })?;

            Ok(())
        })
    }
}

/// Build a full OBS scene item transform from a `VideoOutputRequest`.
///
/// The adapter is idempotent: every call produces the same transform for
/// the same request, independent of any prior OBS state. This matches the
/// architectural rule that `VideoComposition` (domain) is the source of
/// truth, and OBS is a downstream executor.
fn build_scene_item_transform(
    request: &VideoOutputRequest,
) -> Result<SceneItemTransform, VideoOutputError> {
    let source_width = request.source_size.width as f64;
    let source_height = request.source_size.height as f64;
    let canvas_width = request.canvas_size.width as f64;
    let canvas_height = request.canvas_size.height as f64;

    // Crop: domain stores the fraction cropped off each side, same as OBS.
    // Zero-fill when absent to keep the adapter stateless.
    let crop = match request.composition.crop.as_ref() {
        Some(c) => Crop {
            left: Some((c.left * source_width).round() as u32),
            top: Some((c.top * source_height).round() as u32),
            right: Some((c.right * source_width).round() as u32),
            bottom: Some((c.bottom * source_height).round() as u32),
        },
        None => Crop {
            left: Some(0),
            top: Some(0),
            right: Some(0),
            bottom: Some(0),
        },
    };

    // Geometry: fill + zoom + pan, computed by the video-composition crate.
    // With alignment = CENTER, OBS positions the item by the canvas
    // coordinates of its center, which matches the geometry model.
    let geometry = video_composition::calculate_geometry(
        VcSize::new(source_width, source_height),
        VcSize::new(canvas_width, canvas_height),
        VcTransform {
            zoom: request.composition.transform.zoom,
            pan_x: request.composition.transform.pan_x,
            pan_y: request.composition.transform.pan_y,
        },
    )
    .map_err(|e| VideoOutputError::InvalidRequest(format!("invalid composition transform: {e}")))?;

    let center_x = canvas_width / 2.0 + request.composition.transform.pan_x;
    let center_y = canvas_height / 2.0 + request.composition.transform.pan_y;

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
