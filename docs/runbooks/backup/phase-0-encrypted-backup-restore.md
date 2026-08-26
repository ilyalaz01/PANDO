# Encrypted logical backup and clean-restore gate

## Boundary and status

This runbook implements Phase 0 gate 10 for the current relational slice. Timestamped SQL migrations remain the only schema source. Each encrypted archive contains a schema dump for audit/emergency inspection, application data from `api, identity, catalog, targets, overlay, sessions, evidence, mastery, review, planning, integrations, outbox`, the Auth rows required by Identity foreign keys, and `pando.storage-manifest.v1`.

The Storage manifest contains bucket, object path, byte size, and SHA-256. It does **not** contain Storage object bytes. Before Preparation Packs, evidence attachments, or any irreplaceable object are accepted, add and rehearse an object-byte export/replay step against Supabase Storage. Until then, do not describe the whole product backup gate as complete. Live R2 upload is also operational evidence, not a requirement of the local restore test.

## Secret handling and cryptography

`PANDO_BACKUP_PASSPHRASE_FILE` names a regular, non-symlink file. The secret value is never accepted in argv, printed, committed, or uploaded with the archive. The streaming container uses scrypt (`N=32768, r=8, p=1`) and AES-256-GCM with a fresh 128-bit salt and 96-bit nonce. The public versioned header is authenticated as AAD; each bundled member also has an authenticated SHA-256 and length. Both the encrypted header and inner manifest must declare the exact boundary literal `phase0-relational-plus-storage-manifest`; matching arbitrary values are rejected. The inner manifest header is capped at 1 MiB and must contain exactly one each of `database-schema.sql`, `auth-data.sql`, `database-data.sql`, and `storage-manifest.json`; its backup ID and boundary must match the encrypted header. Temporary plaintext lives only in an OS-created private scratch directory and is removed on exit. On POSIX, the loader opens the secret with `O_NOFOLLOW` and reads metadata plus bytes through one handle. On Windows, `lstat` plus open is not an atomic anti-symlink guarantee and mode bits do not prove a private ACL; keep the secret in a user-only directory that no other account can write, and verify its Windows ACL outside this tool.

Generate at least 32 random bytes and keep two recovery copies: one in a password manager and one offline in a sealed location. Test both copies quarterly. A lost secret makes backups unrecoverable.

Rotation is additive: create and verify a new archive with the new secret, retain at least one verified archive under the old secret until the new recovery copies pass a restore rehearsal, then expire the old generation under retention. Never overwrite or re-encrypt the only known-good archive.

## Create

Use the pinned CLI and do not put a database URL/password in argv:

```text
pnpm exec supabase db dump --local --schema api,identity,catalog,targets,overlay,sessions,evidence,mastery,review,planning,integrations,outbox --file <scratch>/database-schema.sql
pnpm exec supabase db dump --local --schema auth --data-only --file <scratch>/auth-data.sql
pnpm exec supabase db dump --local --schema api,identity,catalog,targets,overlay,sessions,evidence,mastery,review,planning,integrations,outbox --data-only --file <scratch>/database-data.sql
pnpm backup:seal -- --schema <scratch>/database-schema.sql --auth-data <scratch>/auth-data.sql --data <scratch>/database-data.sql --storage-manifest <scratch>/storage-manifest.json --output <private>/pando-<UTC timestamp>.pando
```

Before packing, `seal` opens every input once and copies it into the private scratch directory while calculating the exact staged length and digest. The manifest and bundle are then built only from those immutable staged bytes, so later source-file changes cannot make the archive internally inconsistent. POSIX input opens use `O_NOFOLLOW`; Windows has the same non-atomic `lstat` limitation described above for the secret, so keep dump inputs in a user-only directory. The seal command flushes and closes its completed temporary file before a no-clobber hard-link publish. On POSIX it then `fsync`s the parent directory so the published name is durable. Windows keeps the same flushed-file and no-clobber guarantees, but this tool cannot portably `fsync` a directory there. If POSIX parent-directory `fsync` fails after publication, the command returns failure and preserves the already-published valid archive; inspect and verify that exact archive before choosing a new output path or applying retention, rather than blindly retrying or deleting it. The Ubuntu `backup-restore` CI job exercises the directory-`fsync` path; a Windows-only local run cannot.

Delete the exact plaintext scratch directory after the archive is verified. The manifest format is:

```json
{"format":"pando.storage-manifest.v1","generated_at":"ISO-8601","objects":[{"bucket":"private-bucket","path":"object-key","bytes":123,"sha256":"64 lowercase hex"}]}
```

## Restore

Restore only into a disposable, clearly named local Supabase project. Do not run reset against a linked or production project. `backup:open` creates plaintext files: its resolved output must be outside the repository. The only in-repository exception is an exact child of the ignored `backup-private/` directory; verify it with `git check-ignore` before opening. Create the parent with a user-only ACL (`0700` or stricter on POSIX, an equivalent user-only ACL on Windows).

```text
pnpm backup:open -- --input <archive>.pando --output <private-extract>/<backup-id>
pnpm exec supabase db reset --local --sql-paths <relative-auth-data.sql> --sql-paths <relative-database-data.sql>
pnpm exec supabase db lint --local --level warning
```

Record the exact resolved extraction path before opening. After reset and verification, remove only that exact directory and verify that it is gone; never use a glob, repository root, shared parent, or unresolved environment variable for cleanup. The reset first recreates schema from migrations, then loads Auth before application data. The repository's representative Catalog/Target fixture lives in `supabase/seed.sql`, not in a migration: restore `--sql-paths` replace the normal seed path so archived canonical rows are restored exactly once with the rest of application data. Verify row counts, API/RLS isolation under at least two synthetic subjects, command/outbox contract versions, and the Storage manifest. `pnpm verify:backup` automates this against a randomly named temporary local stack and proves positive and negative restored-user isolation, the event contract, and ciphertext tamper rejection. It uses only synthetic `.test` identities and removes the stack with `pnpm exec supabase stop --no-backup`.

`backup:open` atomically claims a previously absent output directory and never recursively removes that path after the claim. If copying fails, it reports the exact incomplete output path and preserves it for explicit operator inspection and cleanup. This prevents a concurrent path replacement from turning automatic error cleanup into deletion of unrelated data.

## Retention and off-site boundary

For a one-user pre-revenue deployment retain 7 daily, 4 weekly, and 6 monthly successful archives; retain the latest quarterly restore-tested archive for 12 months. Expire only after a newer generation has passed clean restore. Record backup ID, ciphertext SHA-256, UTC time, boundary version, restore-test date, and retention class—never the secret.

Cloudflare R2 Standard is an optional off-site adapter, never a runtime or decryption dependency. `pnpm backup:r2-plan -- --input <archive>.pando --account-id <32 lowercase hex> --bucket <bucket>` structurally validates the encrypted envelope and emits the non-secret S3 target plan; it deliberately performs no upload. The emitted key is `pando/logical/<created-date>/<backup-id>.pando`. Upload only the final `.pando` ciphertext using an S3-compatible client, a bucket-scoped token, TLS, and conditional overwrite prevention. R2 credentials and the decryption secret must be separate. A live upload needs an operations-owned adapter/rehearsal; no cloud credentials are required by this repository test.

Repository setting follow-up: configure the external GitHub branch ruleset to require the
aggregate `phase0` CI check before merging to `main`. That check depends on `secrets`, `verify`,
`database`, and `backup-restore`, without rerunning their expensive work. Repository files cannot
enforce that hosting setting.

Primary references: [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), [Supabase database backups](https://supabase.com/docs/guides/platform/backups), [Supabase Storage downloads](https://supabase.com/docs/guides/storage/management/download-objects), [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [Node.js crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html), and [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/get-started/s3/).
