#!/usr/bin/env python3
"""W6 告知信判据的变异复现：每一臂把一处实现改坏，只有对应那条断言应当转红。

用法：
  python3 research/tools/mutate-w6.py baseline
  python3 research/tools/mutate-w6.py <arm>
只动三枚源文件，改前逐枚备份到 .mut-w6-bak/，跑完还原（还原放在 finally 里，
中断也不会把变异留在树里）。臂数由本文件自己打印，文档里不许抄。
"""
import os
import subprocess
import sys
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[2]
BACKUP = ROOT / ".mut-w6-bak"

PASSKEY_SPEC = "tests/passkey-enrollment.spec.ts"
PASSWORD_SPEC = "tests/password-auth-routes.spec.ts"

# (rel_path, old, new, expected_hits, spec)
ARMS = {
    # ---- passkey 腿 ----
    # 1. 不发信 ⇒ “成功 ⇒ 发一封 passkey 信”必须红
    "pk-no-notice": (
        "server/src/passkey.ts",
        "  await notifyAuthenticatorAdded(userId, 'passkey');\n",
        "",
        1,
        PASSKEY_SPEC,
    ),
    # 2. 收件地址不取账号那一行 ⇒ 同那条必须红
    "pk-wrong-recipient": (
        "server/src/account/authenticator-notice.ts",
        "      user.email,\n",
        "      'victim@example.com',\n",
        1,
        PASSKEY_SPEC,
    ),
    # 3. 发在写之前 ⇒ “写入没发生 ⇒ 一封都不发”必须红
    "pk-send-before-write": (
        "server/src/passkey.ts",
        "  let created: { id: string };\n",
        "  await notifyAuthenticatorAdded(userId, 'passkey');\n  let created: { id: string };\n",
        1,
        PASSKEY_SPEC,
    ),
    # 4. 摘掉外层 swallow（通知抛出 = 让整个请求失败）⇒ “发信抛错仍 200”必须红
    "pk-notice-failure-flips": (
        "server/src/account/authenticator-notice.ts",
        """  } catch (err) {
    // 🔴 这一层**唯一**允许的失败形状：记下、然后什么都不改。
    Logger.error(
      `Authenticator-added notice failed (ID: ${userId}): ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }""",
        """  } catch (err) {
    throw err;
  }""",
        1,
        PASSKEY_SPEC,
    ),
    # 5. 走了按 email 查账号那条分支 ⇒ 反向 C 的形状判据必须红
    "pk-email-lookup-branch": (
        "server/src/passkey.ts",
        "  const { rpID, origin } = getWebAuthnConfig();\n\n  const expectedChallenge = getAndClearChallenge('user-registration', String(userId));",
        "  const { rpID, origin } = getWebAuthnConfig();\n  await prisma.user.findUnique({ where: { email: 'someone@example.com' } });\n\n  const expectedChallenge = getAndClearChallenge('user-registration', String(userId));",
        1,
        PASSKEY_SPEC,
    ),
    # ---- password 腿 ----
    # 6. 不发信 ⇒ “成功 ⇒ 发一封 password 信”必须红
    "pw-no-notice": (
        "server/src/password/service.ts",
        "  await notifyAuthenticatorAdded(user.id, 'password');\n",
        "",
        1,
        PASSWORD_SPEC,
    ),
    # 7. 抢输的那次也发 ⇒ “count=0 ⇒ 一封都不发”必须红
    "pw-send-before-write": (
        "server/src/password/service.ts",
        "  const written = await prisma.user.updateMany({\n",
        "  await notifyAuthenticatorAdded(user.id, 'password');\n  const written = await prisma.user.updateMany({\n",
        1,
        PASSWORD_SPEC,
    ),
    # 8. 已有口令那次也发 ⇒ “400 ⇒ 不发”必须红
    "pw-send-on-reject": (
        "server/src/password/service.ts",
        "  if (user.passwordHash !== null) {\n",
        "  if (user.passwordHash !== null) {\n    await notifyAuthenticatorAdded(user.id, 'password');\n",
        1,
        PASSWORD_SPEC,
    ),
    # 9. 语言不看账号、硬编码 en ⇒ “没有值时走默认中文”必须红
    "pw-locale-hardcoded": (
        "server/src/account/authenticator-notice.ts",
        "      asServerLocale(user.locale) ?? DEFAULT_SERVER_LOCALE,\n",
        "      'en',\n",
        1,
        PASSWORD_SPEC,
    ),
    # 10. 外层 swallow 摘掉 ⇒ “发信抛错仍 200”必须红
    "pw-notice-failure-flips": (
        "server/src/account/authenticator-notice.ts",
        """  } catch (err) {
    // 🔴 这一层**唯一**允许的失败形状：记下、然后什么都不改。
    Logger.error(
      `Authenticator-added notice failed (ID: ${userId}): ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }""",
        """  } catch (err) {
    throw err;
  }""",
        1,
        PASSWORD_SPEC,
    ),
}


def run(label: str, spec: str) -> int:
    proc = subprocess.run(
        ["npx", "vitest", "run", spec],
        cwd=ROOT / "server",
        capture_output=True,
        text=True,
        env={**os.environ, "NO_COLOR": "1"},
    )
    out = proc.stdout + proc.stderr
    totals = [ln.strip() for ln in out.splitlines() if "Tests " in ln]
    failed = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("× ")]
    print(f"{label}: rc={proc.returncode} {' | '.join(totals)}", flush=True)
    for ln in failed[:12]:
        print(f"   {ln}", flush=True)
    return proc.returncode


def main() -> int:
    arm = sys.argv[1] if len(sys.argv) > 1 else "baseline"
    print(f"共 {len(ARMS)} 臂", flush=True)
    if arm == "baseline":
        for spec in (PASSKEY_SPEC, PASSWORD_SPEC):
            run("baseline", spec)
        return 0
    if arm not in ARMS:
        print(f"未知臂：{arm}（可选：{', '.join(ARMS)}）", flush=True)
        return 2
    rel, old, new, count, spec = ARMS[arm]
    BACKUP.mkdir(exist_ok=True)
    target = ROOT / rel
    backup = BACKUP / pathlib.Path(rel).name
    shutil.copy(target, backup)
    text = target.read_text(encoding="utf-8")
    assert text.count(old) == count, f"{arm}: 找到 {text.count(old)} 处，预期 {count}"
    target.write_text(text.replace(old, new), encoding="utf-8")
    try:
        return run(arm, spec)
    finally:
        shutil.copy(backup, target)
        print(f"{arm}: 已还原 {rel}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
