# Shared helpers for the scripts/db/*.sh tools. Sourced, not executed.
#
# Config comes from the environment, falling back to $ENV_FILE
# (default: .env.local if present, else .env) in the repo root.
#
#   DATABASE_URL           the app database (target of migrate/restore, source of backup)
#   NEON_DATABASE_URL      the old Neon database (source of migrate-from-neon only)
#   BACKUP_BUCKET          PRIVATE R2 bucket for dumps (never the public media bucket)
#   BACKUP_PREFIX          folder inside the bucket, e.g. "prod" or "local"
#   BACKUP_S3_ENDPOINT / BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY
#                          default to DO_SPACES_ENDPOINT / DO_SPACES_KEY / DO_SPACES_SECRET
#   PG_EXEC                optional prefix for pg_dump/pg_restore/psql, e.g.
#                          "docker compose -f docker-compose.deploy.yml exec -T db"

set -euo pipefail
export LC_COLLATE=C  # sort/join/grep must agree on byte order
unset LC_ALL

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO_ROOT"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# Read KEY=VALUE lines without eval-ing them (values contain & and ? — sourcing would break).
# Variables already set in the real environment win.
load_env() {
  local f=$1 line key val
  [[ -f $f ]] || return 0
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    [[ $line =~ ^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key=${BASH_REMATCH[2]} val=${BASH_REMATCH[3]}
    if [[ $val =~ ^\"(.*)\"$ || $val =~ ^\'(.*)\'$ ]]; then val=${BASH_REMATCH[1]}; fi
    [[ -n ${!key+x} ]] && continue
    export "$key=$val"
  done < "$f"
}
if [[ -n ${ENV_FILE:-} ]]; then load_env "$ENV_FILE"
elif [[ -f .env.local ]]; then load_env .env.local
else load_env .env
fi

# pg_* binaries, optionally run inside the db container.
read -r -a PG_EXEC_ARR <<< "${PG_EXEC:-}"
pg() { "${PG_EXEC_ARR[@]}" "$@"; }

# libpq rejects Prisma-only query params (?schema=public, connection_limit, ...).
pg_url() {
  local url=$1 base query kept=() parts p
  [[ $url == *\?* ]] || { echo "$url"; return; }
  base=${url%%\?*} query=${url#*\?}
  IFS='&' read -r -a parts <<< "$query"
  for p in "${parts[@]}"; do
    case ${p%%=*} in schema|connection_limit|pool_timeout|pgbouncer|statement_cache_size|socket_timeout) ;; *) kept+=("$p") ;; esac
  done
  if ((${#kept[@]})); then (IFS='&'; echo "$base?${kept[*]}"); else echo "$base"; fi
}

# pg_dump and exported snapshots need Neon's direct endpoint, not the pgbouncer pooler.
neon_direct() { echo "${1/-pooler./.}"; }

redact() { sed -E 's#(://[^:/@]+:)[^@]*@#\1***@#' <<< "$1"; }

# One line per public table: "Table|rows|md5-of-all-row-contents".
CHECKSUM_BUILDER="select coalesce(string_agg(format(
  'select %L, count(*), coalesce(md5(string_agg(md5(x::text), '''' order by md5(x::text))), ''-'') from public.%I x',
  c.relname, c.relname), ' union all ' order by c.relname), 'select null, null, null where false')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p')"

# Columns, indexes and constraints — used to prove the structure survived too.
SCHEMA_SQL="select 'col '||table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'')
  from information_schema.columns where table_schema='public'
union all select 'idx '||indexname||' '||indexdef from pg_indexes where schemaname='public'
union all select 'con '||conrelid::regclass||' '||conname||' '||pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'
order by 1"

checksums() { # url -> sorted checksum lines
  local q; q=$(pg psql "$1" -XAtqc "$CHECKSUM_BUILDER")
  pg psql "$1" -XAtq -c "SET TIME ZONE 'UTC'" -c "$q" | sort
}

table_count() { pg psql "$1" -XAtqc "select count(*) from pg_tables where schemaname='public'"; }

# Make sure the target database is empty, or wipe it when --replace was given.
prepare_empty_target() { # url replace(0|1)
  local n; n=$(table_count "$1")
  if [[ $n != 0 ]]; then
    [[ $2 == 1 ]] || die "target already has $n tables — refusing to overwrite (pass --replace to wipe it first)"
    log "--replace: dropping everything in schema public of the target"
    pg psql "$1" -XAtq -v ON_ERROR_STOP=1 -c "SET client_min_messages = warning" -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public"
  fi
}

# rclone remote "voicerbackup:" configured purely from env (no config file needed).
setup_backup_remote() {
  : "${BACKUP_BUCKET:?set BACKUP_BUCKET (private R2 bucket)}"
  : "${BACKUP_PREFIX:?set BACKUP_PREFIX (e.g. prod or local)}"
  export RCLONE_CONFIG_VOICERBACKUP_TYPE=s3
  export RCLONE_CONFIG_VOICERBACKUP_PROVIDER=Cloudflare
  export RCLONE_CONFIG_VOICERBACKUP_REGION=auto
  export RCLONE_CONFIG_VOICERBACKUP_ACL=private
  export RCLONE_CONFIG_VOICERBACKUP_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_VOICERBACKUP_ENDPOINT=${BACKUP_S3_ENDPOINT:-${DO_SPACES_ENDPOINT:?}}
  export RCLONE_CONFIG_VOICERBACKUP_ACCESS_KEY_ID=${BACKUP_S3_ACCESS_KEY_ID:-${DO_SPACES_KEY:?}}
  export RCLONE_CONFIG_VOICERBACKUP_SECRET_ACCESS_KEY=${BACKUP_S3_SECRET_ACCESS_KEY:-${DO_SPACES_SECRET:?}}
  export RCLONE_LOG_LEVEL=${RCLONE_LOG_LEVEL:-ERROR}  # no "config file not found" noise
  command -v rclone >/dev/null || die "rclone not installed"
  [[ $BACKUP_BUCKET != "${DO_SPACES_BUCKET:-}" ]] || die "BACKUP_BUCKET must not be the public media bucket"
  REMOTE="voicerbackup:$BACKUP_BUCKET/$BACKUP_PREFIX"
}

# Upload a file and confirm R2 holds the exact same bytes.
upload_verified() { # local-file remote-path
  rclone copyto --s3-no-check-bucket "$1" "$2"
  local want got
  want=$(md5sum "$1" | cut -d' ' -f1)
  got=$(rclone md5sum "$2" | cut -d' ' -f1)
  [[ $want == "$got" ]] || die "upload checksum mismatch for $2 (local $want, R2 $got)"
}
