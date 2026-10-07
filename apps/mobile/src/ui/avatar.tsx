/**
 * 头像圈（R15b）—— 移动端第一次渲染位图，所以这里把三条裁决写在自己文件头。
 *
 * ## 为什么住 `ui/` 而不是直接写在 `ProfileScreen` 里
 *
 * `check:l4` 的 mobile 段基线**恰好在 90、零余量**（只减不增的棘轮），
 * 而一个圆圈 + 一张铺满的图在 RN 里**不可能**不写内联样式。
 * 比"不碰棘轮"更重要的是归属：这是 chrome，不是产品流程。
 * 屏幕给数据，组件给形状 —— 和 `kit.tsx` 里其余组件同一条界线。
 *
 * ## 尺寸与底色跟 web 是**同一个 token**
 *
 * `size.avatar-lg`（40）与 `color.surface-sunken`：web 的 `.ht-settings__avatar`
 * 消费的就是这两个（`apps/web/src/styles/app/ai-panels.css`）。
 * 一边 40 一边 56 不叫"平台差异"，叫两处各裁一遍。
 *
 * ## 🔴 没有头像时显示的是邮箱首字母，**图片加载失败时也回落到首字母**
 *
 * 后者是本文件唯一一条"看起来像兜底、其实是产品结论"的分支：
 * RN 的 `<Image>` 解不开一个 data URI 时**什么都不画**（不像 web 会显示破图），
 * 于是没有这一句的话，症状是"我明明传了头像，圈里是空的"，而界面上没有任何一句话。
 * 回落首字母与 `fetchAccountAvatar` 把"解不开"当成正常状态是同一条立场：
 * **头像显示不出来不是错误，退回邮箱标识才是它本该有的行为。**
 *
 * ⚠️ 这条回落只在**图片本身**加载失败时生效。"这台设备解不开密文"（口令不对）
 * 是另一件事，由屏幕那一侧单独说一句话，不能在这里顺手吞掉。
 */

import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { avatarInitialFromEmail } from '@heyta/shared-schema';

import { useTokens } from '../theme';
import { Text } from './kit';

export interface AvatarBadgeProps {
  /** 完整 data URI（`data:image/jpeg;base64,…`）。`undefined` = 没有图，显示首字母。 */
  dataUri: string | undefined;
  /** 账号邮箱。首字母由共享层的 `avatarInitialFromEmail` 决定，本文件不自己算。 */
  email: string | undefined;
  testID?: string;
}

export function AvatarBadge({
  dataUri,
  email,
  testID = 'profile-avatar',
}: AvatarBadgeProps): React.JSX.Element {
  const t = useTokens();
  const [loadFailed, setLoadFailed] = useState(false);

  const edge = t['size.avatar-lg'];
  const initial = avatarInitialFromEmail(email);
  const showImage = dataUri !== undefined && !loadFailed;

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      // 🔴 无障碍名**只有**在真的没有图时才是「邮箱首字母」那句话。
      // 有图时给空串：读屏用户要的是"这里有一张头像"，不是一个字母。
      accessibilityLabel={showImage ? '' : (initial ?? '')}
      style={{
        width: edge,
        height: edge,
        borderRadius: t['radius.full'],
        backgroundColor: t['color.surface-sunken'],
        alignItems: 'center',
        justifyContent: 'center',
        // 图是按短边居中裁过的正方形，溢出裁掉而不是留白边（与 web 的 cover 同效）。
        overflow: 'hidden',
      }}
    >
      {showImage ? (
        <Image
          testID={`${testID}-img`}
          source={{ uri: dataUri }}
          // RN 的 Image 没有 CSS 的 `width:100%`：不写尺寸就按 intrinsic 画，
          // 一张 512×512 的原图会把 40 的圈撑破。
          style={{ width: edge, height: edge }}
          onError={() => setLoadFailed(true)}
        />
      ) : (
        initial === undefined ? null : (
          <Text variant="row-title" tone="muted">
            {initial}
          </Text>
        )
      )}
    </View>
  );
}
