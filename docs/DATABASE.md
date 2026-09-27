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

## Server (OVH) — live since 2026-09-27 09:38 UTC

Production runs on the `db` service in `docker-compose.deploy.yml` (host-only file,
backup of the pre-migration version: `docker-compose.deploy.yml.bak-neon-20260927`):

```yaml
  db:
    image: postgres:18
    restart: unless-stopped
    cpuset: "3-5"            # app cores — never competes with Demucs (0-2)
    mem_limit: 2g
    shm_size: 256m
    stop_grace_period: 60s
    environment:
      - POSTGRES_USER=voicer
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      - POSTGRES_DB=voicer
      - POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C.UTF-8 --locale-provider=builtin --builtin-locale=C.UTF-8
      - TZ=UTC
    volumes:
      - pgdata:/var/lib/postgresql   # postgres:18 keeps PGDATA in 18/docker under here
    expose:
      - "5432"                       # compose network only, no public port
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U voicer -d voicer"]
      interval: 5s
      timeout: 5s
      retries: 12
```

`voicer-web` has `depends_on: db: condition: service_healthy`.
Server `.env`: `DATABASE_URL=postgresql://voicer:<POSTGRES_PASSWORD>@db:5432/voicer`,
`POSTGRES_PASSWORD`, `NEON_DATABASE_URL` (old, frozen), `BACKUP_BUCKET=dubthatmovie-db-backups`,
`BACKUP_PREFIX=prod`. Pre-migration `.env`: `.env.bak-neon-20260927`.

Cron (`crontab -l` as ubuntu), logs in `~/logs/`:

```
PATH=/usr/local/bin:/usr/bin:/bin
15 */6 * * *  cd /home/ubuntu/voicer && PG_EXEC="docker compose -f docker-compose.deploy.yml exec -T db" scripts/db/backup.sh >> /home/ubuntu/logs/db-backup.log 2>&1
45 4 * * 0    cd /home/ubuntu/voicer && PG_EXEC="docker compose -f docker-compose.deploy.yml exec -T db" scripts/db/restore.sh --verify >> /home/ubuntu/logs/db-restore-verify.log 2>&1
```

Run any tool by hand the same way, e.g.
`cd ~/voicer && PG_EXEC="docker compose -f docker-compose.deploy.yml exec -T db" scripts/db/restore.sh --list`

**Gotcha:** `docker compose exec -T` reads stdin — never pipe a script into
`ssh host bash -s` that calls it (it swallows the rest of the script). Copy the
script over and run it as a file, or add `</dev/null`.

**Rollback:** Neon is frozen at the cutover and does NOT receive new data. Going back
means copying the self-hosted db back into Neon first (pg_dump db → pg_restore into
Neon), then `DATABASE_URL=$NEON_DATABASE_URL` and `docker compose … up -d voicer-web`.
Neon can be deleted once you're confident (it's no longer used).
