#!/usr/bin/env node
/**
 * 「用了共享 UI，就必须挂共享 UI 的主题 Provider」—— 结构性门禁
 * =============================================================
 *
 * 🔴 **这道门禁来自一次真实的 P0 崩溃**（2026-09-28 实测）：
 *
 * ```
 * FATAL EXCEPTION: mqt_v_native
 * com.facebook.react.common.JavascriptException:
 *   Error: useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用。
 *   This error is located at:  at TaskList (…index.android.bundle…)
 * ```
 *
 * `9d5050d`「TasksScreen 换用共享 TaskList/TaskBadges（M1-4 完成）」把
 * `@heyta/ui` 的共享组件接进了移动端，但 `apps/mobile` **没有挂
 * `HeytaUiProvider`** —— 而 web 的垂直切片与桌面渲染进程**都挂了**。
 *
 * 为什么三道现有防线都没拦住：
 *
 * | 防线 | 为什么没拦住 |
 * |---|---|
 * | 类型系统 | Provider 是**运行时**契约，缺了不报类型错 |
 * | 单测 | 每个包各测各的；`packages/ui` 测的是"没有 Provider 会抛错"（那是对的） |
 * | 真机验收 | **列表为空时渲染的是空态，不走 `TaskList`** —— "装上能开、能配置、能打字"全绿，直到**建出第一条任务**才崩 |
 *
 * 也就是说：**"某一段是对的"与"接起来是对的"之间，一条自动化判据都没有。**
 * 这道门禁补的就是那一条。
 *
 * ## 它查什么（刻意窄，避免变成噪音）
 *
 * 对 `apps/` 下每个宿主：
 *   1. 它是否 import 了 `@heyta/ui` 里**需要 Provider 的符号**；
 *   2. 若是，它的源码里必须出现 `HeytaUiProvider`。
 *
 * 「需要 Provider 的符号」是一份**显式清单**，不是"任何 `@heyta/ui` 的导入"：
 * `packages/ui` 里有些是纯函数/纯类型（不碰 context），把它们也算进来会让
 * 门禁因为一句无关的 import 变红，然后被人用 `// eslint-disable` 式的手法绕过。
 *
 * 🔴 **匹配不到任何需要 Provider 的符号时，本脚本不报错**（那是一个合法的
 * 宿主形态）。但只要匹配到了一个而没挂 Provider，就**必须**报错 ——
 * 这条判据来自本仓库反复吃过的教训：门禁"找不到就跳过"会在重构改名之后
 * **永远通过**（见 `check-pricing-consistency.mjs` 文件头与
 * `apps/landing/tests/seo-head.spec.ts` 的同类说明）。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.env.HEYTA_CHECK_ROOT ?? process.cwd();

/**
 * `@heyta/ui` 里**依赖 `<HeytaUiProvider>`** 的导出。
 *
 * 加新共享组件时要更新这份清单 —— 判据是：它（或它渲染的组件）调了
 * `useHeytaUiTheme` / `useHeytaTokens` / `useHeytaText`。
 * 这比"扫 packages/ui 的调用图"简单，也更容易在 review 里看出来。
 */
const PROVIDER_DEPENDENT = [
  'TaskList',
  'TaskBadges',
  'useHeytaTokens',
  'useHeytaText',
  'useHeytaUiTheme',
];

/** 宿主目录。每一个都要单独判断 —— 它们各有各的 Provider 位置。 */
const HOST_DIRS = ['apps/web/src', 'apps/mobile/src', 'apps/desktop', 'apps/node-host/src'];

/** 递归收集 `.ts` / `.tsx`（跳过构建产物与依赖）。 */
function collectSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // 宿主可能不存在（例如某个壳被删了）
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('dist') || entry === 'build') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const problems = [];
const scanned = [];

for (const hostDir of HOST_DIRS) {
  const files = collectSourceFiles(join(ROOT, hostDir));
  if (files.length === 0) continue;

  /** 这个宿主是否用了需要 Provider 的符号（以及在哪一行）。 */
  const usages = [];
  let mountsProvider = false;

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (/\bHeytaUiProvider\b/.test(text)) mountsProvider = true;

    for (const name of PROVIDER_DEPENDENT) {
      // 只认 `import { … } from '@heyta/ui'` 这一段里的符号，
      // **不认注释里提到它**（否则每一条提到 TaskList 的说明文字都会让门禁变红）。
      const importBlocks = text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@heyta\/ui'/g);
      for (const block of importBlocks) {
        const names = block[1]
          .split(',')
          .map((s) => s.replace(/^\s*type\s+/, '').trim().split(/\s+as\s+/)[0].trim());
        if (names.includes(name)) usages.push({ file: relative(ROOT, file), name });
      }
    }
  }

  if (usages.length === 0) continue;
  scanned.push({ hostDir, count: usages.length });

  if (!mountsProvider) {
    const where = [...new Set(usages.map((u) => `${u.file}（${u.name}）`))].join('\n      ');
    // ⚠️ 这段文本里**不能出现反引号** —— 它在模板字符串内部，
    //    嵌套的反引号会**提前结束模板字符串**，于是 `<HeytaUiProvider>`
    //    被当成表达式求值，在**失败路径**上抛 ReferenceError。
    //    后果比"报错不好看"严重得多：门禁于是从一个"能报告问题的检查"
    //    退化成一个"崩溃的脚本"，而**成功路径永远走不到那里**，
    //    所以本地跑一次绿就发现不了。
    problems.push(
      `${hostDir} 用了需要主题 Provider 的共享组件，但整个宿主里没有 HeytaUiProvider：\n` +
        `      ${where}\n` +
        `      ⇒ 运行时会抛「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用。」而**类型与单测都不会红**。\n` +
        `      修法：在宿主根组件里把 HeytaUiProvider 包在所有用到共享组件的树之外\n` +
        `      （移动端要传 value，见 apps/mobile/src/App.tsx 的 UiThemeBridge）。`,
    );
  }
}

if (problems.length > 0) {
  console.error('🔴 共享 UI 的主题 Provider 缺失：\n');
  for (const p of problems) console.error(`  · ${p}\n`);
  process.exit(1);
}

const summary = scanned.map((s) => `${s.hostDir}（${String(s.count)} 处引用）`).join('、');
console.log(
  `✅ 用了共享 UI 的宿主都挂了 HeytaUiProvider` +
    (summary === '' ? '（本次没有宿主引用需要 Provider 的符号）' : `：${summary}`),
);
