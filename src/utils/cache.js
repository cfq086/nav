/**
 * 缓存版本治理与失效控制
 * 基于 KV (NAV_AUTH) 中的 DATA_VERSION 键，实现全球 Cloudflare 边缘节点毫秒级主动失效
 */

export async function getDataVersion(env) {
  try {
    if (!env || !env.NAV_AUTH) return '1';
    return (await env.NAV_AUTH.get('DATA_VERSION')) || '1';
  } catch (_) {
    return '1';
  }
}

export async function bumpDataVersion(env) {
  try {
    if (!env || !env.NAV_AUTH) return;
    await env.NAV_AUTH.put('DATA_VERSION', Date.now().toString());
  } catch (err) {
    console.error('Failed to update DATA_VERSION in KV:', err);
  }
}
