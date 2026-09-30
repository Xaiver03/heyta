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
import { consumePendingLogin } from './features/auth/pending-login.js';
import { useSyncStore } from './features/sync/store.js';
import { ErrorScreen } from './features/shell/ErrorScreen.js';
import { storageHintKey } from './features/shell/error-hint.js';
import { initOpLog } from './features/tasks/store.js';
import { LocaleHost } from './lib/locale-host.js';
import { startWidgetLifecycle } from './pwa/lifecycle.js';
import { registerWidgetServiceWorker } from './pwa/register.js';

/**
 * W3-1：注册 service worker（Windows 的 PWA 组件靠它接事件）。
 *
 * ⚠️ **放在 `initOpLog()` 之前、而且不等它**：小组件是增强而不是功能前提，
 * 它注册失败不该让应用起不来；反过来，等 op-log 初始化完再注册会白白推后
 * `widgetinstall` 的就绪时间（用户装完组件到能看到数据的那段空窗）。
 * 函数内部自己吞掉所有失败（见 `pwa/register.ts`）。
 */
registerWidgetServiceWorker();

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
if (new URLSearchParams(window.location.search).has('shell')) {
  /**
   * 🔴 M2-B 验证入口（`?shell=1`）：共享 UI 渲染**原生壳推过来的真数据**。
   *
   * 与 `?slice=1` 的分工：切片用**固定种子**回答"能不能渲染"（M2-A）；
   * 这个入口回答"壳能不能把它自己的数据交过来"（M2-B）。
   * 详见 `dev/shell-host.tsx`。
   */
  import('./dev/shell-host.js').then(({ ShellHost }) => {
    root.render(
      <StrictMode>
        <ShellHost />
      </StrictMode>,
    );
  });
} else if (new URLSearchParams(window.location.search).has('slice')) {
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
      /**
       * W3：小组件生命周期（收点击 + 推数据）。
       *
       * 🔴 **必须在 `initOpLog()` 之后**：它第一步就是 drain 组件点击、
       * 并把结果落成 op；op-log 没就绪时 dispatch 会失败，
       * 而那几条点击会被当成"执行失败"写回日志、每次启动重试一遍 —— 永远不会成功。
       * 这正是移动端 `main` 里同一个顺序的理由。
       *
       * 它自己吞掉所有失败（见 `pwa/lifecycle.ts`）：组件是增强，不是功能前提。
       */
      startWidgetLifecycle();

      /**
       * W1：消费**邮件登录链接**带回来的令牌。
       *
       * 🔴 它修的是一个静默失效：服务端确认页把 JWT 写进 `sessionStorage['loginToken']`
       * 之后跳回应用，而**此前没有任何应用代码读它** —— 用户在邮件里"登录成功了"，
       * 回到应用仍是未登录，且界面不报任何错。
       *
       * 🔴 **不 `await`、不阻塞渲染**，理由与 `registerWidgetServiceWorker()` 同源：
       * 本地优先下"未登录"是**合法状态**而不是故障。为了登录去推迟首屏，
       * 等于把"能立刻用"换成"等一个网络往返"，而那个往返失败时用户什么也没得到。
       * 函数内部自己吞掉所有失败（见 `pending-login.ts`），所以这里不需要 catch。
       *
       * ⚠️ 顺序：必须在 `initOpLog()` **之后** —— 登录成功会立刻触发同步，
       * 而同步要在 op-log 就绪后才能安全落盘（与 `startWidgetLifecycle` 同一个理由）。
       */
      void consumePendingLogin();

      /**
       * #10：**实时同步通道**。
       *
       * 🔴 必须在 `initOpLog()` 之后 —— 建连要拿 `engine.clientId`。
       * 冷启动时地址与令牌是从磁盘读回来的，所以这一步是
       * "刷新之后实时同步还在不在"的唯一保证（少了它，用户重新登录一次才能好，
       * 而那让缺陷看起来像随机失灵）。
       *
       * ⚠️ **不 `await`、不阻塞渲染**：实时通道是**增强** ——
       * 它没连上时同步仍然会在用户动作时正常发生，只是不会"自动很快"。
       * 为它推迟首屏不值得。
       */
      useSyncStore.getState().startRealtime();

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
