#!/bin/bash
# SuperSync Server Restore Script
#
# Usage:
#   ./scripts/restore.sh <backup.sql.gz | backup.sql.gz.enc> [--ledger <supersync_tombstones_*.csv.enc>]
#
# Env (same names as backup.sh, so one .env drives both):
#   DB_CONTAINER (default supersync-postgres)  POSTGRES_USER  POSTGRES_DB  BACKUP_DIR
#   BACKUP_ENCRYPTION_PASSPHRASE_FILE (default /run/secrets/backup_passphrase) — needed for
#   the .enc artifacts backup.sh writes by default
#   HEYTA_ALLOW_EMPTY_TOMBSTONES=1 — assert "this deployment has never had a closed account".
#   Without it, a restore whose gate would read zero tombstones is a refusal, not a pass.
#
# --ledger takes the closure ledger backup.sh writes next to the dump (the newest one). It is
# not optional in the sense that matters: a restore with no tombstones anywhere in sight is
# exactly the case the gate exists for, and the live database cannot remember what the snapshot
# it is about to be rolled back to never recorded.
#
# What this script is FOR, in one line: it is not just an importer, it is the gate that
# makes "restore must not resurrect a closed account" (ADR-0055 / UK GDPR Art.17 as the
# ICO describes backups: beyond use + age out) a reproducible refusal instead of an
# adjective in a policy document.
#
# Order matters and is asserted by tests/restore-script.spec.ts:
#   0. a `.enc` artifact is decrypted FIRST (wrong key must fail before anything is read
#      from it) — into a 0700 directory with a 0600 file, removed by the EXIT trap. This is
#      a deliberate, disclosed tradeoff: `gzip -t` needs a seekable file and the import needs
#      a second pass, so a fifo cannot serve both. The decrypted copy lives no longer than
#      this run and the operator sees the path printed.
#   1. artifact exists and gzip -t passes (a truncated dump can still be a VALID gzip,
#      see the #9836 note in backup.sh -- so this is necessary, not sufficient)
#   1b. 🔴 if a closure ledger was passed, it is decrypted and shape-checked HERE -- before
#      a single byte of the artifact is applied. A ledger that turns out to be garbage after
#      the import would leave a half-restored database and a gate that cannot be trusted.
#      This is the other half of the fix for the hole step 2 describes: the live database can
#      only carry what it already knew, so restoring a fresh machine (or a database where the
#      closures were rolled back long ago) has to be told where the ledger is.
#   2. 🔴 the tombstones the LIVE database already knows are carried OUT of the database,
#      to a host-side 0600 file, BEFORE the import. This step is the whole reason the gate
#      protects anything real: the documented recovery path drops the schema and applies the
#      artifact, so restoring a pre-closure snapshot also rolls `account_tombstones` back to
#      the (empty) state it had at dump time. Without this step the gate reads zero
#      tombstones from the very database where the closed account just came back, prints
#      "tombstones=0 removed=0", and calls that a pass. Found by the first real-artifact run
#      (scripts/verify-restore-gate-on-real-db.sh), not by the fake-docker tests -- a fake
#      that ignores stdin cannot see which file is being read.
#   3. import (ON_ERROR_STOP=1, so a failed import never reaches the gate looking green)
#   4. the database -- as it now stands, after the artifact has been applied -- really has
#      account_tombstones
#      -> 🔴 Checked AFTER the import on purpose: the documented full-database recovery
#         drops the schema first, so the table legitimately does not exist before the
#         artifact creates it. Checking it earlier would reject the one path it protects.
#         Skipping the check entirely is what degenerates into "0 tombstones, 0 deleted,
#         looks fine" -- a criterion that can never fail is worse than none.
#   5. carry the preserved tombstones back IN (idempotent: rows the artifact already
#      carries are not inserted twice). The merged set is the UNION of what the live database
#      knew and what the ledger recorded, deduplicated by user_id -- one account can only be
#      closed once, so a duplicate row is the same fact written twice, not a conflict.
#   5b. 🔴 if the table is now EMPTY, the gate has no input: "tombstones=0 removed=0" is printed
#      over a database where a closed account may have just come back. Refused as
#      RESTORE=NO_CLOSURE_KNOWLEDGE unless the operator states, with
#      HEYTA_ALLOW_EMPTY_TOMBSTONES=1, that this deployment has never had a closure at all.
#   6. DELETE every account whose id a tombstone names
#   7. assert every tombstone id now reads 0 account rows -> non-zero exit if any survive
#
# A killed run leaves a half-imported database. That is intentional ground for step 3's
# ON_ERROR_STOP and step 7's loud exit: this script never prints a success line the
# operator can act on unless the gate itself passed.
#
# Exit codes, all of them "do not serve from this database":
#   2 preflight -- artifact/ledger missing, undecryptable, corrupt, no key, no openssl
#   3 the gate cannot run at all -- no account_tombstones table, or the count never came back
#   4 the gate ran and a closed account is still in there
#   5 the gate had no input (zero closure knowledge) and nobody asserted that as a fact

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"

DB_CONTAINER="${DB_CONTAINER:-supersync-postgres}"
DB_USER="${POSTGRES_USER:-supersync}"
DB_NAME="${POSTGRES_DB:-supersync}"
BACKUP_DIR="${BACKUP_DIR:-$SERVER_DIR/backups}"
BACKUP_ENCRYPTION_PASSPHRASE_FILE="${BACKUP_ENCRYPTION_PASSPHRASE_FILE:-/run/secrets/backup_passphrase}"
# Not a default anyone should have to type: it is the operator asserting a fact about this
# deployment ("no account has ever been closed here"), which is the only case where a gate with
# zero input is a correct answer instead of an unchecked one.
ALLOW_EMPTY_TOMBSTONES="${HEYTA_ALLOW_EMPTY_TOMBSTONES:-}"

# Identifies this session like backup.sh does, so health-alert.sh sees a named, bounded
# admin action instead of an anonymous long-running query.
RESTORE_APPLICATION_NAME="supersync-restore"

ARTIFACT=""
LEDGER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ledger)
      LEDGER="${2:-}"
      if [ -z "$LEDGER" ]; then
        echo "RESTORE=NO_LEDGER_PATH"
        echo "--ledger needs a file (the newest supersync_tombstones_*.csv.enc from the backup dir)."
        exit 2
      fi
      shift 2
      ;;
    *)
      ARTIFACT="$1"
      shift
      ;;
  esac
done

if [ -z "$ARTIFACT" ]; then
  echo "Usage: $0 <backup.sql.gz|.sql.gz.enc> [--ledger <supersync_tombstones_*.csv[.enc]>]"
  echo "  (pass the artifact explicitly; this script never guesses which backup to restore)"
  echo "RESTORE=NO_ARTIFACT"
  exit 2
fi

if [ ! -f "$ARTIFACT" ]; then
  echo "Artifact not found: $ARTIFACT"
  echo "RESTORE=ARTIFACT_MISSING"
  exit 2
fi

# Step 0: an encrypted artifact must be decryptable before anything is imported from it.
PLAIN_ARTIFACT="$ARTIFACT"
# 🔴 工作目录在这里无条件建：账本也要落在这里，而早先它是 .enc 分支里才建的 ——
#    明文产物那条路上 WORK_DIR 是空串，拼出的路径变成根目录下的 /tombstones-preserved.csv。
WORK_DIR=$(mktemp -d)
chmod 700 "$WORK_DIR"
cleanup_work_dir() {
  rm -rf "$WORK_DIR"
}
trap cleanup_work_dir EXIT

case "$ARTIFACT" in
  *.enc)
    if ! command -v openssl >/dev/null 2>&1; then
      echo "openssl is not on PATH, so this encrypted artifact cannot be decrypted."
      echo "RESTORE=NO_OPENSSL"
      exit 2
    fi
    if [ ! -f "$BACKUP_ENCRYPTION_PASSPHRASE_FILE" ]; then
      echo "Passphrase file not found: $BACKUP_ENCRYPTION_PASSPHRASE_FILE"
      echo "RESTORE=NO_KEY"
      exit 2
    fi
    PLAIN_ARTIFACT="$WORK_DIR/artifact.sql.gz"
    echo "==> Decrypting $ARTIFACT"
    echo "    plaintext copy: $PLAIN_ARTIFACT (removed on exit)"
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
        -pass "file:$BACKUP_ENCRYPTION_PASSPHRASE_FILE" \
        -in "$ARTIFACT" -out "$PLAIN_ARTIFACT"; then
      echo "Decryption failed (wrong key, or the artifact is not what its name says)."
      echo "Nothing was imported."
      echo "RESTORE=ARTIFACT_UNDECRYPTABLE"
      exit 2
    fi
    ;;
esac

if ! gzip -t "$PLAIN_ARTIFACT"; then
  echo "gzip integrity check failed: $ARTIFACT"
  echo "RESTORE=ARTIFACT_CORRUPT"
  exit 2
fi

# Step 1b: the closure ledger is read BEFORE a single byte of the artifact is applied.
# A ledger that turns out to be garbage after the import would leave a half-restored database
# and a gate nobody can trust, so every ledger failure is a preflight failure.
LEDGER_CSV=""
LEDGER_ROWS=0
if [ -n "$LEDGER" ]; then
  if [ ! -f "$LEDGER" ]; then
    echo "Ledger not found: $LEDGER"
    echo "Nothing was imported."
    echo "RESTORE=LEDGER_MISSING"
    exit 2
  fi
  case "$LEDGER" in
    *.enc)
      if ! command -v openssl >/dev/null 2>&1; then
        echo "openssl is not on PATH, so this encrypted ledger cannot be decrypted."
        echo "Nothing was imported."
        echo "RESTORE=NO_OPENSSL"
        exit 2
      fi
      if [ ! -f "$BACKUP_ENCRYPTION_PASSPHRASE_FILE" ]; then
        echo "Passphrase file not found: $BACKUP_ENCRYPTION_PASSPHRASE_FILE (needed for the encrypted ledger)"
        echo "Nothing was imported."
        echo "RESTORE=NO_KEY"
        exit 2
      fi
      LEDGER_CSV="$WORK_DIR/ledger.csv"
      if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
          -pass "file:$BACKUP_ENCRYPTION_PASSPHRASE_FILE" \
          -in "$LEDGER" -out "$LEDGER_CSV"; then
        echo "Ledger decryption failed (wrong key, or it is not what its name says)."
        echo "Nothing was imported."
        echo "RESTORE=LEDGER_UNDECRYPTABLE"
        exit 2
      fi
      ;;
    *)
      LEDGER_CSV="$LEDGER"
      ;;
  esac
  # The staging COPY below would abort the whole gate on a malformed row (ON_ERROR_STOP=1),
  # after the import already happened. email_hash is checked at the same width as the database
  # CHECK that pins it, so a ledger from a different schema cannot be merged silently.
  if ! awk -F, 'NF != 3 || $1 !~ /^[0-9]+$/ || length($2) != 64 || $2 !~ /^[0-9a-f]+$/ || $3 == "" { bad = 1 } END { if (bad) exit 1 }' "$LEDGER_CSV"; then
    echo "Ledger rows are not (int user_id, 64-hex email_hash, non-empty closed_at): $LEDGER"
    echo "Nothing was imported."
    echo "RESTORE=LEDGER_MALFORMED"
    exit 2
  fi
  LEDGER_ROWS=$(grep -c . "$LEDGER_CSV" || true)
  echo "==> Closure ledger $LEDGER: $LEDGER_ROWS row(s)"
fi

run_psql() {
  # -v ON_ERROR_STOP=1: psql otherwise keeps going after an error and exits 0.
  # -t -A: bare rows, no banner/alignment, so the greps below are exact.
  docker exec -i -e PGAPPNAME="$RESTORE_APPLICATION_NAME" "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

# Step 2: carry the live tombstones out, before the import can roll them back.
# The file lives in this run's 0700 work dir and is removed by the EXIT trap. It contains
# only opaque user ids + an already-hashed email, never a plaintext identity.
TOMBSTONE_LIVE="$WORK_DIR/tombstones-live.csv"
: > "$TOMBSTONE_LIVE"
LIVE_TOMBSTONE_TABLE=$(run_psql -t -A -c \
  "SELECT 1 FROM information_schema.tables WHERE table_name = 'account_tombstones'" </dev/null)
if [ -n "$LIVE_TOMBSTONE_TABLE" ]; then
  run_psql -c "COPY (SELECT user_id, email_hash, closed_at FROM account_tombstones) TO STDOUT WITH (FORMAT csv)" </dev/null > "$TOMBSTONE_LIVE"
fi
LIVE_ROWS=$(grep -c . "$TOMBSTONE_LIVE" || true)
# The merged set is the union of both sources, deduplicated by user_id: one account can only be
# closed once, so a duplicate is the same fact written twice, and the staging table's primary
# key would reject it. The live row wins because it is the record that was in the database
# minutes ago.
TOMBSTONE_KEEP="$WORK_DIR/tombstones-preserved.csv"
if [ -n "$LEDGER_CSV" ]; then
  awk -F, '!seen[$1]++' "$TOMBSTONE_LIVE" "$LEDGER_CSV" > "$TOMBSTONE_KEEP"
else
  cp "$TOMBSTONE_LIVE" "$TOMBSTONE_KEEP"
fi
PRESERVED=$(grep -c . "$TOMBSTONE_KEEP" || true)
echo "    Closure knowledge carried across the import: $PRESERVED (live db $LIVE_ROWS + ledger $LEDGER_ROWS)"

# Step 3: import.
# 🔴 导入的必须是 `$PLAIN_ARTIFACT`，不是 `$ARTIFACT`。上一趟真产物端到端就是这么照出来的：
#    `gzip -t` 已经改读解出来的那份并通过，而这一行还拿着密文去 gunzip ⇒ "not in gzip format"、
#    退出 1、什么都没导入。假 docker 把 stdin 吞掉，所以这个错位**在单元层结构上不可见**，
#    只有真的 pg_dump 产物能撞到它（判据见 tests/restore-script.spec.ts 的"导入的字节"那一腿）。
echo "==> Restoring $ARTIFACT into $DB_NAME (this can take a while for a full dump)..."
gunzip -c "$PLAIN_ARTIFACT" | run_psql
echo "    Import complete"

# Step 4: the gate needs its input table. Checked here, after the artifact has been
# applied, because the full-database path drops the schema first (see the header).
TOMBSTONE_TABLE=$(run_psql -t -A -c \
  "SELECT 1 FROM information_schema.tables WHERE table_name = 'account_tombstones'" </dev/null)
if [ -z "$TOMBSTONE_TABLE" ]; then
  echo "Restored database has no account_tombstones table: the closure gate cannot run."
  echo "The import is applied but NOT verified -- do not start serving from it."
  echo "RESTORE=NO_TOMBSTONE_TABLE"
  exit 3
fi

# Step 5: put the preserved tombstones back. Staged through a table because `COPY FROM`
# would hit the primary key on rows the artifact already carries, and an error there would
# stop the gate rather than merge it.
if [ "$PRESERVED" -gt 0 ]; then
  run_psql -c 'CREATE TABLE IF NOT EXISTS "_restore_tombstone_preserved" ("user_id" INTEGER PRIMARY KEY, "email_hash" TEXT NOT NULL, "closed_at" TIMESTAMP(3) NOT NULL)' </dev/null
  run_psql -c 'COPY "_restore_tombstone_preserved" (user_id, email_hash, closed_at) FROM STDIN WITH (FORMAT csv)' < "$TOMBSTONE_KEEP"
  # GATE_PRESERVE_SQL: INSERT INTO "account_tombstones" ("user_id","email_hash","closed_at") SELECT p."user_id", p."email_hash", p."closed_at" FROM "_restore_tombstone_preserved" p WHERE NOT EXISTS (SELECT 1 FROM "account_tombstones" t WHERE t."user_id" = p."user_id")
  run_psql -c 'INSERT INTO "account_tombstones" ("user_id","email_hash","closed_at") SELECT p."user_id", p."email_hash", p."closed_at" FROM "_restore_tombstone_preserved" p WHERE NOT EXISTS (SELECT 1 FROM "account_tombstones" t WHERE t."user_id" = p."user_id")' </dev/null
  run_psql -c 'DROP TABLE "_restore_tombstone_preserved"' </dev/null
fi

TOMBSTONE_COUNT=$(run_psql -t -A -c "SELECT count(*) FROM account_tombstones" </dev/null)
# A count the database never answered is a broken probe, and "tombstones= removed=" printed as
# a success is exactly the fake green this script exists to refuse.
case "$TOMBSTONE_COUNT" in
  '' | *[!0-9]*)
    echo "The tombstone count did not come back from the database (got: '$TOMBSTONE_COUNT')."
    echo "The import is applied but NOT verified -- do not start serving from it."
    echo "RESTORE=GATE_INPUT_MISSING"
    exit 3
    ;;
esac

# Step 5b: zero tombstones is not "nothing to resurrect" -- it is "the gate had no input".
# On the documented full-database path this is precisely what restoring a pre-closure snapshot
# looks like from the inside, which is why it is a refusal rather than a pass.
if [ "$TOMBSTONE_COUNT" = "0" ] && [ "$ALLOW_EMPTY_TOMBSTONES" != "1" ]; then
  echo "No closure knowledge at all: the artifact carried no tombstones, nothing was preserved, and no --ledger was supplied."
  echo "Either pass the newest ledger next to the dump (--ledger supersync_tombstones_*.csv.enc),"
  echo "or state that this deployment has never had a closed account with HEYTA_ALLOW_EMPTY_TOMBSTONES=1."
  echo "The import is applied but NOT verified -- do not start serving from it."
  echo "RESTORE=NO_CLOSURE_KNOWLEDGE"
  exit 5
fi

# Step 6: delete. The number printed here is a **pre-count** of rows that match a tombstone,
# not a line count of the DELETE's output: an earlier version counted piped lines, and a real
# run reported `removed=1` when nothing matched (empty result + `wc -l` on a trailing newline).
# The truth of the deletion is step 7's job; this line is only the operator's readout.
# GATE_DELETE_SQL: DELETE FROM "users" WHERE "id" IN (SELECT "user_id" FROM "account_tombstones") RETURNING "id"
TO_REMOVE=$(run_psql -t -A -c 'SELECT count(*) FROM "users" u WHERE EXISTS (SELECT 1 FROM "account_tombstones" t WHERE t."user_id" = u."id")' </dev/null)
run_psql -c 'DELETE FROM "users" WHERE "id" IN (SELECT "user_id" FROM "account_tombstones") RETURNING "id"' </dev/null > /dev/null
echo "    Tombstones: $TOMBSTONE_COUNT   Resurrected accounts found and removed: $TO_REMOVE"

# Step 7: the assertion is per-tombstone-still-present, not "how many did we delete" --
# a count of 0 removed is also exactly what a gate that did nothing would report.
# GATE_ASSERT_SQL: SELECT t."user_id" FROM "account_tombstones" t WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."id" = t."user_id")
SURVIVORS=$(run_psql -t -A -c 'SELECT t."user_id" FROM "account_tombstones" t WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."id" = t."user_id")' </dev/null)
if [ -n "$SURVIVORS" ]; then
  echo "Closed accounts are present after restore: $(echo "$SURVIVORS" | tr '\n' ' ')"
  echo "The restored database is NOT usable. Do not start serving from it."
  echo "RESTORE=GATE_FAILED"
  exit 4
fi

echo "RESTORE=OK tombstones=$TOMBSTONE_COUNT removed=$TO_REMOVE preserved=$PRESERVED"
