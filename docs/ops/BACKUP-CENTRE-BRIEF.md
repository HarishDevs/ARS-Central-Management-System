# Brief: Backup, Restore and Migrate centre in Super Admin (owner request, 22 Nov 2026)

Owner: "I want an option to completely back up the database and restore it in the app from Super Admin itself, and an option to directly migrate the database from one to another (GoDaddy shared hosting → my private VPS and back). Backup, migration to and fro and restore should include all possible methods and include secrets as well; it should not be restricted by any reason."

Owner decisions (22 Nov 2026):
- **Order:** after the motion review (R2 → R3 → motion review → this).
- **Secrets:** included in every full backup. The whole package is encrypted with a **passphrase the owner types** when making/downloading it and types again to restore or migrate.
- **Attachments:** a full backup always includes every uploaded file (Private Storage), not only the database.

Why: on 22 Nov 2026 the live database was emptied twice (GoDaddy Database Manager → Import drops every table first) and could only be restored by shipping the backup inside a release (v1.76.2, D-402/D-403).

## Scope (all methods)
**Package** (`.arsbak`): one file = manifest (app version, migrations, table list, row counts, file list, hashes) + database dump (schema + data, all tables) + all attachments + secrets (encrypted DB settings re-keyed, and the server env secrets: ENCRYPTION_KEY, SESSION/HMAC secrets, BACKUP_ENCRYPTION_KEY, Firebase, mail/WhatsApp keys, DB_* of the source). Encrypted end-to-end with a key derived from the passphrase (scrypt/argon2-like KDF + AES-256-GCM, chunked so it streams). Checksum per part.

**Backup — where it goes:** download to PC; server Private Storage (/private/backups); Google Drive; S3-compatible; scheduled (daily, keep N) and on demand; automatic **safety snapshot before every restore or migration**.

**Restore — from where:** upload a package (chunked/resumable, no 100 MB limit); pick from the server backup list; from Google Drive / S3; from a URL; from another ARS-CMS (pull). Modes: full (database + files + secrets), database only, files only, a chosen set of tables. Dry run (check passphrase, versions, sizes) before anything is touched. Runs in maintenance mode with a lock; after restore the migrations bring an older backup up to date; failure rolls back to the safety snapshot.

**Migrate — to and fro:**
1. App-to-app over HTTPS (both run ARS-CMS): on the target, Super Admin → Migrate → "Receive" gives a one-time pairing code; on the source, "Send to another server" with URL + code streams the package directly (resumable). Works GoDaddy → VPS and VPS → GoDaddy.
2. Direct database-to-database: source connects to the target MySQL (host/port/user/password/db typed in, never stored) and copies schema + data; files sent over the app link or downloaded.
3. Package file: download here, upload there (offline route).
After migration the target shows which env secrets to set (VPS: writes a ready `.env` it can use; GoDaddy: a list to paste into Secrets), then verifies (row counts, file hashes, sign-in test).

**Safety (does not restrict, only protects):** Super Admin only; typed confirmation (database name) for restore/migrate-in; audit log + email/WhatsApp alert for every backup download, restore and migration; secrets never written in plain text anywhere; passphrase never stored; rate-limited pairing codes that expire.

## Must also fix while here
- GoDaddy importer trap: the Superadmin page explains that Database Manager → Import drops every table and points to this centre instead.
- restore.js / restore-on-start.js reuse the same package reader.
