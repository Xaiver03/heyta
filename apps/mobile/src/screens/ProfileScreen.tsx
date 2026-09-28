/**
 * 「我的」—— 设置与同步
 * ======================
 *
 * 🔴 这个屏幕之所以存在，是因为**移动端此前一条数据都同步不出去**。
 *
 * 症状不是崩溃、不是报错，而是"建了任务、勾了完成、删了任务，全都只落在本机"。
 * 界面上完全正常 —— 没有服务端也照样能建任务（本地优先本来就该这样），
 * 所以**没有任何一处会提示"你没配上同步"**。
 *
 * 根因不在这个文件里：`openAppHost()` 在应用启动时就跑完了，而服务器地址、
 * 令牌、口令只能由用户在启动**之后**输入。所以真正的修复是在
 * `packages/app-host` 里加"运行时可变凭据"（`getSyncConfig`），
 * 这里只是它的界面。
 *
 * ---
 *
 * 🔴 **凭据只放内存，刻意不落盘。** 理由见 `sync/config.ts`。
 * 代价（每次冷启动要重填）是真的，所以界面上明说，
 * 而不是让用户自己发现"第二天打开又要输一遍"。
 *
 * 🔴 **冲突解决界面已补完**（见 `ConflictSheet.tsx`）。
 *
 * 此前这一屏在冲突时显示的是"解决界面尚未实现"—— 那句话诚实，
 * 但用户**无处可选**，数据会一直卡在待上传队列里。
 * 现在给出双方的内容并让用户选一边，两个方向都走 op-log 重新派发。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **设置行的骨架已收进共享层**（M3 第五刀，settings）
 *
 * 「一行设置长什么样」现在只有 `@heyta/ui` 的 `SettingsRow` /
 * `SettingsSection` 一份实现，web 的设置页用的是同一个（见
 * `apps/web/src/features/settings/HelpPanel.tsx` 等）。本文件**删掉了本地
 * 的 `Row`**，并把三处"`Button` + 说明文字"的成对写法换成了共享动作行。
 *
 * 端特有外壳仍然留在这里：`Screen` / `SectionHeader` / `Card` / `Chip` /
 * `TextField` 都是移动端 L2/L3 原语，共享层只拿 `leading` 插槽接一个字形、
 * 拿 `children` 接一组语言胶囊。
 *
 * 判据在共享层的 `model.ts`（有单测），本文件不再自己判：
 *   · **待上传三态**（`resolvePendingUploadPresentation`）——
 *     `undefined` = 还没读到、`0` = 全传完了，两者不能合并
 *     （这一屏曾经因为初值是 `0` 而把"一条没传"显示成"已全部上传"）；
 *   · **锁屏隐私开关的可用性**（`resolveSettingAvailability`）——
 *     `null`（平台没有这一项）→ 整行不渲染；`false` 是"用户关着"，照常渲染。
 *
 * ⚠️ **一处真实的外观变化**（不是损失，是有意的形状统一）：成长 / 回收站 /
 * 导出三个入口原来画成 kit 的 `Button`（带边框），现在是共享动作行
 * （主色文字 + 说明，无边框）。文案、点击行为、44pt 触控目标与
 * `accessibilityRole="button"` 都没变。
 *
 * ⚠️ **一处真实的损失**：**共享层没有输入行（`TextField` 那一档）**。
 * 同步表单仍是移动端 `TextField`（它管 secure / keyboard / hint 三件事），
 * 本刀没有为它做共享行 —— 理由是 web 那侧的输入框（`AiSettings` 的十几个
 * `#ai-*`）动不了（既有测试断言真实的 `<input type="checkbox">` 与 DOM
 * `disabled`，而 RNW 的 `Pressable` 不产出后者），所以共享输入行今天只会
 * 有**一个真实调用点**。最小可行的一步：等 `AiSettings` 的测试可以改时，
 * 让两端的输入行走同一个行骨架。
 *
 * 另外，`SettingsSection` 的 `leading` 是**插槽**（本文件传的是移动端
 * `ui/icons.tsx` 的 `<Icon>`）—— 因为两端字形不同源：共享层吃 `lucide` 的
 * **数据**（`HeytaIcon` 再拿 `react-native-svg` 画），本端用的是
 * `lucide-react-native` 的**组件**映射表。所以记号由宿主给，不进共享层的 props。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import type { SyncStatus } from '@heyta/sync-client';
import { classifyTransportSecurity } from '@heyta/sync-client';
import { LOCALES, useI18n } from '@heyta/i18n';
import { isArgon2SlowBackend } from '@heyta/sync-core';
import {
  SettingsRow,
  SettingsSection,
  resolvePendingUploadPresentation,
  resolveSettingAvailability,
  shouldRenderSettingsRow,
  type SettingsRowModel,
} from '@heyta/ui';

import { Button, Card, Chip, Divider, Screen, SectionHeader, Text, TextField } from '../ui/kit';
import { Icon } from '../ui/icons';
import { ConflictSheet } from './ConflictSheet';
import { ExportScreen } from './ExportScreen';
import { GrowthScreen } from './GrowthScreen';
import { HabitsScreen } from './HabitsScreen';
import { ListsSection } from './ListsSection';
import { NotesSection } from './NotesSection';
import { TagsSection } from './TagsSection';
import { TrashScreen } from './TrashScreen';
import { useLocalePreference } from '../i18n/locale-preference';
import { formatStamp } from '../lib/date';
import { useTokens } from '../theme';
import { describeSyncStatus, statusTone } from '../sync/status-text';
import { useMobileSync, refreshPendingUpload, syncNow } from '../sync/store';
import {
  DEFAULT_SERVER_URL,
  writeSyncConfig,
  clearSyncConfig,
  readSyncConfig,
} from '../sync/config';
import { wipeCredentialsAndWidgets } from '../widgets/credential-wipe';
import {
  clearWidgetState,
  isWidgetBridgeAvailable,
  readWidgetPrivacy,
  setWidgetPrivacy,
} from '../widgets/widget-bridge';
import {
  WIDGET_CARD_KEYS,
  resolveWidgetPlatform,
  shouldShowWidgetJourney,
  widgetAddSteps,
} from '../widgets/widget-journey';

/**
 * 这台设备该显示哪套"如何添加"步骤。
 *
 * ⚠️ **在模块级算一次**，不在渲染里算：`Platform.OS` 在一次进程生命周期内不会变，
 * 而放在渲染里会让每次重渲染都重建数组 —— 白白让下游的 `key` 失效。
 */
const WIDGET_ADD_STEPS = widgetAddSteps(resolveWidgetPlatform(Platform.OS));

export function ProfileScreen(): React.JSX.Element {
  const { status, lastSyncedAt, pendingUpload, busy } = useMobileSync();
  const { t } = useI18n();
  const tokens = useTokens();
  /**
   * 🔴 语言偏好**只放内存**，与凭据同一个取舍（见文件头与 `sync/config.ts`）。
   *
   * 代价是真实存在的：重开应用会回到设备语言，用户在这里选的英文"消失"。
   * 之所以仍然不落盘：
   *   1. 落盘要引入一个持久化键，而**偏好存储是 `packages/domain` /
   *      同步 schema 的事** —— 自己塞一个 `AsyncStorage` 键会造出
   *      一个谁也同步不到、也不受迁移管理的影子状态。
   *   2. 现在只有两种语言、且默认就跟随设备，收益（少点一次）远小于
   *      多一处"看起来生效了、其实另一台设备上没有"的状态。
   * 界面上因此明说"重开会回到设备语言"（`mobile.profile.language.hint`），
   * 而不是让用户自己发现。
   */
  const { locale, setLocale } = useLocalePreference();

  // 🔴 初值从**活配置**里读，而不是各写一份空字符串 ——
  // 否则切走再切回来（本组件会卸载重建）会把用户刚填的内容抹掉，
  // 而看起来像"填了没保存"。
  const existing = readSyncConfig();
  const [serverUrl, setServerUrl] = useState(existing?.serverUrl ?? DEFAULT_SERVER_URL);
  const [token, setToken] = useState(existing?.token ?? '');
  const [password, setPassword] = useState(existing?.password ?? '');

  // 🔴 冲突界面的可见性只是**界面状态**，不进 store。
  // 冲突本身在 `status.kind === 'conflict'` 里，所以关掉界面**不会清掉它们** ——
  // 「我的」屏仍会提示还有几处待处理，用户随时能回来继续。
  const [conflictsOpen, setConflictsOpen] = useState(false);

  /**
   * W5-2 · 锁屏组件的"隐藏任务标题"开关。
   *
   * 🔴 `null` 有三重含义，**必须区分**：
   *   - `null` = **这个平台没有这一项**（安卓/鸿蒙）或还没读到 → **整段不渲染**；
   *   - `false` = 用户关着；
   *   - `true` = 用户开着。
   *
   * 把 `null` 当成 `false` 会让安卓上出现一个**按了没反应的开关**，
   * 而用户会以为他设上了 —— 这比不显示更坏。
   *
   * ⚠️ 与上面"语言偏好只放内存"**不同**：这一项**必须**从原生读回来。
   *    切到别的标签时本组件会被卸载重建（见上面凭据那段注释），
   *    只放内存的话回来会显示成"关"，而文件里其实是"开" —— 那是在撒谎。
   */
  const [hideTitles, setHideTitles] = useState<boolean | null>(null);
  /**
   * 这台设备上小组件的原生桥在不在。
   *
   * 🔴 它是**整段旅程画不画的唯一判据**（不是平台名）—— 理由在 `widget-journey.ts` 文件头。
   * ⚠️ 只在挂载时算一次：原生模块在进程生命周期内不变，
   *    而且这个函数会触发一次「模块缺失」的警告，每帧调用会刷屏。
   */
  const [widgetBridgeAvailable] = useState(() => isWidgetBridgeAvailable());

  /** 写失败时的一句提示。⚠️ **不能静默** —— 见 `setWidgetPrivacy` 的注释。 */
  const [privacyFailed, setPrivacyFailed] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void readWidgetPrivacy().then((value) => {
      // 卸载后不要再 setState（切标签很快时必然发生）。
      if (alive) setHideTitles(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggleHideTitles = useCallback((): void => {
    if (hideTitles === null || privacyBusy) return;
    const next = !hideTitles;
    // 乐观：先动开关（让点击有即时反馈），失败了再改回来 + 提示。
    setHideTitles(next);
    setPrivacyFailed(false);
    setPrivacyBusy(true);
    void setWidgetPrivacy(next)
      .then((ok) => {
        if (!ok) {
          // 🔴 回滚。写不成的后果是"用户以为设了、其实没设" ——
          //    留着一个假的"开"比留着一个假的"关"更危险。
          setHideTitles(!next);
          setPrivacyFailed(true);
        }
      })
      .finally(() => {
        setPrivacyBusy(false);
      });
  }, [hideTitles, privacyBusy]);

  /**
   * 「我的成长」是**第二层**页面，不是第 6 个底部标签。
   *
   * 🔴 底部标签必须保持 5 个（任务 / 日历 / 专注 / 分类 / 我的）。成长是
   * "关于我"的回顾视图，与设置同居一处才符合心智；挤进标签栏会让每个标签
   * 都读不清。返回靠成长屏顶栏的返回键（`GrowthScreen` 的 `onBack`）。
   *
   * ⚠️ 这个状态**不落盘**：它只是一次浏览的位置。切到别的标签时本组件会被
   * 卸载重建（见下面凭据那段注释），于是回到「我的」总是设置首页 ——
   * 这正是想要的（用户不会"记不住上次在哪一层"）。
   *
   * ⚠️ 这个 `useState` 以及下面那个提前 return 必须**在所有 hook 之后** ——
   * 提前 return 会让后面没跑到的 hook 数量在两次渲染间变化，React 会直接报错。
   */
  const [growthOpen, setGrowthOpen] = useState(false);

  /**
   * 回收站 / 导出同样是**第二层**页面（与成长同一条纪律）：
   * 底部标签保持 5 个，返回靠各自顶栏的返回键。
   *
   * ⚠️ 与 `growthOpen` 一样，这些 `useState` 必须**在所有 hook 之后**才能被
   * 提前 return 消费 —— 见下面那段注释。
   */
  const [trashOpen, setTrashOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /**
   * 习惯（M3 第七刀）。
   *
   * 🔴 它是**另一批数据**（HABIT / HABIT_LOG），不是任务的另一种投影 ——
   * 但入口仍然走「我的」的第二层、**不加 tab**：ADR-0015 §4 的判决与
   * P10（撤销 `tab.quadrant`）都指向"底部标签保持 5 个"。
   * ⚠️ 代价是发现性：用户要「我的 → 习惯」两步才到（已写进本刀汇报）。
   */
  const [habitsOpen, setHabitsOpen] = useState(false);

  // 🔴 **输入即写进活配置，不能等到点「立即同步」才写。**
  //
  // 上面那段注释说的是实话 —— 本屏在切换底部标签时**会被卸载重建** ——
  // 但此前写入只发生在 `onSync` 里，于是**首次同步之前**切走再回来，
  // 令牌和口令就永久丢了。症状很有欺骗性：服务器地址因为还有 `DEFAULT_SERVER_URL`
  // 兜底而"看起来还在"，所以像是"只有令牌没被保存"。
  //
  // 这是移动端冲突验收脚本实测撞出来的：它建完任务切回「我的」时，
  // 界面显示的是「填好服务器地址与访问令牌后才能同步」。
  //
  // 守卫条件：**只有真的填了凭据才写**。否则首次挂载就会把一个空令牌的配置
  // 写进去，`readSyncConfig()` 从 `undefined`（尚未配置）变成一个"已配置但没令牌"
  // 的对象 —— 那会让"清空"和"从没填过"再次分叉，正是 `config.ts` 里
  // 「清空字段要写 null」那条纪律要避免的东西。
  useEffect(() => {
    if (token.trim() === '' && password === '') return;
    writeSyncConfig({ serverUrl, token, password });
  }, [serverUrl, token, password]);

  const configured = serverUrl.trim() !== '' && token.trim() !== '';

  // 🔴 明文连接的知情提示。
  //
  // 为什么不直接禁用 `http://`：heyta 是自建的，NAS / 树莓派 / 局域网容器
  // **本来就是明文 HTTP**，禁掉等于把这部分用户挡在门外。
  // 为什么必须提示：任务内容虽然始终端到端加密，但**访问令牌是明文的** ——
  // 拿到令牌就能读写密文、看元数据、甚至清空用户的数据。
  // 所以立场是"不禁止，但绝不静默"。判定逻辑在 `@heyta/sync-client`，
  // 三个宿主共用同一份规则（见 `packages/sync-client/src/server-url.ts`）。
  const transport = classifyTransportSecurity(serverUrl);

  // 🔴 为什么要把"慢"提前说出来。
  //
  // Hermes 没有 WebAssembly，Argon2id 只能走纯 JS 路径。**实测**：这台模拟器上
  // 一次派生约 30–40 秒，而同一会话内的第二次派生是 1–2 秒 ——
  // `sync-core` 的 session cache 把**同一个 salt** 的结果缓存住了。
  //
  // ⚠️ 但"只付一次"是**错的**说法。派生次数不取决于"同步了几次"，也不取决于
  // op 条数，而取决于**历史里出现过多少个不同的 salt**。
  //
  // 🔴 这里必须说准确，因为它决定了文案能不能给一个具体秒数：
  //   - **加密**侧：`encrypt()` 走 `getOrDeriveEncryptKey()`，一个会话共用
  //     **一个** salt —— 所以一台设备上传 100 条 op 仍然只派生一次；
  //   - **解密**侧：`decryptArgonFromBuffer()` 按**每条 op 载荷里的 salt**
  //     查缓存，缓存键是 `passwordHash:saltBase64`。
  //     所以代价 ≈ **历史上不同"加密会话/口令世代"的个数**，不是 op 条数。
  //
  // 实测：`user:37` 当时有 **20 余条 op、来自 8 个客户端**
  // （≈ 8 个不同 salt，因为一个客户端一个会话共用一个 salt），
  // 手机上首次同步 **290 秒**（宿主 load 47）。空账号（1 个 salt）约 30–40 秒。
  //
  // 原来这里的文案写死"首次同步约 30–40 秒"—— 那是**空账号**的数字，
  // 对一个正在等的用户来说是在**说假话**。现在改成给区间 + 说明增长原因，
  // 因为客户端在下载之前**无从知道**服务端有多少个不同的 salt。
  //
  // 说清楚是什么在慢、能慢到什么程度、之后会怎样，等待就变成可接受的。
  // 同步成功后（`synced`）提示自动消失，不再占地方。
  const slowKdf = isArgon2SlowBackend();

  // 🔴 进屏就真去读一次队列。
  // 不读的话 `pendingUpload` 一直是 `undefined`，界面只能显示"未知" ——
  // 而之前初值是 `0`，于是直接显示"已全部上传"，**本地一条没传也这么说**。
  useEffect(() => {
    void refreshPendingUpload();
  }, []);

  const onSync = (): void => {
    // 先把表单写进活配置，**再**同步 —— 顺序反了的话第一次点同步
    // 用的还是上一次的凭据，用户会看到"第一次失败、第二次才成功"。
    writeSyncConfig({ serverUrl, token, password });
    void syncNow();
  };

  /**
   * 「待上传」的三态判定在**共享层**（`@heyta/ui` 的
   * `resolvePendingUploadPresentation`，有单测）：`undefined` 是"还没读到"、
   * `0` 是"全传完了"，两者**绝不能合并** —— 这一屏曾经因为初值是 `0`
   * 而把"本地一条没传"显示成"已全部上传"。英文单复数（词条表没有 ICU，
   * 靠兄弟词条）也归它判，两端不再各判一次。
   *
   * ⚠️ 词条仍在这里选：门禁只认"字面量紧跟在 `t(` 之后"这一种形状
   * （落地页 `Nav.tsx` 记着同一条教训），所以每个分支都写完整的 `t('key')`。
   */
  const pending = resolvePendingUploadPresentation(pendingUpload);
  const pendingValue =
    pending.kind === 'unknown'
      ? t('mobile.profile.pending.loading')
      : pending.kind === 'none'
        ? t('mobile.profile.pending.allUploaded')
        : t(pending.plural ? 'mobile.profile.pending.count' : 'mobile.profile.pending.countOne', {
            count: pending.count,
          });

  /**
   * 同步状态那两张卡里的**值行**。
   *
   * 🔴 行的骨架来自 `@heyta/ui` 的共享 `SettingsRow`（与 web 的设置页同一份）——
   * 这里只给"标签 / 值 / 色调"，不再自己拼 `justifyContent:'space-between'`。
   * 色调是**状态语义**（未知/没有 → 弱化），不是外观偏好。
   */
  const statusRows: readonly SettingsRowModel[] = [
    {
      kind: 'value',
      label: t('mobile.profile.pending.label'),
      value: pendingValue,
      tone: pending.kind === 'count' ? 'default' : 'muted',
      valueTestID: 'profile-pending-value',
    },
    {
      kind: 'value',
      label: t('mobile.profile.lastSync.label'),
      value:
        lastSyncedAt === undefined
          ? t('mobile.profile.lastSync.never')
          : formatStamp(lastSyncedAt),
      tone: lastSyncedAt === undefined ? 'subtle' : 'muted',
      valueTestID: 'profile-last-sync-value',
    },
  ];

  /**
   * 小组件旅程（应用内）。
   *
   * 🔴 整段的判据是「这台设备上小组件的原生桥在不在」，不是平台名
   * （理由在 `widget-journey.ts` 文件头）。整段不画时，用户照做会得到一张
   * **永远显示占位**的卡片 —— 与"一个点了没反应的开关比没有更糟"同一条纪律。
   *
   * 🔴 锁屏隐私开关的**可用性**走共享 `resolveSettingAvailability`：
   *   - `null`（安卓/鸿蒙没有这一项）→ `unsupported` → 共享层**整行不渲染**；
   *   - `true` / `false` → `ready` → 正常渲染。
   * 把 `null` 当成 `false` 会画出一个**按了没反应的开关**，而用户会以为他设上了。
   */
  const widgetRows: readonly SettingsRowModel[] = [
    { kind: 'note', text: t('mobile.widgetJourney.intro') },
    // 四张卡片的名字要**列出来** —— 用户得先知道有什么可加。
    { kind: 'note', text: WIDGET_CARD_KEYS.map((key) => t(key)).join(' · ') },
    { kind: 'heading', text: t('mobile.widgetJourney.howTo'), divider: true },
    ...WIDGET_ADD_STEPS.map((key, index) => ({
      kind: 'note' as const,
      // ⚠️ `testID` 用词条 key 而不是下标：步骤表是常量，
      //    用下标会在将来插入步骤时让 React 复用错的行。
      testID: `widget-step-${key}`,
      // 🔴 序号由**共享层**画（`index`），不在宿主里拼 `${i + 1}. ` ——
      //    web 原来用 `<ol>`、本端原来拼字符串，那是同一件事的两份实现，
      //    两端的格式会各自漂移。现在只有 `SettingsRow` 一处画序号。
      index: index + 1,
      text: t(key),
    })),
    // 🔴 下面这两句都不是客套话：`cannotAutoAdd` 先说清"这件事得你自己做"，
    //    用户才不会去找那个不存在的按钮；`openOnce` 解释"为什么刚加上去是空的"。
    { kind: 'note', text: t('mobile.widgetJourney.cannotAutoAdd'), divider: true },
    { kind: 'note', text: t('mobile.widgetJourney.openOnce') },
    {
      kind: 'toggle',
      testID: 'widget-privacy-toggle',
      label: t('mobile.widgetJourney.privacyTitle'),
      hint: t('mobile.widgetJourney.privacyHint'),
      checked: hideTitles === true,
      onToggle: toggleHideTitles,
      disabled: privacyBusy,
      availability: resolveSettingAvailability(hideTitles),
    },
    ...(privacyFailed
      ? ([
          {
            kind: 'note',
            text: t('mobile.widgetJourney.privacyFailed'),
            tone: 'danger',
            role: 'alert',
          },
        ] as const)
      : []),
  ];

  /**
   * 「关于我 / 我的数据」的三个入口。
   *
   * 🔴 它们从 `Button` + 说明文字改成了**共享动作行**：设置页里"一行一个动作"
   * 这件事应该和 web 的设置页是同一个骨架（这正是本刀的目标形状）。
   * 代价是**去掉了 kit 按钮的边框外观** —— 文案、点击行为、可达性都没变
   * （动作行自带 44pt 触控目标与 `accessibilityRole="button"`）。
   */
  const entryRows: readonly SettingsRowModel[] = [
    {
      kind: 'action',
      testID: 'profile-entry-growth',
      label: t('mobile.growth.entry'),
      hint: t('mobile.growth.entry.hint'),
      onPress: () => {
        setGrowthOpen(true);
      },
    },
    {
      kind: 'action',
      testID: 'profile-entry-habits',
      label: t('mobile.habits.entry'),
      hint: t('mobile.habits.entry.hint'),
      onPress: () => {
        setHabitsOpen(true);
      },
    },
    {
      kind: 'action',
      testID: 'profile-entry-trash',
      label: t('mobile.trash.entry'),
      hint: t('mobile.trash.entry.hint'),
      onPress: () => {
        setTrashOpen(true);
      },
    },
    {
      kind: 'action',
      testID: 'profile-entry-export',
      label: t('mobile.export.entry'),
      hint: t('mobile.export.entry.hint'),
      onPress: () => {
        setExportOpen(true);
      },
    },
  ];

  /**
   * 🔴 提前 return **必须在所有 hook 之后**（见 `growthOpen` 的注释）。
   * 成长屏自带顶栏返回，所以这里不需要任何导航库。
   */
  if (trashOpen) {
    return (
      <TrashScreen
        onBack={() => {
          setTrashOpen(false);
        }}
      />
    );
  }

  if (exportOpen) {
    return (
      <ExportScreen
        onBack={() => {
          setExportOpen(false);
        }}
      />
    );
  }

  if (growthOpen) {
    return (
      <GrowthScreen
        onBack={() => {
          setGrowthOpen(false);
        }}
      />
    );
  }

  if (habitsOpen) {
    return (
      <HabitsScreen
        onBack={() => {
          setHabitsOpen(false);
        }}
      />
    );
  }

  return (
    <Screen title={t('mobile.profile.title')}>
      <SectionHeader icon="action.sync" title={t('mobile.profile.section.sync')} />
      <Card>
        <View style={{ gap: tokens['space.4'] }}>
          <TextField
            label={t('mobile.profile.serverUrl.label')}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder={DEFAULT_SERVER_URL}
            keyboard="url"
            hint={t('mobile.profile.serverUrl.hint')}
          />
          {transport === 'plaintext' ? (
            <Text variant="caption" tone="warning">
              {t('mobile.profile.transport.plaintext')}
            </Text>
          ) : null}
          {transport === 'plaintext-local' ? (
            <Text variant="caption" tone="warning">
              {t('mobile.profile.transport.plaintextLocal')}
            </Text>
          ) : null}
          <TextField
            label={t('mobile.profile.token.label')}
            value={token}
            onChangeText={setToken}
            placeholder={t('mobile.profile.token.placeholder')}
          />
          <TextField
            label={t('mobile.profile.password.label')}
            value={password}
            onChangeText={setPassword}
            secure
            hint={t('mobile.profile.password.hint')}
          />
        </View>
      </Card>

      <Button
        label={busy ? t('mobile.profile.sync.busy') : t('mobile.profile.sync.now')}
        onPress={onSync}
        tone="primary"
        icon="action.sync"
        disabled={!configured}
        loading={busy}
      />
      {!configured ? (
        <Text variant="caption" tone="subtle" style={{ textAlign: 'center' }}>
          {t('mobile.profile.sync.notConfigured')}
        </Text>
      ) : null}
      {configured && slowKdf && status.kind !== 'synced' ? (
        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {t('mobile.profile.sync.slowKdf')}
        </Text>
      ) : null}

      <SectionHeader icon="action.settings" title={t('mobile.profile.section.status')} />
      <Card>
        <View style={{ gap: tokens['space.3'] }}>
          <StatusRow
            status={status}
            busy={busy}
            onOpenConflicts={() => {
              setConflictsOpen(true);
            }}
          />
          <Divider />
          {/* 值行的骨架来自共享 `SettingsRow`（`statusRows` 见上）。 */}
          {statusRows.map((row) => (
            <SettingsRow key={row.testID ?? row.kind} row={row} />
          ))}
        </View>
      </Card>

      <Button
        label={t('mobile.profile.clearCredentials')}
        onPress={() => {
          // 🔴 清凭据必须**连小组件一起清**（决策 D6）。
          //
          //    小组件那份快照是**设备密钥**加密的，不是凭据加密的 ——
          //    所以"清了凭据"绝不等于"小组件读不到数据"。
          //    不一起清的话，主屏和锁屏上会**继续显示上一个账号的任务**，
          //    而且没有任何报错。
          //
          //    顺序与"抛异常也要清"的理由写在 `credential-wipe.ts` 文件头；
          //    `void` 是安全的 —— 那个函数**永不抛**。
          void wipeCredentialsAndWidgets({
            clearCredentials: clearSyncConfig,
            clearWidgets: clearWidgetState,
            onWidgetError: (error) => {
              // ⚠️ 组件没清干净是这里**唯一真正危险**的失败，
              //    所以必须留下痕迹，而不是退化成没人知道的 false。
              console.warn('[widgets] 清除凭据时没能清掉小组件状态', error);
            },
          });
          setToken('');
          setPassword('');
        }}
        tone="ghost"
        disabled={token === '' && password === ''}
      />

      {/*
        桌面小组件 —— **应用内的用户旅程**。
        ================================================================
        🔴 这一段存在的理由：一个小组件功能如果只在系统里存在，而应用里
        一个字都不提，那它对用户来说就**不存在** —— 他不知道卡片有几种、
        不知道该怎么加上去、更不知道"加了之后要先打开一次应用"。

        🔴 **整段的判据是"原生桥在不在这台设备上"，不是平台名。**
        桥不在时**整段不画**：画了的话用户照做会在桌面得到一张
        **永远显示占位**的卡片。与「一个点了没反应的开关比没有更糟」同一条纪律。
        判据与理由都在 `widget-journey.ts` 文件头。

        ⚠️ 这里**没有**"添加小组件"按钮 —— iOS/Android/鸿蒙**都不允许**
        应用替用户把小组件放上桌面。所以是引导，不是按钮：一个按下去
        什么都不会发生的按钮，比一段说明文字糟糕得多。
      */}
      {shouldShowWidgetJourney(widgetBridgeAvailable) ? (
        // 骨架来自共享 `SettingsSection`（与 web 的「小组件旅程」同一份实现）——
        // 行的内容与可用性判据在 `widgetRows` 里。
        <SettingsSection
          variant="card"
          testID="widget-journey"
          title={t('mobile.widgetJourney.sectionTitle')}
          leading={<Icon name="action.settings" size="sm" color={tokens['color.foreground-muted']} />}
          rows={widgetRows}
        />
      ) : null}

      <Text variant="caption" tone="subtle">
        {t('mobile.profile.footnote')}
      </Text>

      {/*
        「关于我 / 我的数据」的三个入口。
        🔴 成长**不是第 6 个底部标签**：标签栏必须保持 5 个
        （任务 / 日历 / 专注 / 分类 / 我的），而成长是"关于我"的第二层回顾视图，
        与设置同居一处才符合心智；回收站是删除的后悔药；导出是把数据带走
        （移动端没有 `<a download>`，走系统分享面板）。

        骨架来自共享动作行（`entryRows` 见上）—— 文案、行为、触控目标都没变，
        去掉的只是 kit 按钮的边框外观。
      */}
      <View style={{ gap: tokens['space.3'] }} testID="profile-entries">
        {entryRows.filter(shouldRenderSettingsRow).map((row) => (
          <SettingsRow key={row.testID ?? row.kind} row={row} />
        ))}
      </View>

      {/* 🔴 语言切换放在「我的」而不是顶部：它不是高频操作，
          放进顶栏会让每一次切屏都多一个不该点的目标。
          切换**只改内存里的状态**（`LocalePreferenceProvider`），
          理由与代价见上面 `useLocalePreference()` 那段注释。

          胶囊本身是移动端 L2 原语（`Chip`），所以走**插槽**注入 ——
          共享层只负责分组骨架、标题与说明。 */}
      <SettingsSection
        variant="card"
        testID="profile-language"
        title={t('mobile.profile.section.language')}
        note={t('mobile.profile.language.hint')}
        leading={<Icon name="action.settings" size="sm" color={tokens['color.foreground-muted']} />}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.3'] }}>
          {LOCALES.map((code) => {
            // 语言名永远用**它自己的语言**写（中文 / English），
            // 不跟着当前语言翻译 —— 否则用户在英文界面里找"中文"
            // 时会看到 "Chinese"，而他要找的正是"中文"两个字。
            // 顺带：先算成变量再绑，字面量就不会落在 label 的花括号表达式里。
            const label = code === 'zh-CN' ? t('common.lang.zh') : t('common.lang.en');
            return (
              <Chip
                key={code}
                label={label}
                selected={locale === code}
                onPress={() => {
                  setLocale(code);
                }}
              />
            );
          })}
        </View>
      </SettingsSection>

      <ConflictSheet
        visible={conflictsOpen}
        onClose={() => {
          setConflictsOpen(false);
        }}
      />

      {/* 清单 / 标签 / 便签管理。放在最后：它们读的都是**本地已物化状态**，
          而上半屏（同步 / 状态）读的是同步状态机 —— 两者的刷新时机不同，
          混在一起会让人以为"清单没更新是因为同步坏了"。

          ⚠️ 顺序是**清单在标签前**，与任务详情页里的字段顺序一致。
          两处顺序不同的话，用户会在两屏之间建立两套心智模型。

          🔴 **便签排在清单/标签「之后」**，不是插在中间。理由：清单与标签
          是**同一类**东西（"任务属于哪个容器 / 还跟什么有关"，都是任务的
          组织维度，详情页里也紧挨着），便签读的是**另一批实体**（NOTE），
          与任务无关。把便签插进这两段之间会打断那条组织维度的线索；
          排在后面则读成"任务相关的在上、独立的记录在下"。
          ⚠️ 不新增 tab（P10）：底部标签保持 5 个，见 `NotesSection` 文件头。 */}
      <ListsSection />
      <TagsSection />
      <NotesSection />
    </Screen>
  );
}

/** 同步状态那一行。**它必须说清是哪一种失败**，不能只写"同步失败"。 */
function StatusRow({
  status,
  busy,
  onOpenConflicts,
}: {
  status: SyncStatus;
  busy: boolean;
  onOpenConflicts: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  return (
    <View style={{ gap: tokens['space.1'] }}>
      <Text variant="row-title" tone={busy ? 'muted' : statusTone(status)}>
        {describeSyncStatus(status, t)}
      </Text>
      {status.kind === 'error' ? (
        <Text variant="caption" tone="danger" selectable>
          {status.message}
        </Text>
      ) : null}
      {status.kind === 'conflict' ? (
        <View style={{ gap: tokens['space.2'] }}>
          <Text variant="caption" tone="danger">
            {t('mobile.profile.conflict.body')}
          </Text>
          <Button
            label={t('mobile.profile.conflict.open')}
            icon="conflict.warning"
            onPress={onOpenConflicts}
          />
        </View>
      ) : null}
    </View>
  );
}
