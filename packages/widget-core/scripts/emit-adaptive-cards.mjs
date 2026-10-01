/**
 * 把四份 Adaptive Card 模板写进 `apps/web/public/widgets/`。
 *
 * ```sh
 * pnpm --filter @heyta/widget-core gen:adaptive-cards          # 生成
 * pnpm --filter @heyta/widget-core gen:adaptive-cards --check  # 只校验，不写盘
 * ```
 *
 * ## 🔴 为什么模板要落成文件，而不是让 service worker 内联
 *
 * `manifest.webmanifest` 的 `ms_ac_template` 字段要的是**一个 URL** ——
 * 组件宿主自己去取模板，不经过我们的 JS。所以模板必须是能被 URL 取到的静态资源。
 *
 * 而它**不能手写**：手写的模板会与 `buildAdaptiveCardData` 漂移，
 * 症状是组件显示空白或字面量 `${xxx}` —— 只在 Windows 上看得见。
 * 有一条测试钉着"磁盘上的 JSON === 重新生成的结果"（`tests/adaptive-card.spec.ts`），
 * 与黄金夹具用的是同一套纪律；`--check` 是它的快速版本（不用起 vitest）。
 *
 * ## 🔴 第二条判据：生成物里不许有一个字的文案（i18n P1-3）
 *
 * 模板对**全部语言**是同一个文件 —— 宿主取它时没有任何 locale 信号。
 * 所以每写死一句话，那句话就永远不会被翻译。这条在**写盘前**也判一次：
 * 违规时不写出文件，直接非零退出。
 *
 * ⚠️ 依赖 `dist/`：先 `pnpm --filter @heyta/widget-core build`。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serializeAdaptiveCardTemplates } from '../dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', 'apps', 'web', 'public', 'widgets');

/** 汉字 + CJK 标点 + 全角字符（口径同 `scripts/check-ui-language.mjs` 的 `CJK`）。 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

const checkOnly = process.argv.includes('--check');
const files = serializeAdaptiveCardTemplates();
const problems = [];
let changed = 0;

for (const [name, content] of Object.entries(files)) {
  const path = join(OUT, name);

  if (CJK.test(content)) {
    const hit = content.match(new RegExp(`${CJK.source}[^",]*`));
    problems.push(
      `${name}：模板里写死了文案「${String(hit?.[0] ?? '')}」—— ` +
        '组件宿主取这个文件时拿不到 locale，这句话对所有语言都不会变。' +
        '正确做法：把那句话放进**数据**（`build*CardData` 里 `t(key)`），模板只写绑定。',
    );
    continue;
  }

  let committed = null;
  try {
    committed = readFileSync(path, 'utf8');
  } catch {
    /* 文件还不存在 */
  }

  if (committed === content) continue;
  changed += 1;
  if (checkOnly) {
    problems.push(
      `${name}：磁盘上的文件与代码**不一致**${committed === null ? '（文件不存在）' : ''}。` +
        '改过 `adaptive-card.ts` 的模板就要重新生成：\n' +
        '         `pnpm --filter @heyta/widget-core build && pnpm --filter @heyta/widget-core gen:adaptive-cards`\n' +
        '         ⚠️ 重建后看一眼 diff —— 如果变化不是你有意造成的，那是 bug 不是模板过期。',
    );
    continue;
  }
  writeFileSync(path, content, 'utf8');
  console.log(`  ✅ ${name}  ${String(content.length)} 字节`);
}

if (problems.length > 0) {
  console.error(`🔴 小组件模板门禁未通过（${String(problems.length)} 项）：\n`);
  for (const p of problems) console.error(`   · ${p}\n`);
  if (checkOnly)
    console.error(
      '   这是 `pnpm check:adaptive-cards` 的快速版本；完整判据在\n   `packages/widget-core/tests/adaptive-card.spec.ts`（由 `pnpm -r test` 跑）。\n',
    );
  process.exit(1);
}

if (checkOnly) {
  console.log(
    `✅ ${String(Object.keys(files).length)} 份模板与代码一致，且不含写死文案。`,
  );
} else {
  console.log(
    `\n✅ apps/web/public/widgets/：${String(changed)} 份已更新，共 ${String(Object.keys(files).length)} 份。`,
  );
}
