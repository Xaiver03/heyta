/**
 * 个人信息收集清单
 * =================
 *
 * 法定出处：《工业和信息化部关于开展信息通信服务感知提升行动的通知》（工信部信管函〔2021〕292号）
 * 要求建立「已收集个人信息清单」并在 App 二级菜单中展示；《网络数据安全管理条例》第二十一条第 2 款
 * 把「以清单等形式列明」升到了**行政法规**层级；《认定方法》第二类第 1 项的判据是「**未逐一列出**」。
 * 字段模板见 `docs/research/legal-pipl-baseline.md` §5.2 A。
 *
 * 🔴 **这一份的写法：一行一个字段，不许写"账号信息"这种笼统词。**
 * 「逐一列出」是判违规的字面标准，而 §5.2 给的模板有 9 列，本 schema 的表格放不下 9 列，
 * 所以按**数据类别**拆成五张表（A 你输入的 · B 账户与凭据 · C 服务端明文元数据 ·
 * D 仅本机 · E 敏感），每张 3 到 5 列，把「保存期限」单独收成 s7 一张短表。
 * 拆表不是简化 —— 每一行仍然是一个字段级条目。
 *
 * 🔴 **全套文本里最容易写成虚假陈述的一列是「存储位置」。**
 * 三条纪律，都有代码考古做依据：
 * ① 本地是**明文**：端到端加密只覆盖同步通道，不覆盖磁盘静态存储
 *    （`docs/research/legal-dataflow-client.md` B12）；
 * ② 服务端只有**密文**内容 + **明文**元数据，元数据那 11 项必须逐项列（表 C 就是为这件事存在的），
 *    不能写成「我们什么都看不到」（`docs/research/legal-dataflow-server.md` A2 结论 2）；
 * ③ 入站闸门是**形状检查**而非密文证明，且只约束入站、不追溯清洗存量（同上 A2 结论 3、4）。
 *
 * ⚠️ 「敏感个人信息」那张表（s6）的诚实结论是**不收集**，但它有两个必须写出的限定：
 * 用户自己写进任务内容里的健康/宗教/财务字样，以及**不满十四周岁未成年人的信息在定义上就是**
 * 敏感个人信息（PIPL 第二十八条末句）—— 后者指向 `docId: 'minors'`，不在本文件里回答。
 */

import type { LegalDocument } from '../types.js';

const zh = [
  {
    id: 's1',
    title: '这份清单怎么看',
    blocks: [
      {
        kind: 'p',
        text: '这份清单逐项列出 heyta 会保存哪些与你有关的信息：每项用来做什么、怎么来的、存在哪里、存多久。它和《隐私政策》的分工是——政策讲原则和法律依据，这里只讲**一行一条的事实**，因为监管的判据是「有没有逐一列出」。',
      },
      {
        kind: 'p',
        text: '看懂下面三个**存储位置**的档次，就看懂了 heyta 的隐私模型。每个档次都对应真实存在的代码路径，不是承诺。',
      },
      {
        kind: 'ul',
        items: [
          '**仅本机**：只在你当前这台设备或这个浏览器里，以可以直接读出来的文字形式存在。我们不接触它，换设备也不会跟过去。',
          '**本机 + 服务器密文**：内容先在你的手机或电脑上加密，服务器收到的是密文。里面的文字我们读不出来，也不提供解密工具。',
          '**服务器明文**：为了让同步、账号、计费能工作，服务器必须以可读形式保存的少量字段——只有邮箱，以及表 C 那 11 项结构元数据。',
        ],
      },
      {
        kind: 'callout',
        text: '一句必须说清的话：你的任务标题、备注、便签、习惯名，**只有在你自己的设备上是明文；到了服务器的一律是密文**。这不是「我们承诺不看」，而是我们手上没有钥匙。但它**不覆盖元数据**——表 C 就是把我们看得到什么写清楚。',
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: '这些信息的处理目的、法律依据与我们的身份，见《隐私政策》。',
      },
    ],
  },
  {
    id: 's2',
    title: '表 A：你主动输入的内容',
    blocks: [
      {
        kind: 'p',
        text: '下表每一项都是**你在应用里敲出来或点出来的**，没有一项是自动采集的。「收集方式」这一列全表都是「你输入 / 你选择 / 你的操作产生」——这是 heyta 作为本地优先工具最根本的一条事实。',
      },
      {
        kind: 'table',
        head: ['信息项', '使用目的', '收集方式', '存储位置', '是否必要'],
        rows: [
          [
            '任务标题',
            '建立一条待办事项',
            '你在输入框敲入',
            '仅本机明文；开启同步后服务器存密文',
            '基本功能必需',
          ],
          [
            '任务备注正文',
            '记录这条任务的补充说明',
            '你输入',
            '仅本机明文；服务器存密文',
            '非必要',
          ],
          [
            '截止时间与提醒时间',
            '到期提醒、今天视图与日历视图',
            '你选择日期与时间',
            '仅本机明文；服务器存密文',
            '非必要',
          ],
          [
            '优先级与四象限标记',
            '排序与象限视图',
            '你点选',
            '仅本机明文；服务器存密文',
            '非必要',
          ],
          [
            '完成状态与完成时间',
            '记录这条是否做完、什么时候做完',
            '你勾选',
            '仅本机明文；服务器存密文',
            '基本功能必需',
          ],
          [
            '重复规则',
            '完成后自动顺延出下一条',
            '你设置规则',
            '仅本机明文；服务器存密文',
            '非必要',
          ],
          [
            '清单（项目）名称与颜色',
            '把任务分组',
            '你命名；颜色由你从固定色槽里选',
            '仅本机明文；服务器存密文',
            '非必要',
          ],
          [
            '标签名称',
            '跨清单交叉归类',
            '你输入',
            '仅本机明文；服务器存密文',
            '非必要',
          ],
          [
            '习惯名称与每日打卡记录',
            '连续性统计与成长视图',
            '你命名、你勾选',
            '仅本机明文；服务器存密文',
            '非必要',
          ],
          [
            '便签正文',
            '记事',
            '你输入',
            '仅本机明文；服务器存密文',
            '非必要',
          ],
          [
            '专注（番茄钟）时长记录',
            '时长统计，也作为你开启估时功能时的历史参考',
            '你开始专注后由应用记录时长数字',
            '仅本机明文；服务器存密文',
            '非必要',
          ],
          [
            '任务归属与父子关系',
            '把任务归入某个清单或某条父任务',
            '你拖动或在选择器里选',
            '仅本机明文；服务器存密文',
            '非必要',
          ],
          [
            'AI 偏好纠正标记',
            '让 AI 不再按某条推断结果回答你',
            '你在 AI 建议上点「不再这样」',
            '仅本机明文；开启同步后服务器存密文',
            '非必要',
          ],
        ],
      },
      {
        kind: 'p',
        text: '最后一行要说细一点：那条被同步的**只是一个偏好标识**（封闭词表里的机器名，如「估时偏差」「高效时段」）和一个「抑制」动作，**不含任务标题、不含任何正文**。它是一条会被加密同步的事件，但同步的不是「你的画像内容」。',
      },
    ],
  },
  {
    id: 's3',
    title: '表 B：账户与凭据',
    blocks: [
      {
        kind: 'p',
        text: '这一组**只有在你开启同步、注册账号之后**才存在。不注册也能用满本地功能，所以整张表对「基本功能」而言都是非必要——这是产品形态，不是客套。',
      },
      {
        kind: 'table',
        head: ['信息项', '使用目的', '收集方式', '存储位置与形态', '是否必要'],
        rows: [
          [
            '电子邮箱地址',
            '账号唯一标识、登录、发送验证与找回邮件',
            '你输入',
            '🔴 服务器明文。这是全部账号数据里**唯一的直接标识符**',
            '同步服务必需',
          ],
          [
            '登录口令',
            '邮箱 + 口令方式的认证',
            '你设置',
            '服务器只存 Argon2id 哈希（加盐 + 服务器侧秘密 pepper），**不可逆**；数据库里没有明文列也没有可逆列。E2EE 口令只在内存，绝不落盘',
            '用邮箱口令登录时必需',
          ],
          [
            '通行密钥（passkey）凭证',
            '免口令登录',
            '你的设备生成密钥对，注册时把公钥交给我们',
            '服务器存公钥、凭据句柄、签名计数器与传输方式；🔴 **私钥从不离开你的设备**',
            '非必要（可改用邮箱口令）',
          ],
          [
            '设备 `clientId`',
            '同步冲突的确定性决胜依据',
            '应用首次启动时在本机随机生成',
            '仅本机 + 每条同步事件都带着它，服务器明文',
            '同步必需',
          ],
          [
            '同步游标与各设备各自的改动计数',
            '断点续传、判断两条修改谁先谁后',
            '同步协议在处理过程中产生',
            '服务器明文（逐项见表 C）',
            '同步必需',
          ],
          [
            '会话令牌（JWT）',
            '让浏览器在刷新后不必重新登录',
            '服务端签发',
            'Web 落 `localStorage`，🔴 明文不额外加密，依赖浏览器同源隔离；移动端**只在内存**，冷启动需重填',
            '同步必需',
          ],
          [
            '一次性令牌（邮箱验证 / 魔法登录 / 找回通行密钥 / 重置口令）',
            '完成这四个自助流程',
            '服务端随机生成，经邮件送达',
            '服务器**只存其 SHA-256 哈希**；🔴 但在邮件通道里链接是明文——端到端加密不延伸到电子邮件',
            '相应流程必需',
          ],
          [
            '推送订阅（端点 URL + 两个密钥）',
            '把提醒与小组件刷新信号送达你的浏览器',
            '浏览器生成，你开启后交给我们存储',
            '服务器明文（端点 URL 本身就是能力地址）；🔴 它不写进日志',
            '非必要',
          ],
          [
            '设备记录：你自己起的设备名、User-Agent、App 版本、最后使用时间',
            '让你在设备上分得清「哪台是哪台」',
            '设备名你起；其余由客户端上报与服务端接收',
            '服务器明文',
            '非必要',
          ],
          [
            '订阅、订单与邀请关系',
            '权益判定、对账、核验「谁邀请了谁」并发放奖励',
            '你下单；邀请关系由注册链接携带的邀请码生成',
            '服务器明文。🔴 **不含卡号、CVV、IBAN、钱包账号、账单地址**——库里根本没有这些列',
            '购买或使用邀请时必需',
          ],
          [
            '账号语言',
            '决定服务端发给你的邮件与凭据页用中文还是英文',
            '你在设置里切换',
            '服务器明文（未设置时为空，表示从未改过）',
            '非必要',
          ],
          [
            '昵称（显示名）',
            '让你在自己的设备上认出一个账号是谁的；不用于向他人展示',
            '你自填，可留空',
            '服务器明文。**它不是实名、不做唯一性**，登录标识始终是上面那行邮箱；🔴 heyta 没有共享与协作，所以今天**只有你本人**读得到它——服务端也没有按他人身份查它的端点',
            '非必要（留空即回落到邮箱派生的显示名）',
          ],
          [
            '头像图片',
            '同上：只给你自己看',
            '你选一张，应用在本机把它压成小方形后上传',
            '🔴 **服务器密文**（用它自己的 Argon2id + AES-GCM 口令加密后整块存二进制，我们解不开）。服务器上另存该密文的 SHA-256，只用于跨设备判断"换过没有"；原图不存磁盘、不进对象存储。两条边界：① 它需要**已设置 E2EE 口令**才能上传与读回；② 密文相同即哈希相同，严格说这一点泄露"同一张图重复上传过"',
            '非必要',
          ],
        ],
      },
      {
        kind: 'p',
        text: '一句能逐项核对的话：账号表里**没有真实姓名、没有电话、没有地址、没有生日、没有地理位置、没有通讯录**；昵称是你自填的显示名（不是实名、不做唯一），头像是我们**解不开的密文**。列清单就是上面这些。',
      },
      {
        kind: 'callout',
        text: '两项**用户之间的可见性**，很多清单会漏掉，我们写出来：① 你邀请别人之后，你在自己的「活动」页能看到对方邮箱 `@` 之前那一段（不是全址），且这个值会作为历史快照**长期保留**；② 我们的运营人员能看到邀请关系**两端的邮箱全址**，以及订阅、订单金额与设备清单。口令哈希、任何一次性令牌、通行密钥公钥、同步内容（只能数条数）与推送端点都**不在**后台可见范围内。',
      },
    ],
  },
  {
    id: 's4',
    title: '表 C：服务器为完成同步而保存的明文元数据',
    blocks: [
      {
        kind: 'p',
        text: '这一张表是「我们看不到内容，但看得到形状」这句话的证据。下列 11 项**不是**我们从密文里破出来的，而是同步协议本身必须以可读形式保存的字段——每一条上传的同步事件都带着它们。',
      },
      {
        kind: 'table',
        head: ['明文元数据', '它能告诉我们什么', '为什么同步离不开它'],
        rows: [
          [
            '`entityType`',
            '这条事件关于哪一类对象：任务、清单、标签、习惯、全局配置……',
            '回放时要决定把这条事件应用到哪一类数据上',
          ],
          [
            '`entityId` / `entityIds`',
            '具体是哪一个对象；批量操作覆盖了哪些对象',
            '并发冲突检测要按同一个对象把两条事件找出来',
          ],
          [
            '`opType`',
            '动作类型：新增、更新、删除、修复',
            '事件溯源的回放顺序与墓碑语义',
          ],
          [
            '`actionType`',
            '比动作类型更细一层的操作分类',
            '同上：让两端算出同一个结果',
          ],
          [
            '`vectorClock`',
            '这个账号用过几个 `clientId`，以及每个客户端各自的逻辑计数',
            '判断两条事件谁因果在前、还是并发',
          ],
          [
            '`clientTimestamp`',
            '你的设备**声称**的操作时刻',
            '确定性排序，以及并发时的决胜',
          ],
          [
            '`receivedAt`',
            '服务器收到这条事件的时刻',
            '保留期计算与运维诊断',
          ],
          [
            '`serverSeq`',
            '这条事件在该账号内的全局顺序号',
            '下载游标与断点续传',
          ],
          [
            '`payloadBytes`',
            '这条事件加密之后有多大',
            '配额与体积闸门（只记字节数，不记内容）',
          ],
          [
            '`schemaVersion`',
            '客户端写这条事件时用的数据模型版本',
            '跨版本兼容判定',
          ],
          [
            '`clientId`',
            '哪台设备写的',
            '并发修改的最终决胜依据，保证所有设备收敛到同一结果',
          ],
        ],
      },
      {
        kind: 'p',
        text: '把它们组合起来，足以刻画「谁、在什么时候、对哪一类对象里的哪一个、做了什么、多大」——即使内容一个字都读不出来。数据大小与请求频率本身也能透露信息。**所以我们不打「我们什么都看不见」的广告**：端到端加密覆盖的是内容，不覆盖结构、顺序、时间、大小与设备。',
      },
      {
        kind: 'p',
        text: '一项常被问到的：IP 地址**不写进数据库**，它只被用作限流键，并出现在两类安全审计事件里（支付回调验签失败、权益拒绝）。此外服务端**不记录 HTTP 访问日志**。',
      },
      {
        kind: 'callout',
        text: '两个必须一起写的限定：① 服务端的「只收密文」入站闸门做的是**形状检查**，不是密文证明——它会拒绝没有加密标志、或不呈密文形状的上传，但足够长的 base64 明文在形状上也能通过；② 该闸门只约束**新上传**，不追溯清洗历史遗留的行。因此准确的表述是「服务端不持有解密所需的密钥」，而不是「服务端可验证收到的每个字节确为密文」。',
      },
    ],
  },
  {
    id: 's5',
    title: '表 D：仅存在于本机、不会同步的',
    blocks: [
      {
        kind: 'p',
        text: '下面这些只在你当前这台设备或这个浏览器里。它们不跟随同步到其他设备，服务器也拿不到它们。',
      },
      {
        kind: 'table',
        head: ['信息项', '为什么留在本地', '存储位置与形态', '怎么清掉'],
        rows: [
          [
            '同步凭据：服务器地址 + 访问令牌 + 邮箱',
            '刷新页面后不必重新登录',
            '🔴 Web 的 `localStorage`，明文不额外加密',
            '点「退出登录」即清；或由浏览器清除站点数据',
          ],
          [
            'E2EE 口令',
            '它是「解不开就等于没同步」的最后一道',
            '🔴 只在内存，**绝不落盘**（移动端连地址与令牌都不落盘）',
            '关闭应用即消失，下次需重新输入',
          ],
          [
            '界面设置：视图选择、分组折叠状态、主题',
            '每台设备屏幕不同，本来就不该同步',
            '本机存储，明文',
            '卸载应用或清除浏览器站点数据',
          ],
          [
            'AI 配置：端点地址、模型名、逐功能开关、出境授权记录',
            '「数据发到哪」是你的决定，不是我们的',
            'Web 的 `localStorage`，明文；🔴 但配置里**没有密钥字段**',
            '在设置里删除端点；或清除浏览器站点数据',
          ],
          [
            'AI 密钥引用（`keyId` / `secretSlot`）',
            '配置里只留一个指针，不留密钥本体',
            '桌面与命令行宿主走**系统钥匙串**（macOS Keychain），不落明文密钥',
            '在系统钥匙串里删除，或在设置里移除端点',
          ],
          [
            '本地操作日志与它还原出来的当前内容（你的全部数据主体）',
            '本地优先：离线也必须能用',
            '本机的数据库文件 / 浏览器自带的本地存储，🔴 **明文**；移动端未启用数据库加密',
            '卸载应用（系统删除沙盒文件）或清除站点数据',
          ],
          [
            '桌面小组件快照',
            '让系统桌面卡片跨进程读到内容',
            '应用私有容器 / App Group，**AES-256-GCM 密文**，密钥不离开系统安全存储——本地明文规则下唯一的例外',
            '关闭小组件；退出登录时一并清除',
          ],
          [
            '导出文件',
            '查阅与复制权要能真的拿走数据',
            '你选定的目录，🔴 **明文 JSON、不设防**，谁拿到谁能读',
            '由你自己保管与删除',
          ],
        ],
      },
      {
        kind: 'p',
        text: '一处必须逐端说清、不能拿一份最全的说法套所有端：**移动端的所有凭据（地址、令牌、口令）刻意完全不落盘**，冷启动后都要重填；Web 的同步凭据落 `localStorage` 且是明文。两者是不同的取舍，也不同风险。另有一条要说白：**目前任何一端都没有「一键抹掉本机全部数据」的按钮**——彻底清除本机明文数据要靠卸载应用或清除浏览器站点数据。',
      },
    ],
  },
  {
    id: 's6',
    title: '表 E：敏感个人信息',
    blocks: [
      {
        kind: 'p',
        text: '《个人信息保护法》第二十八条把「一旦泄露或者非法使用，容易导致自然人的人格尊严受到侵害或者人身、财产安全受到危害」的个人信息列为敏感个人信息，并列举了生物识别、宗教信仰、特定身份、医疗健康、金融账户、行踪轨迹，以及不满十四周岁未成年人的个人信息。我们逐项对照 heyta 的实际数据流：',
      },
      {
        kind: 'table',
        head: ['第二十八条列举的类别', 'heyta 是否收集', '依据什么这么说'],
        rows: [
          [
            '生物识别',
            '❌ 不收集',
            '通行密钥的指纹或面部匹配在你的设备安全芯片内完成。我们只拿到公钥、凭据句柄与签名计数器，**没有任何生物特征模板离开你的设备**，也不采集认证声明数据',
          ],
          [
            '宗教信仰',
            '❌ 不收集',
            '没有这个字段，也不做任何分类判断',
          ],
          [
            '特定身份',
            '❌ 不收集',
            '不采集身份证号、护照、社保号、人脸比对',
          ],
          [
            '医疗健康',
            '❌ 不收集',
            '不接入任何健康数据源。习惯名由你自己填写：若你写了「服药」「就诊」，那段文字**只在你设备本地是明文**，到服务器是密文，我们不判断它是什么',
          ],
          [
            '金融账户',
            '❌ 不收集',
            '库里没有卡号、CVV、IBAN、钱包账号、账单地址这些列；实际收付款在你的银行与钱包侧完成',
          ],
          [
            '行踪轨迹',
            '❌ 不收集',
            '不申请位置权限，不采集经纬度、Wi-Fi、基站信息，也不做后台位置轮询',
          ],
          [
            '不满十四周岁未成年人的个人信息',
            '🔴 **一旦出现，定义上就是敏感个人信息**',
            '这是第二十八条的末句，不需要再论证。我们不主动核实年龄，因此这条走独立的一份专门规则作答 ↓',
          ],
        ],
      },
      {
        kind: 'p',
        text: '所以结论是：**heyta 不主动收集任何敏感个人信息**，也不因为某条任务「看起来像健康或财务内容」而把它标记成敏感数据。这个结论建立在「我们不判断内容」这个前提上，不是建立在「我们看不到内容」上。',
      },
      {
        kind: 'callout',
        text: '两个诚实的限定，缺一个这条结论就是夸大：① 任务与便签的内容**可能**包含你自己写进去的健康、宗教、财务或行踪字样。我们不判断、不分类、不主动提取；但一旦你开启了 AI 功能并确认把这条内容发给模型，那段文字会以**明文**离开设备——按发送内容逐项列明的方式请你先自己看一眼。② 通行密钥凭证不属于第二十八条列举的敏感个人信息（它是设备绑定的公钥凭证，生物特征不出设备），但我们仍按高一级强度保护它：不进后台响应、不进日志。这一项的法律定性建议由法务最终确认。',
      },
      {
        kind: 'docRef',
        docId: 'minors',
        text: '未成年人（含不满十四周岁）的个人信息处理规则见《未成年人保护与年龄声明》。',
      },
    ],
  },
  {
    id: 's7',
    title: '保留期限一览',
    blocks: [
      {
        kind: 'p',
        text: 'PIPL 第十九条要求保存期限是「为实现处理目的所必要的最短时间」；《网络数据安全管理条例》第二十一条第 3 项还要求：期限确实难以确定的，要写明**确定方法**。下面左列是我们现在真的在执行的取值，不是目标值。',
      },
      {
        kind: 'table',
        head: ['数据', '保存期限', '到期后的处理'],
        rows: [
          [
            '同步事件（密文操作日志）与设备记录',
            '**45 天窗口**，但两类要分开说：**设备记录**确实按这个窗口每日清扫；**同步事件当前一条都不会被清掉**——那条清扫只处理已经存在「完整状态边界」的账号，而本产品当前的客户端不会产生这种边界（实测：每日任务的删除条数恒为 0）。窗口本身是代码里的固定常量，改它要发版本',
            '设备记录：超过窗口仍未出现过的行直接删。同步事件：**在当前版本下不删**，保留到账号注销，或保留到清理条件真的具备的那一天。每日任务即使删除条数为 0 也会记一条日志——这是为了将来能证明清扫真的执行过，而不是只看「没报错」',
          ],
          [
            '服务器数据库备份',
            '当前脚本默认 **14 天**',
            '随备份保留期自然过期。⚠️ 备份是整库快照，**代码里没有「从既有备份中定点删除某一位用户的数据」的能力**',
          ],
          [
            '账户、凭据、订阅、订单、邀请与通知记录',
            '直到你**注销账号**',
            '注销走服务端级联硬删：同步事件、设备、通行密钥、订阅、订单、邀请、通知一并消失，同时作废鉴权缓存并断开活动连接。没有冷静期，也没有回收站。🔴 这一行删的是服务端那一份：你其它设备上的本地明文库不会因为注销而消失 —— 今天还没有“账号已注销就清除本机数据”这个动作',
          ],
          [
            '一次性令牌',
            '邮箱验证 24 小时；魔法登录与重置口令 15 分钟；找回通行密钥 1 小时',
            '过期或被使用即失效。数据库里本来就只存哈希，邮件验证通过前暂存的通行密钥注册项也会被定时清理',
          ],
          [
            '本机数据（含明文内容与历史）',
            '只要不删就一直在',
            '应用内删除是**打标记**（墓碑），彻底删除也只是加一个标记而不清历史——本地明文数据不会在磁盘上被物理擦除。物理清除依赖卸载应用或清除浏览器站点数据',
          ],
          [
            '服务器运行日志',
            '见下面那段说明',
            '应用侧不记录 HTTP 访问日志；运行日志走标准输出，是否另写磁盘文件由部署配置决定，**代码里没有轮转与到期删除机制**',
          ],
        ],
      },
      {
        kind: 'p',
        text: '两句要一起写、否则这段会被读成承诺：**45 天是产品当前设定，不是你可以自选的选项**，界面上没有「更短保留期」的开关，改它要发版本。而「你在应用里点了彻底删除」**不会缩短**这个期限——它让这条数据从你的所有设备界面里消失。🔴 还要如实补第三句：按当前版本，服务器上那条加密历史**等不到「保留期届满」**——每日清扫对我们的数据一条都不命中（见上表那一行），它真的不在，目前只有注销账号这一条路。另有一条边界要如实登记：主机与网络层（如前置代理）的访问日志留存由部署环境决定，法定底线是网络日志留存不少于六个月；官方实例当前配置的具体留存期需运营在发布前确认。',
      },
    ],
  },
  {
    id: 's9',
    title: '欧盟 GDPR 口径：这份清单能当哪半份用、不能当哪半份用',
    blocks: [
      {
        kind: 'p',
        text: '这份清单是按《个人信息保护法》的口径写的：它逐类说明收集什么、存在哪儿、服务端能不能读到。GDPR 里最接近它的是第 30 条的处理活动记录（ROPA），但 ROPA 还要求**每一类各自的处理目的、法律依据与留存期** —— 那三列本清单没有，所以这里写清它能顶哪一半、不能顶哪一半，而不是把它改名成 ROPA 交出去。',
      },
      {
        kind: 'table',
        head: ['GDPR 的位置', '它问的是什么', 'heyta 现在拿得出的', '对不上的部分'],
        rows: [
          [
            '第 30 条（处理活动记录）',
            '有没有一份按 GDPR 格式写成的处理活动记录',
            '清单确实逐类写了"存什么、存在哪、谁能读到"，端到端加密那一列还写明服务端只拿到密文',
            '但它**没有**为每一类标出法律依据与留存期，分类也是按中国法而不是按 GDPR 的分组；补上那两列之前，这份文件不能自称 ROPA'
          ],
          [
            '第 9 条（特殊类别数据）对照"敏感个人信息"',
            '两套"敏感"定义是不是同一批数据',
            '清单里的敏感项严格按中国法的列举写，没有擅自加宽也没有收窄',
            '两个集合**不相等**：GDPR 把生物识别与基因数据明确列入第 9 条，中国法的敏感信息口径与之不同。符合这边的表不自动符合那边，所以本文件不做任何一一对应的换算'
          ],
          [
            '第 15 条（访问权）',
            '这份清单是不是"你能看到的关于你的一切"',
            '不是，而且清单自己就这么写：访问权走**导出**，三个端都有，导出含墓碑与完整操作日志',
            '清单给的是类别，不是你的数据本身；而类别表与实际库不一致时以实际数据为准（本文件第八节写明的那条），这类不一致目前没有逐字段的常驻对账'
          ],
          [
            '第 13(1)(c) 条（留存期限或其确定标准）',
            '每一类要写明存多久、按什么标准到期',
            '清单不写期限，期限统一放在《隐私政策》与保留策略里，避免同一件事两处各写一个数字',
            '留存期今天只能写到"标准"而不能写到"日期"：托管侧的备份是整库快照，代码里**没有**"从既有备份中单独删掉某一条或某一个人"的能力，所以任何按类写死的到期日都会变成一句做不到的话'
          ],
        ],
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: '《隐私政策》：处理目的、法律依据与留存期在那里逐条给出；本清单只回答"有哪些类、存在哪儿、服务端看得见吗"。',
      },
    ],
  },
  {
    id: 's8',
    title: '这份清单什么时候会变，不一致时以什么为准',
    blocks: [
      {
        kind: 'p',
        text: '只有三种情况会让这张表新增一行：① 你主动开启的某个功能确实需要（例如接入系统级提醒）；② 新增一类业务实体；③ 计费或法律要求我们多留一项凭证。**新增采集项时我们会先改这份清单、再发版本，并重新请你同意**——PIPL 第十四条第 3 款要求处理目的、处理方式、处理种类变更时重新取得同意，「改个版本号」不算。',
      },
      {
        kind: 'ul',
        items: [
          '逐项事实来源：服务端数据库结构与代码（每一列都能指回具体文件与行号）、各端本地存储的实际路径、各端权限清单文件。',
          '与《应用权限清单》的分界：那份管**系统替你把守的开关**，这份管**信息本身**。同一件事可能两边都出现（例如提醒通知），两边说法必须一致。',
          '与《第三方与共享清单》的分界：这份回答「我们存了什么」，那份回答「这些字节有没有离开过我们」。表 D 里那条「导出的明文件会随你的选择流向任意第三方」只在后者里展开。',
        ],
      },
      {
        kind: 'p',
        text: '本清单与实际实现不一致时，**以实际实现为准，并请把差异当成缺陷报告给我们**。写在文档里但没有代码支撑的承诺，比不写更糟——它同时构成《认定方法》第三类第 9 项「违反其所声明的收集使用规则」。',
      },
      {
        kind: 'docRef',
        docId: 'third-parties',
        text: '这些数据在哪些时刻会离开我们的设备或服务器，见《第三方与共享清单》。',
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: '查阅、复制、更正、删除、注销、撤回同意的实际入口与它们的真实边界，见《你的权利与行使方式》。',
      },
    ],
  },
] as const;

const en = [
  {
    id: 's1',
    title: 'How to read this inventory',
    blocks: [
      {
        kind: 'p',
        text: 'This inventory lists, item by item, every piece of information about you that heyta keeps: what each one is used for, where it comes from, where it is stored, and for how long. The Privacy Policy covers principles and legal bases; this document covers **one row per fact** — because the regulatory test is literally whether items have been "listed one by one".',
      },
      {
        kind: 'p',
        text: 'Once you understand the three tiers in the **Storage location** column below, you understand heyta\'s privacy model. Each tier maps to a code path that actually exists; none of them is a promise.',
      },
      {
        kind: 'ul',
        items: [
          '**On your device only**: present on this one device or browser, stored as text that can be read directly. We never touch it and it does not follow you to another device.',
          '**Device plus server ciphertext**: content is encrypted on your phone or computer first, so the server receives ciphertext. We cannot read the text inside it, and we ship no tooling to decrypt it either.',
          '**Cleartext on our server**: the small set of fields the server must keep in readable form for sync, accounts and billing to work — your email address, and the eleven structural metadata items in Table C.',
        ],
      },
      {
        kind: 'callout',
        text: 'The sentence that has to be said plainly: your task titles, notes, sticky notes and habit names are **cleartext only on your own device; anything that reaches our server is ciphertext**. That is not "we promise not to look" — we simply do not hold the key. But it **does not cover metadata**, and Table C exists precisely to spell out what we can see.',
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: 'Processing purposes, legal bases and who we are: see the Privacy Policy.',
      },
    ],
  },
  {
    id: 's2',
    title: 'Table A: content you type in yourself',
    blocks: [
      {
        kind: 'p',
        text: 'Every item below is **typed or tapped by you inside the app**. Nothing is harvested automatically. The "How collected" column across this whole table reads "you enter it / you pick it / it results from your action" — the most fundamental fact about heyta as a local-first tool.',
      },
      {
        kind: 'table',
        head: ['Item', 'Purpose', 'How collected', 'Storage location', 'Necessary?'],
        rows: [
          [
            'Task title',
            'Create a to-do item',
            'You type it',
            'Cleartext on your device; ciphertext on the server once sync is on',
            'Required for basic functionality',
          ],
          [
            'Task note body',
            'Keep supplementary detail about a task',
            'You type it',
            'Cleartext on your device; ciphertext on the server',
            'Not necessary',
          ],
          [
            'Due date and reminder time',
            'Due reminders, Today view, calendar view',
            'You pick the date and time',
            'Cleartext on your device; ciphertext on the server',
            'Not necessary',
          ],
          [
            'Priority and quadrant markers',
            'Ordering and the quadrant view',
            'You select them',
            'Cleartext on your device; ciphertext on the server',
            'Not necessary',
          ],
          [
            'Completion state and completion time',
            'Record whether and when a task was done',
            'You tick it',
            'Cleartext on your device; ciphertext on the server',
            'Required for basic functionality',
          ],
          [
            'Repetition rule',
            'Roll the next occurrence forward after completion',
            'You set the rule',
            'Cleartext on your device; ciphertext on the server',
            'Not necessary',
          ],
          [
            'List (project) name and colour',
            'Group tasks',
            'You name it; you pick a colour from fixed slots',
            'Cleartext on your device; ciphertext on the server',
            'Not necessary',
          ],
          [
            'Tag name',
            'Cross-list categorisation',
            'You type it',
            'Cleartext on your device; ciphertext on the server',
            'Not necessary',
          ],
          [
            'Habit name and daily check-ins',
            'Streak statistics and the growth view',
            'You name it, you tick it',
            'Cleartext on your device; ciphertext on the server',
            'Not necessary',
          ],
          [
            'Sticky-note body',
            'Free-form notes',
            'You type it',
            'Cleartext on your device; ciphertext on the server',
            'Not necessary',
          ],
          [
            'Focus-session duration records',
            'Time statistics, and as history when you switch on the estimate feature',
            'Recorded as duration figures after you start a session',
            'Cleartext on your device; ciphertext on the server',
            'Not necessary',
          ],
          [
            'Task membership and parent-child links',
            'Put a task in a list or under a parent task',
            'You drag it or pick it in a selector',
            'Cleartext on your device; ciphertext on the server',
            'Not necessary',
          ],
          [
            'AI preference-correction marker',
            'Stop the AI from answering with one inferred preference',
            'You tap "not like this" on an AI suggestion',
            'Cleartext on your device; ciphertext on the server once sync is on',
            'Not necessary',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'The last row deserves detail: what gets synced there is **only a preference identifier** — a machine name from a closed list, such as "estimate bias" or "deep-work window" — plus a "suppress" action. **It contains no task titles and no body text.** It is an encrypted sync event, but what is synced is not a profile of you.',
      },
    ],
  },
  {
    id: 's3',
    title: 'Table B: account and credentials',
    blocks: [
      {
        kind: 'p',
        text: 'This group **only exists after you switch on sync and register an account**. Every local feature works without registering, so the entire table is unnecessary for basic functionality. That is the shape of the product, not a courtesy.',
      },
      {
        kind: 'table',
        head: ['Item', 'Purpose', 'How collected', 'Where it is stored and in what form', 'Necessary?'],
        rows: [
          [
            'Email address',
            'Sole account identifier; sign-in, verification and recovery mail',
            'You type it',
            '🔴 Cleartext on the server. It is **the only direct identifier** in all of your account data',
            'Required for sync',
          ],
          [
            'Account password',
            'Authentication for the email-plus-password method',
            'You set it',
            'The server keeps only an Argon2id hash (per-user salt plus a server-side secret, pepper) and it is **irreversible**; there is no cleartext column and no reversible column. The E2EE passphrase lives in memory only and never touches disk',
            'Required if you sign in with a password',
          ],
          [
            'Passkey credentials',
            'Password-free sign-in',
            'Your device generates a key pair and hands us the public key at registration',
            'The server stores the public key, credential handle, signature counter and transports; 🔴 **the private key never leaves your device**',
            'Not necessary (password sign-in works)',
          ],
          [
            'Device `clientId`',
            'The deterministic tie-breaker for sync conflicts',
            'Generated randomly on this device at first launch',
            'On your device, plus carried by every sync event and kept as cleartext on the server',
            'Required for sync',
          ],
          [
            "Sync cursor and each device's own change count",
            'Resume after a disconnect; decide which of two edits came first',
            'Produced by the sync protocol in flight',
            'Cleartext on the server (item by item in Table C)',
            'Required for sync',
          ],
          [
            'Session token (JWT)',
            'Keep the browser signed in across reloads',
            'Issued by the server',
            'Web: `localStorage`, 🔴 cleartext, not additionally encrypted, relying on browser origin isolation. Mobile: **memory only**, refilled after a cold start',
            'Required for sync',
          ],
          [
            'One-time tokens (email verification / magic login / passkey recovery / password reset)',
            'Complete those four self-service flows',
            'Generated by the server and delivered by email',
            'The server **stores only their SHA-256 hash**; 🔴 but inside the mail channel the link is cleartext — end-to-end encryption does not extend to email',
            'Required for that flow',
          ],
          [
            'Push subscription (endpoint URL plus two keys)',
            'Deliver reminders and widget refresh signals to your browser',
            'Generated by the browser, handed to us for storage when you switch it on',
            'Cleartext on the server (the endpoint URL is itself a capability URL); 🔴 it is never written to logs',
            'Not necessary',
          ],
          [
            'Device records: the name you gave the device, User-Agent, app version, last-seen time',
            'Let you tell one of your devices from another',
            'The name is yours; the rest is reported by the client and recorded on receipt',
            'Cleartext on the server',
            'Not necessary',
          ],
          [
            'Subscriptions, orders and referral relations',
            'Entitlement decisions, reconciliation, and verifying who invited whom before granting a reward',
            'You place the order; referral rows come from the invite code carried at registration',
            'Cleartext on the server. 🔴 **No card number, CVV, IBAN, wallet account or billing address** — those columns do not exist',
            'Required when you buy something or use an invite',
          ],
          [
            'Account language',
            'Decide whether the emails and credential pages we send you are in Chinese or English',
            'You switch it in settings',
            'Cleartext on the server (null means you never changed it)',
            'Not necessary',
          ],
          [
            'Nickname (display name)',
            'Lets you recognise which account is yours on your own devices; it is not used to show you to anyone else',
            'You type it; it may stay empty',
            'Cleartext on the server. **It is not your legal name and is not unique** — the sign-in identifier remains the email address in the row above. 🔴 heyta has no sharing or collaboration, so today **only you** can read it, and the server exposes no endpoint that looks another user’s profile up by identity',
            'Not necessary (when empty, the display name falls back to one derived from your email)',
          ],
          [
            'Avatar image',
            'Same purpose: it is only ever shown to you',
            'You pick one; the app downscales it to a small square on your device before uploading',
            '🔴 **Ciphertext on the server** — encrypted with your own Argon2id + AES-GCM passphrase and stored as one indivisible binary blob we cannot open. The server also stores the SHA-256 of that ciphertext, used only to tell across devices whether it changed. The original file is never written to disk or to object storage. Two boundaries: ① uploading and reading it back require an **E2EE passphrase to be set**; ② identical ciphertext yields an identical hash, so strictly speaking that leaks "the same image was uploaded twice"',
            'Not necessary',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'One sentence that can be checked column by column: the account table holds **no legal name, no phone number, no postal address, no date of birth, no location and no contacts**; the nickname is a display name you type yourself (not your legal name, not unique), and the avatar is a blob **we cannot decrypt**. What is listed above is the entire list.',
      },
      {
        kind: 'callout',
        text: 'Two facts about **visibility between users**, which inventories often omit, stated here: ① after you invite someone, your own Activity screen shows the part of their email address before the `@` sign (never the full address), and that value is kept **indefinitely** as a historical snapshot; ② our operators can see the **full email addresses on both ends** of a referral relation, plus subscriptions, order amounts and device lists. Password hashes, any one-time token, passkey public keys, sync content (only counts are exposed) and push endpoints are **outside** what the admin console can return.',
      },
    ],
  },
  {
    id: 's4',
    title: 'Table C: cleartext metadata the server keeps to make sync work',
    blocks: [
      {
        kind: 'p',
        text: 'This table is the evidence behind "we cannot see the content, but we can see the shape". The eleven items below are **not** recovered from ciphertext — they are fields the sync protocol itself has to keep readable, and every uploaded event carries them.',
      },
      {
        kind: 'table',
        head: ['Cleartext metadata', 'What it tells us', 'Why sync cannot do without it'],
        rows: [
          [
            '`entityType`',
            'Which kind of object the event is about: task, list, tag, habit, global configuration…',
            'Replay has to know which class of data to apply the event to',
          ],
          [
            '`entityId` / `entityIds`',
            'Exactly which object; which objects a batch operation touched',
            'Conflict detection has to find both events on the same object',
          ],
          [
            '`opType`',
            'Kind of action: create, update, delete, repair',
            'Replay ordering and tombstone semantics in an event-sourced log',
          ],
          [
            '`actionType`',
            'A finer classification one level below the action type',
            'Same reason: every device must compute the identical result',
          ],
          [
            '`vectorClock`',
            'How many `clientId` values this account has used, and each client\'s logical counter',
            'Deciding which of two events causally precedes the other, or that they are concurrent',
          ],
          [
            '`clientTimestamp`',
            'The moment your device **claims** the edit happened',
            'Deterministic ordering and tie-breaking under concurrency',
          ],
          [
            '`receivedAt`',
            'The moment our server received the event',
            'Retention-window arithmetic and operational diagnosis',
          ],
          [
            '`serverSeq`',
            'The event\'s global sequence number within this account',
            'Download cursors and resuming after a disconnect',
          ],
          [
            '`payloadBytes`',
            'How large the event is once encrypted',
            'Quota and size gates (byte counts only, never content)',
          ],
          [
            '`schemaVersion`',
            'The data-model version the client used when writing the event',
            'Cross-version compatibility decisions',
          ],
          [
            '`clientId`',
            'Which device wrote it',
            'The final tie-breaker for concurrent edits, so all devices converge on one result',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'Combined, those are enough to describe "who, at what time, against which object of which class, did what, and how big" — even though not one word of content is readable. Sizes and request frequency are themselves informative. **So we do not advertise "we can see nothing"**: end-to-end encryption covers content, not structure, order, timing, size or devices.',
      },
      {
        kind: 'p',
        text: 'A question that comes up often: IP addresses are **never written to the database**. They are used as a rate-limit key and appear in two security audit events (payment callback signature failure, entitlement denial). Beyond that, the server **does not record HTTP access logs**.',
      },
      {
        kind: 'callout',
        text: 'Two qualifications that must be carried along with this table: ① the server\'s "ciphertext only" inbound gate performs a **shape check**, not a proof of encryption — it rejects uploads that lack the encryption flag or do not look like ciphertext, but sufficiently long base64 cleartext would pass the shape test; ② the gate constrains **inbound uploads only** and does not retroactively cleanse historical rows. So the accurate statement is "the server does not hold the key needed to decrypt", not "the server can verify that every byte it receives is ciphertext".',
      },
    ],
  },
  {
    id: 's5',
    title: 'Table D: on your device only, never synced',
    blocks: [
      {
        kind: 'p',
        text: 'Everything below stays on this one device or browser. It does not travel with sync, and our server never receives it.',
      },
      {
        kind: 'table',
        head: ['Item', 'Why it stays local', 'Where it is stored and in what form', 'How to clear it'],
        rows: [
          [
            'Sync credentials: server address + access token + email',
            'So a page reload does not ask you to sign in again',
            '🔴 Web `localStorage`, cleartext, not additionally encrypted',
            'Logging out clears it; or clear site data in your browser',
          ],
          [
            'E2EE passphrase',
            'It is the last gate — no passphrase, nothing decrypts',
            '🔴 Memory only, **never written to disk** (on mobile even the address and token stay off disk)',
            'Gone when the app closes; you re-type it next time',
          ],
          [
            'Interface settings: view choice, section collapse state, theme',
            'Screens differ per device, so they should not sync',
            'Local storage, cleartext',
            'Uninstall the app or clear browser site data',
          ],
          [
            'AI configuration: endpoint address, model name, per-feature switches, egress authorisations',
            '"Where the data goes" is your decision, not ours',
            'Web `localStorage`, cleartext; 🔴 but the configuration **has no key field**',
            'Delete the endpoint in settings, or clear browser site data',
          ],
          [
            'AI key references (`keyId` / `secretSlot`)',
            'The configuration keeps a pointer, never the secret itself',
            'On desktop and CLI hosts the secret lives in the **system keychain** (macOS Keychain); no plaintext key is written',
            'Delete it in the system keychain, or remove the endpoint in settings',
          ],
          [
            'The local operation log and the current content it rebuilds (the bulk of your data)',
            'Local first: everything must work offline',
            'A database file on your device or your browser\'s built-in local storage, 🔴 **cleartext**; the mobile database is not encrypted at rest',
            'Uninstall the app (the OS removes the sandbox files) or clear site data',
          ],
          [
            'Home-screen widget snapshot',
            'So a desktop widget can read the content across processes',
            'Your app\'s private container / App Group, as an **AES-256-GCM envelope** with the key inside system secure storage — the single exception to the cleartext-at-rest rule',
            'Turn the widget off; logging out clears it too',
          ],
          [
            'Export files',
            'The right of access and copy has to actually hand you the data',
            'Whatever directory you chose, 🔴 **plaintext JSON, unprotected** — anyone holding it can read it',
            'Yours to store and delete',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'One point that must be stated per platform instead of applying the most generous description everywhere: **on mobile, all credentials (address, token, passphrase) are deliberately kept off disk** and re-entered after a cold start, whereas on Web the sync credentials are persisted to `localStorage` in cleartext. Different trade-offs, different risks. And one more, said plainly: **no platform currently has a "wipe all local data" button** — physically clearing local cleartext means uninstalling the app or clearing browser site data.',
      },
    ],
  },
  {
    id: 's6',
    title: 'Table E: sensitive personal information',
    blocks: [
      {
        kind: 'p',
        text: 'Article 28 of PIPL defines sensitive personal information as personal information that, if leaked or unlawfully used, is likely to infringe on a person\'s dignity or endanger their personal or property safety, and it enumerates biometric identification, religious beliefs, specific identities, medical health, financial accounts and movement trajectories, **plus personal information of minors under fourteen**. Checked against heyta\'s actual data flows, item by item:',
      },
      {
        kind: 'table',
        head: ['Category under Article 28', 'Does heyta collect it?', 'What that answer rests on'],
        rows: [
          [
            'Biometric identification',
            '❌ Not collected',
            'Fingerprint or face matching for a passkey completes inside your device\'s secure element. We receive only a public key, a credential handle and a signature counter; **no biometric template ever leaves your device**, and attestation data is not collected',
          ],
          [
            'Religious beliefs',
            '❌ Not collected',
            'There is no such field, and no classification is performed',
          ],
          [
            'Specific identities',
            '❌ Not collected',
            'No ID number, passport, social-security number, no face matching',
          ],
          [
            'Medical health',
            '❌ Not collected',
            'No health data source is connected. Habit names are yours to type: if you write "take medication" or "clinic visit", that text is **cleartext only on your device** and ciphertext on our server — we never classify what it is',
          ],
          [
            'Financial accounts',
            '❌ Not collected',
            'No card number, CVV, IBAN, wallet account or billing address columns exist; the actual money movement happens at your bank and wallet',
          ],
          [
            'Movement trajectories',
            '❌ Not collected',
            'No location permission is requested; no coordinates, Wi-Fi or cell-tower data are collected, and there is no background location polling',
          ],
          [
            'Personal information of minors under fourteen',
            '🔴 **Wherever it exists, it is sensitive personal information by definition**',
            'That is the closing clause of Article 28 and needs no argument. We do not actively verify age, so this point is answered in a separate, dedicated set of rules ↓',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'So the conclusion is: **heyta does not proactively collect any sensitive personal information**, and it never flags a task as sensitive because its content "looks medical or financial". That conclusion rests on "we do not judge content", not on "we cannot see content".',
      },
      {
        kind: 'callout',
        text: 'Two honest qualifications, without which the conclusion above would be an overstatement: ① your task and note content **may** contain health, religious, financial or location details that you typed yourself. We do not judge, categorise or extract them; but if you switch an AI feature on and confirm sending that item to the model, the text leaves your device **in cleartext** — the disclosure lists exactly what will be sent, so please look at it first. ② Passkey credentials are not sensitive personal information under Article 28 (they are device-bound public-key credentials, and biometrics never leave the device), yet we protect them one tier higher: not in admin responses, not in logs. This classification should be confirmed finally by counsel.',
      },
      {
        kind: 'docRef',
        docId: 'minors',
        text: 'Rules for personal information of minors (including those under fourteen): see the Minors Protection and Age Statement.',
      },
    ],
  },
  {
    id: 's7',
    title: 'Retention periods at a glance',
    blocks: [
      {
        kind: 'p',
        text: 'PIPL Article 19 requires the retention period to be the shortest time necessary to achieve the processing purpose; Article 21(3) of the Network Data Security Management Regulations adds that where a period genuinely cannot be fixed, **the method for determining it** must be stated. The values below are what we actually run today, not targets.',
      },
      {
        kind: 'table',
        head: ['Data', 'Retention period', 'What happens when it expires'],
        rows: [
          [
            'Sync events (ciphertext operation log) and device records',
            '**A 45-day window**, but the two kinds have to be said apart: **device records** really are swept on that window daily; **sync events are not pruned by a single row today** — that sweep only processes accounts whose stream already contains a "full-state boundary", which the clients this product ships never produce (measured: the daily job deletes 0 rows). The window itself is a fixed constant in the code; changing it takes a release',
            'Device records: rows absent past the window are deleted. Sync events: **not deleted under the current version** — they are kept until the account is closed, or until the pruning condition really becomes reachable. The number of deleted rows is logged **even when it is zero** — so that a future reader can prove the sweep actually ran, rather than relying on "no error appeared"',
          ],
          [
            'Server database backups',
            '**14 days** at the current script default',
            'Age out with the backup retention window. ⚠️ Backups are whole-database snapshots, and **there is no capability in the code to delete one user\'s data from an existing backup**',
          ],
          [
            'Accounts, credentials, subscriptions, orders, referrals and notifications',
            'Until you **close your account**',
            'Account deletion is a cascading hard delete on the server: sync events, devices, passkeys, subscriptions, orders, referrals and notifications all go, with the auth cache invalidated and live connections dropped. No cooling-off period, no recycle bin. 🔴 What this removes is the server copy: the readable local databases on your other devices survive closure — the action "the account was closed, so wipe this device" does not exist today',
          ],
          [
            'One-time tokens',
            'Email verification 24 hours; magic login and password reset 15 minutes; passkey recovery 1 hour',
            'Expire or are consumed and become void. Only hashes were ever stored, and pending passkey registrations past their window are swept on the same schedule',
          ],
          [
            'Data on your device (cleartext content included)',
            'Indefinite, until you remove it',
            'Deleting inside the app **writes a marker** (a tombstone); "delete forever" adds another marker without erasing history — local cleartext is not physically wiped from disk. Physical removal means uninstalling or clearing site data',
          ],
          [
            'Server runtime logs',
            'See the paragraph below',
            'The application records no HTTP access logs; runtime logs go to standard output, and whether they are also written to a disk file depends on deployment configuration. **There is no rotation or expiry mechanism in the code**',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'Two sentences that must travel together with that table, or it reads like a promise: **45 days is the product\'s current setting, not an option you can choose**, there is no shorter-retention switch in the interface, and changing it takes a release. And pressing "delete forever" in the app **does not shorten it** — the item disappears from every one of your screens. 🔴 A third sentence has to be added, also honestly: under the current version that encrypted history **never reaches "the retention window expiring"** — the daily sweep does not match our data at all (see that row above), so the one route by which it really stops existing is closing the account. One more boundary, registered honestly: access-log retention at the host and network layer (for example a fronting proxy) is decided by the deployment environment, and the statutory floor is that network logs are kept for no less than six months; the retention actually configured for the official instance needs to be confirmed by operations before this document is published.',
      },
    ],
  },
  {
    id: 's9',
    title: 'The EU GDPR view: which half of a record of processing this inventory is, and which half it is not',
    blocks: [
      {
        kind: 'p',
        text: 'This inventory is written against the PIPL: category by category it says what is collected, where it lives, and whether the server can read it. The closest GDPR instrument is the record of processing activities under Article 30, but a record of processing also requires **the purpose, lawful basis and retention for each category** - three columns this inventory does not have. So the cells below state which half this document can stand in for and which it cannot, rather than renaming it and handing it over.',
      },
      {
        kind: 'table',
        head: ['Where in the GDPR', 'What it asks', 'What heyta can produce', 'What does not line up'],
        rows: [
          [
            'Article 30 (record of processing activities)',
            'Is there a record of processing activities in the GDPR\'s shape',
            'The inventory really does state per category "what is stored, where, and who can read it", and one column records that under end-to-end encryption the server receives ciphertext only',
            'It carries **no** lawful basis and no retention period per category, and its categories follow Chinese law rather than the GDPR grouping; until those two columns exist this document must not call itself a record of processing'
          ],
          [
            'Article 9 (special categories) against "sensitive personal information"',
            'Whether the two "sensitive" definitions cover the same data',
            'The sensitive items listed here follow the Chinese enumeration exactly - neither widened on our own initiative nor narrowed',
            'The two sets are **not equal**: the GDPR puts biometric and genetic data inside Article 9 while the Chinese definition differs, so a table that satisfies one side does not automatically satisfy the other and no one-to-one mapping is performed here'
          ],
          [
            'Article 15 (access)',
            'Whether this inventory is "everything we hold about you"',
            'It is not, and the inventory says so: access is exercised through **export**, available on all three clients, including tombstones and the full operation log',
            'The inventory gives categories, not your data; and where the category table and the real database disagree, the database governs (section eight of this document) - that kind of disagreement has no field-by-field standing reconciliation today'
          ],
          [
            'Article 13(1)(c) (the retention period, or the criteria used to set it)',
            'Each category must state how long it is kept, or by what criterion it expires',
            'The inventory states no periods at all; retention lives in the Privacy policy and the retention rules, so one fact is never written as two different numbers',
            'Retention can currently be given as a **criterion** but not as a date: hosted backups are whole-database snapshots and the code has **no** ability to remove a single row or a single person from an existing backup, so any hard-coded expiry per category would become a promise we cannot keep'
          ],
        ],
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: 'Privacy policy: purposes, lawful bases and retention periods are given there article by article; this inventory answers only "which categories exist, where they are stored, and whether the server can see them".',
      },
    ],
  },
  {
    id: 's8',
    title: 'When this inventory changes, and what governs if it disagrees with reality',
    blocks: [
      {
        kind: 'p',
        text: 'A new row enters this table in only three situations: ① a feature **you** switched on genuinely needs it (for example a system-level reminder integration); ② a new class of business entity is added; ③ billing or a legal requirement forces us to keep one more credential. **When a collection item is added, this inventory is updated before the release ships, and we ask for your consent again** — PIPL Article 14(3) requires fresh consent when the purpose, method or categories change, and "bumping a version number" does not count.',
      },
      {
        kind: 'ul',
        items: [
          'Evidence per item: the server database schema and code (every column traces back to a file and line number), the actual local storage paths on each platform, and each platform\'s manifest file.',
          'Boundary against the App Permissions Inventory: that one covers **the gates your operating system holds for you**, this one covers **the information itself**. The same subject can appear in both (reminders, for instance), and the two must agree.',
          'Boundary against the Third Parties and Sharing Inventory: this one answers "what we store", that one answers "do these bytes ever leave us". The row about export files flowing to any third party you pick is developed only in the latter.',
        ],
      },
      {
        kind: 'p',
        text: 'If this inventory and the actual implementation ever disagree, **the implementation governs — and please report the difference to us as a defect**. A promise written into a document with no code behind it is worse than no promise: it is exactly the "collecting or using personal information in breach of the rules you published" item in the third category of the Recognition Method.',
      },
      {
        kind: 'docRef',
        docId: 'third-parties',
        text: 'At which moments this data leaves your device or our servers: see the Third Parties and Sharing Inventory.',
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: 'The real entry points and real limits for access, copy, correction, deletion, account closure and consent withdrawal: see Your Rights and How to Exercise Them.',
      },
    ],
  },
] as const;

export const personalInfoList: LegalDocument = {
  id: 'personal-info-list',
  version: '1.1',
  status: 'draft',
  updatedDate: '2026-10-04',
  title: {
    'zh-CN': '个人信息收集清单',
    en: 'Personal Information Collection Inventory',
  },
  summary: {
    'zh-CN':
      'heyta 逐项收集哪些与你有关的信息、每项的目的与方式、存在哪里（仅本机明文／服务器密文／服务器明文）、存多久 —— 按数据类别拆成五张表，包含服务端以明文保存的全部 11 项同步元数据。',
    en:
      'Every item heyta collects about you, its purpose and how it is gathered, where it lives (device-only cleartext, server ciphertext, server cleartext) and for how long — split into five tables by data class, including all eleven sync metadata items we keep in cleartext.',
  },
  sections: { 'zh-CN': zh, en },
};
