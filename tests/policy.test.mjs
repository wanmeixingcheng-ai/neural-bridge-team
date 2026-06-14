import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ATTACHMENT_MAX_TOTAL_BYTES,
  ATTACHMENT_TEXT_BUDGET_CHARS,
  ATTACHMENT_TEXT_BUDGET_TOKENS,
  ATTACHMENT_TEXT_PER_FILE_CHARS,
  ATTACHMENT_TEXT_PER_FILE_TOKENS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_COUNT,
  IMAGE_MAX_WIDTH,
  estimateTokensFromChars,
  validateAttachmentTotalSize,
  validateImageCount,
  validateImageFile,
} from "../lib/attachmentPolicy.mjs";

import {
  MEMORY_CANDIDATE_TTL_MS,
  MEMORY_SHORT_TERM_TTL_MS,
  archiveMemoryConflictPatch,
  clearMemoryConflictMetadata,
  compactSummary,
  detectMemoryConflict,
  hasExplicitMemoryInstruction,
  importanceScore,
  isCandidateExpired,
  isMemoryExpired,
  memoryHasConflict,
  memoryHash,
  normalizeMemoryItem,
} from "../lib/memoryPolicy.mjs";

test("attachment token budget constants stay aligned", () => {
  assert.equal(ATTACHMENT_TEXT_BUDGET_CHARS, ATTACHMENT_TEXT_BUDGET_TOKENS * 4);
  assert.equal(ATTACHMENT_TEXT_PER_FILE_CHARS, ATTACHMENT_TEXT_PER_FILE_TOKENS * 4);
  assert.equal(estimateTokensFromChars(6001), 1501);
});

test("attachment total size rejects oversized uploads", () => {
  const attachments = [{ file:{ size:ATTACHMENT_MAX_TOTAL_BYTES + 1 } }];
  assert.throws(() => validateAttachmentTotalSize(attachments, "en"), /Attachment limit/);
});

test("image policy rejects too many, too large, and too wide images", () => {
  assert.throws(() => validateImageCount(IMAGE_MAX_COUNT + 1, "en"), /Attachment limit/);
  assert.throws(
    () => validateImageFile({ file:{ name:"big.png", size:IMAGE_MAX_BYTES + 1 }, width:100, height:100, lang:"en" }),
    /exceeds/
  );
  assert.throws(
    () => validateImageFile({ file:{ name:"wide.png", size:1024 }, width:IMAGE_MAX_WIDTH + 1, height:100, lang:"en" }),
    /max is/
  );
});

test("legacy memory items normalize into short-term, candidate, approved, or archived states", () => {
  assert.equal(normalizeMemoryItem({ type:"conversation", content:"hello" }).status, "short_term");
  assert.equal(normalizeMemoryItem({ type:"fact", title:"自动提取事实", content:"fact" }).status, "candidate");
  assert.equal(normalizeMemoryItem({ type:"note", title:"manual", content:"note" }).status, "approved");
  assert.equal(normalizeMemoryItem({ archived:true, content:"old" }).status, "archived");
});

test("candidate memories expire after ttl but approved memories do not", () => {
  const now = Date.now();
  const old = new Date(now - MEMORY_CANDIDATE_TTL_MS - 1).toISOString();
  assert.equal(isCandidateExpired({ status:"candidate", updatedAt:old }, now), true);
  assert.equal(isCandidateExpired({ status:"approved", updatedAt:old }, now), false);
});

test("short-term memories expire after seven days and explicit instructions are detected", () => {
  const now = Date.now();
  const old = new Date(now - MEMORY_SHORT_TERM_TTL_MS - 1).toISOString();
  assert.equal(isMemoryExpired({ status:"short_term", updatedAt:old }, now), true);
  assert.equal(hasExplicitMemoryInstruction("记住，以后都按这个规则处理"), true);
  assert.equal(hasExplicitMemoryInstruction("普通聊天内容"), false);
});

test("memory hash normalizes whitespace and importance scores risk decisions higher", () => {
  assert.equal(memoryHash("a   b"), memoryHash("a b"));
  assert.equal(compactSummary("x".repeat(430)).length, 423);
  assert.ok(importanceScore({ type:"risk", content:"必须处理隐私风险" }) > importanceScore({ type:"note", content:"普通记录" }));
});

test("memory conflict detector flags opposing rules and decisions", () => {
  const existing = [
    { id:"m1", title:"隐私规则", type:"rule", status:"approved", content:"业务数据必须优先本地处理。" },
    { id:"m2", title:"执行规则", type:"rule", status:"approved", content:"Codex 任务需要人工审批。" },
  ];

  const privacyConflict = detectMemoryConflict({ title:"新规则", content:"业务数据可以上云处理。" }, existing);
  const automationConflict = detectMemoryConflict({ title:"新规则", content:"Codex 任务自动执行。" }, existing);
  const noConflict = detectMemoryConflict({ title:"补充", content:"移动端布局必须保持稳定。" }, existing);

  assert.equal(privacyConflict.memoryId, "m1");
  assert.equal(automationConflict.memoryId, "m2");
  assert.equal(noConflict, null);
});

test("memory conflict review metadata clears conflict and keeps audit time", () => {
  const reviewed = clearMemoryConflictMetadata({
    source:"manual",
    conflict:{ memoryId:"m1", title:"旧规则" },
  });

  assert.equal(reviewed.source, "manual");
  assert.equal(reviewed.conflict, undefined);
  assert.match(reviewed.conflictReviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("memory conflict archive patch clears conflict and marks archived", () => {
  const patch = archiveMemoryConflictPatch({
    source:"manual",
    conflict:{ memoryId:"m1", title:"旧规则" },
  });

  assert.equal(patch.status, "archived");
  assert.equal(patch.archived, true);
  assert.equal(patch.metadata.source, "manual");
  assert.equal(patch.metadata.conflict, undefined);
  assert.match(patch.metadata.conflictReviewedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(patch.metadata.conflictArchivedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("memory conflict predicate only matches conflict metadata", () => {
  assert.equal(memoryHasConflict({ metadata:{ conflict:{ memoryId:"m1" } } }), true);
  assert.equal(memoryHasConflict({ metadata:{ conflictReviewedAt:"2026-01-01T00:00:00.000Z" } }), false);
  assert.equal(memoryHasConflict({}), false);
});

test("project constraints define restored knowledge brain policy runtime and handoff gates", () => {
  const constraints = readFileSync(new URL("../PROJECT_CONSTRAINTS.md", import.meta.url), "utf8");

  for (const section of Array.from({ length:15 }, (_, index) => index + 1)) {
    assert.match(constraints, new RegExp(`## ${section}\\.`));
  }
  for (const policyId of Array.from({ length:11 }, (_, index) => `P${`${index + 1}`.padStart(3, "0")}`)) {
    assert.match(constraints, new RegExp(policyId));
  }
  assert.match(constraints, /所有工具（M1–M10）必须通过 Knowledge Brain 调用知识/);
  assert.match(constraints, /禁止工具 hardcode Prompt 直接调用大模型/);
  assert.match(constraints, /review_status = "approved"/);
  assert.match(constraints, /Output Builder 输出规范/);
  assert.match(constraints, /"knowledge_ids_cited"/);
  assert.match(constraints, /handoff_packages 数据结构/);
  assert.match(constraints, /target_agent_or_tool/);
  assert.match(constraints, /https:\/\/system\.reins\.jp\/login\/main\/KG\/GKG001200/);
  assert.match(constraints, /不代理登录 \/ 不自动抓取/);
  assert.match(constraints, /用户业务数据默认只存本地 IndexedDB/);
  assert.match(constraints, /M1–M10 Tool Integration/);
});
