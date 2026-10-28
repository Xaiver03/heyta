import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { HeytaUiProvider, OverlayModal } from '@heyta/ui';

/**
 * P6 的**开工前置探针**（不是产品界面，也不是给人用的页面）
 * ======================================================
 *
 * `docs/reference/environment-traps.md` §7 第 606 条留了一句"未判定"：
 * 共享 `OverlayModal` 的外壳是 react-native-web 的 `Modal`，而它在 Web 真实浏览器里
 * **那一层根本没出现**（零 console、零 pageerror，同一棵树上 jsdom 契约测全绿）。
 * 那条留了一个能一次定死成因的断言：同时量三样 ——
 *   ① `document.body` 子节点增量
 *   ② `[aria-modal]` 计数
 *   ③ `[role="dialog"]` 计数
 * 读 RNW 源码已知的形状是 `aria-modal` 无条件、`role="dialog"` 取决于 `active`，
 * 而 `active` 来自 `ModalAnimation` 的 `onShow`（只有 `animationType !== 'none'` 时
 * 才靠 `animationend` 触发）⇒ **三者互相不一致**＝"挂载了但没激活"（P6 仍可迁，
 * 只是 role 定位与焦点陷阱要另修）；**全为 0**＝"没挂"（Web 侧的迁移目标就不是它）。
 *
 * ⚠️ 这一页只服务那一次测量。它不进产品路由（`vite dev` 按路径直接服务 `.html`），
 *    所以生产构建里没有它；跑法见 `e2e/tests/overlay-modal-mount-probe.spec.ts`。
 */
function Probe(): React.JSX.Element {
  const [visible, setVisible] = useState(false);
  return (
    <HeytaUiProvider>
      <button data-testid="probe-open" type="button" onClick={() => setVisible(true)}>
        挂载
      </button>
      <OverlayModal
        visible={visible}
        overlay="modal-readonly"
        title="探针层"
        labels={{ close: '关闭探针层' }}
        onDismiss={() => setVisible(false)}
        testID="probe-modal"
      >
        <div data-testid="probe-body">探针内容</div>
      </OverlayModal>
    </HeytaUiProvider>
  );
}

const host = document.getElementById('root');
if (host !== null) createRoot(host).render(<Probe />);
