/**
 * 问答列表
 * ==========
 *
 * 🔴 **用 `<dl>` 而不是 `<details>`。**
 *
 * 折起来的那一半很诱人（帮助页看起来短、干净），代价是答案默认不在页面上：
 *   1. 搜索引擎对"默认不可见"的内容给更低的权重，而这一页存在的理由之一
 *      就是有人搜"heyta 怎么同步"能搜到答；
 *   2. 折起来的答案对**读屏软件**是一道要主动展开的墙 —— 打开 `help` 页的人
 *      本来就在找答案，让他再点一次是多余的；
 *   3. `<details>` 的展开状态不在 URL 里，所以"把这个答案发给别人"做不到，
 *      而这个页面最常被分享的恰恰是**某一条答案**。
 *
 * `<dt>` 上带 `id`，于是 `/{locale}/help/#sync` 落在**具体那一问**上 ——
 * 应用里那句"同步出错了"可以直接指过来。
 */

import { KeyText } from './PageSections.js';
import type { FaqPair } from './content.js';

export function FaqList({ pairs }: { pairs: readonly FaqPair[] }): React.JSX.Element {
  return (
    <dl className="lp-faq">
      {pairs.map((pair) => (
        <div key={pair.id} className="lp-faq__item">
          <dt className="lp-faq__q" id={pair.id}>
            <KeyText messageKey={pair.questionKey} />
          </dt>
          <dd className="lp-faq__a">
            <KeyText messageKey={pair.answerKey} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
