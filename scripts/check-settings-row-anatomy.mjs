#!/usr/bin/env node
/**
 * G-4 门禁：web 设置面的「行解剖」只许有一份实现。
 * =============================================
 *
 * 治理计划 `docs/plans/settings-ui-governance-2026-11.md` G-4 的**可执行那一半**：
 * 「新面板强制使用共享契约」。
 *
 * 🔴 为什么门判的是**容器类名**而不是"有没有 import SettingsRow"：
 *   `packages/ui` 的 `SettingsRowModel` 今天是五档穷尽联合
 *   （`value` / `toggle` / `action` / `note` / `heading`）。而 web 设置面里
 *   最常被要的那一行 —— **输入框 + 按钮**（昵称、换邮箱、通行密钥改名、密码）
 *   **五档里哪一档都装不下**：`SettingsValueRow` 的值是 `readonly value: string`，
 *   没有可编辑插槽。所以那几格只能继续手写，直到有人给跨端契约加第六档
 *   （那要同时改 `packages/ui/src/settings/Settings.tsx` 与移动端 4 个屏幕的
 *   穷尽 switch，并在真机上验 —— 见计划里 G-4 的迁移那一半）。
 *   ⇒ 本门**不**要求面板去 import 一个装不下它的组件（那会把人逼成硬塞），
 *     它要求的是：**别再长出第六套容器**。
 *
 * 判据（账本制，与 `check-settings-no-prose.mjs` 同一条纪律）：
 *   · 账本外**新文件**出现手写容器 ⇒ 🔴 红（第六套解剖一天都长不出来）；
 *   · 账内某文件读数**涨了** ⇒ 🔴 红；
 *   · 账内读数**掉了却没改账本** ⇒ 🔴 红（"它真的在缩"的唯一读数）。
 *
 * 账本：`scripts/settings-row-anatomy-ledger.json`。清理时**只许改小**：
 *   `node scripts/check-settings-row-anatomy.mjs --update`
 *
 * 用法：node scripts/check-settings-row-anatomy.mjs [--update|--self-test]
 * 🔴 未知旗标一律拒（§7：一把静默吞掉旗标的尺会照常打绿，而它判的是另一棵树）。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.cwd();
const LEDGER_PATH = join(ROOT, 'scripts/settings-row-anatomy-ledger.json');
const SCAN_DIRS = ['apps/web/src/features/settings'];
const SCAN_FILES = ['apps/web/src/App.tsx'];

/**
 * 承载「一行怎么排」的容器类名。
 * ⚠️ 不含 `__field`（那是宽度约束，`max-inline-size: 42rem`）与 `__item`（标签排版），
 *    它们不是行解剖 —— 把它们算进来会让门去管布局细节，而不是管"又长出一套行"。
 */
const ANATOMY = /ht-settings__(row|section|credential|account-gate|danger-card|order-card|data-card|list)\b/g;

function scan() {
  const found = new Map();
  const files = [...SCAN_FILES];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (name.endsWith('.tsx')) files.push(join(dir, name));
    }
  }
  for (const rel of files) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const hits = readFileSync(abs, 'utf-8').match(ANATOMY);
    if (hits && hits.length > 0) found.set(basename(rel), hits.length);
  }
  return found;
}

function readLedger() {
  if (!existsSync(LEDGER_PATH)) return { total: 0, files: {} };
  return JSON.parse(readFileSync(LEDGER_PATH, 'utf-8'));
}

function evaluate(found, ledger) {
  const reds = [];
  for (const [file, n] of found) {
    const allowed = ledger.files[file];
    if (allowed === undefined) {
      reds.push(`账本外新文件 ${file} 出现 ${n} 处手写行解剖容器 ⇒ 用 packages/ui 的 SettingsRow，或去登记账本（要写清为什么装不下）`);
    } else if (n > allowed) {
      reds.push(`${file} 的行解剖读数 ${n} > 账本 ${allowed} ⇒ 又长出一套容器`);
    }
  }
  for (const [file, allowed] of Object.entries(ledger.files)) {
    const n = found.get(file);
    if (n === undefined) {
      reds.push(`账本记着 ${file} 有 ${allowed} 处，现在一处都没有 ⇒ 跑 --update 把账改小`);
    } else if (n < allowed) {
      reds.push(`${file} 的行解剖从 ${allowed} 缩到 ${n} 却没改账本 ⇒ 跑 --update（只许改小）`);
    }
  }
  return reds;
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--update' && a !== '--self-test');
  if (unknown.length > 0) {
    console.error(`❌ 不认识的旗标：${unknown.join(' ')}\n   只认 --update / --self-test`);
    process.exit(1);
  }

  const found = scan();
  const ledger = readLedger();

  if (args.includes('--self-test')) {
    // 变异臂：往一个账内文件临时加一处容器，门必须红。
    const target = 'apps/web/src/features/settings/MemoryPanel.tsx';
    const original = readFileSync(join(ROOT, target), 'utf-8');
    const mutated = original.replace(
      'export function MemoryPanel',
      'const __MUT_ANATOMY = "ht-settings__section";\nexport function MemoryPanel',
    );
    if (mutated === original) {
      console.error('self-test: 注入没生效（找不到锚点），夹具失效');
      process.exit(1);
    }
    writeFileSync(join(ROOT, target), mutated);
    /**
     * 🔴 退出一律放在**还原之后**：`process.exit` 写在 `try` 里会跳过 `finally`，
     *   于是注入的变异被留在工作树里 —— 本仓另一把尺（`check-tip-adjacency` 第一版）
     *   真踩过这个，症状是别人下一次读到一份带 `__MUT_` 的源码。
     */
    let failure = null;
    try {
      const reds = evaluate(scan(), readLedger());
      if (reds.length === 0) {
        failure = 'self-test: ❌ 注入第六套容器后门仍绿 ⇒ 这把尺不能失败，没有价值';
      } else {
        console.log(`self-test: ✅ 变异臂红（注入一处 ht-settings__section 后门禁拒绝：${reds[0]}）`);
      }
    } finally {
      writeFileSync(join(ROOT, target), original);
    }
    if (failure !== null) {
      console.error(`${failure}（工作树已还原）`);
      process.exit(1);
    }
    return;
  }

  if (args.includes('--update')) {
    const next = { total: 0, files: {} };
    for (const [file, n] of [...found].sort()) {
      next.files[file] = n;
      next.total += n;
    }
    for (const [file, allowed] of Object.entries(ledger.files)) {
      const n = found.get(file);
      if (n !== undefined && n > allowed) {
        console.error(`❌ ${file} 现在 ${n} > 账本 ${allowed} —— --update 只许改小，不许抬高`);
        process.exit(1);
      }
    }
    writeFileSync(LEDGER_PATH, `${JSON.stringify(next, null, 1)}\n`);
    console.log(`账本已按现量重写：${ledger.total} → ${next.total}（${Object.keys(next.files).length} 个文件）`);
    return;
  }

  const reds = evaluate(found, ledger);
  if (reds.length > 0) {
    console.error(`G-4 行解剖门：❌ ${reds.length} 条`);
    for (const r of reds) console.error(`  · ${r}`);
    console.error('\n判据正文：docs/plans/settings-ui-governance-2026-11.md G-4。');
    console.error('出路是用 packages/ui 的 SettingsRow；确实装不下（输入框+按钮那类行）就写清理由再登记账本。');
    process.exit(1);
  }

  console.log(`G-4 行解剖门：✅ ${found.size} 个文件、${[...found.values()].reduce((a, b) => a + b, 0)} 处，与账本逐格相同（无新增解剖）`);
}

main();
