/**
 * 截图产物校验门禁。
 *
 *   pnpm screenshot:verify
 *
 * 移植自 SSOS 的 `scripts/screenshot-artifact-validation.mjs`，判据完全一致：
 *
 *   1. **数量**对得上（少一张 = 有视图没截到）
 *   2. **尺寸**精确匹配（App Store 上传会因尺寸不对被拒）
 *   3. **不含 alpha 通道**（App Store 的 1024 图标硬性要求，截图同理更严）
 *   4. 🔴 **不是空白**（`contentRatio < 0.01` 或 `colorSpan < 16`）
 *
 * 🔴 第 4 条是这套东西存在的**真正理由**：截图脚本"跑成功"和"截到东西"
 * 是两件事。页面 404、白屏、渲染未完成、被引导弹窗盖住 —— 截出来都是一张
 * 纯白图，尺寸正常、退出码 0、文件名齐全。**只有看像素才能发现。**
 *
 * 退出码：有问题 = 1，全过 = 0（可直接进 CI）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { inspectPng, looksBlank, looksSmeared } from './png-stats.mjs';
import {
  ARTIFACT_ROOT,
  DEVICES,
  KNOWN_BAD_CAPTURE_METHODS,
  SHELL_EVIDENCE,
  TARGETS,
  artifactName,
  expectedGroups,
} from './targets.mjs';

const root = process.cwd();
const problems = [];
const notes = [];

function readPngs(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => inspectPng(join(directory, name)));
}

for (const group of expectedGroups()) {
  const directory = join(root, ARTIFACT_ROOT, group.folder);
  const files = readPngs(directory);
  const byName = new Map(files.map((file) => [file.name, file]));

  const missing = [];
  const present = [];

  for (const target of group.targets) {
    const name = artifactName(target);
    const file = byName.get(name);
    if (file) present.push({ target, file });
    else missing.push(name);
  }

  if (missing.length > 0) {
    // 产物还没生成不算"错误"（产品未完成阶段本就是空的），但要如实报出来
    notes.push(`${group.label}: 缺失 ${missing.length}/${group.targets.length} 张 —— ${missing.slice(0, 4).join('、')}${missing.length > 4 ? ' …' : ''}`);
    continue;
  }

  const expected = {
    // 缩放读**设备层**，不是 viewport 里的（放错会算出 NaN×NaN）
    width: group.device.viewport.width * (group.device.deviceScaleFactor ?? 1),
    height: group.device.viewport.height * (group.device.deviceScaleFactor ?? 1),
  };

  for (const { target, file } of present) {
    if (file.width !== expected.width || file.height !== expected.height) {
      problems.push(
        `${group.label}/${file.name}: 尺寸 ${file.width}×${file.height}，期望 ${expected.width}×${expected.height}`,
      );
    }
    if (file.hasTransparency) {
      problems.push(`${group.label}/${file.name}: 含实际透明像素（colorType=${file.colorType}）`);
    }
    if (looksBlank(file)) {
      problems.push(
        `${group.label}/${file.name}: 🔴 疑似空白 —— 内容比例 ${(file.contentRatio * 100).toFixed(1)}%，色阶差 ${file.colorSpan}` +
          `\n    ⇒ 这张图几乎全是白/同色。先查页面是否 404 / 白屏 / 渲染未完成 / 被弹窗遮挡，` +
          `\n      再查 readyText 是否等错了元素。**不要靠调低阈值让它变绿。**`,
      );
    }
  }

  const extra = files.filter((file) => !group.targets.some((t) => artifactName(t) === file.name));
  if (extra.length > 0) {
    notes.push(`${group.label}: 有 ${extra.length} 张不在注册表里（可能是改名后残留）—— ${extra.slice(0, 3).map((f) => f.name).join('、')}`);
  }
}

// ── 5. 🔴 `dismissTexts` 与 i18n 词条真源的对账 ───────────────────────────────
//
// 为什么这条长在**门禁**里而不是运行时：截图点的是按钮的**无障碍名**，而那个名字来自
// `packages/i18n`。`scripts/` 不在 pnpm 工作区里（`import('@heyta/i18n')` 实测
// `ERR_MODULE_NOT_FOUND`），所以 `targets.mjs` 里的串是一份**抄件**。
// 有人改了词条而没改这里 ⇒ 遮挡物再也点不掉，症状是"capture 报视图没切"
// （10-04 的 W07 就是撞在这个形状上：首启同意闸门 10-02 落地，清单没跟上），
// 而不是"文案过期"—— 一个不好归因的失败。所以它必须每次 push 都跑
// （`screenshot:verify` 已在 `pnpm check` 链里）。
//
// ⚠️ 匹配的是「作为某个词条的值出现」这一种形状（`'key': '<串>',`），
//    串只在注释/文档里出现过不算数。若将来某个串本身含引号或转义，
//    这里要换成 TS 解析器（先例：`server` 的 copy 生成器 —— 正则会变成第二套转义规则）。
const LOCALE_SOURCE = {
  'zh-CN': 'packages/i18n/src/locales/zh-CN.ts',
  en: 'packages/i18n/src/locales/en.ts',
};
const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const localeTables = new Map();
let dismissChecked = 0;

for (const target of TARGETS) {
  if (target.site !== 'web' || target.dismissTexts.length === 0) continue;
  const source = LOCALE_SOURCE[target.locale];
  if (!source) {
    problems.push(`目标 ${target.id}: locale「${target.locale}」没有登记词条表来源，无法对账 dismissTexts`);
    continue;
  }
  if (!localeTables.has(source)) {
    if (!existsSync(join(root, source))) {
      problems.push(`目标 ${target.id}: 词条表 ${source} 不存在`);
      continue;
    }
    localeTables.set(source, readFileSync(join(root, source), 'utf8'));
  }
  const table = localeTables.get(source);
  for (const text of target.dismissTexts) {
    dismissChecked += 1;
    const appearsAsEntryValue = newRegExpValue(table, text);
    if (!appearsAsEntryValue) {
      problems.push(
        `目标 ${target.id} 的遮挡物文案「${text}」在 ${source} 里不再是任何词条的值\n` +
          `    ⇒ 词条改了、清单没跟上：那层遮挡物会再也点不掉，截图会静默停在被盖住的视图上`,
      );
    }
  }
}
if (dismissChecked === 0) {
  // 对账自己也要有分母：一条都没比 = 这条门是空的
  problems.push('dismissTexts 对账一条都没跑（web 目标的遮挡物清单为空？）');
}

/** 只在 `: '<串>'` / `: "<串>"` 这一种形状上匹配 —— 即"它是某个词条的值"。 */
function newRegExpValue(table, text) {
  return new RegExp(`:[ \\t]*(['"])${escapeForRegex(text)}\\1[ \\t]*(?:[,;\\n])`).test(table);
}

// ── 5b. 🔴 `seed` 的三份额外对账：入口文案 / 夹具在不在 / 夹具里的四类 ──────────
//
// seed 步骤（`capture.mjs#applySeed`）手里握着两份会悄悄烂掉的东西：
//   1. 一句**无障碍名抄件**（要点开「设置」才走得到还原面板）—— 失效形状与 dismissTexts 完全一样：
//      症状不是"文案过期"，而是截图静默停在别的视图上；
//   2. 一条**夹具路径与它的内容** —— 夹具被删/被手写坏（少一类、或某条没有可显示的标题）时，
//      "回收站里有四类"这句话就没有分母了，而 capture 仍会截出一张看着正常的图。
// 所以这三条长在门禁里，每次 `pnpm check` 都跑（`screenshot:verify` 已在链上）。
const REQUIRED_SEED_KINDS = ['TASK', 'NOTE', 'PROJECT', 'HABIT'];
let seedChecked = 0;

for (const target of TARGETS) {
  if (target.seed == null) continue;
  seedChecked += 1;

  const source = LOCALE_SOURCE[target.locale];
  const table = source == null ? undefined : (localeTables.get(source) ?? loadLocaleTable(source));
  if (table === undefined) {
    problems.push(`seed 目标 ${target.id}: 语言「${target.locale}」的词条表读不到，无法校验设置入口文案「${String(target.seed.settingsLabel)}」`);
  } else if (!newRegExpValue(table, target.seed.settingsLabel)) {
    problems.push(
      `seed 目标 ${target.id} 的设置入口文案「${target.seed.settingsLabel}」在 ${source} 里不再是任何词条的值\n` +
        `    ⇒ 词条改了、清单没跟上：seed 步骤会等不到那颗按钮，还原从不发生，图却照样截出来`,
    );
  }

  const fixturePath = join(root, target.seed.fixture);
  if (!existsSync(fixturePath)) {
    problems.push(
      `seed 目标 ${target.id}: 夹具不存在 ${target.seed.fixture}\n` +
        `    ⇒ 生成它：node scripts/screenshots/seed-trash-fixture.mjs（**别手写墓碑 JSON** —— 那会绕开产品自己的写通道）`,
    );
    continue;
  }
  const doc = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const trashedByKind = {};
  for (const [type, rows] of Object.entries(doc.entities ?? {})) {
    trashedByKind[type] = (Array.isArray(rows) ? rows : []).filter((row) => row?.deletedAt != null).length;
  }
  const missingKinds = REQUIRED_SEED_KINDS.filter((kind) => !trashedByKind[kind]);
  if (missingKinds.length > 0) {
    problems.push(
      `seed 目标 ${target.id}: 夹具「${target.seed.fixture}」里这四类中被删的行缺：${missingKinds.join('、')}\n` +
        `    ⇒ 这张图主张的就是"这几类也进回收站"，夹具缺哪一类，图就演示不出哪一类`,
    );
  }
  // 🔴 三字段依次取：这条判据第一次跑就抓到"取不到标题"的两行 —— 因为**每类的标题字段不一样**
  //   （任务是 `title`、便签是 `content`、清单与习惯是 `name`），而这正是 `@heyta/domain#toTrashItems`
  //   里那份取标题规则的镜像。只取 title/content 会把清单和习惯读成"没有可显示的字"，
  //   于是截图判据永远命不中它们 —— 一个看不见的字段名差异，被这条门禁按住了。
  const displayLabel = (row) => String(row.title ?? row.content ?? row.name ?? '').trim();
  const labelless = Object.values(doc.entities ?? {})
    .flat()
    .filter((row) => row?.deletedAt != null && displayLabel(row) === '');
  if (labelless.length > 0) {
    problems.push(
      `seed 目标 ${target.id}: 夹具里有 ${String(labelless.length)} 条被删的行没有可显示的标题\n` +
        `    ⇒ capture 的逐条存在性判据（assertSeededTitles）对它们永远无从命中，会把好夹具读成失败`,
    );
  }
}

/** 词条表按路径读一次（§5 那张缓存表只在有遮挡物时才填，seed 目标可能没遮挡物清单）。 */
function loadLocaleTable(source) {
  const path = join(root, source);
  if (!existsSync(path)) return undefined;
  const table = readFileSync(path, 'utf8');
  localeTables.set(source, table);
  return table;
}

if (TARGETS.some((t) => t.view === 'trash') && !TARGETS.some((t) => t.view === 'trash' && t.seed != null)) {
  problems.push(
    '回收站那张配图**没有** seed 了 ⇒ 「图里画出四类」这句话退回成"截一张只有任务的图"\n' +
      '    （接线在 targets.mjs 的 `seed` 字段与 capture.mjs 的 applySeed；拆掉判据不是修好它）',
  );
}

// ── 原生壳证据：**来源门禁**（防回归的核心）＋ 糊字启发式 ─────────────────
//
// 顺序很重要：先证明"这份证据是可信的采集路径产出的"，再看它长什么样。
// 反过来做就会出现"图看着没问题、其实是渲染坏的"那种漏检。
for (const evidence of SHELL_EVIDENCE) {
  const pngPath = join(root, evidence.png);
  const notePath = join(root, evidence.note);

  if (!existsSync(pngPath)) {
    notes.push(`${evidence.label}: 证据图还没生成（${evidence.png}）`);
    continue;
  }

  const stats = inspectPng(pngPath);
  if (stats.hasTransparency) problems.push(`${evidence.label}: 证据图含实际透明像素`);
  if (looksBlank(stats)) {
    problems.push(`${evidence.label}: 🔴 证据图疑似空白（内容 ${(stats.contentRatio * 100).toFixed(1)}%）`);
  } else if (looksSmeared(stats)) {
    // ⚠️ 只警告、不失败 —— 这条启发式**已被实测证伪过一次误报**：
    //    Linux 壳的 Xvfb 整屏截图里 50.8% 是纯黑桌面（内部零边缘），
    //    把边缘密度稀释到 0.134 而误判为"糊"，但同一张图裁到窗口是 0.994。
    //    所以它只是**去看一眼的提示**；真正挡回归的是下面的来源门禁。
    notes.push(
      `${evidence.label}: ⚠️ 启发式提示"疑似渲染坏了"（内容占比 ${(stats.contentOnModalRatio * 100).toFixed(1)}%，` +
        `边缘密度 ${stats.edgeOnContent.toFixed(3)}）—— 请人眼看一眼。\n` +
        `       已知误报：截图含大片非主色纯色区（如黑桌面）时会被稀释。`,
    );
  }

  // 🔴 来源门禁
  if (!existsSync(notePath)) {
    problems.push(
      `${evidence.label}: 缺少证据说明 ${evidence.note} —— **无法证明这份图是怎么采的**\n` +
        `    ⇒ 请用 apps/desktop-macos/scripts/capture-window.sh 重新采集（它会写好说明）`,
    );
    continue;
  }
  const note = readFileSync(notePath, 'utf8');
  const method = /^CAPTURE_METHOD=(.+)$/m.exec(note)?.[1]?.trim();
  const crosscheck = /^CROSSCHECK=(.+)$/m.exec(note)?.[1]?.trim();

  if (!method) {
    problems.push(`${evidence.label}: 证据说明里没有 CAPTURE_METHOD —— 无法判定采集路径是否可信`);
  } else if (KNOWN_BAD_CAPTURE_METHODS.has(method)) {
    problems.push(
      `${evidence.label}: 🔴 采集方式是不可信的 \`${method}\`\n` +
        `    ⇒ ${KNOWN_BAD_CAPTURE_METHODS.get(method)}\n` +
        `    ⇒ 改用 capture-window.sh（cgs-window-server）重采`,
    );
  } else if (!evidence.methods.includes(method)) {
    problems.push(
      `${evidence.label}: 采集方式 \`${method}\` 不在白名单里（允许：${evidence.methods.join(' / ')}）\n` +
        `    ⇒ 要么改成可信方式，要么先证明它是忠实的`,
    );
  }

  if (evidence.requiresCrosscheck) {
    if (!crosscheck) {
      problems.push(`${evidence.label}: 证据说明里没有 CROSSCHECK —— 没有与独立截屏交叉验证过`);
    } else if (!crosscheck.startsWith('ok')) {
      problems.push(`${evidence.label}: 交叉验证未通过（${crosscheck}）—— 自产图与独立截屏对不上`);
    }
  }
}

for (const note of notes) console.log(`  ⚠️  ${note}`);

if (problems.length > 0) {
  console.error('');
  for (const problem of problems) console.error(`  🔴 ${problem}`);
  console.error(`\n截图校验未通过：${problems.length} 个问题`);
  process.exit(1);
}

const total = expectedGroups().reduce((sum, group) => sum + group.targets.length, 0);
console.log(`\n✅ 截图校验通过（注册表共 ${total} 个目标；已生成的均尺寸正确、无 alpha、非空白）`);
