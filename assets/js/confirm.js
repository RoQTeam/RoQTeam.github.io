/*
	BreaQ Conference: are you coming? (confirm.html, roqteam.ro/confirm)
	- for someone registered for the conference, with the personal code from the email that asked them (its link
	  fills it in through #code=…): posts { action: "conference-coming", code } to data-endpoint (api/confirm.php on
	  roqteam.ro, with SQLite: an answer in a blink) for their answer so far, then { action: "conference-coming", code,
	  coming } with "yes" or "no", as often as they change their mind, until the conference starts
	- the code leaves the address as soon as the page has read it, and stays in this tab only, for a reload
*/

(function () {

	'use strict';

	var root = document.getElementById('cc');
	if (!root) return;

	var endpoint = (root.getAttribute('data-endpoint') || '').trim();
	var STEPS = ['loading', 'code-form', 'ask', 'done'];
	var CODE_STORE = 'breaq-conference-code';
	var state = { code: '', me: null, busy: false };

	function $(id) { return document.getElementById(id); }

	function step(id) {
		STEPS.forEach(function (s) { $(s).hidden = s !== id; });
	}

	function error(msg) {
		$('err').textContent = msg || '';
		$('err').hidden = !msg;
	}

	function post(body, done) {
		var ctrl = window.AbortController ? new AbortController() : null;
		var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, 15000) : null;
		window.fetch(endpoint, {
			method: 'POST',
			body: JSON.stringify(body),
			cache: 'no-store',
			signal: ctrl ? ctrl.signal : undefined
		}).then(function (res) {
			return res.json();
		}).then(function (json) {
			if (timer) window.clearTimeout(timer);
			done(json, null);
		}).catch(function (err) {
			if (timer) window.clearTimeout(timer);
			done(null, err);
		});
	}

	function problem(json, err) {
		if (json && json.error) return json.error;
		if (err && err.name === 'AbortError') return 'The server took too long to answer. Try again in a minute.';
		return 'Could not reach the server. Check your connection and try again.';
	}

	function keep(code) {
		try {
			if (code) window.sessionStorage.setItem(CODE_STORE, code);
			else window.sessionStorage.removeItem(CODE_STORE);
		} catch (e) {}
	}

	function kept() {
		try { return window.sessionStorage.getItem(CODE_STORE) || ''; } catch (e) { return ''; }
	}

	/* --- the code ---------------------------------------------------- */

	// #code=ABCD-EFGH from the email's link, then out of the address (and of the history)
	function codeFromLink() {
		var m = /[#&]code=([^&]+)/.exec(window.location.hash || '');
		if (!m) return '';
		try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
		try { return decodeURIComponent(m[1]).trim(); } catch (e) { return ''; }
	}

	function open(code, tries) {
		state.code = code;
		error('');
		step('loading');
		post({ action: 'conference-coming', code: code }, function (json, err) {
			if (json && json.ok && json.me) {
				keep(code);
				state.me = json.me;
				show(false);
				return;
			}
			if (((json && json.temporary) || err) && tries < 2) {
				window.setTimeout(function () { open(code, tries + 1); }, 2000);
				return;
			}
			if (json && json.denied) keep('');
			step('code-form');
			$('code').value = code;
			error(problem(json, err));
		});
	}

	$('code-form').addEventListener('submit', function (ev) {
		ev.preventDefault();
		var code = $('code').value.trim();
		if (!code) { error('Type the code from the email first.'); $('code').focus(); return; }
		open(code, 0);
	});

	/* --- the answer ---------------------------------------------------- */

	// what we have: the question, or their answer with the other one a click away. moved: focus the title, so a
	// screen reader hears what changed
	function show(moved) {
		var me = state.me;
		var closed = !me.open;
		error('');
		$('card').classList.toggle('is-yes', me.coming === 'yes');
		$('card').classList.toggle('is-no', me.coming === 'no');
		if (!me.coming) {
			$('title').textContent = 'Are you coming?';
			$('hello').textContent = 'Hi ' + me.name + '. You are registered for the BreaQ Conference. Tell us whether you are coming: one click, and you can change it later.';
			$('yes').hidden = $('no').hidden = closed;
			if (closed) $('hello').textContent = 'Hi ' + me.name + '. The conference has started, so this page no longer takes answers.';
			step('ask');
		} else {
			var yes = me.coming === 'yes';
			$('title').textContent = yes ? 'See you on 14 November.' : 'Thank you for telling us.';
			$('done-text').textContent = yes
				? 'Your answer is in, ' + me.name + ': you are coming. The programme and the practical details (the times, the room, how to get in) reach you by email closer to the day.'
				: 'Your answer is in, ' + me.name + ': you cannot come this time. We will miss you. Changed your mind? You are still registered, so tell us below.';
			$('mark').hidden = !yes;
			$('cal').hidden = !yes;
			$('change').textContent = yes ? 'I cannot come after all' : 'I am coming after all';
			$('change').className = 'btn small ' + (yes ? 'ghost' : 'primary');
			$('change').setAttribute('data-coming', yes ? 'no' : 'yes');
			$('change').hidden = closed;
			step('done');
		}
		if (moved) $('title').focus();
	}

	function answer(btn) {
		if (state.busy) return;
		var coming = btn.getAttribute('data-coming');
		var label = btn.innerHTML;
		state.busy = true;
		error('');
		btn.disabled = true;
		btn.classList.add('is-busy');
		btn.textContent = 'Saving…';
		post({ action: 'conference-coming', code: state.code, coming: coming }, function (json, err) {
			state.busy = false;
			btn.disabled = false;
			btn.classList.remove('is-busy');
			btn.innerHTML = label;
			if (json && json.ok && json.me) {
				state.me = json.me;
				show(true);
				return;
			}
			if (json && json.denied) { keep(''); step('code-form'); }
			error(problem(json, err));
		});
	}

	['yes', 'no', 'change'].forEach(function (id) {
		$(id).addEventListener('click', function () { answer(this); });
	});

	/* --- start ------------------------------------------------------------ */

	var code = codeFromLink() || kept();
	if (code) open(code, 0);
	else step('code-form');

	// the email's link again, on the page already open: it changes only the address's #, which reloads nothing
	window.addEventListener('hashchange', function () {
		var again = codeFromLink();
		if (again && !state.busy) open(again, 0);
	});

})();
