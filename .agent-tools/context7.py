#!/usr/bin/env python3
"""Context7 MCP 调用器（免 key，限流较低）。"""
import json, os, sys, urllib.request

ENDPOINT = "https://mcp.context7.com/mcp"
PROXY = os.environ.get("https_proxy", "http://127.0.0.1:65411")
os.environ.setdefault("https_proxy", PROXY)
os.environ.setdefault("http_proxy", PROXY)

def rpc(method: str, params: dict, rid: int = 1) -> dict:
    body = json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    })
    # urllib 走 https_proxy 环境变量
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = resp.read().decode("utf-8", "replace")
    # SSE: 取 data: 行
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("data: "):
            line = line[6:]
        if not line or not line.startswith("{"):
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        return d
    raise SystemExit("无法解析响应:\n" + raw[:800])

def call_tool(name: str, args: dict) -> str:
    d = rpc("tools/call", {"name": name, "arguments": args})
    if "error" in d:
        return "ERROR: " + json.dumps(d["error"], ensure_ascii=False)
    content = d.get("result", {}).get("content")
    if isinstance(content, list):
        return "\n".join(i.get("text", "") for i in content if i.get("type") == "text")
    return json.dumps(d.get("result"), ensure_ascii=False, indent=2)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "search" and len(sys.argv) >= 3:
        print(call_tool("resolve-library-id", {"libraryName": sys.argv[2], "query": sys.argv[2]}))
    elif cmd == "docs" and len(sys.argv) >= 4:
        print(call_tool("query-docs", {"libraryId": sys.argv[2], "query": sys.argv[3]}))
    else:
        print('用法: call.py search "<库名>" | call.py docs <库ID> "<问题>"')
