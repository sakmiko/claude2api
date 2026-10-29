/* Run after building the server. Uses an isolated database and fictional fixtures. */
const { chromium } = require(
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright"
    : "playwright",
);
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const output = path.resolve(
  process.env.REVIEW_OUTPUT || path.join(root, "review-output"),
);
const binary = process.env.REVIEW_BINARY || path.join(root, "claude2api");
const executablePath = process.env.REVIEW_CHROMIUM || undefined;
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "claude2api-review-"));
  fs.writeFileSync(
    path.join(runtime, "config.example.yaml"),
    "admin_password: review-password\nweb_host: 127.0.0.1\nstatus_check_seconds: 21600\n",
  );
  const server = spawn(binary, [], { cwd: runtime, stdio: "ignore" });
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch("http://127.0.0.1:8787/healthz")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    execFileSync("python3", [
      path.join(root, "scripts/seed-review.py"),
      path.join(runtime, "data/app.db"),
    ]);
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1040 },
      deviceScaleFactor: 1,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const shots = [];
    const visualChecks = [];
    async function shot(name) {
      await page
        .waitForSelector("#msg.hidden", { state: "attached" })
        .catch(() => {});
      await page.evaluate(() => {
        if (!document.getElementById("review-label")) {
          const el = document.createElement("div");
          el.id = "review-label";
          el.textContent = "本地审阅 · 示例数据";
          el.style.cssText =
            "position:fixed;bottom:10px;right:14px;z-index:999999;padding:5px 9px;border-radius:5px;background:#263b2e;color:#e5e9df;font:10px sans-serif;letter-spacing:1px;pointer-events:none";
          document.body.append(el);
        }
      });
      const issues = await page.evaluate(() => {
        const issues = [];
        const visible = (el) =>
          el.getClientRects().length > 0 &&
          getComputedStyle(el).visibility !== "hidden";
        if (document.documentElement.scrollWidth > innerWidth + 1)
          issues.push("page overflows horizontally");
        if (
          innerWidth > 760 &&
          visible(document.getElementById("btn-mobile-menu"))
        )
          issues.push("mobile menu visible on desktop");
        for (const image of document.querySelectorAll("img")) {
          if (visible(image) && (!image.complete || !image.naturalWidth))
            issues.push("broken image: " + image.src);
        }
        for (const icon of document.querySelectorAll("svg.ui-icon")) {
          if (!visible(icon)) continue;
          const r = icon.getBoundingClientRect();
          if (
            Math.abs(r.width - r.height) > 0.5 ||
            r.width < 13 ||
            r.width > 20
          )
            issues.push("distorted icon: " + icon.parentElement.className);
        }
        if (innerWidth < 521) {
          for (const bubble of document.querySelectorAll(
            ".chat-row.user .chat-bubble",
          )) {
            if (
              visible(bubble) &&
              bubble.textContent.length > 8 &&
              bubble.getBoundingClientRect().width < 100
            )
              issues.push("user message squeezed into avatar column");
          }
        }
        for (const group of document.querySelectorAll(
          ".toolbar, .pool-top-actions, .hero-actions",
        )) {
          const buttons = [...group.querySelectorAll(":scope > .btn")].filter(
            visible,
          );
          const heights = buttons.map((el) =>
            Math.round(el.getBoundingClientRect().height),
          );
          if (heights.length && Math.max(...heights) - Math.min(...heights) > 1)
            issues.push(
              "uneven button heights: " + group.className + " " + heights,
            );
        }
        for (const image of document.querySelectorAll(
          ".login-logo img, .chat-avatar img",
        )) {
          if (!visible(image)) continue;
          const a = image.getBoundingClientRect(),
            b = image.parentElement.getBoundingClientRect();
          if (
            Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)) > 1 ||
            Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) > 1
          )
            issues.push("off-center logo: " + image.parentElement.className);
        }
        return issues;
      });
      assert.deepEqual(issues, [], name + ": " + issues.join("; "));
      visualChecks.push({ page: name, issues });
      await page.screenshot({
        path: path.join(output, name + ".png"),
        animations: "disabled",
        fullPage: true,
      });
      shots.push(name);
    }
    await page.goto("http://127.0.0.1:8787");
    await page.evaluate(() => document.fonts.ready);
    await shot("01-login");
    await page.fill("#credential", "wrong");
    await page.click("#btn");
    await page.waitForFunction(
      () => document.getElementById("err").textContent.length > 0,
    );
    await page.fill("#credential", "review-password");
    await page.click("#btn");
    await page.waitForSelector("#page-overview:not(.hidden)");
    await page.waitForFunction(
      () => document.getElementById("metric-accounts").textContent === "6",
    );
    await shot("02-overview");
    assert.equal(
      await page.locator(".sidebar .nav-item svg.ui-icon").count(),
      8,
    );
    await page.click("#btn-sidebar-collapse");
    await page.waitForFunction(() =>
      document.body.classList.contains("sidebar-collapsed"),
    );
    await shot("14-collapsed-sidebar");
    await page.click("#btn-sidebar-collapse");
    await page.click("#btn-workspace-menu");
    await page.waitForSelector("#workspace-menu:not(.hidden)");
    await shot("15-preferences");
    await page.keyboard.press("Escape");
    await page.click('.nav-item[data-page="accounts"]');
    await page.waitForSelector("#acc-body tr[data-email]");
    assert.equal(await page.locator("#acc-body tr[data-email]").count(), 6);
    await page.fill("#search", "review-org-2");
    await page.waitForFunction(
      () => document.querySelectorAll("#acc-body tr[data-email]").length === 1,
    );
    await page.fill("#search", "");
    await page.waitForFunction(
      () => document.querySelectorAll("#acc-body tr[data-email]").length === 6,
    );
    await shot("03-accounts");
    await page.locator("#acc-body .act-detail").first().click();
    await page.waitForSelector("#detail-mask:not(.hidden)");
    await shot("26-account-details");
    await page.keyboard.press("Escape");
    const accountRow = page.locator(
      '#acc-body tr[data-email="studio@example.com"]',
    );
    await accountRow.locator(".act-pause").click();
    await page.waitForFunction(() =>
      document
        .querySelector('#acc-body tr[data-email="studio@example.com"]')
        .textContent.includes("已暂停"),
    );
    await accountRow.locator(".act-pause").click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector('#acc-body tr[data-email="studio@example.com"]')
          .textContent.includes("已暂停"),
    );
    await page.click("#btn-import");
    await page.waitForSelector("#import-mask:not(.hidden)");
    await shot("04-import-dialog");
    await page.keyboard.press("Escape");
    assert(
      await page
        .locator("#import-mask")
        .evaluate((el) => el.classList.contains("hidden")),
    );
    await page.click('.nav-item[data-page="api"]');
    await page.fill("#connection-input", "127.0.0.1:8787/v1/chat/completions");
    assert.equal(
      await page.locator("#connection-base").textContent(),
      "http://127.0.0.1:8787/v1",
    );
    await page.click("#btn-diagnose");
    await page.waitForSelector('#diagnostic-result[data-state="ok"]');
    await shot("05-client-connection");
    await page.selectOption("#connection-protocol", "anthropic");
    assert.equal(
      await page.locator("#connection-base").textContent(),
      "http://127.0.0.1:8787",
    );
    await page.fill("#connection-input", "https://example.com");
    await page.click("#btn-diagnose");
    await page.waitForSelector('#diagnostic-result[data-state="error"]');
    await page.fill("#connection-input", "http://127.0.0.1:8787");
    await page.selectOption("#connection-protocol", "openai");
    await page.click("#btn-diagnose");
    await page.waitForSelector('#diagnostic-result[data-state="ok"]');
    await page.click('.nav-item[data-page="keys"]');
    await page.fill("#key-name", "界面回归测试");
    await page.click("#btn-key-create");
    await page.waitForFunction(() =>
      document.getElementById("keys-body").textContent.includes("界面回归测试"),
    );
    await shot("06-api-keys");
    const createdKeys = await page.evaluate(async () => {
      const res = await fetch("/api/keys", {
        headers: { Authorization: "Bearer review-password" },
      });
      return res.json();
    });
    const accessKey = createdKeys.keys[0].key;
    const poolContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const poolPage = await poolContext.newPage();
    poolPage.on("pageerror", (e) => errors.push(e.message));
    await poolPage.goto("http://127.0.0.1:8787");
    await poolPage.fill("#credential", accessKey);
    await poolPage.click("#btn");
    await poolPage.waitForSelector("#page-pool:not(.hidden)");
    assert.equal(await poolPage.locator(".nav-item:not(.hidden)").count(), 1);
    await poolPage.click("#btn-mobile-menu");
    await poolPage.click("#btn-theme-toggle");
    const forbidden = await poolPage.evaluate(
      async (key) =>
        (
          await fetch("/api/status", {
            headers: { Authorization: "Bearer " + key },
          })
        ).status,
      accessKey,
    );
    assert.equal(forbidden, 401);
    await poolContext.close();
    await page.click(".act-key-del");
    await page.click("#confirm-ok");
    await page.waitForFunction(
      () => !document.querySelector("#keys-body tr[data-id]"),
    );

    await page.click('.nav-item[data-page="pool"]');
    await page.waitForSelector(".pool-card");
    assert.equal(await page.locator(".pool-card").count(), 5);
    await page
      .locator('.pool-card[data-email="studio@example.com"] .favorite-btn')
      .click();
    await page.click("#btn-pool-favorites");
    assert.equal(await page.locator(".pool-card").count(), 1);
    await page.click("#btn-pool-favorites");
    assert.equal(await page.locator(".pool-card").count(), 5);
    await page.fill("#pool-search", "research");
    assert.equal(await page.locator(".pool-card").count(), 1);
    await page.fill("#pool-search", "");
    await shot("07-account-pool");
    await page.click('.nav-item[data-page="system"]');
    await page.waitForFunction(
      () =>
        document.getElementById("cfg-account_cooldown_seconds").value === "300",
    );
    await shot("13-settings");
    await page.click('.nav-item[data-page="logs"]');
    await page.waitForFunction(() =>
      document
        .getElementById("logs-body")
        .textContent.includes("claude-sonnet"),
    );
    await shot("08-request-logs");
    await page.locator(".act-log-detail").first().click();
    await page.waitForSelector("#page-log-detail:not(.hidden)");
    await shot("25-call-details");
    await page.click("#log-detail-back");
    await page.click('.nav-item[data-page="chat"]');
    await page.waitForSelector(
      '#test-model option[value="claude-sonnet-4-6"]',
      { state: "attached" },
    );
    // Controlled SSE only for rendering and error-path tests. This is not an upstream test.
    await page.route("**/v1/chat/completions", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body:
          "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  content:
                    "这是一条用于审阅界面的示例回复。\n\n**接入步骤**\n1. 创建独立的 API 密钥\n2. 复制带协议的 Base URL\n3. 选择模型并发送消息\n\n代码示例、图片上传与流式输出，都可以在这里检查。",
                },
              },
            ],
          }) +
          "\n\ndata: [DONE]\n\n",
      }),
    );
    await page.fill("#test-message", "帮我梳理一下客户端的接入步骤。");
    await page.click("#btn-test-send");
    await page.waitForFunction(
      () => !document.getElementById("btn-test-send").disabled,
    );
    await shot("09-playground");
    await page.route("**/v1/messages", (route) => {
      const body = route.request().postDataJSON();
      return route.fulfill(
        body.stream
          ? {
              contentType: "text/event-stream",
              body: 'event: ping\ndata: {"type":"ping"}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Anthropic 回复"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
            }
          : {
              contentType: "application/json",
              body: JSON.stringify({
                content: [{ type: "text", text: "Anthropic 整段回复" }],
              }),
            },
      );
    });
    await page.route("**/v1/responses", (route) => {
      const body = route.request().postDataJSON();
      return route.fulfill(
        body.stream
          ? {
              contentType: "text/event-stream",
              body: ': keepalive\n\nevent: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Responses 回复"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n',
            }
          : {
              contentType: "application/json",
              body: JSON.stringify({
                output: [
                  {
                    type: "message",
                    content: [
                      { type: "output_text", text: "Responses 整段回复" },
                    ],
                  },
                ],
              }),
            },
      );
    });
    for (const protocol of ["anthropic", "responses"]) {
      await page.selectOption("#test-protocol", protocol);
      for (const streaming of [true, false]) {
        await page.locator("#test-stream").setChecked(streaming);
        await page.fill("#test-message", "检查接口转换");
        await page.click("#btn-test-send");
        await page.waitForFunction(
          () => !document.getElementById("btn-test-send").disabled,
        );
        assert(
          (await page.locator("#chat-messages").innerText()).includes(
            protocol === "anthropic" ? "Anthropic" : "Responses",
          ),
        );
      }
    }
    await page.selectOption("#test-protocol", "openai");
    await page.locator("#test-stream").check();
    await page.click('.nav-item[data-page="overview"]');
    await page.click("#btn-workspace-menu");
    await page.click("#btn-theme-toggle");
    await page.keyboard.press("Escape");
    await shot("10-overview-dark");
    await page.click('.nav-item[data-page="pool"]');
    await shot("16-dark-pool");
    await page.click('.nav-item[data-page="chat"]');
    await shot("17-dark-chat");
    await page.click('.nav-item[data-page="overview"]');
    await page.click("#btn-workspace-menu");
    await page.click("#btn-lang-en");
    assert.equal(
      await page.locator("#workspace-location").textContent(),
      "Overview",
    );
    await page.click("#btn-lang-zh");
    await page.click("#btn-theme-toggle");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 1500 });
    await page.click('.nav-item[data-page="overview"]');
    await shot("11-mobile-overview");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.click('.nav-item[data-page="api"]');
    await shot("12-mobile-connection");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    for (const [index, section] of [
      "accounts",
      "keys",
      "pool",
      "logs",
      "chat",
      "system",
    ].entries()) {
      await page.click(`.nav-item[data-page="${section}"]`);
      await shot(`${18 + index}-mobile-${section}`);
    }
    await page.click("#btn-mobile-menu");
    await page.click("#btn-theme-toggle");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.keyboard.press("Escape");
    await shot("24-mobile-dark-settings");
    // Check intermediate widths, not only a large desktop and one phone.
    for (const width of [360, 768, 1024]) {
      await page.setViewportSize({width, height: 900});
      for (const section of ["overview", "accounts", "chat", "system"]) {
        await page.click(`.nav-item[data-page="${section}"]`);
        await shot(`responsive-${width}-${section}`);
      }
    }
    await page.setViewportSize({width:1440,height:1040});
    await page.click('.nav-item[data-page="chat"]');
    await page.selectOption("#test-protocol", "openai");
    await page.locator("#test-stream").check();
    // A valid terminal event must finish even if the transport remains open.
    await page.evaluate(() => {
      window.reviewOriginalFetch = window.fetch;
      window.reviewStreamCancelled = false;
      window.fetch = (url, options) => {
        if (url !== "/v1/chat/completions") return window.reviewOriginalFetch(url, options);
        window.reviewFirstRow = document.getElementById("chat-messages").firstElementChild;
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data:{"choices":[{"delta":{"content":"流式结束检查"}}]}\n\ndata:[DONE]\n\n'));
          },
          cancel() {window.reviewStreamCancelled = true;},
        }),{headers:{"content-type":"text/event-stream"}}));
      };
    });
    await page.fill("#test-message", "检查结束信号");
    await page.click("#btn-test-send");
    await page.waitForFunction(() => !document.getElementById("btn-test-send").disabled);
    assert(await page.evaluate(() => window.reviewStreamCancelled && window.reviewFirstRow === document.getElementById("chat-messages").firstElementChild));
    await page.evaluate(() => { window.fetch = window.reviewOriginalFetch; });
    await page.emulateMedia({reducedMotion:"reduce"});
    assert.equal(await page.locator(".sidebar").evaluate(el => getComputedStyle(el).transitionDuration), "0s");
    await page.click('.nav-item[data-page="accounts"]');
    await page.click("#btn-import");
    assert.equal(await page.locator("#import-mask .modal").evaluate(el => getComputedStyle(el).animationName), "none");
    await page.keyboard.press("Escape");
    await page.emulateMedia({reducedMotion:"no-preference"});
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, "browser-results.json"),
      JSON.stringify(
        {
          passed: true,
          screenshots: shots,
          errors,
          visualChecks,
          upstreamTested: false,
          fixtures: "fictional accounts; controlled SSE for playground",
          checks: [
            "login validation",
            "account and organization search",
            "import dialog only; original import implementation preserved",
            "URL normalization",
            "same-origin diagnostics",
            "remote credential protection",
            "key creation and deletion",
            "pool-only access and mobile menu",
            "pool filtering and favorites",
            "account pause and resume",
            "request protection settings",
            "logs",
            "SSE rendering",
            "theme",
            "language",
            "mobile layout",
            "mobile menu",
            "Lucide sidebar icons",
            "sidebar collapse",
            "Floating UI preferences",
            "three chat protocols and JSON/SSE replies",
            "360, 768 and 1024px responsive layouts",
            "stream terminal without EOF and reader cancellation",
            "stream updates preserve existing message DOM",
            "reduced motion disables sidebar and dialog motion",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        passed: true,
        screenshots: shots.length,
        output,
        errors,
      }),
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
    fs.rmSync(runtime, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
