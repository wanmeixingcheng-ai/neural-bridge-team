import test from "node:test";
import assert from "node:assert/strict";

import { chunkText, filterProjectMemoriesBySourceType, projectMemorySourceTypeCounts } from "../lib/projectBrain.mjs";

test("project brain chunks long text with overlap", () => {
  const chunks = chunkText("a".repeat(30), 10, 2);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].length, 10);
});

test("project brain ignores empty chunk content", () => {
  assert.deepEqual(chunkText("   "), []);
});

test("project brain filters memories by workflow source type", () => {
  const memories = [
    { id:"record", metadata:{ sourceType:"workflow_record" } },
    { id:"artifact", metadata:{ sourceType:"workflow_artifact_version" } },
    { id:"manual", metadata:{} },
  ];

  assert.deepEqual(filterProjectMemoriesBySourceType(memories, "all").map(item => item.id), ["record", "artifact", "manual"]);
  assert.deepEqual(filterProjectMemoriesBySourceType(memories, "manual").map(item => item.id), ["manual"]);
  assert.deepEqual(filterProjectMemoriesBySourceType(memories, "workflow_record").map(item => item.id), ["record"]);
  assert.deepEqual(filterProjectMemoriesBySourceType(memories, "workflow_artifact_version").map(item => item.id), ["artifact"]);
});

test("project brain counts memory source types", () => {
  const counts = projectMemorySourceTypeCounts([
    { metadata:{ sourceType:"workflow_record" } },
    { metadata:{ sourceType:"workflow_artifact_version" } },
    { metadata:{ sourceType:"workflow_artifact_version" } },
    { metadata:{} },
  ]);

  assert.equal(counts.all, 4);
  assert.equal(counts.workflow_record, 1);
  assert.equal(counts.workflow_artifact_version, 2);
  assert.equal(counts.manual, 1);
});
