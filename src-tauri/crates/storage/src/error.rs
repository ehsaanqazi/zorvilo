use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("serialization: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("credential store: {0}")]
    Keyring(String),
    #[error("{0}")]
    Other(String),
}

pub type StorageResult<T> = Result<T, StorageError>;
