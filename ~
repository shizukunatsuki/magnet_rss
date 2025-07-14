// src/index.js

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

    // 基本的路由逻辑
    if (url.pathname === '/rss' && request.method === 'GET') {
      return this.handleRssRequest(request, env);
    }

    if (url.pathname === '/update' && request.method === 'POST') {
      return this.handleUpdateRequest(request, env);
    }

    // 默认返回 404
    return new Response('Not Found', { status: 404 });
  },

  /**
   * 处理 RSS 订阅请求
   * @param {Request} request
   * @param {object} env
   * @returns {Promise<Response>}
   */
  async handleRssRequest(request, env) {
    const magnetLink = await env.MAGNET_KV.get('latest_magnet');

    if (!magnetLink) {
      return new Response('Magnet link not set yet.', { status: 404 });
    }

    // 生成 RSS XML
    const rssFeed = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
  <title>Latest Magnet Link</title>
  <link>${new URL(request.url).origin}</link>
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
        'Cache-Control': 's-maxage=3600' // 缓存1小时
      },
    });
  },

  /**
   * 处理更新 magnet 链接的请求
   * @param {Request} request
   * @param {object} env
   * @returns {Promise<Response>}
   */
  async handleUpdateRequest(request, env) {
    // 1. 认证
    const authHeader = request.headers.get('Authorization');
    const expectedToken = `Bearer ${env.MAGNET_RSS_KEY}`;

    if (!authHeader || authHeader !== expectedToken) {
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
  },
};
