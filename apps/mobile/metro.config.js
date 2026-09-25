const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro 配置（pnpm monorepo 版）
 * ==============================
 *
 * 🔴 这里有一条**实测踩出来的**教训，写下来免得下次再踩：
 *
 * 网上（包括 RN 官方 monorepo 文档）推荐的配置里有
 * `resolver.disableHierarchicalLookup: true`。**在这个 pnpm 布局下它是错的。**
 *
 * 原因：pnpm 把 `react-native` 的依赖放在**它自己的同级目录**里，而不是提升到根：
 *
 *     node_modules/.pnpm/react-native@0.84.1_<hash>/node_modules/
 *         react-native/            ← 包本体
 *         @react-native/virtualized-lists/   ← 它的依赖，是**同级**不是子级
 *
 * 于是 `react-native/Libraries/Modal/Modal.js` 里那句
 * `require('@react-native/virtualized-lists')` 只能靠**向上逐级查找**命中。
 * 关掉层级查找后，Release 打包直接失败：
 *
 *     UnableToResolveError: Unable to resolve module @react-native/virtualized-lists
 *       from .../react-native/Libraries/Modal/Modal.js
 *
 * ⚠️ 症状的迷惑之处：**Debug 构建照常成功**（Debug 不从 Metro 打包，只连开发服务器），
 * 只有 Release 打包或真机跑才会炸。所以"能构建"不等于"能打包"。
 *
 * 那 `disableHierarchicalLookup` 想防的"两个 React 实例"怎么办？
 * 用 `nodeModulesPaths` 的**顺序**解决：本包优先，然后才是根。
 * 这已经足够 —— 不需要把层级查找整个关掉。
 */

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = {
  // 必须包含仓库根，否则看不到 `packages/*` 里的 workspace 依赖，
  // 报错会指向一个明明装好了的 `@heyta/*`。
  watchFolders: [workspaceRoot],
  resolver: {
    // 顺序有意义：本包在前。**不要**关 disableHierarchicalLookup，
    // 理由见文件头 —— react-native 的嵌套依赖靠它才能解析。
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    // 原生模块的产物里可能引用 .cjs/.mjs，Metro 默认不认。
    sourceExts: ['js', 'jsx', 'ts', 'tsx', 'json', 'cjs', 'mjs'],
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
