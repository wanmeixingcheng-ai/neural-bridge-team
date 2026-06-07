import assert from "node:assert/strict";
import { test } from "node:test";

import { canDispatchCodexTask, codexTaskIssueLabels, isAuthenticatedCodexDispatchEnabled, isCodexAutoRunEnabled } from "../app/api/codex-tasks/route.js";

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

test("authenticated codex dispatch can avoid exposing admin token to the browser", () => {
  assert.equal(isAuthenticatedCodexDispatchEnabled({}), false);
  assert.equal(isAuthenticatedCodexDispatchEnabled({ ALLOW_AUTHENTICATED_CODEX_DISPATCH:"true" }), true);
  assert.equal(canDispatchCodexTask({ confirmCodexDispatch:true }, {
    NODE_ENV:"production",
    ALLOW_AUTHENTICATED_CODEX_DISPATCH:"true",
  }), true);
  assert.equal(canDispatchCodexTask({ confirmCodexDispatch:false }, {
    NODE_ENV:"production",
    ALLOW_AUTHENTICATED_CODEX_DISPATCH:"true",
  }), false);
  assert.equal(canDispatchCodexTask({ confirmCodexDispatch:true }, {
    NODE_ENV:"production",
    CODEX_TASK_ADMIN_TOKEN:"server-secret",
  }), false);
  assert.equal(canDispatchCodexTask({ confirmCodexDispatch:true, adminToken:"server-secret" }, {
    NODE_ENV:"production",
    CODEX_TASK_ADMIN_TOKEN:"server-secret",
  }), true);
});
