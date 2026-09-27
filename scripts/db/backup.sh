#!/usr/bin/env bash
# Dump DATABASE_URL and upload it to the private R2 backup bucket.
#
#   scripts/db/backup.sh
#
# Layout in the bucket:  $BACKUP_PREFIX/daily/voicer-<UTC timestamp>.dump
#                        $BACKUP_PREFIX/monthly/…   (copy made on the 1st of each month)
# Retention: daily kept BACKUP_KEEP_DAILY days (default 14), monthly BACKUP_KEEP_MONTHLY
# days (default 365). Old files are pruned only after a new backup uploaded successfully.
. "$(dirname "$0")/lib.sh"

setup_backup_remote
DB=$(pg_url "${DATABASE_URL:?}")
[[ $DB != *neon.tech* ]] || log "note: backing up a Neon database"

exec 9> "${TMPDIR:-/tmp}/voicer-db-backup.lock"
flock -n 9 || die "another backup is already running"

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
TS=$(date -u +%Y-%m-%dT%H%M%SZ)
FILE=$WORK/voicer-$TS.dump

log "dumping $(redact "$DB")"
pg pg_dump "$DB" -Fc --no-owner --no-acl > "$FILE"
# A dump that pg_restore can't read is worthless — check before uploading.
pg pg_restore --list < "$FILE" > "$WORK/toc" || die "dump is unreadable"
tables=$(grep -c ' TABLE DATA ' "$WORK/toc" || true)
(( tables > 0 )) || die "dump contains no table data"
log "dump OK: $(du -h "$FILE" | cut -f1), $tables tables"

upload_verified "$FILE" "$REMOTE/daily/voicer-$TS.dump"
log "uploaded $REMOTE/daily/voicer-$TS.dump"
if [[ $(date -u +%d) == 01 ]]; then
  upload_verified "$FILE" "$REMOTE/monthly/voicer-$TS.dump"
  log "uploaded monthly copy"
fi

rclone delete --min-age "${BACKUP_KEEP_DAILY:-14}d" "$REMOTE/daily/"
rclone delete --min-age "${BACKUP_KEEP_MONTHLY:-365}d" "$REMOTE/monthly/"
log "done — $(rclone lsf "$REMOTE/daily/" | wc -l) daily backups in R2"
