# Tier — Chrome Extension

A priority task manager for real estate agents. Syncs with Google Calendar, scans Gmail for tasks, tracks escrow progress across 21 stages, and manages properties with individuals and email archives — all in a clean Chrome toolbar popup.

---

## Load in Chrome (No Build Step)

1. Clone the repo
   ```bash
   git clone https://github.com/timvostudio/tier-chrome-extension.git
   cd tier-chrome-extension
   ```
2. Go to `chrome://extensions` → enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the cloned folder
4. Pin the **Tier** icon from the Chrome toolbar puzzle-piece menu

No npm, no bundler, no dependencies. Runs straight from source.

---

## File Structure

```
tier-extension/
├── manifest.json     # MV3 config — permissions, OAuth2, host rules, icons
├── popup.html        # Shell: header, scrollable body, Ask AI bar
├── popup.css         # All styles (CSS variables, no hardcoded colors)
├── popup.js          # All UI logic and rendering (single-file SPA)
├── storage.js        # chrome.storage.local wrapper — single source of truth
├── auth.js           # Google OAuth via chrome.identity
├── background.js     # Service worker — badge updates, alarms, notifications
├── calendar.js       # Google Calendar API sync + tiering logic
├── gmail.js          # Gmail scan + keyword-based task suggestion engine
├── content.js        # Injected on Zillow/Redfin to capture listing photos
└── icons/            # Extension icons (16, 32, 48, 128px)
```

---

## Google OAuth Setup

The extension uses `chrome.identity` for OAuth. To run under your own account:

1. Go to [Google Cloud Console](https://console.cloud.google.com) → create a project
2. Enable **Google Calendar API** and **Gmail API**
3. **OAuth consent screen** → set scopes:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - Add yourself as a **test user**
4. **Credentials** → Create OAuth 2.0 Client ID → type: **Chrome Extension**
   - Item ID: your extension's ID (shown at `chrome://extensions` after loading)
5. Copy the Client ID into `manifest.json` → `oauth2.client_id`

> While the consent screen is in "Testing" mode, only accounts added as test users can sign in. This is fine for personal use indefinitely.

---

## Optional: Google Maps Street View

Enables auto-loading a street view photo for each property.

1. Enable **Maps Static API** in Google Cloud Console
2. Create an API key
3. Open the extension → Settings → paste the key under **Google Maps API Key**

---

## Architecture

**Rendering flow:**
- `init()` → checks auth + tasks → `renderMain()` or `renderConnectScreen()`
- `renderPropertyDetail(propId)` → escrow tracker for one property
- `renderPropertyEmails(propId)` → email archive view
- `renderSettings()` → settings panel

**Key data shapes:**
```js
// Task
{ id, title, tier: "red"|"yellow"|"green", deadline, completed, source }

// Property
{ id, address, url, photoUrl, stages: [...], parties: [...], emails: [...] }

// Stage (escrow step)
{ name, hint, tasks: [{ id, text, completed }], expanded, completed }

// Party (Individual Involved)
{ role, category: "BUYERS"|"SELLERS"|"OTHER", name, phone, email }
```

**State model:**
- `chrome.storage.local` is the single source of truth — all reads/writes via `self.TierStorage`
- `background.js` listens to `chrome.storage.onChanged` to keep the badge count real-time
- Auth token cached in storage to avoid repeated OAuth prompts; refreshed on sync

---

## Features

| Feature | Details |
|---|---|
| Priority tasks (P1 / P2 / P3) | Auto-tiered by deadline: red ≤24h, yellow ≤96h, green beyond |
| Google Calendar sync | Every 15 min in background + manual refresh button |
| Gmail task suggestions | Keyword scan → suggest tasks, must confirm before adding |
| Properties list | Add via Zillow/Redfin URL or manually |
| Escrow tracker | 21 configurable stages, each with sub-tasks and progress bar |
| Task deletion | Hover a task inside any stage → ✕ to delete |
| Street View photo | Auto-loads from Maps API (requires key in Settings) |
| Individuals Involved | Collapsible BUYERS / SELLERS / OTHER groups, custom roles |
| Email archive | Scan Gmail 90 days by address keyword; AI stage suggestion |
| Time-of-day greeting | Illustration + "Good morning/afternoon/evening, Mr. Smith" |
| Weather widget | Open-Meteo (no API key) + Nominatim reverse geocoding |
| Voice greeting | `speakWelcome()` in popup.js — currently disabled, re-enable by calling it in `init()` |
| Toolbar badge | Red badge = total incomplete tasks, live via `chrome.storage.onChanged` |
| Ask AI bar | UI present, wired to chatbox — connect an LLM API in `initChatbox()` |

---

## Development Tips

- **Reload after edits:** `chrome://extensions` → refresh icon on the Tier card
- **Inspect the popup:** Right-click Tier icon → Inspect popup
- **Inspect the service worker:** `chrome://extensions` → Tier → "Service Worker" link
- **Clear all storage:** In popup DevTools console:
  ```js
  chrome.storage.local.clear()
  ```
- **Tiering logic** lives in `calendar.js → computeTier()`
- **Adding a new settings toggle:** add the key to `DEFAULT_SETTINGS` in `storage.js`, render it in `renderSettings()` in `popup.js`
- **Adding a new escrow stage:** edit the `STAGES` array in `popup.js`

---

## Design Tokens (popup.css)

| Variable | Value |
|---|---|
| `--bg-primary` | `#ffffff` |
| `--bg-card` | `#f0f0f0` |
| `--border` | `#e0e0e0` |
| `--text-primary` | `#1a1a1a` |
| `--text-secondary` | `#6e6e6e` |
| `--text-muted` | `#a0a0a0` |
| `--accent-red` | `#e5484d` |
| `--accent-yellow` | `#f5a623` |
| `--accent-green` | `#30a46c` |

Font: system stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI"`), base 13px.
Panel: 360px wide, up to 560px tall. All styling uses CSS variables — no hardcoded colors in rules.
