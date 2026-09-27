/**
 * `verify-universal-slice.sh` 的浏览器步骤
 * ========================================
 *
 *   node scripts/verify-universal-slice.browser.mjs <url>
 *
 * 构建通过只说明"能打包"，**不说明"能渲染"**。这个脚本真的开一个 Chromium
 * 去把 `?slice=1` 打开，然后断言四件在"能渲染"里才成立的事。
 *
 * ## 🔴 为什么断言的是这些，而不是"页面没报错"
 *
 * 四条断言各自对应一种**只会静默出错**的失败方式：
 *
 * | 断言 | 它挡住的失败 |
 * |---|---|
 * | 行的**顺序** | 排序逻辑在 RNW 上没生效 —— 页面照样画出来，只是顺序是错的 |
 * | 空标题渲染成兜底文案 | `model.ts` 的兜底在渲染层被绕过 |
 * | 已完成行有勾 | `completedAt` 的存在性判断断了（`0` 会被真值判断吃掉） |
 * | **点击后该行换位置** | `Pressable` 在 RNW 上不可交互 / 状态没回流 |
 *
 * 最后一条尤其重要：它一次同时证明**可交互 + 状态更新 + 重排序**，
 * 而**静态截图永远证明不了**这件事。
 *
 * ## 为什么要用 `createRequire` 手动找 playwright
 *
 * 本仓库的 Playwright 在**独立工作区** `e2e/` 里（它有自己的
 * `pnpm-workspace.yaml` 与 store）。Node 的裸模块解析是**相对脚本文件**
 * 而不是 cwd 的，所以从 `scripts/` 里直接 `import '@playwright/test'` 会失败。
 * 这里显式从 `e2e/` 的位置去 require，并在找不到时给出**可执行的**提示。
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const E2E = join(ROOT, 'e2e');

const url = process.argv[2];
if (!url) {
  console.error('用法：node scripts/verify-universal-slice.browser.mjs <url>');
  process.exit(2);
}

if (!existsSync(join(E2E, 'node_modules'))) {
  console.error(
    `🔴 找不到 ${E2E}/node_modules。\n` +
      '   e2e/ 是**独立工作区**，根目录的 pnpm install 不会装它。请先跑：\n' +
      '     pnpm -C e2e install',
  );
  process.exit(2);
}

// 显式从 e2e/ 的位置解析 —— 见文件头注释。
const e2eRequire = createRequire(join(E2E, 'package.json'));
let chromium;
try {
  ({ chromium } = e2eRequire('@playwright/test'));
} catch (error) {
  console.error(
    `🔴 无法从 e2e/ 解析 @playwright/test：${String(error)}\n` +
      '   请先跑：pnpm -C e2e install',
  );
  process.exit(2);
}

const failures = [];
const pass = (label, detail) => console.log(`       ✓ ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail) => {
  failures.push(label);
  console.log(`       ✗ ${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage();

  // 收集页面错误。**注意**：这里只是收集，不把它当成主要判据 ——
  // "无报错"是最弱的一种通过，真正要看的在下面。
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
  });

  await page.goto(url, { waitUntil: 'networkidle' });

  const rows = page.locator('[data-testid^="task-row-"]');
  const count = await rows.count();
  if (count === 4) {
    pass('渲染出行数', `${count} 行`);
  } else {
    fail('渲染出行数', `期望 4，实际 ${count}`);
  }

  const texts = [];
  for (let i = 0; i < count; i++) texts.push((await rows.nth(i).innerText()).trim());
  console.log(`       行内容：${JSON.stringify(texts)}`);

  // 断言 1：排序 —— 未完成在前、按截止升序、空标题那条在已完成之前。
  if (texts[0]?.startsWith('写 M1 切片验证') && texts[1]?.startsWith('核对鸿蒙')) {
    pass('排序（截止时间升序，未完成在前）');
  } else {
    fail('排序', `前两行是 ${JSON.stringify(texts.slice(0, 2))}`);
  }

  // 断言 2：空标题走了兜底文案，而不是渲染出一片空白。
  if (texts.some((t) => t.includes('（无标题）'))) {
    pass('空标题兜底');
  } else {
    fail('空标题兜底', '没有任何一行渲染出「（无标题）」');
  }

  // 断言 3：已完成的行在最后，且**它的勾选框**带勾。
  //
  // ⚠️ 勾断言的是 `task-toggle-*` 而**不是** `task-row-*`。
  // 组件把"勾选框"和"行体"拆成了两个元素（各自有正确的无障碍语义：
  // 前者是 checkbox，后者是 button），所以勾在 toggle 里面，
  // 不在 row 里面。第一版断言写在 row 上，于是**组件被重构后测试假红** ——
  // 断言必须指向它真正要验的那个元素。
  const toggles = page.locator('[data-testid^="task-toggle-"]');
  if (texts[texts.length - 1]?.includes('已完成的示例')) {
    pass('已完成沉底');
  } else {
    fail('已完成沉底', `最后一行是 ${JSON.stringify(texts[texts.length - 1])}`);
  }
  const doneTick = (await toggles.nth(count - 1).innerText()).trim();
  if (doneTick.includes('✓')) {
    pass('已完成显示勾', JSON.stringify(doneTick));
  } else {
    fail('已完成显示勾', `最后一个勾选框内容是 ${JSON.stringify(doneTick)}`);
  }

  // 断言 4（最重要）：点一下未完成行的**勾选框**，它应该变成已完成
  // 并**挪到末尾**。这一条同时证明 Pressable 可交互 + state 回流 + 重排序。
  //
  // ⚠️ 点的是 toggle 而不是 row：切片入口没有传 `onOpenTask`，
  // 所以行体按设计**不可点**（那是刻意的默认值 —— 见 TaskList.tsx 里
  // "忘了传 onOpenTask 不该表现成点一下就误完成"那段）。
  const firstBefore = texts[0];
  await toggles.first().click();
  await page.waitForTimeout(250);
  const firstAfter = (await page.locator('[data-testid^="task-row-"]').first().innerText()).trim();
  if (firstAfter !== firstBefore && firstAfter.startsWith('核对鸿蒙')) {
    pass('点击后重排', `${JSON.stringify(firstBefore)} → 首行变成 ${JSON.stringify(firstAfter)}`);
  } else {
    fail('点击后重排', `点击后首行仍是 ${JSON.stringify(firstAfter)}`);
  }

  if (pageErrors.length === 0) {
    pass('无页面错误');
  } else {
    fail('无页面错误', pageErrors.join(' | '));
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n       浏览器断言失败 ${failures.length} 项：${failures.join('、')}`);
  process.exit(1);
}
process.exit(0);
