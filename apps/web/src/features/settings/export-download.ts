/**
 * 浏览器下载：把一段文本存成文件
 * ==================================
 *
 * ⚠️ **这一段无法在 jsdom 里被自动化验证。**
 *
 * `URL.createObjectURL` / `HTMLAnchorElement.click()` 触发的真实下载是浏览器行为，
 * 测试环境里没有"下载"这件事。所以这里刻意做得**尽可能薄**：它不含任何判断，
 * 只是把已经准备好的文本交给浏览器。所有能测的逻辑（导出文档、Markdown 排版、
 * 文件名）都在 `@heyta/app-host` 与 `export-copy.ts` 里，不在这一层。
 *
 * 唯一值得记住的实现细节：**用完要 `revokeObjectURL`**，否则每导出一次就
 * 泄漏一个 blob（在"导出大库"这种场景下会实打实地吃内存）。
 */

/** 触发一次文本文件下载。`mime` 决定浏览器怎么打开它。 */
export function downloadTextFile(fileName: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  // 部分浏览器要求节点在文档里才响应 click()，所以挂上再摘掉。
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
