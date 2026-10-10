#!/usr/bin/env python3
"""把 server/src 里剩下的“自己拼一份邮箱归一化”全部改成调用唯一实现。

每一处都断言命中次数，任何一处对不上就整笔回滚（不写半套）。
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

# (rel, [(old, new, expected_count), ...], import_line)
EDITS = [
    (
        "server/src/api.ts",
        [("    where: { email: email.toLowerCase() },\n", "    where: { email: normalizeEmail(email) },\n", 1)],
        "import { normalizeEmail } from './account/email-normalize';",
        "import { isEmailAllowed } from './email-allowlist';\n",
    ),
    (
        "server/src/test-routes.ts",
        [("        where: { email: email.toLowerCase() },\n", "        where: { email: normalizeEmail(email) },\n", 1)],
        "import { normalizeEmail } from './account/email-normalize';",
        "import { prisma } from './db';\n",
    ),
    (
        "server/src/email-allowlist.ts",
        [
            ("  .map((e) => e.trim().toLowerCase())\n", "  .map((entry) => normalizeEmail(entry))\n", 1),
            ("  const normalized = email.toLowerCase();\n", "  const normalized = normalizeEmail(email);\n", 1),
        ],
        "import { normalizeEmail } from './account/email-normalize';",
        "import { Logger } from './logger';\n",
    ),
    (
        "server/src/admin/admins.ts",
        [
            (
                " * 这里用 `trim().toLowerCase()` —— 与 `server/src/auth.ts` 的查找口径一致。\n"
                " * ⚠️ 如果哪天注册改成不 lowercase，这里要跟着改，否则两者会静默分叉。\n"
                " */\n"
                "export function normalizeAdminEmail(raw: string): string {\n"
                "  return raw.trim().toLowerCase();\n"
                "}\n",
                " * 口径现在**不是这里的一份实现**，是 `account/email-normalize.ts` 的 `normalizeEmail`：\n"
                " * 上面那句“哪天注册改了这里要跟着改”的担心，正是它该被消掉的理由 ——\n"
                " * 一份实现没有“跟着改”这件事，它只有“本来就是同一份”。\n"
                " */\n"
                "export function normalizeAdminEmail(raw: string): string {\n"
                "  return normalizeEmail(raw);\n"
                "}\n",
                1,
            ),
        ],
        "import { normalizeEmail } from '../account/email-normalize';",
        None,
    ),
    (
        "server/src/password/service.ts",
        [("    where: { email: email.toLowerCase() },\n", "    where: { email: normalizeEmail(email) },\n", 1)],
        "import { normalizeEmail } from '../account/email-normalize';",
        "import { notifyAuthenticatorAdded } from '../account/authenticator-notice';\n",
    ),
    (
        "server/src/password/recovery.ts",
        [("  const email = input.email.toLowerCase();\n", "  const email = normalizeEmail(input.email);\n", 1)],
        "import { normalizeEmail } from '../account/email-normalize';",
        "import { sendPasswordChangedEmail, sendPasswordResetEmail } from '../email';\n",
    ),
    (
        "server/src/account/account-tombstones.ts",
        [
            (
                "/** 与 `server/src/admin/admins.ts` 的查找口径一致（trim + 小写），不是新的一套归一化。 */\n"
                "export function hashAccountEmail(email: string): string {\n"
                "  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');\n"
                "}\n",
                "/**\n"
                " * 墓碑的邮箱哈希输入口径 = `account/email-normalize.ts` 的 `normalizeEmail`。\n"
                " *\n"
                " * 🔴 这一行是**对外承诺的一部分**（ADR-0055 §2.2 把它与一条 `CHECK (email_hash ~ '^[0-9a-f]{64}$')`\n"
                " * 绑在一起，而那个口径已经写进隐私政策）。它以前自己写了一份 `trim().toLowerCase()`，\n"
                " * 与注册那五份各漂各的 —— 于是“同一个邮箱”在注销面和登录面可以是两个字符串，\n"
                " * 而恢复备份时那道“不许复活已注销账号”的闸门就会认出另一个人。\n"
                " */\n"
                "export function hashAccountEmail(email: string): string {\n"
                "  return createHash('sha256').update(normalizeEmail(email), 'utf8').digest('hex');\n"
                "}\n",
                1,
            ),
        ],
        "import { normalizeEmail } from './email-normalize';",
        "import { Prisma } from '@prisma/client';\n",
    ),
    (
        "server/src/password/registration-otp.ts",
        [
            (
                "const normalizeEmail = (email: string): string => email.trim().toLowerCase();\n\n",
                "",
                1,
            ),
        ],
        "import { normalizeEmail } from '../account/email-normalize';",
        "import { sendEmailPasswordRegistrationCodeEmail } from '../email';\n",
    ),
]

changed = []
staged = {}
for rel, pairs, import_line, anchor in EDITS:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    for old, new, count in pairs:
        got = text.count(old)
        if got != count:
            print(f"❌ {rel}: 期望 {count} 处，实到 {got} 处：{old[:60]!r}")
            sys.exit(1)
        text = text.replace(old, new)
    if import_line not in text:
        if anchor is None:
            # admins.ts：挂在第一个 import 之后
            idx = text.index("import ")
            end = text.index("\n", idx) + 1
            text = text[:end] + import_line + "\n" + text[end:]
        else:
            if text.count(anchor) != 1:
                print(f"❌ {rel}: import 锚点到 {text.count(anchor)} 处")
                sys.exit(1)
            text = text.replace(anchor, anchor + import_line + "\n")
    staged[path] = text
    changed.append(rel)

for path, text in staged.items():
    path.write_text(text, encoding="utf-8")

print(f"已改 {len(changed)} 枚文件：")
for rel in changed:
    print(f"  · {rel}")
