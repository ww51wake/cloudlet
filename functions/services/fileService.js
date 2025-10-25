/**
 * 通用文件获取服务，负责验证、查询元数据和从缓存获取内容
 * @param {object} env - 环境变量，包含 KV 命名空间绑定
 * @param {string} fileId - 文件 ID
 * @param {string} token - 访问令牌
 * @returns {object} 包含 response, metadata, error, status 等信息的对象
 */
async function deleteFileResources(env, metadata) {
  const cache = caches.default;
  const chunkKeys = Array.isArray(metadata?.chunkKeys) ? metadata.chunkKeys : [];

  await Promise.allSettled(
    chunkKeys.map((chunkKey) => {
      const request = new Request(`https://example.com${chunkKey}`);
      return cache.delete(request);
    })
  );

  if (metadata?.id && metadata?.token) {
    await Promise.allSettled([
      env.FILE_METADATA.delete(metadata.id),
      env.FILE_TOKENS.delete(metadata.token)
    ]);
  }
}

export async function getFileContent(env, fileId, token) {
  try {
    // 1. 验证令牌
    const storedFileId = await env.FILE_TOKENS.get(token);
    if (!storedFileId || storedFileId !== fileId) {
      return { error: 'Access denied: Invalid or expired token', status: 403 };
    }

    // 2. 获取元数据
    const metadataJson = await env.FILE_METADATA.get(fileId);
    if (!metadataJson) {
      return { error: 'File not found: Metadata has been deleted or expired', status: 410 };
    }

    const metadata = JSON.parse(metadataJson);

    // 3. 检查过期
    const now = Math.floor(Date.now() / 1000);
    if (now >= metadata.expiresAt) {
      deleteFileResources(env, metadata);
      return { error: 'File has expired', status: 410 };
    }

    if (metadata.status !== 'uploaded') {
      return { error: 'File upload has not been finalized', status: 409 };
    }

    if (!Array.isArray(metadata.chunkKeys) || metadata.chunkKeys.length === 0) {
      return { error: 'File data is unavailable', status: 410, reason: 'chunk_missing' };
    }

    const cache = caches.default;
    const chunkResponses = [];

    for (const chunkKey of metadata.chunkKeys) {
      const request = new Request(`https://example.com${chunkKey}`);
      const chunkResponse = await cache.match(request);
      if (!chunkResponse || !chunkResponse.body) {
        await deleteFileResources(env, metadata);
        return { error: 'File data is unavailable', status: 410, reason: 'chunk_missing' };
      }
      chunkResponses.push(chunkResponse);
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const chunkResponse of chunkResponses) {
            const reader = chunkResponse.body.getReader();
            while (true) {
              const { value, done } = await reader.read();
              if (done) {
                break;
              }
              controller.enqueue(value);
            }
          }
          controller.close();
        } catch (error) {
          console.error('Stream assembly error:', error);
          controller.error(error);
        }
      }
    });

    const size = metadata.size ?? metadata.totalSize ?? 0;

    const response = new Response(stream, {
      headers: {
        'Content-Type': metadata.type || 'application/octet-stream',
        'Content-Length': size.toString(),
        'X-File-ID': metadata.id,
        'X-File-Name': encodeRFC5987(metadata.name),
        'X-Expiration': metadata.expiresAt.toString()
      }
    });

    return { response, metadata };
  } catch (error) {
    console.error('Shared file service error:', error);
    return { error: 'Internal Server Error during file retrieval', status: 500 };
  }
}

// 辅助函数 (如果需要在多个地方用到)
export function encodeRFC5987(s) {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}