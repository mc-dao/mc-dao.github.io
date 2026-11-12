/* 页面完全由 site.json 驱动；线路状态由访客浏览器直接探测 */

const state = {
  check: {},
  busy: false,
  timer: null,
  lastAt: 0,
};

const $ = (id) => document.getElementById(id);

boot();

async function boot() {
  let cfg = null;

  try {
    cfg = await getJSON('/api/site');
  } catch {
    try {
      cfg = await getJSON('/site.json');
    } catch {
      $('groups').innerHTML = '<p class="empty">配置加载失败，请检查 config/site.json 是否存在且为合法 JSON</p>';
      return;
    }
  }

  applySite(cfg.site || {});
  state.check = cfg.check || {};
  render(cfg.groups || []);

  if (state.check.enabled === false) {
    document.body.classList.add('static');
    $('check-info').textContent = '已关闭线路检测';
    $('refresh').style.display = 'none';
    return;
  }

  $('refresh').addEventListener('click', () => poll(true));
  await poll(true);
  schedule();
}

function applySite(site) {
  if (site.title) {
    document.title = site.title;
    const title = $('site-title');
    if (title) title.textContent = site.title;
  }
  if (site.name) $('site-name').textContent = site.name;
  if (site.subtitle) $('site-subtitle').textContent = site.subtitle;
  if (site.description) {
    const tag = document.querySelector('meta[name="description"]');
    if (tag) tag.setAttribute('content', site.description);
  }
  if (site.domain) $('site-domain').textContent = site.domain;
  $('site-footer').textContent = site.footer || '';
}

/* ---------------- 渲染 ---------------- */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function render(groups) {
  const root = $('groups');
  root.innerHTML = '';

  if (!groups.length) {
    root.append(el('p', 'empty', '暂无线路，请在 config/site.json 中添加'));
    return;
  }

  for (const group of groups) {
    const card = el('section', 'card');
    const items = group.items || [];

    const head = el('div', 'card-head');
    const headMain = el('div', 'card-main');
    headMain.append(el('h2', 'section-title', group.title || ''));
    if (group.description) headMain.append(el('p', 'card-desc', group.description));
    head.append(headMain, el('span', 'card-count', String(items.length).padStart(2, '0') + ' 条'));
    card.append(head);

    const list = el('div', 'list');
    for (const item of items) list.append(renderItem(item));
    card.append(list);

    root.append(card);
  }
}

function renderItem(item) {
  const link = el('a', 'item');
  link.href = item.url;
  link.rel = 'noopener noreferrer';
  if (/^https?:/i.test(item.url || '')) link.target = '_blank';

  const badges = Array.isArray(item.badges) ? item.badges : [];
  if (badges.some((badge) => badge.tone === 'gold')) link.classList.add('featured');

  const top = el('div', 'item-top');
  top.append(el('span', 'name', item.name || item.url || ''));

  const status = el('div', 'status');
  const probeable = item.check !== false && /^https?:\/\//i.test(item.url || '');

  if (probeable) {
    status.dataset.url = item.url;
    const pill = el('span', 'pill unknown');
    pill.append(el('i', 'dot'), el('span', 'label', '未检测'));
    status.append(pill, el('span', 'ms', ''));
  } else {
    const pill = el('span', 'pill flat');
    pill.textContent = '—';
    status.append(pill);
  }
  top.append(status);
  link.append(top);

  if (item.description) link.append(el('p', 'desc', item.description));

  const foot = el('div', 'item-foot');
  if (badges.length) {
    const wrap = el('div', 'badges');
    for (const badge of badges) {
      wrap.append(el('span', `badge ${badge.tone || 'muted'}`, badge.text || ''));
    }
    foot.append(wrap);
  }
  foot.append(el('span', 'jump', '↗'));
  link.append(foot);

  return link;
}

/* ---------------- 客户端探测 ---------------- */

async function poll(force) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add('checking');
  $('refresh').disabled = true;
  $('check-info').textContent = '正在通过本机网络检测…';

  const cells = Array.from(document.querySelectorAll('.status[data-url]'));
  if (force) {
    // 重新检测时先恢复所有条目，等结果出来再统一隐藏
    document.querySelectorAll('.item.is-hidden').forEach((item) => item.classList.remove('is-hidden'));
    document.querySelectorAll('.card.is-hidden').forEach((card) => card.classList.remove('is-hidden'));
    cells.forEach((cell) => paint(cell, { status: 'checking' }));
  }

  const timeout = Math.max(1500, Number(state.check.timeout) || 6000);
  const method = String(state.check.method || 'HEAD').toUpperCase() === 'GET' ? 'GET' : 'HEAD';
  const limit = Math.max(1, Math.min(Number(state.check.concurrency) || 4, cells.length || 1));
  let cursor = 0;

  const worker = async () => {
    while (cursor < cells.length) {
      const cell = cells[cursor++];
      paint(cell, await probe(cell.dataset.url, method, timeout));
    }
  };

  try {
    await Promise.all(Array.from({ length: limit }, worker));
    applyVisibility(cells);
    state.lastAt = Date.now();
    $('check-info').textContent =
      '本机检测完成 · ' + new Date(state.lastAt).toLocaleTimeString('zh-CN', { hour12: false });
  } finally {
    state.busy = false;
    document.body.classList.remove('checking');
    $('refresh').disabled = false;
  }
}

/* 隐藏本机不可达的条目与整组卡片，并同步计数 */
function applyVisibility(cells) {
  for (const cell of cells) {
    const item = cell.closest('.item');
    if (!item) continue;
    if (cell.dataset.status === 'down') item.classList.add('is-hidden');
    else if (cell.dataset.status === 'up') item.classList.remove('is-hidden');
  }

  const cards = Array.from(document.querySelectorAll('#groups .card'));
  for (const card of cards) {
    const items = Array.from(card.querySelectorAll('.item'));
    const visible = items.filter((item) => !item.classList.contains('is-hidden')).length;
    card.classList.toggle('is-hidden', items.length > 0 && visible === 0);

    const count = card.querySelector('.card-count');
    if (count) count.textContent = String(visible).padStart(2, '0') + ' 条';
  }

  const note = $('all-down');
  if (note) note.hidden = cards.length === 0 || cards.some((card) => !card.classList.contains('is-hidden'));
}

async function probe(url, method, timeout) {
  // HTTPS 页面里的 HTTP 请求会被浏览器直接拦截，提前说明原因
  if (location.protocol === 'https:' && /^http:/i.test(url)) {
    return { status: 'down', ms: null, error: 'HTTPS 页面无法探测 HTTP 线路' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = performance.now();

  try {
    // no-cors：不要求目标站配置 CORS，但响应为 opaque，读不到状态码
    await fetch(url, {
      method,
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    return { status: 'up', ms: Math.round(performance.now() - started) };
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return {
      status: 'down',
      ms: Math.round(performance.now() - started),
      error: timedOut ? '超时' : '网络不可达',
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function paint(cell, result) {
  const pill = cell.querySelector('.pill');
  const label = cell.querySelector('.label');
  const ms = cell.querySelector('.ms');
  if (!pill || !label) return;

  const status = result && result.status ? result.status : 'unknown';
  cell.dataset.status = status;
  pill.className = 'pill ' + status;
  label.textContent =
    status === 'up' ? '可达' : status === 'down' ? '不可达' : status === 'checking' ? '检测中' : '未检测';

  if (ms) ms.textContent = result && result.ms != null ? result.ms + 'ms' : '';

  if (status === 'checking') {
    pill.title = '正在从当前设备发起探测';
    return;
  }

  const detail = result
    ? [result.ms != null ? result.ms + ' ms' : null, result.error || '本机网络可达，仅代表连接通畅']
        .filter(Boolean)
        .join(' · ')
    : '';
  pill.title = detail;
}

function schedule() {
  const interval = Math.max(15000, Number(state.check.interval) || 60000);
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (!document.hidden) poll(false);
  }, interval);
}

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
