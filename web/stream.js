/* Protocol conversion shared by the built-in chat and offline contract tests. */
(function (root) {
  function request(protocol, model, messages, stream = true) {
    if (protocol === "anthropic")
      return {
        url: "/v1/messages",
        body: {
          model,
          stream,
          max_tokens: 4096,
          messages: messages.map((m) => ({
            role: m.role,
            content:
              typeof m.content === "string"
                ? m.content
                : m.content.map((part) => {
                    if (part.type === "text") return part;
                    const url = part.image_url.url;
                    const data = /^data:([^;]+);base64,(.*)$/.exec(url);
                    return {
                      type: "image",
                      source: data
                        ? { type: "base64", media_type: data[1], data: data[2] }
                        : { type: "url", url },
                    };
                  }),
          })),
        },
      };
    if (protocol === "responses")
      return {
        url: "/v1/responses",
        body: {
          model,
          stream,
          input: messages.map((m) => ({
            role: m.role,
            content:
              typeof m.content === "string"
                ? m.content
                : m.content.map((part) =>
                    part.type === "text"
                      ? {
                          type:
                            m.role === "assistant"
                              ? "output_text"
                              : "input_text",
                          text: part.text,
                        }
                      : { type: "input_image", image_url: part.image_url.url },
                  ),
          })),
        },
      };
    return { url: "/v1/chat/completions", body: { model, stream, messages } };
  }
  function failure(data) {
    return (
      data?.error?.message ||
      data?.response?.error?.message ||
      (typeof data?.error === "string" ? data.error : null)
    );
  }
  function text(protocol, data) {
    const error = failure(data);
    if (error) throw new Error(error);
    if (protocol === "anthropic")
      return (data.content || [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
    if (protocol === "responses")
      return (
        data.output_text ??
        (data.output || [])
          .flatMap((item) => item.content || [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text)
          .join("")
      );
    return data.choices?.[0]?.message?.content || "";
  }
  class SSEDecoder {
    constructor(emit, activity = () => {}) {
      this.emit = emit;
      this.activity = activity;
      this.buffer = "";
      this.data = [];
      this.event = "";
      this.first = true;
    }
    feed(chunk) {
      this.buffer += chunk;
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        let line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        this.line(line);
      }
    }
    line(line) {
      if (this.first) {
        line = line.replace(/^\uFEFF/, "");
        this.first = false;
      }
      if (line === "") {
        this.dispatch();
        return;
      }
      if (line.startsWith(":")) {
        this.activity();
        return;
      }
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") this.data.push(value);
      if (field === "event") this.event = value;
    }
    dispatch() {
      if (this.data.length) {
        this.emit({
          event: this.event || "message",
          data: this.data.join("\n"),
        });
      }
      this.data = [];
      this.event = "";
    }
    finish() {
      if (this.buffer) {
        this.line(this.buffer.replace(/\r$/, ""));
        this.buffer = "";
      }
      this.dispatch();
    }
  }
  class ResponseStream {
    constructor(protocol, onText, onActivity = () => {}) {
      this.protocol = protocol;
      this.onText = onText;
      this.onActivity = onActivity;
      this.completed = false;
      this.decoder = new SSEDecoder((event) => this.event(event), onActivity);
    }
    event(event) {
      if (this.completed) return;
      this.onActivity();
      if (event.data === "[DONE]") {
        this.completed = true;
        return;
      }
      const data = JSON.parse(event.data);
      const error = failure(data);
      if (error) throw new Error(error);
      let delta = "";
      if (this.protocol === "anthropic") {
        if (
          data.type === "content_block_delta" &&
          data.delta?.type === "text_delta"
        )
          delta = data.delta.text || "";
        if (data.type === "message_stop") this.completed = true;
      } else if (this.protocol === "responses") {
        if (data.type === "response.output_text.delta")
          delta = data.delta || "";
        if (data.type === "response.completed") this.completed = true;
        if (
          data.type === "response.failed" ||
          data.type === "response.incomplete"
        )
          throw new Error(
            data.response?.incomplete_details?.reason || "回复未完成",
          );
      } else {
        delta = data.choices?.[0]?.delta?.content || "";
        if (data.choices?.some((choice) => choice.finish_reason))
          this.completed = true;
      }
      if (delta) this.onText(delta);
    }
    feed(chunk) {
      this.decoder.feed(chunk);
    }
    finish() {
      this.decoder.finish();
      if (!this.completed) throw new Error("连接提前结束，请重试");
    }
  }
  const api = { request, text, SSEDecoder, ResponseStream };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StreamProtocol = api;
})(typeof window !== "undefined" ? window : globalThis);
