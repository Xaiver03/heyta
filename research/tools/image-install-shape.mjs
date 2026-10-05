// 从 `server/Dockerfile` 的**生产阶段**里读出"镜像那棵树是怎么装出来的"。
//
// 为什么不是抄一份清单：这正是本仓库反复付过学费的那件事（AGENTS §3.2
// "失败判据被抄了三遍，三遍都漏了同一项"）。这段形状住在两个消费者里：
//   · research/tools/gen-image-npm-tree.mjs   —— 生成镜像依赖树快照
//   · research/tools/check-image-license-coverage.mjs —— 对账
// 两边各写一份正则，漂了的症状是"对账在量一个没人装的东西"，而且它**会绿**。
//
// 🔴 这里刻意**不**解释整个 Dockerfile：只取 `FROM … AS production` 之后、
// 以 `npm install` 开头的那些行。取多取少都会改变对账证明的东西。
//
// 2026-10-04 起本文件还管第二件事：`server/package.json` 里**哪些顶层字段能改变镜像里那棵树**
// （`readServerInstallInput`）。理由是同一族的 —— 那个判断原先住在两个消费者里，各自
// "哈希整个文件的字节"，于是任何一次与树无关的改动都会把快照判成过期。

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const PRODUCTION_STAGE = /^FROM\s[^\n]*\bAS\s+production\b/im;

export function readProductionStage(dockerfilePath) {
  return productionStageLines(readFileSync(dockerfilePath, 'utf8').split('\n'));
}

// 这一段以前直接读文件，所以**还没写盘的那个版本**没法问它"这样合有没有改变装出来的东西"。
// 载体解第九族时必须先算出产出再判它（落盘之后再判就变成"事后诸葛"：红的时候文件已经坏了），
// 所以把纯计算抽出来，读路径只是它的一层薄壳。
function productionStageLines(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (PRODUCTION_STAGE.test(lines[i])) start = i;
  }
  if (start < 0) {
    throw new Error(
      '`server/Dockerfile` 里没有一个 `FROM … AS production` 阶段 —— 生产阶段被改名或删掉了，' +
        '这条对账已经没有可读的对象。',
    );
  }
  return lines.slice(start);
}

// 把 `RUN a && b && c` 折平成一条一条的命令（保留续行 `\\`）。
function flattenRunLines(stageLines) {
  const runs = [];
  let buffer = null;
  for (const raw of stageLines) {
    const line = raw.replace(/\r$/, '');
    if (buffer !== null) {
      if (/\\\s*$/.test(buffer)) {
        buffer = buffer.replace(/\\\s*$/, ' ') + line.trim();
        continue;
      }
      runs.push(buffer);
      buffer = null;
    }
    if (/^RUN\s/.test(line)) {
      if (/\\\s*$/.test(line)) buffer = line;
      else runs.push(line);
    }
  }
  if (buffer !== null) runs.push(buffer);
  return runs;
}

/**
 * 同一个判定，输入是 **Dockerfile 全文**而不是路径 —— 给"还没写盘的那个版本"用
 * （载体解第九族时必须拿着产出先问一次，落盘之后再问就成了事后诸葛）。
 * 🔴 这不是第二份实现：它和 `readImageInstallShape` 走的是同一条 `shapeOfStageLines`。
 * @returns 同 `readImageInstallShape`
 */
export function readImageInstallShapeFromText(text) {
  return shapeOfStageLines(text.split('\n'));
}

/**
 * @returns {{
 *   installs: Array<{raw:string, specs:string[], omitDev:boolean, ignoreScripts:boolean, registry:string|null, usesPnpm:boolean}>,
 *   normalizedShape: string,
 * }}
 */
export function readImageInstallShape(dockerfilePath) {
  return shapeOfStageLines(readFileSync(dockerfilePath, 'utf8').split('\n'));
}

function shapeOfStageLines(allLines) {
  const runs = flattenRunLines(productionStageLines(allLines));
  const installs = [];
  for (const run of runs) {
    // 一个 RUN 里可以串好几条命令（&& / ;），逐条找 `npm install` / `pnpm install`。
    for (const part of run.replace(/^RUN\s+/, '').split(/&&|;/)) {
      const cmd = part.trim();
      if (!/\b(npm|pnpm)\s+(install|i|ci)\b/.test(cmd)) continue;
      const afterInstall = cmd.replace(/^.*?\b(npm|pnpm)\s+(install|i|ci)\b/, '').trim();
      const tokens = afterInstall.split(/\s+/).filter(Boolean);
      const specs = [];
      let omitDev = false;
      let ignoreScripts = false;
      let registry = null;
      for (const t of tokens) {
        if (t === '--omit=dev') omitDev = true;
        else if (t === '--production' || t === '--omit=dev,true') omitDev = true;
        else if (t === '--ignore-scripts') ignoreScripts = true;
        else if (t.startsWith('--registry=')) registry = t.slice('--registry='.length);
        else if (t.startsWith('-')) continue;
        else if (t.startsWith('"') || t.startsWith('$')) specs.push(t);
        else specs.push(t);
      }
      installs.push({
        raw: cmd,
        specs,
        omitDev,
        ignoreScripts,
        registry,
        usesPnpm: /^\s*pnpm\b/.test(cmd) || /\bpnpm\s+(install|i|ci)\b/.test(cmd),
      });
    }
  }
  return {
    installs,
    // 只哈希"装东西的那几行"，不哈希整个 Dockerfile —— 否则改一行注释就会让快照
    // 看起来过期，而那种红灯教不会任何人任何东西。
    normalizedShape: installs.map((i) => i.raw.replace(/\s+/g, ' ')).join('\n'),
    // 🔴 生产阶段有没有在**任何一条 install 之前**把 devDependencies 摘掉（见下方
    // `prunesDevDependencies` 为什么是承重的）。取"第一条 install 之前的 RUN 段"来判断，
    // 而不是"文件里出现过这句话"：装在后面就等于没装 —— 树已经 E404 死了。
    prunesDevDependencies: prunesBeforeFirstInstall(runs),
  };
}

// `npm pkg delete devDependencies` 的唯一允许形状（契约门禁 `check:image-install-contract`
// 第 5 步与这里的判定共用这一份正则 —— 抄两遍就是下一次漂移的起点）。
export const PRUNE_DEV_DEPS_RE = /\bnpm\s+pkg\s+delete\s+devDependencies\b/;

// 把每个 RUN 折平成 `&&` / `;` 分隔的步骤序列，看"删 devDependencies"这一步
// 是否**严格早于**第一条 install。
function prunesBeforeFirstInstall(runs) {
  for (const run of runs) {
    const steps = run
      .replace(/^RUN\s+/, '')
      .split(/&&|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    const firstInstall = steps.findIndex((s) => /\b(npm|pnpm)\s+(install|i|ci)\b/.test(s));
    const prune = steps.findIndex((s) => PRUNE_DEV_DEPS_RE.test(s));
    if (prune >= 0) return firstInstall < 0 || prune < firstInstall;
  }
  return false;
}

// ── 第二件事：`server/package.json` 里"能改变镜像那棵树"的到底是哪几档 ─────────
//
// 🔴 这一档以前哈希的是**整个文件的字节**，而那个形状两头都错：
//   · 太宽 —— 改一行 `scripts` 里的 vitest 清单就会让快照"看起来过期"，可它不可能改变
//     镜像里装出来的任何东西。本文件上面那句"只哈希装东西的那几行，别哈希整个 Dockerfile"
//     的道理，当时只落在了 Dockerfile 这一侧，没落到 package.json 这一侧。
//     现量：main `b3397cda` 只动了 `scripts` + 三枚 devDependencies，
//     载体上 `check:image-license` 就红在"server/package.json 变了"这一条。
//   · 另一种错 —— 把"其实会影响解析"的字段当成惰性，从此没有任何一层会知道。
// 所以这里是**显式分区 + 未分类即失败**：`server/package.json` 里新出现的顶层字段，
// 必须先被判定过（它会不会改变镜像里那棵树）才能进快照，判定动作落在写这个表的地方。
const TREE_AFFECTING = {
  dependencies: '每一条都并进 mergedDeps，就是镜像里那棵树本体',
  optionalDependencies: 'npm 会装（只是允许装失败）',
  overrides: '直接改写解析出来的版本',
  peerDependencies: 'npm 7+ 会连 peer 一起装',
  bundleDependencies: '决定哪些包随包发布进镜像',
};

const INERT = {
  name: '根包不发布，进不了那棵树',
  version: '同上（镜像里的版本走 OCI 标签，不走这里）',
  description: '元数据',
  keywords: '元数据',
  license: '元数据（许可证对账读的是各依赖自己的 manifest）',
  author: '元数据',
  repository: '元数据',
  homepage: '元数据',
  bugs: '元数据',
  private: '不发布，与树无关',
  type: '模块解析方式，不改变装了哪些包',
  main: '入口指针，不改变装了哪些包',
  files: '只对 publish 生效',
  engines: '只在 engine-strict 下生效，而构建没开它',
  bin: '链接已经装上的包，不新增内容',
  prisma: 'prisma CLI 找 schema 的位置，不是依赖声明',
  scripts: '镜像跑的是 dist/，这些脚本在生产阶段不执行',
  devDependencies:
    '生产装依赖带 `--omit=dev` ⇒ 不进树。🔴 **但这份惰性是有前提的**：npm 在 `--omit=dev` 下仍然会' +
    '**解析** dev 的每一枚 spec（实测 npm 11.19.0 / node:24-alpine），而 `@heyta/*` 这种只存在于本机' +
    ' pnpm 工作区的包在 registry 上是 404 ⇒ 整条 install 当场死。前提由 `prunesDevDependencies` 判定；' +
    '生产阶段那条 `npm pkg delete devDependencies` 一旦不在，这一档自动挪回被哈希的集合。',
};

/**
 * @param {{serverPkgPath:string, prunesDevDependencies:boolean}} opts
 * @returns {{sha256:string, hashedKeys:string[], inertKeys:string[]}}
 * @throws 读到未分类的顶层字段、或 JSON 读不出来时抛错（两个消费者共享这一份判断）
 */
export function readServerInstallInput({ serverPkgPath, prunesDevDependencies }) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(serverPkgPath, 'utf8'));
  } catch (e) {
    throw new Error(`读不出 ${serverPkgPath}：${e.message}`);
  }
  const devIsInert = prunesDevDependencies;
  const keys = Object.keys(pkg);
  const isHashed = (k) => Boolean(TREE_AFFECTING[k]) || (k === 'devDependencies' && !devIsInert);
  const isInert = (k) => Boolean(INERT[k]) && !(k === 'devDependencies' && !devIsInert);
  const unclassified = keys.filter((k) => !isHashed(k) && !isInert(k));
  if (unclassified.length > 0) {
    throw new Error(
      '`server/package.json` 里有 ' + unclassified.length + ' 个顶层字段从没被判定过：' +
        unclassified.map((k) => `\`${k}\``).join(' / ') +
        ' —— 它会不会改变镜像里那棵树？判定之后写进本文件的 `TREE_AFFECTING`（会）或 `INERT`（不会，写清为什么）。' +
        '默认当作"会影响"之前先回答这个问题，而不是让它悄悄进快照或悄悄不进。',
    );
  }
  const hashedKeys = keys.filter(isHashed).sort();
  const canonical = {};
  for (const k of hashedKeys) canonical[k] = pkg[k];
  return {
    sha256: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    hashedKeys,
    inertKeys: keys.filter(isInert).sort(),
  };
}
