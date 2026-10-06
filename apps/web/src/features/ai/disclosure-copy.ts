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
import type { MessageKey, MessageVars } from '@heyta/i18n';

/**
 * 结构化保留策略 → 词条 + 插值。判别式穷举，漏一种编译就不过。
 *
 * 🔴 返回的是**整个披露对象**而不是 `kind`：`metadata-only` 那一句里有天数，
 * 而天数**只能从披露对象取**（它由 `packages/ai` 的那两个常量投影出来）。
 * 只传 `kind` 的话，壳就只能自己写一个 45 —— 那就是"同一个数字两处写"，
 * 而改了常量之后界面会报出一个不存在的保留期。
 */
export function retentionMessage(disclosure: RetentionDisclosure): {
  readonly key: MessageKey;
  readonly vars?: MessageVars;
} {
  switch (disclosure.kind) {
    case 'not-applicable':
      return { key: 'web.ai.disclosure.retentionNotApplicable' };
    case 'third-party-decides':
      return { key: 'web.ai.disclosure.retentionThirdParty' };
    case 'metadata-only':
      return {
        key: 'web.ai.disclosure.retentionMetadataOnly',
        vars: { contentDays: disclosure.contentDays, metadataDays: disclosure.metadataDays },
      };
  }
}
