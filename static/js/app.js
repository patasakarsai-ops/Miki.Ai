/* ============================================================
   Miki.ai — frontend logic
   Streaming chat (SSE), document upload, markdown rendering,
   theme + sidebar, lightweight chat history (in-memory).
   ============================================================ */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"), sidebar: $("sidebar"),
    menuToggleMobile: $("menuToggleMobile"),
    newChat: $("newChat"), history: $("history"),
    docList: $("docList"), uploadTrigger: $("uploadTrigger"),
    themeToggle: $("themeToggle"),
    chat: $("chat"), welcome: $("welcome"), messages: $("messages"),
    suggestions: $("suggestions"),
    input: $("input"), sendBtn: $("sendBtn"), attachBtn: $("attachBtn"),
    fileInput: $("fileInput"), dropHint: $("dropHint"),
    statusPill: $("statusPill"), statusText: $("statusText"),
    toastWrap: $("toastWrap"),
    userMenu: $("userMenu"), userChip: $("userChip"), userDropdown: $("userDropdown"),
    userAvatar: $("userAvatar"), userAvatarLg: $("userAvatarLg"),
    userName: $("userName"), userNameLg: $("userNameLg"), userEmail: $("userEmail"),
    logoutBtn: $("logoutBtn"),
  };

  // ---- State ----------------------------------------------------------
  let conversation = [];      // [{role, content}]
  let chats = [];             // [{id, title, messages}]
  let currentChatId = null;
  let streaming = false;

  // ---- Init -----------------------------------------------------------
  function init() {
    const savedTheme = localStorage.getItem("miki-theme");
    if (savedTheme) document.documentElement.dataset.theme = savedTheme;
    if (window.innerWidth <= 820) el.app.classList.add("collapsed");

    bindEvents();
    initUser();
    loadDocuments();
    newChat();
    autoGrow();
    if (!window.MIKI_CONFIGURED) {
      setStatus("No API key", "err");
      toast("Set GEMINI_API_KEY in your .env file to start chatting.", "err", 6000);
    }
  }

  // ---- User / auth ----------------------------------------------------
  function initUser() {
    if (!window.AUTH_ENABLED) return;          // auth not configured -> hide menu
    const u = window.MIKI_USER;
    if (!u) { window.location.href = "/login"; return; }

    el.userMenu.hidden = false;
    const initial = (u.name || u.email || "U").trim().charAt(0).toUpperCase();
    const avatarHtml = u.picture ? `<img src="${u.picture}" alt="" />` : initial;
    el.userAvatar.innerHTML = avatarHtml;
    el.userAvatarLg.innerHTML = avatarHtml;
    el.userName.textContent = u.name || u.email;
    el.userNameLg.textContent = u.name || "";
    el.userEmail.textContent = u.email || "";

    el.userChip.onclick = (e) => { e.stopPropagation(); el.userDropdown.hidden = !el.userDropdown.hidden; };
    document.addEventListener("click", () => { el.userDropdown.hidden = true; });
    el.userDropdown.onclick = (e) => e.stopPropagation();
    el.logoutBtn.onclick = logout;
  }

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    window.location.href = "/login";
  }

  // ---- Events ---------------------------------------------------------
  function bindEvents() {
    const toggle = () => el.app.classList.toggle("collapsed");
    el.menuToggleMobile.onclick = toggle;
    el.newChat.onclick = newChat;
    el.themeToggle.onclick = toggleTheme;

    el.input.addEventListener("input", () => { autoGrow(); refreshSend(); });
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    el.sendBtn.onclick = send;

    el.suggestions.querySelectorAll(".suggestion").forEach((btn) => {
      btn.onclick = () => { el.input.value = btn.dataset.prompt; refreshSend(); autoGrow(); el.input.focus(); };
    });

    el.attachBtn.onclick = () => el.fileInput.click();
    el.uploadTrigger.onclick = () => el.fileInput.click();
    el.fileInput.onchange = () => { if (el.fileInput.files[0]) uploadFile(el.fileInput.files[0]); el.fileInput.value = ""; };

    // Drag & drop upload
    ["dragenter", "dragover"].forEach((ev) =>
      window.addEventListener(ev, (e) => { e.preventDefault(); el.app.classList.add("dragging"); }));
    ["dragleave", "drop"].forEach((ev) =>
      window.addEventListener(ev, (e) => {
        e.preventDefault();
        if (ev === "dragleave" && e.relatedTarget) return;
        el.app.classList.remove("dragging");
      }));
    window.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files[0];
      if (f) uploadFile(f);
    });
  }

  // ---- Chat sessions --------------------------------------------------
  function newChat() {
    if (streaming) return;
    const id = "c" + Date.now();
    currentChatId = id;
    conversation = [];
    el.messages.innerHTML = "";
    el.welcome.style.display = "flex";
    setStatus("Ready", "ok");
    el.input.focus();
  }

  function ensureChatRecord(title) {
    let chat = chats.find((c) => c.id === currentChatId);
    if (!chat) {
      chat = { id: currentChatId, title, messages: conversation };
      chats.unshift(chat);
      renderHistory();
    }
  }

  function renderHistory() {
    el.history.innerHTML = "";
    chats.forEach((chat) => {
      const b = document.createElement("button");
      b.className = "history__item" + (chat.id === currentChatId ? " active" : "");
      b.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span></span>`;
      b.querySelector("span").textContent = chat.title;
      b.onclick = () => openChat(chat.id);
      el.history.appendChild(b);
    });
  }

  function openChat(id) {
    if (streaming) return;
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    currentChatId = id;
    conversation = chat.messages;
    el.messages.innerHTML = "";
    el.welcome.style.display = conversation.length ? "none" : "flex";
    conversation.forEach((m) => addMessage(m.role, m.content, { sources: m.sources }));
    renderHistory();
    scrollToBottom();
  }

  // ---- Sending / streaming -------------------------------------------
  async function send() {
    const text = el.input.value.trim();
    if (!text || streaming) return;
    if (!window.MIKI_CONFIGURED) { toast("Add your GEMINI_API_KEY to .env first.", "err"); return; }

    el.welcome.style.display = "none";
    el.input.value = ""; autoGrow(); refreshSend();

    addMessage("user", text);
    conversation.push({ role: "user", content: text });
    ensureChatRecord(text.slice(0, 42));

    const aiEl = addMessage("ai", "", { pending: true });
    const contentEl = aiEl.querySelector(".msg__content");

    streaming = true; setStatus("Thinking…", "busy"); refreshSend();

    let answer = "";
    let sources = [];
    const history = conversation.slice(0, -1).map((m) => ({ role: m.role === "ai" ? "assistant" : m.role, content: m.content }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      if (!res.ok || !res.body) throw new Error("Request failed (" + res.status + ")");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const evt = JSON.parse(line.slice(5).trim());

          if (evt.type === "sources") {
            sources = evt.sources || [];
          } else if (evt.type === "token") {
            answer += evt.text;
            contentEl.innerHTML = renderMarkdown(answer) + '<span class="cursor"></span>';
            scrollToBottom();
            if (el.statusText.textContent !== "Writing…") setStatus("Writing…", "busy");
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        }
      }

      contentEl.innerHTML = renderMarkdown(answer);
      if (sources.length) contentEl.appendChild(renderSources(sources));
      conversation.push({ role: "ai", content: answer, sources });
      setStatus("Ready", "ok");
    } catch (err) {
      contentEl.innerHTML = `<p style="color:#d93025">⚠ ${escapeHtml(err.message)}</p>`;
      setStatus("Error", "err");
      toast(err.message, "err");
    } finally {
      streaming = false; refreshSend();
      scrollToBottom();
    }
  }

  // ---- Message rendering ---------------------------------------------
  function addMessage(role, content, opts = {}) {
    const wrap = document.createElement("div");
    wrap.className = "msg msg--" + (role === "user" ? "user" : "ai");
    const avatar = role === "user" ? "You"[0] : "✦";
    const name = role === "user" ? "You" : "Miki";

    wrap.innerHTML =
      `<div class="msg__avatar">${avatar}</div>
       <div class="msg__body">
         <div class="msg__name">${name}</div>
         <div class="msg__content"></div>
       </div>`;

    const c = wrap.querySelector(".msg__content");
    if (opts.pending) {
      c.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
    } else if (role === "user") {
      c.textContent = content;
    } else {
      c.innerHTML = renderMarkdown(content);
      if (opts.sources && opts.sources.length) c.appendChild(renderSources(opts.sources));
    }

    el.messages.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function renderSources(sources) {
    const box = document.createElement("div");
    box.className = "sources";
    sources.forEach((s) => {
      const chip = document.createElement("span");
      chip.className = "source-chip";
      chip.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6"/></svg><b></b>`;
      chip.querySelector("b").textContent = s.filename;
      box.appendChild(chip);
    });
    return box;
  }

  // ---- Documents ------------------------------------------------------
  async function loadDocuments() {
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      renderDocs(data.documents || []);
    } catch { renderDocs([]); }
  }

  function renderDocs(docs) {
    el.docList.innerHTML = "";
    if (!docs.length) {
      el.docList.innerHTML = `<div class="docs__empty">No documents yet. Upload a PDF, DOCX, TXT or MD to chat with it.</div>`;
      return;
    }
    docs.forEach((d) => {
      const item = document.createElement("div");
      item.className = "doc";
      item.innerHTML =
        `<svg class="doc__icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6"/></svg>
         <div style="flex:1;min-width:0">
           <div class="doc__name">${escapeHtml(d.filename)}</div>
           <div class="doc__meta">${d.chunks} chunks</div>
         </div>
         <button class="doc__del" title="Remove"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6"/></svg></button>`;
      item.querySelector(".doc__del").onclick = (e) => { e.stopPropagation(); deleteDoc(d.doc_id, d.filename); };
      el.docList.appendChild(item);
    });
  }

  async function uploadFile(file) {
    const ok = [".pdf", ".txt", ".md", ".docx"].some((x) => file.name.toLowerCase().endsWith(x));
    if (!ok) { toast("Unsupported file type. Use PDF, DOCX, TXT or MD.", "err"); return; }

    setStatus("Indexing…", "busy");
    const tid = toast(`Indexing “${file.name}”…`, "info", 0);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      dismissToast(tid);
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast(`Added “${data.filename}” (${data.chunks} chunks)`, "ok");
      setStatus("Ready", "ok");
      loadDocuments();
    } catch (err) {
      dismissToast(tid);
      toast(err.message, "err");
      setStatus("Ready", "ok");
    }
  }

  async function deleteDoc(id, name) {
    try {
      await fetch("/api/documents/" + id, { method: "DELETE" });
      toast(`Removed “${name}”`, "ok");
      loadDocuments();
    } catch { toast("Could not remove document", "err"); }
  }

  // ---- UI helpers -----------------------------------------------------
  function autoGrow() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 200) + "px";
  }
  function refreshSend() { el.sendBtn.disabled = streaming || !el.input.value.trim(); }
  function scrollToBottom() { el.chat.scrollTop = el.chat.scrollHeight; }

  function setStatus(text, kind) {
    el.statusText.textContent = text;
    el.statusPill.className = "pill" + (kind === "busy" ? " busy" : kind === "err" ? " err" : "");
  }

  function toggleTheme() {
    const cur = document.documentElement.dataset.theme;
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("miki-theme", next);
  }

  function toast(msg, kind = "info", ttl = 3200) {
    const t = document.createElement("div");
    t.className = "toast" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
    t.textContent = msg;
    const id = "t" + Date.now() + Math.round(Math.random() * 999);
    t.dataset.id = id;
    el.toastWrap.appendChild(t);
    if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
    return id;
  }
  function dismissToast(id) {
    const t = el.toastWrap.querySelector(`[data-id="${id}"]`);
    if (t) t.remove();
  }

  // ---- Minimal, safe Markdown renderer -------------------------------
  function renderMarkdown(src) {
    if (!src) return "";
    // Protect fenced code blocks first.
    const blocks = [];
    src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
      return ` CB${blocks.length - 1} `;
    });

    const lines = src.split("\n");
    let html = "", inList = null;
    const closeList = () => { if (inList) { html += `</${inList}>`; inList = null; } };

    for (let raw of lines) {
      const line = raw;
      if (/^\s*$/.test(line)) { closeList(); continue; }

      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        closeList(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        if (inList !== "ul") { closeList(); html += "<ul>"; inList = "ul"; }
        html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`; continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        if (inList !== "ol") { closeList(); html += "<ol>"; inList = "ol"; }
        html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`; continue;
      }
      if (/^>\s?/.test(line)) { closeList(); html += `<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`; continue; }

      closeList();
      html += `<p>${inline(line)}</p>`;
    }
    closeList();

    // Restore code blocks.
    html = html.replace(/ CB(\d+) /g, (_, i) => blocks[+i]);
    return html;
  }

  function inline(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
