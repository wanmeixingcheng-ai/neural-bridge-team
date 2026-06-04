import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectInputLanguage, extractUrls, localOnlyBlockMessage, modelExternalConfigSummary, modelProviderInfo, modelUsageSummary, normalizeModelResponse, outboundBlockedByLocalOnly, outboundBlockedModelKeys, outboundProviderLabel, workflowLocalOnlyBlockMessage } from "../lib/modelGateway.mjs";

describe("modelGateway", () => {
  it("detects the user input language", () => {
    assert.equal(detectInputLanguage("请继续", "en"), "zh");
    assert.equal(detectInputLanguage("続けてください", "zh"), "ja");
    assert.equal(detectInputLanguage("continue please", "zh"), "en");
    assert.equal(detectInputLanguage("", "ja"), "ja");
  });

  it("extracts unique clean URLs", () => {
    assert.deepEqual(extractUrls("看 https://example.com/a，和 https://example.com/a."), [
      "https://example.com/a",
    ]);
  });

  it("labels outbound model providers", () => {
    assert.equal(outboundProviderLabel("codex", {}), "");
    assert.equal(outboundProviderLabel("claude", { claudeBridge: { enabled: true } }), "Claude Bridge");
    assert.equal(outboundProviderLabel("gemma26", {}), "Google Gemini/Gemma");
    assert.deepEqual(modelProviderInfo("codex", {}), { modelKey:"codex", actualModel:"", provider:"", external:false });
    assert.equal(modelProviderInfo("claude", {}).external, true);
    assert.equal(modelProviderInfo("gemma26", {}).actualModel, "gemma-4-26b-a4b-it");
    assert.equal(outboundBlockedByLocalOnly("claude", { localOnlyMode:true }), true);
    assert.equal(outboundBlockedByLocalOnly("codex", { localOnlyMode:true }), true);
    assert.equal(outboundBlockedByLocalOnly("", { localOnlyMode:true }), false);
    assert.match(localOnlyBlockMessage("gemma26", { localOnlyMode:true }, "zh"), /Google Gemini\/Gemma/);
    assert.match(localOnlyBlockMessage("gemma26", { localOnlyMode:true }, "zh", { hasWeb:true }), /网页读取/);
    assert.equal(localOnlyBlockMessage("gemma26", { localOnlyMode:false }, "zh"), "");
  });

  it("blocks workflow member model sets in local-only mode", () => {
    assert.deepEqual(outboundBlockedModelKeys(["gemma26", "gemma26", "codex", ""], { localOnlyMode:true }), ["gemma26", "codex"]);
    assert.deepEqual(outboundBlockedModelKeys(["gemma26"], { localOnlyMode:false }), []);
    assert.match(workflowLocalOnlyBlockMessage(["gemma26", "codex"], { localOnlyMode:true }, "zh"), /工作流/);
    assert.match(workflowLocalOnlyBlockMessage(["gemma26", "codex"], { localOnlyMode:true }, "zh"), /Google Gemini\/Gemma/);
    assert.match(workflowLocalOnlyBlockMessage([""], { localOnlyMode:true }, "en", { hasWeb:true }), /web fetch/);
    assert.equal(workflowLocalOnlyBlockMessage([""], { localOnlyMode:false }, "en"), "");
  });

  it("summarizes unique model usage and external providers", () => {
    const usage = modelUsageSummary(["claude", "claude", "gemma26", "codex"], {});
    assert.deepEqual(usage.models.map(item => item.modelKey), ["claude", "gemma26", "codex"]);
    assert.deepEqual(usage.models.map(item => item.actualModel), ["claude-sonnet-4-20250514", "gemma-4-26b-a4b-it", ""]);
    assert.equal(usage.external, true);
    assert.deepEqual(usage.providers, ["Claude / Anthropic", "Google Gemini/Gemma"]);

    const fallbackUsage = modelUsageSummary(["claude", "gemma26", "claude"], {});
    assert.deepEqual(fallbackUsage.models.map(item => item.modelKey), ["claude", "gemma26"]);
  });

  it("preserves actual model identifiers from provider responses", () => {
    assert.deepEqual(normalizeModelResponse({ text:"ok", actualModel:"gemini-2.5-flash" }), {
      text:"ok",
      actualModel:"gemini-2.5-flash",
    });
    assert.deepEqual(normalizeModelResponse("plain text"), {
      text:"plain text",
      actualModel:"",
    });
  });

  it("summarizes external configuration without exposing secrets", () => {
    const summary = modelExternalConfigSummary({
      anthropic:"sk-ant-secret",
      google:"",
      autoInjectKnowledge:true,
      localOnlyMode:true,
      claudeBridge:{ enabled:false },
      codexAdminToken:"admin-secret",
    });

    assert.equal(summary.localOnlyMode, true);
    assert.equal(summary.externalBlocked, true);
    assert.equal(summary.externalConfigured, true);
    assert.equal(summary.entries.find(entry => entry.id === "anthropic").configured, true);
    assert.equal(summary.entries.find(entry => entry.id === "google").configured, false);
    assert.equal(summary.entries.find(entry => entry.id === "knowledge").blocked, true);
    assert.equal(JSON.stringify(summary).includes("secret"), false);
  });
});
