/**
 * 移动端协作旅程的 **owner 侧步进工具**（给 `verify-mobile-collab-ios.sh` 用）
 * ========================================================================
 *
 * ## 为什么需要一份新的小工具，而不是直接调 `verify-collab-sync.mjs`
 *
 * 那三套 `verify-collab-*.mjs` 是一条**从头跑到尾**的整体验收，手机那一侧在里面不存在；
 * 而移动端旅程的节奏是「owner 做一步 → 等手机界面走到下一态 → 再做下一步」，
 * 中间那一段**只有手机上屏才成立**。所以这里把 owner 侧拆成可单独调用的步进，
 * bash 才能在两个等待点之间去点界面。
 *
 * 🔴 写侧**不手搓线 op**：加评论/加任务都走 `createShareOpDispatcher`（生产装配件，
 * 与 `apps/web`、`apps/mobile` 用的是同一个函数），actionType 词表、`Math.trunc` 的时间戳、
 * 因果时钟自增、逐 op 签名全在里面。脚本换掉的只有"私钥握在谁手里"。
 *
 * ## 状态
 *
 * 一份 JSON（`--state` 指定路径）存 share id、owner 的成员行、清单密钥、邀请凭证、
 * 手机那一行的成员 id。**owner 的种子密钥也落在这个文件里**，所以它必须是**每轮私有的
 * 临时文件**，不许写进仓库、不许用跨轮共享的固定路径。
 *
 * ## 退出码
 *
 * `0` 成功；`1` 判据不成立（含超时）；`2` 用法/前置错（参数缺失、状态文件读不到）。
 * stdout 只有一份 JSON（给 bash 取值用），诊断一律走 stderr。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  classifyShareOpSignature,
  deriveShareIdentityKeyPair,
  generateShareIdentitySeed,
  generateShareListKey,
  sealListKeyForRecipient,
} from '../../packages/sync-core/dist/index.js';
import { createSharePayloadCipher } from '../../packages/sync-client/dist/index.js';
import { createShareOpDispatcher } from '../../packages/app-host/dist/index.js';
import { publishSigningKey, rosterFromMembers } from './collab-sign.mjs';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

const die = (code, msg) => {
  process.stderr.write(`❌ ${msg}\n`);
  process.exit(code);
};

const args = process.argv.slice(3);
const cmd = process.argv[2];
const flags = {};
for (let i = 0; i < args.length; i += 1) {
  if (!args[i]?.startsWith('--')) die(2, `不认识的参数：${String(args[i])}`);
  flags[args[i].slice(2)] = args[i + 1];
  i += 1;
}

const required = (...names) => {
  for (const n of names) if (flags[n] === undefined) die(2, `缺参数 --${n}`);
  return names.map((n) => flags[n]);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── HTTP ─────────────────────────────────────────────────────────────── */

const http = async (method, url, token, body) => {
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 204 等 */
  }
  return { status: res.status, json };
};

const load = () => {
  const path = required('state')[0];
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    die(2, `状态文件读不到：${path}`);
  }
  return { path, state: JSON.parse(raw) };
};

const save = (path, state) => {
  writeFileSync(path, JSON.stringify(state, null, 2));
};

/* ── 生产写侧装配（owner 这一台"设备"） ────────────────────────────────── */

const ownerWriter = (state) => {
  const identity = deriveShareIdentityKeyPair(unb64(state.ownerSeedB64));
  const listKey = unb64(state.listKeyB64);
  const cipher = createSharePayloadCipher({
    current: { shareId: state.shareId, keyEpoch: state.keyEpoch, listKey },
  });
  let seq = state.opSeq ?? 0;
  // 🔴 时钟基准 = **这台设备已经发出去的那几条**（向量时钟的 share 分区只有本设备那一维在长）。
  //    它必须活到状态文件里：每一次 CLI 调用是一个新进程，进程内的 `clock` 从 0 起，
  //    于是 owner 的两条 op 会带同一份 `{owner:1}` —— 同一个 client 的两条 op 互相判 EQUAL，
  //    顺序只能靠 timestamp 猜（ADR-0067 裁决二明令不许退化成的那一形）。
  const clock = state.clientClock?.[state.ownerClientId] ?? 0;
  const dispatcher = createShareOpDispatcher({
    api: {
      uploadOps: async (shareId, ops) =>
        (await http('POST', `${state.baseUrl}/api/shares/${shareId}/ops`, state.ownerToken, { ops })).json ?? {
          accepted: [],
          rejected: [{ id: ops[0]?.id, code: 'HTTP_ERROR' }],
        },
    },
    cipher,
    clientId: state.ownerClientId,
    schemaVersion: 1,
    isSignedIn: () => true,
    baseClock: () => ({ [state.ownerClientId]: clock }),
    newId: () => {
      seq += 1;
      state.opSeq = seq;
      return `owner-op-${String(state.runId)}-${String(seq)}`;
    },
    signerFor: async () => ({
      memberId: state.ownerMemberId,
      ed25519SecretKey: identity.ed25519SecretKey,
    }),
  });
  return { dispatcher, cipher, identity };
};

/** 上传成功之后把本设备那一维推进一格，下一趟才自增得动（与生产 fold 同一条纪律）。 */
const advanceClock = (state) => {
  state.clientClock = state.clientClock ?? {};
  state.clientClock[state.ownerClientId] = (state.clientClock[state.ownerClientId] ?? 0) + 1;
};

/* ── 步进 ──────────────────────────────────────────────────────────────── */

const steps = {
  /**
   * 建共享 → owner 自证签名公钥 → 发一张给手机账号的邀请 → 种一条任务（手机加入后要看得见）。
   */
  async init() {
    const [baseUrl, ownerToken, invitedEmail] = required('base-url', 'owner-token', 'invited-email');
    const runId = Date.now();
    const created = await http('POST', `${baseUrl}/api/shares`, ownerToken, {});
    if (created.status !== 201 || !created.json?.shareId) {
      die(1, `owner 建共享失败：HTTP ${String(created.status)} ${JSON.stringify(created.json)?.slice(0, 200)}`);
    }
    const shareId = created.json.shareId;
    const ownerMemberId = created.json.memberId;
    const ownerSeed = generateShareIdentitySeed();
    const identity = deriveShareIdentityKeyPair(ownerSeed);
    const listKey = generateShareListKey();
    const keyEpoch = 1;
    // collab-sign 的 helper 传的是**相对路径**（在 verify-collab-sync 里由它自己的 api 前缀补全），
    // 这里的 http 要绝对 URL —— 少这一步就是 `Failed to parse URL from /api/...`。
    const pub = await publishSigningKey((m, p, t, b) => http(m, `${baseUrl}${p}`, t, b), {
      shareId,
      memberId: ownerMemberId,
      token: ownerToken,
      ed25519PublicKey: identity.ed25519PublicKey,
    });
    if (pub.status !== 200) die(1, `owner 自证签名公钥失败：HTTP ${String(pub.status)}`);
    const invitation = await http('POST', `${baseUrl}/api/shares/${shareId}/invitations`, ownerToken, {
      invitedEmail,
    });
    if (invitation.status !== 201 || !invitation.json?.token) {
      die(1, `发邀请失败：HTTP ${String(invitation.status)} ${JSON.stringify(invitation.json)?.slice(0, 200)}`);
    }
    const state = {
      runId,
      baseUrl,
      ownerToken,
      invitedEmail,
      shareId,
      ownerMemberId,
      ownerSeedB64: b64(ownerSeed),
      listKeyB64: b64(listKey),
      keyEpoch,
      ownerClientId: `owner-device-${String(runId)}`,
      invitationToken: invitation.json.token,
      clientClock: {},
      seededTaskIds: [],
    };
    save(flags.state, state);
    process.stdout.write(JSON.stringify({ shareId, ownerMemberId, invitationToken: invitation.json.token }) + '\n');
  },

  /** 等手机把自己加成成员（接受邀请是**手机界面**做的，这里只轮询成员表）。 */
  async 'wait-member'() {
    const { state } = load();
    const timeoutMs = Number(flags.timeout ?? 240);
    const deadline = Date.now() + timeoutMs * 1000;
    for (;;) {
      const view = await http('GET', `${state.baseUrl}/api/shares/${state.shareId}/members`, state.ownerToken);
      const rows = view.json?.members ?? [];
      const phone = rows.find((m) => m.memberId !== state.ownerMemberId && typeof m.identityPublicKey === 'string');
      if (phone) {
        state.phone = { memberId: phone.memberId, identityPublicKey: phone.identityPublicKey, role: phone.role };
        save(flags.state, state);
        process.stdout.write(JSON.stringify(state.phone) + '\n');
        return;
      }
      if (Date.now() > deadline) die(1, `等不到手机那一行成员（${String(timeoutMs)} 秒内，当前行数 ${String(rows.length)}）`);
      await sleep(2000);
    }
  },

  /** 把清单密钥封给手机那一行（手机解得开才算真的入群，界面会停在「等待分发密钥」直到这一步）。 */
  async deliver() {
    const { state } = load();
    if (!state.phone?.identityPublicKey) die(2, '还没有手机成员行，先跑 wait-member');
    const envelope = await sealListKeyForRecipient({
      listKey: unb64(state.listKeyB64),
      shareId: state.shareId,
      keyEpoch: state.keyEpoch,
      recipientX25519PublicKey: unb64(state.phone.identityPublicKey),
    });
    const put = await http(
      'PUT',
      `${state.baseUrl}/api/shares/${state.shareId}/members/${state.phone.memberId}/envelope`,
      state.ownerToken,
      { keyEpoch: state.keyEpoch, keyEnvelope: envelope },
    );
    if (put.status !== 200) die(1, `信封下发失败：HTTP ${String(put.status)} ${JSON.stringify(put.json)?.slice(0, 200)}`);
    process.stdout.write(JSON.stringify({ deliveredTo: state.phone.memberId, keyEpoch: state.keyEpoch }) + '\n');
  },

  /** owner（这台"设备"）写一条任务 —— 手机那一侧应当**不点同步**就看见它。 */
  async 'add-task'() {
    const [title] = required('title');
    const { state } = load();
    const { dispatcher } = ownerWriter(state);
    const entityId = `task-owner-${String(state.runId)}-${String(state.seededTaskIds.length + 1)}`;
    const out = await dispatcher.dispatch(state.shareId, {
      entityType: 'TASK',
      entityId,
      opType: 'CRT',
      payload: { title, projectId: state.seededProjectId ?? 'project-owner' },
    });
    if (out.skipped) die(1, 'dispatcher 判定未登录，一条请求都没发');
    advanceClock(state);
    state.seededTaskIds.push({ entityId, opId: out.opId, title });
    save(flags.state, state);
    process.stdout.write(JSON.stringify({ entityId, opId: out.opId }) + '\n');
  },

  /** owner 写一条评论到手机也能看到的那条任务上。 */
  async 'add-comment'() {
    const [body] = required('body');
    const { state } = load();
    const taskId = flags['task-id'] ?? state.seededTaskIds.at(-1)?.entityId;
    if (!taskId) die(2, '没有可评论的任务，先跑 add-task 或带 --task-id');
    const { dispatcher } = ownerWriter(state);
    const entityId = `comment-owner-${String(state.runId)}-${String((state.ownerCommentSeq ?? 0) + 1)}`;
    const out = await dispatcher.dispatch(state.shareId, {
      entityType: 'COMMENT',
      entityId,
      opType: 'CRT',
      // 只有这三格（comment-actions.ts 文件头第 4 条）：createdAt 由 reducer 从 op 时间戳派生。
      payload: { taskId, authorUserId: String(state.ownerUserId ?? state.ownerMemberId), body },
    });
    if (out.skipped) die(1, 'dispatcher 判定未登录，一条请求都没发');
    advanceClock(state);
    state.ownerCommentSeq = (state.ownerCommentSeq ?? 0) + 1;
    state.lastOwnerComment = { entityId, opId: out.opId, body, taskId };
    save(flags.state, state);
    process.stdout.write(JSON.stringify({ entityId, opId: out.opId, taskId }) + '\n');
  },

  /**
   * 拉共享日志，取**手机写的那几条**，用名册公钥逐条重验签。
   *
   * 🔴 判据是"手机那一行的签名在 owner 这台设备上重验 = verified"，不是"服务端说收下了"：
   * 服务端收下只证明字节没坏，verified 才证明 ADR-0069 那三格（同一个函数、同一个域、
   * 先判钥后判人）在移动端也成立。
   */
  async 'verify-phone-op'() {
    const { state } = load();
    if (!state.phone?.memberId) die(2, '还没有手机成员行，先跑 wait-member');
    const opsRes = await http(
      'GET',
      `${state.baseUrl}/api/shares/${state.shareId}/ops/causal?after=0&limit=200`,
      state.ownerToken,
    );
    if (opsRes.status !== 200) die(1, `下载共享日志失败：HTTP ${String(opsRes.status)}`);
    const rosterRes = await http('GET', `${state.baseUrl}/api/shares/${state.shareId}/signing-keys`, state.ownerToken);
    if (rosterRes.status !== 200) die(1, `签名名册读不到：HTTP ${String(rosterRes.status)}`);
    const roster = rosterFromMembers(rosterRes.json);
    const mine = (opsRes.json?.ops ?? []).filter((o) => o.signerMemberId === state.phone.memberId);
    const verdicts = mine.map((row) => ({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId ?? null,
      serverSeq: row.serverSeq,
      classify: classifyShareOpSignature({
        signingPublicKey: roster[row.signerMemberId],
        shareId: state.shareId,
        signerMemberId: row.signerMemberId,
        signature: row.signature,
        wire: {
          id: row.id,
          clientId: row.clientId,
          actionType: row.actionType,
          opType: row.opType,
          entityType: row.entityType,
          entityId: row.entityId ?? null,
          entityIds: row.entityIds ?? null,
          payload: row.payload,
          vectorClock: row.vectorClock ?? null,
          vectorClockEncoding: null,
          isPayloadEncrypted: row.isPayloadEncrypted ?? null,
          schemaVersion: row.schemaVersion,
          clientTimestamp: row.clientTimestamp,
        },
      }),
    }));
    // 🔴 判据用"手机那一行的签名在 owner 这台设备上重验 = verified"，不是"服务端说收下了"：
    //    收下只证明字节没坏，verified 才证明 ADR-0069 那三格（同一个函数、同一个域、
    //    先判钥后判人）在移动端也成立。
    const unverified = verdicts.filter((v) => v.classify !== 'verified');
    // 只有**显式要求**按正文认这一条时才解密（解密要清单密钥，而它不是这条判据的一部分）。
    let matched = flags['expect-body'] === undefined ? verdicts.length > 0 : null;
    if (matched === null) {
      const { cipher } = ownerWriter(state);
      const needle = flags['expect-body'];
      for (const row of mine) {
        let plain = '';
        try {
          plain = await cipher.decrypt(row.payload, {
            id: row.id,
            clientId: row.clientId,
            actionType: row.actionType,
            opType: row.opType,
            entityType: row.entityType,
            entityId: row.entityId ?? undefined,
            entityIds: row.entityIds ?? undefined,
            timestamp: Number(row.clientTimestamp),
            schemaVersion: row.schemaVersion,
          });
        } catch {
          continue;
        }
        if (plain.includes(needle)) {
          matched = true;
          state.phoneMatched = { id: row.id, entityId: row.entityId ?? null, entityType: row.entityType };
          save(flags.state, state);
          break;
        }
      }
      if (matched !== true) {
        die(
          1,
          `手机那一行名下解不出期望正文「${needle}」（名下行数 ${String(verdicts.length)}；` +
            `实体类型 ${verdicts.map((v) => v.entityType).join(',') || '无'}）`,
        );
      }
    }
    if (!matched) die(1, `手机那一行名下没有任何 op（成员行 ${String(state.phone.memberId)} 一条都没写过？）`);
    if (unverified.length > 0) {
      die(1, `手机写出的 op 里有未通过重验的：${JSON.stringify(unverified)}（应全部 verified）`);
    }
    process.stdout.write(JSON.stringify({ phoneOps: verdicts, matched: true }) + '\n');
  },

  /** 读数：把当前状态里"服务端侧看到的事实"打一份，给证据目录留 json。 */
  async dump() {
    const { state } = load();
    const view = await http('GET', `${state.baseUrl}/api/shares/${state.shareId}/members`, state.ownerToken);
    const ops = await http(
      'GET',
      `${state.baseUrl}/api/shares/${state.shareId}/ops/causal?after=0&limit=200`,
      state.ownerToken,
    );
    process.stdout.write(
      JSON.stringify(
        {
          shareId: state.shareId,
          ownerMemberId: state.ownerMemberId,
          phone: state.phone ?? null,
          members: view.json?.members ?? [],
          opCount: (ops.json?.ops ?? []).length,
          opAuthors: (ops.json?.ops ?? []).map((o) => ({
            id: o.id,
            entityType: o.entityType,
            signerMemberId: o.signerMemberId,
            serverSeq: o.serverSeq,
          })),
        },
        null,
        2,
      ) + '\n',
    );
  },
};

const fn = steps[cmd];
if (fn === undefined) die(2, `不认识的子命令：${String(cmd)}（可用：${Object.keys(steps).join(', ')}）`);
await fn();
