# Database schema

File: `<data dir>/zorvilo.sqlite3` (WAL mode). Source of truth:
`crates/storage/src/migrations.rs`. Version tracked with `PRAGMA user_version`.

Entities are stored as a JSON document (`data`, same camelCase shape as the
legacy IndexedDB records and Git files) plus indexed relational columns used
for lookups and ordering. Unknown JSON fields are preserved (`extra` maps).

| Table | Columns (besides `data`) | Indexes |
|---|---|---|
| `workspaces` | `id` PK, `name`, `updated_at` | — |
| `collections` | `id` PK, `workspace_id`, `name`, `sort_order`, `updated_at` | workspace |
| `folders` | `id` PK, `workspace_id`, `collection_id`, `parent_id`, `name`, `sort_order`, `updated_at` | workspace, collection, parent |
| `requests` | `id` PK, `workspace_id`, `collection_id`, `folder_id`, `name`, `method`, `url`, `protocol`, `favorite`, `sort_order`, `updated_at` | workspace, collection, folder |
| `environments` | `id` PK, `workspace_id`, `name`, `is_active`, `updated_at` | workspace |
| `global_variables` | `id` PK, `key`, `position` | — |
| `tabs` | `id` PK, `workspace_id`, `sort_order` | workspace |
| `history` | `id` PK, `workspace_id`, `request_id`, `method`, `url`, `status`, `favorite`, `timestamp` | (workspace, timestamp DESC), request |
| `saved_responses` | `id` PK, `workspace_id`, `request_id`, `created_at` | request |
| `settings` | `key` PK (`app`, `ui`) | — |
| `trash` | `id` PK, `workspace_id`, `kind`, `deleted_at` | workspace, deleted_at |
| `git_meta` | `id` PK (`git-global`) | — |

## Secrets

* Variables flagged *secret* (global, environment, collection, folder,
  request) are written with an empty `value`; the real value lives in the OS
  keychain under service `dev.zorvilo.app`, account `var:<variable id>`.
* Git access token: keychain account `git:token`. It is never part of `git_meta`.
* If no keychain is available the values stay in memory for the session.

## Files outside the database

| Path | Purpose |
|---|---|
| `responses/<history id>.bin` | Full response bodies > 64 KB referenced from history |
| `repo/` | Default Git working tree |
| `backups/` | Database backups (`VACUUM INTO`), pre-restore safety copies |
| `logs/zorvilo.log` | Application log (no request data or secrets) |
| `restore.pending` | Marker: backup to swap in on next start |

## Writes

The UI queues writes and sends them in batches to the `db_apply` command; each batch is
one SQLite transaction. Records that fail validation are skipped and reported back
(the rest of the batch still commits). Cascading deletes (workspaces), trash restore and
Git merges run as single transactions in Rust.
