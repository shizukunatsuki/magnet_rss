// src/index.js - Production-ready Magnet RSS Worker (No Rate Limiting)
// Version: 2.1.0
// Last Updated: 2025-07-15

export default {
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
      console.error(`Unhandled error: ${error.message}`, error.stack);
      return this.jsonResponse(500, {
        error: 'Internal Server Error',
        message: error.message
      });
    }
  },

  async handleRssRequest(request, env) {
    const startTime = Date.now();
    const [magnetLink, lastUpdated] = await Promise.all([
      env.MAGNET_KV.get('latest_magnet'),
      env.MAGNET_KV.get('last_updated')
    ]);
    
    if (!magnetLink) {
      return this.jsonResponse(404, { 
        error: 'Magnet link not available yet' 
      });
    }
    
    const displayName = this.parseDisplayName(magnetLink) || 'Latest Torrent';
    const safeDisplayName = this.sanitizeDisplayName(displayName);
    const pubDate = lastUpdated ? new Date(lastUpdated) : new Date();
    
    const rssFeed = this.generateRssFeed(
      request, 
      magnetLink, 
      safeDisplayName, 
      pubDate
    );
    
    const duration = Date.now() - startTime;
    console.log(`RSS request served in ${duration}ms`);
    
    return new Response(rssFeed, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=1800', // 30分钟缓存
        'X-Response-Time': `${duration}ms`
      },
    });
  },

  async handleUpdateRequest(request, env) {
    const startTime = Date.now();
    
    // 认证验证
    const authError = await this.verifyAuth(request, env);
    if (authError) return authError;
    
    // 解析请求体
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return this.jsonResponse(400, { 
        error: 'Invalid JSON body' 
      });
    }
    
    // 验证磁力链接
    if (!body || typeof body.magnet !== 'string') {
      return this.jsonResponse(400, { 
        error: 'Missing magnet field in request body' 
      });
    }
    
    const magnetValidation = this.validateMagnetLink(body.magnet);
    if (!magnetValidation.valid) {
      return this.jsonResponse(400, { 
        error: magnetValidation.message 
      });
    }
    
    // 更新存储
    try {
      const now = new Date();
      await Promise.all([
        env.MAGNET_KV.put('latest_magnet', body.magnet),
        env.MAGNET_KV.put('last_updated', now.toISOString())
      ]);
      
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
        error: 'Failed to update storage'
      });
    }
  },

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

  async verifyAuth(request, env) {
    const providedToken = request.headers.get('Authorization');
    const secretKey = env.MAGNET_RSS_KEY;
    
    if (!secretKey || typeof secretKey !== 'string') {
      console.error('MAGNET_RSS_KEY is not configured properly');
      return this.jsonResponse(500, {
        error: 'Server configuration error'
      });
    }
    
    if (!providedToken || !providedToken.startsWith('Bearer ')) {
      return this.jsonResponse(401, {
        error: 'Unauthorized: Invalid token format'
      });
    }
    
    const expectedToken = `Bearer ${secretKey}`;
    if (!this.timingSafeEqual(providedToken, expectedToken)) {
      console.warn('Invalid authentication attempt');
      return this.jsonResponse(401, {
        error: 'Unauthorized'
      });
    }
    
    return null;
  },

  validateMagnetLink(magnet) {
    // 基础验证
    if (typeof magnet !== 'string' || magnet.length < 40) {
      return { valid: false, message: 'Invalid magnet format' };
    }
    
    // 核心磁力链接验证
    const magnetPattern = /^magnet:\?xt=urn:btih:([a-zA-Z0-9]{32,40})/i;
    if (!magnetPattern.test(magnet)) {
      return { 
        valid: false, 
        message: 'Invalid magnet link. Must start with "magnet:?xt=urn:btih:"' 
      };
    }
    
    const displayName = this.parseDisplayName(magnet);
    
    return { 
      valid: true, 
      displayName: displayName || 'Unnamed Torrent' 
    };
  },

  parseDisplayName(magnet) {
    const dnMatch = magnet.match(/&dn=([^&]+)/i);
    if (!dnMatch) return null;
    
    try {
      return decodeURIComponent(dnMatch[1]);
    } catch {
      return dnMatch[1];
    }
  },

  sanitizeDisplayName(name) {
    // 移除可能的不安全字符（保留基本字母数字和常见标点）
    return name.replace(/[^\w\s.\-!?()\[\]{}@]/gi, '');
  },

  jsonResponse(status, data) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  },

  timingSafeEqual(a, b) {
    const aBuf = new TextEncoder().encode(a);
    const bBuf = new TextEncoder().encode(b);
    
    if (aBuf.length !== bBuf.length) return false;
    
    let result = 0;
    for (let i = 0; i < aBuf.length; i++) {
      result |= aBuf[i] ^ bBuf[i];
    }
    return result === 0;
  },

  escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, (c) => ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '\'': '&apos;',
      '"': '&quot;'
    }[c] || c));
  },

  truncateMagnet(magnet) {
    const hashMatch = magnet.match(/btih:([a-zA-Z0-9]{8})/i);
    return hashMatch 
      ? `magnet:?xt=urn:btih:${hashMatch[1]}...` 
      : `${magnet.substring(0, 60)}...`;
  }
};