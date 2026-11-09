# Zorvilo — Local-First Desktop API Client

A minimal, fast desktop API client inspired by **Postman** and **Bruno**, for macOS, Windows
and Linux. Local-first, offline-capable and Git-backed: data lives in a local SQLite database
(secrets in the OS keychain), and your collections live as reviewable JSON files in a Git
repository.


<img width="1108" height="538" alt="Screenshot 2026-11-09 at 10 10 01 AM" src="https://github.com/user-attachments/assets/b49a8602-e74c-4b51-ad75-4fc3431140eb" />


## Tech Stack

**UI:** React 19 · TypeScript (strict) · Vite · Tailwind CSS v4 · shadcn/ui-style components ·
Zustand · Monaco Editor

**Desktop shell:** Tauri 2 (system WebView — no bundled browser)

**Backend (Rust):** Tokio · reqwest/rustls (HTTP) · tokio-tungstenite (WebSocket/Socket.IO) ·
SQLite (rusqlite) · OS keychain (keyring) · libgit2 (git2) · Boa (sandboxed JavaScript for
scripts)

---

## Features

### Workspaces
- Multiple workspaces, each with its own collections, environments, history, saved responses and Git repo
- Create, rename, duplicate (deep copy), delete, export as bundle, instant switching

### Collections & Tree
- Nested folders with unlimited depth, virtualized tree (smooth with thousands of requests)
- Create / rename (inline or double-click) / duplicate / delete / move
- Drag & drop requests and folders (into folders, collections, or reorder before a request)
- Live search across names, URLs, descriptions, tags and saved responses with subtree pruning
- Collection details tab (Postman-style): **Overview** (name, description, stats),
  **Authorization** (inherited by requests), **Scripts** (collection-level pre-request/tests),
  **Variables** (collection + global variables in one place)

### Collection Runner
- Run a whole collection or folder in order, with **select all / deselect all** per request
- **Iterations** — repeat the selected set N times, grouped per iteration
- Live stats at the top: completed count, **success (2xx) / failed**, **average response time**,
  test pass totals
- **Preserve responses**: click any completed request to expand its full details in tabs —
  Params, Headers, Body, Response, Response Headers (mirrors the request window)
- Optional delay between requests, stop mid-run
- Run data is in-memory only — closing the modal discards everything

### Request Types (the "+" menu)
- **HTTP** — full request builder
- **GraphQL** — dedicated request type opening straight into the query editor
  (query + variables, sent as standard GraphQL-over-HTTP)
- **WebSocket** — live client: connect/disconnect, send frames, scrolling message log with
  direction + timestamps, `{{variables}}` resolved in URL and messages
- **Socket.IO** — built-in dependency-free client (Engine.IO v4 over websocket): handshake,
  ping/pong, emit any event with JSON/text payloads, live event log
- **Collection**

### Requests
- All methods: GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD
- Query params, headers, cookies, description, tags, favorites
- **Params ↔ URL live sync**: editing the params table updates the URL bar instantly and
  typing a query string in the URL fills the params table (Postman behavior)
- Body types: JSON, Raw, XML, HTML, Text, GraphQL (query + variables), x-www-form-urlencoded,
  multipart/form-data (text + file parts), Binary
- Per-request settings: timeout, follow redirects, TLS verification
- Bulk Edit mode for params/headers/cookies (`key:value` lines, `//` to disable)
- Copy as code: **cURL, JavaScript (fetch), Python (requests), PowerShell**
- Import by pasting a **cURL command straight into the URL bar** (or into the Import dialog)
- Unsaved drafts with dirty indicator; closing prompts **Save / Don't save** with
  "remember my choice"; Save opens a **Postman-style destination picker** — choose a
  collection, click folders to drill into the exact spot

### Authentication
- No Auth, API Key (header/query), Bearer, Basic, **Digest (MD5 / MD5-sess / SHA-256
  challenge/response)**, **JWT (HS256/384/512, signed at send time)**, **OAuth 2.0** (client
  credentials, password, authorization code + PKCE via the system browser, refresh),
  **AWS Signature v4**
- **Inherit from parent**: requests default to the collection's auth, exactly like Postman

### Variables
- Scopes with precedence: **Request → Collection → Environment (workspace) → Global**
- `{{variable}}` resolution everywhere (URL, params, headers, cookies, auth, body), nested refs
- **Dynamic variables**: `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$isoDate}}`,
  `{{$randomInt}}`, `{{$randomBoolean}}`, `{{$randomAlphaNumeric}}`
- Color-highlighted in the URL bar and body editors (orange = resolved, red = unresolved)
- **Autocomplete**: typing `{{` in the URL bar or body editors suggests every variable in
  scope (with value preview + scope badge) including all dynamic variables — arrow keys +
  Enter/Tab to insert
- **Hover a variable** to see its value + scope, or quick-add a missing one on the spot
- Secret values (masked), enable/disable per variable
- Environments: create, rename, duplicate, delete, activate, import/export (Postman format)

### Scripting (pm API)
- Pre-request and test scripts at **request and collection level**
- Runs in a **sandboxed JavaScript engine (Boa) inside the Rust backend** with a Postman-style API:
  `pm.test`, `pm.expect` (equal/eql/include/property/above/below/ok/not…),
  `pm.response` (code/status/json()/text()/headers/to.have.status),
  `pm.environment / pm.globals / pm.collectionVariables` (get/set/unset — persisted),
  `pm.variables.get` (full precedence), `pm.request` (mutate URL/method/headers pre-send),
  `pm.sendRequest`, `pm.cookies`, `pm.info`, `pm.execution.setNextRequest`,
  `console.log` capture; wall-clock timeout plus loop and recursion limits
- Test results + console output shown in the response panel's **Tests** tab and in the Runner

### Response Viewer
- Status, time, size; Pretty (Monaco, syntax highlighted) / Raw / Preview (HTML sandbox, images)
- Headers table with filter, cookies view, search inside body (Ctrl+F in editor)
- Copy body, download body, JSON pretty-print with configurable indent
- **Saved responses** (Postman "examples"): save, list per request, view, rename, delete —
  persisted across reloads
- Saved responses appear **nested under their request in the sidebar tree** (with a count
  badge); click one to open it in the response panel, right-click to open / rename / delete
- **Diff vs current**: side-by-side Monaco diff of a saved response against the live one

### History
- Every send recorded automatically (method, URL, status, duration, size, timestamp)
- Search + filters (favorites / 2xx / errors), favorite entries survive trimming
- One-click replay opens a draft with the full original request snapshot

### Tabs & Layout
- Unlimited tabs, persisted across reloads (session restore), Postman-style **"+" button on
  the tab strip** (new request / new collection)
- Reorder by drag & drop, pin, duplicate, close/others/all, middle-click close
- **Split view**: open any tab side-by-side with the active one (resizable)
- **Layout toggle** in the bottom toolbar: request/response stacked (top/bottom) or
  side-by-side (left/right) — one click switches back and forth
- Bottom **status bar** with active environment, git branch and incoming-commit count

### Global Search (Ctrl+K)
- Command palette searching requests, collections, folders, environments, variables,
  history and saved responses — plus quick actions (new request, theme, settings, git…)

### Import / Export
- Import: Postman Collection **v2.0 & v2.1**, Postman Environment, workspace bundle, **cURL**
- **Multi-file import**: pick several collection/environment JSON files at once
- **Multi-select export dialog**: check any mix of collections and environments —
  each one is saved as its own Postman JSON file (several → choose a folder)
- Also exports: full workspace bundle, single request JSON

### Git Sync
- **One shared repository for ALL workspaces** — each workspace syncs into its own folder
  (`workspaces/<name>/collections/…`, `workspaces/<name>/environments/…`), and every file
  carries its workspaceId so collections/environments always land back in the right workspace
- Native Git (libgit2) against a working tree in the app data folder — no CORS proxy needed
- Clone, init, commit, pull, push, branch switching, status/changed files, token auth
  (the token is stored in the OS keychain)
- **Sync button with live badge**: background `git fetch` every minute shows how many commits
  are waiting (e.g. `Sync 3`); one click discards local changes and hard-pulls the latest
- **Uncommitted changes count** shown in the Sync tooltip
- **Discard all changes**: reset collections and environments to the last commit (with
  confirmation)
- Background auto-sync on an interval (minimum 5 minutes), conflict detection with clear
  errors, local edits win on normal pulls (per-record timestamps)
- **Secret variables are never committed** — their values are redacted in repo files and
  kept local-only (OS keychain)
- A secret scan warns when something that looks like a credential is committed

### Safety
- **Confirmation modal before every delete**, naming the entity type
- **Trash with 30-day retention** for collections, folders, requests and environments —
  restore or delete forever from the Trash panel
- Debounced, batched, transactional SQLite writes, flushed when the window hides/closes
- Corrupt-database recovery screen (the old file is moved aside, never deleted)
- **Delete All Data** (Settings → Danger zone): wipes the database, keychain secrets and the
  Git working tree — a factory reset
- Hardened surface: strict Content-Security-Policy, the WebView can only call Zorvilo's own
  Rust commands, HTML previews render in a fully sandboxed iframe, user scripts run in an
  isolated engine with no filesystem/process access, no `innerHTML`/`eval` in app code

### UI / UX
- Minimal flat design, light/dark/system theme (no flash on load), resizable panels,
  collapsible sidebar, toasts, keyboard-driven
- Monaco loads lazily — first paint stays instant

### Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| Ctrl+Enter | Send request (works inside body editor) |
| Ctrl+K | Command palette |
| Ctrl+N / Ctrl+Shift+N | New request / new collection |
| Ctrl+S | Save draft to a collection |
| Ctrl+W | Close tab (with save prompt) |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+D | Duplicate tab |
| Ctrl+L | Focus URL bar |
| Ctrl+B | Toggle sidebar |
| Ctrl+E | Environments |
| Ctrl+, | Settings |

### Updates & About
- **Settings → Updates**: check for and install the latest version straight from
  **GitHub Releases** (configurable release repository)
- **Settings → About**: app version, links and project information

### Settings
Tabbed settings dialog — theme, UI/editor font size, word wrap, JSON indent, default request timeout, default headers,
max history entries, close-tab behavior, cookies, TLS verification, custom CA / client
certificate, HTTP/SOCKS proxy, Git author/token, auto-sync interval, update source

---

## Getting Started

Prerequisites (install once): Node.js 20+, Rust stable (https://rustup.rs) and the platform
toolchain — macOS: Xcode Command Line Tools · Windows: Visual Studio Build Tools (C++) +
WebView2 (preinstalled on Windows 10/11) · Linux: `libwebkit2gtk-4.1-dev build-essential
libssl-dev libdbus-1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev`.

```bash
npm install
npm run desktop:dev     # Vite + the Tauri window with hot reload
npm run desktop:build   # production bundles (.app/.dmg, .msi/.exe, .deb/.AppImage/.rpm)
npm run lint            # eslint
npm run format          # prettier
cd src-tauri && cargo test --workspace   # Rust tests
```

Share links use the `zorvilo://request/<workspace>/<request>` scheme (registered by the
installed app).

### Landing page

The official website lives in `landing/` (React + Vite + Tailwind CSS v4). It shows
features, a product preview, FAQ and download links pulled from the latest GitHub release.

```bash
cd landing
npm install
npm run dev       # local dev server
npm run build     # static production build in landing/dist
```

## Architecture

```
src/                 React UI (unchanged look & feel)
  components/        feature-based UI (request, response, sidebar, tabs, git, runner, …)
  features/          UI-side logic; anything privileged calls the Rust backend
  platform/          Tauri bridge (invoke / events), clipboard, dialogs
  store/             zustand stores (data, tabs, environments, git, ui, settings, …)
  db/                write queue + loaders talking to the Rust database commands
src-tauri/           Rust backend (Tauri app crate + workspace)
  src/commands/      IPC commands: db, http, realtime, git, files, import_export, trash, system
  crates/core        models, variables, inheritance, URL/path params, JSONC
  crates/http_engine reqwest engine, auth (Digest/JWT/SigV4), OAuth 2.0, network safety
  crates/scripting   Boa runtime + Postman-compatible `pm` prelude
  crates/realtime    WebSocket + Socket.IO clients
  crates/storage     SQLite, migrations, keychain, data paths
  crates/git_engine  libgit2 operations, repo file layout, merge plan, secret scan
  crates/import_export  Postman, cURL, codegen, bundles
  crates/collection_runner  shared request execution pipeline
landing/             marketing website (sections, mockups, GitHub release/stats hooks)
```

The UI keeps its state in memory and queues writes; Rust owns networking, storage,
scripting, Git and import/export.
