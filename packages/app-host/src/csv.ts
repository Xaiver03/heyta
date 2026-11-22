/**
 * CSV 通用拼装（任务清单 / 习惯记录共用一份）
 * =============================================
 *
 * 两处导出（`export-dump.ts` 的任务清单、`habit-export.ts` 的习惯记录）都产出
 * CSV。转义与"防公式注入"的规则必须**只有一份** —— 两处各写一遍，改一处漏一处
 * 就是一次静默的数据损坏（用户把文件丢进 Excel 才会发现）。
 *
 * 这里只做机械拼装，不含任何产品语义（列有哪些、怎么排版在各自的投影里）。
 */

/**
 * CSV 单元格转义。
 *
 * 🔴 除了引号/逗号/换行的标准转义，**还要阻止表格软件把用户文本当公式执行**：
 * 以 `= + - @` 开头的单元格会被 Excel/WPS 当成公式（CSV 注入）。规则是
 * 前面补一个 `'`，让表格软件把它当纯文本。这与 `habit-export.ts` 原来的实现逐字一致。
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * 表头 + 数据行 → 一份带 BOM 的 CSV 文本。
 *
 * - **开头加 UTF-8 BOM**：Excel 打开不带 BOM 的 UTF-8 会把中文显示成乱码。
 * - **CRLF 行结尾**：Excel 与多数表格软件对此最宽容。
 * - **末尾保留一个换行**：与既有产物逐字节一致。
 */
export function renderCsvTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const lines = [header, ...rows];
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
