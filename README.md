## 概述
本服务提供最新的磁力链接 RSS 订阅，并通过安全 API 更新磁力链接。部署完成后，您可以通过以下接口使用服务。

---

## 📡 RSS 订阅接口
获取最新的磁力链接 RSS 订阅源

- **URL**: `/rss`
- **方法**: `GET`
- **认证**: 无需认证
- **响应格式**: `application/xml`
- **缓存**: 30分钟 (客户端可缓存)

### 使用说明
直接访问此端点获取 RSS 订阅源，可添加到任何 RSS 阅读器：
```
https://your-worker-domain.example/rss
```

---

## 🔒 磁力链接更新接口
更新 RSS 中显示的磁力链接

- **URL**: `/update`
- **方法**: `POST`
- **认证**: Bearer Token (在请求头中提供)
- **请求格式**: `application/json`
- **速率限制**: 5次/分钟/IP

### 认证方式
在请求头中添加：
```http
Authorization: Bearer YOUR_MAGNET_RSS_KEY
```

### 请求体格式
```json
{
  "magnet": "完整的磁力链接"
}
```

### 请求示例
```bash
curl -X POST https://your-worker-domain.example/update \
  -H "Authorization: Bearer YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"magnet": "magnet:?xt=urn:btih:00000000000000000000000000000000&dn=test"}'
```

### 验证规则
磁力链接必须满足：
1. 以 `magnet:?xt=urn:btih:` 开头
2. 包含有效的 BTIH 哈希（32-40位字母数字）
3. 可选的显示名称参数 (`&dn=`)
4. 可选的 tracker 参数 (`&tr=`)

---

## 🩺 健康检查接口
检查服务运行状态

- **URL**: `/health`
- **方法**: `GET`
- **响应**: 纯文本 "OK"
- **用途**: 监控服务可用性

```
https://your-worker-domain.example/health
```

---

## ⚠️ 使用注意事项

1. **认证安全**
   - Bearer Token 等同于密码，请妥善保管
   - 不要在客户端代码或公开仓库中暴露 Token
   - 定期轮换 Token (通过 Cloudflare Dashboard)

2. **磁力链接规范**
   - 必须使用完整磁力链接格式
   - 推荐包含 `dn` 参数提供可读名称
   - 示例有效格式：
     ```
     magnet:?xt=urn:btih:00000000000000000000000000000000&dn=test
     ```

3. **更新限制**
   - 每次更新会完全覆盖之前的磁力链接
   - 服务仅维护最新的一条磁力链接
   - 避免高频更新（超过5次/分钟会被限流）

4. **订阅使用**
   - RSS 阅读器会自动检测更新
   - 更新后最多延迟30分钟显示（因缓存机制）
   - 强制刷新可添加参数：`/rss?t=` + 时间戳

---
