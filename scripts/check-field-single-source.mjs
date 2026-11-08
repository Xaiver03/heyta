#!/usr/bin/env node
/**
 * 门禁：一个字段只有一个可编辑落点（P10 §7 R1）
 * ============================================
 *
 * ## 规则一句话
 *
 * 同一条任务的同一个字段，**有且只有一个"编辑落点"**。
 * 可以有多条**输入通路**（右键 / 键盘 / 看板拖拽 / 详情按钮）指向同一落点，
 * 但**不许有两个落点**。
 *
 * ## 为什么必须由脚本判
 *
 * 两个落点不会报错、不会让测试红、界面照样能点 —— 它们各自内部自洽。
 * 症状是漂：一处支持"清除"另一处不支持，一处写一条 op 另一处写两条。
 * **本仓已经为"截止"付过这个代价**（`apps/web/tests/task-detail-card.spec.tsx`
 * 那条"截止两处可编辑"就是当时留下的钉子）。
 * 而那条钉子只钉住了**一个**字段；另外五个字段没有任何东西看着。
 *
 * ## 判据（三条）
 *
 * | # | 判据 | 为什么它能红 |
 * |---|---|---|
 * | R1 | 每个字段的**编辑器落点文件数 = 1**（通路不计） | 把编辑器挂到第二个文件上，不会有任何编译/测试错误 |
 * | R2 | **通路白名单**（`GESTURE_PATHS`）每一条的锚点必须仍在源码里 | 白名单会长蛆：落点搬走/改名后条目还在，"允许"就变成永久的 |
 * | R3 | 每个字段的编辑器落点 = `FIELD_SPECS` 里登记的**那一个文件** | 编辑器搬家是合法变更，但必须**同时改这张表**，否则悄悄长出第二个落点时这张表还指着老的 |
 *
 * ## 为什么"通路"要有白名单，而不是数文件数就完事
 *
 * 看板拖拽真的在 `App.tsx` 里调了 `store.moveToProject` —— 按"文件数"数它就是
 * 第二个落点，但它**不是**：它和详情卡写的是同一个 `store.moveToProject`，
 * 也就是同一个落点，只是另一条输入通路。
 * 🔴 若把这种通路一律判红，下一次的正确做法会变成"给看板单独写一个 setter" ——
 * 那才真的长出第二个落点。**所以白名单必须存在，但它必须是显式的、会过期的。**
 *
 * ## 自检（`--self-test`）
 *
 * 5 条臂 + 1 条阳性对照。臂在**内存里**构造文件集合，不写盘、不碰仓库
 * （本仓不允许门禁脚本改仓库）。判据与主扫描共用同一个 `judge()`。
 *
 * ```
 * node scripts/check-field-single-source.mjs              # 判一次
 * node scripts/check-field-single-source.mjs --self-test  # 自检
 * ```
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.env.HEYTA_CHECK_ROOT ?? process.cwd();

/**
 * 六个字段 → 它们的 store 动作 + **唯一**编辑器落点。
 *
 * `editor` 是判据 R3 的登记值：搬家时**必须**改这里，于是"编辑器换了地方"
 * 是一次看得见的改动，而不是一次静默漂移。
 */
const FIELD_SPECS = [
  { field: 'dueDate', method: 'setDueDate', editor: 'apps/web/src/features/tasks/TaskDetailCard.tsx' },
  { field: 'priority', method: 'setPriority', editor: 'apps/web/src/features/tasks/TaskDetailCard.tsx' },
  { field: 'tags', method: 'setTags', editor: 'apps/web/src/features/tasks/TaskDetailCard.tsx' },
  { field: 'project', method: 'moveToProject', editor: 'apps/web/src/features/tasks/TaskDetailCard.tsx' },
  { field: 'title', method: 'renameTask', editor: 'apps/web/src/features/tasks/TaskDetailCard.tsx' },
  { field: 'repeat', method: 'setRepeat', editor: 'apps/web/src/features/tasks/TaskDetailCard.tsx' },
];

/**
 * 输入通路白名单：**不是**落点，只是另一条指向同一落点的路。
 *
 * 每一条都必须带 `anchor`（源码里的字面量），且它必须仍在那个文件里 ——
 * 见判据 R2。加一条等于**声明**"这条路走的是同一个 setter"，需要理由。
 */
const GESTURE_PATHS = [
  {
    field: 'project',
    file: 'apps/web/src/App.tsx',
    anchor: 'onMoveTask={(taskId, projectId)',
    why: '看板拖拽：调的是同一个 store.moveToProject，属于输入通路不是第二个落点',
  },
];

/** 只扫这些根（相对仓库）。 */
const SCAN_ROOTS = ['apps/web/src'];

/* ─────────────────────────────── 扫描 ─────────────────────────────── */

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** 把仓库读成一个 `{ 相对路径 → 内容 }` 的映射。自检用同一形状喂假数据。 */
function readSources(root) {
  const files = new Map();
  for (const scope of SCAN_ROOTS) {
    for (const full of walk(join(root, scope))) {
      files.set(relative(root, full).split(sep).join('/'), readFileSync(full, 'utf8'));
    }
  }
  return files;
}

/**
 * 🔴 **判据只有这一份实现。**
 *
 * 第一版会把这段逻辑在主扫描与自检里各写一遍 —— 那两份一定会漂，
 * 而漂了之后自检测的是一个不存在的判据，并且它照样全绿（本仓踩过）。
 */
function judge(files) {
  const errors = [];
  const info = [];

  /** 这个方法在哪些文件里被调用（去掉测试文件；`.tsx` 只扫非 spec）。 */
  const callersOf = (method) => {
    const pattern = new RegExp(String.raw`\.${method}\s*\(`);
    const hits = [];
    for (const [file, content] of files) {
      if (/\.spec\.tsx?$/.test(file)) continue;
      if (pattern.test(content)) hits.push(file);
    }
    return hits.sort();
  };

  for (const spec of FIELD_SPECS) {
    const callers = callersOf(spec.method);
    const allow = GESTURE_PATHS.filter((g) => g.field === spec.field);
    const allowFiles = new Set(allow.map((g) => g.file));
    const editors = callers.filter((f) => !allowFiles.has(f));

    // R2：白名单条目必须仍有锚点（先判，否则 R1 会把过期条目的文件当成"合法通路"放过）
    for (const g of allow) {
      const content = files.get(g.file);
      if (content === undefined) {
        errors.push({
          rule: 'R2',
          message: `通路白名单指向的文件不存在：${g.file}（字段 ${spec.field}）`,
        });
      } else if (!content.includes(g.anchor)) {
        errors.push({
          rule: 'R2',
          message: `通路白名单的锚点已不在 ${g.file} 里：\`${g.anchor}\`（字段 ${spec.field}）—— 落点可能搬走了，删掉或更新这条`,
        });
      }
    }

    // R1：编辑器落点必须恰好一个
    if (editors.length === 0) {
      errors.push({
        rule: 'R1',
        message: `字段 ${spec.field}（${spec.method}）没有任何编辑器落点 —— 是改名了还是搬走了？`,
      });
    } else if (editors.length > 1) {
      errors.push({
        rule: 'R1',
        message:
          `字段 ${spec.field}（${spec.method}）有 ${String(editors.length)} 个编辑器落点：` +
          `${editors.join(' / ')} —— 只能有一个；若是输入通路，把它登记进 GESTURE_PATHS 并写明理由`,
      });
    }

    // R3：那一个落点必须是登记过的那一个
    if (editors.length === 1 && editors[0] !== spec.editor) {
      errors.push({
        rule: 'R3',
        message:
          `字段 ${spec.field} 的编辑器在 ${String(editors[0])}，但表里登记的是 ${spec.editor}` +
          ' —— 搬家请同时改这张表（否则这条表会一直指着旧位置）',
      });
    }

    info.push(
      `${spec.field.padEnd(8)} ${spec.method.padEnd(14)} 落点 ${String(editors.length)}（${
        editors[0] ?? '—'
      }）· 通路 ${String(allow.length)}`,
    );
  }

  return { errors, info };
}

/* ─────────────────────────────── 自检 ─────────────────────────────── */

function selfTest() {
  /**
   * 基线形状：6 个字段的调用**都在同一个编辑器文件里**（现实就是这样）。
   *
   * 🔴 第一版把每个字段各 `files.set()` 一次 —— 而它们指向同一个路径，
   * 后写的把先写的覆盖掉，于是阳性对照立刻红了 5 处。
   * 那不是判据坏了，是**自检的夹具坏了**：它构造的世界里根本不存在那个文件。
   */
  const EDITOR = FIELD_SPECS[0].editor;
  const base = () => {
    const files = new Map();
    files.set(
      EDITOR,
      FIELD_SPECS.map((spec) => `void store.${spec.method}(id, x);`).join('\n') + '\n',
    );
    files.set(
      'apps/web/src/App.tsx',
      'onMoveTask={(taskId, projectId) => { void store.moveToProject(taskId, projectId); }}\n',
    );
    return files;
  };

  const run = (mutate) => {
    const files = base();
    mutate(files);
    return judge(files);
  };

  const arms = [];

  // 臂 1：第二个编辑器落点 ⇒ R1 红（这条规则存在的理由）
  arms.push({
    name: '臂 1 第二个编辑器落点（setDueDate 另挂一个行内编辑器）',
    rule: 'R1',
    detail: (() => {
      const { errors } = run((f) => {
        f.set('apps/web/src/features/tasks/RowDueEditor.tsx', 'void store.setDueDate(id, x);\n');
      });
      return errors.some((e) => e.rule === 'R1') ? '' : '没有红在 R1';
    })(),
  });

  // 臂 2：白名单锚点消失 ⇒ R2 红（白名单长蛆）
  arms.push({
    name: '臂 2 通路白名单锚点失效（看板那条调用被改名）',
    rule: 'R2',
    detail: (() => {
      const { errors } = run((f) => {
        f.set('apps/web/src/App.tsx', 'void store.moveToProject(taskId, projectId);\n');
      });
      return errors.some((e) => e.rule === 'R2') ? '' : '没有红在 R2';
    })(),
  });

  // 臂 3：编辑器搬家但没改表 ⇒ R3 红
  arms.push({
    name: '臂 3 编辑器搬家未改登记表（setPriority 搬到新文件）',
    rule: 'R3',
    detail: (() => {
      const { errors } = run((f) => {
        const spec = FIELD_SPECS.find((s) => s.field === 'priority');
        f.set(EDITOR, f.get(EDITOR).replace(`store.${spec.method}(`, 'noop('));
        f.set('apps/web/src/features/tasks/NewPriority.tsx', `void store.${spec.method}(id, x);\n`);
      });
      return errors.some((e) => e.rule === 'R3') ? '' : '没有红在 R3';
    })(),
  });

  // 臂 4：字段彻底没有落点 ⇒ R1 红（改名/搬走也要被看见）
  arms.push({
    name: '臂 4 字段没有任何落点（setTags 被改名）',
    rule: 'R1',
    detail: (() => {
      const { errors } = run((f) => {
        const spec = FIELD_SPECS.find((s) => s.field === 'tags');
        f.set(EDITOR, f.get(EDITOR).replace(`store.${spec.method}(`, 'noop('));
      });
      return errors.some((e) => e.rule === 'R1') ? '' : '没有红在 R1';
    })(),
  });

  // 臂 5：阳性对照 —— 干净形状必须全绿（证明探针不是"什么都红"）
  arms.push({
    name: '臂 5 阳性对照（干净形状全绿）',
    rule: '—',
    detail: (() => {
      const { errors } = run(() => {});
      return errors.length === 0
        ? ''
        : `应为绿但红了 ${String(errors.length)} 处：${JSON.stringify(errors.map((e) => e.rule))}`;
    })(),
  });

  console.log('\n【自检】4 条臂 + 1 条阳性对照\n');
  let bad = 0;
  for (const a of arms) {
    if (a.detail === '') {
      console.log(`  ✅ ${a.name} → 按预期${a.rule === '—' ? '全绿' : `红在 ${a.rule}`}`);
    } else {
      bad += 1;
      console.log(`  ❌ ${a.name} → ${a.detail}`);
    }
  }
  if (bad > 0) {
    console.error(`\n❌ 自检失败：${String(bad)} 条臂没按预期。**形状门禁失效比没有门禁更糟** —— 先修门禁。`);
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ 自检通过：每条臂都真的能红，且干净形状全绿。\n');
}

/* ─────────────────────────────── 入口 ─────────────────────────────── */

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const { errors, info } = judge(readSources(ROOT));
  for (const line of info) console.log(`  · ${line}`);
  if (errors.length > 0) {
    console.error(`\n❌ 一个字段一个可编辑落点（P10 §7 R1）：${String(errors.length)} 处不通过\n`);
    for (const e of errors) console.error(`  [${e.rule}] ${e.message}\n`);
    process.exitCode = 1;
  } else {
    console.log('\n✅ 六个字段各自只有一个编辑器落点；通路白名单无过期条目。');
  }
}
