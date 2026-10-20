/**
 * 备案专用《算法机制机理公示》页 —— 已上线，状态字段仍是 `draft`
 * ===============================================================
 *
 * 2026-10-20 负责人点头后注册进本包与落地页站点，线上地址
 * `https://heyta.waytofuture.cn/legal/algorithm-disclosure/`（中英各一条）。
 * 起草稿与七处落点清单留在
 * `docs/operations/cac-algorithm-filing/材料包_2026-10-08/04_对外公示页草稿_未发布/`，
 * 那份 `落点与前置.md` 记的是**为什么必须住在这里**：备案面向的公开说明要进产品已有的
 * 规范文档体系（共享导航、法务互链、检索、版本历史、发布检查），不许另开一条会漂移的
 * 应用内路由副本。
 *
 * 🔴 **上线这一动的用户可感后果**：`version` 进同意记录的整套指纹
 * （`legalSetVersion()` ⇒ `server/src/legal.generated.ts` 的 `LEGAL_SET_VERSION`），
 * 所以新增这份或日后 bump，都会让官方托管实例上的老用户**重新确认一次**。
 * 改动正文前先看这一条，别把它当成纯文案改动。
 *
 * `status` 与本包其余九份一样取 `draft`（页面上挂"尚未对用户生效"横幅）—— 它说的是
 * **这版文本还在法务复核中**，不是说这一页没上线。输入/输出内容安全审查补齐之前
 * 不许改成 `effective`：那等于把一份自己声明未生效的文本当生效文本发出去。
 *
 * 🔴 三条不许被以后的人写歪的地方（每一条都对应台账里的一条现量事实）：
 *
 * 1. **不许出现备案号。** 本轮没有提交，主体认证那一步也还在待初审；页面上只能写
 *    "未提交 / 无备案号"。
 * 2. **不许把仅剩的那一项缺口写成已具备。** 输入/输出内容安全审查 —— 代码里现在没有
 *    （对外法务文本自述"不做过滤"）。
 *    🔴 另外两枚**已经落地**，别再列回缺口里：法定显式标识（「AI 生成合成内容」字样）
 *    与应用内一键投诉/举报入口都于 2026-10-09 落到界面（Web「设置 → 帮助与关于」、
 *    移动端「设置 → 通用 → 帮助与反馈」）。
 *    这一族过去的旧形状就是"缺口清单"与"代码现状"各活各的，靠备案材料的完成度审计
 *    `B16` 逐条机器复查（含中英双向）才钉得住。
 * 3. **不许把鸿蒙与桌面端写成服务路径。** 鸿蒙工程只是示例载荷小组件页（无 RNOH、无 .hap），
 *    桌面四壳内没有 AI 代码。真实路径只有 Web + Android 内测 + iOS 内测。
 *
 * 中英两版的结构必须逐段对应（`packages/legal/tests/structure.spec.ts` 逐段对账，
 * 不靠 key）⇒ 改一段要同时改两段的同一位置。
 */

import type { LegalDocument } from '../types.js';

export const algorithmDisclosure: LegalDocument = {
  id: 'algorithm-disclosure',
  version: '0.2',
  status: 'draft',
  updatedDate: '2026-10-20',
  title: {
    'zh-CN': '算法机制机理公示',
    en: 'Algorithm Mechanism Disclosure',
  },
  summary: {
    'zh-CN': 'heyta 的 AI 辅助功能用了什么算法、能做什么、不能做什么，以及你手上有哪些控制。',
    en: 'What algorithm powers heyta’s AI assistance, what it can and cannot do, and which controls are yours.',
  },
  sections: {
    'zh-CN': [
      {
        id: 's1',
        title: '算法名称与类型',
        blocks: [
          {
            kind: 'p',
            text: '算法名称：heyta任务智能辅助生成合成算法。算法类型：生成合成类（深度合成）。角色：服务提供者。',
          },
          {
            kind: 'p',
            text: '它做的事情只有一类：把自然语言变成任务管理相关的结构化建议 —— 任务字段、子条目、优先级与耗时估算、以及对提问的解释性回答。',
          },
        ],
      },
      {
        id: 's2',
        title: '当前备案状态',
        blocks: [
          {
            kind: 'p',
            text: '本算法尚未提交备案，因此没有备案号，也没有可核验的公示编号。',
          },
          {
            kind: 'p',
            text: '主体信息认证已提交、正在等待初审。初审通过之前，备案信息登记这一步在门户上是不放开的。',
          },
          {
            kind: 'callout',
            text: '本页只描述当前真实状态。备案通过之后这里会补上备案号与官方公示信息链接；在那之前任何地方出现"已备案"都是错的。',
          },
        ],
      },
      {
        id: 's3',
        title: '你能在哪里用到它',
        blocks: [
          {
            kind: 'p',
            text: '同一个算法通过三条真实可达的路径提供，不是三个不同的算法：',
          },
          {
            kind: 'ul',
            items: [
              '网页端：自托管实例已部署可访问；AI 功能默认关闭，需要你在设置里配置端点并逐项授权。',
              'Android：内测构建，已实机跑通，未公开分发。',
              'iOS：模拟器与内测构建，未上架。',
            ],
          },
          {
            kind: 'p',
            text: '桌面端与鸿蒙工程形态里没有这套 AI 能力，因此不构成该算法的服务路径。',
          },
        ],
      },
      {
        id: 's4',
        title: '运行机制：输入、处理、输出',
        blocks: [
          {
            kind: 'p',
            text: '输入：你在界面里主动发起的中文文本（自然语言描述、任务字段、以及完成这次请求所必需的上下文）。系统不采集通讯录、相册、位置等无关权限。',
          },
          {
            kind: 'ol',
            items: [
              '界面发起：四类入口（收集箱一句话捕获、任务详情拆解任务、时间线与看板的耗时与优先级建议、助手对话面板）。',
              '组装上下文：只带这次请求需要的最小必要内容。',
              '过闸：AI 功能总开关、「允许远程」、逐功能的出境授权三道闸，默认全部关闭。',
              '模型端点生成中文文本；端点由用户自行配置。',
              '结果只作为建议展示在发起请求的界面里，用户确认后才写入。',
            ],
          },
          {
            kind: 'p',
            text: '闸门未通过或端点失败时：该次调用不发出、不静默改道其他端点，界面可见失败原因。未确认的提案不产生任何数据变更，跨会话恢复时自动失效。',
          },
          {
            kind: 'p',
            text: '数据边界：产品采用端到端加密，同步服务端在设计上读不到明文，明文只存在于用户设备本地，以及在闸门放行后发往模型端点的那一份。本算法不自建训练语料、不微调、不托管任何模型权重，也不把用户数据用于训练。',
          },
        ],
      },
      {
        id: 's5',
        title: '你手上的控制',
        blocks: [
          {
            kind: 'ul',
            items: [
              '关掉它：AI 功能总开关，以及逐功能的出境授权；关掉之后相关功能整体不可用，不会退到别的路径。',
              '不采纳：所有建议都要你确认才写入；未确认的提案自动失效。',
              '改与删：结果可以编辑、删除，也可以整条撤回。',
              '带走：可以导出全部数据（含完整操作记录），Web 与移动端都有入口。',
              '注销：可注销账号。',
            ],
          },
          {
            kind: 'p',
            text: '界面当前会展示的来源标注与免责句是「来自本机」/「来自云端」、「AI 估时」，以及「AI 可能出错，请核对重要信息。」；出境前还会披露这一份不受端到端加密保护。AI 产出的文本在界面上带法定显式标识「AI 生成合成内容」—— 助手回答、未确认的提案、拆解草稿、估时结果、优先级建议、自然语言捕获的候选字段，以及移动端的助手回答与提案，都显示在这段文字的下方。',
          },
        ],
      },
      {
        id: 's6',
        title: '尚未具备的一项控制（如实登记）',
        blocks: [
          {
            kind: 'p',
            text: '以下这一项目前**没有实现**。我们把它写在这里，而不是写成已有能力：',
          },
          {
            kind: 'ol',
            items: [
              '输入与输出的自动内容安全审查尚未部署。本系统不识别内容类别，也不做任何"检测到敏感词就拦下"式的过滤。这是当前最主要的剩余风险。',
            ],
          },
          {
            kind: 'callout',
            text: '补齐计划：它要在对外公开发布之前完成，完成后同步更新本页与备案材料。「AI 生成合成内容」显式标识已于 2026-10-09 实现（见上一节）；应用内一键投诉/举报入口已于 2026-10-09 落到界面（见下面的反馈渠道）。这两枚都不再列入本项。',
          },
        ],
      },
      {
        id: 's7',
        title: '反馈渠道',
        blocks: [
          {
            kind: 'p',
            text: '对本算法结果的异议、举报与咨询：heyta@waytofuture.cn，15 个工作日内响应。',
          },
          {
            kind: 'p',
            text: '应用内也提供一键入口：Web 端在「设置 → 帮助与关于」、移动端在「设置 → 通用 → 帮助与反馈」，点下去以该邮箱为收件人起草邮件、主题预填「heyta 算法服务投诉/举报」。它的形态是邮件而不是应用内工单，所以应用内不生成工单编号、也不回显处理进度；移动端在这台设备没有可用邮件应用时会在界面上说明未能开始，并把该地址显示出来。',
          },
          {
            kind: 'p',
            text: '个人信息相关的权利请求见《个人信息主体权利》页。',
          },
        ],
      },
      {
        id: 's8',
        title: '版本与更新',
        blocks: [
          {
            kind: 'p',
            text: '本页最后实质修改：2026-10-20（发布上线，正文本身最后一次实质修改是 2026-10-09）。算法机制、数据流、模型服务、终止范围或服务协议发生实质变更时，本页与备案材料一并更新。',
          },
        ],
      },
    ],
    en: [
      {
        id: 's1',
        title: 'Algorithm name and type',
        blocks: [
          {
            kind: 'p',
            text: 'Algorithm name: heyta task-assistance generative-synthesis algorithm. Type: generative synthesis (deep synthesis). Role: service provider.',
          },
          {
            kind: 'p',
            text: 'It does exactly one kind of thing: turn natural language into structured suggestions for task management — task fields, sub-items, priority and time estimates, and explanatory answers to your questions.',
          },
        ],
      },
      {
        id: 's2',
        title: 'Current filing status',
        blocks: [
          {
            kind: 'p',
            text: 'This algorithm has not been submitted for filing. There is no filing number and no verifiable public registration number.',
          },
          {
            kind: 'p',
            text: 'The entity certification step has been submitted and is awaiting first-round review. Until that review passes, the filing-registration step is not opened by the portal.',
          },
          {
            kind: 'callout',
            text: 'This page describes the current state only. After approval, the filing number and the official public-information link will be added here; until then any claim of "filed" would be wrong.',
          },
        ],
      },
      {
        id: 's3',
        title: 'Where you can use it',
        blocks: [
          {
            kind: 'p',
            text: 'One algorithm is delivered through three real paths; these are not three different algorithms:',
          },
          {
            kind: 'ul',
            items: [
              'Web: a self-hosted instance is deployed and reachable; AI features are off by default and need an endpoint you configure plus per-feature consent.',
              'Android: internal-test build, verified on a real device, not publicly distributed.',
              'iOS: simulator and internal-test build, not listed in any store.',
            ],
          },
          {
            kind: 'p',
            text: 'The desktop shells and the HarmonyOS project contain none of this AI capability, so they are not service paths for this algorithm.',
          },
        ],
      },
      {
        id: 's4',
        title: 'How it works: input, processing, output',
        blocks: [
          {
            kind: 'p',
            text: 'Input: Chinese text you actively submit in the interface (natural-language descriptions, task fields, and the context needed for this request). The system does not collect contacts, photos, location or other unrelated permissions.',
          },
          {
            kind: 'ol',
            items: [
              'Started from the UI: four entry points (inbox one-line capture, decompose-task in task detail, time and priority estimates in timeline and board, assistant panel).',
              'Context assembled: only what this request needs.',
              'Three gates: AI master switch, "allow remote", and per-feature egress consent — all off by default.',
              'A model endpoint generates Chinese text; the endpoint is configured by you.',
              'Results appear as suggestions only, in the screen that made the request, and are written after you confirm.',
            ],
          },
          {
            kind: 'p',
            text: 'If a gate does not pass or the endpoint fails: the call is not made, it is never silently rerouted to another endpoint, and the failure is visible in the interface. Unconfirmed proposals change no data and expire on their own when the session is restored.',
          },
          {
            kind: 'p',
            text: 'Data boundary: the product is end-to-end encrypted, so the sync server cannot read plaintext by design; plaintext exists only on your device, plus the one copy sent to the model endpoint after the gates pass. We do not build our own training corpus, do not fine-tune, do not host model weights, and do not use your data for training.',
          },
        ],
      },
      {
        id: 's5',
        title: 'Controls you hold',
        blocks: [
          {
            kind: 'ul',
            items: [
              'Turn it off: the AI master switch and per-feature egress consent; when off the feature is wholly unavailable and never falls back to another path.',
              'Decline: every suggestion needs your confirmation; unconfirmed ones expire automatically.',
              'Edit or delete: results can be edited, deleted, or withdrawn.',
              'Take your data with you: full export including the complete operation log, on Web and on mobile.',
              'Close your account: account deletion is available.',
            ],
          },
          {
            kind: 'p',
            text: 'What the interface currently shows is provenance labelling — "from this device" / "from cloud", "AI estimate" — plus the notice "AI may be wrong; please check important information.", and a pre-egress disclosure that this one copy is not end-to-end encrypted. Text produced by the model also carries the legally required explicit label "AI-generated synthetic content", shown beneath assistant replies, unconfirmed proposals, breakdown drafts, duration estimates, priority suggestions, natural-language capture candidates, and the mobile assistant replies and proposals.',
          },
        ],
      },
      {
        id: 's6',
        title: 'One control not yet in place (stated plainly)',
        blocks: [
          {
            kind: 'p',
            text: 'The following is **not implemented**. We list it here rather than describing it as existing:',
          },
          {
            kind: 'ol',
            items: [
              'Automatic review of input and output content is not deployed. The system does not classify content and does not filter anything on a keyword hit. This is the main remaining risk.',
            ],
          },
          {
            kind: 'callout',
            text: 'Plan: it is completed before any public release, after which this page and the filing materials are updated together. The explicit label \"AI-generated synthetic content\" was implemented on 2026-10-09 (see the previous section); the in-app one-tap complaint/report entry was added on the same day (see the feedback route below). Neither is listed here any more.',
          },
        ],
      },
      {
        id: 's7',
        title: 'Feedback route',
        blocks: [
          {
            kind: 'p',
            text: 'Objections, reports and questions about this algorithm’s results: heyta@waytofuture.cn, answered within 15 working days.',
          },
          {
            kind: 'p',
            text: 'The app also offers a one-tap entry: on the web under \"Settings → Help and about\", on mobile under \"Settings → General → Help and feedback\". It opens a draft addressed to that mailbox with the subject pre-filled as \"heyta algorithm service complaint/report\". It is email rather than an in-app ticket, so the app issues no ticket number and shows no progress; on mobile, if no mail app is available on the device, the screen says the draft did not open and shows the address itself.',
          },
          {
            kind: 'p',
            text: 'For personal-information requests see the Individual Rights page.',
          },
        ],
      },
      {
        id: 's8',
        title: 'Version and updates',
        blocks: [
          {
            kind: 'p',
            text: 'Last substantive change to this page: 2026-10-20 (published; the text itself last changed on 2026-10-09). When the mechanism, data flow, model service, termination scope or service agreement changes materially, this page and the filing materials are updated together.',
          },
        ],
      },
    ],
  },
};
