/* JARVIS assistant shell for Discipline HQ.
   This version is intentionally API-free. Add a secure backend/Gemini
   connection later; never put a private API key in browser-side code. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const launcher = $("jarvis-launcher");
  const panel = $("jarvis-panel");
  const greeting = $("jarvis-greeting");
  const dismissGreeting = $("jarvis-greeting-dismiss");
  const closeButton = $("jarvis-close");
  const clearButton = $("jarvis-clear");
  const form = $("jarvis-form");
  const input = $("jarvis-input");
  const sendButton = $("jarvis-send");
  const messages = $("jarvis-messages");
  const suggestions = $("jarvis-suggestions");

  if (!launcher || !panel || !form || !input || !messages) return;

  const STORAGE_KEY = "discipline-hq-jarvis-chat-v1";
  const MAX_STORED_MESSAGES = 60;
  let busy = false;

  const welcome = {
    role: "assistant",
    text: "Hey! I’m Jarvis. I can help you navigate Discipline HQ, think through your trading process, review your discipline habits, or chat about general topics. What’s on your mind?",
    time: Date.now()
  };

  function openChat() {
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    launcher.setAttribute("aria-expanded", "true");
    if (greeting) greeting.hidden = true;
    window.setTimeout(() => input.focus(), 100);
  }

  function closeChat() {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  function loadHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter(m =>
        m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string"
      ).slice(-MAX_STORED_MESSAGES) : [];
    } catch (_) { return []; }
  }

  let history = loadHistory();
  if (!history.length) history = [{ ...welcome }];

  function saveHistory() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_STORED_MESSAGES))); }
    catch (_) { /* Chat can still be used if browser storage is unavailable. */ }
  }

  function appendMessage(role, text, persist = true) {
    const row = document.createElement("div");
    row.className = `jarvis-message ${role === "user" ? "jarvis-message-user" : "jarvis-message-bot"}`;

    if (role !== "user") {
      const avatar = document.createElement("div");
      avatar.className = "jarvis-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = "J";
      row.appendChild(avatar);
    }

    const wrap = document.createElement("div");
    wrap.className = "jarvis-bubble-wrap";
    const sender = document.createElement("div");
    sender.className = "jarvis-sender";
    sender.append(document.createTextNode(role === "user" ? "YOU" : "JARVIS"));
    const time = document.createElement("span");
    time.textContent = "NOW";
    sender.appendChild(time);

    const bubble = document.createElement("div");
    bubble.className = "jarvis-bubble";
    bubble.textContent = text; // Use textContent to avoid rendering user input as HTML.
    wrap.append(sender, bubble);
    row.appendChild(wrap);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;

    if (persist) {
      history.push({ role, text, time: Date.now() });
      history = history.slice(-MAX_STORED_MESSAGES);
      saveHistory();
    }
    return row;
  }

  function renderHistory() {
    messages.replaceChildren();
    history.forEach(m => appendMessage(m.role, m.text, false));
  }

  function showTyping() {
    const row = document.createElement("div");
    row.className = "jarvis-message jarvis-message-bot";
    row.id = "jarvis-typing";
    const avatar = document.createElement("div");
    avatar.className = "jarvis-avatar";
    avatar.textContent = "J";
    avatar.setAttribute("aria-hidden", "true");
    const wrap = document.createElement("div");
    wrap.className = "jarvis-bubble-wrap";
    const sender = document.createElement("div");
    sender.className = "jarvis-sender";
    sender.textContent = "JARVIS IS THINKING";
    const dots = document.createElement("div");
    dots.className = "jarvis-bubble jarvis-typing";
    dots.innerHTML = "<span></span><span></span><span></span>";
    wrap.append(sender, dots);
    row.append(avatar, wrap);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
  }

  function normalise(text) {
    return text.toLowerCase().replace(/[’‘]/g, "'").trim();
  }

  function localReply(raw) {
    const text = normalise(raw);
    if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(text)) {
      return "Hey! 👋 I’m here. Tell me what you want to work on, and we’ll take it one step at a time.";
    }
    if (/(what can you do|help me|help menu|capabilities)/.test(text)) {
      return "Here’s what I can help with in this preview:\n• Explain the Discipline HQ sections and how to use them.\n• Help design a pre-market, in-market, or post-market routine.\n• Suggest ways to review discipline and trading habits.\n• Discuss general topics and help organise your thinking.\n\nThe Gemini connection is not active yet, so my replies are limited until we connect the AI service.";
    }
    if (/(how to use|use discipline hq|what is this app|dashboard)/.test(text)) {
      return "Discipline HQ is designed to help you follow a repeatable process rather than trade impulsively. Use your checklist before, during, and after a session; record what happened; then review your history and reflections to spot patterns. Keep checklist items specific enough that you can honestly mark them complete or incomplete.";
    }
    if (/(pre.?market|before market|before trading|pre.?trade)/.test(text)) {
      return "A practical pre-market routine:\n1. Check your energy, mood, and focus.\n2. Mark the important higher-timeframe levels and likely liquidity areas.\n3. Define the setups you are allowed to take.\n4. Set your risk limit and daily stop condition.\n5. Confirm that you will not chase a move or trade without confirmation.\n\nKeep it short enough to complete consistently.";
    }
    if (/(post.?market|after market|journal|review my day|reflection)/.test(text)) {
      return "For your post-market review, record the facts first: which rules you followed, whether entries matched your plan, and whether risk stayed within limits. Then write one thing done well, one mistake or near-miss, and one specific adjustment for the next session. Review process quality separately from profit or loss.";
    }
    if (/(revenge|revenge trading|loss|lost money|losing trade|tilt|angry)/.test(text)) {
      return "Pause before taking another trade. Step away from the chart, take a few slow breaths, and check your written rules. If you have reached your daily loss limit, or you feel you need to win the money back, stop trading for the day. A missed trade is cheaper than a rule-breaking trade.";
    }
    if (/(motivat|reset|give up|discipline is hard|consisten)/.test(text)) {
      return "Reset the goal: you do not need a perfect day; you need the next rule-following decision. Make the next step small, measurable, and within your control. Your job is to execute the process—not force a result from the market.";
    }
    if (/(risk management|risk per trade|position size|stop.?loss)/.test(text)) {
      return "Risk should be defined before entry. Calculate position size from your account risk limit and the distance to the stop-loss, and include fees or slippage where relevant. Never widen a stop simply to avoid taking a planned loss. I can explain the calculation, but this preview cannot see your broker account or live market data.";
    }
    if (/(strategy|smc|liquidity|fvg|order flow|setup|entry)/.test(text)) {
      return "I can help you structure a trading plan, but this offline preview cannot inspect a live chart or verify a setup. Describe the instrument, timeframe, bias, entry trigger, invalidation level, and target. Evaluate whether the trade matches your written rules before considering an entry.";
    }
    if (/(calendar|history|score|checklist|settings|reflection|analytics)/.test(text)) {
      return "Use the app’s navigation to open that section. Checklists capture execution, History and Calendar help you review past sessions, Analytics helps you look for patterns, and Reflections give you space to record lessons. Exact controls depend on the current version of your Discipline HQ interface.";
    }
    if (/(thank you|thanks|thx)/.test(text)) {
      return "You’re welcome. Stay patient, follow the plan, and measure success by the quality of your decisions.";
    }
    return "I’ve received your message. Right now I’m running in preview mode, so I don’t have a connected large language model and can only answer with built-in guidance. Once we connect Gemini through a secure backend, I’ll be able to handle open-ended questions much more naturally. For now, try asking about your checklist, trading routine, discipline, risk management, or post-market review.";
  }

  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
    input.disabled = value;
  }

  async function sendMessage(text) {
    const clean = String(text || "").trim();
    if (!clean || busy) return;
    openChat();
    if (suggestions) suggestions.hidden = true;
    appendMessage("user", clean);
    input.value = "";
    input.style.height = "auto";
    setBusy(true);
    showTyping();

    // API integration point: replace localReply with a fetch to your own backend
    // when Gemini is configured. Never expose the Gemini API key in this file.
    await new Promise(resolve => window.setTimeout(resolve, 450));
    const typing = $("jarvis-typing");
    if (typing) typing.remove();
    appendMessage("assistant", localReply(clean));
    setBusy(false);
    input.focus();
  }

  launcher.addEventListener("click", () => {
    if (panel.classList.contains("is-open")) closeChat();
    else openChat();
  });
  if (closeButton) closeButton.addEventListener("click", closeChat);
  if (dismissGreeting) dismissGreeting.addEventListener("click", () => { greeting.hidden = true; });
  if (clearButton) clearButton.addEventListener("click", () => {
    history = [{ ...welcome, time: Date.now() }];
    saveHistory();
    renderHistory();
    if (suggestions) suggestions.hidden = false;
    input.focus();
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    sendMessage(input.value);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
  });
  if (suggestions) {
    suggestions.addEventListener("click", event => {
      const button = event.target.closest("[data-jarvis-prompt]");
      if (button) sendMessage(button.getAttribute("data-jarvis-prompt"));
    });
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) closeChat();
  });

  renderHistory();
})();
