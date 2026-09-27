# Database: self-hosted Postgres + R2 backups

The app used to run on Neon. It now runs on our own PostgreSQL 18 (same major
version as Neon, so dumps restore 1:1). Backups go to the **private** R2 bucket
`dubthatmovie-db-backups` — never to `dubthatmovie`, which is public through
files.dubthatmovie.com.

| Script | What it does |
|---|---|
| `npm run db:migrate-from-neon` | Snapshot-dump Neon → restore into `DATABASE_URL` → prove every table is identical (row count + md5 of every row, plus columns/indexes/constraints). Uploads the Neon dump to `<prefix>/migration/` as a safety copy. Refuses a non-empty target unless `--replace`. |
| `npm run db:backup` | Dump `DATABASE_URL`, check it is readable, upload to `<prefix>/daily/`, confirm the R2 copy has the same md5. Copies to `<prefix>/monthly/` on the 1st. Prunes daily > 14 days, monthly > 365 days. |
| `npm run db:restore -- --list` | List backups in R2. |
| `npm run db:restore -- --verify` | Restore the latest backup into a throwaway `<db>_restore_check` database, compare row counts with live, drop it. Safe to run any time. |
| `npm run db:restore -- latest --replace` | Disaster recovery: wipe `DATABASE_URL` and rebuild it from the latest backup (or pass a file, e.g. `daily/voicer-2026-09-27T092040Z.dump`). |

Config (env or `.env.local` / `.env`): `DATABASE_URL`, `NEON_DATABASE_URL`,
`BACKUP_BUCKET`, `BACKUP_PREFIX` (`local` / `prod`), R2 creds default to
`DO_SPACES_*`. `PG_EXEC` runs the pg tools through a prefix, e.g. inside the db
container on the server.

## Local (WSL, no Docker/sudo)

Postgres 18 is unpacked in `~/.local/opt/postgresql-18`, data in
`~/.local/share/voicer-postgres` (localhost only, password auth).

```sh
voicer-db start            # after every WSL/Windows restart
. ~/.local/opt/postgresql-18/env.sh   # pg18 tools on PATH before running db:* scripts
npm run dev
```

`rclone` lives in `~/.local/bin`. The old `.env.local` (Neon) is saved as
`.env.local.bak-neon`.

## Server cutover (OVH) — plan

1. Add a `db` service to `docker-compose.deploy.yml`: `postgres:18`, named volume,
   healthcheck `pg_isready`, **no public port**, `POSTGRES_USER=voicer`,
   strong `POSTGRES_PASSWORD`. App `depends_on: db (service_healthy)`.
2. In the server `.env`: `NEON_DATABASE_URL=<current Neon URL>`,
   `DATABASE_URL=postgresql://voicer:<pw>@db:5432/voicer`,
   `BACKUP_BUCKET=dubthatmovie-db-backups`, `BACKUP_PREFIX=prod`.
3. Stop the app (so nothing is written to Neon after the snapshot), then:
   `PG_EXEC="docker compose -f docker-compose.deploy.yml exec -T db" scripts/db/migrate-from-neon.sh`
   Only continue if it prints `SUCCESS`.
4. Start the app, check the site.
5. Nightly backup — crontab on the host:
   `15 3 * * * cd /home/ubuntu/voicer && PG_EXEC="docker compose -f docker-compose.deploy.yml exec -T db" scripts/db/backup.sh >> /var/log/voicer-db-backup.log 2>&1`
   plus a weekly `scripts/db/restore.sh --verify`.
6. Keep Neon untouched for a week as a fallback (rollback = put the Neon URL
   back in `DATABASE_URL`, restart). Then update /privacy (it still names Neon).
