# Development

## Toolchain (install yourself)

* Node.js 20+ and npm
* Rust stable via rustup: <https://rustup.rs>
* Platform prerequisites for Tauri 2:
  * **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  * **Windows:** Visual Studio Build Tools ("Desktop development with C++") and WebView2
    (preinstalled on Windows 10/11)
  * **Linux (Debian/Ubuntu):** `libwebkit2gtk-4.1-dev build-essential curl wget file
    libxdo-dev libssl-dev libdbus-1-dev libayatana-appindicator3-dev librsvg2-dev`

## Commands

```bash
npm install                 # JS dependencies incl. @tauri-apps/cli
npm run desktop:dev         # Vite dev server + Tauri window (hot reload for React, rebuild for Rust)
npm run desktop:build       # release bundles in src-tauri/target/release/bundle/
npm run lint

cd src-tauri
cargo check --workspace --all-targets
cargo test --workspace
cargo clippy --workspace --all-targets
```

Without the npm CLI you can also run `npm run dev` in one terminal and
`cargo run` inside `src-tauri` in another (debug builds load `http://localhost:5173`).

Environment variables:

| Variable | Effect |
|---|---|
| `ZORVILO_DATA_DIR` | Use another data directory (portable installs, testing) |
| `ZORVILO_LOG` | Log filter, e.g. `debug` or `zorvilo=debug` |

Data directory: macOS `~/Library/Application Support/dev.Zorvilo.Zorvilo`, Windows
`%APPDATA%\Zorvilo\Zorvilo\data`, Linux `~/.local/share/zorvilo`. Logs are in `logs/`.

## Adding a backend feature

1. Put the logic in a crate under `src-tauri/crates/` (no Tauri types there) with tests.
2. Expose it as a command in `src-tauri/src/commands/*.rs` and register it in
   `src-tauri/src/lib.rs` (`generate_handler!`). Return `Result<T, String>` with a
   human-readable error; never include secrets in errors.
3. Call it from React through `src/platform/tauri.ts` (`invoke`). JS argument names are
   camelCase; Tauri maps them to snake_case Rust parameters.

## Packaging

`npm run desktop:build` produces `.app`/`.dmg` (macOS), `.msi`/NSIS `.exe` (Windows) and
`.deb`/`.rpm`/`.AppImage` (Linux). Build on each target OS (or in CI).

macOS signing & notarisation: set `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD` and `APPLE_TEAM_ID` before `tauri build`. Windows signing: configure
`bundle.windows.certificateThumbprint` in `tauri.conf.json`.

## Suggested CI (GitHub Actions)

```yaml
name: desktop
on: [push, pull_request]
jobs:
  build:
    strategy:
      matrix: { os: [ubuntu-22.04, macos-latest, windows-latest] }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
      - if: runner.os == 'Linux'
        run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libdbus-1-dev libayatana-appindicator3-dev librsvg2-dev
      - run: npm ci
      - run: cargo test --workspace
        working-directory: src-tauri
      - run: npm run desktop:build
```
