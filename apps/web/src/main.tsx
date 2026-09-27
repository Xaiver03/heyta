/**
 * 应用入口。
 *
 * **引入顺序有讲究**：tokens 必须在 reset 之前 ——
 * reset 里的每条规则都消费 var(--ht-*)，token 未定义时那一条会整体失效
 * （而失败方式是静默的：属性被丢弃，不报错）。
 */
import '@heyta/design-system/tokens.css';
import '@heyta/design-system/reset.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { StorageError } from '@heyta/storage';

import { App } from './App.js';
import { ErrorScreen } from './features/shell/ErrorScreen.js';
import { storageHintKey } from './features/shell/error-hint.js';
import { initOpLog } from './features/tasks/store.js';
import { LocaleHost } from './lib/locale-host.js';

const container = document.getElementById('root');
if (container === null) {
  // 显式抛错而不是静默失败：根节点丢失时白屏最难排查
  throw new Error('找不到 #root 挂载点');
}

const root = createRoot(container);

/**
 * 🔴 M1 垂直切片的验证入口（`?slice=1`）。
 *
 * 它**刻意的**不初始化 op-log、不挂 `LocaleHost`、不走 `<App />`：
 * 切片要回答的只是"同一份 RN 组件源码能不能在 Web 上渲染出来"，
 * 混进数据层与路由只会让失败原因变模糊（详见 `dev/universal-slice.tsx`）。
 *
 * ⚠️ 这**不是**一个功能开关，也不该被产品代码引用 ——
 * 它是给 `scripts/verify-universal-slice.sh` 用的确定性挂载点。
 */
if (new URLSearchParams(window.location.search).has('slice')) {
  import('./dev/universal-slice.js').then(({ UniversalSlice }) => {
    root.render(
      <StrictMode>
        <UniversalSlice />
      </StrictMode>,
    );
  });
} else {
  /**
   * 🔴 必须先完成 op-log 初始化（含**崩溃恢复**）再渲染。
   *
   * 顺序不能换：如果先渲染，用户可能在恢复完成前就发起写入，
   * 而那些待重放的 op 会与新的写入竞争同一个 seq 区间。
   * 且 recover() 必须早于任何同步，否则"已落盘未应用"的 op 永不生效。
   */
  initOpLog()
    .then(() => {
      root.render(
        <StrictMode>
          <LocaleHost>
            <App />
          </LocaleHost>
        </StrictMode>,
      );
    })
    .catch((error: unknown) => {
      // 存储不可用时**不能白屏** —— 必须明确告诉用户数据层没起来。
      // 用 ErrorScreen 而不是裸 inline 样式：错误屏同样要受设计系统管。
      //
      // 🔴 这条路径也包在 LocaleHost 里，所以它能拿到用户偏好的语言；
      // 同时它**不依赖**这个 Provider —— `ErrorScreen` 只用 `useI18n()`，
      // 而 i18n 的 context 默认值是 DEFAULT_LOCALE（它是崩溃屏，
      // 不能因为缺 Provider 而二次崩溃；见 ErrorScreen.tsx 的注释）。
      const message = error instanceof Error ? error.message : String(error);
      // 🔴 建议按**失败原因**给，而不是一句通用的"存储不可用"：
      // 「被其它标签页挡住」和「浏览器禁用了本地数据库」的用户动作完全不同。
      // 结构化原因在 `StorageError.failure.kind` 里（`packages/storage/src/errors.ts`）。
      //
      // ⚠️ `instanceof` 在"模块被加载了两份"时会静默为假，那时 `failure` 是 undefined
      // → 退回通用那句。这是刻意的：**错误屏自己不能再出错**。
      const failure = error instanceof StorageError ? error.failure : undefined;
      root.render(
        <StrictMode>
          <LocaleHost>
            <ErrorScreen
              titleKey="web.error.storage.title"
              message={message}
              hintKey={storageHintKey(failure)}
            />
          </LocaleHost>
        </StrictMode>,
      );
    });
}
