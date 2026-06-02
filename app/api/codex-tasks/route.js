import { isAuthenticatedAsync } from "../auth/session.js";
import { createHash, timingSafeEqual } from "crypto";
import { readJsonLimited, requestBodyTooLargeResponse } from "../../../lib/requestBody.mjs";
import { containsSensitiveSecret, sensitiveContentResponse } from "../../../lib/secretPolicy.mjs";
import { checkRateLimitAsync, rateLimitResponse } from "../../../lib/rateLimit.mjs";
import { auditEvent } from "../../../lib/auditLog.mjs";

const CODEX_TASK_MAX_REQUEST_BYTES = 64 * 1024;
const CODEX_TASK_RATE_WINDOW_MS = 60_000;
const CODEX_TASK_RATE_LIMIT = 5;

function safeIssueTitle(text, fallback) {
  return `${text || fallback || "Codex task"}`
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\p{L}\p{N}\s._:()[\]-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || fallback || "Codex task";
}

function isCodexAutoRunEnabled() {
  if (process.env.CODEX_TASK_AUTO_RUN !== "true") return false;
  return process.env.NODE_ENV !== "production";
}

function secureCompare(a, b) {
  const left = createHash("sha256").update(`${a || ""}`).digest();
  const right = createHash("sha256").update(`${b || ""}`).digest();
  return timingSafeEqual(left, right);
}

function canDispatchCodexTask(body) {
  if (body?.confirmCodexDispatch !== true) return false;
  const expectedAdminToken = process.env.CODEX_TASK_ADMIN_TOKEN;
  if (!expectedAdminToken) return process.env.NODE_ENV !== "production";
  return secureCompare(body?.adminToken, expectedAdminToken);
}

function codexDispatchConfigError() {
  if (process.env.NODE_ENV === "production" && !process.env.CODEX_TASK_ADMIN_TOKEN) {
    return "CODEX_TASK_ADMIN_TOKEN is required for production Codex task dispatch.";
  }
  return "";
}

export async function POST(request) {
  if (!await isAuthenticatedAsync(request)) {
    await auditEvent(request, { type:"codex_task.auth_failed", status:"blocked" });
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  if (!await checkRateLimitAsync({ request, namespace:"codex-tasks", limit:CODEX_TASK_RATE_LIMIT, windowMs:CODEX_TASK_RATE_WINDOW_MS })) {
    await auditEvent(request, { type:"codex_task.rate_limited", status:"blocked" });
    return rateLimitResponse("Codex task rate limit exceeded");
  }

  let body;
  try {
    body = await readJsonLimited(request, CODEX_TASK_MAX_REQUEST_BYTES);
  } catch (error) {
    const response = requestBodyTooLargeResponse(error);
    if (response) return response;
    body = {};
  }
  const configError = codexDispatchConfigError();
  if (configError) {
    await auditEvent(request, {
      type:"codex_task.forwarded",
      status:"ok",
      target:"github",
      metadata:{ taskId, issueUrl:data.html_url, pendingApproval:!autoRunEnabled },
    });
    return Response.json({
      ok: false,
      forwarded: false,
      error: configError,
    }, { status: 503 });
  }
  if (!canDispatchCodexTask(body)) {
    await auditEvent(request, { type:"codex_task.dispatch_denied", status:"blocked" });
    return Response.json({
      ok: false,
      forwarded: false,
      error: "Codex task dispatch requires administrator confirmation.",
    }, { status: 403 });
  }
  if (containsSensitiveSecret(`${body?.userTask || ""}\n${body?.systemPrompt || ""}`)) {
    await auditEvent(request, { type:"codex_task.secret_blocked", status:"blocked" });
    return sensitiveContentResponse();
  }
  const userTask = `${body?.userTask || ""}`.trim();
  if (!userTask) {
    return Response.json({ ok: false, forwarded: false, error: "Codex task is empty." }, { status: 400 });
  }

  const taskId = `nb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const task = {
    id: taskId,
    createdAt: new Date().toISOString(),
    source: "neural-bridge-team",
    systemPrompt: `${body.systemPrompt || ""}`.slice(0, 12000),
    userTask: userTask.slice(0, 12000),
  };

  if (process.env.GITHUB_TASK_TOKEN && process.env.GITHUB_TASK_REPO) {
    const autoRunEnabled = isCodexAutoRunEnabled();
    const labels = autoRunEnabled ? ["codex-task"] : ["codex-pending"];
    const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_TASK_REPO}/issues`, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${process.env.GITHUB_TASK_TOKEN}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: `[Neural Bridge] ${safeIssueTitle(task.userTask, task.id)}`,
        labels,
        body: [
          `Task ID: ${task.id}`,
          `Created: ${task.createdAt}`,
          `Execution: ${autoRunEnabled ? "auto-run enabled" : "manual approval required"}`,
          "",
          "## User task",
          task.userTask,
          "",
          "## Role prompt",
          task.systemPrompt,
        ].join("\n"),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return Response.json(
        { ok: false, taskId, error: data.message || `GitHub failed: ${response.status}` },
        { status: 502 }
      );
    }

    return Response.json({
      ok: true,
      taskId,
      forwarded: true,
      issueUrl: data.html_url,
      pendingApproval: !autoRunEnabled,
    });
  }

  if (process.env.CODEX_TASK_WEBHOOK_URL) {
    const response = await fetch(process.env.CODEX_TASK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task),
    });

    if (!response.ok) {
      return Response.json(
        { ok: false, taskId, error: `Webhook failed: ${response.status}` },
        { status: 502 }
      );
    }

    await auditEvent(request, { type:"codex_task.forwarded", status:"ok", target:"webhook", metadata:{ taskId } });
    return Response.json({ ok: true, taskId, forwarded: true });
  }

  return Response.json({
    ok: false,
    taskId,
    forwarded: false,
    error: "Task delivery is not configured. Set GITHUB_TASK_TOKEN and GITHUB_TASK_REPO.",
  }, { status: 503 });
}
