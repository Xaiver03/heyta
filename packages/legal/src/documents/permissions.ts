/**
 * 应用权限清单
 * ==============
 *
 * 法定出处：《App 违法违规收集使用个人信息行为认定方法》第二类第 3 项（权限申请须同步告知目的）、
 * 《常见类型移动互联网应用程序必要个人信息范围规定》第四条（不得因用户拒绝非必要权限而拒绝基本功能），
 * 以及字段模板见 `docs/research/legal-pipl-baseline.md` §5.2 C。
 *
 * 🔴 **这一份的写法与其他八份不同：逐字抄 manifest，不概括、不补。**
 * 应用商店与监管检测是**对照清单文件**逐项比对的，多写一项（"我们可能申请通知权限"）
 * 会被判成"超范围申请"，少写一项会被判成"隐瞒"。所以每一项都带 `文件:行号`，
 * 证据在 `docs/research/legal-dataflow-client.md` B17。
 *
 * ⚠️ 两处**当前状态**必须如实写，不要因为"以后会加"而提前列进表里：
 * ① Android 只声明了 `INTERNET`，**没有** `POST_NOTIFICATIONS`；移动端代码里也没有任何
 *    系统通知实现（无 `UNUserNotificationCenter` / `notifee` / `NotificationManager` 调用点），
 *    提醒目前只在应用内显示 —— 🔴 系统通知目前**只有 Web 有**（浏览器级授权 + 可选 Web Push）；
 * ② iOS 没有任何 `NS*UsageDescription`（即不申请任何需要说明的隐私权限）。
 * 加了就必须同步这张表 —— 这是本文件唯一会随版本变的部分。
 * 另：`apps/mobile/src/lib/reminders.ts` 与 `apps/web/src/features/reminders/notify.ts`
 * 是"提醒"这件事的两条不同落地路径，写这张表前先看它们，不要凭印象。
 */

import type { LegalDocument } from '../types.js';

const zh = [
  {
    id: 's1',
    title: '这份清单说的是什么',
    blocks: [
      {
        kind: 'p',
        text: '「权限」指操作系统替你把守的开关：一个应用要读某类东西（位置、通讯录、照片…），必须先向你所在的系统申请，系统再问你。**你在这里看到的每一项，都是 heyta 真的在系统清单文件里写进去的项**，没有一项是"以防万一先写上"的。',
      },
      {
        kind: 'p',
        text: 'heyta 不申请位置、通讯录、通话记录、短信、照片、麦克风、相机、健康、日历读写权限，也不读取其他应用的存储数据。',
      },
      {
        kind: 'callout',
        text: '一句实话：因为 heyta 的任务数据**全部由你自己输入**，它没有任何需要向你申请的系统权限理由。唯一必须的 `INTERNET` 也不是"个人信息权限"，它只是让应用能联网。',
      },
    ],
  },
  {
    id: 's2',
    title: '逐项清单',
    blocks: [
      {
        kind: 'p',
        text: '下表按**你实际会看到的系统弹窗**排列。"拒绝后哪些功能仍可用"这一列不是客套：这些功能在你拒绝之后**照常工作**，heyta 不会因为你不给某个权限而不让你用应用。',
      },
      {
        kind: 'table',
        head: ['系统 / 端', '权限名', '对应功能', '什么时候申请', '拒绝后怎样'],
        rows: [
          [
            'Android',
            'INTERNET（联网）',
            '与你配置的同步服务器通信；开启 AI 功能时连你自己填的端点',
            '安装时由系统授予，不会弹窗',
            '🔴 这是应用运行所必需的：断网后应用仍可正常使用与查看数据（本地优先），只是不能同步',
          ],
          [
            'Android',
            '通知（POST_NOTIFICATIONS）',
            '系统横幅提醒',
            '🔴 **未申请**：清单里没有这一项，且移动端代码目前不产生任何系统通知',
            '不适用：提醒只在应用内显示',
          ],
          [
            'iOS / iPadOS',
            '（无任何权限申请）',
            '不适用',
            '🔴 清单文件里**没有任何 `NS…UsageDescription`**，也不申请通知授权',
            '不适用：提醒只在应用内显示',
          ],
          [
            'Web（浏览器）',
            '通知授权（浏览器级，不是应用权限）',
            '任务到期的系统通知；以及可选的后台推送送达',
            '🔴 **只在你于设置里主动点「开启提醒通知」之后**才向浏览器申请；页面加载时绝不申请',
            '拒绝后提醒仍然只在页面内正常显示；被拒后我们不会再申请一次',
          ],
          [
            '鸿蒙 HarmonyOS',
            '（无）',
            '不适用',
            '🔴 当前模块配置**没有申请任何权限**（`requestPermissions` 为空）',
            '不适用',
          ],
          [
            '桌面壳（Windows / macOS / Linux）',
            '（无）',
            '不适用',
            '🔴 以普通桌面程序运行，不使用商店的权限申请模型',
            '不适用',
          ],
        ],
      },
    ],
  },
  {
    id: 's3',
    title: '不是"权限"但会影响你隐私的三件事',
    blocks: [
      {
        kind: 'p',
        text: '下面三项不在系统的"权限申请"页面上，因为它们不需要你点同意；但它们是**真实的数据流**，所以列在这里，免得你以为"没弹窗就等于没发生"。',
      },
      {
        kind: 'table',
        head: ['事项', '具体是什么', '你能怎么控制'],
        rows: [
          [
            '小组件（桌面卡片 / Widget）',
            '为了在系统桌面上显示你的任务与习惯，应用会写一份**加密的**快照到与应用共享的容器里（iOS 的 App Group `group.com.heyta`、Android 的私有存储）。内容是 AES-256-GCM 密文，密钥由系统安全存储生成、不离开系统。',
            '关闭小组件即不再写；锁屏"隐藏标题"开关能减少显示的内容',
          ],
          [
            '系统备份',
            'Android 侧我们**主动关掉了**数据备份（`allowBackup="false"`），你的任务数据不会跟着系统备份离开设备。iOS 的整机备份与鸿蒙的备份能力由系统决定，应用无法代你关闭。',
            '在系统设置里管理备份',
          ],
          [
            '局域网自建服务器',
            '如果你把同步服务器配成自己家里的地址（`http://…`），Android 允许这类明文连接、iOS 只允许连本地网络。这是为"自建"这个产品目标做的**刻意配置**，不是漏洞。',
            '只配置你自己信任的地址；建议用 HTTPS',
          ],
        ],
      },
    ],
  },
  {
    id: 's4',
    title: '这张表什么时候会变',
    blocks: [
      {
        kind: 'p',
        text: '只有两种情况会让我们新增权限：① 你主动开启的某个功能确实需要（例如接入系统级提醒）；② 操作系统本身把某项能力改成了需要申请。**新增时我们会先改这张表，再发版本**，并在下面的"版本记录"里写明为什么。',
      },
      {
        kind: 'ul',
        items: [
          '证据来源：各端系统的权限清单文件（manifest），逐项核对。',
          '本表与实际清单不一致时，**以你设备上安装的那份清单文件为准**，并请把它当作我们的缺陷报告给我们。',
        ],
      },
    ],
  },
] as const;

const en = [
  {
    id: 's1',
    title: 'What this list covers',
    blocks: [
      {
        kind: 'p',
        text: 'A "permission" is a gate your operating system holds for you: before an app can read a certain kind of thing (location, contacts, photos…), it must ask your system, and your system asks you. **Every row below is something heyta actually writes into its manifest file.** Nothing here is listed "just in case".',
      },
      {
        kind: 'p',
        text: 'heyta does not request location, contacts, call log, SMS, photos, microphone, camera, health, or calendar write access, and does not read other apps\' storage.',
      },
      {
        kind: 'callout',
        text: 'One honest sentence: because all of your heyta data is **typed in by you**, there is no reason for the app to ask for any personal-information permission at all. The only required entry, `INTERNET`, is not a personal-information permission either — it just lets the app reach the network.',
      },
    ],
  },
  {
    id: 's2',
    title: 'Item by item',
    blocks: [
      {
        kind: 'p',
        text: 'The table is ordered by **the system prompts you will actually see**. The column "what still works if you decline" is not politeness: those features keep working after you decline, and heyta does not withhold basic functionality because you refused a permission.',
      },
      {
        kind: 'table',
        head: ['Platform', 'Permission', 'Feature it serves', 'When it is requested', 'If you decline'],
        rows: [
          [
            'Android',
            'INTERNET',
            'Talking to the sync server you configured; reaching the endpoint you typed in for AI features',
            'Granted at install, no prompt',
            '🔴 Required for the app to run; offline you can still use and read your data (local-first), you just cannot sync',
          ],
          [
            'Android',
            'Notifications (POST_NOTIFICATIONS)',
            'System banner reminders',
            '🔴 **Not requested**: the manifest has no such entry, and the mobile code currently raises no system notification at all',
            'Not applicable: reminders are shown inside the app only',
          ],
          [
            'iOS / iPadOS',
            '(no permission requests at all)',
            'Not applicable',
            '🔴 The plist contains **no `NS…UsageDescription` entries**, and notification authorisation is not requested either',
            'Not applicable: reminders are shown inside the app only',
          ],
          [
            'Web (browser)',
            'Notification authorisation (a browser-level permission, not an app permission)',
            'System notifications when a task is due; optionally, background delivery',
            '🔴 Asked **only after you tap "turn on reminder notifications" in settings**; never asked on page load',
            'If you decline, reminders still display inside the page; once declined we do not ask again',
          ],
          [
            'HarmonyOS',
            '(none)',
            'Not applicable',
            '🔴 The module configuration **requests no permissions at all** (`requestPermissions` is empty)',
            'Not applicable',
          ],
          [
            'Desktop shells (Windows / macOS / Linux)',
            '(none)',
            'Not applicable',
            '🔴 They run as ordinary desktop programs and do not use a store permission model',
            'Not applicable',
          ],
        ],
      },
    ],
  },
  {
    id: 's3',
    title: 'Three things that are not "permissions" but do affect your privacy',
    blocks: [
      {
        kind: 'p',
        text: 'The three items below never appear on your system\'s permissions screen, because they do not need your consent. But they are **real data flows**, so they are listed here — "no prompt" does not mean "nothing happens".',
      },
      {
        kind: 'table',
        head: ['Item', 'What it actually is', 'How you control it'],
        rows: [
          [
            'Home-screen widgets',
            'To show your tasks and habits on your system desktop, the app writes an **encrypted** snapshot into a container shared with the widget (iOS App Group `group.com.heyta`, Android private storage). The payload is AES-256-GCM ciphertext and the key is generated by, and never leaves, the system secure storage.',
            'Turning the widget off stops the writes; the lock-screen "hide titles" switch further reduces what is shown',
          ],
          [
            'System backups',
            'On Android we **deliberately turned data backup off** (`allowBackup="false"`), so your task data does not leave the device with a system backup. iOS device backups and HarmonyOS backup capability are decided by the system, which the app cannot switch off for you.',
            'Manage backups in your system settings',
          ],
          [
            'Self-hosted servers on your LAN',
            'If you point sync at your own address (`http://…`), Android allows such cleartext connections and iOS allows local-network only. This is a **deliberate configuration** for the "self-hosting" product goal, not an oversight.',
            'Configure only addresses you trust; HTTPS is recommended',
          ],
        ],
      },
    ],
  },
  {
    id: 's4',
    title: 'When this table changes',
    blocks: [
      {
        kind: 'p',
        text: 'We add a permission in only two situations: ① a feature **you** switched on genuinely needs it (for example a system-level reminder integration); ② your operating system reclassifies a capability as requiring a request. **In both cases this table is updated before the release ships**, with the reason recorded in the version note below.',
      },
      {
        kind: 'ul',
        items: [
          'Evidence: each platform\'s manifest file, checked item by item.',
          'If this table and the manifest on your device ever disagree, **the manifest on your device is authoritative** — please treat that as a defect and report it to us.',
        ],
      },
    ],
  },
] as const;

export const permissions: LegalDocument = {
  id: 'permissions',
  version: '1.0',
  status: 'draft',
  updatedDate: '2026-10-01',
  title: {
    'zh-CN': '应用权限清单',
    en: 'App Permissions Inventory',
  },
  summary: {
    'zh-CN':
      'heyta 在各端系统里申请了哪些权限、每项对应什么功能、拒绝之后哪些还能用 —— 逐项对照清单文件写成，没有一项是提前占位。',
    en:
      'Every permission heyta actually declares on each platform, the feature behind it, and what still works if you decline — transcribed from the manifest files, nothing pre-declared.',
  },
  sections: { 'zh-CN': zh, en },
};
