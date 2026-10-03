#!/usr/bin/env node
/**
 * `server/Dockerfile` 的构建参数（ARG）与 `server/docker-compose.build.yml` 的 `build.args`
 * 之间的**四条等式**。
 * ==============================================================================
 *
 * ## 为什么会有这个文件（触发它的是 `NODE_IMAGE`，但它不止管 `NODE_IMAGE`）
 *
 * 2026-10-04 给 Dockerfile 加基础镜像旋钮时，实测到的失败长这样：
 *
 * ```
 * #2 [internal] load metadata for docker.io/library/node:24-alpine
 * #2 ERROR: failed to authorize: DeadlineExceeded: failed to fetch anonymous token: … i/o timeout
 * ```
 *
 * 这条错误里**没有任何"哪一层错了"的线索**，因为 buildkit 是在执行第一条指令**之前**
 * 去要匿名 token 的。旋钮本身好加，危险的是加完之后它的**形状**：
 *
 * 1. `ARG` **不跨 `FROM` 继承** —— Dockerfile 有三个 `FROM`，所以旋钮必须声明**三次**。
 *    漏一次的症状是"三个阶段用了三个不同的 base"，而后两个漏掉的会直接**退回 Docker Hub**，
 *    于是在那台连不上 docker.io 的机器上，构建跑到最后一层才死。
 * 2. 三份默认值里任何一份漂了，`NODE_IMAGE` 就变成"看运气用哪一份"。
 * 3. compose 那份 override 是**第四份抄件**：`args:` 里写的是 `${NODE_IMAGE:-node:24-alpine}`，
 *    它会**无条件覆盖** Dockerfile 的默认值（compose 总是把这一项传下去）。
 *    所以 Dockerfile 说"默认是 A"而 compose 说"默认是 B"时，**实际生效的是 B** ——
 *    而 `pnpm check` 全绿，因为链从来不构建镜像（§8.7 记过同一件事）。
 * 4. 反向的洞同样静默：旋钮只加在 Dockerfile、没进 compose 的 `args:`，那么对外文档里
 *    那句"在 `.env` 里加这行再跑"**根本不生效** —— compose 不会把 `.env` 里那个变量
 *    变成一个 `--build-arg`。症状是"改了配置没反应，而且没有任何东西报错"。
 *
 * 这四条里，①②③④ 都是**只有把判据写成跨文件等式才挡得住**的：单看一个文件永远自洽。
 *
 * ## 四条判据
 *
 * | 号 | 判据 | 红的时候是什么形状 |
 * |---|---|---|
 * | R1 | 同名 ARG 在 Dockerfile 里的**每一份声明**默认值逐字相同 | 有人只改了一处默认值 |
 * | R2 | 每个 `FROM ${NAME}` 之前，**同一个 stage 内**必须有 `ARG NAME=…` | 漏声明 ⇒ 那一段退回 Docker Hub |
 * | R3 | compose `args:` 里每一项 Dockerfile 都必须声明过 | 死旋钮（compose 传了没人收） |
 * | R4 | Dockerfile 里每一个 ARG compose 都必须传；两处的**默认值必须相同**，除非在 `DEFAULT_MAY_DIFFER` 里逐条写明为什么 | ① 文档承诺的 `.env` 旋钮没接线；② 两处默认值不同而没人拍过板 |
 *
 * ⚠️ `DEFAULT_MAY_DIFFER` 现在只有一条：`VCS_REF`（compose 侧默认 `local`、Dockerfile 侧
 * 默认 `unknown`）。这不是疏漏，是**刻意的不同** —— compose 那条要的是"这台机器上打的本地
 * 构建"这个人能读懂的标签，Dockerfile 那条要的是"没人给值时别装作有版本"。
 * 加一条的成本（必须写理由）也是刻意的：判据一旦靠"两边默认值可以不一样"来放行新旋钮，
 * 它就已经不再是判据了。
 *
 * ## 用法
 *
 * ```sh
 * node research/tools/check-image-build-args.mjs                # pnpm check 链里的一条
 * node research/tools/check-image-build-args.mjs --root <dir>   # 变异验证用（只读那份树里的两个文件）
 * ```
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DEFAULT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
};
const root = resolve(argOf('root') ?? ROOT_DEFAULT);
const DOCKERFILE = join(root, 'server/Dockerfile');
const COMPOSE = join(root, 'server/docker-compose.build.yml');

const reds = [];
const notes = [];
const fail = (rule, where, detail) => {
  reds.push(`❌ ${rule}  ${where}\n    ${detail}`);
};

/** 默认值可以不同的 ARG（键是 ARG 名，值是**理由**）。加一条要先回答"为什么这不是漂移"。 */
const DEFAULT_MAY_DIFFER = {
  VCS_REF:
    'compose 侧要的是"这台机器上打的本地构建"这个人能读懂的标签（local），' +
    'Dockerfile 侧要的是"没人给值时别装作有版本"（unknown）。',
};

// ── 读 Dockerfile：按 stage 切，ARG 的作用域只到下一个 FROM ────────────────
const dockerLines = readFileSync(DOCKERFILE, 'utf8').split('\n');

/** @type {{name:string, def:string, line:number, stage:string}[]} */
const dockerArgs = [];
/** @type {{name:string|null, alias:string|null, line:number}[]} */
const froms = [];
let currentStage = '(preamble)';

for (let i = 0; i < dockerLines.length; i += 1) {
  const line = dockerLines[i];
  const arg = /^ARG\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (arg) {
    dockerArgs.push({ name: arg[1], def: arg[2], line: i + 1, stage: currentStage });
    continue;
  }
  const from = /^FROM\s+(\S+)(?:\s+AS\s+([A-Za-z0-9_-]+))?\s*$/i.exec(line);
  if (from) {
    const alias = from[2] ?? null;
    froms.push({ name: from[1].startsWith('${') ? from[1].slice(2, -1) : null, alias, line: i + 1 });
    currentStage = alias ?? `FROM@${String(i + 1)}`;
  }
}

if (froms.length === 0) fail('R0', DOCKERFILE, '一个 FROM 都没读到 —— 探针瞎了，这不算通过');
if (dockerArgs.length === 0) fail('R0', DOCKERFILE, '一个带默认值的 ARG 都没读到 —— 探针瞎了，这不算通过');

// ── R1：同名 ARG 的多份声明，默认值必须逐字相同 ───────────────────────────
const byName = new Map();
for (const a of dockerArgs) {
  if (!byName.has(a.name)) byName.set(a.name, []);
  byName.get(a.name).push(a);
}
for (const [name, list] of byName) {
  const distinct = [...new Set(list.map((a) => a.def))];
  if (distinct.length > 1) {
    fail(
      'R1',
      `${DOCKERFILE} · ${name}`,
      `同一个 ARG 有 ${String(distinct.length)} 个不同的默认值：` +
        list.map((a) => `${name}=${a.def}@${String(a.line)}`).join(' / ') +
        '。ARG 不跨 FROM 继承，所以每个 stage 各有一份声明；漂一份 ⇒ 哪一段用哪个源取决于行号。',
    );
  }
}

// ── R2：FROM ${NAME} 必须在同一个 stage 内先声明过 ─────────────────────────
for (const f of froms) {
  if (f.name === null) continue;
  const declared = dockerArgs.filter((a) => a.name === f.name && a.line < f.line);
  // "同一个 stage 内" = 上一个 FROM 之后。ARG 不跨 FROM 继承，所以更早的声明等于没声明。
  const priorFrom = froms.filter((g) => g.line < f.line).pop();
  const inStage = priorFrom ? declared.filter((a) => a.line > priorFrom.line) : declared;
  if (inStage.length === 0) {
    fail(
      'R2',
      `${DOCKERFILE}:${String(f.line)} · FROM \${${f.name}} AS ${String(f.alias)}`,
      `这一段之前**没有** \`ARG ${f.name}=…\`。ARG 不跨 FROM 继承 ⇒ 这一段用的是 Dockerfile ` +
        '解析出来的空值，等价于**没接这个旋钮**：那台连不上 docker.io 的机器会在这一段退回 Docker Hub。',
    );
  }
}

// ── 读 compose 的 build.args（只取 supersync 那一个服务的 args 映射）───────
const composeLines = readFileSync(COMPOSE, 'utf8').split('\n');
/** @type {{name:string, envName:string, def:string|null, line:number}[]} */
const composeArgs = [];
let inArgs = false;
let argsIndent = -1;
for (let i = 0; i < composeLines.length; i += 1) {
  const raw = composeLines[i];
  if (/^\s*args:\s*$/.test(raw)) {
    inArgs = true;
    argsIndent = /^\s*/.exec(raw)[0].length;
    continue;
  }
  if (!inArgs) continue;
  if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
  if (/^\s*\S/.test(raw) && /^\s*/.exec(raw)[0].length <= argsIndent) {
    inArgs = false;
    continue;
  }
  const kv = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.+?)\s*$/.exec(raw);
  if (!kv) {
    fail('R0', `${COMPOSE}:${String(i + 1)}`, `args: 里读不懂这一行：${raw}`);
    continue;
  }
  const value = kv[2];
  const interp = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}$/.exec(value);
  if (interp) {
    composeArgs.push({ name: kv[1], envName: interp[1], def: interp[2] ?? null, line: i + 1 });
  } else {
    composeArgs.push({ name: kv[1], envName: kv[1], def: value, line: i + 1 });
  }
}
if (composeArgs.length === 0) {
  fail('R0', COMPOSE, '`args:` 段一个条目都没读到 —— 是探针瞎了，不是"没有旋钮"');
}

// ── R3：compose 传的每一项，Dockerfile 都必须声明过（死旋钮）───────────────
for (const c of composeArgs) {
  if (!byName.has(c.name)) {
    fail(
      'R3',
      `${COMPOSE}:${String(c.line)} · ${c.name}`,
      'compose 传了一个 Dockerfile 里**没有声明**的构建参数。docker build 不会为它报错，' +
        '只会把它当"没人用的参数"忽略 ⇒ 界面上那个旋钮接在文档里，不接在镜像上。',
    );
  }
}

// ── R4：Dockerfile 的每一个 ARG compose 都要传，且默认值要相同 ─────────────
const composeByName = new Map(composeArgs.map((c) => [c.name, c]));
for (const [name, list] of byName) {
  const c = composeByName.get(name);
  if (!c) {
    fail(
      'R4',
      `${DOCKERFILE}:${String(list[0].line)} · ${name}`,
      '这个 ARG 没进 compose 的 `build.args`。对外文档承诺的是"在 `.env` 里加一行再跑"，' +
        '而 compose **不会**把 `.env` 里没被 `args:` 引用的变量变成 `--build-arg` ⇒ ' +
        '走 compose 的人改了配置没有任何反应，也不报错。',
    );
    continue;
  }
  const dockerDef = list[0].def;
  if (c.def === dockerDef) continue;
  if (DEFAULT_MAY_DIFFER[name]) {
    notes.push(
      `${name}：两处默认值**刻意不同**（Dockerfile ${dockerDef} / compose ${String(c.def)}）—— ` +
        DEFAULT_MAY_DIFFER[name],
    );
    continue;
  }
  fail(
    'R4',
    `${name}：Dockerfile 默认 ${dockerDef} ≠ compose 默认 ${String(c.def)}`,
    'compose 的 `args:` 总会把这一项传下去，所以**生效的是 compose 那份**，' +
      '而 Dockerfile 里那句"默认值逐字等于今天的行为"就成了假话。' +
      '确实要让它俩不同的话，在 `DEFAULT_MAY_DIFFER` 里写明理由。',
  );
}

// ── 读数（判据的输出必须是证据，不是一个 ✅）──────────────────────────────
/**
 * ── R5：每个 FROM 都必须是 `FROM ${NODE_IMAGE} AS <alias>` ────────────────
 *
 * R1–R4 全是**跨文件等式**，而等式有个共同的盲区：把两边**一起**改回原样，等式照样成立。
 * 所以这里钉的是那个旋钮**本身还在不在**：三个阶段共用一个 base 来源，且都带别名
 * （别名是 `gen-image-npm-tree.mjs` 与 `image-install-shape.mjs` 读阶段的锚点）。
 * 有人把 `ARG NODE_IMAGE` 整族撤掉 ⇒ R1/R3/R4 一条都不会响，而 R5 立刻数出
 * "有一段的 base 是字面量，另一段是变量"或"三段全是字面量"。
 */
const lineOf = (lines, oneBased) => String(lines[oneBased - 1] ?? '').trim();

for (const f of froms) {
  if (f.name !== 'NODE_IMAGE' || f.alias === null) {
    fail(
      'R5',
      `${DOCKERFILE}:${String(f.line)} · ${lineOf(dockerLines, f.line)}`,
      '这一段的 base 不是 `FROM ${NODE_IMAGE} AS <别名>`。三个阶段必须同源：' +
        'base 不一样意味着"镜像里装了什么"再也没有一个答案，而别名没了会让按阶段读的工具' +
        '（`image-install-shape.mjs` / `gen-image-npm-tree.mjs`）读不到这一段。',
    );
  }
}

const summary = [...byName].map(
  ([name, list]) => `${name}×${String(list.length)}（默认 ${list[0].def}）`,
);
if (reds.length > 0) {
  console.error(
    `\n读到的形状：Dockerfile ${String(froms.length)} 段 / ${String(dockerArgs.length)} 条 ARG` +
      `（${summary.join('、')}），compose ${String(composeArgs.length)} 条 args。\n`,
  );
  console.error(reds.join('\n'));
  console.error(
    `\n共 ${String(reds.length)} 条红。这些等式的存在理由见文件头：` +
      '`pnpm check` 从来不构建镜像，而漂移的形状只在**两个文件之间**才看得见。',
  );
  process.exit(1);
}

for (const n of notes) console.log(`   · ${n}`);
console.log(
  `✅ 镜像构建参数：${String(froms.length)} 段全部 \`FROM \${NODE_IMAGE} AS …\`（R5）｜` +
    `同名 ARG 默认值逐字一致（R1，${summary.join('、')}）｜` +
    `每段 FROM 之前同段内有 ARG（R2）｜compose 传的 ${String(composeArgs.length)} 项 Dockerfile 全认（R3）｜` +
    `Dockerfile 的 ${String(byName.size)} 个 ARG compose 全传且默认值相同（R4，例外 ${String(notes.length)} 条已写明理由）`,
);
