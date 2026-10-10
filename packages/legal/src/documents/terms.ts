/**
 * heyta 用户协议 / 服务条款
 * ==========================
 *
 * 本文件文本管的是**「用户和本公司之间约定了什么」**：三样东西各自归谁管、用户能拿应用
 * 做什么、本公司的托管同步服务承诺什么与不承诺什么、到期之后会发生什么、出问题
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
 * 服务器为完成同步必须保存明文的操作元数据。只写「本公司看不到用户的任何数据」就是
 * 虚假陈述。正确口径见 s4 的 callout。
 *
 * 📌 备案号尚未核准，因此本文件不写备案号；也不写电话、微信、客服响应时限 ——
 * 这些通道并不存在，写上去等于给用户一条走不通的救济路径（见 s9）。
 */

import type { LegalDocument } from '../types.js';

const zh = [
  {
    id: 's1',
    title: '合同主体、适用范围与服务边界',
    blocks: [
      {
        kind: 'p',
        text: '本条款由**晓黎（杭州）人工智能科技有限公司**（统一社会信用代码 `91330106MAKNJ6DX7M`，法定代表人邓湘雷，住所浙江省杭州市西湖区蒋村街道文一西路 830 号蒋村商务中心 3 号楼 210 室，联系邮箱 heyta@waytofuture.cn）与用户订立。为明确本条款的适用范围，现将相关对象及其法律关系列示如下。',
      },
      {
        kind: 'table',
        head: ['对象', '是否受本条款约束', '费用'],
        rows: [
          ['heyta 应用本体（全部功能）', '❌ 不受，MIT 许可', '❌ 免费'],
          ['用户自行部署的服务器', '❌ 不适用，不属于本公司提供的服务', '❌ 不涉及本公司收费'],
          ['本公司提供的托管同步服务', '✅ 适用', '见《订阅、计费与退款》'],
        ],
      },
      {
        kind: 'p',
        text: '据此，**本条款的合同标的仅为本公司提供的托管同步服务**。应用本体受 MIT 许可证约束，用户取得、修改或再分发应用本体无需另行取得本条款项下的许可。用户自行部署的服务器不属于本公司提供的服务范围；该服务器的运营、数据处理及相关责任由部署者与其使用者依据双方约定承担。',
      },
      {
        kind: 'callout',
        text: '前述划分构成本条款的适用边界。除另有明确约定外，本条款所载服务承诺、用户义务及责任安排仅适用于本公司提供的托管同步服务，不适用于用户设备上的应用本体或用户自行部署的服务器。',
      },
    ],
  },
  {
    id: 's2',
    title: '账户、凭据及账户活动',
    blocks: [
      {
        kind: 'p',
        text: '官方服务通过**邮箱地址、登录密码和邮箱验证码**完成注册，并支持**通行密钥**等其他认证方式。本公司不要求用户提供手机号、姓名、身份证号或其他身份证件。账户用于确定密文可向哪些设备交付。',
      },
      {
        kind: 'ul',
        items: [
          '用户应妥善保管账户凭据。通行密钥保存在用户设备或其选定的凭据管理器中，不经由本公司的服务器传输。',
          '对于账户项下发生的操作，用户应在法律允许的范围内承担相应的保管和使用责任；因第三人取得或使用用户凭据而产生的操作，服务端无法据此区分其是否由用户本人发起。',
          '如用户发现或合理怀疑凭据泄露，应立即按照 s9 所列联系方式报告安全事件；本公司能够采取的措施受 s4 所述技术架构限制。',
        ],
      },
      {
        kind: 'p',
        text: '**注册邮箱可以自助换绑，采用双侧确认。** 服务同时向当前邮箱与目标邮箱发出确认请求，两侧均完成确认后换绑生效；任一侧未确认的，注册邮箱保持不变。换绑链接有效期 24 小时，同一账号同时仅存在一笔在途请求。换绑生效时既有登录会话同时失效，用户应以新邮箱重新登录；当前邮箱与目标邮箱各收到一封完成通知。用户应在注册前确认邮箱可正常收信：当前邮箱停用或无法接收邮件的，无法完成换绑。',
      },
      {
        kind: 'callout',
        text: '结合 s4 所述加密口令恢复限制，账户恢复能力在现阶段主要取决于用户对注册邮箱、凭据及仍处于登录状态的设备的保管；换绑注册邮箱要求用户同时控制当前邮箱与目标邮箱，当前邮箱已经收不到信时不存在自助换绑通道。该安排源于本地优先和端到端加密架构，用户注册前应充分了解并接受相应影响。',
      },
    ],
  },
  {
    id: 's3',
    title: '软件许可：应用本体是 MIT 许可的自由软件',
    blocks: [
      {
        kind: 'p',
        text: '**应用本体是 MIT 许可的自由软件。用户有权自行搭建服务器并使用全部功能，用户无需购买服务或向本公司通知，本公司亦不对该等使用进行校验或限制。**',
      },
      {
        kind: 'ul',
        items: [
          '在任何设备上安装、运行应用本体，不限设备数量，也不限平台。',
          '阅读、修改、重新分发源码，或把它做成用户自己的产品。',
          '自行部署同步服务端，使数据仅存储于用户控制的设备或服务器。',
          '不购买任何订阅、不提供任何付款信息，长期、完整地使用全部功能。',
        ],
      },
      {
        kind: 'p',
        text: '应用本体无需激活、联网授权验证或定期身份确认。本公司的服务端**不以应用本体是否付费为条件**限制其功能；根据 s1 所列适用范围，该限制不属于托管同步服务的合同内容。',
      },
      {
        kind: 'callout',
        text: '关于 MIT 许可证与本条款的关系，明确如下：**MIT 许可证授予的权利不因本条款而减损。** 本条款仅适用于本公司的托管同步服务；上表前两行所列软件及自建服务器的使用、修改与再分发不以付款为条件。软件本身的权利义务以随源码提供的 MIT 许可证文本为准。',
      },
    ],
  },
  {
    id: 's4',
    title: '托管同步服务与数据处理范围',
    blocks: [
      {
        kind: 'p',
        text: '**同步数据在离开用户设备前完成加密。** 本公司的服务器收到的、保存的、转发给用户其他设备的均为密文。本公司不具备读取、检索或分析用户任务标题、清单名称及备注文字的能力；本公司不要求用户上传明文数据。任何以 heyta 名义提出该等要求的主体均非本公司。',
      },
      {
        kind: 'p',
        text: '此外，为实现同步，服务器需要处理**每条操作的结构及属性**，并保存下列**明文操作元数据**。该等元数据是将密文发送至相应设备并按顺序处理所必需的，不包含任务正文或备注内容。',
      },
      {
        kind: 'ul',
        items: [
          '操作所属实体类型',
          '相关实体标识（实体 ID）',
          '操作类型',
          '每台设备各自的改动计数（用来判断两条改动谁先谁后）',
          '客户端时间戳',
          '到达本公司服务器的时间',
          '序号',
          '载荷字节数',
          'schema 版本',
          '发起这次改动的设备标识',
        ],
      },
      {
        kind: 'callout',
        text: '据此，本公司无法读取任务标题、清单名称或备注等**内容数据**，但可以从上述元数据获知操作对象类别、对象标识、操作次数、时间及设备标识等**结构信息**。因此，本条款不作“服务端完全无法获取任何数据”的概括性表述。',
      },
      {
        kind: 'p',
        text: '关于本地存储的保护范围，明确如下：**端到端加密适用于同步通道，不适用于用户设备上的本地存储。** 为支持离线读写及故障恢复，设备本地保存的数据为明文，并由设备锁屏、账户隔离及文件权限等系统安全措施提供保护。设备遗失且未设置锁屏，或解锁凭据被第三方取得，可能导致本地数据被访问。（桌面小组件生成的快照为 AES-256-GCM 密文。）',
      },
      {
        kind: 'callout',
        text: '🔴 **加密口令遗失的后果**：由于本公司不持有解密密钥，无法为用户恢复以该口令保护的数据。用户可在仍处于登录状态的其他设备上导出数据；如需提交服务请求，可按照 s9 所列联系方式联系本公司，但该请求不改变前述技术限制。',
      },
      {
        kind: 'p',
        text: '计费处理的信息**仅限**账户标识及权益状态，不涉及任务内容；服务计费不以任务内容的读取、分析或画像为基础。',
      },
      {
        kind: 'docRef',
        docId: 'privacy',
        text: '上述明文元数据的完整清单、法定分类、保存期限与本公司的处理依据，见《隐私政策》。',
      },
      {
        kind: 'docRef',
        docId: 'permissions',
        text: '小组件快照、系统备份、局域网自建服务器等无需用户单独同意但涉及隐私的数据流，见《应用权限清单》。',
      },
    ],
  },
  {
    id: 's5',
    title: '订阅与计费',
    blocks: [
      {
        kind: 'p',
        text: '**本节不载明具体金额或期限。** 价格、免费额度、付款渠道、发票、退款条件及到账时效以《订阅、计费与退款》为准。为避免不同文本之间产生冲突，本条款不重复列示上述信息。',
      },
      {
        kind: 'docRef',
        docId: 'subscription-refund',
        text: '有关价格、服务期限、退款、发票及权益生效时间的事项，以《订阅、计费与退款》为准。',
      },
      {
        kind: 'ul',
        items: [
          '收费对象**仅为** s1 表格第三行所述的托管同步服务。',
          '订阅仅适用于托管同步服务，不改变应用本体的功能范围（见 s3 与 s6）。',
          '计费涉及的信息仅限账户与权益状态，不涉及任何任务内容（见 s4）。',
        ],
      },
      {
        kind: 'p',
        text: '若本节与《订阅、计费与退款》存在不一致，**以《订阅、计费与退款》为准**。如发现不一致，用户可通过 s9 所列邮箱反馈；两份对外文件的冲突属于文件维护错误，不影响前述优先适用规则。',
      },
    ],
  },
  {
    id: 's6',
    title: '服务期限届满、中止与终止',
    blocks: [
      {
        kind: 'p',
        text: '**到期或未续费不影响用户读取、使用或导出其本地数据。** 本公司不得以删除用户数据作为催收措施，且未设置因服务期限届满而自动清除本地数据的机制。具体影响以如下清单为准。',
      },
      {
        kind: 'table',
        head: ['项目', '到期后'],
        rows: [
          ['用户设备上的本地数据', '🔴 不删除、不修改、不清空、不锁定'],
          ['应用功能', '🔴 不受影响：全部功能照常可用，可继续查看、编辑、导出'],
          ['已同步到服务器的数据', '🔴 不删除：本公司不以删除数据作为催缴手段'],
          ['托管同步', '停止（适用于全部设备）'],
          ['可选措施', '① 续费；② 改用用户自行部署的服务器，恢复同步且不改变既有数据'],
        ],
      },
      {
        kind: 'p',
        text: '因此，**未按期续费的后果仅限于停止托管同步**，不扩展到功能、数据、凭据或用户已取得的其他权益。价格与退款规则不在本节重复，见 s5 的指向。',
      },
      {
        kind: 'docRef',
        docId: 'data-rights',
        text: '用户行使数据导出、复制、删除及账户注销权利的路径、格式和处理时限，见《数据权利与行使方式》。',
      },
      {
        kind: 'p',
        text: '中止与终止：中止或终止的对象为**托管服务本身**（例如严重违反 s7 所列使用规则，或本公司停止运营该项服务），不涉及用户设备上的本地数据。除法律要求立即采取措施的情形外，本公司将在中止前按 s9 发送通知，并提供合理的数据导出机会。',
      },
      {
        kind: 'ul',
        items: [
          '无论服务因何中止或终止，s3 所述 MIT 许可项下的权利不受影响；用户可将数据迁移至自行部署的服务器。',
          '服务终止前，本公司将依 s9 发送通知；法律要求立即采取措施的除外。',
          '用户有权随时停止使用托管同步服务、导出数据并继续使用应用本体，无需取得本公司同意。',
        ],
      },
    ],
  },
  {
    id: 's7',
    title: '用户的责任与使用规则',
    blocks: [
      {
        kind: 'p',
        text: '本节规则约束的是**用户使用本公司托管服务的方式**，以及用户对其账户与设备负有的注意义务。它们不缩减 s3 下用户作为软件使用者与再分发者的权利。',
      },
      {
        kind: 'ul',
        items: [
          '不利用本公司的服务存储、传输或传播违反法律法规的内容。',
          '不试图绕过加密与授权机制读取他人账户的数据，也不以未经授权的探测、压力测试或逆向工程来获取访问能力。',
          '不干扰或破坏服务的正常运行，包括以自动化方式施加超出正常使用范围的负载。',
          '不得冒用他人身份注册，不得出借、转让或出售账户。设备标识用于并发改动的裁决（见 s4）；同一组凭据在多个地点使用可能导致数据竞争。',
          '用户应妥善保管设备与凭据，并核验所配置同步服务器的可信性。用户将数据发送至非本公司运营的服务器时，该服务器的运营者依法承担相应的数据处理与安全责任。',
        ],
      },
      {
        kind: 'p',
        text: '⚠️ **第三方或自建同步服务器的责任边界**：用户将同步地址配置为第三方托管服务器或自行部署的服务器后，相关数据不再经过本公司的托管服务。该服务器的运营、数据处理及安全措施由其运营者负责；用户与该运营者之间的权利义务以双方约定及适用法律为准。',
      },
      {
        kind: 'callout',
        text: '违反 s7 所列规则时，本公司可依 s6 中止托管同步服务，并依 s9 发送通知。中止托管同步不影响用户设备上的本地数据。',
      },
    ],
  },
  {
    id: 's8',
    title: '责任范围与责任限制',
    blocks: [
      {
        kind: 'p',
        text: 'heyta 采用本地优先架构。因托管服务发生故障、受到攻击、被暂停或停止运营，用户设备上已经保存的本地数据仍可在应用支持的范围内读取、编辑及导出。本项说明不构成对法定责任的排除或限制。',
      },
      {
        kind: 'p',
        text: '在适用法律允许的范围内，托管同步服务按照提供时的实际状态提供。除法律另有规定或双方另有约定外，本公司不保证服务持续不间断、无延迟、无错误或始终保持现有功能和形式。上述服务可用性限制不影响用户对本地数据依法享有的权利。服务及本条款的变更适用 s10。',
      },
      {
        kind: 'p',
        text: '在适用法律允许的范围内，对于因本条款或托管服务引起且依法应由本公司承担的损失，本公司承担的累计赔偿责任以用户在相关服务期间就该项托管服务实际支付的费用总额为限。该限制不适用于法律规定不得限制或免除的责任；如适用法律不允许约定前述上限，则该上限不发生效力。',
      },
      {
        kind: 'ul',
        items: [
          '以下情形已在 s2、s4、s6 逐项说明，并构成用户使用服务时应当注意的具体风险：',
          '加密口令或凭据遗失后，本公司无法恢复相应数据（s4）；',
          '本地存储为明文，设备失窃或未设置锁屏时，数据安全取决于设备自身的安全措施（s4）；',
          '服务未续费期间不执行跨设备同步，该期间产生的改动仅保留在产生改动的设备上（s6）；',
          '用户将同步地址配置为不受其信任的服务器后，密文及相关元数据将传输至该服务器（s1、s7）。',
        ],
      },
      {
        kind: 'p',
        text: '本条款不作概括性免责。前述责任限制仅在适用法律允许的范围内适用，不得解释为免除或减轻本公司依法应承担的责任、加重用户责任或排除用户依法享有的主要权利。',
      },
      {
        kind: 'p',
        text: '无论本条款其他条款如何约定，本公司因故意或重大过失造成用户损失的责任，以及法律明确规定不得预先免除或限制的其他责任，不因本节而免除或限制。',
      },
    ],
  },
  {
    id: 's9',
    title: '通知与送达',
    blocks: [
      {
        kind: 'p',
        text: '通知渠道包括：**应用内通知**及**用户注册邮箱**。本公司不通过广告网络、电话或短信发送营销信息。',
      },
      {
        kind: 'p',
        text: '联系邮箱为 heyta@waytofuture.cn。本公司当前未提供电话或即时通信客服，亦未承诺固定的客服响应时限；除该邮箱外，不指定其他对外送达或受理渠道。',
      },
      {
        kind: 'p',
        text: '本公司将就下列变更**提前**通知用户，且该等变更**不溯及已购买的服务期间**：价格与计费方式、服务期限与权益范围、退款政策，以及责任限制（s8）与数据相关的承诺（s4）。已购买的服务期间继续适用购买时有效的版本。',
      },
      {
        kind: 'p',
        text: '送达时点：应用内通知在用户下次打开应用时视为送达；邮件在邮件系统成功发出时视为送达。用户应保持注册邮箱可用。注册邮箱可以自助换绑，但须当前邮箱与目标邮箱双侧确认；当前邮箱无法接收邮件的，换绑无法完成，该限制构成账户恢复风险，已在 s2 中明确列示。',
      },
      {
        kind: 'callout',
        text: '如因账户问题联系本公司，请说明所使用的设备及相关操作的大致时间。**不得在邮件中附具明文任务内容作为身份核验材料。** 依据 s4，本公司无法读取该等内容，亦不会要求用户提供。',
      },
    ],
  },
  {
    id: 's10',
    title: '条款修订与同意记录',
    blocks: [
      {
        kind: 'p',
        text: '本条款可予修订。修订时，本公司同步更新版本号、本页日期及 s12 所列变更摘要，并依 s9 通知用户。修订内容不适用于用户已经购买的服务期间；该期间继续适用购买时有效的价格、期限及退款规则。',
      },
      {
        kind: 'p',
        text: '涉及数据用途、责任范围或退款政策的**重大变更**，须由用户在应用内**重新确认**；继续使用服务不构成对该等重大变更的默示同意。',
      },
      {
        kind: 'p',
        text: '**同意记录**：注册时记录由 `terms@<版本>;…` 构成的版本指纹，其中包含当时各项对外法律文件的版本号及同意时间。该记录用于确认用户在何时同意何种版本的文件，不以人工记忆或事后复述为依据。',
      },
      {
        kind: 'p',
        text: '由于端到端加密限制了本公司对内容数据的读取（s4），关于当时约定内容的争议应以版本记录为依据。版本号属于该项记录的组成部分；实质性修订须同步更新版本号。',
      },
      {
        kind: 'p',
        text: '在自建服务器场景下（s1 表格第二行），用户同意的是**该服务端提供方**发布的条款，本文件不适用于该等服务。本公司不代表第三方作出承诺，也不解释第三方条款。',
      },
      {
        kind: 'p',
        text: '用户当前适用的版本可通过应用内法律入口查阅；版本号显示于页面顶部，历次变更记录见 s12。',
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
        text: '因本条款或托管同步服务产生争议的，双方应先行协商（联系方式见 s9）。协商不成的，任何一方可向**杭州市西湖区有管辖权的人民法院**提起诉讼；法律另有强制性管辖规定的，从其规定。本条不影响用户依法享有的其他救济途径。',
      },
      {
        kind: 'p',
        text: '本条款某一条被认定无效或不可执行，不影响其余条款的效力；无效的那一条由最接近其原意、且合法有效的约定替代。',
      },
      {
        kind: 'p',
        text: '⚠️ 本条不适用于 s1 表格的前两行：MIT 许可下用户对软件本身的权利不是本条约定的标的，也不因本条款而改变、或被本条的管辖约定所限制。',
      },
    ],
  },
  {
    id: 's12',
    title: '版本记录',
    blocks: [
      {
        kind: 'p',
        text: '版本号将写入同意记录（s10）。每次实质性修订均须同步更新版本号、变更摘要及日期。本页顶部显示当前版本。',
      },
      {
        kind: 'table',
        head: ['版本', '日期与变更摘要'],
        rows: [
        ['1.0', '2026-10-01 首次起草，尚未经法务复核'],
        ['1.1', '2026-10-02 英文栏在转写名之外补上登记的中文主体名称（此前该栏只有转写名，而本条款是九份里唯一规定合同主体的那份）；s10 的指纹示例改写成不钉死版本号的形式。'],
        ['1.2', '2026-10-04 完成法律文档版本记录与服务范围表述；相关内部合规记录同步归档。'],
        ['1.3', '2026-10-08 统一责任、通知及同意记录章节的法律表述，删除元话语、口语连接和非必要的模板化表述。'],
        ['1.4', '2026-10-08 s2 与 s9 关于注册邮箱的表述改为自助换绑（双侧确认、链接 24 小时有效、生效时既有登录会话同时失效），并保留当前邮箱无法收信时无法完成换绑的限制。中英同步。'],
        ['1.5', '2026-10-09 完成服务合同主体、权利义务、责任边界、通知及争议解决条款的整理；相关内部合规记录同步归档。'],
      ],
      },
    ],
  },
] as const;

const en = [
  {
    id: 's1',
    title: 'Contracting parties, scope and service boundary',
    blocks: [
      {
        kind: 'p',
        text: 'These terms are agreed between you and **晓黎（杭州）人工智能科技有限公司** (Xiaoli (Hangzhou) Artificial Intelligence Technology Co., Ltd.; the registered Chinese name above is the authoritative one. Unified Social Credit Code `91330106MAKNJ6DX7M`; legal representative Deng Xianglei; registered address Room 210, Building 3, Jiangcun Business Center, No. 830 Wenyi West Road, Jiangcun Subdistrict, Xihu District, Hangzhou, Zhejiang, China; contact email heyta@waytofuture.cn). The three-way table below defines the scope of these terms and the matters for which we may be contacted.',
      },
      {
        kind: 'table',
        head: ['Thing', 'Governed by these terms', 'Cost'],
        rows: [
          ['The heyta application itself (all features)', '❌ Not governed; MIT licence', '❌ Free'],
          ['A server you build and self-host', '❌ Outside the scope of these terms', '❌ Not required'],
          ['The hosted sync service we provide', '✅ Governed', 'See Subscription, Billing and Refunds'],
        ],
      },
      {
        kind: 'p',
        text: 'Accordingly, **the subject matter of these terms is limited to the hosted sync service we provide**. The application itself is governed by the MIT licence; obtaining, modifying or redistributing the application does not require a separate licence under these terms. A server deployed by the user is outside our service scope; its operation, data processing and related responsibilities are governed by the arrangement between the deployer and its users.',
      },
      {
        kind: 'callout',
        text: 'The foregoing allocation defines the scope of these terms. Unless expressly stated otherwise, the service commitments, user obligations and liability arrangements below apply only to the hosted sync service we provide, not to the application on the user’s device or to a server deployed by the user.',
      },
    ],
  },
  {
    id: 's2',
    title: 'Accounts, credentials and account activity',
    blocks: [
      {
        kind: 'p',
        text: 'Registration with the official service uses **an email address, a sign-in password and an email verification code**. Other authentication methods, including **passkeys**, are also supported. We do not require your phone number, your name, your national identification number, and we ask you for no identity document of any kind. The account identifies the devices authorised to receive the user’s ciphertext.',
      },
      {
        kind: 'ul',
        items: [
          'The user must keep account credentials secure. A passkey remains on the user’s device or selected credential manager and is not transmitted through our server.',
          'To the extent permitted by law, the user is responsible for exercising reasonable care over operations performed under the account; the service cannot determine from the operation alone whether a credential holder is the user or a third party.',
          'If the user discovers or reasonably suspects a credential compromise, the user should report the security incident using the contact in s9 without undue delay; any response remains subject to the technical limits described in s4.',
        ],
      },
      {
        kind: 'p',
        text: '**The registration e-mail can be rebound by the user, subject to two-sided confirmation.** The service sends a confirmation request to the current address and to the target address; the change takes effect only after both sides confirm, and the registration e-mail remains unchanged while either side is outstanding. Each link is valid for 24 hours and an account may hold one in-flight request at a time. When the change takes effect, existing sign-in sessions are invalidated and the user must sign in again with the new address; both addresses receive a completion notice. The user should verify before registering that the mailbox receives mail: rebinding cannot be completed without access to the current mailbox.',
      },
      {
        kind: 'callout',
        text: 'Together with the recovery limitation in s4, account recovery currently depends primarily on the user’s control of the registered mailbox, credentials and devices that remain signed in; rebinding the registration e-mail requires control of both the current and the target mailbox, and no self-service path exists once the current mailbox receives no mail. This follows from the local-first and end-to-end-encrypted architecture and should be considered before registration.',
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
        text: 'The relationship between the MIT licence and these terms is as follows: **the rights granted by the MIT licence are not reduced by these terms.** These terms apply only to our hosted sync service. The use, modification and redistribution rights in rows one and two of the table above do not depend on payment. The MIT licence distributed with the source governs the software itself.',
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
        text: 'In addition, to perform synchronisation the server processes **the structure and attributes of each operation** and stores the **plaintext operational metadata** listed below. That metadata is necessary to deliver ciphertext to the appropriate device and process it in order; it does not include task or note content.',
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
        text: 'Accordingly, we cannot read task titles, list names or note text, but the metadata above can reveal the object type, object identifier, operation count, time and device identifier associated with an operation. These terms therefore do not make the broad statement that the server is unable to obtain any data.',
      },
      {
        kind: 'p',
        text: 'The protection applicable to local storage is as follows: **end-to-end encryption applies to the sync channel, not to local storage on the user’s device.** To support offline use and recovery, data stored locally is plaintext and is protected by the device lock screen, account isolation and file permissions. Loss of a device without a lock screen, or disclosure of its unlock credentials, may permit access to that local data. (A home-screen widget snapshot is an AES-256-GCM ciphertext exception.)',
      },
      {
        kind: 'callout',
        text: '🔴 **Effect of losing the encryption passphrase:** we do not hold the decryption key and cannot recover data protected by that passphrase. The user may export data from another device that remains signed in. A service request may be submitted using the contact in s9, but it cannot override this technical limitation.',
      },
      {
        kind: 'p',
        text: 'Billing processes **only** the account identifier and entitlement state; it does not process task content, and service pricing is not based on reading, analysing or profiling that content.',
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
        text: '**This section states no specific price or duration.** Pricing, free allowances, payment channels, invoicing, refund conditions and processing times are governed by Subscription, Billing and Refunds. This document does not repeat those details in order to avoid inconsistencies between public documents.',
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
        text: 'If this section conflicts with Subscription, Billing and Refunds, **that document prevails**. The user may report the conflict using the email in s9; the conflict is a document-maintenance error and does not alter the stated order of precedence.',
      },
    ],
  },
  {
    id: 's6',
    title: 'Expiry, suspension and termination of the service',
    blocks: [
      {
        kind: 'p',
        text: '**Expiry or non-renewal does not prevent the user from reading, using or exporting local data.** We do not delete local data as a collection measure, and the service has no mechanism that automatically clears local data solely because a period has elapsed. The specific effects are listed below.',
      },
      {
        kind: 'table',
        head: ['Item', 'After expiry'],
        rows: [
          ['Local data on your devices', '🔴 Not deleted, modified, emptied or locked'],
          ['Application features', '🔴 Unaffected: every feature remains usable; you can still view, edit and export'],
          ['Data already synced to our server', '🔴 Not deleted: we never use deletion as a means of pressing you to pay'],
          ['Hosted sync', '⏸ Stops (on all devices, not only new ones)'],
          ['Available measures', '① renew; or ② switch to a server deployed by the user, restoring sync without changing existing data'],
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
        text: 'Suspension and termination apply to **the hosted service itself** (for example, a serious breach of the rules of use in s7 or our discontinuation of the service), not to local data on the user’s devices. Unless the law requires immediate action, we will notify the user under s9 before suspension and provide a reasonable opportunity to export data.',
      },
      {
        kind: 'ul',
        items: [
          'Whatever causes a suspension or termination, your rights under s3 (MIT) are unaffected: taking your data and moving to a self-hosted server always remains available.',
          'On termination we notify the user before access is stopped, subject to any legally required immediate action.',
          'You may stop using the service at any time: turn sync off, export, and keep using the application. None of that requires our consent.',
        ],
      },
    ],
  },
  {
    id: 's7',
    title: 'User responsibilities and rules of use',
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
          'Do not register under another person\'s identity, and do not lend, transfer or sell your account. The device identifier is used to adjudicate concurrent changes (see s4); using one set of credentials in several locations may cause data races.',
          'Keep your devices and credentials secure, and judge for yourself whether the sync address you configure is trustworthy — when you point your data at a server you do not know, we cannot protect you from it.',
        ],
      },
      {
        kind: 'p',
        text: '⚠️ **Third-party and self-hosted server boundary:** when the user configures synchronisation to a third-party host or a self-deployed server, the data no longer passes through our hosted service. The operation, data processing and security measures of that server are the responsibility of its operator; the rights and obligations between the user and that operator are governed by their agreement and applicable law.',
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
          'The risks below are described in s2, s4 and s6 and form part of the information provided before use. They arise from the local-first and end-to-end-encrypted architecture and are subject to the allocation of responsibility stated in this section.',
          'Risk one: if your encryption passphrase or credentials are lost we cannot recover your data, because we hold no decryption capability — a necessary consequence of the architecture (s4).',
          'Risk two: local storage is plaintext, so the outcome of a stolen device or an absent lock screen is decided by your device\'s own protection (s4).',
          'Risk three: during any period in which you are not subscribed, cross-device sync does not occur, so changes made in that period exist only on the device you were using (s6).',
          'Risk four: if you configure sync at a server you do not trust, both ciphertext and metadata flow to that server (s1, s7).',
        ],
      },
      {
        kind: 'p',
        text: 'Each limitation in this section applies only to the extent permitted by applicable law. Under Article 497 of the Civil Code of the People\'s Republic of China, a standard-form clause that exempts the supplying party from liability, aggravates the other party\'s liability, or excludes the other party\'s principal rights is void. No provision of this section is intended to produce any of those effects.',
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
        text: 'Notices may be sent through **in-app notifications** or **the email address registered by the user**. We do not send marketing messages through advertising networks, telephone or SMS.',
      },
      {
        kind: 'p',
        text: 'The contact email is heyta@waytofuture.cn. No telephone or instant-messaging support channel is currently provided, and no fixed response time is promised. No other external service or delivery channel is designated.',
      },
      {
        kind: 'p',
        text: 'The following changes will be notified **in advance** and **will not apply retrospectively to a period already purchased**: price and billing method, service duration and entitlement scope, the refund policy, and any change to the limitation of liability (s8) or data commitments (s4). A period already paid for remains governed by the version in force at the time of purchase.',
      },
      {
        kind: 'p',
        text: 'Time of service: an in-app notice is deemed served when the user next opens the application; an email is deemed served when the mail system successfully dispatches it. The user must keep the registered mailbox available. Changing the registration e-mail is self-service but requires two-sided confirmation, and cannot be completed without access to the current mailbox; that limitation is an account-recovery risk and is expressly stated in s2.',
      },
      {
        kind: 'callout',
        text: 'When contacting us about an account issue, state the devices used and the approximate time of the relevant operation. **Do not attach plaintext task content as identity-verification material.** Under s4, we cannot read that content and will not request it.',
      },
    ],
  },
  {
    id: 's10',
    title: 'Amendments and consent records',
    blocks: [
      {
        kind: 'p',
        text: 'These terms may be amended. The company shall update the version number, page date and change summary in s12, and shall notify the user under s9. ⚠️ **Amendments do not apply retrospectively to a period you have already purchased**: for that period the price, duration and refund rules of the version in force at purchase continue to apply.',
      },
      {
        kind: 'p',
        text: 'For **material** amendments — in particular those touching the purpose for which data is used, the scope of our liability, or the refund policy — we require you to **confirm again** inside the application, rather than treating continued use as agreement. Consent must be given; it must not be presumed.',
      },
      {
        kind: 'p',
        text: '**Consent record.** At registration we store a version fingerprint of the form `terms@<version>;…`, containing the versions of the public legal documents in force at the time of consent together with the consent timestamp. The record identifies when the user agreed to which versions and does not rely on retrospective recollection.',
      },
      {
        kind: 'p',
        text: 'End-to-end encryption means we cannot see your content (s4). Accordingly, **any dispute about what was agreed at the time is answered from the version record**, and not from unrelated data retained by the company. The version number is therefore part of the evidence, and an amendment must bump it.',
      },
      {
        kind: 'p',
        text: 'In the self-hosting scenario (row two of the table in s1), the applicable terms are **those issued by the provider of that server**; this document does not govern that service. We make no promise on a third party\'s behalf and will not interpret their terms for you.',
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
        text: 'The version number forms part of the consent record (s10). Every substantive revision must update the version, change summary and date. The current version is shown at the top of this page.',
      },
      {
        kind: 'table',
        head: ['Version', 'Date and summary of the change'],
        rows: [
        ['1.0', '2026-10-01 first drafted; has not yet been reviewed by counsel'],
        ['1.1', '2026-10-02 the English column now carries the operator’s registered Chinese name next to its transliteration (it previously showed only the transliteration, in the one document of the nine that defines the contracting party); the consent-fingerprint example in s10 is no longer pinned to a version number.'],
        ['1.2', '2026-10-04 recorded the legal-document version history and service-scope wording; the related internal compliance records were archived.'],
        ['1.3', '2026-10-08 standardised the formal legal wording in the responsibility, notice and consent-record sections; removed meta-commentary, colloquial connectors and template-like liability explanations.'],
        ['1.4', '2026-10-08 the registration-e-mail wording in s2 and s9 now describes self-service rebinding (two-sided confirmation, a 24-hour link and existing sessions ending when it takes effect), while retaining the limitation that a mailbox which receives no mail cannot complete a rebinding. Both language columns were updated together.'],
        ['1.5', '2026-10-09 organised the contracting scope, rights and duties, liability boundaries, notices and dispute-resolution provisions required for the service contract; the related internal compliance records were archived.'],
      ],
      },
    ],
  },
] as const;

export const terms: LegalDocument = {
  id: 'terms',
  version: '1.5',
  status: 'draft',
  updatedDate: '2026-10-09',
  title: {
    'zh-CN': 'heyta 服务条款',
    en: 'heyta Terms of Service',
  },
  summary: {
    'zh-CN':
      '本条款界定托管同步服务的适用范围、MIT 许可证授予的权利、服务器处理的操作元数据、订阅到期后的影响及责任边界；本文件不载明具体价格或服务期限。',
    en:
      'These terms define the scope of the hosted sync service, the rights granted by the MIT licence, the operational metadata processed by the server, the effects of subscription expiry and the allocation of responsibility; specific prices and service durations are stated elsewhere.',
  },
  sections: { 'zh-CN': zh, en },
};
