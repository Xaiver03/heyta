/** 原创「双页」助手符号：两道开放的页弧围合长短两条回应。
 * 用户明确要求独立设计，不使用星芒、机器人或通用对话气泡。
 * 几何仅在此定义；颜色与显示尺寸由各端语义 token 提供。
 */
export const ASSISTANT_MARK_VIEWBOX = '0 0 24 24';
export const ASSISTANT_MARK_STROKE = 2;
export const ASSISTANT_MARK_PATHS = [
  'M9 3.5H8a5 5 0 0 0-5 5v7a5 5 0 0 0 5 5h1',
  'M15 3.5h1a5 5 0 0 1 5 5v7a5 5 0 0 1-5 5h-1',
  'M8 9.5h8M8 14.5h5',
] as const;
