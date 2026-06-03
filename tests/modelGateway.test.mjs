import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectInputLanguage, extractUrls, outboundProviderLabel } from "../lib/modelGateway.mjs";

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
  });
});
