import { activeLicense, covers } from './license.js';
import { newProject } from './model.js';
import { hasProAccess } from './pricing.js';
import { PRICING_URL } from './routes.js';
import { listProjects, saveProject } from './store.js';

// Every `tier` line below is a promise made to someone deciding what to pay
// for, so each one names capability that some other module actually enforces:
// standard lines track LANES.paid in pricing.js, pro lines track the
// hasProAccess / hasVideoProEntitlement / hasVoiceProEntitlement gates.
const PRODUCTS = [
  {
    id: 'photo',
    title: 'Photo',
    kicker: 'Shape the image',
    copy: 'Create and refine still images with control over light, color, people, and detail.',
    image: 'studio-entry-photo.webp',
    tier: {
      standard: 'Clean export up to 4096 px, and 4× upscale.',
      pro: {
        summary: 'Generative Fill (Beta), 12288 px export',
        detail: 'Replace or extend part of an image when a compatible local engine is installed, review every result before you keep it, and deliver at three times the Standard export ceiling.'
      }
    },
    starters: [
      { id: 'portrait-finish', label: 'Portrait finish', goal: 'Finish and deliver a polished portrait.', surfaces: ['ig-feed-portrait', 'web-hero-mobile'], qaPreset: 'human' },
      { id: 'product-launch', label: 'Product launch', goal: 'Build a complete product launch image set.', surfaces: ['web-hero-desktop', 'web-hero-mobile', 'ig-feed-portrait', 'meta-feed'], qaPreset: 'product' },
      { id: 'social-campaign', label: 'Social campaign', goal: 'Create a coordinated social campaign.', surfaces: ['ig-feed-portrait', 'ig-reels', 'tiktok-feed', 'meta-feed', 'meta-story'], qaPreset: 'human' }
    ]
  },
  {
    id: 'video',
    title: 'Video',
    kicker: 'Build the story',
    copy: 'Cut, refine, and deliver with the MaterialLogix Motion Engine. Captions and scaling when local packs are installed.',
    image: 'studio-entry-video.webp',
    tier: {
      standard: 'Clean export at platform spec. Captions and scaling when local packs are installed.',
      pro: {
        summary: 'Three-track timeline, finer motion',
        detail: 'A bounded three-track Pro timeline editor, and a motion model that spends longer rendering to hold detail.'
      }
    },
    starters: [
      { id: 'short-form-edit', label: 'Short-form edit', goal: 'Cut and finish a vertical short.', surfaces: ['ig-reels', 'tiktok-feed', 'meta-story'], qaPreset: 'video' },
      { id: 'campaign-cut', label: 'Campaign cut', goal: 'Build a polished campaign video.', surfaces: ['web-hero-desktop', 'ig-reels', 'meta-feed'], qaPreset: 'video' },
      { id: 'podcast-clips', label: 'Podcast clips', goal: 'Turn a conversation into shareable clips.', surfaces: ['ig-reels', 'tiktok-feed', 'meta-story'], qaPreset: 'video' }
    ]
  },
  {
    id: 'voice',
    title: 'Voice',
    kicker: 'Direct the performance',
    copy: 'Shape a read with presence, pace, and personality.',
    image: 'studio-entry-voice.webp',
    tier: {
      standard: 'Reads of any length with clean delivery.',
      pro: {
        summary: 'Mix console, premium minutes, personal profiles',
        detail: 'Voice strip, EQ, gate, compression, de-esser, and reverb on the finished read, plus the plan’s premium natural-voice minutes and on-device personal profiles.'
      }
    },
    starters: [
      { id: 'voiceover', label: 'Voiceover', goal: 'Direct and finish a polished voiceover.', surfaces: [], qaPreset: 'human' },
      { id: 'podcast-read', label: 'Podcast read', goal: 'Create a natural podcast read.', surfaces: [], qaPreset: 'human' },
      { id: 'social-narration', label: 'Social narration', goal: 'Create concise narration for social video.', surfaces: ['ig-reels', 'tiktok-feed', 'meta-story'], qaPreset: 'human' }
    ]
  },
  {
    id: 'music',
    title: 'Music',
    kicker: 'Record and mix',
    copy: 'Bring a beat, record your vocal over it, and mix the two into a finished master.',
    image: 'studio-entry-music.webp',
    tier: {
      standard: 'Record, arrange, and mix up to 24 tracks in a song.',
      pro: {
        summary: '64 tracks, 24-bit master, stem export',
        detail: 'Arrange up to 64 tracks in one song instead of 24, deliver a 24-bit master, and export aligned stems.'
      }
    },
    // Music keeps its songs in the Music workspace's own store, so these hand
    // the starting point over in the URL rather than creating a shared project.
    starters: [
      { id: 'vocal-take', label: 'Vocal take' },
      { id: 'beat-sketch', label: 'Beat sketch' },
      { id: 'song-demo', label: 'Song demo' }
    ]
  }
];

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function entranceAccess(license, accessMode = 'local') {
  const plan = String(license?.plan || 'preview');
  const suspended = plan.startsWith('suspended:');
  const states = Object.fromEntries(PRODUCTS.map(({ id }) => {
    if (suspended) return [id, 'suspended'];
    if (!license) return [id, 'preview'];
    return [id, covers(license, id) ? 'included' : 'locked'];
  }));
  const selected = license?.selected_product || license?.selectedProduct || null;
  // Every branch here has to name each plan explicitly, so a plan added to the
  // catalog and not added here falls through to the no-plan wording. That is
  // how the Pro tiers were greeting their own customers with "Studio Preview"
  // and an invitation to buy a plan they had already bought.
  const studioName = selected ? selected[0].toUpperCase() + selected.slice(1) : 'Single';
  const label = suspended ? 'Reconnect your account'
    : plan === 'fullPro' ? 'Pro Studio'
      : plan === 'full' ? 'Full Studio'
        : plan === 'singlePro' ? `${studioName} Studio Pro`
          : plan === 'single' ? `${studioName} Studio`
            : plan === 'voice_starter' ? 'Voice Starter'
                : accessMode === 'demo' ? 'Free Preview' : 'Studio Preview';
  const message = suspended
    ? 'Reconnect once to restore the products on your plan.'
    // Both Full plans cover Music, so all four are named here.
    : plan === 'full' || plan === 'fullPro'
      ? 'Photo, Video, Voice, and Music are ready when you are.'
      : plan === 'single' || plan === 'singlePro' || plan === 'voice_starter'
        ? 'Your Studio is ready. Other products stay in view for whenever you want more.'
        : 'Explore every Studio. Free exports carry a mark; plans unlock clean delivery. You own what you make.';
  const pro = Object.fromEntries(PRODUCTS.map(({ id }) => [id, !suspended && hasProAccess(license, id)]));
  return { plan, label, message, states, pro };
}

function stateCopy(state, product) {
  if (state === 'included') return { badge: 'Included in your plan', action: `Open ${product.title} Studio` };
  // The page-level plan pill already says Free Preview. Repeating it on every
  // card and again in every action made the entrance read like a warning wall.
  // Keep the entitlement truthful once, then let each card simply open.
  if (state === 'preview') return { badge: '', action: `Open ${product.title} Studio` };
  if (state === 'suspended') return { badge: 'Reconnect account', action: 'Restore access' };
  return { badge: 'Not in your plan', action: 'See upgrade options' };
}

export function starterProjectSpec(productId, starterId) {
  const product = PRODUCTS.find(item => item.id === productId);
  const starter = product?.starters.find(item => item.id === starterId);
  if (!product || !starter) throw new Error('Unknown Studio starter.');
  // A Music song is not a shared-store project, so it must never be built here.
  if (product.id === 'music') throw new Error('Music starters open the Music workspace.');
  return {
    name: starter.label,
    product: product.id,
    starterId: starter.id,
    brief: { campaignGoal: starter.goal },
    surfaces: [...starter.surfaces],
    qaPreset: starter.qaPreset
  };
}

export function makeStarterProject(productId, starterId) {
  const spec = starterProjectSpec(productId, starterId);
  const project = newProject(spec.name);
  project.brief.campaignGoal = spec.brief.campaignGoal;
  project.surfaces = spec.surfaces;
  project.qaPreset = spec.qaPreset;
  project.starter = {
    product: spec.product,
    id: spec.starterId,
    label: spec.name,
    version: 1
  };
  return project;
}

export function entranceLinks(pathname, href) {
  const hostedStudio = /\/studio(?:\/|$)/.test(pathname);
  return {
    pricing: PRICING_URL,
    mediaBase: new URL(hostedStudio ? '../media/' : 'site/media/', href).href
  };
}

function currentEntranceLinks() {
  return entranceLinks(location.pathname, location.href);
}

function pricingUrl() {
  return currentEntranceLinks().pricing;
}

// Leaving for the website should not replace the app the customer is standing
// in, and must not hand the opener to another origin.
function openPricing() {
  window.open(pricingUrl(), '_blank', 'noopener,noreferrer');
}

function preserveDemo(path) {
  const target = new URL(path, location.href);
  if (new URLSearchParams(location.search).get('demo') === '1') target.searchParams.set('demo', '1');
  return target.href;
}

function workspaceUrl() {
  const target = new URL(location.href);
  target.hash = 'workspace';
  target.searchParams.delete('entry');
  return target.href;
}

function openProject(projectId, product = 'photo') {
  localStorage.setItem('cros:project', projectId);
  if (product === 'voice' || product === 'music') {
    const page = product === 'voice' ? 'voice.html' : 'music.html';
    const target = new URL(preserveDemo(page));
    target.searchParams.set('project', projectId);
    location.assign(target.href);
    return;
  }
  history.replaceState(null, '', workspaceUrl());
  location.reload();
}

// Every refusal on this screen states the reason and offers the next step.
function showEntranceStatus(text, next = null) {
  const node = document.querySelector('#studioEntryStatus');
  if (!node) return;
  node.replaceChildren(document.createTextNode(text));
  if (next) {
    const control = next.href
      ? Object.assign(make('a', 'studio-entry__status-action', next.label), { href: next.href, target: '_blank', rel: 'noopener noreferrer' })
      : make('button', 'studio-entry__status-action', next.label);
    if (!next.href) {
      control.type = 'button';
      control.addEventListener('click', next.onClick);
    }
    node.append(control);
  }
  node.hidden = false;
}

// The licence key and its Activate button live in the workspace's Deliver
// panel, so that is where a suspended plan is actually restored. The entrance
// used to drop the customer into the sidebar with no idea what to look for.
function openDeliverPanel() {
  closeEntrance({ focus: false });
  const menu = document.querySelector('#menuBtn');
  if (menu && menu.getAttribute('aria-expanded') !== 'true') menu.click();
}

function launchStarter(product, starter) {
  if (product.id === 'music') {
    const target = new URL(preserveDemo('music.html'));
    target.searchParams.set('start', starter.id);
    location.assign(target.href);
    return Promise.resolve();
  }
  return createStarter(product, starter);
}

async function createStarter(product, starter) {
  try {
    const project = makeStarterProject(product.id, starter.id);
    await saveProject(project);
    openProject(project.id, product.id);
  } catch (error) {
    // A refused write is reported rather than passing without a response.
    showEntranceStatus(`${starter.label} could not be started. ${error?.message || 'Please try again.'}`);
  }
}

function enterWorkspace(kind) {
  try { sessionStorage.setItem('mlx:start-product', kind); } catch { /* unavailable */ }
  if (kind === 'voice' || kind === 'music') {
    // Leave the entrance up while the browser navigates - closing it first
    // flashes the workspace for a beat before the Voice/Music page arrives.
    location.assign(preserveDemo(kind === 'voice' ? 'voice.html' : 'music.html'));
    return;
  }
  if (kind === 'music') {
    location.assign(preserveDemo('music.html'));
    return;
  }
  closeEntrance({ focus: false });
  history.replaceState(null, '', `${location.pathname}${location.search}#workspace`);
  if (kind === 'video') {
    // Reload so the workspace greets you as Video Studio with its own
    // import action, instead of the Photo start page behind a file dialog.
    location.reload();
    return;
  }
  // Photo stays on the same page load (no reload), so studio-nav.js's
  // one-time label pass already ran before mlx:start-product was set above
  // - without this it keeps reading the generic "Studio" fallback. (Not
  // imported from studio-nav.js: that module runs browser-only setup as a
  // side effect of being imported, which also breaks importing this file
  // under Node for tests.)
  const brandSuffix = document.querySelector('.topbar .brand .brand-studio');
  if (brandSuffix) brandSuffix.textContent = 'Photo Studio';
  const breadcrumbHere = document.querySelector('.topbar .breadcrumbs b');
  if (breadcrumbHere) breadcrumbHere.textContent = 'Photo';
  // A fresh Photo Studio has no assets yet, so the stage itself already
  // greets you with "Create or open a photo" and its own Generate/Import
  // actions (see renderReview()'s empty state in app.js). Auto-opening the
  // Create sidebar on top of that used to show the same heading, the same
  // two buttons, and the same workflow steps twice at once.
}

function actionFor(product, state) {
  if (state === 'locked' || state === 'suspended') {
    if (state === 'suspended') {
      return () => showEntranceStatus(
        `${product.title} Studio is on your plan, but the licence needs reconnecting before it opens.`,
        { label: 'Reconnect in Deliver', onClick: openDeliverPanel }
      );
    }
    return () => openPricing();
  }
  return () => enterWorkspace(product.id);
}

function starterList(product, state) {
  const wrap = make('div', 'studio-entry-card__starters');
  const label = state === 'locked' ? 'Available with this Studio'
    : state === 'suspended' ? 'Available after reconnecting' : 'Start with';
  wrap.append(make('p', 'studio-entry-card__starter-label', label));
  const list = make('div', 'studio-entry-card__starter-list');
  for (const starter of product.starters) {
    const button = make('button', 'studio-entry-card__starter', starter.label);
    button.type = 'button';
    button.dataset.starter = starter.id;
    button.setAttribute('aria-label', `${starter.label} in ${product.title} Studio`);
    if (state === 'locked' || state === 'suspended') {
      // aria-disabled rather than disabled: a disabled button is silent AND
      // unreachable by keyboard, so the customer could not even find out why
      // it will not start. It stays focusable and answers when asked.
      button.setAttribute('aria-disabled', 'true');
      button.addEventListener('click', () => (state === 'suspended'
        ? showEntranceStatus(
          `${starter.label} comes back with ${product.title} Studio once your licence reconnects.`,
          { label: 'Reconnect in Deliver', onClick: openDeliverPanel })
        : showEntranceStatus(
          `${starter.label} is part of ${product.title} Studio, which is not on your plan yet.`,
          { label: `See ${product.title} plans`, href: pricingUrl() })));
    } else {
      button.addEventListener('click', () => launchStarter(product, starter));
    }
    list.append(button);
  }
  wrap.append(list);
  return wrap;
}

// Pro capability is shown to every visitor, entitled or not. The row recedes
// instead of hiding, and describes the capability when asked.
function tierBlock(product, proActive) {
  const wrap = make('div', 'studio-entry-card__tier');
  const standard = make('p', 'studio-entry-card__tier-line');
  standard.append(
    make('span', 'studio-entry-card__tier-name', 'Standard'),
    document.createTextNode(product.tier.standard)
  );
  wrap.append(standard);
  if (!product.tier.pro) return wrap;

  const row = make('div', `studio-entry-card__pro pro-only${proActive ? ' is-active' : ''}`);
  const detail = make('div', 'studio-entry-card__pro-detail');
  detail.id = `studioEntryPro-${product.id}`;
  detail.hidden = true;
  detail.append(make('p', '', product.tier.pro.detail));
  if (!proActive) {
    const link = make('a', 'studio-entry-card__pro-link', 'See Pro plans');
    link.href = pricingUrl();
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    detail.append(link);
  }

  const toggle = make('button', 'studio-entry-card__pro-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', detail.id);
  toggle.setAttribute('aria-label', proActive
    ? `${product.tier.pro.summary}, included with your plan. What this does`
    : `${product.tier.pro.summary}, added by ${product.title} Pro. What this does`);
  toggle.append(
    make('span', 'studio-entry-card__pro-tag', 'Pro'),
    make('span', 'studio-entry-card__pro-summary', product.tier.pro.summary)
  );
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    detail.hidden = open;
  });

  row.append(toggle, detail);
  wrap.append(row);
  return wrap;
}

function productCard(product, state, proActive) {
  const words = stateCopy(state, product);
  const card = make('article', `studio-entry-card is-${state}`);
  card.dataset.product = product.id;
  if (product.image) {
    card.style.setProperty('--entry-image', `url("${new URL(product.image, currentEntranceLinks().mediaBase).href}")`);
  }

  const media = make('div', 'studio-entry-card__media');
  if (product.image) {
    media.setAttribute('role', 'img');
    media.setAttribute('aria-label', `${product.title} creator at work`);
  }
  const wash = make('div', 'studio-entry-card__wash');
  const content = make('div', 'studio-entry-card__content');
  const top = make('div', 'studio-entry-card__top');
  if (words.badge) top.append(make('span', 'studio-entry-card__badge', words.badge));
  const kicker = make('p', 'studio-entry-card__kicker', product.kicker);
  const title = make('h2', '', product.title);
  const copy = make('p', 'studio-entry-card__copy', product.copy);
  const button = make('button', 'studio-entry-card__action', words.action);
  button.type = 'button';
  button.setAttribute('aria-label', words.action.includes(product.title) ? words.action : `${words.action}: ${product.title}`);
  button.addEventListener('click', actionFor(product, state));
  if (top.childElementCount) content.append(top);
  content.append(kicker, title, copy, tierBlock(product, proActive));
  if (product.starters.length) content.append(starterList(product, state));
  content.append(button);
  card.append(media, wash, content);
  return card;
}

async function recentProjects() {
  try {
    return (await listProjects()).slice(0, 3);
  } catch {
    return [];
  }
}

let lastFocus = null;
let escapeHandler = null;

export function closeEntrance({ focus = true } = {}) {
  const entry = document.querySelector('#studioEntry');
  if (!entry) return;
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
  }
  entry.remove();
  const app = document.querySelector('#app');
  if (app) {
    app.inert = false;
    app.removeAttribute('aria-hidden');
  }
  document.documentElement.classList.remove('studio-entry-open');
  if (focus) (lastFocus || document.querySelector('#menuBtn'))?.focus();
}

// Rendering awaits the licence and the saved-project list, so the "already
// open" check alone let two triggers in flight both pass it and append two
// entrances, one stacked invisibly on the other.
let entranceOpening = null;

export function openEntrance() {
  if (document.querySelector('#studioEntry')) return Promise.resolve();
  entranceOpening = entranceOpening || renderEntrance().finally(() => { entranceOpening = null; });
  return entranceOpening;
}

// The same three-part lockup the topbar and account pages use, rather than a
// fourth hand-built copy of the wordmark with its own tags and its own gold.
function entranceBrand() {
  const brand = make('div', 'studio-entry__brand');
  brand.append(
    make('span', 'brand-material', 'Material'),
    make('span', 'brand-logix', 'Logix'),
    make('span', 'brand-studio', 'Studio')
  );
  return brand;
}

function entranceIntro(access) {
  const intro = make('div', 'studio-entry__intro');
  const title = make('h1', '', 'Make something worth sharing.');
  title.id = 'studioEntryTitle';
  const message = make('p', 'studio-entry__message', access.message);
  const status = make('p', 'studio-entry__status');
  status.id = 'studioEntryStatus';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  intro.append(make('p', 'studio-entry__eyebrow', 'Start a project'), title, message, status);
  return { intro, message };
}

function entranceProducts(readAccess) {
  const products = make('div', 'studio-entry__products');
  // A bare div drops aria-label on the floor; the group role is what makes the
  // four cards announce as one labelled choice.
  products.setAttribute('role', 'group');
  products.setAttribute('aria-label', 'Choose Photo, Video, Voice, or Music');
  const paint = () => {
    const access = readAccess();
    products.replaceChildren(
      ...PRODUCTS.map(product => productCard(product, access.states[product.id], access.pro[product.id]))
    );
  };
  paint();
  return { products, paint };
}

// The entrance covers an inert workspace, so the account link is the route
// from this screen to the plan it names.
async function entranceFooter() {
  const footer = make('footer', 'studio-entry__footer');
  const existing = await recentProjects();
  if (existing.length) {
    const recents = make('div', 'studio-entry__recent');
    const label = make('span', 'studio-entry__recent-label', 'Open existing project');
    label.id = 'studioEntryExistingLabel';
    recents.setAttribute('aria-labelledby', label.id);
    recents.append(label);
    for (const project of existing) {
      const button = make('button', '', project.name);
      button.type = 'button';
      button.setAttribute('aria-label', `Open existing project: ${project.name}`);
      button.addEventListener('click', () => openProject(project.id, project.starter?.product || 'photo'));
      recents.append(button);
    }
    footer.append(recents);
  }
  const account = make('a', 'studio-entry__account', 'Account & settings');
  account.href = preserveDemo('usage.html');
  footer.append(account);
  return footer;
}

async function renderEntrance() {
  lastFocus = document.activeElement;
  const app = document.querySelector('#app');
  if (app) {
    app.inert = true;
    app.setAttribute('aria-hidden', 'true');
  }

  // The first screen holds #app inert and does not wait on the licence:
  // activeLicense() revalidates over the network with a six second timeout.
  // Render from what is known and raise the plan in place once it answers.
  const accessMode = document.documentElement.dataset.accessMode || 'local';
  let access = entranceAccess(globalThis.lic || null, accessMode);

  const entry = make('section', 'studio-entry');
  entry.id = 'studioEntry';
  entry.setAttribute('aria-labelledby', 'studioEntryTitle');
  // Bound to the document, not the entrance: the workspace finishes rendering
  // behind the overlay and focus falls back to <body>, so an entrance-scoped
  // listener never heard Escape on a fresh load.
  entry.tabIndex = -1;
  escapeHandler = event => { if (event.key === 'Escape') closeEntrance(); };
  document.addEventListener('keydown', escapeHandler);

  const head = make('header', 'studio-entry__head');
  const plan = make('span', 'studio-entry__plan', access.label);
  head.append(entranceBrand(), plan);
  const { intro, message } = entranceIntro(access);
  const { products, paint } = entranceProducts(() => access);

  entry.append(head, intro, products, await entranceFooter());
  document.body.append(entry);
  document.documentElement.classList.add('studio-entry-open');

  const focusFirstChoice = () => {
    const target = entry.querySelector('.studio-entry-card__starter:not([aria-disabled="true"]), .studio-entry-card__action');
    (target || entry).focus({ preventScroll: true });
  };
  requestAnimationFrame(focusFirstChoice);

  if (globalThis.lic) return;
  activeLicense().then(license => {
    if (!license || !entry.isConnected) return;
    const raised = entranceAccess(license, accessMode);
    const unchanged = raised.label === access.label
      && PRODUCTS.every(({ id }) => raised.states[id] === access.states[id] && raised.pro[id] === access.pro[id]);
    if (unchanged) return;
    const keepFocus = entry.contains(document.activeElement);
    access = raised;
    plan.textContent = raised.label;
    message.textContent = raised.message;
    paint();
    if (keepFocus) focusFirstChoice();
  }).catch(() => { /* unlicensed stays unlicensed */ });
}

if (typeof document !== 'undefined') {
  document.querySelector('.topbar .brand')?.addEventListener('click', event => {
    event.preventDefault();
    history.replaceState(null, '', `${location.pathname}${location.search}#studio-entry`);
    openEntrance();
  });

  addEventListener('hashchange', () => {
    if (location.hash === '#studio-entry') openEntrance();
  });

  if (location.hash !== '#workspace' && new URLSearchParams(location.search).get('entry') !== '0') {
    openEntrance();
  }
}
