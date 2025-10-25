# Cloudlet - 免费临时文件分享服务

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-F48120?logo=cloudflare)](https://pages.cloudflare.com/)

> 基于 Cloudflare Pages、KV 和 Cache API 的临时文件分享服务，无需付费 R2 存储即可实现免费临时文件分享。

## ⚠️ 使用声明

本项目仅供个人学习和研究使用，禁止用于任何商业用途。使用者应对上传的文件内容负完全责任，并遵守所有适用的法律法规。

## ✨ 特性

- 🚀 **零成本部署** - 利用 Cloudflare 免费套餐，无需 R2 存储费用
- 🔐 **安全访问** - 基于随机令牌的安全访问控制
- 📁 **简单易用** - 拖放上传界面，生成临时分享链接
- 📊 **API 支持** - 为第三方应用提供完整 API 接口
- ⚡ **边缘缓存** - 利用 Cloudflare 全球 CDN 加速访问，实现高速下载
- 👤 **免登录上传下载** - 无需注册或登录即可上传和下载文件


## 🏗️ 架构

- **前端**: 拖放文件上传界面 (HTML/CSS/JavaScript)
- **API 端点**:
  - `POST /api/upload` - 文件上传接口
  - `GET /api/files/[id]/download?token=[token]` - API 下载接口
  - `GET /s/[fileId]/[token]` - 用户分享链接
  - `GET /api/status` - 服务状态接口
- **存储**:
  - Workers KV: 存储文件元数据和访问令牌
  - Cache API: 临时存储文件内容
- **共享服务**: 核心文件验证与获取逻辑 (`functions/services/fileService.js`)，减少代码重复，提升一致性。

## 📋 功能

- 兼容 Cloudflare 免费套餐（无需 R2）
- 临时文件分享，可配置 TTL
- 基于令牌的安全访问控制
- 文件大小验证（最大 99MB 以符合 Cloudflare Pages Functions 请求限制）
- 自动过期和清理
- 拖放文件上传
- 实时上传进度显示
- 缓存未命中处理，提供用户友好的消息



## 🚀 快速开始

### 前提条件
- Node.js 和 npm
- Cloudflare 账户
- Wrangler CLI (`npm install -g wrangler`)

### 本地开发

1. **克隆并安装依赖**
   ```bash
   git clone <repository-url>
   cd cloudlet-file-share
   npm install
   ```

2. **登录 Cloudflare**
   ```bash
   wrangler login
   ```

3. **创建 KV 命名空间**
   - **生产环境**（部署时需要）：
     ```bash
     wrangler kv namespace create "FILE_METADATA"
     wrangler kv namespace create "FILE_TOKENS"
     ```
   
   - **预览环境**（本地开发用，需要先创建生产环境命名空间）：
     ```bash
     wrangler kv namespace create "FILE_METADATA" --preview
     wrangler kv namespace create "FILE_TOKENS" --preview
     ```

4. **更新配置**
   - 将第3步中返回的命名空间 ID 更新到 `wrangler.toml` 文件中
   - preview_id 用于本地开发，id 用于生产环境

5. **本地运行（开发模式）**
   ```bash
   npm run dev
   # 或
   wrangler pages dev public
   ```

   如果遇到 KV 连接问题：
   ```bash
   wrangler pages dev public --kv=FILE_METADATA --kv=FILE_TOKENS
   ```

### 部署到生产环境

1. **确保已创建生产环境的 KV 命名空间**（如上所述）

2. **更新 `wrangler.toml` 中的生产环境配置**（id 字段）

3. **部署**
   ```bash
   npm run deploy
   # 或
   wrangler pages deploy
   ```

## 🔌 API 接口

### 上传接口
- **端点**: `POST /api/upload`
- **Content-Type**: `multipart/form-data`
- **参数**:
  - `file`: 要上传的文件（最大99MB，受 Cloudflare Pages Functions 限制）
  - `ttl`: 存活时间（秒）- 300到86400秒（5分钟到24小时），默认86400秒（24小时）
- **成功响应**:
  ```json
  {
    "success": true,
    "fileId": "abc123def456",
    "fileName": "example.pdf",
    "downloadUrl": "https://yourdomain.com/s/abc123def456/token789",
    "ttl": 86400
  }
  ```
- **错误响应**:
  ```json
  {
    "success": false,
    "error": "File too large. Maximum size is 99MB"
  }
  ```

### 下载接口
- **端点**: `GET /api/files/[id]/download?token=[token]`
- **参数**:
  - `id`: 文件ID（URL路径参数）
  - `token`: 访问令牌（查询参数）
- **响应**: 文件内容或 JSON 格式的错误消息
- **错误响应示例**:
  ```json
  {
    "error": "File not available",
    "message": "The file has been removed from edge cache...",
    "fileId": "abc123def456",
    "reason": "cache_miss"
  }
  ```

### 状态接口
- **端点**: `GET /api/status`
- **响应示例**:
  ```json
  {
    "status": "File sharing service is running",
    "timestamp": 1234567890
  }
  ```

## 🔒 安全性

- 每个文件分配一个随机的 32 字符令牌进行访问
- 令牌存储在 KV 中并带有过期时间
- 下载请求的元数据验证
- 文件内容存储在 Cloudflare 的边缘缓存中，不在 KV 中
- TTL 过期后自动清理相关数据

## 📉 限制

- 用户可设置的过期时间为 5 分钟到 24 小时（受 Cloudflare Workers Cache API 限制）
- 最大文件大小为 99MB（受 Cloudflare Pages Functions 上传请求大小限制）
- 依赖 Cloudflare 免费套餐配额
- 可能在 TTL 到期前发生缓存驱逐(基于LRU、存储压力等因素）)


## 🤝 贡献

欢迎提交 issue 和 pull request! 

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。