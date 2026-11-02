#!/usr/bin/env node
/**
 * 门禁：界面**控件预算**（页头只能有「图标按钮 + 一枚 ⋯」，动作不许住进列表体）
 * ======================================================================
 *
 * ## 它钉的判断
 *
 * 2026-11-02 的立项读数：任务视图页头平铺着 9 个可交互控件 ——
 * 分享 / 选择任务 / 批量完成 / 重复警告 / 撤销 / 排序文字标签 / 排序原生下拉 /
 * 助手 / 详情开关。三种控制语法并列：`ghost` 文字按钮、`12px 标签 + 44px 原生 select`、
 * 纯图标按钮；而排序那一条还 gate 在 `visible.length > 0` 上，空的收集箱里**整个消失**。
 *
 * 同一时期，列表体里还住着一枚「AI 排优先级」：它是一枚 `ht-btn--ghost` 铺满整列、
 * 带图标的按钮，夹在组头与任务行之间 —— 长得和任务行一样，而它是一次批量写入的入口。
 *
 * 🔴 **这两件事的共同点不是"难看"，是"增加"**：每加一个功能，页头就长一寸、
 * 列表体就多一行动作，而**没有任何一条既有门禁会红**。几何全合规（字号是 token、
 * 颜色是 token、行高对、对比度够），界面照样越加越乱 —— 因为原来的尺量的都是
 * "这一件做得对不对"，没有一条在量"这里该有几件"。
 *
 * 这一道就是那把量**件数**的尺。
 *
 * ## 七格
 *
 * | 格 | 判据 | 红形 |
 * |---|---|---|
 * | 1 | 页头段里有且只有一枚 `task-menu-open` | 有人删掉 `⋯`，或又给它开了第二个入口 |
 * | 2 | 页头段里没有 `<select` | 有人在页头上再加一枚原生下拉（排序那种形状） |
 * | 3 | 页头段里没有 `<label` | 有人把"文字标签 + 控件"这一组塞回页头 |
 * | 4 | 页头段里没有 `task-sort` / `task-sort-select` | 排序以**常驻控件**的形状搬回页头 |
 * | 5 | `<AiPrioritize` 只在 `const aiPanels` **之前**出现一次 | 动作行搬回列表体 |
 * | 6 | `orgActions={aiPrioritizeAction}` 仍然接着 | 有人把它从助手面板上摘掉（入口又没了） |
 * | 7 | `.ht-header__actions` 只有一处 | 第二个页头动作区被新开出来（等于绕开整道门禁） |
 *
 * ## 为什么判源码而不判渲染
 *
 * 渲染层已经有两组判据（`task-sort.spec.tsx` 钉"排序从 `⋯` 可达"、
 * `share-entry-visible.spec.tsx` 钉"共享入口在菜单里"）。它们能被**删测试**绕过；
 * 源码形状这一道绕不过去 —— 两处一起，改坏要付两次代价。
 *
 * ## 自检
 *
 * 七臂 + 一条阳性对照（合规现状 ⇒ 一个字都不报）。每臂改的是临时副本
 * （`HEYTA_CHECK_ROOT` 指过去），工作树零改动。
 * 🔴 没有臂的形状门禁是最糟的一类：它永远绿，而没人知道它在不在看。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HEYTA_CHECK_ROOT ?? process.cwd();
const APP = 'apps/web/src/App.tsx';

/**
 * 去掉注释，只留代码（行数不变）。
 *
 * 🔴 必须先剥：App.tsx 里那段"这里原本平铺着 9 个控件……"的历史注释**逐字提到**
 * `task-sort-select` 与 `选择任务`。不剥的话，格 4 会在**产品已经修好**的那一天红，
 * 而红字指向产品 —— 一条对着注释变红的门禁会让人把注释删掉，然后判据就真的没了。
 *
 * 状态机一次左到右扫描，两种记号都认；`/*` 前面是 `:` 或 `/` 时不开块
 * （否则 `https://` 与 `**` 会被读成注释开头）。同 `check-share-entry-visible.mjs`。
 */
function stripComments(src) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const n = src[i + 1];
    const prev = src[i - 1];
    if (state === 'code') {
      if (c === '/' && n === '/' && prev !== ':') {
        state = 'line';
        i += 1;
        continue;
      }
      if (c === '/' && n === '*' && prev !== ':' && prev !== '/') {
        state = 'block';
        i += 1;
        continue;
      }
      out += c;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      continue;
    }
    if (c === '*' && n === '/') {
      state = 'code';
      i += 1;
      continue;
    }
    if (c === '\n') out += c;
  }
  return out;
}

const read = (rel) => {
  const path = join(ROOT, rel);
  if (!existsSync(path)) return null;
  return stripComments(readFileSync(path, 'utf8'));
};

const count = (haystack, needle) => haystack.split(needle).length - 1;

const problems = [];

const app = read(APP);
if (app === null) {
  problems.push(['app-missing', `${APP} 读不到，无法确认页头形状。`]);
} else {
  /* ── 页头那一段 vs 列表体 ──────────────────────────────────────── */
  const headerStart = app.indexOf('className="ht-header__actions"');
  const contentAt = app.indexOf('className="ht-content"');

  if (headerStart < 0) {
    problems.push([
      'header-missing',
      `${APP} 里找不到 \`className="ht-header__actions"\` —— 页头动作区改名或搬走了。` +
        '这道尺量的是"那一段里有几件"，锚点没了就等于没量（红，而不是跳过）。',
    ]);
  }
  if (contentAt < 0) {
    problems.push([
      'content-missing',
      `${APP} 里找不到 \`className="ht-content"\` —— 列表体的锚点没了，` +
        '格 5 无法判断动作行是不是又住进去了。',
    ]);
  }

  if (headerStart >= 0 && contentAt > headerStart) {
    const headerEnd = app.lastIndexOf('<', contentAt);
    const header = app.slice(headerStart, headerEnd);

    /**
     * 非模式段：把**批量栏**从页头那一段里切掉。
     *
     * 🔴 为什么切：批量栏是**模式态**（只有 `bulkSelecting` 为真时才渲染），
     * 它里面那枚"移动到哪个清单"的下拉是模式内的控件，不是"页头常驻控件"。
     * 不切的话格 2 会在**产品已经做对**的那一天红 —— 而一条指着对的产品的判据，
     * 结局一定是被人把规则删掉。
     *
     * 切法：从 `"bulk-toolbar"` 到 `"bulk-exit"` 之间整段去掉（首尾两枚锚点都留着）。
     */
    const bulkFrom = header.indexOf('"bulk-toolbar"');
    const bulkTo = header.indexOf('"bulk-exit"');
    const nonModeHeader =
      bulkFrom >= 0 && bulkTo > bulkFrom
        ? `${header.slice(0, bulkFrom)}${header.slice(bulkTo)}`
        : header;

    /* ── 格 1：`⋯` 有且只有一枚 ─────────────────────────────────── */
    const menuTriggers = count(header, '"task-menu-open"');
    if (menuTriggers === 0) {
      problems.push([
        'menu-missing',
        '页头没有 `task-menu-open` —— 页头唯一的功能入口没了。' +
          '排序、选择任务、共享都住在它里面：删掉它等于把那三件事从界面上摘掉。',
      ]);
    } else if (menuTriggers > 1) {
      problems.push([
        'menu-duplicated',
        `页头出现了 ${String(menuTriggers)} 枚 \`task-menu-open\` —— ` +
          '页头只能有**一枚** `⋯`。两枚不叫"更方便"，叫"用户得先猜哪个里面有他要的东西"。',
      ]);
    }

    /* ── 格 2 / 格 3：非模式段不许有原生下拉、不许有"标签 + 控件" ──── */
    if (nonModeHeader.includes('<select')) {
      problems.push([
        'header-native-select',
        '页头（批量栏之外）出现了 `<select` —— 原生下拉是"页头 = 一排控件"的起点：' +
          '它自带 44px 高度与边框，与旁边的图标按钮不是同一种视觉语法。' +
          '要加一个"档位"选择，放进 `⋯` 里的单选组。',
      ]);
    }
    if (nonModeHeader.includes('<label')) {
      problems.push([
        'header-labelled-control',
        '页头（批量栏之外）出现了 `<label` —— "可见文字标签 + 控件"这一组是 2026-11-02 之前' +
          '排序那枚控件的形状（`12px 文字 + 44px 下拉`）。它把页头从"图标行"变成"表单项"。',
      ]);
    }

    /* ── 格 4：排序不许以常驻控件的形状回到页头 ─────────────────── */
    for (const needle of ['"task-sort"', '"task-sort-select"']) {
      if (nonModeHeader.includes(needle)) {
        problems.push([
          'sort-back-in-header',
          `页头段里又出现了 ${needle} —— 排序已经在 \`⋯\` 里的单选组里（\`task-sort-<key>\`）。` +
            '搬回页头不只是"多一件"：它会重新引入"空列表时整枚消失"那个形状（它 gate 在 visible.length 上）。',
        ]);
      }
    }
  }

  /* ── 格 5：动作行不许住进列表体 ───────────────────────────────── */
  /**
   * 🔴 必须看**每一处**渲染点的位置，不能只看 `indexOf` 的第一处：
   * 第一处永远是助手槽里那一份（它是合规的），第二个渲染点再搬进列表体时，
   * `indexOf` 仍然指回第一处 —— 判据恒绿。这条在自检臂 F 上抓过。
   */
  const prioritizeAt = [...app.matchAll(/<AiPrioritize/g)].map((m) => m.index ?? -1);
  const aiPanelsIdx = app.indexOf('const aiPanels = (');
  if (prioritizeAt.length === 0) {
    problems.push([
      'prioritize-missing',
      '`<AiPrioritize` 在源码里找不到了 —— 它应当渲染在对话助手的组织类动作槽里。' +
        '整个删掉不是"更简洁"，是把一个已交付的 AI 能力从界面上摘掉。',
    ]);
  } else {
    if (prioritizeAt.length !== 1) {
      problems.push([
        'prioritize-duplicated',
        `\`<AiPrioritize\` 出现了 ${String(prioritizeAt.length)} 次 —— 只能有一处渲染点。`,
      ]);
    }
    if (aiPanelsIdx >= 0 && prioritizeAt.some((at) => at > aiPanelsIdx)) {
      problems.push([
        'action-in-list',
        '`<AiPrioritize` 出现在 `const aiPanels` **之后** —— 它又被写回主内容区了。' +
          '动作不住进列表体：列表体里只有任务行，否则每一行"点下去会发生什么"都要先分辨身份。',
      ]);
    }
    if (contentAt >= 0 && prioritizeAt.some((at) => at > contentAt)) {
      problems.push([
        'action-in-list',
        '`<AiPrioritize` 出现在 `className="ht-content"` **之后** —— 它回到了列表体里。' +
          '它的落点是助手面板的 `orgActions` 槽（那里才是"跟助手有关的动作"唯一能找到的地方）。',
      ]);
    }
  }

  /* ── 格 6：助手面板那个槽仍然接着 ─────────────────────────────── */
  if (!app.includes('orgActions={aiPrioritizeAction}')) {
    problems.push([
      'org-slot-unwired',
      '`orgActions={aiPrioritizeAction}` 不见了 —— 动作定义还在，但没有挂到助手面板上，' +
        '等于把它从界面上摘掉而源码里看起来还有。',
    ]);
  }

  /* ── 格 7：页头动作区只有一处 ─────────────────────────────────── */
  const headerRegions = count(app, 'className="ht-header__actions"');
  if (headerRegions > 1) {
    problems.push([
      'header-duplicated',
      `\`className="ht-header__actions"\` 出现了 ${String(headerRegions)} 处 —— ` +
        '第二个动作区等于在别的地方又开一排控件，而上面所有格只量第一段。',
    ]);
  }
}

for (const [code, message] of problems) {
  console.log(`❌ ${code}：${message}`);
}

if (problems.length === 0) {
  console.log('✅ 界面控件预算：页头只有图标按钮 + 一枚 ⋯ / 没有原生下拉与文字标签控件 / 动作不在列表体里。');
}

/* ── 自检：七臂都必须红，另有一条阳性对照 ────────────────────────── */

const MUTATIONS = {
  'menu-missing': (files) => {
    files[APP] = files[APP].replace('data-testid="task-menu-open"', 'data-testid="something-else"');
  },
  'menu-duplicated': (files) => {
    // 在详情开关旁边再插一枚 `⋯` 触发者 —— 第二入口的形状。
    files[APP] = files[APP].replace(
      'data-testid="detail-pane-toggle"',
      'data-testid="task-menu-open-2" data-x="task-menu-open"',
    );
    files[APP] = files[APP].replace('"task-menu-open-2"', '"task-menu-open"');
  },
  'header-native-select': (files) => {
    files[APP] = files[APP].replace(
      'data-testid="detail-pane-toggle"',
      'data-testid="detail-pane-toggle"><select aria-label="x" />',
    );
  },
  'header-labelled-control': (files) => {
    files[APP] = files[APP].replace(
      'data-testid="detail-pane-toggle"',
      'data-testid="detail-pane-toggle"><label>x</label>',
    );
  },
  'sort-back-in-header': (files) => {
    files[APP] = files[APP].replace(
      'data-testid="detail-pane-toggle"',
      'data-testid="detail-pane-toggle"><select data-testid="task-sort-select" />',
    );
  },
  'action-in-list': (files) => {
    /* 在列表体里再放一份渲染点 —— 正是"动作行搬回列表体"的形状
       （同时会撞上格 5 的"只许一处"，两条都是这条臂要说的话）。 */
    files[APP] = files[APP].replace(
      'className="ht-content"',
      'className="ht-content"><AiPrioritize tasks={[]} routing={aiRouting} consents={[]} secrets={aiSecrets} onApply={async () => {}}',
    );
  },
  'org-slot-unwired': (files) => {
    files[APP] = files[APP].replace('orgActions={aiPrioritizeAction}', 'orgActions={null}');
  },
};

const ARMS = [
  ['A 删掉页头那枚 ⋯ ⇒ 红并点名 menu-missing', 'menu-missing'],
  ['B 页头再开一枚 ⋯ ⇒ 红并点名 menu-duplicated', 'menu-duplicated'],
  ['C 页头塞回一枚原生下拉 ⇒ 红并点名 header-native-select', 'header-native-select'],
  ['D 页头塞回"文字标签 + 控件" ⇒ 红并点名 header-labelled-control', 'header-labelled-control'],
  ['E 排序以常驻控件形状回到页头 ⇒ 红并点名 sort-back-in-header', 'sort-back-in-header'],
  ['F 动作行搬进列表体 ⇒ 红并点名 action-in-list', 'action-in-list'],
  ['G 摘掉助手的动作槽 ⇒ 红并点名 org-slot-unwired', 'org-slot-unwired'],
];

function fixtureRoot(apply) {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-surface-budget-'));
  const abs = join(ROOT, APP);
  if (!existsSync(abs)) throw new Error(`夹具缺文件：${APP}`);
  const files = { [APP]: readFileSync(abs, 'utf8') };
  if (apply) apply(files);
  for (const rel of Object.keys(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, files[rel]);
  }
  return dir;
}

function runGate(root) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, HEYTA_CHECK_ROOT: root },
    encoding: 'utf8',
  });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

function selfTest() {
  let failures = 0;

  const clean = fixtureRoot(null);
  try {
    const out = runGate(clean);
    if (out.includes('❌')) {
      console.log(`❌ 阳性对照失败：合规现状被报红\n${out.slice(0, 240)}`);
      failures += 1;
    } else {
      console.log('✅ 阳性对照：现状（页头 = 图标按钮 + 一枚 ⋯、动作在助手槽里）⇒ 零报红');
    }
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }

  for (const [label, code] of ARMS) {
    const mutate = MUTATIONS[code];
    let dir;
    let out = '';
    let applied = false;
    try {
      dir = fixtureRoot((files) => {
        const before = JSON.stringify(files);
        mutate(files);
        applied = JSON.stringify(files) !== before;
      });
      if (!applied) {
        console.log(`❌ 臂 ${label} —— 病灶没注进去（源码形状变了，臂要跟着改）`);
        failures += 1;
        continue;
      }
      out = runGate(dir);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
    const hit = out.includes('❌') && out.includes(`${code}：`);
    if (hit) {
      console.log(`✅ 臂 ${label}`);
    } else {
      console.log(`❌ 臂 ${label} —— 注入病灶后没红，或红在了别的码上：\n${out.slice(0, 240)}`);
      failures += 1;
    }
  }

  console.log(`\n臂数 ${String(ARMS.length)}（由本脚本自己打印），失败 ${String(failures)}`);
  if (failures > 0) process.exit(1);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else if (problems.length > 0) {
  process.exit(1);
}
