import React from 'react';
import { View } from 'react-native';

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
}: {
  items: readonly ChatTranscriptItem[];
  empty: React.ReactNode;
}): React.JSX.Element {
  return (
    <Stack gap="loose">
      {items.length === 0 ? empty : items.map((item) => <ChatMessage key={item.id} item={item} />)}
    </Stack>
  );
}

function ChatMessage({ item }: { item: ChatTranscriptItem }): React.JSX.Element {
  const tokens = useTokens();
  const isUser = item.role === 'user';
  const isError = item.role === 'error';
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
      </Card>
    </View>
  );
}
