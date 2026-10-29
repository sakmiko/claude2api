/* Shared, dependency-free helpers for client configuration. */
function normalizeClientBaseURL(input, protocol = "openai") {
  let value = String(input || "").trim();
  if (!value) throw new Error("请输入服务地址 / Enter a service URL");
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    const local =
      /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])(?::\d+)?(?:\/|$)/i.test(
        value,
      );
    value = (local ? "http://" : "https://") + value;
  }
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  )
    throw new Error(
      "请使用不含账号密码的 HTTP(S) 地址 / Use an HTTP(S) URL without credentials",
    );
  url.search = "";
  url.hash = "";
  let path = url.pathname
    .replace(/\/+$/, "")
    .replace(
      /\/(?:chat\/completions|responses|messages(?:\/count_tokens)?|models)$/,
      "",
    );
  path = path.replace(/(?:\/v1)+$/, "");
  url.pathname = path + (protocol === "anthropic" ? "" : "/v1");
  return url.toString().replace(/\/$/, "");
}
if (typeof module !== "undefined") module.exports = { normalizeClientBaseURL };
