import test from "node:test";
import assert from "node:assert/strict";

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
  compactSummary,
  hasExplicitMemoryInstruction,
  importanceScore,
  isCandidateExpired,
  isMemoryExpired,
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
