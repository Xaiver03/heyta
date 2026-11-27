/**
 * `registerWidgetServiceWorker()` 的**调用时刻**（链 5 的实测副产品）
 * ==================================================================
 *
 * ## 这一支为什么存在
 *
 * 同意闸门把这次注册从"入口顶层"搬到了"`arm()` 里"，而 `arm()` 跑在
 * `await initOpLog()` **之后** —— 那一刻 `load` 早就放完了。原实现只挂
 * `window.addEventListener('load', …)`，于是**生产构建里 SW 再也不注册**，
 * 而且**一行报错都没有**（`getRegistration()` 恒为 `null`）。
 *
 * 🔴 真浏览器那条判据（`e2e/tests/privacy-consent-zero-egress.spec.ts`）抓到了它，
 * 但那支要生产构建 + Chromium，不在 `pnpm -r test` 里。这里把**同一个失效形状**
 * 用 jsdom 钉住，这样下一次有人把注册推迟到某个异步点时，普通测试就会红。
 *
 * ## 变异（都实测过会红）
 *
 *   1. 只挂 `load` 监听（改回原样）⇒ 第 1 条红；
 *   2. 去掉 `?slice=` 那条早退 ⇒ 第 3 条红；
 *   3. 去掉 `PROD` 那条早退 ⇒ 第 4 条红。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWidgetServiceWorker, serviceWorkerUrl } from '../src/pwa/register.js';

/**
 * 🔴 真实的 `ServiceWorkerContainer.register()` **总是** resolve 一个
 * `ServiceWorkerRegistration`（浏览器不会 resolve `undefined`），而容器在
 * 首装时 `controller` 是 `null`。夹具必须按这个形状造 —— 只给 `{ register }`
 * 会让 `register.ts` 里的 `registration.waiting` 读到 `undefined` 的属性并抛
 * `TypeError`，再被 `.catch` 吞成一条**误导性的**「service worker 注册失败」日志。
 * 那不是产品缺陷（真浏览器里 registration 一定存在），而是夹具缺字段。
 */
const registration = {
  waiting: null,
  installing: null,
  active: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

const register = vi.fn(() => Promise.resolve(registration));

function setReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', { value, configurable: true });
}

beforeEach(() => {
  // `register.ts` 在非生产构建里是空操作（dev 注册 SW 会把 HMR 弄坏），
  // 所以这一支必须把 PROD 打开才测得到真正的路径。
  vi.stubEnv('PROD', true);
  Object.defineProperty(navigator, 'serviceWorker', {
    // `controllerchange` 监听是 2026-11 新增的（新 SW 接管后提示刷新）；
    // 夹具要跟着真实 ServiceWorkerContainer 的形状走。
    value: {
      register,
      // 首装（无旧 SW 接管）时 `controller` 为 `null` —— 与真实容器一致。
      controller: null,
      ready: Promise.resolve(registration),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    configurable: true,
  });
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  setReadyState('complete');
});

describe('SW 注册不能假设"自己一定跑在 load 之前"', () => {
  it('🔴 `load` 已经放完时**当场**注册（闸门补跑就发生在这之后）', () => {
    setReadyState('complete');
    registerWidgetServiceWorker();
    expect(register, 'readyState 已是 complete 时还等 load ⇒ 永远不注册（实测的生产缺陷）').toHaveBeenCalledWith(
      serviceWorkerUrl(),
    );
  });

  it('`load` 还没放完时仍然等它 —— 不和首屏资源抢带宽', () => {
    setReadyState('loading');
    registerWidgetServiceWorker();
    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledTimes(1);
    // 监听是 `once`：再放一次 load 不该注册第二个 SW。
    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('切片验证入口（`?slice=1`）里不注册', () => {
    setReadyState('complete');
    window.history.replaceState({}, '', '/?slice=1');
    registerWidgetServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });

  it('dev 构建里不注册（这条早退是 HMR 的护栏，不是多余的）', () => {
    vi.stubEnv('PROD', false);
    setReadyState('complete');
    registerWidgetServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });
});
