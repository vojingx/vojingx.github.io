/* OmniAI 随身版 — 离线优先的移动聊天
 * - 优先用浏览器内本地模型 (WebLLM / WebGPU)，完全离线推理（首次需联网下载一次模型）。
 * - 不支持 WebGPU 的环境（如 iPhone Safari）自动降级为「离线简版」：内置本地应答，零网络。
 * - 通过 service worker 缓存界面，断网也能打开。
 */
(function () {
  "use strict";
  var chatEl = document.getElementById("chat");
  var inputEl = document.getElementById("input");
  var sendEl = document.getElementById("send");
  var statusEl = document.getElementById("status");
  var hintEl = document.getElementById("hint");
  var dlBtn = document.getElementById("dlmodel");

  var MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
  var engine = null;
  var mode = "loading"; // loading | local | offline
  var history = [{ role: "system", content: "你是一个本地运行的 AI 助手，叫 OmniAI。用简体中文、友好简洁地回答。" }];

  // 本地模型是否已下载并缓存（用于离线提示）
  var modelCached = false;
  try { modelCached = localStorage.getItem("omniai_model_cached") === "1"; } catch (e) {}

  // ---------- 服务注册 ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  // ---------- UI 工具 ----------
  function addBubble(role, text) {
    var m = document.createElement("div");
    m.className = "msg " + (role === "me" ? "me" : role === "bot" ? "bot" : "sys");
    m.textContent = text;
    chatEl.appendChild(m);
    chatEl.scrollTop = chatEl.scrollHeight;
    return m;
  }
  function setStatus(t) { statusEl.textContent = t; }

  function send() {
    var text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    autoGrow();
    addBubble("me", text);
    history.push({ role: "user", content: text });

    if (mode === "local" && engine) {
      streamLocal(text);
    } else {
      var reply = offlineReply(text);
      var b = addBubble("bot", "");
      typeOut(b, reply);
    }
  }

  // 打字机效果（离线简版用）
  function typeOut(el, text) {
    var i = 0;
    var timer = setInterval(function () {
      el.textContent = text.slice(0, ++i);
      chatEl.scrollTop = chatEl.scrollHeight;
      if (i >= text.length) clearInterval(timer);
    }, 18);
  }

  // ---------- 本地模型（WebLLM） ----------
  async function initLocal() {
    if (!navigator.gpu) { fallback("当前浏览器不支持本地模型（无 WebGPU）"); return; }
    try {
      setStatus("正在加载本地模型…");
      var webllm = await import("https://esm.run/@mlc-ai/web-llm");
      engine = new webllm.MLCEngine();
      engine.setInitProgressCallback(function (p) {
        setStatus("本地模型加载中 " + Math.round((p.progress || 0) * 100) + "%");
      });
      await engine.reload(MODEL_ID, { temperature: 0.7, top_p: 0.9 });
      mode = "local";
      try { localStorage.setItem("omniai_model_cached", "1"); } catch (e) {}
      modelCached = true;
      setStatus("本地模型就绪 · 离线可用");
      if (hintEl) {
        hintEl.innerHTML = "✅ 本地模型已下载并缓存，断网也能用真·AI。<br>iPhone 的 Safari 无 WebGPU，仍走离线简版。";
      }
      if (dlBtn) dlBtn.style.display = "none";
    } catch (e) {
      fallback("本地模型加载失败：" + (e && e.message ? e.message : e));
    }
  }

  async function streamLocal(prompt) {
    sendEl.disabled = true;
    var b = addBubble("bot", "");
    var acc = "";
    try {
      var chunks = await engine.chat.completions.create({
        messages: history,
        stream: true,
        stream_options: { include_usage: false },
        temperature: 0.7,
      });
      for await (var chunk of chunks) {
        var d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta
          ? chunk.choices[0].delta.content || "" : "";
        if (d) { acc += d; b.textContent = acc; chatEl.scrollTop = chatEl.scrollHeight; }
      }
      history.push({ role: "assistant", content: acc });
    } catch (e) {
      b.textContent = "（本地推理出错，已切换离线简版）" + (e && e.message ? e.message : "");
      history.push({ role: "assistant", content: acc || "（出错）" });
    }
    sendEl.disabled = false;
  }

  function fallback(reason) {
    mode = "offline";
    if (navigator.gpu && !navigator.onLine) {
      // 支持 WebGPU 但当前离线、且模型尚未缓存：诚实告知需联网下载一次
      setStatus("离线简版 · 本地模型未下载");
      addBubble("sys", "当前离线，且本地模型尚未下载缓存。请联网打开一次本应用（会自动下载并缓存模型，约 400MB），之后即可断网使用真·本地大模型。现已切换为离线简版（内置应答）。");
    } else {
      setStatus("离线简版 · 无需联网");
      addBubble("sys", "本地模型不可用，已切换为离线简版（内置应答，完全断网可用）。");
    }
    console.warn(reason);
  }

  // ---------- 离线简版应答（纯本地，零网络） ----------
  function offlineReply(text) {
    var t = text.toLowerCase();
    if (/(你好|您好|hi|hello|在吗)/.test(t)) return "你好呀，我是 OmniAI 随身版。我现在是离线简版，能陪你聊聊天、记点东西。";
    if (/(你叫|名字|谁)/.test(t)) return "我叫 OmniAI，是你手机上的本地小助手。在支持 WebGPU 的浏览器（如安卓 Chrome）里，我可以跑真正的本地大模型。";
    if (/(离线|断网|没有网|没网络)/.test(t)) return "对，离线简版完全不联网，你的话只在本机处理。想用更聪明的大模型，换安卓 Chrome 打开、首次联网下载一次模型即可。";
    if (/(能做什么|功能|会什么|帮你)/.test(t)) return "我可以：聊天陪聊、帮你写文案/代码、回答问题。离线简版是内置应答；联网下载模型后就是真·本地大模型。";
    if (/(谢谢|感谢|多谢)/.test(t)) return "不客气，随时找我～";
    if (/(再见|拜拜|bye)/.test(t)) return "再见，记得把我「添加到主屏幕」就能当 App 用啦。";
    if (/(怎么|如何|怎样).*(安装|下载|主屏幕|app)/.test(t)) return "在浏览器菜单里选「添加到主屏幕 / 安装应用」，就能像 App 一样放在桌面上，断网也能打开。";
    return "（离线简版）我收到啦：「" + text + "」。这是内置应答；想让我更聪明，用安卓 Chrome 打开并允许下载一次本地模型。";
  }

  // ---------- 事件 ----------
  if (dlBtn) {
    dlBtn.addEventListener("click", function () {
      dlBtn.disabled = true;
      dlBtn.textContent = "下载中…（约 400MB，请保持联网）";
      initLocal();
    });
  }
  sendEl.addEventListener("click", send);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  function autoGrow() { inputEl.style.height = "auto"; inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px"; }
  inputEl.addEventListener("input", autoGrow);

  // 启动
  addBubble("sys", "OmniAI 随身版 · 正在准备…");
  initLocal();
})();
