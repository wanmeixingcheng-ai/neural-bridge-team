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

const CONFLICT_PATTERNS = [
  [/必须|一定要|always|required|必ず/, /禁止|不要|不允许|never|do not|禁止/],
  [/采用|启用|开启|允许|使用|adopt|enable|allow|use|採用|有効/, /不采用|禁用|关闭|不允许|不要使用|disable|disallow|do not use|不採用|無効/],
  [/本地|local|端末内/, /上云|云端|cloud|サーバー|クラウド/],
  [/自动执行|自动部署|auto run|auto deploy|自動実行/, /人工审批|手动审批|manual approval|手動承認/],
];

function normalizeConflictText(text) {
  return `${text || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
}

export function detectMemoryConflict(candidate = {}, existing = []) {
  const content = normalizeConflictText(`${candidate.title || ""}\n${candidate.content || ""}`);
  if (!content) return null;
  const candidates = Array.isArray(existing) ? existing : [];
  for (const item of candidates) {
    if (item.status === "archived" || item.archived) continue;
    const other = normalizeConflictText(`${item.title || ""}\n${item.content || ""}`);
    if (!other) continue;
    for (const [positive, negative] of CONFLICT_PATTERNS) {
      const candidatePositive = positive.test(content);
      const candidateNegative = negative.test(content);
      const otherPositive = positive.test(other);
      const otherNegative = negative.test(other);
      if ((candidatePositive && otherNegative) || (candidateNegative && otherPositive)) {
        return {
          memoryId:item.id || "",
          title:item.title || "",
          status:item.status || "",
          type:item.type || "",
        };
      }
    }
  }
  return null;
}

export function clearMemoryConflictMetadata(metadata = {}) {
  const next = { ...(metadata || {}) };
  delete next.conflict;
  next.conflictReviewedAt = new Date().toISOString();
  return next;
}
