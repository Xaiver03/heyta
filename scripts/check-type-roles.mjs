#!/usr/bin/env node
/**
 * check:type-roles —— 排版角色表的两条判据
 * ==========================================
 *
 * ## 它守的是什么
 *
 * 2026-11-14 的事故：设置页组标题用 `section-title`（16px semibold **主文字色**），
 * 而它管辖的选项用 `row-title`（16px medium 主文字色）——
 * 同字号、同颜色、只差一档字重。用户原话：「标题还没有下面的字大」。
 *
 * 而仓库里**早有一档专为组标题设计的样式** `group-label`（13px + semibold + muted）。
 * 也就是说同一个错犯过两次，第二次的成因是：`TEXT_STYLES` 规定了"有哪些档"，
 * 却没有一张"**哪个位置用哪档**"的表。
 *
 * `type-roles.ts` 补的就是那张表。这个门禁守两件事：
 *
 * ① **孤儿角色**：表里定义了、但没有任何消费点。定义而不用的角色会腐烂，
 *    下一个人才不知道该用哪个（正是那次事故的形状）。
 * ② **绕过表**：`SectionHeader` / `SettingsSection` / `ChoiceRows` 三个
 *    "位置明确"的组件，内部必须走 `TYPE_ROLE[...]`，不许直接写 `'group-label'` /
 *    `'row-title'` 字面量。写死的话，改一处档位只改一处，其余悄悄漂移。
 *
 * ## 自测（判据必须能真的红）
 *
 * `--self-test` 会造两份违规样本（一个孤儿角色、一个绕过表），
 * 断言检查器对它们报红、对当前仓库报绿。**一条永远通过的判据比没有更糟**
 * （`docs/agents/environment-traps-index.md` 的元规则）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TYPE_ROLES = 'packages/design-system/src/type-roles.ts';

/** 三个"位置明确"的组件：内部必须走角色表。 */
const ROLE_OWNERS = [
  'apps/mobile/src/ui/kit.tsx',
  'packages/ui/src/settings/Settings.tsx',
  'packages/design-system/src/choice-row-shape.ts',
];

/** 抽 `TYPE_ROLE` 里定义的角色名（形如 `  'section-heading': 'group-label',`）。 */
function definedRoles(source) {
  const block = source.slice(
    source.indexOf('export const TYPE_ROLE ='),
    source.indexOf('} as const'),
  );
  const names = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\s{2}(?:'([a-z-]+)'|([a-zA-Z]+)):/);
    if (m) names.push(m[1] ?? m[2]);
  }
  /*
   * ⚠️ **不解析 `TYPE_ROLE_CONTENT`**（`row-meta` / `value` / `note`）。
   * 那三个是**内容类型**，`caption` 那种全仓几十处都在用，不存在"孤儿"风险；
   * 把它们纳入孤儿检查只会把门禁变成一条永远要维护的名单。
   * 孤儿检查针对的是"**位置**"，因为位置是有限的、每个都该有人用。
   */
  return names;
}

function findViolations({ files, rolesSource, ownerSources }) {
  const problems = [];
  const roles = definedRoles(rolesSource);

  if (roles.length === 0) {
    problems.push('type-roles.ts 里一个角色都没解析出来 —— 检查器本身可能坏了');
    return problems;
  }

  // ① 孤儿角色（位置表与内容表**都**查）
  for (const role of roles) {
    const used = files.some((text) =>
      new RegExp(`TYPE_ROLE\\[\\s*'${role}'\\s*\\]`).test(text),
    );
    if (!used) {
      problems.push(`孤儿角色：「${role}」在表里定义了，但没有任何消费点（TYPE_ROLE['${role}'])`);
    }
  }

  // ② 绕过表（只查三个 owner 文件里的组标题/行文字位置）
  const BYPASS = [/'group-label'/, /'section-title'/, /text\['group-label'\]/];
  for (const [path, text] of Object.entries(ownerSources)) {
    for (const re of BYPASS) {
      if (re.test(text)) {
        problems.push(
          `${path} 里直接写了 ${re.source} —— 组标题位置必须走 TYPE_ROLE['section-heading']`,
        );
      }
    }
  }

  return problems;
}

/** 递归收集源码（apps 与 packages 下每个包的 src）—— 消费点散在各处，
 *  第一版只扫了 3 个 owner 文件，于是 screen-title / panel-title 刚迁完就被报成孤儿。 */
function collectSources() {
  const out = [];
  for (const root of ['apps', 'packages']) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const pkg of entries) {
      const dir = join(root, pkg, 'src');
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const file of readdirSync(dir, { recursive: true })) {
        const f = String(file);
        if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
        out.push(readFileSync(join(dir, f), 'utf8'));
      }
    }
  }
  return out;
}

function readFiles(paths) {
  return Object.fromEntries(paths.map((p) => [p, readFileSync(p, 'utf8')]));
}

function main() {
  const selfTest = process.argv.includes('--self-test');
  const rolesSource = readFileSync(TYPE_ROLES, 'utf8');
  const ownerSources = readFiles(ROLE_OWNERS);

  const scanSet = collectSources();

  if (selfTest) {
    // 违规样本 A：孤儿角色
    // 锚点用 `TYPE_ROLE` 块里真实存在的一行（2026-11-14：`value` 移去 PENDING 后
    // 这个注入点失效过一次 —— 自测假绿比没有自测更糟，所以锚点要跟着表走。）
    const orphanRoles = rolesSource.replace(
      "  'row-title': 'row-title',",
      "  'row-title': 'row-title',\n  'ghost-role': 'caption',",
    );
    const a = findViolations({ files: scanSet, rolesSource: orphanRoles, ownerSources });
    if (!a.some((p) => p.includes('ghost-role'))) {
      console.error('🔴 self-test A 失败：孤儿角色没有被报红');
      process.exit(1);
    }

    // 违规样本 B：绕过表
    const bypassOwners = {
      ...ownerSources,
      'apps/mobile/src/ui/kit.tsx': ownerSources['apps/mobile/src/ui/kit.tsx'].replace(
        "TYPE_ROLE['section-heading']",
        "'group-label'",
      ),
    };
    const b = findViolations({ files: scanSet, rolesSource, ownerSources: bypassOwners });
    if (!b.some((p) => p.includes('group-label'))) {
      console.error('🔴 self-test B 失败：绕过角色表没有被报红');
      process.exit(1);
    }

    console.log('✅ self-test：孤儿角色与绕过表都能判红（2 臂）');
    return;
  }

  const problems = findViolations({ files: scanSet, rolesSource, ownerSources });
  if (problems.length === 0) {
    console.log(
      `✅ 排版角色：${definedRoles(rolesSource).length} 个角色都有消费点，三个位置组件都走表。`,
    );
    return;
  }

  console.error(`🔴 排版角色：${problems.length} 处问题`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

main();
