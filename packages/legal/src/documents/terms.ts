/**
 * heyta 用户协议 / 服务条款
 * ==========================
 *
 * 这份文本管的是**「你和我们之间约定了什么」**：三样东西各自归谁管、你能拿应用
 * 做什么、我们的托管同步服务承诺什么与不承诺什么、到期之后会发生什么、出问题
 * 责任怎么分。
 *
 * 法定出处：《中华人民共和国民法典》第四百九十六条、第四百九十七条（格式条款：
 * 提供方须以合理方式提示说明；免除自身责任、加重对方责任、排除对方主要权利的
 * 条款无效）。s8 的写法就是按这一条来的 —— 见那里的第一段。
 *
 * 🔴 **最容易写错的一条，也是本文件与其他八份的最大区别：本文件不许出现任何
 * 价格数字与期限天数。** 价格、免费额度、付款渠道、发票、退款条件与到账时效的
 * 唯一事实源是《订阅、计费与退款》（docId `subscription-refund`，实现文件
 * `packages/legal/src/documents/subscription-refund.ts`）。一份文本抄另一个文件
 * 里的数字，就会有各说一个价的那一天，而两份互相矛盾的价格比没有价格更难解决。
 * s5 因此只做一件事：指向那一份。
 *
 * ⚠️ 第二条容易写错的是 s4 的后半句。端到端加密只约束**内容**，不约束**形状**：
 * 服务器为完成同步必须保存明文的操作元数据。只写「我们看不到你的任何数据」就是
 * 虚假陈述。正确口径见 s4 的 callout。
 *
 * 📌 备案号尚未核准，因此本文件不写备案号；也不写电话、微信、客服响应时限 ——
 * 这些通道并不存在，写上去等于给用户一条走不通的救济路径（见 s9）。
 */

import type { LegalDocument } from '../types.js';

const zh = [
  {
    id: 's1',
    title: '谁与你约定，以及本条款不管什么',
    blocks: [
      {
        kind: 'p',
        text: '本条款由**晓黎（杭州）人工智能科技有限公司**与你约定：统一社会信用代码 `91330106MAKNJ6DX7M`，法定代表人 邓湘雷，住所 浙江省杭州市西湖区蒋村街道文一西路 830 号蒋村商务中心 3 号楼 210 室，联系邮箱 heyta@waytofuture.cn。下面这张三分法表决定了"哪件事找我们、哪件事不找我们"，请先看它，再看后面任何一条。',
      },
      {
        kind: 'table',
        head: ['对象', '是否受本条款约束', '费用'],
        rows: [
          ['heyta 应用本体（全部功能）', '❌ 不受，MIT 许可', '❌ 免费'],
          ['你自建自托管的服务器', '❌ 不受，与我们无关', '❌ 不需要'],
          ['我们提供的托管同步服务', '✅ 受约束', '见《订阅、计费与退款》'],
        ],
      },
      {
        kind: 'p',
        text: '换句话说：**本条款约束的只有一件事 —— 我们替你运行的那台服务器。** 应用本身是自由软件，你从哪个渠道拿到它、改不改、分不分发，都不需要同意本条款；你自己在家里或自己的云上搭一台服务器，那台服务器与我们之间没有任何合同关系：我们不为其背书，不从中收费，也不为其上的数据承担本条款下的义务。',
      },
      {
        kind: 'callout',
        text: '这张表是分界线，不是客套话。后面每一条承诺与每一条限制，都只在第三行（我们提供的托管同步服务）上成立。若某一条读起来像是我们在管你设备上的应用，它管的其实是我们自己的服务。',
      },
    ],
  },
  {
    id: 's2',
    title: '账户、凭据，以及账户下发生的行为',
    blocks: [
      {
        kind: 'p',
        text: '注册只需要**一个邮箱地址**和一组**通行密钥**。我们不需要你的手机号、姓名、身份证号，也不向你索取任何身份证件。账户的作用只有一个：让服务器知道哪些密文有权被送到哪些设备。',
      },
      {
        kind: 'ul',
        items: [
          '凭据由你自己保管。通行密钥保存在你的设备或你所使用的凭据管理器里，从来不经过我们的服务器。',
          '你须对**在你的账户下发生的一切行为**负责，包括任何拿到你凭据的人所做的改动 —— 因为从服务器的角度看，那与你自己做的改动无法区分。',
          '如果你怀疑凭据已经泄露，请把它当作安全事件处理并立刻通过 s9 的邮箱告诉我们；同时请理解 s4 那条架构事实会如何限制我们能帮你做到的程度。',
        ],
      },
      {
        kind: 'p',
        text: '🔴 **一条当前实现的限制，我们不藏：注册邮箱目前不可更换。** 产品里没有自助换绑邮箱的入口。这是产品现状而不是我们故意设的门槛，但它带来的后果是真的：邮箱一旦停用或收不到信，你可能收不到通知与变更告知（这一条与 s9 的送达规则直接相关，请连着读）。',
      },
      {
        kind: 'callout',
        text: '把"邮箱目前不可更换"和"加密口令丢失后我们无法帮你恢复数据"（s4）放在一起读：这两条合起来意味着**账户的可恢复性目前主要落在你自己身上**。这不是服务水平，而是本地优先与端到端加密的必然代价 —— 我们把代价写在这里，是为了让你在注册之前就知道自己在接受什么。',
      },
    ],
  },
  {
    id: 's3',
    title: '软件许可：应用本体是 MIT 许可的自由软件',
    blocks: [
      {
        kind: 'p',
        text: '**应用本体是 MIT 许可的自由软件，你有权自行搭建服务器使用全部功能，不需要购买任何东西、不需要通知我们、我们也不会对此做任何校验或限制。**',
      },
      {
        kind: 'ul',
        items: [
          '在任何设备上安装、运行应用本体，不限设备数量，也不限平台。',
          '阅读、修改、重新分发源码，或把它做成你自己的产品。',
          '自行部署同步服务端，让你的数据只存在你自己控制的机器上。',
          '不购买任何订阅、不提供任何付款信息，长期、完整地使用全部功能。',
        ],
      },
      {
        kind: 'p',
        text: '你不需要"激活"，不需要联网验证授权，也不需要定期回到我们这里确认身份。我们的服务端**不做"这个客户端有没有付费"的校验**来锁住应用本体的功能 —— 因为按 s1 的三分法，那种校验本来就不该存在。',
      },
      {
        kind: 'callout',
        text: '一个容易混的点：**MIT 给你的权利，不会因为本条款而缩减。** 本条款签的是"我们的托管服务"这一件事；你在上面表格前两行下的自由，不以任何形式的付款为前提。MIT 许可证原文随源码分发，就软件本身而言，以许可证原文为准。',
      },
    ],
  },
  {
    id: 's4',
    title: '我们提供的托管同步服务：只中转密文，但中转的是密文的形状',
    blocks: [
      {
        kind: 'p',
        text: '前半句：**同步数据在离开你的设备之前就已经加密。** 我们的服务器收到的、保存的、转发给你其他设备的都是密文。我们没有能力读取、检索或分析你的任务标题、清单名称、备注文字；我们也不会要求你上传明文。任何人以 heyta 官方的名义要求你上传明文数据，那不是我们。',
      },
      {
        kind: 'p',
        text: '后半句同样重要，而且必须写出来：为了完成同步，服务器必须知道**每一条改动长什么样**。为此它保存的是**明文的操作元数据**，包括下列各项。这不是实现上的疏漏，而是"服务器看不到内容、却要把正确的密文送到正确的设备并正确排序"这件事本身的必要条件。',
      },
      {
        kind: 'ul',
        items: [
          '这条改动属于哪一类对象（实体类型）',
          '涉及哪个对象的标识（实体 id）',
          '操作类型',
          '每台设备各自的改动计数（用来判断两条改动谁先谁后）',
          '客户端时间戳',
          '到达我们服务器的时间',
          '序号',
          '载荷字节数',
          'schema 版本',
          '发起这次改动的设备标识',
        ],
      },
      {
        kind: 'callout',
        text: '正确的口径只有一句：我们看不到你任务的**内容**，但能看到每一条改动的**形状**。谁在什么时候改过多少个对象、某个对象被改过多少次、哪两台设备在并发写同一个东西 —— 这些我们从密文之外的元数据里读得出来。因此，**"服务端完全看不到你的任何数据"这句话是虚假陈述**，本文件不这么写。',
      },
      {
        kind: 'p',
        text: '还有第三件容易被漏掉、但不写就是误导的事：**端到端加密覆盖的是同步通道，不覆盖你设备上的本地存储。** 为了能离线读写、能在应用异常后恢复，落在你设备上的数据是明文，靠你设备自身的锁屏、账户隔离与文件权限保护。设备失窃且未设锁屏，或者你把解锁凭据交给别人，等于把数据交出去。（唯一例外是桌面小组件写出的那份快照，它是 AES-256-GCM 密文。）',
      },
      {
        kind: 'callout',
        text: '🔴 **由此产生的一条后果，我们需要你在知情下接受：丢失加密口令后，我们无法帮你恢复数据。** 我们没有解密能力 —— 不是"不方便做"、不是"额度不够"，而是**架构上不存在这个能力**。这是端到端加密的定义，不是服务水平问题。你能做的补救只有：在其他仍已登录的设备上导出数据，或者从 s9 的联系邮箱与我们商量还能做什么。',
      },
      {
        kind: 'p',
        text: '计费涉及的信息**仅限**你的账户标识与权益状态，不涉及任何任务内容 —— 我们从设计上就没有可以拿来定价或推销的内容数据。',
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: '上述明文元数据的完整清单、法定分类、保存期限与我们的处理依据，见《隐私政策》。',
      },
      {
        kind: 'docRef',
        docId: 'permissions',
        text: '小组件快照、系统备份、局域网自建服务器这几项"不需要你点同意但确实影响隐私"的数据流，见《应用权限清单》。',
      },
    ],
  },
  {
    id: 's5',
    title: '订阅与计费',
    blocks: [
      {
        kind: 'p',
        text: '**本节不写任何金额，也不写任何期限。** 价格、免费额度、付款渠道、发票、退款条件与到账时效的唯一事实源是《订阅、计费与退款》。理由很直接：一份文本去抄另一份文件里的数字，就一定会有"各说一个价"的那一天，而两份互相矛盾的价格比没有价格更难收拾。',
      },
      {
        kind: 'docRef',
        docId: 'subscription-refund',
        text: '凡涉及"多少钱、买多久、能不能退、怎么开票、权益什么时候生效"的问题，一律以《订阅、计费与退款》为准。',
      },
      {
        kind: 'ul',
        items: [
          '收费对象**只有** s1 表格第三行所描述的托管同步服务。',
          '订阅的效力只及于托管同步：它不解锁、也不锁住应用本体的任何功能（见 s3 与 s6）。',
          '计费涉及的信息仅限账户与权益状态，不涉及任何任务内容（见 s4）。',
        ],
      },
      {
        kind: 'p',
        text: '若本节的表述与《订阅、计费与退款》出现不一致，**以《订阅、计费与退款》为准**；请把这种不一致当作我们的缺陷报告给我们 —— 两份对外文本互相矛盾，是我们的错误，不该由你来猜哪份算。',
      },
    ],
  },
  {
    id: 's6',
    title: '到期、中止与终止：我们不把数据当人质',
    blocks: [
      {
        kind: 'p',
        text: '核心承诺只有一句：**到期或未续费不会让任何一份数据变得不可读、不可用或拿不出来。** 我们不以删除数据作为催缴手段，也不设"过了某个期限自动清空"的机制。下表就是这件事的完整清单 —— 表里没有的，就是我们不会做的。',
      },
      {
        kind: 'table',
        head: ['项目', '到期后'],
        rows: [
          ['你设备上的本地数据', '🔴 一个字都不动：不删除、不修改、不清空、不锁定'],
          ['应用功能', '🔴 不受影响：全部功能照常可用，可继续查看、编辑、导出'],
          ['已同步到服务器的数据', '🔴 不删除：我们不以删除数据作为催缴手段'],
          ['托管同步', '⏸ 停止（所有设备，不只是新设备）'],
          ['出路', '① 续费；② 改为使用你自己的服务器，同步立即恢复、数据无损'],
        ],
      },
      {
        kind: 'p',
        text: '因此，**未按期续费的后果仅限于停止托管同步**，不扩展到功能、数据、凭据或你已获得的其他权益。价格与退款规则不在本节重复，见 s5 的指向。',
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: '你要求导出、复制、删除与注销账户的具体路径、格式与我们的响应时限，见《数据权利与行使方式》。',
      },
      {
        kind: 'p',
        text: '中止与终止：我们能中止或终止的对象是**托管服务本身**（例如 s7 的使用规则被严重违反，或我们停止运营该项服务），而不是你的本地数据。除法律要求我们必须立即处置的情形外，中止前我们会按 s9 的方式通知你，并给你先把数据导出的机会。',
      },
      {
        kind: 'ul',
        items: [
          '无论服务因何中止或终止，你在 s3 下的 MIT 权利不受影响：带着自己的数据改成自建服务器，始终可行。',
          '服务终止时我们会先通知、再停止接入，不会用"突然关断"的方式让你的设备停在同步失败上而无人说明原因。',
          '你随时可以停止使用：关闭同步、导出数据、继续用应用本体，都不需要经过我们同意。',
        ],
      },
    ],
  },
  {
    id: 's7',
    title: '你的责任与使用规则',
    blocks: [
      {
        kind: 'p',
        text: '下面的规则约束的是**你使用我们托管服务的方式**，以及你对自己账户与设备负有的注意义务。它们不缩减 s3 下你作为软件使用者与再分发者的权利。',
      },
      {
        kind: 'ul',
        items: [
          '不利用我们的服务存储、传输或传播违反法律法规的内容。',
          '不试图绕过加密与授权机制读取他人账户的数据，也不以未经授权的探测、压力测试或逆向工程来获取访问能力。',
          '不干扰或破坏服务的正常运行，包括以自动化方式施加超出正常使用范围的负载。',
          '不冒用他人身份注册，不出借、转让或出售你的账户。你的设备标识是我们裁决并发改动的依据（见 s4），同一份凭据在多处使用会造成连你也解释不清的数据竞争。',
          '自行保管设备与凭据，并自行判断你配置的那个同步地址是否可信 —— 你把数据指向你不认识的服务器时，我们保护不了你。',
        ],
      },
      {
        kind: 'p',
        text: '⚠️ **一条必须说清的边界**：当你把同步地址配置成第三方托管或自己搭建的服务器时，你的数据不再经过我们的服务。本条款既不让我们对那份数据负责，也不给你任何针对我们的主张 —— 那种场景下的权利义务，完全由你与该服务器提供方之间的约定决定。',
      },
      {
        kind: 'callout',
        text: '我们**没有**"违规即封号并清空数据"式的处置权。s7 被违反时，我们能采取的处置只有**中止托管同步**这一项服务（见 s6），并且要按 s9 通知你。你的本地数据始终在你手上，不因为我们与你的分歧而受影响。',
      },
    ],
  },
  {
    id: 's8',
    title: '免责与责任限制',
    blocks: [
      {
        kind: 'p',
        text: '**先说我们承担的那一条**：heyta 是本地优先的应用，**服务端故障、被攻击、被关停，或者我们自己停止运营这项服务，都不会让你设备上的本地数据变得不可用。** 你始终可以查看、编辑、导出。这一条不以赔偿为前提，也不受本节下面任何限制的影响 —— 它是架构承诺，不是免责条款。',
      },
      {
        kind: 'p',
        text: '在适用法律允许的范围内，我们的托管同步服务按"现状"与"当前可用"提供。我们不承诺：不间断运行；不出现延迟或临时失败；也不承诺某一项服务永远以同一形式存在（服务与条款本身的变更见 s10）。这些不承诺的后果只落在"同步"这件事上，不落在你的数据上。',
      },
      {
        kind: 'p',
        text: '在适用法律允许的范围内，因本条款或我们的托管服务而引起、且我们依法应当承担责任的损失，我们的**累计赔偿以你在相关期间内就该项服务实际已支付的费用总额为限**。这一上限不适用于法律明确规定不得限制或免除的损失类型；适用法律不允许设此上限时，本节不产生上限的效力。',
      },
      {
        kind: 'ul',
        items: [
          '下面几项风险，我们已经在 s2、s4、s6 以显著方式逐项说明。本节**不是**由我们单方宣布"概不负责"，而是请你确认：**你在知情下接受这些由架构带来的风险。**',
          '风险一：加密口令或凭据丢失后我们无法帮你恢复数据 —— 我们没有解密能力，这是架构的必然结果（s4）。',
          '风险二：本地存储是明文，设备失窃或未设锁屏时的后果由你设备自身的防护决定（s4）。',
          '风险三：未续费期间跨设备同步不发生，该期间的改动只存在于你当时使用的那台设备上（s6）。',
          '风险四：你把同步地址配置为你并不信任的服务器时，密文与元数据都会流向那台服务器（s1、s7）。',
        ],
      },
      {
        kind: 'p',
        text: '我们**不**写"我们对任何损失均不承担责任"这类句子。按《中华人民共和国民法典》第四百九十七条，提供格式条款一方免除自身责任、加重对方责任、排除对方主要权利的条款无效 —— 那样的写法不但没有保护，反而是一眼可辨的模板痕迹。上面每一条限制都限于我们依法可以限制的范围。',
      },
      {
        kind: 'p',
        text: '无论本条款其他部分如何表述，我们依法应当承担的责任不因本节而免除或限制，包括因我们故意或重大过失造成你损失、以及法律明确规定不得预先免除的责任。这一句是本节的兜底，优先级高于上面任何一句。',
      },
    ],
  },
  {
    id: 's9',
    title: '通知与送达',
    blocks: [
      {
        kind: 'p',
        text: '我们向你发消息只有两个通道：**应用内的站内通知**，以及**你注册时提供的邮箱**。我们不通过广告网络、电话或短信向你推送营销内容。',
      },
      {
        kind: 'p',
        text: '联系我们的入口是邮箱 heyta@waytofuture.cn。我们**没有**电话、没有微信客服、也没有对外承诺的客服响应时限 —— 把不存在的路径写进条款，只会让你把时间花在打不通的地方，所以我们只写真的能收信的那一个。',
      },
      {
        kind: 'p',
        text: '下列变更我们会**提前**通知你，并且**不溯及你已经购买的期间**：价格与计费方式、服务期限与权益范围、退款政策，以及责任限制（s8）与数据相关的承诺（s4）。已经付过钱的那一段服务，继续适用购买时那一版。',
      },
      {
        kind: 'p',
        text: '送达时点：站内通知在你下次打开应用时视为送达；邮件在我们成功发出该邮件时视为送达。请保持你的注册邮箱可用 —— 并把它与 s2 里"邮箱目前不可更换"这条限制连着读：那确实是你账户的一项风险，我们把它写在显眼处，而不是藏在你不会读的地方。',
      },
      {
        kind: 'callout',
        text: '如果你因账户问题联系我们，请一并说明你使用的设备与大致时间。**请不要在邮件里贴出任何明文的任务内容来"证明身份"** —— 我们看不到你的内容（s4），因此也从来不需要、不会要求你提供它。',
      },
    ],
  },
  {
    id: 's10',
    title: '条款变更，以及我们记下你同意的是哪一版',
    blocks: [
      {
        kind: 'p',
        text: '本条款可以变更。变更时我们同时更新版本号与本页日期，写明改了什么（s12），并按 s9 通知你。⚠️ **变更不溯及你已经购买的期间**：那一段服务适用的是你购买时那一版里的价格、期限与退款规则。',
      },
      {
        kind: 'p',
        text: '涉及数据用途、责任范围或退款政策的**重大变更**，我们需要你在应用内**重新确认**，而不是"你继续用就视为同意"。同意必须是做出的，不是被推定的。',
      },
      {
        kind: 'p',
        text: '**同意留痕**：注册时我们记下的不是含糊的"他同意过了"，而是一整套版本指纹 —— 形如 `terms@<版本>;…` 的组合，把当时每一份对外文本的版本号一起钉住。它回答的是"此人在什么时刻同意了**哪一版**"，而不依赖任何人的记忆或复述。',
      },
      {
        kind: 'p',
        text: '为什么这件事在这款产品上尤其必须做：端到端加密意味着我们看不到你的内容（s4），所以**任何关于"当时约定的是什么"的争议只能靠版本记录回答**，不可能靠"我们保存的那段数据"回答。版本号因此是证据的一部分，改版必须 bump。',
      },
      {
        kind: 'p',
        text: '自建服务器场景下（s1 表格第二行），你同意的是**该服务端提供方**的条款，与本文件无关。我们不替第三方作任何承诺，也不代为解释他们的条款。',
      },
      {
        kind: 'p',
        text: '你当前适用的那一版随时可以从应用内的法律入口打开；版本号写在页面顶部，历次变更列在下面 s12。',
      },
    ],
  },
  {
    id: 's11',
    title: '适用法律与争议解决',
    blocks: [
      {
        kind: 'p',
        text: '本条款的订立、效力、解释与争议解决，适用**中华人民共和国法律**。',
      },
      {
        kind: 'p',
        text: '因本条款或我们的托管服务发生争议，请先与我们协商（联系邮箱见 s9）。协商不成的，任何一方可向**杭州市西湖区有管辖权的人民法院**提起诉讼；法律对管辖另有强制性规定的，从其规定。这条不排除你依法享有的其他救济途径。',
      },
      {
        kind: 'p',
        text: '本条款某一条被认定无效或不可执行，不影响其余条款的效力；无效的那一条由最接近其原意、且合法有效的约定替代。',
      },
      {
        kind: 'p',
        text: '⚠️ 本条不适用于 s1 表格的前两行：MIT 许可下你对软件本身的权利不是本条约定的标的，也不因本条款而改变、或被本条的管辖约定所限制。',
      },
    ],
  },
  {
    id: 's12',
    title: '版本记录',
    blocks: [
      {
        kind: 'p',
        text: '版本号会进同意记录（s10），所以它的变更是有代价的：每次实质修改都要同时 bump 版本号、写明改了什么、留下日期。本页顶部显示的就是你现在读的这一版。',
      },
      {
        kind: 'table',
        head: ['版本', '日期与变更摘要'],
        rows: [
        ['1.0', '2026-10-01 首次起草，尚未经法务复核'],
        ['1.1', '2026-10-02 英文栏在转写名之外补上登记的中文主体名称（此前该栏只有转写名，而本条款是九份里唯一规定合同主体的那份）；s10 的指纹示例改写成不钉死版本号的形式。'],
      ],
      },
    ],
  },
] as const;

const en = [
  {
    id: 's1',
    title: 'Who is bound by these terms, and what they do not govern',
    blocks: [
      {
        kind: 'p',
        text: 'These terms are agreed between you and **晓黎（杭州）人工智能科技有限公司** (Xiaoli (Hangzhou) Artificial Intelligence Technology Co., Ltd.; the registered Chinese name above is the authoritative one. Unified Social Credit Code `91330106MAKNJ6DX7M`; legal representative Deng Xianglei; registered address Room 210, Building 3, Jiangcun Business Center, No. 830 Wenyi West Road, Jiangcun Subdistrict, Xihu District, Hangzhou, Zhejiang, China; contact email heyta@waytofuture.cn). The three-way table below decides which matters you bring to us and which you do not. Read it before anything else.',
      },
      {
        kind: 'table',
        head: ['Thing', 'Governed by these terms', 'Cost'],
        rows: [
          ['The heyta application itself (all features)', '❌ Not governed; MIT licence', '❌ Free'],
          ['A server you build and self-host', '❌ Not governed; nothing to do with us', '❌ Not required'],
          ['The hosted sync service we provide', '✅ Governed', 'See Subscription, Billing and Refunds'],
        ],
      },
      {
        kind: 'p',
        text: 'Put plainly: **these terms govern exactly one thing — the server we run on your behalf.** The application is free software; where you obtained it, whether you modify it, and whether you redistribute it have nothing to do with agreeing to these terms. If you set up a server in your own home or on your own cloud, there is no contractual relationship between that server and us: we do not endorse it, we take no money from it, and we assume no obligation under these terms for the data on it.',
      },
      {
        kind: 'callout',
        text: 'This table is a boundary, not a courtesy. Every promise and every restriction further down applies only to row three (the hosted sync service we provide). Where a clause reads as though we are regulating the app on your device, it is in fact regulating our own service.',
      },
    ],
  },
  {
    id: 's2',
    title: 'Accounts, credentials, and what happens under your account',
    blocks: [
      {
        kind: 'p',
        text: 'Registration requires **one email address** and **one passkey**. We do not require your phone number, your name, your national identification number, and we ask you for no identity document of any kind. The account has exactly one purpose: to tell the server which ciphertext is permitted to be delivered to which device.',
      },
      {
        kind: 'ul',
        items: [
          'You keep your own credentials. Your passkey lives on your device or in the credential manager you choose; it never passes through our server.',
          'You are responsible for **everything that happens under your account**, including changes made by anyone who obtained your credentials — from the server\'s point of view such a change is indistinguishable from one you made yourself.',
          'If you suspect your credentials have leaked, treat it as a security incident and tell us immediately at the address in s9; while doing so, please understand how the architectural fact stated in s4 limits what we are able to do for you.',
        ],
      },
      {
        kind: 'p',
        text: '🔴 **One limitation of the product as it exists today, which we do not conceal: the registration email cannot currently be changed.** There is no self-service re-binding flow. This is the present state of the product rather than a barrier we chose to build, but its consequence is real: if that mailbox becomes unusable, you may stop receiving notices and change announcements (this interacts directly with the service-of-notice rule in s9; read the two together).',
      },
      {
        kind: 'callout',
        text: 'Read "the email cannot currently be changed" together with "if you lose your encryption passphrase we cannot recover your data" (s4). Taken together they mean that **the recoverability of your account rests mainly with you today**. That is not a service-quality issue; it is the inevitable price of local-first plus end-to-end encryption. We state the price here so that you know what you are accepting before you register.',
      },
    ],
  },
  {
    id: 's3',
    title: 'Software licence: the app itself is free software under MIT',
    blocks: [
      {
        kind: 'p',
        text: '**The application itself is free software under the MIT licence. You are entitled to build your own server and use every feature; you need to buy nothing, you need not notify us, and we will impose no check, gate or restriction on any of it.**',
      },
      {
        kind: 'ul',
        items: [
          'Install and run the application on any device, with no limit on devices or platforms.',
          'Read, modify and redistribute the source, or turn it into your own product.',
          'Deploy the sync server yourself, so that your data resides only on machines you control.',
          'Use every feature indefinitely without purchasing a subscription or supplying any payment details.',
        ],
      },
      {
        kind: 'p',
        text: 'There is no activation step, no online entitlement check, and no requirement to return to us periodically to re-assert your identity. Our server **does not verify "has this client paid"** in order to lock application features — because under the three-way split in s1 no such check ought to exist.',
      },
      {
        kind: 'callout',
        text: 'One point that is easy to conflate: **the rights MIT grants you are not reduced by these terms.** These terms are about one thing, namely our hosted service. Your freedom under rows one and two of the table above does not depend on payment of any kind. The MIT licence text ships with the source and governs the software itself.',
      },
    ],
  },
  {
    id: 's4',
    title: 'Our hosted sync service: we relay ciphertext, but the shape of the ciphertext',
    blocks: [
      {
        kind: 'p',
        text: 'The first half of the sentence: **sync data is encrypted before it leaves your device.** Our server receives, stores and forwards to your other devices nothing but ciphertext. We have no ability to read, search or analyse your task titles, list names or note text, and we will never ask you to upload plaintext. Anyone demanding plaintext data from you in the name of official heyta functionality is not us.',
      },
      {
        kind: 'p',
        text: 'The second half is equally important and must be stated: in order to perform synchronisation the server has to know **what each change looks like**. For that purpose it stores **plaintext operational metadata**, comprising the items listed below. This is not an implementation oversight; it is a necessary condition of "the server cannot see the content, yet must deliver the right ciphertext to the right device in the right order".',
      },
      {
        kind: 'ul',
        items: [
          'which class of object the change concerns (entity type)',
          'which object it concerns (entity identifier)',
          'the operation type',
          "each device's own count of the changes it has seen (this is what orders concurrent edits)",
          'the client-side timestamp',
          'the time of arrival at our server',
          'the sequence number',
          'the payload size in bytes',
          'the schema version',
          'the identifier of the device that made the change',
        ],
      },
      {
        kind: 'callout',
        text: 'The only accurate formulation is this one: we cannot see the **content** of your tasks, but we can see the **shape** of every change. Who changed how many objects at what time, how often a given object was modified, which two devices are writing the same object concurrently — all of that is legible to us from the metadata outside the ciphertext. Accordingly, **"the server cannot see any of your data" is a false statement**, and this document does not make it.',
      },
      {
        kind: 'p',
        text: 'A third point that is routinely omitted and whose omission would mislead you: **end-to-end encryption covers the sync channel, not the local storage on your device.** So that you can read and write offline and recover after a crash, the data at rest on your device is plaintext, protected by your device\'s own lock screen, account isolation and file permissions. A stolen device with no lock screen, or handing your unlock credentials to someone else, is equivalent to handing over the data. (The single exception is the home-screen widget snapshot, which is AES-256-GCM ciphertext.)',
      },
      {
        kind: 'callout',
        text: '🔴 **The consequence we need you to accept with full knowledge: if you lose your encryption passphrase, we cannot help you recover the data.** We hold no decryption capability. This is not "inconvenient", not "outside the plan", and not a service-quality shortfall — **the capability does not exist in the architecture.** Your only remedies are to export from another device that is still signed in, or to write to us at the address in s9 and agree on what remains possible.',
      },
      {
        kind: 'p',
        text: 'Billing involves **only** your account identifier and entitlement state, never any task content — by construction we hold no content data that could be priced, profiled or sold.',
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: 'The complete inventory of the plaintext metadata above, its legal classification, retention periods and our lawful basis for processing are set out in the Privacy Policy.',
      },
      {
        kind: 'docRef',
        docId: 'permissions',
        text: 'The widget snapshot, system backups and self-hosted servers on your local network — data flows that never prompt you for consent yet do affect your privacy — are itemised in the App Permissions Inventory.',
      },
    ],
  },
  {
    id: 's5',
    title: 'Subscriptions and billing',
    blocks: [
      {
        kind: 'p',
        text: '**This section states no price and no duration.** The single source of truth for pricing, any free allowance, payment channels, invoicing, refund conditions and processing times is the document Subscription, Billing and Refunds. The reason is blunt: once one document copies numbers out of another, there will eventually be a day when the two disagree, and two contradictory prices are harder to resolve than none.',
      },
      {
        kind: 'docRef',
        docId: 'subscription-refund',
        text: 'Every question of the form "how much, how long, can I get a refund, how is the invoice issued, when does the entitlement start" is answered by Subscription, Billing and Refunds.',
      },
      {
        kind: 'ul',
        items: [
          'The only thing we charge for is the hosted sync service described in row three of the table in s1.',
          'A subscription affects sync and nothing else: it neither unlocks nor locks any feature of the application itself (see s3 and s6).',
          'Billing concerns only account and entitlement state, never task content (see s4).',
        ],
      },
      {
        kind: 'p',
        text: 'If anything in this section disagrees with Subscription, Billing and Refunds, **that document prevails**. Please report such a disagreement to us as a defect: two public documents contradicting each other is our error, and it is not your job to guess which one binds.',
      },
    ],
  },
  {
    id: 's6',
    title: 'Expiry, suspension and termination: we do not hold your data hostage',
    blocks: [
      {
        kind: 'p',
        text: 'The central promise is one sentence: **expiry or non-renewal never makes any piece of data unreadable, unusable or unrecoverable.** We do not use deletion of your data as a collection tactic, and there is no "auto-wipe after N days" mechanism. The table below is the complete list of consequences — what is absent from it is precisely what we will not do.',
      },
      {
        kind: 'table',
        head: ['Item', 'After expiry'],
        rows: [
          ['Local data on your devices', '🔴 Not one byte changes: nothing is deleted, modified, emptied or locked'],
          ['Application features', '🔴 Unaffected: every feature remains usable; you can still view, edit and export'],
          ['Data already synced to our server', '🔴 Not deleted: we never use deletion as a means of pressing you to pay'],
          ['Hosted sync', '⏸ Stops (on all devices, not only new ones)'],
          ['Your options', '① renew; or ② switch to a server of your own — sync resumes immediately, with no data loss'],
        ],
      },
      {
        kind: 'p',
        text: 'The consequence of failing to renew is therefore **limited to suspension of hosted sync**, and does not extend to features, data, credentials or any other entitlement you already hold. Prices and refund rules are not restated here; see the pointer in s5.',
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: 'The concrete routes, formats and our response deadlines for export, copying, deletion and account closure are set out in Data Rights and How to Exercise Them.',
      },
      {
        kind: 'p',
        text: 'Suspension and termination: what we may suspend or terminate is **the hosted service itself** (for instance on a serious breach of the rules of use in s7, or if we discontinue the service) — never the data on your devices. Save where the law requires us to act immediately, we notify you in the manner described in s9 before suspending access, and we give you the opportunity to export first.',
      },
      {
        kind: 'ul',
        items: [
          'Whatever causes a suspension or termination, your rights under s3 (MIT) are unaffected: taking your data and moving to a self-hosted server always remains available.',
          'On termination we notify first and stop access afterwards; we do not cut off abruptly and leave your devices in an unexplained sync-failure state.',
          'You may stop using the service at any time: turn sync off, export, and keep using the application. None of that requires our consent.',
        ],
      },
    ],
  },
  {
    id: 's7',
    title: 'Your responsibilities and rules of use',
    blocks: [
      {
        kind: 'p',
        text: 'The rules below govern **how you use our hosted service**, and the duty of care you owe in respect of your own account and devices. They do not narrow your rights under s3 as a user and redistributor of the software.',
      },
      {
        kind: 'ul',
        items: [
          'Do not use our service to store, transmit or distribute content that violates applicable law.',
          'Do not attempt to circumvent the encryption or authorisation mechanisms in order to read data under another account, and do not obtain access through unauthorised probing, load testing or reverse engineering.',
          'Do not interfere with or damage the operation of the service, including imposing load beyond ordinary personal use by automated means.',
          'Do not register under another person\'s identity, and do not lend, transfer or sell your account. Your device identifier is what we use to adjudicate concurrent changes (see s4); using one set of credentials in several places creates data races you will not be able to explain either.',
          'Keep your devices and credentials secure, and judge for yourself whether the sync address you configure is trustworthy — when you point your data at a server you do not know, we cannot protect you from it.',
        ],
      },
      {
        kind: 'p',
        text: '⚠️ **A boundary that must be stated plainly**: when you configure sync at a third-party host or a server you built yourself, your data no longer passes through our service. These terms neither make us answerable for that data nor give you any claim against us in respect of it; the relationship there is defined entirely by whatever you have agreed with that server provider.',
      },
      {
        kind: 'callout',
        text: 'We hold **no** power of the form "breach means the account is closed and the data wiped". The only remedy available to us for a breach of s7 is to suspend **the hosted sync service** (see s6), and we must notify you under s9 when we do. Your local data stays in your hands and is not collateral in any dispute between us.',
      },
    ],
  },
  {
    id: 's8',
    title: 'Disclaimers and limitation of liability',
    blocks: [
      {
        kind: 'p',
        text: '**We begin with the obligation we accept.** heyta is a local-first application: **a server outage, an attack on it, its shutdown, or our own decision to discontinue the service will never make the data on your devices unavailable.** You can always view, edit and export it. This undertaking is not conditioned on any compensation and is not affected by any limitation below — it is an architectural promise, not an exclusion clause.',
      },
      {
        kind: 'p',
        text: 'To the extent permitted by applicable law, our hosted sync service is provided on an "as is" and "as available" basis. We do not warrant that it will run uninterrupted, that it will be free of delay or transient failure, or that any given service will exist in the same form indefinitely (changes to the service and to these terms are governed by s10). The effect of these disclaimers falls on synchronisation only, never on your data.',
      },
      {
        kind: 'p',
        text: 'To the extent permitted by applicable law, our aggregate liability for losses arising out of these terms or out of our hosted service, for which we are legally responsible, is **capped at the total amount you have actually paid us for that service during the relevant period**. The cap does not apply to categories of loss that the law expressly forbids limiting; where applicable law does not permit the cap, this section produces no cap.',
      },
      {
        kind: 'ul',
        items: [
          'The risks below have each been brought to your attention prominently in s2, s4 and s6. This section is **not** a unilateral declaration that we bear no responsibility; it asks you to confirm that **you accept these architecture-derived risks with full knowledge of them.**',
          'Risk one: if your encryption passphrase or credentials are lost we cannot recover your data, because we hold no decryption capability — a necessary consequence of the architecture (s4).',
          'Risk two: local storage is plaintext, so the outcome of a stolen device or an absent lock screen is decided by your device\'s own protection (s4).',
          'Risk three: during any period in which you are not subscribed, cross-device sync does not occur, so changes made in that period exist only on the device you were using (s6).',
          'Risk four: if you configure sync at a server you do not trust, both ciphertext and metadata flow to that server (s1, s7).',
        ],
      },
      {
        kind: 'p',
        text: 'We do **not** write sentences such as "we accept no liability for any loss". Under Article 497 of the Civil Code of the People\'s Republic of China, a standard-form clause by which the supplying party exempts itself from liability, aggravates the other party\'s liability, or excludes the other party\'s principal rights is void — such wording affords no protection and, worse, is the unmistakable signature of a copied template. Every limitation above operates only within the range the law allows us to limit.',
      },
      {
        kind: 'p',
        text: 'Nothing in these terms excludes or limits liability that cannot lawfully be excluded or limited, including liability arising from our wilful misconduct or gross negligence, and any liability the law expressly provides may not be disclaimed in advance. This paragraph is the residual rule of this section and prevails over every sentence above it.',
      },
    ],
  },
  {
    id: 's9',
    title: 'Notices and service',
    blocks: [
      {
        kind: 'p',
        text: 'We reach you through exactly two channels: **in-app notices**, and **the email address you registered with**. We do not push marketing to you through advertising networks, telephone or SMS.',
      },
      {
        kind: 'p',
        text: 'The channel for contacting us is the email address heyta@waytofuture.cn. We have **no** telephone line, no messaging-app desk and no published response-time commitment — writing routes that do not exist into a contract would only spend your time on numbers that will not answer, so we list only the one address that genuinely receives mail.',
      },
      {
        kind: 'p',
        text: 'The following changes are notified **in advance** and **do not apply retrospectively to a period you have already purchased**: price and billing method, service duration and scope of entitlements, the refund policy, and any change to the limitation of liability (s8) or to the promises about your data (s4). The period you have already paid for continues to be governed by the version in force when you bought it.',
      },
      {
        kind: 'p',
        text: 'Time of service: an in-app notice is served when you next open the application; an email is served when we successfully despatch it. Keep your registered mailbox usable — and read this together with the limitation in s2 that the email cannot currently be changed. That is genuinely a risk on your side of the account; we place it in a prominent clause rather than where you will not look.',
      },
      {
        kind: 'callout',
        text: 'If you write to us about an account problem, include the devices you use and the approximate times. **Do not paste plaintext task content into the email in order to "prove who you are"** — we cannot read your content (s4) and have therefore never needed, and will never request, that you provide it.',
      },
    ],
  },
  {
    id: 's10',
    title: 'Changes to these terms, and which version you agreed to',
    blocks: [
      {
        kind: 'p',
        text: 'These terms may be amended. When they are, we update both the version number and the date shown on this page, record what changed (s12), and notify you under s9. ⚠️ **Amendments do not apply retrospectively to a period you have already purchased**: for that period the price, duration and refund rules of the version in force at purchase continue to apply.',
      },
      {
        kind: 'p',
        text: 'For **material** amendments — in particular those touching the purpose for which data is used, the scope of our liability, or the refund policy — we require you to **confirm again** inside the application, rather than treating continued use as agreement. Consent must be given; it must not be presumed.',
      },
      {
        kind: 'p',
        text: '**Record of consent.** At registration we do not store a vague "this user agreed"; we store a version fingerprint — a composite of the form `terms@<version>;…` that pins the version number of every public document in force at that moment. It answers the question "at what time did this person agree to **which version**" without relying on anyone\'s memory or account of events.',
      },
      {
        kind: 'p',
        text: 'Why this is particularly necessary in this product: end-to-end encryption means we cannot see your content (s4), so **any dispute about what was agreed at the time can only be answered from the version record** — never from "the data we happened to keep". The version number is therefore part of the evidence, and an amendment must bump it.',
      },
      {
        kind: 'p',
        text: 'In the self-hosting scenario (row two of the table in s1), what you agree to is **the terms of that server\'s provider**, which have nothing to do with this document. We make no promise on a third party\'s behalf and will not interpret their terms for you.',
      },
      {
        kind: 'p',
        text: 'The version that applies to you is always reachable from the legal section inside the application; its version number appears at the top of the page, and the full history is tabulated in s12 below.',
      },
    ],
  },
  {
    id: 's11',
    title: 'Governing law and dispute resolution',
    blocks: [
      {
        kind: 'p',
        text: 'The conclusion, validity, interpretation and dispute resolution of these terms are governed by **the law of the People\'s Republic of China**.',
      },
      {
        kind: 'p',
        text: 'Disputes arising out of these terms or out of our hosted service shall first be submitted to negotiation with us (contact address in s9). Failing negotiation, either party may bring proceedings before **the competent People\'s Court in Xihu District, Hangzhou**; where the law contains mandatory provisions on jurisdiction, those provisions prevail. This clause does not exclude any other remedy you are entitled to by law.',
      },
      {
        kind: 'p',
        text: 'If any provision of these terms is held invalid or unenforceable, the remaining provisions continue in effect; the invalid provision is replaced by one that is lawful, enforceable and closest to the original intent.',
      },
      {
        kind: 'p',
        text: '⚠️ This section does not reach rows one and two of the table in s1: your rights in the software under the MIT licence are not the subject matter of this clause, and are neither altered by these terms nor confined by the jurisdiction agreed here.',
      },
    ],
  },
  {
    id: 's12',
    title: 'Version record',
    blocks: [
      {
        kind: 'p',
        text: 'The version number enters the record of consent (s10), so changing it has a cost: every substantive amendment must bump the version, state what changed, and leave the date. The version you are reading now is the one named at the top of this page.',
      },
      {
        kind: 'table',
        head: ['Version', 'Date and summary of the change'],
        rows: [
        ['1.0', '2026-10-01 first drafted; has not yet been reviewed by counsel'],
        ['1.1', '2026-10-02 the English column now carries the operator’s registered Chinese name next to its transliteration (it previously showed only the transliteration, in the one document of the nine that defines the contracting party); the consent-fingerprint example in s10 is no longer pinned to a version number.'],
      ],
      },
    ],
  },
] as const;

export const terms: LegalDocument = {
  id: 'terms',
  version: '1.1',
  status: 'draft',
  updatedDate: '2026-10-02',
  title: {
    'zh-CN': 'heyta 服务条款',
    en: 'heyta Terms of Service',
  },
  summary: {
    'zh-CN':
      '三分法说清哪些东西归本条款管（只有我们替你运行的托管同步服务）、MIT 给你什么、我们的服务器看得到什么与看不到什么、到期之后会发生什么 —— 本文件不含任何价格与期限。',
    en:
      'What these terms actually govern (only the hosted sync service we run for you), what MIT already gives you, what our server can and cannot see, and what happens when a subscription lapses — no prices or durations live in this document.',
  },
  sections: { 'zh-CN': zh, en },
};
