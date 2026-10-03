#!/usr/bin/env node

/**
 * A1 evidence probe for vector-clock storage size.
 *
 * This is deliberately dependency-free and does not import product code: it
 * measures the JSON wire shape that the current protocol actually stores.
 * Keep the output stable so the A1 research note can be reproduced on another
 * machine without booting a server or database.
 */

const idLengths = [6, 16, 64, 255];
const entryCounts = [100, 101, 250];

const makeClock = (entryCount, idLength) => {
  const clock = {};
  for (let i = 0; i < entryCount; i += 1) {
    const ordinal = String(i).padStart(3, '0');
    const clientId = `${ordinal}${'x'.repeat(Math.max(0, idLength - ordinal.length))}`;
    clock[clientId] = 1;
  }
  return clock;
};

const rows = [];
for (const idLength of idLengths) {
  for (const entries of entryCounts) {
    const clock = makeClock(entries, idLength);
    rows.push({
      idLength,
      entries,
      jsonBytes: Buffer.byteLength(JSON.stringify(clock), 'utf8'),
    });
  }
}

process.stdout.write(`${JSON.stringify({ rows }, null, 2)}\n`);
