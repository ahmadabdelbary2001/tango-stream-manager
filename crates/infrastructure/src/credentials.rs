use keyring::Entry;
use ports::{CredentialError, CredentialStorePort};

const SERVICE_NAME: &str = "tango-stream-manager";

/// OS-native secure credential store backed by Windows Credential Manager / Secret Service.
pub struct KeyringCredentialStore {
    service: String,
}

impl Default for KeyringCredentialStore {
    fn default() -> Self {
        Self::new(SERVICE_NAME)
    }
}

impl KeyringCredentialStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, key_ref: &str) -> Result<Entry, CredentialError> {
        if key_ref.trim().is_empty() {
            return Err(CredentialError::InvalidReference(
                "credential key reference cannot be empty".into(),
            ));
        }
        Entry::new(&self.service, key_ref).map_err(|e| {
            CredentialError::Unavailable(format!("failed to initialize secure keyring entry: {e}"))
        })
    }
}

impl CredentialStorePort for KeyringCredentialStore {
    fn get_credential(&self, key_ref: &str) -> Result<Option<String>, CredentialError> {
        let entry = self.entry(key_ref)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(CredentialError::StorageError(format!(
                "failed to retrieve secret from OS credential store: {err}"
            ))),
        }
    }

    fn set_credential(&self, key_ref: &str, secret: &str) -> Result<(), CredentialError> {
        let entry = self.entry(key_ref)?;
        entry.set_password(secret).map_err(|e| {
            CredentialError::StorageError(format!(
                "failed to write secret to OS credential store: {e}"
            ))
        })
    }

    fn delete_credential(&self, key_ref: &str) -> Result<(), CredentialError> {
        let entry = self.entry(key_ref)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(CredentialError::StorageError(format!(
                "failed to delete secret from OS credential store: {err}"
            ))),
        }
    }
}
