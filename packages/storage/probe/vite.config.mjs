/**
 * 探针的 Vite 配置。
 *
 * 🔴 **整个文件只为一件事存在**：把 `@sqlite.org/sqlite-wasm` 排除出 dep 预打包。
 *
 * 不写这一段时，真浏览器里会失败得**非常难懂**：
 *
 *     wasm streaming compile failed: TypeError: Failed to execute 'compile' on
 *     'WebAssembly': Incorrect response MIME type. Expected 'application/wasm'.
 *     failed to asynchronously prepare wasm: CompileError: WebAssembly.instantiate():
 *     expected magic word 00 61 73 6d, found 3c 21 64 6f @+0
 *
 * `3c 21 64 6f` 是 `<!do` —— 也就是说 wasm 的 URL 拿回来的是 **HTML**（Vite 的
 * index.html 回落），而不是二进制。报错里一个字都没提"预打包"。
 *
 * 原因是 esbuild 预打包会把 `@sqlite.org/sqlite-wasm` 复制进
 * `node_modules/.vite/deps/`，而它内部用来定位 `sqlite3.wasm` 的路径
 * **不会跟着搬**，于是解析到一个不存在的位置、被 dev server 回落成 index.html。
 *
 * ⚠️ 这与 `apps/web` 里 `react-native-svg` 必须进 `optimizeDeps.exclude`
 * 是**同一类**坑：**esbuild 预打包会破坏"运行时按相对路径找资源"的包**。
 * 两边各自中招一次，说明这不是偶发，而是这条链路的固有性质 ——
 * 所以真正的教训是：**任何按相对路径加载自身资源的依赖，都要先怀疑预打包。**
 *
 * 顺带一提，这也是 ADR-0027 §6.1 写下的那类代价的**实例**：
 * "852 KB 的 wasm 必须单独作为资源被正确打包与 MIME 分发，
 * 这是 web 构建要新增的一类失败模式" —— 当时是预判，现在是一手证据。
 */
export default {
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
};
