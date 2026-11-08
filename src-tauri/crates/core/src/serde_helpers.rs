//! Lenient deserializers for data written by the legacy JavaScript app,
//! where every number is an IEEE double.

use serde::{Deserialize, Deserializer};

/// Accept integers, floats and numeric strings for millisecond timestamps.
pub fn lenient_i64<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(match v {
        serde_json::Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f.round() as i64))
            .unwrap_or(0),
        serde_json::Value::String(s) => s.trim().parse::<f64>().map(|f| f as i64).unwrap_or(0),
        _ => 0,
    })
}

/// Accept any JSON scalar for a string field (legacy data sometimes stored numbers).
pub fn lenient_string<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(match v {
        serde_json::Value::String(s) => s,
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        other => other.to_string(),
    })
}
