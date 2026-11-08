# Architecture

Zorvilo is a Tauri 2 desktop app: the React + TypeScript UI runs in the operating
system's WebView, and everything privileged — networking, storage, scripting, Git,
file access and import/export — runs in Rust.

## Layers

```
┌──────────────── WebView (React 19 / TypeScript / Tailwind / Monaco) ───────────────┐
│ components/  feature UI (unchanged design)                                          │
│ store/       zustand: in-memory state, optimistic updates                           │
│ db/          write queue (debounced, coalesced) + loaders                           │
│ features/    UI-side helpers; privileged work → platform/tauri.ts invoke()          │
└───────────────▲──────────────────────────────────────────────┬─────────────────────┘
                │ events: realtime, deep-link                   │ invoke(command, args)
┌───────────────┴──────────────────────────────────────────────▼─────────────────────┐
│ src-tauri/src  Tauri app: commands/{db,http,realtime,git,files,import_export,       │
│                trash,system}.rs, AppState (DB handle, keychain, HTTP engine,        │
│                in-flight requests, live sockets, Git lock)                          │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ crates/  core · http_engine · scripting · realtime · storage · git_engine ·         │
│          import_export · collection_runner                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

* **IPC surface.** The window's capability grants only `core:default`; the UI cannot use
  any Tauri plugin API directly. Every operation is one of Zorvilo's own commands
  (registered in `src-tauri/src/lib.rs`), which validate their input.
* **Threading.** Commands are async or run on the blocking pool (SQLite, keychain,
  libgit2, file dialogs). Git operations are serialised by a lock; HTTP requests carry an
  operation id so they can be cancelled; realtime connections carry a generation so
  events from a replaced socket are dropped.
* **CSP.** Scripts only from the app bundle; images/media from data:/blob:/http(s) for
  response previews; HTML previews render in a sandboxed `srcdoc` iframe.

## Data flow

* **Boot:** `db_bootstrap` (settings, UI state, workspaces, Git config + token from the
  keychain) → `db_load_workspace` for the active workspace.
* **Edits:** stores update memory immediately and queue `put`/`delete`/`setting` writes;
  `persistence.ts` sends them as one `db_apply` batch (one SQLite transaction) after
  300 ms, on window hide/close, and before any backend operation that reads data.
* **Secrets:** secret variable values and the Git token are moved to the OS keychain by
  the backend; the database row keeps an empty value.

## Request pipeline (`collection_runner::pipeline::execute`)

The UI sends a snapshot (`request`, `collection`, `folderChain`, active `environment`,
`globals`, `settings`) to `execute_request`:

1. Effective auth via inheritance (request → folders → collection).
2. Pre-request scripts (collection → folders → request) in Boa.
3. Variable map (global < environment < collection < folders < request < script-local),
   template resolution incl. dynamic variables.
4. Build URL/headers/body, apply auth (API key, bearer, basic, JWT, OAuth token, SigV4).
5. Network safety check, send with reqwest (proxy, TLS options, cookie jar, redirects,
   timeout, cancellation); Digest answers the 401 challenge.
6. Test scripts; result = response, tests, logs, variable changes. The UI applies the
   variable changes to its stores and records history.

## Git

One repository shared by all workspaces in `<data dir>/repo`, same layout as before
(`workspaces/<slug>-<id8>/{workspace.json,collections/*.json,environments/*.json}`), so
existing repositories keep working. Pull merges with "newer local edit wins"; "Pull
latest" resets to the remote and makes it the source of truth. Merge conflicts abort the
merge and keep the local commit. Commits are scanned for credentials.

## Directories

| Path | Contents |
|---|---|
| `src/` | React UI |
| `src-tauri/src/` | Tauri app crate (commands, state) |
| `src-tauri/crates/*` | backend libraries (no Tauri dependency, unit-tested) |
| `src-tauri/tauri.conf.json` | window, CSP, bundling, `zorvilo://` scheme |
| `src-tauri/capabilities/` | WebView permissions (`core:default` only) |
