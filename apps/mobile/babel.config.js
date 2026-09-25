/**
 * Babel 配置
 * ==========
 *
 * ⚠️ RN 预设**不带** `@babel/plugin-transform-export-namespace-from`，
 * 而 zod v4 的 ESM 源第一行就是：
 *
 *     export * as core from "../core/index.js";
 *
 * 于是 Metro 打包直接失败（实测）：
 *
 *     Export namespace should be first transformed by
 *     `@babel/plugin-transform-export-namespace-from`.
 *
 * 🔴 症状的迷惑之处：**它只在打包时出现，跑 `tsc` 和单元测试都不会**。
 * 而且 iOS 的 Debug 构建也照样成功（Debug 不打包，只连开发服务器），
 * 所以"能构建"完全掩盖了"打不出包"。
 *
 * 依赖登记：@babel/plugin-transform-export-namespace-from，MIT，
 * 2026-06-17 仍在发版（已过 AGENTS.md §3.1/§3.2 两道门）。
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['@babel/plugin-transform-export-namespace-from'],
};
