import React from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useI18n } from '@heyta/i18n';

import { useText, useTheme, useTokens } from '../theme';
import { Icon } from '../ui/icons';
import { Text } from '../ui/kit';

export function ChatComposer({
  value,
  onChangeText,
  onSubmit,
  disabled = false,
  busy = false,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  busy?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const text = useText();
  const { native, reducedMotion } = useTheme();
  const canSend = value.trim() !== '' && !disabled;
  return (
    <View
      style={{
        gap: tokens['space.1'],
        paddingTop: tokens['space.2'],
        paddingBottom: tokens['space.2'],
        backgroundColor: tokens['color.background'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: tokens['space.2'] }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={t('web.ai.chat.placeholder')}
          placeholderTextColor={tokens['color.foreground-subtle']}
          accessibilityLabel={t('web.ai.chat.inputAria')}
          testID="ai-assistant-input"
          editable={!disabled}
          multiline
          keyboardType="default"
          autoCapitalize="sentences"
          autoCorrect
          // Return inserts a newline. Sending is deliberately explicit so a
          // Chinese IME's composing text can never be submitted prematurely.
          submitBehavior="newline"
          style={[
            text['row-title'],
            {
              flex: 1,
              maxHeight: tokens['size.field-height'] * 3,
              minHeight: tokens['size.field-height'],
              paddingHorizontal: tokens['space.3'],
              paddingVertical: tokens['space.2'],
              borderRadius: tokens['radius.lg'],
              backgroundColor: tokens['color.surface'],
              color: tokens['color.foreground'],
              fontFamily: native.fontSans,
              textAlignVertical: 'top',
              opacity: disabled ? tokens['state.disabled-opacity'] : 1,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('web.ai.chat.send')}
          accessibilityState={{ disabled: !canSend, busy }}
          testID="ai-assistant-send-button"
          disabled={!canSend}
          onPress={onSubmit}
          style={({ pressed }) => ({
            width: tokens['touch-target.min'],
            height: tokens['touch-target.min'],
            borderRadius: tokens['radius.full'],
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canSend ? tokens['color.primary'] : tokens['color.surface-sunken'],
            opacity: pressed && !reducedMotion && canSend ? tokens['state.pressed-opacity'] : 1,
          })}
        >
          {busy ? <ActivityIndicator size="small" color={tokens['color.foreground-subtle']} /> : <Icon name="action.send" size="sm" color={canSend ? tokens['color.on-primary'] : tokens['color.foreground-subtle']} />}
        </Pressable>
      </View>
      {busy ? <Text variant="caption" tone="subtle">{t('web.ai.loading.waiting')}</Text> : null}
    </View>
  );
}
