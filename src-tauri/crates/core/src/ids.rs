//! Stable identifiers and timestamps.

/// A new random identifier (UUID v4), the same shape the legacy app used
/// (`crypto.randomUUID()`), so migrated ids and new ids are interchangeable.
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Milliseconds since the Unix epoch (matches the legacy `Date.now()`).
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
