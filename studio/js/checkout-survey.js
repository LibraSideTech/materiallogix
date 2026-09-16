// The one short question we ask after a purchase. It appears for a small
// random share of buyers, remembers the answer, and comes back only when the
// last answer said the purchase went badly.
import { apiUrl } from './api-root.js';
import {
  RATINGS, SURVEY_STORAGE, COMMENT_LIMIT, LOW_RATING,
  readRecord, shouldAsk, nextRecord, cleanComment
} from './survey-policy.js';

function save(record) {
  try {
    if (record) localStorage.setItem(SURVEY_STORAGE, JSON.stringify(record));
  } catch { /* unavailable */ }
}

function send(rating, comment, operationId) {
  fetch(apiUrl('/api/feedback/checkout'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, comment, operationId }),
    keepalive: true
  }).catch(() => {});
}

/**
 * Show the question if the policy allows it. `operationId` scopes one answer
 * to one purchase so a retry cannot double-count.
 */
export function offerCheckoutSurvey(operationId, { roll = Math.random(), host = document.body } = {}) {
  const record = readRecord(localStorage);
  if (!shouldAsk(record, roll) || !host) return null;

  const card = document.createElement('aside');
  card.className = 'survey-card';
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'One quick question');

  const question = document.createElement('p');
  question.className = 'survey-question';
  question.textContent = 'How did that go?';

  const choices = document.createElement('div');
  choices.className = 'survey-choices';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn sm survey-close';
  close.textContent = 'No thanks';

  const finish = (message) => {
    card.replaceChildren(Object.assign(document.createElement('p'),
      { className: 'survey-question', textContent: message }));
    setTimeout(() => card.remove(), 4000);
  };

  close.addEventListener('click', () => {
    save(nextRecord(record, { dismissed: true }));
    card.remove();
  });

  const answer = (rating) => {
    save(nextRecord(record, { rating }));
    if (rating > LOW_RATING) {
      send(rating, '', operationId);
      finish('Thank you.');
      return;
    }
    // A low answer is the one worth a detail, so ask for it — still optional.
    const label = document.createElement('label');
    label.className = 'survey-detail';
    label.textContent = 'What should we fix?';
    const field = document.createElement('input');
    field.type = 'text';
    field.maxLength = COMMENT_LIMIT;
    field.className = 'survey-input';
    field.autocomplete = 'off';
    label.append(field);
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'btn primary sm';
    submit.textContent = 'Send';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn sm';
    skip.textContent = 'Skip';
    const done = () => {
      send(rating, cleanComment(field.value), operationId);
      finish('Thank you — we read every one.');
    };
    submit.addEventListener('click', done);
    skip.addEventListener('click', () => { send(rating, '', operationId); finish('Thank you.'); });
    field.addEventListener('keydown', event => { if (event.key === 'Enter') done(); });
    const actions = document.createElement('div');
    actions.className = 'survey-choices';
    actions.append(submit, skip);
    card.replaceChildren(label, actions);
    field.focus();
  };

  for (const rating of RATINGS) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'btn sm';
    choice.textContent = rating.label;
    choice.addEventListener('click', () => answer(rating.value));
    choices.append(choice);
  }

  card.append(question, choices, close);
  host.append(card);
  return card;
}
