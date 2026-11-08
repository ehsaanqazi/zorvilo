# Feature matrix — browser version → Zorvilo desktop

The React UI is carried over unchanged; this table shows where each feature's logic now runs.

| Feature | Browser version | Zorvilo desktop | Status |
|---|---|---|---|
| Workspaces, collections, folders, requests, drag & drop, tabs, split view | React + Zustand | same React UI; persisted via `db_*` commands (SQLite) | ✅ |
| Trash (30 days) | Dexie | `trash_*` commands, restore rules in Rust | ✅ |
| Persistence | Dexie / IndexedDB | SQLite (`crates/storage`), batched transactions | ✅ |
| Secret variables | plaintext in IndexedDB | OS keychain | ✅ improved |
| HTTP / GraphQL sending | `fetch` (+ Netlify CORS proxy) | reqwest (`execute_request`), no CORS limits, cancellable | ✅ improved |
| Cookies | hidden by the browser | cookie jar, `Cookie` header honoured | ✅ improved |
| Proxy / TLS / client certificates | not possible | Settings → proxy, CA, client cert, verification | ✅ new |
| Auth: API key, bearer, basic, Digest, JWT | TS | Rust (`http_engine::auth`) — Digest SHA-256/-sess, JWT HS384/512 added | ✅ |
| OAuth 2.0 | paste token only | client credentials, password, auth code + PKCE, refresh | ✅ new |
| AWS SigV4 | placeholder | signed at send time | ✅ new |
| Variables & dynamic variables | TS | Rust for sending; TS kept for highlighting/hover | ✅ |
| Scripts (`pm` API) | Web Worker | Boa (`crates/scripting`) + `sendRequest`, cookies, limits | ✅ improved |
| Collection runner | TS loop | same UI, each request executed in Rust (iteration info passed) | ✅ |
| WebSocket / Socket.IO | browser WebSocket | `realtime_*` commands + events, handshake headers | ✅ improved |
| Git sync | isomorphic-git + LightningFS + proxy | libgit2 (`git_*` commands), token in keychain, secret scan | ✅ |
| Repo backup ZIP | TS | files from `git_backup_files`, zipped in UI, native save | ✅ |
| Import Postman / env / bundle / cURL | TS | `import_parse`, `parse_curl` | ✅ |
| Export Postman / env / bundle | TS + downloads | Rust export + native save dialogs (folder for multi-export) | ✅ |
| Copy as cURL / fetch / Python / PowerShell | TS | `generate_code` | ✅ |
| File pickers, downloads, clipboard | browser APIs | native dialogs / clipboard via Rust | ✅ |
| Share links | `#/request/…` URL | `zorvilo://request/…` deep links | ✅ |
| Delete all data / recovery screen | IndexedDB wipe | `db_wipe_all` (+ keychain, repo) / `db_reset` | ✅ |
| Monaco editor, themes, shortcuts, command palette | React | unchanged | ✅ |
| PWA manifest / Netlify functions | web only | removed | — |
