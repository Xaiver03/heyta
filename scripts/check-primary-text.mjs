#!/usr/bin/env node
/**
 * check:primary-text —— `color.primary` 不许用来给文字上色
 * =========================================================
 *
 * ## 为什么
 *
 * 2026-11-15 实测：全仓 `color.primary` **157 处**。其中
 * `StateIllustration` 一个文件 13 处（装饰插画）、`CaptureComposer` 10 处 ——
 * primary 被当成了**通用强调色**，用在图标、插画、边框、文字上。
 *
 * 一个哪儿都能用的颜色等于没有语义。用户在「我的」页看到的原话是
 * 「一屏六处蓝」，于是**主按钮不再突出**。
 *
 * ## 规则
 *
 * `primary` 只允许三处：
 *   ① 每屏至多 1 枚主按钮（`Button tone="primary"`）
 *   ② 底部 tab 的选中项
 *   ③ 选中行的文字与勾（`ChoiceRows` / `RadioRow` 内部）
 *
 * **文字着色只允许第 ③ 种**，且只在白名单文件里 —— 那是"这一行被选中了"的
 * 唯一信号，换不得。
 *
 * ## 判据
 *
 * 扫 `<Text` 开标签（含跨行）里同时出现 `color.primary` 的位置。
 * 白名单里的文件放行，其余一律红。
 *
 * ## 自测
 *
 * `--self-test` 造一份违规样本，断言能红。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 白名单：这里用 primary 给**选中行**上色是对的。
 *
 * 每一条都要能说出"为什么这一处必须是主色"—— 说不出就说明它不该在主色里。
 */
const ALLOW = new Map([
  [
    'packages/ui/src/choice/ChoiceRows.tsx',
    '选中行的文字与勾：这是"这一行被选中"的唯一视觉信号',
  ],
  [
    'packages/ui/src/settings/Settings.tsx',
    '选中态（switch 轨道、单选项）：同上',
  ],
]);

/** 递归收集源码。 */
function collect(dir = '.') {
  const out = [];
  const visit = (d) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        visit(p);
      } else if (name.endsWith('.tsx')) {
        out.push(p);
      }
    }
  };
  visit('apps');
  visit('packages');
  return out;
}

/**
 * 找出「`<Text` 开标签里带 `color.primary`」的位置。
 *
 * 做法：先定位每个 `<Text`，向后找到它的 `>`（跳过跨行），
 * 在这一段里找 `color.primary`。够用且不误报 —— 只关心开标签本身。
 */
export function findPrimaryText(source) {
  const hits = [];
  const re = /<Text\b/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const start = m.index;
    // 找开标签的结束 `>`，遇到 `/>` 或 `>` 即止
    let i = start;
    let depth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
      i += 1;
    }
    const tag = source.slice(start, i + 1);
    if (!tag.includes('color.primary')) continue;
    /*
     * 🔴 只在**不可点**的时候报红。
     *
     * 最初我按"位置"判（只允许主按钮 / tab 选中 / 选中行 / 链接），
     * 一扫 13 处，其中大半是合理的 —— 日历的"今天"高亮、`backToToday` 链接、
     * tab 选中项。按位置判会把这些全打红，等于把门禁变成一张豁免名单。
     *
     * 能机械化判的只有一件事：**这行文字自己不可点，却被染成了主色**。
     * 那才是「订阅」「设置」那种错的形状（静态导航行冒充主按钮）。
     */
    const lookback = source.slice(Math.max(0, start - 600), start);
    const clickable = /onPress|<Pressable|onValueChange/.test(lookback);
    if (clickable) continue;
    const line = source.slice(0, start).split('\n').length;
    hits.push({ line, tag: tag.replace(/\s+/g, ' ').slice(0, 90) });
  }
  return hits;
}

function main() {
  const selfTest = process.argv.includes('--self-test');
  const files = collect();

  if (selfTest) {
    const bad = `const a = <Text style={{ color: tokens['color.primary'] }}>x</Text>;`;
    if (findPrimaryText(bad).length !== 1) {
      console.error('🔴 self-test A 失败：违规样本没被检出');
      process.exit(1);
    }
    const good = `const a = <Text style={{ color: tokens['color.foreground'] }}>x</Text>;`;
    if (findPrimaryText(good).length !== 0) {
      console.error('🔴 self-test B 失败：合规样本被误报');
      process.exit(1);
    }
    // 按钮不算（Button 不是 Text）
    const btn = `const a = <Button tone="primary" label="x" />;`;
    if (findPrimaryText(btn).length !== 0) {
      console.error('🔴 self-test C 失败：按钮被误报');
      process.exit(1);
    }
    console.log('✅ self-test：违规判红、合规放行、按钮不误报（3 臂）');
    return;
  }

  const problems = [];
  for (const f of files) {
    const rel = f.replace(/^\.\//, '');
    if (ALLOW.has(rel)) continue;
    const hits = findPrimaryText(readFileSync(f, 'utf8'));
    for (const h of hits) problems.push({ rel, ...h });
  }

  /*
   * 🔴 这是**审查助手**，不是门禁 —— 默认退出码 0。
   *
   * 我试过让它判红，两次都不成立：
   *   · 按"位置"判（只允许按钮/tab/选中行/链接）→ 13 处里大半合理
   *     （日历的"今天"高亮、`backToToday` 链接），等于一张豁免名单；
   *   · 按"不可点"判（回看 600 字符找 onPress）→ `CalendarBoard` 的
   *     `<Pressable>` 在 600 字符之外，照样误报。
   *
   * 配色对不对**只能看图判**（dump 不给颜色）。一条会误报的尺会被下一个人关掉，
   * 那比没有尺更糟 —— 因为它留下"我们查过了"的假象。
   *
   * 所以它输出清单，逐屏审查时对着看：**一屏主色出现 >2 处就是错**。
   * `--strict` 留给将来真能判准的那天。
   */
  if (problems.length === 0) {
    console.log(`✅ primary 不上文字：${files.length} 个 tsx 里没有可疑位置。`);
    return;
  }

  console.log(`📋 primary 给文字上色：${problems.length} 处（审查清单，非门禁）`);
  for (const p of problems) {
    console.log(`  · ${p.rel}:${p.line}`);
    console.log(`      ${p.tag}`);
  }
  console.log('');
  console.log('  判法：一屏里主色出现 >2 处就是错。逐屏看图时对照这份清单。');
  if (process.argv.includes('--strict')) process.exit(1);
}

main();
