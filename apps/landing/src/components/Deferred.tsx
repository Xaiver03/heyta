/**
 * 延迟挂载
 * ==========
 *
 * 用一个 IntersectionObserver 把子树推迟到"快滚到了"才挂载。
 *
 * 为什么需要它：WebGL 那一节用了 three.js，打包后是 **131 kB gzip** 的独立
 * chunk（比页面其余所有 JS 加起来还大）。它在页面靠下的位置，首屏完全用不到。
 * 静态 import 会让每个访客在首屏就下载它 —— 在慢网络上，这就是
 * "首屏白着等一个看不见的东西"。
 *
 * 两个好处：
 *   1. 不滚到那儿就不下载（`rootMargin` 提前 600px 预取，滚到时已经就绪）
 *   2. 不滚到那儿也不创建 WebGL 上下文（上下文是有限资源）
 *
 * 占位块给了 `min-block-size`，避免挂载瞬间撑高页面导致**滚动位置跳动**
 * —— 那是一种很显眼的 CLS，而且会让人以为自己滚过头了。
 *
 * 用 `<div>` 而不是 `display: contents`：后者没有盒子，IntersectionObserver
 * 观察不到（会永远不触发）。
 *
 * 🔴 `id` 必须挂在**占位块**上，不能挂在里面那棵子树上。
 * 否则页内锚点会变成一个**死循环**：导航点 `#sync` → 浏览器找不到落点、不滚动 →
 * 而落点只有在"滚到附近"才会被挂载 → 于是永远滚不到、也永远不挂载。
 * 现象是**点了完全没反应、控制台也没有任何报错**，只有真浏览器里手点才发现。
 * 挂在这里之后：点击立即有落点、浏览器滚过去、IntersectionObserver 随即触发挂载。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Deferred({
  children,
  id,
  minBlockSize = '60vh',
}: {
  children: ReactNode;
  /** 占位块上的锚点 id（见上面那段"死循环"说明）。 */
  id?: string;
  minBlockSize?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    // 没有 IntersectionObserver 就**直接挂载**，而不是永远不挂载。
    // 渐进增强的方向是"没有它也完整可用"，不是"没有它就少一块内容"。
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting === true) {
          setShown(true);
          observer.disconnect();
        }
      },
      // `rootMargin` 用**百分比**而不是固定 px：百分比相对视口高度解析，
      // 于是"提前多远预取"随屏幕大小自动缩放 —— 在矮屏上不会预取过头，
      // 在高屏上也不会临到跟前才开始下载。
      // （固定 600px 在 4K 竖屏上只等于半个屏幕，反而来不及。）
      { rootMargin: '50% 0% 50% 0%' },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={ref} id={id} className="lp-deferred" style={{ minBlockSize }}>
      {shown ? children : null}
    </div>
  );
}
