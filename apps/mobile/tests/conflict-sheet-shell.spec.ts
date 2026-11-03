/**
 * `ConflictSheet` 的外壳形状（迁移到共享原语之后）
 * ==============================================
 *
 * 🔴 **为什么是源码级判据而不是渲染快照**：本壳没有 RN 组件测试栈
 * （没有 `@testing-library/react-native`，为一个判据引新依赖要过 AGENTS §3.1–3.2 两道门）。
 * 同目录的 `privacy-consent-gate.spec.ts`、`task-detail-keyboard-back.spec.ts`
 * 走的是同一条路：**外壳是写在 JSX 里的事实**，读源码就能钉住它被删掉/改回去，
 * 而"被改回自绘 `Modal`"正是这枚面板最可能发生的退化 —— 迁移前它就是那个形状
 * （`sheet-detents.ts` 文件头记的「名字叫 Sheet，几何上是居中弹窗」）。
 *
 * ## 这里钉的是哪些格
 *
 * 1. **外壳只有共享原语一个出口**：`Modal` 不许再被直接 import，遮罩 / 卡片 /
 *    圆角 / 阴影不许在本文件里再算一份（那四条 StyleSheet 就是"两份画法"）。
 * 2. **关闭通道只有一条**：背景 / × / 返回键共用 `onClose`，且**不给** `onBack` ——
 *    不传时原语按定义与 `onDismiss` 同义，这正好等于迁移前的 `onRequestClose={onClose}`。
 *    给了 `onBack` 反而是一次行为变更（Android 第一次返回只做别的事）。
 * 3. **类别是 `bottom-sheet`**：它不是意思表示层（不记录任何表态），
 *    随手关无代价（关掉不清冲突状态）。判错的代价见文件头那节 ——
 *    `modal-deferrable` / `modal-forced-read` 都会把"点背景不许关"写回来，
 *    而 `modal-forced-read` 还会连返回键一起 deny，把用户锁在面板里。
 * 4. **档位单档 `large`**：0.9 与迁移前那句 `maxHeight:'90%'` 是同一格；
 *    出现 `'90%'` 字面量说明有人又把几何搬回了宿主。
 * 5. **两处有意的端差异与"不 await 就报已解决"的纪律**（与 web 同一份共享视图）。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('../src/screens/ConflictSheet.tsx', import.meta.url), 'utf8');
/** 去掉块注释与行注释 —— 注释里写一句 `Modal` 不该让判据绿。 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

describe('ConflictSheet 的外壳走共享浮层原语', () => {
  it('🔴 不再自绘 `Modal`，改用 `BottomSheet`', () => {
    expect(CODE, '又 import 了 RN 的 Modal —— 外壳会退回"居中弹窗"那一格').not.toMatch(
      /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*'react-native'/,
    );
    expect(CODE, '没有走共享原语 BottomSheet').toContain('<BottomSheet');
    expect(CODE).toMatch(/from '@heyta\/ui'/);
  });

  it('🔴 类别是 `bottom-sheet`，不是 deferrable / forced-read', () => {
    expect(CODE, '没有显式声明类别（默认值会跟着原语漂，判据要盯的就是这一行）').toContain(
      'overlay="bottom-sheet"',
    );
    expect(CODE, '判成意思表示层或强制阅读 = 点背景那一格从"能关"变回"不能关"').not.toMatch(
      /overlay="modal-(deferrable|forced-read|dirty-form)"/,
    );
    // 几何三件套必须交回原语：本文件不许再算一份居中/封顶。
    expect(CODE, '宿主又写了一次居中几何').not.toMatch(/justifyContent:\s*'center'/);
    expect(CODE, '宿主又写了一次 maxHeight 封顶').not.toMatch(/maxHeight/);
  });

  it('🔴 三条随手关的通道共用这一个出口（返回键不许被另接一件事）', () => {
    expect(CODE, '关闭出口没接到宿主的 onClose').toContain('onDismiss={onClose}');
    // `onBack` 缺省 ⇒ 原语把它等同于 `onDismiss`（迁移前的 `onRequestClose={onClose}`）。
    expect(CODE, '给了 onBack = Android 返回键与关闭不再是同一件事').not.toMatch(/onBack=/);
    expect(CODE, '自绘外壳回来了（onRequestClose 只属于裸 Modal）').not.toMatch(
      /onRequestClose=\{/,
    );
    // `ask-discard` 那一格在原语里是"不给回调就关不掉"；本类不该出现这条通道。
    expect(CODE, 'bottom-sheet 没有 ask-discard 这一格，给了就是多一个裁决者').not.toMatch(
      /onDismissAttempt=/,
    );
  });

  it('🔴 档位：单档 large（与迁移前 maxHeight:90% 同一格）', () => {
    expect(CODE, '档位集合变了 —— 多档需要先入库 expand/collapse 两枚词条').toContain(
      "detents={['large']}",
    );
  });

  it('🔴 标题仍然走单复数兄弟词条，两支都带 count', () => {
    // 词条表没有 ICU：漏传 count 用户会直接看到"{count}"这个洞（中文两支逐字相同）。
    expect(CODE).toContain("t('mobile.conflict.titleOne', { count: conflicts.length })");
    expect(CODE).toContain("t('mobile.conflict.title', { count: conflicts.length })");
    expect(CODE).toContain("t('mobile.conflict.close')");
  });

  it('⚠️ 共享视图的两处端差异与"不 await 就报已解决"的纪律没被顺手改掉', () => {
    // 手机横向只有 411dp 左右，一处长备注会把界面撑成竖线。
    expect(CODE).toContain('summaryLines={3}');
    // 🔴 传的是原始 `ConflictInfo`：`resolveConflictNow` 要用 local.opId 回 op-log 取那条 op。
    expect(CODE).toMatch(/void resolveConflictNow\(conflict, choice\)/);
    expect(CODE, '界面不许自己宣布"已解决"，下一帧跟 status 走').not.toMatch(
      /await resolveConflictNow/,
    );
  });
});
