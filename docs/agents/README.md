# docs/agents — 给 AI 的仓库地图（自动生成）

> 由「个人指挥中枢 / 上下文治理包」单一源工具生成，**纯新增，未改动本项目既有文件**。

- `repo-map.md`：人读版（目录/入口/枢纽文件/关键文件定义）
- `repo-map.json`：机器读版（含 tree_hash 代码指纹，供漂移检查）

## 重新生成（改了代码就重跑）

```bash
K="${CTX_KIT:-$HOME/Desktop/All in one Data/01_PROJECTS/My personal agent/上下文治理包}"
python3 "$K/bin/ctx" map --root . --out docs/agents
```

## 漂移门禁（防止"代码更新了、地图不更新"）

```bash
python3 "$K/scripts/check_drift.py" --root . --map docs/agents/repo-map.json --strict-on-stale
```

## 回退

本目录是纯新增，不想要了执行：`rm -rf docs/agents`
