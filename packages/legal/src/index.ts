/**
 * heyta 对外法律文本 —— **唯一事实源**
 * =====================================
 *
 * 本包只放**文本与版本**，不放渲染。三个消费面各用自己的渲染器读同一份数据：
 *
 * | 消费面 | 位置 | 形态 |
 * |---|---|---|
 * | 落地页 `/legal/<id>/` | `apps/landing` | 中英两版静态 HTML 入口（注册表派生） |
 * | 自建/托管服务端的对外页 | `server`（生成物 + 门禁） | 应用内「同意**该服务端**提供的…」那条链接的落点 |
 * | 应用内 | web / 移动 | 链接到落地页（**不在客户端复制一份正文**） |
 *
 * 🔴 **「同意该服务端提供的服务条款与隐私政策」这句措辞是本包存在的核心理由。**
 * heyta 的部署方可以是任何人（`site.docs.account.s4p1`），所以注册时勾选的对象是
 * **用户连的那台服务器**的条款，而不是 heyta 的条款。官方托管实例由本包的
 * `OPERATOR` 那组事实 + 这一组文本作答；自建实例由部署者自己负责发布（服务端
 * 那侧的 `PRIVACY_*` / `<dataDir>/legal/terms.html` 机制是为此保留的）。
 * 混用两套文本 —— 或者在应用里把 heyta 的条款显示成"该服务端的条款"——
 * 是在替别人（或替自己）作出没有依据的承诺。
 *
 * 📌 **每条事实断言的证据**在 `docs/research/legal-dataflow-*.md`（服务端 / 客户端 /
 * AI 与权利三份代码考古）。政策里写不进这包的运营事实（客服 SLA 等）在
 * `docs/plans/legal-compliance-before-filing.md` 的缺口清单里编号登记。
 */

import type { Locale } from '@heyta/i18n';

export type {
  LegalBlock,
  LegalDocument,
  LegalInlineText,
  LegalSection,
  LegalStatus,
  LegalTableRow,
} from './types.js';

import type { LegalDocument } from './types.js';

import { dataRights } from './documents/data-rights.js';
import { minors } from './documents/minors.js';
import { permissions } from './documents/permissions.js';
import { personalInfoList } from './documents/personal-info-list.js';
import { privacy } from './documents/privacy.js';
import { subscriptionAndRefund } from './documents/subscription-refund.js';
import { terms } from './documents/terms.js';
import { thirdParties } from './documents/third-parties.js';
import { aiAndTransfer } from './documents/ai-and-transfer.js';

/**
 * 服务提供者 —— **对外承诺里的"我们"是谁**，一份事实源。
 *
 * 🔴 每个字段都必须是**已核实的事实**，不是模板占位：法律文件里写错主体名称或
 * 信用代码，比不写更糟（它会让整份文件指错责任人）。
 * 来源：`docs/runbooks/icp-app-filing.md` §一（备案主体，与华为账号实名主体一致）、
 * `server/legal/terms-of-service.heyta.md` §1。
 *
 * ⚠️ `appFilingNumber` 目前是 `null`：**App 备案号尚未核准**。
 * 文本里凡是要引用它的地方都必须走这个字段，这样核准后**只改一处**，
 * 而不是在九份文件里找"备案号"三个字。
 */
export const OPERATOR = {
  name: '晓黎（杭州）人工智能科技有限公司',
  /** 统一社会信用代码。 */
  code: '91330106MAKNJ6DX7M',
  legalRepresentative: '邓湘雷',
  address: '浙江省杭州市西湖区蒋村街道文一西路 830 号蒋村商务中心 3 号楼 210 室',
  /** 对外联系方式（已投产的出站邮箱，见 `docs/runbooks/deployment.md` §SMTP_FROM）。 */
  contactEmail: 'heyta@waytofuture.cn',
  /** 主域 `waytofuture.cn` 已核准的 ICP 备案号（本主体）。 */
  icpNumber: '浙ICP备2026081423号',
  /** 🔴 App 备案号：工信部尚未核准。**不许编造**；核准后填这个字段。 */
  appFilingNumber: null as string | null,
  /** 官方托管实例的域名（法律页与应用同域）。 */
  hostedDomain: 'heyta.waytofuture.cn',
} as const;

/**
 * 全部对外法律文本。**加一份文件只改这里**（外加一份 `documents/<id>.ts`）。
 *
 * 顺序即页脚与索引页的展示顺序：先"约定的规则"（协议 / 隐私），
 * 再"逐项清单"（收集 / 权限 / 第三方），最后"特定人群与特定功能"与"怎么行使权利"。
 */
export const LEGAL_DOCUMENTS = [
  terms,
  privacy,
  personalInfoList,
  permissions,
  thirdParties,
  aiAndTransfer,
  minors,
  subscriptionAndRefund,
  dataRights,
] as const satisfies readonly LegalDocument[];

/** 注册表里真实存在的文档 id 的联合类型。 */
export type LegalDocumentId = (typeof LEGAL_DOCUMENTS)[number]['id'];

/** 按 id 取文档。**取不到就抛** —— 静默回落到"另一份文件"是法务场景最坏的失败。 */
export function legalDocumentById(id: string): LegalDocument {
  const found = LEGAL_DOCUMENTS.find((document) => document.id === id);
  if (found === undefined) {
    throw new Error(`@heyta/legal 里没有文档 "${id}"（见 src/index.ts 的 LEGAL_DOCUMENTS）。`);
  }
  return found;
}

/** 某一语言下的文档标题（用于导航、页脚、`<title>`）。 */
export function legalTitle(id: string, locale: Locale): string {
  return legalDocumentById(id).title[locale];
}

/**
 * **同意记录要写进数据库的那个版本号。**
 *
 * 形状：`terms@1.0;privacy@1.0;…`（按 id 排序，所以与数组顺序无关）。
 *
 * 为什么用"整套的指纹"而不是单份文件的版本：注册时勾选的是**一组**文件
 * （协议 + 隐私），用户同意的是"当时那一套"。只记 `privacy` 的版本，
 * 就无法回答"他同意的协议是哪一版"。
 * 排序后拼接还有一条好处：**重排数组不会改变指纹**（否则改版只是挪动顺序
 * 就会让历史同意记录对不上任何现行文本）。
 */
export function legalSetVersion(): string {
  return [...LEGAL_DOCUMENTS]
    .map((document) => `${document.id}@${document.version}`)
    .sort()
    .join(';');
}

/** 尚未生效（`status: 'draft'`）的文档 id —— 页面要显示"草案"横幅，索引要能列出来。 */
export function draftDocumentIds(): readonly string[] {
  return LEGAL_DOCUMENTS.filter((document) => document.status === 'draft').map((d) => d.id);
}
