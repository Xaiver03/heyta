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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

/** 字号档位与配色族的**预算**（2026-11-02 的实测值，只许降不许升）。
 *
 * 数据来源（复量命令在 `docs/plans/surface-budget.md` §6）：
 *   · `apps/web` 全部 CSS 用到 **6** 档字号（2xs/xs/sm/base/lg/xl），单文件最多 **5**；
 *   · 色相族用到 **6** 个（primary / danger / warning / success / quadrant / info），单文件最多 **5**。
 *
 * 🔴 这两个数不是审美判断，是**加法预算**：每多一档字号/一个色相族，界面就多一种
 * "这可能是重点"的暗示，而没有任何既有门禁会因此变红（它们全都是合法 token）。
 * 写成上限以后，**加一档就必须先删一档** —— 这正是这一轮在页头上做的事，
 * 只不过页头量的是"件数"，这里量的是"档数"。 */
const FONT_RUNG_CEILING = 6;
const FONT_RUNG_PER_FILE = 5;
const HUE_FAMILY_CEILING = 6;
const HUE_FAMILY_PER_FILE = 5;

/**
 * 页头非模式段的**可交互件**上限 = **2**：一枚 `⋯` + 一枚结构开关。
 *
 *   1. `task-menu-open` —— `⋯`（规则 R1 的主语，唯一的功能入口）；
 *   2. `detail-pane-toggle` —— 详情列的结构开关（几何不可行的档位由 CSS 藏掉）。
 *
 * 🔴 2026-11-02 第三刀把上限从 3 收到 2：当时第三枚是「详情列收起时的助手回退按钮」，
 * 于是**宽档收起详情列**这一态下页头会同时有三枚。现在助手入口搬进 `⋯`
 * （`assistant-open` 这个 testid 跟着搬），展开详情列的入口也进了 `⋯`，
 * 页头在**每一档**都只剩「一枚图标 + 一枚 ⋯」。
 *
 * ⚠️ 上一版这里写着"助手入口不能塞进会卸载的菜单，因为焦点要还给它" ——
 * 那句话**是错的**，实测推翻：`assistantTriggerRef` 从来没有被读过，
 * 焦点归还是浮层自己捕获 `document.activeElement` 做的。所以只要在选中时
 * 先把焦点交回 `⋯` 触发者，归还原样成立（e2e `assistant-hosted-ux` 钉的就是这一格）。
 */
const HEADER_CONTROL_CEILING = 2;

/** 量档数/色相的那一层：web 壳的样式表（不是组件内联样式）。 */
const STYLE_DIR = 'apps/web/src/styles';

/**
 * **做事面**（不是设置面）：任务列、捕获框、对话助手。
 *
 * 🔴 这一组是"主界面不许有说明文字"那条禁令的射程。设置面由
 * `check:settings-no-prose` 管（那里是账本制、已清到 0）；而**主界面此前没有任何
 * 门禁在看** —— 于是 2026-11-02 有一句「也可以直接粘贴截图」被
 * `CaptureComposer` 与 `AssistantPanel` 各挂一次，一屏两遍，产品负责人第三次为
 * 同一件事发火。这条臂就是补那个洞。
 */
const PRIMARY_SURFACE_ROOTS = [
  'apps/web/src/features/tasks',
  'apps/web/src/features/capture',
  'apps/web/src/features/ai',
];

/** 说明容器的类名形状（`__hint` / `-hint`）。 */
const HINT_CLASS_RE = /className=(?:"|\{`)[^"'`]*?(?:__hint|-hint)/;

/**
 * 这一处是不是**反馈**而不是解释。
 *
 * 判据看**同一个元素**（从 `<` 扫到配平的 `>`），不是看邻居 —— 否则
 * "下面三行有个 `role=\"status\"` 的兄弟"就能给一段散文开绿灯。
 */
const FEEDBACK_RE = /role="(?:status|alert)"|aria-live=|role=\{(?:isAlert|feedback)[^}]*\}|data-[a-z-]*disclosure|data-testid="[^"]*(?:failure|error|status|notice|warn)/;

/** 从 index 处的 `<` 向前找元素起点，再扫到配平的 `>`，返回那段源码。 */
function elementAt(text, index) {
  const start = text.lastIndexOf('<', index);
  if (start < 0) return text.slice(index, index + 200);
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start, start + 400);
}

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

  /* ── 格 10：页头非模式段的**可交互件数** ──────────────────────── */
  if (headerStart >= 0 && contentAt > headerStart) {
    // 复用上面切好的那段：批量栏是模式态，不算常驻控件。
    const headerEnd2 = app.lastIndexOf('<', contentAt);
    const header2 = app.slice(headerStart, headerEnd2);
    const bulkFrom2 = header2.indexOf('"bulk-toolbar"');
    const bulkTo2 = header2.indexOf('"bulk-exit"');
    const nonMode2 =
      bulkFrom2 >= 0 && bulkTo2 > bulkFrom2
        ? `${header2.slice(0, bulkFrom2)}${header2.slice(bulkTo2)}`
        : header2;
    const controls = count(nonMode2, '<button');
    if (controls > HEADER_CONTROL_CEILING) {
      problems.push([
        'header-control-count',
        `页头非模式段有 ${String(controls)} 枚可交互件（上限 ${String(HEADER_CONTROL_CEILING)}）—— ` +
          '「一个功能一个控件」就是这样长回来的：每一次加都在预算内，加起来就超了。' +
          '新动作放进 `⋯`，不要占页头。',
      ]);
    }
  }
}

/* ── 格 11：做事面上不许有说明文字（`__hint` / `-hint` 容器） ──────── */
{
  const files = [];
  for (const root of PRIMARY_SURFACE_ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    const walk = (dir, rel) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const childAbs = join(dir, entry.name);
        const childRel = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(childAbs, childRel);
        else if (/\.tsx$/.test(entry.name)) files.push([childRel, readFileSync(childAbs, 'utf8')]);
      }
    };
    walk(abs, root);
  }
  if (existsSync(join(ROOT, APP))) files.push([APP, readFileSync(join(ROOT, APP), 'utf8')]);

  for (const [rel, raw] of files) {
    const body = stripComments(raw);
    for (const match of body.matchAll(new RegExp(HINT_CLASS_RE.source, 'g'))) {
      const element = elementAt(body, match.index ?? 0);
      if (FEEDBACK_RE.test(element)) continue;
      problems.push([
        'primary-prose',
        `${rel} 的 ${element.split('\n')[0].trim().slice(0, 80)} —— ` +
          '做事面上不许有说明容器（`__hint` / `-hint`）。解释只有一种合法载体：' +
          '一个圈里的问号（`InfoTip`），或者干脆不解释。' +
          '反馈（`role="status"` / `aria-live` / 披露标记）不算解释，本格已豁免。',
      ]);
    }
  }
}

/* ── 格 8 / 9：字号档数与色相族（量的是样式表，不是 App.tsx） ──────── */
{
  const styleAbs = join(ROOT, STYLE_DIR);
  if (!existsSync(styleAbs)) {
    problems.push(['style-dir-missing', `${STYLE_DIR} 读不到 —— 格 8/9 没有对象可量。`]);
  } else {
    const cssFiles = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.name.endsWith('.css')) cssFiles.push(abs);
      }
    };
    walk(styleAbs);

    const rungsAll = new Set();
    const huesAll = new Set();
    const HUE_RE = /--ht-color-(primary|danger|warning|success|info|category|quadrant|priority|heat)/g;
    for (const abs of cssFiles) {
      const body = stripComments(readFileSync(abs, 'utf8'));
      const rel = abs.slice(join(ROOT, '').length);
      const rungs = new Set([...body.matchAll(/--ht-font-size-([a-z0-9]+)/g)].map((m) => m[1]));
      const hues = new Set([...body.matchAll(HUE_RE)].map((m) => m[1]));
      for (const rung of rungs) rungsAll.add(rung);
      for (const hue of hues) huesAll.add(hue);
      if (rungs.size > FONT_RUNG_PER_FILE) {
        problems.push([
          'font-rungs-per-file',
          `${rel} 用了 ${String(rungs.size)} 档字号（单文件上限 ${String(FONT_RUNG_PER_FILE)}）。` +
            '一屏的层级靠**拉开**而不是靠**多发几档**：相邻两档只差 1–2px 时，',
        ]);
      }
      if (hues.size > HUE_FAMILY_PER_FILE) {
        problems.push([
          'hue-families-per-file',
          `${rel} 用了 ${String(hues.size)} 个色相族（单文件上限 ${String(HUE_FAMILY_PER_FILE)}）—— ` +
            '同一屏里三个以上色相族在抢注意力时，用户读到的是"到处都重要"。',
        ]);
      }
    }

    if (rungsAll.size > FONT_RUNG_CEILING) {
      problems.push([
        'font-rungs-global',
        `apps/web 的样式表一共用了 ${String(rungsAll.size)} 档字号（上限 ${String(FONT_RUNG_CEILING)}）：` +
          `${[...rungsAll].sort().join(' / ')} —— 加一档必须先删一档（见 docs/plans/surface-budget.md §1.1）。`,
      ]);
    }
    if (huesAll.size > HUE_FAMILY_CEILING) {
      problems.push([
        'hue-families-global',
        `apps/web 的样式表一共用了 ${String(huesAll.size)} 个色相族（上限 ${String(HUE_FAMILY_CEILING)}）：` +
          `${[...huesAll].sort().join(' / ')} —— 含义一多就发一个新颜色，是这一轮之前最典型的加法。`,
      ]);
    }
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
  'font-rungs-global': (files) => {
    files['apps/web/src/styles/app/menu.css'] +=
      '\n.ht-fixture { font-size: var(--ht-font-size-3xl); }\n';
  },
  'hue-families-global': (files) => {
    files['apps/web/src/styles/app/menu.css'] +=
      '\n.ht-fixture { color: var(--ht-color-heat-1); }\n';
  },
  'primary-prose': (files) => {
    files['apps/web/src/features/ai/ImageAttach.tsx'] = files['apps/web/src/features/ai/ImageAttach.tsx'].replace(
      '<span className="ht-capture-attach__picker"',
      '<span className="ht-capture-attach__hint">粘贴也能加图</span><span className="ht-capture-attach__picker"',
    );
  },
  'header-control-count': (files) => {
    files[APP] = files[APP].replace(
      'data-testid="detail-pane-toggle"',
      'data-testid="detail-pane-toggle"><button type="button" data-testid="extra-control"',
    );
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
  ['H 样式表多开一档字号 ⇒ 红并点名 font-rungs-global', 'font-rungs-global'],
  ['I 样式表多开一个色相族 ⇒ 红并点名 hue-families-global', 'hue-families-global'],
  ['J 页头再塞一枚控件 ⇒ 红并点名 header-control-count', 'header-control-count'],
  ['K 做事面塞回一句说明文字 ⇒ 红并点名 primary-prose', 'primary-prose'],
];

function fixtureRoot(apply) {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-surface-budget-'));
  const abs = join(ROOT, APP);
  if (!existsSync(abs)) throw new Error(`夹具缺文件：${APP}`);
  const files = { [APP]: readFileSync(abs, 'utf8') };

  /**
   * 🔴 样式表必须一起进夹具：格 8/9 量的是 `apps/web/src/styles/**`。
   * 只复制 `App.tsx` 的话，这两格在夹具里**永远对着空目录**跑 ——
   * 于是"病灶注入后必须红"的臂会因为"没东西可量"而绿（或因为目录不存在而红错码）。
   * 这一条是写臂的时候自己撞出来的。
   */
  /**
   * 做事面的源文件也进夹具（格 11 扫它们）。同一条理由：
   * 只复制 `App.tsx` 的话，"注入一段说明文字必须红"的臂会对着空清单跑。
   */
  for (const root of PRIMARY_SURFACE_ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    const walk = (dir, rel) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const childAbs = join(dir, entry.name);
        const childRel = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(childAbs, childRel);
        else if (/\.tsx$/.test(entry.name)) files[childRel] = readFileSync(childAbs, 'utf8');
      }
    };
    walk(abs, root);
  }

  const styleAbs = join(ROOT, STYLE_DIR);
  if (existsSync(styleAbs)) {
    const walk = (src, relBase) => {
      for (const entry of readdirSync(src, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const childAbs = join(src, entry.name);
        const childRel = `${relBase}/${entry.name}`;
        if (entry.isDirectory()) walk(childAbs, childRel);
        else if (entry.name.endsWith('.css')) files[childRel] = readFileSync(childAbs, 'utf8');
      }
    };
    walk(styleAbs, STYLE_DIR);
  }

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
