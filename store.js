// localStorage persistence. Falls back to memory when storage is blocked,
// so the app still works for the session.
import { TOPICS } from './data/topics.js';

export const KEYS = Object.freeze({
  settings: 'mpsg:settings',
  progress: 'mpsg:progress',
  quiz: 'mpsg:quiz',
  scheme: 'mpsg:scheme',
});

const TOPIC_IDS = TOPICS.map((t) => t.id);

export const DEFAULT_SETTINGS = Object.freeze({
  newPerDay: 15,      // new cards introduced per daily session
  maxReviews: 150,    // cap on due reviews per daily session
  order: 'mixed',     // 'mixed' (round-robin across topics) | 'topic' (one topic at a time)
  pace: 1,            // interval multiplier: <1 = see cards more often, >1 = less often
  topics: TOPIC_IDS,  // topics being studied
  focus: 'all',       // the Cards tab's topic filter: 'all' or one topic id
  examDate: '',       // 'YYYY-MM-DD', or '' when not set
  name: '',           // first name for the greeting, optional
});

const memory = new Map();

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return memory.get(key);
  }
}

function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const emptyProgress = () => ({
  v: 1,
  cards: {},                                    // card id -> packed card [i, e, d, n, l]
  daily: { day: -1, new: 0, rev: 0, done: 0, extra: 0 },
  log: {},                                      // day number -> answers given
});

export const emptyQuiz = () => ({
  v: 1,
  answers: {},   // question id -> [last answer right (1/0), times answered, times right]
  history: [],   // most recent first: { t, mode, topic, n, right, secs }
  log: {},       // day number -> questions answered
});

const num = (v, min, max, fallback) =>
  v !== '' && v !== null && Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : fallback;

export function sanitizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  const topics = Array.isArray(s.topics) ? TOPIC_IDS.filter((id) => s.topics.includes(id)) : [];
  const focus = s.focus === 'all' || TOPIC_IDS.includes(s.focus) ? s.focus : d.focus;
  return {
    newPerDay: Math.round(num(s.newPerDay, 0, 100, d.newPerDay)),
    maxReviews: Math.round(num(s.maxReviews, 10, 500, d.maxReviews)),
    order: ['mixed', 'topic'].includes(s.order) ? s.order : d.order,
    pace: num(s.pace, 0.5, 2, d.pace),
    topics: topics.length ? topics : [...d.topics],
    focus,
    examDate: typeof s.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.examDate) ? s.examDate : '',
    name: typeof s.name === 'string' ? s.name.trim().slice(0, 40) : '',
  };
}

/** @param {Set<string>|null} ids  known card ids, or null to keep any id */
export function sanitizeProgress(p, ids) {
  const out = emptyProgress();
  if (!p || typeof p !== 'object') return out;
  for (const [id, a] of Object.entries(p.cards ?? {})) {
    if (ids && !ids.has(id)) continue;
    if (!Array.isArray(a) || a.length !== 5 || !a.every(Number.isFinite)) continue;
    out.cards[id] = a;
  }
  for (const [day, count] of Object.entries(p.log ?? {})) {
    if (Number.isFinite(+day) && Number.isFinite(count)) out.log[day] = count;
  }
  if (p.daily && Number.isFinite(p.daily.day)) out.daily = { ...out.daily, ...p.daily };
  return out;
}

export function sanitizeQuiz(q) {
  const out = emptyQuiz();
  if (!q || typeof q !== 'object') return out;
  for (const [id, a] of Object.entries(q.answers ?? {})) {
    if (Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) out.answers[id] = a;
  }
  if (Array.isArray(q.history)) {
    out.history = q.history
      .filter((h) => h && Number.isFinite(h.t) && Number.isFinite(h.n) && Number.isFinite(h.right))
      .slice(0, 50);
  }
  for (const [day, count] of Object.entries(q.log ?? {})) {
    if (Number.isFinite(+day) && Number.isFinite(count)) out.log[day] = count;
  }
  return out;
}

export const loadSettings = () => sanitizeSettings(read(KEYS.settings));
export const saveSettings = (s) => write(KEYS.settings, s);
export const loadProgress = () => sanitizeProgress(read(KEYS.progress), null);
export const saveProgress = (p) => write(KEYS.progress, p);
export const loadQuiz = () => sanitizeQuiz(read(KEYS.quiz));
export const saveQuiz = (q) => write(KEYS.quiz, q);

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
