#!/usr/bin/env bash
# Copy the Neon database into our own Postgres and PROVE nothing was lost.
#
#   scripts/db/migrate-from-neon.sh [--replace]
#
# Reads NEON_DATABASE_URL (source) and DATABASE_URL (target). Neon is only read.
# 1. opens a REPEATABLE READ snapshot on Neon (a frozen point in time)
# 2. pg_dump from that snapshot
# 3. fingerprints every table (row count + md5 of every row) inside the same snapshot
# 4. restores into the target in ONE transaction (all or nothing)
# 5. fingerprints the target and compares table data + columns/indexes/constraints
# The dump is also uploaded to the backup bucket (migration/) as a safety copy.
#
# For the real cutover, stop the app first so nothing is written to Neon after the snapshot.
. "$(dirname "$0")/lib.sh"

REPLACE=0
[[ ${1:-} == --replace ]] && REPLACE=1

SRC=$(neon_direct "$(pg_url "${NEON_DATABASE_URL:?set NEON_DATABASE_URL to the old Neon connection string}")")
DST=$(pg_url "${DATABASE_URL:?}")
[[ $DST != *neon.tech* ]] || die "DATABASE_URL still points at Neon — set it to the new database first"
[[ $SRC == *neon.tech* ]] || log "note: NEON_DATABASE_URL does not look like Neon: $(redact "$SRC")"

log "source: $(redact "$SRC")"
log "target: $(redact "$DST")"

src_ver=$(pg psql "$SRC" -XAtqc "show server_version_num")
dst_ver=$(pg psql "$DST" -XAtqc "show server_version_num")
dump_ver=$(pg pg_dump --version | grep -oE '[0-9]+' | head -1)
(( dump_ver >= src_ver / 10000 )) || die "pg_dump $dump_ver is older than the Neon server ($src_ver) — use Postgres $((src_ver / 10000)) tools"
(( dst_ver / 10000 >= src_ver / 10000 )) || die "target server ($dst_ver) is older than Neon ($src_ver)"

prepare_empty_target "$DST" "$REPLACE"

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
DUMP=$WORK/neon.dump

# --- 1-3: frozen snapshot on Neon ---------------------------------------------------------
coproc NEON { pg psql "$SRC" -XAtq -v ON_ERROR_STOP=1 2>&1; }
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TIME ZONE 'UTC'; SELECT pg_export_snapshot();" >&"${NEON[1]}"
read -r SNAP <&"${NEON[0]}"
[[ $SNAP =~ ^[0-9A-F]+-[0-9A-F]+-[0-9]+$ ]] || die "could not open a snapshot on Neon: $SNAP"
log "snapshot $SNAP opened — dumping"

pg pg_dump "$SRC" --snapshot="$SNAP" -Fc --no-owner --no-acl > "$DUMP"
log "dump: $(du -h "$DUMP" | cut -f1)"

q=$(pg psql "$SRC" -XAtqc "$CHECKSUM_BUILDER")
echo "$q; select '__END__';" >&"${NEON[1]}"
: > "$WORK/src.cksum"
while read -r line <&"${NEON[0]}"; do
  [[ $line == __END__ ]] && break
  [[ $line == *\|*\|* ]] || die "checksum query failed on Neon: $line"
  echo "$line" >> "$WORK/src.cksum"
done
echo "COMMIT;" >&"${NEON[1]}"; exec {NEON[1]}>&-; wait "$NEON_PID" || true
sort -o "$WORK/src.cksum" "$WORK/src.cksum"
pg psql "$SRC" -XAtqc "$SCHEMA_SQL" > "$WORK/src.schema"

if [[ -n ${BACKUP_BUCKET:-} ]]; then
  setup_backup_remote
  key="$REMOTE/migration/neon-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
  upload_verified "$DUMP" "$key"
  log "safety copy of the Neon dump uploaded: $key"
fi

# --- 4: restore ---------------------------------------------------------------------------
log "restoring into target (single transaction)"
pg pg_restore -d "$DST" --no-owner --no-acl --exit-on-error --single-transaction < "$DUMP"

# --- 5: prove it --------------------------------------------------------------------------
checksums "$DST" > "$WORK/dst.cksum"
pg psql "$DST" -XAtqc "$SCHEMA_SQL" > "$WORK/dst.schema"

printf '\n%-16s %10s  %s\n' TABLE ROWS STATUS
ok=1
while IFS='|' read -r t n h; do
  other=$(grep -E "^$t\|" "$WORK/dst.cksum" || true)
  if [[ $other == "$t|$n|$h" ]]; then st=identical; else st="MISMATCH (target: ${other:-missing})"; ok=0; fi
  printf '%-16s %10s  %s\n' "$t" "$n" "$st"
done < "$WORK/src.cksum"
[[ $(wc -l < "$WORK/src.cksum") == $(wc -l < "$WORK/dst.cksum") ]] || { log "table count differs"; ok=0; }
if diff "$WORK/src.schema" "$WORK/dst.schema" > "$WORK/schema.diff"; then
  echo "schema: identical ($(wc -l < "$WORK/src.schema") columns/indexes/constraints)"
else
  echo "schema: DIFFERENT"; cat "$WORK/schema.diff"; ok=0
fi

(( ok )) || die "verification FAILED — do not switch the app over"
log "SUCCESS: all $(wc -l < "$WORK/src.cksum") tables identical to the Neon snapshot"
