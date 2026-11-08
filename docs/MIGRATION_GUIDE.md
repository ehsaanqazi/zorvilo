# Migrating from the browser version

The browser version kept data in IndexedDB, which the desktop app cannot
read. Use one of the export paths the legacy app already
provides. Your original data is never modified.

## Option A — Git repository (recommended if you used Git sync)

1. In the legacy app, run **Sync** so everything is pushed.
2. In Zorvilo: **Git** (header) → enter the same remote URL, branch and an
   access token → **Clone repository**.
3. All workspaces, collections, folders, requests and environments are
   imported with their original ids. Secret variable values were never
   committed, so re-enter them (they then go to the OS keychain).

The on-disk layout is identical (`workspaces/<slug>-<id8>/…`), so both apps
can keep syncing the same repository during a transition period.

## Option B — Workspace bundle

1. Legacy app → Workspaces → **Export** (produces
   `{"__yaakLite":"workspace-bundle", …}`) for each workspace.
2. Zorvilo → **Import** → *Choose JSON file(s)* → select the bundle(s).
3. Read the report: counts, failed records (with reason) and warnings (e.g.
   dangling folder references that were moved to the collection root).

Original ids are kept, so importing the same bundle again replaces those records
instead of duplicating them. Records that cannot be read are listed in the result.

## Option C — Postman exports

Legacy app → Export dialog → Postman collections / environments → import the
JSON files in Zorvilo. Ids are new; secrets are blank unless you exported
them.

## What is carried over

| Data | A (Git) | B (bundle) | C (Postman) |
|---|---|---|---|
| Workspaces | ✅ | ✅ | — |
| Collections, folders, requests (ids preserved) | ✅ | ✅ | new ids |
| Collection auth, scripts, variables | ✅ | ✅ | ✅ |
| Environments | ✅ | ✅ | ✅ |
| Secret values | ❌ (never committed) | ❌ unless exported | ❌ unless exported |
| Global variables | ❌ | ❌ | ❌ |
| History / saved responses | ❌ | ❌ | ❌ |
| Settings, open tabs | ❌ | ❌ | ❌ |

Fields from the legacy format that the Rust models don't know are kept in
each record's `extra` map and written back on export / Git sync, so nothing
is silently dropped.

## Rollback

* Before a large import, use **Settings → Download backup (.zip)** (all workspaces
  as Git-layout JSON files, including history when a repository exists). Restore by
  importing the files or cloning the repository again.
