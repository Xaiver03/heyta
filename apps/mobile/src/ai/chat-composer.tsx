import React from 'react';
import { ActivityIndicator, Image, Pressable, TextInput, View } from 'react-native';
import { useI18n } from '@heyta/i18n';

import type { AiImagePart } from '@heyta/ai';
import { useText, useTheme, useTokens } from '../theme';
import { Icon } from '../ui/icons';
import { Chip, Text } from '../ui/kit';

export function ChatComposer({
  value,
  onChangeText,
  onSubmit,
  disabled = false,
  busy = false,
  attachments,
  onOpenAttach,
  onRemoveAttachment,
  images,
  onPickImage,
  onRemoveImage,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** 已引用的附件（任务）。 */
  attachments?: readonly { readonly id: string; readonly title: string }[];
  /** 打开附件选择面板。省略则不显示附件按钮。 */
  onOpenAttach?: () => void;
  onRemoveAttachment?: (id: string) => void;
  /** 待发送的图片（内存里那一份）。 */
  images?: readonly AiImagePart[];
  /** 打开系统相册选图。省略则不显示附图按钮。 */
  onPickImage?: () => void;
  onRemoveImage?: (index: number) => void;
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
      {images !== undefined && images.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>
          {images.map((img, index) => (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityLabel={t('web.ai.attach.remove', { index: index + 1 })}
              testID={`ai-image-${index}`}
              onPress={() => { if (onRemoveImage !== undefined) onRemoveImage(index); }}
            >
              <Image
                source={{ uri: `data:${img.mediaType};base64,${img.base64}` }}
                style={{ width: tokens['touch-target.min'], height: tokens['touch-target.min'], borderRadius: tokens['radius.md'] }}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
      {attachments !== undefined && attachments.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.1'] }}>
          {attachments.map((a) => (
            <Chip key={a.id} tone="quiet" label={a.title} onPress={() => { if (onRemoveAttachment !== undefined) onRemoveAttachment(a.id); }} />
          ))}
        </View>
      ) : null}
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end', gap: tokens['space.2'],
        backgroundColor: tokens['color.surface'], borderRadius: tokens['radius.lg'],
        padding: tokens['space.2'],
        // RN's boxShadow renders the same theme token on iOS and Android.
        // Give the whole composer depth; the input and send control stay flat.
        boxShadow: tokens['shadow.sm'],
      }}>
        {onOpenAttach === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.ai.attach.open')}
            testID="ai-attach-button"
            onPress={onOpenAttach}
            style={{ width: tokens['touch-target.min'], height: tokens['touch-target.min'], alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="action.attach" size="sm" color={tokens['color.foreground-muted']} />
          </Pressable>
        )}
        {onPickImage === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('web.ai.attach.label')}
            testID="ai-image-button"
            onPress={onPickImage}
            style={{ width: tokens['touch-target.min'], height: tokens['touch-target.min'], alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="action.image" size="sm" color={tokens['color.foreground-muted']} />
          </Pressable>
        )}
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
