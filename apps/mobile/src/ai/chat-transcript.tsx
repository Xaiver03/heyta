import React from 'react';
import { View } from 'react-native';

import { AiGeneratedLabel, StreamCaret } from '@heyta/ui';

import { Card, Stack, Text } from '../ui/kit';
import { useTokens } from '../theme';

export interface ChatTranscriptItem {
  readonly id: string | number;
  readonly role: 'user' | 'assistant' | 'error' | 'proposal';
  readonly text: string;
  readonly detail?: string;
  readonly proposal?: React.ReactNode;
  readonly action?: React.ReactNode;
  /**
   * 这一条**还在生成中** ⇒ 在正文末尾画一根闪烁光标。
   *
   * 🔴 为什么需要它：加了流式之后，有一段瞬间屏幕上是"最后几个字刚画出来、
   * 下一个字还没到"。**静止的文字与"卡住了"长得一样** —— 用户没法从画面
   * 上判断"它在想"还是"它挂了"。光标就是那个判断依据。
   *
   * ⚠️ web 端（`AssistantPanel.tsx`）已有同款光标，走的是共享层的
   * `StreamCaret` —— 两端同一份实现，不是抄的。
   */
  readonly streaming?: boolean;
}

export function ChatTranscript({
  items,
  empty,
  generatedLabel,
}: {
  items: readonly ChatTranscriptItem[];
  empty: React.ReactNode;
  /** 法定显式标识的文字（`common.ai.generatedLabel`），宿主注入。 */
  generatedLabel: string;
}): React.JSX.Element {
  return (
    <Stack gap="loose">
      {items.length === 0 ? empty : items.map((item) => <ChatMessage key={item.id} item={item} generatedLabel={generatedLabel} />)}
    </Stack>
  );
}

function ChatMessage({
  item,
  generatedLabel,
}: {
  item: ChatTranscriptItem;
  generatedLabel: string;
}): React.JSX.Element {
  const tokens = useTokens();
  const isUser = item.role === 'user';
  const isError = item.role === 'error';
  const isGenerated = item.role === 'assistant' || item.role === 'proposal';
  return (
    <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start' }} testID={`chat-message-${item.role}`}>
      <Card
        gap="tight"
        style={{
          maxWidth: '92%',
          backgroundColor: isUser
            ? tokens['color.primary']
            : isError
              ? tokens['color.danger-subtle']
              : tokens['color.surface'],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Text tone={isUser ? 'on-primary' : isError ? 'danger' : 'default'} selectable>
            {item.text}
          </Text>
          {item.streaming === true ? (
            /**
             * 🔴 `font-size.sm`（14）—— 与 `.ht-ai__panel` / web 端光标同档。
             * 两边必须一致，否则同一条回答在两端的光标会一高一矮。
             */
            <StreamCaret testID={`chat-caret-${String(item.id)}`} fontSize={tokens['font-size.sm']} />
          ) : null}
        </View>
        {item.detail !== undefined ? (
          <Text variant="caption" tone="subtle" selectable>
            {item.detail}
          </Text>
        ) : null}
        {item.proposal}
        {item.action}
        {/*
          🔴 标识在**内容下方**（备案材料写的是"七类 AI 产出文本的下方"）：
          提案卡与动作按钮都属于这段推论的呈现，标识是它们的脚注。
        */}
        {isGenerated ? (
          <AiGeneratedLabel label={generatedLabel} testID={`chat-generated-${String(item.id)}`} />
        ) : null}
      </Card>
    </View>
  );
}
