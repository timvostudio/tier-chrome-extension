// Thin async wrapper around chrome.storage.local for tasks, sync state, and overrides.

const KEYS = {
  TASKS: "tier_tasks",
  LAST_SYNC: "tier_last_sync",
  AUTH_STATE: "tier_auth_state",
  OVERRIDES: "tier_overrides",
  SETTINGS: "tier_settings",
  SUGGESTIONS: "tier_suggestions",
  STALLED_NOTIFIED: "tier_stalled_notified",
  PROPERTIES: "tier_properties",
};

const DEFAULT_SETTINGS = {
  urgentAlerts: true,
  showCompleted: false,
  showSourceBadges: true,
  gmailScanEnabled: true,
  nameTitle: "Mr.",
};

async function getTasks() {
  const { [KEYS.TASKS]: tasks = [] } = await chrome.storage.local.get(KEYS.TASKS);
  return tasks.slice().sort((a, b) => a.deadline - b.deadline);
}

async function saveTask(task) {
  const tasks = await getTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) {
    tasks[idx] = task;
  } else {
    tasks.push(task);
  }
  await chrome.storage.local.set({ [KEYS.TASKS]: tasks });
  return task;
}

async function saveTasks(taskList) {
  await chrome.storage.local.set({ [KEYS.TASKS]: taskList });
  return taskList;
}

async function deleteTask(id) {
  const tasks = await getTasks();
  const filtered = tasks.filter((t) => t.id !== id);
  await chrome.storage.local.set({ [KEYS.TASKS]: filtered });
}

async function getLastSync() {
  const { [KEYS.LAST_SYNC]: ts = null } = await chrome.storage.local.get(KEYS.LAST_SYNC);
  return ts;
}

async function setLastSync(timestamp) {
  await chrome.storage.local.set({ [KEYS.LAST_SYNC]: timestamp });
}

async function getAuthState() {
  const { [KEYS.AUTH_STATE]: state = { connected: false, email: null } } =
    await chrome.storage.local.get(KEYS.AUTH_STATE);
  return state;
}

async function setAuthState(state) {
  await chrome.storage.local.set({ [KEYS.AUTH_STATE]: state });
}

async function getOverrides() {
  const { [KEYS.OVERRIDES]: overrides = {} } = await chrome.storage.local.get(KEYS.OVERRIDES);
  return overrides;
}

async function setOverride(eventId, tier) {
  const overrides = await getOverrides();
  overrides[eventId] = tier;
  await chrome.storage.local.set({ [KEYS.OVERRIDES]: overrides });
}

async function getSettings() {
  const { [KEYS.SETTINGS]: settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [KEYS.SETTINGS]: next });
  return next;
}

async function getSuggestions() {
  const { [KEYS.SUGGESTIONS]: suggestions = [] } = await chrome.storage.local.get(KEYS.SUGGESTIONS);
  return suggestions;
}

async function addSuggestions(newSuggestions) {
  const existing = await getSuggestions();
  const existingIds = new Set(existing.map((s) => s.id));
  const merged = [...existing, ...newSuggestions.filter((s) => !existingIds.has(s.id))];
  await chrome.storage.local.set({ [KEYS.SUGGESTIONS]: merged });
  return merged;
}

async function removeSuggestion(id) {
  const existing = await getSuggestions();
  const filtered = existing.filter((s) => s.id !== id);
  await chrome.storage.local.set({ [KEYS.SUGGESTIONS]: filtered });
}

async function getStalledNotified() {
  const { [KEYS.STALLED_NOTIFIED]: map = {} } = await chrome.storage.local.get(KEYS.STALLED_NOTIFIED);
  return map;
}

async function setStalledNotified(map) {
  await chrome.storage.local.set({ [KEYS.STALLED_NOTIFIED]: map });
}

async function getProperties() {
  const { [KEYS.PROPERTIES]: props = [] } = await chrome.storage.local.get(KEYS.PROPERTIES);
  return props;
}

async function saveProperty(property) {
  const props = await getProperties();
  const idx = props.findIndex((p) => p.id === property.id);
  if (idx >= 0) props[idx] = property;
  else props.push(property);
  await chrome.storage.local.set({ [KEYS.PROPERTIES]: props });
  return property;
}

async function deleteProperty(id) {
  const props = await getProperties();
  await chrome.storage.local.set({ [KEYS.PROPERTIES]: props.filter((p) => p.id !== id) });
}

self.TierStorage = {
  getTasks,
  saveTask,
  saveTasks,
  deleteTask,
  getLastSync,
  setLastSync,
  getAuthState,
  setAuthState,
  getOverrides,
  setOverride,
  getSettings,
  setSettings,
  getSuggestions,
  addSuggestions,
  removeSuggestion,
  getStalledNotified,
  setStalledNotified,
  getProperties,
  saveProperty,
  deleteProperty,
};
