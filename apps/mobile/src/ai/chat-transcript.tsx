import React from 'react';
import { View } from 'react-native';

import { AiGeneratedLabel } from '@heyta/ui';

import { Card, Stack, Text } from '../ui/kit';
import { useTokens } from '../theme';

export interface ChatTranscriptItem {
  readonly id: string | number;
  readonly role: 'user' | 'assistant' | 'error' | 'proposal';
  readonly text: string;
  readonly detail?: string;
  readonly proposal?: React.ReactNode;
  readonly action?: React.ReactNode;
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
        <Text tone={isUser ? 'on-primary' : isError ? 'danger' : 'default'} selectable>
          {item.text}
        </Text>
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
