import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const RESTORE_SCRIPT = join(currentDir, '../scripts/restore.sh');

/**
 * `restore.sh` 的**控制流**证据（它的两条 SQL 语句本身在真库上的行为在
 * `account-tombstone.pglite.spec.ts`，那里现读脚本、不抄语句）。
 *
 * `psql` 是 `docker exec` 进去跑的，所以假的 `docker` 就是假的 psql ——
 * 与 `backup-script.spec.ts` 同一个手法。假 docker 把每一次调用的 SQL 追加进
 * `$FAKE_DOCKER_LOG`，于是"闸有没有跑、跑在导入之前还是之后"是可断言的，
 * 而不是靠读脚本眼睛看。
 *
 * 🔴 这一组用例真正的价值在**顺序**与**不落地**：
 * - 表读不到时闸的两条语句一条都不跑，并且明说"导入已应用但**未验证**"
 *   （表检查必须在导入**之后** —— 整库那条路会先 `DROP SCHEMA`，提前查会拒掉它要保护的路）；
 * - 断言失败时不许出现 `RESTORE=OK`（一句可以被照做的成功行，比闸本身更容易伤人）；
 * - 导入失败时闸**根本不该跑**（否则"闸通过"是在一个半途的库上说的）。
 */



// 夹具是一份**真 shell 文件**（tests/fixtures/fake-docker.sh），不是模板字符串里的 shell。
// 它以前住在模板里，于是两类写法各自打断过整个夹具：反引号截断模板、反斜杠+空格被 JS 吃掉；
// 两种症状都不是某一条腿红，而是这一族用例集体红或集体静默读空。
// 它的形状与每一条会读数的臂都由 "FAKE_DOCKER 夹具自身" 那一支真跑一次钉住。
const FAKE_DOCKER_FILE = join(currentDir, "fixtures/fake-docker.sh");
const FAKE_DOCKER = readFileSync(FAKE_DOCKER_FILE, 'utf8');

/**
 * 把假 docker 记下的语句按**它实际是哪一步**归类，用来断言顺序。
 *
 * 🔴 判据的分支顺序与 fixtures/fake-docker.sh 里的臂序**逐字对应**，两边一起改才成立。
 *    字面片段都带上下文（`count(` 而不是 `count`）：表名 account_tombstones 自己就含着
 *    "count" 这四个字符，裸子串会让它冒充任何一句。
 */
function classify(sqls: string[]): string[] {
  return sqls.map((s) =>
    s === ''
      ? 'import'
      : s.includes('information_schema')
        ? 'table-check'
        : s.includes('STDOUT')
          ? 'carry-out'
          : s.includes('_restore_tombstone_preserved')
            ? 'preserve'
            : s.includes('count(') && s.includes('users')
              ? 'to-remove'
              : s.includes('DELETE FROM "users"')
                ? 'delete'
                : s.includes('t."user_id"')
                  ? 'assert'
                  : s.includes('count(')
                    ? 'count'
                    : `other:${s}`,
  );
}

/**
 * 🔴 夹具自己也要有一条能失败的判据。这一枚当场抓到两件事：
 *    ① `*TO\ STDOUT*` 写进 JS 模板字符串后反斜杠被吃掉 ⇒ 假 docker 是一份语法错误的脚本，
 *       症状是这一支**集体红**（24 条里 14 条），而红因只有一行 shell 报错；
 *    ② 更贵的一件：`*users.*u.*` 那条臂**一条都不命中** —— glob 里 `.` 是字面量，不是正则的任意字符。
 *       而分支写坏时兜底臂刻意是空的（不替它编输出），于是症状不是"臂认错"而是"这一句没有读数"：
 *       `removed=` 印成空串、断言那一读永远为空 ⇒ 闸看起来在跑，其实两次都没读到东西。
 *    所以这里不只 `sh -n`：**闸要读数的每一条臂都真跑一次**，并要求它把那个数带出来。
 */
describe('FAKE_DOCKER 夹具自身', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fake-docker-selfcheck-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 用夹具真跑一次：问它"这条语句你当成哪一步、给什么读数"。 */
  const ask = (sql: string, env: Record<string, string> = {}) => {
    const path = join(dir, 'docker');
    writeFileSync(path, FAKE_DOCKER);
    chmodSync(path, 0o755);
    const r = spawnSync(path, ['exec', 'c', 'psql', '-t', '-A', '-c', sql], {
      encoding: 'utf8',
      env: { ...process.env, FAKE_DOCKER_LOG: join(dir, 'calls.log'), ...env },
    });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout;
  };

  it('parses as sh', () => {
    const path = join(dir, 'docker');
    writeFileSync(path, FAKE_DOCKER);
    chmodSync(path, 0o755);
    const syntax = spawnSync('sh', ['-n', path], { encoding: 'utf8' });
    expect(syntax.status, `假 docker 自己语法就没过：${syntax.stderr}`).toBe(0);
  });

  it('every arm the gate reads a number from returns that number', () => {
    // 这四条 SQL 逐字取自 restore.sh 的闸步骤。任何一条臂写坏 ⇒ 这里红，
    // 而不是让上面那二十几条以"读数空 / 顺序怪"的方式红。
    expect(ask('COPY (SELECT user_id, email_hash, closed_at FROM account_tombstones) TO STDOUT WITH (FORMAT csv)', { FAKE_CARRY_ROWS: '1,abc,2026' })).toBe('1,abc,2026\n');
    expect(ask('SELECT count(*) FROM "users" u WHERE EXISTS (SELECT 1 FROM "account_tombstones" t WHERE t."user_id" = u."id")', { FAKE_TO_REMOVE: '3' })).toBe('3\n');
    expect(ask('SELECT t."user_id" FROM "account_tombstones" t WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."id" = t."user_id")', { FAKE_SURVIVORS: '42' })).toBe('42\n');
    expect(ask('SELECT count(*) FROM account_tombstones', { FAKE_TOMBSTONE_COUNT: '7' })).toBe('7\n');

    // 臂序也是判据：预计数那句同样含 t."user_id"。让它落到断言臂上，
    // "复活了几个账号"就会被读成"等着被删有几个"——同一族假绿的另一个方向。
    expect(ask('SELECT count(*) FROM "users" u WHERE EXISTS (SELECT 1 FROM "account_tombstones" t WHERE t."user_id" = u."id")', { FAKE_TO_REMOVE: '3', FAKE_SURVIVORS: '42' })).toBe('3\n');
  });
});

describe('restore.sh', () => {
  let workDir: string;
  let binDir: string;
  let artifact: string;
  let dockerLog: string;

  const run = (
    args: string[] = [artifact],
    env: Record<string, string> = {},
  ) => {
    const result = spawnSync('bash', [RESTORE_SCRIPT, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_DOCKER_LOG: dockerLog,
        ...env,
      },
    });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  };

  /** 假 docker 记录到的 SQL 序列（空串那一条就是"导入"那次调用）。 */
  const calls = (): string[] =>
    existsLog()
      ? readFileSync(dockerLog, 'utf8')
          .split('\n')
          .filter((l) => l.startsWith('CALL|'))
          .map((l) => l.slice('CALL|'.length))
      : [];

  const existsLog = (): boolean => {
    try {
      readFileSync(dockerLog, 'utf8');
      return true;
    } catch {
      return false;
    }
  };

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'restore-spec-'));
    binDir = join(workDir, 'bin');
    mkdirSync(binDir);
    const fakeDocker = join(binDir, 'docker');
    writeFileSync(fakeDocker, FAKE_DOCKER);
    chmodSync(fakeDocker, 0o755);
    dockerLog = join(workDir, 'docker-calls.log');
    artifact = join(workDir, 'supersync_20261005_000000.sql.gz');
    writeFileSync(artifact, gzipSync(Buffer.from('-- fake dump\nSELECT 1;\n')));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('happy path: preflight → import → gate delete → assert, and reports the counts', () => {
    const { status, output } = run([artifact], { FAKE_TOMBSTONE_COUNT: '3', FAKE_TO_REMOVE: '1' });

    expect(output).toContain('RESTORE=OK');
    expect(status).toBe(0);
    expect(output).toContain('tombstones=3');
    expect(output).toContain('removed=1');

    const sqls = calls();
    // 🔴 判子串的顺序与假 docker 里那条一样：表名 `account_tombstones` 含着 "count"，
    // 所以这里认的是 `count(*)` 这个函数调用本身，而不是裸子串 `count`。
    const kinds = classify(sqls);

    // 🔴 每一步都必须**存在且按这个顺序**：缺一就是"那条腿根本没跑到"，
    // 而不是"它跑通了"。表检查排在导入**之后**是有意的：整库恢复那条路会先
    // `DROP SCHEMA`，那张表此刻本来就不存在 —— 提前查会把它要保护的那条路拒掉。
    expect(kinds).toEqual([
      'table-check',
      'carry-out',
      'import',
      'table-check',
      'count',
      'to-remove',
      'delete',
      'assert',
    ]);
  });

  it('the bytes handed to psql are this artifact decompressed — not its own container bytes', () => {
    const stdinFile = join(workDir, 'imported-bytes.sql');
    const { status } = run([artifact], { FAKE_STDIN_FILE: stdinFile });

    expect(status, '导入那一步没跑到，下面这条就没有读数').toBe(0);
    expect(readFileSync(stdinFile, 'utf8')).toBe('-- fake dump\nSELECT 1;\n');
  });

  it('a resurrected account makes it exit 4 and it must NOT print the actionable success line', () => {
    const { status, output } = run([artifact], { FAKE_SURVIVORS: '42' });

    expect(status).toBe(4);
    expect(output).toContain('RESTORE=GATE_FAILED');
    expect(output).toContain('42');
    expect(output).not.toContain('RESTORE=OK');
  });

  it('no account_tombstones table: the gate refuses and says the import is NOT verified', () => {
    const { status, output } = run([artifact], { FAKE_NO_TOMBSTONE_TABLE: '1' });

    expect(status).toBe(3);
    expect(output).toContain('RESTORE=NO_TOMBSTONE_TABLE');
    expect(output).toContain('NOT verified');
    expect(output).not.toContain('RESTORE=OK');
    // 关键那一腿：闸的两条语句**一条都没跑** —— 没有判据可读时不许装作读过。
    const sqls = calls();
    expect(sqls.filter((s) => s.includes('DELETE FROM "users"'))).toEqual([]);
    expect(sqls.filter((s) => s.includes('EXISTS'))).toEqual([]);
    expect(sqls.some((s) => s === '')).toBe(true); // 导入确实发生了（表检查在它之后才有意义）
  });

  it('a failed import never reaches the gate', () => {
    const { status, output } = run([artifact], { FAKE_IMPORT_EXIT: '1' });

    expect(status).not.toBe(0);
    expect(output).not.toContain('RESTORE=OK');
    const sqls = calls();
    expect(sqls.filter((s) => s.includes('DELETE FROM "users"'))).toEqual([]);
  });

  it('missing artifact: refuses without touching the database at all', () => {
    const { status, output } = run([join(workDir, 'nope.sql.gz')]);

    expect(status).toBe(2);
    expect(output).toContain('RESTORE=ARTIFACT_MISSING');
    expect(existsLog()).toBe(false);
  });

  it('no argument at all: refuses instead of guessing which backup to restore', () => {
    const { status, output } = run([]);

    expect(status).toBe(2);
    expect(output).toContain('RESTORE=NO_ARTIFACT');
    expect(existsLog()).toBe(false);
  });

  it('a gzip that fails the integrity check is refused before anything is read from it', () => {
    writeFileSync(artifact, Buffer.from('not a gzip at all'));

    const { status, output } = run([artifact]);

    expect(status).toBe(2);
    expect(output).toContain('RESTORE=ARTIFACT_CORRUPT');
    expect(existsLog()).toBe(false);
  });
});

/**
 * `.enc` 那一档：`backup.sh` 现在**默认**产出加密产物，所以恢复侧不再是"读得到 .sql.gz 就行"。
 * ================================================================================
 *
 * 🔴 这一组真正要钉的是**解密发生在导入之前**，而且失败时什么都不导入：
 *    口令错 / 文件不是有效的密文 / openssl 不在位 —— 任何一种都必须落在 `exit 2` 且
 *    假 docker **一次都没被调用**。若顺序反了（先 gunzip 流进 psql 再判），症状是
 *    半截垃圾进了库、`ON_ERROR_STOP` 报错、运维以为"恢复失败了"，而库里已经动过。
 *
 * 顺序的后半段也要钉：解密之后仍然走那五步（gzip -t → 导入 → 表存在 → DELETE → 逐墓碑断言），
 * 而不是因为多了一步解密就把闸挤到前面去。
 *
 * 用真 openssl：假的只能证明"调用过 openssl"，证明不了"这份密文真能解成可导入的 gzip"。
 */
describe('restore.sh 读加密产物（backup.sh 的默认产物形状）', () => {
  let workDir: string;
  let binDir: string;
  let keyFile: string;
  let encArtifact: string;
  let dockerLog: string;

  const encrypt = (target: string, passphrase: string, content: string) => {
    writeFileSync(passphrase, 'hunter2\n');
    chmodSync(passphrase, 0o600);
    const gz = join(workDir, 'plain.sql.gz');
    writeFileSync(gz, gzipSync(Buffer.from(content)));
    const r = spawnSync(
      'openssl',
      ['enc', '-aes-256-cbc', '-salt', '-pbkdf2', '-iter', '1000000', '-pass', `file:${passphrase}`, '-in', gz, '-out', target],
      { encoding: 'utf8' },
    );
    expect(r.status, `夹具加密失败：${r.stderr}`).toBe(0);
    rmSync(gz);
  };

  const run = (args: string[], env: Record<string, string> = {}) => {
    const result = spawnSync('bash', [RESTORE_SCRIPT, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_DOCKER_LOG: dockerLog,
        BACKUP_ENCRYPTION_PASSPHRASE_FILE: keyFile,
        ...env,
      },
    });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  };

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'restore-enc-'));
    binDir = join(workDir, 'bin');
    mkdirSync(binDir);
    const fakeDocker = join(binDir, 'docker');
    writeFileSync(fakeDocker, FAKE_DOCKER);
    chmodSync(fakeDocker, 0o755);
    dockerLog = join(workDir, 'docker-calls.log');
    keyFile = join(workDir, 'passphrase');
    encArtifact = join(workDir, 'supersync_20261005_000000.sql.gz.enc');
    encrypt(encArtifact, keyFile, '-- fake dump\nSELECT 1;\n');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('decrypts, then keeps the documented gate order all the way to the assertion', () => {
    const { status, output } = run([encArtifact], { FAKE_TOMBSTONE_COUNT: '2', FAKE_TO_REMOVE: '1' });

    expect(output, output).toContain('RESTORE=OK');
    expect(status).toBe(0);

    const sqls = readFileSync(dockerLog, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('CALL|'))
      .map((l) => l.slice('CALL|'.length));
    const kinds = classify(sqls);
    // 🔴 与明文那一档**同一个顺序**：多出来的解密步骤插在 gzip -t 之前，不许动闸的位置。
    expect(kinds).toEqual([
      'table-check',
      'carry-out',
      'import',
      'table-check',
      'count',
      'to-remove',
      'delete',
      'assert',
    ]);
  });

  it('导入那一步喂给 psql 的是**解出来的**那份，不是密文容器本身', () => {
    // 🔴 这一腿是把上一趟真产物端到端撞到的缺陷钉回单元层的：`gzip -t` 已经改读解密后的临时文件
    //    并通过，而导入那一行还拿着 `$ARTIFACT`（密文）去 gunzip ⇒ "not in gzip format"、退出 1、
    //    什么都没导入。原来那份假 docker 把 stdin 丢进 /dev/null，所以这个错位在这里**看不见**；
    //    现在它把 stdin 收下来，于是"导入的是哪份字节"变成可断言的。
    const stdinFile = join(workDir, 'imported-bytes.sql');
    const { status } = run([encArtifact], { FAKE_STDIN_FILE: stdinFile });

    expect(status, '导入那一步没跑到，下面这条就没有读数').toBe(0);
    const bytes = readFileSync(stdinFile, 'utf8');
    expect(bytes).toBe('-- fake dump\nSELECT 1;\n');
    expect(bytes).not.toContain('Salted__');
  });

  it('the wrong passphrase refuses with exit 2 and the database is never touched', () => {
    writeFileSync(keyFile, 'not the passphrase\n');
    chmodSync(keyFile, 0o600);

    const { status, output } = run([encArtifact]);

    expect(status).toBe(2);
    expect(output).toContain('RESTORE=ARTIFACT_UNDECRYPTABLE');
    expect(output).not.toContain('RESTORE=OK');
    // 关键那一腿：**一次都没调用 docker** —— 解不开就不该有"半截导入"这种东西。
    expect(existsSync(dockerLog)).toBe(false);
  });

  it('a missing passphrase file refuses before the dump is read at all', () => {
    rmSync(keyFile);

    const { status, output } = run([encArtifact]);

    expect(status).toBe(2);
    expect(output).toContain('RESTORE=NO_KEY');
    expect(existsSync(dockerLog)).toBe(false);
  });

  it('ciphertext that is not really ciphertext is refused, not imported', () => {
    writeFileSync(encArtifact, Buffer.from('this is not an openssl container at all'));

    const { status, output } = run([encArtifact]);

    expect(status).toBe(2);
    expect(output).toContain('RESTORE=ARTIFACT_UNDECRYPTABLE');
    expect(existsSync(dockerLog)).toBe(false);
  });

  it('a truncated encrypted artifact is refused too (gzip -t still guards the import)', () => {
    // 口令对、容器头对，但内容短到解不出一个合法 gzip —— 这是 #9836 那个形状换了层皮：
    // 加密不改变"截断的产物看起来仍然像一份备份"这件事。
    const bytes = readFileSync(encArtifact);
    writeFileSync(encArtifact, bytes.subarray(0, Math.floor(bytes.length / 2)));

    const { status, output } = run([encArtifact]);

    expect(status).toBe(2);
    expect(output).toContain('RESTORE=ARTIFACT_UNDECRYPTABLE');
    expect(existsSync(dockerLog)).toBe(false);
  });

  it('the decrypted plaintext copy is gone once the run ends', () => {
    const { status, output } = run([encArtifact]);
    expect(status, output).toBe(0);

    const declared = /plaintext copy: (\S+)/.exec(output);
    // 🔴 判据要能从**输出**里指认那个路径：只断言"跑完了没留下 .sql.gz"会漏掉脚本把临时文件
    //    写到别处的实现（比如直接落在产物目录里，那会被下一次留存清扫当成一份合法备份）。
    expect(declared, `输出里没有声明明文副本的位置：${output}`).not.toBeNull();
    const plainPath = declared![1];
    const plainDir = dirname(plainPath);
    expect(existsSync(plainPath), `运行结束后明文副本还在盘上：${plainPath}`).toBe(false);
    expect(existsSync(plainDir), `运行结束后那个工作目录还在盘上：${plainDir}`).toBe(false);
    expect(plainDir).not.toBe(dirname(encArtifact));
    expect(plainDir).not.toBe(dirname(keyFile));

    // 本次夹具目录里不许留下任何解密后的产物（`.sql.gz` 而不带 `.enc`）。
    const leftovers = walk(workDir).filter((f) => f.endsWith('.sql.gz'));
    expect(leftovers, `运行结束后盘上还留着明文：${leftovers.join(', ')}`).toEqual([]);
  });
});

/** 递归列出目录里的文件（只用于"有没有明文残留"那一腿）。 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * 注销账本（`--ledger`）与"零知识拒绝"。
 * ================================================================================
 *
 * 🔴 这一组钉的是第一趟**真产物端到端**照出来的那个设计层空洞：整库恢复会先 `DROP SCHEMA`，
 *    于是 `account_tombstones` 一起被回滚成快照当时的空状态 —— 闸在那条"真会发生复活"的路上
 *    读不到任何输入，`tombstones=0 removed=0` 会被印成一句通过。补法是两件事：
 *    ① `backup.sh` 每晚在产物旁边产出一份**离库**的注销账本；
 *    ② 恢复时可以把它带进来，而**哪里都没有注销知识**时是一次拒绝，不是一次通过。
 *    ② 的那条拒绝必须由"不能失败"证明它有牙：显式 `HEYTA_ALLOW_EMPTY_TOMBSTONES=1` 是唯一出口，
 *    它是运维对"这套部署确实从没注销过账号"这个事实的**声明**，不是静默降级。
 *
 * 顺序也是这组的判据：账本的解码与形状检查都发生在**任何一次 docker 调用之前** ——
 * 一份解不开/形状不对的账本若等到导入之后才发现，留下的是半途的库加一个没人信得过的闸。
 */
describe('restore.sh 的注销账本与零知识拒绝', () => {
  let workDir: string;
  let binDir: string;
  let artifact: string;
  let keyFile: string;
  let dockerLog: string;

  const HEX64 = 'a'.repeat(64);
  const row = (id: number) => `${id},${HEX64},2026-10-01 0${id}:00:00`;

  /** 明文 csv 账本（pg_dump 的 `COPY … WITH (FORMAT csv)` 没有表头，夹具也不给）。 */
  const ledger = (rows: string[]) => {
    const path = join(workDir, 'supersync_tombstones_ledger.csv');
    writeFileSync(path, rows.length ? `${rows.join('\n')}\n` : '');
    return path;
  };

  const run = (args: string[], env: Record<string, string> = {}) => {
    const result = spawnSync('bash', [RESTORE_SCRIPT, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_DOCKER_LOG: dockerLog,
        BACKUP_ENCRYPTION_PASSPHRASE_FILE: keyFile,
        ...env,
      },
    });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  };

  const kinds = () =>
    classify(
      readFileSync(dockerLog, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('CALL|'))
        .map((l) => l.slice('CALL|'.length)),
    );

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'restore-ledger-'));
    binDir = join(workDir, 'bin');
    mkdirSync(binDir);
    const fakeDocker = join(binDir, 'docker');
    writeFileSync(fakeDocker, FAKE_DOCKER);
    chmodSync(fakeDocker, 0o755);
    dockerLog = join(workDir, 'docker-calls.log');
    artifact = join(workDir, 'supersync_20261005_000000.sql.gz');
    writeFileSync(artifact, gzipSync(Buffer.from('-- fake dump\nSELECT 1;\n')));
    keyFile = join(workDir, 'passphrase');
    writeFileSync(keyFile, 'hunter2\n');
    chmodSync(keyFile, 0o600);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('a ledger row is merged in AFTER the import and the gate runs against it', () => {
    const { status, output } = run([artifact, '--ledger', ledger([row(7)])], {
      FAKE_TOMBSTONE_COUNT: '1',
    });

    expect(output, output).toContain('RESTORE=OK');
    expect(status).toBe(0);
    expect(output).toContain('Closure knowledge carried across the import: 1 (live db 0 + ledger 1)');
    // 🔴 并回那四句（建表 / COPY 进 / 并回 / 丢表）必须落在导入之后、DELETE 之前 ——
    //    落在导入之前会被 `DROP SCHEMA` 抹掉，落在 DELETE 之后闸就读的是自己刚写的行。
    expect(kinds()).toEqual([
      'table-check',
      'carry-out',
      'import',
      'table-check',
      'preserve',
      'preserve',
      'preserve',
      'preserve',
      'count',
      'to-remove',
      'delete',
      'assert',
    ]);
  });

  it('the same account known to both sources is one tombstone, not a primary-key collision', () => {
    // 活库带走一行 + 账本同一 user_id 一行。staging 表上 user_id 是主键，不去重就 COPY 报错，
    // 而 ON_ERROR_STOP=1 会把整道闸停在半路 —— 症状是"恢复失败"，原因是一件事被记了两遍。
    const { status, output } = run([artifact, '--ledger', ledger([row(3)])], {
      FAKE_CARRY_ROWS: row(3),
    });

    expect(output, output).toContain('RESTORE=OK');
    expect(status).toBe(0);
    expect(output).toContain('carried across the import: 1 (live db 1 + ledger 1)');
  });

  it('a malformed ledger is refused before a single call reaches the database', () => {
    const bad = ledger([`not-an-id,${HEX64},2026-10-01 00:00:00`]);
    const { status, output } = run([artifact, '--ledger', bad]);

    expect(status).toBe(2);
    expect(output).toContain('RESTORE=LEDGER_MALFORMED');
    expect(output).not.toContain('RESTORE=OK');
    expect(existsSync(dockerLog), '账本坏了却已经动过库').toBe(false);

    // 正向对照：同一份夹具只把那一行换成合法的，就得走到库。没有这一半，
    // "拒绝"可能只是夹具根本没被读到的另一种形状。
    const good = ledger([row(1)]);
    const second = run([artifact, '--ledger', good]);
    expect(second.status, second.output).toBe(0);
    expect(existsSync(dockerLog)).toBe(true);
  });

  it('a hash that is not the shape the database CHECK pins is refused too', () => {
    // 63 位、大写、带分隔符都算坏形状。放宽它等于允许一份"来自别的 schema 的账本"混进闸里，
    // 而闸的唯一输入就是这张表。
    for (const badHash of ['a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(32)}-${'a'.repeat(31)}`]) {
      rmSync(dockerLog, { force: true });
      const path = join(workDir, `ledger-${badHash.length}-${badHash[0]}.csv`);
      writeFileSync(path, `1,${badHash},2026-10-01 00:00:00\n`);
      const { status, output } = run([artifact, '--ledger', path]);
      expect(status, output).toBe(2);
      expect(output).toContain('RESTORE=LEDGER_MALFORMED');
      expect(existsSync(dockerLog), `坏形状 ${badHash.slice(0, 6)}… 却动过库`).toBe(false);
    }
  });

  it('a missing ledger path is a refusal, and --ledger without a value is too', () => {
    const missing = run([artifact, '--ledger', join(workDir, 'no-such-ledger.csv')]);
    expect(missing.status).toBe(2);
    expect(missing.output).toContain('RESTORE=LEDGER_MISSING');
    expect(existsSync(dockerLog)).toBe(false);

    rmSync(dockerLog, { force: true });
    const noValue = run([artifact, '--ledger']);
    expect(noValue.status).toBe(2);
    expect(noValue.output).toContain('RESTORE=NO_LEDGER_PATH');
    expect(existsSync(dockerLog)).toBe(false);
  });

  it('an encrypted ledger decrypts with the same passphrase; the wrong one imports nothing', () => {
    const plain = join(workDir, 'ledger.csv');
    writeFileSync(plain, `${row(9)}\n`);
    const encLedger = join(workDir, 'supersync_tombstones_20261005.csv.enc');
    const enc = spawnSync(
      'openssl',
      ['enc', '-aes-256-cbc', '-salt', '-pbkdf2', '-iter', '1000000', '-pass', `file:${keyFile}`, '-in', plain, '-out', encLedger],
      { encoding: 'utf8' },
    );
    expect(enc.status, `夹具加密失败：${enc.stderr}`).toBe(0);

    const ok = run([artifact, '--ledger', encLedger]);
    expect(ok.output, ok.output).toContain('RESTORE=OK');
    expect(ok.status).toBe(0);
    expect(ok.output).toContain('Closure ledger');

    // 换一把钥匙：形状检查读到的必须是"解不开"，而不是把密文容器当成 csv 判成 malformed。
    writeFileSync(keyFile, 'not the passphrase\n');
    chmodSync(keyFile, 0o600);
    rmSync(dockerLog, { force: true });
    const badKey = run([artifact, '--ledger', encLedger]);
    expect(badKey.status).toBe(2);
    expect(badKey.output).toContain('RESTORE=LEDGER_UNDECRYPTABLE');
    expect(badKey.output).not.toContain('RESTORE=LEDGER_MALFORMED');
    expect(existsSync(dockerLog), '账本解不开却已经动过库').toBe(false);
  });

  it('zero closure knowledge is a refusal (exit 5), and the gate statements never run', () => {
    // 这就是那道洞的本体：产物里没有墓碑、活库也没带走、又没给账本。
    // 旧行为是印 `tombstones=0 removed=0` 然后 RESTORE=OK —— 一条永远不会失败的判据。
    const { status, output } = run([artifact], { FAKE_TOMBSTONE_COUNT: '0' });

    expect(status).toBe(5);
    expect(output).toContain('RESTORE=NO_CLOSURE_KNOWLEDGE');
    expect(output).toContain('NOT verified');
    expect(output).not.toContain('RESTORE=OK');
    const sqls = existsSync(dockerLog) ? callsOf(dockerLog) : [];
    expect(sqls.filter((s) => s.includes('DELETE FROM "users"'))).toEqual([]);
    expect(sqls.filter((s) => s.includes('EXISTS'))).toEqual([]);
  });

  it('HEYTA_ALLOW_EMPTY_TOMBSTONES=1 is the only way past it, and it says so in the counts', () => {
    const { status, output } = run([artifact], {
      FAKE_TOMBSTONE_COUNT: '0',
      HEYTA_ALLOW_EMPTY_TOMBSTONES: '1',
    });

    expect(output, output).toContain('RESTORE=OK');
    expect(status).toBe(0);
    expect(output).toContain('tombstones=0');
  });

  it('a count that never came back is a broken probe, not a zero', () => {
    // 和上一腿是一对：`0` 要说"我知道没有"，"没读到"要说"探针坏了"。
    // 把后者当成前者，就是 `tombstones= removed=` 那一行假绿的来源。
    const { status, output } = run([artifact], { FAKE_NO_COUNT: '1' });

    expect(status).toBe(3);
    expect(output).toContain('RESTORE=GATE_INPUT_MISSING');
    expect(output).not.toContain('RESTORE=OK');
    const sqls = existsSync(dockerLog) ? callsOf(dockerLog) : [];
    expect(sqls.filter((s) => s.includes('DELETE FROM "users"'))).toEqual([]);
  });
});

function callsOf(logPath: string): string[] {
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('CALL|'))
    .map((l) => l.slice('CALL|'.length));
}
