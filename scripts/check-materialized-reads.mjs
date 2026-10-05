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
 * **规则一**：任何屏只要调用了读物化状态的 API，就必须在同一个文件里引用 `dataRevision`
 * （由 `sync/store.ts` 的 `useMobileSync()` 提供，每完成一次同步 +1）。
 *
 * **规则二（W6，2026-10-05）**：渲染共享日历板 `<CalendarBoard` 的宿主必须
 * ① 真的**读**过倒数日、② 真的把它**喂**进板子，且不许喂字面空数组。
 * 这条存在的原因是必填 prop 只挡得住"没传"，挡不住"传了一个永远为空的数组" ——
 * 而后者在界面上与"这台设备没有倒数日"逐像素相同（§7 第 195 条）。
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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
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

/* ────────────────────────────────────────────────────────────────────────────
 * 🔴 第二条规则（W6，2026-10-05）：**渲染共享日历板的宿主必须真的把倒数日喂进去**。
 *
 * 为什么第一条挡不住这件事：第一条问的是"读了物化状态有没有订阅同步完成信号"。
 * 移动端完全可以把 `listEvents()` 那一句删掉、留下 `const [events] = useState([])`，
 * 于是 `events={events}` 照样传、typecheck 照样绿（必填 prop 只挡"根本没传"，
 * **挡不住"传了一个永远为空的数组"**），而界面上"这台设备没有倒数日"与
 * "宿主没接"长得一模一样 —— §7 第 195 条记的就是这个形状。
 *
 * 所以这一条把**宿主侧那一端**钉成一对：
 *   · 渲染 `<CalendarBoard` 的文件必须**读**过倒数日（`listEvents(` 或 store 的 `.events`）；
 *   · 并且必须把它**喂**进去（`events={…}`，且不许是字面空数组 `events={[]}` ——
 *     那正是"用假数据把接线糊过去"的那种写法）。
 *
 * ⚠️ 匹配同样作用在**剥掉注释之后**的源码上（理由见 `stripComments` 的说明：
 *    第一版那条门禁的反证就是被注释里的字命中的）。
 * ────────────────────────────────────────────────────────────────────────── */

/** 只扫宿主自己的源码：测试夹具里的 `<CalendarBoard events={[]} />` 是**该允许**的。 */
const HOST_SRC_DIRS = ['apps/web/src', 'apps/mobile/src', 'apps/desktop/src', 'apps/node-host/src'];
/**
 * 🔴 这一条**必须容忍别名**。Web 端写的是 `import { CalendarBoard as SharedCalendarBoard }`
 *   再 `<SharedCalendarBoard …>`（`CalendarView.tsx:40`）。第一版把模式写成
 *   `/<CalendarBoard[\s>]/`，于是它**只数到移动端那 1 个宿主**、对 Web 整片失明 ——
 *   而且报的是 ✅。一条因为正则太窄而漏掉目标的门禁，比没有门禁更危险：
 *   它会让人以为那一格已经被守住了。
 */
const BOARD_JSX = /<[A-Za-z]*CalendarBoard[\s>]/;
const EVENT_READ = [/\.listEvents\s*\(/, /\.events\b/];
const EVENT_FEED = /events=\{[A-Za-z_$]/;
/** `events={[]}` / `events={[ ]}`：字面空数组 = 没接。 */
const EVENT_FEED_EMPTY = /events=\{\s*\[\s*\]\s*\}/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && entry.name.endsWith('.tsx')) yield path;
  }
}

const feedProblems = [];
let boardHosts = 0;

for (const rel of HOST_SRC_DIRS) {
  const dir = join(ROOT, rel);
  // 宿主目录可以整片不存在（`apps/desktop` 是待退役壳）—— 那种情况**没什么可扫的**，
  // 但不能因此让整把门因为一个 ENOENT 崩掉：崩掉的门禁与放宽规则同样危险。
  if (!existsSync(dir)) continue;
  for (const path of walk(dir)) {
    const source = stripComments(readFileSync(path, 'utf8'));
    if (!BOARD_JSX.test(source)) continue;
    boardHosts += 1;
    const missing = EVENT_READ.filter((re) => !re.test(source)).length === EVENT_READ.length;
    const empty = EVENT_FEED_EMPTY.test(source);
    const fed = EVENT_FEED.test(source);
    if (missing || !fed || empty) {
      feedProblems.push({
        file: relative(ROOT, path),
        why: missing
          ? '渲染了共享日历板，却没有读任何倒数日（既没有 `.listEvents(` 也没有 store 的 `.events`）'
          : empty
            ? '喂给日历板的是**字面空数组** `events={[]}` —— 那与"宿主没接"在界面上完全一样'
            : '读了倒数日却没有把它作为 `events={...}` 传给日历板',
      });
    }
  }
}

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

if (feedProblems.length > 0) {
  console.error('❌ 渲染共享日历板的宿主没有把倒数日接进去（W6 第二条规则）：\n');
  for (const p of feedProblems) console.error(`   ${p.file}\n      ${p.why}`);
  console.error(
    '\n   为什么这一条要常驻：`events` 是**必填** prop，它挡得住"根本没传"，' +
      '\n   挡不住"传了一个永远为空的数组"。后者的界面与"这台设备没有倒数日"' +
      '\n   逐像素相同（§7 第 195 条）。修法是从宿主读它：移动端 `actions.listEvents(today)`，' +
      '\n   Web 端 `useCountdownStore((s) => s.events)`。\n',
  );
  process.exit(1);
}

/*
 * **规则三（W6，2026-10-05 22:3x）**：共享日历板那三枚组件的 `events` prop **不许退回可选**。
 *
 * 为什么单独立一条：规则二查的是"宿主喂没喂"，它的前提是**那道缝是必填的**。
 * 一旦有人把它改回 `events?:`（合流时两边各有一份实现，这是最可能被选中的那一份），
 * 于是：宿主全都还在传 `events` ⇒ **typecheck 一个字都不报**、规则二**照样全绿**
 * （它查的是 JSX 上有没有 `events={…}`），而"某个新宿主忘了接"从此静默通过。
 * 一条只在"有人犯错时"才响的判据，等那个错误发生就已经太晚了 —— 所以查**形状本身**。
 *
 * 判据按符号锚定（`events?:` 这个成员声明），不按行号、不抄整段文本 ——
 * 后者会让它成为第二份格式规范，改缩进就红。
 *
 * `--seam-dir` 是**取证旋钮**，不是逃生门：默认查真实路径，
 * 只用来在别处（例如另一条线那份实现的 blob 副本）证明这条判据真的会红。
 */
const SEAM_DIR_ARG = process.argv.indexOf('--seam-dir');
const SEAM_DIR =
  SEAM_DIR_ARG >= 0 && process.argv[SEAM_DIR_ARG + 1]
    ? resolve(process.argv[SEAM_DIR_ARG + 1])
    : join(ROOT, 'packages/ui/src/calendar');
const SEAM_FILES = ['CalendarBoard.tsx', 'CalendarDayBoard.tsx', 'CalendarYearBoard.tsx'];
/** 可选成员声明：`events?:` （带不带 `readonly` 都算）。 */
const OPTIONAL_EVENTS_PROP = /^\s*(?:readonly\s+)?events\?\s*:/m;

const seamProblems = [];
for (const file of SEAM_FILES) {
  const path = join(SEAM_DIR, file);
  if (!existsSync(path)) {
    // 🔴 文件不在 = 红，不是跳过（§7 第 191 条：挂在文件枚举上的门禁，
    //    目标被删时会安静地不执行还照样打印通过）。
    seamProblems.push({ file: relative(ROOT, path), why: '文件不在了 —— 这条判据不能因为改名/删除而静默失效' });
    continue;
  }
  const source = stripComments(readFileSync(path, 'utf8'));
  if (OPTIONAL_EVENTS_PROP.test(source)) {
    seamProblems.push({
      file: relative(ROOT, path),
      why: '`events` 被声明成了**可选** prop（`events?:`）—— 见本文件规则三那段',
    });
  }
}

if (seamProblems.length > 0) {
  console.error('❌ 共享日历板的倒数日缝不再是必填 prop（W6 第三条规则）：\n');
  for (const p of seamProblems) console.error(`   ${p.file}\n      ${p.why}`);
  console.error(
    '\n   后果：宿主忘接倒数日时 typecheck 与规则二**都不响**，"这台设备没有倒数日"' +
      '\n   会被静默画成正常界面。改回 `readonly events: readonly CountdownEvent[];`，' +
      '\n   没有倒数日就传 `[]`。\n',
  );
  process.exit(1);
}

console.log(
  `✅ ${scanned} 个屏：读物化状态的那些都订阅了 dataRevision；` +
    `${boardHosts} 个渲染共享日历板的宿主都读了并喂进了倒数日；` +
    `${SEAM_FILES.length} 枚共享板组件的 \`events\` 仍是必填。`,
);
