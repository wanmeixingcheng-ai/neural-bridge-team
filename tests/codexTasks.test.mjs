import assert from "node:assert/strict";
import { test } from "node:test";

import { codexTaskIssueLabels, isCodexAutoRunEnabled } from "../app/api/codex-tasks/route.js";

test("codex task auto-run requires explicit production opt-in", () => {
  assert.equal(isCodexAutoRunEnabled({ NODE_ENV:"development" }), false);
  assert.equal(isCodexAutoRunEnabled({ NODE_ENV:"development", CODEX_TASK_AUTO_RUN:"true" }), true);
  assert.equal(isCodexAutoRunEnabled({ NODE_ENV:"production", CODEX_TASK_AUTO_RUN:"true" }), false);
  assert.equal(isCodexAutoRunEnabled({
    NODE_ENV:"production",
    CODEX_TASK_AUTO_RUN:"true",
    ALLOW_PRODUCTION_CODEX_AUTO_RUN:"true",
  }), true);
});

test("codex task issues use repository labels that enter the real Codex workflow", () => {
  assert.deepEqual(codexTaskIssueLabels({ autoRunEnabled:false }), ["ready-for-codex", "risk:medium"]);
  assert.deepEqual(codexTaskIssueLabels({ autoRunEnabled:true }), ["approved-for-codex", "risk:medium"]);
});
