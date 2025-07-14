// src/index.js

/**
 * 安全地比较两个字符串，防止时序攻击。
 * 这是一个独立的辅助函数，不依赖于 'this'。
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
  // 确保输入是字符串，如果不是则视为不匹配
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}


export default {
  /**
   * Worker 的主入口函数
   * @param {Request} request - 收到的请求对象
   * @param {object} env - 环境变量和绑定 (KV, Secrets)
   * @param {object} ctx - 执行上下文
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- 路由 1: GET /rss ---
    if (url.pathname === '/rss' && request.method === 'GET') {
      const magnetLink = await env.MAGNET_KV.get('latest_magnet');

      if (!magnetLink) {
        return new Response('Magnet link not set yet.', { status: 404 });
      }

      const rssFeed = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
  <title>Latest Magnet Link</title>
  <link>${url.origin}</link>
  <description>This feed provides the latest magnet link.</description>
  <item>
    <title>Latest Item</title>
    <link><![CDATA[${magnetLink}]]></link>
    <guid isPermaLink="false">${magnetLink}</guid>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <description><![CDATA[Magnet Link: ${magnetLink}]]></description>
  </item>
</channel>
</rss>`;

      return new Response(rssFeed, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 's-maxage=3600',
        },
      });
    }

    // --- 路由 2: POST /update ---
    if (url.pathname === '/update' && request.method === 'POST') {
      // 1. 认证
      const providedToken = request.headers.get('Authorization');
      
      // ✅✅✅ 最终修复：严格按照官方文档，从 Secret Store 获取 Secret 的值
      const secretKey = await env.MAGNET_RSS_KEY.get();

      if (!secretKey) {
        return new Response('Server configuration error: Secret key is not configured in the store.', { status: 500 });
      }

      const expectedToken = `Bearer ${secretKey}`;

      // ✅ 使用独立的、更健壮的辅助函数进行安全认证
      if (!timingSafeEqual(providedToken, expectedToken)) {
        return new Response('Unauthorized', { status: 401 });
      }

      // 2. 解析请求体
      try {
        const body = await request.json();
        const newMagnet = body.magnet;

        if (!newMagnet || typeof newMagnet !== 'string' || !newMagnet.startsWith('magnet:?')) {
          return new Response(JSON.stringify({ success: false, error: 'Invalid or missing "magnet" field in JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // 3. 存入 KV
        await env.MAGNET_KV.put('latest_magnet', newMagnet);

        return new Response(JSON.stringify({ success: true, message: 'Magnet link updated successfully.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // --- 默认返回 404 ---
    return new Response('Not Found', { status: 404 });
  },
};
