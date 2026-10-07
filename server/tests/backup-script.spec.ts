import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
// HEYTA_BACKUP_SCRIPT 只决定**执行哪一份脚本**（变异臂要跑逐字相同的逻辑，但输入是被改过的那份拷贝）。
// 默认值逐字等于原来的写法；它不参与任何断言，所以拿它做变异取证不会把判据本身放宽。
const BACKUP_SCRIPT = process.env.HEYTA_BACKUP_SCRIPT ?? join(currentDir, '../scripts/backup.sh');

// pg_dump runs inside the container via `docker exec … pg_dump [args]`, so faking the
// docker binary on PATH fakes the dump. The accounts dump is the invocation carrying
// --table flags; the full dump carries none. A non-zero FAKE_FULL_DUMP_EXIT reproduces
// the #9836 failure shape: partial output already written, then the server dies —
// gzip still finalizes a VALID archive, so only the script's own handling can prevent
// a plausible-looking truncated backup.
// 夹具是一份**真 shell 文件**（tests/fixtures/fake-docker-backup.sh），不是模板字符串里的 shell：
// 模板会吃掉反斜杠、会被反引号截断，两种坏法的症状都是整族集体红或集体静默读空。
const FAKE_DOCKER_FILE = join(currentDir, 'fixtures/fake-docker-backup.sh');
const FAKE_DOCKER = readFileSync(FAKE_DOCKER_FILE, 'utf8');
/**
 * 加密是**默认路径**（ADR-0055 §5 第 2 块板的裁决），所以这一组用例的主角从"产物存不存在"
 * 换成了三件事，每一件都是原脚本没有判据覆盖的：
 *
 * 1. **口令的形状** —— 读不到 / 组其他位有权限 / 与产物同目录，各自都必须在**第一次 dump 之前**
 *    拒掉，且 `BACKUP_DIR` 里**一个文件都不许留下**。"先写明文再补加密"是最坏的形状：它把
 *    敞口留在了磁盘上，而症状与成功完全一样。
 * 2. **改名之后清扫还认不认** —— 产物后缀从 `.sql.gz` 变成 `.sql.gz.enc`，而留存清扫按
 *    `-name` 匹配。扫不到新后缀 ⇒ 旧密文永不过期 ⇒ 法务那句"14 天内的备份副本"当场变假，
 *    而当晚的日志看起来完全正常（新产物确实生成了）。这一条是本轮真正的判据增量。
 * 3. **密文真的能还原** —— 只验"文件不是明文"会放过一种坏法：加密参数写错、产物再也解不开。
 *    所以有一腿用同一份口令真解回来并比对内容。
 *
 * 🔴 这里用**真 openssl**，不用假的：假的只能证明管道形状，证明不了"这份密文可恢复"。
 */

/** 假 docker 记下的调用串（`--table=` 那一条就是账号面产物）。 */
const dumpCalls = (logPath: string): string[] => {
  try {
    return readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('CALL|'))
      .map((l) => l.slice('CALL|'.length));
  } catch {
    return [];
  }
};

describe('backup.sh', () => {
  let workDir: string;
  let backupDir: string;
  let keyDir: string;
  let keyFile: string;

  const run = (env: Record<string, string> = {}) => {
    const binDir = join(workDir, 'bin');
    return spawnSync('bash', [BACKUP_SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        BACKUP_DIR: backupDir,
        BACKUP_ENCRYPTION_PASSPHRASE_FILE: keyFile,
        ...env,
      },
    });
  };

  const backupFiles = (): string[] =>
    existsSync(backupDir)
      ? readdirSync(backupDir).sort()
      : [];

  /**
   * 只算 backup.sh 自己产出的东西。
   * 🔴 拒绝分支那条"什么都没写"的判据不能用 readdir 的全集：KEY_COLOCATED 那一档里，
   *    运维自己放进 BACKUP_DIR 的口令文件本来就在里面，把它算成产物会让"什么都没留下"这条
   *    永远读非空 —— 而它恰恰是这一族最要紧的那一条。
   */
  const producedFiles = (): string[] => backupFiles().filter((f) => f.startsWith('supersync_'));

  /** 整库那一份的名字（账号面和账本都不算）。 */
  const fullName = (files: string[]): string | undefined =>
    files.find((f) => /^supersync_\d{8}_\d{6}\.sql\.gz(\.enc)?$/.test(f));

  /** 账本那一份的名字。 */
  const ledgerName = (files: string[]): string | undefined =>
    files.find((f) => /^supersync_tombstones_\d{8}_\d{6}\.csv(\.enc)?$/.test(f));

  /** 用同一份口令把产物解回明文（真 openssl，证明"可恢复"而不只是"不像明文"）。 */
  const decrypt = (file: string): string => {
    const out = join(workDir, 'decrypted.bin');
    const r = spawnSync(
      'openssl',
      ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '1000000', '-pass', `file:${keyFile}`, '-in', file, '-out', out],
      { encoding: 'utf8' },
    );
    expect(r.status, `openssl 解密失败：${r.stderr}`).toBe(0);
    const gun = spawnSync('gunzip', ['-c', out], { encoding: 'utf8' });
    expect(gun.status, `gunzip 失败：${gun.stderr}`).toBe(0);
    return gun.stdout;
  };

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'backup-spec-'));
    backupDir = join(workDir, 'backups');
    const binDir = join(workDir, 'bin');
    mkdirSync(binDir);
    const fakeDocker = join(binDir, 'docker');
    writeFileSync(fakeDocker, FAKE_DOCKER);
    chmodSync(fakeDocker, 0o755);
    // 口令放在 BACKUP_DIR **之外**，这正是脚本要求的形状；同目录那一档另有专门的用例。
    keyDir = join(workDir, 'keys');
    mkdirSync(keyDir);
    keyFile = join(keyDir, 'backup_passphrase');
    writeFileSync(keyFile, 'correct horse battery staple\n');
    chmodSync(keyFile, 0o600);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('openssl 必须在位 —— 默认加密的判据不许因为缺工具而静默跳过', () => {
    const probe = spawnSync('openssl', ['version'], { encoding: 'utf8' });
    expect(probe.status, 'openssl 不可用：这一组用例的"真加密"断言无法成立，必须响亮失败而不是跳过').toBe(0);
    expect(probe.stdout.trim()).toContain('OpenSSL');
  });

  it('writes the two dumps plus the closure ledger, leaves no temp files, keeps them private', () => {
    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const files = backupFiles();
    expect(files).toHaveLength(3);
    expect(files.some((f) => /^supersync_\d{8}_\d{6}\.sql\.gz\.enc$/.test(f))).toBe(true);
    expect(files.some((f) => /^supersync_accounts_\d{8}_\d{6}\.sql\.gz\.enc$/.test(f))).toBe(true);
    // 🔴 第三份产物是注销账本（supersync_tombstones_*.csv.enc）。它存在不是锦上添花：整库恢复会先
    //    `DROP SCHEMA`，把 account_tombstones 一起回滚成快照当时的状态，于是"恢复时不许复活已注销账号"
    //    那道闸在**真会发生复活的那条路上**读不到任何输入。这份离库的账本就是它的输入。
    const ledger = files.find((f) => /^supersync_tombstones_\d{8}_\d{6}\.csv\.enc$/.test(f));
    expect(ledger, `没有产出注销账本：${files.join(', ')}`).toBeTruthy();
    const ledgerPlain = join(workDir, 'ledger-decrypted.csv');
    const dec = spawnSync(
      'openssl',
      ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '1000000', '-pass', `file:${keyFile}`, '-in', join(backupDir, ledger!), '-out', ledgerPlain],
      { encoding: 'utf8' },
    );
    expect(dec.status, `账本解不开：${dec.stderr}`).toBe(0);
    // 假 docker 给 COPY ... TO STDOUT 的那一行就是账本的内容 —— 钉住"账本里真的是墓碑，不是空文件"。
    expect(readFileSync(ledgerPlain, 'utf8')).toContain('7,');
    for (const f of files) {
      // umask 077: dumps carry password hashes and passkey credentials.
      expect(statSync(join(backupDir, f)).mode & 0o777).toBe(0o600);
    }
  });

  it('leaves NO full-dump file when pg_dump dies mid-stream, but keeps the accounts dump', () => {
    const result = run({ FAKE_FULL_DUMP_EXIT: '1' });

    expect(result.status).not.toBe(0);
    const files = producedFiles();
    // The truncated-but-valid-gzip artifact must not exist under any name — final or temp.
    // 🔴 认**名字形状**而不是"不带 accounts 的那个"：账本 `supersync_tombstones_*` 同样不带 accounts，
    //    用后者判就等于把第三份产物当成失败的那一份。
    expect(fullName(files), `整库那份还在盘上：${files.join(', ')}`).toBeUndefined();
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    // The accounts dump runs FIRST precisely so a crash during the long full dump
    // cannot take the disaster-recovery artifact with it.
    expect(files.filter((f) => f.includes('accounts'))).toHaveLength(1);
    // 账本跑在两份 dump **之前**：它是那道闸唯一的输入，不能让一份坏掉的 dump 把它一起带走。
    expect(ledgerName(files), `pg_dump 失败时账本没落盘：${files.join(', ')}`).toBeTruthy();
    expect(files.every((f) => f.includes('accounts') || f.includes('tombstones'))).toBe(true);
  });

  it('sweeps stale .tmp partials but never a recent one (possibly a live dump)', () => {
    mkdirSync(backupDir, { recursive: true });
    const stale = join(backupDir, 'supersync_20200101_000000.sql.gz.enc.tmp');
    writeFileSync(stale, 'orphan from a SIGKILLed run');
    const staleTime = (Date.now() - 7 * 60 * 60 * 1000) / 1000;
    utimesSync(stale, staleTime, staleTime);
    const fresh = join(backupDir, 'supersync_20200101_000001.sql.gz.tmp');
    writeFileSync(fresh, 'in-flight dump of a concurrent run');

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const tmpFiles = backupFiles().filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles).toEqual(['supersync_20200101_000001.sql.gz.tmp']);
  });

  it('the accounts artifact carries the closure tombstones the restore gate reads', () => {
    const logPath = join(workDir, 'dump-calls.log');
    const result = run({ FAKE_DOCKER_LOG: logPath });

    expect(result.status, result.stderr).toBe(0);
    const accountsCall = dumpCalls(logPath).find((c) => c.includes('--table='));
    // 🔴 少了 account_tombstones 不是"少一张表"，是**恢复闸在账号面恢复时没有判据可读**：
    // restore.sh 会在新库里找不到这张表而以 NO_TOMBSTONE_TABLE 拒绝（那是响亮的一半），
    // 而"表存在但是空的"这一半会静默通过 —— 所以这张表必须跟着账号面产物走。
    expect(accountsCall).toBeDefined();
    expect(accountsCall).toContain('--table=account_tombstones');
    expect(accountsCall).toContain('--table=users');
    expect(accountsCall).toContain('--table=passkeys');
  });

  it('no account_tombstones table in the live db: the run refuses instead of shipping a backup with no gate input', () => {
    // 🔴 这一条在夹具改造之前**结构上不可达**：假 docker 没有表检查那一臂，兜底分支给它回了
    //    "partial full dump data" —— 非空，于是"这张表在"是任何一次输出的副产品。
    //    现在的夹具让"读不到"成为可表达的状态，这条拒处才第一次能被问出来。
    //    为什么它是拒绝而不是"照样备份、账本留空"：一份**没有注销知识**的备份，恢复时那道闸
    //    只能要么假通过、要么把整次恢复停住（restore.sh 选的是后者，RESTORE=NO_CLOSURE_KNOWLEDGE）。
    //    与其产出一份注定恢复不了的产物，不如在备份当晚就响亮失败。
    const result = run({ FAKE_NO_TOMBSTONE_TABLE: '1' });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('BACKUP=NO_TOMBSTONE_TABLE');
    expect(producedFiles(), `没有墓碑表却写出了产物：${backupFiles().join(', ')}`).toEqual([]);
  });

  it('the closure ledger carries one row per tombstone, not just an empty file', () => {
    const empty = run({ FAKE_LEDGER_ROWS: '' });
    expect(empty.status, empty.stderr).toBe(0);
    const left = producedFiles();
    const name = ledgerName(left);
    expect(name, `没有产出账本：${left.join(', ')}`).toBeTruthy();
    // 空表 = 这套部署目前确实没人注销过。产物照样要有（恢复侧要能读到"我知道，是 0 行"），
    // 而那一枚 rows= 读数必须打的是 0，不是空串。
    expect(empty.stdout).toMatch(/Closure ledger: .* rows=0/);
    // 解回明文必须是**零行**（`.enc` 本身不是 0 字节 —— openssl 的容器头总要在）。
    const emptyPlain = join(workDir, 'ledger-empty.csv');
    const decEmpty = spawnSync(
      'openssl',
      ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '1000000', '-pass', `file:${keyFile}`, '-in', join(backupDir, name!), '-out', emptyPlain],
      { encoding: 'utf8' },
    );
    expect(decEmpty.status, decEmpty.stderr).toBe(0);
    expect(readFileSync(emptyPlain, 'utf8')).toBe('');

    const one = run({ FAKE_LEDGER_ROWS: '9,ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff,2026-10-02 03:04:05' });
    expect(one.status, one.stderr).toBe(0);
    expect(one.stdout).toMatch(/Closure ledger: .* rows=1/);
  });

  // ── 默认加密 ─────────────────────────────────────────────────────────

  //
  // 🔴 下面每条都要求"拒绝时 BACKUP_DIR 里什么都不留下"。只断言退出码的用例挡不住
  // "先落明文、再报错"这一种实现 —— 而那恰好是最坏的一种。

  it('the default artifact is real ciphertext, and the same passphrase reads it back', () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);

    const full = fullName(producedFiles());
    expect(full, `没找到整库那份：${backupFiles().join(', ')}`).toBeDefined();
    const bytes = readFileSync(join(backupDir, full!));
    // openssl 的 salted 容器魔数：证明真跑过加密，而不是"名字带 .enc 的明文"。
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('Salted__');
    expect(bytes.subarray(0, 2).toString('latin1')).not.toBe('\x1f\x8b');
    // 可恢复那一腿：内容能原样解回来。
    expect(decrypt(join(backupDir, full!))).toContain('partial full dump data');
  });

  it('no plaintext artifact exists at any point, not even a leftover .sql.gz', () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    const plain = backupFiles().filter((f) => f.endsWith('.sql.gz') || f.endsWith('.sql.gz.tmp'));
    expect(plain, `盘上留下了未加密的产物：${plain.join(', ')}`).toEqual([]);
  });

  it('missing passphrase file: refuses loudly and writes NOTHING', () => {
    const result = run({ BACKUP_ENCRYPTION_PASSPHRASE_FILE: join(workDir, 'nope') });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('BACKUP=NO_KEY');
    // 关键那一腿：**没有产物**。只查退出码会放过"先写明文再报错"。
    expect(backupFiles()).toEqual([]);
  });

  it('a passphrase anyone but the owner can read is refused: the key must not be shareable', () => {
    chmodSync(keyFile, 0o644);

    const result = run();

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('BACKUP=KEY_PERMS');
    expect(backupFiles()).toEqual([]);
  });

  it('a key that is owner-only but not mode 600 (0400) still passes — the criterion is the bits, not the string', () => {
    chmodSync(keyFile, 0o400);

    const result = run();

    expect(result.stdout + result.stderr).not.toContain('BACKUP=KEY_PERMS');
    expect(result.status, result.stderr).toBe(0);
    expect(backupFiles().filter((f) => f.includes('accounts'))).toHaveLength(1);
  });

  it('a key stored inside BACKUP_DIR is refused: backing up the backups must not ship the key', () => {
    mkdirSync(backupDir, { recursive: true });
    const colocated = join(backupDir, 'passphrase');
    writeFileSync(colocated, 'same place as the artifacts\n');
    chmodSync(colocated, 0o600);

    const result = run({ BACKUP_ENCRYPTION_PASSPHRASE_FILE: colocated });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('BACKUP=KEY_COLOCATED');
    // 排除运维自己放进去的那一枚口令本身（它在这儿正是这一档的前提）。
    expect(producedFiles(), `拒绝分支写出了产物：${backupFiles().join(', ')}`).toEqual([]);
  });

  it('plaintext only on explicit opt-out, and the run says so out loud', () => {
    const result = run({ BACKUP_ALLOW_PLAINTEXT: '1' });

    expect(result.status, result.stderr).toBe(0);
    const files = producedFiles();
    // 🔴 三份都要在，且**一份 .enc 都不许有**：账本跟着同一个开关走，否则"这套部署不落密文"
    //    这句话只对两份 dump 成立，而运维照字面理解时会去找一把根本不存在的钥匙。
    expect(files.some((f) => f.endsWith('.sql.gz'))).toBe(true);
    expect(files.filter((f) => f.endsWith('.sql.gz'))).toHaveLength(2);
    expect(files.filter((f) => f.endsWith('.csv'))).toHaveLength(1);
    expect(files.filter((f) => f.endsWith('.enc'))).toEqual([]);
    expect(result.stdout).toContain('BACKUP_ALLOW_PLAINTEXT=1');
    expect(result.stdout).toContain('UNENCRYPTED');
  });

  // ── 后缀换了，清扫必须跟着换 ─────────────────────────────────────────
  //
  // 🔴 这是本轮最容易静默坏掉的一条：产物改名后，`find -name "supersync_*.sql.gz"` 不再匹配
  // `.sql.gz.enc`，于是**旧密文永不过期**。当晚一切"看起来正常"（新产物生成、删除计数是个数字），
  // 而对外承诺的 14 天窗口实际变成了"全部历史"。这条用例就是把它照出来。

  it('retention sweeps the ENCRYPTED names, not only the old plaintext ones', () => {
    mkdirSync(backupDir, { recursive: true });
    const oldEnc = join(backupDir, 'supersync_20200101_000000.sql.gz.enc');
    const oldAccountsEnc = join(backupDir, 'supersync_accounts_20200101_000001.sql.gz.enc');
    const oldPlain = join(backupDir, 'supersync_20200101_000002.sql.gz');
    const oldAccountsPlain = join(backupDir, 'supersync_accounts_20200101_000003.sql.gz');
    const oldLedgerEnc = join(backupDir, 'supersync_tombstones_20200101_000004.csv.enc');
    const stale = [oldEnc, oldAccountsEnc, oldPlain, oldAccountsPlain, oldLedgerEnc];
    for (const f of stale) writeFileSync(f, 'x');
    const longAgo = (Date.now() - 30 * 86_400_000) / 1000;
    for (const f of stale) utimesSync(f, longAgo, longAgo);

    const result = run();
    expect(result.status, result.stderr).toBe(0);

    const left = backupFiles();
    for (const staleName of [
      'supersync_20200101_000000.sql.gz.enc',
      'supersync_accounts_20200101_000001.sql.gz.enc',
      'supersync_20200101_000002.sql.gz',
      'supersync_accounts_20200101_000003.sql.gz',
      // 账本也要过窗：漏了它，法务那句"14 天内的备份副本"对这份**离库的注销记录**就是假话。
      'supersync_tombstones_20200101_000004.csv.enc',
    ]) {
      expect(left, `过期产物没被清扫：${staleName}`).not.toContain(staleName);
    }
    // 正向对照腿：当晚新写的三份产物必须**还在** —— 否则"全扫掉了"也会显得像过。
    expect(left).toHaveLength(3);
    expect(left.every((f) => f.endsWith('.sql.gz.enc') || f.endsWith('.csv.enc'))).toBe(true);
    for (const kept of left) expect(kept).not.toMatch(/_2020/);
  });

  it('a fresh encrypted artifact is NOT swept (the window is what expires, not the name)', () => {
    mkdirSync(backupDir, { recursive: true });
    const freshEnc = join(backupDir, 'supersync_20991231_235959.sql.gz.enc');
    writeFileSync(freshEnc, 'x');

    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(backupFiles()).toContain('supersync_20991231_235959.sql.gz.enc');
  });
});
