#!/usr/bin/env node
/**
 * check:tap-targets —— 触控目标门禁
 *
 * ## 它为什么不是"扫源码"
 *
 * 这一轮实测的七处"可点却不够大"，**三种根因各不相同**：
 *   ① `minHeight` 取了「标签胶囊」的 28px（新建面板、倒数日筛选）
 *   ② 漏写 `minHeight`（任务详情空备注行）
 *   ③ 写了高度没写宽度（日历视图 tab 35dp）
 * 静态扫 `<Pressable>` 抓不到 —— 有的高度写在 `style={styles.x}` 里，
 * 有的用 `hitSlop` 补偿，有的靠内容撑开。所以判据只能放在**运行时**：
 * 拿 `uiautomator dump` 量每个 `clickable` 节点的实际 bounds。
 *
 * ## 为什么它不能"没有证据就通过"
 *
 * 一条永远能过的门禁比没有门禁更糟（`docs/agents/environment-traps-index.md` 的元规则）。
 * 证据目录 `apps/mobile/evidence/` 被 `.gitignore` 挡在库外 ⇒ CI 上**没有 xml**。
 * 所以这里分两种结果：
 *   · 有证据 → 逐界面审计，有违规就红（退出 1）
 *   · 没证据 → **不是通过**，是"没跑"（退出 2）并打印怎么产证据
 *
 * ## 与主链的关系
 *
 * 已接进 `pnpm check`，但**只在本地有意义**：`pnpm check` 在 CI 上跑到这一步会因为
 * 没有证据退出 2 ⇒ 红。这是有意的：它逼着交付者在本地跑一次
 * `scripts/capture-ux-parity.sh`，而不是假装检查过。
 * 如果哪天要把 CI 也纳入，做法是先归档证据（`capture-ux-parity.sh` 支持 `--out`），
 * **不要**改成"没证据就跳过"。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EVIDENCE_DIR = 'apps/mobile/evidence';

/** 找最近一份带 xml 的对照目录（按目录名倒序，`ux-parity-YYYYMMDD` 天然可排）。 */
function findEvidenceDirs() {
  if (!existsSync(EVIDENCE_DIR)) return [];
  const out = [];
  for (const name of readdirSync(EVIDENCE_DIR).sort().reverse()) {
    if (!name.startsWith('ux-parity-')) continue;
    const dir = join(EVIDENCE_DIR, name);
    const xmls = readdirSync(dir).filter((f) => f.endsWith('.xml'));
    if (xmls.length > 0) out.push({ dir, count: xmls.length });
  }
  return out;
}

const dirs = findEvidenceDirs();

if (dirs.length === 0) {
  console.error('[tap-targets] 没有可审的证据。');
  console.error('');
  console.error('  这不是"通过"，是"没跑"。先产证据再跑：');
  console.error('    adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk');
  console.error('    scripts/capture-ux-parity.sh heyta <模块名>');
  console.error('');
  console.error('  口径：截图 + uiautomator dump 成对落盘，bounds ÷ 3 = dp（density 480）。');
  process.exit(2);
}

const { dir, count } = dirs[0];
console.log(`[tap-targets] 审计 ${dir}（${count} 个界面）`);

const result = spawnSync(
  'python3',
  ['scripts/audit-tap-targets.py', ...readdirSync(dir).filter((f) => f.endsWith('.xml')).map((f) => join(dir, f))],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
