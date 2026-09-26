/**
 * 披露文案 → 词条 key。
 * =====================
 *
 * 🔴 **为什么需要这一层，而不是在四个面板里各写一遍。**
 *
 * 「发给谁 / 发什么 / 留多久」是同一件事的三个维度，四个 AI 面板（拆解 /
 * 捕获 / 估时 / 排序）共用同一套披露。文案就一条，谁改口径四个面板一起变 ——
 * 这是刻意的。
 *
 * ⚠️ 但门禁**看不见**这里：`t(cond ? 'a' : 'b')` 是不合规形状（它只认
 * "字面量紧跟 `t(`"）。所以四个面板不能把三元直接套进 `t()`，只能先算出
 * key 变量再 `t(key)`。把"算 key"这一步收在一个函数里，就不会出现
 * "其中一个面板漏改一条分支"这种漂移。
 *
 * ⚠️ `retentionText` 是 `packages/ai` 里的**跨包中文兼容句**，与
 * `retentionDisclosure` 同源但**不参与语言切换**。web 壳不再渲染它
 * （那会让英文界面出现中文）；它仍留在 `packages/ai`，因为 CLI 与
 * `check-ai-coverage` 还在用，而且那是个零依赖的包。
 */
import type { RetentionDisclosure } from '@heyta/ai';
import type { MessageKey } from '@heyta/i18n';

/** 结构化保留策略 → 词条 key。判别式穷举，漏一种编译就不过。 */
export function retentionMessageKey(kind: RetentionDisclosure['kind']): MessageKey {
  switch (kind) {
    case 'not-applicable':
      return 'web.ai.disclosure.retentionNotApplicable';
    case 'third-party-decides':
      return 'web.ai.disclosure.retentionThirdParty';
    case 'undecided':
      return 'web.ai.disclosure.retentionUndecided';
  }
}
