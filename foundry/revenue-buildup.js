'use strict';

/**
 * Revenue build-up editor: one card per product or tier (name, price, billing unit, expected
 * customers or units a month with a ramp, variable cost per unit), add/remove rows, and the
 * market the founder can reach. Touch-first: 16px inputs, numeric keypads, 44px targets, one
 * column on a phone.
 *
 * Used on Instant Build (optional, sent with the build) and in "Complete your plan" on Documents
 * (applied with FoundryEngines.pipeline.applyRevenueBuildupToPipeline). The value it produces is
 * what the finance engine reads at intake.plan_detail.financials.revenue_buildup.
 *
 * window.FoundryRevenueBuildup.mount(container, { initial, idPrefix }) -> { value(), setValue(v), isEmpty() }
 */
(function revenueBuildupModule(root) {
  const BILLING = [
    ['per_unit', 'Per unit'],
    ['one_time', 'One-time sale'],
    ['monthly', 'Per month (subscription)'],
    ['annual', 'Per year (subscription)'],
  ];
  const VOLUME_NOUN = { per_unit: 'Units a month', one_time: 'New customers a month', monthly: 'Active subscribers', annual: 'Active subscribers' };

  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of [].concat(children)) if (c) node.append(c);
    return node;
  };
  const numOrNull = (v) => {
    const n = Number(String(v ?? '').replace(/[$,\s%]/g, ''));
    return String(v ?? '').trim() === '' || !Number.isFinite(n) ? null : n;
  };
  const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

  function mount(container, opts = {}) {
    if (!container) return null;
    const prefix = opts.idPrefix || 'rb';
    let seq = 0;
    container.classList.add('revenue-buildup');
    container.replaceChildren();

    const list = el('div', { class: 'rb-tiers' });
    const addBtn = el('button', { type: 'button', class: 'btn ghost rb-add', text: 'Add a product or tier' });
    const samId = `${prefix}_sam`;
    const samBasisId = `${prefix}_sam_basis`;
    const market = el('div', { class: 'rb-market' }, [
      el('div', { class: 'rb-field' }, [
        el('label', { for: samId, text: 'Customers you could reach (serviceable market)' }),
        el('input', { id: samId, 'data-rb': 'sam', inputmode: 'numeric', autocomplete: 'off', placeholder: 'e.g. 30,000' }),
      ]),
      el('div', { class: 'rb-field' }, [
        el('label', { for: samBasisId, text: 'Where that number comes from (optional)' }),
        el('input', { id: samBasisId, 'data-rb': 'sam_basis', autocomplete: 'off', placeholder: 'e.g. residents and office workers within a 10-minute walk' }),
      ]),
    ]);
    const summary = el('p', { class: 'rb-summary', 'aria-live': 'polite' });
    container.append(list, addBtn, market, summary);

    function field(labelText, input, hint) {
      return el('div', { class: 'rb-field' }, [el('label', { for: input.id, text: labelText }), input, hint ? el('span', { class: 'hint', text: hint }) : null]);
    }

    function addTier(t = {}) {
      const n = ++seq;
      const id = (k) => `${prefix}_${n}_${k}`;
      const card = el('fieldset', { class: 'rb-tier', 'data-tier': n });
      const legend = el('legend', { text: `Product or tier ${list.children.length + 1}` });
      const name = el('input', { id: id('name'), 'data-rb': 'name', autocomplete: 'off', placeholder: 'e.g. Espresso drinks', value: t.name || '' });
      const price = el('input', { id: id('price'), 'data-rb': 'price', inputmode: 'decimal', autocomplete: 'off', placeholder: '$', value: t.price_usd ?? '' });
      const billing = el('select', { id: id('billing'), 'data-rb': 'billing' }, BILLING.map(([v, l]) => el('option', { value: v, text: l })));
      billing.value = t.billing || 'per_unit';
      const growthMode = t.volume?.mode === 'growth' || (t.volume?.monthly_growth_pct != null && t.volume?.month12 == null);
      const modeId = id('mode');
      const mode = el('select', { id: modeId, 'data-rb': 'mode' }, [
        el('option', { value: 'points', text: 'Start, month 12 and month 36' }),
        el('option', { value: 'growth', text: 'Start and a monthly growth %' }),
      ]);
      mode.value = growthMode ? 'growth' : 'points';
      const start = el('input', { id: id('start'), 'data-rb': 'start', inputmode: 'decimal', autocomplete: 'off', placeholder: 'At opening', value: t.volume?.start ?? '' });
      const m12 = el('input', { id: id('m12'), 'data-rb': 'm12', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Month 12', value: t.volume?.month12 ?? '' });
      const m36 = el('input', { id: id('m36'), 'data-rb': 'm36', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Month 36', value: t.volume?.month36 ?? '' });
      const growth = el('input', { id: id('growth'), 'data-rb': 'growth', inputmode: 'decimal', autocomplete: 'off', placeholder: '% a month', value: t.volume?.monthly_growth_pct ?? '' });
      const cost = el('input', { id: id('cost'), 'data-rb': 'cost', inputmode: 'decimal', autocomplete: 'off', placeholder: '$', value: t.unit_cost_usd ?? '' });
      const buys = el('input', { id: id('buys'), 'data-rb': 'buys', inputmode: 'decimal', autocomplete: 'off', placeholder: 'e.g. 6', value: t.purchases_per_customer_month ?? '' });
      const volumeLabel = el('p', { class: 'rb-volume-label' });
      const pointsRow = el('div', { class: 'rb-row rb-points' }, [field('At opening', start), field('Month 12', m12), field('Month 36', m36)]);
      const growthRow = el('div', { class: 'rb-row rb-growth' }, [field('Growth a month (%)', growth)]);
      const buysField = field('Buys per customer a month (optional)', buys, 'Lets the plan check customer counts against your market.');
      const remove = el('button', { type: 'button', class: 'btn ghost danger rb-remove', text: 'Remove' });
      remove.setAttribute('aria-label', `Remove product or tier ${list.children.length + 1}`);
      const line = el('p', { class: 'rb-line hint', 'aria-live': 'polite' });
      card.append(
        legend,
        el('div', { class: 'rb-row' }, [field('Name', name), field('Price', price), field('Billed', billing)]),
        volumeLabel,
        field('Ramp', mode),
        pointsRow,
        growthRow,
        el('div', { class: 'rb-row' }, [field('Variable cost per unit (COGS)', cost, 'Ingredients, cloud compute, payment fees…'), buysField]),
        line,
        remove,
      );
      const sync = () => {
        volumeLabel.textContent = `${VOLUME_NOUN[billing.value]} expected`;
        const g = mode.value === 'growth';
        m12.closest('.rb-field').hidden = g;
        m36.closest('.rb-field').hidden = g;
        growthRow.hidden = !g;
        buysField.hidden = billing.value !== 'per_unit';
        const p = numOrNull(price.value);
        const q12 = g ? (numOrNull(start.value) || 0) * (1 + (numOrNull(growth.value) || 0) / 100) ** 9 : numOrNull(m12.value) ?? numOrNull(start.value);
        const c = numOrNull(cost.value) || 0;
        if (p > 0 && q12 > 0) {
          const f = billing.value === 'annual' ? 1 / 12 : 1;
          line.textContent = `About ${money(p * q12 * f)} a month by month 12 · ${Math.round(((p - c) / p) * 100)}% gross margin`;
        } else line.textContent = '';
      };
      card.addEventListener('input', () => {
        sync();
        updateSummary();
      });
      card.addEventListener('change', () => {
        sync();
        updateSummary();
      });
      remove.addEventListener('click', () => {
        card.remove();
        renumber();
        updateSummary();
        (list.querySelector('.rb-tier:last-child input') || addBtn).focus();
      });
      list.append(card);
      sync();
      return card;
    }

    function renumber() {
      [...list.children].forEach((card, i) => {
        card.querySelector('legend').textContent = `Product or tier ${i + 1}`;
        card.querySelector('.rb-remove').setAttribute('aria-label', `Remove product or tier ${i + 1}`);
      });
    }

    function value() {
      const tiers = [...list.children].map((card) => {
        const q = (k) => card.querySelector(`[data-rb="${k}"]`)?.value ?? '';
        const growth = q('mode') === 'growth';
        const t = {
          name: q('name').trim(),
          price_usd: numOrNull(q('price')),
          billing: q('billing'),
          volume: growth
            ? { start: numOrNull(q('start')), monthly_growth_pct: numOrNull(q('growth')) }
            : { start: numOrNull(q('start')), month12: numOrNull(q('m12')), month36: numOrNull(q('m36')) },
          unit_cost_usd: numOrNull(q('cost')),
        };
        const buys = numOrNull(q('buys'));
        if (t.billing === 'per_unit' && buys) t.purchases_per_customer_month = buys;
        return t;
      }).filter((t) => t.name || t.price_usd != null || t.volume.start != null);
      if (!tiers.length) return null;
      const out = { tiers };
      const sam = numOrNull(market.querySelector('[data-rb="sam"]').value);
      if (sam) out.serviceable_customers = sam;
      const basis = market.querySelector('[data-rb="sam_basis"]').value.trim();
      if (basis) out.market_basis = basis;
      return out;
    }

    function updateSummary() {
      const v = value();
      const engine = root.FoundryEngines?.finance;
      const norm = v && engine?.normalizeRevenueBuildup ? engine.normalizeRevenueBuildup(v) : null;
      if (!norm) {
        summary.textContent = v ? 'Add a price and an expected volume to at least one row.' : '';
        return;
      }
      const model = engine.buildRevenueModel(norm, { firstMonth: 1 });
      const y2 = model.annual[1];
      summary.textContent = `${norm.tiers.length} product${norm.tiers.length === 1 ? '' : 's'} · ${money(model.monthly_revenue_month12_usd)} a month by month 12 (counting from opening) · Year 2 about ${money(y2.revenue_usd)} at ${Math.round((y2.gross_margin_pct || 0) * 100)}% gross margin${
        norm.dropped.length ? ` · ${norm.dropped.length} row${norm.dropped.length === 1 ? '' : 's'} left out (no price or volume)` : ''
      }`;
    }

    function setValue(v) {
      list.replaceChildren();
      const tiers = v?.tiers?.length ? v.tiers : [{}];
      tiers.forEach((t) => addTier(t));
      market.querySelector('[data-rb="sam"]').value = v?.serviceable_customers ?? '';
      market.querySelector('[data-rb="sam_basis"]').value = v?.market_basis ?? '';
      updateSummary();
    }

    addBtn.addEventListener('click', () => {
      const card = addTier();
      renumber();
      card.querySelector('input')?.focus();
    });
    market.addEventListener('input', updateSummary);
    setValue(opts.initial || null);
    return { value, setValue, isEmpty: () => value() == null };
  }

  root.FoundryRevenueBuildup = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
