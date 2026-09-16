const ready = document.readyState === 'loading'
  ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  : Promise.resolve();

await ready;

const pricing = document.querySelector('#pricing');
if (pricing && !document.querySelector('#materiallogixCheckoutUi')) {
  const style = document.createElement('style');
  style.id = 'materiallogixCheckoutUi';
  style.textContent = `
    .commerce-toolbar{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:20px 0 8px;padding:16px 18px;background:var(--glass);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border:1px solid var(--glass-line);box-shadow:inset 0 1px 0 var(--glass-highlight),var(--glass-shadow);border-radius:14px}
    .commerce-toolbar label{display:grid;gap:6px;font-size:12px;font-weight:700;color:var(--ink-2)}
    .commerce-toolbar select,.commerce-promo input{min-height:44px;border:1px solid var(--hair);border-radius:10px;background:var(--card);color:var(--ink);padding:0 12px;font:inherit}
    .commerce-toolbar p{margin:0;max-width:50ch;color:var(--muted);font-size:12px}
    .checkout-cta{width:100%;margin-top:16px;white-space:normal;text-align:center}
    .single-checkout{display:none}
    #sp-photo:checked~.single-checkout-photo,#sp-video:checked~.single-checkout-video,#sp-voice:checked~.single-checkout-voice{display:flex}
    #spp-photo:checked~.single-checkout-photo,#spp-video:checked~.single-checkout-video,#spp-voice:checked~.single-checkout-voice{display:flex}
    .commerce-purchase{display:grid;gap:12px;margin:18px 0 0;padding:18px;background:var(--glass);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border:1px solid var(--glass-line);box-shadow:inset 0 1px 0 var(--glass-highlight),var(--glass-shadow);border-radius:14px}
    .commerce-promo{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;max-width:420px;font-size:12px;font-weight:700;color:var(--ink-2)}
    .commerce-promo[hidden]{display:none}
    .commerce-consent{display:flex;align-items:flex-start;gap:10px;color:var(--ink-2);font-size:12px;line-height:1.5}
    .commerce-consent input{width:20px;height:20px;flex:0 0 auto;margin:1px 0 0;accent-color:var(--gold)}
    .commerce-consent a{text-decoration:underline;text-underline-offset:2px}
    .commerce-plain{margin:0;padding-left:18px;color:var(--ink-2);font-size:12px;line-height:1.55}
    .commerce-plain li{margin:4px 0}
    #checkoutStatus{min-height:1.5em;margin:0;color:var(--ink-2);font-size:12px;font-weight:600}
    @media(max-width:720px){.commerce-toolbar{align-items:stretch;flex-direction:column}.commerce-toolbar label{width:100%}.commerce-toolbar select{width:100%}}
  `;
  document.head.append(style);

  const plans = [...pricing.querySelectorAll('.plan')];
  const card = title => plans.find(item => item.querySelector('h3')?.textContent.trim().toLowerCase() === title.toLowerCase());
  const addButton = (target, attributes, label) => {
    if (!target) return null;
    const selector = attributes.checkoutPlan
      ? `[data-checkout-plan="${attributes.checkoutPlan}"]`
      : `[data-checkout-sku="${attributes.checkoutSku}"]`;
    let button = target.querySelector(selector);
    if (button) return button;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn primary checkout-cta';
    if (attributes.checkoutPlan) button.dataset.checkoutPlan = attributes.checkoutPlan;
    if (attributes.checkoutSku) button.dataset.checkoutSku = attributes.checkoutSku;
    button.textContent = label;
    target.append(button);
    return button;
  };

  // Free Preview has no purchase of its own — it is free, and MaterialLogix
  // sells subscriptions only. The one-off "export_one" SKU below was the
  // retired pay-per-export purchase; it still fulfils an already-paid
  // customer's replayed webhook (see workers/license-service.ts), but a live
  // Buy button here would sell a product the business decided to stop
  // selling.
  addButton(card('Voice Starter'), { checkoutPlan: 'voice_starter' }, 'Choose Voice Starter');

  const attachProductPicker = (planCard, namePrefix, panelPlans, fallbackLabel) => {
    if (!planCard) return;
    const picker = planCard.querySelector('.picker');
    let attached = 0;
    if (picker) {
      for (const [kind, plan, label] of panelPlans) {
        const button = addButton(picker, { checkoutPlan: plan }, label);
        if (button) {
          button.classList.add('single-checkout', `single-checkout-${kind}`);
          attached += 1;
        }
      }
    }
    if (!attached) {
      const productSelect = document.createElement('select');
      productSelect.setAttribute('aria-label', fallbackLabel);
      productSelect.innerHTML = panelPlans
        .map(([, plan, label]) => `<option value="${plan}">${label.replace(/^Choose [^—]+ — /, '')}</option>`)
        .join('');
      productSelect.style.cssText = 'width:100%;min-height:44px;margin-top:16px;border:1px solid var(--hair);border-radius:10px;background:var(--card);color:var(--ink);padding:0 12px;font:inherit';
      planCard.append(productSelect);
      const button = addButton(planCard, { checkoutPlan: panelPlans[0][1] }, panelPlans[0][2]);
      productSelect.addEventListener('change', () => {
        button.dataset.checkoutPlan = productSelect.value;
        button.textContent = `Choose ${fallbackLabel} — ${productSelect.options[productSelect.selectedIndex].text}`;
      });
    }
  };

  attachProductPicker(card('Single Studio'), 'sp', [
    ['photo', 'single_photo', 'Choose Single Studio — Photo'],
    ['video', 'single_video', 'Choose Single Studio — Video'],
    ['voice', 'single_voice', 'Choose Single Studio — Voice']
  ], 'Single Studio');

  attachProductPicker(card('Single Studio Pro'), 'spp', [
    ['photo', 'single_pro_photo', 'Choose Single Studio Pro — Photo'],
    ['video', 'single_pro_video', 'Choose Single Studio Pro — Video'],
    ['voice', 'single_pro_voice', 'Choose Single Studio Pro — Voice']
  ], 'Single Studio Pro');

  addButton(card('Full Studio'), { checkoutPlan: 'full' }, 'Choose Full Studio');
  addButton(card('Pro Studio'), { checkoutPlan: 'full_pro' }, 'Choose Pro Studio');

  const plansContainer = pricing.querySelector('.plans');
  if (plansContainer && !document.querySelector('#billingTerm')) {
    const toolbar = document.createElement('div');
    toolbar.className = 'commerce-toolbar';
    toolbar.innerHTML = `
      <label>Billing term
        <select id="billingTerm">
          <option value="monthly">Month-to-month</option>
          <option value="quarterly">3 months</option>
          <option value="yearly">Annual</option>
        </select>
      </label>
      <p>Paid Checkout stays closed until billing is live. Start a free preview anytime; the buttons below prepare the plan you want when sales open.</p>`;
    plansContainer.before(toolbar);
  }

  // Keep the visible Monthly/Quarterly/Yearly radios and #billingTerm on one
  // source of truth so the price a customer sees is the SKU Checkout would use.
  const billingTerm = document.querySelector('#billingTerm');
  const termRadios = {
    monthly: document.querySelector('#term-m'),
    quarterly: document.querySelector('#term-q'),
    yearly: document.querySelector('#term-y')
  };
  const syncTermFromRadio = () => {
    if (!billingTerm) return;
    if (termRadios.quarterly?.checked) billingTerm.value = 'quarterly';
    else if (termRadios.yearly?.checked) billingTerm.value = 'yearly';
    else billingTerm.value = 'monthly';
    billingTerm.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const syncRadioFromSelect = () => {
    const value = billingTerm?.value || 'monthly';
    const radio = termRadios[value];
    if (radio) radio.checked = true;
  };
  for (const radio of Object.values(termRadios)) {
    radio?.addEventListener('change', syncTermFromRadio);
  }
  billingTerm?.addEventListener('change', syncRadioFromSelect);
  syncTermFromRadio();

  let purchase = pricing.querySelector('.commerce-purchase');
  if (!purchase) {
    purchase = document.createElement('div');
    purchase.className = 'commerce-purchase';
    plansContainer?.after(purchase);
  }

  let promoRow = document.querySelector('#promoRow');
  if (!promoRow) {
    promoRow = document.createElement('label');
    promoRow.id = 'promoRow';
    promoRow.className = 'commerce-promo';
    promoRow.hidden = true;
    promoRow.innerHTML = 'Promo code <input id="promoCode" type="text" inputmode="text" autocomplete="off" maxlength="64" placeholder="Optional">';
  }
  if (!promoRow.closest('.commerce-purchase')) {
    promoRow.classList.add('commerce-promo');
    purchase.append(promoRow);
  }

  // Paid Checkout is still closed. Do not mount renew / consent purchase chrome
  // that makes the page look ready to charge; status alone is honest.
  const { PUBLIC_CHECKOUT_OPEN } = await import('/studio/js/pricing.js?v=20260914');
  if (PUBLIC_CHECKOUT_OPEN) {
    if (!document.querySelector('#purchasePlainSummary')) {
      const plain = document.createElement('ul');
      plain.id = 'purchasePlainSummary';
      plain.className = 'commerce-plain';
      plain.innerHTML = `
        <li>Plans renew at the selected interval until you cancel.</li>
        <li>14-day refunds follow the Refund Policy.</li>
        <li>Disputes use individual arbitration, with a free 30-day email opt-out.</li>`;
      purchase.append(plain);
    }
    if (!document.querySelector('#purchaseConsent')) {
      // Show the governing documents in the purchase flow and keep assent
      // disabled until the required notices have been read.
      const { installLegalAcceptance } = await import('/legal-acceptance.js?v=20260908');
      await installLegalAcceptance(purchase);
    }
  }

  if (!document.querySelector('#checkoutStatus')) {
    const status = document.createElement('p');
    status.id = 'checkoutStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = PUBLIC_CHECKOUT_OPEN
      ? 'Review your plan, accept the Terms, then continue to Stripe Checkout.'
      : 'Paid Checkout is not open yet. No payment can be taken from this page.';
    purchase.append(status);
  }

  await import('/studio/js/checkout.js?v=20260914');
}
