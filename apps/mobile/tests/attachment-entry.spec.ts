/**
 * 详情面板上的附件入口（工单 #9，移动端那一米）
 * =============================================
 *
 * 这里钉的四件事，全都是"看起来正常、其实说谎"的那一类：
 *
 *   1. 🔴 **过滤与顺序不许写在界面里。** 写在 `TaskDetailSheet` 里的
 *      `attachments.filter(…)` 与领域层那份迟早分叉，症状是"电脑上删掉的附件
 *      在手机上还在"，而 op-log 里两条记录都对。
 *   2. 🔴 **服务端地址与令牌必须按调用时刻读。** 快照式传值的后果是
 *      "换了服务端还在往旧地址传"和"重新登录后一路 401"，两种都表现为"附件坏了"。
 *   3. ⚠️ **这台设备没通道 ≠ 这个文件坏了。** iOS 侧目前没有读字节的原生模块，
 *      那句话必须单独说；折叠成"读失败"会推着用户去换文件，而换什么都会一样。
 *   4. 🔴 **移除必须二次确认，而且不能假装能撤销。** 这条通道上没有读端点，
 *      字节还给服务端之后就回不来了 —— 给不出撤销就只能把摩擦挪到动作前面。
 *
 * ⚠️ vitest 不做类型检查（AGENTS §3.5）：词条是否存在由 `tsc` 与 i18n 目录测试守，
 * 这个文件守的是**结构**（谁调用谁、判据住在哪一层）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const screen = readFileSync(resolve(__dirname, '../src/screens/TaskDetailSheet.tsx'), 'utf8');
const tasksScreen = readFileSync(resolve(__dirname, '../src/screens/TasksScreen.tsx'), 'utf8');
const picker = readFileSync(resolve(__dirname, '../src/lib/attachment-pick.ts'), 'utf8');

/** 附件那一块（从结构锚到错误行的 testID 之后）的源码。 */
const attachmentBlock = (): string => {
  const start = screen.indexOf('── 附件（工单 #9）');
  // +40：锚点本身就是块的最后一个 testID，`indexOf` 停在它**开头**，
  // 不补这段长度的话断言永远看不到自己找的那串字。
  const end = screen.indexOf('task-detail-attachment-error') + 40;
  expect(start, '详情面板里找不到附件那一块的结构锚').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return screen.slice(start, end);
};

/**
 * 移除那一段处理函数。
 *
 * ⚠️ 结尾必须用 `lastIndexOf`：`if (task === undefined) return null;` 这一句
 * 在文件里**先出现在注释里**（那段讲 hook 顺序的注释），从第一次出现的位置切
 * 会切出一个空串 —— 空串上的断言全绿，正是"不能失败的判据"那一类。
 */
const removeHandler = (): string => {
  const start = screen.indexOf('const runRemoveAttachment');
  const end = screen.lastIndexOf('if (task === undefined) return null;');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return screen.slice(start, end);
};

describe('宿主接线', () => {
  it(' TasksScreen 拼的是真端口，并把动作集传进面板', () => {
    expect(tasksScreen).toMatch(/createAttachmentBlobPort\(/u);
    expect(tasksScreen).toMatch(/createAttachmentActions\(/u);
    expect(tasksScreen).toMatch(/attachmentActions=\{attachmentActions\}/u);
  });

  it('🔴 服务端地址与令牌都是**按调用时刻**读的', () => {
    // getter + 回调。写成 `readSyncConfig()` 一次取值传进去，就是那两个静默故障：
    // 换服务端后仍往旧地址传、重新登录后一路 401。
    expect(tasksScreen).toMatch(/get baseUrl\(\): string \{/u);
    expect(tasksScreen).toMatch(/\(\) => readSyncConfig\(\)\?\.token/u);
  });

  it('🔴 界面不自己过滤附件，读的是动作层那一个出口', () => {
    expect(attachmentBlock()).toMatch(/attachmentActions\?\.\.?attachmentsForTask|attachmentRows/u);
    expect(screen).not.toMatch(/attachments\.filter\(/u);
    expect(screen).not.toMatch(/Object\.values\([^)]*attachments[^)]*\)\.filter/u);
  });
});

describe('入口与回执', () => {
  it('「添加附件」「移除」「错误」三个出口都带着可寻址的 testID', () => {
    expect(attachmentBlock()).toMatch(/testID="task-detail-add-attachment"/u);
    expect(attachmentBlock()).toMatch(/testID=\{`task-detail-attachment-remove-\$\{item\.id\}`\}/u);
    expect(attachmentBlock()).toMatch(/testID="task-detail-attachment-error"/u);
  });

  it('🔴 移除是二次确认：第一次点只翻文案，不发消息', () => {
    const handlers = removeHandler();
    expect(handlers).toMatch(/if \(pendingRemoveId !== attachmentId\)/u);
    expect(handlers).toMatch(/setPendingRemoveId\(attachmentId\)/u);
    // 确认窗口会超时退回（不然按钮永远停在"再点一次"）。
    expect(handlers).toMatch(/setTimeout\(\(\) => \{\n\s+setPendingRemoveId\(null\);/u);
  });

  it('🔴 没有把"移除"说成可以撤销', () => {
    // 这条通道上没有读端点，字节还得去就回不来 —— 说"已移除，可撤销"是不实陈述。
    expect(screen).not.toMatch(/撤销[^]{0,20}附件/u);
    expect(screen).not.toMatch(/undoAttachment|restoreAttachment/u);
  });

  it('上传进行中禁用入口，连点两下不会传两份', () => {
    const block = attachmentBlock();
    expect(block).toMatch(/disabled=\{attachmentBusy\}/u);
    expect(screen).toMatch(/attachmentBusy\) return/u);
  });
});

describe('这台设备没通道时说的是哪句话', () => {
  it('`no-channel` 与 `read-failed` 是两个码、两句不同的话', () => {
    expect(picker).toMatch(/'no-channel'/u);
    expect(picker).toMatch(/'read-failed'/u);
    const keys = screen.slice(screen.indexOf('const PICK_ERROR_KEYS'), screen.indexOf('const UPLOAD_ERROR_KEYS'));
    expect(keys).toMatch(/'no-channel': 'mobile\.detail\.attachments\.error\.no-channel'/u);
    expect(keys).toMatch(/'read-failed': 'mobile\.detail\.attachments\.error\.read-failed'/u);
    expect(keys).not.toMatch(/'no-channel': 'mobile\.detail\.attachments\.error\.read-failed'/u);
  });

  it('取消不是错误：`OPERATION_CANCELED` 走静默分支，不进错误文案', () => {
    expect(screen).toMatch(/OPERATION_CANCELED'\) return;/u);
  });

  it('认不出的 reason 落回那句统称，而不是猜一条最像的', () => {
    expect(screen).toMatch(/UPLOAD_ERROR_KEYS\[[^\]]+\] \?\? UPLOAD_FALLBACK_KEY/u);
  });
});
