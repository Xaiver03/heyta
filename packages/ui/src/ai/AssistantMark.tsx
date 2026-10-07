import React from 'react';
import { View } from 'react-native';
import { Path, Svg } from 'react-native-svg';
import { ASSISTANT_MARK_PATHS, ASSISTANT_MARK_VIEWBOX, ASSISTANT_MARK_STROKE, ICON_SIZE } from '@heyta/design-system';

/** 与桌面/Web 同源的原创助手图形，无主题 Provider 依赖。 */
export function AssistantMark({ size = ICON_SIZE.sm, color }: { size?: number; color: string }): React.JSX.Element {
  return <View accessible={false} aria-hidden style={{ width: size, height: size, flexShrink: 0 }}>
    <Svg width={size} height={size} viewBox={ASSISTANT_MARK_VIEWBOX} fill="none"
      stroke={color} strokeWidth={ASSISTANT_MARK_STROKE} strokeLinecap="round" strokeLinejoin="round">
      {ASSISTANT_MARK_PATHS.map((d) => <Path key={d} d={d} />)}
    </Svg>
  </View>;
}
