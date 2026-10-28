#!/usr/bin/env python3
"""「接收即抽取」这一档的判据，逐把尺各造一次失手（ADR-0077 §5 那 22 枚臂）。

来历：这批臂原先只活在**这台机器上、仓库外**的 `~/.heyta-evidence/inbound-hosted-extraction-20261027/mutate-arms.py`，
而 ADR-0077 §5 与 §6 把它当"可复现的取证装置"引用 —— 那句话的真实射程只是"这台机器上的我"。
同一种缺陷在 10-17 已经为 AC 电池修过一次（见 `verify-inbound-ac-battery.py` 文件头那段"来历"）。
本文件把 22 枚臂的**锚点串与注入串逐字照抄**搬进被跟踪目录，判据口径一个字不动；新增的只有下面两道闸门。

跑法：
    python3 research/tools/verify-inbound-hosted-arms.py --list            # 只列臂（末行 arms=N 是现量枚数）
    python3 research/tools/verify-inbound-hosted-arms.py --self-test        # 只测这台架自己有没有牙（不碰仓库，只用临时目录）
    python3 research/tools/verify-inbound-hosted-arms.py --root <干净载具>   # 全 22 臂
    python3 research/tools/verify-inbound-hosted-arms.py --root <载具> --only 12,13,18   # 按臂序号取子集

规矩（沿用工单 §4 那条纪律，未改）：
 · 一枚臂只动一处，且必须**恰好命中那一个锚**（命中数不是 1 就当场判"臂没落地"，等于零信息）；
 · 每臂跑完**只从 .mut-bak 还原**，还原后逐枚比 sha256，不符就立刻停；
 · 判决看 vitest 自己写的 `Tests ... N failed` 那一行，不取退出码 0/1 这一位，也不数 ` × ` 字形
   （上一版就是这么把八臂全读成"绿"的：ANSI 把 `×` 夹在 ``\\x1b[31m×\\x1b[39m`` 里，裸串永远匹配不到）；
 · 一条臂同时红了别的用例不算作弊，但登记里要写清红了哪几条（防止"随便摘一行都算它红"）。

🔴 两道新闸门（这台架为什么敢放进仓库里跑）：
 1. **载具闸门**：任何一枚臂要点名的文件在工作树里是脏的 ⇒ 整趟拒跑（rc=3），一枚都不注入。
    理由是本仓的共享检出里同时有别线在飞的件（`docs/agents/workflow-rules.md` §8 那条"变异类验收不许在共享检出里开窗口"）。
    还原只从 `.mut-bak` 取、绝不借 `git checkout` —— 那会把别人同一枚文件里的在飞改动一起顶掉。
 2. **库闸门**：集成面（H1 那几枚臂）的库**必须由调用方给** `HEYTA_INTEGRATION_DATABASE_URL`；
    没给就拒跑，不再像台架的前身那样默认某个库名 —— 默认一个名字等于替别人占库，
    而集成档会写行。给法与建库三步在下面 `--only` 拒跑时打印。
    ⚠️ 闸门的作用域**只到"这一趟点名的臂"**（`needs_integration`）：2026-10-28 第一版按整张表判，
    `--only 23,24,25`（三枚单元面）也被拒 —— 范围写宽不等于更安全，它只是逼人建一枚不必要的库或不跑。
    同理对照臂只跑这趟用到的规格（`controls_for`），不拿整张表的三个面当分母。
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ANSI = re.compile(r'\x1b\[[0-9;]*m')
TESTS_SUMMARY = re.compile(r'^\s*Tests\s+(?P<body>.*)$', re.MULTILINE)
FILES_SUMMARY = re.compile(r'^\s*Test Files\s+(?P<body>.*)$', re.MULTILINE)
FAILED_COUNT = re.compile(r'(?P<n>\d+) failed')
FAILED_TEST = re.compile(r'^\s*×\s+(?P<name>.+?)\s+\d+m?s?$', re.MULTILINE)

SERVER_SPEC = 'tests/inbound-hosted-extraction.spec.ts tests/inbound-automation.routes.spec.ts'
WEB_SPEC = 'tests/inbound-hosted-extraction-ui.spec.tsx'
# 🔴 集成面的形状与另两面不同：要 `--config`、要真库、要 `HEYTA_DUAL_HOST_ONLY=-1`
# 只放 H1 那一格过（其余 13 格在臂架上不是被测物，等它们等于把取证变成跑全量）。
INTEGRATION_PREFIX = 'INTEGRATION:'
INTEGRATION_SPEC = INTEGRATION_PREFIX + 'tests/integration/inbound-dual-host-fault-windows.integration.spec.ts'

PROVISION_HINT = (
    'HEYTA_INTEGRATION_DATABASE_URL 没给 ⇒ 集成面那几枚臂拒跑（不替别人占库）。\n'
    '   建一枚自己的库并逐枚 apply 迁移：\n'
    '     createdb heyta_hosted_arms_$(date +%m%d%H%M)\n'
    "     psql postgresql://$USER@127.0.0.1:5432/heyta_hosted_arms_… -c \"ALTER DATABASE … SET timezone='UTC'\"\n"
    '     for m in server/prisma/migrations/*/migration.sql; do psql "$URL" -v ON_ERROR_STOP=1 '
    '                       ${m:+$(grep -q CONCURRENTLY "$m" || echo --single-transaction)} -f "$m"; done\n'
    '   （会话时区那一步不是放宽判据：生产的 Postgres 本来就是 UTC 会话，见 verify-inbound-dual-host.py 同处注释。）'
)

ARMS = [
    # (标签, 文件, cwd, 规格, 旧串, 新串)
    ('A1 抽取成功后不再抹掉正文密文', 'server/src/automation/hosted-extraction.ts', 'server', SERVER_SPEC,
     '      payloadCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null,',
     '      leaseWorkerId: null, leaseExpiresAt: null,'),
    ('A2 设备认领时不再认服务端那把租约', 'server/src/automation/events.ts', 'server', SERVER_SPEC,
     '      if (current.lease_worker_id === HOSTED_EXTRACTION_LEASE_OWNER) {',
     '      if (false) {'),
    ('A3 领不到活也照样发模型请求', 'server/src/automation/hosted-extraction.ts', 'server', SERVER_SPEC,
     "    if (!current || current.status !== 'queued' || current.payloadCiphertext === null ||",
     "    if (!current || current.payloadCiphertext === null ||"),
    ('A4 那一列只要不是 false 就当用户同意', 'server/src/automation/inbound.routes.ts', 'server', SERVER_SPEC,
     '        if (rule.hostedExtraction === true) {',
     '        if (rule.hostedExtraction !== false) {'),
    ('A5 字段授权在发送前被跳过', 'server/src/automation/hosted-extraction.ts', 'server', SERVER_SPEC,
     '    modelInput = buildInboundModelInput(raw, request.rule.allowedFields);',
     '    modelInput = raw as Record<string, unknown>;'),
    ('A6 发送点改名（分母扫不到也要红）', 'server/src/ai/managed-completion.ts', 'server', SERVER_SPEC,
     '  const url = `${upstream.baseUrl}/chat/completions`;',
     '  const url = `${upstream.baseUrl}/chat/completion`;'),
    ('A7 面板里写第二份正文', 'apps/web/src/features/settings/InboundAutomationSettings.tsx', 'apps/web', WEB_SPEC,
     "{t('web.ai.inbound.hosted.label')}",
     '{\'由我们的服务器在内容到达时抽取\'}'),
    ('A8 开关只能开不能关（同意不可撤回）', 'apps/web/src/features/settings/InboundAutomationSettings.tsx', 'apps/web', WEB_SPEC,
     '        hostedExtraction,\n      });\n      setEditingRuleId(undefined);',
     '        ...(hostedExtraction ? { hostedExtraction: true } : {}),\n      });\n      setEditingRuleId(undefined);'),
    # A6 只证"改成 0 枚会红"；门槛的标题还承诺了另一半——长出第二套发送腿也要红。
    ('A9 长出第二枚拼接点（门槛的另一支）', 'server/src/automation/hosted-extraction.ts', 'server', SERVER_SPEC,
     "export const HOSTED_EXTRACTION_LEASE_OWNER = 'hosted-extraction';",
     "export const HOSTED_EXTRACTION_LEASE_OWNER = 'hosted-extraction';\nconst SECOND_LEG_PATH = '/chat/completions';"),
    ('A10 摘掉收件人公钥那道守卫（无公钥也要往下走）', 'server/src/automation/inbound.routes.ts', 'server', SERVER_SPEC,
     "        if (!recipient) return reply.status(503).send({ code: 'recipient_key_is_not_available', message: 'Recipient key is not available' });",
     "        if (false) return reply.status(503).send({ code: 'recipient_key_is_not_available', message: 'Recipient key is not available' });"),
    ('A11 失败日志顺手把正文带上（零日志那把尺）', 'server/src/automation/inbound.routes.ts', 'server', SERVER_SPEC,
     '            Logger.warn(`Inbound hosted extraction fell back to the device lane: ${outcome.reason}`);',
     "            Logger.warn(`Inbound hosted extraction fell back to the device lane: ${outcome.reason} body=${Buffer.from(rawBody).toString('utf8')}`);"),
    # ↓ 两枚打在**集成面**（H1）。单元那两面封/解都出自我自己写的 AAD，所以"两档接不接得上"
    #   这件事只有让真宿主的 `openInbound` 去解才知道 —— 这正是 A12 存在的理由。
    ('A12 冻结结果封回时 AAD 的 purpose 写成 input（设备那一腿解不开）', 'server/src/automation/hosted-extraction.ts', 'server', INTEGRATION_SPEC,
     "      eventId: request.eventId, purpose: 'result', keyEpoch: request.keyEpoch },",
     "      eventId: request.eventId, purpose: 'input', keyEpoch: request.keyEpoch },"),
    ('A13 集成面：抽取成功后正文密文没被抹掉', 'server/src/automation/hosted-extraction.ts', 'server', INTEGRATION_SPEC,
     '      payloadCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null,',
     '      leaseWorkerId: null, leaseExpiresAt: null,'),
    # 查询面（对外响应）的**两条失法各一枚臂**：去重那一支与退回设备那一支是两行不同的代码，
    # 合成一枚臂的话另一支坏掉时尺照样绿。
    ('A14 去重那一支把正文回显给发送方', 'server/src/automation/inbound.routes.ts', 'server', INTEGRATION_SPEC,
     '          return reply.status(202).send(statusResponse(existing.eventId, existing.status));',
     '          return reply.status(202).send({ ...statusResponse(existing.eventId, existing.status), echo: Buffer.from(rawBody).toString(\'utf8\') });'),
    ('A15 退回设备那一支把正文回显给发送方', 'server/src/automation/inbound.routes.ts', 'server', INTEGRATION_SPEC,
     "            return reply.status(202).send(statusResponse(row.eventId, 'queued'));",
     '            return reply.status(202).send({ ...statusResponse(row.eventId, \'queued\'), echo: Buffer.from(rawBody).toString(\'utf8\') });'),
    # ↓ 这两枚打在同一把**结构性门槛**上（`服务端这条腿不写 commit permit、不碰 op 写入`），
    #   但钉的是它**标题承诺的两半里、正则当时没管的那一半**：
    #   服务端真往 op-log 写的那一发是 `tx.operation.create/createMany`（`operation-upload.service.ts` 就是它），
    #   而门槛原先只盯设备侧那几个函数名 ⇒ 标题写着"不碰 op 写入"，断言管的是"没调用 createTaskBatch"。
    ('A16 这条腿长出一发 op 写入（门槛标题的另一半）', 'server/src/automation/hosted-extraction.ts', 'server', SERVER_SPEC,
     '      payloadCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null,\n    } });',
     '      payloadCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null,\n    } });\n    await tx.operation.create({ data: { entityId: String(identity.eventId), payload: String(outcome.resultCiphertext) } });'),
    ('A17 这条腿顺手写了一行 attempts 台账（§3.5 那一半）', 'server/src/automation/hosted-extraction.ts', 'server', SERVER_SPEC,
     '      payloadCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null,\n    } });',
     '      payloadCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null,\n    } });\n    await tx.automationAiAttempt.create({ data: { eventId: String(identity.eventId) } });'),
    # A16/A17 打的是单元面那两把尺；这一枚打的是**集成面那一句注释比断言宽**——
    # H1 里那句"不写任何 op"原先只由 `serverOps(eventId)`（按 `inbound:` 前缀数）撑着，
    # 服务端写出一枚别的 id 的 op 它看不见。补的断言比的是这一趟前后**按用户全量**的差，
    # 所以这一枚注入必须是一枚**schema 合法**的 op（缺字段会抛、抛了就成了意外红，不算牙）。
    ('A18 这条腿往 op-log 写一枚合规的 op（集成面那句"不写任何 op"）', 'server/src/automation/hosted-extraction.ts', 'server', INTEGRATION_SPEC,
     '      payloadCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null,\n    } });',
     '      payloadCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null,\n    } });\n    await tx.operation.create({ data: { id: `hosted-${input.eventId}`, userId: input.userId, clientId: HOSTED_EXTRACTION_LEASE_OWNER, serverSeq: 9_999_999, actionType: \'UPSERT\', opType: \'SINGLE\', entityType: \'task\', entityId: `hosted-${input.eventId}`, payload: {}, vectorClock: {}, schemaVersion: 1, clientTimestamp: BigInt(input.now()), receivedAt: BigInt(input.now()) } });'),
    # ↓ 三枚打的是**新加的那把尺**：ADR-0077 §4.5 那句"服务端不许长出打开入站正文的能力面"。
    # 它是源码读的尺，所以注入**只许碰进口与原语、不许真去执行解密**（一执行就缺私钥、
    # 缺字段 ⇒ 红的原因是崩溃不是判据，A16 那 5 条意外红的教训就写在这三枚的选择上）。
    ('A19 这条腿把具名的解密进口带进服务端', 'server/src/automation/hosted-extraction.ts', 'server', SERVER_SPEC,
     "} from '@heyta/inbound-core';",
     "  openInbound,\n} from '@heyta/inbound-core';"),
    ('A20 同一把尺要认得出**改了名**的进口（针盯的是进口子句里的原名）', 'server/src/automation/hosted-extraction.ts', 'server', SERVER_SPEC,
     "} from '@heyta/inbound-core';",
     "  openInbound as openServerSideEnvelope,\n} from '@heyta/inbound-core';"),
    ('A21 这条腿不进口、自己抄一份底层原语（第二支针钉的那一形）', 'server/src/automation/hosted-extraction.ts', 'server', SERVER_SPEC,
     "import { SERVER_MANAGED_MODEL_HOSTS } from '../ai/managed-upstream';",
     "import { SERVER_MANAGED_MODEL_HOSTS } from '../ai/managed-upstream';\n"
     "// 变异体：不是注释能挡的——把这四枚原语的形状塞进代码里（永不调用，只为让源码读的尺看见）。\n"
     "const _copied: unknown = (shared: Uint8Array) => [x25519, getSharedSecret, envelopeKey, aesDecrypt, diffieHellman, shared];"),
    # A22 打的是**集成面第三行 `202` 出口**：路由里成功那一支（`outcome.state` 直接进状态词）。
    # A14/A15 各钉另外两行（去重先命中、抽取没成退回 queued）—— 三行不同的代码，三枚臂，
    # 合成一枚的话其中一行被写坏时这把尺照样绿。注入走的是"顺手把发送方自己的正文回显给它看"那一形。
    ('A22 抽取成功那一支把正文回显给发送方（集成面第三行 202 出口）', 'server/src/automation/inbound.routes.ts', 'server', INTEGRATION_SPEC,
     '          return reply.status(202).send(statusResponse(row.eventId, outcome.state));',
     '          return reply.status(202).send({ ...statusResponse(row.eventId, outcome.state), echo: Buffer.from(rawBody).toString(\'utf8\') });'),
    # A23–A25 钉的是 ADR-0077 表里那一行「显式重试只认结果不确定那一档，且要求源正文还在」——
    # 那句此前只有集成面一枚**宽松**的断言（`[202,409,410,503]` 里 202 也算过），摘掉守卫里任何一支都不会红。
    # 三枚臂各摘一支：正文缺席 / 留存窗口过期 / 已有提交许可。被测面是 `tests/automation-events.spec.ts` 那四条新用例，
    # 它们自带绿头（正向那一档仍要成功入队），所以红只会来自"该拒的那一支没拒"。
    ('A23 重试不再要求源正文还在（摘掉 payloadCiphertext 那一支）', 'server/src/automation/events.ts', 'server',
     'tests/automation-events.spec.ts',
     '        event.payloadCiphertext === null || event.expiresAt <= now) throw new Error(\'Automation event cannot be retried\');',
     '        event.expiresAt <= now) throw new Error(\'Automation event cannot be retried\');'),
    ('A24 重试不看留存窗口（摘掉 expiresAt 那一支）', 'server/src/automation/events.ts', 'server',
     'tests/automation-events.spec.ts',
     '        event.payloadCiphertext === null || event.expiresAt <= now) throw new Error(\'Automation event cannot be retried\');',
     '        event.payloadCiphertext === null) throw new Error(\'Automation event cannot be retried\');'),
    ('A25 已有提交许可也放行重抽（摘掉 permit 那一支）', 'server/src/automation/events.ts', 'server',
     'tests/automation-events.spec.ts',
     '    if (!rule || permit) throw new Error(\'Automation event cannot be retried\');',
     '    if (!rule) throw new Error(\'Automation event cannot be retried\');'),
    # A26 钉判据 3 里"**查询路径**不出现明文"那一半：列表接口的 select 就是那条界线，
    # 此前没有任何用例看着它（多取一列没人会红）。这条臂往 select 里加回 `payloadCiphertext`。
    ('A26 列表接口把正文密文也选出来（查询路径吐明文）', 'server/src/automation/events.ts', 'server',
     'tests/automation-events.spec.ts',
     '    select: { eventId: true, ruleId: true, ruleVersion: true, status: true, reasonCode: true, attempt: true, createdAt: true },',
     '    select: { eventId: true, ruleId: true, ruleVersion: true, status: true, reasonCode: true, attempt: true, createdAt: true, payloadCiphertext: true },'),
    # A27 钉 ADR §4.1 那句"失败时对外只披露稳定码（model-request-failed 这类）"的**兜底那一支**：
    # 词表外的错误码会落到 `failureForRefusal` 的最后一行；把它改成"透上游 reason"，界面上就会出现上游原话。
    ('A27 兜底把上游 reason 透出去（错误路径回显上游内容）', 'server/src/automation/hosted-extraction.ts', 'server', SERVER_SPEC,
     "  return 'model-request-failed';",
     "  return (result.reason as HostedExtractionFailure) ?? 'model-request-failed';"),
]

ARM_FILES = sorted({arm[1] for arm in ARMS})


def needs_integration(arms: list[tuple]) -> bool:
    """这一趟要点名的臂里有没有走集成面的 —— 库闸门的作用域**只到这枚答案**。

    2026-10-28 实测的失法：第一版按**整张 ARMS 表**判，于是 `--only 23,24,25`（三枚单元面）
    也被库闸门拒（rc=3）。理由站不住：库闸门防的是"集成档往别人库里写行"，单元面一枚都不写库。
    范围写宽了不等于更安全 —— 它让"只想验三枚单元臂"的人要么去建一枚没必要的库，要么干脆不跑。
    """
    return any(arm[3].startswith(INTEGRATION_PREFIX) for arm in arms)


def controls_for(arms: list[tuple]) -> list[tuple[str, str]]:
    """这一趟真正要跑的规格（去重）⇒ 对照臂的面。**按点名到的规格取**，不拿整张表的三面当分母：
    对照臂的作用是"注入之前这枚规格本来就绿"，跑一枚这趟用不到的规格只会多烧几分钟并把红引进来。"""
    seen: dict[tuple[str, str], None] = {}
    for arm in arms:
        seen.setdefault((arm[2], arm[3]), None)
    return list(seen)


def sha(path: str) -> str:
    with open(path, 'rb') as handle:
        return hashlib.sha256(handle.read()).hexdigest()


NO_DIGIT = re.compile(r'\d')


def parse_failures(text: str) -> int:
    """判决只认测试框架自己写的汇总行。返回 -1 = 这趟根本没跑到断言。

    🔴 两种"没跑到"分开钉：整行都没有（语法错）与**行在但一个数字都没有**（`Tests  no tests` —— 集合层没
    collect 到用例，常见于载具缺 workspace 产物）。后者在第一版里被读成 0 条失败 ⇒ 对照臂报"绿"，
    于是"基线不成立"被当成"基线成立、每臂都绿"，整趟 22 臂的红全被吞掉。这正是本仓那条元规则：
    **一把恒绿的判据比没有判据更坏**。
    """
    stripped = ANSI.sub('', text)
    for pattern in (TESTS_SUMMARY, FILES_SUMMARY):
        match = pattern.search(stripped)
        if match is None:
            continue
        body = match.group('body')
        failed = FAILED_COUNT.search(body)
        if failed is not None:
            return int(failed.group('n'))
        return 0 if NO_DIGIT.search(body) else -1
    return -1


def failures(log: str) -> tuple[int, str]:
    with open(log, encoding='utf-8', errors='replace') as handle:
        raw = handle.read()
    return parse_failures(raw), raw


def face_command(spec: str, env: dict[str, str]) -> list[str] | str:
    """返回交给子进程的命令；集成面缺库时返回**一句拒跑理由**。"""
    if not spec.startswith(INTEGRATION_PREFIX):
        return ['npx', '--no-install', 'vitest', 'run', *spec.split()]
    url = os.environ.get('HEYTA_INTEGRATION_DATABASE_URL', '')
    if not url:
        return PROVISION_HINT
    env['DATABASE_URL'] = url
    env['HEYTA_DUAL_HOST_ONLY'] = '-1'
    return ['npx', '--no-install', 'vitest', 'run', '--config', 'vitest.integration.config.ts',
            '--maxWorkers=1', spec[len(INTEGRATION_PREFIX):]]


def carrier_guard(root: Path) -> tuple[list[str], list[str]]:
    """返回（臂点名文件里的脏项，整棵载具的其他脏项）。两栏都空才放行。

    🔴 为什么不只查臂点名的那几枚：注入期间文件处于变异态，而共享检出里别人可能来一发
    `git commit -a` —— 那会把我这枚"故意写坏"的源文件签进 main。判据与历次载具同一口径：**零脏起跑**。
    """
    all_status = subprocess.run(['git', '-C', str(root), 'status', '--porcelain'], capture_output=True, text=True).stdout.splitlines()
    dirty = [line[3:].split(' -> ')[-1] for line in all_status if line.strip()]
    armed = [path for path in dirty if path in ARM_FILES]
    return armed, [path for path in dirty if path not in ARM_FILES]


def default_spawn(command: list[str], cwd: str, env: dict[str, str], handle) -> None:
    subprocess.run(command, cwd=cwd, env=env, stdout=handle, stderr=subprocess.STDOUT)


def run_arm(root: Path, logs: Path, index: int, arm, baseline: str, spawn=default_spawn):
    label, rel, cwd, spec, old, new = arm
    path = str(root / rel)
    backup = path + '.mut-bak'
    shutil.copyfile(path, backup)
    source = Path(path).read_text(encoding='utf-8')
    hits = source.count(old)
    if hits != 1:
        os.remove(backup)
        return f'🔴 臂 {index}「{label}」锚点命中 {hits} 次（要恰好 1）——这臂等于没测', True
    Path(path).write_text(source.replace(old, new), encoding='utf-8')
    log = logs / f'arm-{index}.log'
    env = dict(os.environ)
    command = face_command(spec, env)
    if isinstance(command, str):  # 库闸门兜第二道：正常在 main 里就被挡下了
        shutil.copyfile(backup, path)
        os.remove(backup)
        return f'🔴 臂 {index} 拒跑（面缺输入）：\n{command}', True
    with open(log, 'w', encoding='utf-8') as handle:
        spawn(command, str(root / cwd), env, handle)
    count, text = failures(str(log))
    names = [m.group('name').strip() for m in FAILED_TEST.finditer(ANSI.sub('', text))]
    # 还原只从 .mut-bak 取，绝不借 git（工作树里别人的在飞改动不能被顶掉）。
    shutil.copyfile(backup, path)
    os.remove(backup)
    restored = sha(path) == baseline
    shape = '（没跑到汇总行：语法/集合层失手）' if count == -1 else ''
    verdict = '红' if count != 0 else '绿（这把尺没有牙）'
    lines = [f'{index:>2} · {label} ⇒ {verdict}{shape}，失败 {count} 条；还原{"_ok" if restored else "_FAIL"}']
    lines += [f'      {name}' for name in names]
    return '\n'.join(lines), (count == 0 or not restored)


VALUE_FLAGS = ('--root', '--only', '--ev')
BOOL_FLAGS = ('--list', '--self-test')


def validate_args(args: list[str]) -> str:
    """旗标校验：返回 '' 表示通过。值本身不当旗标判（`--root <路径>` 的那枚路径不是未知旗标）。"""
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in VALUE_FLAGS:
            if index + 1 >= len(args) or args[index + 1].startswith('--'):
                return f'🔴 {arg} 后面必须带值，不许静默退化成默认值'
            index += 2
            continue
        if arg not in BOOL_FLAGS:
            return f'🔴 不认的旗标：{arg}（这枚架只认 --list / --self-test / --root / --only / --ev）'
        index += 1
    return ''


def main() -> int:
    args = sys.argv[1:]
    error = validate_args(args)
    if error:
        print(f'{error}')
        return 2

    root = Path(args[args.index('--root') + 1]).resolve() if '--root' in args else Path(__file__).resolve().parents[2]
    if '--list' in args:
        for index, arm in enumerate(ARMS, start=1):
            face = '集成' if arm[3].startswith(INTEGRATION_PREFIX) else ('web' if arm[2] == 'apps/web' else 'server 单元')
            print(f'{index:>2} · {arm[0]}　[面={face}；文件={arm[1]}]')
        print(f'arms={len(ARMS)} 载具默认={root}')
        return 0
    if '--self-test' in args:
        return self_test()

    armed, others = carrier_guard(root)
    head = subprocess.run(['git', '-C', str(root), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
    if armed or others:
        print(f'🔴 载具闸门：{root} @ {head} 不是零脏（臂点名脏 {len(armed)} 枚／其他脏 {len(others)} 枚）⇒ 整趟拒跑，一枚都不注入。')
        for path in armed:
            print(f'   · 臂点名的：{path}')
        for path in others[:5]:
            print(f'   · 载具里别人在飞的：{path}')
        if len(others) > 5:
            print(f'   · …另有 {len(others) - 5} 枚（这栏是"整棵树不干净"，不是"臂要点名的文件脏"）')
        print('   为什么连"别的文件脏"也挡：注入期间那枚源文件是故意写坏的，共享检出里别人来一发 '
              '`git commit -a` 就会把它签进 main。⇒ 建一枚自己的载具：'
              '`git worktree add --detach .worktrees/<我的载具> HEAD`，装好依赖后 `--root` 指过去。')
        return 3
    print(f'2026 CARRIER_HEAD={head} dirty=0（臂点名的 {len(ARM_FILES)} 枚文件与整棵树都干净）')

    # `--only` 先解析：库闸门与对照臂的作用域都只到"这一趟要点名的臂"（见 needs_integration/controls_for 的注释）。
    only = None
    if '--only' in args:
        wanted = {int(v) for v in args[args.index('--only') + 1].split(',') if v.strip()}
        unknown = wanted - set(range(1, len(ARMS) + 1))
        if unknown:
            print(f'🔴 --only 里这些臂序号不在册：{sorted(unknown)}')
            return 2
        only = wanted
    selected = [arm for index, arm in enumerate(ARMS, start=1) if only is None or index in only]

    if needs_integration(selected) and not os.environ.get('HEYTA_INTEGRATION_DATABASE_URL'):
        print(f'🔴 库闸门：{PROVISION_HINT}')
        return 3

    ev = Path(args[args.index('--ev') + 1]) if '--ev' in args else root / '.run-logs' / f'inb-hosted-arms-{time.strftime("%m%d-%H%M")}'
    ev.mkdir(parents=True, exist_ok=True)

    baseline = {rel: sha(str(root / rel)) for rel in ARM_FILES}
    bad = []
    control_green = True
    for face_index, (cwd, spec) in enumerate(controls_for(selected)):
        log = ev / f'arm-0-control-{face_index}.log'
        env = dict(os.environ)
        command = face_command(spec, env)
        if isinstance(command, str):
            print(f' 0 · 对照臂 {spec} ⇒ 🔴 拒跑：\n{command}')
            control_green = False
            continue
        with open(log, 'w', encoding='utf-8') as handle:
            subprocess.run(command, cwd=str(root / cwd), env=env, stdout=handle, stderr=subprocess.STDOUT)
        count, _ = failures(str(log))
        print(f' 0 · 对照臂 {spec} ⇒ {"绿" if count == 0 else f"🔴 红 {count} 条"}')
        # 集成面那枚对照如果红，可能是载具库里没有 H1 的产物 —— 那照样是"这台机器跑不动这套用例"，
        # 与单元面同判：对照不绿，后面每一臂的红都不能算数。
        control_green = control_green and count == 0
    if not control_green:
        print(f'🔴 对照臂不绿：{len(selected)} 臂的红不能算数，先修基线')
        return 1

    for index, arm in enumerate(ARMS, start=1):
        if only is not None and index not in only:
            continue
        line, failed = run_arm(root, ev, index, arm, baseline[arm[1]])
        print(line, flush=True)
        if failed:
            bad.append(arm[0])
    print(f'\n{"✓ 全部臂都按预期红" if not bad else f"🔴 有 {len(bad)} 臂不符"}：跑过 {len(ARMS) if only is None else len(only)} 臂／在册 {len(ARMS)}')
    for label in bad:
        print(f'   - {label}')
    return 1 if bad else 0


def self_test() -> int:
    """这台架自己的牙：全部在临时目录里造失，不碰仓库、不跑用例。"""
    results = []

    def check(name: str, ok: bool, why: str = '') -> None:
        results.append((name, ok, why))
        print(f'{"✅" if ok else "❌"} 臂 {name}{"" if ok else "（" + why + "）"}', flush=True)

    # ① 判决取框架那行，不取字形：ANSI 包住的失败列表 + `Tests 3 failed (5)` ⇒ 必须读回 3。
    wrapped = '\x1b[31m   × foo > bar\x1b[39m 12ms\n Test Files  1 failed (1)\n      Tests  \x1b[90m3 failed\x1b[39m (5)\n'
    check('① ANSI 包裹的汇总行读得回失败条数（上一版就是在这里把八臂全读成绿）', parse_failures(wrapped) == 3,
          f'读回 {parse_failures(wrapped)}')
    # ② 没有任何汇总行 ⇒ 是"没跑到"，不许当"没失败"。
    # ②b/②c 汇总行**在**但整行没数字 —— 载具缺 workspace 产物时 vitest 就是这么收摊的
    # （10-28 在零脏载具上实测：`Test Files  2 failed (2)` + `Tests  no tests`，169ms 就结束）。
    # 第一版把它读成 0 条失败 ⇒ 对照臂报"绿"，22 臂的红全被吞。这两枚臂分别钉"这一形要红"与"真全过才许读成 0"。
    collected_nothing = ' Test Files  2 failed (2)\n      Tests  no tests\n   Duration  169ms\n'
    check('②b 行在但没数字（`Tests  no tests`）⇒ 判"没跑到"，不许读成 0 条失败',
          parse_failures(collected_nothing) == -1, f'读回 {parse_failures(collected_nothing)}')
    all_green = ' Test Files  2 passed (2)\n      Tests  33 passed (33)\n'
    check('②c 真跑完且全过（`Tests  33 passed (33)`）⇒ 才许读成 0',
          parse_failures(all_green) == 0, f'读回 {parse_failures(all_green)}')
    check('② 没跑到断言（语法/集合层失手）读成 -1，不许读成 0', parse_failures('TypeError: x is not a function\n') == -1,
          f'读回 {parse_failures("TypeError: x is not a function\n")}')
    # ③④⑧ 这三枚都要用到"跑一步"的形状，但自检不许真去 spawn 用例 —— 注入一枚只写日志的假腿。
    def fake_spawn(command, cwd, env, handle) -> None:
        handle.write('      Tests  1 failed (2)\n')

    with tempfile.TemporaryDirectory() as tmp:
        fake = Path(tmp) / 'fake.ts'
        fake.write_text('alpha\nbeta\n', encoding='utf-8')
        before = sha(str(fake))
        root = Path(tmp)
        logs = root / 'logs'
        logs.mkdir()
        line, failed = run_arm(root, logs, 1, ('造失', 'fake.ts', '.', 'nope', 'gamma', 'delta'), before, spawn=fake_spawn)
        check('③ 锚点打不中 ⇒ 报"臂没落地"且不落地改动（不跑用例也算红）',
              failed and '命中 0 次' in line and sha(str(fake)) == before, line.splitlines()[0])
        # ④ 还原不符 ⇒ 必须红（这里把 baseline 换成别的字节，造"改完没还原回原样"那一形）。
        line2, failed2 = run_arm(root, logs, 1, ('造失', 'fake.ts', '.', 'nope', 'alpha', 'ALPHA'),
                                 'not-the-real-baseline', spawn=fake_spawn)
        check('④ 还原后字节对不上 ⇒ 那臂判不符（不靠 git 兜底）', failed2 and '还原_FAIL' in line2, line2.splitlines()[0])
        # ⑤ 库闸门在注入**之后**被兜住时，必须先还原再退出 —— 不许留一枚变异态的文件走人。
        (root / 'arm-1.log').unlink(missing_ok=True)
        saved_url = os.environ.pop('HEYTA_INTEGRATION_DATABASE_URL', None)
        try:
            line3, failed3 = run_arm(root, logs, 1, ('造失', 'fake.ts', '.', INTEGRATION_SPEC, 'alpha', 'ALPHA'),
                                     before, spawn=fake_spawn)
        finally:
            if saved_url is not None:
                os.environ['HEYTA_INTEGRATION_DATABASE_URL'] = saved_url
        check('⑤ 库闸门兜在注入之后时，退出前文件已还原（不留变异态）',
              failed3 and '拒跑' in line3 and sha(str(fake)) == before, line3.splitlines()[0])
    # ⑥ 载具闸门：整棵载具必须零脏才放行。这里直接在临时 git 仓里造脏。
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        for rel in ARM_FILES:
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('seed\n', encoding='utf-8')
        subprocess.run(['git', '-C', str(root), 'add', '-A'], check=True)
        subprocess.run(['git', '-C', str(root), 'commit', '-qm', 'seed'], check=True)
        armed, others = carrier_guard(root)
        check('⑥a 零脏载具 ⇒ 闸门放行', armed == [] and others == [], f'{armed} {others}')
        (root / ARM_FILES[0]).write_text('seed\n别线在飞的一行\n', encoding='utf-8')
        armed, others = carrier_guard(root)
        check('⑥b 臂点名的文件脏 ⇒ 拒跑并归到"臂点名"那一栏', armed == [ARM_FILES[0]] and others == [], f'{armed} {others}')
        (root / ARM_FILES[0]).write_text('seed\n', encoding='utf-8')
        (root / 'apps/web/src/Unrelated.tsx').write_text('在飞\n', encoding='utf-8')
        armed, others = carrier_guard(root)
        check('⑥c 只有别的文件脏 ⇒ 照样拒跑（防注入期间被别人的 git commit -a 签走）',
              armed == [] and others == ['apps/web/src/Unrelated.tsx'], f'{armed} {others}')
    # ⑦ 库闸门：集成面没有 HEYTA_INTEGRATION_DATABASE_URL ⇒ face_command 给的是拒跑理由，不是命令。
    saved = os.environ.pop('HEYTA_INTEGRATION_DATABASE_URL', None)
    try:
        got = face_command(INTEGRATION_SPEC, {})
        check('⑦ 集成面缺库 ⇒ 返回"建库三步"而不是默认某个库名', isinstance(got, str) and 'createdb' in got, str(got)[:60])
    finally:
        if saved is not None:
            os.environ['HEYTA_INTEGRATION_DATABASE_URL'] = saved
    # ⑧ 旗标校验：带值的旗标后面那枚**值**不许被当成未知旗标 —— 写这三枚臂的理由很硬：
    # 第一版就是把 `--root .worktrees/inb-arms` 的那枚路径判成"不认的旗标"，整趟拒跑（rc=2），
    # 而拒跑本身看着像"闸门起作用了"，所以这种失法只能靠臂来钉，不能靠人读代码。
    check('⑧a --root/--ev/--only 带值的合法组合能通过校验',
          validate_args(['--root', '.worktrees/inb-arms', '--ev', '/tmp/x', '--only', '1,2']) == ''
          and validate_args(['--self-test']) == '' and validate_args(['--list']) == '',
          validate_args(['--root', '.worktrees/inb-arms']))
    check('⑧b 旗标缺值或值位上是另一枚旗标 ⇒ 拒（不许静默退化成默认载具）',
          validate_args(['--root']) != '' and validate_args(['--root', '--list']) != '', validate_args(['--root', '--list']))
    check('⑧c 真·未知旗标 ⇒ 拒', validate_args(['--carier']) != '', validate_args(['--carier']))
    # ⑩ 库闸门与对照臂的作用域只到"这一趟点名的臂"。第一版按整张表判 ⇒ `--only 23,24,25`（三枚单元面）
    # 也被拒（rc=3），逼着人要么建一枚不必要的库、要么干脆不跑。
    unit_only = [ARMS[22], ARMS[23], ARMS[24]]
    check('⑩a 只点名单元面的臂 ⇒ 不该要库', not needs_integration(unit_only), str([arm[0] for arm in unit_only]))
    integration_only = [arm for arm in ARMS if arm[3].startswith(INTEGRATION_PREFIX)]
    check('⑩b 点名到集成面的臂 ⇒ 必须要库', bool(integration_only) and needs_integration(integration_only),
          f'集成面在册 {len(integration_only)} 枚')
    check('⑩c 对照臂只取这趟用到的规格（去重）', controls_for(unit_only) == [('server', 'tests/automation-events.spec.ts')],
          str(controls_for(unit_only)))
    # ⑨ 一枚臂都没判过的自检不算量过（防止"把 check 全删掉"留下 failed=0 的假绿）。
    check('⑨ 自检确实跑了臂', len(results) > 0, '一条臂都没跑')
    failed_arms = [name for name, ok, _ in results if not ok]
    print(f'self_test arms={len(results)} failed={len(failed_arms)}')
    return 1 if failed_arms else 0


if __name__ == '__main__':
    raise SystemExit(main())
