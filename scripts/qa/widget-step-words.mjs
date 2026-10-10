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
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const SOURCE = 'apps/web/src/pwa/widget-install.ts';

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
