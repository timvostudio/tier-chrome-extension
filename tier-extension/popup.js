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
  currentPropId: null,
};

// ── Escrow stage template (follows Buyer's Agent Task Sheet) ─────────────────
const ESCROW_STAGES = [
  { name: "Get Pre-Approved",                  hint: "",                                        tasks: [] },
  { name: "Sign Buyer Rep Agreement",          hint: "",                                        tasks: [] },
  { name: "Showings",                          hint: "",                                        tasks: [] },
  { name: "Pre-Offer Due Diligence",           hint: "Before writing offer",                   tasks: ["Call listing agent — offer deadline?","Confirm seller motivation","Disclosures available?","Multiple offers?"] },
  { name: "Prepare Offer Package",             hint: "",                                        tasks: ["Complete Buyer Intake Form"] },
  { name: "Submit Offer",                      hint: "",                                        tasks: ["Buyer contact info","Lender info","CMA in PDF","POF"] },
  { name: "Offer Accepted",                    hint: "",                                        tasks: [] },
  { name: "Open Escrow",                       hint: "",                                        tasks: ["Receive opening package from escrow","Receive wire instructions"] },
  { name: "Earnest Money Deposit (EMD)",       hint: "Buyer wires within 3 business days",     tasks: ["Buyer wires funds to escrow","Confirm receipt with escrow"] },
  { name: "Inspections & Due Diligence",       hint: "",                                        tasks: ["Schedule General Home Inspection","Coordinate access with listing agent","Attend inspection","Sewer scope (recommended in SoCal)","Termite inspection","Roof inspection","Foundation / structural engineer","Mold / HVAC / chimney"] },
  { name: "Send to TC",                        hint: "",                                        tasks: ["CMA in PDF","POF","General Inspection Report / BIW","Termite Inspection Report / BIW","VP (once available)"] },
  { name: "Review Disclosure Package",         hint: "Ensure buyer signs all documents",        tasks: ["TDS — Transfer Disclosure Statement","SPQ — Seller Property Questionnaire","NHD — Natural Hazard Disclosure","Preliminary Title Report","HOA docs (if applicable)"] },
  { name: "Analyze Findings & Advise Buyer",  hint: "",                                        tasks: [] },
  { name: "Negotiations — Request for Repairs",hint: "",                                        tasks: ["Back and forth with listing agent","Finalize repair agreement"] },
  { name: "Loan & Appraisal",                 hint: "",                                        tasks: ["Buyer submits full docs to lender","Lender orders appraisal","Verify appraisal meets purchase price","Order Home Warranty","Loan: conditional approval","Loan: final approval","Loan: clear to close"] },
  { name: "Contingency Removal",              hint: "Once removed — EMD is at risk",           tasks: ["Remove inspection contingency (CR Form)","Remove loan contingency (CR Form)","Remove appraisal contingency (CR Form)"] },
  { name: "Final Walkthrough",                hint: "3–5 days before closing",                 tasks: ["Property condition unchanged","Repairs completed"] },
  { name: "Closing Disclosure",               hint: "Must be signed 3 days before closing",    tasks: ["Buyer reviews final numbers","Buyer signs Closing Disclosure","Wait 3 days — then loan docs come"] },
  { name: "Wire Remaining Funds",             hint: "",                                        tasks: ["Wire down payment + closing costs","Confirm with escrow"] },
  { name: "Sign Loan Docs",                   hint: "Usually 1–3 days before closing",         tasks: [] },
  { name: "Close of Escrow",                  hint: "",                                        tasks: ["Loan funds","Title records","Keys released 🎉"] },
  { name: "Miscellaneous",                    hint: "Any additional tasks that come up",        tasks: [] },
];

function slugToAddress(slug) {
  return slug.split("-").map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
}

function parsePropertyUrl(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    if (u.hostname.includes("zillow.com")) {
      const m = u.pathname.match(/\/homedetails\/([^/]+)/);
      if (m) return slugToAddress(m[1].replace(/-\d{5,}(_zpid)?$/, (z) => ", " + z.replace(/[^0-9]/g, "").slice(0, 5)));
    }
    if (u.hostname.includes("redfin.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 3) return `${slugToAddress(parts[2])}, ${parts[1].replace(/-/g, " ")}, ${parts[0].toUpperCase()}`;
    }
  } catch (_) { /* fall through */ }
  return null;
}

function createNewProperty(rawInput) {
  const isUrl = /^https?:\/\/|zillow\.com|redfin\.com/.test(rawInput);
  const url = isUrl ? rawInput : "";
  const address = isUrl ? (parsePropertyUrl(rawInput) || rawInput) : (rawInput.charAt(0).toUpperCase() + rawInput.slice(1));
  const source = rawInput.includes("zillow") ? "Zillow" : rawInput.includes("redfin") ? "Redfin" : "";

  return {
    id: "prop-" + Date.now() + "-" + Math.random().toString(16).slice(2, 6),
    address,
    url,
    source,
    addedAt: Date.now(),
    stages: ESCROW_STAGES.map((s, si) => ({
      si,
      name: s.name,
      hint: s.hint,
      expanded: si === 0,
      completed: false,
      tasks: s.tasks.map((text, ti) => ({ id: `${si}-${ti}`, text, completed: false })),
    })),
  };
}

function isStageComplete(stage) {
  if (stage.completed) return true;
  if (stage.tasks.length > 0) return stage.tasks.every((t) => t.completed);
  return false;
}

function propProgress(prop) {
  const done = prop.stages.filter(isStageComplete).length;
  return { done, total: prop.stages.length, pct: Math.round((done / prop.stages.length) * 100) };
}

function currentStageName(prop) {
  const first = prop.stages.find((s) => !isStageComplete(s));
  return first ? first.name : "Complete ✓";
}

function uuid() {
  return "task-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function scheduleNextReminder(freq, fromTs = Date.now()) {
  const DAY = 24 * 60 * 60 * 1000;
  if (freq === "daily")  return fromTs + DAY;
  if (freq === "2days")  return fromTs + 2 * DAY;
  if (freq === "weekly") return fromTs + 7 * DAY;
  return null;
}

const FREQ_LABEL = { daily: "Daily", "2days": "Every 2d", weekly: "Weekly" };

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

async function getUserProfile() {
  const authState = await self.TierStorage.getAuthState();
  if (authState.family_name) return authState;

  // Fetch from Google and cache — interactive:true is silent for connected users
  try {
    const token   = await self.TierAuth.getAuthToken(true);
    const profile = await self.TierAuth.fetchUserProfile(token);
    const next    = { ...authState, ...profile };
    await self.TierStorage.setAuthState(next);
    return next;
  } catch {
    return authState;
  }
}

async function greetingHtml() {
  const [profile, settings] = await Promise.all([
    getUserProfile(),
    self.TierStorage.getSettings(),
  ]);

  const title    = settings.nameTitle || "Mr.";
  const lastName = profile.family_name || "";
  const nameStr  = lastName ? `, ${title} ${lastName}` : "";
  return `<div class="greeting">${getGreeting()}${nameStr}!</div>`;
}

function timeOfDayIllustration() {
  const h = new Date().getHours();

  if (h >= 5 && h < 12) {
    // Morning: half-sun rising above horizon
    return `<svg class="time-art-svg" width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="8" y1="42" x2="56" y2="42" stroke="#e8e2d9" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M20 42 A12 12 0 0 1 44 42" fill="#FEF3C7" stroke="#F59E0B" stroke-width="1.5" stroke-linejoin="round"/>
      <line x1="32" y1="16" x2="32" y2="22" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="13" y1="30" x2="19" y2="30" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="45" y1="30" x2="51" y2="30" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="17" y1="19" x2="21" y2="23" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="43" y1="23" x2="47" y2="19" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  } else if (h >= 12 && h < 18) {
    // Afternoon: full sun high with rays
    return `<svg class="time-art-svg" width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="10" fill="#FEF3C7" stroke="#F59E0B" stroke-width="1.5"/>
      <line x1="32" y1="8"  x2="32" y2="14" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="32" y1="50" x2="32" y2="56" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="8"  y1="32" x2="14" y2="32" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="50" y1="32" x2="56" y2="32" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="14" y1="14" x2="18" y2="18" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="46" y1="46" x2="50" y2="50" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="50" y1="14" x2="46" y2="18" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="14" y1="50" x2="18" y2="46" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  } else if (h >= 18 && h < 21) {
    // Evening: sun setting below horizon with warm glow
    return `<svg class="time-art-svg" width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="8"  y1="40" x2="56" y2="40" stroke="#e8e2d9" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="12" y1="46" x2="52" y2="46" stroke="#f5d0a0" stroke-width="1"   stroke-linecap="round" opacity="0.6"/>
      <path d="M20 40 A12 12 0 0 1 44 40" fill="#FDDCB5" stroke="#F97316" stroke-width="1.5" stroke-linejoin="round"/>
      <line x1="32" y1="14" x2="32" y2="20" stroke="#F97316" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="11" y1="28" x2="17" y2="28" stroke="#F97316" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="47" y1="28" x2="53" y2="28" stroke="#F97316" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="16" y1="17" x2="20" y2="21" stroke="#F97316" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="44" y1="21" x2="48" y2="17" stroke="#F97316" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  } else {
    // Night: crescent moon + stars
    return `<svg class="time-art-svg" width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M38 14C30 14 23 21 23 30C23 39 30 46 38 46C28 46 16 38 16 30C16 22 28 14 38 14Z" fill="#E8E8F0" stroke="#9B9BC4" stroke-width="1.2" stroke-linejoin="round"/>
      <circle cx="48" cy="18" r="1.8" fill="#C4C4D8"/>
      <circle cx="44" cy="30" r="1.2" fill="#C4C4D8"/>
      <circle cx="52" cy="34" r="1.4" fill="#C4C4D8"/>
      <circle cx="46" cy="42" r="1"   fill="#C4C4D8"/>
    </svg>`;
  }
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

async function getVoices() {
  return new Promise(resolve => {
    const v = speechSynthesis.getVoices();
    if (v.length) { resolve(v); return; }
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices());
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1000);
  });
}

async function speakWelcome() {
  if (!window.speechSynthesis) return;
  try {
    const [profile, settings] = await Promise.all([
      self.TierStorage.getAuthState(),
      self.TierStorage.getSettings(),
    ]);
    const title    = settings.nameTitle || "Mr.";
    const lastName = profile.family_name || "";
    const nameStr  = lastName ? `, ${title} ${lastName}` : "";
    const text = `${getGreeting()}${nameStr}. Please let me know if I can assist you with any tasks today.`;

    const voices = await getVoices();

    // Prefer female British voices in order of elegance
    const femaleNames = ["Serena", "Kate", "Hazel", "Google UK English Female", "Veena"];
    let voice = voices.find(v => femaleNames.some(n => v.name.includes(n)) && v.lang.startsWith("en-GB"));
    if (!voice) voice = voices.find(v => v.name.includes("Google UK English Female"));
    if (!voice) voice = voices.find(v => v.name.includes("Serena"));
    if (!voice) voice = voices.find(v => v.name.includes("Kate") && v.lang.startsWith("en-GB"));
    if (!voice) voice = voices.find(v => v.name.includes("Hazel"));
    if (!voice) voice = voices.find(v => v.lang === "en-GB");
    if (!voice) voice = voices.find(v => v.lang.startsWith("en-GB"));
    if (!voice) voice = voices.find(v => v.lang.startsWith("en"));

    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate   = 0.82;
    u.pitch  = 1.15;
    u.volume = 1.0;

    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* silent fail */ }
}

async function init() {
  const authState = await self.TierStorage.getAuthState();
  const tasks = await self.TierStorage.getTasks();
  if (!authState.connected && tasks.length === 0) {
    renderConnectScreen();
    return;
  }
  await renderMain();
  await runSync();
}

async function renderMain() {
  state.view = "main";
  const [tasks, lastSync, settings, suggestions, properties] = await Promise.all([
    self.TierStorage.getTasks(),
    self.TierStorage.getLastSync(),
    self.TierStorage.getSettings(),
    self.TierStorage.getSuggestions(),
    self.TierStorage.getProperties(),
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

  for (const tier of TIER_ORDER) {
    const meta = TIER_META[tier];
    const tierTasks = visibleTasks.filter((t) => t.tier === tier);
    html += `<div class="section">
      <div class="section-label"><span class="dot ${tier}"></span>${meta.label.toUpperCase()}</div>
      ${tierTasks.length === 0 ? `<div class="empty-state">No tasks</div>` : tierTasks.map((t) => taskCardHtml(t, settings)).join("")}
    </div>`;
  }

  html += buildPropertiesSectionHtml(properties);
  bodyEl.innerHTML = html;
  wireTaskCards();
  wirePropertySection();
  const reviewBtn = document.getElementById("reviewSuggestionsBtn");
  if (reviewBtn) {
    reviewBtn.addEventListener("click", renderSuggestions);
  }

  // Silently scan all properties in the background and update badges live
  autoScanAllProperties(properties);
}

async function autoScanAllProperties(properties) {
  if (!properties || properties.length === 0) return;
  let token;
  try {
    token = await self.TierAuth.getAuthToken(false); // non-interactive — don't interrupt the user
  } catch { return; }
  if (!token) return;

  for (const prop of properties) {
    if (state.view !== "main") return; // user navigated away, stop
    try {
      const newEmails = await scanPropertyEmails(prop);
      if (newEmails.length > 0) {
        if (!prop.emails) prop.emails = [];
        prop.emails.unshift(...newEmails);
        await self.TierStorage.saveProperty(prop);
      }
      // Update just the badge in-place without re-rendering everything
      const btn = document.querySelector(`.prop-email-btn[data-prop-id="${prop.id}"]`);
      if (!btn) continue;
      const count = (prop.emails || []).length;
      let badge = btn.querySelector(".prop-email-badge");
      if (count > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "prop-email-badge";
          btn.appendChild(badge);
        }
        badge.textContent = count;
      } else if (badge) {
        badge.remove();
      }
    } catch { /* skip this property on error */ }
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
  let actionLabel;
  let propTag = "";
  if (s.type === "property_inquiry") {
    actionLabel = `<span class="inq-label">&#127968; Property inquiry</span> <strong>${escapeHtml(s.title)}</strong>`;
    propTag = s.propAddress
      ? `<div class="suggestion-prop-tag">Linked to: ${escapeHtml(s.propAddress)}</div>`
      : `<div class="suggestion-prop-tag suggestion-prop-unmatched">No matching property — will add as general task</div>`;
  } else if (s.type === "create") {
    actionLabel = `New task: <strong>${escapeHtml(s.title)}</strong>`;
  } else {
    actionLabel = `Mark complete: <strong>${escapeHtml(s.title)}</strong>`;
  }
  return `<div class="suggestion-card${s.type === "property_inquiry" ? " suggestion-inquiry" : ""}" id="card-${s.id}">
    <div class="suggestion-action">${actionLabel}</div>
    ${propTag}
    <div class="suggestion-source">From: ${escapeHtml(s.from || "Unknown sender")}</div>
    <div class="suggestion-snippet">"${escapeHtml(s.snippet || "")}"</div>
    <div class="suggestion-actions">
      <button class="btn-ghost" id="dismiss-${s.id}">Dismiss</button>
      <button class="btn-save" id="confirm-${s.id}">${s.type === "property_inquiry" ? "Add to Property" : "Confirm"}</button>
    </div>
  </div>`;
}

async function applySuggestion(s) {
  if (s.type === "property_inquiry") {
    const taskText = `${s.title}${s.from ? ` (${s.from.replace(/<[^>]+>/, "").trim()})` : ""}`;
    if (s.propId) {
      // Add task to the property's first uncompleted stage that makes sense (Showings = index 2)
      const props = await self.TierStorage.getProperties();
      const prop = props.find((p) => p.id === s.propId);
      if (prop) {
        const showingsStage = prop.stages[2]; // "Showings" stage
        const targetStage = showingsStage || prop.stages.find((st) => !st.completed) || prop.stages[0];
        if (targetStage) {
          const ti = targetStage.tasks.length;
          targetStage.tasks.push({ id: `inq-${Date.now()}`, text: taskText, completed: false });
          await self.TierStorage.saveProperty(prop);
        }
      }
    } else {
      // No property match — add as a general Priority 2 task
      await self.TierStorage.saveTask({
        id: uuid(),
        title: taskText,
        deadline: Date.now() + 24 * 60 * 60 * 1000,
        source: "gmail",
        tier: "yellow",
        tierOverride: false,
        notes: `Property inquiry from email: "${s.sourceSubject}"`,
        completed: false,
        createdAt: Date.now(),
      });
    }
  } else if (s.type === "create") {
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
      ${task.reminder ? `<span class="reminder-badge">${task.reminder.label}</span>` : ""}
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
  if (task.completed) showTaskCompletedPopup(id, task.title);
}

function showTaskCompletedPopup(id, title) {
  document.getElementById("taskCompletedPopup")?.remove();

  const popup = document.createElement("div");
  popup.id = "taskCompletedPopup";
  popup.className = "tcp-wrap";
  popup.innerHTML = `
    <div class="tcp-box">
      <div class="tcp-check">✓</div>
      <div class="tcp-title">Task completed</div>
      <div class="tcp-sub">${escapeHtml(title)}</div>
      <div class="tcp-actions">
        <button class="tcp-btn-keep" id="tcpKeep">Keep it</button>
        <button class="tcp-btn-delete" id="tcpDelete">Delete</button>
      </div>
    </div>
  `;

  document.getElementById("panel").appendChild(popup);

  let autoDismiss = setTimeout(dismiss, 4000);

  function dismiss() {
    clearTimeout(autoDismiss);
    popup.classList.add("tcp-out");
    popup.addEventListener("animationend", () => popup.remove(), { once: true });
  }

  popup.querySelector("#tcpKeep").addEventListener("click", dismiss);
  popup.querySelector("#tcpDelete").addEventListener("click", async () => {
    dismiss();
    const all = await self.TierStorage.getTasks();
    await self.TierStorage.saveTasks(all.filter((t) => t.id !== id));
    renderMain();
  });
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
  const properties = await self.TierStorage.getProperties();
  let html = ``;
  html += `<div class="connect-refresh-msg">Refresh page to show all tasks for the day</div>`;
  html += buildPropertiesSectionHtml(properties);
  bodyEl.innerHTML = html;
  wirePropertySection();
  autoScanAllProperties(properties);
}

async function connectCalendar() {
  try {
    const token = await self.TierAuth.getAuthToken(true);
    const profile = await self.TierAuth.fetchUserProfile(token);
    await self.TierStorage.setAuthState({ connected: true, ...profile });
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
    await Promise.all([
      self.TierCalendar.syncCalendar(),
      getUserProfile(),  // refresh and cache name on every sync
    ]);
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
  const isEdit      = !!task;
  const title       = isEdit ? task.title       : "";
  const notes       = isEdit ? task.notes || "" : "";
  const activeTier  = isEdit ? task.tier        : "yellow";
  const deadlineValue = toDatetimeLocalValue(isEdit ? task.deadline : Date.now() + 24 * 60 * 60 * 1000);

  // Existing reminder state
  const existingReminder = isEdit && task.reminder ? task.reminder : null;
  const reminderOn       = !!existingReminder;
  const savedInterval    = existingReminder?.intervalMins || 60;
  const savedUnit        = existingReminder?.unit         || "hours";
  const savedCustomVal   = existingReminder?.customVal    || 1;
  const savedTime        = existingReminder?.time         || "09:00";

  // Preset intervals (in minutes)
  const PRESETS = [
    { label: "30 min",  mins: 30    },
    { label: "1 hour",  mins: 60    },
    { label: "2 hours", mins: 120   },
    { label: "4 hours", mins: 240   },
    { label: "Daily",   mins: 1440  },
    { label: "Weekly",  mins: 10080 },
    { label: "Custom",  mins: null  },
  ];

  const activePreset = existingReminder
    ? (PRESETS.find(p => p.mins === savedInterval)?.label || "Custom")
    : "1 hour";

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
        ${TIER_ORDER.map(tier => `<div class="tier-toggle ${tier} ${tier === activeTier ? "active" : ""}" data-tier="${tier}">
          <span class="tier-dot ${tier}"></span>${TIER_META[tier].short}
        </div>`).join("")}
      </div>
      <div class="field-group">
        <label class="field-label">Notes (optional)</label>
        <textarea class="textarea-input" id="taskNotes" placeholder="Add details...">${escapeHtml(notes)}</textarea>
      </div>

      <div class="reminder-section">
        <div class="reminder-header-row">
          <span class="reminder-label">Reminders</span>
          <label class="reminder-toggle-wrap">
            <input type="checkbox" id="reminderToggle" ${reminderOn ? "checked" : ""} />
            <span class="reminder-toggle-track"><span class="reminder-toggle-thumb"></span></span>
          </label>
        </div>
        <div class="reminder-body" id="reminderBody" style="display:${reminderOn ? "block" : "none"}">
          <div class="reminder-preset-row" id="reminderPresets">
            ${PRESETS.map(p => `<button class="rp-btn${p.label === activePreset && reminderOn ? " rp-active" : ""}" data-mins="${p.mins ?? ""}" data-label="${p.label}">${p.label}</button>`).join("")}
          </div>
          <div class="reminder-custom-row" id="reminderCustomRow" style="display:${activePreset === "Custom" && reminderOn ? "flex" : "none"}">
            <span class="reminder-custom-label">Every</span>
            <input type="number" class="reminder-custom-num" id="customVal" value="${savedCustomVal}" min="1" max="999" />
            <select class="reminder-custom-unit" id="customUnit">
              <option value="minutes" ${savedUnit === "minutes" ? "selected" : ""}>minutes</option>
              <option value="hours"   ${savedUnit === "hours"   ? "selected" : ""}>hours</option>
              <option value="days"    ${savedUnit === "days"    ? "selected" : ""}>days</option>
            </select>
          </div>
          <div class="reminder-time-row" id="reminderTimeRow" style="display:${(savedInterval >= 1440) && reminderOn ? "flex" : "none"}">
            <span class="reminder-custom-label">At</span>
            <input type="time" class="reminder-time-input" id="reminderTime" value="${savedTime}" />
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn-save" id="saveBtn">Save Task</button>
      </div>
      ${isEdit ? `<hr class="divider" /><button class="btn-delete" id="deleteBtn">Delete Task</button>` : ""}
    </div>
  `;

  let selectedTier   = activeTier;
  let selectedPreset = activePreset;

  document.querySelectorAll("#tierToggleRow .tier-toggle").forEach(el => {
    el.addEventListener("click", () => {
      selectedTier = el.dataset.tier;
      document.querySelectorAll("#tierToggleRow .tier-toggle").forEach(e2 => e2.classList.remove("active"));
      el.classList.add("active");
    });
  });

  // Reminder toggle
  const reminderToggle = document.getElementById("reminderToggle");
  const reminderBody   = document.getElementById("reminderBody");
  reminderToggle.addEventListener("change", () => {
    reminderBody.style.display = reminderToggle.checked ? "block" : "none";
  });

  // Preset pills
  document.querySelectorAll("#reminderPresets .rp-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedPreset = btn.dataset.label;
      document.querySelectorAll("#reminderPresets .rp-btn").forEach(b => b.classList.remove("rp-active"));
      btn.classList.add("rp-active");
      const isCustom   = selectedPreset === "Custom";
      const isLongFreq = !isCustom && Number(btn.dataset.mins) >= 1440;
      document.getElementById("reminderCustomRow").style.display = isCustom   ? "flex" : "none";
      document.getElementById("reminderTimeRow").style.display   = isLongFreq ? "flex" : "none";
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

  // Build reminder object
  const reminderOn = document.getElementById("reminderToggle")?.checked;
  let reminder = null;
  if (reminderOn) {
    const activeBtn  = document.querySelector("#reminderPresets .rp-active");
    const label      = activeBtn?.dataset.label || "1 hour";
    const presetMins = activeBtn?.dataset.mins ? Number(activeBtn.dataset.mins) : null;
    let intervalMins = presetMins;

    if (label === "Custom" || !presetMins) {
      const val  = parseInt(document.getElementById("customVal")?.value || "1");
      const unit = document.getElementById("customUnit")?.value || "hours";
      intervalMins = unit === "minutes" ? val : unit === "hours" ? val * 60 : val * 1440;
    }

    const time = document.getElementById("reminderTime")?.value || "09:00";
    reminder = {
      intervalMins,
      label,
      unit:      label === "Custom" ? (document.getElementById("customUnit")?.value || "hours") : null,
      customVal: label === "Custom" ? parseInt(document.getElementById("customVal")?.value || "1") : null,
      time,
      nextAt: Date.now() + intervalMins * 60 * 1000,
    };
  }

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
    reminder,
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
        <div class="settings-row">
          <span class="settings-row-label">Greeting title</span>
          <select class="settings-select" id="nameTitleSelect">
            <option value="Mr."  ${(settings.nameTitle || "Mr.") === "Mr."  ? "selected" : ""}>Mr.</option>
            <option value="Mrs." ${(settings.nameTitle || "Mr.") === "Mrs." ? "selected" : ""}>Mrs.</option>
            <option value="Ms."  ${(settings.nameTitle || "Mr.") === "Ms."  ? "selected" : ""}>Ms.</option>
            <option value="Dr."  ${(settings.nameTitle || "Mr.") === "Dr."  ? "selected" : ""}>Dr.</option>
          </select>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-heading">Google Maps</div>
        <div class="settings-row-sub">Paste your Maps API key to auto-load street view photos for every property.</div>
        <div class="settings-api-row">
          <input type="text" id="mapsKeyInput" class="settings-text-input" placeholder="AIza…" value="${escapeHtml(settings.mapsApiKey || "")}" />
          <button class="btn-save" id="saveMapsKeyBtn">Save</button>
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

  const saveMapsKeyBtn = document.getElementById("saveMapsKeyBtn");
  if (saveMapsKeyBtn) {
    saveMapsKeyBtn.addEventListener("click", async () => {
      const key = document.getElementById("mapsKeyInput").value.trim();
      await self.TierStorage.setSettings({ mapsApiKey: key });
      if (key) {
        // Backfill existing properties that have no photo
        const props = await self.TierStorage.getProperties();
        for (const p of props) {
          if (!p.photoUrl && p.address) {
            p.photoUrl = streetViewUrl(p.address, key);
            await self.TierStorage.saveProperty(p);
          }
        }
      }
      saveMapsKeyBtn.textContent = "Saved ✓";
      setTimeout(() => { saveMapsKeyBtn.textContent = "Save"; }, 1500);
    });
  }

  const nameTitleSelect = document.getElementById("nameTitleSelect");
  if (nameTitleSelect) {
    nameTitleSelect.addEventListener("change", async () => {
      await self.TierStorage.setSettings({ nameTitle: nameTitleSelect.value });
    });
  }

}

addBtn.addEventListener("click", openAddForm);
syncBtn.addEventListener("click", runSync);
settingsBtn.addEventListener("click", renderSettings);
calendarBtn.addEventListener("click", connectCalendar);

// ── Properties section ────────────────────────────────────────────────────────

function buildPropertiesSectionHtml(properties) {
  const cards = properties.length === 0
    ? `<div class="prop-empty-state">No properties yet — click + to add one.</div>`
    : properties.map(propertyCardHtml).join("");

  return `
    <hr class="section-divider" />
    <div class="section properties-section">
      <div class="prop-section-header">
        <div class="section-label" style="color:var(--text-primary)"><span class="dot" style="background:var(--text-primary)"></span>PROPERTIES</div>
        <button class="prop-add-btn" id="propAddBtn" title="Add property">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1V10M1 5.5H10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="prop-input-row" id="propInputRow">
        <input type="text" class="text-input prop-url-input" id="propUrlInput"
               placeholder="Paste Zillow / Redfin link or type address…" />
      </div>
      ${cards}
    </div>
  `;
}

function propPhotoWrapHtml(p) {
  const placeholderLabel = "Add a Maps API key in Settings to auto-load photos";
  let inner;
  if (p.photoUrl) {
    inner = `
      <img class="prop-photo" src="${escapeHtml(p.photoUrl)}" alt="${escapeHtml(p.address)}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
      <div class="prop-photo prop-photo-placeholder" id="pph-${p.id}" style="display:none">
        <svg width="36" height="32" viewBox="0 0 36 32" fill="none">
          <path d="M4 15L18 3L32 15V30H23V20H13V30H4V15Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
          <rect x="15" y="20" width="6" height="10" rx="1" stroke="currentColor" stroke-width="1.4"/>
        </svg>
        <span class="prop-photo-label">${placeholderLabel}</span>
      </div>`;
  } else {
    inner = `
      <div class="prop-photo prop-photo-placeholder" id="pph-${p.id}">
        <svg width="36" height="32" viewBox="0 0 36 32" fill="none">
          <path d="M4 15L18 3L32 15V30H23V20H13V30H4V15Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
          <rect x="15" y="20" width="6" height="10" rx="1" stroke="currentColor" stroke-width="1.4"/>
        </svg>
        <span class="prop-photo-label">${placeholderLabel}</span>
      </div>`;
  }
  return `
    <div class="prop-photo-wrap" id="ppw-${p.id}">
      ${inner}
      <div class="prop-photo-actions">
        <label class="prop-photo-action-btn prop-photo-upload-label" title="Upload photo from device">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1V9M3 5L7 1L11 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 11H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          Upload photo
          <input type="file" accept="image/*" class="prop-photo-file-input" data-prop-id="${p.id}" />
        </label>
        ${p.photoUrl ? `<button class="prop-photo-action-btn prop-photo-remove" data-prop-id="${p.id}" title="Remove photo">✕ Remove</button>` : ""}
      </div>
    </div>`;
}

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      const MAX_W = 720;
      const scale = Math.min(1, MAX_W / img.width);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(blobUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = blobUrl;
  });
}

function propertyCardHtml(p) {
  const prog = propProgress(p);
  const stage = currentStageName(p);
  return `
    <div class="prop-card" data-prop-id="${p.id}">
      ${propPhotoWrapHtml(p)}
      <div class="prop-card-body">
        <div class="prop-card-top">
          <div class="prop-card-info">
            <div class="prop-address">${escapeHtml(p.address)}</div>
            <div class="prop-stage-pill">${escapeHtml(stage)}</div>
          </div>
          <button class="prop-email-btn" data-prop-id="${p.id}" title="Email archive">
            <svg width="13" height="11" viewBox="0 0 13 11" fill="none"><rect x="0.75" y="0.75" width="11.5" height="9.5" rx="1.25" stroke="currentColor" stroke-width="1.3"/><path d="M1 2.5L6.5 6.5L12 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            ${(p.emails || []).length > 0 ? `<span class="prop-email-badge">${(p.emails || []).length}</span>` : ""}
          </button>
        </div>
        <div class="prop-progress-track"><div class="prop-progress-fill" style="width:${prog.pct}%"></div></div>
        <div class="prop-progress-meta">${prog.done} of ${prog.total} stages complete${p.source ? ` · ${escapeHtml(p.source)}` : ""}</div>
      </div>
    </div>
  `;
}

// Returns the cache key used by content.js for a given listing URL
function streetViewUrl(address, apiKey) {
  return `https://maps.googleapis.com/maps/api/streetview?size=600x300&location=${encodeURIComponent(address)}&source=outdoor&key=${apiKey}`;
}

async function autoStreetViewPhoto(prop) {
  if (prop.photoUrl) return false;
  const settings = await self.TierStorage.getSettings();
  if (!settings.mapsApiKey || !prop.address) return false;
  prop.photoUrl = streetViewUrl(prop.address, settings.mapsApiKey);
  await self.TierStorage.saveProperty(prop);
  return true;
}

function propPhotoCacheKey(url) {
  if (!url) return null;
  const zpid = url.match(/\/(\d{7,})_zpid/)?.[1];
  if (zpid) return `tier_prop_photo_zpid_${zpid}`;
  try {
    const path = new URL(url.startsWith("http") ? url : "https://" + url)
      .pathname.replace(/[^a-zA-Z0-9-_/]/g, "").slice(0, 120);
    return `tier_prop_photo_path_${path}`;
  } catch { return null; }
}

// Check chrome.storage for a photo cached by the content script
async function getCachedPhoto(url) {
  const key = propPhotoCacheKey(url);
  if (!key) return null;
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

// Inject into any currently-open tab matching the listing URL and grab the hero image live
async function getPhotoFromOpenTab(url) {
  if (!url) return null;
  try {
    const stripped = url.split("?")[0];
    const tabs = await chrome.tabs.query({ url: stripped + "*" });
    if (!tabs.length) return null;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => {
        const all = Array.from(document.querySelectorAll("img"));
        const cdn = all.filter(i => i.src && (
          i.src.includes("zillowstatic.com/fp/") ||
          i.src.includes("ssl-photos.redfin.com")
        ));
        if (!cdn.length) return null;
        cdn.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
        return cdn[0].src.replace(/[?&][wh]=\d+/g, "").replace(/\?$/, "");
      },
    });
    return results?.[0]?.result || null;
  } catch { return null; }
}

// Fetch a listing photo: try storage cache first, then live tab injection
async function fetchPropertyPhoto(url) {
  const cached = await getCachedPhoto(url);
  if (cached) return cached;
  return getPhotoFromOpenTab(url);
}

async function applyPhotoToCard(propId, photoUrl) {
  const props = await self.TierStorage.getProperties();
  const prop  = props.find((p) => p.id === propId);
  if (!prop) return;
  prop.photoUrl = photoUrl;
  await self.TierStorage.saveProperty(prop);

  const wrap = document.getElementById(`ppw-${propId}`);
  if (!wrap) return;
  const existing = wrap.querySelector(".prop-photo, .prop-photo-placeholder");
  if (existing) {
    const img = document.createElement("img");
    img.className = "prop-photo";
    img.src = photoUrl;
    img.alt = prop.address;
    existing.replaceWith(img);
  }
}

async function wirePropertySection() {
  // Backfill Street View photos for any properties that don't have one yet
  (async () => {
    const settings = await self.TierStorage.getSettings();
    if (!settings.mapsApiKey) return;
    const props = await self.TierStorage.getProperties();
    for (const p of props) {
      if (!p.photoUrl && p.address) {
        p.photoUrl = streetViewUrl(p.address, settings.mapsApiKey);
        await self.TierStorage.saveProperty(p);
        const wrap = document.getElementById(`ppw-${p.id}`);
        if (wrap) {
          const ph = wrap.querySelector(".prop-photo-placeholder");
          if (ph) {
            const img = document.createElement("img");
            img.className = "prop-photo";
            img.src = p.photoUrl;
            img.alt = p.address;
            img.onerror = () => { img.style.display = "none"; ph.style.display = "flex"; };
            ph.style.display = "none";
            wrap.insertBefore(img, ph);
          }
        }
      }
    }
  })();

  const addBtn = document.getElementById("propAddBtn");
  const row    = document.getElementById("propInputRow");
  const input  = document.getElementById("propUrlInput");
  if (!addBtn) return;

  addBtn.addEventListener("click", () => {
    const open = row.classList.toggle("prop-input-open");
    if (open) input.focus();
  });

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") { row.classList.remove("prop-input-open"); return; }
    if (e.key !== "Enter") return;
    const val = input.value.trim();
    if (!val) return;
    input.value = "";
    row.classList.remove("prop-input-open");
    const prop = createNewProperty(val);
    // Try Zillow/Redfin content-script cache or open tab first
    if (prop.url) {
      const photoUrl = await fetchPropertyPhoto(prop.url);
      if (photoUrl) {
        prop.photoUrl = photoUrl;
        const cacheKey = propPhotoCacheKey(prop.url);
        if (cacheKey) chrome.storage.local.set({ [cacheKey]: photoUrl });
      }
    }
    // Fall back to Google Street View using the address
    if (!prop.photoUrl) await autoStreetViewPhoto(prop);
    await self.TierStorage.saveProperty(prop);
    await renderMain();
  });

  // File upload — compress then store as base64 data URL
  document.querySelectorAll(".prop-photo-upload-label").forEach((label) => {
    label.addEventListener("click", (e) => e.stopPropagation());
  });

  document.querySelectorAll(".prop-photo-file-input").forEach((fileInput) => {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await compressImage(file);
        await applyPhotoToCard(fileInput.dataset.propId, dataUrl);
      } catch (err) {
        console.error("Photo upload failed:", err);
      }
    });
  });

  // Remove photo
  document.querySelectorAll(".prop-photo-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const props = await self.TierStorage.getProperties();
      const prop  = props.find((p) => p.id === btn.dataset.propId);
      if (!prop) return;
      delete prop.photoUrl;
      await self.TierStorage.saveProperty(prop);
      await renderMain();
    });
  });

  document.querySelectorAll(".prop-email-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      renderPropertyEmails(btn.dataset.propId);
    });
  });

  document.querySelectorAll(".prop-card").forEach((card) => {
    card.addEventListener("click", () => renderPropertyDetail(card.dataset.propId));
  });
}

// ── Escrow tracker detail view ────────────────────────────────────────────────

async function renderPropertyDetail(propId) {
  state.view = "property";
  state.currentPropId = propId;

  const props = await self.TierStorage.getProperties();
  const prop  = props.find((p) => p.id === propId);
  if (!prop) { await renderMain(); return; }

  const prog = propProgress(prop);

  const emailCount = (prop.emails || []).length;
  let html = `
    <div class="modal-header">
      <button class="back-btn" id="propBackBtn">&larr; Back</button>
      <span class="modal-title">Escrow Tracker</span>
      <button class="prop-detail-email-btn" id="propDetailEmailBtn" title="Email archive">
        <svg width="15" height="12" viewBox="0 0 15 12" fill="none"><rect x="0.75" y="0.75" width="13.5" height="10.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 3L7.5 7.5L14 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        ${emailCount > 0 ? `<span class="prop-detail-email-badge">${emailCount}</span>` : ""}
      </button>
    </div>
    ${prop.photoUrl ? `<div class="prop-detail-hero"><img class="prop-detail-hero-img" src="${escapeHtml(prop.photoUrl)}" alt="${escapeHtml(prop.address)}" /></div>` : ""}
    <div class="prop-detail-head">
      <div class="prop-detail-address">${escapeHtml(prop.address)}</div>
      ${prop.url ? `<a class="prop-detail-link" href="${escapeHtml(prop.url)}" target="_blank">View listing ↗</a>` : ""}
      <div class="prop-detail-progress-row">
        <div class="prop-detail-bar"><div class="prop-detail-fill" id="overallFill" style="width:${prog.pct}%"></div></div>
        <span class="prop-detail-pct" id="overallPct">${prog.done} / ${prog.total} stages</span>
      </div>
    </div>
  `;

  // ── Individuals Involved ──────────────────────────────────────────────────
  html += buildIndividualsSectionHtml(prop);
  html += `<hr class="section-divider" style="margin:4px 0 0"/>`;

  html += `<div class="stage-list">`;

  prop.stages.forEach((stage, si) => {
    const done  = isStageComplete(stage);
    const doneC = stage.tasks.filter((t) => t.completed).length;
    const numHtml = done
      ? `<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : (si + 1);

    const emailTasks = stage.tasks.filter(t => t.fromEmail);
    const hasNew     = emailTasks.some(t => t.isNew && !t.completed);
    const allDone    = emailTasks.length > 0 && emailTasks.every(t => t.completed);
    const notifDot   = hasNew  ? `<span class="stage-notif-dot stage-notif-new"  id="snd-${si}">!</span>`
                     : allDone ? `<span class="stage-notif-dot stage-notif-done" id="snd-${si}">✓</span>`
                     : "";

    html += `
      <div class="stage-card${done ? " stage-done" : ""}" id="sc-${si}">
        <div class="stage-header" data-si="${si}">
          <div class="stage-num${done ? " stage-num-done" : ""}" id="sn-${si}">${numHtml}</div>
          <div class="stage-info">
            <div class="stage-name-row">
              <div class="stage-name">${escapeHtml(stage.name)}</div>
              ${notifDot}
            </div>
            ${stage.hint ? `<div class="stage-hint">${escapeHtml(stage.hint)}</div>` : ""}
            ${stage.tasks.length > 0 ? `
              <div class="stage-task-count" id="stc-${si}">${doneC}/${stage.tasks.length} tasks</div>
              <div class="stage-mini-bar"><div class="stage-mini-fill" id="smf-${si}" style="width:${Math.round((doneC/stage.tasks.length)*100)}%"></div></div>
            ` : ""}
          </div>
          <div class="stage-chevron" id="schev-${si}">${stage.expanded ? "▴" : "▾"}</div>
        </div>
        <div class="stage-body" id="sb-${si}" style="display:${stage.expanded ? "block" : "none"}">
          <div class="stage-tasks-list" id="stl-${si}">
            ${stage.tasks.map((task, ti) => stageTaskHtml(si, ti, task)).join("")}
          </div>
          <div class="stage-add-row">
            <input type="text" class="stage-add-input" data-si="${si}" placeholder="Add a task…" />
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;

  html += `
    <div class="prop-delete-row">
      <button class="prop-delete-btn" id="propDeleteBtn">Remove this property</button>
    </div>`;

  bodyEl.innerHTML = html;
  bodyEl.scrollTop = 0;

  document.getElementById("propBackBtn").addEventListener("click", renderMain);
  document.getElementById("propDetailEmailBtn").addEventListener("click", () => renderPropertyEmails(propId));

  document.getElementById("propDeleteBtn").addEventListener("click", async () => {
    if (!confirm(`Remove "${prop.address}"?`)) return;
    await self.TierStorage.deleteProperty(prop.id);
    await renderMain();
  });

  // Stage headers — toggle expand / toggle complete (empty stages)
  bodyEl.querySelectorAll(".stage-header").forEach((header) => {
    header.addEventListener("click", async (e) => {
      const si = parseInt(header.dataset.si);
      const numEl = e.target.closest(".stage-num");

      if (numEl && prop.stages[si].tasks.length === 0) {
        prop.stages[si].completed = !prop.stages[si].completed;
        await self.TierStorage.saveProperty(prop);
        refreshStageNum(si, prop.stages[si]);
        updateOverallBar(prop);
        return;
      }

      prop.stages[si].expanded = !prop.stages[si].expanded;

      // Clear "new" flag on email tasks when stage is opened
      if (prop.stages[si].expanded) {
        prop.stages[si].tasks.forEach(t => { if (t.isNew) t.isNew = false; });
        refreshStageNotifDot(si, prop.stages[si]);
      }

      await self.TierStorage.saveProperty(prop);
      document.getElementById(`sb-${si}`).style.display = prop.stages[si].expanded ? "block" : "none";
      document.getElementById(`schev-${si}`).textContent = prop.stages[si].expanded ? "▴" : "▾";
    });
  });

  wireStageTaskEvents(prop);
  wireIndividualsSection(prop);

  // Add-task inputs
  bodyEl.querySelectorAll(".stage-add-input").forEach((input) => {
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const text = input.value.trim();
      if (!text) return;
      const si = parseInt(input.dataset.si);
      const ti = prop.stages[si].tasks.length;
      const newTask = { id: `${si}-${Date.now()}`, text, completed: false };
      prop.stages[si].tasks.push(newTask);
      await self.TierStorage.saveProperty(prop);

      const listEl = document.getElementById(`stl-${si}`);
      listEl.insertAdjacentHTML("beforeend", stageTaskHtml(si, ti, newTask));

      // wire new checkbox
      const newRow = listEl.lastElementChild;
      wireOneTaskRow(newRow, prop, si, ti);

      // update count badge
      refreshTaskCount(si, prop.stages[si]);
      input.value = "";
    });
  });
}

// ── Property Email Archive ────────────────────────────────────────────────────

function emailContainsAddress(subject, snippet, prop) {
  const text = `${subject} ${snippet}`.toLowerCase();
  const parts = (prop.address || "").split(/[\s,]+/).filter(Boolean);

  // House number must appear
  const houseNum = parts.find(w => /^\d+$/.test(w));
  if (!houseNum || !text.includes(houseNum)) return false;

  // At least one real street word (skip abbreviations and state codes) must appear
  const skip = /^(blvd|ave|dr|st|rd|ln|ct|ca|ny|tx|fl|wa|or|az|nv|hi|ak)$/i;
  const streetWords = parts.filter(w => w.length > 3 && !skip.test(w) && !/^\d+$/.test(w));
  if (!streetWords.length) return false;

  return streetWords.some(w => text.includes(w.toLowerCase()));
}

async function scanPropertyEmails(prop) {
  const token = await self.TierAuth.getAuthToken(true);

  // Build search terms: house number + first real street word (AND query, not OR)
  const parts = (prop.address || "").split(/[\s,]+/).filter(Boolean);
  const houseNum  = parts.find(w => /^\d+$/.test(w)) || "";
  const skip      = /^(blvd|ave|dr|st|rd|ln|ct|ca|ny|tx|fl|wa|or|az|nv|hi|ak)$/i;
  const streetWord = parts.find(w => w.length > 3 && !skip.test(w) && !/^\d+$/.test(w)) || "";
  if (!houseNum || !streetWord) return [];

  // Gmail AND query — both terms must appear in the message
  const q = encodeURIComponent(`"${houseNum}" "${streetWord}" newer_than:90d`);
  const listRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=40&q=${q}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) return [];
  const listData = await listRes.json();
  const ids = (listData.messages || []).map(m => m.id);
  const existingIds    = new Set((prop.emails || []).map(e => e.id));
  const existingThreads = new Map((prop.emails || []).map(e => [e.threadId || e.id, e]));

  // Update lastActivity on existing emails whose thread has new messages
  for (const id of ids) {
    if (!existingIds.has(id)) continue;
    const existing = [...(prop.emails || [])].find(e => e.id === id);
    if (existing) existing.lastActivity = Date.now();
  }

  const emails = [];
  for (const id of ids) {
    if (existingIds.has(id)) continue;
    const res = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) continue;
    const data = await res.json();
    const headers = data.payload?.headers || [];
    const get = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
    const subject = get("Subject") || "(no subject)";
    const snippet = data.snippet || "";

    // Hard gate: only archive if subject or snippet explicitly contains the address
    if (!emailContainsAddress(subject, snippet, prop)) continue;

    emails.push({
      id,
      threadId:  data.threadId || id,
      subject,
      from:      get("From"),
      to:        get("To"),
      cc:        get("Cc"),
      date:      get("Date"),
      snippet,
      stageIdx:  null,
      taskAdded: false,
      replied:   false,
      repliedAt: null,
      lastActivity: Date.now(),
    });
  }
  return emails;
}

function suggestStageForEmail(email, stages) {
  const text = `${email.subject} ${email.snippet}`.toLowerCase();
  let best = -1, bestScore = 0;
  stages.forEach((stage, i) => {
    const words = (stage.name + " " + (stage.hint || ""))
      .toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const hits = words.filter(w => text.includes(w)).length;
    const score = words.length > 0 ? hits / words.length : 0;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return bestScore >= 0.2 ? best : -1;
}

const EC_AVATAR_COLORS = ["#7c9bde","#e07b7b","#6dbf91","#d4956a","#9b7fd4","#5fb8c9","#d47a9a","#8fb86d"];

function emailCardHtml(email, idx, stages) {
  // Sender avatar
  const rawFrom    = email.from || "";
  const senderName = rawFrom.replace(/<[^>]+>/, "").trim().replace(/^["']|["']$/g, "") || "?";
  const senderAddr = (rawFrom.match(/<([^>]+)>/) || [])[1] || rawFrom;
  const initial    = (senderName[0] || "?").toUpperCase();
  let hash = 0;
  for (const c of senderName) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  const avatarBg = EC_AVATAR_COLORS[hash % EC_AVATAR_COLORS.length];

  const suggested  = (email.stageIdx !== null && email.stageIdx >= 0) ? email.stageIdx : suggestStageForEmail(email, stages);
  const stageName  = suggested >= 0 ? stages[suggested]?.name : null;
  const dateStr    = email.date
    ? new Date(email.date).toLocaleDateString([], { month: "short", day: "numeric" })
    : "";

  const stageOptions = stages.map((s, i) =>
    `<option value="${i}" ${i === suggested ? "selected" : ""}>${i + 1}. ${escapeHtml(s.name)}</option>`
  ).join("");

  const ageMs    = Date.now() - (email.lastActivity || new Date(email.date).getTime() || 0);
  const staleDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const isStale   = !email.replied && staleDays >= 5;

  const lightbulbSvg = `<svg width="10" height="10" viewBox="0 0 11 11" fill="none"><circle cx="5.5" cy="4.2" r="2.8" stroke="currentColor" stroke-width="1.1"/><path d="M3.8 7.2h3.4M4.4 8.8h2.2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>`;

  return `
    <div class="email-card${email.taskAdded ? " email-card-done" : ""}${email.replied ? " email-card-replied" : ""}" data-eidx="${idx}">

      <!-- Card header row -->
      <div class="ec-head">
        <div class="ec-avatar" style="background:${avatarBg}">${escapeHtml(initial)}</div>
        <div class="ec-meta">
          <div class="ec-subject">${escapeHtml(email.subject)}</div>
          <div class="ec-from">${escapeHtml(senderName)}<span class="ec-addr"> · ${escapeHtml(senderAddr)}</span></div>
        </div>
        <div class="ec-head-right">
          <span class="ec-date">${escapeHtml(dateStr)}</span>
          <button class="email-delete-btn" data-eidx="${idx}" title="Delete">✕</button>
        </div>
      </div>

      <!-- Snippet -->
      ${email.snippet ? `<div class="ec-snippet">${escapeHtml(email.snippet)}</div>` : ""}

      <!-- Stale warning -->
      ${isStale ? `
        <div class="ec-stale">
          <span class="ec-stale-icon">⏱</span>
          <span class="ec-stale-text">No reply in ${staleDays} days</span>
          <div class="ec-stale-btns">
            <button class="email-stale-yes" data-eidx="${idx}">Still active</button>
            <button class="email-stale-no"  data-eidx="${idx}">Close</button>
          </div>
        </div>
      ` : ""}

      <!-- Footer: reply + stage -->
      <div class="ec-footer">

        ${email.replied ? `
          <div class="ec-replied-row">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#30a46c" stroke-width="1.2"/><path d="M3.5 6l2 2 3-3" stroke="#30a46c" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>Replied${email.repliedAt ? " · " + new Date(email.repliedAt).toLocaleDateString([], { month:"short", day:"numeric" }) : ""}</span>
          </div>
        ` : `
          <div class="ec-reply-row">
            <button class="email-reply-btn" data-eidx="${idx}">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1.5 4.5L5 1.5V3.5C9.5 3.5 11 6.5 10.5 10C9 7.5 7 7 5 7V9L1.5 4.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>
              Reply in Gmail
            </button>
            <button class="email-ai-reply-btn" data-eidx="${idx}">
              ✦ AI Reply
            </button>
          </div>
        `}

        <div class="ec-divider"></div>

        ${email.taskAdded ? `
          <div class="ec-added-row">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#30a46c" stroke-width="1.2"/><path d="M3.5 6l2 2 3-3" stroke="#30a46c" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Added to Stage ${email.stageIdx + 1}: <strong>${escapeHtml(stages[email.stageIdx]?.name || "")}</strong>
          </div>
        ` : `
          <div class="ec-stage-section">
            <div class="ec-stage-label">
              ${stageName ? `${lightbulbSvg} Suggested stage` : "Add to stage"}
            </div>
            <div class="ec-stage-row">
              <select class="email-stage-select ec-stage-select" data-eidx="${idx}">
                <option value="-1">— Select stage —</option>
                ${stageOptions}
              </select>
              <button class="email-confirm-btn" data-eidx="${idx}">+ Add</button>
            </div>
            ${stageName ? `<div class="ec-stage-match">Matched: <strong>${escapeHtml(stageName)}</strong></div>` : ""}
          </div>
        `}

      </div>
    </div>`;
}

async function renderPropertyEmails(propId) {
  state.view = "emails";
  bodyEl.scrollTop = 0;

  const props = await self.TierStorage.getProperties();
  let prop = props.find(p => p.id === propId);
  if (!prop) { await renderMain(); return; }

  function renderList() {
    const listEl = document.getElementById("emailList");
    if (!listEl) return;
    const emails = prop.emails || [];
    if (emails.length === 0) {
      listEl.innerHTML = `<div class="ea-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 7.5L12 13L22 7.5" stroke="currentColor" stroke-width="1.2"/></svg>
        <div class="ea-empty-title">No emails yet</div>
        <div class="ea-empty-sub">Tap Scan to check your inbox</div>
      </div>`;
    } else {
      listEl.innerHTML = emails.map((e, i) => emailCardHtml(e, i, prop.stages)).join("");
    }
    wireEmailCards(prop, emails);
  }

  const scanIcon = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12.5 7A5.5 5.5 0 1 1 10.6 3M12.5 1.5V4.5H9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const emailCount  = (prop.emails || []).length;
  const shortAddr   = prop.address?.split(",").slice(0, 2).join(",") || prop.address || "Property";
  const unreplied   = (prop.emails || []).filter(e => !e.replied && !e.taskAdded).length;

  bodyEl.innerHTML = `
    <div class="modal-header">
      <button class="back-btn" id="emailBackBtn">&larr; Back</button>
      <span class="modal-title">Inbox</span>
    </div>

    <div class="ea-hero">
      <div class="ea-hero-icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3" width="13" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 5.5L8 9.5L14.5 5.5" stroke="currentColor" stroke-width="1.2"/></svg>
      </div>
      <div class="ea-hero-info">
        <div class="ea-hero-addr">${escapeHtml(shortAddr)}</div>
        <div class="ea-hero-stats">
          <span class="ea-hero-count" id="emailCountBadge">${emailCount} email${emailCount !== 1 ? "s" : ""}</span>
          ${unreplied > 0 ? `<span class="ea-hero-unreplied">${unreplied} pending</span>` : ""}
          <span class="ea-scan-status" id="emailScanStatus"></span>
        </div>
      </div>
      <button class="ea-scan-btn" id="emailScanBtn">${scanIcon} Scan</button>
    </div>

    <div id="emailList" class="ea-list">
      ${emailCount === 0
        ? `<div class="ea-empty">
             <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 7.5L12 13L22 7.5" stroke="currentColor" stroke-width="1.2"/></svg>
             <div class="ea-empty-title">No emails yet</div>
             <div class="ea-empty-sub">Tap Scan to check your inbox</div>
           </div>`
        : (prop.emails || []).map((e, i) => emailCardHtml(e, i, prop.stages)).join("")}
    </div>`;

  document.getElementById("emailBackBtn").addEventListener("click", () => renderPropertyDetail(propId));

  async function runScan(silent = false) {
    const btn        = document.getElementById("emailScanBtn");
    const status     = document.getElementById("emailScanStatus");
    const countBadge = document.getElementById("emailCountBadge");
    if (!btn) return;
    btn.disabled = true;
    if (!silent) btn.innerHTML = `<span class="ea-spin"></span> Scanning…`;
    try {
      const newEmails = await scanPropertyEmails(prop);
      if (newEmails.length > 0) {
        if (!prop.emails) prop.emails = [];
        prop.emails.unshift(...newEmails);
        await self.TierStorage.saveProperty(prop);
        if (status) { status.textContent = `+${newEmails.length} new`; status.classList.add("ea-status-new"); }
        if (countBadge) countBadge.textContent = `${prop.emails.length} email${prop.emails.length !== 1 ? "s" : ""}`;
      } else {
        if (status && !silent) status.textContent = "Up to date";
      }
      renderList();
    } catch (err) {
      if (status && !silent) status.textContent = "Scan failed";
      console.error(err);
      renderList();
    }
    if (btn) { btn.disabled = false; btn.innerHTML = `${scanIcon} Scan`; }
  }

  document.getElementById("emailScanBtn").addEventListener("click", () => runScan(false));
  runScan(true);
  wireEmailCards(prop, prop.emails || []);
}

function showAddTaskModal(email, suggestedIdx, prop, emails, onSave) {
  // Remove any existing modal
  document.getElementById("emailTaskModal")?.remove();

  const stageOptions = prop.stages.map((s, i) =>
    `<option value="${i}" ${i === suggestedIdx ? "selected" : ""}>${i + 1}. ${escapeHtml(s.name)}</option>`
  ).join("");

  const overlay = document.createElement("div");
  overlay.id = "emailTaskModal";
  overlay.className = "etm-overlay";
  overlay.innerHTML = `
    <div class="etm-box">
      <div class="etm-header">
        <span class="etm-title">Add to Escrow Stage</span>
        <button class="etm-close" id="etmClose">✕</button>
      </div>
      <div class="etm-body">
        <label class="etm-label">Task name</label>
        <input class="etm-input" id="etmTaskName" type="text" value="${escapeHtml(email.subject)}" />
        <label class="etm-label" style="margin-top:12px">Stage</label>
        <select class="etm-select" id="etmStageSelect">
          <option value="-1">— Select a stage —</option>
          ${stageOptions}
        </select>
        ${suggestedIdx >= 0 ? `<div class="etm-hint">Recommended: <strong>${escapeHtml(prop.stages[suggestedIdx]?.name || "")}</strong></div>` : ""}
      </div>
      <div class="etm-footer">
        <button class="etm-btn-cancel" id="etmCancel">Cancel</button>
        <button class="etm-btn-save" id="etmSave">Add task</button>
      </div>
    </div>`;

  document.getElementById("panel").appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  document.getElementById("etmClose").addEventListener("click", close);
  document.getElementById("etmCancel").addEventListener("click", close);

  document.getElementById("etmSave").addEventListener("click", async () => {
    const taskText = document.getElementById("etmTaskName").value.trim();
    const stageIdx = parseInt(document.getElementById("etmStageSelect").value);
    if (!taskText) { document.getElementById("etmTaskName").focus(); return; }
    if (stageIdx < 0) { document.getElementById("etmStageSelect").focus(); return; }
    await onSave(taskText, stageIdx);
    close();
  });

  // Focus task name for quick edit
  setTimeout(() => document.getElementById("etmTaskName")?.select(), 50);
}

function wireEmailCards(prop, emails) {
  // Add task
  document.querySelectorAll(".email-confirm-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx          = parseInt(btn.dataset.eidx);
      const select       = document.querySelector(`.email-stage-select[data-eidx="${idx}"]`);
      const suggestedIdx = parseInt(select?.value ?? "-1");
      const email        = emails[idx];

      showAddTaskModal(email, suggestedIdx, prop, emails, async (taskText, stageIdx) => {
        const senderName = (email.from || "").replace(/<[^>]+>/, "").trim().split(/\s+/)[0] || "";
        const labelledText = senderName ? `${taskText} — from ${senderName}` : taskText;
        const task = { id: `email-${email.id}-${Date.now()}`, text: labelledText, completed: false, fromEmail: true, isNew: true };
        prop.stages[stageIdx].tasks.push(task);
        email.stageIdx  = stageIdx;
        email.taskAdded = true;
        prop.emails     = emails;
        await self.TierStorage.saveProperty(prop);
        refreshEmailCard(idx, email, prop, emails);
      });
    });
  });

  // Delete
  document.querySelectorAll(".email-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.eidx);
      emails.splice(idx, 1);
      prop.emails = emails;
      await self.TierStorage.saveProperty(prop);
      reRenderEmailList(prop, emails);
    });
  });

  // Reply in Gmail
  document.querySelectorAll(".email-reply-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx   = parseInt(btn.dataset.eidx);
      const email = emails[idx];
      const threadId = email.threadId || email.id;
      chrome.tabs.create({ url: `https://mail.google.com/mail/u/0/#inbox/${threadId}` });
      email.replied   = true;
      email.repliedAt = Date.now();
      email.lastActivity = Date.now();
      prop.emails = emails;
      await self.TierStorage.saveProperty(prop);
      refreshEmailCard(idx, email, prop, emails);
      showEmailRepliedToast();
    });
  });

  // AI Reply
  document.querySelectorAll(".email-ai-reply-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx   = parseInt(btn.dataset.eidx);
      const email = emails[idx];
      btn.textContent = "Generating…";
      btn.disabled = true;
      try {
        const draft = await generateAiReply(email, prop);
        showAiReplyModal(draft, email, idx, prop, emails);
      } catch (err) {
        btn.textContent = "✦ AI Reply";
        btn.disabled = false;
        console.error("AI reply failed:", err);
      }
    });
  });

  // Stale — still active
  document.querySelectorAll(".email-stale-yes").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.eidx);
      emails[idx].lastActivity = Date.now();
      prop.emails = emails;
      await self.TierStorage.saveProperty(prop);
      refreshEmailCard(idx, emails[idx], prop, emails);
    });
  });

  // Stale — mark closed
  document.querySelectorAll(".email-stale-no").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.eidx);
      emails[idx].replied   = true;
      emails[idx].repliedAt = null;
      emails[idx].lastActivity = Date.now();
      prop.emails = emails;
      await self.TierStorage.saveProperty(prop);
      refreshEmailCard(idx, emails[idx], prop, emails);
    });
  });
}

function refreshEmailCard(idx, email, prop, emails) {
  const card = document.querySelector(`.email-card[data-eidx="${idx}"]`);
  if (card) {
    card.outerHTML = emailCardHtml(email, idx, prop.stages);
    wireEmailCards(prop, emails);
  }
}

function reRenderEmailList(prop, emails) {
  const listEl = document.getElementById("emailList");
  if (!listEl) return;
  if (emails.length === 0) {
    listEl.innerHTML = `<div class="ea-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 7.5L12 13L22 7.5" stroke="currentColor" stroke-width="1.2"/></svg>
      <div class="ea-empty-title">No emails yet</div>
      <div class="ea-empty-sub">Tap Scan to check your inbox</div>
    </div>`;
  } else {
    listEl.innerHTML = emails.map((e, i) => emailCardHtml(e, i, prop.stages)).join("");
  }
  wireEmailCards(prop, emails);
}

function showEmailRepliedToast() {
  const existing = document.getElementById("emailRepliedToast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "emailRepliedToast";
  toast.className = "email-replied-toast";
  toast.textContent = "✓ Email opened in Gmail — marked as replied";
  document.getElementById("panel").appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, 3000);
}

async function generateAiReply(email, prop) {
  const settings = await self.TierStorage.getSettings();
  const apiKey   = settings.anthropicKey;
  if (!apiKey) throw new Error("No API key");

  const prompt = `You are a professional real estate agent. Write a concise, warm, and professional reply to the following email about the property at ${prop.address}.

Email subject: ${email.subject}
From: ${email.from}
Message: ${email.snippet}

Write only the reply body — no subject line, no "Dear Claude", just the email content. Keep it under 150 words. Be helpful and professional.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

function showAiReplyModal(draft, email, idx, prop, emails) {
  document.getElementById("aiReplyModal")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "aiReplyModal";
  overlay.className = "etm-overlay";
  overlay.innerHTML = `
    <div class="etm-box">
      <div class="etm-header">
        <span class="etm-title">AI Draft Reply</span>
        <button class="etm-close" id="aiReplyClose">✕</button>
      </div>
      <div class="etm-body">
        <div class="ai-reply-to">Replying to: <strong>${escapeHtml(email.from)}</strong></div>
        <textarea class="ai-reply-textarea" id="aiReplyText">${escapeHtml(draft)}</textarea>
      </div>
      <div class="etm-footer">
        <button class="etm-btn-cancel" id="aiReplyCopy">Copy text</button>
        <button class="etm-btn-save" id="aiReplyOpen">Open in Gmail</button>
      </div>
    </div>`;

  document.getElementById("panel").appendChild(overlay);

  overlay.querySelector("#aiReplyClose").addEventListener("click", () => overlay.remove());

  overlay.querySelector("#aiReplyCopy").addEventListener("click", () => {
    const text = overlay.querySelector("#aiReplyText").value;
    navigator.clipboard.writeText(text).then(() => {
      overlay.querySelector("#aiReplyCopy").textContent = "Copied!";
      setTimeout(() => { overlay.querySelector("#aiReplyCopy").textContent = "Copy text"; }, 1500);
    });
  });

  overlay.querySelector("#aiReplyOpen").addEventListener("click", async () => {
    const threadId = email.threadId || email.id;
    chrome.tabs.create({ url: `https://mail.google.com/mail/u/0/#inbox/${threadId}` });
    email.replied   = true;
    email.repliedAt = Date.now();
    email.lastActivity = Date.now();
    prop.emails = emails;
    await self.TierStorage.saveProperty(prop);
    overlay.remove();
    refreshEmailCard(idx, email, prop, emails);
    showEmailRepliedToast();
  });
}

// ── Individuals Involved ──────────────────────────────────────────────────────

const PARTY_CATEGORIES = {
  BUYERS:  { label: "BUYERS",  roles: ["Buyer", "Buyer's Agent", "Associate Buyer Agent", "Buyer Team / TC"] },
  SELLERS: { label: "SELLERS", roles: ["Seller", "Listing Agent", "Associate Listing Agent", "Listing Team / TC"] },
  OTHER:   { label: "OTHER",   roles: ["Title Agent", "Loan Officer", "Inspector"] },
};

function partyCategory(role) {
  for (const [key, cat] of Object.entries(PARTY_CATEGORIES)) {
    if (cat.roles.includes(role)) return key;
  }
  return "OTHER";
}

function partyRowHtml(party, globalIdx) {
  const hasDetail = party.phone || party.email;
  return `
    <div class="party-row" data-gidx="${globalIdx}">
      <div class="party-row-summary">
        <div class="party-row-left">
          <span class="party-role-tag">${escapeHtml(party.role)}</span>
          <span class="party-row-name">${escapeHtml(party.name)}</span>
        </div>
        <div class="party-row-actions">
          ${hasDetail ? `<button class="party-expand-btn" data-gidx="${globalIdx}" title="Details">▾</button>` : ""}
          <button class="party-remove-btn" data-gidx="${globalIdx}" title="Remove">✕</button>
        </div>
      </div>
      <div class="party-row-detail" id="pd-${globalIdx}" style="display:none">
        ${party.phone ? `<div class="party-contact-row"><span class="party-contact-label">Phone</span>${escapeHtml(party.phone)}</div>` : ""}
        ${party.email ? `<div class="party-contact-row"><span class="party-contact-label">Email</span>${escapeHtml(party.email)}</div>` : ""}
      </div>
    </div>`;
}

function buildIndividualsSectionHtml(prop) {
  const parties = prop.parties || [];

  let html = `
    <div class="individuals-section">
      <div class="individuals-header">
        <div class="section-label" style="color:var(--text-primary);margin-bottom:0">
          <span class="dot" style="background:var(--text-primary)"></span>INDIVIDUALS INVOLVED
        </div>
      </div>
      <hr class="section-divider" style="margin:10px 0 8px"/>
      <div id="individualsCats">`;

  for (const [catKey, cat] of Object.entries(PARTY_CATEGORIES)) {
    const catParties = parties
      .map((p, i) => ({ ...p, _gidx: i }))
      .filter(p => partyCategory(p.role) === catKey || p.category === catKey);

    html += `
      <div class="party-cat" data-cat="${catKey}">
        <div class="party-cat-header" data-cat="${catKey}">
          <div class="party-cat-left">
            <span class="party-cat-chevron" id="pcc-${catKey}">▾</span>
            <span class="party-cat-name">${cat.label}</span>
            <span class="party-cat-count" id="pcn-${catKey}">${catParties.length > 0 ? catParties.length : ""}</span>
          </div>
          <button class="party-cat-add-btn" data-cat="${catKey}" title="Add to ${cat.label}">+ Add</button>
        </div>
        <div class="party-cat-body" id="pcb-${catKey}">
          <div class="party-cat-rows" id="pcr-${catKey}">
            ${catParties.map(p => partyRowHtml(p, p._gidx)).join("")}
          </div>
          <div class="party-cat-flow" id="pcf-${catKey}"></div>
        </div>
      </div>`;
  }

  html += `</div></div>`;
  return html;
}

function wireIndividualsSection(prop) {
  // Category collapse/expand
  document.querySelectorAll(".party-cat-header").forEach(header => {
    header.addEventListener("click", e => {
      if (e.target.closest(".party-cat-add-btn")) return;
      const cat  = header.dataset.cat;
      const body = document.getElementById(`pcb-${cat}`);
      const chev = document.getElementById(`pcc-${cat}`);
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      chev.textContent   = open ? "▸" : "▾";
    });
  });

  // Per-category add buttons
  document.querySelectorAll(".party-cat-add-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const catKey  = btn.dataset.cat;
      const cat     = PARTY_CATEGORIES[catKey];
      const flowEl  = document.getElementById(`pcf-${catKey}`);
      if (!flowEl) return;

      // Close any other open flows
      document.querySelectorAll(".party-cat-flow").forEach(f => {
        if (f.id !== `pcf-${catKey}`) { f.innerHTML = ""; f.classList.remove("party-flow-open"); }
      });

      // Role picker for this category
      let pickerHtml = `<div class="party-flow-inner">
        <div class="party-flow-title">${cat.label} — choose role</div>
        <div class="party-pills">`;
      for (const role of cat.roles) {
        pickerHtml += `<button class="party-pill" data-role="${escapeHtml(role)}">${escapeHtml(role)}</button>`;
      }
      pickerHtml += `</div>
        <button class="party-pill party-pill-custom" id="pcCustom-${catKey}">+ Custom role</button>
        <button class="party-flow-cancel" id="pcCancel-${catKey}">Cancel</button>
      </div>`;

      flowEl.innerHTML = pickerHtml;
      flowEl.classList.add("party-flow-open");

      flowEl.querySelectorAll(".party-pill:not(.party-pill-custom)").forEach(pill => {
        pill.addEventListener("click", () => showDetailForm(catKey, pill.dataset.role, flowEl, prop));
      });
      document.getElementById(`pcCustom-${catKey}`).addEventListener("click", () => {
        const custom = prompt("Enter custom role name:");
        if (custom?.trim()) showDetailForm(catKey, custom.trim(), flowEl, prop);
      });
      document.getElementById(`pcCancel-${catKey}`).addEventListener("click", () => {
        flowEl.innerHTML = "";
        flowEl.classList.remove("party-flow-open");
      });
    });
  });

  // Individual expand/collapse
  wirePartyRows(prop);
}

function showDetailForm(catKey, role, flowEl, prop) {
  flowEl.innerHTML = `<div class="party-flow-inner">
    <div class="party-selected-role">${escapeHtml(role)}</div>
    <div class="party-flow-title">Add details</div>
    <input class="party-input" id="pdfName"  placeholder="Full name *" autocomplete="off"/>
    <input class="party-input" id="pdfPhone" placeholder="Phone (optional)" autocomplete="off"/>
    <input class="party-input" id="pdfEmail" placeholder="Email (optional)" autocomplete="off"/>
    <div class="party-form-actions">
      <button class="party-back-btn" id="pdfBack">← Back</button>
      <button class="party-save-btn" id="pdfSave">Save</button>
    </div>
  </div>`;

  const nameInput = document.getElementById("pdfName");
  nameInput.focus();

  document.getElementById("pdfBack").addEventListener("click", () => {
    document.querySelector(`.party-cat-add-btn[data-cat="${catKey}"]`)?.click();
  });

  document.getElementById("pdfSave").addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    if (!prop.parties) prop.parties = [];
    prop.parties.push({
      role,
      category: catKey,
      name,
      phone: document.getElementById("pdfPhone").value.trim(),
      email: document.getElementById("pdfEmail").value.trim(),
    });
    await self.TierStorage.saveProperty(prop);

    flowEl.innerHTML = "";
    flowEl.classList.remove("party-flow-open");

    // Re-render this category's rows
    const gidx = prop.parties.length - 1;
    const rowsEl = document.getElementById(`pcr-${catKey}`);
    if (rowsEl) rowsEl.insertAdjacentHTML("beforeend", partyRowHtml(prop.parties[gidx], gidx));

    // Update count badge
    const countEl = document.getElementById(`pcn-${catKey}`);
    const catCount = prop.parties.filter(p => (p.category || partyCategory(p.role)) === catKey).length;
    if (countEl) countEl.textContent = catCount > 0 ? catCount : "";

    wirePartyRows(prop);
  });

  nameInput.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("pdfSave").click();
  });
}

function wirePartyRows(prop) {
  // Expand/collapse individual detail
  document.querySelectorAll(".party-expand-btn").forEach(btn => {
    btn.onclick = () => {
      const gidx   = btn.dataset.gidx;
      const detail = document.getElementById(`pd-${gidx}`);
      if (!detail) return;
      const open = detail.style.display !== "none";
      detail.style.display = open ? "none" : "block";
      btn.textContent = open ? "▾" : "▴";
    };
  });

  // Remove party
  document.querySelectorAll(".party-remove-btn").forEach(btn => {
    btn.onclick = async () => {
      const gidx = parseInt(btn.dataset.gidx);
      prop.parties.splice(gidx, 1);
      await self.TierStorage.saveProperty(prop);
      // Re-render the whole individuals section
      const section = document.querySelector(".individuals-section");
      if (section) {
        section.outerHTML = buildIndividualsSectionHtml(prop);
        wireIndividualsSection(prop);
      }
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

const STAGE_REMINDER_PRESETS = [
  { label: "30 min",  mins: 30    },
  { label: "1 hr",    mins: 60    },
  { label: "2 hr",    mins: 120   },
  { label: "4 hr",    mins: 240   },
  { label: "Daily",   mins: 1440  },
  { label: "Weekly",  mins: 10080 },
  { label: "Custom",  mins: null  },
];

function stageTaskHtml(si, ti, task) {
  const hasReminder = !!task.reminder;
  const reminderLabel = hasReminder ? task.reminder.label : "";
  return `
  <div class="stage-task-wrap" id="stw-${si}-${ti}">
    <div class="stage-task-row" data-si="${si}" data-ti="${ti}" draggable="true">
      <span class="stage-task-drag" title="Drag to reorder">
        <svg width="10" height="14" viewBox="0 0 10 14" fill="none"><circle cx="3" cy="3" r="1.1" fill="currentColor"/><circle cx="7" cy="3" r="1.1" fill="currentColor"/><circle cx="3" cy="7" r="1.1" fill="currentColor"/><circle cx="7" cy="7" r="1.1" fill="currentColor"/><circle cx="3" cy="11" r="1.1" fill="currentColor"/><circle cx="7" cy="11" r="1.1" fill="currentColor"/></svg>
      </span>
      <label class="stage-task-label">
        <input type="checkbox" class="stage-task-check" data-si="${si}" data-ti="${ti}" ${task.completed ? "checked" : ""}/>
        <span class="stage-task-text${task.completed ? " task-text-done" : ""}">${escapeHtml(task.text)}</span>
      </label>
      <div class="stage-task-actions">
        ${hasReminder ? `<span class="str-badge" data-si="${si}" data-ti="${ti}" title="Edit reminder">${escapeHtml(reminderLabel)}</span>` : ""}
        <button class="str-clock-btn" data-si="${si}" data-ti="${ti}" title="${hasReminder ? "Edit reminder" : "Set reminder"}">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M6 4V6.5L7.5 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        </button>
        <button class="stage-task-delete" data-si="${si}" data-ti="${ti}" title="Delete task">✕</button>
      </div>
    </div>
  </div>`;
}

function wireStageTaskEvents(prop) {
  bodyEl.querySelectorAll(".stage-task-check").forEach((cb) => {
    const si = parseInt(cb.dataset.si);
    const ti = parseInt(cb.dataset.ti);
    wireOneTaskRow(cb.closest(".stage-task-row"), prop, si, ti);
  });
  bodyEl.querySelectorAll(".stage-task-delete").forEach((btn) => {
    const si = parseInt(btn.dataset.si);
    const ti = parseInt(btn.dataset.ti);
    wireTaskDelete(btn, prop, si, ti);
  });
  bodyEl.querySelectorAll(".str-clock-btn, .str-badge").forEach((btn) => {
    const si = parseInt(btn.dataset.si);
    const ti = parseInt(btn.dataset.ti);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleStageTaskReminderPanel(si, ti, prop);
    });
  });
  prop.stages.forEach((_, si) => {
    const listEl = document.getElementById(`stl-${si}`);
    if (listEl) wireStageTaskDrag(listEl, prop, si);
  });
}

function toggleStageTaskReminderPanel(si, ti, prop) {
  const wrap     = document.getElementById(`stw-${si}-${ti}`);
  if (!wrap) return;
  const existing = wrap.querySelector(".str-panel");
  if (existing) { existing.remove(); return; }

  const task    = prop.stages[si].tasks[ti];
  const current = task.reminder;
  const activeLabel = current?.label || "1 hr";

  const panel = document.createElement("div");
  panel.className = "str-panel";
  panel.innerHTML = `
    <div class="str-panel-inner">
      <div class="str-panel-top">
        <span class="str-panel-title">Reminder</span>
        <label class="reminder-toggle-wrap">
          <input type="checkbox" class="str-toggle" ${current ? "checked" : ""} />
          <span class="reminder-toggle-track"><span class="reminder-toggle-thumb"></span></span>
        </label>
      </div>
      <div class="str-panel-body" style="display:${current ? "block" : "none"}">
        <div class="str-presets">
          ${STAGE_REMINDER_PRESETS.map(p =>
            `<button class="rp-btn str-preset${p.label === activeLabel && current ? " rp-active" : ""}" data-mins="${p.mins ?? ""}" data-label="${p.label}">${p.label}</button>`
          ).join("")}
        </div>
        <div class="reminder-custom-row str-custom-row" style="display:${activeLabel === "Custom" && current ? "flex" : "none"}">
          <span class="reminder-custom-label">Every</span>
          <input type="number" class="reminder-custom-num str-custom-num" value="${current?.customVal || 1}" min="1" max="999" />
          <select class="reminder-custom-unit str-custom-unit">
            <option value="minutes" ${current?.unit === "minutes" ? "selected" : ""}>minutes</option>
            <option value="hours"   ${current?.unit === "hours"   ? "selected" : ""}>hours</option>
            <option value="days"    ${current?.unit === "days"    ? "selected" : ""}>days</option>
          </select>
        </div>
        <div class="reminder-time-row str-time-row" style="display:${current?.intervalMins >= 1440 ? "flex" : "none"}">
          <span class="reminder-custom-label">At</span>
          <input type="time" class="reminder-time-input str-time-input" value="${current?.time || "09:00"}" />
        </div>
      </div>
      <div class="str-panel-footer">
        <button class="str-cancel">Cancel</button>
        <button class="str-save">Save</button>
      </div>
    </div>`;

  wrap.appendChild(panel);

  const toggle   = panel.querySelector(".str-toggle");
  const body     = panel.querySelector(".str-panel-body");
  const presets  = panel.querySelectorAll(".str-preset");
  const customRow = panel.querySelector(".str-custom-row");
  const timeRow  = panel.querySelector(".str-time-row");

  toggle.addEventListener("change", () => {
    body.style.display = toggle.checked ? "block" : "none";
  });

  presets.forEach(btn => {
    btn.addEventListener("click", () => {
      presets.forEach(b => b.classList.remove("rp-active"));
      btn.classList.add("rp-active");
      const isCustom = btn.dataset.label === "Custom";
      const isLong   = !isCustom && Number(btn.dataset.mins) >= 1440;
      customRow.style.display = isCustom ? "flex" : "none";
      timeRow.style.display   = isLong   ? "flex" : "none";
    });
  });

  panel.querySelector(".str-cancel").addEventListener("click", () => panel.remove());

  panel.querySelector(".str-save").addEventListener("click", async () => {
    if (!toggle.checked) {
      prop.stages[si].tasks[ti].reminder = null;
    } else {
      const activeBtn  = panel.querySelector(".str-preset.rp-active");
      const label      = activeBtn?.dataset.label || "1 hr";
      const presetMins = activeBtn?.dataset.mins ? Number(activeBtn.dataset.mins) : null;
      let intervalMins = presetMins;

      if (label === "Custom" || !presetMins) {
        const val  = parseInt(panel.querySelector(".str-custom-num")?.value || "1");
        const unit = panel.querySelector(".str-custom-unit")?.value || "hours";
        intervalMins = unit === "minutes" ? val : unit === "hours" ? val * 60 : val * 1440;
      }

      const time = panel.querySelector(".str-time-input")?.value || "09:00";
      prop.stages[si].tasks[ti].reminder = {
        intervalMins,
        label,
        unit:      label === "Custom" ? (panel.querySelector(".str-custom-unit")?.value || "hours") : null,
        customVal: label === "Custom" ? parseInt(panel.querySelector(".str-custom-num")?.value || "1") : null,
        time,
        nextAt: Date.now() + intervalMins * 60 * 1000,
      };
    }

    await self.TierStorage.saveProperty(prop);

    // Re-render just this task row
    const listEl = document.getElementById(`stl-${si}`);
    if (listEl) {
      listEl.innerHTML = prop.stages[si].tasks.map((t, i) => stageTaskHtml(si, i, t)).join("");
      wireStageTaskEvents(prop);
    }
  });
}

function wireStageTaskDrag(listEl, prop, si) {
  let dragSrc = null;

  listEl.querySelectorAll(".stage-task-wrap").forEach((wrap) => {
    const row = wrap.querySelector(".stage-task-row");
    if (!row) return;

    row.addEventListener("dragstart", (e) => {
      dragSrc = wrap;
      wrap.classList.add("drag-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", row.dataset.ti);
    });

    row.addEventListener("dragend", () => {
      wrap.classList.remove("drag-dragging");
      listEl.querySelectorAll(".stage-task-wrap").forEach(w => w.classList.remove("drag-over"));
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (wrap === dragSrc) return;
      listEl.querySelectorAll(".stage-task-wrap").forEach(w => w.classList.remove("drag-over"));
      wrap.classList.add("drag-over");
    });

    row.addEventListener("dragleave", () => wrap.classList.remove("drag-over"));

    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      if (!dragSrc || dragSrc === wrap) return;
      wrap.classList.remove("drag-over");

      const fromIdx = parseInt(dragSrc.querySelector(".stage-task-row").dataset.ti);
      const toIdx   = parseInt(row.dataset.ti);

      const tasks = prop.stages[si].tasks;
      const [moved] = tasks.splice(fromIdx, 1);
      tasks.splice(toIdx, 0, moved);

      await self.TierStorage.saveProperty(prop);

      listEl.innerHTML = tasks.map((t, i) => stageTaskHtml(si, i, t)).join("");
      wireStageTaskEvents(prop);
      refreshTaskCount(si, prop.stages[si]);
    });
  });
}

function wireOneTaskRow(row, prop, si, ti) {
  const cb = row.querySelector(".stage-task-check");
  if (!cb) return;
  cb.addEventListener("change", async () => {
    prop.stages[si].tasks[ti].completed = cb.checked;
    await self.TierStorage.saveProperty(prop);
    row.querySelector(".stage-task-text").classList.toggle("task-text-done", cb.checked);
    refreshTaskCount(si, prop.stages[si]);
    refreshStageNum(si, prop.stages[si]);
    updateOverallBar(prop);
    refreshStageNotifDot(si, prop.stages[si]);
  });
}

function wireTaskDelete(btn, prop, si, ti) {
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    prop.stages[si].tasks.splice(ti, 1);
    await self.TierStorage.saveProperty(prop);
    // Re-index remaining rows in this stage
    const listEl = document.getElementById(`stl-${si}`);
    listEl.innerHTML = prop.stages[si].tasks.map((t, i) => stageTaskHtml(si, i, t)).join("");
    listEl.querySelectorAll(".stage-task-check").forEach((cb) => {
      wireOneTaskRow(cb.closest(".stage-task-row"), prop, si, parseInt(cb.dataset.ti));
    });
    listEl.querySelectorAll(".stage-task-delete").forEach((b) => {
      wireTaskDelete(b, prop, si, parseInt(b.dataset.ti));
    });
    wireStageTaskDrag(listEl, prop, si);
    refreshTaskCount(si, prop.stages[si]);
    refreshStageNum(si, prop.stages[si]);
    updateOverallBar(prop);
  });
}

function refreshStageNotifDot(si, stage) {
  let dot = document.getElementById(`snd-${si}`);

  const emailTasks = stage.tasks.filter(t => t.fromEmail);
  const hasNew     = emailTasks.some(t => t.isNew && !t.completed);
  const allDone    = emailTasks.length > 0 && emailTasks.every(t => t.completed);

  if (!hasNew && !allDone) {
    if (dot) dot.remove();
    return;
  }

  const nameRow = document.querySelector(`#sc-${si} .stage-name-row`);
  if (!nameRow) return;

  if (!dot) {
    dot = document.createElement("span");
    dot.id = `snd-${si}`;
    nameRow.appendChild(dot);
  }
  dot.className = `stage-notif-dot ${allDone ? "stage-notif-done" : "stage-notif-new"}`;
  dot.textContent = allDone ? "✓" : "!";
}

function refreshTaskCount(si, stage) {
  const doneC = stage.tasks.filter((t) => t.completed).length;
  const total = stage.tasks.length;
  const el = document.getElementById(`stc-${si}`);
  if (el) el.textContent = `${doneC}/${total} tasks`;
  const fill = document.getElementById(`smf-${si}`);
  if (fill) fill.style.width = `${total > 0 ? Math.round((doneC / total) * 100) : 0}%`;
}

function refreshStageNum(si, stage) {
  const done  = isStageComplete(stage);
  const card  = document.getElementById(`sc-${si}`);
  const numEl = document.getElementById(`sn-${si}`);
  if (!card || !numEl) return;
  card.classList.toggle("stage-done", done);
  numEl.classList.toggle("stage-num-done", done);
  numEl.innerHTML = done
    ? `<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : String(si + 1);
}

function updateOverallBar(prop) {
  const prog = propProgress(prop);
  const fill = document.getElementById("overallFill");
  const pct  = document.getElementById("overallPct");
  if (fill) fill.style.width = `${prog.pct}%`;
  if (pct)  pct.textContent = `${prog.done} / ${prog.total} stages`;
}

// ── Command chatbox — offline, no API key required ───────────────────────────

const TIER_LABELS = { red: "Priority 1", yellow: "Priority 2", green: "Priority 3" };

function appendChatMessage(role, text) {
  const messagesEl = document.getElementById("askAiMessages");
  if (!messagesEl) return;
  const el = document.createElement("div");
  el.className = role === "user" ? "user-msg" : "ai-msg";
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.classList.add("has-messages");
  document.getElementById("askAiBar")?.classList.add("ask-ai-open");
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function parseCommand(raw) {
  const t = raw.trim();
  const tl = t.toLowerCase();

  // Standalone keywords
  if (/^help$/i.test(tl))                                    return { action: "help" };
  if (/^(sync|sync calendar|refresh)$/i.test(tl))            return { action: "sync_calendar" };
  if (/^(settings|open settings)$/i.test(tl))                return { action: "open_settings" };
  if (/^(list|show|tasks|list tasks|show tasks|my tasks)$/i.test(tl))
                                                              return { action: "list_tasks", filter: "active" };
  if (/^(list all|show all|all tasks)$/i.test(tl))           return { action: "list_tasks", filter: "all" };
  if (/^(completed|done tasks|list completed|show completed)$/i.test(tl))
                                                              return { action: "list_tasks", filter: "completed" };
  if (/^(new task|add task|add|new)$/i.test(tl))             return { action: "open_add_task_form" };

  // DELETE  →  "delete [partial title]"
  let m = tl.match(/^(?:delete|remove|del)\s+(.+)/);
  if (m) return { action: "delete_task", query: m[1] };

  // COMPLETE  →  "complete [partial title]"
  m = tl.match(/^(?:complete|done|finish|check off|mark done|mark complete)\s+(.+)/);
  if (m) return { action: "complete_task", query: m[1] };

  // PRIORITY prefix  →  "p1 [partial title]"
  m = tl.match(/^(?:p1|priority\s*1|urgent)\s+(.+)/);
  if (m) return { action: "update_task_priority", query: m[1], tier: "red" };
  m = tl.match(/^(?:p2|priority\s*2)\s+(.+)/);
  if (m) return { action: "update_task_priority", query: m[1], tier: "yellow" };
  m = tl.match(/^(?:p3|priority\s*3|low)\s+(.+)/);
  if (m) return { action: "update_task_priority", query: m[1], tier: "green" };

  // DEADLINE  →  "deadline [partial title] [today|tomorrow|next week|in N days]"
  m = tl.match(/^(?:deadline|reschedule|due)\s+(.+?)\s+(today|tomorrow|next week|in \d+ days?)$/);
  if (m) {
    const deadlineHours = parseDuration(m[2]);
    return { action: "update_task_deadline", query: m[1], deadlineHours };
  }

  // ADD TASK  →  "add [title] [p1|p2|p3] [today|tomorrow|next week|in N days]"
  m = tl.match(/^(?:add task|add|new task|new)\s+([\s\S]+)/);
  if (m) {
    const prefixLen = m[0].length - m[1].length;
    let rest = t.slice(prefixLen);           // preserve original casing
    let tier = "yellow";
    let deadlineHours = 24;

    // Extract priority token
    if (/\b(p1|priority\s*1|urgent)\b/i.test(rest)) {
      tier = "red";
      rest = rest.replace(/\s*\b(p1|priority\s*1|urgent)\b/gi, "").trim();
    } else if (/\b(p2|priority\s*2)\b/i.test(rest)) {
      rest = rest.replace(/\s*\b(p2|priority\s*2)\b/gi, "").trim();
    } else if (/\b(p3|priority\s*3)\b/i.test(rest)) {
      tier = "green";
      rest = rest.replace(/\s*\b(p3|priority\s*3)\b/gi, "").trim();
    }

    // Extract deadline token
    const durMatch = rest.match(/\s+(?:due\s+)?(today|tomorrow|next week|in \d+ days?)$/i);
    if (durMatch) {
      deadlineHours = parseDuration(durMatch[1]);
      rest = rest.slice(0, rest.length - durMatch[0].length).trim();
    }

    if (!rest) return { action: "open_add_task_form" };
    const title = rest.charAt(0).toUpperCase() + rest.slice(1);
    return { action: "add_task", title, tier, deadlineHours };
  }

  return { action: "unknown" };
}

function parseDuration(str) {
  const s = str.toLowerCase();
  if (s === "today")      return 6;
  if (s === "tomorrow")   return 24;
  if (s === "next week")  return 168;
  const dm = s.match(/in (\d+) days?/);
  if (dm) return parseInt(dm[1]) * 24;
  return 24;
}

async function runCommand(cmd) {
  switch (cmd.action) {
    case "add_task": {
      const tier = cmd.tier || "yellow";
      const newTask = {
        id: uuid(),
        title: cmd.title,
        deadline: Date.now() + (cmd.deadlineHours || 24) * 3600 * 1000,
        source: "manual",
        tier,
        tierOverride: true,
        notes: "",
        completed: false,
        createdAt: Date.now(),
      };
      await self.TierStorage.saveTask(newTask);
      await pushTaskToCalendar(newTask);
      if (state.view === "main") await renderMain();
      return `Added "${newTask.title}" — ${TIER_LABELS[tier]}, due ${formatDue(newTask.deadline)}.`;
    }

    case "open_add_task_form":
      openAddForm();
      return "Opening the new task form.";

    case "complete_task": {
      const tasks = await self.TierStorage.getTasks();
      const match = tasks.find((t) => !t.completed && t.title.toLowerCase().includes(cmd.query));
      if (!match) return `No active task found matching "${cmd.query}".`;
      match.completed = true;
      await self.TierStorage.saveTask(match);
      if (state.view === "main") await renderMain();
      return `Marked "${match.title}" as complete.`;
    }

    case "delete_task": {
      const tasks = await self.TierStorage.getTasks();
      const match = tasks.find((t) => t.title.toLowerCase().includes(cmd.query));
      if (!match) return `No task found matching "${cmd.query}".`;
      await self.TierStorage.deleteTask(match.id);
      await deleteTaskFromCalendar(match);
      if (state.view === "main") await renderMain();
      return `Deleted "${match.title}".`;
    }

    case "update_task_priority": {
      const tasks = await self.TierStorage.getTasks();
      const match = tasks.find((t) => t.title.toLowerCase().includes(cmd.query));
      if (!match) return `No task found matching "${cmd.query}".`;
      match.tier = cmd.tier;
      match.tierOverride = true;
      await self.TierStorage.saveTask(match);
      if (state.view === "main") await renderMain();
      return `"${match.title}" moved to ${TIER_LABELS[cmd.tier]}.`;
    }

    case "update_task_deadline": {
      const tasks = await self.TierStorage.getTasks();
      const match = tasks.find((t) => t.title.toLowerCase().includes(cmd.query));
      if (!match) return `No task found matching "${cmd.query}".`;
      match.deadline = Date.now() + cmd.deadlineHours * 3600 * 1000;
      await self.TierStorage.saveTask(match);
      if (state.view === "main") await renderMain();
      return `"${match.title}" deadline updated to ${formatDue(match.deadline)}.`;
    }

    case "list_tasks": {
      const tasks = await self.TierStorage.getTasks();
      const filter = cmd.filter || "active";
      const list = filter === "completed" ? tasks.filter((t) => t.completed)
        : filter === "all" ? tasks
        : tasks.filter((t) => !t.completed);
      if (list.length === 0) return "No tasks found.";
      const S = { red: "P1", yellow: "P2", green: "P3" };
      return list.map((t) => `${S[t.tier]}  ${t.title} — due ${formatDue(t.deadline)}${t.completed ? " ✓" : ""}`).join("\n");
    }

    case "sync_calendar":
      runSync();
      return "Syncing calendar…";

    case "open_settings":
      renderSettings();
      return "Opening settings.";

    case "help":
      return [
        "── Add tasks ──────────────────────────",
        "add [title]",
        "add [title] p1 / p2 / p3",
        "add [title] today / tomorrow / next week",
        "add [title] in 3 days",
        "",
        "── Manage tasks ───────────────────────",
        "complete [partial title]",
        "delete [partial title]",
        "p1 [partial title]   → change to Priority 1",
        "p2 [partial title]   → change to Priority 2",
        "p3 [partial title]   → change to Priority 3",
        "deadline [title] tomorrow",
        "",
        "── View & other ───────────────────────",
        "list                 → active tasks",
        "list all             → all tasks",
        "list completed       → done tasks",
        "sync                 → sync calendar",
        "settings             → open settings",
      ].join("\n");

    default:
      return `Command not recognised. Type "help" to see what's available.`;
  }
}

async function sendAiMessage() {
  const input = document.getElementById("askAiInput");
  const text = input?.value.trim();
  if (!text) return;
  input.value = "";
  appendChatMessage("user", text);
  const result = await runCommand(parseCommand(text));
  appendChatMessage("assistant", result);
}

function initChatbox() {
  const input = document.getElementById("askAiInput");
  const sendBtn = document.getElementById("askAiSend");
  const closeBtn = document.getElementById("askAiClose");
  const bar = document.getElementById("askAiBar");
  const messages = document.getElementById("askAiMessages");
  if (!input || !sendBtn) return;

  function closeChatbox() {
    messages.innerHTML = "";
    messages.classList.remove("has-messages");
    bar.classList.remove("ask-ai-open");
    input.value = "";
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAiMessage(); }
    if (e.key === "Escape") closeChatbox();
  });
  sendBtn.addEventListener("click", sendAiMessage);
  if (closeBtn) closeBtn.addEventListener("click", closeChatbox);

  document.addEventListener("click", (e) => {
    if (bar.classList.contains("ask-ai-open") && !bar.contains(e.target)) {
      closeChatbox();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────

init();
initChatbox();
