/**
 * 订阅、计费与退款规则
 * =====================
 *
 * 这一份管的是**钱**：两件服务（托管同步、云端 AI 订阅）的价格、
 * 计费方式、到期后果、退款、发票，以及一件我们**故意不做**的事（自动续费）。
 *
 * 🔴 **两件服务在条款上各自成立，这条是本文件的地基**：各自的计价、保留、退款口径不同，
 * 一份的说法不许挪去给另一份撑场面，把它们写成一份条款会让"我买了同步是不是也买了 AI"
 * 变成一句要靠解释的话 —— 而解释在法律文本里就是争议的开始。所以第 1 条先摆一张对应表，
 * 并各自 `docRef` 到真正的条款文件。
 *
 * ⚠️ 但**"各自成立"不等于"价目表能任意组合"**，这句必须一起写：今天只有两个条目 ——
 * ¥5 只给托管同步，¥12 同时给托管同步**与**云端 AI。云端 AI 没有单独定价，"只买 AI
 * 不买同步"这个组合在价目表里不存在。以前那句"买 AI 不等于买同步"因此在开档之后
 * 变成假话，已按现实改掉（第 1 条的表格与那句话本身）。
 *
 * ⚠️ **本文件刻意不写的三样东西，都是刻意的，不是漏了**：
 * ① **税率** —— 是否含税以支付页标示为准；本文件只给定价，不给含税结算口径；
 * ② **开票细节**（抬头类型、开票时限、电子或纸质）—— 口径未定之前先写出来，
 *    就是在制造一份和实际开票不一致的对外文本；
 * ③ **App 备案号** —— 尚未核准。第 9 条把它显式留白并说明核准之后怎么补，
 *    而不是先编一个数字。
 *
 * 🔴 **云端 AI 订阅自 2026-10-05 起提供**（裁决：
 * [ADR-0054](../../../docs/adr/0054-managed-ai-retention-and-selling-preconditions.md)，
 * 它**取代** ADR-0023 §5 那张最小清单的第 1–3 条）。本文件以前写的那套"不提供"
 * 的理由——保留策略未定、启用前检查主动拒绝、没有任何价格额度账单——**已经逐条不再成立**，
 * 留着它们就是对外说假话。
 *
 * ⚠️ 但**开档解除的是"不许卖"，不是"可以随便写"**。这一档在本文件里的每一条事实
 * 都要指得回一个真的东西：
 *   · 额度数字**只能抄** `docs/reference/pricing-and-entitlements.md` §2.1 那个
 *     `ai-quota-ssot` 块（由 `pnpm check:ai-quota` 对账），**不许在这里新造数字**；
 *   · 保留那一段的**每一样留存项都必须在表里真的存在**（那张表只有四列，没有正文列、
 *     也没有功能名／结果状态／字节数），多写一样就是关于不存在的数据的承诺；
 *   · "到期删除"必须带着它那半个条件（超过 45 天**且**该计费周期已结束），
 *     无条件句在这一档上讲不出真话；
 *   · 🔴 **一条一个字都没软化**：云端 AI **不受端到端加密**保护，而它绝不与
 *     "同步是端到端加密"混成一份条款（ADR-0005 / ADR-0006）。
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
        text: 'heyta 有**两件收费的服务**：① **托管同步服务** —— 我们的服务器在你各设备之间中转并保管同步数据；② **云端 AI 订阅** —— 由我们代你使用云端大模型的用量。⚠️ 先把一条现实说清：**价目表今天只有两个条目** —— ¥5 那一档只买托管同步，¥12 那一档同时买托管同步**与**云端 AI；云端 AI **没有单独定价**，"只买 AI、不买同步"这个组合不存在。但两件服务在**条款上各自成立**：各自的额度、保留与退款口径不同，互不挪用，一份的承诺不许拿来给另一份背书。',
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
            '由我们替你调用云端大模型的用量。**这一档现在提供**：¥12 / 一个计费周期、含 300 次请求，完整说明见第 8 条。⚠️ 价目表里**没有"只买 AI、不买同步"的条目** —— 能买到 AI 的那一档同时授予托管同步，所以这一档的 ¥12 里已经包含了上面那 ¥5 所买的东西。',
            '本文件（第 8 条）+《AI 功能与数据流向》（哪些内容交给谁处理、在什么条件下离开这台设备、授权怎么给）',
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
        text: '《AI 功能与数据流向》：AI 功能把哪些内容交给谁处理、什么条件下会离开你的设备，以及云端 AI 与本机 AI 的区别。',
      },
      {
        kind: 'callout',
        text: '一句话：**买同步不等于买 AI。**¥5 那一档里没有云端 AI。反过来今天要说明白：能买到云端 AI 的那一档**同时含托管同步**，因为价目表里只有两个条目。两件服务在**条款上**各自成立（价格、保留、退款各有各的口径，互不挪用），但同一笔付款覆盖同一个 30 天服务期 —— 那一笔到期时，它授予的两项一起停；退掉的也**是同一笔付款里未使用的天数**。',
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
          ['云端 AI 订阅', '¥12 / 一个计费周期（30 天，见第 3 条；该档同时含托管同步）', '$12 / 一个计费周期（同上）', '⚠️ 是否含税**以支付页标示为准**'],
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
          [
            '云端 AI（如果你买的那一档含它）',
            '⏸ 停止：那一期的请求会被拒绝并说明原因，额度不自动补。🔴 你自己配置端点的那条 AI 路**不受任何影响** —— 它本来就不经过我们的服务器，也不限次',
          ],
          ['出路', '① 续费；② 改用你自己的服务器，同步立即恢复、数据无损；③ AI 改用你自己配置的端点（免费、不限次、功能不减）'],
        ],
      },
      {
        kind: 'callout',
        text: '我们不把数据当作人质：未按期续费的后果**仅限于停止你付的那一档所托管的那部分服务**（托管同步；如果你买的那一档含云端 AI，也含它）—— 你的数据、应用本体与自备端点的 AI 都不在其中。heyta 是本地优先的应用，你的数据先落在你自己的设备上，服务器只是一条通道 —— 通道停了，东西还在你手里。续费之后同步自动接上；你也可以把地址换成你自己搭的服务器，那条路同样**数据无损**。',
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
          '支付后 **7 日内**提出，且**未实际使用你买的这一档所提供的服务**：**全额退款**。判断"用过没有"只看服务端本来就有的记录 —— 同步那一侧是有没有事件进出过，云端 AI 那一侧**只有第 8 条那个次数计数**（我们读不到内容，也不需要读）。',
          '支付 **7 日之后**提出：按**剩余未使用天数**的比例退款，已经使用的那部分服务期不予退款。',
          '服务期已届满之后提出：**不予退款** —— 那一期的服务已履行完毕。',
          '退款**按原支付路径退回**，我们在收到申请后 **7 个工作日**内处理。',
        ],
      },
      {
        kind: 'p',
        text: '三点边界，一次说清：① 本条对上表里的**两件服务都适用**，判断口径也是同一条：只按**那一期内你没有用掉的天数**算比例，**不回溯**你此前的历史支付。对云端 AI，"有没有用过"只看**那一期的用量计数**（第 8 条：服务端只知道次数，不知道内容）—— 所以这件事双方都能核对，也不需要任何人去读你发了什么；② 一次支付对应一个 30 天服务期，退款只计算该服务期内未使用的天数；③ 本条是我们对你的承诺，其中一部分**可能比我们负有的法定义务更宽** —— 你按本条主张即可，不需要自己去分辨哪一部分是法定义务、哪一部分是我们主动多给的。',
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
    title: '云端 AI 订阅：现在提供，价格、额度、保留各自是什么',
    blocks: [
      {
        kind: 'p',
        text: '🔴 **云端 AI 订阅现在提供**，第 2 条价格表里那一行不再是"暂未提供"：**¥12 买下一个计费周期，含 300 次云端 AI 请求**（海外那一档是 $12）。⚠️ 这 300 次**不按自然月重置** —— 一个计费周期就是**一次付款买下的那 30 天**，起点是支付成功的那一刻（与第 3 条同一条口径）；跨过边界就换到新的一期、从 0 起算，而边界取自你那一期的**到期时刻**，不是墙上时钟猜出来的"这个月"。用满之后当期的请求被**拒绝并说明原因**，而那一次**不计数** —— 超额的判定与计数写在同一条语句里，所以"先把请求转发出去、事后再发现超额"这个形状不存在。额度用尽**不会**产生任何自动扣费。',
      },
      {
        kind: 'ul',
        items: [
          '🔴 **正文不留存。**你发出去的原文与模型返回的内容，只在**一次代理调用的内存里**存在，调用返回即丢弃：不写日志（含请求日志与错误序列化）、不进 trace、不进崩溃上报、不进任何生成物。所以这一档没有"内容留多久"这个问题 —— 它从来没被写过盘。这件事的证据不是我们的措辞：判据往假上游与假请求里各放一枚标记串，然后断言这两枚串**既不在全部日志输出里，也不在库里任何一张表的任何一行里**。',
          '**服务端只记四列计数**：账号、计费周期、这一期用了几次、最后一次使用的时间。那张表按设计**只有这四列** —— 没有正文列、没有提示词列、没有模型输出列，也没有一个装得下内容的兜底列。"我们不保留 AI 的内容"这句话的证据因此是**这张表的列集合**（有一条判据把它钉成"多一列就红"），而不是我们的形容词。那张表里也**没有**功能名、结果状态、字节数这些列，这一段因此不为它们承诺任何保留期：写进这一段的每一样都必须在表里真的存在。',
          '**计数**保留多久：自最后一次使用起 **45 天**，🔴 而且**要等到它所属的那个计费周期结束**才删 —— 两个条件缺一个都不行，只按时间删会把还在生效的那一期的额度抹掉。⚠️ 所以我们写的是"**超过 45 天、且该期已结束**"这一条有条件的删除，不写"到期就自动清空"那种没有条件的句子。注销账号时，这些计数行随账号一起按数据库外键**级联删除**（见《个人信息收集清单》与《行使你的权利》）。',
        ],
      },
      {
        kind: 'p',
        text: '🔴 **这一档只接中国境内的模型供应商，而且那是一条判据、不是一句措辞。**"只用境内供应商"如果只写在文档里，它约束不了任何东西，所以它被拆成三件可以失败的事：**境内供应商的端点主机名逐条登记成一张白名单**（不在表里就不可用，加一行要写清"为什么算境内"）；**保存配置与真要发请求两个点各校验一次**；动手之前**再复算一次目的地**。上游地址与模型由**服务端配置**决定，客户端请求里换不了它 —— 否则等于把那张白名单交给请求体。端点不合格 ⇒ **响亮地拒绝**，一个字节都不转发。',
      },
      {
        kind: 'p',
        text: '⚠️ **一句必须一起写的边界，免得这一节被读成"此刻就能用"。**收银台这一侧是开放的：价格、额度、计量、闸门、条款都已成立，下单不会被"这一档交付不了"挡回来。而"买完马上就能发请求"还差两件我们核对得到的事：**运营方要在服务器上开通这一档并配上境内的模型上游**（没有那份配置时这条路径直接回"未配置"，一个字节都不转发），以及**客户端里还没有一个把内置 AI 接到这一档的开关**（今天你在 heyta 里用到的 AI，仍然只有你自己配了端点、逐项授权过的那几个）。这两件的现状与判据写在《AI 功能与数据流向》第五节。',
      },
      {
        kind: 'p',
        text: '🔴 一条**自我解除**的规矩，这里写成历史，免得被读成还在生效：我们原先立的是"**在能够准确计量用量之前，不出售按用量计费的服务**"。它约束的是"**承诺已经写下、交付还没有做**"那个状态 —— 违反它就是收钱不交付。2026-10-05 计量在服务端真的存在、并且真的拦截之后，那个前提消失了，于是这条规矩按**它自己的条款**解除（裁决见 ADR-0054，它**取代** ADR-0023 §5 那张最小清单里的第 1–3 条）。规矩本身没有拆：那一份"暂时交付不了"的清单仍留在收银台前面，只是今天它是空的 —— 下一档"已定价、但还交付不了"的服务要靠它。',
      },
      {
        kind: 'docRef',
        docId: 'ai-and-transfer',
        text: '《AI 功能与数据流向》：本机 AI 与云端 AI 的区别、哪些内容会交给谁处理、什么条件下离开这台设备、每一项 AI 功能的开关分别在哪里，以及这一档今天能不能被打开。',
      },
      {
        kind: 'callout',
        text: '一条重要的边界，**一个字都不软化**：托管同步的核心承诺是"我们只中转密文"，而**云端 AI 必须看到明文**。所以这是**两份独立的条款**，各自适用、不合并解释，我们也**永远不会把 heyta 的云端 AI 描述成端到端加密** —— 这条路径**不受端到端加密**保护，那是定义，不是我们可以改进的细节。你的内容因此会**离开这台设备、交给第三方处理**（那一家由我们选定，且必须是境内的）。任务同步走的是另一条通道，它仍然是端到端加密的：同步那一份加密承诺，不适用于这一条路径，也不许被用来给它背书。',
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
          [
            '1.2',
            '2026-10-05',
            '第八节整段改写：那一档**现在提供**了。旧版那句"因为数据保留策略还没定案、所以这一档不能卖"的前提被 ADR-0054 撤掉（它取代 ADR-0023 §5 最小清单的第 1–3 条），留着那一套句子就是对外说假话。新版写的是当前为真的事实：¥12 / 一个计费周期、300 次、正文不留存、服务端只有四列计数、计数"超过 45 天且该期已结束"才删、随账号级联删除、托管那一档只接境内模型供应商（白名单 + 两个校验点 + 发送前复算）。同时改掉四处连带失效的句子：第一节表格里那一行与它的说明、第二节价格表那一行的金额、第五节"因此不存在针对它的退款"（退款现在对两件服务都适用）、第四节到期后果表（新增云端 AI 那一行，并把"后果仅限停止托管同步"改成"仅限停止你买的那一档所托管的那部分"）。**一条一个字都没动**：云端 AI 不受端到端加密保护，而且它与同步两份条款不合并解释。版本号必须换：同意留痕要能回答"他同意的那一版里，云端 AI 是可买的还是不可买的"。',
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
        text: 'heyta charges for **two services**: ① **Hosted sync** — our server relays and holds the sync data between your devices; ② **Cloud AI subscription** — usage of a cloud large language model that we operate on your behalf. ⚠️ One fact about the catalogue comes first: **the price book has exactly two entries today** — ¥5 buys hosted sync alone, ¥12 buys hosted sync **and** cloud AI together. Cloud AI is **not priced separately**, and an "AI without sync" combination does not exist. The two services still hold **separate terms**: their quota, retention and refund rules differ, are never borrowed from one another, and a promise made in one is not used to vouch for the other.',
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
            'Usage of a cloud large language model that we call for you. **This tier is now offered**: ¥12 per billing period, including 300 requests; section 8 gives the full terms. ⚠️ The price book has **no entry for "AI without sync"** — the tier that grants cloud AI also grants hosted sync, so the ¥12 already contains what the ¥5 line buys.',
            'This document (section 8) plus AI Features and Where Your Data Goes (what content goes to whom, when it leaves this device, and how the authorisation is given)',
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
        text: 'AI Features and Where Your Data Goes: which content AI features hand to whom, under what conditions it leaves your device, and how hosted AI differs from on-device AI.',
      },
      {
        kind: 'callout',
        text: 'In one sentence: **buying sync does not buy AI** — the ¥5 tier contains no cloud AI. What has to be said the other way round today is that the tier which grants cloud AI **also includes hosted sync**, because the price book has exactly two entries. The two services stay **separate as terms** (each has its own price, retention and refund rule, and none of them is borrowed from the other), but one payment covers one 30-day term: when that payment runs out, everything it granted stops together, and a refund is calculated over the unused days of **that same payment**.',
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
          ['Cloud AI subscription', '¥12 per billing period (30 days, see section 3; this tier also includes hosted sync)', '$12 per billing period (same)', '⚠️ Whether tax is included **is stated on the payment page**'],
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
            'Cloud AI (if the tier you bought includes it)',
            '⏸ Stops: requests in that period are refused with the reason shown, and the quota is not topped up on its own. 🔴 The AI route where **you** supply the endpoint is **not affected at all** — it never passes through our server and is not metered',
          ],
          [
            'What you can do',
            '① renew; ② point sync at your own server — sync resumes immediately and no data is lost; ③ switch AI to an endpoint you configure yourself (free, unmetered, no feature removed)',
          ],
        ],
      },
      {
        kind: 'callout',
        text: 'We do not hold your data hostage: the only consequence of not renewing on time is **that the hosted part of the tier you paid for stops** (hosted sync, plus cloud AI if your tier includes it) — your data, the app itself and AI on your own endpoint are not among the things that stop. heyta is local-first — your data is written to your own device first, and the server is only a channel. When the channel stops, what you have is still in your hands. After you renew, sync reconnects on its own; you may equally switch the address to a server you run yourself, and that route is likewise **lossless**.',
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
          'Requested **within 7 days** of payment, where **the service your tier provides has not actually been used**: **full refund**. "Used or not" is read from records the server already holds — on the sync side, whether events passed through; on the cloud AI side, **only the request counter from section 8** (we cannot read the content, and do not need to).',
          'Requested **more than 7 days** after payment: refunded **pro rata by remaining unused days**; the part of the term you have used is not refundable.',
          'Requested after the term has already run out: **no refund** — that term has been performed in full.',
          'Refunds are returned **along the original payment route**, and we process them **within 7 working days** of receiving the request.',
        ],
      },
      {
        kind: 'p',
        text: 'Three boundaries, stated once: ① this section applies to **both services** in the table above, on one single test: the refund covers **the days of that term you did not use**, and it never **retroactively** re-opens your earlier payments. For cloud AI, "was it used" is read from **that period\'s usage counter** alone (section 8: our server knows the count, not the content) — so both sides can check it, and nobody has to read what you sent; ② one payment corresponds to one 30-day term, and a refund is calculated only over the unused days of that term; ③ this section is our commitment to you, and part of it **may be more generous than our legal obligations** — you can simply rely on this section, without having to work out for yourself which parts are owed by law and which we give voluntarily.',
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
    title: 'Cloud AI subscription: now offered — price, quota and retention',
    blocks: [
      {
        kind: 'p',
        text: '🔴 **The cloud AI subscription is now offered**, and the line in the section 2 price table no longer says "not currently offered": **¥12 buys one billing period containing 300 cloud AI requests** (the overseas entry is $12). ⚠️ Those 300 requests **do not reset on the first of a calendar month** — a billing period is exactly **the 30 days one payment buys**, counted from the moment payment succeeds (the same rule as section 3); cross that boundary and you start a new period from zero, and the boundary is taken from the **expiry moment of your period**, not from a calendar month guessed at by a wall clock. Once the quota is spent, further requests in that period are **refused with the reason shown**, and the refused attempt **is not counted** — the over-quota decision and the increment happen in one and the same statement, so the shape "forward it first, discover the overrun afterwards" cannot occur. Running out of quota **never** triggers an automatic charge.',
      },
      {
        kind: 'ul',
        items: [
          '🔴 **No content is retained.** The text you send and what the model returns exist **only in the memory of one proxy call** and are discarded when it returns: not written to logs (including request logs and error serialisation), not in a trace, not in a crash report, not in any generated artifact. So the question "how long is content kept on your side" has no answering step here — it was never written to disk. The evidence for this is not our wording: the check plants one marker string in the fake upstream response and another in the fake request, then asserts that neither appears **in any captured log output or in any row of any table in the database**.',
          '**The server records four columns of counters only**: your account, the billing period, how many requests that period used, and the time of the last use. By design that table **has exactly those four columns** — no content column, no prompt column, no completion column, and no catch-all column that could hold content. The evidence for "we do not keep your AI content" is therefore **the column set of that table** (one check fails the build the moment a column is added), not our adjectives. That table also has **no** feature-name, outcome-status or byte-size column, so this section promises no retention period for such items: everything named here has to exist in the table.',
          '**How long the counters stay**: **45 days** from the last time one was used, and 🔴 **only once the billing period it belongs to has also ended** — both conditions are required, because deleting on time alone would wipe the quota of a period that is still active. ⚠️ That is why we write "**more than 45 days, and the period ended**" as a conditional deletion, and not an unconditional "wiped when it expires". When you close your account these counter rows are removed by the database foreign-key **cascade**, together with the account (see Personal Information Collection Inventory and Exercising Your Rights).',
        ],
      },
      {
        kind: 'p',
        text: '🔴 **This tier only connects to model providers located in mainland China, and that is a check, not a wording.** "Domestic providers only" written into a document constrains nothing, so it is split into three things that can fail: **the host names of domestic providers are registered one by one in a whitelist** (anything not in the table is unavailable, and adding a row requires stating why it counts as domestic); **the address is validated twice, once when the configuration is saved and once when a request is actually about to be sent**; and the destination is **recomputed immediately before the action**. The upstream address and the model are fixed by **server-side configuration** and cannot be replaced by a client request — otherwise the whitelist would be handed to whoever sends the request. A non-qualifying endpoint ⇒ **a loud refusal**, not one byte forwarded.',
      },
      {
        kind: 'p',
        text: '⚠️ **A boundary that has to be written in the same breath, so this section is not read as "usable right now".** The checkout side is open: the price, the quota, the metering, the gates and these terms all exist, and an order is no longer bounced back with "this tier cannot be delivered yet". Two things we can verify are still missing before a purchase means a working request: **the operator has to switch this tier on and configure a domestic upstream on the server** (without that configuration the route answers "not configured" and forwards not one byte), and **the client has no switch yet that wires the built-in AI to this tier** (the AI you can use in heyta today is still only what you configured an endpoint for and authorised feature by feature). The current state of both is written in section five of AI Features and Where Your Data Goes.',
      },
      {
        kind: 'p',
        text: '🔴 One rule that **dissolves itself**, recorded here as history so nobody reads it as still in force: our previous rule was "**we do not sell a metered service before we can meter it accurately**". What it governed was the state "the promise is already written, the delivery is not" — breaking that state means taking money without delivering. On 2026-10-05 metering came to exist on the server and really does refuse requests, the premise disappeared, and the rule was released **by its own terms** (the decision is ADR-0054, which **supersedes** items 1-3 of the short checklist in ADR-0023 §5). The mechanism itself was not removed: that "not yet deliverable" list still stands in front of the checkout, it is just empty today — the next tier that is priced but cannot yet be delivered depends on it.',
      },
      {
        kind: 'docRef',
        docId: 'ai-and-transfer',
        text: 'AI Features and Where Your Data Goes: how on-device AI differs from hosted AI, which content is handed to whom, under what conditions it leaves this device, where each AI feature is switched on or off, and whether this tier can be turned on today.',
      },
      {
        kind: 'callout',
        text: 'The boundary that matters most, **not softened by one word**: **hosted sync promises that we relay ciphertext only, whereas cloud AI must see plaintext.** These are therefore **two separate sets of terms**, applied independently and never read as one — and we **will never describe heyta\'s cloud AI as end-to-end encrypted**: this route is **not protected by end-to-end encryption**, and that is a definition, not a detail we could improve. Your content therefore **leaves this device and is handed to a third party** for processing (we choose that provider, and it must be one located in mainland China). Task sync runs on a different channel and remains end-to-end encrypted: the encryption promise of that one does not extend to this route, and must never be borrowed to vouch for it.',
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
          [
            '1.2',
            '2026-10-05',
            'Section eight rewritten in full: the tier **is now offered**. The old premise - "the retention policy is undecided, so this tier cannot be sold" - was removed by ADR-0054, which supersedes items 1-3 of the checklist in ADR-0023 §5, so leaving those sentences in place would be an outward falsehood. The new text states only what is currently true: ¥12 per billing period, 300 requests, no content retained, four counter columns only, counters deleted after "more than 45 days and the period ended", the counters cascaded on account closure, and a domestic-only provider whitelist enforced at save, at enablement and again before sending. Four further sentences that went stale with it were fixed: the cloud AI row and its note in section one, the amount in the price table in section two, the "nothing to refund under it" claim in section five (refunds now cover both services), and the expiry table in section four (a cloud AI row was added, and "the only consequence is that hosted sync stops" became "the hosted part of the tier you paid for stops"). **One sentence was not softened by one word**: cloud AI is not protected by end-to-end encryption, and its terms are never merged with those of sync. The version had to change because consent records must answer whether the version a person agreed to said this tier could be bought or could not.',
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
  // 🔴 1.1 → 1.2（2026-10-05，ADR-0054 开档）：第八节从"这一档不提供"改成"这一档提供"，
  // 连带改掉价格、退款对象、到期后果四处。**这是对外承诺的实质**——旧版同意里那一档
  // 是"谁也买不到"，新版是"¥12 能买到、有 300 次额度、只留计数"，两版根本不是同一件事，
  // 所以必须换版本号；沿用 1.1 会让一份"买不到"的同意去覆盖一段"可以买"的条款。
  version: '1.2',
  status: 'draft',
  updatedDate: '2026-10-05',
  title: {
    'zh-CN': '订阅、计费与退款规则',
    en: 'Subscription, Billing and Refund Rules',
  },
  summary: {
    'zh-CN':
      '托管同步与云端 AI 两件**各有各的条款**的收费服务（今天能买到云端 AI 的那一档同时含托管同步）各自怎么计价、怎么到期、怎么退、怎么开票 —— 包括一条刻意的不做：我们没有任何自动扣款。',
    en:
      'How two paid services with **their own separate terms** — hosted sync and cloud AI, where the tier that grants cloud AI today also includes hosted sync — are priced, how they end, how they are refunded and invoiced, including one deliberate absence: we never charge you without your confirmation.',
  },
  sections: { 'zh-CN': zh, en },
};
