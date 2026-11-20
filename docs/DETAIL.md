# 六耳 AI资讯情报站

把 RSS 订阅变成每天 5 分钟扫完的面板。本地运行，自带抓取引擎，两级内容筛选。

## 它解决什么问题

订阅了 100 个源，每天进来 500 条，但真正想看的只有 10 条。这个插件做三件事：

1. **汇总** —— 所有 RSS 收进一个三栏面板
2. **筛选** —— 关键词规则 + AI 语义打分，从 500 条里筛出那 10 条
3. **阅读** —— 全文搜索、已读收藏、来源健康度

## 功能

### 阅读

- **三栏布局**：侧栏导航 → 卡片时间线 → 正文阅读，桌面移动都适配
- **七个视图**：精选 / 未读 / 实操落地 / 认知洞察 / 近期 / 收藏 / 全部
- **AI 自动分级**：每篇内容自动打上类型（实操/洞察/资讯）和频道，侧栏按此分组
- **全文搜索**：SQLite FTS5 trigram，中文子串可搜，索引正文前 600 字
- **键盘操作**：`j/k` 翻页、`m` 已读、`s` 收藏、`/` 搜索

### 订阅管理

三种添加方式，都支持自动去重和标题探测：

| 方式 | 说明 |
|---|---|
| 单条添加 | 粘贴一个 RSS 地址 |
| 批量粘贴 | 多行，每行一个 |
| OPML 导入 | 从 Feedly / Inoreader 迁移 |

### 内容筛选（两级）

**第一级：关键词规则**（免费，即时）

标题命中 +40 / 摘要 +20 / 正文 +10，排除词 −100。改规则不用重新抓取，因为抓取是全量保存、筛选在展示层。

**第二级：AI 语义打分 + 自动分级**（可选，需 API key）

用一段话描述你关注什么，AI 给每篇打 0-100 分。只给规则已经筛过的内容打分，所以成本极低 —— 1000 条的资讯日通常只需几十次调用的量。

同一次调用还返回**内容类型**（实操落地 / 认知洞察 / 纯资讯）和**所属频道**，侧栏据此生成分级视图和频道分组。频道列表可在配置里改成你自己行业的分类。

AI 分覆盖规则分；没打过 AI 分的仍用规则分兜底。

### 运维

- **来源健康度**：自动标出停更 / 低频 / 灌水的源
- **周回顾**：产量趋势 + 最活跃来源
- **定时抓取**：附 `install-schedule.sh`，macOS launchd / Linux cron 自动判断

### AI 摘要（可选）

任意文章点「生成 AI 总结」，DeepSeek 生成 150 字中文摘要。

## 安装

```bash
dsh plugin --profile web add github:scar119/liuer-intel-station
```

或在 DSH 界面里：插件 → 从 URL 安装 → 粘贴仓库地址。

### 装完如果侧栏没出现，重启 DSH

多数情况装完就生效。侧栏没有「情报站」图标时，重启一次 DSH（新安装的 JS 模块需重新加载）。

之后的版本更新不用重启：禁用再启用插件即可，HTTP 路由会正确注销和重新注册。

## 首次使用

1. 侧栏点「情报站」
2. 「＋ 订阅管理」→ 粘贴 RSS 地址 / 导入 OPML
3. 点「立即抓取」
4. （可选）「⚙ 过滤设置」→ 填 DeepSeek API key → 填关键词 → 保存 → 规则重新打分 → 回到「精选」

详细步骤和配图见 README。

## 数据存储

全部在 `~/.liuer-intel-station/`，不上传任何地方：

| 文件 | 内容 |
|---|---|
| `intel.db` | 条目 + 全文索引（SQLite） |
| `feeds.json` | 订阅源列表 |
| `config.json` | 筛选规则 + 关注方向 |
| `.deepseek_key` | DeepSeek API key（权限 600） |

唯一的对外网络请求：抓 RSS 源 + 调 DeepSeek API（仅在你启用 AI 功能时）。

## 键盘快捷键

| 键 | 功能 |
|---|---|
| `j` / `k` | 下 / 上一篇 |
| `Shift+j/k` | 跳过已读 |
| `m` | 切换已读 |
| `s` | 切换收藏 |
| `o` / `Enter` | 打开原文 |
| `/` | 搜索 |
| `Esc` | 退出搜索 |

## 环境要求

| 项目 | 要求 |
|---|---|
| Python | 3.9+，`python3` 在 PATH 里（只用标准库） |
| DSH | 已安装并在用 |
| DeepSeek API key | 可选，只有 AI 功能需要 |

插件会依次尝试 `python3` / `python` / `/usr/bin/python3` / `/opt/homebrew/bin/python3`，找不到才报错。

## 限制

- **数据目录改动需环境变量** —— `LIUER_DATA_DIR`，界面里改不了
- **Windows 未实测** —— 只在 macOS 验证过
- **只支持 RSS/Atom** —— JSON Feed 暂不支持

## 技术实现

Host 插件 + 纯前端，零第三方依赖：

```
index.js           Host 半边，注册 /intel-station 前缀路由
client.js          面板入口（悬浮窗 + iframe）
web/               三栏阅读器（原生 HTML/CSS/JS，无框架）
engines/*.py       15 个零依赖 Python 脚本
  schema.py          建表
  fetch_feeds.py     并发抓取 + 解析 + 去重 + 写 FTS
  apply_filters.py   关键词规则打分
  ai_score.py        AI 语义打分
  summarize.py       AI 摘要
  query_items.py     列表查询
  search.py          全文搜索
  bootstrap.py       首页统计
  source_health.py   来源健康度
  weekly.py          周回顾
  item_detail.py     单篇详情
  mark_read.py       标记已读
  mark_star.py       标记收藏
  parse_opml.py      OPML 解析
  probe_feed.py      RSS 地址探测
```

数据层用 SQLite + FTS5（trigram 分词，中英文都能子串搜）。
