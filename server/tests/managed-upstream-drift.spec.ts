/**
 * 两份**境内表**的漂移对账（读盘，不 import）。
 * ============================================
 *
 * ## 为什么这个文件存在
 *
 * `server/src/ai/managed-upstream.ts` 里的 `SERVER_MANAGED_MODEL_HOSTS` 是
 * `packages/ai/src/managed-endpoints.ts` 里 `MANAGED_MODEL_HOSTS` 的**镜像**。
 * 镜像这件事本身是本轮权衡之后的选择，理由写在那份文件头：
 * `server/Dockerfile` 的 builder 阶段只 COPY/pack `sync-core`+`shared-schema`+`domain` 三包，
 * `packages/ai` 只进 **web 阶段** ⇒ 运行时 `import '@heyta/ai'` 是**镜像里起不来**的
 * （AGENTS §6.1「门禁绿 ≠ 能打包」，同一个坑在 Dockerfile 自己记过两次）。
 *
 * 🔴 抄一份的代价就是"两份会漂"。而漂了的后果不是编译错误，是
 * **服务端把用户的明文转发到一家我们从来没有判定过它境外的 API**。
 * 所以这一对表必须有一条**能失败**的对账 —— 不能失败的检查没有价值（AGENTS §8.3）。
 *
 * ## 为什么是"从盘上读"而不是 import
 *
 * import 就是把依赖真的装上（那条 Docker 的代价），而这里要证的只是**两个字符串集合相等**。
 * 读文件 + 解析是零依赖的做法，与 `scripts/check-ai-quota-consistency.mjs` 用同一个正则
 * 从文档里解析那个数字是同一类手法。
 *
 * ⚠️ 这个文件**只在仓库里跑**（镜像里没有 `packages/`，而测试也不进镜像）。
 * 所以动那份表时不能只跑 `pnpm --filter @heyta/ai test` —— 必须连这里一起跑。
 * 读到不到文件时**抛错**而不是 skip：`门禁没能运行 ≠ 门禁通过`。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SERVER_MANAGED_AI_FEATURES,
  SERVER_MANAGED_MODEL_HOSTS,
} from '../src/ai/managed-upstream';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOWLIST_FILE = 'packages/ai/src/managed-endpoints.ts';
const EGRESS_FILE = 'packages/ai/src/egress.ts';

const readFromRepo = (relative: string): string => {
  try {
    return readFileSync(join(repoRoot, relative), 'utf8');
  } catch {
    throw new Error(
      `读不到 ${relative} —— 对账**没能运行**，这不是通过。\n` +
        '   🔴 如果那份文件被挪走了，请更新本文件的锚点；如果是在镜像里跑，请把测试移出镜像。',
    );
  }
};

interface ParsedHost {
  readonly host: string;
  readonly provider: string;
  readonly jurisdiction: string;
}

/**
 * 从 `MANAGED_MODEL_HOSTS` 的数组体里逐条取出 `{host, provider, jurisdiction}`。
 *
 * 🔴 解析不到任何一条时**抛**，不是返回空数组。返回空的话，"那份表被重构成了
 * 另一种写法"会让本文件变成**一组测着不存在的东西的绿灯** —— 而输出看起来是
 * 「对账通过」。这一条的形状在 `scripts/check-ai-quota-consistency.mjs` 里
 * 被写得很明白（`must()`：找不到预期的写法就抛）。
 */
const parseAllowlist = (): ParsedHost[] => {
  const text = readFromRepo(ALLOWLIST_FILE);
  const body = /MANAGED_MODEL_HOSTS[^=]*=\s*\[[\s\S]*?\];/.exec(text)?.[0];
  if (body === undefined) {
    throw new Error(
      `在 ${ALLOWLIST_FILE} 里找不到 \`MANAGED_MODEL_HOSTS: … = […];\` 这个形状。\n` +
        '   🔴 那份表被改名或重构时，请更新本文件的锚点 —— 而不是删掉这条对账：\n' +
        '      两份境内表漂开的后果是服务端把明文转发到一家从未被判定为境内的 API。',
    );
  }
  const found = [
    ...body.matchAll(
      /host:\s*'([^']+)'\s*,\s*provider:\s*'([^']+)'\s*,\s*jurisdiction:\s*'([^']+)'/g,
    ),
  ].map((match) => ({
    host: String(match[1]),
    provider: String(match[2]),
    jurisdiction: String(match[3]),
  }));
  if (found.length === 0) {
    throw new Error(
      `在 ${ALLOWLIST_FILE} 的数组体里解析出 **0** 条条目 —— 锚点失效（字段顺序变了？）。` +
        '   🔴 修解析，不要修断言。',
    );
  }
  return found;
};

/** 取出 `export type AiFeature = … ;` 那一段里的全部联合成员。 */
const parseFeatures = (): string[] => {
  const text = readFromRepo(EGRESS_FILE);
  const body = /export type AiFeature =([\s\S]*?);/.exec(text)?.[1];
  if (body === undefined) {
    throw new Error(
      `在 ${EGRESS_FILE} 里找不到 \`export type AiFeature = … ;\`。` +
        '   🔴 服务端日志里的"功能名"必须与这份封闭词表同源，否则 ADR-0054 §4 那句\n' +
        '      "封闭词表里的五个之一"变成一个自由字符串 —— 日志就从后门变成了内容仓库。',
    );
  }
  const found = [...body.matchAll(/^\s*\|\s*'([a-z][a-z-]*)'/gm)].map((m) => String(m[1]));
  if (found.length === 0) {
    throw new Error(`在 AiFeature 联合里解析出 **0** 个成员 —— 锚点失效，请修解析。`);
  }
  return found;
};

describe('境内白名单：服务端那份与 packages/ai 那份逐条对账', () => {
  const allowlist = parseAllowlist();

  it('主机集合**完全相等**（不多、不少、不重叠）', () => {
    const theirs = new Set(allowlist.map((entry) => entry.host));
    const ours = new Set(SERVER_MANAGED_MODEL_HOSTS.map((entry) => entry.host));
    expect([...ours].sort()).toEqual([...theirs].sort());
  });

  it('条数一致 ⇒ 镜像没有"少抄一行"（少抄的后果是**合格的上游被拒**，那是一句谎话）', () => {
    expect(SERVER_MANAGED_MODEL_HOSTS).toHaveLength(allowlist.length);
  });

  it('每一条的 `jurisdiction` 与 `provider` 两边逐字相同', () => {
    for (const entry of allowlist) {
      const mirror = SERVER_MANAGED_MODEL_HOSTS.find((ours) => ours.host === entry.host);
      expect(mirror, `服务端那份表里没有主机 \`${entry.host}\``).toBeDefined();
      expect(mirror?.jurisdiction, `${entry.host} 的所在地判定漂了`).toBe(entry.jurisdiction);
      expect(mirror?.provider, `${entry.host} 的供应方主体漂了`).toBe(entry.provider);
    }
  });

  it('🔴 服务端那份表里**每一行都是 `cn`**（托管路径唯一接受的取值）', () => {
    const notCn = SERVER_MANAGED_MODEL_HOSTS.filter((entry) => entry.jurisdiction !== 'cn');
    expect(notCn.map((entry) => `${entry.host}=${entry.jurisdiction}`)).toEqual([]);
  });

  it('🔴 每一行都带**非空出处**（一个形容词不算出处）', () => {
    for (const entry of SERVER_MANAGED_MODEL_HOSTS) {
      expect(entry.evidence.trim().length, `${entry.host} 没有出处`).toBeGreaterThan(20);
    }
  });

  it('⚠️ 表里**没有回环/私网地址** —— 那是 `plaintextHosts` 那个测试旋钮进不了生产的原因', () => {
    const risky = SERVER_MANAGED_MODEL_HOSTS.filter((entry) =>
      /^(127\.|localhost|\[::1\]|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        entry.host,
      ),
    );
    expect(risky.map((entry) => entry.host)).toEqual([]);
  });
});

describe('功能名词表：服务端那份与 `AiFeature` 对账', () => {
  it('集合**完全相等**（顺序敏感：日志与界面按它取词条）', () => {
    expect([...SERVER_MANAGED_AI_FEATURES].sort()).toEqual(parseFeatures().sort());
  });
});
