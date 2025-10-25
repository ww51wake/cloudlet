import { getFileContent, encodeRFC5987 } from "../../services/fileService.js"; // 修正路径

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathParts = url.pathname.split("/");

  if (pathParts.length !== 4) {
    // /s/foo/bar
    return new Response("Invalid sharing URL", { status: 400 });
  }

  const fileId = pathParts[2]; // 'foo'
  const token = pathParts[3]; // 'bar'

  const { response, metadata, error, status, reason } = await getFileContent(
    context.env,
    fileId,
    token
  );

  if (error) {
    if (reason === "cache_miss" || reason === "chunk_missing") {
      // 分享链接对缓存未命中的响应 (可以是 HTML 或 JSON)
      return new Response(
        `File with ID ${fileId} is no longer available on edge storage.`,
        { status: status, headers: { "Content-Type": "text/plain" } }
      );
    } else {
      // 返回错误页面或消息
      return new Response(error, { status: status });
    }
  }

  // 分享链接特定的响应头设置
  response.headers.set("Content-Type", metadata.type || "application/octet-stream");
  response.headers.set(
    "Content-Disposition",
    `inline; filename="file"; filename*=UTF-8''${encodeRFC5987(metadata.name)}`
  );
  const remainingTtl = Math.max(0, metadata.expiresAt - Math.floor(Date.now() / 1000));
  response.headers.set("Cache-Control", `public, max-age=${remainingTtl}`);
  response.headers.set("Content-Length", metadata.size?.toString() ?? metadata.totalSize?.toString() ?? "0");
  response.headers.set("X-File-Name", encodeRFC5987(metadata.name));
  return response;
}