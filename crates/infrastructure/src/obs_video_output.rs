use obws::Client;
use obws::requests::canvases::SceneId;
use obws::requests::scene_items::{Crop, Id as SceneItemId, SceneItemTransform, SetTransform};
use ports::{VideoOutputError, VideoOutputPort, VideoOutputRequest};
use tokio::runtime::Runtime;

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

            if let Some(crop) = request.composition.crop.as_ref() {
                let width = request.source_size.width as f64;
                let height = request.source_size.height as f64;

                // Domain CropRegion: normalized coordinates of the kept region.
                // OBS: pixels removed from each side.
                let obs_crop = Crop {
                    left: Some((f64::from(crop.left) * width).round() as u32),
                    top: Some((f64::from(crop.top) * height).round() as u32),
                    right: Some(((1.0 - f64::from(crop.right)) * width).round() as u32),
                    bottom: Some(((1.0 - f64::from(crop.bottom)) * height).round() as u32),
                };

                let transform = SceneItemTransform {
                    crop: Some(obs_crop),
                    ..SceneItemTransform::default()
                };

                client
                    .scene_items()
                    .set_transform(SetTransform {
                        scene: SceneId::Name(request.scene_name.as_str()),
                        item_id,
                        transform,
                    })
                    .await
                    .map_err(|e| VideoOutputError::Backend(format!("failed to apply crop: {e}")))?;
            }

            Ok(())
        })
    }
}
