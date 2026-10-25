/**
 * 从 RNW 注入的那张原子样式表里读**声明本身**。
 *
 * 🔴 为什么不用 `getComputedStyle`：react-native-web 把样式编译成原子 class
 *    （`r-backgroundColor-1frcd3k`），声明落在注入文档的那张表里。jsdom 对
 *    "**原地换了 class 的节点**"会返回**换之前**的值 —— 实测症状是"勾选之后仍然读到
 *    未勾选那枚底色"，与"产品根本没换色"在输出上逐字同形，而且它在单跑与全套之间一绿一红。
 *    所以这里查那张表，不查节点上的缓存。（原始出处：`share-consent-modal-theme.spec.tsx`）
 *
 * 🔴 只认**原子类**（`r-backgroundColor-…`）。RNW 还给每个节点挂了基底类 `css-view-*` /
 *    `css-text-*`，那里面就写着 `background-color: rgba(0, 0, 0, 0)` 之类的复位声明 ——
 *    按 classList 顺序扫会永远先撞上基底，读到的全是复位值。
 */

/** `#rrggbb` → `rgb(r, g, b)`，与注入表里的写法对齐；不是十六进制的原样返回。 */
export function norm(color: string): string {
  const hex = color.trim().replace('#', '');
  if (hex.length !== 6) return color.trim();
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${n(0)}, ${n(2)}, ${n(4)})`;
}

/**
 * 取节点上那枚原子类对应的声明值。
 * 节点不存在 ⇒ 抛错（探针坏了要响亮）；该属性一个声明都没有 ⇒ 返回 `'<none>'`，
 * 那是**读数**不是失败：对"这一层不该有底色"这类判据，它正是判据要的值。
 */
export function declared(el: ParentNode, selector: string, prop: string): string {
  const node = el.querySelector<HTMLElement>(selector);
  if (node === null) throw new Error(`DOM 里没有 ${selector}`);
  const atomic = Array.from(node.classList).filter((cls) => cls.startsWith('r-'));
  if (atomic.length === 0) return '<none>';
  let found = '<none>';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 读不到的表（跨源）与本判据无关
    }
    for (const rule of Array.from(rules)) {
      const styleRule = rule as CSSStyleRule;
      if (styleRule.style === undefined) continue;
      const cls = atomic.find((name) => styleRule.selectorText === `.${name}`);
      if (cls === undefined) continue;
      const value = styleRule.style.getPropertyValue(prop);
      // 后写的规则覆盖先写的，所以取**最后一个**命中，而不是第一个。
      if (value !== '') found = norm(value);
    }
  }
  return found;
}
