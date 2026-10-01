/**
 * 第三方与共享清单
 * ================
 *
 * 法定出处：《个人信息保护法》第二十一条（委托处理）与第二十三条（向其他处理者提供），
 * 《网络数据安全管理条例》第十二条、第二十一条第二款（以清单等形式列明），
 * 《App 违法违规收集使用个人信息行为认定方法》第二类第 1 项、第五类第 1、2 项；
 * 字段模板见 `docs/research/legal-pipl-baseline.md` §5.2 B（接收方名称 / 共享方式 /
 * 信息种类 / 使用目的 / 接收方信息）。
 *
 * 🔴 **本文件的第一条纪律：不得出现「我们不与任何第三方共享数据」这句话。**
 * 它已被代码事实否证：服务端有 **4 类出网请求**，另有承载服务端的云基础设施。
 * 证据与逐字反例列表见 `docs/research/legal-dataflow-server.md` 的 A10「出网站点穷举」表，
 * 以及同文件「绝对不能声明」表里那一行「不向任何第三方传输数据」。
 * 同样不能写「我们不会向第三方传输任何与口令有关的信息」—— 泄露口令检查确实传了摘要前缀，
 * 只能写成「仅传输口令 SHA-1 的前 5 个字符，无法反推口令，且不携带身份标识」。
 *
 * 🔴 **第二条纪律：按目的地写，不按服务商名单写。**
 * 邮件服务与推送服务具体是哪家，取决于每个自建实例的部署者配了什么，代码里没有写死
 * （`server/src/email.ts` 只读 `SMTP_HOST`；推送目的地就是每个订阅自带的 endpoint）。
 * 列一个具体名字，对绝大多数用户反而是错的。官方托管实例需另行披露它自己配的这两家。
 *
 * 🟡 **三种流转方式的划分**来自 baseline §5.2 B 第 2 行：委托处理 / 用户直接发送给第三方 /
 * 用户指示的转移。本文件在其上多列一种「向其他处理者提供」，因为微信支付与泄露口令检查的
 * 真实定性就是它 —— 这一字之差决定要不要单独同意，不是文字游戏（见 §1.3 的分界口径：
 * 判据是对方是否自主决定处理目的）。
 *
 * 关于第四节那张「没有接入」的表：它的价值全在**方法可复跑**。证据是那次检索的
 * 14 个关键词全部零命中，加上运行时依赖清单与锁文件层面的旁证；期间唯一一次
 * 「命中」是假阳性（价格表里一个函数名 `isEn` + `tryEffectiveAt` 的子串），
 * 🟡 撰写时不要因为它是子串就改口，也不要把这句写成绝对化否定句 ——
 * 绝对句会被任何一个新依赖当场作废（第三类第 9 项）。
 *
 * 关于第五节的主体信息：那是**唯一事实源，逐字使用**。
 * 🔴 App 备案号尚未核准，本文件不写、不推测、不占位；除那一个邮箱之外，
 * 没有公开的电话号码与客服时间，也不要编造。微信支付与 haveibeenpwned 两家的
 * 运营主体全称、联系方式与所在国家/地区不在事实源里 —— 留给法务定稿时补，
 * 这也是本文件 `status` 仍为 `draft` 的原因之一。
 */

import type { LegalDocument } from '../types.js';

const zh = [
  {
    id: 's1',
    title: '这份清单怎么看：数据离开我们有四种身份',
    blocks: [
      {
        kind: 'p',
        text: '这份清单只回答一件事：**你的哪些数据离开了 heyta，去了哪里，是以什么身份离开的。** 先说一句不客气的话：我们不会写「我们不与任何第三方共享数据」，因为这句话是假的。下面第二节的表里有四类由我们的服务器主动发出的请求，第一节还有承载这些服务器的云基础设施。一份真实的清单比一份好听的清单安全。',
      },
      {
        kind: 'p',
        text: '法律上「共享」不是一件事，而是几件不同的事，判据是**对方是否自己决定处理目的**（《个人信息保护法》第二十一条与第二十三条的分界）。监管模板要求至少区分三种：委托处理、你直接发送给第三方、你指示的转移。我们在此基础上单列第四种，因为它才是本节表里两行的正确定性，而这一字之差决定**要不要你的单独同意**。',
      },
      {
        kind: 'table',
        head: ['流转方式', '判定标准', '在 heyta 里对应什么'],
        rows: [
          [
            '委托处理',
            '对方只按我们的指令处理，不自主决定目的与方式',
            '云基础设施（腾讯云内地节点）、邮件投递服务、推送送达',
          ],
          [
            '向其他处理者提供',
            '我们把一部分数据交给对方，由对方按它自己的规则与法定义务完成一件事',
            '微信支付（支付受理）、haveibeenpwned（泄露口令查询）',
          ],
          [
            '你直接发送给第三方',
            '请求从**你的设备**发出，目的地由你填写，我们不中转、不经手',
            '你自配的 AI 端点、你自建的同步服务器',
          ],
          [
            '你指示的转移',
            '数据本就在你手上，按你的主动操作交给别人',
            '导出文件经系统分享面板、本机其他程序经本机 API 读取',
          ],
        ],
      },
      {
        kind: 'p',
        text: '还有一条写法上的纪律：这张清单**按目的地写，不按服务商名字写**。原因很实际 —— 邮件服务与推送服务具体是哪家，取决于每个自建实例的部署者配了什么，代码里没有写死任何一个名字。我们若替你填上一个名字，对绝大多数用户来说反而是错的。',
      },
      {
        kind: 'callout',
        text: '🔴 三处刻意不夸大：① 不写「端到端加密所以第三方看不到内容」—— 邮件正文里的一次性链接是明文，导出的文件是明文；② 不写「你收集的信息不出我们的服务器」；③ 不写「我们绝不接入第三方 SDK」，而是**逐项列出为否**（第四节）。',
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: '我们处理个人信息的总口径（目的、方式、你的权利与我们的义务）见《隐私政策》。本清单是它对「对外提供」这一部分的逐项展开。',
      },
    ],
  },
  {
    id: 's2',
    title: '由 heyta 服务器发出的对外请求',
    blocks: [
      {
        kind: 'p',
        text: '下表是**全部**：第 1 行是承载我们服务端全部数据的云基础设施，第 2–5 行是对服务端代码做全量出网穷举后得到的**四类**对外请求。除这五条之外，你的同步内容、口令散列、一次性令牌、通行密钥凭据、订单与邀请关系都不离开我们的库。',
      },
      {
        kind: 'table',
        head: ['接收方 / 目的地', '流转方式', '送过去的字段', '什么时候发生'],
        rows: [
          [
            '腾讯云（中国内地节点）',
            '委托处理',
            '服务端全部数据所在的机器：密文同步事件、账号表（含邮箱明文与口令散列）、订单表、每日备份快照',
            '始终 —— 它是我们服务器的机房',
          ],
          [
            'haveibeenpwned（`api.pwnedpasswords.com`）',
            '向其他处理者提供',
            '🔴 **口令 SHA-1 的前 5 个十六进制字符**；不含口令、不含完整哈希、不含邮箱、不含任何身份标识',
            '只在你设置口令的那一刻（注册 / 改密 / 重置完成）',
          ],
          [
            '邮件投递服务（SMTP，由部署者配置）',
            '委托处理',
            '收件人邮箱地址 + 邮件正文（正文里含一次性链接）',
            '五封功能性邮件的每一封',
          ],
          [
            '微信支付（`api.mch.weixin.qq.com`）',
            '向其他处理者提供',
            '商户与商品标识、商户订单号、金额、回调地址，🔴 以及 `attach` 字段里**你的内部用户 id**',
            '你下单支付托管同步或云端 AI 时',
          ],
          [
            '推送服务（每个订阅自带的 `endpoint` 地址）',
            '委托处理',
            '`endpoint` 地址、我们写在 VAPID 里的联系方式、一条内容恒定的密文载荷',
            '🔴 只在你于设置里开启提醒通知之后',
          ],
        ],
      },
      {
        kind: 'p',
        text: '**关于 haveibeenpwned 那一行。** 我们不是在把口令交给第三方：发送的是口令 SHA-1 摘要的前 5 个字符（这是 k-匿名查法的固有形状，收端无法据此反推口令，也不知道是谁在问），请求里不携带账号、邮箱或任何标识，工具类库的 `User-Agent` 是 `heyta-auth`。查询有 2 秒超时，查不通就**放行**（fail-open），登录路径一律不跑这条检查。同时要说清一句：这 5 个字符本身不构成个人信息，我们仍然把它列进来，因为它与你的口令有关，而你有权知道与口令有关的每一次对外动作。',
      },
      {
        kind: 'p',
        text: '**关于邮件。** 我们只发**五封纯功能性邮件**：验证邮箱、魔法登录链接、找回通行密钥、重置口令、口令已修改的安全通知。🔴 **没有营销邮件、没有订阅列表、没有任何群发** —— 这一条我们敢确定地写。正文是封闭词表的固定文案，**不含你的任务内容**；但收件人邮箱和正文里那条一次性链接会以明文经过邮件服务商的通道，所以「端到端加密」这句话**不能**延伸到邮件这一段。至于具体是哪家邮件服务商：代码里没有写死，由每个实例的部署者配置；官方托管实例用的是哪一家，会在定稿时单独披露。',
      },
      {
        kind: 'p',
        text: '**关于微信支付。** 下单请求里唯一能指到你的是 `attach` 字段，它的值是**我们数据库内部自增用户 id 的十进制串**（一个伪标识符），同一个 id 还被编进商户订单号里作为兜底。我们不向微信支付提交你的邮箱、姓名、地址，也不经手你的银行卡数据 —— 卡号与支付要素只在微信支付的通道里。**但也不要写成「我们不向支付商提供任何标识」**，那是假的，`attach` 就在请求体里。另：微信支付是唯一的支付通道，且只有部署者配齐相关环境变量时才启用；未启用时下单回调接口直接返回 404。',
      },
      {
        kind: 'p',
        text: '**关于推送。** `endpoint` 是浏览器或操作系统给你的一个「能往这台设备投递」的地址，它本身就是凭据（拿到它就能给该设备发任意载荷），所以我们把它当凭据保管：不写进日志、不在后台回显。推送服务因此能看见「某个地址在被反复投递」，但**读不到内容**：载荷是加密的（aes128gcm），而当前唯一的推送语义是一个固定串 —— 「让桌面上的小组件去刷新」，不含任何用户内容。这一整条只在你开启提醒通知之后才存在。',
      },
      {
        kind: 'callout',
        text: '🟡 关于第一行的性质：腾讯云按我们的指令存储与运转数据，因此它是**受托方**而不是「我们向之提供个人信息的第三方」—— 这意味着不需要你的单独同意，但意味着**必须披露**并且必须有约定目的、方式、范围与安全义务的合同附件。另外两件必须如实写的事：① 每日备份是整库快照，账号面那一份**含邮箱明文、口令散列与通行密钥凭据**；② 若部署开启了异地上传，备份快照还会交给所选的远端存储服务商（这也是由部署者决定，代码里没有写死名字）。',
      },
    ],
  },
  {
    id: 's3',
    title: '由你的设备直接发出的请求：目的地由你指定',
    blocks: [
      {
        kind: 'p',
        text: '下面四条**不是「我们向第三方提供」** —— 决定处理目的与方式的人是你，请求也是从你的设备直接发出的，我们不中转。但把它们写进这份清单，是因为你很难自己发现它们，而《认定方法》要求的正是「如实、完整」而不是「对我们有利」。',
      },
      {
        kind: 'table',
        head: ['你的设备直接连到哪里', '送出去什么', '为什么不由我们代你决定', '开关在哪里'],
        rows: [
          [
            '你自建的同步服务器（设置里填写的地址）',
            '与官方实例相同的**密文同步事件 + 明文同步元数据**',
            '地址是你填的，数据直接从你的设备发出',
            '不填就不存在；删除同步配置即停止',
          ],
          [
            '你填写的 AI 端点',
            '🔴 按功能逐项送出的**明文原文**：任务标题、任务备注正文、你刚敲进去的那句话',
            'heyta 刻意**不内置任何云端预设**，两个内置预设都是本机地址',
            '三道闸默认全关：AI 总开关、「允许远程」、逐功能出境授权',
          ],
          [
            '系统分享面板（移动端导出）',
            '明文 JSON：你看得见的全部内容 + 完整操作日志（含删除墓碑）',
            '由你在系统面板里选一个 App 或一个目录',
            '导出动作由你发起；不导出则不发生',
          ],
          [
            '本机 API / MCP（只监听回环地址）',
            '反向：是**本机其他程序来读你的数据**',
            '读你数据的那个程序是你在为你自己授权的',
            '总开关默认关，每个工具单独默认关，另需访问令牌',
          ],
        ],
      },
      {
        kind: 'p',
        text: '「出境」这件事在这里有两种完全不同的情形，不要混着读。经由我们服务器的情形不由你决定：服务器在**中国内地**，你不使用同步就没有这一项。而**你自配的端点构成的出境是你自己的决定** —— 如果你把一个境外推理服务的地址填进来，那一次数据传输的处理者是你。我们不替你评估目的地是否合规，也不会把它写成 heyta 的一项安全承诺。',
      },
      {
        kind: 'p',
        text: 'AI 那条路还有一句必须直写、不许美化的话：出境的是**原文明文**，不是摘要、不是脱敏结果，长度上限只是截断保护而不是脱敏。同时有一条成立且让人安心的事实：请求由**你的设备直接发往你自己配置的那个端点**，我们不中转、无法获知内容；API 密钥在配置里根本没有明文存放的字段，只有一个引用（`keyRef`），取用时由系统安全存储提供，也不会被交给我们。',
      },
      {
        kind: 'callout',
        text: '🟡 一句容易被误读的话：跑在 `localhost` / `127.0.0.1` 上的模型（本机 Ollama、本机 LM Studio）**不属于对外请求**。判定只看地址是不是字面上的回环，**不做域名解析** —— 所以 `http://my-nas.local:11434` 这类局域网名字会被判成远端并要求你逐功能授权。这是取舍，不是漏洞：局域网名可以指向你网络里任意一台主机。',
      },
      {
        kind: 'docRef',
        docId: 'ai-and-transfer',
        text: 'AI 功能逐项出境了什么、三道闸各自拦在哪一步、撤回为什么立即生效但不溯及已发出的请求，见《AI 与数据出境说明》。',
      },
    ],
  },
  {
    id: 's4',
    title: '我们没有接入的东西（逐项列出为否）',
    blocks: [
      {
        kind: 'p',
        text: '这一节用表格而不是用一句口号，理由是：绝对化的否定句（「我们绝不可能接入任何追踪」）会被任何一个新依赖当场作废，而且无法证伪；而**逐项为否**是可以被你复跑、被你拿去和抓包结果对照的。方法：在服务端与前端源码里逐项检索下列关键词并统计命中数，同时核对运行时依赖清单与锁文件层面是否存在观测类组件。',
      },
      {
        kind: 'table',
        head: ['类别', '是否接入', '依据（截至 2026-10-01）'],
        rows: [
          ['数据统计 / 埋点 SDK', '否', '`analytics`、`telemetry`、`logEvent`、`track(` 逐项检索，命中 0'],
          ['广告 / 归因 SDK', '否', '`gtag`、`ga(`、`hotjar`、`clarity`、`openreplay` 命中 0'],
          ['崩溃与错误上报 SDK', '否', '`sentry`、`bugsnag`、`captureException`、`crash` 命中 0；锁文件层面也无'],
          ['App 端推送 SDK（Firebase / 个推 / 厂商通道）', '否', '🔴 移动端不申请通知权限，提醒只在应用内；Web 推送用的是浏览器标准能力，不是 SDK'],
          ['社交登录 SDK（微信 / QQ / Google / Apple 登录）', '否', '登录只有邮箱口令与通行密钥两条路，无第三方登录组件'],
          ['远程字体 / 第三方 CDN 脚本', '否', '前端源码内无外部 CDN、无样式表远程引用、无 Google Fonts，命中 0'],
          ['Apple / Google / 华为商店内购通道', '否', '支付只有微信支付一条路，未接入任何商店内购'],
          ['地图 / 定位 / 健康数据服务', '否', '无相关代码，也不申请相关权限'],
        ],
      },
      {
        kind: 'p',
        text: '三点诚实的限制，比一句「全部为否」更有价值：① 上述检索覆盖的是服务端与前端**源码**，不含构建产物里第三方包自身的联网行为，也不含你所在网络的其他环节；② 大小写不敏感检索时出现过**一次假阳性**（价格表中一个函数名的子串像 `sentry`），那不是 Sentry SDK，我们没有因为它改口；③ 这张「否」表只对**本文件版本所对应的客户端**成立 —— 一旦接入任何一项，先改这张表再发版本，否则就落进《认定方法》第三类第 9 项。',
      },
      {
        kind: 'p',
        text: '顺带登记一条不影响隐私结论但影响可核对性的残留：`bcryptjs` 仍在服务端依赖清单里，而产品代码里没有任何使用点（口令哈希用的是 Argon2id）。它不会向任何地方发送数据，但它会出现在第三方组件清单里 —— 我们把它列出来，而不是从这张表里抹掉。',
      },
      {
        kind: 'callout',
        text: '为什么这张表值得相信：它给的是**可复跑的方法**（关键词清单 + 依赖清单 + 锁文件），不是一句承诺。任何人都能在自己手上的版本上重跑一遍，跑出来的结果和这张表不一致，就是我们的问题。',
      },
    ],
  },
  {
    id: 's5',
    title: '谁对这些数据负责，怎么找到我们',
    blocks: [
      {
        kind: 'p',
        text: '对外清单必须能落到一个可被联系的主体上（《网络数据安全管理条例》要求公开运营者的名称与联系方式）。下列信息是这份文件里唯一的主体事实源。',
      },
      {
        kind: 'table',
        head: ['项', '内容'],
        rows: [
          ['名称', '晓黎（杭州）人工智能科技有限公司'],
          ['统一社会信用代码', '91330106MAKNJ6DX7M'],
          ['法定代表人', '邓湘雷'],
          ['住所', '浙江省杭州市西湖区蒋村街道文一西路 830 号蒋村商务中心 3 号楼 210 室'],
          ['联系邮箱', 'heyta@waytofuture.cn'],
          ['主域 ICP 备案号', '浙ICP备2026081423号'],
        ],
      },
      {
        kind: 'p',
        text: '🔴 **App 备案号尚未核准**，所以本文件里没有它，也不做任何占位或推测；核准之后会作为一次独立修订补入并升版本号。联系方式同理：除了上面这一个邮箱，我们**没有**公开的电话号码或客服时间，本文件不编造这些。',
      },
      {
        kind: 'p',
        text: '🟡 这份清单还有两处**留给法务在定稿时补齐**，缺了它们这份文本就不算完整：① 微信支付与 haveibeenpwned 两家接收方的**运营主体全称、联系方式与所在国家/地区**（代码考古的事实源里没有，我们不猜）；② 官方托管实例实际配置的**邮件服务商与推送通道**名称。这两项补齐之前，本文件的状态一直是 `draft`，页面上会显示「尚未生效」。',
      },
      {
        kind: 'ul',
        items: [
          '不开启同步：第二节表里的第 2–5 行照常发生（它们是账号与支付必需的），但你的任务内容不会以密文形式离开你的设备。',
          '不开启 AI 远程、不填自建端点：第三节整张表都是空的。',
          '不开启提醒通知：推送那一行从不发生。',
          '注销账号：服务端按表外键级联删除同步数据、设备记录、凭据、订阅与订单；备份是整库快照，**代码层没有「从备份里定点删除某条数据」的能力**，这一点我们在《你的数据权利》里如实写明，不承诺即时从备份中清除。',
        ],
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: '你要行使查阅、复制、更正、删除或注销时走哪条路径、多久会有回音，见《你的数据权利》。',
      },
    ],
  },
  {
    id: 's6',
    title: '这份清单什么时候会变，不一致时以什么为准',
    blocks: [
      {
        kind: 'p',
        text: '会让这份清单增加的只有三种情况：① 接入新的第三方服务（支付通道、邮件服务、推送、崩溃上报、商店内购、托管 AI 中的任何一项）；② 部署换掉了邮件或推送供应商；③ 监管口径要求换一种披露结构。**任一新增都会先改这份文件并升版本号，再发版本**，并按《个人信息保护法》第十四条第三款重新取得你的同意。',
      },
      {
        kind: 'ul',
        items: [
          '证据来源：对 heyta 服务端、客户端与 AI 链路三份出网面逐项代码核查 —— 每一个会发出数据的请求点、每一处发信、每一种备份与其保留期。本文件里每一条断言都能指回一段具体的代码，核查记录随源代码一起公开，任何贡献者都能逐条复核。',
          '与《个人信息收集清单》的分工：那一份回答「存了什么、存在哪、存多久」，本份回答「离开过我们、到了谁手上」。同一件事在两份里说法不一致时，以本份关于接收方的表述为准。',
          '与《应用权限清单》的分工：那一份是系统替你守的门（会弹窗、可拒绝），本份是不需要弹窗的数据流出 —— 两者不能互相代替。',
        ],
      },
      {
        kind: 'p',
        text: '如果这份清单与你实际观测到的网络行为不一致：① 版本与日期以本文件顶部标注为准，本份是「对特定版本的陈述」而不是永恒承诺；② **以你设备上的实际网络出口为准**；③ 请把这种不一致当作缺陷报告给我们，它对我们是必须修的错，不是可以解释的偏差。应用商店与监管检测会用静态特征比对加动态抓包，把抓出来的域名清单和这份文本对齐 —— 不一致本身就是违规项，所以我们宁可把清单写得让人不舒服，也不写成对不上号的样子。',
      },
      {
        kind: 'docRef',
        docId: 'personal-info-list',
        text: '你的哪些数据被收集、存在哪一层、保留多久，见《个人信息收集清单》。',
      },
      {
        kind: 'docRef',
        docId: 'permissions',
        text: '我们在各端系统里申请了哪些权限、拒绝后哪些功能仍可用，见《应用权限清单》。',
      },
    ],
  },
] as const;

const en = [
  {
    id: 's1',
    title: 'How to read this list: the four capacities in which data leaves us',
    blocks: [
      {
        kind: 'p',
        text: 'This inventory answers one question only: **which of your data leaves heyta, where it goes, and in what capacity it goes there.** A blunt sentence first: we will not write "heyta shares no data with any third party", because that sentence is false. Section 2 below lists four kinds of request our own servers send out, and its first row is the cloud infrastructure that hosts those servers. A truthful list is safer than a flattering one.',
      },
      {
        kind: 'p',
        text: 'Legally, "sharing" is not one thing but several, and the test is **whether the other party decides the purpose itself** (the line drawn between Articles 21 and 23 of PIPL). The regulatory template asks us to distinguish at least three: processing on our behalf, data you send to a third party directly, and transfers made at your instruction. We add a fourth, because it is the correct characterisation of two rows in Section 2 — and that single word decides **whether your separate consent is required**.',
      },
      {
        kind: 'table',
        head: ['Mode', 'The test', 'What it corresponds to in heyta'],
        rows: [
          [
            'Entrusted processing',
            'The other party handles data solely on our instructions and does not set the purpose or the means',
            'Cloud infrastructure (Tencent Cloud, mainland China node), outbound mail delivery, push delivery',
          ],
          [
            'Provision to another handler',
            'We hand part of the data over and the other party completes one thing under its own rules and its own statutory duties',
            'WeChat Pay (payment acceptance), haveibeenpwned (breached-password lookup)',
          ],
          [
            'Sent by you directly to a third party',
            'The request originates on **your device**, to a destination you typed in; we neither relay nor handle it',
            'The AI endpoint you configure, the sync server you host yourself',
          ],
          [
            'Transferred at your instruction',
            'The data was already in your hands and leaves because of an action you took',
            'The export file via the system share sheet, other local programs reading through the local API',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'One further drafting discipline: this list is organised **by destination, not by vendor name**. The reason is practical — which mail provider and which push service are actually used depends on what each self-hosted deployment configures, and no name is hard-coded anywhere in the code. Had we filled in a name for you, it would be wrong for most users.',
      },
      {
        kind: 'callout',
        text: '🔴 Three deliberate refusals to overstate: ① we do not say "end-to-end encryption, so no third party can see your content" — the one-time link in the mail body is cleartext, and so is the export file; ② we do not say "your data never leaves our servers"; ③ we do not say "we would never integrate a third-party SDK" — instead we list **item by item what is not integrated** (Section 4).',
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: 'Our overall approach to handling personal information (purposes, means, your rights and our duties) is set out in the Privacy Policy. This inventory is its item-by-item expansion of the "provision to third parties" part.',
      },
    ],
  },
  {
    id: 's2',
    title: 'Outbound requests sent from heyta\'s servers',
    blocks: [
      {
        kind: 'p',
        text: 'The table below is **complete**: row 1 is the cloud infrastructure that hosts every byte of our server-side data; rows 2–5 are the **four** classes of outbound request produced by an exhaustive sweep of the server code for network calls. Beyond these five, nothing leaves our database — not your synced content, not password hashes, not one-time tokens, not passkey credentials, not orders, not invitations.',
      },
      {
        kind: 'table',
        head: ['Recipient / destination', 'Mode', 'Fields handed over', 'When it happens'],
        rows: [
          [
            'Tencent Cloud (mainland China node)',
            'Entrusted processing',
            'The machines holding all server-side data: ciphertext sync events, the account table (with cleartext e-mail addresses and password hashes), orders, daily backup snapshots',
            'Continuously — it is where our servers run',
          ],
          [
            'haveibeenpwned (`api.pwnedpasswords.com`)',
            'Provision to another handler',
            '🔴 **The first 5 hexadecimal characters of the SHA-1 of your password**; no password, no full hash, no e-mail address, no identity of any kind',
            'At the moment you set a password (sign-up, change, or completed reset)',
          ],
          [
            'The mail delivery service (SMTP, configured by whoever deploys)',
            'Entrusted processing',
            'The recipient\'s e-mail address plus the message body (which contains a one-time link)',
            'Each of the five functional e-mails',
          ],
          [
            'WeChat Pay (`api.mch.weixin.qq.com`)',
            'Provision to another handler',
            'Merchant and product identifiers, the merchant order number, the amount, the notification URL, and 🔴 **your internal user id** in the `attach` field',
            'When you pay for hosted sync or cloud AI',
          ],
          [
            'The push service behind each subscription\'s own `endpoint`',
            'Entrusted processing',
            'The `endpoint` address, our contact address carried in the VAPID header, and a payload whose content never varies',
            '🔴 Only after you turn on reminder notifications in settings',
          ],
        ],
      },
      {
        kind: 'p',
        text: '**About the haveibeenpwned row.** We are not handing your password to a third party. What is sent is the first 5 characters of its SHA-1 digest — the inherent shape of a k-anonymous lookup, from which the receiving side cannot recover the password and cannot tell who is asking. The request carries no account, no e-mail address and no identifier; its `User-Agent` is `heyta-auth`. The call has a 2-second timeout and **fails open** (if the check cannot be made, the password is accepted), and the login path never runs it. One more sentence for completeness: those 5 characters are not themselves personal information, yet we still list them, because they relate to your password and you are entitled to know about every outbound action that touches it.',
      },
      {
        kind: 'p',
        text: '**About mail.** We send **five purely functional e-mails and nothing else**: address verification, magic sign-in link, passkey recovery, password reset, and a security notice that your password changed. 🔴 **There is no marketing mail, no mailing list, no bulk send of any kind** — that sentence we are confident in. The bodies are fixed text drawn from a closed word list and **contain none of your task content**; but the recipient address and the one-time link inside the body do traverse the mail provider\'s channel in cleartext, which is exactly why "end-to-end encryption" **cannot** be extended to the mail leg. As for which provider: nothing is hard-coded, it is set per deployment, and the provider used by the official hosted instance will be disclosed separately at finalisation.',
      },
      {
        kind: 'p',
        text: '**About WeChat Pay.** The only thing in the order request that points at you is the `attach` field, whose value is **the decimal string of our internal auto-increment user id** — a pseudonymous identifier, the same id being encoded a second time inside the merchant order number as a fallback. We do not send WeChat Pay your e-mail address, name or postal address, and no card data passes through us: card details live only inside WeChat Pay\'s own channel. **But do not read this as "no identifier reaches the payment provider"** — that would be false, and `attach` is in the request body. Also: WeChat Pay is the only payment rail, and it is enabled only when a deployment supplies its credentials; without them, the payment callback endpoint simply returns 404.',
      },
      {
        kind: 'p',
        text: '**About push.** An `endpoint` is an address your browser or operating system hands out meaning "deliver to this device", which makes it a credential in its own right (whoever holds it can post arbitrary payloads to that device). We store it as a credential: never written to logs, never echoed back by the admin console. The push service therefore sees that *some* endpoint is being delivered to repeatedly, but **cannot read the content** — the payload is encrypted (aes128gcm) and the only push semantic we currently use is a fixed string meaning "refresh the desktop widget", carrying no user content whatsoever. None of this exists unless you turn on reminder notifications.',
      },
      {
        kind: 'callout',
        text: '🟡 On the nature of row 1: Tencent Cloud stores and operates data strictly on our instructions, so it is an **entrusted processor**, not a party to whom we "provide" personal information. That means no separate consent is required — but it does mean disclosure is required, and a contract annex fixing purpose, means, scope and security duties. Two further facts we are obliged to state: ① the daily backup is a whole-database snapshot, and the account-side dump **contains cleartext e-mail addresses, password hashes and passkey credentials**; ② if the deployment enables off-site upload, that snapshot is also handed to whichever remote storage provider was configured — again a choice made by whoever deploys, with no name hard-coded in the code.',
      },
    ],
  },
  {
    id: 's3',
    title: 'Requests sent straight from your device: you choose the destination',
    blocks: [
      {
        kind: 'p',
        text: 'The four rows below are **not "provision by us to a third party"** — you decide the purpose and the means, and the request goes out directly from your own device without passing through us. They still belong in this list, because they are precisely the flows you would have difficulty discovering on your own, and because the recognition method asks for disclosure that is truthful and complete rather than disclosure that flatters us.',
      },
      {
        kind: 'table',
        head: ['Where your device connects directly', 'What leaves', 'Why we do not choose it for you', 'Where the switch is'],
        rows: [
          [
            'A sync server you host yourself (the address you type in settings)',
            'The same **ciphertext sync events plus plaintext sync metadata** as the hosted instance would see',
            'You typed the address, and the data goes out from your device',
            'It does not exist until you fill it in; deleting the sync configuration stops it',
          ],
          [
            'The AI endpoint you configure',
            '🔴 **Verbatim cleartext**, field by field per feature: task titles, task note bodies, the sentence you just typed',
            'heyta deliberately **ships no cloud preset**; both built-in presets point at your own machine',
            'Three gates, all off by default: the AI master switch, "allow remote", and per-feature egress authorisation',
          ],
          [
            'The system share sheet (mobile export)',
            'Cleartext JSON: materialised data plus the full operation log, deletion tombstones included',
            'You pick an app or a folder in your operating system\'s own sheet',
            'The export action is initiated by you; nothing happens if you do not export',
          ],
          [
            'The local API / MCP server (loopback address only)',
            'Inverted: **other programs on your machine read your data**',
            'It is that program handling data on your behalf, under your authorisation',
            'Master switch off by default, every tool individually off by default, plus an access token',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'Two entirely different things are called "cross-border" here, and they must not be read together. What travels through our servers is not your decision: those servers are in **mainland China**, and if you do not use sync, that case simply does not arise. But **a destination you configure yourself constitutes a cross-border transfer made by you** — if you type in the address of an inference service located abroad, you are the handler of that transfer. We do not assess destinations on your behalf, and we will not dress that up as one of heyta\'s security assurances.',
      },
      {
        kind: 'p',
        text: 'One sentence about the AI path must be written plainly and not softened: what leaves is **the original cleartext**, not a summary and not a de-identified form; the length cap is truncation protection, not anonymisation. Alongside it stands one genuinely reassuring fact that we can prove: the request goes **from your device straight to the endpoint you configured**, without our involvement, and we cannot see its content. The API key has no field in which it could be stored in plaintext — configuration holds only a reference (`keyRef`), resolved from your system\'s secure store at call time, and it is never handed to us either.',
      },
      {
        kind: 'callout',
        text: '🟡 A sentence that is easy to misread: a model running on `localhost` / `127.0.0.1` (local Ollama, local LM Studio) is **not an outbound request**. The test looks only at whether the address is literally a loopback one and **performs no name resolution** — so a local-network name such as `http://my-nas.local:11434` is treated as remote and requires your per-feature authorisation. That is a trade-off, not a defect: a `.local` name can point at any host on your network.',
      },
      {
        kind: 'docRef',
        docId: 'ai-and-transfer',
        text: 'Which fields leave for each AI feature, where each of the three gates sits in the request path, and why withdrawing authorisation takes effect immediately but does not recall a request already sent, are set out in the AI and Data Transfer notice.',
      },
    ],
  },
  {
    id: 's4',
    title: 'What we have not integrated (answered item by item)',
    blocks: [
      {
        kind: 'p',
        text: 'This section is a table rather than a slogan. An absolute negation ("we would never integrate any tracking") is invalidated on the spot by any single new dependency and cannot be falsified; an **item-by-item "no"**, by contrast, can be re-run by you and checked against a packet capture. The method: search the server and frontend sources for each keyword listed below and count the hits, and separately check the runtime dependency list and the lockfile for any observability component.',
      },
      {
        kind: 'table',
        head: ['Category', 'Integrated?', 'Basis (as of 2026-10-01)'],
        rows: [
          ['Analytics / behavioural tracking SDK', 'No', 'Item-by-item search for `analytics`, `telemetry`, `logEvent`, `track(` returns zero hits'],
          ['Advertising / attribution SDK', 'No', '`gtag`, `ga(`, `hotjar`, `clarity`, `openreplay` return zero hits'],
          ['Crash and error reporting SDK', 'No', '`sentry`, `bugsnag`, `captureException`, `crash` return zero hits; the lockfile likewise'],
          ['Push SDK on mobile (Firebase / Getui / vendor channels)', 'No', '🔴 The mobile app requests no notification permission and shows reminders in-app only; Web push uses the browser\'s standard capability, not an SDK'],
          ['Social sign-in SDK (WeChat / QQ / Google / Apple)', 'No', 'Sign-in has exactly two paths — e-mail plus password, or passkey. No third-party login component'],
          ['Remote web fonts / third-party CDN scripts', 'No', 'No external CDN, no remote stylesheet import, no Google Fonts anywhere in the frontend sources'],
          ['App Store in-app purchase (Apple / Google / Huawei)', 'No', 'WeChat Pay is the only payment rail; no store IAP is wired up'],
          ['Maps / location / health-data services', 'No', 'No related code, and no related permission is requested'],
        ],
      },
      {
        kind: 'p',
        text: 'Three honest limits, which are worth more than a bare "all no": ① the searches above cover **source code** on the server and the frontend — not the network behaviour of third-party packages inside build artefacts, and not other links in your own network path; ② one case-insensitive hit did turn up and was a **false positive** (a substring of a function name in the price book looked like `sentry`); it is not Sentry, and we did not change our wording because of it; ③ this table holds only for **the client version this file\'s version refers to** — the moment any of these is integrated, the table must be amended before the release ships, or we fall squarely under item 9 of the third category of the recognition method.',
      },
      {
        kind: 'p',
        text: 'One residual fact registered in passing, since it affects verifiability even though it does not change the privacy conclusion: `bcryptjs` is still in the server dependency list while no product code calls it (password hashing uses Argon2id). It sends nothing anywhere, but it does appear in a third-party component inventory, so we list it here rather than quietly deleting it from this table.',
      },
      {
        kind: 'callout',
        text: 'Why this table deserves to be believed: it publishes a **reproducible method** (the keyword list, the dependency list, the lockfile) instead of a promise. Anyone can re-run it against the build in their hands; if the result disagrees with this table, that is our error to fix.',
      },
    ],
  },
  {
    id: 's5',
    title: 'Who is accountable for this data, and how to reach us',
    blocks: [
      {
        kind: 'p',
        text: 'An outward-facing inventory has to land on an operator that can actually be contacted (the Network Data Security Management Regulations require the operator\'s name and contact details to be published). The following is the single source of truth for that within this file.',
      },
      {
        kind: 'table',
        head: ['Item', 'Detail'],
        rows: [
          ['Legal name', '晓黎（杭州）人工智能科技有限公司 (Xiaoli (Hangzhou) Artificial Intelligence Technology Co., Ltd.)'],
          ['Unified social credit code', '91330106MAKNJ6DX7M'],
          ['Legal representative', 'Deng Xianglei'],
          ['Registered address', 'Room 210, Building 3, Jiangcun Business Center, 830 Wenyi West Road, Jiangcun Subdistrict, Xihu District, Hangzhou, Zhejiang, China'],
          ['Contact e-mail', 'heyta@waytofuture.cn'],
          ['ICP filing number (primary domain)', '浙ICP备2026081423号'],
        ],
      },
      {
        kind: 'p',
        text: '🔴 **The App filing number has not been approved yet**, so it appears nowhere in this file and is not guessed or placeholdered; once approved it will be added as a standalone revision with a version bump. The same discipline applies to contact details: apart from the one e-mail address above, we publish **no** telephone number and no customer-service hours, and this file does not invent them.',
      },
      {
        kind: 'p',
        text: '🟡 Two gaps are left **for counsel to close before this text becomes final**, and without them it is not complete: ① the full legal names, contact details and countries of the two recipients WeChat Pay and haveibeenpwned (absent from the archaeological sources — we will not guess); ② the actual mail provider and push channel configured by the official hosted instance. Until both are filled in, this file remains `draft` and the page shows a "not yet in effect" banner.',
      },
      {
        kind: 'ul',
        items: [
          'Do not enable sync: rows 2–5 of Section 2 still occur (they are inherent to the account and to payment), but your task content no longer leaves your device even as ciphertext.',
          'Do not enable remote AI and do not configure a self-hosted server: Section 3 is empty in its entirety.',
          'Do not turn on reminder notifications: the push row never occurs.',
          'Close your account: the server deletes synced data, device records, credentials, subscriptions and orders by foreign-key cascade. Backups are whole-database snapshots and **there is no capability in the code to excise one record from a backup** — we state that plainly in Your Data Rights rather than promising instant removal from backups.',
        ],
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: 'Which route to take for access, portability, correction, deletion or account closure, and what response time to expect, is described in Your Data Rights.',
      },
    ],
  },
  {
    id: 's6',
    title: 'When this list changes, and what prevails if it disagrees with reality',
    blocks: [
      {
        kind: 'p',
        text: 'Only three things can add to this list: ① a new third-party service is integrated (any of payment rails, mail, push, crash reporting, store IAP, hosted AI); ② a deployment switches mail provider or push channel; ③ a regulatory requirement changes the shape of the disclosure. **In every case this file is amended and its version bumped before the release ships**, and consent is obtained again as required by Article 14(3) of PIPL.',
      },
      {
        kind: 'ul',
        items: [
          'Evidence: an item-by-item code review of the outbound surfaces of the heyta server, the clients and the AI path — every request that sends data anywhere, every place mail is sent, every kind of backup and how long it is kept. Each claim in this document points back to a specific piece of code; the review itself ships with the source and anyone can re-check it line by line.',
          'Division of labour with the Personal Information Collection Inventory: that document answers what is stored, where and for how long; this one answers what left us and whose hands it reached. Where the two disagree about a recipient, this document\'s wording about the recipient prevails.',
          'Division of labour with the App Permissions Inventory: that one covers the gates your operating system holds for you (prompts you can refuse); this one covers data flows that never prompt. Neither can substitute for the other.',
        ],
      },
      {
        kind: 'p',
        text: 'If this list ever disagrees with the network behaviour you actually observe: ① read the version and date at the top of this file — it makes a statement **about a specific version**, not an eternal one; ② **the network behaviour of the build on your device is authoritative**; ③ please report the discrepancy to us as a defect. We treat it as something broken on our side, not something to be explained away. Store review and regulatory testing cross-check a static feature scan plus a dynamic domain capture against this list, and a mismatch is itself the violation — which is why we would rather write a list that makes us look uncomfortable than one that does not match.',
      },
      {
        kind: 'docRef',
        docId: 'personal-info-list',
        text: 'What personal information is collected, at which storage tier it lives and for how long it is kept is set out in the Personal Information Collection Inventory.',
      },
      {
        kind: 'docRef',
        docId: 'permissions',
        text: 'Which permissions heyta declares on each platform, and what still works if you decline, are set out in the App Permissions Inventory.',
      },
    ],
  },
] as const;

export const thirdParties: LegalDocument = {
  id: 'third-parties',
  version: '1.0',
  status: 'draft',
  updatedDate: '2026-10-01',
  title: {
    'zh-CN': '第三方与共享清单',
    en: 'Third Parties and Data Sharing Inventory',
  },
  summary: {
    'zh-CN':
      '数据离开 heyta 的全部去向：由我们服务器发出的四类对外请求与承载它们的云基础设施，由你的设备直接发出的四条，以及逐项列明为「否」的未接入清单 —— 按目的地写，不按服务商名单写。',
    en:
      'Every destination your data can reach: the four classes of request sent from our servers and the infrastructure that hosts them, the four flows sent straight from your device, and an item-by-item list of what is not integrated — organised by destination, not by vendor name.',
  },
  sections: { 'zh-CN': zh, en },
};
