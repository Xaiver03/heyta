/**
 * 分享链接的 URL 约定（W6 链接落点）—— 纯函数，无 React、无副作用。
 * =============================================================================
 *
 * 生产端是 `@heyta/ui#share-link` 的 `buildShareJoinLink`：
 * `{应用地址}?shareToken=<encodeURIComponent(token)>`。本文件是**消费端**：
 * 应用起来后从地址栏取出 token、把参数摘干净。
 *
 * 拆成纯函数而不是留在 `ProjectsPanel` 的 mount effect 里，因为 effect 里的
 * 字符串拼装测不了，而且第二个消费点出现时（桌面壳、PWA 冷启动入口）会
 * 漂成两套规则。🔴 提取的收尾是"旧的内联解析删掉 + 判据钉住"——
 * `tests/join-link.spec.ts` 末尾那条源码级断言盯的就是"抽了 ≠ 用了"
 * （AGENTS §3.5「ids.ts 教训」）。
 */

/**
 * 从查询串里取 `shareToken`。
 *
 * 缺失或**空串**都算"没有"（undefined）：`?shareToken=` 是一张空门票，
 * 打开入群对话框也只是让用户盯着一个空输入框。
 */
export function extractShareToken(search: string): string | undefined {
  const token = new URLSearchParams(search).get('shareToken');
  return token === null || token === '' ? undefined : token;
}

/**
 * 摘掉 `shareToken` 之后的查询串（**不带**前导 `?`；空串 = 没有剩余参数）。
 *
 * 消费完把地址栏还原成这个值（`history.replaceState`），刷新不会重弹入群框、
 * token 也不长期躺在地址栏里（它会进浏览器历史、被扩展/截图顺手带走）。
 */
export function searchWithoutShareToken(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('shareToken');
  return params.toString();
}
