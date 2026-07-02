importScripts("storage.js", "auth.js", "calendar.js", "gmail.js");

const SYNC_ALARM = "calendar-sync";
const BADGE_ALARM = "badge-refresh";
const NOTIFIED_KEY = "tier_notified_ids";
const BADGE_RED = "#e5484d";
const STALLED_DAYS = 2;
const STALLED_RENOTIFY_HOURS = 24;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 15 });
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM) {
    await runSyncAndNotify();
  } else if (alarm.name === BADGE_ALARM) {
    await updateBadge();
  }
});

// Storage is the single source of truth — any context (popup, background
// sync) that mutates tasks triggers this, so the badge stays accurate
// without every call site needing to remember to refresh it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.tier_tasks) {
    updateBadge();
  }
});

async function updateBadge() {
  try {
    const tasks = await self.TierStorage.getTasks();
    const count = tasks.filter((t) => !t.completed).length;
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_RED });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: "#ffffff" });
    }
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  } catch (err) {
    console.error("Tier badge update failed:", err);
  }
}

async function runSyncAndNotify() {
  try {
    const authState = await self.TierStorage.getAuthState();
    if (!authState.connected) return;

    const tasks = await self.TierCalendar.syncCalendar();
    await notifyUrgentTasks(tasks);
    await notifyStalledTasks(tasks);
    await runGmailScan();
  } catch (err) {
    console.error("Tier background sync failed:", err);
  }
}

async function runGmailScan() {
  try {
    const settings = await self.TierStorage.getSettings();
    if (!settings.gmailScanEnabled) return;

    const newSuggestions = await self.TierGmail.scanGmail();
    if (newSuggestions.length > 0) {
      chrome.notifications.create(`tier-gmail-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Tier — New activity detected",
        message: `Found ${newSuggestions.length} task update${newSuggestions.length > 1 ? "s" : ""} from your inbox. Open Tier to confirm.`,
      });
    }
  } catch (err) {
    console.error("Tier Gmail scan failed:", err);
  }
}

async function notifyStalledTasks(tasks) {
  const settings = await self.TierStorage.getSettings();
  if (!settings.urgentAlerts) return;

  const now = Date.now();
  const stalledCutoff = STALLED_DAYS * 24 * 60 * 60 * 1000;
  const renotifyCutoff = STALLED_RENOTIFY_HOURS * 60 * 60 * 1000;
  const notifiedMap = await self.TierStorage.getStalledNotified();

  const stalled = tasks.filter(
    (t) => !t.completed && now - t.deadline > stalledCutoff
  );

  let mapChanged = false;
  for (const task of stalled) {
    const lastNotified = notifiedMap[task.id] || 0;
    if (now - lastNotified < renotifyCutoff) continue;

    const daysOverdue = Math.floor((now - task.deadline) / (24 * 60 * 60 * 1000));
    chrome.notifications.create(`tier-stalled-${task.id}-${now}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Tier — Stalled task",
      message: `${task.title} has been overdue for ${daysOverdue} day${daysOverdue > 1 ? "s" : ""}.`,
    });
    notifiedMap[task.id] = now;
    mapChanged = true;
  }

  if (mapChanged) {
    await self.TierStorage.setStalledNotified(notifiedMap);
  }
}

async function notifyUrgentTasks(tasks) {
  const settings = await self.TierStorage.getSettings();
  if (!settings.urgentAlerts) return;

  const { [NOTIFIED_KEY]: notifiedIds = [] } = await chrome.storage.local.get(NOTIFIED_KEY);
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  const dueSoon = tasks.filter(
    (t) =>
      t.tier === "red" &&
      !t.completed &&
      t.deadline - now <= oneHour &&
      t.deadline - now > 0 &&
      !notifiedIds.includes(t.id)
  );

  for (const task of dueSoon) {
    chrome.notifications.create(`tier-${task.id}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Tier — Urgent",
      message: `${task.title} is due soon.`,
    });
  }

  if (dueSoon.length > 0) {
    const updatedIds = [...notifiedIds, ...dueSoon.map((t) => t.id)];
    await chrome.storage.local.set({ [NOTIFIED_KEY]: updatedIds });
  }
}
