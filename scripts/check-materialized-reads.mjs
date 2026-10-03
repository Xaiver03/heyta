#!/usr/bin/env node
/**
 * 门禁：**读物化状态的屏必须订阅同步完成信号**。
 *
 * ## 为什么需要这条
 *
 * 移动端的屏读的是**内存里的物化状态**（`actions.listTasks()` /
 * `engine.getState()`），而它们只在挂载时读一次。
 *
 * 实测到的线上形状（2026-09-26，真公网服务端 + 真 iOS 模拟器）：
 *
 *   1. 冷启动落在「任务」页 —— 此时本地是空的，屏**已挂载**
 *   2. 去「我的」填凭据 → 同步 → 服务端那 2 条 op 下载、应用、物化
 *   3. 切回「任务」—— **屏一直挂着，`useEffect` 依赖没变，不会重读**
 *   4. 界面显示「还没有任务」，而**数据库里任务明明在**（重启 App 就能看见）
 *
 * 用户据此会认为"多端同步没成功" —— 而真相是**数据到了，界面没去看**。
 * 这是最坏的一类 bug：功能是对的，界面在说谎。
 *
 * ## 这条门禁查什么
 *
 * 任何屏只要调用了读物化状态的 API，就必须在同一个文件里引用 `dataRevision`
 * （由 `sync/store.ts` 的 `useMobileSync()` 提供，每完成一次同步 +1）。
 *
 * 它是**静态**检查，不是运行时检查 —— 因为运行时那种 bug 需要
 * "屏挂着 + 恰好此时同步" 的时序，单元测试很难稳定复现。
 * 静态检查在这里更可靠：漏了就红，不依赖运气。
 *
 * ## 误报怎么办
 *
 * 如果某个屏确实不需要在同步后刷新（例如只显示本机设置），
 * 把文件加进下面的 `EXEMPT` 并**写明理由** —— 不要放宽匹配规则。
 * 放宽规则会让这条门禁悄悄失效，那比没有门禁更糟。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCREENS_DIR = join(ROOT, 'apps/mobile/src/screens');

/** 读物化状态的调用形状。 */
const READ_PATTERNS = [
  /\.listTasks\s*\(/,
  /\.listSessions\s*\(/,
  /\.listPendingTasks\s*\(/,
  /\.listProjects\s*\(/,
  // W2：倒数日/纪念日是第二个事件源。漏这一行的后果是移动端倒计时屏
  // 不订阅 dataRevision 也**永远不红** —— 这条模式必须在屏建出来之前就位。
  /\.listEvents\s*\(/,
  /engine\.getState\s*\(/,
  /materializedState\s*\(/,
];

/** 订阅同步完成信号的标志。 */
const SUBSCRIBE_PATTERN = /dataRevision/;

/**
 * 豁免清单：**每一项都必须写明理由**。
 *
 * 空着是正常的 —— 加之前先问："这个屏真的不需要看见别的设备同步下来的数据吗？"
 */
const EXEMPT = new Map([
  // 例：['SomeScreen.tsx', '只显示本机设置，不读物化状态'],
]);

/**
 * 剥掉注释（保留字符串内容）。
 *
 * 🔴 **这一步是承重的，不是洁癖。**
 *
 * 第一版直接拿正则去匹配**原始源码**，结果反证时**它照样通过**：
 * 我把 `const { dataRevision } = useMobileSync();` 改成了 `const { } = useMobileSync();`，
 * 但文件里**注释**还写着 "`dataRevision` 是同步完成信号" ——
 * 于是 `/dataRevision/` 命中注释，门禁报绿。
 *
 * **一条不会失败的检查等于没有检查。** 所以匹配必须作用在"剥掉注释之后的代码"上。
 *
 * 保留字符串内容是有意的：`import ... from '../sync/store'` 这类要留着。
 * 代价是"字符串里恰好写了 dataRevision"也会算数 —— 那在本仓库里不会发生，
 * 而且真要绕过它是刻意为之，不是失误。
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  /** code | line | block | single | double | template */
  let state = 'code';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && n === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'template';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && n === '/') {
        state = 'code';
        i += 2;
      } else if (c === '\n') {
        out += c; // 保留换行，行号才有意义
        i += 1;
      } else {
        i += 1;
      }
      continue;
    }
    // 字符串内部：原样保留
    out += c;
    if (
      (state === 'single' && c === "'") ||
      (state === 'double' && c === '"') ||
      (state === 'template' && c === '`')
    ) {
      state = 'code';
    }
    i += 1;
  }
  return out;
}

const problems = [];
let scanned = 0;

for (const file of readdirSync(SCREENS_DIR)) {
  if (!file.endsWith('.tsx')) continue;
  const path = join(SCREENS_DIR, file);
  // 🔴 匹配作用在**剥掉注释之后**的源码上（理由见 stripComments）。
  const source = stripComments(readFileSync(path, 'utf8'));
  scanned += 1;

  const reads = READ_PATTERNS.filter((re) => re.test(source));
  if (reads.length === 0) continue;

  if (EXEMPT.has(file)) continue;

  if (!SUBSCRIBE_PATTERN.test(source)) {
    problems.push({
      file: relative(ROOT, path),
      // 报出**命中了哪条**，而不是笼统一句"缺 dataRevision" ——
      // 否则改的人不知道该把订阅加在哪一段读取旁边。
      hits: reads.map((re) => re.source),
    });
  }
}

if (problems.length > 0) {
  console.error('❌ 有屏读物化状态，但没有订阅同步完成信号（dataRevision）：\n');
  for (const p of problems) {
    console.error(`   ${p.file}`);
    for (const h of p.hits) console.error(`      命中读取：${h}`);
  }
  console.error(
    '\n   修法：在该屏里 `import { useMobileSync } from \'../sync/store\';`，' +
      '\n   取 `const { dataRevision } = useMobileSync();`，并把它加进那个读数据的' +
      '\n   `useEffect` 的依赖数组。\n' +
      '\n   背景见 `apps/mobile/src/sync/store.ts` 里 `dataRevision` 的字段说明 ——' +
      '\n   少了它，同步完成后界面会一直显示旧快照（实测过：数据库里有、界面说没有）。\n',
  );
  process.exit(1);
}

console.log(`✅ ${scanned} 个屏：读物化状态的那些都订阅了 dataRevision。`);
