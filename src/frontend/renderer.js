import { escapeHTML, sanitizeUrl } from '../utils/html.js';
import { normalizeSortOrder } from '../utils/sort.js';
import { isSubmissionEnabled, isAdminAuthenticated } from '../admin/auth.js';
import { getDataVersion } from '../utils/cache.js';
import frontendTemplate from '../templates/frontend.html';

export async function handleFrontendRequest(request, env, ctx) {
  const url = new URL(request.url);
  const cache = caches.default;

  // 1. 获取全局数据版本号，组装边缘缓存 Cache Key
  const dataVersion = await getDataVersion(env);
  const cacheUrl = new URL(url.origin + url.pathname);
  if (url.searchParams.has('catalog')) {
    cacheUrl.searchParams.set('catalog', url.searchParams.get('catalog'));
  }
  cacheUrl.searchParams.set('_v', dataVersion);
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  // 2. 检查 ?nocache 权限（必须有管理员鉴权才允许穿透）
  const isNoCache = url.searchParams.get('nocache') === '1';
  let isAdmin = false;
  if (isNoCache) {
    try {
      isAdmin = await isAdminAuthenticated(request, env);
    } catch (_) {
      isAdmin = false;
    }
  }
  const shouldBypassCache = isNoCache && isAdmin;

  // 3. 尝试读取 Cloudflare 边缘缓存（非管理员穿透的 GET 请求）
  if (!shouldBypassCache && request.method === 'GET') {
    try {
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const response = new Response(cachedResponse.body, cachedResponse);
        response.headers.set('X-Cache-Status', 'HIT');
        return response;
      }
    } catch (_) {}
  }

  // 4. 回源查询 D1 数据库（利用 idx_sites_sort 索引）
  let sites = [];
  try {
    const { results } = await env.NAV_DB.prepare(
      'SELECT id, name, url, logo, desc, catelog, sort_order FROM sites ORDER BY sort_order ASC, create_time DESC'
    ).all();
    sites = results || [];
  } catch (e) {
    return new Response(`Database Error: ${e.message}`, { status: 500 });
  }

  const totalSites = sites.length;

  // 5. 统计分类数据与分类排序
  const categoryCountMap = new Map();
  const categoryMinSort = new Map();
  const categorySet = new Set();

  sites.forEach((site) => {
    const name = (site.catelog || '').trim() || '未分类';
    categorySet.add(name);
    categoryCountMap.set(name, (categoryCountMap.get(name) || 0) + 1);

    const raw = Number(site.sort_order);
    const normalized = Number.isFinite(raw) ? raw : 9999;
    if (!categoryMinSort.has(name) || normalized < categoryMinSort.get(name)) {
      categoryMinSort.set(name, normalized);
    }
  });

  const categoryOrderMap = new Map();
  try {
    const { results: orderRows } = await env.NAV_DB.prepare('SELECT catelog, sort_order FROM category_orders').all();
    (orderRows || []).forEach(row => categoryOrderMap.set(row.catelog, normalizeSortOrder(row.sort_order)));
  } catch (error) {
    if (!/no such table/i.test(error.message || '')) {
      return new Response(`Database Error: ${error.message}`, { status: 500 });
    }
  }

  const catalogsWithMeta = Array.from(categorySet).map((name) => {
    const fallbackSort = categoryMinSort.has(name) ? normalizeSortOrder(categoryMinSort.get(name)) : 9999;
    const order = categoryOrderMap.has(name) ? categoryOrderMap.get(name) : fallbackSort;
    return { name, order, fallback: fallbackSort };
  });

  catalogsWithMeta.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.fallback !== b.fallback) return a.fallback - b.fallback;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base' });
  });

  const catalogs = catalogsWithMeta.map(item => item.name);

  // 6. 构造侧边栏分类标签
  const catalogLinkMarkup = catalogs.map((cat) => {
    const safeCat = escapeHTML(cat);
    const count = categoryCountMap.get(cat) || 0;
    return `<a href="javascript:void(0);" data-catalog="${safeCat}" data-catalog-name="${safeCat}" class="catalog-link">
      <span>${safeCat}</span>
      <span class="catalog-count">${count}</span>
    </a>`;
  }).join('');

  const datalistOptions = catalogs.map(cat => `<option value="${escapeHTML(cat)}">`).join('');
  const submissionEnabled = isSubmissionEnabled(env);

  // 7. 渲染全量站点卡片（在客户端即时过滤与搜索，解决分类下搜索漏数据的 Bug）
  const siteCardsHtml = sites.map((site) => {
    const rawName = site.name || '未命名';
    const rawDesc = site.desc || '暂无详细描述';
    const normalizedUrl = sanitizeUrl(site.url);
    const hrefValue = escapeHTML(normalizedUrl || '#');

    let displayDomain = '';
    try {
      if (normalizedUrl) {
        const u = new URL(normalizedUrl);
        displayDomain = u.hostname;
      }
    } catch (_) {
      displayDomain = normalizedUrl;
    }

    const safeDisplayDomain = escapeHTML(displayDomain || '链接直达');
    const dataUrlAttr = escapeHTML(normalizedUrl || '');
    const logoUrl = sanitizeUrl(site.logo);
    const cardInitial = escapeHTML((rawName.trim().charAt(0) || '站').toUpperCase());
    const safeName = escapeHTML(rawName);
    const safeCatalog = escapeHTML(site.catelog || '未分类');
    const safeDesc = escapeHTML(rawDesc);
    const safeDataName = escapeHTML(site.name || '');
    const safeDataCatalog = escapeHTML(site.catelog || '');
    const safeDataDesc = escapeHTML(site.desc || '');
    const hasValidUrl = Boolean(normalizedUrl);

    return `<div class="site-card" data-id="${site.id}" data-name="${safeDataName}" data-url="${dataUrlAttr}" data-catalog="${safeDataCatalog}" data-desc="${safeDataDesc}">
  <a href="${hrefValue}" ${hasValidUrl ? 'target="_blank" rel="noopener noreferrer"' : ''} class="card-main-link">
    <div class="card-header">
      ${logoUrl
        ? `<img src="${escapeHTML(logoUrl)}" alt="${safeName}" class="site-logo" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
           <div class="site-fallback-logo" style="display:none;">${cardInitial}</div>`
        : `<div class="site-fallback-logo">${cardInitial}</div>`
      }
      <div class="site-info">
        <h3 class="site-name" title="${safeName}">${safeName}</h3>
        <span class="site-category-badge">${safeCatalog}</span>
      </div>
    </div>
    <p class="site-desc" title="${safeDesc}">${safeDesc}</p>
  </a>
  <div class="card-footer">
    <span class="site-domain" title="${dataUrlAttr}">${safeDisplayDomain}</span>
    <button type="button" class="btn-copy-url" data-url="${dataUrlAttr}" title="复制链接">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      <span>复制</span>
    </button>
  </div>
</div>`;
  }).join('');

  // 8. 填充模板
  const html = renderTemplate(frontendTemplate, {
    CATALOG_LINKS: catalogLinkMarkup,
    SUBMISSION_ACTION: buildSubmissionActionHtml(submissionEnabled),
    TOTAL_SITES: String(totalSites),
    SITE_CARDS: siteCardsHtml,
    ADD_SITE_MODAL: buildAddSiteModalHtml(submissionEnabled, datalistOptions),
  });

  // 9. 构建响应与边缘缓存头（CDN 缓存 24 小时 + SWR 1 小时）
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=60, s-maxage=86400, stale-while-revalidate=3600',
    'X-Cache-Status': shouldBypassCache ? 'BYPASS' : 'MISS',
  });

  const response = new Response(html, { headers });

  // 10. 异步写入 Worker 边缘缓存
  if (!shouldBypassCache && request.method === 'GET' && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

function buildSubmissionActionHtml(submissionEnabled) {
  return submissionEnabled
    ? `<button type="button" id="addSiteBtnSidebar" class="btn-submit-nav">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>提交新书签</span>
      </button>`
    : `<div style="font-size: 11.5px; color: var(--text-muted); text-align: center; padding: 6px 0;">书签投稿暂已关闭</div>`;
}

function buildAddSiteModalHtml(submissionEnabled, datalistOptions) {
  if (!submissionEnabled) return '';
  return `<div id="addSiteModal" class="modal-overlay">
    <div class="modal-card">
      <div class="modal-header">
        <h2 class="modal-title">提交新书签</h2>
        <button type="button" id="closeModal" class="btn-close-modal">&times;</button>
      </div>
      <form id="addSiteForm">
        <div class="form-group">
          <label for="addSiteName" class="form-label">网站名称</label>
          <input type="text" id="addSiteName" required class="form-input" placeholder="例如：GitHub">
        </div>
        <div class="form-group">
          <label for="addSiteUrl" class="form-label">网站链接 (URL)</label>
          <input type="url" id="addSiteUrl" required class="form-input" placeholder="https://example.com">
        </div>
        <div class="form-group">
          <label for="addSiteLogo" class="form-label">Logo 图标链接 (可选)</label>
          <input type="url" id="addSiteLogo" class="form-input" placeholder="https://example.com/logo.png">
        </div>
        <div class="form-group">
          <label for="addSiteCatelog" class="form-label">分类</label>
          <input type="text" id="addSiteCatelog" required class="form-input" list="catalogDatalist" placeholder="选择或输入新分类">
          <datalist id="catalogDatalist">${datalistOptions}</datalist>
        </div>
        <div class="form-group">
          <label for="addSiteDesc" class="form-label">简短描述 (可选)</label>
          <textarea id="addSiteDesc" rows="2" class="form-input" placeholder="简单介绍该网站的主要用途..."></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" id="cancelAddSite" class="btn-cancel">取消</button>
          <button type="submit" class="btn-save">提交审核</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderTemplate(template, values) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}
