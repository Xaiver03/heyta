#!/bin/sh
# 假 docker = 假 pg_dump + 假 psql（backup.sh 的两条数据面都走 docker exec）。
#
# 🔴 和 restore 那一支同一次抽取：它以前住在 JS 模板字符串里，而模板字符串会吃掉 `\`、
#    会被反引号截断，两种坏法的症状都不是"某一条腿红"，而是整族集体红或集体静默读空。
#    住在这里以后 `sh -n` 直接能查。
#
# 旋钮：
#   FAKE_DOCKER_LOG          给了就把每次调用的完整参数记成一行 CALL|...
#   FAKE_FULL_DUMP_EXIT      整库那一趟 pg_dump 的退出码，默认 0
#   FAKE_NO_TOMBSTONE_TABLE=1 表检查读不到 account_tombstones
#   FAKE_LEDGER_ROWS         COPY ... TO STDOUT 返回的行；默认给一行真形状
set -u
if [ -n "${FAKE_DOCKER_LOG:-}" ]; then printf 'CALL|%s\n' "$*" >> "$FAKE_DOCKER_LOG"; fi
case "$*" in
  *information_schema*)
    # "这张表在不在"只能靠**输出有没有**回答。上一版这里没有臂，落到兜底分支拿到了
    # "partial full dump data" —— 非空，于是"表存在"是**任何输出的副产品**，
    # BACKUP=NO_TOMBSTONE_TABLE 那一条拒处在单元层结构上不可达。
    [ "${FAKE_NO_TOMBSTONE_TABLE:-0}" = 1 ] || echo 1
    ;;
  *STDOUT*)
    # 注销账本那一句（COPY (SELECT user_id, email_hash, closed_at ...) TO STDOUT WITH (FORMAT csv)）。
    if [ -n "${FAKE_LEDGER_ROWS+set}" ]; then
      [ -z "$FAKE_LEDGER_ROWS" ] || printf '%s\n' "$FAKE_LEDGER_ROWS"
    else
      printf '%s\n' '7,a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90,2026-10-01 00:00:00'
    fi
    ;;
  *--table=*)
    printf 'accounts data\n'
    ;;
  *)
    printf 'partial full dump data\n'
    exit "${FAKE_FULL_DUMP_EXIT:-0}"
    ;;
esac
