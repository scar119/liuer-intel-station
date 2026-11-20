// 六耳 AI资讯情报站 · Host 半边
// 提供 /intel-station/ 前缀路由：静态页面 + RSS 抓取 API + SQLite 索引
import { spawn, execSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const inject = ['webServer'];

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = '/intel-station';
const WEB_DIR = join(ROOT, 'web');
const ENGINE_DIR = join(ROOT, 'engines');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendFile(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  const ext = extname(filePath);
  const ctype = MIME[ext] || 'application/octet-stream';
  const stat = statSync(filePath);
  res.writeHead(200, {
    'Content-Type': ctype,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(filePath).pipe(res);
}

function dataDir(config) {
  const dir = config?.dataDir || join(process.env.HOME || '/tmp', '.liuer-intel-station');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// 密钥解析顺序：config.deepseekApiKey（YAML 里填的）→ 本地密钥文件
// 文件方式对定时任务也通用，且不把密钥写进 profile 的 YAML
function readApiKey(config, dataDir) {
  if (config?.deepseekApiKey) return config.deepseekApiKey;
  try {
    const f = join(dataDir, '.deepseek_key');
    if (existsSync(f)) {
      const k = readFileSync(f, 'utf-8').trim();
      if (k) return k;
    }
  } catch { /* 忽略 */ }
  return '';
}

function pyEngine(config) {
  if (config?.pythonPath) return config.pythonPath;
  // 自动探测：用户最常见的失败是 python3 不在 PATH
  const candidates = ['python3', 'python', '/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'];
  for (const c of candidates) {
    try {
      execSync(`"${c}" -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)"`, { timeout: 5000, stdio: 'ignore' });
      return c;
    } catch { /* 试下一个 */ }
  }
  return 'python3'; // 兜底，后面报错时能看到原因
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function runPy(py, script, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(py, [script, ...args], {
      timeout: 120_000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(stderr.slice(0, 500) || `exit ${code}`));
      else resolve(stdout.trim());
    });
    proc.on('error', reject);
  });
}

export function apply(ctx, config) {
  const DATA = dataDir(config);
  const PY = pyEngine(config);
  const DB = join(DATA, 'intel.db');
  const FEEDS_FILE = join(DATA, 'feeds.json');

  // 确保初始化
  if (!existsSync(FEEDS_FILE)) {
    writeFileSync(FEEDS_FILE, JSON.stringify({ feeds: [], lastFetch: null }, null, 2));
  }
  if (!existsSync(DB)) {
    try {
      execSync(`"${PY}" "${join(ENGINE_DIR, 'schema.py')}" "${DB}"`, { timeout: 10000 });
    } catch { /* fetch 时会再试 */ }
  }

  // register() 返回 disposer —— 必须用 ctx.effect 绑定到插件生命周期，
  // 否则卸载/热重载时路由泄漏，再次启用会撞 duplicate prefix route
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      const url = new URL(req.url || '/', 'http://x');
      const rest = decodeURIComponent(url.pathname.slice(BASE.length)) || '/';
      const method = req.method || 'GET';

      try {
        // ── 静态文件 ──
        if (method === 'GET' && (rest === '/' || rest === '/index.html')) {
          return sendFile(res, join(WEB_DIR, 'index.html'));
        }
        if (method === 'GET' && rest.startsWith('/web/')) {
          const rel = rest.slice(5);
          const target = join(WEB_DIR, rel);
          if (!target.startsWith(WEB_DIR)) return sendJson(res, 403, { error: 'forbidden' });
          return sendFile(res, target);
        }

        // ── API: bootstrap ──
        if (method === 'GET' && rest === '/api/bootstrap') {
          const result = await runPy(PY, join(ENGINE_DIR, 'bootstrap.py'), [DB]);
          return sendJson(res, 200, JSON.parse(result));
        }

        // ── API: feeds ──
        if (method === 'GET' && rest === '/api/feeds') {
          try {
            const data = JSON.parse(readFileSync(FEEDS_FILE, 'utf-8'));
            return sendJson(res, 200, data);
          } catch {
            return sendJson(res, 200, { feeds: [], lastFetch: null });
          }
        }

        if (method === 'POST' && rest === '/api/feeds/add') {
          const body = JSON.parse(await readBody(req));
          const existing = JSON.parse(readFileSync(FEEDS_FILE, 'utf-8'));
          const existingUrls = new Set(existing.feeds.map(f => f.xmlUrl));
          let added = 0;

          if (body.opml) {
            const result = await runPy(PY, join(ENGINE_DIR, 'parse_opml.py'), [body.opml]);
            const parsed = JSON.parse(result);
            for (const f of parsed) {
              if (!existingUrls.has(f.xmlUrl)) {
                existing.feeds.push({ ...f, addedAt: new Date().toISOString() });
                existingUrls.add(f.xmlUrl);
                added++;
              }
            }
          } else if (body.urls) {
            for (const u of body.urls) {
              const trimmed = u.trim();
              if (!trimmed || existingUrls.has(trimmed)) continue;
              let title = trimmed;
              try {
                const probe = await runPy(PY, join(ENGINE_DIR, 'probe_feed.py'), [trimmed]);
                const info = JSON.parse(probe);
                title = info.title || trimmed;
              } catch { /* use URL as title */ }
              existing.feeds.push({ title, xmlUrl: trimmed, addedAt: new Date().toISOString() });
              existingUrls.add(trimmed);
              added++;
            }
          }

          writeFileSync(FEEDS_FILE, JSON.stringify(existing, null, 2));
          return sendJson(res, 200, { ok: true, added, total: existing.feeds.length });
        }

        if (method === 'POST' && rest === '/api/feeds/remove') {
          const body = JSON.parse(await readBody(req));
          const existing = JSON.parse(readFileSync(FEEDS_FILE, 'utf-8'));
          const removeSet = new Set(body.urls || []);
          existing.feeds = existing.feeds.filter(f => !removeSet.has(f.xmlUrl));
          writeFileSync(FEEDS_FILE, JSON.stringify(existing, null, 2));
          return sendJson(res, 200, { ok: true, removed: removeSet.size, total: existing.feeds.length });
        }

        // ── API: fetch ──
        if (method === 'POST' && rest === '/api/fetch') {
          const result = await runPy(PY, join(ENGINE_DIR, 'fetch_feeds.py'), [DATA, DB]);
          // 抓取后自动应用过滤规则
          try {
            await runPy(PY, join(ENGINE_DIR, 'apply_filters.py'), [DATA, DB]);
          } catch { /* 过滤失败不影响抓取结果 */ }
          return sendJson(res, 200, { ok: true, stats: JSON.parse(result) });
        }

        // ── API: items ──
        if (method === 'GET' && rest === '/api/items') {
          const args = [DB,
            '--view', url.searchParams.get('view') || 'unread',
            '--limit', url.searchParams.get('limit') || '40',
            '--offset', url.searchParams.get('offset') || '0',
            '--feed', url.searchParams.get('feed') || '',
            '--q', url.searchParams.get('q') || '',
            '--channel', url.searchParams.get('channel') || '',
          ];
          const result = await runPy(PY, join(ENGINE_DIR, 'query_items.py'), args);
          return sendJson(res, 200, JSON.parse(result));
        }

        // ── API: search ──
        if (method === 'GET' && rest === '/api/search') {
          const args = [DB,
            url.searchParams.get('q') || '',
            url.searchParams.get('limit') || '40',
            url.searchParams.get('offset') || '0',
          ];
          const result = await runPy(PY, join(ENGINE_DIR, 'search.py'), args);
          return sendJson(res, 200, JSON.parse(result));
        }

        // ── API: item detail ──
        if (method === 'GET' && rest.startsWith('/api/item/')) {
          const id = rest.slice(10);
          const result = await runPy(PY, join(ENGINE_DIR, 'item_detail.py'), [DB, id]);
          return sendJson(res, 200, JSON.parse(result));
        }

        // ── API: read / star ──
        if (method === 'POST' && (rest === '/api/read' || rest === '/api/star')) {
          const body = JSON.parse(await readBody(req));
          const ids = body.ids || [];
          const val = body.value ? '1' : '0';
          const script = rest === '/api/read' ? 'mark_read.py' : 'mark_star.py';
          await runPy(PY, join(ENGINE_DIR, script), [DB, JSON.stringify(ids), val]);
          return sendJson(res, 200, { ok: true, updated: ids.length });
        }

        // ── API: sources ──
        if (method === 'GET' && rest === '/api/sources') {
          const result = await runPy(PY, join(ENGINE_DIR, 'source_health.py'), [DB]);
          return sendJson(res, 200, JSON.parse(result));
        }

        // ── API: weekly ──
        if (method === 'GET' && rest === '/api/weekly') {
          const result = await runPy(PY, join(ENGINE_DIR, 'weekly.py'), [DB]);
          return sendJson(res, 200, JSON.parse(result));
        }

        // ── API: summarize (AI 摘要) ──
        if (method === 'POST' && rest === '/api/summarize') {
          const apiKey = readApiKey(config, DATA);
          if (!apiKey) {
            return sendJson(res, 400, { error: '未配置 DeepSeek API key，请在「过滤设置」里保存' });
          }
          const body = JSON.parse(await readBody(req));
          const id = body.id;
          if (!id) {
            return sendJson(res, 400, { error: '缺少文章 id' });
          }
          const result = await runPy(PY, join(ENGINE_DIR, 'summarize.py'), [DB, id, apiKey]);
          return sendJson(res, 200, JSON.parse(result));
        }

        // ── API: apply filters (应用过滤规则) ──
        if (method === 'POST' && rest === '/api/apply-filters') {
          const result = await runPy(PY, join(ENGINE_DIR, 'apply_filters.py'), [DATA, DB]);
          return sendJson(res, 200, JSON.parse(result));
        }

        // ── API: key (读写 DeepSeek API key) ──
        if (rest === '/api/key') {
          const keyFile = join(DATA, '.deepseek_key');
          if (method === 'GET') {
            return sendJson(res, 200, { hasKey: !!readApiKey(config, DATA) });
          }
          if (method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const key = String(body.key || '').trim();
            if (key) {
              writeFileSync(keyFile, key, { mode: 0o600 });
              try { execSync(`chmod 600 "${keyFile}"`); } catch { /* ignore */ }
              return sendJson(res, 200, { ok: true, hasKey: true });
            }
            // 传空字符串 = 删除
            try { execSync(`rm -f "${keyFile}"`); } catch { /* ignore */ }
            return sendJson(res, 200, { ok: true, hasKey: false });
          }
        }

        // ── API: ai-score (AI 打分，v2 混合方案) ──
        if (method === 'POST' && rest === '/api/ai-score') {
          const apiKey = readApiKey(config, DATA);
          if (!apiKey) {
            return sendJson(res, 400, { error: '未配置 DeepSeek API key，请在「过滤设置」里保存' });
          }
          const body = JSON.parse(await readBody(req) || '{}');
          const limit = String(body.limit || 50);
          const args = [DATA, DB, apiKey, '--limit', limit];
          const result = await runPy(PY, join(ENGINE_DIR, 'ai_score.py'), args);
          return sendJson(res, 200, JSON.parse(result));
        }

        // ── API: config (读取配置) ──
        if (method === 'GET' && rest === '/api/config') {
          const configFile = join(DATA, 'config.json');
          let config = {};
          if (existsSync(configFile)) {
            try {
              config = JSON.parse(readFileSync(configFile, 'utf-8'));
            } catch { /* ignore */ }
          }
          return sendJson(res, 200, {
            ...config,
            dataDir: DATA,
            pythonPath: PY,
            hasApiKey: !!readApiKey(config, DATA),
          });
        }

        // ── API: config (写入配置) ──
        if (method === 'POST' && rest === '/api/config') {
          const body = JSON.parse(await readBody(req));
          const configFile = join(DATA, 'config.json');
          let existing = {};
          if (existsSync(configFile)) {
            try {
              existing = JSON.parse(readFileSync(configFile, 'utf-8'));
            } catch { /* ignore */ }
          }
          // 合并配置（不覆盖 dataDir/pythonPath 等系统字段）
          const updated = { ...existing, ...body };
          delete updated.dataDir;
          delete updated.pythonPath;
          writeFileSync(configFile, JSON.stringify(updated, null, 2));
          return sendJson(res, 200, { ok: true, config: updated });
        }

        // 404
        return sendJson(res, 404, { error: 'not found' });
      } catch (e) {
        return sendJson(res, 500, { error: e.message || 'internal error' });
      }
    },
  }));
}
