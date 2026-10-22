/**
 * 法定标识的**样式计划**（纯数据，不碰 React / 不碰 react-native）
 * ============================================================
 *
 * 为什么单独一个文件：`packages/ui` 的测试跑在 node 环境、且**不**转译
 * react-native（RN 源码是 Flow 语法，Vite 直接解析失败）。把"长什么样"
 * 提成纯函数，判据才测得到它，而不是只能靠人看截图。
 *
 * 形状与位置的理由（为什么是灰字不是胶囊、为什么在被标识内容下方）
 * 写在 `AiGeneratedLabel.tsx` 文件头 —— 那里是这一族的**唯一叙事点**，
 * 这里只放数据。
 */

import type { HeytaNativeTokens, RnTextStyle, TextStyleName } from '@heyta/design-system';

export interface AiGeneratedLabelStyle {
  /** 外框：只承担"贴左 + 上距"。 */
  readonly frame: {
    readonly alignSelf: 'flex-start';
    readonly marginTop: number;
  };
  /** 文字：caption 档 + 灰色。 */
  readonly label: RnTextStyle;
}

export function aiGeneratedLabelStyle(
  tokens: HeytaNativeTokens,
  text: Record<TextStyleName, RnTextStyle>,
): AiGeneratedLabelStyle {
  return {
    // 🔴 这里**只有两件事**：贴左、与上方正文拉开 4px。
    // 多一个 `backgroundColor` / `padding*` / `borderRadius` 就退回成胶囊 ——
    // `tests/ai-generated-label-style.spec.ts` 按键集合逐字断言。
    frame: {
      alignSelf: 'flex-start',
      marginTop: tokens['space.1'],
    },
    label: {
      ...text.caption,
      color: tokens['color.foreground-muted'],
    },
  };
}
