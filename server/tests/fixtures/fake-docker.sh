#!/bin/sh
# 假 docker = 假 psql（restore.sh 的 psql 都是 `docker exec` 进去跑的）。
#
# 🔴 这一份是**真 shell 文件**，不是 JS 模板字符串里的 shell。之前它住在一个模板字符串里，
#    于是两类写法各自把整个夹具打断过：反引号截断模板、`\` + 空格被 JS 吃掉反斜杠。
#    两种症状都不是"某一条腿红"，而是这一族用例集体红或集体静默读空。
#    住在这里以后，`sh -n` 直接能查，注释里想写什么写什么。
#    它的自检在 tests/restore-script.spec.ts 的 "FAKE_DOCKER 夹具自身" 那一支：
#    闸要读数的每一条臂都被真跑一次 —— glob 里 `.` 是字面量而不是"任意字符"，
#    一条写坏的臂配上空的兜底分支，症状是"这一句没有读数"，不是"臂认错"。
#
# 旋钮（都由用例通过 env 给）：
#   FAKE_DOCKER_LOG        必填，每次调用追加一行 CALL|<sql>（空 sql = 导入那一次）
#   FAKE_STDIN_FILE        导入那一次把 stdin 收进这里（不给就丢掉）
#   FAKE_IMPORT_EXIT       导入退出码，默认 0
#   FAKE_NO_TOMBSTONE_TABLE=1  表检查读不到 account_tombstones
#   FAKE_CARRY_ROWS        带走那一句返回的行（一行 csv）
#   FAKE_TO_REMOVE         预计数那一句的读数
#   FAKE_DELETED_COUNT     DELETE ... RETURNING 打几行，默认 1
#   FAKE_SURVIVORS         断言那一句打哪些还活着的 id（空格分隔）
#   FAKE_TOMBSTONE_COUNT   墓碑总数那一句的读数，默认 2
#   FAKE_NO_COUNT=1        让墓碑总数那一句**没有输出**（模拟探针没读到，不是 0）
set -u
sql=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-c" ]; then sql="$a"; fi
  prev="$a"
done
printf 'CALL|%s\n' "$sql" >> "$FAKE_DOCKER_LOG"
if [ -z "$sql" ]; then
  # 导入那一次：收下 stdin，"导入用的到底是哪一份文件"才在单元层看得见。
  # `.enc` 那一档真坏过一次 —— gzip -t 已经改读解密后的临时文件并通过，而导入那一行还拿着
  # 密文去 gunzip。假 docker 不读内容，所以它照样"成功"。
  if [ -n "${FAKE_STDIN_FILE:-}" ]; then cat > "$FAKE_STDIN_FILE"; else cat > /dev/null; fi
  exit "${FAKE_IMPORT_EXIT:-0}"
fi
case "$sql" in
  *information_schema*)
    [ "${FAKE_NO_TOMBSTONE_TABLE:-0}" = 1 ] || echo 1
    ;;
  *STDOUT*)
    # 导入前"把活库已知的墓碑带走"那一句（COPY ... TO STDOUT）。restore.sh 里只有这一条含它。
    if [ -n "${FAKE_CARRY_ROWS:-}" ]; then printf '%s\n' "$FAKE_CARRY_ROWS"; fi
    ;;
  *_restore_tombstone_preserved*)
    # 并回墓碑那四句（建表 / COPY 进 / 并回 / 丢表）归成一个臂，不替它们编输出。
    ;;
  *"count("*users*)
    # 预计数那一句（有几行正躺在墓碑名下等着被删）。必须排在断言臂前面：
    # 两句都含 t."user_id"，让断言的输出冒充这个数，就是把"复活了几个"读成"等着删几个"。
    # 🔴 模式里的字面片段都用引号包起来，且带左括号：表名 account_tombstones **自己就含着 "count"
    #    这四个字符**，裸写 `*count*` 会让它冒充任何一句。上一版配的 `*users.*u.*` 则是另一种坏法 ——
    #    glob 里 `.` 是字面量，那条臂一条都不命中，症状是 removed= 印成空串。
    echo "${FAKE_TO_REMOVE:-0}"
    ;;
  *DELETE*)
    _i=0
    while [ "$_i" -lt "${FAKE_DELETED_COUNT:-1}" ]; do
      echo "$_i"
      _i=$((_i + 1))
    done
    ;;
  *'t."user_id"'*)
    # 逐墓碑断言那一句：哪些墓碑名下还站着账号。
    for _id in ${FAKE_SURVIVORS:-}; do
      echo "$_id"
    done
    ;;
  *"count("*FROM*account_tombstones*)
    # 墓碑总数。FAKE_NO_COUNT=1 让它**没有输出** —— 脚本必须把这当"探针没读到"，
    # 而不是当 0：把没读到印成一句成功，正是这一族假绿的形状。
    if [ "${FAKE_NO_COUNT:-0}" != 1 ]; then echo "${FAKE_TOMBSTONE_COUNT:-2}"; fi
    ;;
  *)
    # 认不出来的语句不替它编一个输出：兜底分支必须是空，
    # 否则将来新加的那条会被当成某个已有读数。
    ;;
esac
exit 0
