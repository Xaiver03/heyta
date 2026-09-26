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
import { isArgon2SlowBackend } from '@heyta/sync-core';

import { Button, Card, Divider, Screen, SectionHeader, Text, TextField } from '../ui/kit';
import { ConflictSheet } from './ConflictSheet';
import { formatStamp } from '../lib/date';
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
  // 第一次同步（含一次密钥派生）耗时约 30–40 秒，而同一会话内的第二次同步是 1–2 秒
  // —— `sync-core` 的 session cache 已经把派生结果缓存住了，所以那 30–40 秒
  // **每次应用会话只付一次**。
  //
  // 但"只付一次"不等于"不用解释"：一个没有说明的 40 秒转圈，用户会以为卡死了。
  // 说清楚是什么在慢、慢多久、之后会怎样，等待就变成可接受的。
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

  return (
    <Screen title="我的">
      <SectionHeader icon="action.sync" title="同步" />
      <Card>
        <View style={{ gap: 16 }}>
          <TextField
            label="服务器地址"
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder={DEFAULT_SERVER_URL}
            keyboard="url"
            hint="模拟器填 10.0.2.2（指向这台电脑）；真机填局域网地址。"
          />
          {transport === 'plaintext' ? (
            <Text variant="caption" tone="warning">
              {'明文连接，且目标不像是本机网段。访问令牌会以明文经过网络、可能被截获。任务内容仍是端到端加密的，但公网请务必改用 https://。'}
            </Text>
          ) : null}
          {transport === 'plaintext-local' ? (
            <Text variant="caption" tone="warning">
              {'明文连接（本机/局域网）。任务内容是端到端加密的，但访问令牌会以明文经过网络，只建议在可信网络里这样用。'}
            </Text>
          ) : null}
          <TextField
            label="访问令牌"
            value={token}
            onChangeText={setToken}
            placeholder="登录服务端后获得"
          />
          <TextField
            label="端到端加密口令"
            value={password}
            onChangeText={setPassword}
            secure
            hint="只存在内存里，应用重启后需要重新输入。服务端看不到明文。"
          />
        </View>
      </Card>

      <Button
        label={busy ? '正在同步…' : '立即同步'}
        onPress={onSync}
        tone="primary"
        icon="action.sync"
        disabled={!configured}
        loading={busy}
      />
      {!configured ? (
        <Text variant="caption" tone="subtle" style={{ textAlign: 'center' }}>
          填好服务器地址与访问令牌后才能同步。
        </Text>
      ) : null}
      {configured && slowKdf && status.kind !== 'synced' ? (
        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {'这台设备没有 WebAssembly，密钥派生要用纯 JS 计算：首次同步需等待约 30–40 秒，同一会话内之后就会很快。任务内容不受影响，照常可离线使用。'}
        </Text>
      ) : null}

      <SectionHeader icon="action.settings" title="状态" />
      <Card>
        <View style={{ gap: 12 }}>
          <StatusRow
            status={status}
            busy={busy}
            onOpenConflicts={() => {
              setConflictsOpen(true);
            }}
          />
          <Divider />
          <Row
            label="待上传"
            // 🔴 三态，不是两态。`0` 也要显示成"已全部上传" —— 留空会让用户
            // 分不清"没有待上传"和"还没读到"。但**还没读到就绝不能显示 0**：
            // 实测过本地躺着一条从未同步的任务时，界面写的是"已全部上传"。
            value={
              pendingUpload === undefined
                ? '读取中…'
                : pendingUpload === 0
                  ? '已全部上传'
                  : `${String(pendingUpload)} 项`
            }
            tone={pendingUpload === undefined || pendingUpload === 0 ? 'muted' : 'default'}
          />
          <Row
            label="上次成功同步"
            value={lastSyncedAt === undefined ? '从未' : formatStamp(lastSyncedAt)}
            tone={lastSyncedAt === undefined ? 'subtle' : 'muted'}
          />
        </View>
      </Card>

      <Button
        label="清除本机保存的凭据"
        onPress={() => {
          clearSyncConfig();
          setToken('');
          setPassword('');
        }}
        tone="ghost"
        disabled={token === '' && password === ''}
      />

      <Text variant="caption" tone="subtle">
        凭据只保留在内存中，应用完全退出后需要重新输入。
        日历、专注、清单与标签管理尚未实现。
      </Text>

      <ConflictSheet
        visible={conflictsOpen}
        onClose={() => {
          setConflictsOpen(false);
        }}
      />
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
  return (
    <View style={{ gap: 4 }}>
      <Text variant="row-title" tone={busy ? 'muted' : statusTone(status)}>
        {describeSyncStatus(status)}
      </Text>
      {status.kind === 'error' ? (
        <Text variant="caption" tone="danger" selectable>
          {status.message}
        </Text>
      ) : null}
      {status.kind === 'conflict' ? (
        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="danger">
            这几处两边都改过，heyta 不会替你挑——自动挑一个会悄悄丢掉另一边的改动。数据没有丢，但选完之前它们不会上传。
          </Text>
          <Button label="逐条处理" icon="conflict.warning" onPress={onOpenConflicts} />
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
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
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

