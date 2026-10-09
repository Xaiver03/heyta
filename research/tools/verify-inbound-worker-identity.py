#!/usr/bin/env python3
"""Run inbound identity HTTP tests in a disposable, loopback-only PostgreSQL.

This tests the actual migration SQL and application code, not the Linux
production deployment/recovery script. It never reads a production DB URL.
"""
import argparse
import getpass
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
from urllib.parse import quote


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', help='Directory containing initdb/pg_ctl/psql/createdb')
    parser.add_argument('--log', default='/tmp/heyta-inbound-worker-identity.log')
    args = parser.parse_args()
    found = shutil.which('initdb')
    if not args.pg_bin and not found:
        parser.error('PostgreSQL tools not on PATH; provide --pg-bin')
    pg = Path(args.pg_bin or str(Path(found).parent))
    root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    with tempfile.TemporaryDirectory(prefix='heyta-inbound-pg-') as temporary:
        base = Path(temporary)
        data = base / 'data'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        env['DATABASE_URL'] = f'postgresql://{quote(getpass.getuser())}@127.0.0.1:{port}/heyta_inbound'
        with open(args.log, 'w') as log:
            def run(command, cwd=None):
                subprocess.run(command, cwd=cwd, env=env, stdout=log,
                               stderr=subprocess.STDOUT, check=True)
            started = False
            try:
                run([str(pg / 'initdb'), '-D', str(data), '-A', 'trust', '--no-locale', '--encoding=UTF8'])
                run([str(pg / 'pg_ctl'), '-D', str(data), '-l', str(base / 'postgres.log'),
                     '-o', f'-h 127.0.0.1 -p {port} -k {base} -c shared_buffers=16MB -c work_mem=1MB -c maintenance_work_mem=16MB -c max_connections=32', '-w', 'start'])
                started = True
                run([str(pg / 'createdb'), '-h', '127.0.0.1', '-p', str(port), 'heyta_inbound'])
                for migration in sorted((root / 'server/prisma/migrations').glob('*/migration.sql')):
                    sql = migration.read_text()
                    # Keep SET LOCAL and its DDL in one transaction. Concurrent
                    # indexes require separate statements outside a transaction.
                    transaction = [] if 'CONCURRENTLY' in sql.upper() else ['--single-transaction']
                    run([str(pg / 'psql'), env['DATABASE_URL'], '-v', 'ON_ERROR_STOP=1', *transaction, '-f', str(migration)])
                run(['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts',
                     '--maxWorkers=1', 'tests/integration/inbound-worker-identity.integration.spec.ts'], root / 'server')
            finally:
                if started:
                    run([str(pg / 'pg_ctl'), '-D', str(data), '-m', 'fast', '-w', 'stop'])
                server_log = base / 'postgres.log'
                if server_log.exists():
                    log.write('\n--- Disposable PostgreSQL server log ---\n' + server_log.read_text())
    print(f'Results: {Path(args.log).resolve()}')


if __name__ == '__main__':
    main()
