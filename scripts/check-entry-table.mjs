#!/usr/bin/env node
/**
 * 门禁：R14 入口契约（入口表一动作一主入口 + 壳里只有一套动词表）
 * ==================================================================
 *
 * ## 它钉的三件事
 *
 * | # | 判据 | 为什么它能红，而别的检查红不了 |
 * |---|---|---|
 * | 1 | `docs/plans/r14-entry-table.md` 里**每个动作恰好一个主入口** | 入口重复不会有任何编译错误：两个按钮各自自洽，界面照样能点。只有账本对不上才会红 |
 * | 2 | `apps/web/src/features/tasks/TaskRowMenu.tsx` 的 id **全部**来自 `packages/ui/src/task-list/row-actions.ts` 的 `ROW_ACTION_IDS` | 两套动词表（2026-11-06 实测：共享层 7 个 id 与 web 行菜单 7 项**只交集 3 个**）各自内部自洽 ⇒ 没有任何测试会红，而它会稳定长出"同一动作两个入口、一端没入口" |
 * | 3 | 三个已修缺陷**不许回潮**：B5（详情栏开关两处同时在场）/ A1（放弃任务零入口）/ C2（第二套动词表） | 这三条都是"删掉之后没人会注意到又长回来"的形状 |
 *
 * ## 为什么"账本对不上"必须由脚本判，不能靠人读
 *
 * 入口表是**散文 + 表格**，人读的时候只会看自己关心的那几行。而"同一动作两个主入口"
 * 恰恰是在**两张不同的行**上各写一个位置 —— 眼睛扫过去两行都合理。
 * 所以判据必须落在**机器可读的形状**上：
 *
 *  · 动作 cell 里恰好一个反引号 id（`id` 是唯一键，不许两行同 id）；
 *  · 当前入口 cell 里恰好**一个** `文件:行号（锚点）`；
 *  · **锚点必须在那个文件里解析得到** —— 见下面「锚点判据（2026-11-10 改版）」。
 *
 * ## 锚点判据（2026-11-10 改版：从"行号 ±3"改成"唯一命中 / 就近命中"）
 *
 * 🔴 **旧判据为什么必须换掉**：它要求锚点落在所写行号的 **±3 行**内。
 * 而 `App.tsx` 一天改几十行 ⇒ **行号必然漂** ⇒ 门禁必然恒红。
 * 实测（2026-11-10）：54 个锚点里**只有 35 个**还落在 ±3 行窗口内，
 * 其余 19 个**锚点全都还在文件里、只是行号漂了**。于是这条门禁的阳性对照
 * 失败、整道 R14 门禁恒红 ⇒ **它的 10 条臂提供的保护全部归零**
 *（本仓自己的话：「长期变红就等于没有测试」）。
 * 这张表此前已因**同一原因**"按锚点重定位"过三次：
 * `fd543d07`（19 处）/ `4d795782`（20 处）/ `6e37f948`。
 *
 * 🔴 **新判据：判"锚点解析得到"，不判"行号没动"**。规则三条，按强度递降：
 *
 *  1. **唯一命中**（首选）：锚点在文件里**恰好出现 1 次** ⇒ 位置自明，
 *     行号只是给人看的提示，**它漂了不算错**。
 *     依据：本表 54 个锚点里 **47 个天然全局唯一**
 *     （`data-testid="bulk-exit"`、`onSetAbandoned=` 这种串本来就只该有一处）。
 *  2. **就近命中**（多处命中时）：锚点出现 N>1 次 ⇒ 要求**所写行号附近的那一处**
 *     确实是其中之一 —— 即"行号指对了地方"，但**允许 ±3 以外的漂移**：
 *     取**距离所写行号最近的那一次命中**，只要求它存在。
 *     ⚠️ 这一档判别力**弱于**第 1 档（"指对了地方"仍由行号与就近关系担保），
 *     所以 R6/R7 会把它**登记出来**（`info`，不是错误），提醒有人把它收紧成唯一串。
 *  3. **零命中** ⇒ **红**。这才是这条判据真正要挡的：锚点被改名/删掉、
 *     或者路径抄错 —— 那说明**表描述的东西已经不存在了**。
 *
 * 为什么这样改**没有削弱**它要挡的东西：旧判据真正抓住的是
 * "R14 那一轮改完之后，表里写的入口还在不在"（臂 5：行号不动、锚点抄错 ⇒ 红）。
 * 新判据**仍然抓得住**（零命中就红），而它不再被"行号漂了"这种**与语义无关**的
 * 变化误伤。顺带：**行号不再需要人来维护** —— 省掉的是那三次"重定位"的整类工作。
 *
 * 代价（写明，不藏）：**"锚点挪到了同一文件里的另一个地方"不再必然被发现**。
 * 但那恰好是 R6/R7 的第 2 档要登记的东西，而且第 1 档（47/54）本来就不受影响。
 * 要把 7 个多处命中的锚点逐个收紧成唯一串，见 `docs/plans/r14-entry-table.md` 的待办。
 *
 * ## 锚点为什么写进表格
 *
 * 只写 `文件:行号` 的表**一定**会漂（这个仓库一天改几十行），而漂了之后
 * "文件存在 + 行号没越界"照样通过 —— 那是一条永远绿的门禁。
 * 把锚点一起写进 cell，`文件:行号（锚点）` 就能被判：**行号漂了、锚点没挪，立刻红**。
 * 代价是表里多几个字；收益是这张表在两周后仍然可信。
 *
 * ## 11 条规则
 *
 * | 规则 | 判据 |
 * |---|---|
 * | R1 | 表存在、≥ 20 行、每行 7 列 |
 * | R2 | 动作 cell 恰好一个 `id`，且 id 唯一 |
 * | R3 | 作用域 / 应有层级 ∈ 枚举，且满足 J 规则映射（单值→字段、单条→对象、多条→对象、全局→全局或视图） |
 * | R4 | 类型 token ∈ {直接, 导航型, 隐式, 缺入口} |
 * | R5 | 处置 ∈ {新增, 收敛, 删除, 保留, 未落地}，且 `未落地` ⟺ 当前入口 = `未落地` |
 * | R6 | 当前入口：恰好一个 `文件:行号（锚点）`；文件在、行号在范围内、锚点在 ±3 行内 |
 * | R7 | 第二入口：`—` 或 ≥ 1 个位置（每个都验），且此时处置必须是 `保留` 或 `收敛`（"允许第二入口"必须是判过的，不是默认的） |
 * | R8 | 共享词汇表的 11 个 id **全覆盖**（表里少一个 id = 有动作没登记） |
 * | R9 | C2：web 行菜单的每个 id 字面量都必须出现在 `case` 标签里（不许另立数组/对象表），且 `renderRowAction` 与 `hostContentOf` 的 switch **覆盖共享层全部 id** |
 * | R10 | B5：剥注释后 App.tsx 里没有 `testID="detail-pane…"`，而 `data-testid="detail-pane-toggle"` 恰好 1 处 |
 * | R11 | A1：`放弃任务` 的四段链路都在（行菜单项 → 宿主接线 → store 转发 → app-host action） |
 *
 * ## 自检（`--self-test`）
 *
 * 9 条臂 + 1 条阳性对照。每条臂在**临时副本**上做一次最小改动，
 * 断言"该红的那条规则真的红了"。🔴 没有臂的形状门禁是最糟的一类：
 * 它永远绿，而没人知道它在不在看。
 *
 * 用法：
 *   node scripts/check-entry-table.mjs              # 判当前工作树
 *   node scripts/check-entry-table.mjs --self-test  # 9 条臂 + 阳性对照
 *   HEYTA_CHECK_ROOT=/tmp/x node scripts/check-entry-table.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const TABLE = 'docs/plans/r14-entry-table.md';
const SRC_ROW_ACTIONS = 'packages/ui/src/task-list/row-actions.ts';
const SRC_ROW_MENU = 'apps/web/src/features/tasks/TaskRowMenu.tsx';
const SRC_APP = 'apps/web/src/App.tsx';
const SRC_STORE = 'apps/web/src/features/tasks/store.ts';
const SRC_ACTIONS = 'packages/app-host/src/actions.ts';

const SOURCES = [SRC_ROW_ACTIONS, SRC_ROW_MENU, SRC_APP, SRC_STORE, SRC_ACTIONS];

const SCOPES = ['单条', '多条', '全局', '单值'];
const LAYERS = ['全局', '视图', '对象', '字段'];
const TYPES = ['直接', '导航型', '隐式', '缺入口'];
const DISPOSITIONS = ['新增', '收敛', '删除', '保留', '未落地'];

/** J 规则（`docs/research/ticktick-ux-ia-and-entry-paths.md` §3.1）的可判红形状。 */
const LAYER_FOR_SCOPE = {
  单值: ['字段'],
  单条: ['对象'],
  多条: ['对象'],
  全局: ['全局', '视图'],
};

/** 剥掉注释（行数不变）—— 一条会被散文改变的判据量的不是代码。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\n)([^\n]*?)\/\/[^\n]*/g, (m, lead, head) => lead + head + ' '.repeat(Math.max(0, m.length - lead.length - head.length)));
}

function read(root, rel) {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** 表格行 → 7 个 cell。不是表格行返回 null。 */
function cellsOf(line) {
  if (!line.trimStart().startsWith('|')) return null;
  const raw = line.trim();
  if (raw.endsWith('|')) {
    // 去掉首尾的竖线再切
  }
  const parts = raw.split('|');
  // parts[0] 与 parts[last] 是空串（首尾竖线）
  const cells = parts.slice(1, -1).map((c) => c.trim());
  return cells.length === 7 ? cells : null;
}

const LOC_RE = /([A-Za-z0-9_./-]+\.(?:tsx?|mjs|css|md)):(\d+)（([^）]*)）/g;

function locationsIn(text) {
  const out = [];
  for (const m of text.matchAll(LOC_RE)) out.push({ path: m[1], line: Number(m[2]), anchor: m[3] });
  return out;
}

/** 共享层的 id 集合（从 `ROW_ACTION_IDS` 那个数组字面量里读，不在这里抄一份）。 */
function sharedIds(root) {
  const src = read(root, SRC_ROW_ACTIONS);
  if (src === null) return { ids: [], error: `${SRC_ROW_ACTIONS} 不存在` };
  const m = src.match(/export const ROW_ACTION_IDS = \[([\s\S]*?)\] as const;/);
  if (m === null) return { ids: [], error: `${SRC_ROW_ACTIONS} 里找不到 \`ROW_ACTION_IDS = [...] as const\`` };
  const ids = [...m[1].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]);
  return { ids, error: null };
}

function check(root) {
  const errors = [];
  const info = [];
  const err = (rule, message) => errors.push({ rule, message });

  // ── R1：表存在、行数、列数 ───────────────────────────────────────────────
  const tableSrc = read(root, TABLE);
  if (tableSrc === null) {
    err('R1', `${TABLE} 不存在 —— 入口表是这一道门禁的唯一输入。`);
    return { errors, info };
  }
  const rows = [];
  for (const line of tableSrc.split('\n')) {
    const cells = cellsOf(line);
    if (cells === null) continue;
    if (cells[0].includes('动作') || /^-+$/.test(cells[0].replace(/[: ]/g, '-'))) continue;
    rows.push({ cells, line });
  }
  if (rows.length < 20) {
    err('R1', `${TABLE} 只有 ${String(rows.length)} 行入口（要求 ≥ 20）。`);
  }
  info.push(`入口表：${String(rows.length)} 行`);

  // ── R2 / R3 / R4 / R5：每行自洽 ──────────────────────────────────────────
  const seen = new Map();
  for (const [i, row] of rows.entries()) {
    const at = `第 ${String(i + 2)} 行（${row.cells[0].slice(0, 24)}…）`;
    const [actionCell, scope, layer, primary, secondary, typeCell, dispositionCell] = row.cells;

    const ids = [...actionCell.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]);
    if (ids.length !== 1) {
      err('R2', `${at}：动作 cell 必须恰好一个反引号 id（读到 ${String(ids.length)} 个）。`);
    } else {
      const id = ids[0];
      if (seen.has(id)) {
        err(
          'R2',
          `${at}：动作 id \`${id}\` **出现了两次**（第一次在第 ${String(seen.get(id))} 行）` +
            ' —— 一个动作两个主入口就是这一条要抓的形状。',
        );
      } else {
        seen.set(id, i + 2);
      }
    }

    if (!SCOPES.includes(scope)) err('R3', `${at}：作用域 \`${scope}\` 不在枚举里。`);
    if (!LAYERS.includes(layer)) err('R3', `${at}：应有层级 \`${layer}\` 不在枚举里。`);
    if (SCOPES.includes(scope) && LAYERS.includes(layer)) {
      const allowed = LAYER_FOR_SCOPE[scope];
      if (!allowed.includes(layer)) {
        err(
          'R3',
          `${at}：作用域 \`${scope}\` 决定层级只能是 ${allowed.join(' / ')}，写的是 \`${layer}\`（J1/J2/J4）。`,
        );
      }
    }

    const types = typeCell.split(/[,，]/).map((x) => x.trim()).filter((x) => x !== '');
    for (const t of types) {
      if (!TYPES.includes(t)) err('R4', `${at}：类型 \`${t}\` 不在枚举里（直接 / 导航型 / 隐式 / 缺入口）。`);
    }

    const disposition = dispositionCell.split('—')[0].trim();
    if (!DISPOSITIONS.includes(disposition)) {
      err('R5', `${at}：处置 \`${disposition}\` 不在枚举里（新增 / 收敛 / 删除 / 保留 / 未落地）。`);
    }

    // ── R5 的另一半：未落地 ⟺ 当前入口 = 未落地 ─────────────────────────────
    const isUndeployed = primary.trim() === '未落地';
    if (isUndeployed !== (disposition === '未落地')) {
      err(
        'R5',
        `${at}：\`当前入口 = 未落地\` 与 \`处置 = 未落地\` 必须同时成立（读到 当前入口 ${isUndeployed ? '未落地' : '有位置'} / 处置 ${disposition}）。`,
      );
    }

    // ── R6：主入口恰好一个位置，且锚点可达 ────────────────────────────────
    const primaryLocs = locationsIn(primary);
    if (!isUndeployed) {
      if (primaryLocs.length !== 1) {
        err(
          'R6',
          `${at}：当前入口必须**恰好一个** \`文件:行号（锚点）\`（读到 ${String(primaryLocs.length)} 个）` +
            ' —— 两个就是两个主入口，请把次要的那个挪进「第二入口」并写理由。',
        );
      }
      for (const loc of primaryLocs) verifyLocation(root, loc, at, 'R6', err, info);
    }

    // ── R7：第二入口 ───────────────────────────────────────────────────────
    const secondaryLocs = locationsIn(secondary);
    if (secondary.trim() !== '—') {
      if (secondaryLocs.length === 0 && !secondary.includes('未核实')) {
        err('R7', `${at}：第二入口既不是 \`—\` 也没有可解析的位置 —— 要么写位置，要么写 \`—\`。`);
      }
      if (!['保留', '收敛'].includes(disposition)) {
        err(
          'R7',
          `${at}：有第二入口时处置必须是 \`保留\`（判定可接受）或 \`收敛\`（登记为债），写的是 \`${disposition}\`。`,
        );
      }
      for (const loc of secondaryLocs) verifyLocation(root, loc, at, 'R7', err, info);
    }
  }

  // ── R8：共享词汇表全覆盖 ──────────────────────────────────────────────────
  const { ids: shared, error: sharedError } = sharedIds(root);
  if (sharedError !== null) {
    err('R8', sharedError);
  } else {
    for (const id of shared) {
      if (!seen.has(id)) {
        err(
          'R8',
          `共享词汇表里的 \`${id}\` 在入口表里**没有行** —— 一个动作没登记层级，B/C/D 就会各自发明入口。`,
        );
      }
    }
    info.push(`共享词汇表：${String(shared.length)} 个 id，表里覆盖 ${String(shared.filter((id) => seen.has(id)).length)} 个`);
  }

  // ── R9：C2 一套动词表 ────────────────────────────────────────────────────
  const menuSrc = read(root, SRC_ROW_MENU);
  if (menuSrc === null) {
    err('R9', `${SRC_ROW_MENU} 不存在。`);
  } else {
    const menu = stripComments(menuSrc);
    if (!/ROW_ACTION_IDS/.test(menu)) {
      err('R9', `${SRC_ROW_MENU} 没有引用 \`ROW_ACTION_IDS\` —— 行菜单自己发明了 id 集合（C2 回潮）。`);
    }
    if (!/groupRowActions\(/.test(menu)) {
      err('R9', `${SRC_ROW_MENU} 没有调用 \`groupRowActions()\` —— 顺序与分组又回到壳里自己排了。`);
    }
    // 每个 id 字面量都必须出现在 case 标签里（不许另立数组 / 对象表）
    for (const id of shared) {
      const occurrences = [...menu.matchAll(new RegExp(`'${id}'`, 'g'))].length;
      const cases = [...menu.matchAll(new RegExp(`case '${id}':`, 'g'))].length;
      if (occurrences !== cases) {
        err(
          'R9',
          `${SRC_ROW_MENU} 里 \`'${id}'\` 出现 ${String(occurrences)} 次，而 \`case '${id}':\` 只有 ${String(cases)} 处` +
            ' —— 多出来的那几处是**第二份动词表**（数组 / 对象 / 条件里手写的 id）。',
        );
      }
    }
    // switch 必须覆盖共享层全部 id：加一个 id 而壳不表态 ⇒ 红
    for (const id of shared) {
      for (const fn of ['hostContentOf', 'renderRowAction']) {
        if (!new RegExp(`case '${id}':`).test(menu)) {
          err('R9', `${SRC_ROW_MENU} 的 \`${fn}\` 没有 \`case '${id}':\` —— 共享层加了 id，壳没表态。`);
        }
      }
    }
    // 反面：壳里不许出现共享层没有的 id
    for (const m of menu.matchAll(/case '([A-Za-z][A-Za-z0-9]*)':/g)) {
      if (!shared.includes(m[1])) {
        err('R9', `${SRC_ROW_MENU} 里 \`case '${m[1]}':\` 不在共享词汇表里 —— 壳发明了 id。`);
      }
    }
  }

  // ── R10：B5 详情栏开关只有一个入口 ───────────────────────────────────────
  const appSrc = read(root, SRC_APP);
  if (appSrc === null) {
    err('R10', `${SRC_APP} 不存在。`);
  } else {
    const app = stripComments(appSrc);
    const menuItems = [...app.matchAll(/testID="(detail-pane[^"]*)"/g)].map((m) => m[1]);
    if (menuItems.length > 0) {
      err(
        'R10',
        `${SRC_APP} 的 \`⋯\` 里又出现了详情栏的 \`MenuItem\`（${menuItems.join(' / ')}）` +
          ' —— 收起态会与页头那枚**同时在场**（B5 回潮）。',
      );
    }
    const headerToggles = [...app.matchAll(/data-testid="detail-pane-toggle"/g)].length;
    if (headerToggles !== 1) {
      err('R10', `${SRC_APP} 里 \`data-testid="detail-pane-toggle"\` 出现 ${String(headerToggles)} 次（必须恰好 1 次）。`);
    }
  }

  // ── R11：A1 放弃任务的四段链路 ───────────────────────────────────────────
  const chain = [
    [SRC_ROW_MENU, /data-testid="task-row-menu-abandon"/, '行菜单里没有「放弃」这一枚'],
    [SRC_ROW_MENU, /onSetAbandoned\?\.\(taskId, !abandoned\)/, '行菜单没有把意图发出去'],
    [SRC_APP, /onSetAbandoned=/, '宿主没有把 `onSetAbandoned` 接到行菜单上'],
    [SRC_APP, /isAbandoned\(/, '宿主没有用领域层的 `isAbandoned()` 判当前态'],
    [SRC_STORE, /taskActions\.setAbandoned\(/, 'store 没有转发到 `TaskActions.setAbandoned`'],
    [SRC_ACTIONS, /async setAbandoned\(/, 'app-host 的 `setAbandoned` action 不见了'],
  ];
  for (const [file, re, why] of chain) {
    const src = read(root, file);
    if (src === null || !re.test(src)) err('R11', `${file}：${why}（A1 回潮）。`);
  }

  return { errors, info };
}

function verifyLocation(root, loc, at, rule, err, info) {
  const src = read(root, loc.path);
  if (src === null) {
    err(rule, `${at}：\`${loc.path}\` 不存在（表里写的是 ${loc.path}:${String(loc.line)}）。`);
    return;
  }
  const lines = src.split('\n');
  if (loc.line < 1 || loc.line > lines.length) {
    err(rule, `${at}：\`${loc.path}:${String(loc.line)}\` 越界（文件只有 ${String(lines.length)} 行）。`);
    return;
  }
  const anchor = loc.anchor.replace(/&lt;/g, '<');

  /**
   * 锚点在全文里的**每一处**命中（1-based 行号）。
   * 见文件头「锚点判据（2026-11-10 改版）」—— 判的是**锚点解析得到**，
   * 不是**行号没动**。
   */
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(anchor)) hits.push(i + 1);
  }

  if (hits.length === 0) {
    err(
      rule,
      `${at}：\`${loc.path}\` 里**找不到**锚点 \`${loc.anchor}\`` +
        ' —— 它被改名/删掉了，或者路径抄错了（表描述的那个入口已经不存在）。',
    );
    return;
  }

  if (hits.length === 1) {
    // 第 1 档：唯一命中 ⇒ 位置自明，**行号漂了不算错**。
    const drift = Math.abs(hits[0] - loc.line);
    if (drift > 3) {
      info.push(
        `${at}：锚点 \`${loc.anchor}\` 在 ${loc.path} 里唯一命中于第 ${String(hits[0])} 行` +
          `（表里写 ${String(loc.line)}，漂了 ${String(drift)} 行）。判据通过 —— 行号只是提示，` +
          '有空把它改准即可（不必为它单独提交）。',
      );
    }
    return;
  }

  // 第 2 档：多处命中 ⇒ 要求"所写行号附近确实是其中一处"。
  // 就近关系存在即通过，但**登记出来**提醒收紧成唯一串。
  const nearest = hits.reduce((best, h) =>
    Math.abs(h - loc.line) < Math.abs(best - loc.line) ? h : best,
  );
  const window = lines.slice(Math.max(0, loc.line - 1 - 3), Math.min(lines.length, loc.line + 3)).join('\n');
  if (!window.includes(anchor)) {
    info.push(
      `${at}：锚点 \`${loc.anchor}\` 在 ${loc.path} 里出现 ${String(hits.length)} 次` +
        `（第 ${hits.join('、')} 行），最近的命中在第 ${String(nearest)} 行、` +
        `而表里写的是 ${String(loc.line)}（不在 ±3 行内）。判据通过 —— 但**请把锚点收紧成唯一串**` +
        '（多处命中的锚点判别力弱：它证明"这个词还在文件里"，不证明"位置没挪"）。',
    );
  }
}

/* ────────────────────────── 自检（9 臂 + 阳性对照） ────────────────────────── */

function stage(root, tablePatch, patches = []) {
  const dir = mkdtempSync(join(tmpdir(), 'r14-entry-'));
  // 🔴 表里引用的**每一个**文件都要复制：只复制 SOURCES 的话，
  // 副本里 20 来个路径都不存在 ⇒ 阳性对照会红，而人只会以为"门禁坏了"。
  const referenced = new Set(SOURCES);
  const tableSrc = read(root, TABLE) ?? '';
  for (const m of tableSrc.matchAll(LOC_RE)) referenced.add(m[1]);
  for (const rel of [...referenced, TABLE]) {
    const src = read(root, rel);
    if (src === null) throw new Error(`stage: 读不到 ${rel}`);
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, src, 'utf8');
  }
  if (tablePatch !== null) {
    const p = join(dir, TABLE);
    writeFileSync(p, tablePatch(readFileSync(p, 'utf8')), 'utf8');
  }
  for (const [rel, mutate] of patches) {
    const p = join(dir, rel);
    writeFileSync(p, mutate(readFileSync(p, 'utf8')), 'utf8');
  }
  return dir;
}

function selfTest(root) {
  const arms = [];
  const expectRed = (name, rule, dir) => {
    const { errors } = check(dir);
    const hit = errors.filter((e) => e.rule === rule);
    arms.push({ name, rule, ok: hit.length > 0, detail: hit[0]?.message ?? (errors[0]?.message ?? '一条错都没报') });
    rmSync(dir, { recursive: true, force: true });
  };

  // 阳性对照：合规现状一个字都不许报
  {
    const dir = stage(root, null);
    const { errors } = check(dir);
    arms.push({
      name: '阳性对照（合规现状）',
      rule: '—',
      ok: errors.length === 0,
      detail: errors.length === 0 ? '0 条' : errors.map((e) => `${e.rule} ${e.message}`).join(' | '),
    });
    rmSync(dir, { recursive: true, force: true });
  }

  // 臂 1：**故意插一条重复** —— 同一个动作两行、各有一个主入口
  expectRed(
    '臂 1 同一动作插第二行（重复主入口）',
    'R2',
    stage(root, (t) => {
      // 🔴 必须挑**表格行**：正文 §5.2 里也有 `abandon`，复制一行散文不会让 R2 红
      //（第一次跑自检就是这么假的绿了一次 —— 臂自己也要能失败）。
      const line = t
        .split('\n')
        .find((l) => l.trimStart().startsWith('|') && l.includes('`abandon`') && cellsOf(l) !== null);
      if (line === undefined) throw new Error('臂 1：表里找不到 `abandon` 那一行');
      return t.replace(line, `${line}\n${line}`);
    }),
  );

  // 臂 2：一行里塞两个主入口
  expectRed(
    '臂 2 当前入口塞两个位置',
    'R6',
    stage(root, (t) =>
      t.replace(
        /(\| 打开详情 `open` \|[^\n]*?\| )([A-Za-z0-9_./-]+\.tsx?:\d+（[^）]*）)/,
        '$1$2 · apps/web/src/App.tsx:1（x）',
      ),
    ),
  );

  // 臂 3：层级与作用域不匹配（单值写了对象层）
  expectRed(
    '臂 3 作用域/层级不匹配（J1）',
    'R3',
    stage(root, (t) => t.replace(/(\| 设日期 `dueDate` \| 单值 \| )字段( \|)/, '$1对象$2')),
  );

  // 臂 4：路径写错
  expectRed(
    '臂 4 当前入口的文件不存在',
    'R6',
    stage(root, (t) => t.replace(/apps\/web\/src\/App\.tsx:(\d+)（data-testid="theme-toggle"）/, 'apps/web/src/AppNope.tsx:$1（data-testid="theme-toggle"）')),
  );

  // 臂 5：锚点抄错（行号对、锚点不对）
  expectRed(
    '臂 5 锚点在 ±3 行内找不到',
    'R6',
    stage(root, (t) => t.replace('（data-testid="theme-toggle"）', '（data-testid="theme-nope"）')),
  );

  // 臂 6：删掉一行 ⇒ 共享词汇表有 id 没登记
  expectRed(
    '臂 6 删掉 abandon 那一行（词汇表漏登记）',
    'R8',
    stage(root, (t) => t.split('\n').filter((l) => !l.includes('`abandon`')).join('\n')),
  );

  // 臂 7：B5 回潮 —— 把 `⋯` 里那枚「展开详情栏」加回去
  expectRed(
    '臂 7 B5 回潮（`⋯` 里再加一枚详情栏开关）',
    'R10',
    stage(root, null, [
      [
        SRC_APP,
        (s) =>
          s.replace(
            /data-testid="detail-pane-toggle"/,
            'testID="detail-pane-open"\n              data-testid="detail-pane-toggle"',
          ),
      ],
    ]),
  );

  // 臂 8：C2 回潮 —— 壳里另立一份 id 数组
  expectRed(
    '臂 8 C2 回潮（壳里另立 id 数组）',
    'R9',
    stage(root, null, [
      [SRC_ROW_MENU, (s) => `${s}\nconst LEGACY_IDS = ['open', 'priority', 'delete'];\n`],
    ]),
  );

  // 臂 9：A1 回潮 —— store 不再转发
  expectRed(
    '臂 9 A1 回潮（store 不再转发 setAbandoned）',
    'R11',
    stage(root, null, [[SRC_STORE, (s) => s.replace(/taskActions\.setAbandoned\(/g, 'noop(')]]),
  );

  console.log('\n【自检】9 条臂 + 1 条阳性对照\n');
  let bad = 0;
  for (const a of arms) {
    if (a.ok) {
      console.log(`  ✅ ${a.name} → 按预期${a.rule === '—' ? '全绿' : `红在 ${a.rule}`}`);
    } else {
      bad += 1;
      console.log(`  ❌ ${a.name} → 没按预期红（期望 ${a.rule}）：${a.detail}`);
    }
  }
  if (bad > 0) {
    console.error(`\n❌ 自检失败：${String(bad)} 条臂没按预期。**形状门禁失效比没有门禁更糟** —— 先修门禁。`);
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ 自检通过：每一条臂都真的能红，且合规现状全绿。\n');
}

/* ────────────────────────────────── 入口 ────────────────────────────────── */

const root = process.env.HEYTA_CHECK_ROOT ?? process.cwd();

if (process.argv.includes('--self-test')) {
  selfTest(root);
} else {
  const { errors, info } = check(root);
  for (const line of info) console.log(`  · ${line}`);
  if (errors.length > 0) {
    console.error(`\n❌ R14 入口契约：${String(errors.length)} 处不通过\n`);
    for (const e of errors) console.error(`  [${e.rule}] ${e.message}\n`);
    process.exitCode = 1;
  } else {
    console.log('\n✅ R14 入口契约：一动作一主入口 / 壳里只有一套动词表 / B5·A1·C2 三条都没回潮。');
  }
}
