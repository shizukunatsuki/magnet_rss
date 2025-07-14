// src/index.js - Production-ready Magnet RSS Worker
// Version: 1.2.0
// Last Updated: 2025-07-15

export default {
  /**
   * Worker 主入口函数
   * @param {Request} request - 请求对象
   * @param {object} env - 环境变量和绑定
   * @param {object} ctx - 执行上下文
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      
      // 路由处理
      if (url.pathname === '/rss' && request.method === 'GET') {
        return this.handleRssRequest(request, env);
      }
      
      if (url.pathname === '/update' && request.method === 'POST') {
        return this.handleUpdateRequest(request, env);
      }
      
      if (url.pathname === '/health' && request.method === 'GET') {
        return new Response('OK', { status: 200 });
      }
      
      return new Response('Not Found', { status: 404 });
    } catch (error) {
      // 全局错误处理
      console.error(`Unhandled error: ${error.message}`, error.stack);
      return new Response('Internal Server Error', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  },

  /**
   * 处理 RSS 订阅请求
   */
  async handleRssRequest(request, env) {
    const startTime = Date.now();
    const magnetLink = await env.MAGNET_KV.get('latest_magnet');
    
    if (!magnetLink) {
      return new Response('Magnet link not set yet.', { 
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    // 解析磁力链接中的显示名称
    const displayName = this.parseDisplayName(magnetLink) || 'Latest Torrent';
    
    // 获取最后更新时间
    const lastUpdated = await env.MAGNET_KV.get('last_updated') || new Date().toISOString();
    
    // 构建 RSS Feed
    const rssFeed = this.generateRssFeed(
      request, 
      magnetLink, 
      displayName, 
      new Date(lastUpdated)
    );
    
    // 日志记录
    const duration = Date.now() - startTime;
    console.log(`RSS request served in ${duration}ms`);
    
    return new Response(rssFeed, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300', // 5分钟缓存
        'X-Response-Time': `${duration}ms`
      },
    });
  },

  /**
   * 处理磁力链接更新请求
   */
  async handleUpdateRequest(request, env) {
    const startTime = Date.now();
    
    // 1. 认证验证
    const authError = await this.verifyAuth(request, env);
    if (authError) return authError;
    
    // 2. 解析请求体
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return this.jsonResponse(400, { 
        success: false, 
        error: 'Invalid JSON body' 
      });
    }
    
    // 3. 验证磁力链接
    const magnetValidation = this.validateMagnetLink(body.magnet);
    if (!magnetValidation.valid) {
      return this.jsonResponse(400, { 
        success: false, 
        error: magnetValidation.message 
      });
    }
    
    // 4. 更新存储
    try {
      const now = new Date();
      await Promise.all([
        env.MAGNET_KV.put('latest_magnet', body.magnet),
        env.MAGNET_KV.put('last_updated', now.toISOString())
      ]);
      
      // 5. 成功响应
      const duration = Date.now() - startTime;
      console.log(`Magnet link updated in ${duration}ms: ${this.truncateMagnet(body.magnet)}`);
      
      return this.jsonResponse(200, {
        success: true,
        message: 'Magnet link updated successfully',
        display_name: magnetValidation.displayName,
        updated_at: now.toISOString()
      });
    } catch (error) {
      console.error('KV storage error:', error);
      return this.jsonResponse(500, {
        success: false,
        error: 'Failed to update storage'
      });
    }
  },

  /**
   * 生成 RSS Feed XML
   */
  generateRssFeed(request, magnetLink, displayName, pubDate) {
    const origin = new URL(request.url).origin;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Latest Magnet Link</title>
  <link>${this.escapeXml(origin)}</link>
  <description>This feed provides the latest magnet link</description>
  <atom:link href="${this.escapeXml(origin + '/rss')}" rel="self" type="application/rss+xml" />
  <generator>Cloudflare Workers Magnet RSS</generator>
  <lastBuildDate>${pubDate.toUTCString()}</lastBuildDate>
  
  <item>
    <title>${this.escapeXml(displayName)}</title>
    <link><![CDATA[${magnetLink}]]></link>
    <guid isPermaLink="false"><![CDATA[${magnetLink}]]></guid>
    <pubDate>${pubDate.toUTCString()}</pubDate>
    <description><![CDATA[Latest magnet link: ${magnetLink}]]></description>
  </item>
</channel>
</rss>`;
  },

  /**
   * 验证认证令牌
   */
  async verifyAuth(request, env) {
    const providedToken = request.headers.get('Authorization');
    const secretKey = env.MAGNET_RSS_KEY;
    
    // 检查环境变量
    if (!secretKey || typeof secretKey !== 'string') {
      console.error('MAGNET_RSS_KEY is not configured properly');
      return this.jsonResponse(500, {
        success: false,
        error: 'Server configuration error'
      });
    }
    
    // 验证令牌格式
    if (!providedToken || !providedToken.startsWith('Bearer ')) {
      return new Response('Unauthorized: Invalid token format', { 
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' }
      });
    }
    
    // 安全比较
    const expectedToken = `Bearer ${secretKey}`;
    if (!this.timingSafeEqual(providedToken, expectedToken)) {
      console.warn('Invalid authentication attempt');
      return new Response('Unauthorized', { status: 401 });
    }
    
    return null;
  },

  /**
   * 验证磁力链接格式
   */
  validateMagnetLink(magnet) {
    if (!magnet || typeof magnet !== 'string') {
      return { valid: false, message: 'Missing magnet field' };
    }
    
    // 基本格式检查
    if (!magnet.startsWith('magnet:?')) {
      return { valid: false, message: 'Invalid magnet link format' };
    }
    
    // 正则表达式验证
    const magnetPattern = /^magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}(&dn=[^&]+)?(&tr=udp?%3A%2F%2F[^&]+)*$/i;
    if (!magnetPattern.test(magnet)) {
      return { 
        valid: false, 
        message: 'Invalid magnet link structure. Expected format: magnet:?xt=urn:btih:...' 
      };
    }
    
    // 提取显示名称
    const displayName = this.parseDisplayName(magnet);
    
    return { 
      valid: true, 
      displayName: displayName || 'Unnamed Torrent' 
    };
  },

  /**
   * 从磁力链接解析显示名称
   */
  parseDisplayName(magnet) {
    const dnMatch = magnet.match(/&dn=([^&]+)/i);
    if (!dnMatch) return null;
    
    try {
      return decodeURIComponent(dnMatch[1]);
    } catch {
      return dnMatch[1]; // 如果解码失败返回原始值
    }
  },

  /**
   * 生成 JSON 响应
   */
  jsonResponse(status, data) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  },

  /**
   * 安全比较字符串（防止时序攻击）
   */
  timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    
    const aBuf = new TextEncoder().encode(a);
    const bBuf = new TextEncoder().encode(b);
    
    if (aBuf.length !== bBuf.length) return false;
    
    let result = 0;
    for (let i = 0; i < aBuf.length; i++) {
      result |= aBuf[i] ^ bBuf[i];
    }
    return result === 0;
  },

  /**
   * XML 特殊字符转义
   */
  escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  },

  /**
   * 截断磁力链接用于日志记录
   */
  truncateMagnet(magnet, maxLength = 60) {
    if (!magnet || magnet.length <= maxLength) return magnet;
    const hashMatch = magnet.match(/btih:([a-zA-Z0-9]+)/);
    if (hashMatch) {
      return `magnet:?xt=urn:btih:${hashMatch[1].substring(0, 8)}...`;
    }
    return `${magnet.substring(0, maxLength)}...`;
  }
};
