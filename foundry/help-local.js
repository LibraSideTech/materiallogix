/**
 * Help: free help near you. Lists the nearest Small Business Development Center, SCORE chapter,
 * Women's Business Center and the other offices the saved plan's documents name (the plan's own
 * render_model.local_help, computed on this device from the local help directory). Plain text
 * only; nothing is sent anywhere and no link is opened. Kept apart from help.js, which never reads
 * the plan.
 */
(function () {
  'use strict';
  var section = document.getElementById('localHelp');
  var list = document.getElementById('localHelpList');
  if (!section || !list) return;
  function readHelp() {
    try {
      var saved = JSON.parse(sessionStorage.getItem('foundry.instant.context') || 'null');
      return saved && saved.render_model && saved.render_model.local_help;
    } catch (e) {
      return null;
    }
  }
  // The tab holds the plan once any Foundry page has opened it. Help opened in a new tab (or after
  // the tab was closed) starts empty, so wait for this device's saved copy to be read first.
  var help = readHelp();
  if (help) render(help);
  else if (window.FoundryPlanStore && window.FoundryPlanStore.ready) {
    window.FoundryPlanStore.ready.then(function () {
      var restored = readHelp();
      if (restored) render(restored);
    }, function () {});
  }

  function render(help) {
    if (!Array.isArray(help.offices) || !help.offices.length) return;
    help.offices.forEach(function (o) {
      var li = document.createElement('li');
      var name = document.createElement('strong');
      name.textContent = o.name;
      li.appendChild(name);
      var bits = [o.label, o.address, o.distance, o.phone, o.website].filter(Boolean);
      li.appendChild(document.createTextNode(' · ' + bits.join(' · ')));
      list.appendChild(li);
    });
    var lenders = document.getElementById('localHelpLenders');
    if (lenders && Array.isArray(help.lenders) && help.lenders.length) {
      lenders.textContent = 'Lenders that make smaller loans, often with advice attached: ' + help.lenders.map(function (o) { return o.name + ' (' + o.website + ')'; }).join('; ') + '.';
      lenders.hidden = false;
    }
    section.hidden = false;
  }
})();
