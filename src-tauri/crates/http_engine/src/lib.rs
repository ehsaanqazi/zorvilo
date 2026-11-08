//! Zorvilo HTTP engine.
//!
//! Requests go directly from the user's machine to the target API — there is
//! no proxy service and no browser CORS layer. The pipeline is:
//!
//! 1. [`build::build_spec`] turns a variable-resolved [`zorvilo_core::ApiRequest`]
//!    into a wire-level [`build::HttpRequestSpec`] (URL, headers, body bytes).
//! 2. [`auth::apply_auth`] signs/decorates the spec (API key, bearer, basic,
//!    JWT, OAuth 2.0 token, AWS SigV4). Digest is answered on a 401 challenge.
//! 3. [`client::HttpEngine::send`] executes it with timeouts, redirects,
//!    proxy, TLS options, cookies and cancellation.

pub mod auth;
pub mod build;
pub mod client;
pub mod error;
pub mod network;
pub mod oauth2;
pub mod response;

pub use build::{build_spec, HttpRequestSpec, SendOptions};
pub use client::HttpEngine;
pub use error::{HttpError, HttpResult};
pub use tokio_util::sync::CancellationToken;
