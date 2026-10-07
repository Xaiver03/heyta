#!/bin/bash
# 恢复闸的**真产物**端到端验收（ADR-0055 / P-12 第四格）
# =====================================================================
#
# 这一档补的是什么：`server/tests/restore-script.spec.ts` 用的是**假 docker**，它只能证明
# 控制流（先解密 → gzip -t → 导入 → 查表 → DELETE → 逐墓碑断言），证明不了
# "真 pg_dump 产出的真产物里，那两条闸 SQL 真的删掉了该删的那一行、并且没碰活着的两行"。
# PGlite 那份证明的是语句本身在真库里成立。中间那一格——**产物形状**——此前没人验过。
#
# 🔴 腿的形状跟着**真灾难**走，不跟着"备份一次就恢复"走：灾备的常态是"拿**上周**的快照恢复
#    一台新库"，而注销发生在上周之后。文档里的整库恢复先 DROP SCHEMA 再导入 ⇒
#    account_tombstones 也被倒回上周那张空表，闸在自己的输入上读到 0 行，然后把
#    `tombstones=0 removed=0` 打成通过。这正是注销账本存在理由，所以主腿必须是
#    "旧快照 + 最新账本"。时序：先出**未注销**的快照 → 注销账号 → 再出一份（拿到含那一行的
#    账本）→ 用最新账本恢复那份**旧快照**。
#
# 两腿最有价值：
#   L2 **正向对照**：同一条产品路径、同一批字节，只把**账本那一行**去掉（并用
#      HEYTA_ALLOW_EMPTY_TOMBSTONES=1 断言"这台部署从未注销过账号"），那条已注销账号就**回来了**。
#      没有对照腿，"账号不在"这个读数既可能是闸起作用，也可能是 pg_dump 根本没导出那一行 ——
#      两种解释在输出上长得一模一样。
#   L11 **变异腿**：把 DELETE 那一句从一份**临时副本**里摘掉，再跑同一份产物 + 同一个账本 ⇒
#      必须 exit 4 RESTORE=GATE_FAILED。这一腿证的是第七步（逐墓碑 WHERE EXISTS）在真产物上有牙，
#      而不是只在假 docker 的分支表上有牙。改的是 $ART_DIR 里那份副本，仓库文件一字未动。
#
# 腿清单（条数不写在这里 —— 那是会漂的值；现量：本文件里 `grep -c '^expect_'`）：
#   A   注销前的备份：三件产物齐、账本 rows=0、盘上不留明文、不落 .tmp
#   B   注销 + 第二次备份：账本 rows=1
#   L1  旧快照 + 最新账本      → RESTORE=OK tombstones=1 removed=1，两条活账号在、注销那条不在，
#                                恢复库里那行墓碑的 email_hash 逐字等于账本里那行（⇒ 合并真写进了库）
#   L2  旧快照 + 无账本 + 断言  → RESTORE=OK removed=0，**注销那条回来了**（正向对照）
#   L3  旧快照 + 无账本         → exit 5 NO_CLOSURE_KNOWLEDGE，且导入**已发生**（那句 NOT verified 有牙）
#   L4  注销后备的那份 + 无账本  → RESTORE=OK tombstones=1 removed=0 —— removed 数的是**真被删掉的行**，
#                                不是墓碑条数（那份快照里本来就没有那条账号）
#   L5  产物自带墓碑 + 账本同一行  → tombstones=1（不是 2）：并集按 user_id 去重，撞上真 PK 也不会重复插
#   L5b 库认识墓碑、产物里连这张表都没有 → live db 1 + ledger 1，且快照带回的那条账号被删掉
#       （这一腿是 ADR-0055 那句话在真字节上的原形：闸靠"导入前带走"保护的是**库的记忆**）
#   L6  账本用错口令            → exit 2 LEDGER_UNDECRYPTABLE，目标库**一张表都没多**（账本预检排在导入之前）
#   L7  账本形状坏              → exit 2 LEDGER_MALFORMED，同样一张表都没多
#   L8  旧形状产物（无墓碑表）    → exit 3 NO_TOMBSTONE_TABLE，带账本也救不了，且导入已发生
#   L9  产物口令错              → exit 2 ARTIFACT_UNDECRYPTABLE，目标库一张表都没多
#   L10a 截断的密文            → exit 2 ARTIFACT_UNDECRYPTABLE（解密层先叫）
#   L10b 截断的明文 gzip        → exit 2 ARTIFACT_CORRUPT（gzip -t 那一层）
#   L11 摘掉 DELETE 的副本       → exit 4 GATE_FAILED，且那条账号**确实还在**库里
#
# 用它自己的容器与库，不碰任何在跑的栈：容器 heyta-gate-<pid>，
# 库 supersync(源) + t_*（每条腿一座空库，互不污染）。产物落 tmp/verify-restore-gate/，
# 口令落 tmp/verify-restore-gate-keys/（**不同目录**，这正是 backup.sh 要求并校验的形状）。
#
# 退出码：0 = 所有腿按预期成立；1 = 有腿不符（产品/脚本问题）；2 = 前置不成立（docker/镜像/
#         工具缺）—— 前置不成立**不算**通过，也**不记**产品失败（AGENTS §8 第 7 条的五态）。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/server"
ART_DIR="${VERIFY_GATE_ART_DIR:-$ROOT/tmp/verify-restore-gate}"
KEY_DIR="${VERIFY_GATE_KEY_DIR:-$ROOT/tmp/verify-restore-gate-keys}"
KEY_FILE="$KEY_DIR/passphrase"
WRONG_KEY="$KEY_DIR/wrong-passphrase"
CONTAINER="heyta-gate-$$"
PG_IMAGE="${VERIFY_GATE_IMAGE:-postgres:16-alpine}"
DB_USER=supersync
SRC_DB=supersync
DB_PW="gate-$$"

RESTORE_SHA_BEFORE=$(shasum -a 256 "$SERVER_DIR/scripts/restore.sh" | cut -d' ' -f1)

FAILS=0
LOAD_AT_START=$(sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg)

say() { printf '%s\n' "$*"; }
die_preflight() { say "PREFLIGHT=FAIL reason=$1"; say "RESULT=ENV_INVALID"; exit 2; }
expect_eq() { # expect_eq <腿名> <期望> <实际>
  if [ "$2" = "$3" ]; then say "LEG=$1 verdict=OK expected=$2"; else say "LEG=$1 verdict=FAIL expected=$2 actual=$3"; FAILS=$((FAILS + 1)); fi
}
expect_grep() { # expect_grep <腿名> <文件> <要出现的字样>
  if grep -q "$3" "$2"; then say "LEG=$1 verdict=OK pattern=$3"; else say "LEG=$1 verdict=FAIL pattern=$3 (absent in $2)"; FAILS=$((FAILS + 1)); fi
}
expect_no_grep() {
  if grep -q "$3" "$2"; then say "LEG=$1 verdict=FAIL pattern=$3 present"; else say "LEG=$1 verdict=OK pattern=$3 absent"; fi
}

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 && say "CLEANUP=container_removed $CONTAINER"
}
trap cleanup EXIT

say "=== 恢复闸真产物端到端（容器 ${CONTAINER}，镜像 ${PG_IMAGE}）==="
say "LOAD_AT_START=$LOAD_AT_START"

command -v docker >/dev/null 2>&1 || die_preflight "docker 不在 PATH"
docker info >/dev/null 2>&1 || die_preflight "docker 守护进程不可达"
docker image inspect "$PG_IMAGE" >/dev/null 2>&1 || die_preflight "本机没有镜像 ${PG_IMAGE}（不隐式拉取：网络故障不该读成脚本结论）"
command -v openssl >/dev/null 2>&1 || die_preflight "openssl 不在 PATH"
command -v python3 >/dev/null 2>&1 || die_preflight "python3 不在 PATH（email_hash 要在宿主机上算）"

rm -rf "$ART_DIR"; mkdir -p "$ART_DIR" "$KEY_DIR"
umask 077
printf 'verify-gate-passphrase-%s\n' "$$" > "$KEY_FILE"
printf 'not-the-passphrase\n' > "$WRONG_KEY"
chmod 600 "$KEY_FILE" "$WRONG_KEY"

docker run -d --name "$CONTAINER" -e POSTGRES_USER="$DB_USER" -e POSTGRES_DB="$SRC_DB" \
  -e POSTGRES_PASSWORD="$DB_PW" "$PG_IMAGE" >/dev/null || die_preflight "docker run 失败"

READY=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60; do
  if docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$SRC_DB" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
[ "$READY" = 1 ] || die_preflight "postgres 60s 内没就绪"
say "CONTAINER=up"

q() { # q <db> <sql>  → 裸行输出
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$1" -v ON_ERROR_STOP=1 -q -t -A -c "$2" </dev/null
}
TABLES_IN_DB() { q "$1" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"; }
HAS_CLOSED() { q "$1" "SELECT count(*) FROM \"users\" WHERE id=$CLOSED_ID"; }
HAS_ALIVE() { q "$1" "SELECT count(*) FROM \"users\" WHERE email LIKE 'gate-alive-%'"; }

enc() { openssl enc -aes-256-cbc -salt -pbkdf2 -iter 1000000 -pass "file:$1" -in "$2" -out "$3"; }
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 -pass "file:$1" -in "$2" -out "$3"; }

# ── 真迁移（50 份 migration.sql 逐个 psql -f）─────────────────────────
# 用 psql -f 而不是把整个文件当一个查询串发：多语句合在一个字符串里会形成隐式事务，
# 那时 CREATE INDEX CONCURRENTLY 当场 25001（AGENTS §4）。psql -f 逐条发送，正是要的形状。
# 🔴 用 glob 而不是 `for dir in $(ls -d …)`：本仓库的绝对路径里**有空格**
#    （…/All in one Data/…），命令替换出来的词会被按空格拆开，于是每一"个目录"都变成
#    两个不存在的路径，`[ -f migration.sql ]` 全假 ⇒ 迁移一份都没 apply 而循环"成功"退出。
#    上一趟就是这样把 MIGRATIONS=applied 0 打成 rc=1 的（不是 postgres 的问题）。
MIG_FAIL=0
MIG_APPLIED=0
MIG_SEEN=0
for dir in "$SERVER_DIR"/prisma/migrations/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  [ -f "$dir/migration.sql" ] || continue
  MIG_SEEN=$((MIG_SEEN + 1))
  docker cp "$dir/migration.sql" "$CONTAINER:/tmp/mig.sql" >/dev/null
  if ! docker exec "$CONTAINER" psql -U "$DB_USER" -d "$SRC_DB" -v ON_ERROR_STOP=1 -q -f /tmp/mig.sql >"$ART_DIR/mig-$name.err" 2>&1; then
    say "MIGRATION=FAIL name=$name detail=$(head -2 "$ART_DIR/mig-$name.err" | tr '\n' ' ')"
    MIG_FAIL=$((MIG_FAIL + 1))
  else
    MIG_APPLIED=$((MIG_APPLIED + 1))
  fi
done
# 分母自检：扫到的目录数必须等于 apply 数 + 失败数，且**不能为 0** ——
# "0 份迁移全部成功"曾经就是这么印出来的。
expect_eq "迁移分母" "$MIG_SEEN" "$((MIG_APPLIED + MIG_FAIL))"
[ "$MIG_SEEN" -gt 0 ] || die_preflight "一份迁移都没扫到（装置坏，不是库坏）"
[ "$MIG_FAIL" = 0 ] || die_preflight "$MIG_FAIL 份迁移在真 postgres 上失败（先修前置再谈恢复闸）"
say "MIGRATIONS=seen $MIG_SEEN applied $MIG_APPLIED"

# ── 种三条账号（此时还没有任何注销）───────────────────────────────────
# 墓碑的 email_hash 有 CHECK 只收 SHA-256 小写 hex，所以散列在宿主机上算（库里没有 pgcrypto）。
C_EMAIL='gate-closed-c@example.test'
C_HASH=$(python3 -c "import hashlib,sys;print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" "$C_EMAIL")
q "$SRC_DB" "INSERT INTO \"users\" (email, password_hash) VALUES ('gate-alive-a@example.test','hash-a'), ('gate-alive-b@example.test','hash-b'), ('$C_EMAIL','hash-c');" \
  || { say "SEED=FAIL users 插不进去"; exit 1; }
say "SEED=users=3 tombstones=0"

export DB_CONTAINER="$CONTAINER" POSTGRES_USER="$DB_USER" BACKUP_DIR="$ART_DIR" \
  BACKUP_ENCRYPTION_PASSPHRASE_FILE="$KEY_FILE"

# ── A：注销**之前**的备份 —— 这就是灾备里那份"上周的快照" ───────────────
# 🔴 产物名只精确到**秒**（backup.sh 的 DATE=%Y%m%d_%H%M%S）。这一趟库很小，两次备份会落在同一秒，
#    第二份就把第一份**按名字覆盖**了 —— 于是所有"旧快照"腿实际拿到的是注销后的字节，
#    症状是一串和闸有关的红（tombstones=1 removed=0、无账本也能通过），而根因在装置。
#    上一趟 14 枚红里 11 枚是这一枚级联。所以每次备份前等到秒真的翻过去，并把两份名字钉住。
wait_new_stamp() { # 等到 date 的秒位与上一次不同（有界，最多 5s）
  local now prev
  prev=$(date +%Y%m%d_%H%M%S)
  for _ in 1 2 3 4 5; do
    sleep 1
    now=$(date +%Y%m%d_%H%M%S)
    [ "$now" != "$prev" ] && return 0
  done
  return 1
}
wait_new_stamp || die_preflight "时间戳 5s 内没前进（两份产物会同名互相覆盖，装置坏）"
bash "$SERVER_DIR/scripts/backup.sh" > "$ART_DIR/backup-old.log" 2>&1
RC_A=$?
expect_eq "A 备份退出码" "0" "$RC_A"
S_OLD=$(ls "$ART_DIR"/supersync_2*.sql.gz.enc 2>/dev/null | head -1)
L_OLD=$(ls "$ART_DIR"/supersync_tombstones_*.csv.enc 2>/dev/null | head -1)
[ -n "$S_OLD" ] || { say "ARTIFACT=FAIL 没有加密的全量产物，见 $ART_DIR/backup-old.log"; exit 1; }
[ -n "$L_OLD" ] || { say "ARTIFACT=FAIL 没有注销账本"; exit 1; }
expect_eq "A 未注销时账本就是 0 行" "1" "$(grep -c 'Closure ledger: .*rows=0' "$ART_DIR/backup-old.log")"
expect_eq "A 盘上不落明文 sql.gz" "0" "$(ls "$ART_DIR"/supersync_2*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
expect_eq "A 盘上不落明文账本" "0" "$(ls "$ART_DIR"/supersync_tombstones_*.csv 2>/dev/null | wc -l | tr -d ' ')"
expect_eq "A 没有遗留 .tmp" "0" "$(ls "$ART_DIR"/*.tmp 2>/dev/null | wc -l | tr -d ' ')"
expect_eq "A 产物是 openssl 的 salted 容器" "Salted__" "$(head -c 8 "$S_OLD")"
say "SNAPSHOT_OLD=$(basename "$S_OLD") LEDGER_OLD=$(basename "$L_OLD")"

# ── B：注销账号（users 行删掉 + 墓碑写下），再出一份 ────────────────────
CLOSED_ID=$(q "$SRC_DB" "DELETE FROM \"users\" WHERE email='$C_EMAIL' RETURNING id;")
case "$CLOSED_ID" in
  ''|*[!0-9]*) say "SEED=FAIL 拿不到被删账号的 id（读到 '$CLOSED_ID'）"; exit 1 ;;
esac
q "$SRC_DB" "INSERT INTO \"account_tombstones\" (user_id, email_hash, closed_at) VALUES ($CLOSED_ID, '$C_HASH', now());" \
  || { say "SEED=FAIL 墓碑行写不进去"; exit 1; }
wait_new_stamp || die_preflight "时间戳第二次没前进"
bash "$SERVER_DIR/scripts/backup.sh" > "$ART_DIR/backup-new.log" 2>&1
RC_B=$?
expect_eq "B 第二次备份退出码" "0" "$RC_B"
S_NEW=$(ls -t "$ART_DIR"/supersync_2*.sql.gz.enc | head -1)
L_NEW=$(ls -t "$ART_DIR"/supersync_tombstones_*.csv.enc | head -1)
[ "$S_NEW" != "$S_OLD" ] || { say "B=FAIL 第二份产物没生成（拿到同一份 ${S_NEW}）"; FAILS=$((FAILS + 1)); }
[ "$L_NEW" != "$L_OLD" ] || { say "B=FAIL 第二份账本没生成"; FAILS=$((FAILS + 1)); }
expect_eq "B 最新账本 1 行" "1" "$(grep -c 'rows=1' "$ART_DIR/backup-new.log")"
say "SNAPSHOT_NEW=$(basename "$S_NEW") LEDGER_NEW=$(basename "$L_NEW") CLOSED_ID=$CLOSED_ID"

# ── 共用夹具：把真账本解出来，再按腿需要重新加密 ───────────────────────
LEDGER_PLAIN="$ART_DIR/ledger-plain.csv"
dec "$KEY_FILE" "$L_NEW" "$LEDGER_PLAIN" || { say "FIXTURE=FAIL 真账本解不开"; exit 1; }
expect_eq "夹具 真账本就是那一行" "1" "$(grep -c . "$LEDGER_PLAIN")"
expect_eq "夹具 账本里就是那条账号" "$CLOSED_ID,$C_HASH" "$(cut -d, -f1,2 "$LEDGER_PLAIN")"

restore_to() { # restore_to <新库名> <日志名> <restore.sh 路径> [恢复参数…]
  local db=$1 log=$2 script=$3; shift 3
  q postgres "CREATE DATABASE $db" >/dev/null || { say "PRE=FAIL 建不了库 $db"; return 99; }
  POSTGRES_DB="$db" bash "$script" "$@" > "$ART_DIR/$log" 2>&1
}
restore_into() { # 恢复进一座**已存在且已有内容**的库（L5b 用它：那儿的墓碑表是装置自己先建好的）
  local db=$1 log=$2 script=$3; shift 3
  POSTGRES_DB="$db" bash "$script" "$@" > "$ART_DIR/$log" 2>&1
}

# ── L1：旧快照 + 最新账本 —— 真灾备路径，闸必须拦住 ────────────────────
restore_to t_gate restore-l1.log "$SERVER_DIR/scripts/restore.sh" "$S_OLD" --ledger "$L_NEW"
RC_L1=$?
expect_eq "L1 退出码" "0" "$RC_L1"
expect_grep "L1 成功行" "$ART_DIR/restore-l1.log" "RESTORE=OK"
expect_grep "L1 闸的读数" "$ART_DIR/restore-l1.log" "tombstones=1 removed=1"
expect_grep "L1 账本并入被打印出来" "$ART_DIR/restore-l1.log" "carried across the import: 1 (live db 0 + ledger 1)"
expect_eq "L1 活着的两条都回来了" "2" "$(HAS_ALIVE t_gate)"
expect_eq "L1 已注销那条不在（闸拦住了）" "0" "$(HAS_CLOSED t_gate)"
# 恢复库里那行墓碑**只可能来自账本**（旧快照里这张表一行都没有），所以这条读数证的是合并真的写进了库。
expect_eq "L1 墓碑行来自账本（email_hash 逐字对上）" "$C_HASH" "$(q t_gate "SELECT email_hash FROM \"account_tombstones\" WHERE user_id=$CLOSED_ID")"

# ── L2：正向对照 —— 同一批字节，只把**账本那一行**去掉 ─────────────────
q postgres "CREATE DATABASE t_control" >/dev/null
POSTGRES_DB=t_control HEYTA_ALLOW_EMPTY_TOMBSTONES=1 \
  bash "$SERVER_DIR/scripts/restore.sh" "$S_OLD" > "$ART_DIR/restore-l2.log" 2>&1
RC_L2=$?
expect_eq "L2 退出码" "0" "$RC_L2"
expect_grep "L2 报的删除数是 0" "$ART_DIR/restore-l2.log" "tombstones=0 removed=0"
# 🔴 对照的那一问：没有账本时，那条已注销账号**在不在**恢复出来的库里。
expect_eq "L2 对照：没有账本时那条账号回来了" "1" "$(HAS_CLOSED t_control)"
expect_eq "L2 对照：活着的两条也在（不是整库没导进来）" "2" "$(HAS_ALIVE t_control)"

# ── L3：无账本且没人断言"从未注销" ⇒ 响亮拒绝，且导入确实发生过 ─────────
restore_to t_noknowledge restore-l3.log "$SERVER_DIR/scripts/restore.sh" "$S_OLD"
RC_L3=$?
expect_eq "L3 退出码" "5" "$RC_L3"
expect_grep "L3 点名 NO_CLOSURE_KNOWLEDGE" "$ART_DIR/restore-l3.log" "RESTORE=NO_CLOSURE_KNOWLEDGE"
expect_no_grep "L3 不许出现可照做的成功行" "$ART_DIR/restore-l3.log" "RESTORE=OK"
expect_eq "L3 导入已发生（表在库里）" "1" "$(q t_noknowledge "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='users'")"
# 没有账本，那条注销账号就在这台库里 —— "applied but NOT verified" 那句说的是真话。
expect_eq "L3 没账本时那条账号在（这就是拒绝的理由）" "1" "$(HAS_CLOSED t_noknowledge)"

# ── L4：注销后备的那份，不需要账本 —— removed 数的是真被删的行 ──────────
restore_to t_postclose restore-l4.log "$SERVER_DIR/scripts/restore.sh" "$S_NEW"
RC_L4=$?
expect_eq "L4 退出码" "0" "$RC_L4"
expect_grep "L4 墓碑 1 条、删除 0 行" "$ART_DIR/restore-l4.log" "tombstones=1 removed=0"
expect_eq "L4 那条账号本来就不在这份快照里" "0" "$(HAS_CLOSED t_postclose)"
expect_eq "L4 活着的两条在" "2" "$(HAS_ALIVE t_postclose)"

# ── 共用夹具：一张**没有墓碑表**的产物（这张表之前的存量备份形状）──────────
# 不是 backup.sh 现在能产出的形状（它的账号面 dump 带着 --table=account_tombstones，表不在就
# 当场报错），而是**这张表建立之前**的存量备份。L5b 与 L8 都用它，但目标库状态不同 —— 同一批
# 字节在"库认识这条注销"与"谁都不认识"两种局面下走闸的两个不同出口，这是最省事的 A/B。
# 🔴 从 L3 那座**已导入的旧快照库** dump，不从源库 dump：源库此刻已经注销了那条账号，
#    从它 dump 会得到一份"本来就没有那条账号"的产物，于是 L5b/L8 里"账号回来了"那两条读数
#    结构上不可能成立 —— 上一趟 L3 的失败就是这么来的（不是 postgres 的问题）。
docker exec -i "$CONTAINER" pg_dump -U "$DB_USER" --table=users --table=passkeys t_noknowledge </dev/null \
  | gzip > "$ART_DIR/legacy.sql.gz"
RC_FIX=$?
enc "$KEY_FILE" "$ART_DIR/legacy.sql.gz" "$ART_DIR/legacy.sql.gz.enc"
expect_eq "旧形状夹具能造出来" "0" "$((RC_FIX + $?))"

# ── L5：同一条注销事实同时来自产物与账本 ⇒ 真 PK 上只算一条 ──────────────
# 假 docker 只能证分支表；这一腿证的是**真主键**：墓碑表导入后已经带着那一行了，
# preserved 那句 INSERT ... WHERE NOT EXISTS 必须跳过它，否则 23505 把闸停在半路。
restore_to t_dedup restore-l5.log "$SERVER_DIR/scripts/restore.sh" "$S_NEW" --ledger "$L_NEW"
RC_L5=$?
expect_eq "L5 退出码" "0" "$RC_L5"
expect_grep "L5 合并只算一条" "$ART_DIR/restore-l5.log" "carried across the import: 1 (live db 0 + ledger 1)"
expect_eq "L5 墓碑仍是 1 行（不是 2，也没撞 PK）" "1" "$(q t_dedup "SELECT count(*) FROM \"account_tombstones\"")"
expect_eq "L5 那条账号不在" "0" "$(HAS_CLOSED t_dedup)"

# ── L5b：库自己认识这条注销，而产物里连这张表都没有 ⇒ 带走的那一行必须活过导入 ──
# 这正是 ADR-0055 说要保护的那件事，在真字节上的形态：快照比注销更早（甚至是这张表建立之前的
# 存量备份），恢复把那条账号**带回来**了，而库里还留着墓碑 ⇒ 闸必须靠"导入前带走"那一步拦住。
q postgres "CREATE DATABASE t_carry" >/dev/null
docker cp "$SERVER_DIR/prisma/migrations/20261015000000_add_account_tombstones/migration.sql" \
  "$CONTAINER:/tmp/tomb.sql" >/dev/null
docker exec "$CONTAINER" psql -U "$DB_USER" -d t_carry -v ON_ERROR_STOP=1 -q -f /tmp/tomb.sql \
  > "$ART_DIR/carry-schema.err" 2>&1 || { say "FIXTURE=FAIL 墓碑表在 t_carry 里建不起来，见 carry-schema.err"; exit 1; }
q t_carry "INSERT INTO \"account_tombstones\" (user_id, email_hash, closed_at) VALUES ($CLOSED_ID, '$C_HASH', now());" >/dev/null
restore_into t_carry restore-l5c.log "$SERVER_DIR/scripts/restore.sh" "$ART_DIR/legacy.sql.gz.enc" --ledger "$L_NEW"
RC_L5C=$?
expect_eq "L5b 退出码" "0" "$RC_L5C"
expect_grep "L5b 库认识墓碑：live db 1 + ledger 1" "$ART_DIR/restore-l5c.log" "carried across the import: 1 (live db 1 + ledger 1)"
expect_grep "L5b 闸真的删掉了带回来的那条" "$ART_DIR/restore-l5c.log" "tombstones=1 removed=1"
expect_eq "L5b 那条账号被拦住（快照把它带回来了）" "0" "$(HAS_CLOSED t_carry)"
expect_eq "L5b 活着的两条仍在" "2" "$(HAS_ALIVE t_carry)"
expect_eq "L5b 墓碑仍 1 行（没被账本重复插）" "1" "$(q t_carry "SELECT count(*) FROM \"account_tombstones\"")"
# 阳性对照：同一批字节、同一座库的形状，但**库里没有墓碑** ⇒ 那条账号就留下了（L3 已证导入把它带回）。
expect_eq "L5b 对照：没墓碑的那座库里它确实在（L3）" "1" "$(HAS_CLOSED t_noknowledge)"

# ── L6：账本口令错 ⇒ 一次都没导入（证账本预检排在导入之前）────────────
enc "$WRONG_KEY" "$LEDGER_PLAIN" "$ART_DIR/ledger-wrongkey.csv.enc"
restore_to t_badledgerkey restore-l6.log "$SERVER_DIR/scripts/restore.sh" "$S_OLD" --ledger "$ART_DIR/ledger-wrongkey.csv.enc"
RC_L6=$?
expect_eq "L6 退出码" "2" "$RC_L6"
expect_grep "L6 点名 LEDGER_UNDECRYPTABLE" "$ART_DIR/restore-l6.log" "RESTORE=LEDGER_UNDECRYPTABLE"
expect_no_grep "L6 不许出现成功行" "$ART_DIR/restore-l6.log" "RESTORE=OK"
expect_eq "L6 账本坏了就一张表都没多" "0" "$(TABLES_IN_DB t_badledgerkey)"

# ── L7：账本形状坏 ⇒ 同样一次都没导入 ─────────────────────────────────
printf 'not-an-int,%s,2026-10-01 00:00:00\n' "$C_HASH" > "$ART_DIR/ledger-bad.csv"
enc "$KEY_FILE" "$ART_DIR/ledger-bad.csv" "$ART_DIR/ledger-bad.csv.enc"
restore_to t_badledgerrow restore-l7.log "$SERVER_DIR/scripts/restore.sh" "$S_OLD" --ledger "$ART_DIR/ledger-bad.csv.enc"
RC_L7=$?
expect_eq "L7 退出码" "2" "$RC_L7"
expect_grep "L7 点名 LEDGER_MALFORMED" "$ART_DIR/restore-l7.log" "RESTORE=LEDGER_MALFORMED"
expect_no_grep "L7 不许出现成功行" "$ART_DIR/restore-l7.log" "RESTORE=OK"
expect_eq "L7 形状坏就一张表都没多" "0" "$(TABLES_IN_DB t_badledgerrow)"

# ── L8：同一批字节，但这座库**谁都不认识**这条注销 ⇒ 响亮拒绝 ────────────
# 与 L5b 用同一份 legacy 产物、两种库状态：那儿的库带着墓碑 ⇒ 闸拦得住并删得掉；
# 这儿的空库什么都不认识，而产物里连这张表都没有 ⇒ 闸没有判据可读，只能拒绝（带账本也一样，
# 因为恢复出来的库里根本没有那张表可以插）。
restore_to t_legacy restore-l8.log "$SERVER_DIR/scripts/restore.sh" "$ART_DIR/legacy.sql.gz.enc" --ledger "$L_NEW"
RC_L8=$?
expect_eq "L8 退出码" "3" "$RC_L8"
expect_grep "L8 点名 NO_TOMBSTONE_TABLE" "$ART_DIR/restore-l8.log" "RESTORE=NO_TOMBSTONE_TABLE"
expect_no_grep "L8 不许出现可照做的成功行" "$ART_DIR/restore-l8.log" "RESTORE=OK"
expect_eq "L8 导入已发生（表在库里）" "1" "$(q t_legacy "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='users'")"
expect_eq "L8 没这张表时那条账号在（闸没有判据可读）" "1" "$(HAS_CLOSED t_legacy)"

# ── L9：产物口令错 ⇒ 一次都没导入 ─────────────────────────────────────
q postgres "CREATE DATABASE t_badkey" >/dev/null
POSTGRES_DB=t_badkey BACKUP_ENCRYPTION_PASSPHRASE_FILE="$WRONG_KEY" \
  bash "$SERVER_DIR/scripts/restore.sh" "$S_OLD" > "$ART_DIR/restore-l9.log" 2>&1
RC_L9=$?
expect_eq "L9 退出码" "2" "$RC_L9"
expect_grep "L9 点名 ARTIFACT_UNDECRYPTABLE" "$ART_DIR/restore-l9.log" "RESTORE=ARTIFACT_UNDECRYPTABLE"
expect_no_grep "L9 不许出现成功行" "$ART_DIR/restore-l9.log" "RESTORE=OK"
expect_eq "L9 什么都没导入" "0" "$(TABLES_IN_DB t_badkey)"

# ── L10：产物被截断 —— 密文与明文各一趟，因为拦下它的是**不同的一层** ────
# 截断的 **.enc**：openssl 先叫（bad decrypt）⇒ 读到的是 ARTIFACT_UNDECRYPTABLE。
# 截断的 **.sql.gz**：gzip -t 才叫 ⇒ ARTIFACT_CORRUPT。#9836 那句"截断的产物仍像一份备份"
# 在加密之后换了层皮，所以两层的读数要分开拿，不能合成一条"非零即可"。
HALF=$(( $(wc -c < "$S_OLD") / 2 ))
head -c "$HALF" "$S_OLD" > "$ART_DIR/truncated.sql.gz.enc"
restore_to t_truncenc restore-l10a.log "$SERVER_DIR/scripts/restore.sh" "$ART_DIR/truncated.sql.gz.enc" --ledger "$L_NEW"
RC_L10A=$?
expect_eq "L10a 截断密文退出码" "2" "$RC_L10A"
expect_grep "L10a 截断密文由解密层拦下" "$ART_DIR/restore-l10a.log" "RESTORE=ARTIFACT_UNDECRYPTABLE"
expect_no_grep "L10a 不许出现成功行" "$ART_DIR/restore-l10a.log" "RESTORE=OK"
expect_eq "L10a 什么都没导入" "0" "$(TABLES_IN_DB t_truncenc)"

PLAIN_OLD="$ART_DIR/old-plain.sql.gz"
dec "$KEY_FILE" "$S_OLD" "$PLAIN_OLD" || { say "FIXTURE=FAIL 旧快照解不开"; exit 1; }
head -c "$(( $(wc -c < "$PLAIN_OLD") / 2 ))" "$PLAIN_OLD" > "$ART_DIR/truncated.sql.gz"
restore_to t_trunc restore-l10b.log "$SERVER_DIR/scripts/restore.sh" "$ART_DIR/truncated.sql.gz" --ledger "$L_NEW"
RC_L10B=$?
expect_eq "L10b 截断明文退出码" "2" "$RC_L10B"
expect_grep "L10b 截断明文由 gzip -t 拦下" "$ART_DIR/restore-l10b.log" "RESTORE=ARTIFACT_CORRUPT"
expect_no_grep "L10b 不许出现成功行" "$ART_DIR/restore-l10b.log" "RESTORE=OK"
expect_eq "L10b 什么都没导入" "0" "$(TABLES_IN_DB t_trunc)"

# ── L11：变异腿 —— 摘掉 DELETE，第七层的断言必须抓到 ───────────────────
# 🔴 改的是 $ART_DIR 里的一份副本，仓库里 server/scripts/restore.sh 一字未动（跑完再对一次字节）。
MUT="$ART_DIR/restore-no-delete.sh"
python3 - "$SERVER_DIR/scripts/restore.sh" "$MUT" <<'PY' || { say "FIXTURE=FAIL 变异副本造不出来"; exit 1; }
import sys
src, dst = sys.argv[1], sys.argv[2]
lines = open(src, encoding='utf8').read().splitlines(True)
kept = [l for l in lines if 'DELETE FROM "users" WHERE "id" IN' not in l]
if len(kept) == len(lines):
    sys.exit(1)          # 那一句不在了：装置坏了，不许把"没有变异"读成"闸没问题"
open(dst, 'w', encoding='utf8').writelines(kept)
PY
expect_eq "L11 变异副本确实少了那一句" "0" "$(grep -c 'DELETE FROM "users" WHERE "id" IN' "$MUT")"
restore_to t_mutant restore-l11.log "$MUT" "$S_OLD" --ledger "$L_NEW"
RC_L11=$?
expect_eq "L11 退出码" "4" "$RC_L11"
expect_grep "L11 点名 GATE_FAILED" "$ART_DIR/restore-l11.log" "RESTORE=GATE_FAILED"
expect_no_grep "L11 不许出现成功行" "$ART_DIR/restore-l11.log" "RESTORE=OK"
expect_eq "L11 那条账号确实还在（这就是第七层抓到的东西）" "1" "$(HAS_CLOSED t_mutant)"
# 阳性对照的另一半：同一份产物 + 同一个账本，没摘 DELETE 的那趟（L1）判 0 行、这趟判 1 行。
# 🔴 对账的是**本趟开始时**自己取的哈希，不是 git HEAD —— 仓库里那份 restore.sh 是未提交的改动，
#    拿 HEAD 比会恒红，而那条红跟"副本没改到原件"这件事毫无关系。
expect_eq "L11 仓库里那份 restore.sh 没被动过" "$RESTORE_SHA_BEFORE" \
  "$(shasum -a 256 "$SERVER_DIR/scripts/restore.sh" | cut -d' ' -f1)"

say "SUMMARY legs_failed=$FAILS container=$CONTAINER artifacts=$ART_DIR"
if [ "$FAILS" = 0 ]; then say "RESULT=OK"; exit 0; else say "RESULT=FAIL"; exit 1; fi
