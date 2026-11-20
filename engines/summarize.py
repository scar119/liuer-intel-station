#!/usr/bin/env python3
"""AI 摘要引擎 - 调用 DeepSeek API 为单篇文章生成摘要"""
import sys
import json
import sqlite3
import urllib.request
import urllib.error

API_URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"
MAX_TOKENS = 500

PROMPT_TEMPLATE = """请为以下文章生成一段 150 字以内的中文摘要，突出核心信息和关键观点：

标题：{title}
来源：{source}
正文：
{content}

摘要："""


def get_article(db_path, article_id):
    """从数据库读取文章内容"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        "SELECT title, source, summary, body FROM entries WHERE id = ?",
        (article_id,)
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "title": row["title"] or "",
        "source": row["source"] or "",
        "summary": row["summary"] or "",
        "body": row["body"] or "",
    }


def summarize(api_key, title, source, content):
    """调用 DeepSeek API 生成摘要"""
    # 内容截断到 2000 字（节省 token）
    if len(content) > 2000:
        content = content[:2000] + "..."

    prompt = PROMPT_TEMPLATE.format(
        title=title,
        source=source,
        content=content
    )

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": MAX_TOKENS,
        "temperature": 0.3,
    }

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        raise Exception(f"API 错误 {e.code}: {error_body}")
    except Exception as e:
        raise Exception(f"请求失败: {e}")


def save_summary(db_path, article_id, summary):
    """保存摘要到数据库"""
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    # 添加 ai_summary 列（如果不存在）
    try:
        cur.execute("ALTER TABLE entries ADD COLUMN ai_summary TEXT")
    except sqlite3.OperationalError:
        pass  # 列已存在
    cur.execute(
        "UPDATE entries SET ai_summary = ? WHERE id = ?",
        (summary, article_id)
    )
    conn.commit()
    conn.close()


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "用法: summarize.py <db_path> <article_id> <api_key>"}))
        sys.exit(1)

    db_path = sys.argv[1]
    article_id = sys.argv[2]
    api_key = sys.argv[3]

    # 读取文章
    article = get_article(db_path, article_id)
    if not article:
        print(json.dumps({"error": "文章不存在"}))
        sys.exit(1)

    # 内容优先用 body，其次 summary
    content = article["body"] or article["summary"]
    if not content:
        print(json.dumps({"error": "文章内容为空"}))
        sys.exit(1)

    # 生成摘要
    try:
        summary = summarize(
            api_key,
            article["title"],
            article["source"],
            content
        )
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    # 保存到数据库
    save_summary(db_path, article_id, summary)

    print(json.dumps({"ok": True, "summary": summary}))


if __name__ == "__main__":
    main()