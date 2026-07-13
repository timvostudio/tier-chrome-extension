# Tier — Chrome Extension for Real Estate Agents

A priority task manager, escrow tracker, Gmail inbox scanner, and property pipeline tool — all inside a Chrome Extension popup. Built for real estate agents managing multiple active transactions.

---

## Features

- **Priority Task System** — Three-tier tasks (Priority 1/2/3) with deadlines, reminders, and Google Calendar sync
- **Property Escrow Tracker** — 22-stage pipeline per property with task checklists, drag-to-reorder, progress bar, and per-stage reminders
- **Step Indicator** — Visual 22-segment bar with red pulsing alerts for urgent stages and hover tooltips showing stage name, task count, and status
- **Gmail Inbox Scanner** — Auto-scans Gmail for emails related to each property, links to escrow stages, flags ones needing replies
- **Inbox View** — Per-property email inbox with "All emails" / "Pending" filter chips, pending email highlights, and AI reply drafts
- **Individuals Tracker** — Track buyers, sellers, agents, escrow officers, and lenders per property
- **Reminder System** — Set frequency reminders on any task or escrow stage (30 min → weekly, custom intervals)
- **Accessibility Panel** — Font size, light/dark/high-contrast theme, font style, bold, spacing, reduce motion, resizable popup
- **AI Reply** — Claude-powered email reply drafts (requires Anthropic API key)
- **Street View Photos** — Auto-loads property photos from Google Street View (requires Maps API key)

---

## Prerequisites

- Google Chrome (or any Chromium-based browser)
- A Google account (for Calendar + Gmail features)
- Git

---

## Quick Start — Load the Extension

```bash
git clone https://github.com/timvostudio/tier-chrome-extension.git
cd tier-chrome-extension
```

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** → select the `tier-extension` folder
4. Click the puzzle-piece icon in the toolbar → pin **Tier**

No npm, no bundler, no build step. Runs straight from source.

**Core features work immediately** — tasks, property cards, escrow tracker, all UI. The features below need API keys to unlock.

---

## API Key Setup

### Google Maps (Street View property photos)

> Without this, property cards show a placeholder. Everything else works fine.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create or select a project
2. Enable **Street View Static API** and **Maps Static API**
3. Go to **APIs & Services → Credentials → Create Credentials → API Key**
4. Copy the key (starts with `AIza…`)
5. In Tier: open **Settings** (⋮ button) → scroll to **Google Maps** → paste key → Save

---

### Anthropic API (AI Reply drafts on email cards)

> Without this, the "✦ AI Reply" button shows an error. Everything else works fine.

1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Go to **API Keys** → create a new key (starts with `sk-ant-…`)
3. In Chrome: go to `chrome://extensions` → find Tier → click **Service Worker** to open DevTools
4. In the **Console** tab, paste this (replacing `YOUR_KEY_HERE` with your actual key):

```js
const s = await new Promise(r => chrome.storage.local.get('tier_settings', r));
chrome.storage.local.set({ tier_settings: { ...s.tier_settings, anthropicKey: "YOUR_KEY_HERE" } });
```

> **Note for developers:** A settings UI input for the Anthropic key should be added to `renderSettings()` in `popup.js` — follow the same pattern as the Maps API key input (around line 1187).

---

### Google Calendar + Gmail (Sync & inbox scanning)

The OAuth `client_id` in `manifest.json` is registered under the original developer's Google Cloud project. You have two options:

**Option A — Get added as a test user (easiest)**

Email Tim Vo at timvostudio@gmail.com and ask to be added as a test user. Once added, connect directly inside the Tier popup — no code changes needed.

**Option B — Create your own Google Cloud project**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a new project
2. Enable **Google Calendar API** and **Gmail API**
3. Go to **APIs & Services → OAuth consent screen**:
   - User type: External
   - App name: Tier
   - Add scopes: `calendar.events` and `gmail.readonly`
   - Add your email as a **test user**
4. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**:
   - Application type: **Chrome Extension**
   - Extension ID: copy from `chrome://extensions` (shown under Tier after loading)
5. Copy the generated Client ID
6. Open `tier-extension/manifest.json`, replace the `client_id` value:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly"
  ]
}
```

7. Reload the extension at `chrome://extensions`
8. In Tier popup → click **Connect Google Calendar**

---

## File Structure

```
tier-extension/
├── manifest.json     Chrome MV3 manifest — permissions, OAuth config, icons
├── popup.html        Shell HTML — loads all scripts, #panel container
├── popup.js          ~3,300 lines — ALL views, rendering, event wiring
├── popup.css         ~3,330 lines — ALL styles
├── background.js     Service worker — alarms, badge updates, reminder notifications
├── storage.js        chrome.storage.local abstraction layer (TierStorage namespace)
├── auth.js           Google OAuth2 flow (TierAuth namespace)
├── calendar.js       Google Calendar sync (TierCalendar namespace)
├── gmail.js          Gmail API scan (TierGmail namespace)
├── content.js        Zillow/Redfin content script — extracts listing data
├── CLAUDE.md         Full architecture + developer handoff documentation
└── icons/            Extension icons (16/32/48/128px)
```

**For a full breakdown of architecture, data models, all 22 escrow stages, every key function, storage keys, CSS conventions, and patterns to follow — read `CLAUDE.md` before making changes.**

---

## Development Workflow

```bash
# Make your changes in any file, then reload:
# chrome://extensions → click the reload icon on the Tier card

# Save your changes
git add -A
git commit -m "describe your change"
git push origin main
```

**Useful DevTools:**
- **Inspect popup UI:** Right-click the Tier toolbar icon → Inspect popup
- **Inspect background worker:** `chrome://extensions` → Tier → click "Service Worker"
- **Clear all stored data:**
  ```js
  chrome.storage.local.clear()
  ```
- **Read current storage:**
  ```js
  chrome.storage.local.get(null, console.log)
  ```

---

## Key Architecture Rules

Before making changes, understand these patterns:

1. **All views render into `#body`** via `innerHTML`. Don't mutate individual DOM elements — use the provided refresh helpers or re-render the full view.

2. **Always call `TierStorage.saveProperty(prop)` after mutating a property** — changes are in-memory and won't persist without an explicit save.

3. **Use `escapeHtml(str)`** before inserting any user-provided content into innerHTML.

4. **Stage task drag-to-reorder targets `.stage-task-wrap`** (the outer wrapper), not `.stage-task-row` (the inner row). This is intentional.

5. **Popup state resets when the popup closes** — Chrome behavior. All data survives in `chrome.storage.local`.

---

## Data Overview

| Storage Key | Contents |
|-------------|----------|
| `tier_tasks` | All priority tasks |
| `tier_properties` | All properties + their stages, tasks, emails, individuals |
| `tier_settings` | App settings incl. API keys |
| `tier_auth_state` | Google OAuth token + connection state |
| `tier_suggestions` | Pending Gmail-derived task suggestions |
| `tier_a11y` | Accessibility panel settings |
| `tier_win_size` | Popup window dimensions |

---

## Original Developer

**Tim Vo** · timvostudio@gmail.com  
GitHub: [github.com/timvostudio](https://github.com/timvostudio)  
Repo: [github.com/timvostudio/tier-chrome-extension](https://github.com/timvostudio/tier-chrome-extension)
