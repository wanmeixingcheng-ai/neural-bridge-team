const SECRET_PATTERNS = [
  /\b(?:sk-ant|sk-proj|sk)-[A-Za-z0-9_-]{20,}\b/i,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/,
  /"client_email"\s*:\s*"[^"]+@[^"]+\.iam\.gserviceaccount\.com"/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*[^\s]{8,}/i,
];

export function containsSensitiveSecret(value) {
  const text = `${value || ""}`;
  return SECRET_PATTERNS.some(pattern => pattern.test(text));
}

export function sensitiveContentResponse() {
  return Response.json({
    ok: false,
    forwarded: false,
    error: "Sensitive secret-like content was detected. Remove keys, tokens, passwords, or private keys before dispatching.",
  }, { status: 400 });
}
