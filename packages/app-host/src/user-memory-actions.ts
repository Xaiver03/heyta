/**
 * 陈述记忆的写路径（宿主无关）
 * =================================
 *
 * ## 为什么必须有这个文件
 *
 * `packages/domain/src/user-memory.ts` 会算、`USER_MEMORY` 能同步，
 * 但如果没有一条路径把**用户说过的这句话**写进去，两层都是空转 ——
 * 这正是本仓库最熟的那类失效（能力建好、单测全绿、零调用方）。
 *
 * ## 四条不变量
 *
 * 1. **一个意图一个 op**：新增/改/忘/确认各只写一条，绝不为了「标记旧条目
 *    被替代」再补一条 —— 同 `kind + topicKey` 只取最新是**读规则**。
 * 2. **忘记 = 清空正文 + 留指纹**：`textHash` 留着，抽取再看到同一句话会被挡掉；
 *    正文不进新 op（旧的仍在 op-log 历史里，这是本引擎的既有语义）。
 * 3. **敏感内容不写**：第二道闸（第一道在抽取提示词），命中直接抛错。
 * 4. **pending 只能由推断产生**，`origin='extracted'` 时强制 `status='pending'`。
 */

import {
  MEMORY_TEXT_MAX,
  deriveTopicKey,
  isSensitiveMemoryText,
  memoryTextHash,
  parseStatedMemory,
  type UserMemory,
  type UserMemoryKind,
  type UserMemoryOrigin,
} from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

const VALID_KINDS: readonly UserMemoryKind[] = ['profile', 'preference', 'fact', 'task'];
const VALID_ORIGINS: readonly UserMemoryOrigin[] = ['stated', 'extracted', 'manual'];

/** 一条陈述记忆的最大条数（active + pending）；超出由读取层忽略最旧的。 */
export const MAX_USER_MEMORIES = 200;

export interface AddUserMemoryInput {
  kind: UserMemoryKind;
  text: string;
  origin?: UserMemoryOrigin;
  importance?: number;
  /** 来源消息；给了就能从设置页点回原话。 */
  sourceTurnId?: string;
  /** 只对 `task` 有意义。 */
  expiresAt?: number;
}

export interface UserMemoryActions {
  /**
   * 新增一条。**幂等**：同 `kind + topicKey + textHash` 已存在时返回旧 id，不写 op。
   *
   * @throws 文本为空 / 超长 / 命中敏感类 / kind 非法
   */
  add(input: AddUserMemoryInput): Promise<string>;
  /** 改正文或重要度；正文变了会重算 topicKey 与指纹。 */
  update(id: string, patch: { text?: string; importance?: number; kind?: UserMemoryKind }): Promise<void>;
  /** 忘记：清空正文、留指纹；幂等。 */
  forget(id: string): Promise<void>;
  /** 确认一条推断（pending → active）；幂等。 */
  confirm(id: string): Promise<void>;
}

/**
 * 从一句用户输入里捕获「明说的记忆」。
 *
 * 解析在领域层（`parseStatedMemory` 纯函数），落库走同一个 `add` ——
 * 这样「什么算明说」只有一份定义，界面不需要自己写正则。
 *
 * @returns 新条目 id；不是明说句式（或命中敏感类）时 `null`。
 */
export async function captureStatedMemory(
  actions: UserMemoryActions,
  text: string,
): Promise<string | null> {
  const parsed = parseStatedMemory(text);
  if (parsed === null) return null;
  return actions.add({ kind: parsed.kind, text: parsed.text, origin: 'stated' });
}

export interface UserMemoryActionsOptions {
  now?: () => number;
  newId?: () => string;
}

const clampImportance = (n: number | undefined): number => {
  if (n === undefined || !Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
};

const normalizeText = (raw: string): string => {
  const text = [...raw.trim()].slice(0, MEMORY_TEXT_MAX).join('');
  return text;
};

/** 校验并抛错（不静默丢：UI 需要知道「为什么没记住」）。 */
function validateText(text: string): void {
  if (text.length === 0) throw new Error('记忆内容不能为空');
  if (isSensitiveMemoryText(text)) throw new Error('这类内容不记录');
}

export function createUserMemoryActions(
  ctx: ActionContext,
  options: UserMemoryActionsOptions = {},
): UserMemoryActions {
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => `mem-${randomId()}`);

  const all = (): UserMemory[] =>
    Object.values(ctx.getState().userMemories) as UserMemory[];

  return {
    async add(input) {
      if (!VALID_KINDS.includes(input.kind)) {
        throw new Error(`未知的记忆类型「${String(input.kind)}」`);
      }
      const origin = input.origin ?? 'stated';
      if (!VALID_ORIGINS.includes(origin)) {
        throw new Error(`未知的来源「${String(origin)}」`);
      }
      // 敏感类先挡，再落正文 —— 保证错误信息里也不回显敏感原文。
      if (isSensitiveMemoryText(input.text)) throw new Error('这类内容不记录');
      const text = normalizeText(input.text);
      validateText(text);

      const topicKey = deriveTopicKey(input.kind, text);
      const textHash = memoryTextHash(text);

      const duplicate = all().find(
        (m) =>
          m.deletedAt === undefined &&
          m.status !== 'forgotten' &&
          m.kind === input.kind &&
          m.topicKey === topicKey &&
          // 按**正文现算**指纹，不信存量字段：旧数据可能来自早期版本、
          // 或手工写错过；用存量的会让「同一条再说一遍」漏判成新增。
          memoryTextHash(m.text) === textHash,
      );
      if (duplicate !== undefined) return duplicate.id;

      const id = newId();
      await ctx.dispatch({
        entityType: 'USER_MEMORY' as EntityType,
        entityId: id,
        opType: OpType.Create,
        payload: {
          kind: input.kind,
          topicKey,
          text,
          textHash,
          // 推断一律先挂起：`pending` 永不注入，等用户确认。
          origin,
          status: origin === 'extracted' ? 'pending' : 'active',
          importance: clampImportance(input.importance),
          scope: 'global',
          ...(input.sourceTurnId === undefined ? {} : { sourceTurnId: input.sourceTurnId }),
          ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        },
      });
      return id;
    },

    async update(id, patch) {
      const current = ctx.getState().userMemories[id];
      if (current === undefined) throw new Error(`找不到这条记忆「${id}」`);
      if (current.status === 'forgotten') throw new Error('这条记忆已经被忘记');

      const payload: Record<string, unknown> = {};
      if (patch.kind !== undefined) {
        if (!VALID_KINDS.includes(patch.kind)) throw new Error(`未知的记忆类型「${patch.kind}」`);
        payload.kind = patch.kind;
      }
      if (patch.importance !== undefined) payload.importance = clampImportance(patch.importance);
      if (patch.text !== undefined) {
        if (isSensitiveMemoryText(patch.text)) throw new Error('这类内容不记录');
        const text = normalizeText(patch.text);
        validateText(text);
        payload.text = text;
        payload.textHash = memoryTextHash(text);
        payload.topicKey = deriveTopicKey((patch.kind ?? current.kind) as UserMemoryKind, text);
        // 用户改过的条目，后续抽取不得静默覆盖（与 ADR-0014 的纠正同一条纪律）。
        payload.origin = 'manual';
      }
      if (Object.keys(payload).length === 0) return;
      await ctx.dispatch({
        entityType: 'USER_MEMORY' as EntityType,
        entityId: id,
        opType: OpType.Update,
        payload,
      });
    },

    async forget(id) {
      const current = ctx.getState().userMemories[id];
      if (current === undefined) throw new Error(`找不到这条记忆「${id}」`);
      if (current.status === 'forgotten') return;
      await ctx.dispatch({
        entityType: 'USER_MEMORY' as EntityType,
        entityId: id,
        opType: OpType.Update,
        payload: {
          status: 'forgotten',
          text: '',
          textHash: current.textHash ?? memoryTextHash(current.text),
        },
      });
    },

    async confirm(id) {
      const current = ctx.getState().userMemories[id];
      if (current === undefined) throw new Error(`找不到这条记忆「${id}」`);
      if (current.status !== 'pending') return;
      await ctx.dispatch({
        entityType: 'USER_MEMORY' as EntityType,
        entityId: id,
        opType: OpType.Update,
        payload: { status: 'active' },
      });
    },
  };
}
