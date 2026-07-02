// Gmail scanning: pulls recent inbox messages and applies lightweight
// keyword heuristics to surface likely new tasks or task completions.
// This is pattern-matching, not an LLM — every hit is presented to the
// user as a suggestion that requires explicit confirmation before it
// touches any task.

// Keywords that signal a buyer/renter is inquiring about a property
const INQUIRY_KEYWORDS = [
  "interested in", "schedule a showing", "schedule a viewing", "book a showing",
  "like to see", "like to tour", "love to see", "want to see", "like to view",
  "available for a showing", "available to show", "can we see", "can i see",
  "make an offer", "submit an offer", "write an offer",
  "is this still available", "still on the market", "asking price",
  "more information about", "more info about", "send me more info",
  "property at", "listing at", "home at", "house at",
  "open house", "pre-approval", "pre approval",
];

// Address words to skip when fuzzy-matching email text to a property
const ADDR_STOP_WORDS = new Set([
  "st","ave","rd","blvd","dr","ln","ct","way","pl","the","and","of","a","an",
  "street","avenue","road","boulevard","drive","lane","court","place",
]);

const COMPLETION_PHRASES = [
  "done", "completed", "finished", "wrapped up", "sent over", "sent the",
  "closed", "signed", "all set", "took care of", "handled", "submitted",
  "wired", "finalized", "confirmed the",
];

const CREATION_PHRASES = [
  "can you", "could you", "please send", "please follow up", "need you to",
  "follow up on", "schedule a", "let's schedule", "don't forget to",
  "make sure to", "reminder to", "asap", "by end of day", "deadline",
  "due by", "due on",
];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function decodeBase64Url(data) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeURIComponent(escape(atob(normalized)));
  } catch (err) {
    return "";
  }
}

function extractPlainText(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  return "";
}

function getHeader(message, name) {
  const headers = message.payload?.headers || [];
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : "";
}

async function fetchRecentMessages(token, maxResults = 15) {
  const listRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=newer_than:2d in:inbox`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`);
  const listData = await listRes.json();
  const ids = (listData.messages || []).map((m) => m.id);

  const messages = [];
  for (const id of ids) {
    const res = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) continue;
    const data = await res.json();
    messages.push({
      id: data.id,
      subject: getHeader(data, "Subject"),
      from: getHeader(data, "From"),
      snippet: data.snippet || "",
      body: extractPlainText(data.payload).slice(0, 2000),
      internalDate: Number(data.internalDate) || Date.now(),
    });
  }
  return messages;
}

function parseDeadlineFromText(text) {
  const lower = text.toLowerCase();
  const now = new Date();

  if (/\btoday\b|\beod\b|\bend of day\b/.test(lower)) {
    const d = new Date(now);
    d.setHours(17, 0, 0, 0);
    return d.getTime();
  }
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(17, 0, 0, 0);
    return d.getTime();
  }
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (lower.includes(WEEKDAYS[i])) {
      const d = new Date(now);
      const todayIdx = d.getDay();
      let diff = i - todayIdx;
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      d.setHours(17, 0, 0, 0);
      return d.getTime();
    }
  }
  const dateMatch = lower.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (dateMatch) {
    const month = Number(dateMatch[1]) - 1;
    const day = Number(dateMatch[2]);
    const d = new Date(now.getFullYear(), month, day, 17, 0, 0, 0);
    if (d.getTime() < now.getTime()) d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  return null;
}

function titleFromSubject(subject) {
  return subject.replace(/^(re|fwd|fw):\s*/i, "").trim();
}

function findMatchingProperty(text, properties) {
  if (!properties || properties.length === 0) return null;
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const prop of properties) {
    if (!prop.address) continue;
    const words = prop.address.toLowerCase()
      .split(/[\s,]+/)
      .filter((w) => w.length > 2 && !ADDR_STOP_WORDS.has(w));
    if (words.length === 0) continue;
    const hits = words.filter((w) => lower.includes(w)).length;
    const score = hits / words.length;
    if (score >= 0.5 && score > bestScore) { best = prop; bestScore = score; }
  }
  return best;
}

function findMatchingOpenTask(text, tasks) {
  const lower = text.toLowerCase();
  return tasks.find((t) => {
    if (t.completed) return false;
    const words = t.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.length === 0) return false;
    const hits = words.filter((w) => lower.includes(w)).length;
    return hits / words.length >= 0.5;
  });
}

function detectSuggestions(messages, existingTasks, existingSuggestions, properties = []) {
  const suggestions = [];
  const seenKeys = new Set(existingSuggestions.map((s) => `${s.sourceEmailId}:${s.type}`));

  for (const message of messages) {
    const text = `${message.subject} ${message.snippet} ${message.body}`;
    const lower = text.toLowerCase();

    // ── Property inquiry detection (highest priority) ─────────────────────────
    const hasInquiryPhrase = INQUIRY_KEYWORDS.some((p) => lower.includes(p));
    if (hasInquiryPhrase) {
      const matchedProp = findMatchingProperty(text, properties);
      const key = `${message.id}:inquiry`;
      if (!seenKeys.has(key)) {
        const senderName = (message.from || "").replace(/<[^>]+>/, "").trim() || "Unknown sender";
        suggestions.push({
          id: key,
          type: "property_inquiry",
          propId: matchedProp ? matchedProp.id : null,
          propAddress: matchedProp ? matchedProp.address : null,
          title: `Reply to inquiry — ${escapeForStorage(senderName)}`,
          sourceEmailId: message.id,
          sourceSubject: message.subject,
          snippet: message.snippet,
          from: message.from,
          createdAt: Date.now(),
        });
        seenKeys.add(key);
      }
      continue;
    }

    // ── Existing-task completion signal ───────────────────────────────────────
    const matchedTask = findMatchingOpenTask(text, existingTasks);
    const hasCompletionPhrase = COMPLETION_PHRASES.some((p) => lower.includes(p));
    if (matchedTask && hasCompletionPhrase) {
      const key = `${message.id}:complete`;
      if (!seenKeys.has(key)) {
        suggestions.push({
          id: key,
          type: "complete",
          taskId: matchedTask.id,
          title: matchedTask.title,
          sourceEmailId: message.id,
          sourceSubject: message.subject,
          snippet: message.snippet,
          from: message.from,
          createdAt: Date.now(),
        });
        seenKeys.add(key);
      }
      continue;
    }

    // ── New task creation signal ───────────────────────────────────────────────
    const hasCreationPhrase = CREATION_PHRASES.some((p) => lower.includes(p));
    if (hasCreationPhrase && !matchedTask) {
      const key = `${message.id}:create`;
      if (!seenKeys.has(key)) {
        const deadline = parseDeadlineFromText(text) || Date.now() + 24 * 60 * 60 * 1000;
        suggestions.push({
          id: key,
          type: "create",
          title: titleFromSubject(message.subject) || message.snippet.slice(0, 60),
          deadline,
          sourceEmailId: message.id,
          sourceSubject: message.subject,
          snippet: message.snippet,
          from: message.from,
          createdAt: Date.now(),
        });
        seenKeys.add(key);
      }
    }
  }

  return suggestions;
}

function escapeForStorage(str) {
  return str.replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" }[c]));
}

async function scanGmail() {
  const token = await self.TierAuth.getAuthToken(true);
  const [messages, tasks, existingSuggestions] = await Promise.all([
    fetchRecentMessages(token),
    self.TierStorage.getTasks(),
    self.TierStorage.getSuggestions(),
  ]);

  const newSuggestions = detectSuggestions(messages, tasks, existingSuggestions);
  if (newSuggestions.length > 0) {
    await self.TierStorage.addSuggestions(newSuggestions);
  }
  return newSuggestions;
}

self.TierGmail = {
  fetchRecentMessages,
  parseDeadlineFromText,
  detectSuggestions,
  scanGmail,
};
