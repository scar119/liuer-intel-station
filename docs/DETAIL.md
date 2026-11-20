# 六耳 AI资讯情报站

本地 RSS 阅读器，三栏布局，全文搜索，来源健康度，OPML 导入。

## 功能

- **三栏阅读器**：侧栏（频道/来源）→ 列表（卡片流）→ 阅读器（正文 + AI 总结）
- **全文搜索**：SQLite FTS5 trigram，中文子串可搜，含正文前 600 字
- **来源健康度**：自动检测停更、灌水、低频源
- **周回顾**：产量趋势、最活跃来源
- **订阅管理**：单条添加 / 批量粘贴 / OPML 导入
- **内置 RSS 抓取**：不依赖外部流水线，插件自己抓
- **AI 摘要**（可选）：配置 DeepSeek API key 后自动生成

## 快速开始

1. 安装后重启 DSH，侧栏出现「情报站」图标
2. 点进去 → 「订阅管理」→ 添加你的 RSS 源
3. 点「立即抓取」或等自动抓取
4. 回到精选/未读视图开始阅读

## 数据存储

所有数据存在 `~/.liuer-intel-station/`：
- `intel.db` — SQLite 数据库（条目 + FTS 索引）
- `feeds.json` — 订阅源列表
- `config.json` — 用户配置（API key 等）

## 键盘快捷键

| 键 | 功能 |
|---|---|
| j/k | 下/上一篇 |
| Shift+j/k | 跳过已读 |
| m | 切换已读 |
| s | 切换收藏 |
| o / Enter | 打开原文 |
| / | 搜索 |
| Esc | 退出搜索 |

## 配置

在 DSH 插件设置里可以配置：
- `dataDir`：数据目录（默认 `~/.liuer-intel-station`）
- `pythonPath`：Python 路径（默认 `python3`）
- `deepseekApiKey`：DeepSeek API key（可选，用于 AI 摘要）
