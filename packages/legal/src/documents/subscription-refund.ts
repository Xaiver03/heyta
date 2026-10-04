/**
 * 订阅、计费与退款规则
 * =====================
 *
 * 这一份管的是**钱**：两件各自收费的服务（托管同步、云端 AI 订阅）的价格、
 * 计费方式、到期后果、退款、发票，以及一件我们**故意不做**的事（自动续费）。
 *
 * 🔴 **两件服务互相独立，这条是本文件的地基**：可以只买其中一个，买了一个
 * 不等于另一个，计价 / 期限 / 到期后果 / 退款各自计算。把它们写成一份条款会
 * 让"我买了同步是不是也买了 AI"变成一句要靠解释的话 —— 而解释在法律文本里
 * 就是争议的开始。所以第 1 条先摆一张对应表，并各自 `docRef` 到真正的条款文件。
 *
 * ⚠️ **本文件刻意不写的三样东西，都是刻意的，不是漏了**：
 * ① **税率** —— 是否含税以支付页标示为准；本文件只给定价，不给含税结算口径；
 * ② **开票细节**（抬头类型、开票时限、电子或纸质）—— 口径未定之前先写出来，
 *    就是在制造一份和实际开票不一致的对外文本；
 * ③ **App 备案号** —— 尚未核准。第 9 条把它显式留白并说明核准之后怎么补，
 *    而不是先编一个数字。
 *
 * 🔴 **云端 AI 订阅当前不提供，本文件不许把它写成可购买项。**该供给模式在
 * 实现里结构性不可达（无对应配置分支，且启用前检查会主动抛错，结论是
 * "数据保留策略未定"），并且有一条红线：**计量能力存在之前不得售卖**。
 * 因此第 8 条只写"不提供 + 为什么不提供 + 将来提供时怎么办（不溯及已支付期间）"。
 * 本文件也**不出现任何 AI 用量的次数或档位数字** —— 那些数字本身即承诺，
 * 而承诺要能对上实现。
 *
 * 📌 第 4 条（到期后果）与第 6 条（无自动续费）是**产品承诺**，不是套话：
 * 到期不删数据、不锁功能、不催缴；每一次扣款都要你主动确认。这两条写下来就是
 * 为了将来有人想"加个自动续费方便用户"时，必须先改这份对外文本并 bump 版本。
 *
 * 本文件的 `status` 目前是 `draft`：整份文件尚未法务复核，页面上的"尚未生效"
 * 横幅由该字段承担，正文里不写内部流程话术。
 */

import type { LegalDocument } from '../types.js';

const zh = [
  {
    id: 's1',
    title: '这份文件规范什么',
    blocks: [
      {
        kind: 'p',
        text: 'heyta 有**两件互相独立、各自收费**的服务：① **托管同步服务** —— 我们的服务器在你各设备之间中转并保管同步数据；② **云端 AI 订阅** —— 由我们代你使用云端大模型的用量。两件服务**可以只买其中一个**；买了其中一件**不等于**另一件也在生效。两件的计价、期限、到期后果与退款**各自计算、互不牵连**。',
      },
      {
        kind: 'table',
        head: ['服务', '你付钱买到的是什么', '完整条款在哪份文件里'],
        rows: [
          [
            '托管同步服务',
            '端到端加密后的数据由我们的服务器在各设备之间中转与保管。服务器按设计**只接触密文**，它是一条同步通道，不是你数据的存放处 —— 你设备上的本地数据始终是唯一可直接读写的副本。',
            '本文件（价格、期限、到期、退款）+《用户服务协议》（账号与服务变更等一般条款）',
          ],
          [
            '云端 AI 订阅',
            '由我们替你调用云端大模型的用量。🔴 **当前不提供**，原因与本条的完整说明见第 8 条。',
            '本文件（第 8 条）+《AI 功能与数据出境说明》（哪些数据交给谁、出境授权怎么给）',
          ],
        ],
      },
      {
        kind: 'docRef',
        docId: 'terms',
        text: '《用户服务协议》：账号、服务的变更与中止、责任边界等一般条款；本文件是它在**付费服务**这一块的补充，两处对同一件事的表述不一致时，以本文件中更具体的那一条为准。',
      },
      {
        kind: 'docRef',
        docId: 'ai-and-transfer',
        text: '《AI 功能与数据出境说明》：AI 功能把哪些内容交给谁处理、什么条件下会离开你的设备，以及云端 AI 与本机 AI 的区别。',
      },
      {
        kind: 'callout',
        text: '一句话：**买同步不等于买 AI，买 AI 不等于买同步。**两件服务的账单分开出现，退掉其中一件不影响另一件的剩余服务期。',
      },
    ],
  },
  {
    id: 's2',
    title: '价格与含税',
    blocks: [
      {
        kind: 'p',
        text: '下表是**本文件里唯一的价格清单**，本文件不出现其他金额。价格如有调整，新价格只对你**下一次支付**生效；你已经支付的那一期服务期内价格不变、服务不变。',
      },
      {
        kind: 'table',
        head: ['服务', '中国大陆', '海外', '含税'],
        rows: [
          [
            '托管同步服务',
            '¥5 / 月',
            '$5 / 月',
            '⚠️ 是否含税**以支付页标示为准**',
          ],
          ['云端 AI 订阅', '暂未提供', '暂未提供', '—'],
        ],
      },
      {
        kind: 'callout',
        text: '🔴 我们**不在本文件里替你算税**。中国大陆与海外、不同购买渠道下的适用税率与开票口径并不相同，本表给出的是**定价**，不是含税结算口径的承诺。你在支付页看到的**应付金额**才是你实际支付的数额；如果支付页与本表出现任何不一致，请先停下来，把截图发到本文末尾的邮箱，我们核实之后再收款。',
      },
    ],
  },
  {
    id: 's3',
    title: '计费方式与期限',
    blocks: [
      {
        kind: 'p',
        text: '两件关于钱的事先说清：① **一个计费周期是 30 天**，自支付成功之时起算；② 🔴 **我们不自动扣款** —— 服务期走完之后，除非你再次主动完成支付，不会有任何款项从你的账户或支付渠道划走。',
      },
      {
        kind: 'ul',
        items: [
          '支付周期：**按月支付**，每次支付覆盖 **30 天**的服务期。',
          '起算点：服务期自**支付成功**之时起算；以服务期长度计，不以你这 30 天里实际同步了多少次为准。',
          '到期提醒：服务期结束前，我们会在应用内提醒你续费。🔴 提醒只是提醒，**不构成任何扣款授权**，也不会替你按下支付。',
          '🔴 **提前续费不损失时间**：在到期日之前续费，新的 30 天在**原到期日之上顺延**，不是从续费当天重新起算、把原来剩下的天数作废。',
        ],
      },
      {
        kind: 'p',
        text: '举个例子：你的服务期还剩 **10 天**时完成了一次续费，续完之后你的剩余服务期是 **40 天**（原来的 10 天 + 新的 30 天），而不是重新数 30 天、让那 10 天凭空消失。你随时可以在应用内查看当前服务期的**截止日**，它是唯一的计算结果，不需要你自己加。',
      },
    ],
  },
  {
    id: 's4',
    title: '到期会发生什么',
    blocks: [
      {
        kind: 'p',
        text: '这一条是我们对"到期没续费会怎样"的**完整**回答。下表之外没有别的事情会发生，我们也不会用"再不说就删"这类说法催你付款。',
      },
      {
        kind: 'table',
        head: ['项目', '到期后'],
        rows: [
          [
            '你设备上的本地数据',
            '🔴 一个字都不动：不删除、不修改、不清空、不锁定',
          ],
          [
            '应用功能',
            '🔴 不受影响：全部功能照常可用，可继续查看、编辑、导出',
          ],
          [
            '已同步到服务器的数据',
            '🔴 不删除：不以删除数据作为催缴手段',
          ],
          ['托管同步', '⏸ 停止（所有设备，不只是新设备）'],
          ['出路', '① 续费；② 改用你自己的服务器，同步立即恢复、数据无损'],
        ],
      },
      {
        kind: 'callout',
        text: '我们不把数据当作人质：未按期续费的后果**仅限于停止托管同步**这一件事。heyta 是本地优先的应用，你的数据先落在你自己的设备上，服务器只是一条通道 —— 通道停了，东西还在你手里。续费之后同步自动接上；你也可以把地址换成你自己搭的服务器，那条路同样**数据无损**。',
      },
    ],
  },
  {
    id: 's5',
    title: '退款',
    blocks: [
      {
        kind: 'p',
        text: '退款按**你实际未使用的服务期**计算。申请方式：把订单信息与你的诉求发到本文末尾的联系邮箱，我们在核实支付记录与实际使用情况后回复处理结果。',
      },
      {
        kind: 'ol',
        items: [
          '支付后 **7 日内**提出，且**未实际使用托管同步的**：**全额退款**。',
          '支付 **7 日之后**提出：按**剩余未使用天数**的比例退款，已经使用的那部分服务期不予退款。',
          '服务期已届满之后提出：**不予退款** —— 那一期的服务已履行完毕。',
          '退款**按原支付路径退回**，我们在收到申请后 **7 个工作日**内处理。',
        ],
      },
      {
        kind: 'p',
        text: '三点边界，一次说清：① 上表中的"云端 AI 订阅"当前不提供，因此**不存在针对它的退款**，本条的退款对象只有托管同步；② 一次支付对应一个 30 天服务期，退款只计算**该服务期内未使用的天数**，不回溯你此前的历史支付；③ 本条是我们对你的承诺，其中一部分**可能比我们负有的法定义务更宽** —— 你按本条主张即可，不需要自己去分辨哪一部分是法定义务、哪一部分是我们主动多给的。',
      },
    ],
  },
  {
    id: 's6',
    title: '关于自动续费：我们没有，所以那一套义务不适用',
    blocks: [
      {
        kind: 'p',
        text: '这个品类（包括应用商店里绝大多数订阅商品）的常见做法是**默认开启自动续费**，然后由监管要求平台"扣款前显著提示、提供便捷的取消路径"。《互联网平台价格行为规则》（2026-04-10 施行）第 20 条讲的就是这一套。heyta **不发生任何自动扣款**，因此那一套义务在本服务上**没有适用的对象** —— 不是我们免除了它，而是它的结构在这里不成立。',
      },
      {
        kind: 'callout',
        text: '这是可以直接核验的承诺：**我们不会在你未确认的情况下扣款；到期不使用也不会产生任何费用；每一次续费都必须由你主动完成。**对照核验的方法很简单 —— 我们的设置里没有"取消订阅"这个入口，因为**没有需要取消的订阅**；你的支付渠道里也不会出现我们发起的、你未确认过的重复扣款。',
      },
      {
        kind: 'p',
        text: '这个选择的代价由我们承担、不由你承担：你要自己记得续费，否则服务期会安静地结束（后果见第 4 条，只有托管同步停止这一件）；好处是你不必去翻设置找那个被藏在三级菜单里的取消按钮，也不必担心"忘了关"这件事本身要花钱。如果将来我们改成支持自动续费，**必须先把本条改掉并提前公告**，不会先用起来再补文本。',
      },
    ],
  },
  {
    id: 's7',
    title: '发票与凭证',
    blocks: [
      {
        kind: 'p',
        text: '付费服务**可以开具发票**。需要的话，请把**开票信息**（抬头、必要时的税号）连同**支付凭证**（订单号、支付时间、金额）发到本文末尾的联系邮箱，🔴 我们在收到后 **7 个工作日**内处理并回复。',
      },
      {
        kind: 'ul',
        items: [
          '应用内的支付成功记录与支付渠道的账单是**付款凭证**，它们不等同于发票；需要报销文件的，请照上面那一句申请。',
          '发票的具体口径（抬头类型、开票时限、电子或纸质形态）以我们回复你的邮件为准。**我们不在本文件里预先写一套细节** —— 那只会制造一份和实际开票不一致的对外文本。',
        ],
      },
    ],
  },
  {
    id: 's8',
    title: '云端 AI 订阅的现状：当前不提供',
    blocks: [
      {
        kind: 'p',
        text: '🔴 **当前不提供云端 AI 订阅**，本文件也不把它写成可购买项。第 2 条价格表里那一行"暂未提供"就是这个意思：现在**没有任何人可以购买它**，也没有任何关于它的价格、额度或账单。',
      },
      {
        kind: 'ul',
        items: [
          '这个供给模式在我们的系统里**尚未开通**：既没有把请求发往云端的服务配置，也有一道启用前的检查会**主动拒绝**而不是放行 —— 它当前给出的理由是"数据保留策略未定"。',
          '我们的纪律是：**在能够准确计量用量之前，不出售按用量计费的服务。**否则就是收了钱却不交付，或者收了钱却无法向你说明你到底用掉了什么。',
        ],
      },
      {
        kind: 'p',
        text: '为什么"保留策略未定"就不能卖：云端 AI **必须**看到你的明文内容才能工作，而"这些内容在我们这一侧停留多久、以什么形式留存、到期怎么清除"恰恰是保留策略要回答的问题。在这个问题还没有答案的时候把它挂上收银台，等于把一个我们无法说明边界的处理过程卖给你。',
      },
      {
        kind: 'docRef',
        docId: 'ai-and-transfer',
        text: '《AI 功能与数据出境说明》：本机 AI 与云端 AI 的区别、哪些内容会交给谁处理、出境授权怎么给、以及每一项 AI 功能的开关分别在哪里。',
      },
      {
        kind: 'callout',
        text: '一条重要的边界：**托管同步的核心承诺是"我们只中转密文"，而云端 AI 必须看到明文。**所以这是**两份独立的条款**，各自适用、不合并解释，我们也**不会把 heyta 的云端 AI 描述成端到端加密**。一旦我们决定提供云端 AI 订阅，会**另行发布适用的条款并提前通知**，🔴 且新条款**不溯及你已经支付的服务期**。',
      },
    ],
  },
  {
    id: 's10',
    title: '欧盟 GDPR 口径：付费这一侧留下什么、能删到哪一步',
    blocks: [
      {
        kind: 'p',
        text: '收费与退款这一侧的 GDPR 问题不是"我们有没有拿到你的同意"，而是**为了收钱而留下的那几行记录，能删到哪里**。下面每一格都按实际表结构写：`payment_events` 与 `checkout_orders` 是真在库里的那两张表，措辞与它们的字段一致，不写这两张表里没有的东西。',
      },
      {
        kind: 'table',
        head: ['GDPR 的位置', '它问的是什么', 'heyta 现在拿得出的', '对不上的部分'],
        rows: [
          [
            '第 5(1)(c) 条（数据最小化）',
            '为了收款而保存的东西是否限于必要',
            '`payment_events` 保存渠道事件号与**报文摘要** `payloadDigest`，不保存支付渠道发来的原始报文；`checkout_orders` 只有订单号、价格、币种、地区、金额与状态，没有卡号那一类支付凭据',
            '但这些行都通过 `user_id` 绑到你的账号上，摘要本身也能被渠道那边反查；另外开票时你主动发到邮箱的**抬头与税号**落在邮件系统里，不在这两张表的删除范围内'
          ],
          [
            '第 17 条第 17(3)(b) 与 17(3)(e) 款（法定义务、法律主张）',
            '付费记录能不能说删就删',
            '合同存续期间必须保留权益判定所需的记录，否则"你到底买到哪一天"就没有可核对的答案',
            '退款之后那几行**不会当场消失**：会计与税务的留存年限由法定义务决定，而本文件不写具体年限 —— 开票口径本身还没定（见第五节），先写一个数字就是制造一份和实际不一致的对外文本'
          ],
          [
            '第 7(3) 条（撤回同意应与给予同样容易）',
            '不想再被处理时，撤消这条路是不是同样短',
            '没有任何自动扣款：到期即止，不存在"先取消订阅才能停止处理"这一步',
            '但停止托管同步这一侧的处理等于**注销账号**，不是关掉一个开关；所以这里不写"随时可撤、撤回即清除"，那种说法在备份与授权范围内都不成立'
          ],
          [
            '第 22 条（仅自动化决策）',
            '有没有一个只由机器作出、对你有显著影响的决定',
            '权益是多个来源取并集的机械判定（付费、邀请奖励、人工授予都算数，后写的奖励不会盖掉已付的时长），没有"机器判断你不配用"这一档',
            '它确实决定付费功能的可用与不可用，所以判定规则写在本文前几节而不是留成黑箱；如果将来按用户画像调价，这一格会立刻变成对不上，而今天没有这件事，本文件也不为它预留说法'
          ],
        ],
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: '《个人权利行使与请求响应》：注销账号之后各类数据各自删到什么程度、备份的边界在哪里，那张 GDPR 逐条对照表在那里；本文件只讲为了收款而留下的记录。',
      },
    ],
  },
  {
    id: 's9',
    title: '争议、联系与版本记录',
    blocks: [
      {
        kind: 'p',
        text: '提供本服务并收取费用的主体：**晓黎（杭州）人工智能科技有限公司**；统一社会信用代码 `91330106MAKNJ6DX7M`；住所 浙江省杭州市西湖区蒋村街道文一西路 830 号蒋村商务中心 3 号楼 210 室；联系邮箱 `heyta@waytofuture.cn`。与价格、扣款、到期、退款、发票有关的任何问题，都请发到该邮箱。',
      },
      {
        kind: 'ul',
        items: [
          '对退款金额或服务期计算有争议：先联系上面的邮箱，附上订单号与你认为正确的计算；我们核实支付与实际使用记录后回复处理结果，不会要求你先接受一个未说明理由的结论。',
          '本文件与《用户服务协议》一并适用；两者就付费服务的价格、期限、到期后果或退款表述不一致时，**以本文件中更具体的那一条为准**。',
          '🔴 App 备案号：本文件的这一版**尚未填写** —— 备案号尚未核准。核准之后我们会新增一个版本把它写明，🔴 **不会先放一个还没有的数字在这里**。',
        ],
      },
      {
        kind: 'table',
        head: ['版本', '日期', '说明'],
        rows: [
          ['1.0', '2026-10-01', '首次起草，尚未经法务复核'],
          [
            '1.1',
            '2026-10-04',
            '新增第十节：GDPR 一侧"为了收款而留下的记录"按 `payment_events` 与 `checkout_orders` 的真实字段写（数据最小化、法定留存、撤回同意这条路有多短、仅自动化决策四格）。同时写明两件做不到的：退款不会让那几行当场消失，你在邮件里发来的抬头与税号不在这两张表的删除范围内。权利行使的逐条对照表只在《个人权利行使与请求响应》那一份里，本节只指向它，不另抄一份。',
          ],
        ],
      },
    ],
  },
] as const;

const en = [
  {
    id: 's1',
    title: 'What this document governs',
    blocks: [
      {
        kind: 'p',
        text: 'heyta charges for **two separate services**: ① **Hosted sync** — our server relays and holds the sync data between your devices; ② **Cloud AI subscription** — usage of a cloud large language model that we operate on your behalf. You may buy **either one alone**; buying one **does not** mean the other is active. Price, term, expiry and refund are calculated **for each service on its own** and never affect one another.',
      },
      {
        kind: 'table',
        head: ['Service', 'What you are paying for', 'Where the full terms live'],
        rows: [
          [
            'Hosted sync',
            'Your end-to-end encrypted data is relayed and held between your devices by our server. By design the server **handles ciphertext only**; it is a sync channel, not the place where your data lives — the local copy on your device remains the only directly readable one.',
            'This document (price, term, expiry, refund) plus the Terms of Service (account, changes to and suspension of the service)',
          ],
          [
            'Cloud AI subscription',
            'Usage of a cloud large language model that we call for you. 🔴 **Not currently offered**; section 8 explains why in full.',
            'This document (section 8) plus the AI Features and Cross-border Data statement (what is handed to whom, and on what authorisation)',
          ],
        ],
      },
      {
        kind: 'docRef',
        docId: 'terms',
        text: 'Terms of Service: the general terms — account, changes to and suspension of the service, limits of liability. This document supplements it for **paid services**; where the two disagree about the same thing, the more specific provision in this document prevails.',
      },
      {
        kind: 'docRef',
        docId: 'ai-and-transfer',
        text: 'AI Features and Cross-border Data statement: which content AI features hand to whom, under what conditions it leaves your device, and how hosted AI differs from on-device AI.',
      },
      {
        kind: 'callout',
        text: 'In one sentence: **buying sync does not buy AI, and buying AI does not buy sync.** The two appear as separate charges, and refunding one leaves the remaining term of the other untouched.',
      },
    ],
  },
  {
    id: 's2',
    title: 'Prices and tax',
    blocks: [
      {
        kind: 'p',
        text: 'The table below is **the only price list in this document**; no other amount appears anywhere in it. If we change a price, the new price applies only to your **next payment**; a term you have already paid for keeps both its price and its service unchanged.',
      },
      {
        kind: 'table',
        head: ['Service', 'Mainland China', 'Overseas', 'Tax included'],
        rows: [
          [
            'Hosted sync',
            '¥5 / month',
            '$5 / month',
            '⚠️ Whether tax is included **is stated on the payment page**',
          ],
          ['Cloud AI subscription', 'Not currently offered', 'Not currently offered', '—'],
        ],
      },
      {
        kind: 'callout',
        text: '🔴 **We do not compute tax for you inside this document.** Applicable rates and invoicing treatment differ between mainland China and overseas, and between purchase channels. The table gives **list prices**, not a settled tax-inclusive figure. The amount shown on the payment page as payable is what you actually pay. If that page ever disagrees with this table, stop and send us a screenshot at the address at the end of this document — we will check it before we take the money.',
      },
    ],
  },
  {
    id: 's3',
    title: 'How billing works, and for how long',
    blocks: [
      {
        kind: 'p',
        text: 'Two things about money come first: ① **a billing period is 30 days**, counted from the moment payment succeeds; ② 🔴 **we do not charge you automatically** — once a term ends, no further amount is taken from your account or payment channel unless you yourself complete another payment.',
      },
      {
        kind: 'ul',
        items: [
          'Billing period: **paid monthly**; each payment covers a **30-day** term.',
          'Start of the term: it runs from the moment **payment succeeds**. Length of the term is what counts, not how many times you actually synced during those 30 days.',
          'Renewal reminder: before a term ends we remind you inside the app to renew. 🔴 A reminder is only a reminder — **it is not authorisation to charge you**, and we do not press pay on your behalf.',
          '🔴 **Renewing early costs you nothing**: if you renew before the expiry date, the new 30 days are **added on top of the existing expiry date**, rather than restarting from the day you paid and voiding the days left.',
        ],
      },
      {
        kind: 'p',
        text: 'For example: if you renew while **10 days** are left on your term, you then have **40 days** remaining (the 10 you had plus the new 30) — you do not go back to 30 and lose those 10 days. The **expiry date** of your current term is shown in the app at any time; it is the single computed result, and you never have to add anything up yourself.',
      },
    ],
  },
  {
    id: 's4',
    title: 'What happens when your term ends',
    blocks: [
      {
        kind: 'p',
        text: 'This section is our **complete** answer to "what happens if my term lapses". Nothing beyond the table below occurs, and we do not use threats such as "pay or we delete" to push you towards a payment.',
      },
      {
        kind: 'table',
        head: ['Item', 'After the term ends'],
        rows: [
          [
            'Your local data on your devices',
            '🔴 Not one byte changes: nothing is deleted, altered, emptied or locked',
          ],
          [
            'App features',
            '🔴 Unaffected: every feature keeps working; you may still read, edit and export',
          ],
          [
            'Data already synced to the server',
            '🔴 Not deleted: we never use deletion as a debt-collection tactic',
          ],
          ['Hosted sync', '⏸ Stops (on all of your devices, not only newly added ones)'],
          [
            'What you can do',
            '① renew; or ② point sync at your own server — sync resumes immediately and no data is lost',
          ],
        ],
      },
      {
        kind: 'callout',
        text: 'We do not hold your data hostage: the only consequence of not renewing on time is **that hosted sync stops**. heyta is local-first — your data is written to your own device first, and the server is only a channel. When the channel stops, what you have is still in your hands. After you renew, sync reconnects on its own; you may equally switch the address to a server you run yourself, and that route is likewise **lossless**.',
      },
    ],
  },
  {
    id: 's5',
    title: 'Refunds',
    blocks: [
      {
        kind: 'p',
        text: 'Refunds are calculated against **the part of the term you did not use**. To request one, send your order details and what you are asking for to the contact address at the end of this document; we check the payment record and the actual usage, then reply with the outcome.',
      },
      {
        kind: 'ol',
        items: [
          'Requested **within 7 days** of payment, where **hosted sync has not actually been used**: **full refund**.',
          'Requested **more than 7 days** after payment: refunded **pro rata by remaining unused days**; the part of the term you have used is not refundable.',
          'Requested after the term has already run out: **no refund** — that term has been performed in full.',
          'Refunds are returned **along the original payment route**, and we process them **within 7 working days** of receiving the request.',
        ],
      },
      {
        kind: 'p',
        text: 'Three boundaries, stated once: ① the "cloud AI subscription" in the table above is not currently offered, so **there is nothing to refund under it** — this section applies to hosted sync only; ② one payment corresponds to one 30-day term, and a refund is calculated **only over the unused days of that term**, never rolled back across your earlier payments; ③ this section is our commitment to you, and part of it **may be more generous than our legal obligations** — you can simply rely on this section, without having to work out for yourself which parts are owed by law and which we give voluntarily.',
      },
    ],
  },
  {
    id: 's6',
    title: 'On auto-renewal: we do not have it, so those duties do not attach',
    blocks: [
      {
        kind: 'p',
        text: 'The usual practice in this product category — including most subscription items in the app stores — is to **enable auto-renewal by default**, after which regulators require platforms to "give prominent notice before charging and provide an easy way to cancel". Article 20 of the Internet Platform Pricing Conduct Rules (effective 2026-04-10) is exactly that set of duties. heyta **never charges you automatically**, so those duties **have nothing to attach to** here. It is not that we are exempt from them; it is that the structure they regulate does not exist in our service.',
      },
      {
        kind: 'callout',
        text: 'A commitment you can verify directly: **we never charge you without your confirmation; letting a term lapse creates no cost of any kind; and every renewal must be completed by you.** How to check it: our settings contain no "cancel subscription" entry, because **there is no subscription to cancel**, and your payment channel will never show a recurring charge from us that you did not confirm.',
      },
      {
        kind: 'p',
        text: 'The cost of this choice sits with us, not with you: you have to remember to renew, otherwise the term simply ends quietly (see section 4 — only hosted sync stops). The benefit is that you never have to hunt through settings for a cancel button hidden three levels deep, or worry that "forgetting to switch it off" costs money. If we ever introduce auto-renewal, **this section must be rewritten and announced in advance first** — we will not switch it on and patch the text afterwards.',
      },
    ],
  },
  {
    id: 's7',
    title: 'Invoices and payment evidence',
    blocks: [
      {
        kind: 'p',
        text: 'Paid services **can be invoiced**. If you need an invoice, send the **invoicing details** (the payee name, and a tax identification number where one is required) together with your **payment evidence** (order number, time of payment, amount) to the contact address at the end of this document. 🔴 We process it and reply **within 7 working days** of receipt.',
      },
      {
        kind: 'ul',
        items: [
          'The in-app payment success record and your payment channel statement are **proof of payment**; they are not an invoice. If you need a document for expense reimbursement, request one as described above.',
          'The concrete invoicing arrangements (payee name types, the window in which an invoice can be issued, electronic or paper form) follow what we tell you in our reply. **We do not pre-commit to those details in this document** — doing so would only create an external text that may not match the invoices we actually issue.',
        ],
      },
    ],
  },
  {
    id: 's8',
    title: 'Status of the cloud AI subscription: currently not offered',
    blocks: [
      {
        kind: 'p',
        text: '🔴 **The cloud AI subscription is not currently offered**, and this document does not present it as something you can buy. The line "Not currently offered" in the price table in section 2 means exactly that: **nobody can purchase it today**, and there is no price, quota or bill associated with it.',
      },
      {
        kind: 'ul',
        items: [
          'This supply mode is **not switched on** in our system: there is no service configuration that routes requests to the cloud, and a pre-enablement check **actively refuses** rather than permits — the reason it currently gives is that the data retention policy is undecided.',
          'Our rule is: **we do not sell metered services before we can meter them accurately.** Otherwise we would be taking money without delivering, or taking money while being unable to tell you what you actually consumed.',
        ],
      },
      {
        kind: 'p',
        text: 'Why an undecided retention policy means we cannot sell it: cloud AI **must** see your content in order to work, and "how long that content stays on our side, in what form, and how it is then removed" is precisely what the retention policy has to answer. Putting it on the checkout before that question is answered would mean selling you a processing arrangement whose boundaries we cannot describe.',
      },
      {
        kind: 'docRef',
        docId: 'ai-and-transfer',
        text: 'AI Features and Cross-border Data statement: how on-device AI differs from hosted AI, which content is handed to whom, how cross-border authorisation is granted, and where each AI feature is switched on or off.',
      },
      {
        kind: 'callout',
        text: 'An important boundary: **hosted sync promises that we relay ciphertext only, whereas cloud AI must see plaintext.** These are therefore **two separate sets of terms**, applied independently and never read as one — and we **will not describe heyta\'s cloud AI as end-to-end encrypted**. If we ever decide to offer the cloud AI subscription, we will **publish the terms that apply to it separately and notify you in advance**, 🔴 and those new terms will **not reach back into a service period you have already paid for**.',
      },
    ],
  },
  {
    id: 's10',
    title: 'The EU GDPR view: what the billing side keeps, and how far it can be deleted',
    blocks: [
      {
        kind: 'p',
        text: 'The GDPR question on the billing side is not "did we get your consent", it is **how far the rows we keep in order to take your money can be deleted**. Every cell below is written against the actual table structure: `payment_events` and `checkout_orders` are the two tables that really exist, the wording matches their columns, and nothing that is not in those tables is claimed.',
      },
      {
        kind: 'table',
        head: ['Where in the GDPR', 'What it asks', 'What heyta can produce', 'What does not line up'],
        rows: [
          [
            'Article 5(1)(c) (data minimisation)',
            'Whether what is stored to take payment is limited to what is necessary',
            '`payment_events` keeps the provider event id and a **digest** of the payload (`payloadDigest`), not the raw message the provider sent; `checkout_orders` holds only the order number, price, currency, region, amounts and status - no card-style payment credential',
            'Every row is still tied to your account through `user_id`, and the digest can be traced back by the provider; the invoice **name of payee and tax number** you email us live in the mail system, which is **not** within the deletion scope of these two tables'
          ],
          [
            'Article 17, points 17(3)(b) and 17(3)(e) (legal obligation, legal claims)',
            'Whether payment records can be deleted on request',
            'While the contract runs the entitlement records have to stay, otherwise "how far did you actually buy" has no checkable answer',
            'Those rows do **not** vanish at the moment of a refund: accounting and tax retention is set by legal obligation, and this document deliberately states no number of years - the invoicing practice itself is still undecided (section five), so writing a figure now would create text that disagrees with what we actually do'
          ],
          [
            'Article 7(3) (withdrawal as easy as giving)',
            'Whether stopping the processing is as short a path as starting it',
            'There is no automatic charge anywhere: an entitlement simply ends, so there is no "cancel the subscription first" step standing in the way',
            'Stopping the processing on the hosted-sync side means **closing the account**, not flipping a switch; this document therefore does not say "withdraw any time, and it is erased immediately" - that claim does not hold within the backup and authorisation boundaries'
          ],
          [
            'Article 22 (solely automated decisions)',
            'Whether a decision with a significant effect on you is made by machine alone',
            'Entitlement is a mechanical union across sources (paid time, invite rewards, manual grants all count, and a later reward row cannot overwrite paid time), with no "the machine decides you are not entitled" path',
            'It does decide whether a paid feature is available, which is why the rules are written out earlier in this document instead of left as a black box; pricing driven by user profiling would make this row stop lining up, and since no such thing exists today this document reserves no wording for it'
          ],
        ],
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: 'Data rights document: how far each kind of data actually goes after an account is closed, and where the backup boundary sits, is in that GDPR comparison table; this document covers only the records kept to take payment.',
      },
    ],
  },
  {
    id: 's9',
    title: 'Disputes, contact, and version history',
    blocks: [
      {
        kind: 'p',
        text: 'The entity providing this service and taking payment is **晓黎（杭州）人工智能科技有限公司**; Unified Social Credit Code `91330106MAKNJ6DX7M`; registered address 浙江省杭州市西湖区蒋村街道文一西路 830 号蒋村商务中心 3 号楼 210 室; contact email `heyta@waytofuture.cn`. Please send anything about price, charging, expiry, refunds or invoices to that address.',
      },
      {
        kind: 'ul',
        items: [
          'If you dispute a refund amount or how a term was calculated: contact the address above first, with your order number and the figure you believe is correct. We verify the payment and usage records and reply with the outcome — we will not ask you to accept a conclusion we have not explained.',
          'This document applies together with the Terms of Service. Where the two disagree about the price, term, expiry consequences or refunds of a paid service, **the more specific provision in this document prevails**.',
          '🔴 App filing number: **not filled in** in this version — the number has not yet been approved. Once it is approved we will issue a new version recording it; 🔴 **we will not put a number here that does not exist yet**.',
        ],
      },
      {
        kind: 'table',
        head: ['Version', 'Date', 'Note'],
        rows: [
          ['1.0', '2026-10-01', 'First drafted; legal review not yet performed'],
          [
            '1.1',
            '2026-10-04',
            'Added section ten: the GDPR side of "the rows we keep in order to take payment", written against the real columns of `payment_events` and `checkout_orders` (minimisation, legal retention, how short the withdrawal path is, solely automated decisions - four cells). It also states the two things that cannot be promised: a refund does not make those rows vanish on the spot, and the invoice name of payee and tax number you email us are outside the deletion scope of these two tables. The article-by-article rights table stays in the Data rights document only; this section points at it instead of copying it.',
          ],
        ],
      },
    ],
  },
] as const;

export const subscriptionAndRefund: LegalDocument = {
  id: 'subscription-refund',
  // 🔴 1.0 → 1.1：新增第十节（GDPR 一侧"为了收款而留下的记录"）。
  // 加的是**承诺的边界**（退款不即时删、邮件里的抬头与税号不在这两张表的范围内），
  // 不是措辞打磨，所以必须换版本号：同意留痕要能回答"他同意的那一版里有没有这一段"。
  version: '1.1',
  status: 'draft',
  updatedDate: '2026-10-04',
  title: {
    'zh-CN': '订阅、计费与退款规则',
    en: 'Subscription, Billing and Refund Rules',
  },
  summary: {
    'zh-CN':
      '托管同步与云端 AI 两件**互相独立**的收费服务各自怎么计价、怎么到期、怎么退、怎么开票 —— 包括一条刻意的不做：我们没有任何自动扣款。',
    en:
      'How two **independent** paid services — hosted sync and cloud AI — are priced, how they end, how they are refunded and invoiced, including one deliberate absence: we never charge you without your confirmation.',
  },
  sections: { 'zh-CN': zh, en },
};
