/**
 * 个人权利行使与请求响应
 * ======================
 *
 * 法定出处：《个人信息保护法》第 44–50 条（知情决定、查阅复制、转移、更正补充、
 * 删除、解释说明、死者个人信息近亲属权利、便捷受理机制与"拒绝应当说明理由"），
 * 以及《App 违法违规收集使用个人信息行为认定方法》第六类第 3、5 项
 * （入口必须存在、不得设置不必要条件、**人工处理不得超过 15 个工作日**）。
 * 条文级依据与取值理由见 `docs/research/legal-pipl-baseline.md` §1.7 与 §2.6。
 *
 * 🔴 **这一份的写法纪律：只承诺代码里能走通的动作；能力已就绪但界面没接上的，
 * 承诺渠道而不是承诺自助。** 全部事实来自 `docs/research/legal-dataflow-ai-rights.md`
 * 的 D24（权利逐项核对）与 D25（保留与备份），删除语义另见
 * `docs/research/legal-dataflow-client.md` E 节与 `docs/research/legal-dataflow-server.md` 附表。
 *
 * 三条绝对不能写（写了就是虚假陈述，而且一查就穿）：
 * 1. **"立即从服务器彻底销毁"** —— 界面上的"彻底删除"只是打一个加性标记，
 *    服务端承载它的加密历史要等保留期届满或账号注销才消失（D24.3、D25.2）。
 * 2. **"你可以在设置里注销账号"** —— 服务端确实有一条真·硬删的路由（引用 `users` 且
 *    CASCADE 的外键 16 条、覆盖 15 张表 —— ⚠️ 这两个数已于 2026-10-04 被 `structure.spec.ts`
 *    重量为 **19 条 / 18 张表**（04:27 那一跑报的就是这条；下面 GDPR 行原先抄的是本注释的旧数）；
 *    2026-10-03 更正：此前这里写的"级联 18 处"与
 *    隐私政策的"19 处"是两个错误口径的抄件 —— 它们数的是全部迁移里 `ON DELETE CASCADE`
 *    的出现次数，既含与账号无关的级联又把历史重建重复计入。真值由
 *    `packages/legal/tests/structure.spec.ts` 从 `server/prisma/migrations` 现量对账）、
 *    带审计与限流），但应用内**零入口**（D24.4）。所以本文件写"通过邮件申请"。
 *    ⚠️ **这条的事实部分在 2026-10-04 过期**（批次 E3：网页版设置页、手机端「我的」、
 *    命令行版三处都有了入口，都带二次确认与"先导出"提示）。**没过期的是那条纪律** ——
 *    不许承诺界面里走不通的动作；它今天反过来要求把第五节改成自助表述（对账见 §10.6）。
 *    原句划在这里而不是删掉，是为了让下一位看清"零入口"当年是真的、而且是被一条判据钉进去的。
 * 3. **"删除后 30 日内于备份中完成"** —— 备份是整库快照，代码里**不存在**
 *    "从既有备份中单独删掉某一条/某一个人"的能力（D25.4）。不写天数、不写穿透，
 *    只写"随备份自身保留期结束而消失"。
 * 4. 🔴 **"注销会删除你在所有设备上的数据"**（2026-10-03 加，产品负责人要求 GDPR 口径后的新雷区）
 *    —— 注销删的是服务端。本地优先意味着每台设备自己有一份**明文**库，而当前代码里
 *    没有任何"账号已注销 ⇒ 清除本机数据"的路径（`DbAdapter` 连 `destroy` 都没有声明，
 *    IndexedDB 那份 `destroy()` 零调用方，同步客户端遇到鉴权失败的既有立场是"绝不清本地数据"）。
 *    写这句话就是虚假陈述；写"不会"才是可核验的。
 *    ⚠️ **括号里那三句事实已在 2026-10-04 过期**（批次 E2：`DbAdapter.destroy` 已进契约，
 *    IndexedDB / SQLite / op-sqlite 三套实现与宿主注册表都在 HEAD 里，收到注销信号会清本机）。
 *    **但这条禁令一个字都不放松**，只是理由换了：现在仍然不能写那句话，因为
 *    **一台从此不再联网、不再登录的设备上的副本清不掉** —— 没有远程擦除未连接设备这回事。
 *    这一类"句子会因为代码变好而变成谎话"的雷，现在有一条常驻门禁盯着：
 *    `scripts/check-legal-closure-truth.mjs`。
 *
 * 另外两处必须如实写的限制：邮箱**不可更换**（服务端根本没有改邮箱的路由），
 * 以及导出文件本身**不受加密保护**（它是客户端解开之后的明文副本）。
 * 联系渠道只有邮箱：没有电话号码、没有在线客服、没有实体受理点，
 * 本文件不许出现这三类承诺。
 */

import type { LegalDocument } from '../types.js';

const zh = [
  {
    id: 's1',
    title: '这份文件回答什么问题',
    blocks: [
      {
        kind: 'p',
        text: '《个人信息保护法》给了你一串权利，但一份把权利清单抄一遍的文件对你没有用处 —— 你真正需要知道的是**每一项在 heyta 里具体怎么做到、做不到的是什么、做不到时找谁**。这张表就是为这个问题写的，每一行都对照过实际代码。',
      },
      {
        kind: 'table',
        head: ['你主张的权利', '法律依据（《个人信息保护法》）', '在 heyta 里实际怎么做', '要不要联系我们'],
        rows: [
          ['查阅、复制（把数据拿走）', '第 45 条第 1 款', '自助导出，三个端都有；导出的是可读的明文文件', '不需要'],
          ['转移（交给另一家服务）', '第 45 条第 3 款', '我们提供导出文件本身；跨系统搬迁由你自己完成', '需要协助时联系'],
          ['更正、补充', '第 46 条', '在界面里直接改，改完经同步到达你的其他设备', '仅账号类信息需要'],
          ['删除', '第 47 条', '应用内删除 + 回收站"彻底删除"', '服务端级需联系'],
          ['注销账号', '第 47 条', '网页版设置页、手机端「我的」或命令行版 `account close` 自助完成；也可以邮件申请', '需要'],
          ['撤回同意、拒绝非必要处理', '第 15、44 条', '设置里逐项关闭（含「隐私同意」那一项，它管的是这台设备准不准出门），关闭即刻生效', '不需要'],
          ['要求解释说明处理规则', '第 48 条', '邮件提出，我们书面答复', '需要'],
          ['近亲属对死者个人信息的权利', '第 49 条', '邮件提出，我们核验关系后处理', '需要'],
        ],
      },
      {
        kind: 'docRef',
        docId: 'personal-info-list',
        text: '你手上有什么牌可以打，取决于我们到底处理了哪些信息 —— 逐项字段清单见《个人信息收集清单》。',
      },
      {
        kind: 'callout',
        text: '有一条贯穿本文件的事实：heyta 的同步是端到端加密的，服务器只存密文事件、不持有解密所需的口令。所以**凡是涉及"具体内容"的动作，你自己在设备上做都比我们代你做更快、更可靠**；而"我们无法读取你同步的内容"这句同时也是我们的能力边界，不是客套。',
      },
    ],
  },
  {
    id: 's2',
    title: '查阅与复制：把你的数据拿走',
    blocks: [
      {
        kind: 'p',
        text: '这是 heyta 覆盖得最全的一项权利：导出**不是**给你看个列表，而是把整份数据交给你，包括那些界面上不再显示的部分。',
      },
      {
        kind: 'ul',
        items: [
          '**网页版**：设置页里的导出面板，浏览器直接下载一个 `.json` 文件。',
          '**命令行版**：`export --out <路径>`，把同一个文件写到你自己指定的位置。',
          '**手机端**：「我的 → 导出数据」，走系统分享面板 —— 你可以存进"文件"，也可以转发给邮件、云盘或任意其他应用。',
        ],
      },
      {
        kind: 'table',
        head: ['导出文件里的部分', '内容', '为什么需要它'],
        rows: [
          ['`entities`', '当前状态里的全部实体，按类型分组，**含已删除记录的墓碑**', '让人和程序都能直接读你的数据'],
          ['`opLog`', '完整操作日志，按确定顺序排列', '重建历史、也证明导出没有被裁剪'],
          ['`counts`', '实体数、已删除数、操作总条数与按类型的条数', '让你能自己核对"导全了没有"'],
          ['元数据', '格式版本、应用与宿主名、导出时刻、数据结构版本', '日后重新导入或排查时能对上'],
        ],
      },
      {
        kind: 'p',
        text: '一处范围限定，免得你以为"实体清单就是你的全部数据"：`entities` 只覆盖会被还原成当前状态的那些实体类型；少数类型（例如提醒）的完整内容只存在于 `opLog` 里。对**整份文件**来说"导全了"成立，对 `entities` 这一个字段单独说不成立。',
      },
      {
        kind: 'callout',
        text: '**导出文件本身不设防。** 它是端到端加密在你自己设备上解开之后的明文副本，任务标题、备注正文、习惯与专注记录全都在里面，没有任何加密保护。它一旦离开你的设备（下载到磁盘、经分享面板转给其他应用），保管责任就在你手上 —— 请把它当作与"你的整本日记"同级敏感的副本。',
      },
      {
        kind: 'p',
        text: '三处必须说清的地方：① **手机端没有"把 heyta 导出文件还原回来"的入口** —— 手机上能导出来，但还原只能在网页版或命令行版做；因此这份导出文件**不是还原点**，它是给你读、给你搬走的副本，别把它当备份用。② 手机端同一屏上还有另一件事：**从滴答清单导入**，输入方式是粘贴 CSV 文本（不是选文件），它把外部数据搬进来、与既有数据共存且不覆盖 —— 这和"还原 heyta 的导出"是两个不同的承诺。③ 还原 heyta 自己的导出文件**只支持还原到一个空库**，往已有数据里合并这件事我们不做（那会制造无法判定的冲突）。',
      },
    ],
  },
  {
    id: 's3',
    title: '更正与补充',
    blocks: [
      {
        kind: 'p',
        text: '业务数据的更正不需要找任何人 —— 它在界面里就是一等功能。下表列出可更正的范围；一次修改会作为一条新记录进入操作日志，并经同步到达你的其他设备。',
      },
      {
        kind: 'table',
        head: ['想更正什么', '在哪里改', '改完会发生什么'],
        rows: [
          ['任务标题', '任务详情 / 列表内联编辑', '追加一条修改记录；空标题会被拒绝'],
          ['备注正文', '任务详情的备注区', '同上；清空可以清到"没有备注"'],
          ['截止时间、"延期到今天"', '任务详情', '同上'],
          ['优先级、重要标记、四象限归属', '任务详情 / 四象限视图', '一次操作可同时改截止时间与象限'],
          ['完成状态', '列表勾选 / 专注面板', '完成与取消完成都是可更正字段'],
          ['归属：清单、父任务、标签', '任务的组织区', '标签是整组覆盖，悬空的标签 id 会被拒绝'],
          ['重复规则', '任务详情', '设为"不重复"同样是更正'],
          ['清单、便签、习惯、专注记录、提醒', '各自的编辑面', '与任务共用同一个写入口，语义一致'],
          ['界面语言', '设置', '账号级元数据，可改'],
        ],
      },
      {
        kind: 'callout',
        text: '**邮箱不可更换。** heyta 的账号就是那个邮箱地址，作为登录凭据它目前不能改、也不能换绑；服务端没有这样的能力，我们也不会在这里承诺它。如果注册时填错了地址，目前可行的做法是用正确的地址重新注册，并请我们注销填错的那个账号。',
      },
      {
        kind: 'p',
        text: '"更正"在事件溯源架构里的真实含义要写清楚，否则会让人以为旧值消失了：**更正是追加一条新记录，不是原地覆盖**。一条数据被改过几次，历史里就有几条记录；旧值仍以（服务端读不懂的）密文形式留在同步历史中，直到保留期届满被清理。',
      },
      {
        kind: 'p',
        text: '因此也不存在"请客服替我改掉某条任务内容"这种服务：我们看不到明文，也无从判断它"应该是"什么。你登录任意一台已同步的设备自行修改，是唯一可行的路径，而且这一改动会经同步到达你的其他设备。',
      },
    ],
  },
  {
    id: 's4',
    title: '删除：三段式，以及"删除"在这里到底意味着什么',
    blocks: [
      {
        kind: 'p',
        text: 'heyta 的删除有三段，语义各不相同。把它们混成"删除"一个词，是这类文本最常见的失真来源，所以我们分开写。',
      },
      {
        kind: 'ol',
        items: [
          '**删除**：条目进回收站，列表里不再出现。',
          '**恢复**：把还在回收站里的条目还原回列表。',
          '**彻底删除**：从回收站里也不再显示，之后无法恢复；只有已经在回收站的条目才能走到这一步。',
        ],
      },
      {
        kind: 'table',
        head: ['你做的动作', '界面上', '这台设备的库里', '服务器上'],
        rows: [
          ['删除', '从列表消失，回收站可见', '记录仍在，带"已删除"标记', '对应的加密历史仍在'],
          ['恢复', '回到原列表', '标记被清除，这也是一条新记录', '同上，新增一条加密记录'],
          ['彻底删除', '回收站也不再显示', '记录仍在，带"已彻底删除"标记', '对应的加密历史仍在。⚠️ 按当前版本，那条每日清扫对我们的数据**一条都不命中**（它的生效条件见第四节），所以现在真的会让它消失的只有注销账号'],
        ],
      },
      {
        kind: 'p',
        text: '所以要如实说清：**"彻底删除"不是一条抹除指令，而是一个标记。** 服务器承载那条数据的加密历史记录，理论上只有两条路会真的让它消失 —— 保留期届满，或账号注销。🔴 但按当前版本必须再补一句：**保留期这条路现在走不通** —— 每日清扫只处理已经存在「完整状态边界」的账号，而本产品当前的客户端不会产生那种边界，实测每天清掉的条数是 0。所以目前唯一真的会让它消失的是**注销账号**。我们不写"立即从服务器销毁"，因为那不成立；把清理条件写清楚，反而把端到端加密与保留期这两件事交代明白了。',
      },
      {
        kind: 'callout',
        text: '**本地与备份的三条边界。** ① 这台设备上的历史操作日志不会因为你在界面上删了一条任务而从磁盘消失；应用内**没有**"一键清空本地全部数据"的入口，本地明文的物理清除依赖卸载应用（或在手机上到系统设置里清除应用数据）、网页版则是清理浏览器站点数据。② 手机端「我的」里那个**「清除凭据」**按钮容易被误解，这里说清它做什么：它清掉同步令牌与口令、清掉小组件那份快照、忘掉界面上记住的账号邮箱 —— 它**不删除**这台设备上的本地数据库，你的任务与备注仍然留在手机里。③ 我们会对服务器数据做定期备份；备份是整库快照，技术上没有"从某个既有备份里单独剔除你的一条数据"的能力，因此我们不承诺删除会穿透到备份 —— 已删除的内容可能仍存在于尚未过期的备份中，并随备份自身的保留期结束而消失。',
      },
    ],
  },
  {
    id: 's5',
    title: '注销账号',
    blocks: [
      {
        kind: 'p',
        text: '服务端侧的注销是**真删除**，不是打标记：账号行连同它名下的同步数据、设备记录、通行密钥、订阅与订单、邀请关系与通知一并级联清除，口令与令牌随之失效，活动连接被踢下线。这一步没有冷静期、没有回收站，做完不可恢复。🔴 本地优先意味着每台设备自己存着一份可读的库，所以注销还得回答"其它设备上那一份怎么办"：**你点下注销的这台设备当场清掉本机明文**，其它设备在**下一次同步拿到"账号已注销"这个信号**时各自清掉自己那一份。⚠️ **今天不承诺的有两处**：① 那台**从此再也不联网、再也不登录**的设备 —— 我们没有远程擦除未连接设备的能力，它上面的副本只能靠系统层面的卸载并清除应用数据交还干净；② 🟡 **Linux 桌面壳**：那台机器上的本机销毁通道今天只走到「把内容清空并重写这个库文件」，**删不掉文件本体** —— 那个壳的驱动没有把「删掉容器」这一步递给界面这一层，而清空 + 重写这个补救按我们自己的说法是**不完备**的：空闲页里仍可能翻得出旧内容。✅ **macOS 与 Windows 的桌面壳已在 2026-10-04 接上这一步**：那两个壳把存储托管给桌面程序自己那一份本地库（界面一起来就改用壳交出来的存储，可读的那份数据从此写进壳的库文件），而现在本机销毁通道会连那个库文件一起删掉，连它的 WAL 日志与共享内存旁挂一个都不留。手机端与网页版没有「壳自己的库」这一层。',
      },
      {
        kind: 'p',
        text: '**注销入口在三个面上都有**：网页版在设置页，手机端在「我的」，命令行版是 `account close`。三处都要先勾上"我知道这会把本机上包括还没同步出去的数据一起清掉"，再做第二次确认，并且都先提示导出。命令行版还多一道硬拦：本机存在未上传的操作时**直接拒绝执行，不提供逃生门**。邮件渠道仍然保留（发到 `heyta@waytofuture.cn`，主题写明"注销账号"，从该账号对应的邮箱发出），我们在**收到请求后 15 个工作日内**完成核查与处理并回复结果。',
      },
      {
        kind: 'callout',
        text: '**注销之前请先导出你的数据。** 这条顺序不可逆：一旦删除完成，我们自己也拿不回来 —— 服务端只有密文事件，没有口令就无法还原明文。导出方法与内容见上面第二节。',
      },
      {
        kind: 'docRef',
        docId: 'subscription-refund',
        text: '注销时仍在有效期内的订阅怎么处理（退订、退款、按比例退还），按《订阅与退款》一节执行。',
      },
      {
        kind: 'p',
        text: '两条边界：① 我们只接受来自该账号邮箱、或经我们核实的本人请求，必要时会要求你用该邮箱回复确认；② 与备份的关系同第四节 —— 整库快照里没有单点删除能力，账号删除后你的内容仍可能存在于尚未过期的备份中，随备份保留期自然结束。',
      },
    ],
  },
  {
    id: 's6',
    title: '撤回同意与拒绝处理',
    blocks: [
      {
        kind: 'p',
        text: 'heyta 的隐私开关不是"设置项"而是**真的闸门**：与隐私相关的每一处，出厂都不是"开着"的 —— 联网那一处出厂是**还没问过**（问过、你没答应，它就一路关着），其余开关出厂是关闭；而关掉之后被改变的是**当下正在发生的行为**，不是一份内部记录。这就是撤回同意在这里可以立即生效的原因。',
      },
      {
        kind: 'table',
        head: ['你关掉的开关', '关掉之后的实际效果', '什么时候生效'],
        rows: [
          [
            '联网同意（首启那张面板上作出的决定）',
            '同步、注册与登录、通知未读数的拉取、实时连接、离线缓存的注册**全部停下来**；撤回后状态清回"还没问过"，界面会重新问一次。本地数据一条都不动',
            '每一个要出门的动作在动手之前重新检查；已经建立的实时连接当场关掉',
          ],
          ['AI 功能总开关', '不再向任何外部服务发起请求，连候选端点都不再解析', '下一次调用第一件事就是检查它'],
          ['允许远程端点', '远程端点根本不进入候选列表，因此连授权询问都不再产生', '即时'],
          ['某个功能的出境授权', '该功能不再送出任何内容；本机端点仍按你配的状态使用', '每次调用都在网络动作之前重新检查'],
          ['记忆与偏好', '连输入都不再被读取：推断层不再计算，不再有偏好进入请求内容', '即时'],
          ['推送 / 小组件后台刷新', '服务端订阅被删除、浏览器侧订阅同时退掉，不是"只是不再显示提示"', '你点下开关的那一刻'],
          ['本机接口', '本机服务不再接受任何调用', '即时'],
        ],
      },
      {
        kind: 'callout',
        text: '**撤回只对之后生效。** 一次已经离开你设备的 AI 请求无法被"关掉开关"追回 —— 数据在网络上，不在我们手里。同理，你在界面上撤回某项授权，不会使此前已发出的请求作废。这是物理边界，不是我们的政策选择。',
      },
      {
        kind: 'p',
        text: '拒绝非必要功能不影响基本功能：任务的新建、修改、完成、查看、导出都不依赖任何需要你同意的能力。所有隐私开关出厂为关闭、不预置任何 AI 目的地、不内置任何云端端点 —— 你拒绝之后，应用照常工作。',
      },
    ],
  },
  {
    id: 's7',
    title: '提出请求：渠道、时限、被拒绝时会怎样',
    blocks: [
      {
        kind: 'p',
        text: '受理渠道目前只有一个：邮箱 `heyta@waytofuture.cn`。这是已投产的地址。我们没有电话号码、没有在线客服、没有实体受理点，所以本文件不写这三种方式 —— 写一条没人接的热线，比不写更糟。',
      },
      {
        kind: 'ul',
        items: [
          '请求里请写明：**该账号的邮箱地址**、你要行使上面哪一项权利、针对**某几条数据还是整个账号**。',
          '涉及删除或注销时，请一并写明是否希望我们先给出导出协助。',
          '近亲属代为请求的，请附可说明关系的材料；我们核验后处理，不会向无关第三人披露任何内容。',
          '对同一事项请勿同时发多封邮件排队 —— 第一封会按收到顺序处理。',
        ],
      },
      {
        kind: 'table',
        head: ['请求类型', '渠道', '答复时限'],
        rows: [
          ['查阅、复制、更正、删除（自助可做的那些）', '应用内直接操作', '即时，无需等待'],
          ['撤回同意、停止某项处理', '应用内关闭对应开关', '即时'],
          ['注销账号', '网页版设置页 / 手机端「我的」/ 命令行版 `account close`，或邮箱申请', '自助即时生效；邮件请求收到后 15 个工作日内'],
          ['账号类信息（例如填错的注册邮箱）', '邮箱', '收到请求后 15 个工作日内'],
          ['要求解释说明处理规则', '邮箱', '收到请求后 15 个工作日内'],
          ['近亲属请求、投诉与举报', '邮箱', '收到请求后 15 个工作日内'],
        ],
      },
      {
        kind: 'p',
        text: '如果我们拒绝一项请求，会**书面说明理由**。可以拒绝的情形由法律规定，只有那么几种（例如法律、行政法规规定的保存期限尚未届满）；即便属于这些情形，我们也只保留存储与必要的维护，不再把它用于其他处理目的。你不同意我们的答复时，可以向履行个人信息保护职责的部门申诉。',
      },
    ],
  },
  {
    id: 's9',
    title: '欧盟 GDPR 口径：逐条对得上什么、对不上什么',
    blocks: [
      {
        kind: 'p',
        text: '上面那张表对的是中国法。这一节对的是《通用数据保护条例》（GDPR），因为**同一批代码事实要能被两套法各自问一遍**。写法与全篇一致：只写代码里能走通的动作，做不到的写在同一行里，不挪到脚注。',
      },
      {
        kind: 'table',
        head: ['GDPR 条文', '它要求什么', 'heyta 对应的事实', '对不上的部分'],
        rows: [
          ['第 13、14 条 透明度', '处理目的、类别、保留、接收方逐项告知', '这一套对外文本本身就是告知载体：数据清单、保留与备份、第三方、权限逐项列开', '本套文本没有公布数据保护专员或欧盟代表（第 27、37 条）的联系方式；受理渠道只有邮箱'],
          ['第 15 条 访问', '告知并复制其个人数据', '导出是**自助**的，而且只有你解得开：服务端存的是端到端加密的事件，我们没有口令就还原不出明文', '正因为你给的从来不是明文，我们无法替你查出"你的任务标题是什么"——这一条由你的设备行使，不由我们代查'],
          ['第 16 条 更正', '在不合理延迟内更正', '在界面里直接改，改完经同步到达你的其他设备', '**邮箱改不了**：服务端没有换绑邮箱的路由，所以"账号标识本身写错了"这一类更正今天只能重新注册并请我们注销旧账号'],
          ['第 17 条 删除', '在不合理延迟内删除', '应用内删除与回收站里的"彻底删除"标记 + 账号级联硬删（现量：引用 `users` 且 CASCADE 的外键 19 条、覆盖 18 张表）+ 点下注销的那台设备当场清本机明文，其它设备在下次同步收到注销信号时各自清', '两个"不承诺"：从此不再上线的设备上的本地副本无法远程清除；整库备份里没有单点删除，随备份保留期自然结束'],
          ['第 18 条 限制处理', '暂停处理但保留数据', '实际能用的是撤回同意：关掉某项开关后该项出站动作立即停止、已建立的实时连接当场关掉', '没有"整号冻结但数据保留"这一档（产品里没有这个状态），要停就走到注销'],
          ['第 20 条 数据可携带', '以结构化、通用、机器可读格式取得并转移', '导出文件是明文 JSON，含**墓碑**与完整操作日志，另带可核对的 counts（丢掉墓碑的备份在回放时会让已删数据复活）', '我们没有替你把这份文件搬进别家服务的通道；转换由你自己完成'],
          ['第 21、22 条 反对与自动化决策', '反对特定处理；不受仅凭自动化产生法律效果的决策约束', 'AI 在这套代码里**类型上产生不了写入**：读操作即时执行，写操作只产出提案，确认之后才真的落到你的数据里；出境还要过逐功能授权', '撤回同意后已同步到其它设备的既有数据不会自动回滚，那要你自己删'],
          ['第 32、33 条 安全与事件告知', '与风险相称的措施；知悉后通知', '端到端加密是默认而非可选，口令散列与服务端密文用 Argon2id；即便同步内容被整体泄露也是密文', '触发范围按**账号标识与元数据**写（它们不是密文）；自建部署下这一条的义务人是部署者，不是我们'],
        ],
      },
      {
        kind: 'p',
        text: '**谁是控制者要分两种部署说。** 官方托管实例里，heyta 决定处理目的与方式，因此我们是控制者；**自建部署**里，服务器是你自己的，数据落在你的机器上，我们是软件而不是处理者 —— 我们既拿不到你的数据，也没有一把能替你解密的密钥。跨境那一条同样按这两种说：官方托管的服务器在中国大陆，对来自欧盟的访问而言这构成向第三国的传输，而**本节不声称已有任何转移机制**（标准合同条款、充分性决定或转移影响评估）—— 那一层今天既没有代码也没有文档支撑；能确定的一件事是自建部署把数据留在你自己的机器上。',
      },
      {
        kind: 'ul',
        items: [
          '**没有做但 GDPR 会问到的**：数据保护影响评估、数据保护专员或欧盟代表的任命、面向欧盟用户的独立文本。这三项今天都只有本节的如实登记，没有对应的产品或法务动作。',
          '**注销冷静期仍未决**：第 17 条要求"不合理延迟"，而一条不可逆且会连带清掉本机未同步数据的自助注销，是否需要一个可撤销的等待窗口，是产品与法务的取舍，本文件不替它做决定（见《未成年人》与本节第 17 条那一行的边界）。',
          '**备份侧的彻底销毁**：整库快照没有单点删除能力这一条，只有把备份本身做成可销毁密钥加密（销毁密钥即视为删除）才可能翻转；那是一个运维动作，今天没做，所以第 17 行右栏仍然写着"不承诺"。',
          '**这一节会跟着代码改**：上面每一行右栏都指向一个具体缺口，缺口补掉的那天文本必须同批改写，并提升版本号 —— 同意记录里存的就是版本号。',
        ],
      },
    ],
  },
  {
    id: 's8',
    title: '这份文件什么时候会变',
    blocks: [
      {
        kind: 'p',
        text: '本文件里的每一处"目前不能"都是**带着触发条件的**，不是敷衍的措辞。下面四项一变，文本就跟着改；改版会提升版本号，因为同意记录里存的就是版本号。',
      },
      {
        kind: 'ul',
        items: [
          '**如果我们具备远程擦除未连接设备的能力**（今天不具备）：第五节里"再也不联网、再也不登录的那台设备"这条边界就会消失，文本跟着改。原先挂在这里的"注销做出界面入口之后"那一条已在 1.2 兑现，不再是一个待触发的改写条件。',
          '**Linux 桌面壳把「删掉容器」这一步递给界面这一层之后**：第五节 ② 那条"删不掉文件本体"就会消失，"今天不承诺的"从两处回到一处。（macOS 与 Windows 两个桌面壳已在 2026-10-04 接上这一步，所以这里只剩 Linux 一端。）',
          '**邮箱换绑实现之后**：第三节那条"邮箱不可更换"会被删除，并换成换绑流程。',
          '**保留期调整之后**：第四节的 45 天要跟着改。它是产品设定、不是你可以自选的选项，改它需要发版。还有第二件事也要让文案跟着改：**清理真正开始对我们的数据生效**的那一天（见第四节如实补出的那条边界）。',
        ],
      },
      {
        kind: 'table',
        head: ['版本', '日期', '变化'],
        rows: [
          ['1.0', '2026-10-01', '首版草案（尚未生效）：八项权利逐条对照实际代码写成，其中"注销账号"与"邮箱更正"承诺渠道而非自助。'],
          [
            '1.1',
            '2026-10-02',
            '第六节把「联网同意」列为闸门表的**第一行**（首启隐私面板与出站请求闸门已落地），并写明撤回它时**实际发生的三件事**：全部出站动作停止、已建立的实时连接当场关掉、状态清回"还没问过"并重新询问。第一节那张表的"撤回同意"一行同时点名这一项。',
          ],
          [
            '1.2',
            '2026-10-04',
            '第五节从"承诺渠道"改写为**自助表述**：注销入口在网页版设置页、手机端「我的」与命令行版三处都有，并逐条写明二次确认、先导出提示、命令行版对未上传操作的硬拒。同节把本地副本那条边界改成分层实话——点下注销的设备当场清除、其它设备在下次同步收到注销信号时各自清除，**唯一不承诺的是从此不再上线的设备**。第一节与第七节两张表的对应行同步改写。同批新增《欧盟 GDPR 口径：逐条对得上什么、对不上什么》一节：八条条文各自对到一条代码事实，**每一行都带"对不上的部分"那一栏**（数据保护专员与欧盟代表、邮箱不可改、无远程擦除、整库备份无单点删除、转移机制不声称），中英两份逐段镜像。同一版还把"不承诺"从一处扩成**两处**：除了那台从此离线的设备，🟡 **Linux 桌面壳**上那条本机销毁通道今天只走到"把内容清空并重写库文件"，**删不掉文件本体**。✅ macOS 与 Windows 两个桌面壳在同一天（2026-10-04）把这一步接上了——它们把界面上可读的那份数据托管进壳自己那一份本地库，而本机销毁通道现在连那个库文件带它的 WAL 日志与共享内存旁挂一起删掉；两端各自在壳级验收里真跑到 `containerRemoved:true`，并从壳外确认文件已不在盘上。第八节的触发条件跟着改成"只剩 Linux 一端"。',
          ],
        ],
      },
    ],
  },
] as const;

const en = [
  {
    id: 's1',
    title: 'What this document answers',
    blocks: [
      {
        kind: 'p',
        text: 'The Personal Information Protection Law (PIPL) gives you a list of rights, but a document that merely restates that list is useless to you. What you actually need is **how each one works in heyta, which ones do not work, and who to go to when they do not**. This table was written against the code as it exists.',
      },
      {
        kind: 'table',
        head: ['The right you assert', 'Legal basis (PIPL)', 'How it actually works in heyta', 'Do you need us'],
        rows: [
          ['Access and copy (take your data with you)', 'Article 45(1)', 'Self-service export, available on all three clients, as a readable plaintext file', 'No'],
          ['Portability (hand it to another service)', 'Article 45(3)', 'We provide the export file itself; moving it to another system is yours to do', 'Only if you need help'],
          ['Correction and supplementation', 'Article 46', 'Edit it in the interface; the change reaches your other devices through sync', 'Account-level fields only'],
          ['Deletion', 'Article 47', 'In-app delete plus "purge" in the Trash', 'Server-side scope requires contact'],
          ['Account closure', 'Article 47', 'Self-service in Web settings, in the mobile “Mine” tab or from the command line (`account close`); an e-mail request also works', 'Yes'],
          [
            'Withdrawal of consent, refusal of non-essential processing',
            'Articles 15 and 44',
            'Switch it off per feature in settings (including “Privacy consent”, which decides whether this device is allowed to go out at all); switching off takes effect at once',
            'No',
          ],
          ['A request to explain our processing rules', 'Article 48', 'Raise it by email; we reply in writing', 'Yes'],
          ['Next-of-kin rights over a deceased person\'s data', 'Article 49', 'Raise it by email; we verify the relationship and then act', 'Yes'],
        ],
      },
      {
        kind: 'docRef',
        docId: 'personal-info-list',
        text: 'What you can ask for depends on what we actually hold — the field-by-field inventory is in the Personal Information Collection List.',
      },
      {
        kind: 'callout',
        text: 'One fact runs through this entire document: heyta syncs end-to-end encrypted, so our server stores only ciphertext events and does not hold the passphrase. **Anything that involves the actual content is faster and more reliable for you to do on your own device than for us to do on your behalf.** "We cannot read your synced content" is a description of our capability, not a courtesy.',
      },
    ],
  },
  {
    id: 's2',
    title: 'Access and copy: taking your data with you',
    blocks: [
      {
        kind: 'p',
        text: 'This is the right heyta covers most completely: exporting is **not** a readout of what the interface happens to show. It hands you the whole dataset, including parts the interface no longer displays.',
      },
      {
        kind: 'ul',
        items: [
          '**Web**: the export panel in settings; the browser downloads a `.json` file.',
          '**Command line**: `export --out <path>` writes that same file wherever you point it.',
          '**Mobile**: "Me — Export data" goes through the system share sheet — save it to Files, or send it to mail, a cloud drive, or any other app.',
        ],
      },
      {
        kind: 'table',
        head: ['Part of the export file', 'What it contains', 'Why it is there'],
        rows: [
          ['`entities`', 'Every entity in the current state, grouped by type, **including tombstones of deleted records**', 'So people and programs can read your data directly'],
          ['`opLog`', 'The complete operation log in a deterministic order', 'Reconstructs history, and proves nothing was trimmed'],
          ['`counts`', 'Entity counts, deleted counts, total operations and per-type counts', 'Lets you verify the export is complete'],
          ['Metadata', 'Format version, app and host name, export timestamp, data structure version', 'So a later re-import or an investigation can line up'],
        ],
      },
      {
        kind: 'p',
        text: 'One scope caveat, so that "the entity list equals all your data" is not assumed: `entities` covers only the entity types that are materialised into current state. A few types (reminders, for example) exist in full only inside `opLog`. "Complete" is true of **the file as a whole** and cannot be claimed of `entities` on its own.',
      },
      {
        kind: 'callout',
        text: '**The export file itself is unprotected.** It is the plaintext that end-to-end encryption produced by decrypting on your device — task titles, note bodies, habits and focus records are all in there, with no encryption at all. Once it leaves your device (written to disk, or handed to another app through the share sheet) custody is yours. Treat it with the same care as your diary.',
      },
      {
        kind: 'p',
        text: 'Three things have to be said clearly. (i) **Mobile has no way to restore a heyta export back in** — you can export from the phone, but restoring can only be done on the Web or the command-line client. A heyta export file is therefore **not a restore point**: it is a copy for you to read and to move elsewhere, and treating it as a backup is a mistake. (ii) The same mobile screen offers a **different** thing: importing from TickTick, where you paste CSV text rather than pick a file. That brings external data in, coexists with what you already have, and overwrites nothing — it is a separate promise from "restore a heyta export". (iii) Restoring a heyta export **only works into an empty store**; we deliberately do not merge into existing data, because that creates conflicts nobody can adjudicate.',
      },
    ],
  },
  {
    id: 's3',
    title: 'Correction and supplementation',
    blocks: [
      {
        kind: 'p',
        text: 'Correcting your own data involves nobody: it is a first-class feature. The table below lists what can be corrected. Each edit becomes a new record in the operation log and reaches your other devices through sync.',
      },
      {
        kind: 'table',
        head: ['What you want to correct', 'Where you change it', 'What happens afterwards'],
        rows: [
          ['Task title', 'Task detail / inline in the list', 'A new record is appended; an empty title is refused'],
          ['Note body', 'The note area of a task', 'Same; clearing can clear it to "no note"'],
          ['Due date, "postpone to today"', 'Task detail', 'Same'],
          ['Priority, important flag, quadrant', 'Task detail / quadrant view', 'One action can change due date and quadrant together'],
          ['Completion state', 'List checkbox / focus panel', 'Completing and un-completing are both correctable'],
          ['Belonging: project, parent task, tags', 'The organiser section of a task', 'Tags are replaced as a set; dangling tag ids are refused'],
          ['Repeat rule', 'Task detail', 'Setting "no repeat" is a correction too'],
          ['Projects, notes, habits, focus records, reminders', 'Their own editors', 'They share the same write path as tasks, with the same semantics'],
          ['Interface language', 'Settings', 'Account-level metadata, changeable'],
        ],
      },
      {
        kind: 'callout',
        text: '**The email address cannot be changed.** Your heyta account *is* that address, and as a login credential it can currently be neither changed nor rebound; no such capability exists on our server and we will not promise it here. If you registered with a wrong address, the workable route today is to register again with the right one and ask us to close the account holding the wrong address.',
      },
      {
        kind: 'p',
        text: 'What "correction" actually means in an event-sourced architecture has to be spelled out, or readers will assume the old value disappeared: **a correction appends a new record, it does not overwrite in place.** Change a value five times and the history holds five records; the old value stays in the sync history as ciphertext our server cannot read, until the retention period sweeps it.',
      },
      {
        kind: 'p',
        text: 'For the same reason there is no "ask support to edit this task for me" service: we cannot see plaintext and cannot know what a value "should" be. Editing it yourself on any already-synced device is the only route, and that edit then reaches your other devices through sync.',
      },
    ],
  },
  {
    id: 's4',
    title: 'Deletion: three stages, and what "delete" means here',
    blocks: [
      {
        kind: 'p',
        text: 'heyta has three distinct stages of deletion. Collapsing them into the single word "delete" is the most common source of dishonesty in documents like this one, so we keep them apart.',
      },
      {
        kind: 'ol',
        items: [
          '**Delete**: the entry moves to the Trash and disappears from your lists.',
          '**Restore**: an entry still in the Trash goes back to where it was.',
          '**Purge**: it disappears from the Trash as well and can no longer be restored; only entries already in the Trash can reach this stage.',
        ],
      },
      {
        kind: 'table',
        head: ['Your action', 'In the interface', 'In this device\'s store', 'On our server'],
        rows: [
          ['Delete', 'Gone from lists, visible in Trash', 'Record still present, marked as deleted', 'The corresponding encrypted history is still there'],
          ['Restore', 'Back in its list', 'Marker cleared, which is itself a new record', 'As above, plus one more encrypted record'],
          ['Purge', 'No longer shown in Trash either', 'Record still present, marked as purged', 'The encrypted history remains. ⚠️ Under the current version the daily sweep **matches no data of ours** (its precondition is spelled out in section four), so right now the only route that really removes it is closing the account'],
        ],
      },
      {
        kind: 'p',
        text: 'So it has to be said plainly: **"purge" is not an erasure command, it is a marker.** In theory the encrypted history that carries that data leaves our server by exactly two routes — the retention period expiring, or your account being closed. 🔴 A third sentence has to be added for the current version: **the retention route does not work today** — the daily sweep only processes accounts whose stream already contains a "full-state boundary", which the clients this product ships never produce, and the measured number of rows removed per day is 0. So the only route that really removes it right now is **closing your account**. We do not write "destroyed on the server immediately", because that is not true; spelling out the pruning condition also explains end-to-end encryption and retention properly.',
      },
      {
        kind: 'callout',
        text: '**Three boundaries: local storage, the credentials button, and backups.** (i) The local operation log on this device does not shrink because you deleted a task in the interface; there is **no** "erase all local data" button anywhere in the app, and physically clearing the local plaintext means uninstalling the app (or, on a phone, clearing app data in the system settings) or, on the web, clearing the browser site data. (ii) The **"Clear credentials"** button on the mobile profile screen is easy to misread, so here is exactly what it does: it removes the sync token and passphrase, clears the widget snapshot, and forgets the account email the interface remembered. It **does not delete** this device\'s local database — your tasks and notes stay on the phone. (iii) We take periodic server backups. A backup is a whole-database snapshot: there is technically no way to remove one of your records from a backup that already exists. We therefore do not promise that deletion propagates into backups — deleted content may persist in a backup that has not yet aged out, and disappears when that backup itself reaches the end of its own retention.',
      },
    ],
  },
  {
    id: 's5',
    title: 'Closing your account',
    blocks: [
      {
        kind: 'p',
        text: 'On the server side, account closure is a **real delete**, not a marker: the account row and everything under it — synced data, device records, passkeys, subscriptions and orders, referral relationships and notifications — are removed by cascade. Passwords and tokens die with it, and live connections are dropped. There is no cooling-off period and no Trash: once done, it cannot be undone. 🔴 Local-first means each device keeps its own readable database, so closure also has to answer "what about the copies on the other devices": **the device you press it on wipes its local plaintext on the spot**, and every other device wipes its own copy **the next time it syncs and receives the "account closed" signal**. ⚠️ **Two things we do not promise today**: (1) a device that **never comes back online and never signs in again** — we have no way to remotely erase a device that is not connected, and the copy on it is returned to a clean state only by uninstalling at the operating-system level and clearing the app’s data; (2) 🟡 **the Linux desktop shell**: there the path that is supposed to wipe this device’s local data stops at "empty the content and rewrite the database file" and **cannot remove the file itself** — that shell\'s driver does not hand "remove the container" to the interface layer, and by our own account empty-and-rewrite is an **incomplete** remedy: old content may still be recoverable from free pages. ✅ **The macOS and Windows desktop shells were wired up on 2026-10-04**: those shells keep the storage themselves (the interface switches to the storage the shell hands it as it starts, and its readable copy is written into the desktop program\'s own database file), and the local destruction path now removes that file too, together with its WAL log and shared-memory side files. The phone and the web app do not have a "shell\'s own database" layer.',
      },
      {
        kind: 'p',
        text: 'The closure entry point exists **on all three surfaces**: Web settings, the mobile “Mine” tab, and the command-line client (`account close`). All three require ticking "I understand this also erases this device’s data, including anything not yet synced" followed by a second confirmation, and all three tell you to export first. The command-line client adds a hard stop: if the machine still holds operations that were never uploaded, it **refuses to run, with no override**. The e-mail channel stays open too — send the request to `heyta@waytofuture.cn`, subject line "account closure", from the mailbox that belongs to that account. We complete verification and processing **within 15 working days of receiving the request** and write back the outcome.',
      },
      {
        kind: 'callout',
        text: '**Export your data before closing the account.** This order is irreversible: once the delete has run, we cannot recover it either — the server holds only encrypted events, and without your passphrase they cannot be turned back into plaintext. See section two for what an export contains.',
      },
      {
        kind: 'docRef',
        docId: 'subscription-refund',
        text: 'How a subscription still running at the moment of closure is handled (cancellation, refund, pro-rata return) is governed by the Subscription and Refund terms.',
      },
      {
        kind: 'p',
        text: 'Two limits: (i) we accept requests only from that account\'s mailbox, or from someone we have verified as acting for it, and we may ask you to confirm by replying from that address; (ii) as in section four, a whole-database snapshot offers no targeted removal, so after closure your content may still sit in a backup that has not aged out, and goes away when that backup expires.',
      },
    ],
  },
  {
    id: 's6',
    title: 'Withdrawing consent and refusing processing',
    blocks: [
      {
        kind: 'p',
        text: 'heyta\'s privacy switches are **actual gates**, not settings rows: nowhere that touches privacy ships in the "on" state — for the one that governs going online the factory state is **never having asked** (once asked and you did not agree, it stays off), and the remaining switches ship off; switching one off changes **what is happening right now**, not a note in our records. That is why withdrawal of consent can take effect immediately.',
      },
      {
        kind: 'table',
        head: ['The switch you turn off', 'What actually changes', 'When it takes effect'],
        rows: [
          [
            'Consent to going online (the decision made on the first-launch panel)',
            'Synchronisation, sign-up and sign-in, fetching notification unread counts, the realtime connection and the registration of the offline cache **all stop**; after withdrawal the state is cleared back to “never asked”, and the interface asks you again. Not one local record is touched',
            'Every action that is about to leave the device re-checks it before it acts; a realtime connection already open is closed on the spot',
          ],
          ['The AI master switch', 'No request is made to any external service; candidate endpoints are not even resolved', 'The next call checks it first thing'],
          ['Allow remote endpoints', 'Remote endpoints never enter the candidate list, so no authorisation prompt is produced either', 'Immediately'],
          ['Egress authorisation for one feature', 'That feature sends nothing out; local endpoints still behave as you configured them', 'Re-checked before every network action'],
          ['Memory and preferences', 'Even the input stops being read: nothing is inferred, no preference enters a request', 'Immediately'],
          ['Push / widget background refresh', 'The server-side subscription is deleted and the browser subscription is unregistered — not merely "we stop showing hints"', 'The moment you toggle it'],
          ['The local interface', 'The local service stops accepting any call', 'Immediately'],
        ],
      },
      {
        kind: 'callout',
        text: '**Withdrawal is prospective.** An AI request that has already left your device cannot be recalled by switching a setting off — the data is on the network, not in our hands. Likewise, revoking an authorisation does not invalidate requests already sent. That is a physical boundary, not a policy choice of ours.',
      },
      {
        kind: 'p',
        text: 'Refusing non-essential features never costs you core functionality: creating, editing, completing, viewing and exporting tasks depends on nothing that needs your consent. Every privacy switch ships off, no AI destination is preset, and no cloud endpoint is built in — decline, and the app works as normal.',
      },
    ],
  },
  {
    id: 's7',
    title: 'Making a request: channel, deadlines, and refusal',
    blocks: [
      {
        kind: 'p',
        text: 'There is exactly one channel today: the mailbox `heyta@waytofuture.cn`, which is live. We have no telephone hotline, no live chat, and no physical service point, so this document does not list those three. A hotline nobody answers is worse than no hotline.',
      },
      {
        kind: 'ul',
        items: [
          'Please state in the request: **the email address of the account**, which right above you are exercising, and whether it concerns **particular records or the whole account**.',
          'For deletion or closure, say whether you would like help exporting first.',
          'For a next-of-kin request, attach material that evidences the relationship; we verify it before acting and disclose nothing to unrelated third parties.',
          'Please do not send several emails about the same matter — the first one is handled in queue order.',
        ],
      },
      {
        kind: 'table',
        head: ['Type of request', 'Channel', 'Response time'],
        rows: [
          ['Access, copy, correction, deletion (the self-service ones)', 'In the app, directly', 'Immediate, no waiting'],
          ['Withdrawal of consent, stopping a processing activity', 'Switch it off in the app', 'Immediate'],
          ['Account closure', 'Web settings / the mobile “Mine” tab / `account close` in the command-line client, or by e-mail', 'Self-service takes effect immediately; e-mail requests within 15 working days of receipt'],
          ['Account-level information (e.g. a mistyped registration address)', 'Email', 'Within 15 working days of receipt'],
          ['A request to explain our processing rules', 'Email', 'Within 15 working days of receipt'],
          ['Next-of-kin requests, complaints and reports', 'Email', 'Within 15 working days of receipt'],
        ],
      },
      {
        kind: 'p',
        text: 'If we refuse a request we **state the reason in writing**. The grounds for refusal are set by law and are few (for example, a retention period prescribed by a law or administrative regulation has not yet elapsed); even then we keep the data only for storage and necessary safeguards and stop using it for any other purpose. If you disagree with our answer, you may complain to the department that performs personal information protection duties.',
      },
    ],
  },
  {
    id: 's9',
    title: 'The GDPR position: what lines up, article by article, and what does not',
    blocks: [
      {
        kind: 'p',
        text: 'The table above answers Chinese law. This section answers the General Data Protection Regulation (GDPR), because **the same set of code facts has to survive being asked twice, once under each regime**. It is written the way everything here is written: only actions the code actually performs, and anything it cannot do is stated in the same row rather than moved to a footnote.',
      },
      {
        kind: 'table',
        head: ['GDPR article', 'What it requires', 'The corresponding fact in heyta', 'Where it does not line up'],
        rows: [
          ['Arts. 13, 14 transparency', 'Purposes, categories, retention and recipients disclosed item by item', 'This set of documents **is** the disclosure vehicle: the data inventory, retention and backups, third parties and permissions are each listed out', 'These texts publish no data-protection-officer or EU-representative contact (Arts. 27, 37); the only channel is the mailbox'],
          ['Art. 15 access', 'Inform and provide a copy of the personal data', 'Export is **self-service**, and only you can open it: the server stores end-to-end-encrypted events, which cannot be turned back into plaintext without your passphrase', 'Precisely because what you hold is never our plaintext, we cannot look up "what your task titles are" on your behalf — this right is exercised by your device, not by us querying for you'],
          ['Art. 16 rectification', 'Correct without undue delay', 'Edit it in the interface; the change reaches your other devices through sync', '**The e-mail address cannot be corrected**: there is no rebinding route on the server, so an account identifier written wrong can only be handled by registering the right one and asking us to close the wrong one'],
          ['Art. 17 erasure', 'Delete without undue delay', 'In-app deletion plus the "purge" marker in Trash plus the account-level cascade hard delete (measured: 19 foreign keys referencing `users` with CASCADE, covering 18 tables) + the device you press closure on wipes its local plaintext on the spot, and every other device wipes its own on the next sync that receives the closure signal', 'Two things not promised: a device that never comes back online cannot be erased remotely, and a whole-database snapshot offers no targeted removal — it goes away when that backup ages out'],
          ['Art. 18 restriction', 'Suspend processing while keeping the data', 'What actually exists is withdrawal of consent: switch an item off and every outbound action for it stops immediately, and a realtime connection already open is closed on the spot', 'There is no "freeze the whole account but keep the data" state (the product has no such state); stopping everything means closing the account'],
          ['Art. 20 portability', 'Structured, commonly used, machine-readable data, transmitted to another controller', 'The export file is plaintext JSON containing the **tombstones** and the complete operation log, with verifiable counts (a backup that drops tombstones resurrects deleted data on replay)', 'We offer no channel that moves that file into somebody else’s service for you; the conversion is yours'],
          ['Arts. 21, 22 objection and automated decisions', 'Object to specific processing; not be subject to a decision taken solely on automated processing', 'In this code base AI **cannot produce a write at the type level**: reads execute immediately, writes only produce a proposal, and nothing is written into your data until you confirm; leaving the device additionally requires per-feature authorisation', 'Withdrawing consent does not roll back data already synced to your other devices — that part you delete yourself'],
          ['Arts. 32, 33 security and breach notification', 'Measures appropriate to the risk; notify once aware', 'End-to-end encryption is the default rather than an option, and both the passphrase hash and the server-side ciphertext use Argon2id; even a wholesale leak of synced content yields ciphertext', 'The trigger is described in terms of **account identifiers and metadata** (those are not encrypted); under a self-hosted deployment the duty-holder for this article is the deployer, not us'],
        ],
      },
      {
        kind: 'p',
        text: '**Who the controller is depends on which deployment.** On the officially hosted instance heyta decides the purposes and means, so we are the controller. Under a **self-hosted** deployment the server is yours and the data sits on your machine, which makes us the software rather than a processor — we neither reach your data nor hold a key that could decrypt it for you. Cross-border follows the same split: the officially hosted server is in mainland China, so access from the European Union is a transfer to a third country, and **this section claims no transfer mechanism** (standard contractual clauses, an adequacy decision or a transfer impact assessment) — at that layer there is neither code nor documentation today. The one thing that can be stated is that a self-hosted deployment keeps the data on your own machine.',
      },
      {
        kind: 'ul',
        items: [
          '**Asked for by the GDPR but not done**: a data protection impact assessment, the appointment of a data-protection officer or an EU representative, and a stand-alone text for EU users. Today all three exist in this section only as an honest register, with no product or legal action behind them.',
          '**The cooling-off period is still undecided**: Art. 17 asks for “without undue delay”, while an irreversible self-service closure that also erases not-yet-synced local data may or may not need a revocable waiting window. That is a product-and-legal trade-off, and this file does not decide it for them (see the boundary in the row for Art. 17 above and in the minors document).',
          '**Total destruction on the backup side**: the “no targeted removal in a whole-database snapshot” line can only be flipped by making the backups themselves crypto-erasable (destroy the key and the content counts as deleted). That is an operations action, it has not been done, so the right-hand column of the Art. 17 row still reads “not promised”.',
          '**This section follows the code**: every right-hand column above points at a specific gap, and the day a gap is closed the text must be rewritten in the same change and the version bumped — the version number is what your consent record stores.',
        ],
      },
    ],
  },
  {
    id: 's8',
    title: 'When this document changes',
    blocks: [
      {
        kind: 'p',
        text: 'Every "not today" in this document comes with its trigger condition; none of them is filler wording. When the four items below change, the text changes with them. A change also raises the version number, because the version number is what your consent record stores.',
      },
      {
        kind: 'ul',
        items: [
          '**If we ever gain the ability to remotely erase a device that is not connected** (we do not have it today): the boundary in section five about “a device that never comes back online” disappears and the text changes with it. The item that used to sit here — “once account closure has an interface entry” — was fulfilled in 1.2 and is no longer a pending trigger.',
          '**Once the Linux desktop shell hands the "remove the container" step down to the interface layer**: item (2) in section five — "the file itself cannot be removed" — disappears and the list of what is not promised goes back from two items to one. (The macOS and Windows desktop shells were wired up on 2026-10-04, so Linux is the only shell left.)',
          '**Once email rebinding is implemented**: "the email address cannot be changed" in section three is deleted and replaced by the rebinding procedure.',
          '**Once the retention period changes**: the 45 days in section four changes with it. It is a product setting, not an option you can pick, and changing it requires a release. A second event also requires this text to change: **the day the sweep really starts applying to our data** (see the boundary spelled out in section four).',
        ],
      },
      {
        kind: 'table',
        head: ['Version', 'Date', 'Change'],
        rows: [
          ['1.0', '2026-10-01', 'First draft (not yet in force): eight rights checked against the actual code, with account closure and email correction committed as a channel rather than as self-service.'],
          [
            '1.1',
            '2026-10-02',
            'Section six now lists “consent to going online” as the **first row** of the gate table (the first-launch privacy panel and the outbound-request gate have landed), and states the **three things that actually happen** when you withdraw it: every outbound action stops, a realtime connection already open is closed on the spot, and the state is cleared back to “never asked” so the interface asks again. The “withdrawal of consent” row of the table in section one names the same item.',
          ],
          [
            '1.2',
            '2026-10-04',
            'Section five moves from “a channel, not self-service” to a **self-service statement**: closure entries exist in Web settings, in the mobile “Mine” tab and in the command-line client, each with the tick-box acknowledgement, the export-first prompt, and the command line refusing to run while un-uploaded operations exist. The same section now states the local-copy boundary as **layered truth** — the device you press it on is wiped on the spot, other devices wipe themselves on the next sync that receives the closure signal, and the only thing not promised is a device that never comes back online. The matching rows of the tables in sections one and seven are rewritten with it. A new section, “The GDPR position: what lines up, article by article, and what does not”, was added in the same change: eight articles each mapped to one code fact, and **every row carries its own “where it does not line up” cell** (no data-protection officer or EU representative, the e-mail address cannot be corrected, no remote wipe of an offline device, no targeted removal from a whole-database snapshot, no claimed transfer mechanism), mirrored block by block in both languages. The same version widens the list of what is not promised from one item to **two**: besides the device that never comes back online, 🟡 on the **Linux desktop shell** the path that is supposed to wipe this device’s local data still stops at "empty the content and rewrite the database file" and **cannot remove the file itself**. ✅ The macOS and Windows desktop shells were wired up on the same day (2026-10-04): those two shells hand the interface’s readable copy to their own local database, and the destruction path now removes that database file together with its WAL log and shared-memory sidecar — both shells were measured doing it end to end at shell level (`containerRemoved:true`, with the files confirmed gone from outside the shell). Section eight’s trigger list is rewritten with it, so the outstanding item there is Linux only.',
          ],
        ],
      },
    ],
  },
] as const;

export const dataRights: LegalDocument = {
  id: 'data-rights',
  version: '1.2',
  status: 'draft',
  updatedDate: '2026-10-04',
  title: {
    'zh-CN': '个人权利行使与请求响应',
    en: 'Exercising Your Rights: Requests and Responses',
  },
  summary: {
    'zh-CN':
      '查阅、复制、更正、删除、注销、撤回同意逐项在 heyta 里怎么做；哪些能自助、哪些只能走邮件、答复时限 15 个工作日，以及"删除"在这个架构里到底意味着什么。',
    en:
      'Access, copy, correction, deletion, account closure and withdrawal of consent — what is self-service in heyta, what is email-only, the 15-working-day response window, and what "deletion" actually means in this architecture.',
  },
  sections: { 'zh-CN': zh, en },
};
