const WORKFLOW_DB_NAME = "neural_bridge_workflow_archive";
const WORKFLOW_DB_VERSION = 1;
const WORKFLOW_RECORD_LIMIT = 60;
const MAX_TEXT_CHARS = 12000;

function truncateText(value, limit = MAX_TEXT_CHARS) {
  const text = `${value || ""}`;
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function normalizeWorkflowRecord(record = {}) {
  const now = new Date().toISOString();
  const id = record.id || `wfr-${Date.now().toString(36)}`;
  return {
    id,
    title: `${record.title || "Workflow"}`.slice(0, 120),
    task: truncateText(record.task, 4000),
    source: record.source || "workflow",
    status: record.status || "done",
    language: record.language || "zh",
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
    members: Array.isArray(record.members)
      ? record.members.slice(0, 24).map(member => ({
        id: member.id || member.member || member.name || "",
        name: member.name || member.member || "",
        title: member.title || "",
        model: member.model || "",
        status: member.status || "complete",
        summary: truncateText(member.summary || member.text, 1600),
      }))
      : [],
    results: Array.isArray(record.results)
      ? record.results.slice(0, 24).map(result => ({
        member: result.member || result.name || "",
        title: result.title || "",
        model: result.model || "",
        summary: truncateText(result.summary || result.text, 1600),
        text: truncateText(result.text, 6000),
      }))
      : [],
    artifacts: Array.isArray(record.artifacts)
      ? record.artifacts.slice(0, 8).map(artifact => ({
        title: artifact.title || record.title || "Artifact",
        kind: artifact.kind || "Integrated report",
        content: truncateText(artifact.content || artifact.text, MAX_TEXT_CHARS),
        createdAt: artifact.createdAt || now,
      }))
      : [],
    error: truncateText(record.error, 1000),
  };
}

function formatWorkflowRecordMarkdown(record, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const lines = [
    `# ${item.title}`,
    "",
    `- ${label("状态", "状態", "Status")}: ${item.status}`,
    `- ${label("来源", "ソース", "Source")}: ${item.source}`,
    `- ${label("更新时间", "更新時刻", "Updated")}: ${item.updatedAt}`,
    "",
    `## ${label("任务", "タスク", "Task")}`,
    item.task || "-",
    "",
    `## ${label("执行成员", "担当メンバー", "Members")}`,
    ...(item.members.length
      ? item.members.map(member => `- ${member.name} · ${member.title} · ${member.model} · ${member.status}`)
      : ["-"]),
    "",
    `## ${label("成员成果", "メンバー成果", "Member outputs")}`,
    ...(item.results.length
      ? item.results.flatMap(result => [
        `### ${result.member} · ${result.title}`,
        "",
        result.text || result.summary || "-",
        "",
      ])
      : ["-"]),
    "",
    `## ${label("整合产物", "統合成果物", "Integrated artifacts")}`,
    ...(item.artifacts.length
      ? item.artifacts.flatMap(artifact => [
        `### ${artifact.title}`,
        "",
        artifact.content || "-",
        "",
      ])
      : ["-"]),
  ];
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function buildWorkflowContinuationPrompt(record, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const artifact = item.artifacts[0];
  const memberBlock = item.results
    .slice(0, 6)
    .map(result => `- ${result.member} · ${result.title}: ${result.summary || summarizeLine(result.text)}`)
    .join("\n");
  return [
    label("请基于以下历史工作流继续推进，不要重新从零开始。", "以下の過去ワークフローを前提に続行してください。最初からやり直さないでください。", "Continue from the workflow below. Do not restart from scratch."),
    "",
    `${label("原任务", "元タスク", "Original task")}:`,
    item.task || "-",
    "",
    `${label("已有整合产物", "既存の統合成果物", "Existing integrated artifact")}:`,
    artifact?.content || "-",
    "",
    `${label("成员成果摘要", "メンバー成果サマリー", "Member output summaries")}:`,
    memberBlock || "-",
    "",
    label("请先判断下一步应该调度哪些成员，再继续生成可执行产物。", "次に担当すべきメンバーを判断し、実行可能な成果物を続けて生成してください。", "First decide which members should be dispatched next, then produce the next actionable output."),
  ].join("\n").trim();
}

function summarizeLine(text, limit = 220) {
  return `${text || ""}`.replace(/\s+/g, " ").trim().slice(0, limit);
}

function openWorkflowDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKFLOW_DB_NAME, WORKFLOW_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("records")) {
        const store = db.createObjectStore("records", { keyPath:"id" });
        store.createIndex("updatedAt", "updatedAt", { unique:false });
        store.createIndex("status", "status", { unique:false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveWorkflowRecord(record) {
  const item = normalizeWorkflowRecord(record);
  const db = await openWorkflowDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction("records", "readwrite").objectStore("records").put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
  await enforceWorkflowRecordLimit().catch(() => {});
  return item;
}

async function listWorkflowRecords({ limit = 20 } = {}) {
  const db = await openWorkflowDb();
  const items = await new Promise((resolve, reject) => {
    const request = db.transaction("records", "readonly").objectStore("records").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items
    .map(normalizeWorkflowRecord)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, limit);
}

async function enforceWorkflowRecordLimit(limit = WORKFLOW_RECORD_LIMIT) {
  const items = await listWorkflowRecords({ limit: 1000 });
  const overflow = items.slice(limit);
  if (!overflow.length) return 0;
  const db = await openWorkflowDb();
  const tx = db.transaction("records", "readwrite");
  const store = tx.objectStore("records");
  for (const item of overflow) store.delete(item.id);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return overflow.length;
}

function deleteWorkflowArchive() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(WORKFLOW_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Workflow archive database is open in another tab."));
  });
}

export {
  WORKFLOW_DB_NAME,
  deleteWorkflowArchive,
  buildWorkflowContinuationPrompt,
  formatWorkflowRecordMarkdown,
  listWorkflowRecords,
  normalizeWorkflowRecord,
  saveWorkflowRecord,
};
