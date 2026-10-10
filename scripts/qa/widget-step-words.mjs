#!/usr/bin/env node
/**
 * 「PWA 安装步骤」与「原生小组件步骤」的**唯一区分依据**，从产品真源读，不给装置各写一份。
 *
 * 为什么要收到这一枚文件里（10-10 03:1x 现量撞出来的）：两枚壳级取证装置都在判
 * "原生壳里不许出现安装引导"，而它们用的都是**形状**判据 —— Windows 那枚挑
 * `testid ^= "web.widgetJourney." && *= ".step"`，macOS 那枚挑 "行文本以 `1.`/`2.`/`3.` 开头"。
 * 产品那侧两套步骤的键名分别是
 * · 安装步骤：`web.widgetJourney.{windows,macos,other}.stepN`
 * · 原生小组件步骤：`web.widgetJourney.native.{macos,windows}.step1` + `web.widgetJourney.native.choose`
 * —— **两套都带 `.step`、都在 `web.widgetJourney.` 之下、都会渲染成带序号的行**。
 * 所以壳真的注入了小组件桥（= 产品该有的样子）时，两把尺都会把"引导用户往桌面加小组件"
 * 读成"对着已装好的应用教怎么装应用"，也就是**在正确的界面上报红**。
 *
 * 判据因此只能按**键名集合**判，而键名集合的唯一事实源是 `apps/web/src/pwa/widget-install.ts`
 * 里那两支函数。这里读它，读空就响亮失败 —— 与装置里 `SHELL_MESSAGE_HANDLER_NAMES` 同一口径。
 */
import { readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(import.meta.dirname, '..', '..');
const SOURCE = 'apps/web/src/pwa/widget-install.ts';

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** 从 `startMarker` 到 `endMarker` 之间切出函数体（按源码位置，不按行数）。 */
function sliceFunction(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`${SOURCE} 里找不到 ${startMarker} —— 判据的名单是承重的，不许退回硬编码`);
  const end = endMarker === null ? text.length : text.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${SOURCE} 里 ${startMarker} 之后找不到 ${endMarker}，切不出函数体`);
  return text.slice(start, end);
}

/** 从一段源码里收全部 `web.widgetJourney.*` 词条键（去重、保序）。 */
function collectKeys(body) {
  const keys = [...new Set([...body.matchAll(/'(web\.widgetJourney\.[^']+)'/g)].map((m) => m[1]))];
  if (keys.length === 0) {
    throw new Error(`${SOURCE} 里那一段一个 web.widgetJourney.* 键都没读到 —— 读空不许当通过`);
  }
  return keys;
}

export const installStepKeys = () =>
  collectKeys(sliceFunction(readFileSync(resolve(REPO, SOURCE), 'utf8'), 'export function installSteps(', 'export function nativeWidgetSteps('));

/**
 * 到文件末尾为止。⚠️ 这一档的前提是 `nativeWidgetSteps` 是该文件**最后一个导出** ——
 * 现量：`awk 'NR>213 && /web\\.widgetJourney/'` 为空、文件共 213 行。它之后若新增导出，
 * 这里的键集合会跟着变宽，所以改这个文件的人必须回来重跑本模块（读空/读宽都会在这一步现形）。
 */
export const nativeStepKeys = () =>
  collectKeys(sliceFunction(readFileSync(resolve(REPO, SOURCE), 'utf8'), 'export function nativeWidgetSteps(', null));

/**
 * 取某批键在**中英两份词条表里的原文**（macOS 那枚装置走 Accessibility，只拿得到文本拿不到 testid，
 * 所以它判"是不是安装引导"必须按文本，而文本也只能从词条真源来）。
 * 任何一枚键在任何一份表里缺值都直接抛 —— 静默少一枚就等于那道判据少一格。
 */
export function stepTexts(keys) {
  const files = { zh: 'packages/i18n/src/locales/zh-CN.ts', en: 'packages/i18n/src/locales/en.ts' };
  const tables = Object.fromEntries(
    Object.entries(files).map(([tag, path]) => [tag, readFileSync(resolve(REPO, path), 'utf8')]),
  );
  const texts = [];
  for (const key of keys) {
    for (const tag of Object.keys(tables)) {
      const m = tables[tag].match(new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)"|\`((?:[^ \`\\\\]|\\\\.)*)\`)`));
      if (!m) throw new Error(`词条 ${key} 在 ${relative(REPO, resolve(REPO, files[tag]))} 里读不到值 —— 判据的分母不许缺这一枚`);
      texts.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"'));
    }
  }
  if (texts.length !== keys.length * Object.keys(tables).length) {
    throw new Error(`词条原文枚数 ${String(texts.length)} 不等于 键数×表数 ${String(keys.length * Object.keys(tables).length)}`);
  }
  return texts;
}

/**
 * `--self-test`：不起壳、不要设备，只问这枚真源模块自己的承重条件**能不能红**。
 * 这枚模块是两枚壳级取证装置唯一的区分依据，而那两枚装置都要装出来的产物才跑得动 ——
 * 所以它的全部判据在设备腿放开之前没有任何东西试过；这一档就是那段"没人试过"的替身。
 * 臂数由它自己打印，不抄进文档。
 */
async function runSelfTest() {
  const install = installStepKeys();
  const native = nativeStepKeys();
  const arms = [];
  const arm = (name, problems) => arms.push({ name, problems });

  arm('两套步骤键必须互不相交（这枚模块存在的理由）', [
    ...install.filter((k) => native.includes(k)).map((k) => `同一枚键既算安装步骤又算原生步骤：${k}`),
  ]);
  arm('形状不许串（安装那批全带 .step，原生那批全带 .native.）', [
    ...install.filter((k) => !k.includes('.step')).map((k) => `安装步骤键不带 .step：${k}`),
    ...native.filter((k) => !k.includes('.native.')).map((k) => `原生步骤键不带 .native.：${k}`),
  ]);

  let resolved = [];
  try {
    resolved = stepTexts([...install, ...native]);
    arm('每一枚键在中英两份表里都读得到值', resolved.filter((t) => t.trim() === '').map(() => '读到空文案'));
  } catch (error) {
    arm('每一枚键在中英两份表里都读得到值', [error.message]);
  }

  // 正对照：缺一枚键必须抛，不许静默少一格 —— 上面那三条能不能红全靠这一臂配对。
  let missingThrew = false;
  try {
    stepTexts(['web.widgetJourney.nope.nope']);
  } catch {
    missingThrew = true;
  }
  arm('正对照：读不到的键必须抛（不许静默少一枚）', missingThrew ? [] : ['`stepTexts` 对不存在的键没抛 ⇒ 分母会静默变短']);

  let failures = 0;
  for (const { name, problems } of arms) {
    const ok = problems.length === 0;
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '🔴'} SELFTEST ${name} ⇒ ${problems.length ? problems.join(' ｜ ') : '通过'}`);
  }
  console.log(`SELFTEST ARMS=${arms.length} FAILED=${failures} 安装步骤键=${install.length} 原生步骤键=${native.length} 文案=${resolved.length}`);
  return failures === 0 ? 0 : 1;
}

// 只在"这枚文件被直接执行"时跑自测。比较要过 realpath：macOS 上 `/tmp` 是 `/private/tmp` 的软链，
// 拿 `process.argv[1]` 原样比 `import.meta.url` 会在夹具路径下**整档静默不执行还退 0**
// （实测：仓外软链路径那次一行输出都没有、MUT_RC=0 —— 那正是这枚模块要拦的形状，先发生在它自己身上）。
const selfPath = process.argv[1] ? safeRealpath(process.argv[1]) : '';
if (process.argv.includes('--self-test') && selfPath && selfPath === safeRealpath(fileURLToPath(import.meta.url))) {
  process.exit(await runSelfTest());
}
