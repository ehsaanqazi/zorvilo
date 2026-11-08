use thiserror::Error;

#[derive(Debug, Error)]
pub enum HttpError {
    #[error("request URL is empty")]
    EmptyUrl,
    #[error("invalid URL: {0}")]
    InvalidUrl(String),
    #[error("invalid method: {0}")]
    InvalidMethod(String),
    #[error("invalid header {0}")]
    InvalidHeader(String),
    #[error("could not read file {path}: {source}")]
    File { path: String, source: std::io::Error },
    #[error("TLS configuration: {0}")]
    Tls(String),
    #[error("proxy configuration: {0}")]
    Proxy(String),
    #[error("blocked by network safety policy: {0}")]
    Blocked(String),
    #[error("authentication: {0}")]
    Auth(String),
    #[error("request cancelled")]
    Cancelled,
    #[error("request timed out after {0} ms")]
    Timeout(u64),
    #[error("{0}")]
    Transport(String),
}

pub type HttpResult<T> = Result<T, HttpError>;
