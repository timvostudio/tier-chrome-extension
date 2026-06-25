// Tier popup controller — view state, rendering, and event wiring.
// Storage/auth/calendar logic lives in storage.js / auth.js / calendar.js.

const bodyEl = document.getElementById("body");
const syncBtn = document.getElementById("syncBtn");
const syncIconWrap = syncBtn;
const addBtn = document.getElementById("addBtn");
const settingsBtn = document.getElementById("settingsBtn");
const calendarBtn = document.getElementById("calendarBtn");

const TIER_ORDER = ["red", "yellow", "green"];
const TIER_META = {
  red: { label: "Priority 1", emoji: "\u{1F534}", short: "P1" },
  yellow: { label: "Priority 2", emoji: "\u{1F7E1}", short: "P2" },
  green: { label: "Priority 3", emoji: "\u{1F7E2}", short: "P3" },
};

const EXAMPLE_TASKS = [
  { id: "ex-1", title: "Send offer letter to client", deadline: Date.now() + 2 * 60 * 60 * 1000, source: "calendar", tier: "red", completed: false, notes: "" },
  { id: "ex-2", title: "Follow up on 3BR listing", deadline: Date.now() + 2 * 24 * 60 * 60 * 1000, source: "manual", tier: "yellow", completed: false, notes: "" },
  { id: "ex-3", title: "Close escrow — Oak Street", deadline: Date.now() + 6 * 24 * 60 * 60 * 1000, source: "calendar", tier: "green", completed: false, notes: "" },
];

let state = {
  view: "main",
  editingTask: null,
  offline: false,
};

function uuid() {
  return "task-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

async function getUserDisplayName() {
  try {
    const info = await new Promise((resolve) => chrome.identity.getProfileUserInfo(resolve));
    if (info && info.email) {
      const local = info.email.split("@")[0];
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
  } catch (err) {
    // No Chrome profile info available — greet without a name.
  }
  return "";
}

async function greetingHtml() {
  const name = await getUserDisplayName();
  return `<div class="greeting">${getGreeting()}${name ? ", " + name : ""}!</div>`;
}

function formatDue(deadline) {
  const date = new Date(deadline);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  if (deadline < Date.now()) return `Overdue — ${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`;
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

async function init() {
  const authState = await self.TierStorage.getAuthState();
  if (!authState.connected) {
    renderConnectScreen();
    return;
  }
  await renderMain();
}

async function renderMain() {
  state.view = "main";
  const [tasks, lastSync, settings, suggestions] = await Promise.all([
    self.TierStorage.getTasks(),
    self.TierStorage.getLastSync(),
    self.TierStorage.getSettings(),
    self.TierStorage.getSuggestions(),
  ]);

  const visibleTasks = settings.showCompleted ? tasks : tasks.filter((t) => !t.completed);

  let html = "";
  if (state.offline) {
    html += `<div class="offline-banner">Offline — showing cached tasks</div>`;
  }
  if (suggestions.length > 0) {
    html += `<div class="suggestion-banner" id="suggestionBanner">
      <span>Tier found ${suggestions.length} task update${suggestions.length > 1 ? "s" : ""} from your inbox</span>
      <button class="suggestion-review-btn" id="reviewSuggestionsBtn">Review</button>
    </div>`;
  }
  html += `<div class="intro-section">`;
  html += await greetingHtml();
  html += `<div class="sync-label">Last synced: ${lastSync ? timeAgo(lastSync) : "never"}</div>`;
  html += `</div>`;
  html += `<hr class="section-divider" />`;

  for (const tier of TIER_ORDER) {
    const meta = TIER_META[tier];
    const tierTasks = visibleTasks.filter((t) => t.tier === tier);
    html += `<div class="section">
      <div class="section-label"><span class="dot ${tier}"></span>${meta.label.toUpperCase()}</div>
      ${tierTasks.length === 0 ? `<div class="empty-state">No tasks</div>` : tierTasks.map((t) => taskCardHtml(t, settings)).join("")}
    </div>`;
  }

  bodyEl.innerHTML = html;
  wireTaskCards();
  const reviewBtn = document.getElementById("reviewSuggestionsBtn");
  if (reviewBtn) {
    reviewBtn.addEventListener("click", renderSuggestions);
  }
}

async function renderSuggestions() {
  state.view = "suggestions";
  const suggestions = await self.TierStorage.getSuggestions();

  bodyEl.innerHTML = `
    <div class="modal-header">
      <button class="back-btn" id="backBtn">&larr; Back</button>
      <span class="modal-title">Inbox Suggestions</span>
    </div>
    <div class="modal-body">
      ${suggestions.length === 0
        ? `<div class="empty-state">No pending suggestions</div>`
        : suggestions.map((s) => suggestionCardHtml(s)).join("")}
    </div>
  `;

  document.getElementById("backBtn").addEventListener("click", renderMain);
  suggestions.forEach((s) => {
    const confirmBtn = document.getElementById(`confirm-${s.id}`);
    const dismissBtn = document.getElementById(`dismiss-${s.id}`);
    if (confirmBtn) confirmBtn.addEventListener("click", () => applySuggestion(s));
    if (dismissBtn) dismissBtn.addEventListener("click", () => dismissSuggestion(s.id));
  });
}

function suggestionCardHtml(s) {
  const actionLabel = s.type === "create"
    ? `New task: <strong>${escapeHtml(s.title)}</strong>`
    : `Mark complete: <strong>${escapeHtml(s.title)}</strong>`;
  return `<div class="suggestion-card" id="card-${s.id}">
    <div class="suggestion-action">${actionLabel}</div>
    <div class="suggestion-source">From: ${escapeHtml(s.from || "Unknown sender")}</div>
    <div class="suggestion-snippet">"${escapeHtml(s.snippet || "")}"</div>
    <div class="suggestion-actions">
      <button class="btn-ghost" id="dismiss-${s.id}">Dismiss</button>
      <button class="btn-save" id="confirm-${s.id}">Confirm</button>
    </div>
  </div>`;
}

async function applySuggestion(s) {
  if (s.type === "create") {
    const tier = self.TierCalendar.computeTier(s.deadline);
    await self.TierStorage.saveTask({
      id: uuid(),
      title: s.title,
      deadline: s.deadline,
      source: "gmail",
      tier,
      tierOverride: false,
      notes: `Detected from email: "${s.sourceSubject}"`,
      completed: false,
      createdAt: Date.now(),
    });
  } else if (s.type === "complete") {
    const tasks = await self.TierStorage.getTasks();
    const task = tasks.find((t) => t.id === s.taskId);
    if (task) {
      task.completed = true;
      await self.TierStorage.saveTask(task);
    }
  }
  await self.TierStorage.removeSuggestion(s.id);
  renderSuggestions();
}

async function dismissSuggestion(id) {
  await self.TierStorage.removeSuggestion(id);
  renderSuggestions();
}

function taskCardHtml(task, settings) {
  const badge = settings.showSourceBadges
    ? `<span class="source-badge">${task.source}</span>`
    : "";
  return `<div class="task-card ${task.tier} ${task.completed ? "completed" : ""}" data-id="${task.id}">
    <div class="task-title-row">
      <span class="task-title" data-action="toggle-complete">${escapeHtml(task.title)}</span>
      <button class="edit-icon" data-action="edit" title="Edit">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <div class="task-sub-row">
      <span class="task-due">Due: ${formatDue(task.deadline)}</span>
      ${badge}
    </div>
  </div>`;
}

function wireTaskCards() {
  bodyEl.querySelectorAll(".task-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-action="toggle-complete"]').addEventListener("click", () => toggleComplete(id));
    card.querySelector('[data-action="edit"]').addEventListener("click", (e) => {
      e.stopPropagation();
      openEditForm(id);
    });
  });
}

async function toggleComplete(id) {
  const tasks = await self.TierStorage.getTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  await self.TierStorage.saveTask(task);
  renderMain();
}

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function todayLabel() {
  return new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

async function renderConnectScreen() {
  state.view = "connect";
  let html = `<div class="intro-section">`;
  html += await greetingHtml();
  html += `<div class="example-banner">Tasks To Complete — ${todayLabel()}</div>`;
  html += `</div>`;
  html += `<hr class="section-divider" />`;
  for (const tier of TIER_ORDER) {
    const meta = TIER_META[tier];
    const tierTasks = EXAMPLE_TASKS.filter((t) => t.tier === tier);
    html += `<div class="section">
      <div class="section-label"><span class="dot ${tier}"></span>${meta.label.toUpperCase()}</div>
      ${tierTasks.map((t) => taskCardHtml(t, { showSourceBadges: true })).join("")}
    </div>`;
  }
  html += `<div class="connect-screen"></div>`;
  bodyEl.innerHTML = html;
}

async function connectCalendar() {
  try {
    const token = await self.TierAuth.getAuthToken(true);
    const email = await self.TierAuth.fetchUserEmail(token);
    await self.TierStorage.setAuthState({ connected: true, email });
    await runSync();
  } catch (err) {
    console.error("Connect failed:", err);
    bodyEl.insertAdjacentHTML("afterbegin", `<div class="offline-banner">Connection failed — try again.</div>`);
  }
}

async function runSync() {
  syncIconWrap.classList.add("spinning");
  state.offline = false;
  try {
    await self.TierCalendar.syncCalendar();
  } catch (err) {
    console.error("Sync failed:", err);
    state.offline = true;
  } finally {
    syncIconWrap.classList.remove("spinning");
    await renderMain();
  }
}

function openAddForm() {
  state.editingTask = null;
  renderForm();
}

async function openEditForm(id) {
  const tasks = await self.TierStorage.getTasks();
  state.editingTask = tasks.find((t) => t.id === id) || null;
  renderForm();
}

function toDatetimeLocalValue(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderForm() {
  state.view = "form";
  const task = state.editingTask;
  const isEdit = !!task;
  const title = isEdit ? task.title : "";
  const notes = isEdit ? task.notes || "" : "";
  const activeTier = isEdit ? task.tier : "yellow";
  const deadlineValue = toDatetimeLocalValue(isEdit ? task.deadline : Date.now() + 24 * 60 * 60 * 1000);

  bodyEl.innerHTML = `
    <div class="modal-header">
      <button class="back-btn" id="backBtn">&larr; Back</button>
      <span class="modal-title">${isEdit ? "Edit Task" : "New Task"}</span>
    </div>
    <div class="modal-body">
      <div class="field-group">
        <label class="field-label">Task name</label>
        <input type="text" class="text-input" id="taskTitle" value="${escapeHtml(title)}" placeholder="e.g. Send offer letter to client" />
      </div>
      <div class="field-group">
        <label class="field-label">Deadline</label>
        <input type="datetime-local" class="text-input" id="taskDeadline" value="${deadlineValue}" />
      </div>
      <div class="tier-toggle-row" id="tierToggleRow">
        ${TIER_ORDER.map((tier) => `<div class="tier-toggle ${tier} ${tier === activeTier ? "active" : ""}" data-tier="${tier}">
          <span class="tier-dot ${tier}"></span>${TIER_META[tier].short}
        </div>`).join("")}
      </div>
      <div class="field-group">
        <label class="field-label">Notes (optional)</label>
        <textarea class="textarea-input" id="taskNotes" placeholder="Add details...">${escapeHtml(notes)}</textarea>
      </div>
      <div class="form-actions">
        <button class="btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn-save" id="saveBtn">Save Task</button>
      </div>
      ${isEdit ? `<hr class="divider" /><button class="btn-delete" id="deleteBtn">Delete Task</button>` : ""}
    </div>
  `;

  let selectedTier = activeTier;
  document.querySelectorAll("#tierToggleRow .tier-toggle").forEach((el) => {
    el.addEventListener("click", () => {
      selectedTier = el.dataset.tier;
      document.querySelectorAll("#tierToggleRow .tier-toggle").forEach((e2) => e2.classList.remove("active"));
      el.classList.add("active");
    });
  });

  document.getElementById("backBtn").addEventListener("click", renderMain);
  document.getElementById("cancelBtn").addEventListener("click", renderMain);
  document.getElementById("saveBtn").addEventListener("click", () => saveTaskForm(selectedTier));
  if (isEdit) {
    document.getElementById("deleteBtn").addEventListener("click", async () => {
      await self.TierStorage.deleteTask(task.id);
      renderMain();
    });
  }
}

async function saveTaskForm(selectedTier) {
  const title = document.getElementById("taskTitle").value.trim();
  const notes = document.getElementById("taskNotes").value.trim();
  const deadlineInput = document.getElementById("taskDeadline").value;
  if (!title) return;

  const task = state.editingTask;
  const now = Date.now();
  const parsedDeadline = deadlineInput ? new Date(deadlineInput).getTime() : NaN;
  const newTask = {
    id: task ? task.id : uuid(),
    title,
    deadline: !isNaN(parsedDeadline) ? parsedDeadline : (task ? task.deadline : now + 24 * 60 * 60 * 1000),
    source: task ? task.source : "manual",
    tier: selectedTier,
    tierOverride: true,
    notes,
    completed: task ? task.completed : false,
    createdAt: task ? task.createdAt : now,
  };

  if (newTask.source === "calendar") {
    await self.TierStorage.setOverride(newTask.id, selectedTier);
  }

  await self.TierStorage.saveTask(newTask);
  renderMain();
}

async function renderSettings() {
  state.view = "settings";
  const [authState, settings] = await Promise.all([
    self.TierStorage.getAuthState(),
    self.TierStorage.getSettings(),
  ]);

  bodyEl.innerHTML = `
    <div class="modal-header">
      <button class="back-btn" id="backBtn">&larr; Back</button>
      <span class="modal-title">Settings</span>
    </div>
    <div class="modal-body">
      <div class="settings-section">
        <div class="settings-heading">Calendar</div>
        ${authState.connected
          ? `<div class="settings-row">
               <span class="settings-row-label">Connected as: ${escapeHtml(authState.email || "—")}</span>
             </div>
             <button class="btn-disconnect" id="disconnectBtn">Disconnect</button>`
          : `<div class="settings-row"><span class="settings-row-sub">Not connected</span></div>
             <button class="btn-primary" id="connectBtn">Connect Google Calendar</button>`}
      </div>
      <div class="settings-section">
        <div class="settings-heading">Gmail</div>
        <div class="settings-row">
          <span class="settings-row-label">Scan inbox for tasks</span>
          <div class="toggle ${settings.gmailScanEnabled ? "on" : ""}" data-key="gmailScanEnabled"><div class="thumb"></div></div>
        </div>
        <div class="settings-row-sub">Reads recent emails to suggest new tasks or completions — always asks before acting.</div>
      </div>
      <div class="settings-section">
        <div class="settings-heading">Notifications</div>
        <div class="settings-row">
          <span class="settings-row-label">Urgent task alerts</span>
          <div class="toggle ${settings.urgentAlerts ? "on" : ""}" data-key="urgentAlerts"><div class="thumb"></div></div>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-heading">Display</div>
        <div class="settings-row">
          <span class="settings-row-label">Show completed tasks</span>
          <div class="toggle ${settings.showCompleted ? "on" : ""}" data-key="showCompleted"><div class="thumb"></div></div>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">Show source badges</span>
          <div class="toggle ${settings.showSourceBadges ? "on" : ""}" data-key="showSourceBadges"><div class="thumb"></div></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("backBtn").addEventListener("click", () => init());
  document.querySelectorAll(".toggle").forEach((el) => {
    el.addEventListener("click", async () => {
      const key = el.dataset.key;
      const next = !el.classList.contains("on");
      await self.TierStorage.setSettings({ [key]: next });
      el.classList.toggle("on", next);
    });
  });

  const connectBtn = document.getElementById("connectBtn");
  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      await connectCalendar();
      renderSettings();
    });
  }

  const disconnectBtn = document.getElementById("disconnectBtn");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", async () => {
      await self.TierAuth.disconnect();
      init();
    });
  }
}

addBtn.addEventListener("click", openAddForm);
syncBtn.addEventListener("click", runSync);
settingsBtn.addEventListener("click", renderSettings);
calendarBtn.addEventListener("click", connectCalendar);

init();
