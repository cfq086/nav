-- 网站配置表
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  logo TEXT,
  desc TEXT,
  catelog TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 9999,
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 待审核网站表
CREATE TABLE IF NOT EXISTS pending_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  logo TEXT,
  desc TEXT,
  catelog TEXT NOT NULL,
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 分类排序表
CREATE TABLE IF NOT EXISTS category_orders (
  catelog TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 9999
);

-- ================= 索引优化补丁（消除全表扫描与临时表排序） =================
-- 1. 覆盖全量与分页排序查询
CREATE INDEX IF NOT EXISTS idx_sites_sort ON sites (sort_order ASC, create_time DESC);

-- 2. 覆盖分类过滤、分类排序及 GROUP BY 聚合查询
CREATE INDEX IF NOT EXISTS idx_sites_catelog_sort ON sites (catelog, sort_order ASC, create_time DESC);

-- 3. 覆盖待审核站点按时间倒序查询
CREATE INDEX IF NOT EXISTS idx_pending_sites_create_time ON pending_sites (create_time DESC);
