pub mod obs_video_output;

pub use obs_video_output::ObsVideoOutput;

#[cfg(test)]
mod tests {
    use super::ObsVideoOutput;

    #[test]
    fn test_infrastructure_exports() {
        let _ = std::mem::size_of::<ObsVideoOutput>();
    }
}
