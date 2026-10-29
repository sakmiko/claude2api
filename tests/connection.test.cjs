const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeClientBaseURL: normalize } = require("../web/connection.js");
for (const [input, kind, want] of [
  ["127.0.0.1:8787/v1/chat/completions", "openai", "http://127.0.0.1:8787/v1"],
  ["localhost:8787", "openai", "http://localhost:8787/v1"],
  ["192.168.1.8:8787/v1", "anthropic", "http://192.168.1.8:8787"],
  [
    "https://gateway.example.com/v1/v1/responses",
    "responses",
    "https://gateway.example.com/v1",
  ],
  [
    "https://gateway.example.com/proxy/v1/messages?foo=bar#x",
    "anthropic",
    "https://gateway.example.com/proxy",
  ],
  ["[::1]:8787", "openai", "http://[::1]:8787/v1"],
  ["gateway.example.com", "openai", "https://gateway.example.com/v1"],
])
  test(input + " / " + kind, () => assert.equal(normalize(input, kind), want));
for (const input of [
  "",
  "ftp://example.com",
  "http://",
  "https://admin:secret@example.com",
])
  test("reject " + input, () => assert.throws(() => normalize(input)));
