import { isAuthenticatedAsync } from "../auth/session.js";
import { readJsonLimited, requestBodyTooLargeResponse } from "../../../lib/requestBody.mjs";
import { containsSensitiveSecret, sensitiveContentResponse } from "../../../lib/secretPolicy.mjs";
import { checkRateLimitAsync, rateLimitResponse } from "../../../lib/rateLimit.mjs";
import { auditEvent } from "../../../lib/auditLog.mjs";

const SAVE_FILE_MAX_REQUEST_BYTES = 256 * 1024;
const SAVE_FILE_RATE_WINDOW_MS = 60_000;
const SAVE_FILE_RATE_LIMIT = 10;

function safeTitle(text) {
  return (text || "Neural Bridge 输出")
    .replace(/[^\p{L}\p{N}\s._-]/gu, "")
    .trim()
    .slice(0, 60) || "Neural Bridge 输出";
}

export async function POST(request) {
  if (!await isAuthenticatedAsync(request)) {
    await auditEvent(request, { type:"save_file.auth_failed", status:"blocked" });
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  if (!await checkRateLimitAsync({ request, namespace:"save-file", limit:SAVE_FILE_RATE_LIMIT, windowMs:SAVE_FILE_RATE_WINDOW_MS })) {
    await auditEvent(request, { type:"save_file.rate_limited", status:"blocked" });
    return rateLimitResponse("Save rate limit exceeded");
  }

  let body;
  try {
    body = await readJsonLimited(request, SAVE_FILE_MAX_REQUEST_BYTES);
  } catch (error) {
    const response = requestBodyTooLargeResponse(error);
    if (response) return response;
    body = {};
  }
  const saveId = `save-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const member = body.member || "Neural Bridge";
  const content = body.content || "";

  if (process.env.ENABLE_GITHUB_SAVE_TRANSIT !== "true") {
    await auditEvent(request, { type:"save_file.github_transit_disabled", status:"blocked" });
    return Response.json({
      ok: false,
      forwarded: false,
      error: "GitHub save transit is disabled. Use browser local download or explicitly set ENABLE_GITHUB_SAVE_TRANSIT=true.",
    }, { status: 403 });
  }

  if (body.confirmGithubTransit !== true) {
    await auditEvent(request, { type:"save_file.github_transit_unconfirmed", status:"blocked" });
    return Response.json({
      ok: false,
      forwarded: false,
      error: "GitHub transit confirmation is required because content will be sent to GitHub Issues.",
    }, { status: 403 });
  }

  if (!content.trim()) {
    return Response.json({ ok: false, error: "没有可保存内容" }, { status: 400 });
  }
  if (containsSensitiveSecret(`${member}\n${content}`)) {
    await auditEvent(request, { type:"save_file.secret_blocked", status:"blocked" });
    return sensitiveContentResponse();
  }

  if (!process.env.GITHUB_TASK_TOKEN || !process.env.GITHUB_TASK_REPO) {
    return Response.json({ ok: false, error: "保存通道未配置" }, { status: 503 });
  }

  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_TASK_REPO}/issues`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${process.env.GITHUB_TASK_TOKEN}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: `[Neural Bridge Save] ${safeTitle(member)}`,
      labels: ["file-save"],
      body: [
        `Save ID: ${saveId}`,
        `Created: ${new Date().toISOString()}`,
        "",
        "## Member",
        member,
        "",
        "## File content",
        content,
      ].join("\n"),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return Response.json({ ok: false, error: data.message || `GitHub failed: ${response.status}` }, { status: 502 });
  }

  await auditEvent(request, { type:"save_file.forwarded", status:"ok", target:"github", metadata:{ saveId } });
  return Response.json({ ok: true, saveId, issueUrl: data.html_url });
}
