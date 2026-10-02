#!/usr/bin/env node
/**
 * 真端点验收的**配置装载与"跳过"判据 —— 唯一事实源**
 * ==================================================
 *
 * 🔴 为什么这个文件存在：`verify:ai-live` / `-breakdown-live` /
 * `verify:ai-output-language` / `-preferences-live` 四个脚本原来**各自抄了一遍**
 * "读配置 → 读不到就 `process.exit(0)`"。那份判据的语义是错的：
 *
 *   **「没配端点」不是「验过了」，而退出 0 在退出码这一层把它们长得一模一样。**
 *   结果是这三条（加上 preferences 那份）可以在**一次都没碰过真模型**的情况下
 *   连续报绿 —— 本仓库 §7 元规则第 2 条（"一条永远通过的判据比没有判据更糟"）
 *   的现行实例。配置被搬到 /tmp 的一个改名副本后没归位，**没有任何一层会失败**。
 *
 * ⚠️ 严重性要说准：这四个脚本**都不在 `pnpm check` 里**（它们是手工验收，
 * 需要真 API key，挂进门禁只会逼人把 key 塞进仓库）。所以它们**没有骗到过 CI**，
 * 骗到的是**运行它的人**。修法一样，只是不要把它写成"门禁假绿"。
 *
 * ## 现在的规则
 *
 * 配置缺失 / 不完整 ⇒ **默认退出码 2**（响亮地"这条没跑"），
 * 只有显式声明才允许跳过：
 *
 *   - `--skip`，或
 *   - `HEYTA_AI_LIVE_ALLOW_SKIP=1`
 *
 * 跳过时**照样打大字警告**（"这一轮没有验真端点"），只是退出码回到 0 ——
 * 让"我知道我没跑"成为一次**有意识的动作**，而不是默认行为。
 *
 * 退出码分三档，为了让人和脚本都能区分：
 *   0 = 跑了且全绿（或显式 --skip）
 *   1 = 跑了且有红（真失败）
 *   2 = **根本没跑**（配置缺失/不完整，且没显式允许跳过）
 *
 * 配置字段（`endpoint`/`apiKey`/`model`）缺失是**不完整**，走同一条路；
 * 但文件存在而 JSON 解析失败是**配置写坏了** —— 那属于"跑了但坏了"，抛错退出 1，
 * 不许伪装成"还没配"。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';

export const CONFIG_ENV = 'HEYTA_AI_LIVE_CONFIG';
export const SKIP_ENV = 'HEYTA_AI_LIVE_ALLOW_SKIP';
export const DEFAULT_CONFIG_PATH = '/tmp/heyta-ai-live/provider.json';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_NOT_RUN = 2;

/**
 * 找一个"看起来是被搬走的旧配置"。
 *
 * 🔴 这条不是便利功能，是**这次事故的形状**：配置没被删除，是被改名搬到 /tmp 根下
 * （`heyta-ai-live-provider.json.stashed-by-i18n-round`）。只报"没找到配置"会把人
 * 引向"去配一个"，而真相是"你有一个，但它不在期望路径上"。两种诊断的修法不同。
 *
 * 只在 /tmp 一层做前缀匹配，不递归、不读内容 —— 找到也**不自动用**它：
 * 用不用一份凭据必须是显式决定，否则"改个文件名"就能绕过这道闸门。
 */
function findRelocatedCandidates() {
  const tmpDir = '/tmp';
  try {
    return readdirSync(tmpDir)
      .filter((name) => name.startsWith('heyta-ai-live-provider'))
      .map((name) => `${tmpDir}/${name}`);
  } catch {
    return [];
  }
}

function skipAllowed() {
  return process.argv.includes('--skip') || process.env[SKIP_ENV] === '1';
}

/**
 * 装载真端点配置，或在"这条验收没跑"时**响亮地**收尾。
 *
 * @param {string} invocation 打印用的**可复制命令**（如 `pnpm verify:ai-live`
 *   或 `node scripts/verify-ai-output-language.mjs`）。
 *   ⚠️ 故意由调用方给，不在这里拼 `pnpm <name>`：
 *   `verify-ai-output-language.mjs` **没有 `verify:` 别名**（`package.json` 里查不到），
 *   拼出来的提示会是一条不存在的命令 —— 提示错一个字符，人就当它是假的。
 * @param {readonly string[]} required 必须为非空字符串的字段
 * @returns {Record<string, string> & { path: string }} 一定返回（否则本函数已 exit）
 */
export function requireLiveProviderConfig(
  invocation,
  required = ['endpoint', 'apiKey', 'model'],
) {
  const path = process.env[CONFIG_ENV] ?? DEFAULT_CONFIG_PATH;
  let raw;
  let missingReason;

  if (!existsSync(path)) {
    missingReason = `配置文件不存在：${path}`;
  } else {
    try {
      raw = readFileSync(path, 'utf8');
    } catch (error) {
      console.error(`❌ 配置文件读不了：${path} —— ${error.message}`);
      process.exit(EXIT_FAILED);
    }
  }

  let parsed;
  if (raw !== undefined) {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error(`❌ 配置文件不是合法 JSON：${path} —— ${error.message}`);
      console.error('   这是"配置写坏了"，不是"还没配" —— 本脚本不会把它当成跳过。');
      process.exit(EXIT_FAILED);
    }
    const absent = required.filter(
      (field) => typeof parsed[field] !== 'string' || parsed[field] === '',
    );
    if (absent.length > 0) {
      missingReason = `配置缺少字段 ${absent.join(' / ')}：${path}`;
    }
  }

  if (missingReason === undefined) {
    return { path, ...parsed };
  }

  const relocated = findRelocatedCandidates();
  console.log('');
  console.log('━'.repeat(72));
  if (skipAllowed()) {
    console.log(`⚠️  ${invocation}：这一轮**没有验真端点**（显式允许跳过）`);
  } else {
    console.log(`❌ ${invocation}：这一轮**没有验真端点**，判据一条都没跑。`);
  }
  console.log(`   ${missingReason}`);
  if (relocated.length > 0) {
    console.log('   🔎 /tmp 下找到疑似**被搬走**的同名配置（本脚本不会自动使用它）：');
    for (const candidate of relocated) {
      console.log(`      ${candidate}`);
    }
    console.log('   要么把它放回期望路径，要么显式指过去：');
  }
  console.log(`   ${CONFIG_ENV}=<path> ${invocation}`);
  console.log('   确实要在本轮跳过（CI / 无凭据的环境）—— 必须显式声明，默认不跳过：');
  console.log(`   ${SKIP_ENV}=1 ${invocation}   # 或给命令加 --skip`);
  console.log('━'.repeat(72));
  console.log('');
  process.exit(skipAllowed() ? EXIT_OK : EXIT_NOT_RUN);
}
