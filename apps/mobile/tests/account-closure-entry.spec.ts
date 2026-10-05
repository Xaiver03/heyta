/**
 * 「我的 → 注销账号」（批次 E3 的移动端面）
 * ==========================================
 *
 * ⚠️ 本壳没有 RN 组件测试栈（`@testing-library/react-native` 不在依赖里，引它要
 * 先过 AGENTS §3.1 / §3.2 两道门并逐项登记），所以这里与 `calendar-view-entry.spec.ts`、
 * `auth-screen-password.spec.ts` 同一条路：**接线半用源码形状判据，数据半跑代码**。
 *
 * 它证明：入口真的在「我的」上、点它真的到那屏、那屏真的调共享那条顺序、
 * 句子真的来自 `@heyta/ui` 那一份、凭据清理真的复用宿主那四件事。
 * 它**不**证明"手机上按下去界面长什么样" —— 那一半只有真机截图算（§6.2 规定一），
 * 登记在 `docs/plans/trash-and-archive.md` 的 W6/E3 取证栏。
 *
 * 🔴 判据一律跑在**剥掉注释**的源码上：这些文件里写满了"不许再抄一张表"之类的话，
 * 连着注释一起扫会让判据自己误报（也会诱使人把判据改成匹配注释）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE_SRC = resolve(HERE, '../src');
const REPO = resolve(HERE, '../../..');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

const screen = stripComments(readFileSync(join(MOBILE_SRC, 'screens/AccountClosureScreen.tsx'), 'utf8'));
const profile = stripComments(readFileSync(join(MOBILE_SRC, 'screens/ProfileScreen.tsx'), 'utf8'));

const zhSrc = readFileSync(join(REPO, 'packages/i18n/src/locales/zh-CN.ts'), 'utf8');
const enSrc = readFileSync(join(REPO, 'packages/i18n/src/locales/en.ts'), 'utf8');

/** 本屏读到的所有词条 key（从 `t('…')` 里现取，不手抄清单）。 */
const usedKeys = [...new Set([...screen.matchAll(/\bt\(\s*'([a-zA-Z.]+)'/g)].map((m) => m[1]!))];
const profileKeys = [
  ...new Set(
    [...profile.matchAll(/\bt\(\s*'(common\.accountClosure\.[a-zA-Z.]+)'/g)].map((m) => m[1]!),
  ),
];

describe('注销账号：移动端的接线', () => {
  it('前提：探针取到了东西（取空集会让下面每条都无条件绿）', () => {
    expect(usedKeys.length, '本屏一个 t() 都没取到 ⇒ 正则在测自己').toBeGreaterThan(6);
    expect(profileKeys.length).toBeGreaterThan(0);
  });

  it('🔴 入口在「我的」上，而且排在「导出数据」的**紧后面**', () => {
    // 顺序是功能，不是审美：注销那道屏要求的第一步就是"先导出留一份"。
    // 两格隔着一屏时，那句话只是一个引用，不是一个出口。
    const exportAt = profile.indexOf("testID: 'profile-entry-export'");
    const closeAt = profile.indexOf("testID: 'profile-entry-close-account'");
    expect(exportAt, '「导出数据」那格不见了（判据的锚点坏了）').toBeGreaterThan(-1);
    expect(closeAt, '「注销账号」没有入口').toBeGreaterThan(-1);
    expect(closeAt, '注销入口排在了导出前面').toBeGreaterThan(exportAt);
    // 中间不许夹别的行：`},\n    {` 之后就是它。
    const between = profile.slice(exportAt, closeAt);
    expect(between.split('testID:').length - 1, '两格之间还夹了别的入口').toBe(1);
  });

  it('🔴 `onClosed` 接的是宿主那条 `onClearCredentials`，不是在这儿再写一份清理', () => {
    expect(screen).toMatch(/onClosed\(\)/);
    expect(profile).toMatch(/<AccountClosureScreen[\s\S]{0,400}onClosed=\{onClearCredentials\}/);
    // 清凭据在移动端是四件事（凭据、小组件快照、表单状态、邮箱）。壳里再写一份
    // 就是第五处漂移点 —— 那四件事每一件都对应一个已经发生过的事故。
    const clears = (profile.match(/onClearCredentials/g) ?? []).length;
    expect(clears, `onClearCredentials 的引用数不对：${clears}`).toBeGreaterThanOrEqual(2);
  });

  it('🔴 句子全部来自共享那一份路由：本屏不许出现 done./failed. 的字面量', () => {
    expect(screen).toMatch(/accountClosureMessageKey\(/);
    const hardcoded = usedKeys.filter(
      (key) => key.startsWith('common.accountClosure.done.') || key.startsWith('common.accountClosure.failed.'),
    );
    expect(hardcoded, `本屏自己挑了结局的句子：${hardcoded.join(', ')}`).toEqual([]);
  });

  it('未上传那一句用的是现量数字，不是"可能有未同步数据"', () => {
    expect(screen).toMatch(/pendingUploadCount\(\)/);
    expect(screen).toMatch(/t\(\s*'common\.accountClosure\.pending',\s*\{\s*count:/);
    // 🔴 读不到数时**整行不进树**：显示 0 会让人敢按下，显示"未知"会被读成"那就是没有"。
    expect(screen).toMatch(/pending !== undefined && pending > 0/);
  });

  it('🔴 注销也是出境：请求必须过本机同意闸门', () => {
    expect(screen).toMatch(/fetchImpl:\s*consentFetch/);
    // 反面对照：同一个调用里确实带了 baseUrl 与 token，闸门不是唯一那个参数。
    // ⚠️ 末尾的 `,?` 是给 prettier 的换行尾逗号留的：这条要钉的是"调用形状"，
    // 不是格式化器的偏好 —— 不给它留这一格，判据会在没人改行为的那次 reformat 上转红。
    expect(screen).toMatch(
      /closeAccountAndEraseLocal\(\s*\{\s*baseUrl,\s*fetchImpl:\s*consentFetch\s*\},\s*token\s*,?\s*\)/,
    );
  });

  it('in-flight 守卫写在函数里，不只靠按钮的 disabled（双击会发两条 DELETE）', () => {
    expect(screen).toMatch(/if \(\s*busy \|\| !acked \|\| !signedIn\s*\) return/);
    // 第二条 DELETE 会拿到"账号已经不在了"的失败，于是界面在"已注销"之后
    // 又显示"没有注销" —— 那是一句自相矛盾的话，而两种说法都是假的。
    expect(screen).toMatch(/disabled=\{busy\}/);
  });

  it('只有账号确认没了才清凭据，而且清之前先把那个已被销毁的宿主单例换掉', () => {
    // 🔴 后半句是批次 E2 口径 B（§10.186/§10.187）逼出来的：
    // `open-host.ts` 的 `pending` / `resolvedHost` 是**模块级单例**，全部屏共用一个 `AppHost`，
    // 而兜底销毁器（`host.ts:341`）销毁的正是它手里那个 adapter。不在这儿作废它的话，
    // 下一屏的 `openTaskHost()` 会把同一个死实例再交出去 ——
    // 加了守卫之后那会当场抛 `AdapterDestroyedError`，加守卫**之前**则是
    // "静默把刚删掉的空壳建回盘上"（§10.146 那枚 73728 字节 / 6 张空表）。
    // 两种都不是注销完该有的样子：政策承诺这台设备回到**全新空库**。
    expect(screen).toMatch(
      /if \(closure\.disposition !== 'not-closed'\) \{\s*resetTaskHostCache\(\);\s*onClosed\(\);\s*\}/,
    );
    // 反方向：`not-closed` 时一次都不许调。这条形状判据挡得住"写成无条件调用"吗？
    // 挡得住 —— 上面那句要求的是**带条件的**块，无条件那一行匹配不上。
    expect(screen.match(/onClosed\(\)/g) ?? []).toHaveLength(1);
    expect(screen.match(/resetTaskHostCache\(\)/g) ?? []).toHaveLength(1);
    // 来源必须是那一个模块，而不是在本屏再抄一份"清单例"的逻辑（那正是漂移的开始）。
    expect(screen).toMatch(
      /import \{[^}]*\bresetTaskHostCache\b[^}]*\} from '\.\.\/db\/open-host'/,
    );
  });

  it('🔴 被动通道也作废单例：`open-host.ts` 必须把 `resetTaskHostCache` 接到宿主销毁通知上', () => {
    // 主动通道那一发在 `AccountClosureScreen` 里（上一条钉它）。
    // 但注销常常是**另一台设备**按下的：本机某次同步读到 `ACCOUNT_CLOSED` ⇒
    // `client.ts:937` 的 `eraseLocalData()` 销毁同一个 adapter，而那条路上**没有那屏**。
    // 所以作废单例这件事必须挂在"销毁成功"这个**事件**上，而不是挂在某个界面上。
    const hostSrc = stripComments(readFileSync(join(MOBILE_SRC, 'db/open-host.ts'), 'utf8'));
    expect(hostSrc).toMatch(/onLocalDataErased:\s*resetTaskHostCache/);
    // 反面对照：不能只是"两个符号都在文件里"—— 要真的接进 `openAppHost` 的那一份选项里。
    expect(hostSrc).toMatch(/openAppHost\(\{[\s\S]{0,3000}onLocalDataErased:\s*resetTaskHostCache/);
  });

  it('本屏的可见文字全部走词条，且有汉字的地方不含裸文案', () => {
    // `check:ui-language` 管的是全站；这条只管本屏，而且管的是另一个方向：
    // JSX 里出现 `>中文<` 就是硬编码。
    expect(screen).not.toMatch(/>\s*[\u4e00-\u9fa5][^<]*</);
    expect(screen).not.toMatch(/label=\s*'[^']*[一-龥]/u);
  });

  it('🔴 ProfileScreen 那两条冻结判据的红线：本批没有往它加 `web.*` 键', () => {
    // `profile-nickname-entry.spec.ts` 要求这整个文件里连注释都不许出现 `t('web.`。
    // 注销那组词条因此住在 `common.` —— 它是 Web 与移动端**共读**的一份句子。
    expect(readFileSync(join(MOBILE_SRC, 'screens/ProfileScreen.tsx'), 'utf8').match(/t\(\s*'web\./gu) ?? []).toHaveLength(0);
    expect(profileKeys.every((key) => key.startsWith('common.'))).toBe(true);
    // 正向对照：同一形状的探针在本文件里是能命中的。
    expect(profile.match(/t\(\s*'(common|mobile)\./gu)?.length ?? 0).toBeGreaterThan(6);
  });

  it('用到的每一条 key 在中英两份表里都有字', () => {
    const all = [...new Set([...usedKeys, ...profileKeys])];
    expect(all.length).toBeGreaterThan(8);
    for (const key of all) {
      expect(zhSrc.includes(`'${key}':`), `zh 里没有 ${key}`).toBe(true);
      expect(enSrc.includes(`'${key}':`), `en 里没有 ${key}`).toBe(true);
    }
  });
});
