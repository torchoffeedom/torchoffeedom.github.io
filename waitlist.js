/* FEEDOM waitlist page.
 *
 * Three jobs: flip the hero from CONSUME to CONTROL, take the email, then take the 5-question survey.
 *
 * THE ONE SETTING THAT MATTERS (now live: true, the database side was applied on 2026-11-20)
 *   live: false  -> draft mode. Nothing is sent anywhere. Test entries are kept in this browser only
 *                   (localStorage, key "feedom-waitlist-draft") and a black note shows at the top of the page.
 *   live: true   -> emails and answers go to the FEEDOM Supabase project (Frankfurt) through two
 *                   functions, join_waitlist and save_waitlist_survey. Apply
 *                   backend/supabase/migrations/20261120000001_waitlist.sql first, or every sign-up fails.
 *
 * The address and key below are public by design (the extension uses the same pair). The database
 * allows this key to call the two functions and nothing else: it cannot read the list.
 *
 * No cookies, no analytics, no storage in live mode. The survey token lives in memory only.
 */
(function () {
  'use strict';

  var CONFIG = {
    live: true,
    supabaseUrl: 'https://wcghlceaoepxgscvjewb.supabase.co',
    supabaseKey: 'sb_publishable_95UfNf7TE6ayqQBRcyGaDQ_wyA34b_Q',
    timeoutMs: 10000
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var screens = { landing: $('#landing'), confirm: $('#confirm'), thanks: $('#thanks') };
  var surveyToken = null;       // in memory only
  var joinedEmail = null;

  // ---------- the CONSUME / CONTROL switch ----------
  var hero = $('.hero');
  var sw = $('#mode-switch');
  var hint = $('#switch-hint');
  function setMode(mode) {
    var control = mode === 'control';
    hero.setAttribute('data-mode', control ? 'control' : 'consume');
    sw.setAttribute('aria-checked', control ? 'true' : 'false');
    hint.textContent = control ? 'CONTROL mode on. Flip it back to see the feed as it was.' : 'Flip the switch.';
  }
  sw.addEventListener('click', function () {
    setMode(sw.getAttribute('aria-checked') === 'true' ? 'consume' : 'control');
  });

  // ---------- draft mode note ----------
  if (!CONFIG.live) $('#draft-note').hidden = false;

  // ---------- screens ----------
  function show(name, push) {
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    if (push) {
      try { history.pushState({ step: name }, '', name === 'landing' ? location.pathname + location.search : '#' + name); } catch (e) { /* file:// */ }
    }
    window.scrollTo(0, 0);
    if (name !== 'landing') screens[name].focus({ preventScroll: true });
  }
  function stepFromHash() {
    var h = (location.hash || '').replace('#', '');
    if (h === 'confirm' || h === 'thanks') {
      // In draft mode both screens can be previewed by address. In live mode only a real sign-up gets there.
      if (!CONFIG.live || (h === 'confirm' && surveyToken)) return h;
    }
    return 'landing';
  }
  window.addEventListener('popstate', function () { show(stepFromHash(), false); });
  if (stepFromHash() !== 'landing') show(stepFromHash(), false);

  // ---------- helpers ----------
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  function sourceTag() {
    var s = new URLSearchParams(location.search).get('src') || '';
    return /^[a-z0-9_-]{1,40}$/i.test(s) ? s.toLowerCase() : 'website';
  }
  function showError(form, msg) {
    var box = $('.wl-error', form);
    box.textContent = msg;
    box.hidden = !msg;
  }
  function draftSave(kind, payload) {
    try {
      var key = 'feedom-waitlist-draft';
      var list = JSON.parse(localStorage.getItem(key) || '[]');
      list.push({ kind: kind, at: new Date().toISOString(), data: payload });
      localStorage.setItem(key, JSON.stringify(list));
    } catch (e) { /* storage blocked: draft mode still shows the screens */ }
  }
  function rpc(fn, body) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, CONFIG.timeoutMs);
    return fetch(CONFIG.supabaseUrl + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CONFIG.supabaseKey },
      body: JSON.stringify(body),
      signal: ctl.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }, function (err) { clearTimeout(timer); throw err; });
  }

  // ---------- step 1: the email ----------
  $$('.wl-form').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      showError(form, '');
      var email = form.elements.email.value.trim();
      var trap = form.elements.website && form.elements.website.value;
      if (!EMAIL_RE.test(email)) {
        showError(form, 'Enter an email address like name@example.com.');
        form.elements.email.focus();
        return;
      }
      var btn = $('button[type="submit"]', form);
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Joining…';
      var done = function (token) {
        joinedEmail = email;
        surveyToken = token;
        btn.disabled = false;
        btn.textContent = label;
        show('confirm', true);
      };
      if (trap) { done(null); return; }                       // a bot filled the hidden field: look like success, send nothing
      if (!CONFIG.live) { draftSave('join', { email: email, source: sourceTag() }); done('draft'); return; }
      rpc('join_waitlist', { p_email: email, p_source: sourceTag() }).then(done, function () {
        btn.disabled = false;
        btn.textContent = label;
        showError(form, 'We could not reach the list. Check your connection and press the button again.');
      });
    });
  });

  // ---------- step 2: the five questions ----------
  var survey = $('#survey');
  survey.addEventListener('submit', function (ev) {
    ev.preventDefault();
    showError(survey, '');
    var answers = { version: 'survey-v1' };
    ['situation', 'result', 'price'].forEach(function (name) {
      var picked = $('input[name="' + name + '"]:checked', survey);
      if (picked) answers[name] = picked.value;
    });
    ['frustrations', 'tried'].forEach(function (name) {
      var picked = $$('input[name="' + name + '"]:checked', survey).map(function (i) { return i.value; });
      if (picked.length) answers[name] = picked;
    });
    var btn = $('button[type="submit"]', survey);
    var label = btn.textContent;
    var finish = function () { btn.disabled = false; btn.textContent = label; show('thanks', true); };

    if (!CONFIG.live) { draftSave('survey', { email: joinedEmail, answers: answers }); finish(); return; }
    if (!surveyToken) { showError(survey, 'Your session ended. Reload the page and join again to save your answers.'); return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    rpc('save_waitlist_survey', { p_token: surveyToken, p_answers: answers }).then(finish, function () {
      btn.disabled = false;
      btn.textContent = label;
      showError(survey, 'We could not save your answers. Press the button again.');
    });
  });

  // ---------- share ----------
  $('#share-btn').addEventListener('click', function () {
    var note = $('#share-note');
    var url = location.origin + location.pathname;
    var data = { title: 'FEEDOM', text: 'Burn the Feed. Claim Your Feedom. Join the FEEDOM waitlist.', url: url };
    if (navigator.share) { navigator.share(data).catch(function () { /* closed by the person */ }); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { note.textContent = 'Link copied.'; },
        function () { note.textContent = url; }
      );
    } else { note.textContent = url; }
  });
})();
