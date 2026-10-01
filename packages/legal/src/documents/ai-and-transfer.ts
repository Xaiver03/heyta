/**
 * AI 功能与数据流向
 * =================
 *
 * 法定出处：《个人信息保护法》第 23 条（向其他个人信息处理者提供 → 单独同意）、
 * 第 25、29、30 条（敏感个人信息的单独同意与必要性/影响告知）、第 38、39 条（跨境提供的
 * 条件与六项告知 + 单独同意），以及《促进和规范数据跨境流动规定》第七、八条的门槛。
 * 条文与门槛逐字核对见 `docs/research/legal-pipl-baseline.md` §1.2、§1.6、§7。
 *
 * 🔴 **本文件全部关于 AI 的事实只来自 `docs/research/legal-dataflow-ai-rights.md`**
 * （C19 闸门与默认值 / C20 出境 payload 逐字段 / C21 端点配置与校验 /
 *  C22 本机 API 与 MCP / C23 记忆偏好层）。三条禁令逐字重复一遍，因为它们是本文件
 * 唯一的"写了就要担责"的地方：
 *
 * 1. **禁止写"我们会先脱敏、匿名化或摘要后再发送"。** 代码里不存在任何这类环节：
 *    任务备注是整段正文照发，任务列表是 JSON 原文。这条路径有五个可查的调用点，一查就穿。
 * 2. **禁止写"heyta 云端 AI / 我们替你调用模型 / 我们可能使用自有 AI 服务"。**
 *    `managed` 供给在类型结构上不可达（出境路由配置里没有"模式"字段，目的地只能由端点地址推导），
 *    而且那个有意的断言会因"保留策略未定"直接失败。写了就是在描述一个不存在的功能。
 * 3. **禁止把云端 AI 与端到端加密写在同一句话里。** 模型必须读到明文才能工作 ——
 *    这是定义外的例外，不是可调和的细节。
 *
 * 两处必须如实降级的表述：
 * ① "受保护条目即使开启本机接口也读不出来" —— 协议层的投影实现完整，但两个真实宿主都把
 *    可读性判为真（产品里还没有这个概念），所以只能写"打开读取详情后，备注正文全文可读"。
 * ② "出境手续已完成 / 完全无需手续" —— 用户自配境外端点的定性在研究文档里是**推理**
 *    而非既有监管口径，本文件把它标为待确认，不下结论。
 */

import type { LegalDocument } from '../types.js';

const zh = [
  {
    id: 's1',
    title: '为什么这一份要单独存在',
    blocks: [
      {
        kind: 'p',
        text: 'heyta 的同步通道是端到端加密的：服务器只收到加密后的事件，不持有解密所需的口令，因此读不到你的任务标题与备注。很多文件到这一步就写成"你的数据全程加密" —— **在本产品里这句话对 AI 这条路径不成立**，所以我们把它拆出来单说。',
      },
      {
        kind: 'p',
        text: 'AI 功能的工作方式是：把你写下的某些内容交给一个语言模型，模型读懂了才能给出建议。**"读懂"和"加密到我们看不见"在定义上不能同时成立。** 这不是我们做得到或做不到的问题，而是两条路本身互斥。',
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: '《隐私政策》处理的是"我们如何处理你的信息"；本文件处理的是"你的信息如何离开你的设备、以及是谁让它离开的"。两份要一起读，任何一份单独读都会得出夸大的结论。',
      },
      {
        kind: 'callout',
        text: '一句总括，后面每一节都在支撑它：端到端加密保护的是"云端与第三方读不到你的内容"；而 AI 这条路径，是**你**在设置里逐项授权后，**你**把某几个字段的原文交给**你**指定的一个服务。这三个"你"缺一个，出境就不会发生。',
      },
    ],
  },
  {
    id: 's2',
    title: '默认不发生：四道闸门',
    blocks: [
      {
        kind: 'p',
        text: '"我们只在必要时处理你的信息"这类话无法核对。这里换成四道可以逐项检查的开关，它们出厂时**全部是关闭的**，而且判定方式是严格相等 —— 只有真的"开"才算开。',
      },
      {
        kind: 'table',
        head: ['闸门', '出厂默认', '关掉（也就是默认状态）时的实际行为'],
        rows: [
          ['AI 功能总开关', '关闭', '任何调用第一件事就是查它；不通过就返回"未配置"，候选端点一个都不解析，一次请求都不发'],
          ['允许使用远程端点', '关闭', '远程端点根本不进入候选列表 —— 不是"进去了再失败"，因此连授权询问都不会弹出'],
          ['逐功能的出境授权', '一条都没有', '只要目的地不是"不出境"又找不到这个功能与这个目的地的精确匹配授权，就当场拒绝；这道检查排在网络动作之前'],
          ['记忆与偏好', '关闭', '零推断、零偏好进入请求内容；连输入都不再被读取'],
          ['本机接口（与上面并列的另一条路）', '关闭，且每个工具单独默认关闭', '本机服务不接受任何调用；未授权的工具对外部程序完全不可见'],
        ],
      },
      {
        kind: 'p',
        text: '加固细节值得写出来，因为"默认关"是文案、而下面这些是可验证实现：本地存储里的值只认真正的"开"，被写成字符串、数字或缺失一律按关闭处理；本机服务的监听地址**永远**使用默认的本机回环值，从不从存储读回 —— 否则有人把存储改掉，服务就会悄悄暴露给整个局域网。',
      },
      {
        kind: 'callout',
        text: '**回退不会跨越你的授权边界。** 如果你首选的端点没有授权，或者本机端点失败、要回退到一个未授权的远程端点，我们直接停下来报错，**一个请求都不发**。换一个目的地重发不叫重试，那叫偷发。',
      },
    ],
  },
  {
    id: 's3',
    title: '出境的到底是什么：逐功能、逐字段',
    blocks: [
      {
        kind: 'p',
        text: '下表是**全部**出境面。它不是"主要字段清单"：每一个 AI 功能各自只喂这几列里的字段，全产品也只有这五个出站调用点，没有任何一处把整库数据、完整操作日志或导出文件塞进请求。',
      },
      {
        kind: 'table',
        head: ['功能', '出境的字段', '发出去的是什么', '上限'],
        rows: [
          ['一句话捕获', '`today`、`text`，可选 `preferences`', '你刚敲进去的那句话**原文**，加上这台设备的本地日期与星期', '输入超过 500 字符直接拒绝，不截断后发送'],
          ['拆解任务', '`title`、可选 `note`，可选 `preferences`', '任务标题原文，加上任务备注**整段正文**', '备注不截断；只有完全为空才不发送'],
          ['优先级建议', '`tasks`，可选 `preferences`', '至多 50 条任务的标识、标题、截止时间、优先级，按 JSON 原文', '50 条，且在构造请求之前就收窄'],
          ['估时', '`title`、可选 `note`、`history`，可选 `preferences`', '标题与备注原文；最近至多 20 条专注记录的"计划用时 / 实际用时"分钟数', '20 条；这些记录里没有时间戳、也没有任务标识'],
          ['工具选择', '`text`、`tools`', '你那句话的原文，加上这台设备上**已授权工具的名字、描述与参数结构**', '500 字符；纯规则能选中的场景一次都不出境'],
        ],
      },
      {
        kind: 'callout',
        text: '**没有"脱敏"这一步。** 发送前不存在任何脱敏、匿名化或摘要处理 —— 发出去的就是上面这些字段的原文，一字不改。真正在保护你的是"默认关闭 + 逐功能授权 + 目的地由你指定"这套闸门，而不是"我们帮你改掉几个字"。任何一份政策如果在这里写"已做匿名化处理"，那它就是假的。',
      },
      {
        kind: 'p',
        text: '同样重要的是**不出境**的清单：邮箱地址、账号标识、订阅与计费信息、设备指纹、口令、同步凭据、便签正文、整张习惯表、完整操作日志、任何整库导出 —— 这些都不在任何一条出境路径上。需要如实标注的一项：优先级建议会带上任务的标识符，它是你数据的一部分，但仍然是一个可关联的标识。',
      },
      {
        kind: 'docRef',
        docId: 'minors',
        text: '如果你把 heyta 交给未满十四周岁的孩子使用，出境内容里可能出现其个人信息 —— 这类情形的额外约束见《未成年人保护》。',
      },
    ],
  },
  {
    id: 's4',
    title: '发给谁：由你指定，我们不筛选也不中转',
    blocks: [
      {
        kind: 'p',
        text: '这一节回答"你的数据到了谁手里"。答案是：**由你在设置里填的那个地址**，而不是由我们选定的某家服务商。',
      },
      {
        kind: 'ul',
        items: [
          '出厂不预置任何目的地。内置的两个预设**都是本机的**（本机的 Ollama 与 LM Studio）；我们刻意不做云端预设 —— 内置某个云端预设就等于 heyta 在替你做"数据发到哪"的决定。',
          '请求由**你的设备直接**发往你填的那个地址。heyta 服务器不是这条链路的中转，也没有为它做过网关或代理。',
          '我们不做服务商白名单、不判断那个端点在哪个国家或地区、也不了解它的日志与保留策略 —— 该端点由你提供，我们无法审计。',
          '地址的校验发生在四个点：你在界面里保存时、候选端点被解析时、真正发出请求的那一刻、以及从本地存储读回配置时。远端地址必须是加密的 HTTPS，只有本机地址允许明文。',
          'API 密钥不进配置、不进存储、也不会发给 heyta：配置里只存一个引用（`keyRef`），真正使用的密钥从设备自身的安全存储取出，只作为请求头发给你自己配置的那个端点。地址里带用户名密码会被直接拒绝。',
        ],
      },
      {
        kind: 'p',
        text: '授权不继承：**换了目的地或改了端点地址，此前的出境授权中不再匹配的那些会被删除**，必须重新授权 —— 而改地址在当前界面里必须删掉重建，因此一定会再过一遍校验。',
      },
      {
        kind: 'callout',
        text: '所以这件事的法律定性是"**你自行向第三方提供**"，而不是"heyta 向第三方提供"。请把这句话当成实际操作指引：那个第三方会不会留存、留多久、给谁看、要不要跨境，都在你的选择范围内、不在我们的控制范围内。要行使针对它的权利，请直接找它的公开联系方式；我们无法代为删除已经发出去的内容。',
      },
    ],
  },
  {
    id: 's5',
    title: '由我们提供并计费的云端 AI：当前不可用',
    blocks: [
      {
        kind: 'p',
        text: 'heyta 里存在一条**没有实现、也无法靠配置打开**的路：由我们统一提供、统一计费、由我们选择模型的云端 AI。它不可达不是修辞：出境路由的配置里根本没有"服务模式"这个字段，目的地只能从端点地址推导，因此结构上永远推不出"heyta 云端"。同时，我们对这类服务的数据保留期还没有作出决定，而代码里有一道有意的检查会在保留期未定时直接失败 —— 它宁可报错，也不肯编一个听起来合理的保留期数字。',
      },
      {
        kind: 'callout',
        text: '**这项服务现在没有提供，也不在"关着的选项"里 —— 它是一个不存在的选项。** 本文件不会写"我们可能使用自有 AI 服务"来预留空间。你今天能在 heyta 里用到的 AI 功能，只有你自己配了端点、逐项授权过的那几个。',
      },
      {
        kind: 'p',
        text: '为什么这条界限必须写死：任何由平台侧提供、由平台挑选模型的 AI 服务，定义上必须能看到明文；它**永远不能**被描述成端到端加密。把两句话拼成"我们全程加密，还用 AI 帮你整理"是一种会在监管与用户两侧同时翻车的写法。我们的立场是：这类服务如果将来要做，必须先解决保留期、出境手续与单独同意三件事，届时本文件这一节要整段重写。',
      },
    ],
  },
  {
    id: 's6',
    title: '本机接口与 MCP：不出境，但确实有别的程序读得到你',
    blocks: [
      {
        kind: 'p',
        text: '这是与 AI 出境不同的一条路：把 heyta 接到**同一台设备上的其他程序**（MCP 客户端、自动化脚本）。它不会把数据送出网络，但确实让别的东西读得到你的任务，所以放在这里而不是藏在"第三方"里。',
      },
      {
        kind: 'table',
        head: ['工具', '它做什么', '打开之后那个程序能读到什么'],
        rows: [
          ['`list_tasks`', '列出任务', '任务标识、标题、截止时间、优先级、完成状态，一次最多 50 条，可反复翻页 —— **不含备注正文**'],
          ['`get_task`', '读取单条任务详情', '上面全部，**再加任务备注正文全文**'],
          ['`list_projects`', '列出清单', '清单标题与任务数量'],
          ['`create_task`', '新建任务', '不读数据；写入必须经操作日志'],
          ['`update_task`', '修改任务', '只改你显式给出的字段'],
          ['`complete_task`', '完成任务', '不读数据'],
        ],
      },
      {
        kind: 'ul',
        items: [
          '总开关默认关闭，而且**每个工具单独默认关闭** —— 未列出的工具视为未授权。',
          '服务只监听本机回环地址；配置成其他地址会被直接拒绝，`0.0.0.0` 与通配地址在拒绝之列。',
          '必须携带显式令牌，没有令牌就什么都做不了；令牌比较是定长的，避免被计时探测；令牌校验排在"这个工具存不存在"之前，所以没带令牌的程序连我们的工具清单都枚举不出来。',
          '未授权的工具对外部客户端**完全不可见** —— 不是"看得见但调不动"。',
          '写入不直接生效：外部程序只能产出一个待确认的意图，**由你确认后**才落库。',
        ],
      },
      {
        kind: 'callout',
        text: '**不要以为"加密条目"在本机接口前是读不出来的。** 协议层确实做了字段白名单投影，但这款产品目前还没有"受保护条目"这个概念，两个真实宿主都把"可读"判为真。结论很简单：你一旦打开 `get_task`，那台机器上的那个程序就能读到你的任务备注正文全文。只开 `list_tasks` 也不算安全 —— 标题加截止时间足以拼出一个人的日程。',
      },
      {
        kind: 'p',
        text: '两条路是**同一套目录**：本机接口的工具清单同时也是内置 AI 出境时使用的清单。你为"本机程序访问"打开的每一个工具，同时也扩大了 AI 请求里那份 `tools` 的内容。把这两件事写成互不相干的两节，就与代码不符了。另外，真正的本机服务监听只在命令行宿主里；浏览器网页无法监听端口，那里的开关是配置编辑面，而且两边不会自动同步。',
      },
    ],
  },
  {
    id: 's7',
    title: '记忆与偏好：它记得你什么，什么会跨设备走',
    blocks: [
      {
        kind: 'p',
        text: 'heyta 可以"记得你的习惯"：你估计用时与实际用时的偏差、你的高效时段、你偏好的任务粒度与标题风格。这个能力默认关闭，而且它与"用不用 AI"是**两个独立的同意**，不能合并成一个"AI 授权"。',
      },
      {
        kind: 'ul',
        items: [
          '关掉之后：推断层不再计算，连输入都不再被读取 —— 不留"算了但没显示"的中间态。',
          '推断结果**不写进数据库**：每次都从本地的操作日志重新算。存下来就会漂移，而一份漂移的用户画像比没有画像更糟。',
          '进入出境请求的形态：若干条中文自然语言的画像陈述（在字段清单里统一叫 `preferences`），不是原始记录集合。工具选择这一项默认**不附带任何偏好**。',
          '其中一条画像陈述会带上你标题的中文占比、表情符号占比与平均字数 —— 它是统计量、不是内容，但确实透露了你的语言与表达习惯。',
        ],
      },
      {
        kind: 'p',
        text: '唯一会跨设备走的一条要精确写：**你主动"抑制某个偏好"这个动作会写进操作日志，因此它会作为加密事件同步到服务器。** 它携带的只有一个偏好标识和"抑制"这个动作，**不含任务标题、不含任何正文**；那个偏好标识是一个封闭词表里的机器名（例如估时偏差、高效时段、粒度、标题风格）。所以"纠正会同步"是真的，但同步过去的是一个标识，不是一份画像内容。撤销一条纠正同样是一条记录，被抑制的偏好随即恢复。',
      },
      {
        kind: 'p',
        text: '给法务的一句提醒：这一节里的同意与第三节的出境授权是**两次不同的授权**。只关掉记忆不会阻止你的任务原文出境，只批准出境也不会让 heyta 记住你的偏好。',
      },
    ],
  },
  {
    id: 's8',
    title: '关于"数据出境"的定性：待确认',
    blocks: [
      {
        kind: 'p',
        text: '如果你把端点填成位于境外的服务，数据就会从**你的设备**直接出境。我们对 heyta 在这条链路里的角色有一个初步判断：既然目的地由你填写、我们不决定目的与方式、内容也不经过我们的服务器，那么这一出境行为不是你替我们做的、也不是我们替你做的。但这个判断在我们的内部结论里属于**推理**，不是既有的监管口径。',
      },
      {
        kind: 'ul',
        items: [
          '这个判断成立的第一个前提：架构上必须是设备直连。任何由 heyta 服务器代发的路径（省流量的服务端代理、统一鉴权网关、把密钥存在服务器上的配置同步）都会把它变成平台自己的出境行为 —— 我们目前一条都没有，也不会加。',
          '第二个前提：我们不从这条通道收费、也不承担服务义务。它写成"heyta 提供的接入能力"，服务本身由你选的第三方提供；合同、发票、客服边界都必须与这句话一致。',
          '第三个前提：每一次（或首次）出境都有可举证的确认记录，出境对象的名称与字段清单在界面上展示给你，不同意也完全不影响其他功能。',
        ],
      },
      {
        kind: 'callout',
        text: '因此本文件**不写**"我们已按数据出境相关规定完成评估、标准合同或认证"，也**不写**"完全不需要任何出境手续"。在定性经法务复核之前，我们只承诺这四件可核对的事：默认不发生、逐项授权、由你指定目的地、随时可停。',
      },
    ],
  },
  {
    id: 's9',
    title: '这份文件什么时候会变',
    blocks: [
      {
        kind: 'p',
        text: '三种触发，每一种都会让本文件实质改版（版本号要跟着升，因为同意记录里存的就是版本号）：新增或修改任何 AI 功能、提供云端 AI、以及把"受保护条目"做进产品。',
      },
      {
        kind: 'ul',
        items: [
          '**加任何一个新的出境字段**：第三节那张表必须先扩、再上线 —— 出境面必须在数据被写进请求之前收窄，披露不能虚报，也不能少报。',
          '**提供云端 AI**：第五节整段重写，并必须先落地保留策略、出境手续与单独同意；届时"端到端加密"与"云端 AI"必须写成两个功能面，不得并成一句。',
          '**把"受保护条目"做进产品**：第六节那条提示才允许从"警告"改成"承诺"。在此之前，任何"加密条目读不出来"的表述都不写。',
        ],
      },
      {
        kind: 'table',
        head: ['版本', '日期', '变化'],
        rows: [
          ['1.0', '2026-10-01', '首版草案（尚未生效）：逐字段出境表按实现写；明确不做脱敏；云端 AI 写作"当前不可用"；出境定性标为待法务复核。'],
        ],
      },
    ],
  },
] as const;

const en = [
  {
    id: 's1',
    title: 'Why this document exists on its own',
    blocks: [
      {
        kind: 'p',
        text: 'heyta syncs end-to-end encrypted: our servers receive only encrypted events, do not hold the passphrase, and therefore cannot read your task titles or notes. Many policies stop there and write "your data is encrypted throughout". **In this product that sentence does not hold for the AI path**, so we separate it out.',
      },
      {
        kind: 'p',
        text: 'An AI feature works by handing some of what you wrote to a language model, which has to read it in order to be useful. **"Being able to read it" and "encrypted so that nobody but you can read it" cannot both be true at once.** This is not a matter of our effort or good intentions; the two paths are mutually exclusive by definition.',
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: 'The Privacy Policy covers how we process your information; this document covers how your information leaves your device, and who caused it to leave. Read them together — either one alone invites an overstatement.',
      },
      {
        kind: 'callout',
        text: 'One sentence to hold on to, which every section below supports: end-to-end encryption protects your content from the cloud and from third parties; the AI path is **you**, after authorising it feature by feature in settings, handing the original text of certain fields to a service **you** specified. Remove any one of those "you"s and nothing leaves at all.',
      },
    ],
  },
  {
    id: 's2',
    title: 'By default nothing happens: four gates',
    blocks: [
      {
        kind: 'p',
        text: '"We process your information only where necessary" cannot be checked. What we have instead are four gates you can inspect one by one. Every one of them ships **switched off**, and the test each gate performs is a strict one — only a genuine "on" counts as on.',
      },
      {
        kind: 'table',
        head: ['The gate', 'Factory default', 'What actually happens while it is off (that is the default)'],
        rows: [
          ['AI master switch', 'Off', 'Every call checks it first; if it is off the call returns "not configured", no candidate endpoint is even resolved, and not one request is sent'],
          ['Allow remote endpoints', 'Off', 'Remote endpoints never enter the candidate list — not "in the list but failing", so no authorisation prompt is produced either'],
          ['Per-feature egress authorisation', 'No authorisations at all', 'Unless the destination is "nothing leaves" and an exact match for this feature and this destination is found, the call is refused on the spot; this check sits before the network action'],
          ['Memory and preferences', 'Off', 'No inference, no preference enters a request; even the input stops being read'],
          ['The local interface (a separate path, listed alongside the four)', 'Off, and every tool individually off', 'The local service accepts no call at all; unauthorised tools are entirely invisible to external programs'],
        ],
      },
      {
        kind: 'p',
        text: 'The hardening details are worth stating, because "off by default" is wording while these are implementation: values read back from local storage count as on only when they are genuinely true — a string, a number, or a missing field is treated as off. And the local service\'s bind address **always** uses the loopback default and is never read back from storage; otherwise one edited value would quietly expose the service to the whole local network.',
      },
      {
        kind: 'callout',
        text: '**A fallback never crosses your authorisation boundary.** If your preferred endpoint has no authorisation, or a local endpoint fails and the fallback would be an unauthorised remote endpoint, we stop and report the error — **not one request is sent**. Sending to a different destination instead is not a retry; it is sending behind your back.',
      },
    ],
  },
  {
    id: 's3',
    title: 'What actually leaves: feature by feature, field by field',
    blocks: [
      {
        kind: 'p',
        text: 'The table below is the **complete** egress surface. It is not a list of "the main fields": each AI feature feeds only the fields in its row, there are exactly five outbound call sites in the whole product, and nowhere is a full data export, the complete operation log, or a database dump put into a request.',
      },
      {
        kind: 'table',
        head: ['Feature', 'Fields that leave', 'What is actually sent', 'Cap'],
        rows: [
          ['One-line capture', '`today`, `text`, optionally `preferences`', 'The **original text** of the line you just typed, plus this device\'s local date and weekday', 'Input over 500 characters is refused outright, never truncated and sent'],
          ['Task breakdown', '`title`, optionally `note`, optionally `preferences`', 'The original task title, plus the **entire note body** of that task', 'Notes are not truncated; an entirely blank note is what is left out'],
          ['Prioritisation', '`tasks`, optionally `preferences`', 'Up to 50 tasks\' identifier, title, due date and priority, as JSON in the original', '50 items, narrowed before the request is even constructed'],
          ['Duration estimate', '`title`, optionally `note`, `history`, optionally `preferences`', 'The original title and note; up to the 20 most recent focus records as "planned / actual" minutes', '20 records; no timestamps and no task identifiers in them'],
          ['Tool selection', '`text`, `tools`', 'The original text of your line, plus **the names, descriptions and parameter structures of the tools authorised on this device**', '500 characters; where pure rules can pick the tool, nothing leaves at all'],
        ],
      },
      {
        kind: 'callout',
        text: '**There is no redaction step.** Before sending, nothing is anonymised, de-identified, summarised, or scrubbed — what goes out is the original text of the fields above, unchanged. What protects you is the set of gates — "off by default, authorised per feature, destination chosen by you" — not "we changed a few words for you". Any policy that wrote "data is anonymised before sending" here would simply be false.',
      },
      {
        kind: 'p',
        text: 'The list of what does **not** leave matters just as much: your email address, account identifier, subscription and billing data, device fingerprints, your passphrase, sync credentials, note bodies as an entity type, the whole habits table, the complete operation log, and any bulk export. One item has to be flagged honestly: prioritisation includes task identifiers. They are part of your data, but they are still linkable identifiers.',
      },
      {
        kind: 'docRef',
        docId: 'minors',
        text: 'If heyta is used by a child under fourteen, egress content may contain their personal information — the additional constraints are in the Protection of Minors document.',
      },
    ],
  },
  {
    id: 's4',
    title: 'Who receives it: the address you type; we neither filter nor relay',
    blocks: [
      {
        kind: 'p',
        text: 'This section answers "whose hands does my data land in". The answer is: **the address you enter in settings**, not a provider we selected.',
      },
      {
        kind: 'ul',
        items: [
          'No destination is preset at install. The two built-in presets are **both local** (a local Ollama and a local LM Studio); we deliberately ship no cloud preset — building one in would mean heyta was making the "where does your data go" decision for you.',
          'Requests go **directly from your device** to the address you typed. heyta servers are not a relay in this path, and no gateway or proxy for it has ever been built.',
          'We maintain no allowlist of providers, do not determine which country an endpoint sits in, and do not know its logging or retention — the endpoint is yours, and we cannot audit it.',
          'Address validation runs at four points: when you save it in the interface, when candidate endpoints are resolved, at the instant a request is actually sent, and when configuration is read back from local storage. Remote addresses must use HTTPS; only local addresses may use cleartext.',
          'API keys are not stored in the configuration, not persisted, and never sent to heyta: the configuration holds only a reference (`keyRef`), the key itself is taken from the device\'s own secure storage, and it is presented only in the request header to the endpoint you configured. A URL containing username or password is rejected outright.',
        ],
      },
      {
        kind: 'p',
        text: 'Authorisation is not inherited: **change the destination or the endpoint address and the previously granted egress authorisations that no longer match are deleted**, so you must authorise again. Changing an address currently means deleting the endpoint and adding a new one, so it always passes validation once more.',
      },
      {
        kind: 'callout',
        text: 'Legally, then, this is "**you providing information to a third party yourself**", not "heyta providing your information to a third party". Treat that as practical guidance: whether that third party retains the data, for how long, and who else sees it sits inside your choice and outside our control. To exercise rights against it, use its own published contact route; we cannot delete content that has already been sent to it on your behalf.',
      },
    ],
  },
  {
    id: 's5',
    title: 'Cloud AI operated and billed by us: currently unavailable',
    blocks: [
      {
        kind: 'p',
        text: 'There is a path in heyta that is **not implemented and cannot be switched on by configuration**: cloud AI provided and billed by us, with models chosen by us. Its unreachability is not rhetoric — the egress routing configuration has no "service mode" field at all, and destinations are derived solely from endpoint addresses, so "heyta cloud" can never be derived. At the same time we have not decided a data retention period for such a service, and a deliberate check in the code fails outright while retention is undecided: it prefers an error over inventing a plausible-sounding retention figure.',
      },
      {
        kind: 'callout',
        text: '**This service is not offered today, and it is not an option that happens to be switched off — it is an option that does not exist.** This document will not say "we may use our own AI service" to leave room. The only AI you can use in heyta today is what you configured yourself, endpoint by endpoint and feature by feature.',
      },
      {
        kind: 'p',
        text: 'Why this line must be held hard: any AI service provided by the platform, with models picked by the platform, must see plaintext by definition, and can **never** be described as end-to-end encrypted. Stitching the two into "we encrypt everything and also let AI tidy your notes" is the kind of sentence that fails both a regulator and a user. Our position: if such a service is ever built, retention, cross-border procedures, and separate consent must be settled first — and this section would then be rewritten in full.',
      },
    ],
  },
  {
    id: 's6',
    title: 'The local interface and MCP: no egress, but other programs can read you',
    blocks: [
      {
        kind: 'p',
        text: 'This is a different path from AI egress: connecting heyta to **other programs on the same device** (MCP clients, automation scripts). It does not send data over the network, but it does let other things read your tasks, so it belongs here rather than buried in a third-party list.',
      },
      {
        kind: 'table',
        head: ['Tool', 'What it does', 'What that program can read once you enable it'],
        rows: [
          ['`list_tasks`', 'List tasks', 'Task id, title, due date, priority, completion — 50 at a time, pageable — **without note bodies**'],
          ['`get_task`', 'Read one task in full', 'Everything above, **plus the complete note body of that task**'],
          ['`list_projects`', 'List projects', 'Project titles and task counts'],
          ['`create_task`', 'Create a task', 'Reads nothing; writes go through the operation log'],
          ['`update_task`', 'Update a task', 'Only the fields explicitly supplied'],
          ['`complete_task`', 'Complete a task', 'Reads nothing'],
        ],
      },
      {
        kind: 'ul',
        items: [
          'The master switch is off by default and **every tool is off by default individually** — a tool not listed is not granted.',
          'The service listens only on a loopback address; any other bind address is refused, including `0.0.0.0` and wildcard addresses.',
          'An explicit token is mandatory — without one nothing can be called at all. Token comparison is constant-length so it cannot be probed by timing, and it runs before "does this tool exist", so a caller without a token cannot even enumerate our tool list.',
          'Unauthorised tools are **entirely invisible** to an external client — not "visible but not callable".',
          'Writes do not take effect directly: an external program produces an intent awaiting confirmation, and it is persisted **only after you confirm it**.',
        ],
      },
      {
        kind: 'callout',
        text: '**Do not assume that "encrypted entries" are unreadable through the local interface.** The protocol layer really does project fields through a whitelist, but this product has no concept of a "protected entry" yet, and both real hosts currently evaluate readability as true. The consequence is simple: once you enable `get_task`, that program on that machine can read your task note bodies in full. Enabling only `list_tasks` is not the safe option either — titles plus due dates are enough to reconstruct somebody\'s schedule.',
      },
      {
        kind: 'p',
        text: 'The two paths **share one catalogue**: the tool list used by the local interface is also the list the built-in AI uses when it composes the `tools` field of an outbound request. Every tool you enable "so a local program can access heyta" simultaneously enlarges what that request discloses. Writing these as two unrelated sections would misdescribe the code. Separately: the actual listening service exists only in the command-line host — a browser page cannot listen on a port, so the switch in the web settings screen edits configuration only, and the two sides do not sync automatically.',
      },
    ],
  },
  {
    id: 's7',
    title: 'Memory and preferences: what it remembers, and what crosses devices',
    blocks: [
      {
        kind: 'p',
        text: 'heyta can "remember your habits": how far your time estimates drift from reality, when your productive window is, what task granularity and title style you prefer. This capability is off by default, and it is a **separate consent** from "whether AI is used" — the two must never be merged into a single "AI permission".',
      },
      {
        kind: 'ul',
        items: [
          'When switched off: nothing is inferred and even the input stops being read — there is no "computed but not displayed" intermediate state kept anywhere.',
          'Inferred results are **never written to the database**: they are recomputed each time from the local operation log. A stored profile drifts, and a drifted profile is worse than no profile.',
          'What enters an outbound request is a handful of natural-language statements about you (field name `preferences` as a whole), not a set of raw records. Tool selection carries **no preferences at all** by default.',
          'One of those statements carries the CJK share, emoji share and average length of your task titles — a statistic rather than content, but it does reveal your language and writing habits.',
        ],
      },
      {
        kind: 'p',
        text: 'The one thing that does travel across devices has to be stated precisely: **when you actively suppress a preference, that action is written to the operation log, so it syncs to the server as an encrypted event.** What it carries is one preference identifier and the action "suppress" — **no task titles, no body text of any kind** — and that identifier is a machine name from a closed vocabulary (time-estimate bias, productive window, lead time, granularity, title style). So "your correction syncs" is true, while what syncs is an identifier, not a profile. Reversing a suppression is likewise one record, and the preference then applies again.',
      },
      {
        kind: 'p',
        text: 'A note for anyone checking this against the law: the consent in this section and the egress authorisation in section three are **two different grants**. Turning memory off does not stop your task text from leaving; approving egress does not let heyta remember your preferences.',
      },
    ],
  },
  {
    id: 's8',
    title: 'The "cross-border data" characterisation: pending legal review',
    blocks: [
      {
        kind: 'p',
        text: 'If you enter an endpoint hosted outside mainland China, data leaves **from your device** directly. Our working view of heyta\'s role on that path is: since you type the destination, we decide neither the purpose nor the means, and the content does not pass through our servers, the export is not something you did on our behalf, nor something we did on yours. But in our own research this characterisation is recorded as **reasoning**, not as an established regulatory position.',
      },
      {
        kind: 'ul',
        items: [
          'The first premise holding that view up is architectural: it must be a direct device-to-endpoint connection. Any path where heyta\'s server sends the request for you (a proxy to save bandwidth, a gateway to centralise authentication, configuration sync that stores keys on our server) turns this into the platform\'s own export. We have none today and will not add one.',
          'The second premise: we take no fee and assume no service obligation on this channel. It is described as an access capability heyta provides, while the service itself is provided by the third party you chose — contracts, invoices, and support boundaries must all match that sentence.',
          'The third premise: every send (or the first, per feature) leaves an evidence-grade confirmation record, the recipient and the field list are shown to you in the interface, and refusing has no effect whatsoever on any other feature.',
        ],
      },
      {
        kind: 'callout',
        text: 'Accordingly, this document **does not say** "we have completed the required security assessment, standard contract, or certification for cross-border transfers", and it **does not say** "no such procedure is needed at all". Until the characterisation has been reviewed by counsel, we commit only to the four verifiable facts: nothing happens by default, authorisation is per feature, the destination is yours, and it can be stopped at any time.',
      },
    ],
  },
  {
    id: 's9',
    title: 'When this document changes',
    blocks: [
      {
        kind: 'p',
        text: 'Three triggers, each of which makes this document substantively new (and the version number must rise with it, because the version number is what your consent record stores): adding or changing an AI feature, offering cloud AI, and building "protected entries" into the product.',
      },
      {
        kind: 'ul',
        items: [
          '**Any new egress field**: the table in section three must be widened before the feature ships. The outbound surface has to be narrowed before data is written into the request, and disclosure may neither overstate nor understate.',
          '**Cloud AI being offered**: section five is rewritten end to end, and only after retention, cross-border procedures and separate consent exist. At that point "end-to-end encryption" and "cloud AI" must stay two separate feature descriptions and may never be merged into one sentence.',
          '**"Protected entries" becoming a product concept**: only then may the callout in section six change from a warning into a promise. Until then, no sentence claiming "encrypted entries cannot be read" is written.',
        ],
      },
      {
        kind: 'table',
        head: ['Version', 'Date', 'Change'],
        rows: [
          ['1.0', '2026-10-01', 'First draft (not yet in force): field-by-field egress table written from the implementation; redaction explicitly disclaimed; cloud AI described as currently unavailable; the cross-border characterisation marked as pending legal review.'],
        ],
      },
    ],
  },
] as const;

export const aiAndTransfer: LegalDocument = {
  id: 'ai-and-transfer',
  version: '1.0',
  status: 'draft',
  updatedDate: '2026-10-01',
  title: {
    'zh-CN': 'AI 功能与数据流向',
    en: 'AI Features and Where Your Data Goes',
  },
  summary: {
    'zh-CN':
      'AI 功能默认全部关闭；每个功能出境哪些字段、发出去的是原文而不是摘要、目的地由你自己填且 heyta 服务器不中转；由我们提供的云端 AI 当前不可用。',
    en:
      'AI features ship switched off; what each feature sends out field by field, as your original text rather than a redacted summary; the destination is the address you type, and heyta servers are not a relay. The cloud AI operated by us is currently unavailable.',
  },
  sections: { 'zh-CN': zh, en },
};
