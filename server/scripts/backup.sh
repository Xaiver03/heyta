#!/bin/bash
# SuperSync Server Backup Script
#
# Usage:
#   ./scripts/backup.sh [--upload]
#
# This script:
#   1. Creates a PostgreSQL dump
#   2. Compresses it with gzip and ENCRYPTS it (AES-256-CBC + PBKDF2) by default, so the
#      artifact that leaves this host is never plaintext. Passphrase comes from
#      BACKUP_ENCRYPTION_PASSPHRASE_FILE, provisioned out of band -- never from this repo.
#      No key => no dump at all (there is no silent plaintext fallback; BACKUP_ALLOW_PLAINTEXT=1
#      is an explicit opt-out and prints a warning on every run).
#   3. Optionally uploads to remote storage (requires rclone)
#   4. Cleans up old backups (RETENTION_DAYS below -- and it sweeps BOTH the .sql.gz and the
#      .sql.gz.enc names, because a suffix change that the sweep does not follow means old
#      artifacts never expire)
#
# Options:
#   --upload    Upload to remote storage via rclone
#
# Setup for cron: see docs/backup-and-recovery.md (use flock with a root-owned lock
# path like /run/supersync-backup.lock so a slow dump cannot overlap the next run).
#
# Rclone setup for offsite backup:
#   1. Install: curl https://rclone.org/install.sh | sudo bash
#   2. Configure: rclone config (follow prompts for B2/S3)
#   3. Set RCLONE_REMOTE below

set -eo pipefail
# The full dump is the whole database and the accounts dump is users + passkeys — password
# hashes and passkey credentials. Under root cron the default umask is 022, so without this
# both land 0644 and every local account on the host can read them.
umask 077

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$SERVER_DIR/backups}"
# 留存窗口的**唯一事实源**是这个默认值：runbook 的表格与法务那句"14 天内的备份副本"都必须是
# 它，由 scripts/check-backup-retention.mjs 三方对账钉住。改这里而不改那两处 ⇒ 门禁红。
# 拍板理由（ADR-0055 §5 第 1 块板）：法务两处（中英）承诺已公开写 14，缩到 3 要重新发布
# 进同意指纹的条款；而 3 天小于一周 —— 一次跨周末的静默故障会把全部产物清掉，恢复窗口归零。
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Rclone remote name (e.g., "b2:supersync-backups" or "s3:my-bucket/supersync")
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

# ── 备份默认加密（ADR-0055 §5 第 2 块板的裁决）─────────────────────────
#
# 口令**不在仓库里、不由本脚本生成、也不许和产物同目录**：它由部署者从仓库之外下发
# （systemd credential / docker secret / 手工 root-only 文件）。本脚本只读它，并**校验它的
# 形状**，因为"读得到一个谁都能读的口令"等于没加密 —— 那正是原来
# `tools/backup-encrypted.sh` 那条旁路没有回答的问题（它读同机 root 可读的文件就完事了）。
#
# 🔴 三条校验各自挡一种"看着加密了"：
#   - 不是普通文件 / 读不到  ⇒ 口令根本没下发；
#   - 组或其他位有任何权限   ⇒ 同机任意本地账号能读口令，密文与密钥在同一威胁模型里；
#   - 口令落在 BACKUP_DIR 里 ⇒ 一次目录级外传就把密文和密钥一起送出去（异地备份尤其如此）。
# 残余敞口要写清，不许读成"已解决"：备份那一刻主机上的 root 仍读得到在用的口令。加密买到的是
# "产物离开这台机器之后不再是明文"（异地副本、被拿走的磁盘、误传的归档），不买到"本机 root 不可读"。
BACKUP_ENCRYPTION_PASSPHRASE_FILE="${BACKUP_ENCRYPTION_PASSPHRASE_FILE:-/run/secrets/backup_passphrase}"
# 明文不是兜底路径。要明文必须显式说出这句话，且它会打印在每次运行里（不静默降级）。
BACKUP_ALLOW_PLAINTEXT="${BACKUP_ALLOW_PLAINTEXT:-}"
ENCRYPTED=1
[ "$BACKUP_ALLOW_PLAINTEXT" = "1" ] && ENCRYPTED=0
ARTIFACT_SUFFIX=".sql.gz"
[ "$ENCRYPTED" = "1" ] && ARTIFACT_SUFFIX=".sql.gz.enc"

# Identifies the dump's session in pg_stat_activity. health-alert.sh exempts exactly this
# name from its long-query check: a full dump legitimately runs for hours and would
# otherwise page every night, on a schedule, forever. It is NOT exempt from the pool-busy
# check, so a dump that actually starves the server still alerts, and the exemption expires
# after 6h so a WEDGED dump still pages. Keep it in sync with the `pageable` expression in
# scripts/health-alert.sh.
BACKUP_APPLICATION_NAME="supersync-backup"

# Every dump goes through here, so a new dump site cannot forget the session stamp that
# the health check's exemption keys on.
run_pg_dump() {
  docker exec -e PGAPPNAME="$BACKUP_APPLICATION_NAME" "$DB_CONTAINER" \
    pg_dump -U "$DB_USER" "$DB_NAME" "$@"
}

# pg_dump → gzip → (可选)openssl 对称加密，全部走管道，落盘只有 .tmp 再原子改名。
# 加密时**任何时刻都不存在明文产物**（连 .tmp 都是密文），这是这条路径存在的理由：
# 产物里躺着口令散列与通行密钥凭据，"先写明文再加密"会留下一个可被读走的窗口。
write_dump() {
  local target="$1"
  shift
  if [ "$ENCRYPTED" = "1" ]; then
    run_pg_dump "$@" \
      | gzip \
      | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 1000000 \
          -pass "file:$BACKUP_ENCRYPTION_PASSPHRASE_FILE" -out "$target.tmp"
  else
    run_pg_dump "$@" | gzip > "$target.tmp"
  fi
  mv "$target.tmp" "$target"
}

# Database container name
DB_CONTAINER="${DB_CONTAINER:-supersync-postgres}"
DB_USER="${POSTGRES_USER:-supersync}"
DB_NAME="${POSTGRES_DB:-supersync}"

# Parse arguments
UPLOAD=false
if [ "$1" = "--upload" ]; then
    UPLOAD=true
fi

# Create backup directory FIRST, and before the key checks below.
# 🔴 顺序是有理由的：同目录判定要用 realpath，而 realpath 对**还不存在**的目录会失败并退回字面量。
#    在 macOS 上 /var 是 /private/var 的软链，于是"目录的字面量路径"与"密钥的真实路径"永远对不上
#    ⇒ BACKUP=KEY_COLOCATED 这一档会静默不触发（单元测试就是这么抓到的：口令放进备份目录照样跑成功）。
mkdir -p "$BACKUP_DIR"
# Fixes a directory created before the umask above.
chmod 700 "$BACKUP_DIR"

# 口令校验必须在**第一次 dump 之前**：跑到一半才拒，等于已经往盘上写过一份不该存在的东西。
if [ "$ENCRYPTED" = "1" ]; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "BACKUP=NO_OPENSSL"
    echo "    Encryption is the default; openssl is not on PATH. Nothing was written."
    echo "    Set BACKUP_ALLOW_PLAINTEXT=1 only if you have decided plaintext backups are acceptable here."
    exit 1
  fi
  if [ ! -f "$BACKUP_ENCRYPTION_PASSPHRASE_FILE" ]; then
    echo "BACKUP=NO_KEY"
    echo "    Passphrase file not found: $BACKUP_ENCRYPTION_PASSPHRASE_FILE"
    echo "    Provision it out of band (never in this repo, never inside BACKUP_DIR), e.g.:"
    echo "      install -m 600 /dev/null \"$BACKUP_ENCRYPTION_PASSPHRASE_FILE\"   # then paste the passphrase"
    echo "    Nothing was written."
    exit 1
  fi
  KEY_MODE=$(stat -f '%Lp' "$BACKUP_ENCRYPTION_PASSPHRASE_FILE" 2>/dev/null \
    || stat -c '%a' "$BACKUP_ENCRYPTION_PASSPHRASE_FILE" 2>/dev/null || echo "")
  if [ -z "$KEY_MODE" ]; then
    echo "BACKUP=KEY_MODE_UNKNOWN"
    echo "    Could not read the mode of $BACKUP_ENCRYPTION_PASSPHRASE_FILE; refusing to assume it is safe."
    exit 1
  fi
  # 🔴 用位运算判，不用字符串比"是不是 600"：0400/0600/0700 都合格，0644 不合格。
  if [ "$(( 0$KEY_MODE & 077 ))" -ne 0 ]; then
    echo "BACKUP=KEY_PERMS"
    echo "    Passphrase file is readable beyond its owner: mode $KEY_MODE (need group/other bits 0)."
    echo "    A key any local account can read does not encrypt the artifact against that account."
    exit 1
  fi
  # 密钥与产物同目录 = 一次目录级外传把两样一起送出去。用 realpath 比前缀，不比字符串相等。
  KEY_REAL=$(realpath "$BACKUP_ENCRYPTION_PASSPHRASE_FILE" 2>/dev/null || echo "$BACKUP_ENCRYPTION_PASSPHRASE_FILE")
  DIR_REAL=$(realpath "$BACKUP_DIR" 2>/dev/null || echo "$BACKUP_DIR")
  case "$KEY_REAL" in
    "$DIR_REAL"/*)
      echo "BACKUP=KEY_COLOCATED"
      echo "    Passphrase file lives inside BACKUP_DIR ($KEY_REAL under $DIR_REAL)."
      echo "    Backing up the backups would then also back up the key. Move the key out and re-run."
      exit 1
      ;;
  esac
  echo "==> Encryption: AES-256-CBC + PBKDF2 (1M iterations), key $BACKUP_ENCRYPTION_PASSPHRASE_FILE mode $KEY_MODE"
else
  echo "==> ⚠️ BACKUP_ALLOW_PLAINTEXT=1 — writing UNENCRYPTED dumps (they contain password hashes)"
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"
# Fixes a directory created before the umask above.
chmod 700 "$BACKUP_DIR"

# The EXIT trap below cannot fire on SIGKILL, OOM or a host reboot, and the retention
# find only matches final names — sweep dead runs' partials here instead. -mmin checks
# mtime and gzip touches the .tmp on every write, so a live dump — however slow — is
# never eligible; only a partial nothing has written to for 6h is.
find "$BACKUP_DIR" \( -name "supersync_*.sql.gz.tmp" -o -name "supersync_*.sql.gz.enc.tmp" -o -name "supersync_tombstones_*.csv*.tmp" \) -mmin +360 -delete

# Generate filename with timestamp
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/supersync_$DATE$ARTIFACT_SUFFIX"
ACCOUNTS_FILE="$BACKUP_DIR/supersync_accounts_$DATE$ARTIFACT_SUFFIX"
# The closure ledger follows the same encryption switch as the dumps, and its name is needed
# before the EXIT trap below (a dead run must not leave a *.tmp that the next sweep mistakes
# for an artifact).
if [ "$ENCRYPTED" = "1" ]; then
  LEDGER_FILE="$BACKUP_DIR/supersync_tombstones_$DATE.csv.enc"
else
  LEDGER_FILE="$BACKUP_DIR/supersync_tombstones_$DATE.csv"
fi
LEDGER_TMP="$LEDGER_FILE.tmp"

# A dump killed mid-run (e.g. a #9695 crash-restart) leaves a truncated file that still
# passes gzip -t: gzip sees EOF and finalizes a valid archive when pg_dump dies upstream
# (#9836, observed 2026-08-31 and 2026-09-02). Write to .tmp and rename only on success
# so a failed night leaves no plausible-looking backup behind.
trap 'rm -f "$BACKUP_FILE.tmp" "$ACCOUNTS_FILE.tmp" "$LEDGER_FILE.tmp"' EXIT

echo "==> SuperSync Backup"
echo "    Date: $DATE"
echo "    Output: $BACKUP_FILE"
echo ""

# Step 0c: 🔴 the closure ledger, as an artifact of its own.
#
# Why a second copy of a table the dumps already carry: the documented full-database recovery
# drops the schema *before* importing, so restoring last week's snapshot also rolls
# `account_tombstones` back to how empty it was last week. The account the owner closed then
# comes back, and a gate that reads its input from the restored database reports
# "tombstones=0, removed=0" as a pass. The record of an erasure must survive the erasure's own
# restore — which it only can if it lives somewhere the snapshot does not overwrite.
#
# CSV, encrypted with the same key, tiny (one row per closed account, ever). `restore.sh`
# takes it via --ledger / RESTORE_TOMBSTONE_LEDGER.
# 🔴 It follows the SAME encryption switch as the dumps: an operator who set
#    BACKUP_ALLOW_PLAINTEXT=1 has said "this deployment stores no secrets at rest" about the whole
#    backup dir, and a lone `.enc` sitting in the middle of that is a third state nobody asked for.
TOMBSTONE_TABLE_EXISTS=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c \
  "SELECT 1 FROM information_schema.tables WHERE table_name = 'account_tombstones'" </dev/null)
if [ -z "$TOMBSTONE_TABLE_EXISTS" ]; then
  echo "BACKUP=NO_TOMBSTONE_TABLE"
  echo "    The live database has no account_tombstones, so there is no closure ledger to back up."
  echo "    A restore would then have no gate input to carry forward. Nothing was uploaded."
  exit 1
fi
if [ "$ENCRYPTED" = "1" ]; then
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
    "COPY (SELECT user_id, email_hash, closed_at FROM account_tombstones) TO STDOUT WITH (FORMAT csv)" </dev/null \
    | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 1000000 -pass "file:$BACKUP_ENCRYPTION_PASSPHRASE_FILE" -out "$LEDGER_TMP"
else
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
    "COPY (SELECT user_id, email_hash, closed_at FROM account_tombstones) TO STDOUT WITH (FORMAT csv)" </dev/null > "$LEDGER_TMP"
fi
mv "$LEDGER_TMP" "$LEDGER_FILE"
if [ "$ENCRYPTED" = "1" ]; then
  LEDGER_ROWS=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 -pass "file:$BACKUP_ENCRYPTION_PASSPHRASE_FILE" -in "$LEDGER_FILE" | grep -c . || true)
else
  LEDGER_ROWS=$(grep -c . "$LEDGER_FILE" || true)
fi
echo "    Closure ledger: $LEDGER_FILE rows=$LEDGER_ROWS"

# Step 1: Create minimal accounts-only dump (users + passkeys + closure tombstones)
# This is tiny and sufficient for disaster recovery when clients still have data.
# Recovery: restore accounts, wipe sync data, let clients re-upload.
# It runs BEFORE the 1-2 h full dump so a crash inside that window (#9695 hit the
# dump window twice in five occurrences) cannot take both artifacts.
#
# account_tombstones MUST be in this artifact: restore.sh's gate (ADR-0055) reads it to
# refuse a restored account the owner already closed, and this is the artifact an
# accounts-only recovery loads. A dump that carried only users+passkeys would restore
# successfully and leave the gate with nothing to check -- the silent shape.
echo "==> Creating accounts-only dump (users + passkeys + account_tombstones)..."
write_dump "$ACCOUNTS_FILE" --table=users --table=passkeys --table=account_tombstones

ACCOUNTS_SIZE=$(du -h "$ACCOUNTS_FILE" | cut -f1)
echo "    Accounts backup size: $ACCOUNTS_SIZE"


# Step 2: Create full PostgreSQL dump
echo ""
echo "==> Creating full database dump..."
write_dump "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "    Full backup size: $SIZE"

# Step 3: Upload to remote (if enabled)
if [ "$UPLOAD" = true ]; then
    if [ -z "$RCLONE_REMOTE" ]; then
        echo ""
        echo "Warning: --upload specified but RCLONE_REMOTE not set"
        echo "    Set RCLONE_REMOTE environment variable to enable uploads"
    elif command -v rclone &> /dev/null; then
        echo ""
        echo "==> Uploading to $RCLONE_REMOTE..."
        rclone copy "$BACKUP_FILE" "$RCLONE_REMOTE/"
        rclone copy "$ACCOUNTS_FILE" "$RCLONE_REMOTE/"
        echo "    Upload complete"
    else
        echo ""
        echo "Warning: rclone not installed, skipping upload"
        echo "    Install with: curl https://rclone.org/install.sh | sudo bash"
    fi
fi

# Step 4: Clean up old backups
# 🔴 两种后缀都要扫。改名而不改这里 = 新产物叫 *.sql.gz.enc，而清扫只认 *.sql.gz，
# 于是旧密文**永不过期** —— 法务那句"14 天内的备份副本"会在没人察觉的情况下变成假话，
# 而且症状与"一切正常"完全一样（当天确实产出了新文件、也确实打了删除计数 0 以外的数字）。
echo ""
echo "==> Cleaning up backups older than $RETENTION_DAYS days..."
DELETED=$(find "$BACKUP_DIR" \( -name "supersync_*.sql.gz" -o -name "supersync_accounts_*.sql.gz" -o -name "supersync_*.sql.gz.enc" -o -name "supersync_accounts_*.sql.gz.enc" -o -name "supersync_tombstones_*.csv*" \) -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
echo "    Deleted $DELETED old backup(s)"

# List current backups
echo ""
echo "==> Current backups:"
ls -lh "$BACKUP_DIR"/supersync_*.gz* "$BACKUP_DIR"/supersync_tombstones_*.csv* 2>/dev/null | tail -10 || echo "    (none)"

echo ""
echo "==> Backup complete:"
echo "    Full:     $BACKUP_FILE"
echo "    Accounts: $ACCOUNTS_FILE"
