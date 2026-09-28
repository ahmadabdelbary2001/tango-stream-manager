use obws::Client;
use obws::requests::canvases::SceneId;
use obws::requests::scene_items::Id as SceneItemId;
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

            println!(
                "[ObsVideoOutput] scene='{}' source='{}' item_id={:?}",
                request.scene_name, request.source_name, item_id
            );

            Ok(())
        })
    }
}
