import { schedule, bucket, pack, unpack, dayNumber, dateOfDay, newCardOrder, AGAIN } from './srs.js';
import {
  KEYS, emptyProgress, emptyQuiz, loadProgress, saveProgress, loadQuiz, saveQuiz, loadSettings, saveSettings,
  sanitizeProgress, sanitizeQuiz, sanitizeSettings, requestPersistence,
} from './store.js';
import { TOPICS, TOPIC_BY_ID, topicOf } from './data/topics.js';
import { CARDS } from './data/cards.js';
import { QUESTIONS } from './data/questions.js';
import { FORMULAS, CONSTANTS, NUCLIDES } from './data/reference.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const nf = new Intl.NumberFormat('en');

// ───────── Data ─────────
const deck = CARDS.map(([id, front, back, more = '']) => ({ id, topic: topicOf(id), front, back, more }));
const byId = new Map(deck.map((c, i) => [c.id, i]));
const questions = QUESTIONS.map(([id, text, choices, correct, why]) => ({ id, topic: topicOf(id), text, choices, correct, why }));
const qById = new Map(questions.map((q) => [q.id, q]));
const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ───────── State ─────────
let settings = loadSettings();
let progress = emptyProgress();
let quiz = emptyQuiz();
let today = dayNumber();
let queue = [];            // [{ id: deck index, kind: 'new' | 'learning' | 'review' }]
let flipped = false;
let undoState = null;
let run = null;            // the practice session in progress, if any
let lastRun = null;        // { mode, topic } of the last finished session, for "Another round"

const cardState = (i) => progress.cards[deck[i].id];
const studied = (topic) => settings.topics.includes(topic);
const focusTopic = () => (settings.focus !== 'all' && studied(settings.focus) ? settings.focus : 'all');
const inFocus = (i) => studied(deck[i].topic) && (focusTopic() === 'all' || deck[i].topic === focusTopic());

// ───────── Boot ─────────
function init() {
  progress = loadProgress();
  quiz = loadQuiz();
  buildStatic();
  wireEvents();
  fillSettingsForm();
  startSession();
  route();
  registerServiceWorker();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** An element whose content is trusted markup from the data files. */
function html(tag, className, markup) {
  const node = el(tag, className);
  node.innerHTML = markup;
  return node;
}

function topicTag(node, topicId, long = false) {
  const t = TOPIC_BY_ID[topicId];
  node.textContent = `${t.icon} ${long ? t.name : t.short}`;
  node.style.setProperty('--h', t.hue);
}

// ───────── Flashcard session ─────────
function ensureToday() {
  today = dayNumber();
  if (progress.daily.day !== today) {
    progress.daily = { day: today, new: 0, rev: 0, done: 0, extra: 0 };
  }
}

/** Today's work, across the cards that pass `include`. */
function todaysWork(include) {
  const { daily } = progress;
  const learning = [];
  const due = [];
  deck.forEach((c, i) => {
    const s = progress.cards[c.id];
    if (!s || !include(i)) return;
    if (s[0] === 0) learning.push(i);
    else if (s[2] <= today) due.push(i);
  });
  due.sort((a, b) => cardState(a)[2] - cardState(b)[2] || a - b);
  due.length = Math.min(due.length, Math.max(0, settings.maxReviews - daily.rev));
  const fresh = pickNew(Math.max(0, settings.newPerDay + daily.extra - daily.new), include);
  return { learning, due, fresh };
}

function startSession() {
  ensureToday();
  undoState = null;
  const { learning, due, fresh } = todaysWork(inFocus);

  // Spread new cards evenly among the reviews so a session doesn't front-load them.
  const mixed = due.map((id) => ({ id, kind: 'review' }));
  const gap = (mixed.length + fresh.length) / (fresh.length || 1);
  fresh.forEach((id, k) => mixed.splice(Math.min(mixed.length, Math.round(k * gap)), 0, { id, kind: 'new' }));

  queue = [...learning.map((id) => ({ id, kind: 'learning' })), ...mixed];
  renderStudy();
}

const orderCache = {};

/** The next `count` unseen cards that pass `include`, in the chosen order. */
function pickNew(count, include) {
  if (count <= 0) return [];
  const order = (orderCache[settings.order] ??= newCardOrder(settings.order, deck));
  const picked = [];
  for (const i of order) {
    if (cardState(i) || !include(i)) continue;
    picked.push(i);
    if (picked.length === count) break;
  }
  return picked;
}

const unseenCount = (include) => deck.reduce((n, c, i) => n + (include(i) && !progress.cards[c.id] ? 1 : 0), 0);
const studiedCard = (i) => studied(deck[i].topic);

function answer(rating) {
  const item = queue[0];
  if (!item || !flipped) return;
  ensureToday();
  const key = deck[item.id].id;
  const prev = progress.cards[key];
  undoState = {
    key,
    prev: prev ? [...prev] : null,
    daily: { ...progress.daily },
    logged: progress.log[today] ?? 0,
    queue: queue.map((q) => ({ ...q })),
  };

  const next = schedule(unpack(prev), rating, today, settings.pace);
  progress.cards[key] = pack(next);
  if (!prev) progress.daily.new += 1;
  else if (prev[0] > 0) progress.daily.rev += 1;
  progress.log[today] = (progress.log[today] ?? 0) + 1;

  queue.shift();
  if (next.i === 0) {
    // Forgotten: show it again a few cards later in this same session.
    queue.splice(Math.min(queue.length, 4), 0, { id: item.id, kind: 'learning' });
  } else {
    progress.daily.done += 1;
  }
  persist();
  if (rating !== AGAIN) requestPersistence();
  renderStudy();
  if (!queue.length) celebrate();
}

function undo() {
  if (!undoState) return;
  const u = undoState;
  if (u.prev) progress.cards[u.key] = u.prev;
  else delete progress.cards[u.key];
  progress.daily = u.daily;
  if (u.logged) progress.log[today] = u.logged;
  else delete progress.log[today];
  queue = u.queue;
  undoState = null;
  persist();
  renderStudy();
}

function persist() {
  if (!saveProgress(progress)) toast('Could not save — browser storage is unavailable.');
}

function renderFocusBar() {
  const current = focusTopic();
  const make = (value, label, hue) => {
    const lab = el('label', 'focus-chip');
    const input = el('input');
    input.type = 'radio';
    input.name = 'focus';
    input.value = value;
    input.checked = value === current;
    if (hue != null) lab.style.setProperty('--h', hue);
    lab.append(input, el('span', '', label));
    return lab;
  };
  $('focus-bar').replaceChildren(
    make('all', 'All topics'),
    ...TOPICS.filter((t) => studied(t.id)).map((t) => make(t.id, `${t.icon} ${t.short}`, t.hue)),
  );
}

function renderStudy() {
  const item = queue[0];
  $('undo').hidden = !undoState;
  $('session').hidden = !item;
  $('done').hidden = !!item;
  if (!item) return renderDone();

  const count = (kind) => queue.filter((q) => q.kind === kind).length;
  $('count-new').textContent = count('new');
  $('count-learning').textContent = count('learning');
  $('count-review').textContent = count('review');
  const bar = $('session-bar');
  bar.max = progress.daily.done + queue.length;
  bar.value = progress.daily.done;

  const card = deck[item.id];
  const node = $('card');
  node.style.setProperty('--h', TOPIC_BY_ID[card.topic].hue);

  // Reset to the front without animating (which would flash the next answer).
  node.classList.add('instant');
  setFlipped(false);
  topicTag($('front-topic'), card.topic, true);
  topicTag($('back-topic'), card.topic, true);
  $('question').innerHTML = card.front;
  $('question-back').innerHTML = card.front;
  $('answer').innerHTML = card.back;
  $('more-text').innerHTML = card.more;
  $('badge-new').hidden = item.kind !== 'new';
  void node.offsetWidth;
  node.classList.remove('instant');
  if (!reducedMotion.matches) {
    node.animate(
      [{ opacity: 0, transform: 'translateY(14px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'ease-out' },
    );
  }

  const current = unpack(cardState(item.id));
  for (const btn of document.querySelectorAll('.rate')) {
    const next = schedule(current, +btn.dataset.rating, today, settings.pace);
    btn.querySelector('small').textContent = fmtInterval(next.i);
  }
}

function fmtInterval(days) {
  const f = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
  if (days <= 0) return 'today';
  if (days < 30) return `${days} d`;
  if (days < 365) return `${f.format(days / 30)} mo`;
  return `${f.format(days / 365)} y`;
}

function setFlipped(value) {
  flipped = value;
  const focusOut = value ? $('show') : $('ratings');
  if (focusOut.contains(document.activeElement)) document.activeElement.blur();
  $('card').classList.toggle('flipped', value);
  $('face-front').inert = value;
  $('face-back').inert = !value;
  $('show').hidden = value;
  $('ratings').hidden = !value;
}

function reveal() {
  if (!queue[0] || flipped) return;
  setFlipped(true);
  $('ratings').querySelector('.rate-3').focus({ preventScroll: true });
}

function renderDone() {
  const tomorrow = deck.filter((c, i) => {
    const s = progress.cards[c.id];
    return s && inFocus(i) && s[0] > 0 && s[2] <= today + 1;
  }).length;
  const unseen = unseenCount(inFocus);
  $('done-today').textContent = progress.daily.done;
  $('done-streak').textContent = streak();
  $('done-tomorrow').textContent = tomorrow + Math.min(settings.newPerDay, unseen);
  const extra = Math.min(unseen, Math.max(5, settings.newPerDay));
  $('more').hidden = unseen === 0;
  $('more').textContent = `Learn ${extra} more new card${extra === 1 ? '' : 's'}`;
  $('more').dataset.extra = extra;
  const focus = focusTopic();
  $('done-title').textContent = focus === 'all' ? 'All done for today' : `${TOPIC_BY_ID[focus].short}: all done for today`;
  $('done-sub').textContent = unseen === 0
    ? 'You have seen every card here! Keep reviewing to lock it in, or try some practice questions.'
    : 'Nice work. Come back tomorrow to keep your memory fresh.';
}

/** Days in a row with any study (cards or questions), ending today or yesterday. */
function streak() {
  const active = (d) => progress.log[d] || quiz.log[d];
  let day = active(today) ? today : today - 1;
  let n = 0;
  while (active(day)) { n += 1; day -= 1; }
  return n;
}

// ───────── Today ─────────
function examDay() {
  if (!settings.examDate) return null;
  const [y, m, d] = settings.examDate.split('-').map(Number);
  return dayNumber(new Date(y, m - 1, d, 12));
}

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Burning the midnight oil' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return settings.name ? `${part}, ${settings.name}` : part;
}

function renderToday() {
  ensureToday();
  $('today-date').textContent = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  $('greeting').textContent = greeting();

  // Exam countdown and plan
  const exam = examDay();
  const unseen = unseenCount(studiedCard);
  $('set-exam').hidden = exam !== null;
  $('countdown-show').hidden = exam === null;
  let sub = 'Flashcards, practice questions and formula sheets for your medical physics boards, a few minutes a day.';
  if (exam !== null) {
    const left = exam - today;
    $('countdown-days').textContent = Math.max(0, left);
    $('countdown-label').textContent = left > 1 ? 'days to your exam' : left === 1 ? 'day to go' : left === 0 ? 'Exam day!' : 'days since your exam';
    if (left < 0) $('countdown-days').textContent = -left;
    $('countdown-date').textContent = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(dateOfDay(exam));
    if (left === 0) sub = 'Today’s the day. Breathe, read each question twice, and trust your preparation. Good luck!';
    else if (left < 0) sub = 'How did it go? Set a new date in Settings if there’s another exam ahead, or keep reviewing to stay sharp.';
    else if (unseen === 0) sub = 'You’ve seen every card. Keep up the daily reviews and mock exams until the big day.';
    else if (settings.newPerDay > 0) {
      const finish = today + Math.ceil(unseen / settings.newPerDay);
      const fmt = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' });
      const buffer = Math.min(14, Math.floor(left / 3));
      if (finish <= exam - buffer) {
        sub = `At ${settings.newPerDay} new cards a day, you’ll have seen all ${nf.format(unseen + Object.keys(progress.cards).length)} cards by ${fmt.format(dateOfDay(finish))}, with time to review before your exam.`;
      } else {
        const need = Math.ceil(unseen / Math.max(1, left - buffer));
        sub = `To see every card with time to spare before your exam, aim for about ${need} new cards a day (you can change this in Settings).`;
      }
    }
  }
  $('hero-sub').textContent = sub;

  // Today's cards
  const { learning, due, fresh } = todaysWork(studiedCard);
  const remaining = learning.length + due.length + fresh.length;
  const done = progress.daily.done;
  const total = done + remaining;
  setRing($('today-ring-fill'), total ? done / total : 1);
  $('today-ring-text').textContent = remaining || '✓';
  const mins = Math.max(1, Math.round((due.length * 8 + learning.length * 8 + fresh.length * 20) / 60));
  if (remaining) {
    const parts = [];
    if (due.length + learning.length) parts.push(`${nf.format(due.length + learning.length)} to review`);
    if (fresh.length) parts.push(`${nf.format(fresh.length)} new`);
    $('today-cards-sub').textContent = `${parts.join(' · ')} — about ${mins} min.`;
    $('today-cards-btn').textContent = done ? 'Keep going' : 'Start studying';
  } else {
    $('today-cards-sub').textContent = done ? `All ${done} done for today. Great work!` : 'Nothing due right now.';
    $('today-cards-btn').textContent = 'Learn more cards';
  }
  $('today-cards-btn').onclick = () => {
    if (settings.focus !== 'all') { updateSettings({ focus: 'all' }); startSession(); renderFocusBar(); }
  };

  // Practice
  const last = quiz.history[0];
  $('today-quiz-sub').textContent = last
    ? `Last time: ${last.right} of ${last.n} (${Math.round((100 * last.right) / last.n)}%) on ${modeLabel(last)}.`
    : `${questions.length} exam-style questions with worked explanations.`;

  // Tiles
  $('t-streak').textContent = streak();
  $('t-learned').textContent = nf.format(deck.filter((c) => (progress.cards[c.id]?.[0] ?? 0) > 0).length);
  const acc = accuracy(questions);
  $('t-accuracy').textContent = acc === null ? '–' : `${acc}%`;

  renderTip();
  renderTopicGrid();
}

function setRing(circle, fraction) {
  const c = 2 * Math.PI * 52;
  circle.style.strokeDasharray = `${c}`;
  circle.style.strokeDashoffset = `${c * (1 - Math.max(0, Math.min(1, fraction)))}`;
}

/** Percent right on the latest answer to each of `qs`, or null if none answered. */
function accuracy(qs) {
  let n = 0, right = 0;
  for (const q of qs) {
    const a = quiz.answers[q.id];
    if (!a) continue;
    n += a[1];
    right += a[2];
  }
  return n ? Math.round((100 * right) / n) : null;
}

function renderTip() {
  const facts = TOPICS.filter((t) => studied(t.id)).flatMap((t) => t.outline.map((text) => ({ t, text })));
  if (!facts.length) return;
  // A fixed shuffle, so the fact changes daily but doesn't repeat for a while.
  const k = (today * 7919) % facts.length;
  const { t, text } = facts[(k + facts.length) % facts.length];
  $('tip-text').innerHTML = text;
  topicTag($('tip-topic'), t.id, true);
}

function renderTopicGrid() {
  $('topic-grid').replaceChildren(...TOPICS.map((t) => {
    const cards = deck.filter((c) => c.topic === t.id);
    const learned = cards.filter((c) => (progress.cards[c.id]?.[0] ?? 0) > 0).length;
    const qs = questions.filter((q) => q.topic === t.id);
    const acc = accuracy(qs);
    const li = el('li', `topic-tile${studied(t.id) ? '' : ' paused'}`);
    li.style.setProperty('--h', t.hue);
    const head = el('div', 'tt-head');
    head.append(el('span', 'tt-icon', t.icon), el('h3', '', t.name));
    const meter = el('span', 'meter');
    const fill = el('span');
    fill.style.inlineSize = `${(100 * learned) / cards.length}%`;
    meter.append(fill);
    const stats = el('p', 'tt-stats', `${learned}/${cards.length} cards${acc === null ? '' : ` · ${acc}% on questions`}`);
    if (!studied(t.id)) stats.textContent = 'Paused (turn it on in Settings)';
    const actions = el('div', 'tt-actions');
    const study = el('button', 'tt-btn', 'Cards');
    study.type = 'button';
    study.dataset.focus = t.id;
    const drill = el('button', 'tt-btn', 'Questions');
    drill.type = 'button';
    drill.dataset.start = 'drill';
    drill.dataset.topic = t.id;
    const notes = el('a', 'tt-btn', 'Notes');
    notes.href = `#guide`;
    notes.dataset.notes = t.id;
    actions.append(study, drill, notes);
    if (!studied(t.id)) { study.disabled = true; drill.disabled = true; }
    li.append(head, el('p', 'tt-blurb', t.blurb), meter, stats, actions);
    return li;
  }));
}

// ───────── Practice ─────────
const MODE_NAMES = { quick: 'Quick 10', drill: 'Topic drill', mock: 'Mock exam', missed: 'Review mistakes' };
const modeLabel = (h) => (h.mode === 'drill' && TOPIC_BY_ID[h.topic] ? `${TOPIC_BY_ID[h.topic].short} drill` : MODE_NAMES[h.mode] ?? 'Practice');
const MOCK_SIZE = 40;
const MOCK_SECONDS_PER_Q = 90;

function shuffled(list) {
  const a = [...list];
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [a[k], a[j]] = [a[j], a[k]];
  }
  return a;
}

function pool() {
  return questions.filter((q) => studied(q.topic));
}

const missedQuestions = () => pool().filter((q) => quiz.answers[q.id]?.[0] === 0);

function pickQuestions(mode, topic) {
  if (mode === 'drill') return shuffled(questions.filter((q) => q.topic === topic));
  if (mode === 'missed') return shuffled(missedQuestions());
  if (mode === 'mock') {
    // Round-robin across the topics so the exam is balanced.
    const lanes = TOPICS.filter((t) => studied(t.id)).map((t) => shuffled(pool().filter((q) => q.topic === t.id)));
    const out = [];
    for (let r = 0; out.length < MOCK_SIZE && lanes.some((l) => l.length > r); r++) {
      for (const lane of shuffled(lanes)) if (lane[r] && out.length < MOCK_SIZE) out.push(lane[r]);
    }
    return shuffled(out);
  }
  // Quick: unseen and missed questions first, then the rest, with some randomness.
  const score = (q) => {
    const a = quiz.answers[q.id];
    return (a ? (a[0] ? 2 : 1) : 0) + Math.random() * 1.5;
  };
  return pool().map((q) => [score(q), q]).sort((a, b) => a[0] - b[0]).slice(0, 10).map(([, q]) => q);
}

function startRun(mode, topic = null) {
  if (run) stopTimer();
  const qs = pickQuestions(mode, topic);
  if (!qs.length) {
    toast(mode === 'missed' ? 'No mistakes to review. Nice!' : 'No questions in the topics you’re studying.');
    return;
  }
  run = {
    mode, topic,
    items: qs.map((q) => ({ id: q.id, order: shuffled(q.choices.map((_, k) => k)), picked: null })),
    i: 0,
    instant: mode !== 'mock',
    started: Date.now(),
    deadline: mode === 'mock' ? Date.now() + qs.length * MOCK_SECONDS_PER_Q * 1000 : null,
  };
  lastRun = { mode, topic };
  if (location.hash !== '#practice') location.hash = '#practice';
  else renderPractice();
  if (run.deadline) startTimer();
  scrollTo({ top: 0 });
}

let timerId = null;
function startTimer() {
  stopTimer();
  const tick = () => {
    if (!run?.deadline) return stopTimer();
    const left = Math.max(0, Math.round((run.deadline - Date.now()) / 1000));
    $('timer').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('timer').classList.toggle('low', left <= 300);
    if (left === 0) {
      stopTimer();
      toast('Time’s up!');
      finishRun();
    }
  };
  tick();
  timerId = setInterval(tick, 1000);
}
function stopTimer() { clearInterval(timerId); timerId = null; }

function renderPractice() {
  const showRun = !!run;
  const showResults = !run && !!$('practice-results').dataset.ready;
  $('practice-home').hidden = showRun || showResults;
  $('practice-run').hidden = !showRun;
  $('practice-results').hidden = !showResults;
  if (showRun) renderQuestion();
  else if (!showResults) renderPracticeHome();
}

function renderPracticeHome() {
  const sel = $('drill-topic');
  const keep = sel.value;
  sel.replaceChildren(...TOPICS.filter((t) => studied(t.id)).map((t) => {
    const o = el('option', '', `${t.icon} ${t.name} (${questions.filter((q) => q.topic === t.id).length})`);
    o.value = t.id;
    return o;
  }));
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  const n = Math.min(MOCK_SIZE, pool().length);
  $('mock-help').textContent = `${n} questions in ${Math.round((n * MOCK_SECONDS_PER_Q) / 60)} minutes, scored at the end, like the real thing.`;
  const missed = missedQuestions().length;
  $('missed-help').textContent = missed
    ? `${missed} question${missed === 1 ? '' : 's'} you got wrong last time.`
    : 'Questions you got wrong last time. None yet!';
  $('mode-missed').disabled = !missed;

  $('history-panel').hidden = !quiz.history.length;
  const fmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
  $('history').replaceChildren(...quiz.history.slice(0, 8).map((h) => {
    const li = el('li');
    const pct = Math.round((100 * h.right) / h.n);
    const badge = el('b', `pct ${pct >= 80 ? 'hi' : pct >= 60 ? 'mid' : 'lo'}`, `${pct}%`);
    li.append(el('span', 'h-date', fmt.format(new Date(h.t))), el('span', 'h-mode', modeLabel(h)), el('span', 'h-score', `${h.right}/${h.n}`), badge);
    return li;
  }));
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function renderQuestion() {
  const item = run.items[run.i];
  const q = qById.get(item.id);
  $('run-count').textContent = `${modeLabel(run)} · ${run.i + 1} of ${run.items.length}`;
  $('timer').hidden = !run.deadline;
  $('run-bar').max = run.items.length;
  $('run-bar').value = run.i;
  topicTag($('q-topic'), q.topic, true);
  $('qcard').style.setProperty('--h', TOPIC_BY_ID[q.topic].hue);
  $('q-text').innerHTML = q.text;
  const answered = item.picked !== null;
  const reveal = answered && run.instant;
  $('choices').replaceChildren(...item.order.map((k, pos) => {
    const li = el('li');
    const btn = el('button', 'choice-btn');
    btn.type = 'button';
    btn.dataset.pos = pos;
    btn.append(el('span', 'letter', LETTERS[pos]), html('span', 'choice-text', q.choices[k]));
    if (item.picked === pos) btn.classList.add('picked');
    if (reveal) {
      btn.disabled = true;
      if (k === q.correct) btn.classList.add('right');
      else if (item.picked === pos) btn.classList.add('wrong');
    }
    li.append(btn);
    return li;
  }));
  $('feedback').hidden = !reveal;
  if (reveal) {
    const right = item.order[item.picked] === q.correct;
    $('feedback').className = `feedback ${right ? 'right' : 'wrong'}`;
    $('feedback-verdict').textContent = right ? pick(['Correct!', 'Nailed it.', 'Exactly right.', 'Yes!']) : `Not quite — the answer is ${LETTERS[item.order.indexOf(q.correct)]}.`;
    $('feedback-text').innerHTML = q.why;
  }
  const last = run.i === run.items.length - 1;
  $('next').hidden = !answered;
  $('next').firstChild.textContent = last ? 'See results ' : 'Next ';
  if (answered) $('next').focus({ preventScroll: true });
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function choose(pos) {
  if (!run) return;
  const item = run.items[run.i];
  if (item.picked !== null && run.instant) return;
  item.picked = pos;
  renderQuestion();
  if (run.instant) $('feedback').scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

function nextQuestion() {
  if (!run || run.items[run.i].picked === null) return;
  if (run.i === run.items.length - 1) return finishRun();
  run.i += 1;
  renderQuestion();
  $('qcard').scrollIntoView({ block: 'nearest' });
}

function finishRun() {
  if (!run) return;
  stopTimer();
  const r = run;
  run = null;
  // Practice modes score what was answered; the mock exam scores every question.
  const scored = r.mode === 'mock' ? r.items : r.items.filter((it) => it.picked !== null);
  if (!scored.length) { renderPractice(); return; }
  ensureToday();
  let right = 0;
  const results = scored.map((it) => {
    const q = qById.get(it.id);
    const ok = it.picked !== null && it.order[it.picked] === q.correct;
    if (ok) right += 1;
    if (it.picked !== null) {
      const a = quiz.answers[q.id] ?? [0, 0, 0];
      quiz.answers[q.id] = [ok ? 1 : 0, a[1] + 1, a[2] + (ok ? 1 : 0)];
    }
    return { q, it, ok };
  });
  const answeredCount = scored.filter((it) => it.picked !== null).length;
  quiz.log[today] = (quiz.log[today] ?? 0) + answeredCount;
  quiz.history.unshift({ t: Date.now(), mode: r.mode, topic: r.topic, n: scored.length, right, secs: Math.round((Date.now() - r.started) / 1000) });
  quiz.history = quiz.history.slice(0, 50);
  if (!saveQuiz(quiz)) toast('Could not save — browser storage is unavailable.');
  requestPersistence();
  renderResults(r, results, right);
  $('practice-results').dataset.ready = '1';
  renderPractice();
  scrollTo({ top: 0 });
}

function renderResults(r, results, right) {
  const n = results.length;
  const pct = Math.round((100 * right) / n);
  setRing($('score-ring-fill'), right / n);
  $('score-ring').style.setProperty('--h', pct >= 80 ? 150 : pct >= 60 ? 75 : 25);
  $('score-pct').textContent = `${pct}%`;
  $('score-title').textContent = pct >= 90 ? 'Outstanding!' : pct >= 80 ? 'Great work!' : pct >= 65 ? 'Solid progress' : pct >= 50 ? 'Getting there' : 'Keep at it';
  const mins = Math.round((Date.now() - r.started) / 60000);
  $('score-sub').textContent = `${right} of ${n} right on ${modeLabel(r)}${mins ? ` in ${mins} min` : ''}. ${pct >= 80 ? 'That’s passing territory.' : 'Read the explanations below — the misses are your best study material.'}`;
  if (pct >= 80) celebrate();

  const perTopic = new Map();
  for (const { q, ok } of results) {
    const t = perTopic.get(q.topic) ?? { n: 0, right: 0 };
    t.n += 1;
    t.right += ok ? 1 : 0;
    perTopic.set(q.topic, t);
  }
  $('result-topics').replaceChildren(...TOPICS.filter((t) => perTopic.has(t.id)).map((t) => {
    const { n: tn, right: tr } = perTopic.get(t.id);
    return topicBar(t, `${tr} / ${tn}`, tr / tn);
  }));

  const ordered = [...results.filter((x) => !x.ok), ...results.filter((x) => x.ok)];
  $('review').replaceChildren(...ordered.map(({ q, it, ok }) => {
    const li = el('li', ok ? 'ok' : 'miss');
    const det = el('details');
    det.open = !ok;
    const sum = el('summary');
    sum.append(el('span', 'mark', ok ? '✓' : '✗'), html('span', 'rq', q.text));
    const body = el('div', 'rbody');
    const yours = it.picked === null ? 'No answer' : q.choices[it.order[it.picked]];
    if (!ok) body.append(html('p', 'yours', `<b>Your answer:</b> ${yours}`));
    body.append(html('p', 'correct', `<b>Answer:</b> ${q.choices[q.correct]}`), html('p', 'why', q.why));
    det.append(sum, body);
    li.append(det);
    return li;
  }));
}

function topicBar(t, label, fraction, second = null) {
  const li = el('li');
  li.style.setProperty('--h', t.hue);
  const name = el('span', 'label', `${t.icon} ${t.name}`);
  if (!studied(t.id)) name.append(el('span', 'paused', 'paused'));
  const meter = el('span', 'meter');
  const fill = el('span');
  fill.style.inlineSize = `${fraction * 100}%`;
  meter.append(fill);
  li.append(name, el('b', '', label), meter);
  if (second) {
    const m2 = el('span', 'meter meter-quiz');
    const f2 = el('span');
    f2.style.inlineSize = `${second.fraction * 100}%`;
    m2.append(f2);
    li.append(el('span', 'sublabel', second.label), m2);
  }
  return li;
}

// ───────── Guide ─────────
function guideMode() {
  return document.querySelector('input[name="guide"]:checked')?.value ?? 'topics';
}

function renderGuide() {
  const query = $('guide-search').value.trim().toLowerCase();
  const body = $('guide-body');
  if (query) return body.replaceChildren(...searchResults(query));
  const mode = guideMode();
  if (mode === 'topics') body.replaceChildren(...TOPICS.map((t) => topicNotes(t)));
  else if (mode === 'formulas') body.replaceChildren(...formulaSections(FORMULAS), constantsTable());
  else if (mode === 'nuclides') body.replaceChildren(nuclideTable(NUCLIDES));
  else body.replaceChildren(...TOPICS.map((t) => cardSection(t, deck.filter((c) => c.topic === t.id))));
}

function topicNotes(t, open = false) {
  const det = el('details', 'notes');
  det.id = `notes-${t.id}`;
  det.open = open;
  det.style.setProperty('--h', t.hue);
  const sum = el('summary');
  const title = el('span', 'n-title');
  title.append(el('span', 'tt-icon', t.icon), el('b', '', t.name));
  if (!studied(t.id)) title.append(el('span', 'paused', 'paused'));
  sum.append(title, el('span', 'n-blurb', t.blurb));
  const ul = el('ul', 'outline');
  for (const point of t.outline) ul.append(html('li', '', point));
  const fs = FORMULAS.filter(([id]) => topicOf(id) === t.id);
  const actions = el('div', 'btn-row');
  const study = el('button', 'soft-btn', 'Study these cards');
  study.type = 'button';
  study.dataset.focus = t.id;
  const drill = el('button', 'soft-btn', 'Practice questions');
  drill.type = 'button';
  drill.dataset.start = 'drill';
  drill.dataset.topic = t.id;
  if (!studied(t.id)) { study.disabled = true; drill.disabled = true; }
  actions.append(study, drill);
  const inner = el('div', 'n-body');
  inner.append(el('h4', '', 'High-yield points'), ul);
  if (fs.length) inner.append(el('h4', '', 'Formulas'), formulaList(fs));
  inner.append(actions);
  det.append(sum, inner);
  return det;
}

function formulaList(list) {
  const ul = el('ul', 'formulas');
  for (const [, name, formula, note] of list) {
    const li = el('li', 'formula');
    li.append(el('span', 'f-name', name), html('span', 'f-eq', formula));
    if (note) li.append(html('span', 'f-note', note));
    ul.append(li);
  }
  return ul;
}

function formulaSections(list) {
  return TOPICS.filter((t) => list.some(([id]) => topicOf(id) === t.id)).map((t) => {
    const sec = el('section', 'g-section');
    sec.style.setProperty('--h', t.hue);
    sec.append(el('h2', '', `${t.icon} ${t.name}`), formulaList(list.filter(([id]) => topicOf(id) === t.id)));
    return sec;
  });
}

function constantsTable(list = CONSTANTS) {
  const sec = el('section', 'g-section');
  sec.append(el('h2', '', '🔢 Key constants and units'));
  const dl = el('dl', 'constants');
  for (const [name, value] of list) {
    const row = el('div');
    row.append(el('dt', '', name), el('dd', '', value));
    dl.append(row);
  }
  sec.append(dl);
  return sec;
}

function nuclideTable(list) {
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'nuclides');
  const head = el('thead');
  const hr = el('tr');
  for (const h of ['Nuclide', 'Half-life', 'Decay', 'Main emissions', 'Use']) hr.append(el('th', '', h));
  head.append(hr);
  const tbody = el('tbody');
  for (const row of list) {
    const tr = el('tr');
    row.forEach((cell, k) => tr.append(el(k ? 'td' : 'th', '', cell)));
    tr.firstChild.scope = 'row';
    tbody.append(tr);
  }
  table.append(head, tbody);
  wrap.append(table);
  return wrap;
}

const STATUS = { new: 'Not seen yet', learning: 'Learning', young: 'Young', mature: 'Mastered' };

function cardSection(t, cards) {
  const sec = el('section', 'g-section');
  sec.style.setProperty('--h', t.hue);
  sec.append(el('h2', '', `${t.icon} ${t.name}`));
  const ul = el('ul', 'card-list');
  for (const c of cards) {
    const li = el('li');
    const btn = el('button', 'card-row');
    btn.type = 'button';
    btn.dataset.card = c.id;
    const b = bucket(unpack(progress.cards[c.id]));
    btn.append(el('span', `dot b-${b}`), html('span', 'cr-q', c.front));
    btn.title = STATUS[b];
    li.append(btn);
    ul.append(li);
  }
  sec.append(ul);
  return sec;
}

function searchResults(query) {
  const words = query.split(/\s+/).filter(Boolean);
  const hit = (...texts) => {
    const hay = strip(texts.join(' ')).toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const out = [];
  const notes = TOPICS.flatMap((t) => t.outline.filter((o) => hit(o)).map((o) => ({ t, o })));
  const fs = FORMULAS.filter(([, name, f, n]) => hit(name, f, n));
  const consts = CONSTANTS.filter(([n, v]) => hit(n, v));
  const nucs = NUCLIDES.filter((row) => hit(...row));
  const cards = deck.filter((c) => hit(c.front, c.back, c.more));
  if (notes.length) {
    const sec = el('section', 'g-section');
    sec.append(el('h2', '', `High-yield notes (${notes.length})`));
    const ul = el('ul', 'outline');
    for (const { t, o } of notes) {
      const li = html('li', '', o);
      const tag = el('span', 'topic-tag mini');
      topicTag(tag, t.id);
      li.prepend(tag, ' ');
      ul.append(li);
    }
    sec.append(ul);
    out.push(sec);
  }
  if (fs.length) {
    const sec = el('section', 'g-section');
    sec.append(el('h2', '', `Formulas (${fs.length})`), formulaList(fs));
    out.push(sec);
  }
  if (consts.length) out.push(constantsTable(consts));
  if (nucs.length) {
    const sec = el('section', 'g-section');
    sec.append(el('h2', '', `Nuclides (${nucs.length})`), nuclideTable(nucs));
    out.push(sec);
  }
  if (cards.length) {
    const sec = el('section', 'g-section');
    sec.append(el('h2', '', `Flashcards (${cards.length})`));
    for (const t of TOPICS) {
      const mine = cards.filter((c) => c.topic === t.id);
      if (mine.length) sec.append(cardSection(t, mine));
    }
    out.push(sec);
  }
  if (!out.length) out.push(el('p', 'empty', `Nothing matches “${query}”.`));
  return out;
}

function openPreview(id) {
  const c = deck[byId.get(id)];
  topicTag($('preview-topic'), c.topic, true);
  $('preview-q').innerHTML = c.front;
  $('preview-a').innerHTML = c.back;
  $('preview-more').innerHTML = c.more;
  const s = unpack(progress.cards[c.id]);
  let status = STATUS[bucket(s)];
  if (s && s.i > 0) {
    const days = s.d - today;
    status += days <= 0 ? ' · due today' : ` · next review in ${fmtInterval(days)}`;
  }
  if (!studied(c.topic)) status += ' · topic paused';
  $('preview-status').textContent = status;
  $('preview').showModal();
}

// ───────── Progress ─────────
const BUCKETS = { new: 'Not seen', learning: 'Learning', young: 'Young', mature: 'Mastered' };

function renderProgress() {
  ensureToday();
  const counts = { new: 0, learning: 0, young: 0, mature: 0 };
  const forecast = new Array(14).fill(0);
  deck.forEach((card, i) => {
    if (!studiedCard(i)) return;
    const c = unpack(cardState(i));
    counts[bucket(c)] += 1;
    if (c) {
      const offset = Math.max(0, c.d - today);
      if (offset < 14) forecast[offset] += 1;
    }
  });
  const answered = Object.values(quiz.answers).reduce((a, x) => a + x[1], 0);
  $('st-streak').textContent = nf.format(streak());
  $('st-learned').textContent = nf.format(counts.young + counts.mature);
  $('st-mature').textContent = nf.format(counts.mature);
  $('st-questions').textContent = nf.format(answered);

  renderHeatmap();

  const order = ['mature', 'young', 'learning', 'new'];
  $('mastery-bar').replaceChildren(...order.filter((b) => counts[b]).map((b) => {
    const seg = el('span', `b-${b}`);
    seg.style.flexGrow = counts[b];
    return seg;
  }));
  $('mastery-legend').replaceChildren(...order.map((b) => {
    const li = el('li');
    li.append(el('span', `dot b-${b}`), BUCKETS[b], el('b', '', nf.format(counts[b])));
    return li;
  }));

  $('topic-bars').replaceChildren(...TOPICS.map((t) => {
    const cards = deck.filter((c) => c.topic === t.id);
    const learned = cards.filter((c) => (progress.cards[c.id]?.[0] ?? 0) > 0).length;
    const acc = accuracy(questions.filter((q) => q.topic === t.id));
    return topicBar(t, `${learned} / ${cards.length}`, learned / cards.length, {
      label: acc === null ? 'No questions answered yet' : `${acc}% of questions right`,
      fraction: (acc ?? 0) / 100,
    });
  }));

  const peak = Math.max(1, ...forecast);
  const dayFmt = new Intl.DateTimeFormat('en', { weekday: 'narrow' });
  const fullFmt = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' });
  $('forecast').replaceChildren(...forecast.map((n, k) => {
    const date = dateOfDay(today + k);
    const li = el('li');
    li.setAttribute('aria-label', `${fullFmt.format(date)}: ${n}`);
    const col = el('span', 'col');
    col.style.setProperty('--v', n / peak);
    const num = el('span', 'n', n || '');
    const day = el('span', 'day', dayFmt.format(date));
    num.ariaHidden = day.ariaHidden = 'true';
    li.append(num, col, day);
    return li;
  }));
}

function renderHeatmap() {
  const WEEKS = 18;
  const weekday = dateOfDay(today).getDay();          // 0 = Sunday
  const start = today - weekday - (WEEKS - 1) * 7;   // a Sunday
  const fmt = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' });
  const cells = [];
  let days = 0, total = 0;
  for (let d = start; d <= today; d++) {
    const n = (progress.log[d] ?? 0) + (quiz.log[d] ?? 0);
    if (n) { days += 1; total += n; }
    const level = n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4;
    const li = el('li', `lv${level}${d === today ? ' today' : ''}`);
    li.title = `${fmt.format(dateOfDay(d))}: ${n ? `${n} cards and questions` : 'no study'}`;
    cells.push(li);
  }
  $('heatmap').replaceChildren(...cells);
  $('activity-sum').textContent = days
    ? `${days} study day${days === 1 ? '' : 's'} and ${nf.format(total)} cards and questions in the last ${WEEKS} weeks.`
    : 'Your study days will fill in here.';
}

// ───────── Routing ─────────
const VIEWS = ['today', 'cards', 'practice', 'guide', 'progress'];
const currentView = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today');

function route() {
  const name = currentView();
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (dayNumber() !== today) startSession();
  if (name === 'today') renderToday();
  if (name === 'cards') renderFocusBar();
  if (name === 'practice') renderPractice();
  if (name === 'guide') renderGuide();
  if (name === 'progress') renderProgress();
}

function refreshAll() {
  startSession();
  route();
}

// ───────── Theme ─────────
const schemeMeta = document.querySelector('meta[name="color-scheme"]');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function setScheme(value) {
  schemeMeta.content = value;
  try {
    // Saved even when it's System: with nothing saved, the app starts in Light.
    localStorage.setItem(KEYS.scheme, JSON.stringify(value));
  } catch { /* theme still applies for this visit */ }
  syncSchemeControl();
}

function syncSchemeControl() {
  const value = ['light', 'dark'].includes(schemeMeta.content) ? schemeMeta.content : 'light dark';
  for (const input of document.querySelectorAll('input[name="scheme"]')) input.checked = input.value === value;
}

function updateSchemeLabel() {
  $('scheme-system').textContent = `System (currently ${darkQuery.matches ? 'dark' : 'light'})`;
}

// ───────── Settings ─────────
function buildStatic() {
  $('topic-checks').replaceChildren(...TOPICS.map((t) => {
    const label = el('label', 'check');
    label.style.setProperty('--h', t.hue);
    const input = el('input');
    input.type = 'checkbox';
    input.name = 'topic';
    input.value = t.id;
    const n = deck.filter((c) => c.topic === t.id).length;
    const qn = questions.filter((q) => q.topic === t.id).length;
    label.append(input, el('span', '', `${t.icon} ${t.name}`), el('small', '', `${n} cards · ${qn} Qs`));
    return label;
  }));
}

function fillSettingsForm() {
  for (const input of document.querySelectorAll('input[name="topic"]')) input.checked = settings.topics.includes(input.value);
  $('name').value = settings.name;
  $('examDate').value = settings.examDate;
  $('newPerDay').value = settings.newPerDay;
  $('maxReviews').value = settings.maxReviews;
  for (const input of document.querySelectorAll('input[name="order"]')) input.checked = input.value === settings.order;
  $('pace').value = String(settings.pace);
  syncSchemeControl();
  updateSchemeLabel();
}

function updateSettings(patch) {
  settings = sanitizeSettings({ ...settings, ...patch });
  if (!saveSettings(settings)) toast('Could not save — browser storage is unavailable.');
}

function exportBackup() {
  const blob = new Blob(
    [JSON.stringify({ app: 'mpsg', v: 1, exportedAt: new Date().toISOString(), settings, progress, quiz })],
    { type: 'application/json' },
  );
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mpsg-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup downloaded.');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data?.app !== 'mpsg' || typeof data.progress?.cards !== 'object') throw new Error('shape');
    progress = sanitizeProgress(data.progress, new Set(byId.keys()));
    quiz = sanitizeQuiz(data.quiz);
    persist();
    saveQuiz(quiz);
    if (data.settings) {
      updateSettings(data.settings);
      fillSettingsForm();
    }
    refreshAll();
    toast('Backup restored.');
  } catch {
    toast('That file is not a valid backup.');
  }
}

let toastTimer;
function toast(message, ms = 2600) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
}

// ───────── Confetti ─────────
function celebrate() {
  if (reducedMotion.matches) return;
  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const hues = [265, 195, 330, 55, 150, 25];
  const bits = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: innerHeight * 0.45,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 15 - 5,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 6,
    h: 3 + Math.random() * 4,
    c: `oklch(0.72 0.19 ${pick(hues)})`,
  }));
  const t0 = performance.now();
  canvas.classList.add('on');
  const frame = (t) => {
    const age = t - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += 0.45;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.r += b.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 2200);
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (age < 2200) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, innerWidth, innerHeight); canvas.classList.remove('on'); }
  };
  requestAnimationFrame(frame);
}

// ───────── Events ─────────
function wireEvents() {
  addEventListener('hashchange', route);

  // Buttons that start a practice session or focus the cards on a topic, wherever they are.
  document.addEventListener('click', (e) => {
    const start = e.target.closest('[data-start]');
    if (start && !start.disabled) {
      const mode = start.dataset.start;
      const topic = start.dataset.topic ?? (mode === 'drill' ? $('drill-topic').value : null);
      $('practice-results').dataset.ready = '';
      startRun(mode, topic);
      return;
    }
    const focus = e.target.closest('[data-focus]');
    if (focus && !focus.disabled) {
      updateSettings({ focus: focus.dataset.focus });
      startSession();
      location.hash = '#cards';
      return;
    }
    const notes = e.target.closest('[data-notes]');
    if (notes) {
      e.preventDefault();
      $('guide-search').value = '';
      document.querySelector('input[name="guide"][value="topics"]').checked = true;
      location.hash = '#guide';
      if (currentView() === 'guide') renderGuide();
      const det = $(`notes-${notes.dataset.notes}`);
      if (det) { det.open = true; det.scrollIntoView({ block: 'start' }); }
      return;
    }
    const row = e.target.closest('[data-card]');
    if (row) openPreview(row.dataset.card);
  });

  // Today
  $('set-exam').addEventListener('click', () => {
    $('settings').showModal();
    $('examDate').focus();
  });

  // Cards
  $('focus-bar').addEventListener('change', (e) => {
    updateSettings({ focus: e.target.value });
    startSession();
  });
  $('card').addEventListener('click', (e) => { if (!e.target.closest('button, a')) reveal(); });
  $('show').addEventListener('click', reveal);
  $('ratings').addEventListener('click', (e) => {
    const btn = e.target.closest('.rate');
    if (btn) answer(+btn.dataset.rating);
  });
  $('undo').addEventListener('click', undo);
  $('more').addEventListener('click', () => {
    progress.daily.extra += +$('more').dataset.extra;
    persist();
    startSession();
  });

  // Practice
  $('choices').addEventListener('click', (e) => {
    const btn = e.target.closest('.choice-btn');
    if (btn && !btn.disabled) choose(+btn.dataset.pos);
  });
  $('next').addEventListener('click', nextQuestion);
  $('quit').addEventListener('click', () => {
    if (!run) return;
    const answered = run.items.filter((it) => it.picked !== null).length;
    if (!answered) { stopTimer(); run = null; renderPractice(); return; }
    $('quit-text').textContent = run.mode === 'mock'
      ? `You’ve answered ${answered} of ${run.items.length}. Unanswered questions count as wrong.`
      : `Your ${answered} answer${answered === 1 ? '' : 's'} so far will be scored.`;
    $('confirm-quit').showModal();
  });
  $('confirm-quit').addEventListener('close', (e) => {
    const ok = e.target.returnValue === 'quit';
    e.target.returnValue = '';
    if (ok) finishRun();
  });
  $('again').addEventListener('click', () => {
    $('practice-results').dataset.ready = '';
    if (lastRun) startRun(lastRun.mode === 'missed' && !missedQuestions().length ? 'quick' : lastRun.mode, lastRun.topic);
  });
  $('results-done').addEventListener('click', () => {
    $('practice-results').dataset.ready = '';
    renderPractice();
  });

  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const target = e.target instanceof Element ? e.target : document.body;
    if (target.closest('input, select, textarea')) return;
    const view = currentView();
    const key = e.key.toLowerCase();
    if (view === 'cards' && queue[0]) {
      const control = target.closest('button, a');
      const onButton = control && (control.checkVisibility?.() ?? true);
      if ((e.key === ' ' || e.key === 'Enter') && !flipped && !onButton) { e.preventDefault(); reveal(); }
      else if (flipped && e.key >= '1' && e.key <= '4') { e.preventDefault(); answer(+e.key); }
      else if (key === 'z' && undoState) undo();
    } else if (view === 'practice' && run) {
      const n = qById.get(run.items[run.i].id).choices.length;
      const idx = 'abcdef'.indexOf(key) >= 0 && key.length === 1 ? 'abcdef'.indexOf(key) : e.key >= '1' && e.key <= '9' ? +e.key - 1 : -1;
      if (idx >= 0 && idx < n) { e.preventDefault(); choose(idx); }
      else if (e.key === 'Enter' && !target.closest('button')) { e.preventDefault(); nextQuestion(); }
    }
  });

  // Guide
  $('guide-search').addEventListener('input', renderGuide);
  $('guide-mode').addEventListener('change', () => {
    $('guide-search').value = '';
    renderGuide();
  });

  // Settings
  $('topic-checks').addEventListener('change', (e) => {
    const chosen = [...document.querySelectorAll('input[name="topic"]:checked')].map((i) => i.value);
    if (!chosen.length) {
      e.target.checked = true;
      toast('Keep at least one topic.');
      return;
    }
    updateSettings({ topics: chosen });
    refreshAll();
  });
  $('name').addEventListener('change', (e) => {
    updateSettings({ name: e.target.value });
    route();
  });
  $('examDate').addEventListener('change', (e) => {
    updateSettings({ examDate: e.target.value });
    route();
  });
  $('scheme').addEventListener('change', (e) => setScheme(e.target.value));
  darkQuery.addEventListener('change', updateSchemeLabel);
  $('order').addEventListener('change', (e) => {
    updateSettings({ order: e.target.value });
    refreshAll();
  });
  for (const id of ['newPerDay', 'maxReviews', 'pace']) {
    $(id).addEventListener('change', (e) => {
      updateSettings({ [id]: e.target.value });
      e.target.value = String(settings[id]);
      refreshAll();
    });
  }
  $('export').addEventListener('click', exportBackup);
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importBackup(file);
    e.target.value = '';
  });
  $('reset').addEventListener('close', (e) => {
    const confirmed = e.target.returnValue === 'reset';
    e.target.returnValue = '';
    if (!confirmed) return;
    progress = emptyProgress();
    quiz = emptyQuiz();
    persist();
    saveQuiz(quiz);
    refreshAll();
    toast('Progress erased.');
  });

  // Stay in sync with other tabs, and roll over to a new day while left open.
  addEventListener('storage', (e) => {
    if (e.key === KEYS.scheme) {
      try { schemeMeta.content = JSON.parse(e.newValue) ?? 'light'; } catch { schemeMeta.content = 'light'; }
      syncSchemeControl();
    }
    if (e.key === KEYS.progress) { progress = loadProgress(); refreshAll(); }
    if (e.key === KEYS.quiz) { quiz = loadQuiz(); route(); }
    if (e.key === KEYS.settings) { settings = loadSettings(); fillSettingsForm(); refreshAll(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && dayNumber() !== today) refreshAll();
  });

  syncSchemeControl();
  updateSchemeLabel();
  wireDialogFallbacks();
  wireInstall();
}

// Invoker commands and closedby are progressive enhancements; cover browsers without them.
function wireDialogFallbacks() {
  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button[commandfor]');
      const target = btn && document.getElementById(btn.getAttribute('commandfor'));
      if (!(target instanceof HTMLDialogElement)) return;
      if (btn.getAttribute('command') === 'show-modal') target.showModal();
      else if (btn.getAttribute('command') === 'close') target.close();
    });
  }
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => { pressedOutside = e.target === dialog && outside(e, dialog); });
      dialog.addEventListener('pointerup', (e) => { if (pressedOutside && e.target === dialog && outside(e, dialog)) dialog.close(); });
    }
  }
}

function wireInstall() {
  const button = $('install');
  const supportsWebInstall = typeof Navigator.prototype.install === 'function';
  let deferredPrompt;
  if (matchMedia('(display-mode: standalone)').matches) return;
  if (supportsWebInstall) button.hidden = false;

  addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (!supportsWebInstall) button.hidden = false;
  });
  addEventListener('appinstalled', () => { button.hidden = true; });

  button.addEventListener('click', async () => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    button.setAttribute('aria-disabled', 'true');
    try {
      if (supportsWebInstall) {
        await navigator.install();
        toast('App installed.');
        button.hidden = true;
      } else if (deferredPrompt) {
        const promptEvent = deferredPrompt;
        deferredPrompt = undefined;
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        toast(outcome === 'accepted' ? 'App installed.' : 'Installation was cancelled.');
        if (!deferredPrompt) button.hidden = true;
      }
    } catch (error) {
      if (error.name === 'AbortError') toast('Installation was cancelled.');
      else console.error(error);
    } finally {
      button.removeAttribute('aria-disabled');
    }
  });
}

init();
