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

    // 路由逻辑
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
   * 从 KV 存储中读取最新的 magnet 链接，并生成 RSS XML 响应。
   * @param {Request} request
   * @param {object} env
   * @returns {Promise<Response>}
   */
  async handleRssRequest(request, env) {
    const magnetLink = await env.MAGNET_KV.get('latest_magnet');

    if (!magnetLink) {
      return new Response('Magnet link not set yet.', { status: 404 });
    }

    // 对 magnetLink 进行 XML 转义，用于 <guid> 标签
    // <![CDATA[...]]> 内部的内容不需要转义，但 <guid> 标签直接包含内容时需要
    const escapedMagnetLink = this.escapeXml(magnetLink);

    // 生成 RSS XML 字符串
    const rssFeed = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
  <title>Latest Magnet Link</title>
  <link>${new URL(request.url).origin}</link>
  <description>This feed provides the latest magnet link.</description>
  <item>
    <title>Latest Item</title>
    <link><![CDATA[${magnetLink}]]></link>
    <guid isPermaLink="false">${escapedMagnetLink}</guid>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <description><![CDATA[Magnet Link: ${magnetLink}]]></description>
  </item>
</channel>
</rss>`;

    return new Response(rssFeed, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 's-maxage=3600' // 缓存1小时，减少KV读取次数
      },
    });
  },

  /**
   * 处理更新 magnet 链接的请求
   * 验证 Bearer Token，解析请求体中的新链接，并将其存入 KV 存储。
   * @param {Request} request
   * @param {object} env
   * @returns {Promise<Response>}
   */
  async handleUpdateRequest(request, env) {
    // 1. 认证：从 Authorization 头获取提供的 Token
    const providedToken = request.headers.get('Authorization');
    
    // 从环境变量中获取期望的 Secret Key 字符串
    const secretKey = env.MAGNET_RSS_KEY; 

    // 检查环境变量是否已设置且有效
    if (!secretKey || typeof secretKey !== 'string') {
      return new Response('Server configuration error: MAGNET_RSS_KEY environment variable not set or invalid.', { status: 500 });
    }

    // 构建期望的完整 Bearer Token 字符串
    const expectedToken = `Bearer ${secretKey}`;

    // 使用恒定时间比较函数进行安全认证
    if (!providedToken || !this.timingSafeEqual(providedToken, expectedToken)) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 2. 解析请求体，获取新的 magnet 链接
    try {
      const body = await request.json();
      const newMagnet = body.magnet;

      // 验证 magnet 链接的格式
      if (!newMagnet || typeof newMagnet !== 'string' || !newMagnet.startsWith('magnet:?')) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid or missing "magnet" field in JSON body.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 3. 将新链接存入 KV 存储
      await env.MAGNET_KV.put('latest_magnet', newMagnet);

      return new Response(JSON.stringify({ success: true, message: 'Magnet link updated successfully.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      // 处理 JSON 解析错误
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },

  /**
   * 安全地比较两个字符串，防止时序攻击。
   * 确保两个字符串的长度和内容都完全匹配，但执行时间保持恒定。
   * @param {string} a - 第一个字符串
   * @param {string} b - 第二个字符串
   * @returns {boolean} - 如果两个字符串相同则返回 true，否则返回 false
   */
  timingSafeEqual(a, b) {
    // 确保输入是字符串且长度相同，否则直接返回 false
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
      return false;
    }

    let diff = 0;
    // 逐字符比较，即使发现不匹配也继续比较到最后，以保持恒定时间
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    // 只有当所有字符都匹配时 (diff 为 0) 才返回 true
    return diff === 0;
  },

  /**
   * XML 特殊字符转义函数
   * 将 XML 中具有特殊含义的字符转换为其对应的实体引用。
   * @param {string} unsafe - 包含可能未转义 XML 字符的字符串
   * @returns {string} - 转义后的字符串
   */
  escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, function (c) {
      switch (c) {
        case '<': return '<';
        case '>': return '>';
        case '&': return '&';
        case '\'': return '''; // ✅ 再次确认：这里是正确的字符串字面量 '''
        case '"': return '"';   
        default: return c; 
      }
    });
  }
};
