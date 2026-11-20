#!/usr/bin/env python3
"""AI relevance scoring — the v2 half of the hybrid filter.

Only entries that already passed the rule filter (or are still unscored) get sent
to the LLM, so a 1000-entry day costs a handful of API calls instead of 1000.

Usage:
    python ai_score.py <data_dir> <db_path> <api_key> [--limit N] [--dry-run]

Behaviour:
    - Reads `interests` + `minScore` from config.json
    - Picks entries where llm_score IS NULL, ordered by rule score desc
    - Sends them in batches, asks for a 0-100 relevance score each
    - Writes llm_score; the `filtered` view prefers llm_score over rule score
"""

import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request

API_URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"
BATCH_SIZE = 10
RULE_FLOOR = 20          # 只给规则分 >= 20 的内容花钱打分
MAX_BODY_CHARS = 400     # 喂给模型的正文字数

DEFAULT_CHANNELS = [
    "AI 工具与产品", "Agent 与工程", "模型与研究", "AI 创业与商业",
    "投融资动态", "观点与认知", "内容创作与增长", "社会与伦理", "其他",
]

PROMPT = """你是一个资讯筛选助手。用户关注的方向是：

{interests}

可选频道（给每条选一个最贴合的）：
{channels}

下面是 {n} 条资讯。请为每一条输出三样东西：

1. **score** 0-100 相关度
   - 90-100 高度相关，必须看 / 70-89 值得看 / 40-69 边缘 / 0-39 不相关
2. **tier** 内容类型，三选一
   - `practice`：实操落地 —— 有具体步骤、工具用法、上手实测、代码、可复制的做法
   - `insight`：认知洞察 —— 观点、判断、方法论、行业分析、趋势推演
   - `news`：纯资讯 —— 快讯、融资公告、人事变动、事件通报
3. **channel** 频道，从上面列表里原样选一个

严格只输出 JSON：
{{"scores": [{{"i": 0, "score": 85, "tier": "insight", "channel": "模型与研究", "why": "一句话理由"}}, ...]}}

资讯列表：
{items}"""


def load_config(data_dir):
    path = os.path.join(data_dir, "config.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def ensure_column(conn):
    for ddl in (
        "ALTER TABLE entries ADD COLUMN llm_score INTEGER",
        "ALTER TABLE entries ADD COLUMN ai_tier TEXT",
        "ALTER TABLE entries ADD COLUMN ai_channel TEXT",
    ):
        try:
            conn.execute(ddl)
        except sqlite3.OperationalError:
            pass  # already there
    conn.commit()


def pick_entries(conn, min_score, limit):
    """Entries with no LLM score yet, best rule score first."""
    rows = conn.execute(
        """SELECT id, title, summary, body, source
           FROM entries
           WHERE llm_score IS NULL
             AND COALESCE(ai_score, 0) >= ?
           ORDER BY COALESCE(ai_score, 0) DESC, published_ts DESC
           LIMIT ?""",
        (min_score, limit),
    ).fetchall()
    return rows


def build_items(rows):
    lines = []
    for i, r in enumerate(rows):
        title = (r["title"] or "").strip()
        summary = re.sub(r"<[^>]+>", " ", (r["summary"] or "")).strip()
        body = re.sub(r"<[^>]+>", " ", (r["body"] or "")).strip()[:MAX_BODY_CHARS]
        detail = summary or body
        lines.append(f"[{i}] 来源：{r['source'] or '未知'}\n    标题：{title}\n    内容：{detail}")
    return "\n".join(lines)


def call_llm(api_key, interests, rows, channels):
    prompt = PROMPT.format(
        interests=interests,
        channels="、".join(channels),
        n=len(rows),
        items=build_items(rows),
    )
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 1200,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = data["choices"][0]["message"]["content"]
    parsed = json.loads(text)
    scores = parsed.get("scores") or parsed.get("data") or []
    if not isinstance(scores, list):
        raise ValueError("模型返回格式不对")
    return scores


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "用法: ai_score.py <data_dir> <db_path> <api_key> [--limit N] [--dry-run]"}))
        sys.exit(1)

    data_dir, db_path, api_key = sys.argv[1], sys.argv[2], sys.argv[3]
    limit = 50
    dry_run = "--dry-run" in sys.argv
    if "--limit" in sys.argv:
        try:
            limit = int(sys.argv[sys.argv.index("--limit") + 1])
        except (IndexError, ValueError):
            pass

    config = load_config(data_dir)
    interests = (config.get("interests") or "").strip()
    if not interests:
        print(json.dumps({
            "ok": False,
            "error": "未配置关注方向，请先在「过滤设置」里填写 interests",
        }))
        sys.exit(0)

    min_score = int(config.get("minScore", 50))
    rule_floor = max(RULE_FLOOR, min_score - 30)
    channels = config.get("channels") or DEFAULT_CHANNELS
    if not isinstance(channels, list) or not channels:
        channels = DEFAULT_CHANNELS

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    ensure_column(conn)

    rows = pick_entries(conn, rule_floor, limit)
    if not rows:
        print(json.dumps({"ok": True, "scored": 0, "message": "没有需要打分的内容"}))
        conn.close()
        return

    if dry_run:
        print(json.dumps({
            "ok": True,
            "dry_run": True,
            "would_score": len(rows),
            "interests": interests,
            "channels": channels,
        }))
        conn.close()
        return

    scored = 0
    failed = 0
    batches = [rows[i:i + BATCH_SIZE] for i in range(0, len(rows), BATCH_SIZE)]

    for batch in batches:
        idx = {i: r for i, r in enumerate(batch)}
        try:
            scores = call_llm(api_key, interests, batch, channels)
        except Exception as exc:
            failed += len(batch)
            last_error = str(exc)[:200]
            continue

        for item in scores:
            try:
                i = int(item.get("i", -1))
                s = int(item.get("score", -1))
            except (TypeError, ValueError):
                continue
            row = idx.get(i)
            if row is None or not (0 <= s <= 100):
                continue
            tier = item.get("tier")
            if tier not in ("practice", "insight", "news"):
                tier = None
            ch = item.get("channel")
            if ch not in channels:
                ch = None
            conn.execute(
                "UPDATE entries SET llm_score = ?, ai_tier = ?, ai_channel = ? WHERE id = ?",
                (s, tier, ch, row["id"]),
            )
            scored += 1
        conn.commit()

    conn.close()

    result = {"ok": True, "scored": scored, "candidates": len(rows), "failed": failed}
    if failed and 'last_error' in dir():
        result["lastError"] = last_error
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
