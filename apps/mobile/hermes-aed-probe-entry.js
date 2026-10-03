/*
 * Standalone Android/Hermes probe for the A/D evidence pass.
 *
 * This file is deliberately separate from apps/mobile/index.js.  The probe is
 * bundled into a temporary release APK by scripts/verify-mobile-aed.sh and
 * exercises the same op-sqlite driver used by the mobile host, without
 * changing the production entry point.
 */
import 'react-native-get-random-values';
import 'fast-text-encoding';

import React, { useEffect, useState } from 'react';
import { AppRegistry, Text, View } from 'react-native';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { OpLogEngine } from '@heyta/op-log';
import { OpType, limitVectorClockSize } from '@heyta/sync-core';
import { OpSqliteDriver } from './src/db/op-sqlite-driver';

const COMPONENT_NAME = 'heyta';
const DIMENSION_COUNT = 101;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function makeRemoteOps() {
  return Array.from({ length: DIMENSION_COUNT }, (_, index) => {
    const n = index + 1;
    const clientId = `hermes-peer-${String(n).padStart(3, '0')}`;
    return {
      id: `hermes-peer-op-${String(n).padStart(3, '0')}`,
      clientId,
      entityType: 'TASK',
      entityId: `hermes-task-${String(n).padStart(3, '0')}`,
      vectorClock: { [clientId]: 1 },
      timestamp: n,
      opType: OpType.Create,
      actionType: 'CRT_TASK',
      schemaVersion: 1,
      payload: { title: `Hermes probe task ${n}` },
    };
  });
}

async function runProbe() {
  const dbName = `heyta-hermes-aed-${Date.now()}`;
  const hasHermesInternal = typeof HermesInternal !== 'undefined';
  check(hasHermesInternal, 'HermesInternal is unavailable; this is not a Hermes runtime');
  console.log(`PROBE_START db=${dbName} hermes=${hasHermesInternal}`);

  const makeDb = () => new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new OpSqliteDriver({ name: dbName }),
  });
  const firstDb = makeDb();
  await firstDb.init();
  const firstStore = new DbOpLogStore(firstDb, 0);
  let nextId = 0;
  const first = new OpLogEngine({
    store: firstStore,
    clientId: 'hermes-target',
    now: () => 1000,
    nextOpId: () => `hermes-local-${++nextId}`,
  });

  const remote = await first.applyRemote(makeRemoteOps());
  const firstClock = first.getClock();
  const firstClockSize = Object.keys(firstClock).length;
  check(remote.applied.length === DIMENSION_COUNT, `remote applied=${remote.applied.length}`);
  check(firstClockSize === DIMENSION_COUNT, `clock dimensions=${firstClockSize}`);
  for (let index = 1; index <= DIMENSION_COUNT; index += 1) {
    check(firstClock[`hermes-peer-${String(index).padStart(3, '0')}`] === 1, `missing peer clock ${index}`);
  }
  console.log(`PROBE_CLOCK_BEFORE_RESTART dimensions=${firstClockSize}`);

  await first.checkpoint();
  const checkpoint = await firstStore.readCheckpoint();
  check(checkpoint?.coveredSeq === DIMENSION_COUNT, `checkpoint covered=${checkpoint?.coveredSeq}`);
  console.log(`PROBE_CHECKPOINT coveredSeq=${checkpoint.coveredSeq}`);

  await first.dispatch({
    entityType: 'TASK',
    entityId: 'hermes-tail-task',
    opType: OpType.Create,
    payload: { title: 'checkpoint tail' },
  });
  const expectedState = JSON.stringify(first.getState());
  firstDb.close();
  console.log('PROBE_DB_CLOSED');

  const secondDb = makeDb();
  await secondDb.init();
  const secondStore = new DbOpLogStore(secondDb, 0);
  const second = new OpLogEngine({
    store: secondStore,
    clientId: 'hermes-target',
    nextOpId: () => `hermes-restarted-${++nextId}`,
  });
  const recovery = await second.recover();
  const secondClock = second.getClock();
  const secondClockSize = Object.keys(secondClock).length;
  check(secondClockSize === DIMENSION_COUNT + 1, `restarted clock dimensions=${secondClockSize}`);
  for (let index = 1; index <= DIMENSION_COUNT; index += 1) {
    check(secondClock[`hermes-peer-${String(index).padStart(3, '0')}`] === 1, `lost peer clock ${index}`);
  }
  check(second.getState().tasks['hermes-tail-task']?.title === 'checkpoint tail', 'checkpoint tail missing');
  check(JSON.stringify(second.getState()) === expectedState, 'restarted state differs');
  check(recovery.replayed === 1, `incremental replayed=${recovery.replayed}`);
  console.log(`PROBE_RESTART_OK preservedDimensions=${DIMENSION_COUNT} dimensions=${secondClockSize} replayed=${recovery.replayed}`);
  secondDb.close();

  // Exercise the legacy limiter only to prove that its danger signal reaches
  // a real Hermes process. Production writes no longer call this lossy helper.
  const legacyClock = Object.fromEntries(
    Array.from({ length: DIMENSION_COUNT + 1 }, (_, index) => [`legacy-${index}`, 1]),
  );
  const limited = limitVectorClockSize(legacyClock, ['legacy-0']);
  check(Object.keys(limited).length === 100, `legacy limited size=${Object.keys(limited).length}`);
  console.warn(`PROBE_LEGACY_LIMIT_WARNING_OBSERVED input=${Object.keys(legacyClock).length} output=${Object.keys(limited).length}`);
  console.log('PROBE_PASS');
}

function Probe() {
  const [status, setStatus] = useState('running');
  useEffect(() => {
    runProbe().then(() => setStatus('PASS')).catch((error) => {
      console.error('PROBE_FAIL', error?.stack ?? String(error));
      setStatus(`FAIL: ${error?.message ?? String(error)}`);
    });
  }, []);
  return React.createElement(View, { style: { flex: 1, padding: 24, justifyContent: 'center' } },
    React.createElement(Text, { style: { fontSize: 18 } }, `heyta A/D Hermes probe: ${status}`),
  );
}

AppRegistry.registerComponent(COMPONENT_NAME, () => Probe);
