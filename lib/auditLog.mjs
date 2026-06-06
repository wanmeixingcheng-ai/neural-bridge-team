import { randomUUID } from "crypto";
import { sql } from "./externalStore.mjs";

let warnedMissingAuditPersistence = false;

function requestIp(request) {
  const forwarded = request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request?.headers?.get("x-real-ip") || "unknown";
}

function userAgent(request) {
  return request?.headers?.get("user-agent") || "";
}

export async function auditEvent(request, event) {
  const db = sql();
  const record = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    type: event.type || "unknown",
    actor: event.actor || "anonymous",
    ip: requestIp(request),
    userAgent: userAgent(request).slice(0, 300),
    target: event.target || "",
    status: event.status || "",
    metadata: event.metadata || {},
    persistence: db ? "database" : "memory",
  };

  if (!db) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[audit]", JSON.stringify(record));
    } else if (!warnedMissingAuditPersistence) {
      warnedMissingAuditPersistence = true;
      console.warn("[audit] DATABASE_URL is not configured; audit events are not persisted.");
    }
    return record;
  }

  try {
    await db`
      insert into nb_audit_events
        (id, created_at, event_type, actor, ip_address, user_agent, target, status, metadata)
      values
        (${record.id}, ${record.createdAt}, ${record.type}, ${record.actor}, ${record.ip},
         ${record.userAgent}, ${record.target}, ${record.status}, ${JSON.stringify(record.metadata)}::jsonb)
    `;
  } catch (error) {
    console.warn("[audit] write failed", error?.message || error);
  }
  return record;
}
