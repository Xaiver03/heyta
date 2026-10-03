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

import { readFileSync } from 'node:fs';

const PRODUCTION_STAGE = /^FROM\s[^\n]*\bAS\s+production\b/im;

export function readProductionStage(dockerfilePath) {
  const text = readFileSync(dockerfilePath, 'utf8');
  const lines = text.split('\n');
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
 * @returns {{
 *   installs: Array<{raw:string, specs:string[], omitDev:boolean, ignoreScripts:boolean, registry:string|null, usesPnpm:boolean}>,
 *   normalizedShape: string,
 * }}
 */
export function readImageInstallShape(dockerfilePath) {
  const runs = flattenRunLines(readProductionStage(dockerfilePath));
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
  };
}
