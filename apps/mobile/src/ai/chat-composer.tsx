import React from 'react';
import { ActivityIndicator, Image, Pressable, TextInput, View } from 'react-native';
import { useI18n } from '@heyta/i18n';

import type { AiImagePart } from '@heyta/ai';
import { useTheme, useTokens } from '../theme';
import { Icon } from '../ui/icons';
import { Chip } from '../ui/kit';

/**
 * 聊天输入框（composer）。
 *
 * 布局严格对照开源三端 AI 客户端 Chatbox（`chatboxai/chatbox`）的 InputBox：
 *  - 外层：圆角卡片 + **1px 边框** + 白底 + 小阴影 + 内边距；
 *  - 输入：**14px 常规字重**、透明底、自动增高（至多 3 行）；
 *  - 发送：**实心主色圆钮 + 上箭头**（生成中显示加载），禁用态为低饱和底；
 *  - 不发任何说明/提示文字（只在结构里表达状态）。
 */
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
  attachments?: readonly { readonly id: string; readonly title: string }[];
  onOpenAttach?: () => void;
  onRemoveAttachment?: (id: string) => void;
  images?: readonly AiImagePart[];
  onPickImage?: () => void;
  onRemoveImage?: (index: number) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const { native, reducedMotion } = useTheme();
  const canSend = value.trim() !== '' && !disabled;
  const sendActive = canSend && !busy;

  const iconButton = (name: Parameters<typeof Icon>[0]['name'], label: string, testID: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={{ width: tokens['touch-target.min'], height: tokens['touch-target.min'], alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={name} size="sm" color={tokens['color.foreground-muted']} />
    </Pressable>
  );

  return (
    <View
      style={{
        gap: tokens['space.2'],
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

      {/* 输入卡片：圆角 + 1px 边框 + 白底 + 小阴影（对齐 Chatbox InputBox 容器）。 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: tokens['space.1'],
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
          borderWidth: 1,
          borderColor: tokens['color.border'],
          paddingHorizontal: tokens['space.2'],
          paddingVertical: tokens['space.1'],
          boxShadow: tokens['shadow.sm'],
        }}
      >
        {onOpenAttach === undefined ? null : iconButton('action.attach', t('mobile.ai.attach.open'), 'ai-attach-button', onOpenAttach)}
        {onPickImage === undefined ? null : iconButton('action.image', t('web.ai.attach.label'), 'ai-image-button', onPickImage)}
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
          submitBehavior="newline"
          style={{
            flex: 1,
            maxHeight: tokens['size.field-height'] * 3,
            minHeight: tokens['size.field-height'],
            paddingHorizontal: tokens['space.1'],
            paddingVertical: tokens['space.1'],
            backgroundColor: 'transparent',
            color: tokens['color.foreground'],
            fontFamily: native.fontSans,
            fontSize: tokens['font-size.sm'],
            fontWeight: '400',
            lineHeight: tokens['line-height.normal'],
            textAlignVertical: 'top',
            opacity: disabled ? tokens['state.disabled-opacity'] : 1,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('web.ai.chat.send')}
          accessibilityState={{ disabled: !sendActive, busy }}
          testID="ai-assistant-send-button"
          disabled={!sendActive}
          onPress={onSubmit}
          style={({ pressed }) => ({
            width: tokens['touch-target.min'],
            height: tokens['touch-target.min'],
            borderRadius: tokens['radius.full'],
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: sendActive ? tokens['color.primary'] : tokens['color.surface-sunken'],
            opacity: pressed && !reducedMotion && sendActive ? tokens['state.pressed-opacity'] : 1,
          })}
        >
          {busy ? (
            <ActivityIndicator size="small" color={tokens['color.on-primary']} />
          ) : (
            <Icon name="action.send" size="sm" color={sendActive ? tokens['color.on-primary'] : tokens['color.foreground-subtle']} />
          )}
        </Pressable>
      </View>
    </View>
  );
}
