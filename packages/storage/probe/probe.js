/**
 * 浏览器侧 OPFS 探针的**页面外壳**。
 *
 * 真正的活儿在 `worker.js` 里 —— 因为 OPFS 的 `createSyncAccessHandle`
 * 只在 Worker 中可用（完整证据见 `worker.js` 文件头）。
 *
 * 这个文件只做三件事：起一个 module Worker、把它报回来的结果挂到
 * `window.__heytaSqliteProbe`、以及把结果画到页面上（好让截图能说明问题）。
 *
 * ⚠️ 用 `.js` 而不是 `.ts`：探针不需要进任何 tsconfig 的编译范围，
 * 而它要验的也不是"类型对不对"。驱动脚本见 `scripts/verify-web-sqlite.mjs`。
 */

const out = document.getElementById('out');

function render(result) {
  const lines = (result.steps ?? []).map(
    (s) => `${s.name}${s.detail === undefined ? '' : ` → ${JSON.stringify(s.detail)}`}`,
  );
  lines.push(result.status === 'ok' ? '✅ 探针完成' : `🔴 ${result.error}`);
  out.textContent = lines.join('\n');
}

window.__heytaSqliteProbe = undefined;

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

worker.onmessage = (event) => {
  window.__heytaSqliteProbe = event.data;
  render(event.data);
};

worker.onerror = (event) => {
  const result = { status: 'error', steps: [], error: `Worker 错误：${event.message}` };
  window.__heytaSqliteProbe = result;
  render(result);
};
