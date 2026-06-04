import {
  MEMORY_CANDIDATE_TTL_MS,
  MEMORY_MAX_ACTIVE,
  MEMORY_SHORT_TERM_TTL_MS,
  compactSummary,
  detectMemoryConflict,
  hasExplicitMemoryInstruction,
  importanceScore,
  isMemoryExpired,
  memoryHash,
  normalizeMemoryItem,
} from "./memoryPolicy.mjs";
import { summarizeForWorkflow } from "./taskEngine.mjs";

async function brainContextPrompt(query, lang) {
  await enforceMemoryRetention().catch(() => {});
  const [approved, shortTerm, candidates, hits] = await Promise.all([
    listProjectMemories({ statuses:["approved"] }).catch(() => []),
    listProjectMemories({ statuses:["short_term"] }).catch(() => []),
    listProjectMemories({ statuses:["candidate"] }).catch(() => []),
    searchKnowledge(query).catch(() => []),
  ]);
  const keyword = `${query || ""}`.trim().toLowerCase();
  const relatedShortTerm = shortTerm
    .filter(item => !keyword || `${item.title}\n${item.content}`.toLowerCase().includes(keyword))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, 3);
  const strongCandidates = candidates
    .filter(item => keyword && `${item.title}\n${item.content}`.toLowerCase().split(keyword).length - 1 >= 2)
    .slice(0, 2);
  const approvedBlock = approved.slice(0, 10).map(item => `- [approved/${item.type}] ${item.title}\n${item.content}`).join("\n\n");
  const shortBlock = relatedShortTerm.map(item => `- [short_term/${item.type}] ${item.title}\n${item.summary || item.content}`).join("\n\n");
  const candidateBlock = strongCandidates.map(item => `- [candidate/${item.type}] ${item.title}\n${item.summary || item.content}`).join("\n\n");
  const hitBlock = hits.slice(0, 8).map(hit => `- ${hit.title} / chunk ${hit.index + 1}\n${hit.content.slice(0, 900)}`).join("\n\n");
  if (!approvedBlock && !shortBlock && !candidateBlock && !hitBlock) return "";
  const title = lang === "ja" ? "Neural Bridge 知識庫コンテキスト" : lang === "en" ? "Neural Bridge knowledge context" : "Neural Bridge 知识库上下文";
  const instruction = lang === "ja"
    ? "以下はローカル知識庫から検索された文脈です。approved を最優先し、short_term は補助文脈、candidate は強一致時のみ参考にしてください。"
    : lang === "en"
      ? "The following context was retrieved from the local knowledge base. Prioritize approved memory, treat short_term as lightweight recent context, and use candidate only when strongly relevant."
      : "以下内容来自本地知识库自动检索。请最高优先参考 approved，short_term 仅作为近期低权重上下文，candidate 仅在强相关时参考。";
  return `\n\n${title}:\n${instruction}\n\n${approvedBlock ? `长期记忆 approved:\n${approvedBlock}\n\n` : ""}${shortBlock ? `短期记忆 short_term:\n${shortBlock}\n\n` : ""}${candidateBlock ? `待确认强相关 candidate:\n${candidateBlock}\n\n` : ""}${hitBlock ? `已批准相关文档:\n${hitBlock}` : ""}`;
}

async function learnFromExchange({ member, userText, reply, lang }) {
  const user = `${userText || ""}`.trim();
  const answer = `${reply || ""}`.trim();
  if (user.length < 4 || answer.length < 8) return;
  const title = `${member.name} · ${user.slice(0, 42)}`;
  const content = [
    lang === "ja" ? "ユーザー入力:" : lang === "en" ? "User input:" : "用户输入:",
    user.slice(0, 1600),
    "",
    lang === "ja" ? "役割回答:" : lang === "en" ? "Role reply:" : "角色回复:",
    answer.slice(0, 2600),
  ].join("\n");
  await putProjectMemory({
    type:"conversation",
    title,
    content,
    status:hasExplicitMemoryInstruction(user) ? "approved" : "short_term",
  }).catch(() => {});
  await autoCurateBrain({ member, userText:user, reply:answer, lang });
}

function extractSectionLines(text, labels) {
  const lines = `${text || ""}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.filter(line => labels.some(label => line.includes(label))).slice(0, 4);
}

async function autoCurateBrain({ member, userText, reply, lang }) {
  const rules = [
    { type:"decision", labels:["决定", "决策", "确定", "采用", "选择", "decision"], title:"自动提取决策" },
    { type:"risk", labels:["风险", "问题", "阻塞", "注意", "risk"], title:"自动提取风险" },
    { type:"rule", labels:["规则", "约束", "必须", "禁止", "原则", "rule"], title:"自动提取规则" },
    { type:"fact", labels:["事实", "背景", "现状", "已完成", "已配置", "fact"], title:"自动提取事实" },
  ];
  for (const rule of rules) {
    const lines = extractSectionLines(`${userText}\n${reply}`, rule.labels);
    if (!lines.length) continue;
    await putProjectMemory({
      type:rule.type,
      title:`${rule.title} · ${member.name}`,
      content:lines.join("\n"),
    }).catch(() => {});
  }
}

async function rememberWorkflowArtifact({ task, results = [], finalText, lang, source = "workflow" }) {
  const title = firstUserTitle([{ role:"user", text:task }], lang === "en" ? "Workflow output" : lang === "ja" ? "ワークフロー成果" : "工作流产物");
  for (const item of results.slice(0, 12)) {
    await putProjectMemory({
      type:"member_output",
      title:`${lang === "en" ? "Member output" : lang === "ja" ? "メンバー成果" : "成员产出"} · ${item.member}`,
      content:[
        `task: ${task}`,
        `member: ${item.member}`,
        `title: ${item.title}`,
        "",
        item.text,
      ].join("\n"),
      status:"candidate",
    }).catch(() => {});
  }
  if (!finalText?.trim()) return;
  const artifactText = [
    `task: ${task}`,
    `source: ${source}`,
    "",
    lang === "en" ? "Final integrated output:" : lang === "ja" ? "最終統合成果:" : "最终整合产物:",
    finalText,
    "",
    lang === "en" ? "Member outputs:" : lang === "ja" ? "メンバー成果:" : "成员成果:",
    results.map(item => `【${item.member} · ${item.title}】\n${item.text}`).join("\n\n"),
  ].join("\n");
  const doc = await putKnowledgeDocument({
    title:`${lang === "en" ? "Workflow artifact" : lang === "ja" ? "ワークフロー成果物" : "工作流产物"} - ${title}`,
    source,
    text:artifactText,
  }).catch(() => null);
  await putProjectMemory({
    type:"artifact",
    title:`${lang === "en" ? "Workflow artifact" : lang === "ja" ? "ワークフロー成果物" : "工作流产物"} · ${title}`,
    content:artifactText,
    status:"candidate",
    metadata:{ sourceDocId:doc?.id || "", source },
  }).catch(() => {});
}

const KB_DB_NAME = "neural_bridge_library_kb";
const KB_DB_VERSION = 2;
const KB_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const KB_IMPORT_MAX_ITEMS = 1200;
const KB_IMPORT_MAX_TEXT_CHARS = 2_000_000;

function openKnowledgeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KB_DB_NAME, KB_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents")) {
        db.createObjectStore("documents", { keyPath:"id" });
      }
      if (!db.objectStoreNames.contains("chunks")) {
        const store = db.createObjectStore("chunks", { keyPath:"id" });
        store.createIndex("docId", "docId", { unique:false });
      }
      if (!db.objectStoreNames.contains("memories")) {
        const store = db.createObjectStore("memories", { keyPath:"id" });
        store.createIndex("type", "type", { unique:false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteKnowledgeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(KB_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Knowledge database is open in another tab."));
  });
}

async function readAllProjectMemories() {
  const db = await openKnowledgeDb();
  const items = await new Promise((resolve, reject) => {
    const request = db.transaction("memories", "readonly").objectStore("memories").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items.map(normalizeMemoryItem);
}

async function findExistingMemory(content) {
  const hash = memoryHash(content);
  const items = await readAllProjectMemories().catch(() => []);
  return items.find(item => item.hash === hash && item.status !== "archived") || null;
}

async function putProjectMemory({ type = "note", title, content, status = "candidate", metadata = {} }) {
  await enforceMemoryRetention().catch(() => {});
  const existing = await findExistingMemory(content);
  if (existing) {
    if (status === "approved" && existing.status !== "approved") {
      await updateProjectMemory(existing.id, { status:"approved", type, title:title || existing.title });
    }
    return null;
  }
  const score = importanceScore({ type, content });
  const conflict = await findMemoryConflict({ type, title, content }).catch(() => null);
  const db = await openKnowledgeDb();
  const now = new Date();
  const activeStatus = ["short_term", "approved", "candidate", "archived"].includes(status) ? status : "candidate";
  const ttl = activeStatus === "short_term" ? MEMORY_SHORT_TERM_TTL_MS : activeStatus === "candidate" ? MEMORY_CANDIDATE_TTL_MS : 0;
  const item = {
    id:`mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    type,
    title:title || type,
    content,
    summary:compactSummary(content),
    importance:score,
    status:activeStatus,
    hash:memoryHash(content),
    project:"default",
    metadata:conflict ? { ...metadata, conflict } : metadata,
    archived:activeStatus === "archived",
    expiresAt:ttl ? new Date(now.getTime() + ttl).toISOString() : "",
    createdAt:now.toISOString(),
    updatedAt:now.toISOString(),
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction("memories", "readwrite");
    tx.objectStore("memories").put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  await enforceMemoryRetention().catch(() => {});
  return item;
}

async function findMemoryConflict(candidate) {
  const existing = await listProjectMemories({ statuses:["approved", "candidate"], includeExpired:false }).catch(() => []);
  return detectMemoryConflict(candidate, existing);
}

async function listProjectMemories({ statuses = ["candidate", "approved"], includeExpired = false } = {}) {
  const items = await readAllProjectMemories();
  const allowed = new Set(statuses);
  const now = Date.now();
  return items
    .filter(item => item.status === "archived" ? allowed.has("archived") : allowed.has(item.status) && !item.archived)
    .filter(item => includeExpired || !isMemoryExpired(item, now))
    .sort((a, b) => {
      const rank = { approved:4, short_term:2, candidate:1, archived:0 };
      return (rank[b.status] || 0) - (rank[a.status] || 0) ||
        (b.importance || 0) - (a.importance || 0) ||
        (b.updatedAt || "").localeCompare(a.updatedAt || "");
    });
}

async function enforceMemoryRetention() {
  const active = await listProjectMemories({ statuses:["short_term", "candidate", "approved"], includeExpired:true });
  const expired = active.filter(item => isMemoryExpired(item));
  const overflow = active
    .filter(item => !expired.some(exp => exp.id === item.id))
    .sort((a, b) => {
      const rank = { short_term:0, candidate:1, approved:2 };
      if (a.status !== b.status) return (rank[a.status] || 0) - (rank[b.status] || 0);
      return (a.importance || 0) - (b.importance || 0) || (a.updatedAt || "").localeCompare(b.updatedAt || "");
    })
    .slice(0, Math.max(0, active.length - MEMORY_MAX_ACTIVE));
  const targets = [...expired, ...overflow];
  for (const item of targets) {
    await updateProjectMemory(item.id, { status:"archived", archived:true });
  }
  return targets.length;
}

async function updateProjectMemory(id, patch) {
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("memories", "readwrite");
    const store = tx.objectStore("memories");
    const request = store.get(id);
    request.onsuccess = () => {
      const next = { ...(request.result || {}), ...patch, updatedAt:new Date().toISOString() };
      if (patch.content) {
        next.summary = compactSummary(patch.content);
        next.importance = importanceScore({ type:next.type, content:patch.content });
        next.hash = memoryHash(patch.content);
      }
      if (patch.status) {
        next.archived = patch.status === "archived";
        next.expiresAt = patch.status === "short_term"
          ? new Date(Date.now() + MEMORY_SHORT_TERM_TTL_MS).toISOString()
          : patch.status === "candidate"
            ? new Date(Date.now() + MEMORY_CANDIDATE_TTL_MS).toISOString()
            : patch.status === "approved" || patch.status === "archived" ? "" : next.expiresAt;
      }
      store.put(next);
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function approveProjectMemory(item) {
  const conflict = await findMemoryConflict(item).catch(() => null);
  await updateProjectMemory(item.id, {
    status:"approved",
    archived:false,
    metadata:conflict ? { ...(item.metadata || {}), conflict } : { ...(item.metadata || {}), conflict:null },
  });
  const sourceDocId = item.metadata?.sourceDocId;
  if (sourceDocId) {
    await updateKnowledgeDocument(sourceDocId, { status:"approved", archived:false }).catch(() => {});
  }
}

async function exportKnowledgeLibrary() {
  const db = await openKnowledgeDb();
  const readStore = (name) => new Promise((resolve, reject) => {
    const request = db.transaction(name, "readonly").objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  const payload = {
    version:KB_DB_VERSION,
    exportedAt:new Date().toISOString(),
    documents:await readStore("documents"),
    chunks:await readStore("chunks"),
    memories:await readStore("memories"),
  };
  db.close();
  return payload;
}

async function importKnowledgeLibrary(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid knowledge export.");
  }
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
  const memories = Array.isArray(payload.memories) ? payload.memories : [];
  const totalItems = documents.length + chunks.length + memories.length;
  const totalChars = [...documents, ...chunks, ...memories]
    .reduce((sum, item) => sum + `${item?.title || ""}${item?.content || ""}${item?.summary || ""}`.length, 0);
  const validId = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
  if (totalItems > KB_IMPORT_MAX_ITEMS || totalChars > KB_IMPORT_MAX_TEXT_CHARS) {
    throw new Error("Knowledge export is too large.");
  }
  if (documents.some(item => !validId(item?.id)) || chunks.some(item => !validId(item?.id) || !validId(item?.docId)) || memories.some(item => !validId(item?.id))) {
    throw new Error("Knowledge export contains invalid record ids.");
  }
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "chunks", "memories"], "readwrite");
    documents.forEach(item => tx.objectStore("documents").put({
      ...item,
      status:item.status === "approved" ? "approved" : "candidate",
      archived:!!item.archived,
      updatedAt:item.updatedAt || new Date().toISOString(),
    }));
    chunks.forEach(item => tx.objectStore("chunks").put(item));
    memories.forEach(item => tx.objectStore("memories").put(normalizeMemoryItem(item)));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function deleteKnowledgeDocument(docId) {
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "chunks"], "readwrite");
    tx.objectStore("documents").delete(docId);
    const index = tx.objectStore("chunks").index("docId");
    const request = index.openCursor(IDBKeyRange.only(docId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function deleteProjectMemory(id) {
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("memories", "readwrite");
    tx.objectStore("memories").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function archiveLowValueMemories() {
  const memories = await listProjectMemories({ statuses:["short_term", "candidate"], includeExpired:true });
  const lowValue = memories.filter(item => (item.importance || 1) <= 1 || isMemoryExpired(item)).slice(0, 80);
  for (const item of lowValue) {
    await updateProjectMemory(item.id, { status:"archived", archived:true });
  }
  return lowValue.length;
}

async function knowledgeStats() {
  const [docs, memories, archived] = await Promise.all([
    listKnowledgeDocuments(),
    listProjectMemories({ statuses:["short_term", "candidate", "approved"] }),
    listProjectMemories({ statuses:["archived"], includeExpired:true }),
  ]);
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => ({})) : {};
  return {
    documents:docs.length,
    documentChars:docs.reduce((sum, doc) => sum + (doc.size || 0), 0),
    documentChunks:docs.reduce((sum, doc) => sum + (doc.chunks || 0), 0),
    candidateDocuments:docs.filter(doc => doc.status === "candidate").length,
    approvedDocuments:docs.filter(doc => doc.status === "approved").length,
    memories:memories.length,
    shortTermMemories:memories.filter(item => item.status === "short_term").length,
    candidateMemories:memories.filter(item => item.status === "candidate").length,
    approvedMemories:memories.filter(item => item.status === "approved").length,
    archivedMemories:archived.length,
    memoryChars:memories.reduce((sum, item) => sum + (`${item.content || ""}`.length), 0),
    quota:estimate.quota || 0,
    usage:estimate.usage || 0,
  };
}

function chunkText(text, size = 1800, overlap = 180) {
  const value = `${text || ""}`.replace(/\s+/g, " ").trim();
  const chunks = [];
  for (let start = 0; start < value.length; start += size - overlap) {
    const part = value.slice(start, start + size).trim();
    if (part) chunks.push(part);
  }
  return chunks;
}

async function putKnowledgeDocument({ title, source, text }) {
  const db = await openKnowledgeDb();
  const id = `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const chunks = chunkText(text);
  const now = new Date().toISOString();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "chunks"], "readwrite");
    tx.objectStore("documents").put({ id, title, source, size:text.length, chunks:chunks.length, status:"candidate", archived:false, createdAt:now, updatedAt:now });
    chunks.forEach((content, index) => {
      tx.objectStore("chunks").put({ id:`${id}-chunk-${index}`, docId:id, title, index, content });
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { id, chunks:chunks.length };
}

async function listKnowledgeDocuments() {
  const db = await openKnowledgeDb();
  const docs = await new Promise((resolve, reject) => {
    const request = db.transaction("documents", "readonly").objectStore("documents").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return docs
    .map(doc => ({ ...doc, status:doc.status || "approved", archived:!!doc.archived }))
    .filter(doc => !doc.archived)
    .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
}

async function updateKnowledgeDocument(docId, patch) {
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readwrite");
    const store = tx.objectStore("documents");
    const request = store.get(docId);
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      store.put({ ...current, ...patch, updatedAt:new Date().toISOString() });
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function searchKnowledge(query) {
  const keyword = `${query || ""}`.trim().toLowerCase();
  if (!keyword) return [];
  const db = await openKnowledgeDb();
  const [docs, chunks] = await Promise.all([
    new Promise((resolve, reject) => {
      const request = db.transaction("documents", "readonly").objectStore("documents").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }),
    new Promise((resolve, reject) => {
      const request = db.transaction("chunks", "readonly").objectStore("chunks").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }),
  ]);
  const approvedDocIds = new Set(docs
    .map(doc => ({ ...doc, status:doc.status || "approved", archived:!!doc.archived }))
    .filter(doc => doc.status === "approved" && !doc.archived)
    .map(doc => doc.id));
  db.close();
  return chunks
    .filter(chunk => approvedDocIds.has(chunk.docId))
    .map(chunk => {
      const lower = chunk.content.toLowerCase();
      const count = lower.split(keyword).length - 1;
      return { ...chunk, score:count };
    })
    .filter(chunk => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

async function searchKnowledgeForPanel(query) {
  const keyword = `${query || ""}`.trim().toLowerCase();
  if (!keyword) return [];
  const db = await openKnowledgeDb();
  const chunks = await new Promise((resolve, reject) => {
    const request = db.transaction("chunks", "readonly").objectStore("chunks").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return chunks
    .map(chunk => {
      const lower = chunk.content.toLowerCase();
      const count = lower.split(keyword).length - 1;
      return { ...chunk, score:count };
    })
    .filter(chunk => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function filterProjectMemoriesBySourceType(memories = [], sourceType = "all") {
  const safeSourceType = `${sourceType || "all"}`;
  if (safeSourceType === "all") return memories;
  return memories.filter(item => item?.metadata?.sourceType === safeSourceType);
}

function projectMemorySourceTypeCounts(memories = []) {
  return memories.reduce((counts, item) => {
    const sourceType = item?.metadata?.sourceType || "manual";
    counts.all += 1;
    counts[sourceType] = (counts[sourceType] || 0) + 1;
    return counts;
  }, { all:0 });
}

export {
  approveProjectMemory,
  archiveLowValueMemories,
  brainContextPrompt,
  chunkText,
  deleteKnowledgeDb,
  deleteKnowledgeDocument,
  deleteProjectMemory,
  enforceMemoryRetention,
  exportKnowledgeLibrary,
  filterProjectMemoriesBySourceType,
  findMemoryConflict,
  importKnowledgeLibrary,
  knowledgeStats,
  learnFromExchange,
  listKnowledgeDocuments,
  listProjectMemories,
  putKnowledgeDocument,
  putProjectMemory,
  projectMemorySourceTypeCounts,
  rememberWorkflowArtifact,
  searchKnowledgeForPanel,
  updateKnowledgeDocument,
  updateProjectMemory,
};
