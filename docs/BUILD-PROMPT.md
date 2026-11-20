# DSH 数据面板插件 · 开发起始提示词

> **怎么用**：把下面「任务」开始到文件末尾的整段内容，复制给你的 AI Agent（DSH / Claude Code / Codex 都行）。把 `<尖括号>` 里的内容换成你的实际需求，然后让它开始。
>
> **它是什么**：一份经过真实项目验证的开发流程。作者用它从零做出过一个带 RSS 抓取、全文搜索、AI 分级、三栏阅读界面的 DSH 插件（约 15 个 Python 引擎 + 1 个 Host 插件 + 1 个 Client 面板 + 一套原生前端）。这里的每个阶段、每条约束、每个坑，都是实际撞过之后总结的，不是理论推演。

---

# 任务

你要为 DeepSeek Harness（DSH）开发一个**数据面板插件**：把某类数据采集到本地、存起来、做成一个能快速浏览和筛选的面板。

本次的数据源是：`<这里写清楚数据从哪来：RSS / API / 本地文件 / 网页抓取 / 数据库>`

用户想解决的问题是：`<一句话：比如"每天 500 条资讯里，我只想看 10 条">`

---

## 开工前：先问用户这 5 个问题

不要跳过。答不上来的按括号里的默认值走，并在开工前告诉用户你采用了默认值。

1. **数据源具体是什么？** 给 1-3 个真实样例（URL / 文件路径 / 表名），不要只给类型名。
   - 默认：让用户先给 2 个样例跑通，别一开始就接全量
2. **数据量级？** 每天进来多少条、最终存量多少条。
   - 默认：按每天 500 条、存量 5 万条设计
3. **必须能做的筛选是什么？** 关键词？打分？分类？时间范围？
   - 默认：先做「关键词规则过滤」，AI 相关能力后置
4. **要不要联网调 AI？** 有没有可用的 API key。
   - 默认：设计成可选。没有 key 也要能当纯阅读器用
5. **除了看，还要做什么？** 标记已读、收藏、导出、定时任务？
   - 默认：已读 + 收藏 + 一键抓取，其余后置

---

## 执行阶段

**规则**：一个阶段做完、验收通过、给用户看结果，再进下一阶段。不要一口气写完再交。

---

### 阶段 0 · 骨架跑通（目标：证明能挂到 DSH 上）

这是最容易走错的一步。先用**假数据**把「插件能被 DSH 加载 + 面板能打开 + 能请求到自己的接口」跑通，再谈业务。

要做的事：

1. 建目录结构（见文末「已验证骨架」）
2. `package.json` 填 `dsh.bundle.patch` 和 `dsh.client.platform: web`
3. `cordis.patch.yml` 写一条 `insert`
4. `index.js` 注册一个 `/xxx/` 前缀路由，只返回 `{"ok":true}`
5. `client.js` 注册侧栏面板 + 主面板，里面先放一个 iframe 指向自己的路由
6. `web/index.html` 只写一句 `hello`
7. 装到 profile，重启 DSH，打开面板

**验收**（必须实际执行，不能只看代码）：

```bash
# 换成你的实际端口和路径前缀
curl -s http://127.0.0.1:<端口>/<前缀>/api/ping   # 要返回 ok
```

面板能打开、能看到 hello、侧栏有这个插件 —— 三条全过才进下一阶段。

**这一阶段最常见的失败**见文末「坑 1 / 2 / 3」。

---

### 阶段 1 · 数据层（目标：能存能查）

1. 建 SQLite 表。**必须有**：主键、来源、时间戳（用整数 epoch，不要存字符串时间）、标题、正文/摘要
2. 建全文索引（见「坑 5」的正确写法）
3. 写 3 个 Python 脚本，都只用标准库、都接受 `<db_path>` 作参数、都往 stdout 打 JSON：
   - `schema.py` 建表
   - `query_items.py` 查列表（支持视图/分页/关键词）
   - `item_detail.py` 查单篇

**验收**：

```bash
python3 engines/schema.py /tmp/t.db
python3 engines/query_items.py /tmp/t.db --view all --limit 5   # 空数组也算通过
```

---

### 阶段 2 · 采集层（目标：真数据能进来）

1. 写 `fetch_feeds.py`（或对应的采集脚本）
2. **并发采集**（线程池，8 左右），单个源失败不能影响整体
3. 去重：用「链接的 sha1 前 16 位」当主键，`INSERT OR IGNORE`
4. 写库后**同事务**插入全文索引，用 `cursor.lastrowid`

**验收**：

```bash
python3 engines/fetch_feeds.py <数据目录> /tmp/t.db
# 必须再跑一次，确认不会重复入库（new_entries 应为 0 或很少）
```

---

### 阶段 3 · 查询层（目标：接口能给界面喂数据）

Host 侧把 Python 脚本用 `spawn` 调起来，路由返回 JSON。要有的接口：

| 接口 | 用途 |
|---|---|
| `GET /api/bootstrap` | 首页统计（总数/未读/各分组计数）+ 侧栏数据 |
| `GET /api/items` | 列表，支持 view/limit/offset/feed/q |
| `GET /api/item/:id` | 单篇详情 |
| `POST /api/read` `POST /api/star` | 状态变更 |
| `GET /api/search` | 全文搜索 |

**验收**：每个接口都用 `curl` 打一遍，确认 200 且字段是前端真能用的（见「坑 7」）。

---

### 阶段 4 · 界面（目标：三栏能看）

原生 HTML/CSS/JS，不引框架。三栏布局：

```
侧栏导航 (固定宽) │ 列表 (固定宽) │ 正文 (自适应)
```

必须同时做对的四件事：

1. **静态资源用相对路径**（`web/app.js`，不是 `/web/app.js`）—— 见「坑 3」
2. **空态**：列表空、正文未选中、加载中，三种状态都要有画面
3. **移动端**：`@media (max-width: 640px)` 下切成单栏，且**必须有 JS 切换列表/正文**——见「坑 9」
4. **键盘**：`j/k` 翻页、`m` 已读、`s` 收藏、`/` 搜索

**验收**：桌面 1400px 和手机 390px 各截一张图，两张都要能看清内容（不是空白、不被弹窗挡住）。

---

### 阶段 5 · 价值层（目标：把「多」变成「少」）

这是这类工具的核心价值，别跳过。

**5.1 规则过滤（免费、即时）**

- 抓取**全量保存**，筛选放在查询层 —— 这样用户改规则不用重新抓
- 按字段加权打分，不要一视同仁：标题命中 > 摘要命中 > 正文命中
- 排除词给大负分

**5.2 AI 打分/分类（可选，需 key）**

- 只给**规则分已经过线**的内容送 AI，1000 条只花几十条的钱
- 一次调用同时要三样：分数、类型、分组 —— 别为了三样东西调三次
- 严格 JSON 输出 + 越界值丢弃，别信模型一定按格式来
- **key 不要写进 profile 的 YAML**，用本地文件 `chmod 600`，Host 读取

**验收**：造 100 条测试数据，确认筛选后条数显著下降（比如 100 → 10 左右），并且分数能在界面上看到。

---

### 阶段 6 · 打磨（目标：别人能用）

按这个顺序，一条条过：

- [ ] 所有页面用浏览器 dump 一遍 DOM，确认没有 `undefined` / `NaN` / 字面量 `${...}`
- [ ] 空数据、单条数据、五千条数据，三种情况都不崩
- [ ] 错误状态有提示（后端没起来 / 抓取失败 / key 无效）
- [ ] 首次打开有引导，且引导能用 `?nointro=1` 跳过（截图要用）
- [ ] 移动端真的能用（不只是"没报错"）
- [ ] **空目录模拟全新安装**：按「建库 → 采集 → 查询 → 统计 → 筛选」顺序全跑通一遍

---

### 阶段 7 · 交付

- [ ] README：这是什么、装前须知（环境要求）、装、首次使用分步走（每步配图）
- [ ] 顶部「效果预览」放截图，**每张图注必须写清这张图里到底有什么**
- [ ] 已知限制诚实列出
- [ ] 常见问题写真实的排障顺序，不是"请检查网络"
- [ ] `docs/DETAIL.md`：插件市场详情页，讲**解决什么问题**，不是功能列表
- [ ] 隐私自查：全仓库扫个人路径、API key、邮箱、误提交的数据库文件

---

## 硬约束（违反必返工）

1. **零第三方依赖**。引擎只用 Python 标准库；前端不引框架；Host 侧不装 npm 包。理由：插件要能被任何人一行命令装上，多一个依赖就多一类失败。

2. **数据默认落在 `~/.<插件名>/`**，路径可通过环境变量覆盖。别往用户项目目录里写。

3. **每个 Python 脚本必须能单独跑**。`python3 engines/xxx.py <db>` 就是它的完整用法，不依赖 Host。这样出问题能二分定位。

4. **引擎输出字段名，前端必须用同一套**。这是最高频的 bug 来源（见「坑 7」）。

5. **时间统一用整数 epoch 存**，显示时才转本地时间。别在数据库里存格式化字符串。

6. **密钥不进代码、不进 YAML、不进 git**。放本地文件，`chmod 600`。

---

## 已验证骨架（直接抄，这些是真实跑通的）

### 目录结构

```
你的插件/
├── package.json          # dsh.bundle.patch + dsh.client.platform
├── cordis.patch.yml      # 一行 insert，告诉 DSH 怎么挂载
├── index.js              # Host：注册 HTTP 前缀路由
├── client.js             # Client：注册侧栏面板 + 主面板
├── locale/zh.json        # 标题/描述/详情页路径
├── icon.svg
├── web/                  # 三栏界面（原生）
│   ├── index.html
│   ├── app.js
│   └── style.css
├── engines/              # 全部 Python 标准库
│   ├── schema.py
│   ├── fetch_feeds.py
│   ├── query_items.py
│   ├── item_detail.py
│   └── ...
└── docs/DETAIL.md
```

### package.json 关键字段

```json
{
  "name": "@你的scope/插件名",
  "version": "0.1.0",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "docs/DETAIL.md", "icon.svg", "web", "engines"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  }
}
```

### cordis.patch.yml

```yaml
- insert:
    - id: 你的插件id
      name: '@你的scope/插件名'
      config: {}
```

### index.js · Host 半边（**注意 ctx.effect，见坑 1**）

```js
import { spawn } from 'node:child_process';
import { existsSync, createReadStream, readFileSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const inject = ['webServer'];

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = '/你的前缀';
const WEB = join(ROOT, 'web');
const ENGINES = join(ROOT, 'engines');

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function runPy(py, script, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(py, [script, ...args], { timeout: 120000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', c => c === 0 ? resolve(out.trim()) : reject(new Error(err.slice(0, 500) || `exit ${c}`)));
    p.on('error', reject);
  });
}

export function apply(ctx, config) {
  const DB = join(process.env.HOME || '/tmp', '.你的插件名', 'data.db');
  const PY = 'python3';

  // ★ 必须用 ctx.effect 包住，否则插件卸载时路由泄漏，
  //   再次启用会报 duplicate prefix route
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      const url = new URL(req.url || '/', 'http://x');
      const rest = decodeURIComponent(url.pathname.slice(BASE.length)) || '/';

      try {
        if (req.method === 'GET' && (rest === '/' || rest === '/index.html')) {
          const f = join(WEB, 'index.html');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          return createReadStream(f).pipe(res);
        }
        if (req.method === 'GET' && rest.startsWith('/web/')) {
          const f = join(WEB, rest.slice(5));
          if (!f.startsWith(WEB) || !existsSync(f)) return sendJson(res, 404, { error: 'not found' });
          const mime = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[extname(f)] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': mime, 'Content-Length': statSync(f).size });
          return createReadStream(f).pipe(res);
        }
        if (req.method === 'GET' && rest === '/api/ping') return sendJson(res, 200, { ok: true });

        return sendJson(res, 404, { error: 'not found' });
      } catch (e) {
        return sendJson(res, 500, { error: e.message || 'internal error' });
      }
    },
  }));
}
```

### client.js · Client 半边

```js
window.__ModuleLoader__.load({
  id: '@你的scope/插件名',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const PANEL_ID = '你的插件id';
    const SRC = '/你的前缀/';

    function IntelPage() {
      return h('iframe', {
        src: SRC,
        style: { width: '100%', height: '100%', border: 'none' },
        title: '数据面板',
      });
    }

    function PanelIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16 },
        h('circle', { cx: 12, cy: 12, r: 8, stroke: 'currentColor', strokeWidth: 1.6, fill: 'none' }));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 12, label: '面板名',
        }, PanelIcon));
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID,
        }, IntelPage));
      },
    };
  },
});
```

---

## 13 个已经踩过的坑（每条都真实发生过）

**坑 1 · 路由泄漏导致"更新必须重启"**
`webServer.register()` 返回 disposer。直接调用而不交给 `ctx.effect`，卸载时路由不注销，再次启用撞 `duplicate prefix route`。**必须** `ctx.effect(() => ctx.webServer.register({...}))`。
> 这个坑会让人误以为是 DSH 的限制，然后在文档里写"更新需重启，暂无解"——错的，是自己的 bug。

**坑 2 · Host 插件忘了声明依赖**
不写 `export const inject = ['webServer']`，激活时报 `cannot get property "webServer" without inject`。

**坑 3 · 静态资源路径写成绝对路径**
`index.html` 里写 `/web/app.js`，挂到 `/前缀/` 下之后 404（它去根目录找）。**用相对路径** `web/app.js`。症状是页面能开但一片空白、无报错。

**坑 4 · 用脚本批量改 JS 时把 `${}` 转义了**
用 Python/sed 改含模板字符串的 JS，容易产出 `\${feeds.length}`。页面会显示字面量 `${feeds.length}` 而不是数字。改完**必须** `grep -c '\\\${'` 检查。

**坑 5 · FTS5 索引写错**
正确写法：
```sql
CREATE VIRTUAL TABLE entry_fts USING fts5(
  title, summary, body, source,
  content='',                 -- 必须是空串（contentless），不能写 content='entries'
  contentless_delete=1,
  tokenize='trigram'
);
```
- `content='entries'` 配 `contentless_delete=1` 会直接报错 `contentless_delete=1 requires a contentless table`
- `tokenize='trigram'` 才能中文子串搜
- **2 个字的词走不了 trigram**，会退化成 `LIKE`，要单独写降级分支
- 索引由应用层自己维护（contentless 表没有触发器）：插入要用 `cursor.lastrowid`，且只在 `rowcount > 0`（真插入了）时插

**坑 6 · 全量重建索引慢到不可用**
5 万条全量重建 FTS 要 6 分钟、索引 200MB。增量更新时**不要逐行 DELETE**，改用「查已存在的 rowid 集合、跳过」。正文只索引前 600 字。

**坑 7 · 后端和前端字段名不一致（最高频 bug）**
SQL 里叫 `source`，前端读 `item.name` → 界面到处是 `undefined`。
防御手段：每加一个接口，先用 `curl | python3 -m json.tool` 看一眼真实结构，再写前端。前端取值一律 `src.source || src.name || ""`。

**坑 8 · 截图被引导弹窗挡住**
无头浏览器 localStorage 是空的，每次都会弹引导，截出来的图全是废图。
做法：前端读 `?nointro=1` 跳过引导，截图统一带这个参数。

**坑 9 · 移动端 CSS 藏了列表但没人让它出来**
`@media (max-width: 640px) { .listpane { display: none } }` 写好了，但全代码没有任何地方加显示类 —— 手机上永远只能看到空白面板。
移动端必须做：① 默认显示列表 ② 点开切正文 ③ 正文里有返回按钮 ④ 桌面端保持自动选中第一篇、移动端不要自动选中。

**坑 10 · 定时任务日志放在 Documents 被打不开**
macOS 的 TCC 会拦。日志一律放 `~/Library/Logs/`。
另外 launchd 的 `ProgramArguments` 不要用 `/bin/bash -lc`（会挂），用 `/bin/sh -c "cd 目录 && exec 命令"`。

**坑 11 · Python 路径写死 `python3`**
有的用户 Python 装在 `/opt/homebrew/bin` 或 `/usr/local/bin`。要做自动探测：依次试 `python3` / `python` / `/usr/bin/python3` / `/opt/homebrew/bin/python3`，第一个能跑 `-c "import sys"` 的胜出。

**坑 12 · 密钥写进 profile 的 YAML**
插件配置会随 profile 一起被同步/分享。密钥单独存本地文件（`~/.你的插件/data/.key`，`chmod 600`），Host 启动时读。这样定时任务也能共用同一个 key。

**坑 13 · 建表语句写在多个文件里，互相对不上**
这是最隐蔽的一个：`schema.py` 写一套、抓取脚本里又 `CREATE TABLE IF NOT EXISTS` 写另一套。开发时因为数据库是一路增量升级出来的，**本地永远正常**；但新用户拿到的是空库，两套 schema 谁先跑谁定义，另一个直接报错。

表现：你自己怎么测都没事，别人一装就是 `no column named xxx` / `contentless_delete=1 requires a contentless table`。

防御：
- 只留**一个**建表函数（`schema.ensure(conn)`），其它脚本 `import schema` 复用，绝不各写一份
- 后加的列用 `ALTER TABLE` 增量补，老库升级不丢数据
- **上线前必须做一次全新安装模拟**：`rm -rf /tmp/fresh && mkdir /tmp/fresh`，然后拿空目录把所有脚本按顺序跑一遍。这一步能挡住 90% 的"我这儿能跑"型 bug。

---

## 参考实现

完整跑通的实例（RSS 资讯面板，含 15 个 Python 引擎、AI 打分分级、三栏前端、定时抓取）：

```
https://github.com/scar119/liuer-intel-station
```

遇到具体问题时，优先去那里看对应文件，比重新设计快得多。

---

## 现在开始

先执行「开工前 5 个问题」，拿到答案后从**阶段 0** 开始，做完一个阶段停下给用户看，不要一口气写完。
