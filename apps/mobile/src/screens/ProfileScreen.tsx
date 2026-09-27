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
 */

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { SyncStatus } from '@heyta/sync-client';
import { classifyTransportSecurity } from '@heyta/sync-client';
import { LOCALES, useI18n } from '@heyta/i18n';
import { isArgon2SlowBackend } from '@heyta/sync-core';

import { Button, Card, Chip, Divider, Screen, SectionHeader, Text, TextField } from '../ui/kit';
import { ConflictSheet } from './ConflictSheet';
import { GrowthScreen } from './GrowthScreen';
import { ListsSection } from './ListsSection';
import { TagsSection } from './TagsSection';
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
   * 「待上传」的三态文案**在 JSX 外面算好**。
   *
   * 🔴 两个理由，都会真的踩到：
   *   1. 三态：`undefined` 是"还没读到"，`0` 是"全部上传完"，两者都不能显示成数字。
   *   2. 门禁只认"字面量紧跟在 `t(` 之后"这一种形状；在属性里写
   *      `t(count === 1 ? 'a' : 'b')` 会被判成硬编码文案
   *      （落地页 `Nav.tsx` 记着同一条教训）。
   *
   * 顺带把英文单复数也放进这一层（词条表没有 ICU）：`1` 走单数兄弟词条，
   * 否则英文会渲染成 `1 items`。
   */
  const pendingValue =
    pendingUpload === undefined
      ? t('mobile.profile.pending.loading')
      : pendingUpload === 0
        ? t('mobile.profile.pending.allUploaded')
        : t(
            pendingUpload === 1 ? 'mobile.profile.pending.countOne' : 'mobile.profile.pending.count',
            { count: pendingUpload },
          );

  /**
   * 🔴 提前 return **必须在所有 hook 之后**（见 `growthOpen` 的注释）。
   * 成长屏自带顶栏返回，所以这里不需要任何导航库。
   */
  if (growthOpen) {
    return (
      <GrowthScreen
        onBack={() => {
          setGrowthOpen(false);
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
          <Row
            label={t('mobile.profile.pending.label')}
            // 三态 + 英文单复数的分支都在 `pendingValue` 里（见上面的注释）。
            value={pendingValue}
            tone={pendingUpload === undefined || pendingUpload === 0 ? 'muted' : 'default'}
          />
          <Row
            label={t('mobile.profile.lastSync.label')}
            value={
              lastSyncedAt === undefined
                ? t('mobile.profile.lastSync.never')
                : formatStamp(lastSyncedAt)
            }
            tone={lastSyncedAt === undefined ? 'subtle' : 'muted'}
          />
        </View>
      </Card>

      <Button
        label={t('mobile.profile.clearCredentials')}
        onPress={() => {
          clearSyncConfig();
          setToken('');
          setPassword('');
        }}
        tone="ghost"
        disabled={token === '' && password === ''}
      />

      <Text variant="caption" tone="subtle">
        {t('mobile.profile.footnote')}
      </Text>

      {/* 🔴 成长入口是「我的」里的一项，**不是第 6 个底部标签**：
          标签栏必须保持 5 个（任务 / 日历 / 专注 / 分类 / 我的），
          而成长是"关于我"的第二层回顾视图，与设置同居一处才符合心智。
          图标用 `growth.milestones`（奖杯）—— 它是这一屏的代表语义，
          且有别于任务/专注的任何字形，不会被误认成跳去别的功能。 */}
      <Button
        label={t('mobile.growth.entry')}
        icon="growth.milestones"
        onPress={() => {
          setGrowthOpen(true);
        }}
        tone="secondary"
      />
      <Text variant="caption" tone="subtle">
        {t('mobile.growth.entry.hint')}
      </Text>

      {/* 🔴 语言切换放在「我的」而不是顶部：它不是高频操作，
          放进顶栏会让每一次切屏都多一个不该点的目标。
          切换**只改内存里的状态**（`LocalePreferenceProvider`），
          理由与代价见上面 `useLocalePreference()` 那段注释。 */}
      <SectionHeader icon="action.settings" title={t('mobile.profile.section.language')} />
      <Card>
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
      </Card>
      <Text variant="caption" tone="subtle">
        {t('mobile.profile.language.hint')}
      </Text>

      <ConflictSheet
        visible={conflictsOpen}
        onClose={() => {
          setConflictsOpen(false);
        }}
      />

      {/* 清单 / 标签管理。放在最后：它们读的都是**本地已物化状态**，
          而上半屏（同步 / 状态）读的是同步状态机 —— 两者的刷新时机不同，
          混在一起会让人以为"清单没更新是因为同步坏了"。

          ⚠️ 顺序是**清单在标签前**，与任务详情页里的字段顺序一致。
          两处顺序不同的话，用户会在两屏之间建立两套心智模型。 */}
      <ListsSection />
      <TagsSection />
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

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'default' | 'muted' | 'subtle';
}): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: tokens['space.3'] }}>
      <Text variant="row-meta" tone="muted">
        {label}
      </Text>
      {/* 数字用等宽样式，避免 9 → 10 时整行宽度跳动。 */}
      <Text variant="numeric-body" tone={tone} numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}

