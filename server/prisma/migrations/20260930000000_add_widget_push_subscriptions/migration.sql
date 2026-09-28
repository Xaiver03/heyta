-- Windows PWA 小组件的 Web Push 订阅表：`widget_push_subscriptions`。
--
-- 依据：docs/plans/multi-platform-widgets.md 的 U12、
-- docs/adr/0025-*.md（小组件的四条不变量）。
--
-- 🔴 这一迁移修的是一类**"功能齐全但永远不刷新"**：`server/` 侧此前
-- **零 push 基础设施** —— 而 Windows 上"当日任务"只能靠 Web Push 刷新
-- （PBS 的下限是 12 小时，且桌面端没有 OS 级唤醒）。没有这张表，
-- 上一轮写好的 `push-crypto` / `vapid` / `sender` 三件套**没有任何调用者**：
-- 服务端不知道要把推送发给谁。
--
-- 为什么是普通 DDL：新建一张小表（行数与用户数同阶），
-- 按 AGENTS.md §4 的优先级 1 —— 表够小就用普通 DDL，不引入 CONCURRENTLY
-- 与那套恢复路径。
--
-- SQL 主体由
--   prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- 逐字取出（这一迁移之后没有任何 ALTER，所以"从空库建到当前 schema"
-- 的那一段就是本表应有的形状，两者不会漂移）；其后两条是**手工补充**，
-- 因为 Prisma schema 表达不了它们。

-- CreateTable
CREATE TABLE "widget_push_subscriptions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" BIGINT NOT NULL,
    "last_used_at" BIGINT,

    CONSTRAINT "widget_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "widget_push_subscriptions_endpoint_key" ON "widget_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "widget_push_subscriptions_user_id_idx" ON "widget_push_subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "widget_push_subscriptions" ADD CONSTRAINT "widget_push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 🔴 手工补充 1/2：`failure_count` 不能为负。
--
-- 这一列参与的是"连续失败到阈值就删掉这行"的判定。允许负数之后，
-- 一个 `-1`（比如某处减法方向写反）会让这一行**永远到不了阈值**，
-- 而它的表现是"这张表里有几条永远删不掉的死订阅" —— 那种泄漏
-- 不会报错、不会告警，只是慢慢涨。CHECK 让这种写错在**第一次**就失败。
ALTER TABLE "widget_push_subscriptions" ADD CONSTRAINT "widget_push_subscriptions_failure_count_nonneg"
  CHECK ("failure_count" >= 0);

-- 🔴 手工补充 2/2：`endpoint` / `p256dh` / `auth` 都不能是空串。
--
-- `NOT NULL` 挡不住 `''`，而空串在这张表里是一个**静默的坏行**：
-- 发送时会拿着空 endpoint 去 fetch（表现为一个指向自身的奇怪请求），
-- 或者拿长度为 0 的密钥去 ECDH（`push-crypto` 会抛"必须是 65 字节"）。
-- 两者都会让那条订阅**永远发不出去**，而它看起来是一条正常的记录。
-- 长度校验留在应用层（那里有 base64url 解码，能给出带字段名的报错），
-- 这里只挡"连内容都没有"这一种。
ALTER TABLE "widget_push_subscriptions" ADD CONSTRAINT "widget_push_subscriptions_fields_nonempty"
  CHECK ("endpoint" <> '' AND "p256dh" <> '' AND "auth" <> '');

-- 注：**没有**给 `endpoint` 加"必须是 https"之类的 CHECK。
-- 本地推送服务（以及某些自托管的实现）会用 `http://127.0.0.1:port/...`，
-- 而 heyta 明确是**可自托管**的 —— 一条只允许 https 的约束会把
-- 自托管用户整条路堵死，且报错会落在一次 INSERT 上，与真实原因无关。
