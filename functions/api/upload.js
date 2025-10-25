// Helper function to encode URI components for headers
function encodeRFC5987(s) {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

// Import nanoid from CDN since it's not natively available in Cloudflare Workers
// We'll define a simple nanoid equivalent for this implementation
function nanoid(size = 21) {
  const urlAlphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  let id = '';
  for (let i = 0; i < size; i++) {
    id += urlAlphabet[Math.floor(Math.random() * urlAlphabet.length)];
  }
  return id;
}

// Generate a random token for file access
function generateToken() {
  return nanoid(32); // 32-character random string
}

const MAX_CHUNK_SIZE = 99 * 1024 * 1024; // 99MB
const MIN_TTL = 300; // 5 minutes
const MAX_TTL = 604800; // 7 days
const DEFAULT_TTL = 86400; // 24 hours
const PENDING_UPLOAD_TTL_MS = 15 * 60 * 1000; // 15 minutes inactivity window

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function cleanupUploadResources(env, metadata) {
  const cache = caches.default;
  const chunkKeys = Array.isArray(metadata?.chunkKeys) ? metadata.chunkKeys : [];
  const deletionTasks = chunkKeys.map((chunkKey) => {
    const request = new Request(`https://example.com${chunkKey}`);
    return cache.delete(request);
  });

  await Promise.allSettled(deletionTasks);

  if (metadata?.id && metadata?.token) {
    await Promise.allSettled([
      env.FILE_METADATA.delete(metadata.id),
      env.FILE_TOKENS.delete(metadata.token)
    ]);
  }
}

async function loadMetadata(env, fileId) {
  const metadataJson = await env.FILE_METADATA.get(fileId);
  if (!metadataJson) {
    return null;
  }

  try {
    return JSON.parse(metadataJson);
  } catch (error) {
    console.error('Failed to parse metadata for file', fileId, error);
    return null;
  }
}

async function saveMetadata(env, metadata) {
  let expiration = metadata.expiresAt;
  if (metadata.status === 'pending' && metadata.pendingExpiresAt) {
    const pendingExpirationSeconds = Math.floor(metadata.pendingExpiresAt / 1000);
    expiration = Math.min(expiration, pendingExpirationSeconds);
  }

  await env.FILE_METADATA.put(metadata.id, JSON.stringify(metadata), {
    expiration
  });
}

function ensureUploadActive(metadata) {
  if (!metadata.pendingExpiresAt) {
    return true;
  }
  return Date.now() <= metadata.pendingExpiresAt;
}

export async function onRequestPost(context) {
  try {
    const url = new URL(context.request.url);
    const action = (url.searchParams.get('action') || 'initialize').toLowerCase();

    switch (action) {
      case 'initialize':
        return await handleInitialize(context);
      case 'append':
        return await handleAppend(context);
      case 'complete':
        return await handleComplete(context);
      default:
        return jsonResponse({ success: false, error: 'Unsupported action' }, 400);
    }
  } catch (error) {
    console.error('Upload error:', error);
    return jsonResponse({ success: false, error: error.message || 'Unexpected error' }, 500);
  }
}

async function handleInitialize(context) {
  const body = await context.request.json().catch(() => null);
  if (!body) {
    return jsonResponse({ success: false, error: 'Invalid JSON payload' }, 400);
  }

  const {
    fileName,
    fileSize,
    fileType,
    ttl: requestedTtl,
    totalChunks
  } = body;

  if (!fileName || typeof fileName !== 'string') {
    return jsonResponse({ success: false, error: 'fileName is required' }, 400);
  }

  if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
    return jsonResponse({ success: false, error: 'totalChunks must be a positive integer' }, 400);
  }

  if (fileSize !== undefined && (!Number.isFinite(fileSize) || fileSize < 0)) {
    return jsonResponse({ success: false, error: 'fileSize must be a non-negative number' }, 400);
  }

  const ttl = requestedTtl ? parseInt(requestedTtl, 10) : DEFAULT_TTL;
  if (Number.isNaN(ttl) || ttl < MIN_TTL || ttl > MAX_TTL) {
    return jsonResponse({
      success: false,
      error: `TTL must be between ${MIN_TTL} seconds and ${MAX_TTL} seconds`
    }, 400);
  }

  const fileId = nanoid(16);
  const token = generateToken();
  const now = Date.now();
  const expiresAt = Math.floor(now / 1000) + ttl;
  const cacheKey = `/api/files/${fileId}/download?token=${token}`;

  const metadata = {
    id: fileId,
    name: fileName,
    size: 0,
    expectedSize: fileSize ?? null,
    type: fileType || 'application/octet-stream',
    uploadAt: now,
    expiresAt,
    token,
    cacheKey,
    status: 'pending',
    chunkCount: 0,
    totalChunks,
    totalSize: 0,
    chunkKeys: [],
    lastActivity: now,
    pendingExpiresAt: now + PENDING_UPLOAD_TTL_MS
  };

  await saveMetadata(context.env, metadata);
  await context.env.FILE_TOKENS.put(token, fileId, { expiration: expiresAt });

  const baseUrl = new URL(context.request.url);
  baseUrl.pathname = `/s/${fileId}/${token}`;

  return jsonResponse({
    success: true,
    fileId,
    token,
    downloadUrl: baseUrl.toString(),
    expiresAt,
    ttl,
    status: metadata.status
  });
}

async function handleAppend(context) {
  const url = new URL(context.request.url);
  const fileId = url.searchParams.get('fileId');
  const token = url.searchParams.get('token');
  const chunkIndex = Number(url.searchParams.get('chunkIndex'));
  const totalChunks = Number(url.searchParams.get('totalChunks'));

  if (!fileId || !token) {
    return jsonResponse({ success: false, error: 'fileId and token are required' }, 400);
  }

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return jsonResponse({ success: false, error: 'chunkIndex must be a non-negative integer' }, 400);
  }

  if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
    return jsonResponse({ success: false, error: 'totalChunks must be a positive integer' }, 400);
  }

  const metadata = await loadMetadata(context.env, fileId);
  if (!metadata) {
    return jsonResponse({ success: false, error: 'Upload session not found' }, 404);
  }

  if (metadata.token !== token) {
    return jsonResponse({ success: false, error: 'Invalid token for upload session' }, 403);
  }

  if (Math.floor(Date.now() / 1000) >= metadata.expiresAt) {
    await cleanupUploadResources(context.env, metadata);
    return jsonResponse({ success: false, error: 'Upload session has expired' }, 410);
  }

  if (!ensureUploadActive(metadata)) {
    await cleanupUploadResources(context.env, metadata);
    return jsonResponse({ success: false, error: 'Upload session timed out due to inactivity' }, 410);
  }

  if (metadata.status !== 'pending') {
    return jsonResponse({ success: false, error: 'Upload session already finalized' }, 409);
  }

  if (metadata.totalChunks !== totalChunks) {
    return jsonResponse({ success: false, error: 'totalChunks mismatch with initialized session' }, 400);
  }

  if (chunkIndex !== metadata.chunkCount) {
    return jsonResponse({
      success: false,
      error: 'Chunks must be uploaded sequentially',
      expectedIndex: metadata.chunkCount
    }, 409);
  }

  if (chunkIndex >= metadata.totalChunks) {
    return jsonResponse({ success: false, error: 'chunkIndex exceeds expected totalChunks' }, 400);
  }

  let chunkBuffer;
  try {
    chunkBuffer = await context.request.arrayBuffer();
  } catch (error) {
    console.error('Failed to read chunk payload', error);
    return jsonResponse({ success: false, error: 'Unable to read chunk payload' }, 400);
  }

  const chunkSize = chunkBuffer.byteLength;
  if (chunkSize === 0) {
    return jsonResponse({ success: false, error: 'Chunk payload is empty' }, 400);
  }

  if (chunkSize > MAX_CHUNK_SIZE) {
    return jsonResponse({
      success: false,
      error: `Chunk too large. Maximum allowed size is ${MAX_CHUNK_SIZE}`
    }, 400);
  }

  const projectedSize = metadata.totalSize + chunkSize;
  if (metadata.expectedSize !== null && projectedSize > metadata.expectedSize) {
    return jsonResponse({
      success: false,
      error: 'Chunk exceeds expected file size'
    }, 409);
  }

  const cache = caches.default;
  const chunkKey = `${metadata.cacheKey}#${chunkIndex}`;
  const cacheRequest = new Request(`https://example.com${chunkKey}`);
  const remainingSeconds = Math.max(
    1,
    metadata.expiresAt - Math.floor(Date.now() / 1000)
  );
  const chunkResponse = new Response(chunkBuffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': chunkSize.toString(),
      'Cache-Control': `public, max-age=${remainingSeconds}`,
      'X-Chunk-Index': chunkIndex.toString()
    }
  });

  await cache.put(cacheRequest, chunkResponse);
  chunkBuffer = null; // Release reference for GC

  metadata.chunkKeys.push(chunkKey);
  metadata.chunkCount += 1;
  metadata.totalSize = projectedSize;
  metadata.lastActivity = Date.now();
  metadata.pendingExpiresAt = metadata.lastActivity + PENDING_UPLOAD_TTL_MS;

  await saveMetadata(context.env, metadata);

  return jsonResponse({
    success: true,
    chunkIndex,
    chunkCount: metadata.chunkCount,
    remainingChunks: metadata.totalChunks - metadata.chunkCount
  });
}

async function handleComplete(context) {
  const body = await context.request.json().catch(() => ({}));
  const url = new URL(context.request.url);
  const fileId = body.fileId || url.searchParams.get('fileId');
  const token = body.token || url.searchParams.get('token');
  const reportedSize = body.totalSize;

  if (!fileId || !token) {
    return jsonResponse({ success: false, error: 'fileId and token are required' }, 400);
  }

  const metadata = await loadMetadata(context.env, fileId);
  if (!metadata) {
    return jsonResponse({ success: false, error: 'Upload session not found' }, 404);
  }

  if (metadata.token !== token) {
    return jsonResponse({ success: false, error: 'Invalid token for upload session' }, 403);
  }

  if (Math.floor(Date.now() / 1000) >= metadata.expiresAt) {
    await cleanupUploadResources(context.env, metadata);
    return jsonResponse({ success: false, error: 'Upload session has expired' }, 410);
  }

  if (!ensureUploadActive(metadata)) {
    await cleanupUploadResources(context.env, metadata);
    return jsonResponse({ success: false, error: 'Upload session timed out due to inactivity' }, 410);
  }

  if (metadata.status !== 'pending') {
    return jsonResponse({ success: false, error: 'Upload session already finalized' }, 409);
  }

  if (metadata.chunkCount !== metadata.totalChunks) {
    return jsonResponse({
      success: false,
      error: 'Uploaded chunk count does not match totalChunks',
      expected: metadata.totalChunks,
      received: metadata.chunkCount
    }, 409);
  }

  if (metadata.expectedSize !== null && metadata.totalSize !== metadata.expectedSize) {
    return jsonResponse({
      success: false,
      error: 'Uploaded file size does not match expected size'
    }, 409);
  }

  if (reportedSize !== undefined && reportedSize !== metadata.totalSize) {
    return jsonResponse({
      success: false,
      error: 'Reported totalSize does not match accumulated size'
    }, 409);
  }

  metadata.status = 'uploaded';
  metadata.size = metadata.totalSize;
  metadata.completedAt = Date.now();
  metadata.lastActivity = metadata.completedAt;
  delete metadata.pendingExpiresAt;

  await saveMetadata(context.env, metadata);

  const baseUrl = new URL(context.request.url);
  baseUrl.pathname = `/s/${metadata.id}/${metadata.token}`;

  return jsonResponse({
    success: true,
    fileId: metadata.id,
    downloadUrl: baseUrl.toString(),
    totalSize: metadata.size,
    status: metadata.status
  });
}