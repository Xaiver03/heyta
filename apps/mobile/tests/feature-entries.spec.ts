/**
 * 移动端功能域入口的守卫（W8 / 本文 §7 第 5 条那条裁决的**执行**）
 * =================================================================
 *
 * ## 判的不是"样式对不对"，而是"入口是不是真的存在、词表是不是真的共享"
 *
 * 本壳没有 RN 组件测试栈（`@testing-library/react-native` 不在依赖里，
 * 引它要先过 AGENTS §3.1 + §3.2 两道门），所以这里用**两半**：
 *
 *   · **数据半**：`nav/feature-entries.ts` 是纯数据，node 里能值导入，
 *     于是"每个 key 在共享词表里""中英两条词条都取到字"这两件事
 *     是**跑代码**跑出来的，不是读文本读出来的。
 *   · **接线半**：注册表有没有被 `ProfileScreen` 真的消费、那张屏在不在，
 *     只能查源码（与 `habit-goal-entry.spec.ts`、`subtask-entry.spec.ts`
 *     同一个取向 —— 那种"零件都在、线没接"的失效**没有行为可测**）。
 *     🔴 一律先剥注释再匹配：把一行调用**注释掉**来糊过判据，
 *     是这个仓库记过的第一种假绿（§7 第 50 条）。
 *
 * ## 为什么"词表共享"这条能红
 *
 * 主判据是**编译期**的：`MobileFeatureEntry.key` 声明成 `@heyta/domain` 的
 * `FeatureModuleKey`，移动端自己编一个 web 没有的词就是 typecheck 红。
 * 🔴 实测过的变异臂（就地写在这里，不留给一份会漂的抄件）：
 *
 *   | 臂 | 改动 | 红在哪 |
 *   |---|---|---|
 *   | A | `feature-entries.ts` 里 `countdown` → `count-down` | typecheck 红 **+** 本文件「注册表里每个 key 都在共享词表里」红 |
 *   | B | 删掉注册表里的 `countdown` 一项 | 本文件「🔴 移动端**必须露出**这三个功能域」红（产品承诺，不是实现细节） |
 *   | C | 把 `ProfileScreen` 里 `MOBILE_FEATURE_ENTRIES.map` 换回手写两行字面量 | 本文件「`ProfileScreen` **消费了注册表**」红 |
 *   | D | 把那张屏的渲染从 `featureScreen()` 里删掉、只留注册表项 | 同一条红的第二句（`<CountdownScreen` 不在源码里） |
 *   | E | `MobileFeatureEntry.key` 放宽成 `string` | A 的编译期部分失效，但运行时那条仍红 —— 两条各管一件事 |
 *
 * 本文件里的运行时那两条是**补位**，各有分工：
 *
 *   1. `isFeatureModuleKey(entry.key)` —— 防的是"有人把 `key` 的类型放宽成
 *      `string`"（那时编译期那条就没了，而字符串照样能溜进来）。
 *   2. **web 开关表 ⇄ 共享词表集合相等** —— 防的是"别名只是装饰"：
 *      加了词表项而 web 的 `SHELL_MODULES` 少一项（或反过来），这里红。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FEATURE_MODULE_KEYS, isFeatureModuleKey } from '@heyta/domain';
import { translate } from '@heyta/i18n';
import { describe, expect, it } from 'vitest';

import { MOBILE_FEATURE_ENTRIES } from '../src/nav/feature-entries';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');
/** web 的开关表：词表的另一半，跨 app 只能按源码文本对账。 */
const WEB_MODULES = resolve(HERE, '../../../apps/web/src/features/shell/modules.ts');
/** web 那份倒数日 labels 构造器：与移动端 `lib/countdown-display.ts` 对账的另一半。 */
const WEB_COUNTDOWN_VIEW = resolve(
  HERE,
  '../../../apps/web/src/features/countdown/CountdownView.tsx',
);

/** 去掉块注释与行注释，只留会被执行的东西（理由见文件头 ⚠️）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** 本壳 `src/` 下的文件，剥掉注释后的源码。 */
function codeOf(file: string): string {
  return stripComments(readFileSync(join(SRC, file), 'utf8'));
}

/** 跨 app 的文件（同一套剥注释规则）—— 词表的另一半住在 `apps/web`。 */
function codeOfPath(absPath: string): string {
  return stripComments(readFileSync(absPath, 'utf8'));
}

/** 从一个 .ts/.tsx 源文本里取 `key: '<字面量>'` 的那批字面量（数组注册表用的形状）。 */
function keyLiteralsOf(source: string): string[] {
  return [...source.matchAll(/\bkey:\s*'([a-z-]+)'/g)].map((m) => m[1] as string);
}

/**
 * 🔴 **移动端必须露出的功能域**（产品承诺清单，不是实现细节）。
 *
 * 每一项都写清"为什么这一端必须有入口"，因为这张表的**存在理由**是：
 * 删掉注册表里的一项**不会**让任何其他判据变红 —— 注册表少一项，
 * 生成的行数就少一行，界面照样好看、编译照样过、web 照样全绿。
 * 那正是"零件都在、线没接"里最难查的一格（AGENTS §3.5 末尾两段、
 * roadmap §5.1 的 P0/P2 全是同一形状）。所以这一条是那个失效模式的**唯一**拦截点。
 *
 * | key | 为什么这一端必须有入口 |
 * |---|---|
 * | `growth` | M3 第六刀：移动端此前只能看任务，看不到"我这段日子花在哪" |
 * | `habits` | M3 第七刀：打卡是**手机**的场景（坐在书桌前掏手机），web 反而不是主场 |
 * | `countdown` | **W8**：`EVENT`（W2）+ 共享卡片面（W5）+ AI 工具（W10）全都在，而移动端零入口 |
 *
 * ⚠️ 这张表**不是**词表的副本 —— 它是词表的**子集**，下面的断言钉住这一点：
 * 往这里加一个词表里没有的词 = 红；往 `FEATURE_MODULE_KEYS` 加一项而没动这里
 * = **不红**（"这一端摆几个"是平台差异，见 `nav/feature-entries.ts` 文件头那半张表）。
 */
const MOBILE_MUST_EXPOSE = ['growth', 'habits', 'countdown'] as const;

describe('功能域词表：两端共用一份，不是两份抄件', () => {
  it('注册表里每个 key 都在共享词表 `FEATURE_MODULE_KEYS` 里', () => {
    for (const entry of MOBILE_FEATURE_ENTRIES) {
      expect(
        isFeatureModuleKey(entry.key),
        `移动端登记了一个不在共享词表里的功能域：${entry.key}`,
      ).toBe(true);
    }
  });

  it('🔴 移动端**必须露出这三个功能域**（少一个 = 那一端根本没有这个功能）', () => {
    const exposed = MOBILE_FEATURE_ENTRIES.map((entry) => entry.key);
    for (const key of MOBILE_MUST_EXPOSE) {
      expect(
        exposed,
        `移动端没有 ${key} 的入口了 —— 这一条就是"倒数日在手机上根本不存在"那类失效的拦截点`,
      ).toContain(key);
    }
    // 子集关系（不许把这张表长成第二份词表）
    for (const key of MOBILE_MUST_EXPOSE) {
      expect(
        FEATURE_MODULE_KEYS,
        `承诺清单里的 ${key} 已经不在共享词表里了 —— 词表被改小要**先**改这里`,
      ).toContain(key);
    }
  });

  it('🔴 web 的开关表与共享词表**集合相等**（别名不是装饰）', () => {
    const webKeys = keyLiteralsOf(readFileSync(WEB_MODULES, 'utf8'));
    expect(
      webKeys.length,
      '一个 `key:` 字面量都没抓到 —— web 的注册表形状变了，这条判据已经失效',
    ).toBeGreaterThan(0);
    expect([...new Set(webKeys)].sort()).toEqual([...FEATURE_MODULE_KEYS].sort());
  });
});

describe('每一条登记的入口：词条取到字、屏接得上', () => {
  it('中英两条词条都**真的取得到字**（缺 key 会抛，不是返回空串）', () => {
    for (const entry of MOBILE_FEATURE_ENTRIES) {
      const zh = translate('zh-CN', entry.labelKey);
      const zhHint = translate('zh-CN', entry.hintKey);
      const en = translate('en', entry.labelKey);
      const enHint = translate('en', entry.hintKey);
      for (const [name, text] of [
        ['zh label', zh],
        ['zh hint', zhHint],
        ['en label', en],
        ['en hint', enHint],
      ] as const) {
        expect(text.trim(), `${entry.key} 的 ${name} 是空串`).not.toBe('');
      }
      // 中文含汉字、英文不含 —— 与 `check:ui-language` 同一条口径，
      // 差别是这里按"这一条入口真的两语都有字"来判。
      expect(zh, `${entry.key} 的中文标题没有汉字`).toMatch(/[\u4e00-\u9fff]/);
      expect(en, `${entry.key} 的英文标题里混进了汉字`).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('testID 全局唯一且都挂在 `profile-entry-` 这一族上（设备验收指的就是它）', () => {
    const ids = MOBILE_FEATURE_ENTRIES.map((entry) => entry.testID);
    expect(new Set(ids).size, '两个入口用了同一个 testID，设备脚本会点到错的那一行').toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^profile-entry-[a-z-]+$/);
  });

  it('🔴 `ProfileScreen` **消费了注册表**，并为每一项渲染注册表里那张屏', () => {
    const code = codeOf('screens/ProfileScreen.tsx');
    expect(code, '入口行不再由注册表生成 ⇒ 回到了各写一遍').toContain('MOBILE_FEATURE_ENTRIES.map');
    for (const entry of MOBILE_FEATURE_ENTRIES) {
      expect(code, `注册表里的 ${entry.key} 没有对应的 switch 分支`).toContain(
        `case '${entry.key}'`,
      );
      expect(code, `${entry.screen} 没有被渲染 ⇒ 那一行点了没反应`).toContain(`<${entry.screen}`);
    }
  });
});

describe('P10 仍然成立：功能域不占底部标签', () => {
  it('底部标签仍是 5 个，且功能域的 key 一个都没进 `TABS`', () => {
    const code = codeOf('nav/TabBar.tsx');
    const tabs = [...code.matchAll(/\bkey:\s*'([a-z-]+)'/g)].map((m) => m[1] as string);
    expect(tabs, `底部标签数量变成 ${String(tabs.length)}`).toHaveLength(5);
    for (const entry of MOBILE_FEATURE_ENTRIES) {
      expect(
        tabs,
        `${entry.key} 变成了第 6 个 tab —— ADR-0015 §4 / P10 的连带（真机脚本的坐标）都要重算`,
      ).not.toContain(entry.key);
    }
  });
});

describe('注册表里那个 `screen` 字符串：那张屏真的存在、真的接了宿主', () => {
  it('每一项的 `screen` 都有同名文件，且它读的是**物化状态**（`openTaskHost()`）', () => {
    // 为什么这一条不是重复上一条：上一条只查 `ProfileScreen` 里出现过 `<CountdownScreen`，
    // 而那**只证明 import 了**——把那张屏写成"还没有内容"的占位组件时上一条照样绿。
    // 这正是 `NotesSection` / `HabitsScreen` 都写"占位文件已删除"的原因（AGENTS §2 的 P2 行）。
    for (const entry of MOBILE_FEATURE_ENTRIES) {
      const file = join(SRC, 'screens', `${entry.screen}.tsx`);
      expect(existsSync(file), `${entry.key} 的屏不存在：apps/mobile/src/screens/${entry.screen}.tsx`).toBe(
        true,
      );
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, `${entry.screen} 没有打开宿主 ⇒ 那一屏读到的是空的`).toContain('openTaskHost()');
      expect(
        code,
        `${entry.screen} 没有接 onBack ⇒ 进去了出不来（本壳没有导航库，返回只靠这一条线）`,
      ).toContain('onBack');
      // 🔴 AGENTS §3.5：外壳不许自己拼 op。屏里出现 entityType: 就是那条红线。
      expect(
        code,
        `${entry.screen} 里出现了 'entityType:' —— 构造 op 是 app-host 的事，不是壳的`,
      ).not.toMatch(/\bentityType\s*:/);
    }
  });
});

describe('倒数日这一屏：两端消费的是同一批词条', () => {
  /**
   * 🔴 判的是"两端各写一份 labels 时会不会分叉"，不是"有没有登记这些键"。
   *
   * 后者由类型兜着（`MessageKey` 是词条表的 `keyof`，写了没登记的键**编译不过**）。
   * 前者**没有任何一层在守**：web 把 `ageText` 换成一条新登记的键、移动端不换，
   * 两端就变成"同一张卡两种措辞"，而两边的测试各自都绿 ——
   * §2.7 那条"逾期只换措辞、不许有审判感"恰恰是措辞层面的红线，
   * 分叉一次就等于一端把它违反了。
   *
   * 变异臂（2026-10-04 实测会红）：把移动端 `lib/countdown-display.ts` 的
   * `web.countdown.since` 改成 `web.countdown.face.today` ⇒ 本条红，
   * 而 typecheck / 两端各自的测试全绿。
   */
  it('移动端 labels 构造器与 web 的 `eventBoardLabels` 取到**同一组** `web.countdown.*` 键', () => {
    const countKeys = (source: string): string[] =>
      [...source.matchAll(/'(web\.countdown\.[a-z0-9.]+)'/g)].map((m) => m[1] as string);

    const mobile = [...new Set(countKeys(codeOf('lib/countdown-display.ts')))].sort();
    const web = [...new Set(countKeys(codeOfPath(WEB_COUNTDOWN_VIEW)))].sort();

    expect(mobile.length, '一个 `web.countdown.*` 都没抓到 —— 抽取规则已经失效').toBeGreaterThan(0);
    expect(web.length, '同上，web 那侧').toBeGreaterThan(0);
    // 逐项相等（不是"子集"）：一端多一条 = 那一端在消费另一端不认的措辞。
    expect(mobile, '两端消费的倒数日词条分叉了').toEqual(web);
  });
});
