/**
 * 移动端日历的**档位入口**在位吗（R11 批三·补）
 * =============================================
 *
 * 产品负责人 2026-10-02 挑的差异化里，「日历要有月/周/日」是共享板那一侧先做完的，
 * 而入口只有 Web 有（页头一个 `<select>`）。`apps/mobile` 连 `view` 都不传 ⇒
 * 手机上永远只有月档 —— 于是"周视图/日视图已交付"这句话在移动端只兑现了一半。
 * 这条洞登记在 `docs/plans/ui-review-fill-zh-timeline.md` §9.4「批三·补」。
 *
 * ## 🔴 这一类判据证明什么、不证明什么
 *
 * 本仓的移动端测试通道**没有** React 渲染器（`apps/mobile` 的 devDependencies 里
 * 没有 `react-test-renderer` / `@testing-library/react-native`，加它要先过
 * AGENTS §3.1 可维护性与 §3.2 许可证两道门并逐项登记）。所以这里走的是
 * **源码形状**判据（同 `auth-screen-password.spec.ts` 的 `codeOf` 一条路）：
 *
 * · 它证明"接线在位、规则没在本地重写一份、选项表里没有还不存在的档位"；
 * · 它**不**证明"手机上点一下真的换了板"。那一半由三处补：
 *   共享组件本体的渲染判据在 `apps/web/tests/calendar-view-tabs.spec.tsx`，
 *   游标/选中的耦合在 `packages/ui/tests/calendar-view-step.spec.ts`，
 *   而**真机取证仍未做** —— `pnpm -r build` 正红在另一条会话在飞的
 *   `packages/op-log`（APK 打不出来），不许拿 jsdom 的图冒充移动端证据（§6.2 规定一）。
 *
 * ⚠️ 判据一律跑在**剥掉注释**的源码上：这些文件里写满了"不许再抄一份 `startOfMonth`"
 *   之类的话，连着注释一起扫会让判据自己误报（也会诱使人把判据改成匹配注释）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREEN = resolve(HERE, '../src/screens/CalendarScreen.tsx');
const BOARD = resolve(HERE, '../../../packages/ui/src/calendar/CalendarBoard.tsx');
const LOCALES = resolve(HERE, '../../../packages/i18n/src/locales');

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

const screen = codeOf(SCREEN);
const board = codeOf(BOARD);

describe('移动端日历的档位入口', () => {
  it('🔴 选中日清单消费与格子相同的跨日任务投影', () => {
    expect(board).toMatch(/const\s+dayTasks\s*=\s*calendarTasksByDate\.get\(selected\)/);
    expect(board).not.toMatch(/const\s+dayTasks\s*=\s*byDate\.get\(selected\)/);
  });

  it('🔴 把 `view` 真的传给了共享板（不传 = 板子永远按月档渲染，切换器点了也没反应）', () => {
    expect(screen).toMatch(/<CalendarBoard[\s\S]*?view=\{view\}/);
  });

  it('渲染了档位切换器，且它挂在**板子外面**（挂进板子里会打爆 Web 那两条按 role 数格子的判据）', () => {
    expect(screen).toContain('<CalendarViewTabs');
    const tabs = screen.indexOf('<CalendarViewTabs');
    const board = screen.indexOf('<CalendarBoard');
    expect(tabs, '找不到切换器').toBeGreaterThan(-1);
    expect(board, '找不到共享板').toBeGreaterThan(-1);
    expect(tabs, '切换器落在了 <CalendarBoard> 之后（应挂在外面、板子之前）').toBeLessThan(board);
  });

  it('🔴 可切的档位取自**共享那份顺序**，本地不许再长回一张表（R17）', () => {
    // 立场一个字没变：这一栏列的仍然只能是"真的能切过去的档"。
    // 变的是**由谁回答"有哪些档"** —— 原来是本文件一份 `VIEW_OPTIONS` 字面量、
    // web 页头一份 `{kind,key}[]`、再加上本文件下面那份 档位→键 的映射，共三处，
    // R13 加年档时三处都靠人记着改。现在三处合成 `@heyta/ui` 那一份，
    // "有哪些档 / 每档叫什么"的一致性判据住在 `packages/ui/tests/calendar-view-step.spec.ts`。
    //
    // ⚠️ 这里刻意**不 import** `@heyta/ui`：那条桶会 `from "react-native"`，
    //   在本包的 node 侧测试里会以 `RolldownError: Flow is not supported` 挂在收集阶段
    //   （台账 §5 第 9 行实测过）。所以这一条只钉接线形状，取值集合由上面那份共享判据守。
    expect(screen).toMatch(/options=\{CALENDAR_VIEW_ORDER\}/);
    expect(screen, '本地又长回一张 VIEW_OPTIONS ⇒ 档位清单重新变成两份').not.toMatch(
      /const VIEW_OPTIONS/,
    );
  });

  it('游标规则**不在本文件重写**：只许从 `@heyta/ui` 取那两个函数', () => {
    expect(screen).toContain('calendarCursorFor');
    expect(screen).toContain('calendarSelectedForCursor');
    // 本地那份的形状就是 `view === 'month' ? startOfMonth(...)`。
    // 它一旦回来，移动端与 Web 会在跨月那天各指一段（两端各自"看着对"）。
    expect(screen).not.toMatch(/view === 'month' \? startOfMonth/);
  });

  it('🔴 游标 handler 用**函数式**更新读选中（读闭包里的 `selected` 会拿到上一轮的值）', () => {
    // 共享板的 `pickDay` 连着调 `onSelect(date)` + `onCursorChange(date)`，
    // React 批处理这两个 setter ⇒ 读闭包就把刚点的那一天写回成旧的。
    // 症状是"月档点格子没选中、日档点了没反应" —— 不崩、不报错。
    expect(screen).toMatch(/setSelected\(\s*\(prev\)\s*=>\s*calendarSelectedForCursor\(/);
  });

  it('周/日两档的词取自 `common.calendar.*`（与 Web 同一份，不另抄一套）', () => {
    for (const key of ['dayAllDay', 'dayNoTimed', 'prevDay', 'nextDay', 'prevWeek', 'nextWeek']) {
      expect(screen, `移动端没给 ${key} ⇒ 那一档会缺这块文案`).toContain(
        `t('common.calendar.${key}')`,
      );
    }
    const zh = codeOf(join(LOCALES, 'zh-CN.ts'));
    // 反方向：不许出现"移动端自己那一份"的同名键（那才是漂移的起点）。
    for (const key of ['dayAllDay', 'dayNoTimed']) {
      expect(zh, `词条表里多了一份 mobile.calendar.${key}`).not.toContain(
        `'mobile.calendar.${key}'`,
      );
    }
  });
});

/**
 * 年档（R13）在移动端接好了吗
 * =============================
 *
 * 与上面同一类判据的形状：**只证接线在位、规则没在本地重写**，
 * 不证"手机上点得到"（那一半要真机取证，见文件头）。
 */
describe('移动端日历的年档接线（R13）', () => {
  it('🔴 月卡点击真的交给了共享板（不给的话板子会把月卡画成**不可点** —— 那是刻意的降级）', () => {
    expect(screen).toMatch(/<CalendarBoard[\s\S]*?onPickMonth=\{pickMonth\}/);
  });

  it('🔴 迁移规则**不在本文件重写**：点月卡要走 `calendarMonthDrill`', () => {
    // 症状：移动端自己写 `setView('month'); setCursor(startOfMonth(d))`，
    // Web 那边写另一套 —— 同一个动作在两端把游标放到不同的地方（AGENTS §3.5）。
    expect(screen).toContain('calendarMonthDrill');
    expect(screen).toMatch(/const\s+drill\s*=\s*calendarMonthDrill\(/);
    // 本地那份的形状就是直接 `setView('month')` 配一个自己算的游标。
    expect(screen).not.toMatch(/setView\('month'\);\s*setCursor\(\s*startOfMonth/);
  });

  it('年档要的四条文案都注入了（缺一条就会退回月份标题或空标签）', () => {
    for (const key of ['yearTitle', 'yearMonthTitle', 'prevYear', 'nextYear']) {
      expect(screen, `labels 里没有 ${key}`).toContain(`${key}:`);
    }
  });

  it('🔴 档位名取自共享那份 `CALENDAR_VIEW_LABEL_KEYS`，本地那份 档位→键 映射不许回来（R17）', () => {
    // 原来那三条嵌套三元：`kind === 'month' ? … : kind === 'week' ? … : t(day)`，
    // 年插进去若不改这里，年会**念成「日」**（类型合法、词条都在、看着正常）。
    // R17 把那层守卫搬进共享层的 `Record<CalendarViewKind, …>`：少一条**编译不过**，
    // 而 web 与移动端同时拿到这颗牙。这里钉的是"移动端确实从那份取"。
    expect(screen).toMatch(/CALENDAR_VIEW_LABEL_KEYS\s*\[\s*kind\s*\]/);
    expect(screen).not.toMatch(
      /kind === 'month'[\s\S]{0,200}\?: t\('common\.calendar\.view\.day'\)/,
    );
    // 旧的坏形状也不许以"映射表"的形式在宿主里长回来（那正是被消掉的那一份）。
    expect(screen, '宿主里又出现一份 档位→键 的字面量表').not.toMatch(
      /month:\s*'common\.calendar\.view\.month'/,
    );
  });

  /*
    ⚠️ 这条原来的标题写着「`check:ui-language` 只比键集」—— 22:1x 现量**否证**：
    把 en 的一条值抄成中文（V4），那条门禁自己 rc=1 并指名 `common.calendar.view.year = 年`；
    反方向把 zh 的值写成英文（V4b）同样 rc=1（「zh-CN 词条里没有汉字」）。
    ⇒ 这一条与它**重叠、没有独立维度**（缺键另有 i18n 的 `satisfies Record<MessageKey,…>`
      在类型层拦，台账 M10/B14 实测过 build rc=1）。
    留着的理由只有一条，且要说清：它钉的是"本批新增的那四条"，改档位的人在这里**先看到**，
    而不是等到全仓门禁跑完才发现。它守不住的那个维度在别处 ——
    🔴 代码引用的**键名在词条表里根本不存在**，门禁 rc=0（V4c 实测），那条腿在
    `apps/web/tests/calendar-view-tabs.spec.tsx` 与 `packages/ui/tests/calendar-view-step.spec.ts`。
  */
  it('中英两侧的**新键都齐**（第二层：与 `check:ui-language` 重叠，理由见上面那段）', () => {
    const zh = readFileSync(join(LOCALES, 'zh-CN.ts'), 'utf8');
    const en = readFileSync(join(LOCALES, 'en.ts'), 'utf8');
    for (const key of [
      'common.date.yearTitle',
      'common.calendar.view.year',
      'common.calendar.prevYear',
      'common.calendar.nextYear',
    ]) {
      expect(zh, `zh-CN 缺 ${key}`).toContain(`'${key}'`);
      expect(en, `en 缺 ${key}`).toContain(`'${key}'`);
    }
    // 反向：不许给移动端另抄一套 `mobile.calendar.year*`（那就是同一句话的两个来源）。
    for (const dup of ['mobile.calendar.yearTitle', 'mobile.calendar.view.year']) {
      expect(screen, `移动端另抄了一份：${dup}`).not.toContain(dup);
    }
  });
});
