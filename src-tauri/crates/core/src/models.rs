//! Core domain models.
//!
//! Field names serialize in camelCase so that JSON written by the legacy
//! TypeScript application (Dexie records, workspace bundles and Git
//! repository files) deserializes directly into these types, and JSON we
//! write stays readable by the legacy app. Unknown fields are captured in
//! `extra` maps so nothing is silently discarded on round-trips.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ids::{new_id, now_ms};
use crate::serde_helpers::{lenient_i64, lenient_string};

pub type Extra = BTreeMap<String, Value>;

pub const HTTP_METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

/// What kind of API a request talks to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum Protocol {
    #[default]
    #[serde(rename = "http")]
    Http,
    #[serde(rename = "graphql")]
    GraphQl,
    #[serde(rename = "ws")]
    WebSocket,
    #[serde(rename = "socketio")]
    SocketIo,
}

impl Protocol {
    pub fn label(self) -> &'static str {
        match self {
            Protocol::Http => "HTTP",
            Protocol::GraphQl => "GraphQL",
            Protocol::WebSocket => "WebSocket",
            Protocol::SocketIo => "Socket.IO",
        }
    }
    pub fn is_realtime(self) -> bool {
        matches!(self, Protocol::WebSocket | Protocol::SocketIo)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct KeyValue {
    pub id: String,
    #[serde(deserialize_with = "lenient_string")]
    pub key: String,
    #[serde(deserialize_with = "lenient_string")]
    pub value: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub description: String,
}

impl Default for KeyValue {
    fn default() -> Self {
        Self { id: new_id(), key: String::new(), value: String::new(), enabled: true, description: String::new() }
    }
}

impl KeyValue {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self { key: key.into(), value: value.into(), ..Default::default() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Variable {
    pub id: String,
    #[serde(deserialize_with = "lenient_string")]
    pub key: String,
    #[serde(deserialize_with = "lenient_string")]
    pub value: String,
    pub enabled: bool,
    pub secret: bool,
}

impl Default for Variable {
    fn default() -> Self {
        Self { id: new_id(), key: String::new(), value: String::new(), enabled: true, secret: false }
    }
}

impl Variable {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self { key: key.into(), value: value.into(), ..Default::default() }
    }
}

// ---------------------------------------------------------------- auth

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum AuthType {
    #[default]
    #[serde(rename = "none")]
    None,
    #[serde(rename = "inherit")]
    Inherit,
    #[serde(rename = "apiKey")]
    ApiKey,
    #[serde(rename = "bearer")]
    Bearer,
    #[serde(rename = "basic")]
    Basic,
    #[serde(rename = "digest")]
    Digest,
    #[serde(rename = "oauth2")]
    OAuth2,
    #[serde(rename = "jwt")]
    Jwt,
    #[serde(rename = "aws")]
    Aws,
}

impl AuthType {
    pub const ALL: [AuthType; 9] = [
        AuthType::Inherit,
        AuthType::None,
        AuthType::ApiKey,
        AuthType::Bearer,
        AuthType::Basic,
        AuthType::Digest,
        AuthType::Jwt,
        AuthType::OAuth2,
        AuthType::Aws,
    ];
    pub fn label(self) -> &'static str {
        match self {
            AuthType::None => "No Auth",
            AuthType::Inherit => "Inherit from parent",
            AuthType::ApiKey => "API Key",
            AuthType::Bearer => "Bearer Token",
            AuthType::Basic => "Basic Auth",
            AuthType::Digest => "Digest Auth",
            AuthType::OAuth2 => "OAuth 2.0",
            AuthType::Jwt => "JWT Bearer",
            AuthType::Aws => "AWS Signature v4",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AddTo {
    #[default]
    Header,
    Query,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ApiKeyAuth {
    pub key: String,
    pub value: String,
    pub add_to: AddTo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BearerAuth {
    pub token: String,
    pub prefix: String,
}
impl Default for BearerAuth {
    fn default() -> Self {
        Self { token: String::new(), prefix: "Bearer".into() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UserPass {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum OAuth2Grant {
    #[serde(rename = "authorization_code")]
    AuthorizationCode,
    #[default]
    #[serde(rename = "client_credentials")]
    ClientCredentials,
    #[serde(rename = "password")]
    Password,
    #[serde(rename = "implicit")]
    Implicit,
}

impl OAuth2Grant {
    pub const ALL: [OAuth2Grant; 4] = [
        OAuth2Grant::AuthorizationCode,
        OAuth2Grant::ClientCredentials,
        OAuth2Grant::Password,
        OAuth2Grant::Implicit,
    ];
    pub fn label(self) -> &'static str {
        match self {
            OAuth2Grant::AuthorizationCode => "Authorization Code (PKCE)",
            OAuth2Grant::ClientCredentials => "Client Credentials",
            OAuth2Grant::Password => "Password (legacy)",
            OAuth2Grant::Implicit => "Implicit (legacy)",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ClientAuthMethod {
    /// client id/secret sent as HTTP Basic credentials
    #[default]
    Header,
    /// client id/secret sent in the form body
    Body,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OAuth2Auth {
    pub grant_type: OAuth2Grant,
    pub auth_url: String,
    pub token_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub scope: String,
    pub access_token: String,
    pub refresh_token: String,
    pub username: String,
    pub password: String,
    pub audience: String,
    pub use_pkce: bool,
    /// Fixed loopback port for the authorization-code callback (0 = random).
    pub callback_port: u16,
    pub client_auth: ClientAuthMethod,
    /// Prefix used in the Authorization header (normally "Bearer").
    pub header_prefix: String,
    /// Expiry of `access_token` (ms since epoch), 0 = unknown.
    #[serde(deserialize_with = "lenient_i64")]
    pub expires_at: i64,
}

impl Default for OAuth2Auth {
    fn default() -> Self {
        Self {
            grant_type: OAuth2Grant::ClientCredentials,
            auth_url: String::new(),
            token_url: String::new(),
            client_id: String::new(),
            client_secret: String::new(),
            scope: String::new(),
            access_token: String::new(),
            refresh_token: String::new(),
            username: String::new(),
            password: String::new(),
            audience: String::new(),
            use_pkce: true,
            callback_port: 0,
            client_auth: ClientAuthMethod::Header,
            header_prefix: "Bearer".into(),
            expires_at: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JwtAuth {
    pub secret: String,
    /// JSON claims
    pub payload: String,
    /// HS256 | HS384 | HS512
    pub algorithm: String,
    pub add_to: AddTo,
    /// Query parameter name when `add_to == Query`
    pub query_param: String,
    /// Header prefix when `add_to == Header`
    pub header_prefix: String,
    /// Inject `iat` automatically at send time.
    pub auto_iat: bool,
    /// When > 0 inject `exp = iat + expires_in_secs`.
    pub expires_in_secs: u64,
    /// Whether `secret` is base64 encoded.
    pub secret_base64: bool,
}

impl Default for JwtAuth {
    fn default() -> Self {
        Self {
            secret: String::new(),
            payload: "{\n  \"sub\": \"user\"\n}".into(),
            algorithm: "HS256".into(),
            add_to: AddTo::Header,
            query_param: "token".into(),
            header_prefix: "Bearer".into(),
            auto_iat: false,
            expires_in_secs: 0,
            secret_base64: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AwsAuth {
    pub access_key: String,
    pub secret_key: String,
    pub session_token: String,
    pub region: String,
    pub service: String,
}

impl Default for AwsAuth {
    fn default() -> Self {
        Self {
            access_key: String::new(),
            secret_key: String::new(),
            session_token: String::new(),
            region: "us-east-1".into(),
            service: "execute-api".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AuthConfig {
    #[serde(rename = "type")]
    pub auth_type: AuthType,
    pub api_key: ApiKeyAuth,
    pub bearer: BearerAuth,
    pub basic: UserPass,
    pub digest: UserPass,
    pub oauth2: OAuth2Auth,
    pub jwt: JwtAuth,
    pub aws: AwsAuth,
}

impl AuthConfig {
    pub fn of(auth_type: AuthType) -> Self {
        Self { auth_type, ..Default::default() }
    }
    pub fn inherit() -> Self {
        Self::of(AuthType::Inherit)
    }
}

// ---------------------------------------------------------------- body

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum BodyType {
    #[default]
    #[serde(rename = "none")]
    None,
    #[serde(rename = "json")]
    Json,
    #[serde(rename = "raw")]
    Raw,
    #[serde(rename = "xml")]
    Xml,
    #[serde(rename = "html")]
    Html,
    #[serde(rename = "text")]
    Text,
    #[serde(rename = "javascript")]
    JavaScript,
    #[serde(rename = "graphql")]
    GraphQl,
    #[serde(rename = "form-urlencoded")]
    FormUrlEncoded,
    #[serde(rename = "multipart")]
    Multipart,
    #[serde(rename = "binary")]
    Binary,
}

impl BodyType {
    pub const ALL: [BodyType; 11] = [
        BodyType::None,
        BodyType::Json,
        BodyType::Xml,
        BodyType::Html,
        BodyType::Text,
        BodyType::JavaScript,
        BodyType::Raw,
        BodyType::GraphQl,
        BodyType::FormUrlEncoded,
        BodyType::Multipart,
        BodyType::Binary,
    ];
    pub fn label(self) -> &'static str {
        match self {
            BodyType::None => "None",
            BodyType::Json => "JSON",
            BodyType::Raw => "Raw",
            BodyType::Xml => "XML",
            BodyType::Html => "HTML",
            BodyType::Text => "Text",
            BodyType::JavaScript => "JavaScript",
            BodyType::GraphQl => "GraphQL",
            BodyType::FormUrlEncoded => "Form URL Encoded",
            BodyType::Multipart => "Multipart Form",
            BodyType::Binary => "Binary File",
        }
    }
    /// Default content type implied by the body type.
    pub fn content_type(self) -> Option<&'static str> {
        match self {
            BodyType::None | BodyType::Multipart => None,
            BodyType::Json | BodyType::GraphQl => Some("application/json"),
            BodyType::Xml => Some("application/xml"),
            BodyType::Html => Some("text/html"),
            BodyType::Text | BodyType::Raw => Some("text/plain"),
            BodyType::JavaScript => Some("application/javascript"),
            BodyType::FormUrlEncoded => Some("application/x-www-form-urlencoded"),
            BodyType::Binary => Some("application/octet-stream"),
        }
    }
    pub fn is_text_editor(self) -> bool {
        matches!(
            self,
            BodyType::Json | BodyType::Raw | BodyType::Xml | BodyType::Html | BodyType::Text | BodyType::JavaScript
        )
    }
    /// Language id for the code editor highlighter.
    pub fn language(self) -> &'static str {
        match self {
            BodyType::Json => "json",
            BodyType::Xml | BodyType::Html => "xml",
            BodyType::JavaScript => "js",
            BodyType::GraphQl => "graphql",
            _ => "text",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FormDataFile {
    pub file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// base64 file content (legacy / small embedded files)
    pub file_base64: String,
    /// Native file reference (desktop app); read at send time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum FormKind {
    #[default]
    Text,
    File,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FormDataItem {
    pub id: String,
    #[serde(deserialize_with = "lenient_string")]
    pub key: String,
    #[serde(deserialize_with = "lenient_string")]
    pub value: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub description: String,
    pub kind: FormKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<FormDataFile>>,
    /// legacy single-file fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_base64: Option<String>,
}

impl Default for FormDataItem {
    fn default() -> Self {
        Self {
            id: new_id(),
            key: String::new(),
            value: String::new(),
            enabled: true,
            description: String::new(),
            kind: FormKind::Text,
            files: None,
            file_name: None,
            content_type: None,
            file_base64: None,
        }
    }
}

impl FormDataItem {
    /// Attached files, folding legacy single-file fields into the list.
    pub fn all_files(&self) -> Vec<FormDataFile> {
        if let Some(files) = &self.files {
            if !files.is_empty() {
                return files.clone();
            }
        }
        if let Some(b64) = &self.file_base64 {
            return vec![FormDataFile {
                file_name: self.file_name.clone().unwrap_or_else(|| "file".into()),
                content_type: self.content_type.clone(),
                file_base64: b64.clone(),
                file_path: None,
            }];
        }
        Vec::new()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BinaryBody {
    pub file_name: String,
    pub content_type: String,
    pub base64: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GraphQlBody {
    pub query: String,
    pub variables: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub operation_name: String,
}

impl Default for GraphQlBody {
    fn default() -> Self {
        Self { query: String::new(), variables: "{}".into(), operation_name: String::new() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BodyConfig {
    #[serde(rename = "type")]
    pub body_type: BodyType,
    pub content: String,
    pub graphql: GraphQlBody,
    pub form_url_encoded: Vec<KeyValue>,
    pub multipart: Vec<FormDataItem>,
    pub binary: Option<BinaryBody>,
}

// ---------------------------------------------------------------- request

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestSettings {
    /// 0 = use the global default
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub max_redirects: u32,
    pub verify_ssl: bool,
}

impl Default for RequestSettings {
    fn default() -> Self {
        Self { timeout_ms: 0, follow_redirects: true, max_redirects: 10, verify_ssl: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ApiRequest {
    pub id: String,
    pub workspace_id: String,
    /// empty when the request only lives in a draft tab
    pub collection_id: String,
    pub folder_id: Option<String>,
    pub name: String,
    pub description: String,
    pub protocol: Protocol,
    #[serde(deserialize_with = "lenient_string")]
    pub method: String,
    pub url: String,
    pub path_params: Vec<KeyValue>,
    pub params: Vec<KeyValue>,
    pub headers: Vec<KeyValue>,
    pub cookies: Vec<KeyValue>,
    pub auth: AuthConfig,
    pub body: BodyConfig,
    pub pre_request_script: String,
    pub test_script: String,
    pub variables: Vec<Variable>,
    pub settings: RequestSettings,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub sort_order: f64,
    #[serde(deserialize_with = "lenient_i64")]
    pub created_at: i64,
    #[serde(deserialize_with = "lenient_i64")]
    pub updated_at: i64,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Default for ApiRequest {
    fn default() -> Self {
        let ts = now_ms();
        Self {
            id: new_id(),
            workspace_id: String::new(),
            collection_id: String::new(),
            folder_id: None,
            name: "New Request".into(),
            description: String::new(),
            protocol: Protocol::Http,
            method: "GET".into(),
            url: String::new(),
            path_params: Vec::new(),
            params: Vec::new(),
            headers: Vec::new(),
            cookies: Vec::new(),
            auth: AuthConfig::inherit(),
            body: BodyConfig::default(),
            pre_request_script: String::new(),
            test_script: String::new(),
            variables: Vec::new(),
            settings: RequestSettings::default(),
            tags: Vec::new(),
            favorite: false,
            sort_order: ts as f64,
            created_at: ts,
            updated_at: ts,
            extra: Extra::new(),
        }
    }
}

impl ApiRequest {
    /// Preset for the "+" menu request types.
    pub fn with_protocol(protocol: Protocol) -> Self {
        let mut r = Self { protocol, ..Default::default() };
        match protocol {
            Protocol::GraphQl => {
                r.name = "GraphQL Request".into();
                r.method = "POST".into();
                r.body.body_type = BodyType::GraphQl;
            }
            Protocol::WebSocket => {
                r.name = "WebSocket".into();
                r.url = "wss://".into();
            }
            Protocol::SocketIo => {
                r.name = "Socket.IO".into();
                r.url = "https://".into();
            }
            Protocol::Http => {}
        }
        r
    }

    pub fn is_draft(&self) -> bool {
        self.collection_id.is_empty()
    }

    /// Short badge label for trees/tabs.
    pub fn badge(&self) -> String {
        match self.protocol {
            Protocol::Http => {
                let m = self.method.to_uppercase();
                match m.as_str() {
                    "DELETE" => "DEL".into(),
                    "OPTIONS" => "OPT".into(),
                    "PATCH" => "PATCH".into(),
                    _ => m,
                }
            }
            Protocol::GraphQl => "GQL".into(),
            Protocol::WebSocket => "WS".into(),
            Protocol::SocketIo => "SIO".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Folder {
    pub id: String,
    pub workspace_id: String,
    pub collection_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub description: String,
    /// folder-level auth (Inherit by default → parent folder / collection)
    pub auth: AuthConfig,
    pub variables: Vec<Variable>,
    pub pre_request_script: String,
    pub test_script: String,
    pub sort_order: f64,
    #[serde(deserialize_with = "lenient_i64")]
    pub created_at: i64,
    #[serde(deserialize_with = "lenient_i64")]
    pub updated_at: i64,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Default for Folder {
    fn default() -> Self {
        let ts = now_ms();
        Self {
            id: new_id(),
            workspace_id: String::new(),
            collection_id: String::new(),
            parent_id: None,
            name: "New Folder".into(),
            description: String::new(),
            auth: AuthConfig::inherit(),
            variables: Vec::new(),
            pre_request_script: String::new(),
            test_script: String::new(),
            sort_order: ts as f64,
            created_at: ts,
            updated_at: ts,
            extra: Extra::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Collection {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub description: String,
    pub variables: Vec<Variable>,
    pub auth: AuthConfig,
    pub pre_request_script: String,
    pub test_script: String,
    pub sort_order: f64,
    #[serde(deserialize_with = "lenient_i64")]
    pub created_at: i64,
    #[serde(deserialize_with = "lenient_i64")]
    pub updated_at: i64,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Default for Collection {
    fn default() -> Self {
        let ts = now_ms();
        Self {
            id: new_id(),
            workspace_id: String::new(),
            name: "New Collection".into(),
            description: String::new(),
            variables: Vec::new(),
            auth: AuthConfig::default(),
            pre_request_script: String::new(),
            test_script: String::new(),
            sort_order: ts as f64,
            created_at: ts,
            updated_at: ts,
            extra: Extra::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(deserialize_with = "lenient_i64")]
    pub created_at: i64,
    #[serde(deserialize_with = "lenient_i64")]
    pub updated_at: i64,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Default for Workspace {
    fn default() -> Self {
        let ts = now_ms();
        Self {
            id: new_id(),
            name: "My Workspace".into(),
            description: String::new(),
            created_at: ts,
            updated_at: ts,
            extra: Extra::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Environment {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub variables: Vec<Variable>,
    pub is_active: bool,
    #[serde(deserialize_with = "lenient_i64")]
    pub created_at: i64,
    #[serde(deserialize_with = "lenient_i64")]
    pub updated_at: i64,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Default for Environment {
    fn default() -> Self {
        let ts = now_ms();
        Self {
            id: new_id(),
            workspace_id: String::new(),
            name: "New Environment".into(),
            variables: Vec::new(),
            is_active: false,
            created_at: ts,
            updated_at: ts,
            extra: Extra::new(),
        }
    }
}

// ---------------------------------------------------------------- responses / history

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ResponseData {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body_text: String,
    /// present for binary payloads (images, files)
    pub body_base64: Option<String>,
    pub content_type: String,
    pub size_bytes: u64,
    pub duration_ms: f64,
    #[serde(deserialize_with = "lenient_i64")]
    pub timestamp: i64,
    /// network / abort error when the request failed before a response
    pub error: Option<String>,
    /// Final URL after redirects (desktop engine only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_url: Option<String>,
    /// HTTP version string, e.g. "HTTP/1.1".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_version: Option<String>,
    /// Non-fatal warnings (e.g. private-network destination, TLS verification disabled).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    /// Detailed timing breakdown (ms).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timing: Option<ResponseTiming>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ResponseTiming {
    pub dns_ms: f64,
    pub headers_ms: f64,
    pub body_ms: f64,
}

impl ResponseData {
    pub fn error(message: impl Into<String>) -> Self {
        Self { error: Some(message.into()), timestamp: now_ms(), ..Default::default() }
    }
    pub fn is_success(&self) -> bool {
        self.error.is_none() && (200..300).contains(&self.status)
    }
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SavedResponse {
    pub id: String,
    pub workspace_id: String,
    pub request_id: String,
    pub request_name: String,
    pub name: String,
    pub method: String,
    pub url: String,
    pub response: ResponseData,
    #[serde(deserialize_with = "lenient_i64")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HistoryEntry {
    pub id: String,
    pub workspace_id: String,
    pub request_id: Option<String>,
    pub method: String,
    pub url: String,
    pub status: u16,
    pub status_text: String,
    pub duration_ms: f64,
    pub size_bytes: u64,
    #[serde(deserialize_with = "lenient_i64")]
    pub timestamp: i64,
    pub favorite: bool,
    /// Request snapshot for replay; literal credentials are redacted.
    pub snapshot: ApiRequest,
    /// Response snapshot (body truncated; full body may live in `body_file`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<ResponseData>,
    /// Relative path of the full response body stored on disk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_file: Option<String>,
    /// Error message, if the request failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ---------------------------------------------------------------- trash / git / tabs

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TrashKind {
    #[default]
    Collection,
    Folder,
    Request,
    Environment,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TrashPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection: Option<Collection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folders: Option<Vec<Folder>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requests: Option<Vec<ApiRequest>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<Environment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TrashEntry {
    pub id: String,
    pub workspace_id: String,
    pub kind: TrashKind,
    pub name: String,
    #[serde(deserialize_with = "lenient_i64")]
    pub deleted_at: i64,
    pub payload: TrashPayload,
}

pub const TRASH_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// Git sync configuration. The access token is never part of this struct's
/// persisted form — it lives in the OS credential store.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GitMeta {
    pub id: String,
    pub repo_url: String,
    /// Absolute path of the working tree on disk ("" = app default).
    pub dir: String,
    pub branch: String,
    pub username: String,
    pub author_name: String,
    pub author_email: String,
    #[serde(deserialize_with = "lenient_i64")]
    pub last_sync_at: i64,
    #[serde(deserialize_with = "lenient_i64")]
    pub created_at: i64,
}

pub const GLOBAL_GIT_META_ID: &str = "git-global";

impl Default for GitMeta {
    fn default() -> Self {
        Self {
            id: GLOBAL_GIT_META_ID.into(),
            repo_url: String::new(),
            dir: String::new(),
            branch: "main".into(),
            username: String::new(),
            author_name: "Zorvilo".into(),
            author_email: "zorvilo@localhost".into(),
            last_sync_at: 0,
            created_at: now_ms(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TabKind {
    #[default]
    Request,
    Collection,
}

/// Persisted tab (session restore).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TabRecord {
    pub id: String,
    pub workspace_id: String,
    pub kind: TabKind,
    /// request id (or collection id for collection tabs)
    pub request_id: String,
    /// unsaved working copy (drafts and dirty tabs)
    pub draft: Option<ApiRequest>,
    pub pinned: bool,
    pub sort_order: f64,
    #[serde(deserialize_with = "lenient_i64")]
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_legacy_request_json() {
        let json = r#"{
            "id":"r1","workspaceId":"w","collectionId":"c","folderId":null,
            "name":"Get user","description":"","protocol":"http","method":"GET",
            "url":"{{base}}/users/:id","pathParams":[{"id":"p","key":"id","value":"1","enabled":true}],
            "params":[],"headers":[{"id":"h","key":"Accept","value":"application/json","enabled":true,"description":""}],
            "cookies":[],
            "auth":{"type":"bearer","apiKey":{"key":"","value":"","addTo":"header"},"bearer":{"token":"t","prefix":"Bearer"},
                    "basic":{"username":"","password":""},"digest":{"username":"","password":""},
                    "oauth2":{"grantType":"client_credentials","authUrl":"","tokenUrl":"","clientId":"","clientSecret":"","scope":"","accessToken":""},
                    "jwt":{"secret":"","payload":"{}","algorithm":"HS256","addTo":"header"},
                    "aws":{"accessKey":"","secretKey":"","region":"us-east-1","service":"execute-api"}},
            "body":{"type":"form-urlencoded","content":"","graphql":{"query":"","variables":"{}"},"formUrlEncoded":[],"multipart":[],"binary":null},
            "preRequestScript":"","testScript":"","variables":[],
            "settings":{"timeoutMs":0,"followRedirects":true,"maxRedirects":10,"verifySsl":true},
            "tags":[],"favorite":false,"sortOrder":1.5,"createdAt":1700000000000.0,"updatedAt":1700000000001,
            "someFutureField": {"x": 1}
        }"#;
        let r: ApiRequest = serde_json::from_str(json).unwrap();
        assert_eq!(r.auth.auth_type, AuthType::Bearer);
        assert_eq!(r.body.body_type, BodyType::FormUrlEncoded);
        assert_eq!(r.created_at, 1_700_000_000_000);
        assert!(r.extra.contains_key("someFutureField"));
        // round trip keeps the unknown field
        let back = serde_json::to_value(&r).unwrap();
        assert_eq!(back["someFutureField"]["x"], 1);
        assert_eq!(back["body"]["type"], "form-urlencoded");
    }

    #[test]
    fn legacy_form_files_fold() {
        let item = FormDataItem {
            kind: FormKind::File,
            file_name: Some("a.txt".into()),
            file_base64: Some("aGk=".into()),
            ..Default::default()
        };
        assert_eq!(item.all_files().len(), 1);
        assert_eq!(item.all_files()[0].file_name, "a.txt");
    }
}
