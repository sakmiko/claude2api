/* Interface enhancements; all data comes from authenticated local endpoints. */
function uiIcon(name) {
  return window.UIKit.icon(name);
}
function decorateControls() {
  document.querySelectorAll("[data-ui-icon]").forEach((el) => {
    el.innerHTML = uiIcon(el.dataset.uiIcon);
  });
  document.querySelectorAll("[data-icon-only]").forEach((el) => {
    el.innerHTML = uiIcon(el.dataset.iconOnly);
  });
  const navIcons = {
    overview: "grid",
    pool: "layers",
    accounts: "users",
    keys: "key",
    api: "code",
    chat: "compose",
    logs: "activity",
    system: "settings",
  };
  document.querySelectorAll(".nav-item").forEach((el) => {
    const label =
      el.querySelector(".control-label")?.textContent || el.textContent;
    el.innerHTML =
      uiIcon(navIcons[el.dataset.page]) +
      `<span class="control-label">${label}</span>`;
    el.setAttribute("aria-label", label.trim());
    el.setAttribute(
      "aria-current",
      el.classList.contains("active") ? "page" : "false",
    );
  });
  const icons = {
    "btn-refresh": "refresh",
    "btn-refresh-all": "refresh",
    "btn-import": "upload",
    "btn-del-expired": "trash",
    "btn-key-create": "plus",
    "btn-logs-refresh": "refresh",
    "btn-pool-refresh": "refresh",
    "btn-pool-random": "arrow",
    "btn-logout": "logout",
  };
  Object.entries(icons).forEach(([id, name]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const label =
      el.querySelector(".control-label")?.textContent || el.textContent;
    el.innerHTML = uiIcon(name) + `<span class="control-label">${label}</span>`;
  });
}
function initWorkbench(api, navigate) {
  const $ = (id) => document.getElementById(id);
  const tr = (zh, en) => (i18n.getLanguage() === "zh" ? zh : en);
  const names = {
    overview: ["总览", "Overview"],
    pool: ["选择账号", "Accounts"],
    accounts: ["账号管理", "Accounts"],
    keys: ["访问密钥", "API keys"],
    api: ["接入客户端", "Connect"],
    chat: ["试聊", "Chat"],
    logs: ["调用记录", "History"],
    system: ["设置", "Settings"],
  };
  const subtitles = {
    overview: ["账号和对话，都在这里。", "One gateway for your workflow."],
    pool: [
      "选个账号，开始对话。",
      "Choose an account and keep the conversation going.",
    ],
    accounts: [
      "查看账号和用量。",
      "Accounts, quotas and sessions at a glance.",
    ],
    keys: [
      "给客户端创建访问密钥。",
      "Give each client its own access credential.",
    ],
    api: [
      "复制地址，填入客户端。",
      "Copy the right URL. Connect your preferred client.",
    ],
    chat: [
      "发条消息，试试效果。",
      "Try a real conversation before connecting a client.",
    ],
    logs: ["查看最近的调用。", "Inspect requests, timing and error details."],
    system: ["按你的习惯调整。", "Tune the gateway to fit your workflow."],
  };
  function refreshChrome() {
    const active =
      document.querySelector(".nav-item.active")?.dataset.page || "overview";
    document
      .querySelectorAll(".nav-item")
      .forEach(
        (el) =>
          (el.textContent = tr(...(names[el.dataset.page] || names.overview))),
      );
    $("workspace-location").textContent = tr(
      ...(names[active] || names.overview),
    );
    $("workspace-subtitle").textContent = tr(
      ...(subtitles[active] || subtitles.overview),
    );
    document.title = `${$("workspace-location").textContent} · Claude2API`;
    document
      .querySelectorAll("[data-copyword]")
      .forEach((el) => (el.textContent = tr("复制", "Copy")));
    decorateControls();
  }
  window.refreshWorkbenchChrome = refreshChrome;
  document.querySelectorAll("[data-go]").forEach((el) =>
    el.addEventListener("click", () => {
      navigate(el.dataset.go);
      if (el.dataset.protocol) {
        $("connection-protocol").value = el.dataset.protocol;
        updateConnection();
      }
    }),
  );
  $("connection-input").value = location.origin;
  function updateConnection() {
    try {
      const value = $("connection-input").value;
      const kind = $("connection-protocol").value;
      const base = normalizeClientBaseURL(value, kind);
      const root = normalizeClientBaseURL(value, "anthropic");
      $("connection-base").textContent = base;
      $("connection-endpoint").textContent =
        root +
        "/v1/" +
        (kind === "anthropic"
          ? "messages"
          : kind === "responses"
            ? "responses"
            : "chat/completions");
      $("api-base").textContent = normalizeClientBaseURL(location.origin);
      $("connection-error").textContent = "";
      $("connection-snippet").textContent =
        kind === "anthropic"
          ? `from anthropic import Anthropic\n\nclient = Anthropic(\n    base_url="${base}",\n    api_key="YOUR_API_KEY",\n)\nmessage = client.messages.create(\n    model="claude-sonnet-4-6", max_tokens=1024,\n    messages=[{"role": "user", "content": "Hello"}],\n)`
          : `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${base}",\n    api_key="YOUR_API_KEY",\n)\n` +
            (kind === "responses"
              ? `response = client.responses.create(\n    model="claude-sonnet-4-6", input="Hello",\n)`
              : `response = client.chat.completions.create(\n    model="claude-sonnet-4-6",\n    messages=[{"role": "user", "content": "Hello"}],\n)`);
    } catch (e) {
      $("connection-error").textContent = e.message;
      $("connection-base").textContent = "—";
      $("connection-endpoint").textContent = "—";
      $("connection-snippet").textContent = "";
    }
  }
  $("connection-input").addEventListener("input", updateConnection);
  $("connection-protocol").addEventListener("change", updateConnection);
  document.querySelectorAll("[data-copy-target]").forEach((el) =>
    el.addEventListener("click", async () => {
      const text = $(el.dataset.copyTarget).textContent;
      if (!text || text === "—") return;
      try {
        if (navigator.clipboard && window.isSecureContext)
          await navigator.clipboard.writeText(text);
        else {
          const temp = document.createElement("textarea");
          temp.value = text;
          document.body.append(temp);
          temp.select();
          if (!document.execCommand("copy")) throw new Error("copy");
          temp.remove();
        }
        const old = el.innerHTML;
        el.innerHTML = uiIcon("check") + tr("已复制", "Copied");
        setTimeout(() => (el.innerHTML = old), 1400);
      } catch (e) {
        $("connection-error").textContent = tr(
          "复制失败，请手动选择地址复制。",
          "Copy failed. Select and copy the URL manually.",
        );
      }
    }),
  );
  async function diagnose() {
    const btn = $("btn-diagnose");
    btn.disabled = true;
    $("diagnostic-result").textContent = tr(
      "正在检查连接…",
      "Checking routes, authentication and model list…",
    );
    try {
      const target = new URL(
        normalizeClientBaseURL($("connection-input").value, "anthropic"),
      );
      if (target.origin !== location.origin)
        throw new Error(
          tr(
            "请在这个地址打开后台后重试。",
            "Open this dashboard at the target origin to test it. Credentials are never sent to another site.",
          ),
        );
      const start = performance.now();
      const [status, models] = await Promise.all([
        api("/api/status"),
        api("/v1/models"),
      ]);
      $("diagnostic-result").textContent = tr(
        `连接正常，找到 ${models.data.length} 个模型。`,
        `Reachable · Authorized · ${models.data.length} model IDs · ${Math.round(performance.now() - start)} ms. ${status.usable_accounts} usable sessions. Run the Playground to verify upstream generation.`,
      );
      $("diagnostic-result").dataset.state = "ok";
    } catch (e) {
      $("diagnostic-result").textContent = e.message;
      $("diagnostic-result").dataset.state = "error";
    } finally {
      btn.disabled = false;
    }
  }
  $("btn-diagnose").addEventListener("click", diagnose);
  async function overview() {
    try {
      const [status, models, logs] = await Promise.all([
        api("/api/status"),
        api("/v1/models"),
        api("/api/logs?limit=5"),
      ]);
      $("metric-accounts").textContent = status.accounts;
      $("metric-usable").textContent = status.usable_accounts;
      $("metric-models").textContent = models.data.length;
      $("metric-requests").textContent = logs.total;
      const recent = status.recent || {};
      $("health-success").textContent = recent.requests
        ? Math.round((recent.succeeded / recent.requests) * 100) + "%"
        : "—";
      $("health-latency").textContent = recent.requests
        ? (Number(recent.average_ms || 0) / 1000).toFixed(1) + tr(" 秒", " s")
        : "—";
      $("health-cooling").textContent = status.cooling || 0;
      $("overview-status").textContent = tr("服务在线", "Gateway online");
      const list = $("overview-recent");
      list.replaceChildren();
      if (!logs.logs.length) {
        const empty = document.createElement("p");
        empty.className = "overview-empty";
        empty.textContent = tr(
          "还没有记录，先试聊一句吧。",
          "No requests yet. Your first conversation will appear here.",
        );
        list.append(empty);
      }
      for (const log of logs.logs) {
        const row = document.createElement("div");
        row.className = "recent-row";
        const label = document.createElement("span");
        label.textContent = log.model;
        const route = document.createElement("code");
        route.textContent = "/v1/" + log.endpoint;
        const state = document.createElement("span");
        state.className = "badge " + (log.success ? "active" : "error");
        state.textContent = log.success
          ? tr("成功", "Success")
          : tr("失败", "Failed");
        const duration = document.createElement("span");
        duration.textContent = log.duration_ms + " ms";
        row.append(label, route, state, duration);
        list.append(row);
      }
    } catch (e) {
      $("overview-status").textContent = tr("连接异常", "Connection error");
      $("overview-recent").textContent = e.message;
    }
  }
  window.refreshOverview = overview;
  updateConnection();
  refreshChrome();
  overview();
}

Object.assign(i18n.translations.zh, {
  overviewTitle: "每一次连接，都井然有序。",
  overviewDesc: "管理账号、接入客户端、验证对话。在这里，专注于你的下一步。",
  connectClient: "接入客户端",
  tryPlayground: "打开对话测试",
  totalAccounts: "账号总数",
  managedSessions: "集中管理所有会话",
  usableSessions: "可用会话",
  sessionHint: "已导入且未标记失效",
  modelIdentifiers: "模型标识",
  modelHint: "包含扩展思考变体",
  totalRequests: "累计调用",
  requestHint: "追踪服务的每次响应",
  protocolTitle: "三种接口，一个入口",
  protocolNote: "通过网页会话转换协议；模型与额度以账号实际权限为准。",
  startTitle: "准备好你的第一条连接",
  stepAccounts: "导入账号",
  stepAccountsDesc: "添加 sessionKey，检查会话状态",
  stepKeys: "创建访问密钥",
  stepKeysDesc: "为你的客户端分配独立凭证",
  stepConnect: "复制地址并连接",
  stepConnectDesc: "选择协议，检测连接，再开始对话",
  recentRequests: "最近调用",
  viewAll: "查看全部",
  connectionTitle: "把正确的地址交给客户端",
  diagnose: "检测连接",
  serviceAddress: "服务地址",
  clientProtocol: "客户端协议",
  fullEndpoint: "完整请求地址",
  connectionTip:
    "地址必须包含 http:// 或 https://。OpenAI SDK 的 Base URL 填到 /v1；要求完整接口地址的客户端才填 /chat/completions。手机上的 127.0.0.1 指向手机自身，请改用服务器的局域网 IP 或域名。",
  sdkExample: "查看 Python SDK 配置示例",
  stopGeneration: "停止接收",
  generationStopped: "已停止接收。",
  imageSizeError: "支持 PNG、JPEG、WebP、GIF，每张图片不超过 10 MB。",
  imageCountError: "每条消息最多添加 4 张图片。",
});
Object.assign(i18n.translations.en, {
  overviewTitle: "Every connection, in its place.",
  overviewDesc:
    "Manage accounts. Connect clients. Try a conversation. Find your next step here.",
  connectClient: "Connect a client",
  tryPlayground: "Open Playground",
  totalAccounts: "Total accounts",
  managedSessions: "All your sessions, together",
  usableSessions: "Usable sessions",
  sessionHint: "Imported and not marked expired",
  modelIdentifiers: "Model identifiers",
  modelHint: "Includes thinking variants",
  totalRequests: "Total requests",
  requestHint: "Keep track of every response",
  protocolTitle: "Three APIs. One gateway.",
  protocolNote:
    "Converted through web sessions. Models and quotas depend on account access.",
  startTitle: "Make your first connection",
  stepAccounts: "Import an account",
  stepAccountsDesc: "Add a sessionKey and check its status",
  stepKeys: "Create an API key",
  stepKeysDesc: "Give your client a separate credential",
  stepConnect: "Copy your URL and connect",
  stepConnectDesc: "Choose a protocol, test, then start chatting",
  recentRequests: "Recent requests",
  viewAll: "View all",
  connectionTitle: "The right URL for your client",
  diagnose: "Test connection",
  serviceAddress: "Service URL",
  clientProtocol: "Client protocol",
  fullEndpoint: "Full endpoint",
  connectionTip:
    "Always include http:// or https://. OpenAI SDK Base URLs end in /v1; only use /chat/completions when your client asks for a full endpoint. On a phone, 127.0.0.1 points to the phone itself. Use the server LAN IP or domain.",
  sdkExample: "View Python SDK example",
  stopGeneration: "Stop receiving",
  generationStopped: "Stopped receiving.",
  imageSizeError: "Use PNG, JPEG, WebP or GIF, up to 10 MB per image.",
  imageCountError: "Add up to 4 images per message.",
});

// Keep keyboard focus inside an open dialog and return it to its trigger.
(function setupDialogs() {
  let previousFocus = null,
    active = null;
  const masks = [...document.querySelectorAll(".modal-mask")];
  for (const mask of masks) {
    const dialog = mask.querySelector(".modal");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.tabIndex = -1;
    const title = dialog.querySelector(".modal-title");
    if (title) {
      if (!title.id) title.id = mask.id + "-title";
      dialog.setAttribute("aria-labelledby", title.id);
    }
  }
  const observer = new MutationObserver(() => {
    const mask = masks.find((el) => !el.classList.contains("hidden"));
    if (mask && mask !== active) {
      previousFocus = document.activeElement;
      active = mask;
      const focus =
        mask.querySelector('input,textarea,button,[tabindex="0"]') ||
        mask.querySelector(".modal");
      focus.focus();
    } else if (!mask && active) {
      active = null;
      previousFocus?.focus();
    }
  });
  masks.forEach((mask) =>
    observer.observe(mask, { attributes: true, attributeFilter: ["class"] }),
  );
  document.addEventListener("keydown", (e) => {
    if (!active) return;
    if (e.key === "Escape") {
      active.classList.add("hidden");
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = [
      ...active.querySelectorAll(
        'button,input,select,textarea,a[href],[tabindex="0"]',
      ),
    ].filter((el) => !el.disabled && el.getClientRects().length);
    const first = focusables[0],
      last = focusables.at(-1);
    if (!first) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
})();

i18n.translations.zh.sessionNote =
  "sessionKey 失效后需要重新导入；定期巡检不会自动续期授权。额度信息来自上游会话事件，尚未捕获时显示「—」。";
i18n.translations.en.sessionNote =
  "Re-import your sessionKey after it expires. Scheduled checks do not renew authorization. Quotas come from upstream session events; unknown data is shown as —.";

(function setupWorkspaceChrome() {
  const mobile = document.getElementById("btn-mobile-menu");
  const profile = document.getElementById("btn-workspace-menu");
  const collapse = document.getElementById("btn-sidebar-collapse");
  const popup = document.getElementById("workspace-menu");
  let anchor = null,
    dispose = null;
  function close(restore = false) {
    if (!anchor) return;
    const previous = anchor;
    anchor.setAttribute("aria-expanded", "false");
    anchor = null;
    dispose?.();
    dispose = null;
    popup.classList.add("hidden");
    if (restore) previous.focus();
  }
  function open(trigger) {
    if (anchor === trigger) {
      close(true);
      return;
    }
    close();
    anchor = trigger;
    popup.style.visibility = "hidden";
    popup.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
    const update = () =>
      window.UIKit.computePosition(trigger, popup, {
        strategy: "fixed",
        placement: trigger === mobile ? "bottom-end" : "top-start",
        middleware: [
          window.UIKit.offset(8),
          window.UIKit.flip(),
          window.UIKit.shift({ padding: 12 }),
        ],
      }).then(({ x, y }) => {
        if (anchor === trigger) {
          popup.style.left = x + "px";
          popup.style.top = y + "px";
          if (popup.style.visibility === "hidden") {
            popup.style.visibility = "visible";
            popup.querySelector("button")?.focus();
          }
        }
      });
    dispose = window.UIKit.autoUpdate(trigger, popup, update);
    update();
  }
  mobile.innerHTML = uiIcon("preferences");
  mobile.addEventListener("click", () => open(mobile));
  profile.addEventListener("click", () => open(profile));
  document.addEventListener("click", (e) => {
    if (anchor && !popup.contains(e.target) && !anchor.contains(e.target))
      close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && anchor) {
      e.preventDefault();
      close(true);
    }
  });
  popup.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = [...popup.querySelectorAll("button:not(:disabled)")];
    if (
      (e.shiftKey && document.activeElement === items[0]) ||
      (!e.shiftKey && document.activeElement === items.at(-1))
    ) {
      e.preventDefault();
      close(true);
    }
  });
  function setCollapsed(value) {
    document.body.classList.toggle("sidebar-collapsed", value);
    collapse.setAttribute("aria-expanded", String(!value));
    collapse.setAttribute("aria-label", value ? "展开侧栏" : "收起侧栏");
    localStorage.setItem("claude2api_sidebar_collapsed", String(value));
    close();
  }
  setCollapsed(localStorage.getItem("claude2api_sidebar_collapsed") === "true");
  collapse.addEventListener("click", () =>
    setCollapsed(!document.body.classList.contains("sidebar-collapsed")),
  );
})();

Object.assign(i18n.translations.zh, {
  overviewTitle: "你的 Claude，随时就绪。",
  overviewDesc: "选个账号，接入客户端，或直接开始对话。",
  connectClient: "接入客户端",
  tryPlayground: "试聊一句",
  totalAccounts: "账号",
  managedSessions: "已添加的账号",
  usableSessions: "可用账号",
  sessionHint: "可以继续使用",
  modelIdentifiers: "模型",
  modelHint: "已登记的模型",
  totalRequests: "调用次数",
  requestHint: "保留的调用记录",
  protocolTitle: "选择接入方式",
  protocolNote: "模型能否使用，取决于你的账号。",
  startTitle: "三步开始使用",
  stepAccounts: "添加账号",
  stepAccountsDesc: "导入你的 sessionKey",
  stepKeys: "创建密钥",
  stepKeysDesc: "给客户端一个访问密钥",
  stepConnect: "连接客户端",
  stepConnectDesc: "复制地址和密钥，即可使用",
  recentRequests: "最近调用",
  viewAll: "查看全部",
  connectionTitle: "复制地址，连接客户端",
  clientProtocol: "客户端类型",
  clientAddress: "接口地址",
  fullEndpoint: "请求地址",
  connectionTip: "先创建密钥，再把地址和密钥填入客户端。",
  sdkExample: "代码示例",
  sessionNote: "登录失效后，请重新导入 sessionKey。",
  loginTitle: "登录",
  loginSubtitle: "输入管理密码或访问密钥",
  credential: "密码或密钥",
  credentialPlaceholder: "请输入密码或密钥",
  accountManagement: "账号管理",
  keyManagement: "访问密钥",
  apiDocs: "接入客户端",
  apiTitle: "接入客户端",
  chatTest: "试聊",
  callLogs: "调用记录",
  systemSettings: "设置",
  refreshAll: "检查全部账号",
  batchImport: "导入账号",
  deleteExpired: "清理失效账号",
  allAccounts: "全部",
  searchEmail: "搜索邮箱或组织",
  noteLabel: "密钥名称",
  customKey: "留空自动生成",
  contextThreshold: "长消息转为附件的字数",
  refreshInterval: "检查间隔，秒",
  proxyPlaceholder: "留空不使用代理",
  sessionLimit: "已用额度",
  resetTime: "恢复时间",
  noSessionData: "暂无用量",
  sessionLimits: "用量",
  newChat: "新对话",
  chatTitle: "试聊",
  startNewChat: "发条消息，开始对话。",
  selectAccountDesc: "开始对话",
  poolSelection: "选择账号",
  randomAccount: "自动选择",
  noRestart: "保存后生效",
  statusMonitoringDesc: "定期检查账号是否还能使用。",
  detailedLoggingNo: "只记调用结果",
  detailedLoggingYes: "保存消息内容",
  outboundProxy: "网络代理",
  requestInProgress: "正在回复…",
  keyDescription: "在客户端中填写这里创建的密钥。",
  keyName: "名称",
  keyValue: "密钥",
  favoritesOnly: "只看常用",
  favorite: "设为常用",
  unfavorite: "取消常用",
  noUsage: "暂无用量",
  usedPercent: "已用 {percent}%",
  usage: "用量",
  unavailable: "暂不可用",
  paused: "已暂停",
  resting: "休息中",
  pause: "暂停",
  resume: "恢复",
  referenceDocs: "接口说明",
  searchAccount: "搜索账号",
  protectionTitle: "请求保护",
  protectionDesc: "同一账号一次只发一条请求，受限后自动休息。",
  requestInterval: "请求间隔，秒",
  cooldownSeconds: "受限后至少休息，秒",
});
Object.assign(i18n.translations.en, {
  favoritesOnly: "Favorites",
  poolSelection: "Choose an account",
  refreshAll: "Check all accounts",
  favorite: "Add favorite",
  unfavorite: "Remove favorite",
  noUsage: "No usage yet",
  usedPercent: "{percent}% used",
  usage: "Usage",
  unavailable: "Unavailable",
  paused: "Paused",
  resting: "Resting",
  pause: "Pause",
  resume: "Resume",
  referenceDocs: "API reference",
  searchAccount: "Search accounts",
  clientAddress: "Base URL",
  protectionTitle: "Request protection",
  protectionDesc:
    "One request per account. Limited accounts rest before retrying.",
  requestInterval: "Request interval, seconds",
  cooldownSeconds: "Minimum cooldown, seconds",
});

Object.assign(i18n.translations.zh, {
  lastDay: "近 24 小时",
  successRate: "成功率",
  averageTime: "平均耗时",
});
Object.assign(i18n.translations.en, {
  lastDay: "Last 24 hours",
  successRate: "Success rate",
  averageTime: "Average response",
});

Object.assign(i18n.translations.zh, {
  you: "你",
  chatTestDesc: "支持图片，也可以继续追问。",
  enterMessage: "输入消息",
  clear: "新对话",
});

Object.assign(i18n.translations.zh, {
  manageSection: "管理",
  workspaceName: "本地工作区",
  preferences: "偏好设置",
});
Object.assign(i18n.translations.en, {
  manageSection: "Manage",
  workspaceName: "Local workspace",
  preferences: "Preferences",
});

Object.assign(i18n.translations.zh, {
  streamDisplay: "逐字显示",
  waitingReply: "正在等待回复",
});
Object.assign(i18n.translations.en, {
  streamDisplay: "Stream",
  waitingReply: "Waiting for a reply",
});
