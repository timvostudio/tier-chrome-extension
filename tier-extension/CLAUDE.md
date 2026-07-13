# CLAUDE.md — Tier Chrome Extension

This file provides complete guidance for any developer (or AI assistant) continuing work on the Tier Chrome Extension. Read this before touching any code.

---

## What This App Is

**Tier** is a Chrome Extension (Manifest V3) built for real estate agents. It is a priority task manager, escrow tracker, Gmail inbox scanner, and property pipeline manager — all in a single popup UI.

Primary users: real estate agents managing multiple property transactions simultaneously.

---

## File Structure

```
tier-extension/
├── manifest.json       Chrome MV3 manifest — permissions, OAuth, icons
├── popup.html          Shell HTML — loads all scripts, defines #panel structure
├── popup.js            ~3,300 lines — ALL UI rendering, event wiring, views
├── popup.css           ~3,330 lines — ALL styles for the popup
├── background.js       Service worker — alarms, badge, notifications, Gmail sync
├── storage.js          Chrome storage abstraction layer (TierStorage namespace)
├── auth.js             Google OAuth2 flow (TierAuth namespace)
├── calendar.js         Google Calendar sync (TierCalendar namespace)
├── gmail.js            Gmail API scan (TierGmail namespace)
├── content.js          Content script — runs on Zillow/Redfin to extract property data
└── icons/              icon16/32/48/128.png
```

---

## Architecture Overview

### No build step, no framework, no bundler.
Everything is vanilla JS. Scripts are loaded in order via `<script>` tags in `popup.html`. The popup re-renders views by mutating `document.getElementById("body").innerHTML`.

### Single `#body` div
All views are rendered into `<div class="body" id="body">`. Views are:
- `renderMain()` — task list, greeting, property cards
- `renderPropertyDetail(propId)` — escrow tracker for one property
- `renderPropertyEmails(propId)` — inbox view for one property
- `renderSettings()` — settings panel
- `renderSuggestions()` — Gmail suggestion review
- `renderConnectScreen()` — Google Calendar connect prompt

### State object
```js
const state = {
  view: "main" | "detail" | "emails" | "settings" | "suggestions",
  editingId: null,
  formOpen: false,
};
```

---

## Storage Layer (`storage.js`)

All data lives in `chrome.storage.local`. The `TierStorage` namespace is exposed on `self` (so both popup and background worker can use it).

**Storage keys:**
| Key | Contents |
|-----|----------|
| `tier_tasks` | Array of task objects |
| `tier_properties` | Array of property objects |
| `tier_auth_state` | `{ connected, email, token }` |
| `tier_settings` | `{ urgentAlerts, showCompleted, gmailScanEnabled, nameTitle, … }` |
| `tier_suggestions` | Array of Gmail-derived task suggestions |
| `tier_stalled_notified` | Map of `taskId → lastNotifiedTimestamp` |
| `tier_win_size` | `{ w, h }` — popup dimensions |
| `tier_a11y` | Accessibility settings object |

**Key methods:**
- `TierStorage.getTasks()` / `saveTasks()` / `saveTask()` / `deleteTask()`
- `TierStorage.getProperties()` / `saveProperty()` / `deleteProperty()`
- `TierStorage.getSettings()` / `saveSettings()`
- `TierStorage.getAuthState()` / `setAuthState()`
- `TierStorage.getSuggestions()` / `saveSuggestions()`

---

## Data Models

### Task
```js
{
  id: string,           // uuid
  title: string,
  tier: "red" | "yellow" | "green",
  deadline: number,     // Unix ms timestamp
  completed: boolean,
  completedAt: number,
  source: "manual" | "calendar" | "gmail",
  calEventId: string,   // if synced from calendar
  reminder: {           // null if no reminder set
    intervalMins: number,
    label: string,      // "30 min" | "1 hr" | "Every day" | "Custom"
    unit: string | null,
    customVal: number | null,
    time: string,       // "09:00"
    nextAt: number,     // next fire timestamp ms
  }
}
```

### Property
```js
{
  id: string,           // uuid
  address: string,
  url: string,          // Zillow/Redfin listing URL
  photoUrl: string,     // base64 compressed image or Street View URL
  emails: Email[],
  individuals: Party[], // buyers, sellers, agents, escrow officers, lenders
  stages: Stage[],      // always 22 stages (see DEFAULT_STAGES below)
}
```

### Stage
```js
{
  name: string,         // e.g. "Get Pre-Approved"
  hint: string,         // optional tooltip hint
  completed: boolean,   // true if manually marked done (empty-task stages)
  expanded: boolean,    // accordion open/closed
  tasks: StageTask[],
  reminder: Reminder | null,  // stage-level reminder (same shape as task reminder)
}
```

### StageTask
```js
{
  id: string,
  text: string,
  completed: boolean,
  fromEmail: boolean,   // true = auto-generated from Gmail scan
  isNew: boolean,       // true = recently added, triggers ! badge
  reminder: Reminder | null,
}
```

### Email
```js
{
  id: string,
  subject: string,
  from: string,         // "Name <email@domain.com>"
  snippet: string,
  date: string,         // ISO date string
  gmailId: string,
  replied: boolean,
  repliedAt: number,
  taskAdded: boolean,
  stageIdx: number,     // which stage this email was linked to
  lastActivity: number,
}
```

### Party (Individuals Involved)
```js
{
  role: string,         // "Buyer" | "Seller" | "Buyer's Agent" | "Escrow Officer" | "Lender" | "Other"
  name: string,
  email: string,
  phone: string,
}
```

---

## The 22 Default Escrow Stages

Defined in `popup.js` as `DEFAULT_STAGES`. Every new property gets a copy. In order:
1. Get Pre-Approved
2. Sign Buyer Rep Agreement
3. Property Search & Tours
4. Make an Offer
5. Offer Accepted
6. Open Escrow
7. Submit Earnest Money Deposit
8. Complete Loan Application
9. Order Home Inspection
10. Review Inspection Report
11. Negotiate Repairs / Credits
12. Appraisal Ordered
13. Appraisal Received
14. Loan Approval / Underwriting
15. Review & Sign Disclosures
16. Final Walkthrough
17. Loan Documents Signed
18. Funds Wired to Escrow
19. Lender Funds the Loan
20. Title Records the Deed
21. Keys Handed Over
22. Post-Close Follow-Up

---

## Key UI Components

### Progress Bar Step Indicator (`.spp-wrap`)
Located at top of escrow tracker. Shows all 22 stages as segmented bars.

- Green (`spp-done`) = stage complete
- Red pulsing (`spp-alert`) = stage has a new unread email task (`!` flag)
- Gray = not started

Below the bars: step numbers 1–22. Red + bold when urgent.

Hover tooltip (`#sppTip`) shows: step name, task count, and urgency message. Arrow always points exactly at the hovered segment (computed via `--arrow-left` CSS variable).

**Relevant functions:** `updateOverallBar(prop)`, `toggleStageReminderPanel(si, prop)`

### Email Inbox Page (`renderPropertyEmails`)
Collapsed by default — only shows chips. Each chip is independently clickable:
- **"N emails"** chip (green) → expands list showing ALL emails
- **"N pending"** chip (red) → expands list filtered to pending only (not replied + no task)
- Clicking the active chip collapses the list

Pending email cards are highlighted with amber left border + "Needs action" badge.

### Accessibility Panel (`showA11yPanel`)
Triggered by "Aa" button in header. Controls:
- Font size (small/normal/large/xl) via `document.body.style.zoom`
- Theme (light/dark/high-contrast) via `#panel[data-theme]`
- Font style (system/serif/readable)
- Bold mode, comfortable spacing, reduce motion
- Window size presets + drag-to-resize via `#resizeHandle`

All settings persisted to `tier_a11y` and `tier_win_size` in chrome.storage.

### Reminder System
Two levels of reminders — both use the same panel UI and same data shape:
1. **Task-level** (per `StageTask`): clock button on each task row → `toggleStageTaskReminderPanel(si, ti, prop)`
2. **Stage-level** (per `Stage`): clock button in stage header → `toggleStageReminderPanel(si, prop)`

Presets: 30 min, 1 hr, 3 hr, Every day, Every week, Custom.
Custom: number + unit (minutes/hours/days) + optional time-of-day picker for day+ intervals.

Background worker fires notifications when `reminder.nextAt <= Date.now()` and reschedules.

### Stage Task Drag-to-Reorder
Each task is wrapped in `.stage-task-wrap` (not `.stage-task-row`). The drag events attach to the inner `.stage-task-row`. Function: `wireStageTaskDrag(listEl, prop, si)`.

---

## Background Service Worker (`background.js`)

Runs on two alarms:
- `calendar-sync` (every 15 min): syncs Google Calendar, scans Gmail, fires stalled/urgent task notifications
- `badge-refresh` (every 1 min): updates extension badge count, fires any due reminders

**`fireTaskReminders()`** checks:
1. Main task list — fires if `task.reminder.nextAt <= now`
2. Stage-level reminders — fires if `stage.reminder.nextAt <= now`
3. Stage task reminders — fires if `stTask.reminder.nextAt <= now`

Badge = count of incomplete main tasks (red background, white text).

---

## Chrome APIs Used

| API | Purpose |
|-----|---------|
| `chrome.storage.local` | All persistent data |
| `chrome.identity` | Google OAuth2 token acquisition |
| `chrome.alarms` | Background sync + reminder scheduling |
| `chrome.notifications` | Task/stage reminder popups |
| `chrome.action.setBadgeText/Color` | Incomplete task count badge |
| `chrome.tabs` | Opening Gmail links |
| `chrome.scripting` | Content script injection |
| `chrome.runtime.onMessage` | Content script → popup communication |

---

## Permissions (manifest.json)
`identity`, `storage`, `unlimitedStorage`, `alarms`, `notifications`, `tabs`, `scripting`

Host permissions: `googleapis.com`, `maps.googleapis.com`, `api.anthropic.com`, `zillow.com`, `redfin.com`

OAuth scopes: `calendar.events`, `gmail.readonly`

---

## CSS Conventions

All CSS is in `popup.css`. No preprocessor.

**CSS variables** (defined on `:root`):
- `--bg`, `--bg-secondary`, `--bg-hover` — background hierarchy
- `--border`, `--border-light` — borders
- `--text-primary`, `--text-muted` — text
- `--accent-green: #30a46c` — primary action color
- `--accent-x`, `--accent-o` — tier colors (unused in current UI)

**Theming** via `#panel[data-theme="dark"]` and `#panel[data-theme="hc"]` data attributes — override CSS vars for dark/high-contrast modes. Spacing via `#panel[data-spacing="comfortable"]`. Reduce motion via `#panel[data-reduce-motion="true"]`.

**Key class prefixes:**
- `.stage-*` — escrow stage cards
- `.spp-*` — step progress bar (stepper)
- `.ec-*` — email card internals
- `.eap-*` — email archive page
- `.str-*` — stage task reminder panel
- `.a11y-*` — accessibility panel
- `.prop-detail-*` — property detail page header/hero

---

## Content Script (`content.js`)

Runs on `zillow.com/homedetails/*` and `redfin.com/*`. Extracts:
- Property address
- Listing URL
- Hero photo URL

Sends via `chrome.runtime.sendMessage` to popup, which creates a new property.

---

## Gmail Integration (`gmail.js`)

`TierGmail.scanGmail()` uses `gmail.readonly` scope to:
1. Search for emails matching property addresses
2. Extract sender, subject, snippet, date
3. Match emails to stages via keyword heuristics (`suggestStageForEmail`)
4. Return new emails not already stored

`scanPropertyEmails(prop)` in `popup.js` wraps this with property-specific filtering.

---

## Google Calendar Integration (`calendar.js`)

`TierCalendar.syncCalendar()` pulls events from Google Calendar and creates/updates tasks. Bidirectional: tasks with `calEventId` are matched to calendar events on re-sync.

---

## AI Reply Feature

`generateAiReply(email, prop)` in `popup.js` calls `https://api.anthropic.com/v1/messages` using the Claude API. Requires `api.anthropic.com` in host_permissions. Drafts a contextual reply based on the email content and property stage. Shown in `showAiReplyModal()`.

---

## Window Resizing

Drag handle (`#resizeHandle`) at bottom-right of `#panel`. Uses `screenX`/`screenY` (not `clientX`/`clientY`) to track mouse across popup boundary. Min: 280×380, Max: 800×720. Preset sizes: Compact (300×480), Default (360×560), Large (460×640), Wide (580×660).

Sizing applied via:
```js
panel.style.width = w + "px";
panel.style.maxHeight = h + "px";
document.body.style.width = w + "px";
document.body.style.minWidth = w + "px";
```

---

## Adding a New Feature — Checklist

1. **New view**: add a `renderXxx()` async function, set `state.view`, write HTML to `bodyEl.innerHTML`, wire events below
2. **New storage key**: add to `KEYS` object in `storage.js`, add getter/setter to `TierStorage`
3. **New background alarm**: add `chrome.alarms.create` in `onInstalled`, handle in `onAlarm` listener
4. **New property field**: add to the property object created in `createNewProperty()`, ensure it's preserved in all `saveProperty()` calls
5. **New stage field**: add to `DEFAULT_STAGES` array, handle in stage card HTML template in `renderPropertyDetail()`

---

## Known Patterns to Follow

- **Never mutate DOM elements directly** — always re-render via innerHTML or a refresh helper (`refreshStageNum`, `refreshTaskCount`, etc.)
- **Always call `self.TierStorage.saveProperty(prop)` after mutating `prop`** — the object is in-memory, mutations don't auto-persist
- **`escapeHtml(str)` before inserting any user data** into innerHTML
- **`e.stopPropagation()`** on buttons inside clickable containers (e.g. stage header, email cards)
- **Stage task drag**: target `.stage-task-wrap` (outer), not `.stage-task-row` (inner) for drag events

---

## GitHub Remote

Repository: `timvostudio/tic-tac-toe` (note: this may need to be updated to a dedicated repo for the extension).

Push with:
```bash
git add popup.js popup.css background.js
git commit -m "description"
git push origin main
```

---

## Developer Handoff Notes

- The extension is **fully functional offline** except for: Google Calendar sync, Gmail scan, AI reply, and Street View photos
- All UI state resets when the popup closes (Chrome behavior) — persisted data survives via `chrome.storage.local`
- The popup **auto-scans Gmail silently** on every inbox page open (`runScan(true)`)
- Font scaling uses `document.body.style.zoom` — Chrome-native, no layout side effects
- The `#sppTip` tooltip div is created once and reused across all 22 segments — it's appended to `document.body` (not `#panel`) so it can position freely
- Dark theme applies to `#panel` only (not `body`) to avoid OS-level conflicts
