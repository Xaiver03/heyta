#!/usr/bin/env node
/**
 * check:title-collision —— 同一屏上不许出现两个一样的标题
 * =======================================================
 *
 * ## 为什么
 *
 * 2026-11-15 逐屏审查里，这类问题**反复出现在不同屏上**：
 *
 * | 屏 | 撞的两个 | 后果 |
 * |---|---|---|
 * | 清单 | 顶栏「清单」+ 组标题「清单」 | 同一个词两次，而组标题不起分组作用 |
 * | 清单 | 字段名「清单名称」+ 占位符「给新清单起个名字」 | 同一张卡里"清单"三次 |
 * | 习惯 | 字段名「新习惯名称」+ 占位符「新习惯，例如…」 | 同上 |
 *
 * 这些不是某一屏的疏忽 —— 是**没有判据**。所以做成尺。
 *
 * ## 判据（两条）
 *
 * ① **顶栏标题 与 组标题** 不许是同一个文案（同一屏上同一个词出现两次）。
 *    ⚠️ 只在**同一个文件**里比对 —— 那才保证是同一屏。
 *
 *    🔴 **这条尺有已知覆盖缺口**：当顶栏与组标题分居两个文件时抓不到。
 *    2026-11-15 实测一处：`ProfileScreen.tsx` 的 `titleKey = 'notes.title'` 与
 *    `NotesSection.tsx` 的 `<SectionHeader title={t('notes.title')} />` 撞名，
 *    这条尺判绿。静态分析判不出"这个组件渲染在哪张屏"（那要跟组件树），
 *    所以那种情况只能人工发现。**写在这里是为了让下一个人知道它漏什么**，
 *    而不是以为"跑过了就没问题"。
 * ② **字段名 与 占位符** 不许共享一个 ≥2 字的词。
 *    占位符的职责是**举例子**，不是复述字段名。
 *
 * ## 为什么比对**文案**而不是 key
 *
 * 第一版按 key 比对，跑出 0 处 —— 因为撞名的两处往往用的是**不同的 key**：
 * `mobile.profile.section.lists`（"清单"）与 `mobile.tab.lists`（也是"清单"）。
 * 按 key 比等于没查。所以这里把 `zh-CN.ts` 解析成 key→文案的映射再比。
 *
 * ## 自测
 *
 * `--self-test` 造两种违规样本，断言都判红。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 从 zh-CN.ts 抽出 key → 文案。只认 `'key': 'value',` 这种单行形状。 */
export function buildMessageMap(source) {
  const map = new Map();
  const re = /^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',?\s*$/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    map.set(m[1], m[2].replace(/\\'/g, "'"));
  }
  return map;
}

/** 两个中文/英文串是否共享一个 ≥2 字的词。 */
export function sharesWord(a, b) {
  if (!a || !b) return false;
  /*
   * 🔴 不能按"连续汉字片段"切词。第一版那样写，`清单名称` 与 `给新清单起个名字`
   * 各自被当成**一整串**，交集为空，于是自测 B 判绿 —— 漏报。
   *
   * 中文没有空格，但**共同子串**是可判的：两边任意 ≥2 字的公共片段即撞词。
   * `清单名称` 与 `给新清单起个名字` 共享「清单」。
   */
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i + 2 <= s.length; i += 1) {
      const g = s.slice(i, i + 2);
      if (/[\u4e00-\u9fa5]{2}|[A-Za-z]{2}/.test(g)) set.add(g);
    }
    return set;
  };
  const ga = grams(a);
  for (const g of grams(b)) if (ga.has(g)) return true;
  return false;
}

/** 抽 `<X ... title={t('k')}>` 里的 key（带出现位置）。 */
function keysWithPos(source, tagName, attr) {
  const re = new RegExp(`<${tagName}\\b[^>]*?${attr}=\\{t\\('([^']+)'\\)\\}`, 'gs');
  return [...source.matchAll(re)].map((m) => ({ key: m[1], at: m.index }));
}

function keysOf(source, tagName, attr) {
  return keysWithPos(source, tagName, attr).map((x) => x.key);
}

/** 抽 `<TextField label={t('a')} ... placeholder={t('b')}>` 这种成对。 */
function placeholderPairs(source) {
  const out = [];
  const re = /<TextField\b[\s\S]*?\/>/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const tag = m[0];
    const label = tag.match(/label=\{t\('([^']+)'\)\}/);
    const ph = tag.match(/placeholder=\{t\('([^']+)'\)\}/);
    if (label && ph) out.push([label[1], ph[1]]);
  }
  return out;
}

export function findCollisions({ source, messages }) {
  const out = [];

  // ① 顶栏 与 组标题
  const screenKeys = keysOf(source, 'Screen', 'title');
  const sectionKeys = keysOf(source, 'SectionHeader', 'title');
  for (const sk of screenKeys) {
    for (const ck of sectionKeys) {
      const a = messages.get(sk);
      const b = messages.get(ck);
      if (a !== undefined && a === b) {
        out.push(`顶栏与组标题同名「${a}」（${sk} / ${ck}）`);
      }
    }
  }

  /*
   * ①b **同一文件里两个组标题同名**。
   *
   * 这条是"找尺自己漏什么"时补上的：上一版只比「顶栏 vs 组标题」，
   * 但一屏里出现两个一模一样的组标题，同样是同一句话说了两遍。
   */
  /*
   * ⚠️ **互斥分支不算同屏**。`ProfileProgressSummary` 里两处 `近期状态`
   * 分别在 `snapshot === null` 与正常渲染两个 `return` 分支里 —— 屏幕上只会出现一个。
   * 所以两处之间隔着 `return` 时跳过（这是对"同屏"的近似判据，够用）。
   */
  const seen = new Map();
  for (const { key: ck, at } of keysWithPos(source, 'SectionHeader', 'title')) {
    const text = messages.get(ck);
    if (text === undefined) continue;
    const prev = seen.get(text);
    if (prev !== undefined && !source.slice(prev.at, at).includes('return')) {
      out.push(`同一文件里两个组标题同名「${text}」（${prev.key} / ${ck}）`);
    } else {
      seen.set(text, { key: ck, at });
    }
  }

  // ② 字段名 与 占位符
  for (const [lk, pk] of placeholderPairs(source)) {
    const a = messages.get(lk);
    const b = messages.get(pk);
    if (a !== undefined && b !== undefined && sharesWord(a, b)) {
      out.push(`字段名「${a}」与占位符「${b}」共享同一个词`);
    }
  }

  return out;
}

function collect() {
  const out = [];
  const visit = (d) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      // 原生工程目录里没有我们关心的 tsx，而且 `ios/Pods` 会有断链。
      if (name === 'node_modules' || name === 'dist' || name === 'ios' || name === 'android') continue;
      if (name.startsWith('.')) continue;
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) visit(p);
      else if (name.endsWith('.tsx')) out.push(p);
    }
  };
  visit('apps');
  visit('packages');
  return out;
}

function main() {
  const zh = readFileSync('packages/i18n/src/locales/zh-CN.ts', 'utf8');
  const messages = buildMessageMap(zh);

  if (process.argv.includes('--self-test')) {
    const a = findCollisions({
      source: `<Screen title={t('k.a')}><SectionHeader title={t('k.b')} />`,
      messages: new Map([['k.a', '清单'], ['k.b', '清单']]),
    });
    if (a.length === 0) {
      console.error('🔴 self-test A 失败：顶栏与组标题同名没被报红');
      process.exit(1);
    }
    const b = findCollisions({
      source: `<TextField label={t('k.a')} placeholder={t('k.b')} />`,
      messages: new Map([
        ['k.a', '清单名称'],
        ['k.b', '给新清单起个名字'],
      ]),
    });
    if (b.length === 0) {
      console.error('🔴 self-test B 失败：字段名与占位符撞词没被报红');
      process.exit(1);
    }
    const c = findCollisions({
      source: `<TextField label={t('k.a')} placeholder={t('k.b')} />`,
      messages: new Map([
        ['k.a', '清单名称'],
        ['k.b', '例如「工作」'],
      ]),
    });
    if (c.length !== 0) {
      console.error('🔴 self-test C 失败：合规样本被误报');
      process.exit(1);
    }
    // D：同一文件里两个组标题同名（同一分支，真的会同屏）
    const d = findCollisions({
      source: `<><SectionHeader title={t('k.a')} /><SectionHeader title={t('k.b')} /></>`,
      messages: new Map([
        ['k.a', '近期状态'],
        ['k.b', '近期状态'],
      ]),
    });
    if (d.length === 0) {
      console.error('🔴 self-test D 失败：同文件双组标题没被报红');
      process.exit(1);
    }
    // E：两处隔着 `return`（互斥分支）⇒ 不算同屏，不许报红
    const e = findCollisions({
      source: `if (x) { return <SectionHeader title={t('k.a')} />; } return <SectionHeader title={t('k.b')} />;`,
      messages: new Map([
        ['k.a', '近期状态'],
        ['k.b', '近期状态'],
      ]),
    });
    if (e.length !== 0) {
      console.error('🔴 self-test E 失败：互斥分支被误报');
      process.exit(1);
    }
    console.log('✅ self-test：顶栏撞组标题、字段撞占位符、同文件双组标题都判红；互斥分支与合规放行（5 臂）');
    return;
  }

  const problems = [];
  for (const f of collect()) {
    for (const p of findCollisions({ source: readFileSync(f, 'utf8'), messages })) {
      problems.push(`${f.replace(/^\.\//, '')}: ${p}`);
    }
  }

  if (problems.length === 0) {
    console.log(`✅ 标题不撞名：${messages.size} 条文案里，没有同屏重名或字段/占位符撞词。`);
    return;
  }

  console.error(`🔴 标题撞名：${problems.length} 处`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error('');
  console.error('  规则见 docs/agents/design-体系-分页配速配色.md。');
  console.error('  组标题只用来分隔多组，单组页面不需要它（顶栏已经在说这一屏是什么）。');
  console.error('  占位符的职责是举例子，不是复述字段名。');
  process.exit(1);
}

main();
