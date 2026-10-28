use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use domain::StreamingProfile;
use ports::{ProfileRepositoryPort, ProfileStorageError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct ProfileStorageData {
    active_profile_id: Option<String>,
    profiles: Vec<StreamingProfile>,
}

pub struct FileProfileRepository {
    storage_path: PathBuf,
    lock: Mutex<()>,
}

impl FileProfileRepository {
    pub fn new(storage_path: impl AsRef<Path>) -> Self {
        Self {
            storage_path: storage_path.as_ref().to_path_buf(),
            lock: Mutex::new(()),
        }
    }

    fn read_data(&self) -> Result<ProfileStorageData, ProfileStorageError> {
        if !self.storage_path.exists() {
            // Seed with an initial default Tango profile
            let default_profile = StreamingProfile::new("default", "Tango Live");
            let initial = ProfileStorageData {
                active_profile_id: Some("default".into()),
                profiles: vec![default_profile],
            };
            self.write_data(&initial)?;
            return Ok(initial);
        }

        let content = fs::read_to_string(&self.storage_path)
            .map_err(|e| ProfileStorageError::ReadError(e.to_string()))?;

        serde_json::from_str(&content)
            .map_err(|e| ProfileStorageError::SerializationError(e.to_string()))
    }

    fn write_data(&self, data: &ProfileStorageData) -> Result<(), ProfileStorageError> {
        let json = serde_json::to_string_pretty(data)
            .map_err(|e| ProfileStorageError::SerializationError(e.to_string()))?;

        if let Some(parent) = self.storage_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| ProfileStorageError::WriteError(e.to_string()))?;
        }

        let tmp_path = self.storage_path.with_extension("tmp");
        fs::write(&tmp_path, json).map_err(|e| ProfileStorageError::WriteError(e.to_string()))?;

        fs::rename(&tmp_path, &self.storage_path)
            .map_err(|e| ProfileStorageError::WriteError(e.to_string()))?;

        Ok(())
    }
}

impl ProfileRepositoryPort for FileProfileRepository {
    fn list_profiles(&self) -> Result<Vec<StreamingProfile>, ProfileStorageError> {
        let _guard = self.lock.lock().unwrap();
        let data = self.read_data()?;
        Ok(data.profiles)
    }

    fn get_profile(&self, id: &str) -> Result<Option<StreamingProfile>, ProfileStorageError> {
        let _guard = self.lock.lock().unwrap();
        let data = self.read_data()?;
        Ok(data.profiles.into_iter().find(|p| p.id == id))
    }

    fn save_profile(&self, profile: &StreamingProfile) -> Result<(), ProfileStorageError> {
        let _guard = self.lock.lock().unwrap();
        let mut data = self.read_data()?;
        if let Some(pos) = data.profiles.iter().position(|p| p.id == profile.id) {
            data.profiles[pos] = profile.clone();
        } else {
            data.profiles.push(profile.clone());
        }
        if data.active_profile_id.is_none() {
            data.active_profile_id = Some(profile.id.clone());
        }
        self.write_data(&data)
    }

    fn delete_profile(&self, id: &str) -> Result<bool, ProfileStorageError> {
        let _guard = self.lock.lock().unwrap();
        let mut data = self.read_data()?;
        let initial_len = data.profiles.len();
        data.profiles.retain(|p| p.id != id);

        if data.profiles.len() == initial_len {
            return Ok(false);
        }

        // If active profile was deleted, switch active profile to first remaining
        if data.active_profile_id.as_deref() == Some(id) {
            data.active_profile_id = data.profiles.first().map(|p| p.id.clone());
        }

        self.write_data(&data)?;
        Ok(true)
    }

    fn get_active_profile_id(&self) -> Result<Option<String>, ProfileStorageError> {
        let _guard = self.lock.lock().unwrap();
        let data = self.read_data()?;
        Ok(data.active_profile_id)
    }

    fn set_active_profile_id(&self, id: &str) -> Result<(), ProfileStorageError> {
        let _guard = self.lock.lock().unwrap();
        let mut data = self.read_data()?;
        if !data.profiles.iter().any(|p| p.id == id) {
            return Err(ProfileStorageError::NotFound(format!(
                "profile '{id}' not found"
            )));
        }
        data.active_profile_id = Some(id.to_string());
        self.write_data(&data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_crud_and_isolation() {
        let dir = std::env::temp_dir().join(format!("tsm_test_{}", std::process::id()));
        let file = dir.join("profiles.json");

        let repo = FileProfileRepository::new(&file);

        // Initial list has seeded default
        let list = repo.list_profiles().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "default");

        // Create new profile
        let mut p2 = StreamingProfile::new("tango-game", "Tango Gamer Portrait");
        p2.server_url = "rtmp://live.tango.me/ingest".into();
        repo.save_profile(&p2).unwrap();

        let fetched = repo.get_profile("tango-game").unwrap().unwrap();
        assert_eq!(fetched.name, "Tango Gamer Portrait");
        assert_eq!(fetched.server_url, "rtmp://live.tango.me/ingest");
        assert_eq!(fetched.credential_ref, "tsm_profile_tango-game");

        // Verify isolation: default profile server_url is still empty
        let def = repo.get_profile("default").unwrap().unwrap();
        assert_eq!(def.server_url, "");
        assert_ne!(def.credential_ref, fetched.credential_ref);

        // Switch active profile
        repo.set_active_profile_id("tango-game").unwrap();
        assert_eq!(
            repo.get_active_profile_id().unwrap(),
            Some("tango-game".into())
        );

        // Delete profile
        let deleted = repo.delete_profile("tango-game").unwrap();
        assert!(deleted);
        assert!(repo.get_profile("tango-game").unwrap().is_none());
        // Active profile switched back to default
        assert_eq!(
            repo.get_active_profile_id().unwrap(),
            Some("default".into())
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
