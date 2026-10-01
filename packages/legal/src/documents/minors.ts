/**
 * 未成年人保护（专门个人信息处理规则）
 * =====================================
 *
 * 法定出处：《个人信息保护法》第 28 条（不满十四周岁未成年人的个人信息**是**敏感个人信息，
 * 属法条明文列举）与第 31 条（处理不满十四周岁未成年人个人信息应取得父母或其他监护人同意，
 * 并**制定专门的个人信息处理规则** —— 本文件就是那份专门规则）；
 * 《未成年人网络保护条例》（国务院令第 766 号，2024-01-01 施行）第 31–36、42–44 条；
 * 《网络数据安全管理条例》第 21 条第 3 款（重复"专门规则"义务）。
 * 条文逐字核对与口径见 `docs/research/legal-pipl-baseline.md` §6 与 §1.5。
 *
 * 🔴 **本文件的两条写法纪律，来自同一份调研里两个容易被写歪的地方：**
 *
 * 1. **不许写"我们会验证年龄"。** 事实是我们不核验、也没有核验能力（注册只需要一个邮箱，
 *    全库只有一个直接标识符，见 `docs/research/legal-dataflow-server.md` A1 结论）。
 *    §6.3 的原话是这句要"写成『我们不会主动核实年龄』以免构成对家长的误导"。
 * 2. **不许笼统写"我们完全符合《未成年人网络保护条例》"。** 正确写法是逐条判适用 / 不适用，
 *    并说清**为什么不适用**（判断依据是产品形态：无信息发布、无站内消息、无社交与协作、
 *    无直播与音视频、无 UGC 分发、无排行榜；见 §6.3 第 4 项那条"变化触发器"与
 *    `docs/plans/motivation-and-progression.md` 的 P5 设计红线"只与自己比"）。
 *    §36 那条"访问未成年人个人信息须审批并记录"在后台侧**尚未落地为独立审计日志**
 *    （ADR-0038 明确不做 RBAC），所以那是本文件里的一处**承认**，不是宣称。
 *
 * 三处需要产品负责人或法务拍板、本文按最保守写法处理的点：
 * ① 未成年人模式（条例第 43 条）目前判定为不适用，但 2026-09-18 的征求意见稿正在把范围
 *    往"不满十六周岁强制切换"方向收紧，其适用范围**未逐条核实** ⇒ 文本里写成"目前"，
 *    并写进"什么时候会变"；② 面向未成年人的 AI 功能默认关闭这条建议出自【推理】，
 *    《生成式人工智能服务管理暂行办法》相关条款**未逐字核实** ⇒ 本文件只写"AI 默认关闭、
 *    监护人可以让它保持关闭"，不写"法律要求我们对未成年人默认关闭 AI"；
 * ③ 注册流程里目前没有年龄自述勾选（它是 §6.3 列的**待办**，不是现状）⇒ 文本不许写
 *    "注册时我们会请你声明年龄"。
 */

import type { LegalDocument } from '../types.js';

const zh = [
  {
    id: 's1',
    title: '这份文件写给谁',
    blocks: [
      {
        kind: 'p',
        text: 'heyta 是一款面向成年人的效率工具：任务、清单、习惯、番茄钟、日历。它没有为任何年龄群体设计过内容，不面向儿童，也没有任何把你的任务、备注等内容展示给其他用户的场所 —— 没有动态流，没有评论区，没有协作看板，没有排行榜。需要说清的一个例外是：跨账号可见的只剩下一条账号级的关系记录 —— 使用邀请功能时，被邀请人邮箱的可识别部分会出现在邀请人那侧的记录里（第四节有完整表格）。那是关系凭证，不是内容。',
      },
      {
        kind: 'p',
        text: '这份文件回答三个问题：**我们怎么知道使用者是不是未成年人**；如果确实有未成年人在用，法律要求我们做到什么；监护人可以替孩子做哪些事、通过什么渠道做。它同时是《个人信息保护法》第 31 条要求的那份**专门处理规则**。',
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: '监护人能主张的权利，与每个用户能主张的权利是同一套 —— 各项权利具体怎么行使、答复时限、以及哪些只能走邮件，见《个人权利行使与请求响应》。',
      },
      {
        kind: 'callout',
        text: '一句放在最前面的坦白：**我们不核验年龄。** 这份文件里关于年龄的边界，全部依赖使用者或其监护人的如实声明与承诺。任何"我们会验证你的年龄"的说法都不成立 —— 我们宁可把这句写在这里，也不愿意用一句做不到的话让家长放心。',
      },
    ],
  },
  {
    id: 's2',
    title: '关于年龄核验：我们做什么、不做什么',
    blocks: [
      {
        kind: 'p',
        text: '为什么不核验，理由要说清，因为它不是疏忽：heyta 注册只需要一个邮箱地址。没有姓名、没有电话、没有证件、没有人脸，也没有任何身份要素 —— 我们的数据库里只有这一个直接标识符。要核验年龄，就必须先收集比现在多得多的个人信息，那与"数据最小化"直接冲突。**我们选择的不是"更安全"，而是"更少收集"，于是把年龄这条边界交给了声明。**',
      },
      {
        kind: 'callout',
        text: '这条选择有一个必须承认的后果：如果一位成年人替孩子注册并使用了 heyta，我们在技术上分辨不出来。因此监护责任的一部分是**由监护人在设备上完成配置与把关**，包括把与年龄有关的功能开关保持在他认为合适的状态。',
      },
      {
        kind: 'ul',
        items: [
          '我们**不做**年龄核验：没有身份认证、没有证件上传、没有人脸识别，也不向任何第三方购买年龄或身份数据。',
          '注册流程里目前**没有**强制的年龄声明勾选步骤；本文件对你的是承诺与请求渠道，不是一项我们已经执行的自动拦截。',
          '我们**不投放广告，也不做使用统计**：截至本版本（1.0，2026-10-01），三端依赖清单里没有分析、埋点、广告或崩溃上报组件 —— 这是一句可以拿去证伪的话，不是修辞。所以"向未成年人定向推送广告"这个问题在产品结构上并不存在。',
          '我们**不做**未成年人模式，理由与这条判断的不确定性都写在第五、第八节。',
        ],
      },
    ],
  },
  {
    id: 's3',
    title: '如果使用者不满十四周岁',
    blocks: [
      {
        kind: 'p',
        text: '按《个人信息保护法》第 28 条，不满十四周岁未成年人的个人信息属于**敏感个人信息** —— 这是法条明文列举的类别，不是我们的判断。第 31 条接着要求两件事：处理它应当取得**父母或其他监护人的同意**，并且应当**制定专门的个人信息处理规则**。前者需要你的声明与确认，后者就是这份文件。',
      },
      {
        kind: 'ul',
        items: [
          '未满十四周岁者不应在没有监护人同意的情况下使用本应用；监护人同意后，建议在监护人指导下使用。',
          '监护人可以随时撤回同意，并要求删除孩子的账号与数据 —— 渠道是第七节的邮箱，时限是**收到请求后 15 个工作日内**。',
          '涉及付费的，监护人可以请求退订与退款（见第六节）。',
          '如果我们在收到的请求中发现确有未成年人在无监护人同意的情况下使用了服务，我们会按第七节的流程处理该账号，并书面说明结果。',
        ],
      },
      {
        kind: 'docRef',
        docId: 'terms',
        text: '使用资格与账号条款在《用户协议》里；本文件只在"与年龄有关"这一点上对它作补充和优先适用 —— 就未成年人而言，以本文件为准。',
      },
    ],
  },
  {
    id: 's4',
    title: '未成年人的数据在 heyta 里实际是什么样',
    blocks: [
      {
        kind: 'p',
        text: '内容面：任务、备注、习惯、专注记录以明文存在于**你自己的设备上**；开启同步时，服务器只收到加密后的事件，我们**不持有解密所需的口令**，因此读不到明文，也无从人工查看。"孩子的日记我们看不见"这句话在产品架构上是成立的 —— 但它的成立范围只到这里。',
      },
      {
        kind: 'p',
        text: '"读不到内容"**不等于**"没有处理任何个人信息"。下面这几类信息在平台侧确实存在，无论使用者是谁、几岁。把这张表写全，才算把第五节的适用性判断讲明白。',
      },
      {
        kind: 'table',
        head: ['仍然存在的部分', '具体是什么'],
        rows: [
          ['账号标识', '注册邮箱（唯一的直接标识符）、登录令牌、通行密钥的公钥与其名称等元数据'],
          ['同步协议元数据', '每台设备的随机标识 `clientId`、事件的顺序号与时间戳、事件条数与字节长度 —— 内容是密文，但这些结构信息是明文'],
          ['设备信息', '设备记录里的设备名称、应用版本、最近在线时间'],
          ['接入与运维日志', '服务器与接入层（反向代理）的运行日志，其中必然包含 IP 地址、客户端标识（User-Agent）与接入时间。业务数据库里没有 IP 地址列，我们不把访问日志写进业务库；但日志本身按法定要求留存**不少于六个月**（《网络安全法》第二十三条第（三）项，2025 修正版序号）'],
          ['在线状态', '开启同步后，Web 端会在你的浏览器里注册 Service Worker 并建立实时同步连接，两者都是持久连接 —— 服务器因此能看到"该账号此刻在线"这一事实。我们没有把它做成任何功能，但它是架构的副产品，写出来比略过去诚实'],
          ['计费数据', '订单、订阅，以及开具发票与满足税务要求所必需的信息'],
          ['邀请关系', '如果使用"邀请好友得会员"，会生成一条跨账号的关系记录，其中包含被邀请人邮箱的可识别部分，并作为通知内容长期保存'],
        ],
      },
    ],
  },
  {
    id: 's5',
    title: '《未成年人网络保护条例》逐条：适用还是不适用，以及为什么',
    blocks: [
      {
        kind: 'p',
        text: '一句"我们完全符合"帮不了任何人。下面逐条给出判断，判断依据是产品的**真实形态**：没有信息发布、没有站内私信、没有社交与协作、没有直播与音视频、没有用户生成内容的分发、没有排行榜 —— 数据只在你自己的设备和你自己选择（或我们运营）的那台服务器之间流动。',
      },
      {
        kind: 'table',
        head: ['条例里的义务', '对 heyta 是否适用', '为什么'],
        rows: [
          [
            '第 31 条：提供信息发布、即时通讯等服务时，应要求未成年人或其监护人提供真实身份信息',
            '不适用',
            'heyta 不提供信息发布，也没有站内私信：任务内容不向任何其他用户展示。唯一一处跨账号可见的信息是邀请记录里对方邮箱的可识别部分，而那不是用户发布的内容。如果将来加入共享清单、协作或评论，这一条立刻适用，本文件要重写。',
          ],
          [
            '第 43 条：设置未成年人模式，在使用时段、时长、功能和内容方面按规定提供服务',
            '目前不适用',
            '现行强制适用挂在网络游戏、直播、音视频、社交等易沉迷服务上，效率工具不在其列。但这条边界正在收紧：2026-09-18 公开的《国务院关于保障未成年人健康安全使用网络的规定（征求意见稿）》提出了"不满十六周岁应当按照规定切换至未成年人模式"的思路，征求意见期至 2026-10-17，**尚未施行**，其适用范围是否覆盖效率工具我们尚未逐条核实。因此这里写"目前"，并把改动条件写在第八节。',
          ],
          [
            '第 32 条：不得强制同意非必要的个人信息处理，不得因不同意或撤回同意而拒绝基本功能',
            '适用，且已满足',
            '所有与隐私相关的开关出厂状态都是关闭：AI 出境、记忆与偏好、推送、本机接口，每一项都要你逐项打开。任务的新建、修改、完成、查看与导出不依赖任何需要同意的功能。',
          ],
          [
            '第 42 条：不得向未成年人提供诱导其沉迷的产品和服务',
            '适用，且是我们的设计红线',
            'heyta 不发行任何货币或积分，不做排行榜、联赛、段位、组队打卡；成长与统计只与自己的过去比较（在端到端加密下，跨用户比较平台也算不出来）。这一条不是被审查后补的，而是产品规则里写死的。',
          ],
          [
            '第 35 条：发生或可能发生未成年人个人信息泄露、篡改、丢失时，立即启动应急预案并告知受影响者及其监护人',
            '适用',
            '我们会启动应急处置，并按本文件第七节的邮箱渠道告知受影响的账号与其监护人。同步内容即使被整体泄露也是密文，但账号标识与元数据不是 —— 所以这条义务的触发范围按后者写。',
          ],
          [
            '第 36 条：对工作人员以最小授权为原则，访问未成年人个人信息应经审批并记录',
            '部分适用，且有一处我们尚未做到',
            '我们的运营后台按字段白名单工作：看不到同步内容明文（服务器只有密文），口令散列、任何登录令牌、推送端点都被排除在后台响应之外；能看到的只有账号级字段（邮箱、订单与金额、设备清单、条数）。**需要如实说明的部分**：后台不区分角色，也**还没有**针对未成年人账号的独立访问审批与访问日志。我们把这句写在文件里作为承认与待办，而不是宣称符合。',
          ],
        ],
      },
      {
        kind: 'p',
        text: '最后一条不属于条例但直接相关：《网络数据安全管理条例》第 21 条第 3 款同样要求"制定专门的个人信息处理规则"。本节把话说完 —— 这份文件就是那份规则，它会随产品形态变化而实质改版。',
      },
    ],
  },
  {
    id: 's6',
    title: '付费：监护人的退订与退款',
    blocks: [
      {
        kind: 'p',
        text: '《未成年人网络保护条例》第 44 条不允许向未成年人提供与其民事行为能力不符的付费服务。我们的实现方式不是设一道支付前的人脸核验（那会引入第五节说的那类收集），而是把渠道给监护人：**未成年人自行购买的订阅，监护人可以请求退订与退款。**',
      },
      {
        kind: 'ul',
        items: [
          '把请求发到 `heyta@waytofuture.cn`，主题写明"未成年人退款"，从付款时使用的账号邮箱发出。',
          '请附上订单号或订阅截图、购买发生的大致时间，以及一句话说明你与账号使用人的关系。',
          '我们在**收到请求后 15 个工作日内**核查并答复。已经消耗掉的服务时长如何处理，按《订阅与退款》的规则执行。',
          '通过应用商店完成的购买，商店自身也有各自的退款与未成年人购买处理机制；走商店那条路时，我们仍会配合商店的核实要求。',
        ],
      },
      {
        kind: 'docRef',
        docId: 'subscription-refund',
        text: '退订、退款与按比例退还的具体计算规则在《订阅与退款》里；本节只说明监护人可以主张这件事，以及通过哪个渠道主张。',
      },
    ],
  },
  {
    id: 's7',
    title: '监护人行使权利的渠道与时限',
    blocks: [
      {
        kind: 'p',
        text: '受理渠道只有一个邮箱：`heyta@waytofuture.cn`。我们没有电话号码、没有在线客服、没有实体受理点，所以这里不列那三种方式 —— 写一条没人接的热线比不写更糟。',
      },
      {
        kind: 'table',
        head: ['你想替孩子做的事', '怎么做', '时限'],
        rows: [
          ['查阅、复制其数据', '与孩子一起在设备上使用导出功能（明文只有使用者一侧能解开，我们读不到内容，因此无法代为导出）', '即时，自助完成'],
          ['更正、补充其数据', '在设备上直接修改；改完经同步到达其他设备', '即时，自助完成'],
          ['删除某条数据或注销整个账号', '邮箱申请；注销是服务端级联硬删除，做完不可恢复，所以请先导出', '收到请求后 15 个工作日内'],
          ['撤回同意、停止某项处理', '在设置的对应开关上关闭（AI 出境、记忆与偏好、推送、本机接口）', '即时'],
          ['退订与退款、投诉与举报、要求解释说明', '邮箱申请', '收到请求后 15 个工作日内'],
        ],
      },
      {
        kind: 'p',
        text: '两点核验上的坦白：① 我们只接受来自该账号邮箱、或经我们核实的监护人请求，必要时会要求你补充可说明关系的材料；② 因为端到端加密，涉及**具体任务内容**的操作我们既无法代为完成、也无法代为判断对错 —— 这类请求会引导回设备端完成，而不是被当成拒绝。我们拒绝任何请求时会书面说明理由。',
      },
      {
        kind: 'docRef',
        docId: 'ai-and-transfer',
        text: '给监护人的一条具体提醒：heyta 的 AI 功能默认全部关闭，你可以让它一直保持关闭。一旦开启并授权出境，发出去的是任务标题与备注的**原文**，没有任何脱敏或摘要环节 —— 这是未成年人使用场景下最需要知道的一件事，逐项字段清单见《AI 功能与数据流向》。',
      },
    ],
  },
  {
    id: 's8',
    title: '这份文件什么时候会变',
    blocks: [
      {
        kind: 'p',
        text: '本文件里有几处"目前"，它们各自绑着一个明确的触发条件。任一条发生，这份专门规则就会实质改版并提升版本号 —— 版本号不是装饰，它写进同意记录，用来回答"当时同意的是哪一版"。',
      },
      {
        kind: 'ul',
        items: [
          '**加入共享清单、协作、评论或任何社区功能**：产品形态即落入"网络社区类"，条例第 31 条的真实身份信息核验会落到我们头上，第五节第一条随之改写，并可能需要手机号。这条被登记为产品决策护栏，而不是可以顺手加的功能。',
          '**上面提到的征求意见稿正式施行**，且适用范围覆盖效率工具：未成年人模式与使用时段、时长限制需要落地，第五节第二条的"目前不适用"要删掉。',
          '**上架任何应用商店，或面向未成年人投放任何内容**：按该商店的年龄分级与该地区的监护人同意要求补充声明；如果将来加入年龄自述或核验步骤，第二节那条"注册时没有年龄声明步骤"要跟着改。',
        ],
      },
      {
        kind: 'table',
        head: ['版本', '日期', '变化'],
        rows: [
          ['1.0', '2026-10-01', '首版草案（尚未生效）：作为《个人信息保护法》第 31 条要求的专门处理规则发布；明确不核验年龄；条例义务逐条判适用性，其中第 36 条如实登记一处未落地。'],
        ],
      },
    ],
  },
] as const;

const en = [
  {
    id: 's1',
    title: 'Who this document is for',
    blocks: [
      {
        kind: 'p',
        text: 'heyta is an adult-oriented productivity app: tasks, lists, habits, a pomodoro timer, a calendar. It was not designed for any age group, it is not aimed at children, and there is nowhere in it where your tasks, notes or other content are displayed to another user — no feed, no comments, no shared boards, no leaderboards. The exception that has to be stated: one cross-account record remains, an account-level relationship — if the invite feature is used, the identifiable part of the invited person\'s email address appears in a record on the inviter\'s side (section four carries the full table). That is a relationship receipt, not content.',
      },
      {
        kind: 'p',
        text: 'This document answers three questions: **how we would know whether a user is a minor**; what the law requires of us if a minor is in fact using the app; and what a guardian may do for a child, through which channel. It is also the **dedicated processing rules** that Article 31 of the Personal Information Protection Law requires.',
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: 'The rights a guardian can assert are the same set every user has — how each right is exercised in practice, the response window, and which requests are email-only, is in Exercising Your Rights.',
      },
      {
        kind: 'callout',
        text: 'A confession placed at the very front: **we do not verify age.** Every age boundary in this document rests on the honest declaration of the user or their guardian. No sentence of the form "we will verify your age" is true here — and we would rather say so plainly than let parents rely on something we cannot do.',
      },
    ],
  },
  {
    id: 's2',
    title: 'On age verification: what we do and what we do not do',
    blocks: [
      {
        kind: 'p',
        text: 'The reason is stated because it is a deliberate trade-off rather than an oversight: registering for heyta requires one email address and nothing else — no name, no phone number, no identity document, no face scan, no identity attribute of any kind. Our database holds exactly one direct identifier. Verifying age would require collecting far more personal information than we collect today, which conflicts head-on with data minimisation. **We chose "collect less" rather than "verify more", and handed the age boundary over to declarations.**',
      },
      {
        kind: 'callout',
        text: 'That choice has a consequence we have to own: if an adult registers and configures heyta on a child\'s behalf, we cannot tell the difference technically. Part of guardianship here is therefore **the guardian doing the setup and the gatekeeping on the device**, including leaving age-relevant switches wherever they judge appropriate.',
      },
      {
        kind: 'ul',
        items: [
          'We **do not** verify age: no identity authentication, no document upload, no facial recognition, and we buy no age or identity data from any third party.',
          'There is currently **no** mandatory age declaration step in the registration flow; what this document offers is commitments and a request channel, not an automated barrier we already run.',
          'We **do not run advertising**, so "targeted ads toward minors" does not exist as a question in this product\'s structure (heyta contains no analytics, telemetry, advertising, or crash-reporting component).',
          'We **do not** provide a minors\' mode; the reasoning and the uncertainty behind that judgement are in sections five and eight.',
        ],
      },
    ],
  },
  {
    id: 's3',
    title: 'If the user is under fourteen',
    blocks: [
      {
        kind: 'p',
        text: 'Under Article 28 of the Personal Information Protection Law, the personal information of a minor under fourteen **is sensitive personal information** — that is an expressly enumerated statutory category, not our own assessment. Article 31 then requires two things: consent from a **parent or other guardian**, and the adoption of **dedicated processing rules**. The first needs your declaration; the second is this document.',
      },
      {
        kind: 'ul',
        items: [
          'Someone under fourteen should not use the app without a guardian\'s consent; with consent, use is best accompanied by guardianship.',
          'A guardian may withdraw consent at any time and ask for the child\'s account and data to be deleted — the channel is the mailbox in section seven, and the window is **within 15 working days of receiving the request**.',
          'Where payment is involved, a guardian may request cancellation and refund (see section six).',
          'If a request we receive establishes that a minor used the service without guardian consent, we handle that account through the process in section seven and report the outcome in writing.',
        ],
      },
      {
        kind: 'docRef',
        docId: 'terms',
        text: 'Eligibility and account terms live in the Terms of Service; this document supplements and prevails over them on the single axis of age — for minors, this document governs.',
      },
    ],
  },
  {
    id: 's4',
    title: 'What a minor\'s data actually looks like inside heyta',
    blocks: [
      {
        kind: 'p',
        text: 'On the content side: tasks, notes, habits, and focus records exist in plaintext **on your own device**. When sync is enabled the server receives only encrypted events, and we **do not hold the passphrase**, so we cannot read plaintext and have no way to browse it manually. "We cannot see the child\'s diary" is a statement the architecture genuinely supports — but it supports it only that far.',
      },
      {
        kind: 'p',
        text: '"We cannot read the content" **does not equal** "we process no personal information". The categories below do exist on the platform side, whatever the user\'s age. Writing this table out in full is what makes the applicability judgements in section five meaningful.',
      },
      {
        kind: 'table',
        head: ['What still exists', 'What precisely it is'],
        rows: [
          ['Account identifiers', 'The registration email (the only direct identifier), login tokens, passkey public keys and metadata such as their names'],
          ['Sync protocol metadata', 'A random per-device identifier `clientId`, event sequence numbers and timestamps, event counts and byte lengths — the content is ciphertext, but this structure is plaintext'],
          ['Device information', 'Device name, app version and last-seen time held in the device records'],
          ['Access and operations logs', 'Runtime logs from the server and the access layer (the reverse proxy), which necessarily contain the IP address, the client identifier (User-Agent) and the time of access. The business database has no IP address column and we do not write access logs into it, but the logs themselves are kept for **no less than six months**, which is the statutory floor (Cybersecurity Law, Article 23(3), 2025 revised numbering)'],
          ['Online presence', 'Once sync is on, the web client registers a Service Worker in your browser and holds a realtime sync connection; both are persistent, so the server can observe the fact that "this account is online right now". We never made that into a feature, but it is a by-product of the architecture, and saying so is more honest than leaving it out'],
          ['Billing data', 'Orders, subscriptions, and whatever is required to issue an invoice and satisfy tax obligations'],
          ['Referral relationships', 'If "invite a friend" is used, a cross-account relationship record is created that contains the identifiable part of the invited person\'s email address and is retained permanently inside a notification'],
        ],
      },
    ],
  },
  {
    id: 's5',
    title: 'Article by article under the Minors Protection Regulations: applicable or not, and why',
    blocks: [
      {
        kind: 'p',
        text: 'A blanket "we fully comply" helps nobody. Each obligation below gets its own judgement, made against the **actual shape** of the product: no publishing, no private in-app messaging, no social features or collaboration, no live streaming or audio-video, no distribution of user-generated content, no leaderboards — data flows only between your own devices and the one server you chose (or that we operate).',
      },
      {
        kind: 'table',
        head: ['The obligation', 'Applies to heyta?', 'Why'],
        rows: [
          [
            'Article 31: where the service provides information publishing or instant messaging, require the minor or their guardian to provide real identity information',
            'Not applicable',
            'heyta provides no publishing and no private messaging: task content is never displayed to any other user. The only cross-account visible item is the identifiable part of an email address inside a referral record, and that is not user-published content. Should shared lists, collaboration, or comments ever be added, this article applies immediately and this section is rewritten.',
          ],
          [
            'Article 43: provide a minors\' mode covering time slots, duration, features and content',
            'Not applicable at present',
            'The mandatory scope of this obligation currently sits with services prone to compulsive use — online games, live streaming, audio-video, social. A productivity tool is not among them. But this boundary is tightening: the draft provisions "of the State Council on Safeguarding the Healthy and Safe Use of Networks by Minors", published for comment on 2026-09-18 (comment period to 2026-10-17), propose mandatory switching to a minors\' mode for those under sixteen. It is **not in force**, and we have not verified line by line whether its scope reaches productivity tools. Hence "at present", with the change condition recorded in section eight.',
          ],
          [
            'Article 32: do not compel consent to non-essential processing, and do not refuse basic functionality because consent is withheld or withdrawn',
            'Applicable, and already met',
            'Every privacy-relevant switch ships off: AI egress, memory and preferences, push, the local interface — each must be opened by you individually. Creating, editing, completing, viewing and exporting tasks depends on nothing that requires consent.',
          ],
          [
            'Article 42: do not offer minors products or services designed to induce compulsive use',
            'Applicable, and one of our design red lines',
            'heyta issues no currency and no points, and has no leaderboard, league, tier promotion, or group check-in streaks; the growth and statistics views compare you only with your own past (under end-to-end encryption the platform could not compute a cross-user comparison anyway). This was fixed in the product rules, not patched in after a review.',
          ],
          [
            'Article 35: on a leak, tampering, or loss of minors\' personal information that has occurred or may occur, activate an emergency response at once and notify the affected minors and their guardians',
            'Applicable',
            'We activate incident response and notify the affected account and its guardian through the mailbox in section seven. A bulk leak of synced content would still be ciphertext, but account identifiers and metadata are not — so the trigger scope of this duty is written around the latter.',
          ],
          [
            'Article 36: apply least-authorisation to staff, and require approval and logging for access to minors\' personal information',
            'Partially applicable, and one point we do not yet meet',
            'Our operations console works from a field whitelist: it cannot see synced content in plaintext (the server stores only ciphertext), and password hashes, login tokens and push endpoints are excluded from its responses; what it can see is account-level fields — email, orders and amounts, device lists, record counts. **What we have to admit**: the console has no role separation, and there is no separate approval-and-access-log regime for minors\' accounts yet. That sentence is recorded here as an acknowledged gap, not as a claim of compliance.',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'One further obligation that is outside the Regulations but directly relevant: Article 21(3) of the Network Data Security Management Regulations likewise requires "dedicated personal information processing rules". This section closes the loop — this document is those rules, and it will change substantively when the product does.',
      },
    ],
  },
  {
    id: 's6',
    title: 'Payment: guardian cancellation and refunds',
    blocks: [
      {
        kind: 'p',
        text: 'Article 44 of the Minors Protection Regulations forbids offering minors paid services inconsistent with their capacity for civil acts. We do not implement that as a face check before payment (which would introduce exactly the collection described in section five); we implement it as a channel for guardians: **a subscription purchased by a minor can be cancelled and refunded at a guardian\'s request.**',
      },
      {
        kind: 'ul',
        items: [
          'Send the request to `heyta@waytofuture.cn`, subject line "minor refund", from the mailbox of the account that was charged.',
          'Include the order number or a screenshot of the subscription, the approximate time of purchase, and a sentence describing your relationship to the user.',
          'We verify and reply **within 15 working days of receiving the request**. How already-consumed service time is treated follows the rules in the Subscription and Refund terms.',
          'Purchases made through an app store have their own refund and minor-purchase mechanisms at the store; if you go that route we still cooperate with the store\'s verification requirements.',
        ],
      },
      {
        kind: 'docRef',
        docId: 'subscription-refund',
        text: 'The calculation behind cancellation, refund, and pro-rata return is in the Subscription and Refund terms; this section only states that a guardian may assert it, and through which channel.',
      },
    ],
  },
  {
    id: 's7',
    title: 'How a guardian exercises these rights, and by when',
    blocks: [
      {
        kind: 'p',
        text: 'There is one channel, a mailbox: `heyta@waytofuture.cn`. We have no telephone hotline, no live chat, and no physical service point, so none of those three appear here — a hotline nobody answers would be worse than none.',
      },
      {
        kind: 'table',
        head: ['What you want to do for the child', 'How', 'Timeframe'],
        rows: [
          ['Access and copy their data', 'Use the export function on the device, together with the child (only the user side can turn ciphertext back into plaintext, so we cannot export it for you)', 'Immediate, self-service'],
          ['Correct or supplement their data', 'Edit it on the device; the change reaches your other devices through sync', 'Immediate, self-service'],
          ['Delete particular records, or close the whole account', 'By email; closure is a cascading hard delete on the server and cannot be undone, so export first', 'Within 15 working days of receipt'],
          ['Withdraw consent, stop a processing activity', 'Switch it off in settings (AI egress, memory and preferences, push, the local interface)', 'Immediate'],
          ['Cancellation and refund, complaints and reports, a request to explain our rules', 'By email', 'Within 15 working days of receipt'],
        ],
      },
      {
        kind: 'p',
        text: 'Two admissions about verification: (i) we accept requests only from that account\'s mailbox, or from a guardian we have verified, and we may ask for material evidencing the relationship; (ii) because of end-to-end encryption, requests about **specific task content** are ones we can neither carry out nor judge — those are redirected to the device rather than refused. Where we do refuse a request, we state the reason in writing.',
      },
      {
        kind: 'docRef',
        docId: 'ai-and-transfer',
        text: 'One reminder addressed specifically to guardians: every AI feature in heyta is switched off by default, and you can leave them all off. Once a feature is enabled and authorised for egress, what is sent is the **original** text of task titles and notes, with no redaction or summarisation. This is the single most important thing to know when a minor uses the app; the field-by-field list is in AI Features and Where Your Data Goes.',
      },
    ],
  },
  {
    id: 's8',
    title: 'When this document changes',
    blocks: [
      {
        kind: 'p',
        text: 'Several of the "at present" statements above each carry an explicit trigger. When any one of them fires, these dedicated rules change substantively and the version number rises — the version number is not decoration; it is written into consent records so that we can answer "which version did they agree to".',
      },
      {
        kind: 'ul',
        items: [
          '**Shared lists, collaboration, comments, or any community feature is added**: the product then falls into the "online community" category, Article 31\'s real-identity requirement lands on us, the first row of section five is rewritten, and a phone number may become necessary. This is registered as a guard rail for product decisions, not a feature to add casually.',
          '**The draft provisions mentioned above enter into force** and their scope reaches productivity tools: a minors\' mode plus time-slot and duration limits must be implemented, and "not applicable at present" in the second row of section five is removed.',
          '**Listing the app in any store, or directing any content at minors**: declarations are added per that store\'s age rating and that region\'s guardian-consent requirements; if an age self-declaration or verification step is ever added, the sentence in section two about there being no age declaration step in registration changes with it.',
        ],
      },
      {
        kind: 'table',
        head: ['Version', 'Date', 'Change'],
        rows: [
          ['1.0', '2026-10-01', 'First draft (not yet in force): published as the dedicated processing rules required by Article 31; states that we do not verify age; assesses each article of the Regulations for applicability, and records one unmet point under Article 36.'],
        ],
      },
    ],
  },
] as const;

export const minors: LegalDocument = {
  id: 'minors',
  version: '1.0',
  status: 'draft',
  updatedDate: '2026-10-01',
  title: {
    'zh-CN': '未成年人保护',
    en: 'Protection of Minors',
  },
  summary: {
    'zh-CN':
      '面向成年人的效率工具如何处理未成年人：我们不核验年龄、依赖监护人声明；不满十四周岁信息的专门规则、条例义务逐条判定适用性，以及监护人的行使渠道与退款入口。',
    en:
      'How an adult-oriented productivity app handles minors: we do not verify age and rely on declarations; the dedicated processing rules for children under fourteen, article-by-article applicability under the Minors Protection Regulations, and the channels open to guardians.',
  },
  sections: { 'zh-CN': zh, en },
};
