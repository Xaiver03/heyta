/**
 * 读一个用户选中的文件为文本
 * ==============================
 *
 * 刻意做得**尽可能薄**：它不含任何判断，只是把 `File` 变成字符串。
 * 所有能测的逻辑（解析、能不能导、导到哪里）都在 `@heyta/app-host`。
 *
 * ⚠️ 用 `FileReader` 而**不是** `file.text()`：jsdom 的 `Blob` 不实现 `.text()`
 * （导出面板的测试里已经踩过同一条），而 `FileReader` 两边都有。
 * 这样这段接线在测试里跑的就是**和浏览器里同一条路径**。
 */

/** 读取一个 `File` 的文本内容。失败时 reject。 */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file);
  });
}
