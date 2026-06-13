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
import {
  HIGH_RISK_SOURCE_TYPES,
  JRE_KNOWLEDGE_DOMAINS,
  KNOWLEDGE_BRAIN_STORES,
  buildAreaRecord,
  buildBuildingRecord,
  buildCalculationRunRecord,
  buildEvidenceRefRecord,
  buildEvalCaseRecord,
  buildExpenseRecord,
  buildKnowledgeUnitRecord,
  buildLandRecord,
  buildLeaseRecord,
  buildLoanRecord,
  buildPolicyRuleRecord,
  buildPropertyRecord,
  buildRiskRecord,
  buildScenarioRecord,
  buildSourceRegistryRecord,
  buildTaxRecord,
  buildTransactionRecord,
  JRE_ENTITY_TYPES,
  validateEvidenceRefQuality,
  validateCalculationRunRecord,
  validateJapaneseRealEstateRecord,
  validateSourceRegistryRecord,
  validateKnowledgeUnitQuality,
  validateKnowledgeUnitVersionChain,
} from "./knowledgeBrainSchemas.mjs";
import { buildInvestmentMetrics } from "./jreCalculations.mjs";
import { summarizeForWorkflow } from "./taskEngine.mjs";

function workflowArtifactTitle(task, fallback = "Workflow output") {
  const text = `${task || ""}`.replace(/\s+/g, " ").trim();
  return text.slice(0, 48) || fallback;
}

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
  const title = workflowArtifactTitle(task, lang === "en" ? "Workflow output" : lang === "ja" ? "ワークフロー成果" : "工作流产物");
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
const KB_DB_VERSION = 5;
const KB_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const KB_IMPORT_MAX_ITEMS = 1200;
const KB_IMPORT_MAX_TEXT_CHARS = 2_000_000;

function ensureKnowledgeBrainIndexes(store, indexes = []) {
  for (const [indexName, keyPath] of indexes) {
    if (store.indexNames.contains(indexName)) continue;
    store.createIndex(indexName, keyPath, { unique:false });
  }
}

function createKnowledgeBrainStores(db, transaction = null) {
  for (const definition of Object.values(KNOWLEDGE_BRAIN_STORES)) {
    const store = db.objectStoreNames.contains(definition.name)
      ? transaction?.objectStore(definition.name)
      : db.createObjectStore(definition.name, { keyPath:"id" });
    if (store) ensureKnowledgeBrainIndexes(store, definition.indexes);
  }
}

function normalizeKnowledgeSourceType(source = "attachment", sourceType = "") {
  const explicit = `${sourceType || ""}`.trim();
  if (explicit) return explicit;
  const value = `${source || ""}`.trim().toLowerCase();
  if (value.includes("reins")) return "reins_user_upload";
  if (value.includes("contract")) return "contract";
  if (value.includes("important_matter") || value.includes("重説") || value.includes("重要事項")) return "important_matter_explanation";
  if (value.includes("customer")) return "customer_record";
  if (value.startsWith("workflow-") || value.includes("workflow")) return "workflow_artifact";
  return value || "attachment";
}

function normalizeImportedSourceRegistryRecord(source = {}) {
  const record = { ...source };
  const consentScope = `${record.consent_scope || "none"}`.trim();
  const sourceType = `${record.source_type || ""}`.trim();
  const riskLevel = `${record.risk_level || "medium"}`.trim();
  const addImportWarnings = (...warningIds) => {
    const warnings = Array.isArray(record.metadata?.import_warnings) ? record.metadata.import_warnings : [];
    record.metadata = {
      ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}),
      import_warnings:[...new Set([...warnings, ...warningIds.filter(Boolean)])],
    };
  };
  const reinsManualMethods = new Set(["manual", "user_upload", "user_manual_upload"]);
  if (sourceType === "reins_user_upload" && !reinsManualMethods.has(record.collection_method)) {
    record.collection_method = "manual";
    addImportWarnings("reins_collection_method_sanitized");
  }
  const trainingWarnings = [];
  if (!["opt_in", "explicit_opt_in"].includes(consentScope)) trainingWarnings.push("training_disabled_missing_explicit_consent");
  if (record.deletion_requested === true) trainingWarnings.push("training_disabled_deleted_source");
  if (["high", "restricted"].includes(riskLevel)) trainingWarnings.push("training_disabled_high_risk");
  if (HIGH_RISK_SOURCE_TYPES.includes(sourceType)) trainingWarnings.push("training_disabled_high_risk_source_type");
  if (trainingWarnings.length > 0) {
    if (record.training_allowed === true) addImportWarnings(...trainingWarnings);
    record.training_allowed = false;
  }
  return record;
}

function normalizeImportedKnowledgeBrainRecord(storeName = "", item = {}) {
  const record = storeName === KNOWLEDGE_BRAIN_STORES.sourceRegistry.name
    ? normalizeImportedSourceRegistryRecord(item)
    : { ...item };
  const reviewMetadataReasons = approvedHighRiskReviewMetadataReasons(record);
  if (reviewMetadataReasons.length > 0) {
    const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
    const warnings = Array.isArray(metadata.import_warnings) ? metadata.import_warnings : [];
    record.review_status = "in_review";
    record.metadata = {
      ...metadata,
      import_warnings:[...new Set([...warnings, "approved_high_risk_missing_reviewer_metadata", ...reviewMetadataReasons])],
      import_original_review_status:"approved",
    };
  }
  return record;
}

function buildSourceRegistryIngestPayload({
  title,
  source = "attachment",
  sourceType = "",
  originUrl = "",
  provider = "",
  jurisdiction = "JP",
  collectedBy = "user",
  collectionMethod = "manual",
  license = "",
  consentScope = "none",
  trainingAllowed = false,
  deletionRequested = false,
  retentionPolicy = "project_local_default",
  reviewStatus = "candidate",
  riskLevel = "",
  metadata = {},
} = {}) {
  const source_type = normalizeKnowledgeSourceType(source, sourceType);
  const requestedTraining = trainingAllowed === true;
  const record = normalizeImportedSourceRegistryRecord(buildSourceRegistryRecord({
    source_type,
    title,
    origin_url:originUrl,
    provider,
    jurisdiction,
    collected_by:collectedBy,
    collection_method:collectionMethod,
    license,
    consent_scope:consentScope,
    training_allowed:requestedTraining,
    deletion_requested:deletionRequested === true,
    retention_policy:retentionPolicy,
    review_status:reviewStatus,
    risk_level:riskLevel || undefined,
    metadata:{
      ...(metadata && typeof metadata === "object" ? metadata : {}),
      legacySource:source,
    },
  }));
  if (requestedTraining && record.training_allowed === false) {
    const warnings = Array.isArray(record.metadata?.import_warnings) ? record.metadata.import_warnings : [];
    const trainingWarnings = [];
    if (!["opt_in", "explicit_opt_in"].includes(record.consent_scope)) trainingWarnings.push("training_disabled_missing_explicit_consent");
    if (record.deletion_requested === true) trainingWarnings.push("training_disabled_deleted_source");
    if (["high", "restricted"].includes(record.risk_level)) trainingWarnings.push("training_disabled_high_risk");
    if (HIGH_RISK_SOURCE_TYPES.includes(record.source_type)) trainingWarnings.push("training_disabled_high_risk_source_type");
    record.metadata = {
      ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}),
      import_warnings:[...new Set([...warnings, ...trainingWarnings])],
    };
  }
  return {
    record,
    quality:validateSourceRegistryRecord(record),
    trainingEligible:trainingEligibleSources([record]).length === 1,
  };
}

function buildKnowledgeDocumentIngestRecords({
  title,
  source = "attachment",
  text,
  chunks = null,
  sourceType = "",
  domain = "general",
  reviewStatus = "candidate",
  riskLevel = "",
  metadata = {},
  documentId = "",
} = {}) {
  const safeTitle = `${title || ""}`.trim();
  const safeText = `${text || ""}`.trim();
  if (!safeTitle) throw new Error("title is required.");
  if (!safeText) throw new Error("text is required.");
  const source_type = normalizeKnowledgeSourceType(source, sourceType);
  const sourceRecord = buildSourceRegistryRecord({
    source_type,
    title:safeTitle,
    collection_method:"manual",
    review_status:reviewStatus,
    risk_level:riskLevel || undefined,
    training_allowed:metadata.trainingAllowed === true,
    consent_scope:metadata.consentScope || "none",
    metadata:{
      ...metadata,
      legacyDocumentId:documentId,
      legacySource:source,
    },
  });
  const sourceChunks = Array.isArray(chunks) && chunks.length ? chunks : chunkText(safeText);
  const unitRecords = [];
  const evidenceRecords = [];
  sourceChunks.forEach((content, index) => {
    const unit = buildKnowledgeUnitRecord({
      id:`ku-${sourceRecord.id}-${index}`,
      source_id:sourceRecord.id,
      domain,
      title:sourceChunks.length > 1 ? `${safeTitle} / chunk ${index + 1}` : safeTitle,
      content,
      review_status:reviewStatus,
      risk_level:sourceRecord.risk_level,
      metadata:{
        legacyDocumentId:documentId,
        legacyChunkIndex:index,
      },
    });
    const evidence = buildEvidenceRefRecord({
      id:`ev-${sourceRecord.id}-${index}`,
      source_id:sourceRecord.id,
      target_type:"knowledge_unit",
      target_id:unit.id,
      locator:`chunk:${index + 1}`,
      quote:content.slice(0, 500),
      review_status:reviewStatus,
      risk_level:sourceRecord.risk_level,
      metadata:{
        legacyDocumentId:documentId,
        legacyChunkIndex:index,
      },
    });
    unit.evidence_ref_ids = [evidence.id];
    unitRecords.push(unit);
    evidenceRecords.push(evidence);
  });
  return {
    source:sourceRecord,
    knowledgeUnits:unitRecords,
    evidenceRefs:evidenceRecords,
  };
}

function japaneseRealEstateStoreName(entityType) {
  const normalized = `${entityType || ""}`.trim();
  if (!JRE_ENTITY_TYPES.includes(normalized)) {
    throw new Error(`entity_type must be one of: ${JRE_ENTITY_TYPES.join(", ")}`);
  }
  return `${normalized}_records`;
}

const JAPANESE_REAL_ESTATE_RECORD_BUILDERS = Object.freeze({
  property:buildPropertyRecord,
  land:buildLandRecord,
  building:buildBuildingRecord,
  lease:buildLeaseRecord,
  expense:buildExpenseRecord,
  loan:buildLoanRecord,
  tax:buildTaxRecord,
  risk:buildRiskRecord,
  area:buildAreaRecord,
  transaction:buildTransactionRecord,
});

function buildJapaneseRealEstateRecordPayload(entityType, input = {}) {
  if (`${input.calculation_method || ""}`.trim() === "llm") {
    throw new Error("Financial real estate records must not use LLM calculation.");
  }
  const normalized = `${entityType || ""}`.trim();
  const builder = JAPANESE_REAL_ESTATE_RECORD_BUILDERS[normalized];
  if (!builder) {
    throw new Error(`entity_type must be one of: ${JRE_ENTITY_TYPES.join(", ")}`);
  }
  const record = builder(input);
  const quality = validateJapaneseRealEstateRecord(record);
  if (quality.issues.includes("llm_financial_calculation")) {
    throw new Error("Financial real estate records must not use LLM calculation.");
  }
  return {
    storeName:japaneseRealEstateStoreName(record.entity_type),
    record,
    quality,
  };
}

function buildJapaneseRealEstateSourceIngestRecords({
  title,
  source = "attachment",
  text = "",
  sourceType = "",
  reviewStatus = "candidate",
  riskLevel = "",
  metadata = {},
  documentId = "",
  records = [],
} = {}) {
  const safeTitle = `${title || ""}`.trim();
  if (!safeTitle) throw new Error("title is required.");
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("records must include at least one Japanese real estate entity.");
  }
  const source_type = normalizeKnowledgeSourceType(source, sourceType);
  const sourceRecord = buildSourceRegistryRecord({
    source_type,
    title:safeTitle,
    collection_method:"manual",
    review_status:reviewStatus,
    risk_level:riskLevel || undefined,
    training_allowed:metadata.trainingAllowed === true,
    consent_scope:metadata.consentScope || "none",
    metadata:{
      ...metadata,
      legacyDocumentId:documentId,
      legacySource:source,
      ingestion_kind:"japanese_real_estate_source",
    },
  });
  const evidenceRefs = [];
  const entityRecords = records.map((input, index) => {
    const entityType = `${input.entity_type || input.entityType || ""}`.trim();
    const recordId = input.id || `${entityType}-${sourceRecord.id}-${index}`;
    const evidenceId = `ev-${recordId}`;
    const evidence = input.evidence && typeof input.evidence === "object" ? input.evidence : {};
    const evidenceRefIds = [...new Set([
      ...(Array.isArray(input.evidence_ref_ids) ? input.evidence_ref_ids : []),
      evidenceId,
    ])];
    const payload = buildJapaneseRealEstateRecordPayload(entityType, {
      ...input,
      id:recordId,
      source_id:input.source_id || sourceRecord.id,
      review_status:input.review_status || reviewStatus,
      risk_level:input.risk_level || sourceRecord.risk_level,
      evidence_ref_ids:evidenceRefIds,
      metadata:{
        ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
        source_title:safeTitle,
        source_type,
        legacyDocumentId:documentId,
      },
    });
    const evidenceRef = buildEvidenceRefRecord({
      id:evidenceId,
      source_id:sourceRecord.id,
      target_type:`jre_${payload.record.entity_type}`,
      target_id:payload.record.id,
      locator:evidence.locator || input.locator || `record:${index + 1}`,
      quote:evidence.quote || input.quote || payload.record.title,
      hash:evidence.hash || input.hash || "",
      review_status:payload.record.review_status,
      risk_level:payload.record.risk_level,
      metadata:{
        ...(evidence.metadata && typeof evidence.metadata === "object" ? evidence.metadata : {}),
        legacyDocumentId:documentId,
        source_title:safeTitle,
      },
    });
    evidenceRefs.push(evidenceRef);
    return payload;
  });
  const referenceIntegrity = validateKnowledgeBrainReferenceIntegrity({
    sources:[sourceRecord],
    evidenceRefs,
    japaneseRealEstateRecords:entityRecords.map(item => item.record),
  });
  const reviewQueue = knowledgeBrainReviewQueueSummary({
    sources:[sourceRecord],
    japaneseRealEstateRecords:entityRecords.map(item => item.record),
  });
  return {
    source:sourceRecord,
    text:`${text || ""}`,
    documentId,
    records:entityRecords,
    evidenceRefs,
    referenceIntegrity,
    reviewQueue,
  };
}

const GOVERNANCE_RECORD_BUILDERS = Object.freeze({
  policy_rule: {
    storeName:KNOWLEDGE_BRAIN_STORES.policyRules.name,
    build:buildPolicyRuleRecord,
  },
  scenario: {
    storeName:KNOWLEDGE_BRAIN_STORES.scenarios.name,
    build:buildScenarioRecord,
  },
  eval_case: {
    storeName:KNOWLEDGE_BRAIN_STORES.evalCases.name,
    build:buildEvalCaseRecord,
  },
});

function buildKnowledgeGovernanceRecordPayload(recordType, input = {}) {
  const normalized = `${recordType || ""}`.trim();
  const definition = GOVERNANCE_RECORD_BUILDERS[normalized];
  if (!definition) {
    throw new Error("recordType must be one of: policy_rule, scenario, eval_case");
  }
  const record = definition.build(input);
  return {
    storeName:definition.storeName,
    recordType:normalized,
    record,
  };
}

function buildKnowledgeGovernanceUpdatePayload(recordType, current = {}, patch = {}, options = {}) {
  const normalized = `${recordType || ""}`.trim();
  const definition = GOVERNANCE_RECORD_BUILDERS[normalized];
  if (!definition) {
    throw new Error("recordType must be one of: policy_rule, scenario, eval_case");
  }
  const updatePatch = options.incrementVersion === false
    ? {
        ...patch,
        updated_at:options.now || new Date().toISOString(),
      }
    : buildVersionedKnowledgePatch(current, patch, options);
  const record = applyReviewDecisionMetadata({
    ...current,
    ...updatePatch,
    source_id:updatePatch.source_id || current.source_id,
  }, options);
  const quality = validateKnowledgeGovernanceRecordQuality(normalized, record);
  return {
    storeName:definition.storeName,
    recordType:normalized,
    record,
    quality,
  };
}

function filterKnowledgeGovernanceRecords(records = [], { sourceId = "", sourceIds = [], reviewStatuses = [], riskLevels = [], includeArchived = false, query = "" } = {}) {
  const sourceSet = new Set(sourceIds);
  if (sourceId) sourceSet.add(sourceId);
  const reviewStatusSet = new Set(reviewStatuses);
  const riskLevelSet = new Set(riskLevels);
  const keyword = `${query || ""}`.trim().toLowerCase();
  return records
    .filter(record => includeArchived || record.review_status !== "archived")
    .filter(record => !sourceSet.size || sourceSet.has(record.source_id))
    .filter(record => !reviewStatusSet.size || reviewStatusSet.has(record.review_status))
    .filter(record => !riskLevelSet.size || riskLevelSet.has(record.risk_level))
    .filter(record => {
      if (!keyword) return true;
      return [
        record.title,
        record.rule_type,
        record.rule_text,
        record.scenario_type,
        record.description,
        record.prompt,
        record.expected_behavior,
        record.forbidden_behavior,
      ].join("\n").toLowerCase().includes(keyword);
    })
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

function buildKnowledgeUnitUpdatePayload(current = {}, patch = {}, options = {}) {
  const updatePatch = options.incrementVersion === false
    ? {
        ...patch,
        updated_at:options.now || new Date().toISOString(),
      }
    : buildVersionedKnowledgePatch(current, patch, options);
  const record = applyReviewDecisionMetadata({
    ...current,
    ...updatePatch,
    source_id:updatePatch.source_id || current.source_id,
  }, options);
  const quality = validateKnowledgeUnitQuality(record);
  return { record, quality };
}

function buildEvidenceRefUpdatePayload(current = {}, patch = {}, options = {}) {
  const updatePatch = options.incrementVersion === false
    ? {
        ...patch,
        updated_at:options.now || new Date().toISOString(),
      }
    : buildVersionedKnowledgePatch(current, patch, options);
  const record = applyReviewDecisionMetadata({
    ...current,
    ...updatePatch,
    source_id:updatePatch.source_id || current.source_id,
    target_type:updatePatch.target_type || current.target_type,
    target_id:updatePatch.target_id || current.target_id,
  }, options);
  const quality = validateEvidenceRefQuality(record);
  return { record, quality };
}

function approvedRecordHasReviewMetadata(record = {}) {
  if (record.review_status !== "approved") return false;
  if (!["high", "restricted"].includes(record.risk_level)) return true;
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
  return !!`${metadata.reviewed_by || ""}`.trim() && !!`${metadata.reviewed_at || ""}`.trim();
}

function approvedKnowledgeUnitSearchResults({ query, sources = [], units = [] } = {}) {
  const keyword = `${query || ""}`.trim().toLowerCase();
  if (!keyword) return [];
  const approvedSourceIds = new Set(sources
    .filter(source => approvedRecordHasReviewMetadata(source) && source.deletion_requested !== true)
    .map(source => source.id));
  return units
    .filter(unit => approvedRecordHasReviewMetadata(unit) && approvedSourceIds.has(unit.source_id))
    .map((unit, index) => {
      const lower = `${unit.content || ""}`.toLowerCase();
      const score = lower.split(keyword).length - 1;
      return {
        id:unit.id,
        docId:unit.metadata?.legacyDocumentId || unit.source_id,
        sourceId:unit.source_id,
        title:unit.title,
        index:unit.metadata?.legacyChunkIndex ?? index,
        content:unit.content,
        evidenceRefIds:unit.evidence_ref_ids || [],
        score,
      };
    })
    .filter(unit => unit.score > 0)
    .sort((a, b) => b.score - a.score);
}

function filterKnowledgeUnitRecords(units = [], { sourceIds = [], domains = [], reviewStatuses = [], riskLevels = [], query = "" } = {}) {
  const sourceIdSet = new Set(sourceIds);
  const domainSet = new Set(domains);
  const reviewStatusSet = new Set(reviewStatuses);
  const riskLevelSet = new Set(riskLevels);
  const keyword = `${query || ""}`.trim().toLowerCase();
  return units
    .filter(unit => !sourceIdSet.size || sourceIdSet.has(unit.source_id))
    .filter(unit => !domainSet.size || domainSet.has(unit.domain))
    .filter(unit => !reviewStatusSet.size || reviewStatusSet.has(unit.review_status))
    .filter(unit => !riskLevelSet.size || riskLevelSet.has(unit.risk_level))
    .filter(unit => {
      if (!keyword) return true;
      return `${unit.title || ""}\n${unit.content || ""}\n${(unit.tags || []).join("\n")}`.toLowerCase().includes(keyword);
    })
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

function filterEvidenceRefRecords(refs = [], { sourceIds = [], targetTypes = [], targetIds = [], reviewStatuses = [], riskLevels = [], query = "" } = {}) {
  const sourceIdSet = new Set(sourceIds);
  const targetTypeSet = new Set(targetTypes);
  const targetIdSet = new Set(targetIds);
  const reviewStatusSet = new Set(reviewStatuses);
  const riskLevelSet = new Set(riskLevels);
  const keyword = `${query || ""}`.trim().toLowerCase();
  return refs
    .filter(ref => !sourceIdSet.size || sourceIdSet.has(ref.source_id))
    .filter(ref => !targetTypeSet.size || targetTypeSet.has(ref.target_type))
    .filter(ref => !targetIdSet.size || targetIdSet.has(ref.target_id))
    .filter(ref => !reviewStatusSet.size || reviewStatusSet.has(ref.review_status))
    .filter(ref => !riskLevelSet.size || riskLevelSet.has(ref.risk_level))
    .filter(ref => {
      if (!keyword) return true;
      return `${ref.locator || ""}\n${ref.quote || ""}\n${ref.hash || ""}`.toLowerCase().includes(keyword);
    })
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

function approvedKnowledgeBrainSearchResults({ query, sources = [], policyRules = [], scenarios = [], evalCases = [], japaneseRealEstateRecords = [], calculationRuns = [] } = {}) {
  const keyword = `${query || ""}`.trim().toLowerCase();
  if (!keyword) return [];
  const approvedSourceIds = new Set(sources
    .filter(source => approvedRecordHasReviewMetadata(source) && source.deletion_requested !== true)
    .map(source => source.id));
  const countMatches = text => `${text || ""}`.toLowerCase().split(keyword).length - 1;
  const buildHit = ({ type, id, sourceId = "", sourceIds = [], title = "", content = "", evidenceRefIds = [] }) => {
    const score = countMatches(`${title}\n${content}`);
    if (score <= 0) return null;
    return { type, id, sourceId, sourceIds, title, content, evidenceRefIds, score };
  };
  const governanceHits = [
    ...policyRules
      .filter(record => approvedRecordHasReviewMetadata(record) && approvedSourceIds.has(record.source_id))
      .map(record => buildHit({
        type:"policy_rule",
        id:record.id,
        sourceId:record.source_id,
        title:record.title,
        content:[record.rule_type, record.rule_text, ...(record.applies_to || [])].join("\n"),
        evidenceRefIds:record.evidence_ref_ids || [],
      })),
    ...scenarios
      .filter(record => approvedRecordHasReviewMetadata(record) && approvedSourceIds.has(record.source_id))
      .map(record => buildHit({
        type:"scenario",
        id:record.id,
        sourceId:record.source_id,
        title:record.title,
        content:[record.scenario_type, record.description, ...(record.expected_outputs || [])].join("\n"),
        evidenceRefIds:record.evidence_ref_ids || [],
      })),
    ...evalCases
      .filter(record => approvedRecordHasReviewMetadata(record) && approvedSourceIds.has(record.source_id))
      .map(record => buildHit({
        type:"eval_case",
        id:record.id,
        sourceId:record.source_id,
        title:record.prompt,
        content:[record.expected_behavior, record.forbidden_behavior, JSON.stringify(record.scoring_rubric || {})].join("\n"),
        evidenceRefIds:record.evidence_ref_ids || [],
      })),
  ];
  const jreHits = japaneseRealEstateRecords
    .filter(record => approvedRecordHasReviewMetadata(record) && approvedSourceIds.has(record.source_id))
    .map(record => buildHit({
      type:`jre_${record.entity_type || "record"}`,
      id:record.id,
      sourceId:record.source_id,
      title:record.title,
      content:JSON.stringify({ ...record, metadata:undefined }),
      evidenceRefIds:record.evidence_ref_ids || [],
    }));
  const calculationHits = calculationRuns
    .filter(record => approvedRecordHasReviewMetadata(record))
    .filter(record => Array.isArray(record.source_ids) && record.source_ids.length > 0 && record.source_ids.every(sourceId => approvedSourceIds.has(sourceId)))
    .map(record => buildHit({
      type:"calculation_run",
      id:record.id,
      sourceIds:record.source_ids || [],
      title:`${record.calculation_type || "calculation"} ${record.property_id || ""}`.trim(),
      content:JSON.stringify({ inputs:record.inputs, formulas:record.formulas, outputs:record.outputs, metadata:record.metadata }),
      evidenceRefIds:record.evidence_ref_ids || [],
    }));
  return [...governanceHits, ...jreHits, ...calculationHits]
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function filterJapaneseRealEstateRecords(records = [], { propertyId = "", sourceIds = [], statuses = [], reviewStatuses = [], riskLevels = [], includeArchived = false, query = "" } = {}) {
  const sourceIdSet = new Set(sourceIds);
  const reviewStatusSet = new Set([...statuses, ...reviewStatuses]);
  const riskLevelSet = new Set(riskLevels);
  const keyword = `${query || ""}`.trim().toLowerCase();
  return records
    .filter(record => includeArchived || record.review_status !== "archived")
    .filter(record => !propertyId || record.property_id === propertyId || record.id === propertyId)
    .filter(record => !sourceIdSet.size || sourceIdSet.has(record.source_id))
    .filter(record => !reviewStatusSet.size || reviewStatusSet.has(record.review_status))
    .filter(record => !riskLevelSet.size || riskLevelSet.has(record.risk_level))
    .filter(record => {
      if (!keyword) return true;
      return [
        record.title,
        record.address,
        record.risk_type,
        record.finding,
        record.station,
        record.municipality,
        record.attributes ? JSON.stringify(record.attributes) : "",
      ].join("\n").toLowerCase().includes(keyword);
    })
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

function sourceTrainingEligibilityReasons(source = {}) {
  const reasons = [];
  if (source.review_status !== "approved") reasons.push("source_not_approved");
  if (source.training_allowed !== true) reasons.push("training_not_enabled");
  if (!["opt_in", "explicit_opt_in"].includes(source.consent_scope)) reasons.push("missing_explicit_consent");
  if (source.deletion_requested === true) reasons.push("deletion_requested");
  if (["high", "restricted"].includes(source.risk_level)) reasons.push("high_risk_source");
  if (HIGH_RISK_SOURCE_TYPES.includes(source.source_type)) reasons.push("high_risk_source_type");
  return reasons;
}

function sourceUsagePermissions(source = {}) {
  const referenceReasons = [];
  if (source.deletion_requested === true) referenceReasons.push("deletion_requested");
  if (source.review_status === "archived") referenceReasons.push("source_archived");
  if (source.review_status !== "approved") referenceReasons.push("source_not_approved");

  const derivativeReasons = [...referenceReasons];
  const requiresExplicitDerivativeApproval = ["high", "restricted"].includes(source.risk_level) || HIGH_RISK_SOURCE_TYPES.includes(source.source_type);
  if (requiresExplicitDerivativeApproval && source.metadata?.derivative_allowed !== true) {
    derivativeReasons.push("high_risk_derivative_requires_explicit_approval");
  }
  if (requiresExplicitDerivativeApproval && !`${source.metadata?.reviewed_by || ""}`.trim()) {
    derivativeReasons.push("missing_reviewed_by");
  }
  if (requiresExplicitDerivativeApproval && !`${source.metadata?.reviewed_at || ""}`.trim()) {
    derivativeReasons.push("missing_reviewed_at");
  }

  const trainingReasons = sourceTrainingEligibilityReasons(source);
  return {
    source_id:source.id || "",
    source_type:source.source_type || "",
    review_status:source.review_status || "unknown",
    risk_level:source.risk_level || "unknown",
    deletion_requested:source.deletion_requested === true,
    reference:{
      allowed:referenceReasons.length === 0,
      reasons:[...new Set(referenceReasons)],
    },
    derivative:{
      allowed:derivativeReasons.length === 0,
      reasons:[...new Set(derivativeReasons)],
    },
    training:{
      allowed:trainingReasons.length === 0,
      reasons:trainingReasons,
    },
  };
}

function sourceUsagePermissionBlockedReasonCounts(sources = []) {
  return sources.reduce((counts, source) => {
    const permissions = sourceUsagePermissions(source);
    for (const [scope, detail] of Object.entries({
      reference:permissions.reference,
      derivative:permissions.derivative,
      training:permissions.training,
    })) {
      for (const reason of detail.reasons) {
        const key = `${scope}:${reason}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }, {});
}

function sourceTrainingEligibilityReport(sources = []) {
  return sources.map(source => {
    const reasons = sourceTrainingEligibilityReasons(source);
    return {
      source_id:source.id || "",
      source_type:source.source_type || "",
      review_status:source.review_status || "unknown",
      risk_level:source.risk_level || "unknown",
      training_allowed:source.training_allowed === true,
      consent_scope:source.consent_scope || "none",
      eligible:reasons.length === 0,
      reasons,
    };
  });
}

function sourceTrainingEligibilityBlockedReasonCounts(sources = []) {
  return sourceTrainingEligibilityReport(sources).reduce((counts, item) => {
    for (const reason of item.reasons) {
      counts[reason] = (counts[reason] || 0) + 1;
    }
    return counts;
  }, {});
}

function sourceColdStartTier(source = {}) {
  const explicit = `${source.metadata?.cold_start_tier || source.cold_start_tier || ""}`.trim();
  const sourceType = `${source.source_type || ""}`.trim();
  const provider = `${source.provider || ""}`.trim().toLowerCase();
  if (["tier_1_official_public", "official_public"].includes(explicit)) return "tier_1_official_public";
  if (["tier_2_industry_association", "industry_association"].includes(explicit)) return "tier_2_industry_association";
  if (["tier_3_partner_practitioner_case", "partner_practitioner_case"].includes(explicit)) return "tier_3_partner_practitioner_case";
  if (["tier_4_ai_assisted_draft", "ai_assisted_draft"].includes(explicit)) return "tier_4_ai_assisted_draft";
  if (["official_public", "public_manual", "public_web"].includes(sourceType) && /(mlit|国土交通省|retio|不動産適正取引推進機構|consumer affairs|消費者庁)/i.test(provider)) {
    return "tier_1_official_public";
  }
  if (["industry_association", "association_template"].includes(sourceType)) return "tier_2_industry_association";
  if (["partner_practitioner_case", "desensitized_case"].includes(sourceType)) return "tier_3_partner_practitioner_case";
  if (["ai_assisted_draft", "ai_generated_draft"].includes(sourceType)) return "tier_4_ai_assisted_draft";
  return "unclassified";
}

function sourceColdStartTierCounts(sources = []) {
  return sources.reduce((counts, source) => {
    const tier = sourceColdStartTier(source);
    counts[tier] = (counts[tier] || 0) + 1;
    return counts;
  }, {});
}

const KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS = Object.freeze({
  phase_2_1_official_public:{
    sourceTier:"tier_1_official_public",
    domains:["D07", "D08", "D16"],
    approvedKnowledgeUnitTarget:{ min:300, max:500 },
    reviewMode:"internal_review",
    recommendedSourceTypes:["public_manual", "public_web", "official_public"],
    recommendedProviders:["MLIT", "RETIO", "Consumer Affairs Agency"],
  },
  phase_2_2_industry_templates:{
    sourceTier:"tier_2_industry_association",
    domains:["D01", "D02", "D03", "D09", "D10"],
    approvedKnowledgeUnitTarget:{ min:400, max:600 },
    reviewMode:"internal_review",
    recommendedSourceTypes:["industry_association", "association_template"],
    recommendedProviders:["Zen宅連", "全日本不動産協会"],
  },
  phase_2_3_partner_cases:{
    sourceTier:"tier_3_partner_practitioner_case",
    domains:["D04", "D05", "D06"],
    approvedKnowledgeUnitTarget:{ min:200, max:400 },
    reviewMode:"partner_takken_reviewer",
    recommendedSourceTypes:["partner_practitioner_case", "desensitized_case"],
    recommendedProviders:["partner_brokerage", "partner_property_manager"],
  },
  phase_2_4_ai_assisted_long_tail:{
    sourceTier:"tier_4_ai_assisted_draft",
    domains:["D11", "D12", "D13", "D14", "D15"],
    approvedKnowledgeUnitTarget:{ min:300, max:500 },
    reviewMode:"team_review_with_external_sampling",
    recommendedSourceTypes:["ai_assisted_draft", "ai_generated_draft"],
    recommendedProviders:["internal_ai_draft"],
  },
});

function knowledgeBrainColdStartDomainPlan(input = {}) {
  const coverage = knowledgeBrainDomainCoverage(input);
  const groups = Object.fromEntries(Object.entries(KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS).map(([phase, group]) => {
    const totals = group.domains.reduce((sum, domain) => {
      const domainCoverage = coverage.domains[domain] || {};
      sum.knowledgeUnits += domainCoverage.knowledgeUnits || 0;
      sum.approvedKnowledgeUnits += domainCoverage.approvedKnowledgeUnits || 0;
      sum.evalCases += domainCoverage.evalCases || 0;
      sum.approvedEvalCases += domainCoverage.approvedEvalCases || 0;
      return sum;
    }, { knowledgeUnits:0, approvedKnowledgeUnits:0, evalCases:0, approvedEvalCases:0 });
    return [phase, {
      ...group,
      ...totals,
      missingApprovedKnowledgeUnitDomains:group.domains.filter(domain => (coverage.domains[domain]?.approvedKnowledgeUnits || 0) === 0),
      missingEvalCaseDomains:group.domains.filter(domain => (coverage.domains[domain]?.evalCases || 0) === 0),
      targetMet:totals.approvedKnowledgeUnits >= group.approvedKnowledgeUnitTarget.min,
    }];
  }));
  return {
    groups,
    coverage,
    allTargetsMet:Object.values(groups).every(group => group.targetMet),
  };
}

function knowledgeBrainColdStartIngestionQueue(input = {}) {
  const plan = knowledgeBrainColdStartDomainPlan(input);
  return Object.entries(plan.groups)
    .map(([phase, group], index) => {
      const approvedKnowledgeUnitDeficit = Math.max(0, group.approvedKnowledgeUnitTarget.min - group.approvedKnowledgeUnits);
      const domainPriorities = group.domains.map(domain => {
        const domainCoverage = plan.coverage.domains[domain] || {};
        const needsApprovedKnowledgeUnit = (domainCoverage.approvedKnowledgeUnits || 0) === 0;
        const needsEvalCase = (domainCoverage.evalCases || 0) === 0;
        return {
          domain,
          approvedKnowledgeUnits:domainCoverage.approvedKnowledgeUnits || 0,
          evalCases:domainCoverage.evalCases || 0,
          needsApprovedKnowledgeUnit,
          needsEvalCase,
          priorityScore:(needsApprovedKnowledgeUnit ? 2 : 0) + (needsEvalCase ? 1 : 0),
        };
      }).sort((a, b) => b.priorityScore - a.priorityScore || a.domain.localeCompare(b.domain));
      return {
        phase,
        order:index + 1,
        sourceTier:group.sourceTier,
        reviewMode:group.reviewMode,
        recommendedSourceTypes:group.recommendedSourceTypes,
        recommendedProviders:group.recommendedProviders,
        targetRange:group.approvedKnowledgeUnitTarget,
        approvedKnowledgeUnits:group.approvedKnowledgeUnits,
        approvedKnowledgeUnitDeficit,
        missingApprovedKnowledgeUnitDomains:group.missingApprovedKnowledgeUnitDomains,
        missingEvalCaseDomains:group.missingEvalCaseDomains,
        nextDomains:domainPriorities.filter(item => item.priorityScore > 0).map(item => item.domain),
        domainPriorities,
      };
    })
    .filter(item => item.approvedKnowledgeUnitDeficit > 0 || item.missingApprovedKnowledgeUnitDomains.length > 0 || item.missingEvalCaseDomains.length > 0)
    .sort((a, b) => a.order - b.order);
}

function trainingEligibleSources(sources = []) {
  return sources.filter(source => sourceTrainingEligibilityReasons(source).length === 0);
}

function filterSourceRegistryRecords(sources = [], { sourceTypes = [], reviewStatuses = [], riskLevels = [], trainingAllowed, includeDeleted = false, query = "" } = {}) {
  const sourceTypeSet = new Set(sourceTypes);
  const reviewStatusSet = new Set(reviewStatuses);
  const riskLevelSet = new Set(riskLevels);
  const keyword = `${query || ""}`.trim().toLowerCase();
  return sources
    .filter(source => includeDeleted || source.deletion_requested !== true)
    .filter(source => !sourceTypeSet.size || sourceTypeSet.has(source.source_type))
    .filter(source => !reviewStatusSet.size || reviewStatusSet.has(source.review_status))
    .filter(source => !riskLevelSet.size || riskLevelSet.has(source.risk_level))
    .filter(source => trainingAllowed === undefined || source.training_allowed === trainingAllowed)
    .filter(source => {
      if (!keyword) return true;
      return [
        source.title,
        source.provider,
        source.origin_url,
        source.source_type,
        source.jurisdiction,
        source.collected_by,
      ].join("\n").toLowerCase().includes(keyword);
    })
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

function sourceTrainingMustBeDisabled(source = {}) {
  return source.deletion_requested === true ||
    ["high", "restricted"].includes(source.risk_level) ||
    HIGH_RISK_SOURCE_TYPES.includes(source.source_type) ||
    (source.training_allowed === true && !["opt_in", "explicit_opt_in"].includes(source.consent_scope));
}

function buildSourceRegistryUpdatePayload(current = {}, patch = {}, options = {}) {
  const updatePatch = options.incrementVersion === false
    ? {
        ...patch,
        updated_at:options.now || new Date().toISOString(),
      }
    : buildVersionedKnowledgePatch(current, patch, options);
  const record = applyReviewDecisionMetadata({
    ...current,
    ...updatePatch,
  }, options);
  if (record.source_type === "reins_user_upload" && !record.collection_method) {
    record.collection_method = "manual";
  }
  if (sourceTrainingMustBeDisabled(record)) {
    record.training_allowed = false;
  }
  const quality = validateSourceRegistryRecord(record);
  return { record, quality };
}

function buildSourceWithdrawalPatch(source = {}, { reason = "user_requested", requestedBy = "user", now = new Date().toISOString() } = {}) {
  return {
    ...source,
    review_status:"archived",
    training_allowed:false,
    consent_scope:"none",
    deletion_requested:true,
    updated_at:now,
    metadata:{
      ...(source.metadata && typeof source.metadata === "object" ? source.metadata : {}),
      previous_consent_scope:source.consent_scope || source.metadata?.consent_scope || "none",
      deletion_requested_at:now,
      deletion_reason:`${reason || "user_requested"}`.trim(),
      deletion_requested_by:`${requestedBy || "user"}`.trim(),
      training_withdrawn_at:now,
    },
  };
}

function applyReviewDecisionMetadata(record = {}, { changedBy = "user", now = new Date().toISOString() } = {}) {
  if (record.review_status !== "approved") return record;
  return {
    ...record,
    metadata:{
      ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}),
      reviewed_by:`${record.metadata?.reviewed_by || changedBy || "user"}`.trim(),
      reviewed_at:record.metadata?.reviewed_at || now,
    },
  };
}

function buildVersionedKnowledgePatch(current = {}, patch = {}, { changedBy = "user", reason = "manual_update", now = new Date().toISOString(), reviewStatus = "candidate" } = {}) {
  const currentVersion = Number.isInteger(Number(current.version)) && Number(current.version) > 0 ? Number(current.version) : 1;
  const nextVersion = patch.version === undefined || patch.version === null ? currentVersion + 1 : Number(patch.version);
  if (!Number.isInteger(nextVersion) || nextVersion <= currentVersion) {
    throw new Error("versioned knowledge updates must increment version.");
  }
  const nextReviewStatus = patch.review_status || reviewStatus;
  const metadata = {
    ...(current.metadata && typeof current.metadata === "object" ? current.metadata : {}),
    ...(patch.metadata && typeof patch.metadata === "object" ? patch.metadata : {}),
    previous_version:currentVersion,
    changed_by:`${changedBy || "user"}`.trim(),
    change_reason:`${reason || "manual_update"}`.trim(),
    changed_at:now,
  };
  if (nextReviewStatus === "approved") {
    metadata.reviewed_by = `${metadata.reviewed_by || changedBy || "user"}`.trim();
    metadata.reviewed_at = metadata.reviewed_at || now;
  }
  return {
    ...patch,
    version:nextVersion,
    review_status:nextReviewStatus,
    updated_at:now,
    metadata,
  };
}

function openKnowledgeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KB_DB_NAME, KB_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
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
      createKnowledgeBrainStores(db, transaction);
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

function approvedMemoryMetadata(metadata = {}, { conflict = null, approvedAt = new Date().toISOString() } = {}) {
  const approvalSummary = `${metadata.approvalSummary || ""}`
    .replace(/(记忆|メモリ|memory) (candidate|approved)/gi, "$1 approved")
    .replace(/(文档|文書|document) (candidate|approved)/gi, "$1 approved");
  return {
    ...metadata,
    approvalState:"approved",
    documentState:metadata.sourceDocId || metadata.documentState ? "approved" : metadata.documentState,
    requiresApproval:false,
    approvalAction:"approved",
    approvedAt,
    approvalSummary:approvalSummary || metadata.approvalSummary,
    conflict,
  };
}

async function approveProjectMemory(item) {
  const conflict = await findMemoryConflict(item).catch(() => null);
  await updateProjectMemory(item.id, {
    status:"approved",
    archived:false,
    metadata:approvedMemoryMetadata(item.metadata || {}, { conflict }),
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
  const brainStores = Object.values(KNOWLEDGE_BRAIN_STORES);
  const brainPayload = {};
  for (const store of brainStores) {
    brainPayload[store.name] = await readStore(store.name);
  }
  const payload = {
    version:KB_DB_VERSION,
    knowledgeBrainStores:KNOWLEDGE_BRAIN_STORES,
    exportedAt:new Date().toISOString(),
    documents:await readStore("documents"),
    chunks:await readStore("chunks"),
    memories:await readStore("memories"),
    ...brainPayload,
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
  const brainStores = Object.values(KNOWLEDGE_BRAIN_STORES);
  const brainPayload = Object.fromEntries(brainStores.map(store => [store.name, Array.isArray(payload[store.name]) ? payload[store.name] : []]));
  const brainItems = Object.values(brainPayload).flat();
  const totalItems = documents.length + chunks.length + memories.length + brainItems.length;
  const totalChars = [...documents, ...chunks, ...memories, ...brainItems]
    .reduce((sum, item) => sum + `${item?.title || ""}${item?.content || ""}${item?.summary || ""}`.length, 0);
  const validId = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
  if (totalItems > KB_IMPORT_MAX_ITEMS || totalChars > KB_IMPORT_MAX_TEXT_CHARS) {
    throw new Error("Knowledge export is too large.");
  }
  if (documents.some(item => !validId(item?.id)) || chunks.some(item => !validId(item?.id) || !validId(item?.docId)) || memories.some(item => !validId(item?.id)) || brainItems.some(item => !validId(item?.id))) {
    throw new Error("Knowledge export contains invalid record ids.");
  }
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "chunks", "memories", ...Object.values(KNOWLEDGE_BRAIN_STORES).map(store => store.name)], "readwrite");
    documents.forEach(item => tx.objectStore("documents").put({
      ...item,
      status:item.status === "approved" ? "approved" : "candidate",
      archived:!!item.archived,
      updatedAt:item.updatedAt || new Date().toISOString(),
    }));
    chunks.forEach(item => tx.objectStore("chunks").put(item));
    memories.forEach(item => tx.objectStore("memories").put(normalizeMemoryItem(item)));
    for (const store of brainStores) {
      brainPayload[store.name].forEach(item => tx.objectStore(store.name).put(normalizeImportedKnowledgeBrainRecord(store.name, item)));
    }
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
  await markKnowledgeBrainDeletedForDocument(docId).catch(() => {});
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

async function archiveLowValueMemories({ sourceType = "all" } = {}) {
  const memories = await listProjectMemories({ statuses:["short_term", "candidate"], includeExpired:true });
  const lowValue = selectLowValueMemories(memories, { sourceType });
  for (const item of lowValue) {
    await updateProjectMemory(item.id, { status:"archived", archived:true });
  }
  return lowValue.length;
}

function countByStatus(items = []) {
  return items.reduce((counts, item) => {
    const status = item?.review_status || item?.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function countByRiskLevel(items = []) {
  return items.reduce((counts, item) => {
    const risk = item?.risk_level || "unknown";
    counts[risk] = (counts[risk] || 0) + 1;
    return counts;
  }, {});
}

function knowledgeBrainDomainCoverage({ knowledgeUnits = [], evalCases = [] } = {}) {
  const domains = Object.fromEntries(JRE_KNOWLEDGE_DOMAINS.map(domain => [domain, {
    knowledgeUnits:0,
    approvedKnowledgeUnits:0,
    evalCases:0,
    approvedEvalCases:0,
  }]));
  const other = { knowledgeUnits:0, approvedKnowledgeUnits:0, evalCases:0, approvedEvalCases:0 };
  const bucketFor = (domain) => domains[domain] || other;
  for (const unit of knowledgeUnits) {
    const bucket = bucketFor(`${unit.domain || ""}`.trim());
    bucket.knowledgeUnits += 1;
    if (unit.review_status === "approved") bucket.approvedKnowledgeUnits += 1;
  }
  for (const evalCase of evalCases) {
    const domain = `${evalCase.domain || evalCase.metadata?.domain || ""}`.trim();
    const bucket = bucketFor(domain);
    bucket.evalCases += 1;
    if (evalCase.review_status === "approved") bucket.approvedEvalCases += 1;
  }
  return {
    domains,
    other,
    missingApprovedKnowledgeUnitDomains:JRE_KNOWLEDGE_DOMAINS.filter(domain => domains[domain].approvedKnowledgeUnits === 0),
    missingEvalCaseDomains:JRE_KNOWLEDGE_DOMAINS.filter(domain => domains[domain].evalCases === 0),
  };
}

function evalCaseCategory(evalCase = {}) {
  const explicit = `${evalCase.metadata?.eval_category || evalCase.eval_category || ""}`.trim();
  if (["prohibited_behavior", "scenario", "retrieval", "boundary"].includes(explicit)) return explicit;
  if (`${evalCase.forbidden_behavior || ""}`.trim()) return "prohibited_behavior";
  if (Array.isArray(evalCase.evidence_ref_ids) && evalCase.evidence_ref_ids.length > 0) return "retrieval";
  if (evalCase.scenario_id) return "scenario";
  return "boundary";
}

function evalCaseCategoryCounts(evalCases = []) {
  return evalCases.reduce((counts, evalCase) => {
    const category = evalCaseCategory(evalCase);
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
}

const DEFAULT_HIGH_RISK_EVAL_CATEGORY_RATIOS = Object.freeze({
  prohibited_behavior:0.4,
  scenario:0.3,
  retrieval:0.2,
  boundary:0.1,
});

function evalCaseMixReadiness(evalCases = [], {
  minEvalCases = 500,
  minCategoryRatios = DEFAULT_HIGH_RISK_EVAL_CATEGORY_RATIOS,
  requireApproved = true,
} = {}) {
  const scopedEvalCases = requireApproved
    ? evalCases.filter(evalCase => evalCase.review_status === "approved")
    : evalCases;
  const counts = evalCaseCategoryCounts(scopedEvalCases);
  const total = scopedEvalCases.length;
  const blockers = [];
  if (total < minEvalCases) {
    blockers.push({ gate:"approved_eval_cases", current:total, required:minEvalCases });
  }
  for (const [category, ratio] of Object.entries(minCategoryRatios)) {
    const required = Math.ceil(minEvalCases * ratio);
    const current = counts[category] || 0;
    if (current < required) {
      blockers.push({ gate:`eval_case_category_${category}`, current, required });
    }
  }
  return {
    ready:blockers.length === 0,
    requireApproved,
    gates:{ minEvalCases, minCategoryRatios },
    counts,
    total,
    blockers,
  };
}

function countKnowledgeUnitQualityIssues(units = []) {
  return units.reduce((counts, unit) => {
    const quality = validateKnowledgeUnitQuality(unit);
    if (quality.ok) return counts;
    counts.invalid += 1;
    for (const issue of quality.issues) {
      counts.byIssue[issue] = (counts.byIssue[issue] || 0) + 1;
    }
    return counts;
  }, { invalid:0, byIssue:{} });
}

function countSourceRegistryIssues(sources = []) {
  return sources.reduce((counts, source) => {
    const quality = validateSourceRegistryRecord(source);
    if (quality.ok) return counts;
    counts.invalid += 1;
    for (const issue of quality.issues) {
      counts.byIssue[issue] = (counts.byIssue[issue] || 0) + 1;
    }
    return counts;
  }, { invalid:0, byIssue:{} });
}

function countEvidenceRefQualityIssues(refs = []) {
  return refs.reduce((counts, ref) => {
    const quality = validateEvidenceRefQuality(ref);
    if (quality.ok) return counts;
    counts.invalid += 1;
    for (const issue of quality.issues) {
      counts.byIssue[issue] = (counts.byIssue[issue] || 0) + 1;
    }
    return counts;
  }, { invalid:0, byIssue:{} });
}

function countJapaneseRealEstateRecordIssues(records = []) {
  return records.reduce((counts, record) => {
    const quality = validateJapaneseRealEstateRecord(record);
    if (quality.ok) return counts;
    counts.invalid += 1;
    for (const issue of quality.issues) {
      counts.byIssue[issue] = (counts.byIssue[issue] || 0) + 1;
    }
    return counts;
  }, { invalid:0, byIssue:{} });
}

function countCalculationRunIssues(records = []) {
  return records.reduce((counts, record) => {
    const quality = validateCalculationRunRecord(record);
    if (quality.ok) return counts;
    counts.invalid += 1;
    for (const issue of quality.issues) {
      counts.byIssue[issue] = (counts.byIssue[issue] || 0) + 1;
    }
    return counts;
  }, { invalid:0, byIssue:{} });
}

function validateKnowledgeGovernanceRecordQuality(recordType, record = {}) {
  const type = `${recordType || ""}`.trim();
  const issues = [];
  if (!record.source_id) issues.push("missing_source_id");
  if (!record.review_status) issues.push("missing_review_status");
  if (!record.risk_level) issues.push("missing_risk_level");
  if (!record.version) issues.push("missing_version");
  if (["high", "restricted"].includes(record.risk_level) && (!Array.isArray(record.evidence_ref_ids) || record.evidence_ref_ids.length === 0)) {
    issues.push("high_risk_missing_evidence");
  }
  if (["high", "restricted"].includes(record.risk_level) && record.review_status !== "approved") {
    issues.push("high_risk_not_approved");
  }
  if (type === "policy_rule") {
    if (!`${record.rule_type || ""}`.trim()) issues.push("missing_rule_type");
    if (!`${record.title || ""}`.trim()) issues.push("missing_title");
    if (!`${record.rule_text || ""}`.trim()) issues.push("missing_rule_text");
    if (["high", "restricted"].includes(record.risk_level) && record.requires_expert_confirmation !== true) {
      issues.push("policy_rule_missing_expert_confirmation");
    }
  } else if (type === "scenario") {
    if (!`${record.scenario_type || ""}`.trim()) issues.push("missing_scenario_type");
    if (!`${record.title || ""}`.trim()) issues.push("missing_title");
    if (!`${record.description || ""}`.trim()) issues.push("missing_description");
  } else if (type === "eval_case") {
    if (!`${record.prompt || ""}`.trim()) issues.push("missing_prompt");
    if (!`${record.expected_behavior || ""}`.trim()) issues.push("missing_expected_behavior");
  } else {
    issues.push("invalid_governance_record_type");
  }
  return {
    ok:issues.length === 0,
    issues:[...new Set(issues)],
    requiresExpertConfirmation:["high", "restricted"].includes(record.risk_level) || record.requires_expert_confirmation === true,
  };
}

function countKnowledgeGovernanceRecordIssues(recordType, records = []) {
  return records.reduce((counts, record) => {
    const quality = validateKnowledgeGovernanceRecordQuality(recordType, record);
    if (quality.ok) return counts;
    counts.invalid += 1;
    for (const issue of quality.issues) {
      counts.byIssue[issue] = (counts.byIssue[issue] || 0) + 1;
    }
    return counts;
  }, { invalid:0, byIssue:{} });
}

function validateKnowledgeBrainReferenceIntegrity({ sources = [], evidenceRefs = [], knowledgeUnits = [], policyRules = [], scenarios = [], evalCases = [], japaneseRealEstateRecords = [], calculationRuns = [] } = {}) {
  const sourceById = new Map(sources.filter(source => source?.id).map(source => [source.id, source]));
  const evidenceById = new Map(evidenceRefs.filter(ref => ref?.id).map(ref => [ref.id, ref]));
  const issues = [];
  const addIssue = (target, issue, extra = {}) => {
    issues.push({
      target_type:target.target_type,
      target_id:target.target_id,
      issue,
      ...extra,
    });
  };
  const checkSource = (target, sourceId) => {
    if (!sourceId) {
      addIssue(target, "missing_source_id");
      return;
    }
    const source = sourceById.get(sourceId);
    if (!source) {
      addIssue(target, "missing_source_ref", { source_id:sourceId });
      return;
    }
    if (source.deletion_requested === true) addIssue(target, "deleted_source_ref", { source_id:sourceId });
    if (source.review_status === "archived") addIssue(target, "archived_source_ref", { source_id:sourceId });
    if (target.review_status === "approved" && source.review_status !== "approved") {
      addIssue(target, "approved_record_unapproved_source", { source_id:sourceId, source_review_status:source.review_status || "unknown" });
    }
  };
  const checkEvidence = (target, evidenceRefIds = []) => {
    for (const refId of evidenceRefIds) {
      const ref = evidenceById.get(refId);
      if (!ref) {
        addIssue(target, "missing_evidence_ref", { evidence_ref_id:refId });
        continue;
      }
      const evidenceSource = sourceById.get(ref.source_id);
      if (!evidenceSource) {
        addIssue(target, "evidence_missing_source_ref", { evidence_ref_id:refId, source_id:ref.source_id || "" });
      } else {
        if (evidenceSource.deletion_requested === true) addIssue(target, "evidence_deleted_source_ref", { evidence_ref_id:refId, source_id:ref.source_id || "" });
        if (evidenceSource.review_status === "archived") addIssue(target, "evidence_archived_source_ref", { evidence_ref_id:refId, source_id:ref.source_id || "" });
        if (ref.review_status === "approved" && evidenceSource.review_status !== "approved") {
          addIssue(target, "approved_evidence_unapproved_source", { evidence_ref_id:refId, source_id:ref.source_id || "", source_review_status:evidenceSource.review_status || "unknown" });
        }
      }
      if (target.review_status === "approved" && ref.review_status !== "approved") {
        addIssue(target, "approved_record_unapproved_evidence", { evidence_ref_id:refId, evidence_review_status:ref.review_status || "unknown" });
      }
      if (["high", "restricted"].includes(target.risk_level) && ref.review_status !== "approved") {
        addIssue(target, "high_risk_unapproved_evidence", { evidence_ref_id:refId, evidence_review_status:ref.review_status || "unknown" });
      }
      if (target.strictEvidenceTarget && (ref.target_type !== target.target_type || ref.target_id !== target.target_id)) {
        addIssue(target, "evidence_target_mismatch", { evidence_ref_id:refId, evidence_target_type:ref.target_type || "", evidence_target_id:ref.target_id || "" });
      }
    }
  };
  const checkReviewMetadata = (target) => {
    for (const reason of approvedHighRiskReviewMetadataReasons(target)) {
      addIssue(target, reason);
    }
  };
  for (const unit of knowledgeUnits) {
    const target = { target_type:"knowledge_unit", target_id:unit.id || "", review_status:unit.review_status, risk_level:unit.risk_level, metadata:unit.metadata, strictEvidenceTarget:true };
    checkReviewMetadata(target);
    checkSource(target, unit.source_id);
    checkEvidence(target, Array.isArray(unit.evidence_ref_ids) ? unit.evidence_ref_ids : []);
  }
  for (const rule of policyRules) {
    const target = { target_type:"policy_rule", target_id:rule.id || "", review_status:rule.review_status, risk_level:rule.risk_level, metadata:rule.metadata, strictEvidenceTarget:true };
    checkReviewMetadata(target);
    checkSource(target, rule.source_id);
    checkEvidence(target, Array.isArray(rule.evidence_ref_ids) ? rule.evidence_ref_ids : []);
  }
  for (const scenario of scenarios) {
    const target = { target_type:"scenario", target_id:scenario.id || "", review_status:scenario.review_status, risk_level:scenario.risk_level, metadata:scenario.metadata, strictEvidenceTarget:true };
    checkReviewMetadata(target);
    checkSource(target, scenario.source_id);
    checkEvidence(target, Array.isArray(scenario.evidence_ref_ids) ? scenario.evidence_ref_ids : []);
  }
  for (const evalCase of evalCases) {
    const target = { target_type:"eval_case", target_id:evalCase.id || "", review_status:evalCase.review_status, risk_level:evalCase.risk_level, metadata:evalCase.metadata, strictEvidenceTarget:true };
    checkReviewMetadata(target);
    checkSource(target, evalCase.source_id);
    checkEvidence(target, Array.isArray(evalCase.evidence_ref_ids) ? evalCase.evidence_ref_ids : []);
  }
  for (const record of japaneseRealEstateRecords) {
    const target = { target_type:`jre_${record.entity_type || "record"}`, target_id:record.id || "", review_status:record.review_status, risk_level:record.risk_level, metadata:record.metadata };
    checkReviewMetadata(target);
    checkSource(target, record.source_id);
    checkEvidence(target, Array.isArray(record.evidence_ref_ids) ? record.evidence_ref_ids : []);
  }
  for (const run of calculationRuns) {
    const target = { target_type:"calculation_run", target_id:run.id || "", review_status:run.review_status, risk_level:run.risk_level, metadata:run.metadata };
    checkReviewMetadata(target);
    for (const sourceId of Array.isArray(run.source_ids) ? run.source_ids : []) checkSource(target, sourceId);
    checkEvidence(target, Array.isArray(run.evidence_ref_ids) ? run.evidence_ref_ids : []);
  }
  return {
    ok:issues.length === 0,
    issues,
  };
}

function filterKnowledgeBrainReferenceIntegrityActions(actions = [], { targetTypes = [], sourceIds = [], issues = [], actions:actionNames = [], blocksApproval, query = "" } = {}) {
  const targetTypeSet = new Set(targetTypes);
  const sourceIdSet = new Set(sourceIds);
  const issueSet = new Set(issues);
  const actionSet = new Set(actionNames);
  const keyword = `${query || ""}`.trim().toLowerCase();
  return actions
    .filter(item => !targetTypeSet.size || targetTypeSet.has(item.target_type))
    .filter(item => !sourceIdSet.size || sourceIdSet.has(item.source_id))
    .filter(item => !issueSet.size || issueSet.has(item.issue))
    .filter(item => !actionSet.size || actionSet.has(item.action))
    .filter(item => blocksApproval === undefined || item.blocks_approval === blocksApproval)
    .filter(item => {
      if (!keyword) return true;
      return `${item.target_type || ""}\n${item.target_id || ""}\n${item.source_id || ""}\n${item.evidence_ref_id || ""}\n${item.issue || ""}\n${item.action || ""}`.toLowerCase().includes(keyword);
    });
}

function knowledgeBrainReferenceIntegrityActions(referenceIntegrity = {}, filters = {}) {
  const issues = Array.isArray(referenceIntegrity?.issues) ? referenceIntegrity.issues : [];
  const actionByIssue = {
    missing_source_id:"attach_source_or_archive_record",
    missing_source_ref:"restore_source_or_archive_record",
    deleted_source_ref:"archive_or_relink_record",
    archived_source_ref:"archive_or_relink_record",
    approved_record_unapproved_source:"approve_source_before_record",
    missing_evidence_ref:"attach_evidence_or_downgrade_review",
    evidence_missing_source_ref:"restore_evidence_source_or_replace_evidence",
    evidence_deleted_source_ref:"restore_evidence_source_or_replace_evidence",
    evidence_archived_source_ref:"restore_evidence_source_or_replace_evidence",
    approved_evidence_unapproved_source:"approve_evidence_source_before_record",
    approved_record_unapproved_evidence:"approve_evidence_before_record",
    high_risk_unapproved_evidence:"expert_review_evidence_before_approval",
    evidence_target_mismatch:"relink_evidence_to_target",
    missing_reviewed_by:"record_expert_reviewer_metadata",
    missing_reviewed_at:"record_expert_reviewer_metadata",
  };
  const actions = issues.map(issue => ({
    ...issue,
    action:actionByIssue[issue.issue] || "manual_review_required",
    blocks_approval:[
      "missing_source_id",
      "missing_source_ref",
      "deleted_source_ref",
      "archived_source_ref",
      "approved_record_unapproved_source",
      "missing_evidence_ref",
      "evidence_missing_source_ref",
      "evidence_deleted_source_ref",
      "evidence_archived_source_ref",
      "approved_evidence_unapproved_source",
      "approved_record_unapproved_evidence",
      "high_risk_unapproved_evidence",
      "evidence_target_mismatch",
      "missing_reviewed_by",
      "missing_reviewed_at",
    ].includes(issue.issue),
  }));
  return filterKnowledgeBrainReferenceIntegrityActions(actions, filters);
}

function needsKnowledgeBrainReview(item = {}) {
  return ["candidate", "in_review", "draft"].includes(item.review_status);
}

function approvedHighRiskReviewMetadataReasons(item = {}) {
  if (item.review_status !== "approved" || !["high", "restricted"].includes(item.risk_level)) return [];
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  return [
    `${metadata.reviewed_by || ""}`.trim() ? "" : "missing_reviewed_by",
    `${metadata.reviewed_at || ""}`.trim() ? "" : "missing_reviewed_at",
  ].filter(Boolean);
}

function filterKnowledgeBrainReviewQueueItems(items = [], { targetTypes = [], sourceIds = [], reviewStatuses = [], riskLevels = [], reasons = [], query = "" } = {}) {
  const targetTypeSet = new Set(targetTypes);
  const sourceIdSet = new Set(sourceIds);
  const reviewStatusSet = new Set(reviewStatuses);
  const riskLevelSet = new Set(riskLevels);
  const reasonSet = new Set(reasons);
  const keyword = `${query || ""}`.trim().toLowerCase();
  return items
    .filter(item => !targetTypeSet.size || targetTypeSet.has(item.target_type))
    .filter(item => !sourceIdSet.size || sourceIdSet.has(item.source_id))
    .filter(item => !reviewStatusSet.size || reviewStatusSet.has(item.review_status))
    .filter(item => !riskLevelSet.size || riskLevelSet.has(item.risk_level))
    .filter(item => !reasonSet.size || (Array.isArray(item.reasons) && item.reasons.some(reason => reasonSet.has(reason))))
    .filter(item => {
      if (!keyword) return true;
      return `${item.target_type || ""}\n${item.target_id || ""}\n${item.source_id || ""}\n${(item.reasons || []).join("\n")}`.toLowerCase().includes(keyword);
    });
}

function knowledgeBrainReviewQueueItems({ sources = [], knowledgeUnits = [], evidenceRefs = [], policyRules = [], scenarios = [], evalCases = [], japaneseRealEstateRecords = [], calculationRuns = [], limit = 100, targetTypes = [], sourceIds = [], reviewStatuses = [], riskLevels = [], reasons = [], query = "" } = {}) {
  const items = [];
  const itemByKey = new Map();
  const highRiskNeedsExpert = (item = {}) => ["high", "restricted"].includes(item.risk_level) && item.review_status !== "approved";
  const addItem = ({ target_type, target_id, review_status, risk_level, source_id = "", reasons = [], quality = null }) => {
    const uniqueReasons = [...new Set([
      ...reasons,
      ...(quality && !quality.ok ? quality.issues : []),
    ])].filter(Boolean);
    if (!uniqueReasons.length) return;
    const key = `${target_type}:${target_id}`;
    const existing = itemByKey.get(key);
    if (existing) {
      existing.reasons = [...new Set([...existing.reasons, ...uniqueReasons])];
      if (!existing.source_id && source_id) existing.source_id = source_id;
      if (existing.review_status === "unknown" && review_status) existing.review_status = review_status;
      if (existing.risk_level === "unknown" && risk_level) existing.risk_level = risk_level;
      return;
    }
    const item = {
      target_type,
      target_id,
      source_id,
      review_status:review_status || "unknown",
      risk_level:risk_level || "unknown",
      reasons:uniqueReasons,
    };
    itemByKey.set(key, item);
    items.push(item);
  };
  const targetRecordByKey = new Map();
  const rememberTarget = (target_type, target_id, record = {}) => {
    if (!target_id) return;
    targetRecordByKey.set(`${target_type}:${target_id}`, record);
  };
  const reviewReasons = item => [
    needsKnowledgeBrainReview(item) ? "needs_review" : "",
    highRiskNeedsExpert(item) ? "high_risk_expert_review" : "",
    item.requires_expert_confirmation === true && item.review_status !== "approved" ? "expert_confirmation_required" : "",
    ...approvedHighRiskReviewMetadataReasons(item),
  ].filter(Boolean);
  for (const source of sources) {
    addItem({
      target_type:"source_registry",
      target_id:source.id || "",
      review_status:source.review_status,
      risk_level:source.risk_level,
      reasons:reviewReasons(source),
      quality:validateSourceRegistryRecord(source),
    });
  }
  for (const ref of evidenceRefs) {
    rememberTarget("evidence_ref", ref.id || "", ref);
    addItem({
      target_type:"evidence_ref",
      target_id:ref.id || "",
      source_id:ref.source_id || "",
      review_status:ref.review_status,
      risk_level:ref.risk_level,
      reasons:reviewReasons(ref),
      quality:validateEvidenceRefQuality(ref),
    });
  }
  for (const unit of knowledgeUnits) {
    rememberTarget("knowledge_unit", unit.id || "", unit);
    addItem({
      target_type:"knowledge_unit",
      target_id:unit.id || "",
      source_id:unit.source_id || "",
      review_status:unit.review_status,
      risk_level:unit.risk_level,
      reasons:reviewReasons(unit),
      quality:validateKnowledgeUnitQuality(unit),
    });
  }
  for (const rule of policyRules) {
    rememberTarget("policy_rule", rule.id || "", rule);
    addItem({
      target_type:"policy_rule",
      target_id:rule.id || "",
      source_id:rule.source_id || "",
      review_status:rule.review_status,
      risk_level:rule.risk_level,
      reasons:reviewReasons(rule),
      quality:validateKnowledgeGovernanceRecordQuality("policy_rule", rule),
    });
  }
  for (const scenario of scenarios) {
    rememberTarget("scenario", scenario.id || "", scenario);
    addItem({
      target_type:"scenario",
      target_id:scenario.id || "",
      source_id:scenario.source_id || "",
      review_status:scenario.review_status,
      risk_level:scenario.risk_level,
      reasons:reviewReasons(scenario),
      quality:validateKnowledgeGovernanceRecordQuality("scenario", scenario),
    });
  }
  for (const evalCase of evalCases) {
    rememberTarget("eval_case", evalCase.id || "", evalCase);
    addItem({
      target_type:"eval_case",
      target_id:evalCase.id || "",
      source_id:evalCase.source_id || "",
      review_status:evalCase.review_status,
      risk_level:evalCase.risk_level,
      reasons:reviewReasons(evalCase),
      quality:validateKnowledgeGovernanceRecordQuality("eval_case", evalCase),
    });
  }
  for (const record of japaneseRealEstateRecords) {
    const targetType = `jre_${record.entity_type || "record"}`;
    rememberTarget(targetType, record.id || "", record);
    addItem({
      target_type:targetType,
      target_id:record.id || "",
      source_id:record.source_id || "",
      review_status:record.review_status,
      risk_level:record.risk_level,
      reasons:reviewReasons(record),
      quality:validateJapaneseRealEstateRecord(record),
    });
  }
  for (const record of calculationRuns) {
    rememberTarget("calculation_run", record.id || "", record);
    addItem({
      target_type:"calculation_run",
      target_id:record.id || "",
      review_status:record.review_status,
      risk_level:record.risk_level,
      reasons:reviewReasons(record),
      quality:validateCalculationRunRecord(record),
    });
  }
  const referenceIntegrity = validateKnowledgeBrainReferenceIntegrity({
    sources,
    evidenceRefs,
    knowledgeUnits,
    policyRules,
    scenarios,
    evalCases,
    japaneseRealEstateRecords,
    calculationRuns,
  });
  for (const issue of referenceIntegrity.issues) {
    const record = targetRecordByKey.get(`${issue.target_type}:${issue.target_id}`) || {};
    addItem({
      target_type:issue.target_type,
      target_id:issue.target_id,
      source_id:issue.source_id || record.source_id || "",
      review_status:record.review_status,
      risk_level:record.risk_level,
      reasons:[issue.issue],
    });
  }
  return filterKnowledgeBrainReviewQueueItems(items, { targetTypes, sourceIds, reviewStatuses, riskLevels, reasons, query })
    .sort((a, b) => {
      const highA = ["high", "restricted"].includes(a.risk_level) ? 1 : 0;
      const highB = ["high", "restricted"].includes(b.risk_level) ? 1 : 0;
      if (highA !== highB) return highB - highA;
      return a.target_type.localeCompare(b.target_type) || a.target_id.localeCompare(b.target_id);
    })
    .slice(0, limit);
}

function knowledgeBrainReviewQueueSummary({ sources = [], knowledgeUnits = [], policyRules = [], scenarios = [], evalCases = [], japaneseRealEstateRecords = [], calculationRuns = [] } = {}) {
  const highRiskNeedsExpert = (item = {}) => ["high", "restricted"].includes(item.risk_level) && item.review_status !== "approved";
  const unitQuality = knowledgeUnits.map(unit => ({ unit, quality:validateKnowledgeUnitQuality(unit) }));
  const policyQuality = policyRules.map(record => ({ record, quality:validateKnowledgeGovernanceRecordQuality("policy_rule", record) }));
  const scenarioQuality = scenarios.map(record => ({ record, quality:validateKnowledgeGovernanceRecordQuality("scenario", record) }));
  const evalQuality = evalCases.map(record => ({ record, quality:validateKnowledgeGovernanceRecordQuality("eval_case", record) }));
  const jreQuality = japaneseRealEstateRecords.map(record => ({ record, quality:validateJapaneseRealEstateRecord(record) }));
  const calculationQuality = calculationRuns.map(record => ({ record, quality:validateCalculationRunRecord(record) }));
  return {
    total:
      sources.filter(needsKnowledgeBrainReview).length +
      knowledgeUnits.filter(needsKnowledgeBrainReview).length +
      policyRules.filter(needsKnowledgeBrainReview).length +
      scenarios.filter(needsKnowledgeBrainReview).length +
      evalCases.filter(needsKnowledgeBrainReview).length +
      japaneseRealEstateRecords.filter(needsKnowledgeBrainReview).length +
      calculationRuns.filter(needsKnowledgeBrainReview).length,
    sources:sources.filter(needsKnowledgeBrainReview).length,
    knowledgeUnits:knowledgeUnits.filter(needsKnowledgeBrainReview).length,
    policyRules:policyRules.filter(needsKnowledgeBrainReview).length,
    scenarios:scenarios.filter(needsKnowledgeBrainReview).length,
    evalCases:evalCases.filter(needsKnowledgeBrainReview).length,
    japaneseRealEstateRecords:japaneseRealEstateRecords.filter(needsKnowledgeBrainReview).length,
    calculationRuns:calculationRuns.filter(needsKnowledgeBrainReview).length,
    highRiskExpertReview:
      sources.filter(highRiskNeedsExpert).length +
      knowledgeUnits.filter(highRiskNeedsExpert).length +
      policyRules.filter(rule => highRiskNeedsExpert(rule) || rule.requires_expert_confirmation === true && rule.review_status !== "approved").length +
      scenarios.filter(highRiskNeedsExpert).length +
      evalCases.filter(highRiskNeedsExpert).length +
      japaneseRealEstateRecords.filter(record => highRiskNeedsExpert(record) || record.requires_expert_confirmation === true && record.review_status !== "approved").length +
      calculationRuns.filter(highRiskNeedsExpert).length,
    invalidKnowledgeUnits:unitQuality.filter(item => !item.quality.ok).length,
    invalidKnowledgeUnitIds:unitQuality.filter(item => !item.quality.ok).map(item => item.unit.id).filter(Boolean).slice(0, 50),
    invalidPolicyRules:policyQuality.filter(item => !item.quality.ok).length,
    invalidPolicyRuleIds:policyQuality.filter(item => !item.quality.ok).map(item => item.record.id).filter(Boolean).slice(0, 50),
    invalidScenarios:scenarioQuality.filter(item => !item.quality.ok).length,
    invalidScenarioIds:scenarioQuality.filter(item => !item.quality.ok).map(item => item.record.id).filter(Boolean).slice(0, 50),
    invalidEvalCases:evalQuality.filter(item => !item.quality.ok).length,
    invalidEvalCaseIds:evalQuality.filter(item => !item.quality.ok).map(item => item.record.id).filter(Boolean).slice(0, 50),
    invalidJapaneseRealEstateRecords:jreQuality.filter(item => !item.quality.ok).length,
    invalidJapaneseRealEstateRecordIds:jreQuality.filter(item => !item.quality.ok).map(item => item.record.id).filter(Boolean).slice(0, 50),
    invalidCalculationRuns:calculationQuality.filter(item => !item.quality.ok).length,
    invalidCalculationRunIds:calculationQuality.filter(item => !item.quality.ok).map(item => item.record.id).filter(Boolean).slice(0, 50),
  };
}

function knowledgeBrainInventoryStats({ sources = [], knowledgeUnits = [], evidenceRefs = [], policyRules = [], scenarios = [], evalCases = [], japaneseRealEstateRecords = [], calculationRuns = [] } = {}) {
  const retainedSources = sources.filter(source => source.deletion_requested !== true && source.review_status !== "archived");
  const highRiskUnits = knowledgeUnits.filter(unit => ["high", "restricted"].includes(unit.risk_level));
  const qualityIssues = countKnowledgeUnitQualityIssues(knowledgeUnits);
  const sourceIssues = countSourceRegistryIssues(sources);
  const evidenceIssues = countEvidenceRefQualityIssues(evidenceRefs);
  const policyIssues = countKnowledgeGovernanceRecordIssues("policy_rule", policyRules);
  const scenarioIssues = countKnowledgeGovernanceRecordIssues("scenario", scenarios);
  const evalIssues = countKnowledgeGovernanceRecordIssues("eval_case", evalCases);
  const jreIssues = countJapaneseRealEstateRecordIssues(japaneseRealEstateRecords);
  const calculationIssues = countCalculationRunIssues(calculationRuns);
  const reviewQueue = knowledgeBrainReviewQueueSummary({ sources, knowledgeUnits, policyRules, scenarios, evalCases, japaneseRealEstateRecords, calculationRuns });
  const reviewQueueItems = knowledgeBrainReviewQueueItems({ sources, knowledgeUnits, evidenceRefs, policyRules, scenarios, evalCases, japaneseRealEstateRecords, calculationRuns, limit:50 });
  const domainCoverage = knowledgeBrainDomainCoverage({ knowledgeUnits, evalCases });
  const versionChain = validateKnowledgeUnitVersionChain(knowledgeUnits);
  const referenceIntegrity = validateKnowledgeBrainReferenceIntegrity({
    sources,
    evidenceRefs,
    knowledgeUnits,
    policyRules,
    scenarios,
    evalCases,
    japaneseRealEstateRecords,
    calculationRuns,
  });
  const referenceIntegrityActions = knowledgeBrainReferenceIntegrityActions(referenceIntegrity);
  return {
    sourceRegistry:retainedSources.length,
    deletedSources:sources.filter(source => source.deletion_requested === true).length,
    trainingEligibleSources:trainingEligibleSources(sources).length,
    trainingBlockedByConsentSources:sources.filter(source => source.training_allowed === true && !["opt_in", "explicit_opt_in"].includes(source.consent_scope)).length,
    sourceReviewStatus:countByStatus(sources),
    sourceRiskLevels:countByRiskLevel(sources),
    invalidSources:sourceIssues.invalid,
    sourceRegistryQualityIssues:sourceIssues.byIssue,
    sourceTrainingEligibilityBlockedReasons:sourceTrainingEligibilityBlockedReasonCounts(sources),
    sourceUsagePermissionBlockedReasons:sourceUsagePermissionBlockedReasonCounts(sources),
    sourceColdStartTierCounts:sourceColdStartTierCounts(sources),
    knowledgeUnits:knowledgeUnits.length,
    approvedKnowledgeUnits:knowledgeUnits.filter(unit => unit.review_status === "approved").length,
    highRiskKnowledgeUnits:highRiskUnits.length,
    invalidKnowledgeUnits:qualityIssues.invalid,
    knowledgeUnitQualityIssues:qualityIssues.byIssue,
    versionChainIssues:versionChain.issues.length,
    knowledgeUnitVersionChainIssues:versionChain.issues.slice(0, 50),
    knowledgeUnitReviewStatus:countByStatus(knowledgeUnits),
    knowledgeUnitRiskLevels:countByRiskLevel(knowledgeUnits),
    knowledgeBrainDomainCoverage:domainCoverage,
    knowledgeBrainColdStartDomainPlan:knowledgeBrainColdStartDomainPlan({ knowledgeUnits, evalCases }),
    knowledgeBrainColdStartIngestionQueue:knowledgeBrainColdStartIngestionQueue({ knowledgeUnits, evalCases }).slice(0, 10),
    evidenceRefs:evidenceRefs.length,
    approvedEvidenceRefs:evidenceRefs.filter(ref => ref.review_status === "approved").length,
    invalidEvidenceRefs:evidenceIssues.invalid,
    evidenceRefQualityIssues:evidenceIssues.byIssue,
    referenceIntegrityIssues:referenceIntegrity.issues.length,
    knowledgeBrainReferenceIntegrityIssues:referenceIntegrity.issues.slice(0, 50),
    knowledgeBrainReferenceIntegrityActions:referenceIntegrityActions.slice(0, 50),
    policyRules:policyRules.length,
    policyRuleReviewStatus:countByStatus(policyRules),
    policyRuleRiskLevels:countByRiskLevel(policyRules),
    invalidPolicyRules:policyIssues.invalid,
    policyRuleQualityIssues:policyIssues.byIssue,
    scenarios:scenarios.length,
    scenarioReviewStatus:countByStatus(scenarios),
    scenarioRiskLevels:countByRiskLevel(scenarios),
    invalidScenarios:scenarioIssues.invalid,
    scenarioQualityIssues:scenarioIssues.byIssue,
    evalCases:evalCases.length,
    evalCaseReviewStatus:countByStatus(evalCases),
    evalCaseRiskLevels:countByRiskLevel(evalCases),
    evalCaseCategoryCounts:evalCaseCategoryCounts(evalCases),
    evalCaseMixReadiness:evalCaseMixReadiness(evalCases),
    invalidEvalCases:evalIssues.invalid,
    evalCaseQualityIssues:evalIssues.byIssue,
    japaneseRealEstateRecords:japaneseRealEstateRecords.length,
    japaneseRealEstateRecordsByType:JRE_ENTITY_TYPES.reduce((counts, type) => {
      counts[type] = japaneseRealEstateRecords.filter(record => record.entity_type === type).length;
      return counts;
    }, {}),
    japaneseRealEstateReviewStatus:countByStatus(japaneseRealEstateRecords),
    japaneseRealEstateRiskLevels:countByRiskLevel(japaneseRealEstateRecords),
    invalidJapaneseRealEstateRecords:jreIssues.invalid,
    japaneseRealEstateRecordQualityIssues:jreIssues.byIssue,
    calculationRuns:calculationRuns.length,
    calculationRunReviewStatus:countByStatus(calculationRuns),
    calculationRunRiskLevels:countByRiskLevel(calculationRuns),
    invalidCalculationRuns:calculationIssues.invalid,
    calculationRunQualityIssues:calculationIssues.byIssue,
    reviewQueue,
    reviewQueueItems,
  };
}

function knowledgeBrainColdStartReadiness(input = {}, {
  minApprovedKnowledgeUnits = 800,
  minEvalCases = 300,
  requireAllDomains = true,
  requireOfficialPublicSource = true,
  requireIndustryAssociationSource = true,
  requirePartnerPractitionerSource = true,
  requireCleanReferenceIntegrity = true,
} = {}) {
  const stats = knowledgeBrainInventoryStats(input);
  const blockers = [];
  const addBlocker = (gate, current, required) => blockers.push({ gate, current, required });
  if (stats.approvedKnowledgeUnits < minApprovedKnowledgeUnits) {
    addBlocker("approved_knowledge_units", stats.approvedKnowledgeUnits, minApprovedKnowledgeUnits);
  }
  if (stats.evalCases < minEvalCases) {
    addBlocker("eval_cases", stats.evalCases, minEvalCases);
  }
  if (requireAllDomains && stats.knowledgeBrainDomainCoverage.missingApprovedKnowledgeUnitDomains.length > 0) {
    addBlocker("approved_knowledge_domain_coverage", stats.knowledgeBrainDomainCoverage.missingApprovedKnowledgeUnitDomains.length, 0);
  }
  if (requireAllDomains && stats.knowledgeBrainDomainCoverage.missingEvalCaseDomains.length > 0) {
    addBlocker("eval_case_domain_coverage", stats.knowledgeBrainDomainCoverage.missingEvalCaseDomains.length, 0);
  }
  const tierCounts = stats.sourceColdStartTierCounts;
  if (requireOfficialPublicSource && !tierCounts.tier_1_official_public) {
    addBlocker("official_public_source_tier", 0, 1);
  }
  if (requireIndustryAssociationSource && !tierCounts.tier_2_industry_association) {
    addBlocker("industry_association_source_tier", 0, 1);
  }
  if (requirePartnerPractitionerSource && !tierCounts.tier_3_partner_practitioner_case) {
    addBlocker("partner_practitioner_source_tier", 0, 1);
  }
  if (requireCleanReferenceIntegrity && stats.referenceIntegrityIssues > 0) {
    addBlocker("reference_integrity", stats.referenceIntegrityIssues, 0);
  }
  return {
    ready: blockers.length === 0,
    phase:"v0.1_cold_start",
    gates:{
      minApprovedKnowledgeUnits,
      minEvalCases,
      requireAllDomains,
      requireOfficialPublicSource,
      requireIndustryAssociationSource,
      requirePartnerPractitionerSource,
      requireCleanReferenceIntegrity,
    },
    blockers,
    stats,
  };
}

const HIGH_RISK_TOOL_IDS = Object.freeze(["M4", "M5", "assessment_basis", "contract_risk_check"]);

function knowledgeBrainHighRiskToolReadiness(input = {}, {
  toolId = "M4",
  externalRelease = true,
  coldStartOptions = {},
  evalMixOptions = {},
} = {}) {
  const normalizedToolId = `${toolId || ""}`.trim();
  const coldStart = knowledgeBrainColdStartReadiness(input, coldStartOptions);
  const evalMix = evalCaseMixReadiness(input.evalCases || [], evalMixOptions);
  const blockers = [];
  const addNestedBlockers = (gate, readiness) => {
    for (const blocker of readiness.blockers) {
      blockers.push({
        gate,
        sub_gate:blocker.gate,
        current:blocker.current,
        required:blocker.required,
      });
    }
  };
  if (!coldStart.ready) addNestedBlockers("cold_start_readiness", coldStart);
  if (!evalMix.ready) addNestedBlockers("eval_set_mix", evalMix);
  if (!HIGH_RISK_TOOL_IDS.includes(normalizedToolId)) {
    blockers.push({ gate:"high_risk_tool_id", current:normalizedToolId || "(empty)", required:HIGH_RISK_TOOL_IDS.slice(0, 2).join("|") });
  }
  return {
    ready:blockers.length === 0,
    toolId:normalizedToolId,
    releaseMode:blockers.length === 0 && externalRelease ? "external_release" : "internal_pilot",
    externalReleaseAllowed:blockers.length === 0 && externalRelease,
    internalPilotAllowed:true,
    blockers,
    coldStart,
    evalMix,
  };
}

async function knowledgeStats() {
  const jreStoreNames = JRE_ENTITY_TYPES.map(type => `${type}_records`);
  const [docs, memories, archived, sources, knowledgeUnits, evidenceRefs, policyRules, scenarios, evalCases, calculationRuns, ...jreRecordGroups] = await Promise.all([
    listKnowledgeDocuments(),
    listProjectMemories({ statuses:["short_term", "candidate", "approved"] }),
    listProjectMemories({ statuses:["archived"], includeExpired:true }),
    readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.sourceRegistry.name),
    readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.knowledgeUnits.name),
    readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.evidenceRefs.name),
    readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.policyRules.name),
    readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.scenarios.name),
    readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.evalCases.name),
    readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.calculationRuns.name),
    ...jreStoreNames.map(name => readKnowledgeBrainStore(name)),
  ]);
  const japaneseRealEstateRecords = jreRecordGroups.flat();
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => ({})) : {};
  return {
    ...knowledgeBrainInventoryStats({ sources, knowledgeUnits, evidenceRefs, policyRules, scenarios, evalCases, japaneseRealEstateRecords, calculationRuns }),
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

async function putKnowledgeDocument({ title, source, text, sourceType = "", domain = "general", reviewStatus = "candidate", riskLevel = "", metadata = {} }) {
  const db = await openKnowledgeDb();
  const id = `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const chunks = chunkText(text);
  const now = new Date().toISOString();
  const brainRecords = buildKnowledgeDocumentIngestRecords({
    title,
    source,
    text,
    chunks,
    sourceType,
    domain,
    reviewStatus,
    riskLevel,
    metadata,
    documentId:id,
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "chunks", "source_registry", "knowledge_units", "evidence_refs"], "readwrite");
    tx.objectStore("documents").put({ id, title, source, size:text.length, chunks:chunks.length, status:"candidate", archived:false, createdAt:now, updatedAt:now });
    chunks.forEach((content, index) => {
      tx.objectStore("chunks").put({ id:`${id}-chunk-${index}`, docId:id, title, index, content });
    });
    tx.objectStore("source_registry").put(brainRecords.source);
    brainRecords.knowledgeUnits.forEach(item => tx.objectStore("knowledge_units").put(item));
    brainRecords.evidenceRefs.forEach(item => tx.objectStore("evidence_refs").put(item));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { id, chunks:chunks.length, sourceId:brainRecords.source.id, knowledgeUnits:brainRecords.knowledgeUnits.length, evidenceRefs:brainRecords.evidenceRefs.length };
}

async function putSourceRegistryRecord(input = {}) {
  const payload = buildSourceRegistryIngestPayload(input);
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(KNOWLEDGE_BRAIN_STORES.sourceRegistry.name, "readwrite");
    tx.objectStore(KNOWLEDGE_BRAIN_STORES.sourceRegistry.name).put(payload.record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return {
    sourceId:payload.record.id,
    record:payload.record,
    quality:payload.quality,
    trainingEligible:payload.trainingEligible,
  };
}

async function putJapaneseRealEstateSourceIngest({ title, source = "attachment", text = "", sourceType = "", reviewStatus = "candidate", riskLevel = "", metadata = {}, records = [] } = {}) {
  const db = await openKnowledgeDb();
  const id = `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const safeText = `${text || ""}`;
  const chunks = safeText.trim() ? chunkText(safeText) : [];
  const now = new Date().toISOString();
  const ingest = buildJapaneseRealEstateSourceIngestRecords({
    title,
    source,
    text:safeText,
    sourceType,
    reviewStatus,
    riskLevel,
    metadata,
    records,
    documentId:id,
  });
  const entityStoreNames = [...new Set(ingest.records.map(item => item.storeName))];
  const storeNames = ["source_registry", "evidence_refs", ...entityStoreNames];
  if (chunks.length) storeNames.push("documents", "chunks");
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, "readwrite");
    if (chunks.length) {
      tx.objectStore("documents").put({ id, title, source, size:safeText.length, chunks:chunks.length, status:"candidate", archived:false, createdAt:now, updatedAt:now });
      chunks.forEach((content, index) => {
        tx.objectStore("chunks").put({ id:`${id}-chunk-${index}`, docId:id, title, index, content });
      });
    }
    tx.objectStore("source_registry").put(ingest.source);
    ingest.evidenceRefs.forEach(item => tx.objectStore("evidence_refs").put(item));
    ingest.records.forEach(item => tx.objectStore(item.storeName).put(item.record));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return {
    id:chunks.length ? id : "",
    chunks:chunks.length,
    sourceId:ingest.source.id,
    records:ingest.records.length,
    evidenceRefs:ingest.evidenceRefs.length,
    referenceIntegrity:ingest.referenceIntegrity,
    reviewQueue:ingest.reviewQueue,
    quality:ingest.records.map(item => ({ id:item.record.id, entity_type:item.record.entity_type, ok:item.quality.ok, issues:item.quality.issues })),
  };
}

async function readKnowledgeBrainStore(storeName) {
  const db = await openKnowledgeDb();
  const items = await new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items;
}

async function listSourceRegistry(filters = {}) {
  const sources = await readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.sourceRegistry.name);
  return filterSourceRegistryRecords(sources, filters);
}

async function updateSourceRegistryRecord(id, patch = {}, options = {}) {
  const safeId = `${id || ""}`.trim();
  if (!safeId) throw new Error("id is required.");
  const db = await openKnowledgeDb();
  const result = await new Promise((resolve, reject) => {
    let output = null;
    const tx = db.transaction(KNOWLEDGE_BRAIN_STORES.sourceRegistry.name, "readwrite");
    const store = tx.objectStore(KNOWLEDGE_BRAIN_STORES.sourceRegistry.name);
    const request = store.get(safeId);
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      const payload = buildSourceRegistryUpdatePayload(current, patch, options);
      store.put(payload.record);
      output = payload;
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(output);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return result;
}

async function listKnowledgeUnits(filters = {}) {
  const units = await readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.knowledgeUnits.name);
  return filterKnowledgeUnitRecords(units, filters);
}

async function updateKnowledgeUnit(id, patch = {}, options = {}) {
  const safeId = `${id || ""}`.trim();
  if (!safeId) throw new Error("id is required.");
  const db = await openKnowledgeDb();
  const result = await new Promise((resolve, reject) => {
    let output = null;
    const tx = db.transaction(KNOWLEDGE_BRAIN_STORES.knowledgeUnits.name, "readwrite");
    const store = tx.objectStore(KNOWLEDGE_BRAIN_STORES.knowledgeUnits.name);
    const request = store.get(safeId);
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      const payload = buildKnowledgeUnitUpdatePayload(current, patch, options);
      store.put(payload.record);
      output = payload;
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(output);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return result;
}

async function listEvidenceRefs(filters = {}) {
  const refs = await readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.evidenceRefs.name);
  return filterEvidenceRefRecords(refs, filters);
}

async function updateEvidenceRef(id, patch = {}, options = {}) {
  const safeId = `${id || ""}`.trim();
  if (!safeId) throw new Error("id is required.");
  const db = await openKnowledgeDb();
  const result = await new Promise((resolve, reject) => {
    let output = null;
    const tx = db.transaction(KNOWLEDGE_BRAIN_STORES.evidenceRefs.name, "readwrite");
    const store = tx.objectStore(KNOWLEDGE_BRAIN_STORES.evidenceRefs.name);
    const request = store.get(safeId);
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      const payload = buildEvidenceRefUpdatePayload(current, patch, options);
      store.put(payload.record);
      output = payload;
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(output);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return result;
}

async function putKnowledgeGovernanceRecord(recordType, input = {}) {
  const { storeName, record } = buildKnowledgeGovernanceRecordPayload(recordType, input);
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { record, storeName };
}

async function updateKnowledgeGovernanceRecord(recordType, id, patch = {}, options = {}) {
  const normalized = `${recordType || ""}`.trim();
  const definition = GOVERNANCE_RECORD_BUILDERS[normalized];
  if (!definition) {
    throw new Error("recordType must be one of: policy_rule, scenario, eval_case");
  }
  const db = await openKnowledgeDb();
  const result = await new Promise((resolve, reject) => {
    let output = null;
    const tx = db.transaction(definition.storeName, "readwrite");
    const store = tx.objectStore(definition.storeName);
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      const payload = buildKnowledgeGovernanceUpdatePayload(normalized, current, patch, options);
      store.put(payload.record);
      output = payload;
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(output);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return result;
}

async function listKnowledgeGovernanceRecords(recordType, filters = {}) {
  const normalized = `${recordType || ""}`.trim();
  const definition = GOVERNANCE_RECORD_BUILDERS[normalized];
  if (!definition) {
    throw new Error("recordType must be one of: policy_rule, scenario, eval_case");
  }
  const records = await readKnowledgeBrainStore(definition.storeName);
  return filterKnowledgeGovernanceRecords(records, filters);
}

async function requestSourceDeletion(sourceId, { reason = "user_requested", requestedBy = "user" } = {}) {
  const safeSourceId = `${sourceId || ""}`.trim();
  if (!safeSourceId) throw new Error("sourceId is required.");
  const db = await openKnowledgeDb();
  const now = new Date().toISOString();
  const touched = await new Promise((resolve, reject) => {
    const counts = { sources:0, knowledgeUnits:0, policyRules:0, scenarios:0, evalCases:0, evidenceRefs:0, japaneseRealEstateRecords:0, calculationRuns:0 };
    const storeNames = [
      KNOWLEDGE_BRAIN_STORES.sourceRegistry.name,
      KNOWLEDGE_BRAIN_STORES.knowledgeUnits.name,
      KNOWLEDGE_BRAIN_STORES.policyRules.name,
      KNOWLEDGE_BRAIN_STORES.scenarios.name,
      KNOWLEDGE_BRAIN_STORES.evalCases.name,
      KNOWLEDGE_BRAIN_STORES.evidenceRefs.name,
      KNOWLEDGE_BRAIN_STORES.calculationRuns.name,
      ...JRE_ENTITY_TYPES.map(type => japaneseRealEstateStoreName(type)),
    ];
    const tx = db.transaction(storeNames, "readwrite");
    const sourceStore = tx.objectStore(KNOWLEDGE_BRAIN_STORES.sourceRegistry.name);
    const sourceRequest = sourceStore.get(safeSourceId);
    sourceRequest.onsuccess = () => {
      if (sourceRequest.result) {
        sourceStore.put(buildSourceWithdrawalPatch(sourceRequest.result, { reason, requestedBy, now }));
        counts.sources += 1;
      }
    };
    const archiveLinkedRecord = (storeName, countKey, predicate) => {
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        for (const item of request.result || []) {
          if (!predicate(item)) continue;
          store.put({
            ...item,
            review_status:"archived",
            updated_at:now,
            metadata:{
              ...(item.metadata && typeof item.metadata === "object" ? item.metadata : {}),
              archived_due_to_source_deletion:safeSourceId,
              archived_at:now,
            },
          });
          counts[countKey] += 1;
        }
      };
    };
    archiveLinkedRecord(KNOWLEDGE_BRAIN_STORES.knowledgeUnits.name, "knowledgeUnits", item => item.source_id === safeSourceId);
    archiveLinkedRecord(KNOWLEDGE_BRAIN_STORES.policyRules.name, "policyRules", item => item.source_id === safeSourceId);
    archiveLinkedRecord(KNOWLEDGE_BRAIN_STORES.scenarios.name, "scenarios", item => item.source_id === safeSourceId);
    archiveLinkedRecord(KNOWLEDGE_BRAIN_STORES.evalCases.name, "evalCases", item => item.source_id === safeSourceId);
    archiveLinkedRecord(KNOWLEDGE_BRAIN_STORES.evidenceRefs.name, "evidenceRefs", item => item.source_id === safeSourceId);
    archiveLinkedRecord(KNOWLEDGE_BRAIN_STORES.calculationRuns.name, "calculationRuns", item => Array.isArray(item.source_ids) && item.source_ids.includes(safeSourceId));
    for (const entityType of JRE_ENTITY_TYPES) {
      archiveLinkedRecord(japaneseRealEstateStoreName(entityType), "japaneseRealEstateRecords", item => item.source_id === safeSourceId);
    }
    tx.oncomplete = () => resolve(counts);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { sourceId:safeSourceId, deletionRequested:true, trainingAllowed:false, touched };
}

async function putJapaneseRealEstateRecord(entityType, input = {}) {
  const { storeName, record, quality } = buildJapaneseRealEstateRecordPayload(entityType, input);
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { record, quality };
}

async function listJapaneseRealEstateRecords(filters = {}) {
  const { entityType = "" } = filters;
  const storeNames = entityType
    ? [japaneseRealEstateStoreName(entityType)]
    : JRE_ENTITY_TYPES.map(type => japaneseRealEstateStoreName(type));
  const groups = await Promise.all(storeNames.map(name => readKnowledgeBrainStore(name)));
  return filterJapaneseRealEstateRecords(groups.flat(), filters);
}

async function updateJapaneseRealEstateRecord(entityType, id, patch = {}, options = {}) {
  const storeName = japaneseRealEstateStoreName(entityType);
  const db = await openKnowledgeDb();
  const result = await new Promise((resolve, reject) => {
    let output = null;
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current) {
        return;
      }
      const updatePatch = options.incrementVersion === false
        ? {
            ...patch,
            updated_at:options.now || new Date().toISOString(),
          }
        : buildVersionedKnowledgePatch(current, patch, options);
      const merged = applyReviewDecisionMetadata({
        ...current,
        ...updatePatch,
        entity_type:current.entity_type,
        source_id:updatePatch.source_id || current.source_id,
      }, options);
      const quality = validateJapaneseRealEstateRecord(merged);
      if (quality.issues.includes("llm_financial_calculation")) {
        reject(new Error("Financial real estate records must not use LLM calculation."));
        return;
      }
      store.put(merged);
      output = { record:merged, quality };
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(output);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return result;
}

async function archiveJapaneseRealEstateRecord(entityType, id) {
  return updateJapaneseRealEstateRecord(entityType, id, { review_status:"archived" }, { incrementVersion:false });
}

function buildPropertyDossier({ propertyId, records = [] } = {}) {
  const scoped = records.filter(record => record.property_id === propertyId || record.id === propertyId);
  const byType = JRE_ENTITY_TYPES.reduce((groups, type) => {
    groups[type] = scoped.filter(record => record.entity_type === type);
    return groups;
  }, {});
  const quality = scoped.map(record => ({ id:record.id, entity_type:record.entity_type, ...validateJapaneseRealEstateRecord(record) }));
  return {
    propertyId,
    records:scoped.length,
    byType,
    reviewStatus:countByStatus(scoped),
    riskLevels:countByRiskLevel(scoped),
    evidenceRefIds:[...new Set(scoped.flatMap(record => Array.isArray(record.evidence_ref_ids) ? record.evidence_ref_ids : []))],
    needsReview:scoped.filter(needsKnowledgeBrainReview).map(record => record.id),
    qualityIssues:quality.filter(item => !item.ok).map(({ id, entity_type, issues }) => ({ id, entity_type, issues })),
  };
}

function acquisitionPriceFromDossier(dossier, explicitPrice = null) {
  if (explicitPrice !== undefined && explicitPrice !== null && explicitPrice !== "") return explicitPrice;
  const transactions = [...(dossier.byType.transaction || [])]
    .filter(record => record.review_status !== "archived")
    .filter(record => record.price_amount !== undefined && record.price_amount !== null && record.price_amount !== "")
    .sort((a, b) => (b.contract_date || b.updated_at || "").localeCompare(a.contract_date || a.updated_at || ""));
  return transactions[0]?.price_amount ?? null;
}

function buildPropertyDossierInvestmentMetrics({ propertyId, records = [], acquisitionPrice = null, vacancyRatePercent = 0 } = {}) {
  const dossier = buildPropertyDossier({ propertyId, records });
  const price = acquisitionPriceFromDossier(dossier, acquisitionPrice);
  if (price === null) {
    throw new Error("acquisitionPrice or a transaction price_amount is required for deterministic investment metrics.");
  }
  const metrics = buildInvestmentMetrics({
    propertyId,
    acquisitionPrice:price,
    vacancyRatePercent,
    leases:dossier.byType.lease,
    expenses:dossier.byType.expense,
    taxes:dossier.byType.tax,
    loans:dossier.byType.loan,
  });
  return {
    ...metrics,
    dossier:{
      records:dossier.records,
      reviewStatus:dossier.reviewStatus,
      riskLevels:dossier.riskLevels,
      needsReview:dossier.needsReview,
      qualityIssues:dossier.qualityIssues,
    },
  };
}

function buildCalculationRunFromInvestmentMetrics(metrics = {}, { reviewStatus = "candidate", riskLevel = "medium", metadata = {} } = {}) {
  return buildCalculationRunRecord({
    property_id:metrics.propertyId,
    calculation_type:"investment_metrics",
    review_status:reviewStatus,
    risk_level:riskLevel,
    inputs:metrics.inputs,
    formulas:metrics.formulas,
    outputs:metrics.outputs,
    source_ids:metrics.audit?.sourceIds || [],
    evidence_ref_ids:metrics.audit?.evidenceRefIds || [],
    dossier_snapshot:metrics.dossier || {},
    metadata:{
      ...metadata,
      calculatedAt:metrics.audit?.calculatedAt || "",
      auditNote:metrics.audit?.note || "",
    },
  });
}

function buildCalculationRunUpdatePayload(current = {}, patch = {}, options = {}) {
  const updatePatch = options.incrementVersion === false
    ? {
        ...patch,
        updated_at:options.now || new Date().toISOString(),
      }
    : buildVersionedKnowledgePatch(current, patch, options);
  const record = applyReviewDecisionMetadata({
    ...current,
    ...updatePatch,
    calculation_method:"deterministic_code",
  }, options);
  const quality = validateCalculationRunRecord(record);
  if (quality.issues.includes("non_deterministic_calculation")) {
    throw new Error("Calculation runs must use deterministic_code.");
  }
  return { record, quality };
}

function filterCalculationRunRecords(records = [], { propertyId = "", calculationType = "", sourceIds = [], statuses = [], reviewStatuses = [], riskLevels = [], includeArchived = false, query = "" } = {}) {
  const sourceIdSet = new Set(sourceIds);
  const reviewStatusSet = new Set([...statuses, ...reviewStatuses]);
  const riskLevelSet = new Set(riskLevels);
  const keyword = `${query || ""}`.trim().toLowerCase();
  return records
    .filter(record => includeArchived || record.review_status !== "archived")
    .filter(record => !propertyId || record.property_id === propertyId)
    .filter(record => !calculationType || record.calculation_type === calculationType)
    .filter(record => !sourceIdSet.size || (Array.isArray(record.source_ids) && record.source_ids.some(sourceId => sourceIdSet.has(sourceId))))
    .filter(record => !reviewStatusSet.size || reviewStatusSet.has(record.review_status))
    .filter(record => !riskLevelSet.size || riskLevelSet.has(record.risk_level))
    .filter(record => {
      if (!keyword) return true;
      return [
        record.calculation_type,
        record.property_id,
        record.inputs ? JSON.stringify(record.inputs) : "",
        record.formulas ? JSON.stringify(record.formulas) : "",
        record.outputs ? JSON.stringify(record.outputs) : "",
      ].join("\n").toLowerCase().includes(keyword);
    })
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

function filterKnowledgeDocumentRecords(documents = [], { statuses = [], sources = [], includeArchived = false, query = "" } = {}) {
  const statusSet = new Set(statuses);
  const sourceSet = new Set(sources);
  const keyword = `${query || ""}`.trim().toLowerCase();
  return documents
    .map(doc => ({ ...doc, status:doc.status || "approved", archived:!!doc.archived }))
    .filter(doc => includeArchived || !doc.archived)
    .filter(doc => !statusSet.size || statusSet.has(doc.status))
    .filter(doc => !sourceSet.size || sourceSet.has(doc.source))
    .filter(doc => {
      if (!keyword) return true;
      return `${doc.title || ""}\n${doc.source || ""}`.toLowerCase().includes(keyword);
    })
    .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
}

async function putCalculationRun(input = {}) {
  const record = input.calculation_method === "deterministic_code" ? input : buildCalculationRunRecord(input);
  const quality = validateCalculationRunRecord(record);
  if (quality.issues.includes("non_deterministic_calculation")) {
    throw new Error("Calculation runs must use deterministic_code.");
  }
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(KNOWLEDGE_BRAIN_STORES.calculationRuns.name, "readwrite");
    tx.objectStore(KNOWLEDGE_BRAIN_STORES.calculationRuns.name).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { record, quality };
}

async function updateCalculationRun(id, patch = {}, options = {}) {
  const safeId = `${id || ""}`.trim();
  if (!safeId) throw new Error("id is required.");
  const db = await openKnowledgeDb();
  const result = await new Promise((resolve, reject) => {
    let output = null;
    const tx = db.transaction(KNOWLEDGE_BRAIN_STORES.calculationRuns.name, "readwrite");
    const store = tx.objectStore(KNOWLEDGE_BRAIN_STORES.calculationRuns.name);
    const request = store.get(safeId);
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      const payload = buildCalculationRunUpdatePayload(current, patch, options);
      store.put(payload.record);
      output = payload;
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(output);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return result;
}

async function listCalculationRuns(filters = {}) {
  const records = await readKnowledgeBrainStore(KNOWLEDGE_BRAIN_STORES.calculationRuns.name);
  return filterCalculationRunRecords(records, filters);
}

async function listKnowledgeDocuments(filters = {}) {
  const db = await openKnowledgeDb();
  const docs = await new Promise((resolve, reject) => {
    const request = db.transaction("documents", "readonly").objectStore("documents").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return filterKnowledgeDocumentRecords(docs, filters);
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
  if (patch.status) {
    await updateKnowledgeBrainReviewForDocument(docId, patch.status).catch(() => {});
  }
}

async function updateKnowledgeBrainReviewForDocument(docId, status) {
  const reviewStatus = status === "approved" ? "approved" : status === "archived" ? "archived" : "candidate";
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["source_registry", "knowledge_units", "evidence_refs"], "readwrite");
    for (const storeName of ["source_registry", "knowledge_units", "evidence_refs"]) {
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        for (const item of request.result || []) {
          if (item.metadata?.legacyDocumentId !== docId) continue;
          store.put({ ...item, review_status:reviewStatus, updated_at:new Date().toISOString() });
        }
      };
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function markKnowledgeBrainDeletedForDocument(docId) {
  const db = await openKnowledgeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["source_registry", "knowledge_units", "evidence_refs"], "readwrite");
    const now = new Date().toISOString();
    const sourceRequest = tx.objectStore("source_registry").getAll();
    sourceRequest.onsuccess = () => {
      for (const source of sourceRequest.result || []) {
        if (source.metadata?.legacyDocumentId !== docId) continue;
        tx.objectStore("source_registry").put({
          ...source,
          deletion_requested:true,
          training_allowed:false,
          review_status:"archived",
          updated_at:now,
        });
      }
    };
    for (const storeName of ["knowledge_units", "evidence_refs"]) {
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        for (const item of request.result || []) {
          if (item.metadata?.legacyDocumentId !== docId) continue;
          store.put({ ...item, review_status:"archived", updated_at:now });
        }
      };
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function searchKnowledge(query) {
  const keyword = `${query || ""}`.trim().toLowerCase();
  if (!keyword) return [];
  const db = await openKnowledgeDb();
  const readStoreFromDb = name => new Promise((resolve, reject) => {
    const request = db.transaction(name, "readonly").objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  const [docs, chunks, sources, units, policyRules, scenarios, evalCases, calculationRuns, ...jreRecordGroups] = await Promise.all([
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
    new Promise((resolve, reject) => {
      const request = db.transaction("source_registry", "readonly").objectStore("source_registry").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }),
    new Promise((resolve, reject) => {
      const request = db.transaction("knowledge_units", "readonly").objectStore("knowledge_units").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }),
    readStoreFromDb(KNOWLEDGE_BRAIN_STORES.policyRules.name),
    readStoreFromDb(KNOWLEDGE_BRAIN_STORES.scenarios.name),
    readStoreFromDb(KNOWLEDGE_BRAIN_STORES.evalCases.name),
    readStoreFromDb(KNOWLEDGE_BRAIN_STORES.calculationRuns.name),
    ...JRE_ENTITY_TYPES.map(type => readStoreFromDb(japaneseRealEstateStoreName(type))),
  ]);
  const approvedDocIds = new Set(docs
    .map(doc => ({ ...doc, status:doc.status || "approved", archived:!!doc.archived }))
    .filter(doc => doc.status === "approved" && !doc.archived)
    .map(doc => doc.id));
  db.close();
  const legacyHits = chunks
    .filter(chunk => approvedDocIds.has(chunk.docId))
    .map(chunk => {
      const lower = chunk.content.toLowerCase();
      const count = lower.split(keyword).length - 1;
      return { ...chunk, score:count };
    })
    .filter(chunk => chunk.score > 0);
  const unitHits = approvedKnowledgeUnitSearchResults({ query, sources, units });
  const brainHits = approvedKnowledgeBrainSearchResults({
    query,
    sources,
    policyRules,
    scenarios,
    evalCases,
    japaneseRealEstateRecords:jreRecordGroups.flat(),
    calculationRuns,
  });
  return [...unitHits, ...brainHits, ...legacyHits]
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
  return memories.filter(item => (item?.metadata?.sourceType || "manual") === safeSourceType);
}

function projectMemorySourceTypeCounts(memories = []) {
  return memories.reduce((counts, item) => {
    const sourceType = item?.metadata?.sourceType || "manual";
    counts.all += 1;
    counts[sourceType] = (counts[sourceType] || 0) + 1;
    return counts;
  }, { all:0 });
}

function projectMemoryNeedsApproval(item = {}) {
  const metadata = item?.metadata || {};
  return item?.status === "candidate" || !!metadata.requiresApproval || !!metadata.ingestRequiresReview;
}

function projectMemoryApprovalQueueSummary(memories = []) {
  return memories.reduce((summary, item) => {
    const metadata = item?.metadata || {};
    if (!projectMemoryNeedsApproval(item)) return summary;
    const sourceType = metadata.sourceType || "manual";
    const action = metadata.ingestAction || `${sourceType}_candidate`;
    summary.total += 1;
    summary.bySource[sourceType] = (summary.bySource[sourceType] || 0) + 1;
    summary.byAction[action] = (summary.byAction[action] || 0) + 1;
    if (metadata.workflowRecordId) summary.workflowRecordIds.push(metadata.workflowRecordId);
    return summary;
  }, { total:0, bySource:{}, byAction:{}, workflowRecordIds:[] });
}

function selectLowValueMemories(memories = [], { sourceType = "all", limit = 80, now = Date.now() } = {}) {
  return filterProjectMemoriesBySourceType(memories, sourceType)
    .filter(item => (item.importance || 1) <= 1 || isMemoryExpired(item, now))
    .slice(0, limit);
}

export {
  approveProjectMemory,
  approvedMemoryMetadata,
  archiveLowValueMemories,
  archiveJapaneseRealEstateRecord,
  approvedKnowledgeBrainSearchResults,
  approvedKnowledgeUnitSearchResults,
  brainContextPrompt,
  buildCalculationRunUpdatePayload,
  buildEvidenceRefUpdatePayload,
  buildJapaneseRealEstateRecordPayload,
  buildJapaneseRealEstateSourceIngestRecords,
  buildCalculationRunFromInvestmentMetrics,
  buildKnowledgeGovernanceRecordPayload,
  buildKnowledgeGovernanceUpdatePayload,
  buildKnowledgeDocumentIngestRecords,
  buildKnowledgeUnitUpdatePayload,
  buildPropertyDossier,
  buildPropertyDossierInvestmentMetrics,
  buildSourceRegistryIngestPayload,
  buildSourceRegistryUpdatePayload,
  buildSourceWithdrawalPatch,
  buildVersionedKnowledgePatch,
  chunkText,
  deleteKnowledgeDb,
  deleteKnowledgeDocument,
  deleteProjectMemory,
  enforceMemoryRetention,
  exportKnowledgeLibrary,
  filterCalculationRunRecords,
  filterEvidenceRefRecords,
  filterJapaneseRealEstateRecords,
  filterKnowledgeDocumentRecords,
  filterKnowledgeGovernanceRecords,
  filterKnowledgeBrainReviewQueueItems,
  filterKnowledgeBrainReferenceIntegrityActions,
  filterKnowledgeUnitRecords,
  filterSourceRegistryRecords,
  filterProjectMemoriesBySourceType,
  findMemoryConflict,
  importKnowledgeLibrary,
  KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS,
  knowledgeBrainColdStartReadiness,
  knowledgeBrainColdStartDomainPlan,
  knowledgeBrainColdStartIngestionQueue,
  knowledgeBrainHighRiskToolReadiness,
  knowledgeBrainInventoryStats,
  knowledgeBrainDomainCoverage,
  evalCaseCategory,
  evalCaseCategoryCounts,
  evalCaseMixReadiness,
  knowledgeBrainReviewQueueItems,
  knowledgeBrainReferenceIntegrityActions,
  validateKnowledgeBrainReferenceIntegrity,
  knowledgeBrainReviewQueueSummary,
  knowledgeStats,
  learnFromExchange,
  listEvidenceRefs,
  listCalculationRuns,
  listJapaneseRealEstateRecords,
  listKnowledgeGovernanceRecords,
  listKnowledgeDocuments,
  listKnowledgeUnits,
  listProjectMemories,
  listSourceRegistry,
  normalizeImportedKnowledgeBrainRecord,
  normalizeImportedSourceRegistryRecord,
  putKnowledgeDocument,
  putKnowledgeGovernanceRecord,
  putCalculationRun,
  putJapaneseRealEstateRecord,
  putJapaneseRealEstateSourceIngest,
  putSourceRegistryRecord,
  putProjectMemory,
  projectMemoryApprovalQueueSummary,
  projectMemoryNeedsApproval,
  projectMemorySourceTypeCounts,
  rememberWorkflowArtifact,
  requestSourceDeletion,
  searchKnowledgeForPanel,
  selectLowValueMemories,
  sourceColdStartTier,
  sourceColdStartTierCounts,
  sourceTrainingEligibilityBlockedReasonCounts,
  sourceTrainingEligibilityReasons,
  sourceTrainingEligibilityReport,
  sourceUsagePermissionBlockedReasonCounts,
  sourceUsagePermissions,
  trainingEligibleSources,
  updateCalculationRun,
  updateEvidenceRef,
  updateJapaneseRealEstateRecord,
  updateKnowledgeGovernanceRecord,
  updateKnowledgeDocument,
  updateKnowledgeUnit,
  updateProjectMemory,
  updateSourceRegistryRecord,
};
