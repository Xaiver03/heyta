/**
 * 移动端行操作（长按菜单 + 左滑露出 + 删除入口归位）—— **源码级**判据
 * =====================================================================
 *
 * ## 为什么又是源码级（而不是渲染测试）
 *
 * `apps/mobile` 没有组件测试栈（本仓刻意不引 `@testing-library/*`，理由见
 * `packages/ui/vitest.config.ts` 文件头与 `apps/mobile/tests/subtask-entry.spec.ts`），
 * 而这一批要防的失效**恰好全是"接线"与"分叉"**，不是"逻辑算错"：
 *
 *   - 手势改派之后"进入多选"这条路**被丢掉**（不是报错，是少一项功能）；
 *   - 左滑做成"松手即删"（§9.3 明令不做）；
 *   - 危险档在界面里手填一个布尔，于是菜单问了一句、滑出的那枚直接删；
 *   - 行尾那枚常驻删除又长回来（三个删除入口并排 = §3.1 要打的那个形状）。
 *
 * 这四种都不会让任何行为测试变红，只能查源码。形状照 `subtask-entry.spec.ts`。
 * 真机渲染那一路归 `scripts/verify-mobile-task-row.sh` 与设备级验收（本单没跑）。
 *
 * ## 判据出处
 *
 * `docs/plans/row-actions-redesign.md` §3.2 / §3.3 / §3.4 / §9.1，
 * 以及 `docs/adr/0083-task-abandonment-fifth-state-and-share-boundary.md` §3.1 / §3.2。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCREEN = 'apps/mobile/src/screens/TasksScreen.tsx';
const MENU = 'packages/ui/src/overlay/RowActionMenu.tsx';
const SWIPE = 'packages/ui/src/task-list/SwipeReveal.tsx';
const ROW = 'packages/ui/src/task-list/TaskRow.tsx';
const VOCAB = 'packages/ui/src/task-list/row-actions.ts';

const src = (file: string): string => readFileSync(join(REPO, file), 'utf8');

/** 取一段：从左边界那次出现开始，到下一个 `  const ` 声明之前（回调的整块身体）。 */
function region(text: string, leftAnchor: string): string {
  const start = text.indexOf(leftAnchor);
  expect(start, `找不到 ${leftAnchor} ⇒ 这条判据会在测空气`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + leftAnchor.length);
  const next = rest.search(/\n {2}const |\n {2}\/\*\*/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('手势改派：长按 = 上下文菜单，批量态恢复成勾选', () => {
  it('🔴 两处（列表 / 四象限）都不再把长按直接交给 `enterBulkSelection`', () => {
    const text = src(SCREEN);
    expect(text, '长按还挂在"进入多选"上 ⇒ 上下文菜单没接上').not.toMatch(
      /onLongPressTask=\{enterBulkSelection\}/,
    );
    const reassigned = text.match(/onLongPressTask=\{bulkSelecting \? toggleBulkSelection : openRowMenu\}/g) ?? [];
    expect(reassigned, '长按改派只出现在一处 ⇒ 另一档的长按还是旧手势').toHaveLength(2);
  });

  it('🔴 「进入批量选择」没被丢掉：它是菜单里的一项，并且真的调 `enterBulkSelection`', () => {
    const actions = region(src(SCREEN), 'const rowMenuActions = useCallback(');
    for (const id of ["'open'", "'pin'", "'unpin'", "'abandon'", "'unabandon'", "'select'", "'delete'"]) {
      expect(actions, `菜单里少了 ${id} 这一项`).toContain(id);
    }
    const handler = region(src(SCREEN), 'const handleRowAction = useCallback(');
    expect(handler, '菜单的「多选」没有真的进入批量态 ⇒ 效率路径丢了').toMatch(
      /case 'select':[\s\S]*?enterBulkSelection\(id\)/,
    );
  });

  it('🔴 点行 = 打开详情（不变），且菜单的 `open` 与它是同一个目的地', () => {
    const text = src(SCREEN);
    const handler = region(text, 'const handleRowAction = useCallback(');
    expect(handler).toMatch(/case 'open':[\s\S]*?pushTaskRoute\(\)[\s\S]*?selection\.select\('task', id\)/);
    expect(text).toMatch(/onOpenTask=\{handleTaskOpen\}/);
  });
});

describe('删除入口归位：行尾不常驻（§3.2）', () => {
  it('🔴 列表那一档不再传 `renderTrailing`，改成 `swipeActions`', () => {
    const text = src(SCREEN);
    expect(text, '行尾还常驻着一枚回调 ⇒ §3.2 的结论没落地').not.toMatch(
      /renderTrailing=\{bulkSelecting \? undefined : renderTaskTrailing\}/,
    );
    expect(text).toMatch(/swipeActions=\{bulkSelecting \? undefined : renderTaskTrailingActions\}/);
  });

  it('🔴 `IconButton` 的删除字形全仓只剩批量工具栏那一枚（读数钉死，多一枚即红）', () => {
    const text = src(SCREEN);
    const deleteIconButtons = text.match(/icon="task\.delete"/g) ?? [];
    expect(
      deleteIconButtons.length,
      `行尾那枚常驻删除回来了（现量 ${deleteIconButtons.length} 枚，只该有批量工具栏那 1 枚）`,
    ).toBe(1);
    expect(region(text, 'const renderQuadrantTrailing = useCallback('), '四象限的行尾又长出删除').not.toContain(
      'task.delete',
    );
  });

  it('🔴 单条删除也给撤销回执，且不自定窗口时长（`check:undo-receipt` R1 的形状）', () => {
    const handler = region(src(SCREEN), 'const handleRowAction = useCallback(');
    expect(handler).toMatch(/case 'delete':[\s\S]*?actions\.remove\(id\)[\s\S]*?setBulkUndoIds\(\[id\]\)/);
    expect(src(SCREEN), '出现了自己写的毫秒数 ⇒ 时长归各页管了').not.toMatch(
      /setTimeout\([^)]*setBulkUndoIds[^)]*,\s*\d+\)/,
    );
  });
});

describe('危险档：两个落点问同一枚判定（§3.3）', () => {
  it('🔴 判定只在 `@heyta/domain` 那一处：菜单与左滑都问它，界面不手填布尔', () => {
    const vocab = src(VOCAB);
    expect(vocab).toContain('resolveDangerTier');
    expect(vocab, '撤销性手填了布尔 ⇒ 迟早和动作层分家').toContain("isUndoableDeletion('task')");
    expect(vocab).toMatch(/export function deleteTierForTask\(/);
    expect(vocab).toMatch(/export function deleteNeedsConfirm\(/);

    // 两个落点都不许自己写"要不要弹"。
    for (const file of [MENU, SWIPE]) {
      const text = src(file);
      expect(text, `${file} 自己判了档位 ⇒ 出现了第二份裁决`).not.toMatch(/childCount\s*>\s*0/);
      expect(text).not.toMatch(/undoAvailable\s*:\s*(true|false)/);
    }
    // 宿主交的是**事实**（子任务数）与文案，不是结论。
    const screen = src(SCREEN);
    expect(screen).toMatch(/childCount=\{childCountByTaskId\.get\(rowMenuTask\.id\)/);
    expect(screen, '移动端自己弹了原生确认框 ⇒ 绕过了档位').not.toMatch(/Alert\.alert\(/);
  });

  it('🔴 `popconfirm` 那一档：第一下只改口 + 说事实，第二下才执行；且能取消', () => {
    const menu = src(MENU);
    expect(menu).toMatch(/const \[confirming, setConfirming\] = useState\(false\)/);
    expect(menu).toMatch(/if \(isDangerousRowAction\(item\.id\) && needsConfirm && !confirming\)/);
    expect(menu, '没有那一句后果 ⇒ 二次确认退化成"连点两下"').toMatch(/data-testid|testID=\{`\$\{testID\}-consequence`\}/);
    expect(menu).toMatch(/setConfirming\(false\)/);
    // 危险项在分隔线**之后**（与 web 的 P2 同一条）。
    const safeFirst = menu.indexOf('safe.map');
    const separator = menu.indexOf('testID={`${testID}-separator`}');
    const dangerLast = menu.indexOf('danger.map');
    expect(safeFirst, '菜单没有安全组').toBeGreaterThanOrEqual(0);
    expect(separator, '菜单没有分隔线').toBeGreaterThan(safeFirst);
    expect(dangerLast, '危险项不在分隔线之后').toBeGreaterThan(separator);
  });

  it('🔴 后果句用的是真事实的词条（子任务被提到顶层那条），不是"确定要删除吗"', () => {
    const screen = src(SCREEN);
    expect(screen).toContain("t('web.rowMenu.childConsequence'");
    expect(screen).toContain("t('web.rowMenu.confirmDelete'");
  });
});

describe('左滑：露出动作、点击执行（不做全滑直删，§9.3）', () => {
  it('🔴 松手那一支里没有任何执行：手势只决定"开还是关"', () => {
    const swipe = src(SWIPE);
    const release = swipe.slice(swipe.indexOf('onPanResponderRelease'));
    const body = release.slice(0, release.indexOf('onPanResponderTerminate'));
    expect(body, '松手就执行 ⇒ 做成了全滑直删（§9.3 明令不做）').not.toContain('onAction(');
    expect(swipe).toMatch(/setOpen\(true\)/);
    expect(swipe).toMatch(/animateTo\(-width\)/);
  });

  it('🔴 执行只来自那枚按钮自己的 `onPress`', () => {
    const swipe = src(SWIPE);
    expect(swipe).toMatch(/onPress=\{\(\) => \{[\s\S]*?onAction\(action\.id\)/);
  });

  it('🔴 与纵向滚动的方向分家：四道闸都在（少一道就是"跟滚动打架"）', () => {
    const swipe = src(SWIPE);
    // ① 按下不抢（否则没有点击、读屏也没法用）
    expect(swipe).toMatch(/onStartShouldSetPanResponder:\s*\(\) => false/);
    // ② 横向必须压过纵向
    expect(swipe).toMatch(/Math\.abs\(gesture\.dx\) > Math\.abs\(gesture\.dy\)/);
    // ③ 阈值走 token，不写字面量
    expect(swipe, '方向阈值写成了字面量 ⇒ 第二份手势判据').toMatch(/gesture\.hysteresis/);
    // ④ 拖到一半不被列表收回
    expect(swipe).toMatch(/onPanResponderTerminationRequest: \(\) => false/);
    expect(swipe).toMatch(/onShouldBlockNativeResponder: \(\) => true/);
  });

  it('🔴 滑出的宽度与时长都来自 token（没有裸 px / ms）', () => {
    const swipe = src(SWIPE);
    expect(swipe).toMatch(/tokens\['size\.swipe-action'\]/);
    expect(swipe).toMatch(/duration: tokens\['duration\.fast'\]/);
    expect(swipe, '出现了裸的动画毫秒数').not.toMatch(/duration:\s*\d{2,}/);
  });

  it('🔴 同一时刻只允许一行是滑开的，且卸载会交还（不留一个收不了的行）', () => {
    const swipe = src(SWIPE);
    expect(swipe).toMatch(/function closeOtherRows\(/);
    expect(swipe).toMatch(/claimOpenRow\(subjectId, \(\) => closeNowRef\.current\(\)\)/);
    expect(swipe).toMatch(/return \(\) => releaseOpenRow\(subjectId\)/);
  });

  it('🔴 行本身仍只有一份实现：滑动外壳不重画勾选框/标题/截止', () => {
    const swipe = src(SWIPE);
    expect(swipe, '滑动外壳里出现了标题槽 ⇒ 出现了第二份行').not.toMatch(/row\.title|accessibilityRole="checkbox"/);
    expect(swipe).toMatch(/\{children\}/);
    // `TaskRow` 只是把那一行交给外壳，几何差异仍走 `DENSITY_SPEC`。
    const row = src(ROW);
    expect(row).toMatch(/const rowNode = \(/);
    expect(row).toMatch(/\{rowNode\}/);
    expect(row, '滑动的开关写成了 density 分支 ⇒ 密度差异散落了').not.toMatch(/density === '/);
  });
});

describe('共享层边界：不 import i18n、不碰数据', () => {
  for (const file of [MENU, SWIPE, VOCAB, ROW]) {
    it(`${file} 里没有对 \`@heyta/i18n\` 的**真实 import**`, () => {
      // 🔴 断的是**语句**，不是"文件里出现过这个字符串" —— 这几个文件的文件头
      // 都在**讲**这条边界（"本包不 import i18n"），按字符串断言会判出假红。
      expect(src(file), '共享层 import 了 i18n ⇒ 四个端会中招').not.toMatch(/from '@heyta\/i18n'/);
    });
  }

  it('移动端菜单项的文案全部走词条（界面里不硬编码中文）', () => {
    const screen = src(SCREEN);
    expect(screen, '菜单项文案写死了中文 ⇒ 违反 `packages/i18n` 唯一事实源').not.toMatch(
      /label:\s*'[^']*[\u4e00-\u9fff]/,
    );
    expect(screen).toMatch(/closeLabel: t\('mobile\.tasks\.swipe\.close'\)/);
  });

  it('批量选择态里不挂横向手势（勾选优先于滑动）', () => {
    expect(src(SCREEN)).toMatch(/swipeActions=\{bulkSelecting \? undefined : renderTaskTrailingActions\}/);
  });
});

describe('词条齐备（缺一条即红 —— 这些键必须先入库）', () => {
  const KEYS = [
    'web.rowMenu.pin',
    'web.rowMenu.unpin',
    'web.rowMenu.abandon',
    'web.rowMenu.unabandon',
    'web.rowMenu.select',
    'mobile.tasks.swipe.close',
  ];

  const zh = readFileSync(join(REPO, 'packages/i18n/src/locales/zh-CN.ts'), 'utf8');
  const en = readFileSync(join(REPO, 'packages/i18n/src/locales/en.ts'), 'utf8');

  for (const key of KEYS) {
    it(`「${key}」在中英两边都在，且 zh 含汉字 / en 不含汉字`, () => {
      const zhLine = new RegExp(`'${key}':\\s*'([^']*)'`).exec(zh)?.[1] ?? '';
      const enLine = new RegExp(`'${key}':\\s*'([^']*)'`).exec(en)?.[1] ?? '';
      expect(zhLine, `${key} 在 zh 里缺失`).not.toBe('');
      expect(enLine, `${key} 在 en 里缺失`).not.toBe('');
      expect(/[\u4e00-\u9fff]/.test(zhLine), `${key} 的 zh 值不含汉字`).toBe(true);
      expect(/[\u4e00-\u9fff]/.test(enLine), `${key} 的 en 值含汉字`).toBe(false);
    });
  }

  it('「长按 = 多选」那句手势提示已经改口（手势改派之后它不能再教错手势）', () => {
    const hint = new RegExp("'mobile\\.tasks\\.gestureHint':\\s*'([^']*)'").exec(zh)?.[1] ?? '';
    expect(hint, '词条读不到了').not.toBe('');
    expect(hint, '还在教"长按 = 多选" ⇒ 与改派后的手势相反').not.toMatch(/长按任务可多选/);
  });
});
