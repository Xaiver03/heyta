-- 账号语言：`users.locale`（可空文本，合法取值即 SERVER_LOCALES）。
--
-- 依据：docs/plans/i18n-multilingual.md §3「应用的语言解析链」（2026-10-01 产品拍板）。
-- 邮件语言此前只有 body.locale / Accept-Language 两条来源，而客户端从不传
-- body.locale —— 在中文浏览器里把应用切成英文的用户，收到的邮件仍是中文。
-- 存账号级语言后，发信函数对已查到的用户行可以直接用 `locale ?? 请求解析结果`。
--
-- 🔴 刻意可空（AGENTS §3.3）：存量行没有这个字段；null = 「用户从未在登录态下
-- 改过语言」，解析链照旧。写入只有两条路：注册时带上、登录态下 PUT /account/locale。
ALTER TABLE "users" ADD COLUMN "locale" TEXT;
