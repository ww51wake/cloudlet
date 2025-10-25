import { getFileContent, encodeRFC5987 } from "../../../services/fileService.js"; 

export async function onRequestGet(context) {
  const { id } = context.params;
  const url = new URL(context.request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { response, metadata, error, status, reason } = await getFileContent(
    context.env,
    id,
    token
  );

  if (error) {
    if (reason === "cache_miss" || reason === "chunk_missing") {
      // API 端点对缓存未命中的响应
      return new Response(
        JSON.stringify({
          error: "File not available",
          message:
            "The file data is no longer available on edge storage. This can happen due to cache eviction policies or incomplete uploads.",
          fileId: id,
          reason: reason,
        }),
        {
          status: status,
          headers: { "Content-Type": "application/json" },
        }
      );
    } else {
      return new Response(JSON.stringify({ error }), {
        status: status || 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // API 端点特定的响应头设置
  response.headers.set("Content-Type", metadata.type || "application/octet-stream");
  // 设置剩余 TTL
  const remainingTtl = Math.max(0, metadata.expiresAt - Math.floor(Date.now() / 1000));
  response.headers.set("Cache-Control", `public, max-age=${remainingTtl}`);
  response.headers.set("Content-Length", metadata.size?.toString() ?? metadata.totalSize?.toString() ?? "0");
  response.headers.set("X-File-Name", encodeRFC5987(metadata.name));
  response.headers.set(
    "Content-Disposition",
    `inline; filename="file"; filename*=UTF-8''${encodeRFC5987(metadata.name)}`
  );
  return response;
}