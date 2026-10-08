/**
 * 助手对话的一条记录 —— **界面与落盘共用的那一个类型**
 * ======================================================
 *
 * 单独成文件的理由只有一条：会话历史现在要写进本机存储（ADR-0045 的 D-4 (i)），
 * 而"存的"与"画的"必须是同一个形状。在落盘层再抄一份镜像类型，
 * 就是本仓库反复付过学费的那件事 —— 两份事实源一定会漂，
 * 而漂了的症状是"重启后恢复出来的对话少一样东西，而界面照常显示它"。
 *
 * ⚠️ 这里的每一条都必须**可 JSON 序列化**（纯数据、无函数、无 Date、无 Map）。
 * 不可序列化的字段进不来：`JSON.stringify` 对函数与 `undefined` 是**省略**
 * 而不是报错，所以漏字段这件事在落盘那一层是静默的。
 */

import type { AiToolProposal } from './ai-tool-run.js';
import type { AssistantFailureReason, AssistantStep } from './ai-assistant.js';
import type { AiFailureReason } from '@heyta/ai';
import type { LocalApiWriteResult } from '@heyta/local-api';

/** 界面上的一条消息。发送给模型的 `history` 由 `user`/`assistant` 两类拼出来。 */
export type ChatItem =
  | { readonly id: number; readonly role: 'user'; readonly text: string }
  | {
      readonly id: number;
      readonly role: 'assistant';
      readonly text: string;
      readonly steps: readonly AssistantStep[];
      /** 触顶时的那一句（`stopped` 也是回答，只是带"我停在哪儿"）。 */
      readonly stoppedAt: string | undefined;
    }
  | {
      readonly id: number;
      readonly role: 'proposal';
      readonly text: string;
      readonly proposal: AiToolProposal;
      readonly confirmed: LocalApiWriteResult | undefined;
      /**
       * 恢复出来的**未确认**提案：卡片还在，但确认按钮没有了。
       *
       * 🔴 一条未确认的改动不许跨过一次页面重载还继续可点 ——
       * 重载期间同一个任务可能已经被改过，按下"确认"就是一次
       * 用户此刻看不见依据的写入。要改就重新说一次（那是另一次确认）。
       */
      readonly expired?: true;
    }
  | {
      readonly id: number;
      readonly role: 'error';
      readonly reason: AssistantFailureReason;
      readonly message: string;
      readonly cause: AiFailureReason | undefined;
      readonly endpointUrl: string | undefined;
      readonly outsideFields: readonly string[] | undefined;
    };

/**
 * 追加一条消息时的输入形状（`id` 由组件里的递增计数给）。
 *
 * ⚠️ 用**条件类型**而不是 `Omit<ChatItem, 'id'>`：后者会把判别联合塌成
 * 一个"所有分支的公共属性"对象，于是 `reason` / `text` 这些分支独有的字段
 * 全部报"未知属性" —— 这是 TS 的经典坑，症状看着像类型定义写错了。
 */
export type WithoutId<T> = T extends { readonly id: number } ? Omit<T, 'id'> : never;
