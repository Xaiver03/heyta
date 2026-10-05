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
 *    `managed` 供给在生产出境路径上仍然不可达：`AiRoutingConfig` 里没有"模式"字段，
 *    目的地只能由端点地址推导，所以那条链路推不出 `heyta-cloud`（服务端那条代理路由要真的
 *    工作还得运营方配上境内上游）。⚠️ 2026-10-05 换过一次理由：那句"因为保留策略未定所以
 *    挡住"已经过期 —— ADR-0054 把保留期定案了，`assertEnableable` 里那条有意的检查
 *    从此不再触发。**禁令本身一条没松**，只是它现在只靠结构那条腿撑着；写了那句就是在
 *    描述一个用户打不开的功能。
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
          ['拆解任务', '`today`、`title`，可选 `note`，可选 `preferences`', '这台设备的本地日期与星期（用于把"下周三"这类说法算对），加上任务标题原文与任务备注**整段正文**', '备注不截断；只有完全为空才不发送'],
          ['优先级建议', '`today`、`tasks`，可选 `preferences`', '这台设备的本地日期与星期，加上至多 50 条任务的标识、标题、截止时间、优先级，按 JSON 原文', '50 条，且在构造请求之前就收窄'],
          ['估时', '`today`、`title`，可选 `note`、`history`，可选 `preferences`', '这台设备的本地日期与星期，加上标题与备注原文；最近至多 20 条专注记录的"计划用时 / 实际用时"分钟数', '20 条记录；记录本身里面没有时间戳、也没有任务标识'],
          ['工具选择', '`today`、`text`、`tools`', '这台设备的本地日期与星期，加上你那句话的原文，以及这台设备上**已授权工具的名字、描述与参数结构**', '500 字符；纯规则能选中的场景一次都不出境'],
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
    title: '由我们提供并计费的云端 AI：保留策略已定案，但这一档仍打不开',
    blocks: [
      {
        kind: 'p',
        text: 'heyta 里存在一条**由我们统一提供、统一计费、由我们挑选模型**的云端 AI 的路。这条路的**数据保留策略已于 2026-10-05 定案**（ADR-0054，"托管 AI 的数据保留策略与可售卖的前置顺序"），下面第二段写的就是定案内容 —— 它不再是"还没想清楚数据留多久，所以不许打开"。但它**今天仍然不是一个用户打得开的功能**，理由是一条可核对的结构事实：内置 AI 真正走的那份出境路由配置里没有"服务模式"这个字段，目的地只能从端点地址推导，因此那条链路推不出"heyta 云端"；而服务端那条代理路径要真的工作，还需要运营方先把境内上游配上 —— 没配的时候它一律回"未配置"，一个字节都不转发。',
      },
      {
        kind: 'p',
        text: '定案下来的保留规则有**三条**，每一条都被写成可失败的判据，而不是一句措辞：**（一）服务端不保留内容。** 承载用量的那张表按设计只有四列：账号、计费周期锚点、次数、更新时间 —— 没有提示词列、没有模型输出列，也没有一个装得下内容的兜底列。有一条判据断言它的列集合**等于**这四个，多一列就红；理由是本文件反复用的那一条 —— "不保留内容"这句话的证据必须是表形状，不是我们的形容词。**（二）请求体与返回体只在一次代理调用的内存里存在，调用返回即丢弃**：不写日志、不进 trace、不进崩溃上报，排障看的是元数据而不是内容。**（三）保留的运维元数据只有**时间、用户、功能名（封闭词表里的那一个）、结果状态、请求与响应的**字节数**（不是内容）、耗时；这一档的**保留期定为 45 天**，推导是一次计费周期 30 天加 15 天出账缓冲，为了让"上一期到底用了几次"可核对 —— ⚠️ **不是**因为某部法律要求 45 天。🔴 还有一句必须一起写、否则这段会被读成承诺：**"到期就删"这一步本轮没有落地**。这些元数据走的是运行日志那条通道，而运行日志目前没有轮转与到期删除机制，要等一条部署侧的作业把它配上。所以我们写"期限定为 45 天"，**不写**"45 天后会自动删除"。',
      },
      {
        kind: 'p',
        text: '与"发给谁"有关的一条定案也要写在这里，因为它与第四节讲的你自备端点**不是同一件事**：托管这一档的目的地不由客户端声明，而是由端点地址落在一份**境内供应商白名单**上推导出来的；主机名逐条登记，不在表里就不可用，保存配置与真要发请求**两个点各校验一次**，接了不合格的端点是响亮拒绝而不是静默降级。第四节那句"我们不做服务商白名单、也不判断那个端点在哪个国家"说的始终是你自己填的自备端点 —— 那里地址由你决定，我们无权替你判断，也无法审计。',
      },
      {
        kind: 'callout',
        text: '**这项服务现在没有提供，而且它不是一个"暂时关着"的选项** —— 今天的客户端里没有任何一个开关能把它打开，本文件也不会写"我们可能使用自有 AI 服务"来预留空间。你今天能在 heyta 里用到的 AI 功能，只有你自己配了端点、逐项授权过的那几个。',
      },
      {
        kind: 'p',
        text: '为什么这条界限必须写死：任何由平台侧提供、由平台挑选模型的 AI 服务，定义上必须能看到明文；它**永远不能**被描述成端到端加密。把两句话拼成"我们全程加密，还用 AI 帮你整理"是一种会在监管与用户两侧同时翻车的写法。这一节的改写**不等于**这条路已经开放：保留期那一件有了答案，另两件没有 —— 它面向用户时必须是**逐项、可撤销的单独同意**（不能随订阅默认生效），而第 8 节那一格关于境外端点的定性仍然**不下结论**。它真正开放的那一天，这一节还是得整段重写，而"端到端加密"与"云端 AI"必须写成两个功能面，不得并成一句。',
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
          // 🔴 W10 给目录加了四条 EVENT 工具 ⇒ 这张表**必须同时**加行：条款里那句
          // "未列出的工具视为未授权"把这行当成了授权面，少一行就是对着用户少说一项能读到什么。
          // 对账由 `pnpm check:legal-tools` 钉住（工具目录 ↔ 中英两张表三方集合相等）。
          ['`list_events`', '列出倒数日与纪念日', '标识、标题、锚点日期、下一次发生日、距今几天、种类、是否重复/农历/置顶，一次最多 50 条 —— **不含正文**（列表连可读条目的正文也不给）'],
          ['`get_event`', '读取单条倒数日详情', '上面全部，**再加这条倒数日的正文全文**（写了正文才有这一格）'],
          ['`create_event`', '新建倒数日', '不读数据；写入必须经操作日志'],
          ['`update_event`', '修改倒数日', '只改你显式给出的字段'],
          // 🔴 批次二把覆盖面从 4 个实体补到 9 个 ⇒ 这张表**必须同时**加行（下面 16 条）。
          // 条款里那句"未列出的工具视为未授权"把这张表变成了授权面：目录里有、表里没说，
          // 就是对着用户少说一项"打开之后别人读得到什么"。对账由 `pnpm check:legal-tools` 钉住
          // （目录 ↔ 中文表 ↔ 英文表：集合相等 + 中英**逐行同序**，行贴错对象也会红）。
          ['`list_habits`', '列出习惯', '习惯标识、名称、每天的目标数值、单位、达成口径（至少/至多/恰好）—— **不含打卡记录**'],
          ['`create_habit`', '新建习惯', '不读数据；写入必须经操作日志'],
          ['`list_checkins`', '列出打卡记录', '哪条习惯、哪一天、当天记录的数值，一次最多 50 条 —— **不含习惯名称**，但"哪天做了什么、数值多少"本身已经是一份行为记录'],
          ['`record_checkin`', '记录一次打卡', '不读数据；写入必须经操作日志'],
          ['`list_focuses`', '列出专注记录', '种类、关联的任务标识、计划时长、实际时长、是否完成、开始时刻，一次最多 50 条 —— **不含任务标题**，但加上时间戳就能看出一个人的作息'],
          ['`log_focus`', '记录一次专注', '不读数据；写入必须经操作日志'],
          ['`list_tags`', '列出标签', '标签标识与名称'],
          ['`create_tag`', '新建标签', '不读数据；写入必须经操作日志'],
          ['`set_task_tags`', '给任务设置标签', '不读数据；它按你显式给出的那一组**整组覆盖**该任务的标签（不是追加，没写进去的会被摘掉）'],
          ['`create_project`', '新建清单', '不读数据；写入必须经操作日志'],
          ['`list_notes`', '列出便签', '便签标识、所属清单、是否置顶到今天、最后修改时刻，一次最多 50 条 —— **不含正文**。便签没有标题，所以这一格出境的只有"什么时候动过"'],
          ['`get_note`', '读取单条便签', '上面全部，**再加这张便签的正文全文**'],
          ['`create_note`', '新建便签', '不读数据；写入必须经操作日志'],
          ['`update_note`', '修改便签', '整段替换那张便签的正文（不是追加）'],
          ['`list_reminders`', '列出提醒', '提醒标识、关联的任务标识、触发时刻、当前走到哪一步（还没到/已顺延/该响了/已响过/已忽略）—— **不含任务标题**'],
          ['`create_reminder`', '新建提醒', '不读数据；写入必须经操作日志'],
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
        text: '**不要以为"加密条目"在本机接口前是读不出来的。** 协议层确实做了字段白名单投影，但这款产品目前还没有"受保护条目"这个概念，两个真实宿主都把"可读"判为真。结论很简单：你一旦打开 `get_task`，那台机器上的那个程序就能读到你的任务备注正文全文。只开 `list_tasks` 也不算安全 —— 标题加截止时间足以拼出一个人的日程。🔴 倒数日那两条同理，而且**更窄不了**：`get_event` 给正文全文，而倒数日的标题往往本身就是内容（「妈妈的生日」加上那一天，不读正文也已经说出一件事）。',
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
    id: 's10',
    title: '欧盟 GDPR 口径：这一份讲的"出境"在 GDPR 里算哪一档',
    blocks: [
      {
        kind: 'p',
        text: '本文件的"数据出境"原本是按中国法写的：《个人信息保护法》第三十八条那一类规则问的是**个人信息离开中国境内**。GDPR 第五章问的是**另一件事** —— 个人数据离开欧洲经济区。两个词在中文里长得一样，判据、依据形式和举证责任都不同，所以这里**不把任一侧的结论抄到另一侧**：中国法侧的定性仍然是上面第 8 节那个"待确认"，而下面这一栏只回答 GDPR 侧此刻能拿出什么、拿不出什么。',
      },
      {
        kind: 'table',
        head: ['GDPR 的位置', '它问的是什么', 'heyta 现在拿得出的', '对不上的部分'],
        rows: [
          [
            '第 44–49 条（向第三国转移）',
            '个人数据离开欧洲经济区时，有没有一条被承认的传输依据',
            '今天**一次都不会发生**：托管路径按 ADR-0054 §5 只能接**境内白名单里**的供应商（保存与发送两个点各校验一次，不在表里就响亮拒绝），逐项出境授权默认关闭，所以没有数据在我们这一侧被送往境外',
            '我们**没有**标准合同条款、**没有**充分性决定可依赖、**也没有**约束性公司规则。如果用户在自建实例里填入境外端点，那次传输的依据由**用户自己**承担，本文件不代任何人写"已有依据"',
          ],
          [
            '第 9 条（特殊类别数据）',
            '有没有在处理健康、宗教信仰、性取向一类的敏感数据',
            '我们不识别内容类别，也不做任何"检测到敏感词就拦下"的过滤',
            '送出去的上下文来自用户自己写的任务与便签，里面可能就有第 9 条所指的内容；我们没有能力声称"发送前会被识别并拦下"，所以也不写这句',
          ],
          [
            '第 22 条（仅自动化决策）',
            '有没有对用户产生法律或显著影响的决定是只由机器作出的',
            '这一条对得上：AI 在类型上就产生不了写入，读操作直接执行、写操作只到提案，确认之后才成为一次 op',
            '但它成立的前提就是那道人工确认。任何"把建议直接落成写入"的改动都会让这一格立刻变成对不上，所以它不是一项一次性的资质，而是一条需要一直有人守着的判据',
          ],
          [
            '第 25、32 条（默认数据保护与安全性）',
            '默认设置是否隐私友好，措施是否与风险相称',
            '默认关闭、本机接口只监听回环、逐工具授权、端到端加密使服务端读不到明文、回退不得跨越隐私边界',
            '这些主张只有本仓库的代码与测试作为证据，**没有**第三方认证或审计报告；因此本节不写"已通过 GDPR 认证"这一类话',
          ],
        ],
      },
      {
        kind: 'ul',
        items: [
          '同意在 heyta 里是**逐功能**的（第 6(1)(a) 与第 7 条要的"特定、明确、可撤回"），不是一个总开关；关掉某一项，那一项就一个字节都不出站。',
          '自建部署时控制者（controller）是运行这个实例的人，GDPR 的对外义务随之在他那一侧；我们提供的是软件。',
          '逐条的权利行使怎么落地，写在《个人权利行使与请求响应》的 GDPR 对照表里，本文件**不重复那张表** —— 两处各抄一份一定会漂，而漂掉的那一份通常是话说得更满的那一份。',
        ],
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: '《个人权利行使与请求响应》：GDPR 逐条对照表在那里（含第 13/14、15、16、17、18、20、21/22、32/33 条各自"对不上的部分"）。本文件只讲 AI 与出境这一段，权利行使的具体做法以那份为准。',
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
          '**提供云端 AI**：第五节整段重写。它列的三件前置条件里，**保留期那一件已在 2026-10-05 定案并写进第五节**，另两件没有 —— 逐项可撤销的单独同意，以及第 8 节那一格仍然**不下结论**的定性；届时"端到端加密"与"云端 AI"必须写成两个功能面，不得并成一句。',
          '**把"受保护条目"做进产品**：第六节那条提示才允许从"警告"改成"承诺"。在此之前，任何"加密条目读不出来"的表述都不写。',
        ],
      },
      {
        kind: 'table',
        head: ['版本', '日期', '变化'],
        rows: [
          ['1.0', '2026-10-01', '首版草案（尚未生效）：逐字段出境表按实现写；明确不做脱敏；云端 AI 写作"当前不可用"；出境定性标为待法务复核。'],
          [
            '1.1',
            '2026-10-03',
            '第六节那张本机接口工具表加了四条倒数日工具（`list_events` / `get_event` / `create_event` / `update_event`），并写明倒数日标题往往本身就是内容。这份清单与产品内的工具目录逐一核对，产品新增工具时会同步更新这里。',
          ],
          [
            '1.2',
            '2026-10-04',
            '第六节那张表补齐**剩下的 16 条工具**（习惯 / 打卡 / 专注 / 标签 / 便签 / 清单 / 提醒）：目录已随 AI 覆盖面扩到 9 个实体 26 条，而条款只披露了 10 条。那句"未列出的工具视为未授权"把这张表变成了授权面，所以少一行就是对用户少说一项"打开之后别人读得到什么"。逐格取值按构建产物里的 `egressFields` 写，不写字段名以外的推测；`list_notes` 明确写明便签没有标题、列表出境的只有"什么时候动过"。',
          ],
          [
            '1.3',
            '2026-10-04',
            '新增第十节：GDPR 第五章（第 44–49 条）问的是"个人数据离开欧洲经济区"，与本文件的"数据出境离开中国境内"**不是同一个问题**，所以两侧结论不互抄。逐格写明拿得出与拿不出的：没有标准合同条款、没有可依赖的充分性决定、没有约束性公司规则；第 9 条不做内容识别也不过滤；第 22 条只在"确认"这道人工关口存在时成立；第 25/32 条只有本仓库的代码与测试作证据，没有第三方认证。权利行使那张逐条表不在这里复制，只用 docRef 指向《个人权利行使与请求响应》。',
          ],
          [
            '1.4',
            '2026-10-05',
            '第三节那张表的**拆解任务 / 优先级建议 / 估时**三行各加了 `today`，工具选择那行也补上 `today`：这三条链路此前不知道"今天是哪天"，用户说"下周三""14 号"时模型只能自己编（实测编错过四个半月），而唯一的修法是往提示词里注入这一行。它看起来不像用户数据，实际上是**这台设备的本地日期**，所以按"新增任何一个出境字段都要先扩表再上线"那条纪律，先改这张表。工具选择那行的 `today` 不是新增出境面，是**补一句漏写**：内置助手早就带这一项，而这张表把它漏掉了。',
          ],
          [
            '1.5',
            '2026-10-05',
            '第五节按 ADR-0054 改写：这类服务的**数据保留策略已经定案**，所以本节不再把"保留期还没决定"当成它不可用的理由（那道为此而写的有意的检查，在定案之后不再触发）。定案本身写在第五节第二段，逐条落到可核对的东西上：一张只装计数的表（证据是列集合，不是措辞）、请求与返回体只存在于一次代理调用的内存里、保留下来的运维元数据是一份封闭字段清单加一个有出处的期限，以及托管档的目的地由**境内白名单**推导而不是由客户端声明。两处刻意没写成更满的话：那一个期限**没有**配"到期会自动删除"（清理作业本轮未落地，它落地时本节要改），而第 8 节关于你自己配置的境外端点那一格**仍然不下结论** —— 本次定案不涉及它，本文件也不替它定性。第九节的触发清单同步改掉保留期这一件。开放与购买按 ADR-0054 §6 的顺序走，走到那一步本节还要整段重写。本行不复述那个数字与那份字段清单：它们只住在第五节，抄一份就是多一个会漂的副本。',
          ],
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
          ['Task breakdown', '`today`, `title`, optionally `note`, optionally `preferences`', 'This device\'s local date and weekday (so that wording like "next Wednesday" resolves against a real day), plus the original task title and the **entire note body** of that task', 'Notes are not truncated; an entirely blank note is what is left out'],
          ['Prioritisation', '`today`, `tasks`, optionally `preferences`', 'This device\'s local date and weekday, plus up to 50 tasks\' identifier, title, due date and priority, as JSON in the original', '50 items, narrowed before the request is even constructed'],
          ['Duration estimate', '`today`, `title`, optionally `note`, `history`, optionally `preferences`', 'This device\'s local date and weekday, plus the original title and note; up to the 20 most recent focus records as "planned / actual" minutes', '20 records; the records themselves carry no timestamps and no task identifiers'],
          ['Tool selection', '`today`, `text`, `tools`', 'This device\'s local date and weekday, plus the original text of your line, and **the names, descriptions and parameter structures of the tools authorised on this device**', '500 characters; where pure rules can pick the tool, nothing leaves at all'],
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
    title: 'Cloud AI operated and billed by us: the retention policy is settled, the tier is still not switchable on',
    blocks: [
      {
        kind: 'p',
        text: 'There is a path in heyta for cloud AI **provided and billed by us, with the model chosen by us**. The **data retention policy for that path was settled on 2026-10-05** (ADR-0054, the decision on managed-AI retention and the preconditions for selling it); the second paragraph below is what was settled, so the reason is no longer "we have not worked out how long data stays, so nobody may turn it on". It is **still not a feature a user can switch on**, and that rests on a checkable structural fact: the egress routing configuration the built-in AI actually uses has no "service mode" field at all, destinations are derived solely from endpoint addresses, and so "heyta cloud" can never be derived on that path. For the server-side proxy route to do anything at all, the operator must first point it at a domestic upstream; while that is unset it answers "not configured" and forwards nothing.',
      },
      {
        kind: 'p',
        text: 'The settled retention rules are **three**, and each is written as a check that can fail rather than as wording. **(1) The server keeps no content.** The table holding usage has exactly four columns by design — account, billing-period anchor, request count, last updated. There is no prompt column, no model-output column and no catch-all column able to hold content; a check asserts the column set **equals** those four and fails red if one is added, for the reason this document keeps using: the evidence for "no content is kept" has to be the shape of the table, not our adjective. **(2) Request and response bodies exist only in the memory of one proxied call and are dropped when it returns** — not written to logs, not put in a trace, not sent to crash reporting; troubleshooting reads metadata, never content. **(3) The operational metadata that is kept** is limited to time, user, feature name (one entry from a closed vocabulary), outcome, the **byte counts** of request and response (not their content) and duration, and **the retention period for it is set at 45 days**. The derivation is one 30-day billing period plus a 15-day reconciliation buffer, so that "how many did I actually use last period" can be checked against a bill — ⚠️ **not** because some law asks for 45 days. 🔴 One more sentence has to travel with that number or the paragraph reads as an undertaking: **the "delete it when the period ends" step is not implemented in this round**. Those fields go out over the application log channel, and the application log has neither rotation nor an expiry sweep today; a deployment-side job still has to be added. So we write "the period is set at 45 days" and we do **not** write "it is deleted automatically after 45 days".',
      },
      {
        kind: 'p',
        text: 'One settled point about "who receives it" belongs here too, because it is **not the same thing** as the endpoint you configure yourself (section four): on the managed tier the destination is not declared by the client, it is derived from an endpoint address matching a **whitelist of domestic providers** — host names registered one by one, anything off the list unavailable, checked twice (when the configuration is saved and again immediately before a request is actually sent), and an unqualified endpoint is refused loudly rather than silently downgraded. The sentence in section four, "we maintain no allowlist of providers and do not determine which country an endpoint sits in", is about **your** endpoint — you choose that address, we have no standing to judge it for you and no ability to audit it.',
      },
      {
        kind: 'callout',
        text: '**This service is not offered today, and it is not an option that happens to be switched off** — no switch anywhere in the shipped clients can turn it on, and this document will not say "we may use our own AI service" to leave room. The only AI you can use in heyta today is what you configured yourself, endpoint by endpoint and feature by feature.',
      },
      {
        kind: 'p',
        text: 'Why this line must be held hard: any AI service provided by the platform, with models picked by the platform, must see plaintext by definition, and can **never** be described as end-to-end encrypted. Stitching the two into "we encrypt everything and also let AI tidy your notes" is the kind of sentence that fails both a regulator and a user. Rewriting this section is **not** the same as opening the path: one of the three preconditions now has an answer, two do not — when this tier faces a user it must be a **per-feature, revocable, separate consent** (never something a subscription grants by default), and the characterisation in section 8 about an endpoint abroad still **stays open**. On the day it really does open, this section gets rewritten end to end again, and "end-to-end encryption" and "cloud AI" must stay two separate feature descriptions that are never merged into one sentence.',
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
          // The same four EVENT tools, in the same order as the Chinese table —
          // `pnpm check:legal-tools` asserts the two language tables carry identical name sets.
          ['`list_events`', 'List countdowns and anniversaries', 'Id, title, anchor date, next occurrence, days from today, kind, whether it repeats/is lunar/is pinned — 50 at a time, **without note bodies** (the list projection strips them even for readable entries)'],
          ['`get_event`', 'Read one countdown in full', 'Everything above, **plus the complete note body of that entry** (only when one was written)'],
          ['`create_event`', 'Create a countdown', 'Reads nothing; writes go through the operation log'],
          ['`update_event`', 'Update a countdown', 'Only the fields explicitly supplied'],
          // The same sixteen tools the second batch added (4 entities → 9), in the same order as
          // the Chinese table — `pnpm check:legal-tools` asserts set equality against the catalog
          // *and* row-by-row agreement between the two language tables.
          ['`list_habits`', 'List habits', 'Habit id, name, daily target value, unit, goal type (at least / at most / exactly) — **no check-in records**'],
          ['`create_habit`', 'Create a habit', 'Reads nothing; writes go through the operation log'],
          ['`list_checkins`', 'List check-ins', 'Which habit, which date, the value recorded that day — 50 at a time. **Without habit names**, but "what you did on which day, and how much" is itself a behavioural record'],
          ['`record_checkin`', 'Record a check-in', 'Reads nothing; writes go through the operation log'],
          ['`list_focuses`', 'List focus sessions', 'Kind, related task id, planned duration, actual duration, whether completed, start time — 50 at a time. **Without task titles**, but timestamps alone already show a person\'s daily rhythm'],
          ['`log_focus`', 'Log a focus session', 'Reads nothing; writes go through the operation log'],
          ['`list_tags`', 'List tags', 'Tag ids and names'],
          ['`create_tag`', 'Create a tag', 'Reads nothing; writes go through the operation log'],
          ['`set_task_tags`', 'Set a task\'s tags', 'Reads nothing; it **replaces the whole tag set** of that task with the group you explicitly supply (not an addition — tags you leave out are removed)'],
          ['`create_project`', 'Create a project', 'Reads nothing; writes go through the operation log'],
          ['`list_notes`', 'List notes', 'Note id, owning project, whether pinned to today, last modified — 50 at a time, **without bodies**. Notes have no titles, so this row discloses only "when something was touched"'],
          ['`get_note`', 'Read one note in full', 'Everything above, **plus the complete body of that note**'],
          ['`create_note`', 'Create a note', 'Reads nothing; writes go through the operation log'],
          ['`update_note`', 'Update a note', 'Replaces the note body outright (not an append)'],
          ['`list_reminders`', 'List reminders', 'Reminder id, related task id, trigger time, current phase (pending / postponed / due / fired / dismissed) — **without task titles**'],
          ['`create_reminder`', 'Create a reminder', 'Reads nothing; writes go through the operation log'],
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
        text: '**Do not assume that "encrypted entries" are unreadable through the local interface.** The protocol layer really does project fields through a whitelist, but this product has no concept of a "protected entry" yet, and both real hosts currently evaluate readability as true. The consequence is simple: once you enable `get_task`, that program on that machine can read your task note bodies in full. Enabling only `list_tasks` is not the safe option either — titles plus due dates are enough to reconstruct somebody\'s schedule. 🔴 The two countdown tools are the same, and there is no narrower option to fall back on: `get_event` returns the full note body, and a countdown title is often itself the content — a title naming a person plus that date already discloses something even when no note exists.',
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
    id: 's10',
    title: 'The EU GDPR view: which box the "egress" in this document falls into',
    blocks: [
      {
        kind: 'p',
        text: 'The "cross-border transfer" wording above was written against Chinese law: the rules around Article 38 of the PIPL ask whether personal information has left **mainland China**. Chapter V of the GDPR asks about **a different thing** - personal data leaving the European Economic Area. The two phrases look identical in translation while the test, the accepted forms of legal basis and the burden of proof all differ, so this document **does not copy a conclusion from one side onto the other**: the characterisation on the Chinese side is still the "pending legal review" in section 8, and the column below answers only what can be produced under the GDPR right now, and what cannot.',
      },
      {
        kind: 'table',
        head: ['Where in the GDPR', 'What it asks', 'What heyta can produce', 'What does not line up'],
        rows: [
          [
            'Articles 44-49 (transfers to a third country)',
            'Whether there is a recognised transfer basis once personal data leaves the EEA',
            'Today it **never happens**: ADR-0054 §5 allows the managed path to reach **only hosts on the domestic allowlist** (validated once when the config is saved and again before the request is actually sent, anything off the table is refused loudly), and per-feature egress consent defaults to off, so no data is sent abroad on our side',
            'We have **not** filed standard contractual clauses, there is **no** adequacy decision we rely on, and there are **no** binding corporate rules. If a self-hosted instance is pointed at an endpoint abroad, the basis for that transfer is the **operator**\'s to carry; this document will not write "a basis exists" on anyone\'s behalf',
          ],
          [
            'Article 9 (special categories)',
            'Whether data such as health, religious beliefs or sexual orientation is being processed',
            'We neither classify content nor run any "detect a sensitive term and block the send" filter',
            'The context sent comes from the user\'s own tasks and notes, which may well contain Article 9 data; we cannot claim it "will be recognised and stopped before sending", so we do not write that',
          ],
          [
            'Article 22 (solely automated decisions)',
            'Whether a decision with legal or similarly significant effect on the user is made by machine alone',
            'This one lines up: the AI cannot produce a write at the type level - reads execute, writes stop at a proposal, and only confirmation becomes an op',
            'But that holds **only** while the human confirmation exists. Any change that turns a suggestion directly into a write makes this row stop lining up, so it is not a qualification earned once - it is a judgement that has to keep being defended',
          ],
          [
            'Articles 25 and 32 (data protection by default, security)',
            'Whether default settings are privacy-friendly and measures are appropriate to the risk',
            'Off by default, the local interface binds to loopback only, per-tool authorisation, end-to-end encryption that leaves the server unable to read plaintext, and no fallback may cross a privacy boundary',
            'These claims rest on this repository\'s code and tests alone; there is **no** third-party certification or audit report, so this section does not claim "GDPR certified" or anything like it',
          ],
        ],
      },
      {
        kind: 'ul',
        items: [
          'Consent in heyta is **per feature** (the "specific, informed, withdrawable" that Articles 6(1)(a) and 7 ask for), not one master switch; switch a feature off and that feature sends not a single byte.',
          'For a self-hosted deployment the controller is the person running the instance, and the GDPR obligations travel with them; what we supply is the software.',
          'How each right is exercised is in the GDPR comparison table of the Data rights document, and this document **does not duplicate that table** - two copies of one list always drift, and the copy that drifts is usually the one that says more.',
        ],
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: 'Data rights document: the article-by-article GDPR table lives there (including what does not line up for Articles 13/14, 15, 16, 17, 18, 20, 21/22 and 32/33). This document covers only the AI and egress part; for exercising a right, that document governs.',
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
          '**Cloud AI being offered**: section five is rewritten end to end. Of the three preconditions it names, **the retention period was settled on 2026-10-05 and is written into section five**; the other two are not — a per-feature, revocable, separate consent, and the characterisation in section 8 which still **stays open**. At that point "end-to-end encryption" and "cloud AI" must stay two separate feature descriptions and may never be merged into one sentence.',
          '**"Protected entries" becoming a product concept**: only then may the callout in section six change from a warning into a promise. Until then, no sentence claiming "encrypted entries cannot be read" is written.',
        ],
      },
      {
        kind: 'table',
        head: ['Version', 'Date', 'Change'],
        rows: [
          ['1.0', '2026-10-01', 'First draft (not yet in force): field-by-field egress table written from the implementation; redaction explicitly disclaimed; cloud AI described as currently unavailable; the cross-border characterisation marked as pending legal review.'],
          [
            '1.1',
            '2026-10-03',
            'The local-interface tool table in section six gained the four countdown tools (`list_events` / `get_event` / `create_event` / `update_event`), together with the note that a countdown title is often itself the content. This list is reconciled one-by-one against the tool catalogue inside the product, and it is updated whenever a new tool is added.',
          ],
          [
            '1.2',
            '2026-10-04',
            'The same table now discloses **the remaining 16 tools** (habits / check-ins / focus / tags / notes / projects / reminders): the catalog had grown to 9 entities and 26 tools with the AI coverage work, while this document still listed 10. Because the sentence "a tool not listed is not granted" turns this table into the authorisation surface, a missing row is a missing disclosure of what becomes readable once a tool is enabled. Each cell follows the `egressFields` actually present in the built catalog, with no inference beyond the field names; `list_notes` states explicitly that notes have no titles, so the list projection discloses only "when something was touched".',
          ],
          [
            '1.3',
            '2026-10-04',
            'Added section ten. Chapter V of the GDPR (Articles 44-49) asks whether personal data leaves the European Economic Area, which is **not the same question** as the cross-border wording elsewhere in this document, so neither side borrows the other conclusion. Each cell states what can be produced and what cannot: no standard contractual clauses, no adequacy decision we rely on, no binding corporate rules; Article 9 content is never classified or filtered; Article 22 holds only while the human confirmation stands in the way; Articles 25 and 32 rest on this repository\'s code and tests, with no third-party certification. The article-by-article rights table is deliberately not copied here - it is pointed at through a document reference instead.',
          ],
          [
            '1.4',
            '2026-10-05',
            'The **Task breakdown / Prioritisation / Duration estimate** rows of the table in section three each gained `today`, and the Tool selection row gained it too. Those three chains did not know which day it was, so when you wrote "next Wednesday" or "the 14th" the model had to invent a date (measured: it was once off by four and a half months); the only fix is to inject that line into the prompt. It does not look like user data, but it is **this device\'s local date**, so the rule "any new egress field extends this table before it ships" applies. For Tool selection the `today` is not new egress - it is a **missing line being added back**: the built-in assistant already sent it while this table omitted it.',
          ],
          [
            '1.5',
            '2026-10-05',
            'Section five is rewritten against ADR-0054: the **data retention policy for this kind of service has been settled**, so the section no longer gives "the retention period is undecided" as the reason the tier is unavailable (the deliberate check written for that purpose no longer fires once the period is decided). What was settled is stated in the second paragraph of section five, item by item against things that can be checked: a table that can only hold counts (its column set is the evidence, not our wording), request and response bodies that exist only in the memory of one proxied call, the operational metadata as a closed field list plus one dated period with a stated derivation, and the managed destination being derived from a **domestic allowlist** rather than declared by the client. Two places deliberately say less than they could: that period carries **no** "it is deleted automatically when it expires" (the sweep is not implemented in this round, and section five changes again when it is), and the cell in section 8 about an endpoint you configure abroad **still reaches no conclusion** - this decision does not touch it and this document will not settle it. The trigger list in section nine drops the retention item with this change. Opening the tier and selling it follow the order in ADR-0054 §6; when that step arrives this section is rewritten end to end again. This row does not restate that number or that field list: they live in section five only, and a second copy is a second thing that can drift.',
          ],
        ],
      },
    ],
  },
] as const;

export const aiAndTransfer: LegalDocument = {
  id: 'ai-and-transfer',
  // 🔴 1.0 → 1.1：这次改的是**披露本身**（本机接口工具表 + 那句"打开之后能读到什么"）。
  // 版本号进同意指纹（`packages/legal/src/index.ts:125` 把每张文档拼成 `id@version`），
  // 改了文字而不 bump，等于让 1.0 那枚已存的同意去覆盖一段它没见过的话 ——
  // 这正是条款 s12 那条纪律禁止的事（"否则等于偷偷改"）。
  // 🔴 1.1 → 1.2：同一张表又补了 16 条工具（目录 26 条此前只披露 10 条）。
  // 触发的是同一句纪律，而且这次更直白：条款把这张表当授权面，表少一行 = 同意少一项。
  // 🔴 1.2 → 1.3：新增第十节（GDPR 第五章那一档）。加的是**实质承诺的边界**
  // （没有传输依据、不识别第 9 条内容、第 22 条依赖人工确认），不是措辞打磨，
  // 所以必须换版本号：同意留痕要能回答"他同意的那一版里有没有这一段"。
  // 🔴 1.3 → 1.4：第三节那张表加了 `today`（拆解 / 排序 / 估时三条链路 + 工具选择补漏）。
  // 触发的还是同一条纪律，而且这次是本文件自己列的第一种触发："加任何一个新的出境字段，
  // 那张表必须先扩、再上线"。出境面变了而不换版本号 = 让 1.3 那枚同意去覆盖
  // 一段它没见过的数据，正是条款 s9 禁止的事。
  // 🔴 1.4 → 1.5：第五节按 ADR-0054 改写 —— 改的是**对外承诺的实质**（保留策略从"还没定"
  // 变成一份可核对的定案：只装计数的表 / 内容只活在一次调用里 / 运维元数据一个有出处的期限 /
  // 目的地由境内白名单推导），不是措辞。而且这一版**撤掉了一句真话的旧版本**：
  // "因为保留策略未定所以这一档打不开"在 2026-10-05 之后不再成立。同意留痕要能回答
  // "他同意的那一版里，这一节写的是哪一套理由"，所以必须换版本号。
  version: '1.5',
  status: 'draft',
  updatedDate: '2026-10-05',
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
