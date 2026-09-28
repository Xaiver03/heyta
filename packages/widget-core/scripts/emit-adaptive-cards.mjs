/**
 * 把四份 Adaptive Card 模板写进 `apps/web/public/widgets/`。
 *
 * ```sh
 * pnpm --filter @heyta/widget-core gen:adaptive-cards
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
 * 与黄金夹具用的是同一套纪律。
 *
 * ⚠️ 依赖 `dist/`：先 `pnpm --filter @heyta/widget-core build`。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serializeAdaptiveCardTemplates } from '../dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', 'apps', 'web', 'public', 'widgets');

mkdirSync(OUT, { recursive: true });

const files = serializeAdaptiveCardTemplates();
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(OUT, name), content, 'utf8');
  console.log(`  ✅ ${name}  ${content.length} 字节`);
}
console.log(`\n✅ 写了 ${Object.keys(files).length} 份模板到 apps/web/public/widgets/`);
