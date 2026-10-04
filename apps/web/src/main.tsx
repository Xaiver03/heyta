/**
 * 应用入口。
 *
 * **引入顺序有讲究**：tokens 必须在 reset 之前 ——
 * reset 里的每条规则都消费 var(--ht-*)，token 未定义时那一条会整体失效
 * （而失败方式是静默的：属性被丢弃，不报错）。
 */
import '@heyta/design-system/tokens.css';
import '@heyta/design-system/reset.css';
/* 语义文字档位（.ht-type-*）——从 TEXT_STYLES 生成，与共享层同一套档位。
   消费方式：JSX 里 `className="ht-xxx ht-type-<档位>"` 成对出现。 */
import '@heyta/design-system/typography.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { StorageError } from '@heyta/storage';

import { registerLocalEraser } from '@heyta/app-host';

import { App } from './App.js';
import { holdPendingLogin, releasePendingLogin } from './features/auth/pending-login.js';
import { createStartupNetwork } from './features/privacy/startup-network.js';
import {
  installConsentGatedFetch,
  privacyConsent,
  subscribePrivacyConsent,
} from './features/privacy/consent-gate.js';
import { useSyncStore } from './features/sync/store.js';
// 🔴 G-27：启动那一步要问的"这个账号要不要补签"。装配在 gate.ts，判定在 app-host。
import { askLegalRecheck } from './features/legal-recheck/gate.js';
import { ErrorScreen } from './features/shell/ErrorScreen.js';
import { storageHintKey } from './features/shell/error-hint.js';
import { startPublicFacts } from './features/calendar/public-facts.js';
import { initOpLog } from './features/tasks/store.js';
import { LocaleHost } from './lib/locale-host.js';
import { eraseWebLocalData } from './lib/local-data-destruction.js';
import { startWidgetLifecycle } from './pwa/lifecycle.js';
import { registerWidgetServiceWorker } from './pwa/register.js';

/**
 * 本机数据销毁器（E2）。
 *
 * 🔴 必须是**入口的第一批语句**，而且要早于任何一次同步：`createSyncClient()`
 * 在共享接缝装的默认回调读的就是这个注册表，注册晚于第一次同步的话，
 * 那一次 `ACCOUNT_CLOSED` 会走到"没有销毁器"的分支。
 *
 * 为什么注册在这里而不是 `features/sync/store.ts`（同步客户端的构造点）：
 * 销毁是**设备级**的，不属于任何一个界面状态机；而入口是这个文件里
 * 唯一"必定先于所有宿主动作"的位置。判据：
 * `apps/web/tests/local-data-destruction.spec.ts`。
 */
registerLocalEraser(eraseWebLocalData);

/**
 * 🔴 **同意之前，一个字节都不许出这个进程**（计划 G-12）。
 *
 * 这一行必须是**函数体的第一条语句**，而且要早于下面任何一次网络动作。
 * 它把 `window.fetch` 换成带闸的那一份，于是"新加一个调用点忘了传 `fetchImpl`"
 * 不再等于"合规前提悄悄失效"。
 *
 * ⚠️ 它**拦不住** `import()` / `<script src>` / `WebSocket` / `serviceWorker.register()`
 * —— 那四类各有各的闸（分别见下面的注释与 `restartRealtime`）。
 * 之所以仍然要做这一层：`fetch` 是全仓**唯一**会承载用户数据的 HTTP 出口，
 * 而其余三类都是本站自己的东西。
 */
installConsentGatedFetch();

/**
 * W3-1：注册 service worker（Windows 的 PWA 组件靠它接事件）。
 *
 * 🔴 **收到同意之后才注册**（G-12 点名的正是这一条）：注册本身会向
 * `scope` 发一次请求，而那时用户还没有对"这台应用会不会跟服务端说话"作出过决定。
 *
 * 这三步（注册 SW / 采用待消费的登录 / 建实时连接）现在在
 * `features/privacy/startup-network.ts` 里 —— 抽出去的**唯一理由是判据**：
 * 入口有顶层副作用、要 `#root`、会拉起 op-log，写死在这里就等于
 * "把注册搬回同意之前，全仓没有任何东西会失败"。顺序与三步各自的闸见那个文件头。
 */
const startupNetwork = createStartupNetwork({
  networkAllowed: () => privacyConsent.networkAllowed(),
  registerServiceWorker: registerWidgetServiceWorker,
  // 🔴 排在 `startRealtime` 之前：这一次询问把闸门置成 `checking`，
  // 于是"还没问到答案"的窗口里不会先建起实时通道（顺序判据在 startup-network 的测试里）。
  askLegalRecheck,
  // 未配置/未登录时它自己就是不连（不抛），所以这里无条件调。
  startRealtime: () => useSyncStore.getState().startRealtime(),
  // 🔴 采用一枚登录会**发请求**，所以它只可能在闸门打开之后被调到（判据数得出次数）。
  adoptPendingLogin: (held) => {
    void releasePendingLogin(held);
  },
});

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
       * 公共事实（调休 / 补班）的下行（W4b，ADR-0052）。
       *
       * 🔴 排在这里的两个理由缺一不可：
       *  · 它要 `requireStore()` —— 引擎没就绪时那是**一条会抛的读**，而它没有重试；
       *  · 装缓存是**异步**的，所以首屏很可能先没有标记、装完再补上 —— 这不是缺陷，
       *    但补上那一步必须有人敲（`publicFactsEpoch`），否则界面会一直停在首屏那张图。
       *
       * ⚠️ 它自己判闸门（G-12）：没同意时一个请求都不发，缓存照装。
       *    所以这里无条件调，而不是把它挂到"已登录"那条分支上 ——
       *    这条通道是匿名的，未登录的用户同样该看到部署方录的调休。
       */
      startPublicFacts();

      /**
       * W1：消费**邮件登录链接**带回来的令牌。
       *
       * 🔴 它修的是一个静默失效：服务端确认页把会话交进来之后跳回应用，而**此前没有
       * 任何应用代码读它** —— 用户在邮件里"登录成功了"，回到应用仍是未登录，
       * 且界面不报任何错。
       *
       * 🔴 **现在确认页的投递走 URL `fragment`，不走 `sessionStorage`** ——
       * 后者跨不过 agent cluster（实测：确认页 `pagehide` 时还在、应用启动时已空）。
       * 原因与 2×2 证据见 `docs/adr/0039-…md` §4 第 5 轮。这里不用改：
       * 取用顺序仍是 **fragment → 壳交付的会话 → 链接令牌**。
       *
       * 🔴 **闸门关闭时只做"收下"，不做"采用"**（`holdPendingLogin` 的文件头写着
       * 为什么这两步必须能分开）：收下的那一步会把令牌从地址栏与存储里**立刻抹掉**，
       * 那是安全动作、与同意无关；采用那一步会**发请求**，必须等到同意之后。
       * 少了这个区分就只有两种坏法 —— 要么让一枚活令牌赖在历史里，
       * 要么用户点了同意之后登录状态悄悄丢了。
       *
       * ⚠️ 顺序：必须在 `initOpLog()` **之后** —— 登录成功会立刻触发同步，
       * 而同步要在 op-log 就绪后才能安全落盘（与 `startWidgetLifecycle` 同一个理由）。
       */
      const held = holdPendingLogin();
      startupNetwork.hold(held);
      if (held !== null && !privacyConsent.networkAllowed()) {
        // ⚠️ 不能静默：这条路径下用户"在邮件里已经登录成功了"，而应用里还是未登录。
        // 首屏会立刻弹隐私面板，所以他能自己走完；留痕是为了将来排查。
        console.warn('[privacy] 收到待消费的登录，但还没有同意 → 已收下并抹掉投递，同意之后才采用');
      }
      /**
       * 🔴 **无论有没有待消费的登录，都要走这一次**：它自己会判闸门，
       * 关闭时什么都不做。这样"已经同意过（冷启动）"与"刚刚点了同意"
       * 走的是同一条补跑路径，而不是两套行为。
       */
      startupNetwork.arm();

      /**
       * 用户在同一次会话里点了「同意」（首启面板）之后，上面那几步要**补跑一遍**。
       *
       * 🔴 订阅而不是让面板直接调：同意这个决定有三个来源（首启面板、设置页撤回、
       * 将来的深链），而"实时通道连着没有"只有一个所有者。让每个来源都记得踢一次
       * 同步，就是"新加一个入口忘了踢"的开始。
       * ⚠️ 这个订阅**不必**取消 —— 它就是本进程的生命周期。
       */
      subscribePrivacyConsent(() => {
        startupNetwork.arm();
      });

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
