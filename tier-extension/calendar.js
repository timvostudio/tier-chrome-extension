// Google Calendar fetch + auto-tiering logic.

function computeTier(deadline) {
  const now = Date.now();
  const hoursUntil = (deadline - now) / (1000 * 60 * 60);
  if (hoursUntil <= 24) return "red";
  if (hoursUntil <= 96) return "yellow";
  return "green";
}

function countDueToday(tasks) {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return tasks.filter((t) => !t.completed && t.deadline < endOfToday).length;
}

function parseEventDeadline(event) {
  const start = event.start || {};
  if (start.dateTime) return new Date(start.dateTime).getTime();
  if (start.date) return new Date(`${start.date}T23:59:59`).getTime();
  return Date.now();
}

async function fetchCalendarEvents(token) {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    throw new Error(`Calendar fetch failed: ${res.status}`);
  }

  const data = await res.json();
  return data.items || [];
}

async function syncCalendar() {
  const token = await self.TierAuth.getAuthToken(true);
  const events = await fetchCalendarEvents(token);

  const overrides = await self.TierStorage.getOverrides();
  const existingTasks = await self.TierStorage.getTasks();
  const manualTasks = existingTasks.filter((t) => t.source === "manual");

  const calendarTasks = events
    .filter((e) => e.summary)
    .map((event) => {
      const deadline = parseEventDeadline(event);
      const hasOverride = Object.prototype.hasOwnProperty.call(overrides, event.id);
      const previous = existingTasks.find((t) => t.id === event.id);
      return {
        id: event.id,
        title: event.summary,
        deadline,
        source: "calendar",
        tier: hasOverride ? overrides[event.id] : computeTier(deadline),
        tierOverride: hasOverride,
        notes: previous?.notes || "",
        completed: previous?.completed || false,
        createdAt: previous?.createdAt || Date.now(),
      };
    });

  const allTasks = [...calendarTasks, ...manualTasks];
  await self.TierStorage.saveTasks(allTasks);
  await self.TierStorage.setLastSync(Date.now());
  return allTasks;
}

self.TierCalendar = {
  computeTier,
  countDueToday,
  parseEventDeadline,
  fetchCalendarEvents,
  syncCalendar,
};
