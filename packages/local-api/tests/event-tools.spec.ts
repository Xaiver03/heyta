/**
 * 倒数日工具进了目录之后的**目录级**不变量（W10）
 * =================================================
 *
 * 这个文件只测"进目录"这件事本身带来的四条立场，投影与协议形状在
 * `tool-egress-fields.spec.ts` 与 `server.spec.ts` 里测：
 *
 *   1. 🔴 **逐工具默认关**（ADR-0011）—— 新工具没被用户打开之前，
 *      MCP 侧调不动、内置 AI 也选不到；
 *   2. 🔴 **未授权即不可见**（`tools/list` 与 `listAuthorizedTools` 同一条立场）；
 *   3. **授权判定只有一份**（`isToolGranted` 是 `grants?.[name] === true`，
 *      未列出 = 关）—— 这条如果被复制成两份，"同一个工具在两个入口两套规则"就成立；
 *   4. **实体归属能被能力清单推出来** —— `list_events` / `get_event` /
 *      `create_event` / `update_event` 必须都归到 `EVENT`，
 *      否则 `gen-ai-capability-manifest.mjs` 会当场失败（那条判据在生成器里，
 *      这里只钉"目录里的名字与读写档位别再改出歧义"）。
 */

import { describe, expect, it } from 'vitest';

import {
  LOCAL_API_TOOLS,
  authorizeToolCall,
  errorCodeForDenial,
  findTool,
  isToolGranted,
  listAuthorizedTools,
  toolNames,
  type LocalApiConfig,
} from '../src/index.js';

const EVENT_TOOL_NAMES = ['list_events', 'get_event', 'create_event', 'update_event'] as const;

function config(grants?: Record<string, boolean>): LocalApiConfig {
  return {
    enabled: true,
    bindAddress: '127.0.0.1',
    port: 47_119,
    token: 'tok',
    ...(grants === undefined ? {} : { grants }),
  };
}

describe('倒数日工具进了目录（W10）', () => {
  it('四条都在，且**读写档位**是 read/read/write/write', () => {
    expect(toolNames()).toEqual(
      expect.arrayContaining([...EVENT_TOOL_NAMES.map((n) => String(n))]),
    );
    const kindOf = (name: string): string | undefined => findTool(name)?.kind;
    expect(kindOf('list_events')).toBe('read');
    expect(kindOf('get_event')).toBe('read');
    expect(kindOf('create_event')).toBe('write');
    expect(kindOf('update_event')).toBe('write');
  });

  it('🔴 目录驱动：每一条工具都 defaultEnabled:false（不逐条抄名字）', () => {
    // 手抄"这 4 条默认关"的版本加第 11 条工具时会静默漏掉它。
    const openByDefault = LOCAL_API_TOOLS.filter((t) => t.defaultEnabled !== false);
    expect(openByDefault.map((t) => t.name)).toEqual([]);
    expect(LOCAL_API_TOOLS.length).toBeGreaterThanOrEqual(10);
  });

  it('🔴 未授权时：MCP 列表里**完全不可见**，调用时报"没有这个方法"', () => {
    // grants 里根本没有倒数日 —— 与"grants 写了 false"两种形态都要挡
    for (const grants of [undefined, {}, { list_events: false } as Record<string, boolean>]) {
      const cfg = config(grants === undefined ? undefined : { ...grants });
      const visible = listAuthorizedTools(cfg.grants).map((t) => t.name);
      for (const name of EVENT_TOOL_NAMES) {
        expect(visible, `grants=${JSON.stringify(grants)} 时 ${name} 不该可见`).not.toContain(name);
      }
      const verdict = authorizeToolCall(cfg, 'list_events', 'tok');
      expect(verdict.allowed).toBe(false);
      if (verdict.allowed) continue;
      // 🔴 "不存在"与"未授权"在**协议层**必须是同一个错误，否则能靠错误码枚举目录。
      // ⚠️ 判据挂在 `errorCodeForDenial` 上而不是 `reason` 上：`reason` 是**内部**
      // 两个不同取值（`tool-unknown` / `tool-not-granted`，实现上必须先查存在再查授权），
      // 外泄的只有翻译后的 JSON-RPC 错误。拿 `reason` 比会红得毫无道理。
      const unknown = authorizeToolCall(cfg, 'list_events_but_typo', 'tok');
      expect(unknown.allowed).toBe(false);
      if (unknown.allowed) continue;
      expect(verdict.reason).not.toBe(unknown.reason);
      expect(errorCodeForDenial(verdict.reason)).toEqual(errorCodeForDenial(unknown.reason));
    }
  });

  it('授权之后可见、可调，但**读**工具仍然只走读路径', () => {
    const cfg = config({ list_events: true });
    expect(listAuthorizedTools(cfg.grants).map((t) => t.name)).toEqual(['list_events']);
    const verdict = authorizeToolCall(cfg, 'list_events', 'tok');
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) return;
    expect(verdict.tool.kind).toBe('read');
  });

  it('🔴 `isToolGranted` 是**唯一**的判定：倒数日与任务共用同一个函数', () => {
    // 这条看起来是废话，但它是 W10 最容易被"顺手优化"的地方：
    // 有人会给倒数日另写一个"更宽松"的判定（因为它只在进程内被 AI 用）。
    expect(isToolGranted({ list_events: true }, 'list_events')).toBe(true);
    expect(isToolGranted({ list_events: undefined }, 'list_events')).toBe(false);
    expect(isToolGranted({}, 'get_event')).toBe(false);
    expect(isToolGranted(undefined, 'create_event')).toBe(false);
    // 未列出的工具 = 关，**任务侧同一条**（证明没有分叉）
    expect(isToolGranted({ list_events: true }, 'list_tasks')).toBe(false);
  });

  it('每条倒数日工具都带**非空**说明与（写工具以外）非空出境声明', () => {
    for (const name of EVENT_TOOL_NAMES) {
      const tool = findTool(name);
      expect(tool, name).toBeDefined();
      expect(tool?.description.length, `${name} 的说明不能为空`).toBeGreaterThan(20);
      if (tool?.kind === 'read') {
        expect(tool.egressFields.length, `${name} 必须声明出境字段`).toBeGreaterThan(0);
      } else {
        expect(tool?.egressFields, `${name} 是写工具，不该声明出境字段`).toEqual([]);
      }
    }
  });

  it('读工具的出境声明里，`event.notes` **只**出现在 get_event', () => {
    // 🔴 这就是"可列举不可读"在目录层的表达。给 list_events 加上 notes ⇒ 这条红。
    expect(findTool('get_event')?.egressFields).toContain('event.notes');
    expect(findTool('list_events')?.egressFields).not.toContain('event.notes');
    // 而两者都必须声明 readable，否则调用方无从知道"有一条读不出来"
    for (const name of ['list_events', 'get_event']) {
      expect(findTool(name)?.egressFields, name).toContain('event.readable');
    }
  });
});
