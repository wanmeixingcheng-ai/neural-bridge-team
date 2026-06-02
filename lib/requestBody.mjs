export class RequestBodyTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
    this.status = 413;
  }
}

export async function readJsonLimited(request, maxBytes, fallback = {}) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  const reader = request.body?.getReader();
  if (!reader) return fallback;

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new RequestBodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  if (!chunks.length) return fallback;

  try {
    const text = new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export function requestBodyTooLargeResponse(error) {
  if (error?.status !== 413) return null;
  return Response.json({ error: "Request body is too large" }, { status: 413 });
}
