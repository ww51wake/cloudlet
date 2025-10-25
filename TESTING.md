# 免费临时文件分享测试说明

## 前提条件
- 安装了 Node.js 和 npm
- 拥有 Workers 访问权限的 Cloudflare 账户
- 安装了 Wrangler CLI (`npm install -g wrangler`)

## 设置步骤

1. 安装项目依赖：
```bash
npm install
```

2. 登录 Cloudflare：
```bash
wrangler login
```

3. 创建 KV 命名空间（预览环境用于本地测试）：
```bash
wrangler kv namespace create "FILE_METADATA" --preview
wrangler kv namespace create "FILE_TOKENS" --preview
```

4. 使用返回的命名空间 ID 和账户信息更新 `wrangler.toml`
   - 确保 `pages_build_output_dir = "public"` 配置正确
   - 使用从 Cloudflare Dashboard 获取的 `account_id` 和 `zone_id`
   - 使用创建命名空间时返回的 ID 更新 KV 配置
   - 注意：本地测试环境使用 `[env.preview]`，生产环境使用 `[env.production]`

5. 本地测试：
```bash
wrangler pages dev public
```

如果遇到KV连接问题，请确保：
- 已创建预览环境的KV命名空间
- `wrangler.toml`中的预览环境配置使用了正确的预览命名空间ID
- 或者使用本地KV模拟：
```bash
wrangler pages dev public --kv=FILE_METADATA --kv=FILE_TOKENS
```

## 测试场景

### 1. 上传测试
- 导航到主页
- 上传一个小文本文件（< 1MB）
- 验证您获得分享链接
- 检查链接是否可以用于下载

### 2. 文件大小验证
- 尝试上传大于 25MB 的文件
- 验证错误消息是否出现

### 3. 令牌安全性
- 尝试使用无效令牌访问文件
- 验证访问被拒绝（403）
- 尝试使用有效令牌访问文件
- 验证访问被允许

### 4. 过期处理
- 检查 KV 条目是否设置了过期时间
- TTL 过期后，验证文件不再可访问
- 检查显示了适当的错误消息

### 5. 缓存行为
- 上传文件并立即下载
- 等待潜在的缓存驱逐
- 尝试再次下载并验证缓存未命中处理

## 预期行为

- 最多可上传 25MB 的文件
- 生成带有随机令牌的分享链接
- 文件根据所选 TTL 过期
- 过期文件返回 410（Gone）状态
- 缓存未命中返回适当的错误消息
- 文件上传不会触发 Pages 部署

## 生产部署

1. 创建生产 KV 命名空间：
```bash
wrangler kv namespace create "FILE_METADATA"
wrangler kv namespace create "FILE_TOKENS"
```

2. 使用生产命名空间 ID 更新 `wrangler.toml`

3. 部署到 Cloudflare Pages：
```bash
wrangler pages deploy
```

## 清理

该服务依赖于 KV 自动过期，因此通常不需要手动清理。过期条目将自动删除。