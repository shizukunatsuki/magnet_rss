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

    if (url.pathname === '/rss' && request.method === 'GET') {
      return this.handleRssRequest(request, env);
    }

    if (url.pathname === '/update' && request.method === 'POST') {
      return this.handleUpdateRequest(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },

  /**
   * 处理 RSS 订阅请求
   */
  async handleRssRequest(request, env) {
    const magnetLink = await env.MAGNET_KV.get('latest_magnet');

    if (!magnetLink) {
      return new Response('Magnet link not set yet.', { status: 404 });
    }

    // ✅ 关键改动：对 magnetLink 进行 XML 转义，用于 <guid> 标签
    const escapedMagnetLink = this.escapeXml(magnetLink);

    const rssFeed = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
  <title>Latest Magnet Link</title>
  <link>${new URL(request.url).origin}</link>
  <description>This feed provides the latest magnet link.</description>
  <item>
    <title>Latest Item</title>
    <link><![CDATA[${magnetLink}]]></link>
    <guid isPermaLink="false">${escapedMagnetLink}</guid> <!-- 使用转义后的链接 -->
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
  },

  /**
   * 处理更新 magnet 链接的请求
   */
  async handleUpdateRequest(request, env) {
    const providedToken = request.headers.get('Authorization');
    
    const secretKey = env.MAGNET_RSS_KEY; 

    if (!secretKey || typeof secretKey !== 'string') {
      return new Response('Server configuration error: MAGNET_RSS_KEY environment variable not set or invalid.', { status: 500 });
    }

    const expectedToken = `Bearer ${secretKey}`;

    if (!providedToken || !this.timingSafeEqual(providedToken, expectedToken)) {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      const body = await request.json();
      const newMagnet = body.magnet;

      if (!newMagnet || typeof newMagnet !== 'string' || !newMagnet.startsWith('magnet:?')) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid or missing "magnet" field in JSON body.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

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

  /**
   * 安全地比较两个字符串，防止时序攻击。
   */
  timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
      return false;
    }

    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  },

  /**
   * ✅ 新增：XML 特殊字符转义函数
   * @param {string} unsafe - 包含可能未转义 XML 字符的字符串
   * @returns {string} - 转义后的字符串
   */
  escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, function (c) {
      switch (c) {
        case '<': return '<';
        case '>': return '>';
        case '&': return '&';
        case "'": return '''; // For attributes, though not strictly needed for content
        case '"': return '"'; // For attributes, though not strictly needed for content
      }
    });
  }
};
