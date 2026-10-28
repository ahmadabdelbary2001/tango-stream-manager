pub mod credentials;
pub mod obs_streaming;
pub mod obs_video_output;
pub mod profile_repository;

pub use credentials::KeyringCredentialStore;
pub use obs_video_output::{ObsVersionInfo, ObsVideoOutput};
pub use profile_repository::FileProfileRepository;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infrastructure_exports() {
        let _ = std::mem::size_of::<ObsVideoOutput>();
        let _ = std::mem::size_of::<KeyringCredentialStore>();
    }
}
