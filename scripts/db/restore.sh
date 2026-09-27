#!/usr/bin/env bash
# Restore a backup from R2.
#
#   scripts/db/restore.sh --list                     show available backups
#   scripts/db/restore.sh --verify [latest|<file>]   restore into a throwaway database next to
#                                                    DATABASE_URL, compare row counts, drop it
#   scripts/db/restore.sh [latest|<file>] [--replace]
#                                                    restore INTO DATABASE_URL (must be empty,
#                                                    or --replace to wipe it first)
#
# <file> is a path inside $BACKUP_PREFIX, e.g. daily/voicer-2026-09-27T120000Z.dump
. "$(dirname "$0")/lib.sh"

setup_backup_remote
MODE=restore WHICH=latest REPLACE=0
for a in "$@"; do
  case $a in
    --list) MODE=list ;;
    --verify) MODE=verify ;;
    --replace) REPLACE=1 ;;
    -*) die "unknown option $a" ;;
    *) WHICH=$a ;;
  esac
done

if [[ $MODE == list ]]; then
  rclone lsl "$REMOTE/" | sort -k4
  exit 0
fi

if [[ $WHICH == latest ]]; then
  WHICH=daily/$(rclone lsf --files-only "$REMOTE/daily/" | sort | tail -1)
  [[ $WHICH != daily/ ]] || die "no backups found in $REMOTE/daily/"
fi

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
log "downloading $REMOTE/$WHICH"
rclone copyto "$REMOTE/$WHICH" "$WORK/backup.dump"
pg pg_restore --list < "$WORK/backup.dump" > /dev/null || die "backup file is unreadable"

LIVE=$(pg_url "${DATABASE_URL:?}")
if [[ $MODE == verify ]]; then
  DBNAME=$(pg psql "$LIVE" -XAtqc "select current_database()")
  CHECK_DB=${DBNAME}_restore_check
  # swap only the database name (last path segment), not the "//voicer:" user part
  TARGET=$(sed -E "s#/[^/?]+(\\?|\$)#/$CHECK_DB\\1#" <<< "$LIVE")
  pg psql "$LIVE" -XAtq -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$CHECK_DB\"" -c "CREATE DATABASE \"$CHECK_DB\" TEMPLATE template0"
  trap 'pg psql "$LIVE" -XAtqc "DROP DATABASE IF EXISTS \"$CHECK_DB\"" >/dev/null; rm -rf "$WORK"' EXIT
else
  TARGET=$LIVE
  prepare_empty_target "$TARGET" "$REPLACE"
fi

log "restoring into $(redact "$TARGET")"
pg pg_restore -d "$TARGET" --no-owner --no-acl --exit-on-error --single-transaction < "$WORK/backup.dump"

counts() { checksums "$1" | cut -d'|' -f1,2; }
if [[ $MODE == verify ]]; then
  counts "$LIVE" > "$WORK/live"; counts "$TARGET" > "$WORK/restored"
  printf '\n%-16s %10s %10s\n' TABLE BACKUP LIVE-NOW
  join -t'|' -a1 -a2 -e missing -o 0,1.2,2.2 "$WORK/restored" "$WORK/live" | tr '|' ' ' | xargs -n3 printf '%-16s %10s %10s\n'
  grep -q missing <(join -t'|' -a1 -a2 -e missing -o 0,1.2,2.2 "$WORK/restored" "$WORK/live") \
    && die "backup and live database have different tables"
  log "backup $WHICH restores cleanly (live may be a little ahead — that's new activity since the backup)"
else
  counts "$TARGET" | tr '|' ' ' | xargs -n2 printf '%-16s %10s\n'
  log "restored $WHICH into the database"
fi
