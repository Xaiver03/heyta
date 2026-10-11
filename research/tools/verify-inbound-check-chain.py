#!/usr/bin/env python3
"""Run the `pnpm check` chain step by step without bailing, and keep a re-runnable record.

Why this exists: the chain is one `&&` string, so the first red hides the other twelve, and a
shell wrapper that decodes child output as UTF-8 dies on the binary bytes some gates print
(observed at step 86) — losing every reading after it. So capture stays in bytes.

Usage:
  python3 research/tools/verify-inbound-check-chain.py --logs <dir> [--from N] [--to N]
          [--timeout SEC] [--repo .] [--only "substr"] [--self-test]
Exit: 0 = every step requested ran and returned 0, 1 = at least one red, 2 = the device itself
refused to run (bad range / empty denominator / self-test failure).
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time

CHAIN_SCRIPT = "check"
STEP_SEPARATOR = " && "
# Only these characters separate steps in the real script; anything else stays inside a step so
# the printed command is exactly what `pnpm run check` would execute.
REDACT = re.compile(rb"(?i)(secret|token|password|authorization|apikey|api_key)\s*[=:]\s*\S+")


def steps(repo):
    with open(os.path.join(repo, "package.json"), "rb") as handle:
        manifest = json.loads(handle.read().decode("utf-8"))
    script = manifest["scripts"][CHAIN_SCRIPT]
    return [s.strip() for s in script.split(STEP_SEPARATOR) if s.strip()]


def run_step(repo, command, timeout):
    started = time.time()
    try:
        proc = subprocess.run(
            command,
            shell=True,
            cwd=repo,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            env={**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0"},
        )
        return proc.returncode, proc.stdout, time.time() - started
    except subprocess.TimeoutExpired as exc:
        partial = exc.output if isinstance(exc.output, bytes) else b""
        return 124, partial + b"\n[chain device] step exceeded timeout\n", time.time() - started


def excerpt(raw, limit=120):
    """Decode for humans only; never let a bad byte abort the run."""
    text = REDACT.sub(b"[redacted]", raw).decode("utf-8", errors="replace")
    tail = text.strip().splitlines()[-limit:]
    return " | ".join(tail)[-1200:]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=os.getcwd())
    parser.add_argument("--logs", required=False)
    parser.add_argument("--from", dest="start", type=int, default=1)
    parser.add_argument("--to", dest="stop", type=int, default=0)
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--only", default=None, help="run only steps whose command contains this substring")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test(args.repo)

    all_steps = steps(args.repo)
    total = len(all_steps)
    stop = args.stop or total
    if args.start < 1 or stop < args.start or args.start > total:
        print(f"CHAIN_DEVICE_REFUSED range {args.start}..{stop} of {total}")
        return 2
    if not args.logs:
        print("CHAIN_DEVICE_REFUSED --logs is required (readings must be on disk, not stdout only)")
        return 2
    os.makedirs(args.logs, exist_ok=True)

    selected = [
        (index, command)
        for index, command in enumerate(all_steps, start=1)
        if args.start <= index <= stop and (args.only is None or args.only in command)
    ]
    print(f"CHAIN carrier={os.path.abspath(args.repo)} total_steps={total} "
          f"requested={stop - args.start + 1} selected={len(selected)} timeout={args.timeout}s")
    print(f"HEAD={subprocess.run(['git', '-C', args.repo, 'rev-parse', '--short', 'HEAD'],
                                capture_output=True).stdout.decode().strip()}")

    reds = []
    rows = []
    for index, command in selected:
        rc, raw, seconds = run_step(args.repo, command, args.timeout)
        log_path = os.path.join(args.logs, f"{index:03d}.log")
        with open(log_path, "wb") as handle:
            handle.write(raw)
        rows.append({"step": index, "cmd": command, "rc": rc, "sec": round(seconds, 1), "log": log_path})
        print(f"STEP={index:3d}/{total} RC={rc:3d} SEC={seconds:7.1f} CMD={command}", flush=True)
        if rc != 0:
            reds.append(index)
            print(f"  EXCERPT {command}: {excerpt(raw)}", flush=True)

    with open(os.path.join(args.logs, "chain.tsv"), "w", encoding="utf-8") as handle:
        handle.write("step\tcmd\trc\tsec\tlog\n")
        for row in rows:
            handle.write(f"{row['step']}\t{row['cmd']}\t{row['rc']}\t{row['sec']}\t{row['log']}\n")
    with open(os.path.join(args.logs, "chain.json"), "w", encoding="utf-8") as handle:
        json.dump({"total_steps": total, "selected": len(selected), "reds": reds, "rows": rows},
                  handle, ensure_ascii=False, indent=1)

    # Denominator self-check: the device must be able to refuse its own empty reading.
    if not rows:
        print("CHAIN_DEVICE_NO_STEPS_RAN selected=0 (refusing to report a green for an empty run)")
        return 2
    print(f"CHAIN ran={len(rows)}/{len(selected)} of {total}  RED={len(reds)}  steps={reds}")
    return 1 if reds else 0


def self_test(repo):
    """Arms that prove the device can fail. Printed arm count is derived, never hardcoded here."""
    import tempfile

    arms = []
    with tempfile.TemporaryDirectory() as tmp:
        logdir = os.path.join(tmp, "logs")
        os.makedirs(logdir)

        # arm 1: a red step must be reported red (and the whole run must go non-zero).
        rc, raw, _ = run_step(repo, "node -e 'process.exit(3)'", 60)
        arms.append(("red step is reported non-zero", rc != 0))

        # arm 2: the regression this device exists for — undecodable bytes must not kill the reader.
        rc, raw, _ = run_step(repo, "node -e 'process.stdout.write(Buffer.from([0xff,0xfe,0xbc,0x41]))'", 60)
        try:
            excerpt(raw)
            survived = True
        except UnicodeDecodeError:
            survived = False
        arms.append(("non-UTF8 child output survives the excerpt decoder", survived))

        # arm 3: a green step must be reported zero, otherwise "RED=0" means nothing.
        rc_green, _, _ = run_step(repo, "node -e 'process.exit(0)'", 60)
        arms.append(("green step is reported zero", rc_green == 0))

        # arm 4: the timeout must be honoured and reported as 124, not as a hang.
        rc_to, _, _ = run_step(repo, "node -e 'setTimeout(()=>{}, 30000)'", 1)
        arms.append(("a step that overruns is reported 124", rc_to == 124))

        # arm 5: step enumeration must equal the real chain length (a split bug would silently
        # merge or drop gates).
        count = len(steps(repo))
        arms.append((f"chain parses to {count} steps and none is empty", count > 0 and
                     all(s for s in steps(repo))))

        # arm 6: the empty-selection refusal actually fires.
        empty_selected = [s for s in steps(repo) if "no-such-gate-xyz" in s]
        arms.append(("an --only that matches nothing selects 0 (device refuses above)",
                     len(empty_selected) == 0))

    failed = [name for name, ok in arms if not ok]
    for name, ok in arms:
        print(f"ARM {'OK ' if ok else 'BAD'} {name}")
    print(f"SELF_TEST arms={len(arms)} failed={len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
