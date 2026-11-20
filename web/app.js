/* 六耳 AI资讯情报站 前端 — 无框架、无构建。 */

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

const S = {
  view: "hot",
  channel: null,
  feed: null,
  q: "",
  items: [],
  selected: null,
  offset: 0,
  hasMore: false,
  loading: false,
  boot: null,
  mode: "list", // list | report
  userTouched: false,
  pendingReload: false,
};

const VIEW_META = {
  unread: { title: "未读", empty: "没有未读内容了" },
  hot: { title: "近期", empty: "最近 7 天没有新内容" },
  filtered: { title: "精选", empty: "没有达到分数阈值的内容，去「过滤设置」调整关键词" },
  starred: { title: "收藏", empty: "还没有收藏" },
  all: { title: "全部", empty: "索引里还没有内容" },
};

/* ───────────────────────── 工具 ───────────────────────── */
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const p = (n) => String(n).padStart(2, "0");
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

function dayKey(ts) {
  if (!ts || ts <= 0) return "未知日期";
  const d = new Date(ts * 1000);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const delta = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (delta === 0) return "今天";
  if (delta === 1) return "昨天";
  if (delta < 7) return `${delta} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// 命中高亮：先转义再加 <mark>，避免 XSS
function hl(text, q) {
  const safe = esc(text == null ? "" : text);
  if (!q) return safe;
  let out = safe;
  q.split(/\s+/).filter(Boolean).forEach((t) => {
    const re = new RegExp(escRe(esc(t)), "gi");
    out = out.replace(re, (m) => `<mark>${m}</mark>`);
  });
  return out;
}

function hueOf(str) {
  let h = 0;
  for (let i = 0; i < (str || "").length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function thumbStyle(source) {
  const h = hueOf(source || "?");
  return `background:linear-gradient(135deg,hsl(${h} 62% 60%),hsl(${(h + 34) % 360} 66% 44%))`;
}

function initialOf(source) {
  const s = (source || "?").trim();
  return /[a-zA-Z]/.test(s[0]) ? s[0].toUpperCase() : s[0];
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/* ───────────────────────── Markdown ─────────────────────────
   自写一个小渲染器：这些正文来自 RSS，结构不复杂但脏，
   用通用库反而容易整段吞掉。故意只支持实际出现的语法。 */
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sanitizeHtml(html) {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|svg|math|template|noscript|marquee|meta|link|base)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|svg|math|template|noscript|marquee|meta|link|base)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\son\w+=/gi, "")
    .replace(/javascript\s*:/gi, "");
}

function inline(s) {
  s = s.replace(/`([^`]+)`/g, (m, a) => `<code>${a}</code>`);
  // [[路径.md|标题]] / [[路径]] —— Obsidian 风格，日报里大量使用
  s = s.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (m, pth, label) => {
    const txt = esc(label || pth.split("/").pop().replace(/\.md$/, ""));
    return `<a class="wikilink" data-path="${esc(pth)}" href="#">${txt}</a>`;
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,
    (m, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,
    (m, txt, href) => `<a href="${href}" target="_blank" rel="noopener">${txt}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  return s;
}

function parseList(lines, i) {
  const items = [];
  let baseIndent = null;
  let ordered = false;
  while (i < lines.length) {
    const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
    if (!m) {
      if (items.length && /^\s+\S/.test(lines[i])) {
        items[items.length - 1].text += " " + lines[i].trim();
        i++;
        continue;
      }
      break;
    }
    if (baseIndent === null) {
      baseIndent = m[1].length;
      ordered = /\d/.test(m[2]);
    }
    if (m[1].length < baseIndent) break;
    if (m[1].length > baseIndent) {
      const [sub, next] = parseList(lines, i);
      if (items.length) items[items.length - 1].sub += sub;
      i = next;
      continue;
    }
    items.push({ text: m[3], sub: "" });
    i++;
  }
  const tag = ordered ? "ol" : "ul";
  const body = items
    .map((it) => `<li>${inline(it.text)}${it.sub}</li>`)
    .join("");
  return [`<${tag}>${body}</${tag}>`, i];
}

function renderMarkdown(raw) {
  const src0 = String(raw || "");

  // 先判断「整篇是 HTML」还是「Markdown 掺 HTML」——顺序很重要：
  // 先把 HTML 预处理成 Markdown 再判断，会把纯 HTML 正文切碎。
  const head = src0.slice(0, 900);
  const htmlTags = (head.match(/<\/?(p|div|br|h[1-6]|figure|figcaption|img|ul|ol|li|blockquote|table|tr|td|a|span|b|strong|em)\b[^>]*>/gi) || []).length;
  const mdBlocks = (src0.match(/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/gm) || []).length;
  if (htmlTags >= 3 && htmlTags > mdBlocks) {
    return `<div class="prose">${sanitizeHtml(src0)}</div>`;
  }

  // 走 Markdown 分支：把零散的 HTML 片段换成 Markdown 等价物，否则会被转义成源码
  let src = src0
    .replace(/<img[^>]*?src=["']([^"']+)["'][^>]*>/gi, "\n\n![]($1)\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<\/?figure[^>]*>/gi, "\n")
    .replace(/<\/?figcaption[^>]*>/gi, "\n");

  src = esc(src.replace(/\r\n/g, "\n"));
  const lines = src.split("\n");
  const out = [];
  let buf = [];
  let i = 0;

  const flush = () => {
    if (buf.length) {
      // 行尾两个空格 = Markdown 硬换行（日报/审计报告里大量使用）
      const text = buf.join("\n").replace(/ {2,}\n/g, "<br>");
      out.push(`<p>${inline(text)}</p>`);
      buf = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${code.join("\n")}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push("<hr>"); i++; continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const lv = Math.min(h[1].length, 4);
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++;
      continue;
    }

    // 表格
    if (line.includes("|") && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flush();
      const rows = [];
      const header = line.split("|").map((c) => c.trim()).filter((c, ix, a) =>
        !(ix === 0 && c === "") && !(ix === a.length - 1 && c === ""));
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(lines[i].split("|").map((c) => c.trim()).filter((c, ix, a) =>
          !(ix === 0 && c === "") && !(ix === a.length - 1 && c === "")));
        i++;
      }
      const thead = `<thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows.map((r) =>
        `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const [html, next] = parseList(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
      continue;
    }

    buf.push(line.replace(/^\s+/, ""));   // 保留行尾空格：Markdown 硬换行靠它
    i++;
  }
  flush();
  return `<div class="prose">${out.join("")}</div>`;
}

/* ───────────────────────── URL 状态 ─────────────────────────
   用 hash 存视图状态：可以直接收藏「精选」「某个频道」，刷新也不丢。 */
function syncHash() {
  const p = new URLSearchParams();
  if (S.view !== "unread") p.set("view", S.view);
  if (S.channel) p.set("channel", S.channel);
  if (S.feed) p.set("feed", S.feed);
  if (S.q) p.set("q", S.q);
  if (S.selected && S.mode === "list") p.set("id", S.selected);
  if (["report", "weekly", "audit", "subscribe"].includes(S.mode)) p.set("view", S.mode);
  const h = p.toString();
  history.replaceState(null, "", h ? `#${h}` : location.pathname);
}

function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  const view = p.get("view");
  if (["weekly", "subscribe", "filters"].includes(view)) { S.mode = view; return; }
  if (view === "sources") S.view = "sources";
  else if (view && VIEW_META[view]) S.view = view;
  if (p.get("channel")) S.channel = p.get("channel");
  if (p.get("feed")) S.feed = p.get("feed");
  if (p.get("q")) S.q = p.get("q");
  S.pendingId = p.get("id") || null;
}

/* ───────────────────────── 左栏 ───────────────────────── */
function renderSidebar() {
  const b = S.boot;
  const prim = $("#nav-primary");
  prim.innerHTML = "";

  const rows = [
    { key: "filtered", label: "精选", count: b.filtered_count, badge: true },
    { key: "unread", label: "未读", count: b.unread, dot: true },
    { key: "hot", label: "近期", count: b.hot_unread },
    { key: "starred", label: "收藏", count: b.starred },
    { key: "all", label: "全部", count: b.total },
  ];
  rows.forEach((r) => {
    const btn = el("button", `nav-item${S.view === r.key && !S.channel && !S.feed ? " active" : ""}${r.key === "hot" ? " hot-entry" : ""}`);
    btn.innerHTML =
      `${r.dot ? '<span class="dot"></span>' : '<span class="ico">' +
        (r.key === "filtered" ? "◉"
          : r.key === "hot" ? "✦"
          : r.key === "starred" ? "★" : "▤") + "</span>"}` +
      `<span class="label">${r.label}</span>` +
      `<span class="count">${r.count ?? 0}</span>`;
    btn.onclick = () => setView(r.key);
    prim.appendChild(btn);
  });

  // 本周回顾
  const wk = el("button", `nav-item${S.mode === "weekly" ? " active" : ""}`);
  wk.innerHTML = `<span class="ico">◷</span><span class="label">本周回顾</span>`;
  wk.onclick = openWeekly;
  prim.appendChild(wk);

  // 订阅管理
  const sub = el("button", `nav-item\${S.mode === "subscribe" ? " active" : ""}`);
  sub.innerHTML = `<span class="ico">＋</span><span class="label">订阅管理</span>`;
  sub.onclick = openSubscribe;
  prim.appendChild(sub);

  // 来源健康度
  const src = el("button", `nav-item${S.view === "sources" ? " active" : ""}`);
  src.innerHTML = `<span class="ico">◎</span><span class="label">来源健康</span>` +
    `<span class="count">${b.feed_count ?? ""}</span>`;
  src.onclick = () => { S.view = "sources"; S.q = ""; S.channel = null; S.feed = null;
    refreshList(true); renderSidebar(); renderFilters(); syncHash(); };
  prim.appendChild(src);

  // 过滤设置
  const flt = el("button", `nav-item${S.mode === "filters" ? " active" : ""}`);
  flt.innerHTML = `<span class="ico">⚙</span><span class="label">过滤设置</span>`;
  flt.onclick = openFilters;
  prim.appendChild(flt);

  const ch = $("#nav-channels");
  ch.innerHTML = "";
  b.channels.forEach((c) => {
    const btn = el("button",
      `nav-item${S.channel === c.key ? " active" : ""}${c.unread ? " unread" : ""}`);
    btn.innerHTML = `<span class="dot" style="opacity:${c.unread ? 1 : 0}"></span>` +
      `<span class="label">${c.label}</span><span class="count">${c.unread || c.count}</span>`;
    btn.onclick = () => {
      S.channel = S.channel === c.key ? null : c.key;
      S.feed = null;
      refreshList(true);
      renderSidebar();
      syncHash();
    };
    ch.appendChild(btn);
  });

  const fd = $("#nav-feeds");
  fd.innerHTML = "";
  b.feeds.slice(0, 40).forEach((f) => {
    const btn = el("button", `nav-item${S.feed === f.name ? " active" : ""}${f.unread ? " unread" : ""}`);
    btn.innerHTML = `<span class="label" title="${esc(f.name)}">${esc(f.name)}</span>` +
      `<span class="count">${f.unread || f.count}</span>`;
    btn.onclick = () => {
      S.feed = S.feed === f.name ? null : f.name;
      S.channel = null;
      refreshList(true);
      renderSidebar();
      syncHash();
    };
    fd.appendChild(btn);
  });

  $("#sidebar-foot").innerHTML = `${b.total.toLocaleString()} 篇 · 近 24h ${b.last_24h}<br>` +
    `索引于 ${b.last_indexed ? new Date(b.last_indexed).toLocaleString("zh-CN", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}`;
}

function renderFilters() {
  const f = $("#filters");
  f.innerHTML = "";
  [["unread", "未读"], ["hot", "近期"],
   ["cognition", "洞察"], ["all", "全部"], ["starred", "收藏"]]
    .forEach(([k, label]) => {
      const b = el("button", `chip${S.view === k ? " active" : ""}`, label);
      b.onclick = () => setView(k);
      f.appendChild(b);
    });
}

function setView(v) {
  S.view = v;
  S.channel = null;
  S.feed = null;
  S.mode = "list";
  refreshList(true);
  renderSidebar();
  renderFilters();
  syncHash();
}

/* ───────────────────────── 列表 ───────────────────────── */
function currentTitle() {
  if (S.feed) return S.feed;
  if (S.channel) {
    const c = (S.boot?.channels || []).find((x) => x.key === S.channel);
    return c ? c.label : "频道";
  }
  return VIEW_META[S.view]?.title || "未读";
}

async function refreshList(reset) {
  if (S.loading) {                 // 并发保护：登记一个待重跑的请求
    if (reset) S.pendingReload = true;
    return;
  }
  S.loading = true;
  if (reset) {
    S.items = [];
    S.offset = 0;
    S.selected = null;
    $("#items").innerHTML = "";
    $("#reader-body").hidden = true;
    $("#reader-empty").hidden = false;
  }
  if (S.view === "sources" && !S.q) {
    S.loading = false;
    return loadSources();
  }

  $("#list-title").textContent = S.q ? `搜索「${S.q}」` : currentTitle();
  $("#list-sub").textContent = "";

  const params = new URLSearchParams({
    view: S.view, limit: "40", offset: String(S.offset),
  });
  if (S.channel) params.set("channel", S.channel);
  if (S.feed) params.set("feed", S.feed);
  if (S.q) params.set("q", S.q);

  const url = S.q ? `/intel-station/api/search?${params}` : `/intel-station/api/items?${params}`;
  try {
    const data = await api(url);
    S.searchMode = data.mode || null;
    S.hasMore = data.has_more;
    S.items = S.items.concat(data.items);
    S.offset = data.offset;
    renderItems(reset);
    if (reset) {
      $("#list-sub").textContent = S.items.length
        ? `${S.items.length}${S.hasMore ? "+" : ""} 条` +
          (S.q ? (S.searchMode === "fts" ? " · 含正文" : " · 仅标题摘要") : "")
        : "";
      if (!S.items.length) renderEmptyList();
      else if (!S.selected) {
        const at = S.pendingId ? S.items.findIndex((x) => x.id === S.pendingId) : -1;
        selectIndex(at >= 0 ? at : 0, false);
      }
    }
    updateFoot();
  } catch (e) {
    toast("加载失败：" + e.message);
  } finally {
    S.loading = false;
    if (S.pendingReload) {
      S.pendingReload = false;
      refreshList(true);
    }
  }
}

function updateFoot() {
  const foot = $("#list-foot");
  if (!S.items.length) {
    foot.innerHTML = "";
    foot.style.display = "none";
    return;
  }
  foot.style.display = "flex";
  foot.innerHTML =
    `<span>${S.hasMore ? "继续滚动加载…" : `已到最底 · 共 ${S.items.length} 篇`}</span>` +
    `<button id="foot-markall">标记以上已读</button>`;
  $("#foot-markall").onclick = markAllAbove;
}

const SOURCE_STATUS = {
  ok:    { label: "活跃", cls: "ok" },
  quiet: { label: "低频", cls: "quiet" },
  stale: { label: "停更", cls: "stale" },
  spam:  { label: "灌水", cls: "spam" },
};

async function loadSources() {
  const wrap = $("#items");
  $("#list-title").textContent = "来源健康";
  wrap.innerHTML = `<div class="empty-list">统计中…</div>`;
  $("#list-foot").style.display = "none";
  try {
    const d = await api("/intel-station/api/sources");
    const sm = d.summary;
    $("#list-sub").textContent =
      `${d.total_sources} 个源 · 健康 ${sm.ok} · 低频 ${sm.quiet} · 停更 ${sm.stale} · 灌水 ${sm.spam}`;

    wrap.innerHTML = "";
    const bar = el("div", "src-summary");
    bar.innerHTML = `
      <div class="src-stat"><b>${sm.ok}</b><span>活跃</span></div>
      <div class="src-stat quiet"><b>${sm.quiet}</b><span>低频</span></div>
      <div class="src-stat stale"><b>${sm.stale}</b><span>停更</span></div>
      <div class="src-stat spam"><b>${sm.spam}</b><span>灌水</span></div>`;
    wrap.appendChild(bar);

    d.sources.forEach((src) => {
      const st = SOURCE_STATUS[src.status] || SOURCE_STATUS.ok;
      const card = el("div", "card src-card");
      const ratePct = Math.round(src.signal_rate * 100);
      card.innerHTML = `
        <div class="card-main">
          <div class="card-meta">
            <span class="src-pill ${st.cls}">${st.label}</span>
            <span class="src">${esc(src.name)}</span>
          </div>
          <div class="src-line">
            ${src.total} 篇 · 近 30 天 ${src.n30} · 信号率 ${ratePct}% ·
            ${src.days >= 9999 ? "无日期" : src.days === 0 ? "今天有更新" : `最后更新 ${src.days} 天前`}
          </div>
          <div class="src-meter"><i style="width:${Math.min(100, ratePct * 4)}%"></i></div>
        </div>`;
      card.onclick = () => {
        S.feed = src.name;
        S.view = "unread";
        S.channel = null;
        refreshList(true);
        renderSidebar();
        renderFilters();
        syncHash();
      };
      wrap.appendChild(card);
    });
    $("#list-foot").style.display = "flex";
    $("#list-foot").innerHTML = `<span>点任意来源 → 只看它的文章</span>`;
  } catch (e) {
    wrap.innerHTML = `<div class="empty-list">加载失败：${esc(e.message)}</div>`;
  }
}

function renderEmptyList() {
  const wrap = $("#items");
  const meta = VIEW_META[S.view] || {};
  wrap.innerHTML = `<div class="empty-list"><span class="big">${meta.empty || "暂无内容"}</span>` +
    (S.view === "unread" ? "换个频道看看，或用 / 搜索" : "") + `</div>`;
  $("#list-foot").innerHTML = "";
}

function renderItems(reset) {
  const wrap = $("#items");
  if (reset) wrap.innerHTML = "";
  if (!S.items.length) return;
  let lastDay = null;
  const seen = new Set(wrap.querySelectorAll(".card").length ? [] : []);
  S.items.forEach((it, idx) => {
    if (seen.has(it.id)) return;
    // 搜索按相关度排序，按天分隔反而错乱，所以只在时间序里显示
    if (!(S.q && S.searchMode === "fts")) {
      const day = dayKey(it.published_ts);
      if (day !== lastDay) {
        wrap.appendChild(el("div", "day-sep", day));
        lastDay = day;
      }
    }
    const card = buildCard(it, idx);
    wrap.appendChild(card);
  });
}

// 这些分类名是流水线的兜底产物，显示出来只是噪音
const JUNK_CATS = new Set(["news", "资讯", "纯资讯", "未分类", "其他", "AI", "科技"]);

function buildCard(it, idx) {
  const card = el("div", `card${it.read ? " read" : ""}${S.selected === it.id ? " active" : ""}`);
  card.dataset.id = it.id;
  card.dataset.idx = idx;

  const tags = [];
  if (it.body_hit) tags.push('<span class="tag bodyhit">正文命中</span>');
  if (it.starred) tags.push('<span class="tag star">★ 收藏</span>');
  if (it.raw_category && !JUNK_CATS.has(it.raw_category) &&
      it.raw_category !== it.tier_label) {
    tags.push(`<span class="tag">${esc(it.raw_category)}</span>`);
  }

  card.innerHTML = `
    <div class="card-main">
      <div class="card-meta">
        ${it.read ? "" : '<span class="unread-dot"></span>'}
        <span class="src">${esc(it.source || "未标注来源")}</span>
        <span class="sep">·</span>
        <span>${fmtTime(it.published_at)}</span>
        ${typeof it.ai_score === "number" && it.ai_score > 0
          ? `<span class="score-badge s${it.ai_score >= 70 ? "hi" : it.ai_score >= 40 ? "mid" : "lo"}">${it.ai_score}</span>`
          : ""}
      </div>
      <p class="card-title">${hl(it.title || "(无标题)", S.q)}</p>
      ${it.preview ? `<div class="card-preview">${hl(it.preview, S.q)}</div>` : ""}
      ${tags.length ? `<div class="card-tags">${tags.join("")}</div>` : ""}
    </div>
    <div class="card-thumb" style="${thumbStyle(it.source)}">${esc(initialOf(it.source))}</div>
  `;
  card.onclick = () => selectIndex(idx, true);
  return card;
}

function updateCardState(id) {
  const idx = S.items.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const it = S.items[idx];
  const node = $(`.card[data-id="${CSS.escape(id)}"]`);
  if (!node) return;
  node.classList.toggle("read", !!it.read);
  node.classList.toggle("active", S.selected === id);
  const dot = $(".unread-dot", node);
  if (it.read && dot) dot.remove();
  const hasStar = $(".tag.star", node);
  if (it.starred && !hasStar) {
    $(".card-tags", node)?.prepend(el("span", "tag star", "★ 收藏"));
  } else if (!it.starred && hasStar) {
    hasStar.remove();
  }
}

/* ───────────────────────── 阅读器 ───────────────────────── */
async function selectIndex(idx, userAction) {
  const it = S.items[idx];
  if (!it) return;
  S.selected = it.id;
  S.mode = "list";
  S.pendingId = null;
  syncHash();
  document.querySelectorAll(".card.active").forEach((n) => n.classList.remove("active"));
  const node = $(`.card[data-id="${CSS.escape(it.id)}"]`);
  if (node) {
    node.classList.add("active");
    node.scrollIntoView({ block: "nearest" });
  }
  $("#reader-empty").hidden = true;
  const body = $("#reader-body");
  body.hidden = false;
  body.innerHTML = `<div class="reader-loading">加载中…</div>`;

  try {
    const d = await api(`/intel-station/api/item/${it.id}`);
    renderArticle(d);
    if (!it.read) markRead([it.id], true);
  } catch (e) {
    body.innerHTML = `<div class="reader-loading">加载失败：${esc(e.message)}</div>`;
  }
}

function renderArticle(d) {
  const body = $("#reader-body");
  const tierChip = d.tier && d.tier !== "news"
    ? `<span class="chip-tier ${d.tier}">${d.tier_label}</span>` : "";
  const catChip = d.raw_category && !JUNK_CATS.has(d.raw_category)
    ? `<span class="chip-tier">${esc(d.raw_category)}</span>` : "";

  body.innerHTML = `
    <div class="reader-top">
      <a class="rbtn" href="${esc(d.link || "#")}" target="_blank" rel="noopener">打开原文 ↗</a>
      <button class="rbtn" id="btn-star">${d.starred ? "★ 已收藏" : "☆ 收藏"}</button>
      <button class="rbtn" id="btn-read">${d.read ? "标为未读" : "标为已读"}</button>
    </div>
    <h1 class="article-title">${esc(d.title || "(无标题)")}</h1>
    <div class="article-meta">
      <span class="src-badge">
        <span class="mini" style="${thumbStyle(d.source)}">${esc(initialOf(d.source))}</span>
        ${esc(d.source || "未标注来源")}
      </span>
      <span class="sep">·</span>
      <span>${new Date(d.published_at || Date.now()).toLocaleString("zh-CN", {
        year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit" })}</span>
      ${tierChip}${catChip}
    </div>
    ${d.ai_summary ? `<div class="ai-card">
        <div class="ai-head">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor"
            d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16.5l-1.9-5.6L4.5 9l5.6-1.4L12 2zm6.5 12l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6zM5 15l.7 2 2 .7-2 .7L5 20.5l-.7-2.1-2-.7 2-.7L5 15z"/></svg>
          AI 总结
          <button class="ai-refresh" id="btn-regen" title="重新生成">↻</button>
        </div>
        <div class="ai-text">${esc(d.ai_summary)}</div>
      </div>` : `<button class="ai-generate" id="btn-generate">✨ 生成 AI 总结</button>`}
    ${d.body ? renderMarkdown(d.body) : `<div class="prose"><p style="color:#9a9a94">（这篇没有正文缓存，点上方「打开原文」查看）</p></div>`}
  `;

  $("#btn-star").onclick = () => toggleStar(d.id);
  $("#btn-read").onclick = () => {
    const it = S.items.find((x) => x.id === d.id);
    const next = !(it?.read);
    markRead([d.id], next);
    body.querySelector("#btn-read").textContent = next ? "标为未读" : "标为已读";
  };

  // AI 摘要按钮
  const btnGen = $("#btn-generate");
  if (btnGen) {
    btnGen.onclick = async () => {
      btnGen.disabled = true;
      btnGen.textContent = "生成中…";
      try {
        const r = await api("/intel-station/api/summarize", { method: "POST", body: { id: d.id } });
        if (r.ok) {
          // 重新渲染文章
          const updated = await api(`/intel-station/api/item/${d.id}`);
          renderArticle(updated);
          toast("摘要已生成");
        } else {
          throw new Error(r.error || "生成失败");
        }
      } catch (e) {
        btnGen.disabled = false;
        btnGen.textContent = "✨ 生成 AI 总结";
        toast("生成失败: " + e.message);
      }
    };
  }

  const btnRegen = $("#btn-regen");
  if (btnRegen) {
    btnRegen.onclick = async () => {
      btnRegen.disabled = true;
      toast("正在重新生成…");
      try {
        const r = await api("/intel-station/api/summarize", { method: "POST", body: { id: d.id } });
        if (r.ok) {
          const updated = await api(`/intel-station/api/item/${d.id}`);
          renderArticle(updated);
          toast("摘要已更新");
        } else {
          throw new Error(r.error || "生成失败");
        }
      } catch (e) {
        toast("生成失败: " + e.message);
      }
      btnRegen.disabled = false;
    };
  }

  $(".reader").scrollTop = 0;
}

async function openEntryById(id) {
  try {
    const d = await api(`/intel-station/api/item/${id}`);
    S.selected = id;
    S.mode = "list";
    $("#reader-empty").hidden = true;
    const body = $("#reader-body");
    body.hidden = false;
    renderArticle(d);
    syncHash();
    if (!d.read) markRead([id], true);
  } catch (e) {
    toast("打不开这篇：" + e.message);
  }
}

async function openEntryByPath(pth) {
  try {
    const r = await api(`/intel-station/api/resolve?path=${encodeURIComponent(pth)}`);
    if (r.id) return openEntryById(r.id);
    toast("索引里没有这篇（可能已随旧报告清理）");
  } catch (e) {
    toast("查找失败");
  }
}

async function openSubscribe() {
  S.mode = "subscribe";
  syncHash();
  renderSidebar();
  document.querySelectorAll(".card.active").forEach((n) => n.classList.remove("active"));
  $("#list-title").textContent = "订阅管理";
  $("#list-sub").textContent = "";
  $("#reader-empty").hidden = true;
  const body = $("#reader-body");
  body.hidden = false;

  // 加载当前订阅列表
  let feeds = [];
  try {
    const d = await api("/intel-station/api/feeds");
    feeds = d.feeds || [];
  } catch {}

  body.innerHTML = `
    <div class="reader-top">
      <span class="rbtn" style="border-color:#ffd9c2;background:#fff1e9;color:#b8420a">订阅管理</span>
      <span style="flex:1"></span>
      <button class="rbtn" id="btn-fetch-now">立即抓取</button>
    </div>
    <h1 class="article-title">管理你的订阅源</h1>

    <div class="sub-section">
      <h2 class="wk-h">添加单个 RSS</h2>
      <div class="sub-row">
        <input id="sub-single" type="url" placeholder="https://example.com/feed.xml" class="sub-input" />
        <button class="sub-btn" id="btn-add-single">添加</button>
      </div>
    </div>

    <div class="sub-section">
      <h2 class="wk-h">批量添加（每行一个 URL）</h2>
      <textarea id="sub-batch" class="sub-textarea" rows="4" placeholder="https://blog.example.com/rss\nhttps://news.example.com/feed.xml"></textarea>
      <button class="sub-btn" id="btn-add-batch" style="margin-top:6px">批量添加</button>
    </div>

    <div class="sub-section">
      <h2 class="wk-h">导入 OPML</h2>
      <div class="sub-row">
        <input id="sub-opml" type="file" accept=".opml,.xml" class="sub-file" />
        <button class="sub-btn" id="btn-import-opml">导入</button>
      </div>
    </div>

    <div class="sub-section">
      <h2 class="wk-h">当前订阅（\${feeds.length} 个）</h2>
      <div id="sub-list" class="sub-list"></div>
    </div>

    <div id="sub-status" class="sub-status"></div>
  `;

  // 渲染订阅列表
  const listEl = $("#sub-list");
  if (!feeds.length) {
    listEl.innerHTML = '<div class="sub-empty">还没有订阅源，添加一些吧</div>';
  } else {
    feeds.forEach((f) => {
      const row = el("div", "sub-feed-row");
      row.innerHTML = `
        <span class="sub-feed-title">\${esc(f.title || f.xmlUrl)}</span>
        <span class="sub-feed-url">\${esc(f.xmlUrl)}</span>
        <button class="sub-remove" data-url="\${esc(f.xmlUrl)}">删除</button>`;
      listEl.appendChild(row);
    });
    listEl.querySelectorAll(".sub-remove").forEach((btn) => {
      btn.onclick = async () => {
        const url = btn.dataset.url;
        try {
          await api("/intel-station/api/feeds/remove", {
            method: "POST", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ urls: [url] }),
          });
          toast("已删除");
          openSubscribe(); // 刷新
        } catch (e) { toast("删除失败：" + e.message); }
      };
    });
  }

  const statusEl = $("#sub-status");
  function showStatus(msg, ok = true) {
    statusEl.textContent = msg;
    statusEl.style.color = ok ? "var(--status-ok)" : "var(--status-danger)";
  }

  // 单条添加
  $("#btn-add-single").onclick = async () => {
    const url = $("#sub-single").value.trim();
    if (!url) return;
    try {
      const r = await api("/intel-station/api/feeds/add", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ urls: [url] }),
      });
      showStatus(`添加了 \${r.added} 个源`, true);
      $("#sub-single").value = "";
      setTimeout(() => openSubscribe(), 800);
    } catch (e) { showStatus("添加失败：" + e.message, false); }
  };

  // 批量添加
  $("#btn-add-batch").onclick = async () => {
    const urls = $("#sub-batch").value.split("\n").map(s => s.trim()).filter(Boolean);
    if (!urls.length) return;
    try {
      const r = await api("/intel-station/api/feeds/add", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ urls }),
      });
      showStatus(`添加了 \${r.added} 个源`, true);
      $("#sub-batch").value = "";
      setTimeout(() => openSubscribe(), 800);
    } catch (e) { showStatus("添加失败：" + e.message, false); }
  };

  // OPML 导入
  $("#btn-import-opml").onclick = async () => {
    const fileInput = $("#sub-opml");
    if (!fileInput.files.length) return;
    const text = await fileInput.files[0].text();
    try {
      const r = await api("/intel-station/api/feeds/add", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ opml: text }),
      });
      showStatus(`从 OPML 导入了 \${r.added} 个源`, true);
      setTimeout(() => openSubscribe(), 800);
    } catch (e) { showStatus("导入失败：" + e.message, false); }
  };

  // 立即抓取
  $("#btn-fetch-now").onclick = async () => {
    const btn = $("#btn-fetch-now");
    btn.textContent = "抓取中…";
    btn.disabled = true;
    try {
      const r = await api("/intel-station/api/fetch", { method: "POST" });
      showStatus(`抓取完成：\${r.stats.new_entries} 条新文章，\${r.stats.seconds}s`, true);
      await reloadBoot();
    } catch (e) { showStatus("抓取失败：" + e.message, false); }
    finally { btn.textContent = "立即抓取"; btn.disabled = false; }
  };

  $(".reader").scrollTop = 0;
}


async function openWeekly() {
  S.mode = "weekly";
  syncHash();
  renderSidebar();
  document.querySelectorAll(".card.active").forEach((n) => n.classList.remove("active"));
  $("#list-title").textContent = "本周回顾";
  $("#list-sub").textContent = "";
  $("#items").innerHTML = `<div class="empty-list">右侧显示本周概览<br>← 点左侧任意频道返回列表</div>`;
  $("#reader-empty").hidden = true;
  const body = $("#reader-body");
  body.hidden = false;
  body.innerHTML = `<div class="reader-loading">统计中…</div>`;
  try {
    const d = await api("/intel-station/api/weekly");
    const chLabel = {};
    (S.boot?.channels || []).forEach((c) => { chLabel[c.key] = c.label; });
    const maxDay = Math.max(1, ...d.daily.map((x) => x.n));
    const maxCh = Math.max(1, ...d.channels.map((x) => x.n));
    const arrow = d.delta >= 0 ? "↑" : "↓";
    const deltaCls = d.delta >= 0 ? "up" : "down";

    body.innerHTML = `
      <div class="reader-top">
        <span class="rbtn" style="border-color:#ffd9c2;background:#fff1e9;color:#b8420a">
          近 7 天 · ${new Date(d.range.from * 1000).toLocaleDateString("zh-CN",{month:"numeric",day:"numeric"})}
          – ${new Date(d.range.to * 1000).toLocaleDateString("zh-CN",{month:"numeric",day:"numeric"})}
        </span>
      </div>
      <h1 class="article-title">本周回顾</h1>

      <div class="wk-hero">
        <div class="wk-num">${d.cur.total}</div>
        <div class="wk-cap">篇新内容
          <span class="wk-delta ${deltaCls}">${arrow} ${Math.abs(d.delta)}（${d.pct ?? 0}%）</span>
          对比上周 ${d.prev.total}
        </div>
      </div>

      <div class="wk-grid">
        <div class="wk-cell"><b>${d.cur.practice}</b><span>实操落地</span></div>
        <div class="wk-cell"><b>${d.cur.insight}</b><span>认知洞察</span></div>
        <div class="wk-cell"><b>${d.cur.signal}</b><span>高信号</span></div>
        <div class="wk-cell"><b>${d.cur.sources}</b><span>活跃来源</span></div>
      </div>

      <h2 class="wk-h">每天产出</h2>
      <div class="wk-bars">
        ${d.daily.map((x) => `
          <div class="wk-bar" title="${x.day}：${x.n} 篇">
            <i style="height:${Math.round((x.n / maxDay) * 100)}%"></i>
            <em>${x.n}</em>
            <span>${x.day.slice(5).replace("-", "/")}</span>
          </div>`).join("")}
      </div>

      <h2 class="wk-h">频道分布</h2>
      <div class="wk-rows">
        ${d.channels.map((c) => `
          <div class="wk-row">
            <span class="wk-lbl">${esc(chLabel[c.key] || c.key)}</span>
            <span class="wk-track"><i style="width:${Math.round((c.n / maxCh) * 100)}%"></i></span>
            <span class="wk-val">${c.n}</span>
          </div>`).join("")}
      </div>

      <h2 class="wk-h">本周高信号 Top ${d.top.length}</h2>
      <div class="wk-list">
        ${d.top.map((it) => `
          <div class="wk-item" data-id="${it.id}">
            <div class="wk-item-t">${esc(it.title || "")}</div>
            <div class="wk-item-m">${esc(it.source)} · ${it.tier_label}${
              it.score >= 6 ? ` · 评分 ${it.score}` : ""}</div>
          </div>`).join("") || `<div class="wk-empty">本周没有高信号内容</div>`}
      </div>

      ${d.new_sources.length ? `<h2 class="wk-h">本周新出现的来源</h2>
      <div class="wk-chips">${d.new_sources.map((x) =>
        `<span class="wk-chip">${esc(x.name)} · ${x.n}</span>`).join("")}</div>` : ""}

      <h2 class="wk-h">最活跃来源</h2>
      <div class="wk-chips">${d.busiest.map((x) =>
        `<span class="wk-chip">${esc(x.name)} · ${x.n}</span>`).join("")}</div>
    `;
    body.querySelectorAll(".wk-item").forEach((elm) => {
      elm.onclick = () => openEntryById(elm.dataset.id);
    });
    $(".reader").scrollTop = 0;
  } catch (e) {
    body.innerHTML = `<div class="reader-loading">统计失败：${esc(e.message)}</div>`;
  }
}


/* ───────────────────────── 状态变更 ───────────────────────── */
async function markRead(ids, value = true) {
  try {
    await api("/intel-station/api/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, value }),
    });
    ids.forEach((id) => {
      const it = S.items.find((x) => x.id === id);
      if (it) it.read = value ? 1 : 0;
      updateCardState(id);
    });
    if (value && S.boot) {
      S.boot.unread = Math.max(0, S.boot.unread - ids.length);
      S.boot.hot_unread = Math.max(0, S.boot.hot_unread - ids.length);
      renderSidebar();
    }
  } catch (e) {
    toast("状态保存失败");
  }
}

async function toggleStar(id) {
  const it = S.items.find((x) => x.id === id);
  const next = !(it?.starred);
  try {
    await api("/intel-station/api/star", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], value: next }),
    });
    if (it) it.starred = next ? 1 : 0;
    updateCardState(id);
    if (S.boot) S.boot.starred = Math.max(0, (S.boot.starred || 0) + (next ? 1 : -1));
    renderSidebar();
    const btn = $("#btn-star");
    if (btn) btn.textContent = next ? "★ 已收藏" : "☆ 收藏";
    toast(next ? "已收藏" : "已取消收藏");
  } catch (e) {
    toast("收藏失败");
  }
}

async function markAllAbove() {
  if (!S.items.length) return;
  // 「以上」= 当前已加载的这一屏。列表按时间倒序，所以取最底部那条的时间戳作为下界。
  const before = S.items[S.items.length - 1].published_ts;
  try {
    const r = await api("/intel-station/api/read_above", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: S.view, channel: S.channel, feed: S.feed, before_ts: before,
      }),
    });
    toast(`已标记 ${r.updated} 条为已读`);
    await reloadBoot();
    refreshList(true);
  } catch (e) {
    toast("操作失败");
  }
}

async function reloadBoot() {
  S.boot = await api("/intel-station/api/bootstrap");
  renderSidebar();
}

/* ───────────────────────── 事件 ───────────────────────── */
function bind() {
  const touch = () => { S.userTouched = true; };
  ["pointerdown", "keydown", "wheel"].forEach((ev) =>
    document.addEventListener(ev, touch, { once: false, passive: true }));

  // 移动端菜单
  const sidebar = $("#sidebar");
  const backdrop = $("#sidebar-backdrop");
  $("#btn-mobile-menu").onclick = () => {
    sidebar.classList.toggle("open");
    backdrop.classList.toggle("show");
  };
  backdrop.onclick = () => {
    sidebar.classList.remove("open");
    backdrop.classList.remove("show");
  };

  $("#btn-markall").onclick = markAllAbove;

  $("#btn-refresh").onclick = async (e) => {
    const btn = $("#btn-refresh");
    btn.classList.add("spin");
    try {
      const r = await api("/intel-station/api/refresh", { method: "POST" });
      toast(`索引已更新：新增/更新 ${r.stats.upserted} 篇，${r.stats.seconds}s`);
      await reloadBoot();
      refreshList(true);
    } catch (err) {
      toast("刷新失败：" + err.message);
    } finally {
      btn.classList.remove("spin");
    }
  };

  const search = $("#search");
  const doSearch = debounce(() => {
    S.q = search.value.trim();
    refreshList(true);
    syncHash();
  }, 260);
  search.oninput = doSearch;
  search.onkeydown = (e) => { if (e.key === "Escape") { search.value = ""; S.q = ""; refreshList(true); search.blur(); } };

  $("#reader-body").addEventListener("click", (ev) => {
    const a = ev.target.closest("a.wikilink");
    if (!a) return;
    ev.preventDefault();
    openEntryByPath(a.dataset.path);
  });

  $("#items").onscroll = () => {
    const box = $("#items");
    if (S.hasMore && !S.loading &&
        box.scrollTop + box.clientHeight > box.scrollHeight - 400) {
      // 显示加载指示器
      let spinner = $("#load-spinner");
      if (!spinner) {
        spinner = el("div", "load-spinner", '<span class="spin-dot"></span> 加载中…');
        spinner.id = "load-spinner";
        box.appendChild(spinner);
      }
      refreshList(false).finally(() => { spinner?.remove(); });
    }
  };

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
    if (typing) {
      // 搜索框内：Enter 跳到第一条结果，ArrowDown 也跳
      if ((e.key === "Enter" || e.key === "ArrowDown") && S.items.length) {
        e.preventDefault();
        search.blur();
        selectIndex(0, true);
      }
      return;
    }
    if (e.key === "/") { e.preventDefault(); search.focus(); return; }
    if (!S.items.length || S.mode !== "list") return;
    const idx = S.items.findIndex((x) => x.id === S.selected);
    if (e.key === "Enter") {
      e.preventDefault();
      const it = S.items[idx];
      if (it?.link) window.open(it.link, "_blank");
      return;
    }
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      let next = Math.min(idx + 1, S.items.length - 1);
      if (e.shiftKey) { while (next < S.items.length - 1 && S.items[next].read) next++; }
      selectIndex(next, true);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      let prev = Math.max(idx - 1, 0);
      if (e.shiftKey) { while (prev > 0 && S.items[prev].read) prev--; }
      selectIndex(prev, true);
    } else if (e.key === "m") {
      e.preventDefault();
      const it = S.items[idx];
      if (it) markRead([it.id], !it.read);
    } else if (e.key === "s") {
      e.preventDefault();
      if (S.items[idx]) toggleStar(S.items[idx].id);
    } else if (e.key === "o") {
      e.preventDefault();
      const it = S.items[idx];
      if (it?.link) window.open(it.link, "_blank");
    }
  });
}

/* 打开面板时若索引超过 2 小时没更新，后台静默增量扫一次。
   增量是纯 stat 扫描（实测 0.3s），所以可以放心在每次打开时跑。 */
const STALE_MS = 2 * 3600 * 1000;

async function autoRefreshIfStale() {
  const last = S.boot?.last_indexed ? new Date(S.boot.last_indexed).getTime() : 0;
  if (Date.now() - last < STALE_MS) return;
  try {
    const r = await api("/intel-station/api/refresh", { method: "POST" });
    if (r.stats.upserted > 0) {
      await reloadBoot();
      if (!S.userTouched) {
        refreshList(true);
        toast(`发现 ${r.stats.upserted} 条新内容`);
      } else {
        toast(`后台已更新 ${r.stats.upserted} 条新内容`);
      }
    }
  } catch (e) { /* 后台任务，失败不打扰 */ }
}

/* ───────────────────────── 启动 ───────────────────────── */
(async function start() {
  bind();
  try {
    await reloadBoot();
  } catch (e) {
    document.body.innerHTML =
      `<div style="padding:40px;font-family:system-ui">
        无法连接后端：${esc(e.message)}<br><br>
        请先运行 <code>python3 folio/server.py</code>
       </div>`;
    return;
  }

  // 首次 onboarding
  if (!localStorage.getItem("liuer_onboarded")) {
    showOnboarding();
  }

  readHash();
  if (S.q) $("#search").value = S.q;
  renderFilters();
  if (S.mode === "weekly") { renderSidebar(); openWeekly(); autoRefreshIfStale(); return; }
  if (S.mode === "subscribe") { renderSidebar(); openSubscribe(); autoRefreshIfStale(); return; }
  if (S.mode === "filters") { renderSidebar(); openFilters(); autoRefreshIfStale(); return; }
  refreshList(true);
  autoRefreshIfStale();
})();

/* ───────────────────────── Onboarding ───────────────────────── */
function showOnboarding() {
  const overlay = el("div", "onboard-overlay");
  overlay.innerHTML = `
    <div class="onboard-card">
      <img src="web/mascot.png" alt="六耳" class="onboard-mascot" />
      <h2>欢迎来到六耳情报站</h2>
      <p class="onboard-sub">你的 AI 资讯中枢，每天 5 分钟掌握全局</p>
      <div class="onboard-steps">
        <div class="onboard-step">
          <span class="step-num">1</span>
          <div><b>先加订阅</b><br>在「订阅管理」里粘贴 RSS 地址或导入 OPML</div>
        </div>
        <div class="onboard-step">
          <span class="step-num">2</span>
          <div><b>抓取与阅读</b><br>点「立即抓取」，然后 j/k 上下翻 · m 已读</div>
        </div>
        <div class="onboard-step">
          <span class="step-num">3</span>
          <div><b>全文搜索</b><br>按 / 搜标题、摘要和正文</div>
        </div>
      </div>
      <button class="onboard-btn" id="onboard-dismiss">开始使用</button>
    </div>`;
  document.body.appendChild(overlay);
  $("#onboard-dismiss").onclick = () => {
    localStorage.setItem("liuer_onboarded", "1");
    overlay.remove();
  };
  overlay.onclick = (e) => { if (e.target === overlay) $("#onboard-dismiss").click(); };
}

async function openFilters() {
  S.mode = "filters";
  syncHash();
  renderSidebar();
  document.querySelectorAll(".card.active").forEach((n) => n.classList.remove("active"));
  $("#list-title").textContent = "过滤设置";
  $("#list-sub").textContent = "";
  $("#items").innerHTML = `<div class="empty-list">左侧配置关键词规则<br>保存后点「应用到已有内容」<br><br>← 点左侧任意入口返回列表</div>`;
  $("#reader-empty").hidden = true;
  const body = $("#reader-body");
  body.hidden = false;

  body.innerHTML = `<div class="filters-page">
    <h1>过滤设置</h1>
    <p class="filters-hint">配置关键词规则，从全量抓取里筛出你真正关心的内容。</p>

    <div class="filter-section">
      <h3>包含关键词</h3>
      <p class="filter-desc">命中越多分越高 —— 标题 +40 · 摘要 +20 · 正文 +10</p>
      <textarea id="filter-include" class="filter-textarea" rows="5" placeholder="AI
LLM
创业"></textarea>
    </div>

    <div class="filter-section">
      <h3>排除关键词</h3>
      <p class="filter-desc">命中任意一个直接扣 100 分（用于挡掉招聘、广告等噪音）</p>
      <textarea id="filter-exclude" class="filter-textarea" rows="4" placeholder="招聘
广告
推广"></textarea>
    </div>

    <div class="filter-section">
      <h3>最低分数</h3>
      <p class="filter-desc">「精选」视图只显示分数 ≥ 此值的内容（0-100，建议 40-60）</p>
      <input id="filter-minscore" type="number" min="0" max="100" value="50" class="filter-input">
      <span class="filter-minscore-hint">分数越高越严格</span>
    </div>

    <div class="filter-actions">
      <button id="btn-save-filters" class="filter-save-btn">保存设置</button>
      <button id="btn-apply-filters" class="filter-apply-btn">应用到已有内容</button>
    </div>
    <p class="filter-status" id="filter-status"></p>
  </div>`;

  // 加载当前配置
  try {
    const config = await api("/intel-station/api/config");
    $("#filter-include").value = (config.include || []).join("\n");
    $("#filter-exclude").value = (config.exclude || []).join("\n");
    $("#filter-minscore").value = config.minScore ?? 50;
  } catch (e) {
    $("#filter-status").textContent = "加载配置失败：" + e.message;
  }

  const parseLines = (v) => v.split("\n").map((x) => x.trim()).filter(Boolean);

  $("#btn-save-filters").onclick = async () => {
    const btn = $("#btn-save-filters");
    btn.disabled = true;
    try {
      await api("/intel-station/api/config", {
        method: "POST",
        body: {
          include: parseLines($("#filter-include").value),
          exclude: parseLines($("#filter-exclude").value),
          minScore: parseInt($("#filter-minscore").value, 10) || 50,
        },
      });
      $("#filter-status").textContent = "已保存。点「应用到已有内容」让规则对旧内容生效。";
      await reloadBoot();
      renderSidebar();
    } catch (e) {
      $("#filter-status").textContent = "保存失败：" + e.message;
    }
    btn.disabled = false;
  };

  $("#btn-apply-filters").onclick = async () => {
    const btn = $("#btn-apply-filters");
    btn.disabled = true;
    btn.textContent = "应用中…";
    try {
      const r = await api("/intel-station/api/apply-filters", { method: "POST" });
      $("#filter-status").textContent = `已对 ${r.scored} 篇内容重新评分。`;
      await reloadBoot();
      renderSidebar();
    } catch (e) {
      $("#filter-status").textContent = "应用失败：" + e.message;
    }
    btn.disabled = false;
    btn.textContent = "应用到已有内容";
  };
}

