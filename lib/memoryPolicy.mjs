export const MEMORY_CANDIDATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MEMORY_SHORT_TERM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MEMORY_MAX_ACTIVE = 240;
export const MEMORY_STATUSES = new Set(["short_term", "approved", "candidate", "archived"]);

export function compactSummary(text, max = 420) {
  const value = `${text || ""}`.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export function importanceScore({ type, content }) {
  const value = `${content || ""}`;
  let score = 1;
  if (["decision", "rule", "risk"].includes(type)) score += 2;
  if (/必须|禁止|风险|决定|已确认|合规|API|KEY|部署|架构|隐私|数据/.test(value)) score += 1;
  if (value.length > 800) score += 1;
  return Math.min(score, 5);
}

export function normalizeMemoryContent(content) {
  return `${content || ""}`.replace(/\s+/g, " ").trim().slice(0, 2000);
}

export function memoryHash(content) {
  const value = normalizeMemoryContent(content);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

export function normalizeMemoryItem(item) {
  const rawStatus = item.status || (item.archived ? "archived" : item.type === "conversation" ? "short_term" : `${item.title || ""}`.startsWith("自动提取") ? "candidate" : "approved");
  const status = MEMORY_STATUSES.has(rawStatus) ? rawStatus : "candidate";
  return {
    ...item,
    status,
    archived: status === "archived" || !!item.archived,
    hash:item.hash || memoryHash(item.content),
  };
}

export function memoryTtlMs(status) {
  if (status === "short_term") return MEMORY_SHORT_TERM_TTL_MS;
  if (status === "candidate") return MEMORY_CANDIDATE_TTL_MS;
  return 0;
}

export function isMemoryExpired(item, now = Date.now()) {
  const ttl = memoryTtlMs(item.status);
  if (!ttl) return false;
  const expiresAt = item.expiresAt ? Date.parse(item.expiresAt) : Date.parse(item.updatedAt || item.createdAt || "");
  if (!Number.isFinite(expiresAt)) return false;
  const threshold = item.expiresAt ? expiresAt : expiresAt + ttl;
  return threshold < now;
}

export function isCandidateExpired(item, now = Date.now()) {
  return isMemoryExpired(item, now);
}

export function hasExplicitMemoryInstruction(text) {
  return /记住|以后都按|这是规则|确定采用|不要再|固定为|remember this|always use|this is a rule|adopt this|do not .* again|set .* as fixed|覚えて|今後.*従|これはルール|採用する|二度と|固定/.test(`${text || ""}`);
}
