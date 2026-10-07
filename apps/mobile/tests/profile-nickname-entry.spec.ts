/**
 * R15a：移动端「我的」页的**昵称读写界面**（接线判据）
 * =====================================================
 *
 * `apps/mobile` 的测试通道是**源码级**的（node 环境，没有 RTL / 没有 jsdom，
 * 见 `apps/mobile/package.json` 与 `subtask-entry.spec.ts` 文件头那段理由），
 * 行为本身由设备脚本 `pnpm verify:mobile-*` 那一族负责。
 * 所以这里钉的是三件事：
 *
 * 1. **接的是共享的那三个函数**（读 / 判 / 写），不是在本壳里重写一遍判定 ——
 *    判定重写一遍就是"两份裁决"，而 AGENTS §3.5 已经为这个形状记过两次账。
 * 2. **出境闸门在读取路径上**（`networkAllowed()` 为假 ⇒ 一个请求都不发）。
 * 3. **文案全走 i18n，且移动端不许读 `web.*` 命名空间的键** ——
 *    那一族的键名说的是"哪个壳画的"，而不是"说的是什么事"。
 *
 * 🔴 每条负向断言都配了正向对照（同一段源码里必然命中另一枚 needle），
 *    否则"没命中"可能只是探针根本没读到文件。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 🔴 路径**必须**相对本文件解析：vitest 的工作目录是 `apps/mobile`，
//    写仓库相对路径会在 `pnpm --filter` 下 ENOENT（第一版就是这么红的 9 条）。
const SCREEN = new URL('../src/screens/ProfileScreen.tsx', import.meta.url);
const ZH = new URL('../../../packages/i18n/src/locales/zh-CN.ts', import.meta.url);
const EN = new URL('../../../packages/i18n/src/locales/en.ts', import.meta.url);

/** 读源码并**去掉注释** —— 注释里提到的函数名不算接上了。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\S\s]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const screen = (): string => stripComments(readFileSync(SCREEN, 'utf8'));

/** `fetchDisplayName` 那一段（从声明到它自己闭合的那行）。 */
const fetchBody = (): string => {
  const src = screen();
  const start = src.indexOf('const fetchDisplayName');
  expect(start, '源码里找不到 `const fetchDisplayName`').toBeGreaterThan(-1);
  const end = src.indexOf('const saveDisplayName', start);
  expect(end, '源码里找不到 `const saveDisplayName`').toBeGreaterThan(start);
  return src.slice(start, end);
};

/**
 * `saveDisplayName` 那一段。
 *
 * 🔴 终点必须显式截到头像段之前。原本它是"一直到文件末尾"，于是 R15b 在同一个
 * 文件里接上头像之后，那句 `not.toContain('avatar.failed')` 命中的是**头像自己的**
 * 失败文案 —— 判据想钉的是"昵称失败别说头像"，却把邻居的合法文案读成了违规。
 * 一条会因为旁边新增功能而变红的判据，说明它数的不是它声称在数的东西。
 */
const saveBody = (): string => {
  const src = screen();
  const start = src.indexOf('const saveDisplayName');
  expect(start, '源码里找不到 `const saveDisplayName`').toBeGreaterThan(-1);
  const end = src.indexOf('const [avatarHash', start);
  expect(end, '源码里找不到头像段的起点（保存段的终点）').toBeGreaterThan(start);
  return src.slice(start, end);
};

describe('移动端 Profile 的昵称（R15a）', () => {
  it('🔴 读 / 判 / 写三个函数都来自共享层，本壳里没有第二套判定', () => {
    const src = screen();
    expect(src).toMatch(/getAccountProfile\s*\(/u);
    expect(src).toMatch(/planDisplayNameWrite\s*\(/u);
    expect(src).toMatch(/updateAccountDisplayName\s*\(/u);
    // 正向对照证明这三条正则真的能匹配调用形状（而不是匹配到 import 那一行）：
    // `planDisplayNameWrite({` 这种带对象的调用只在判定那一次出现。
    expect((src.match(/planDisplayNameWrite\s*\(\s*\{/u) ?? []).length).toBe(1);
    // 🔴 没有本地重判：界面上不许自己比"超没超长"来决定发不发。
    expect(src).not.toMatch(/draft[^)]*>\s*ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS\s*\)\s*return/u);
  });

  it('读取走出境闸门 —— 没同意就不发请求（与徽标同一条纪律）', () => {
    expect(fetchBody()).toContain('networkAllowed()');
    // 正向对照：这一段真的在发请求（不是空函数）。
    expect(fetchBody()).toMatch(/getAccountProfile\s*\(\s*\{\s*baseUrl/u);
  });

  it('读取失败**不清空**已有读数（一次抖动不该让昵称凭空消失）', () => {
    // 判据的形状：失败立刻 return，后面的 set 都够不着；且任何路径都不把昵称写成 null。
    // ⚠️ R15b 把这里从 `if (outcome.ok) set…` 改成了 `if (!outcome.ok) return;`
    //    （同一次读取要顺带回 `avatarHash`）。不变量没变，所以改的是形状，不是判据。
    const body = fetchBody();
    expect(body).toMatch(/if\s*\(!outcome\.ok\)\s*return;/u);
    expect(body).not.toMatch(/setSavedName\(\s*null\s*\)/u);
    expect(body).not.toMatch(/else\s*\{\s*setSavedName\(null\)/u);
  });

  it('🔴 三态是分开的：还没读到 ⇒ **整行不出现**；读到 null ⇒ 显示那句占位', () => {
    const src = screen();
    expect(src).toMatch(
      /savedName === undefined \? null : !profileNetworkAllowed \? null :/u,
    );
    expect(src).toMatch(/savedName \?\? t\('common\.profile\.nickname\.placeholder'\)/u);
    // 正向对照：这一行确实可点（编辑入口挂上了）。
    expect(src).toMatch(/onPress: \(\) =>/u);
  });

  it('本地模式只说明本地可用，不显示无效重试或伪造的读取失败', () => {
    const src = screen();
    const editorStart = src.indexOf('const profileEditor =');
    const editorEnd = src.indexOf('return (\n    <Screen', editorStart);
    expect(editorStart).toBeGreaterThan(-1);
    expect(editorEnd).toBeGreaterThan(editorStart);
    const editor = src.slice(editorStart, editorEnd);
    const localStart = editor.indexOf('!profileNetworkAllowed ? (');
    const readStart = editor.indexOf(': savedName === undefined ? (', localStart);
    expect(localStart).toBeGreaterThan(-1);
    expect(readStart).toBeGreaterThan(localStart);

    const localBranch = editor.slice(localStart, readStart);
    expect(localBranch).toContain("t('mobile.profile.localOnly')");
    expect(localBranch).not.toContain('mobile.profile.retry');
    expect(localBranch).not.toContain('mobile.profile.loading');
    expect(localBranch).not.toContain('common.profile.loadFailed');

    const readEnd = editor.indexOf('\n      ) : null}', readStart);
    expect(readEnd).toBeGreaterThan(readStart);
    const readBranch = editor.slice(readStart, readEnd);
    expect(readBranch).toContain("'mobile.profile.loading'");
    expect(readBranch).toContain("'common.profile.loadFailed'");
    expect(readBranch).toContain("profileReadState === 'loading'");
    expect(readBranch).toContain("t('mobile.profile.retry')");
  });

  it('保存路径的三个出口都有文案：失败 / 已保存 / 已清除', () => {
    const body = saveBody();
    expect(body).toContain("common.profile.nickname.failed");
    expect(body).toContain("common.profile.nickname.saved");
    expect(body).toContain("common.profile.nickname.cleared");
    // 🔴 失败用的是**昵称**那句，不是头像那句（web 那边曾经复用错过）。
    expect(body).not.toContain('avatar.failed');
  });

  it('超长时说的是带数字的那句（{max} 与 {count} 都从契约来）', () => {
    const body = saveBody();
    expect(body).toContain('common.profile.nickname.toolong');
    expect(body).toMatch(/displayNameCodePoints\(nameDraft\)/u);
    expect(body).toMatch(/ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS/u);
  });

  it('界面文案全部走 i18n：昵称这一段里没有硬编码中文', () => {
    const src = readFileSync(SCREEN, 'utf8');
    const jsx = src.slice(src.indexOf('{savedName === undefined ? null : !profileNetworkAllowed'));
    expect(jsx).not.toMatch(/>[^<{\n]*[\u4e00-\u9fa5]/u);
    // 正向对照：这段里确实有 t() 调用。
    expect(jsx).toMatch(/t\('common\.profile\.nickname\./u);
  });

  it('新词条中英**都在**，且不是同一段英文糊上去的', () => {
    const zh = readFileSync(ZH, 'utf8');
    const en = readFileSync(EN, 'utf8');
    for (const key of ['common.profile.nickname.failed', 'mobile.profile.nickname.hint']) {
      expect(zh, `zh 词条表缺 ${key}`).toContain(`'${key}'`);
      expect(en, `en 词条表缺 ${key}`).toContain(`'${key}'`);
    }
    // ⚠️ 这句英文里带撇号（`Couldn\'t`），用 `[^"']*` 去包值会被它截断
    //    ⇒ 假红"词条不存在"（本条第二版就是这么红的）。
    //    改成"整行里出现 nickname" —— 比的是这一行，不是引号形状。
    //    （词条表的形状由 `check:ui-language` 管：一行一条、key 与 value 都单引号、
    //      内部引号要转义 —— 写成双引号的值会让那个解析器报"漏行"而不是静默通过。）
    expect(en).toMatch(/^  'common\.profile\.nickname\.failed':.*nickname/imu);
    expect(zh).toMatch(/'mobile\.profile\.nickname\.hint':\s*'[^']*昵称[^']*'/u);
  });

  it('🔴 本屏**一个 `web.*` 键都不读**（命名空间说的是壳，不是事）', () => {
    // ⚠️ 这一条的范围是**本文件**，不是整个 `apps/mobile/src` —— 现量：整个移动壳
    //    正在读 179 处 `web.*` 键（`ExportScreen.tsx`、`ui/habit-goal-slot.tsx` 等），
    //    那是既存的账，登记在计划文档 §6，不在这一批里顺手改。
    //    新写的界面不能再往那本账上加一条。
    const src = screen();
    expect(src.match(/t\(\s*'web\./gu) ?? [], 'ProfileScreen 里出现了 t(\'web.…\')').toHaveLength(0);
    // 正向对照：同一形状的探针在本文件里是能命中的（否则 0 条什么都不证明）。
    expect(src.match(/t\(\s*'(common|mobile)\./gu)?.length ?? 0).toBeGreaterThan(6);
  });
});
