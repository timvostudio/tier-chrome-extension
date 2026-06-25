# Tier

A minimal, professional task prioritization system for real estate agents and entrepreneurs, built as a Google Chrome Extension. Tier lives as a small icon in the browser toolbar; when clicked, it expands into a focused panel showing tasks pulled from Google Calendar — auto-tiered by urgency — plus manually added tasks, with optional Gmail-based task detection.

## Features

- **Auto-tiered task list** — every task is sorted into Priority 1 (red), 2 (yellow), or 3 (green) based on how soon it's due.
- **Google Calendar sync** — pulls events from your primary calendar every 15 minutes and re-tiers them automatically.
- **Gmail task detection** — scans recent inbox messages for language that suggests a new task ("can you follow up on...", "deadline Friday") or a completed one ("just sent over the signed offer letter"). Every match is surfaced as a *suggestion* that you must explicitly **Confirm** or **Dismiss** — nothing is created or completed without approval.
- **Manual tasks** — add, edit, and delete tasks directly, with a deadline picker and manual tier override.
- **Toolbar badge** — shows a live, red badge with the count of tasks due today (including anything overdue), updating in real time via `chrome.storage.onChanged` plus a 1-minute refresh alarm to catch the midnight rollover.
- **Notifications** — a Chrome notification fires when a Priority 1 task is due within the hour, and again if a task goes "stalled" (overdue 2+ days), re-alerting at most once every 24 hours.
- **Settings panel** — toggle Gmail scanning, urgent alerts, completed-task visibility, and source badges; connect/disconnect your Google account.
- **Time-of-day greeting** — "Good morning / afternoon / evening, {name}!" using the signed-in Chrome profile's name, no calendar connection required.

## File structure

```
tier-extension/
├── manifest.json     MV3 manifest — permissions, OAuth2 config, pinned extension key
├── popup.html        Popup markup (header, scrollable body, fixed Ask AI bar)
├── popup.css         All styling — CSS custom properties, no hardcoded colors in rules
├── popup.js          View router + rendering (main list, add/edit form, settings, suggestions)
├── background.js     MV3 service worker — alarms, badge updates, notifications, sync orchestration
├── auth.js           chrome.identity OAuth token handling (get/remove token, fetch email, disconnect)
├── calendar.js       Calendar fetch + tiering logic (computeTier, countDueToday, syncCalendar)
├── gmail.js          Gmail fetch + heuristic task/completion detection (no LLM — keyword matching)
├── storage.js        Async chrome.storage.local wrapper (tasks, settings, suggestions, overrides)
└── icons/            Toolbar icons (16/32/48/128px, generated grey circle + white dot)
```

## Design system

| Token | Value |
|---|---|
| `--bg-primary` | `#ffffff` |
| `--bg-secondary` | `#f7f7f7` |
| `--bg-card` | `#f0f0f0` |
| `--bg-hover` | `#e6e6e6` |
| `--border` / `--border-light` | `#e0e0e0` / `#d0d0d0` |
| `--text-primary` | `#1a1a1a` |
| `--text-secondary` | `#6e6e6e` |
| `--text-muted` | `#a0a0a0` |
| `--accent-red` (Priority 1) | `#e5484d` |
| `--accent-yellow` (Priority 2) | `#f5a623` |
| `--accent-green` (Priority 3) | `#30a46c` |

- Font: system stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`), base 13px.
- Panel: fixed 360px wide, up to 560px tall, square top corners (filled solid black header), 12px-rounded bottom corners.
- Header bar: solid black background, white logo/icons, 44px tall.
- Task cards: light grey background, 5px solid left border in the tier color, white-on-hover edit icon.
- Settings/Add-task views slide in over the same panel body (no separate windows).

## Tiering logic

```js
const hoursUntil = (deadline - now) / (1000 * 60 * 60);
if (hoursUntil <= 24) tier = "red";       // due today or overdue
else if (hoursUntil <= 96) tier = "yellow"; // due within 4 days
else tier = "green";                        // due in 4+ days
```

Manual tier overrides are stored per task ID in `chrome.storage.local` and always take precedence over the computed tier on re-sync.

## Setup — Google Cloud OAuth

The extension needs a real Google Cloud OAuth client to talk to Calendar and Gmail. The extension ID is pinned via the `key` field in `manifest.json`, so it stays the same every time you load it unpacked:

```
dkjiilaldghdpgfhcccbapaljpmphahn
```

1. **Create a project** at [console.cloud.google.com](https://console.cloud.google.com).
2. **Enable APIs**: search for and enable both the **Google Calendar API** and the **Gmail API**.
3. **OAuth consent screen** (APIs & Services → OAuth consent screen):
   - User type: External (unless on a Workspace org restricted to internal users)
   - Add scopes: `https://www.googleapis.com/auth/calendar.readonly` and `https://www.googleapis.com/auth/gmail.readonly`
   - Add yourself as a **test user** (required while the app is in "Testing" status — only test users can authorize it)
4. **Create credentials** (APIs & Services → Credentials → Create Credentials → OAuth client ID):
   - Application type: **Chrome Extension**
   - Item ID: the extension ID above
   - Copy the generated client ID
5. Paste the client ID into `manifest.json` → `oauth2.client_id`.

> While the consent screen is in "Testing" mode, only accounts explicitly added as test users can complete the OAuth flow — anyone else hits `Error 403: access_denied`. This is fine indefinitely for personal/internal use; broader distribution requires Google's verification review (required because Calendar/Gmail are sensitive scopes).

## Running it locally

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `tier-extension/` folder.
3. Click the Tier icon → gear/kebab menu (⋮) → **Connect Google Calendar**.
4. Sign in with a test-user Google account and grant access.

## Code conventions

- No external libraries or CDN dependencies — pure vanilla JS.
- All async operations use `async`/`await` with `try`/`catch`.
- No inline styles — all styling lives in `popup.css`, using CSS custom properties throughout.
- Storage is the single source of truth: any context (popup or background) that writes `tier_tasks` triggers `chrome.storage.onChanged`, which background.js listens to for badge updates — no call site has to remember to refresh it manually.

## Known limitations (iteration 1)

- Gmail/email task detection is keyword-heuristic, not an LLM — it will miss phrasing it doesn't recognize and can occasionally false-positive on ambiguous emails. This is why every detection requires manual confirmation before it touches your task list.
- No real backend for the "Ask AI" search box yet — it's currently a styled, non-functional input reserved for a future iteration.
- OAuth consent is in "Testing" mode by default; only added test users can sign in until the app goes through Google's verification process.
