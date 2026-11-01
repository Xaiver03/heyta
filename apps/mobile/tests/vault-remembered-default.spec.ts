/**
 * ADR-0080 §5.4：移动端"钥匙默认由这台设备持有"
 * =============================================
 *
 * ⚠️ 本壳没有 RN 组件测试栈（`@testing-library/react-native` 不在依赖里，引它要先过
 * AGENTS §3.1 / §3.2 两道门并逐项登记），所以与 `account-closure-entry.spec.ts`、
 * `auth-screen-password.spec.ts` 同一条路：**剥掉注释后的源码形状判据**。
 *
 * 它证明的是三件能钉住的事，**不**证明"手机上点下去界面长什么样"（那一半只有真机截图算）：
 *   ① 「记住解锁」的初值是 `true`（默认设备持有，不是每次都要输）；
 *   ② 恢复码解锁那条路**仍然**把它压回 `false`（强制轮换期间不许持久化旧 root）；
 *   ③ 文件里不存在把它默认成 `false` 的写法（防"改回去了还绿"）。
 *
 * 判据一律跑在**剥掉注释**的源码上：这个文件里写满了"为什么默认开"的说明，
 * 而说明文字里出现 `useState(true)` 不该让判据变绿。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SOURCE = fileURLToPath(new URL('../src/screens/VaultSettingsSection.tsx', import.meta.url));

/** 去掉 `//` 与 `/* *\/` 注释，只留可执行代码的形状。 */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const code = stripComments(readFileSync(SOURCE, 'utf8'));

describe('移动端「记住解锁」默认值（ADR-0080）', () => {
  it('① 初值是 true —— 默认由这台设备持有 root', () => {
    expect(code).toMatch(/\[rememberUnlock,\s*setRememberUnlock\]\s*=\s*useState\(true\)/);
  });

  it('② 恢复码解锁仍把它压回 false（强制轮换期间不许持久化旧 root）', () => {
    // 这一句是"轮换未完成不落盘"的唯一执行点；默认值改成 true 之后它更容易被漏掉。
    expect(code).toMatch(/requiresRecoveryRotation[\s\S]{0,400}setRememberUnlock\(false\)/);
  });

  it('③ 不存在"默认 false"的写法（改回去了这条会红）', () => {
    expect(code).not.toMatch(/\[rememberUnlock,\s*setRememberUnlock\]\s*=\s*useState\(false\)/);
  });
});
