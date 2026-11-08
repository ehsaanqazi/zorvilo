# Build status

_Last updated: 2026-11-08_

| Check | Result |
|---|---|
| `cargo check --workspace --all-targets` (src-tauri) | clean, 0 warnings |
| `cargo test --workspace` (src-tauri) | all tests pass (core, http, scripting, realtime, storage, git, import/export, runner, IPC contract tests) |
| `tsc -p tsconfig.app.json --noEmit` | clean |
| `eslint src` | 1 pre-existing finding in `src/lib/jsonc.ts` (irregular whitespace) |
| Desktop app launched end-to-end | not yet — run `npm install` then `npm run desktop:dev` |
| Windows / Linux builds | not yet built |

## Done

* egui UI removed; React UI is the only interface, served by Tauri 2.
* Dexie/IndexedDB → SQLite via `db_*` commands; secrets → OS keychain.
* Browser `fetch` + Netlify proxy → Rust HTTP engine (`execute_request`, cancellable).
* Web Worker scripts → Boa in Rust (same `pm` API, plus `sendRequest`, cookies, limits).
* Browser WebSocket/Socket.IO → Rust clients (`realtime_*` commands + `realtime` events),
  with handshake headers.
* isomorphic-git/LightningFS/CORS proxy → libgit2 (`git_*` commands).
* Import (Postman, cURL, bundles), export (Postman, bundles) and codegen → Rust.
* File pickers/saves, clipboard, confirmation dialogs → native via Rust.
* Share links → `zorvilo://request/<workspace>/<request>` deep links.
* OAuth 2.0 token flows and AWS SigV4 are now real features.
* Hard-coded Git token removed from the source.

## Known gaps

* Data from the old browser version is not read automatically (IndexedDB is not
  accessible to a desktop app) — see `MIGRATION_GUIDE.md`.
* `window.alert`-style browser dialogs are not used anywhere; keep it that way (WebViews
  differ in support).
* Code signing / notarisation is not configured (see `DEVELOPMENT.md`).
