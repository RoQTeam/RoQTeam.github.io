/*
	BreaQ Hackathon: on your own or in a team (team-choice.html, roqteam.ro/team-choice)
	- for a registered hackathon participant, with the personal code from the email that asked them (its link
	  fills it in through #code=…): posts { action: "team-choice", code } to the Apps Script in data-endpoint
	  (tools/register-backend.gs) for what their registration says now, then { action: "team-choice", code, team,
	  mates } with their answer
	- team: solo (on their own), team (with the teammates they name, two at most), match (the organisers put them
	  in a team)
	- the code is not kept: it leaves the address as soon as the page has read it
*/

(function () {

	'use strict';

	var root = document.getElementById('tc');
	if (!root) return;

	var endpoint = (root.getAttribute('data-endpoint') || '').trim();
	var STEPS = ['loading', 'code-form', 'choice-form', 'done'];
	var state = { code: '', me: null };

	function $(id) { return document.getElementById(id); }
	function forEach(list, fn) { Array.prototype.forEach.call(list, fn); }

	function step(id) {
		STEPS.forEach(function (s) { $(s).hidden = s !== id; });
	}

	function error(msg) {
		$('err').textContent = msg || '';
		$('err').hidden = !msg;
	}

	function post(body, done) {
		var ctrl = window.AbortController ? new AbortController() : null;
		var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, 30000) : null;
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
		if (err && err.name === 'AbortError') return 'Google took too long to answer. Try again in a minute.';
		return 'Could not reach the server. Check your connection and try again.';
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
		post({ action: 'team-choice', code: code }, function (json, err) {
			if (json && json.ok && json.me) {
				state.me = json.me;
				fill();
				step('choice-form');
				return;
			}
			if (((json && json.temporary) || err) && tries < 2) {
				window.setTimeout(function () { open(code, tries + 1); }, 2000);
				return;
			}
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

	function chosen() {
		var r = $('choice-form').querySelector('input[name="team"]:checked');
		return r ? r.value : '';
	}

	function sync() {
		var c = chosen();
		forEach($('choice-form').querySelectorAll('.tc-opt'), function (opt) {
			opt.classList.toggle('is-on', opt.querySelector('input').checked);
		});
		$('mates-field').hidden = c !== 'team';
	}

	function fill() {
		var me = state.me;
		$('hello').textContent = 'Hi ' + me.name + '. How do you want to take part in the hackathon?';
		forEach($('choice-form').querySelectorAll('input[name="team"]'), function (r) { r.checked = r.value === me.team; });
		$('mates').value = me.team === 'team' ? me.mates : '';
		$('mates-hint').textContent = 'Their names as they write them on their own registrations. Each of them registers too, on roqteam.ro/register with their own motivation letter, by ' + me.by + '.';
		sync();
	}

	$('choice-form').addEventListener('change', sync);

	$('choice-form').addEventListener('submit', function (ev) {
		ev.preventDefault();
		var team = chosen();
		var mates = $('mates').value.trim();
		if (!team) { error('Choose one of the three.'); return; }
		if (team === 'team' && !mates) { error('Write your teammates’ names.'); $('mates').focus(); return; }
		error('');
		var btn = $('save');
		btn.disabled = true;
		btn.classList.add('is-busy');
		btn.textContent = 'Saving…';
		post({ action: 'team-choice', code: state.code, team: team, mates: team === 'team' ? mates : '' }, function (json, err) {
			btn.disabled = false;
			btn.classList.remove('is-busy');
			btn.textContent = 'Save';
			if (json && json.ok && json.me) {
				state.me = json.me;
				done();
				return;
			}
			if (json && json.denied) { step('code-form'); }
			error(problem(json, err));
		});
	});

	function done() {
		var me = state.me;
		var text = {
			solo: 'Saved: you take part on your own.',
			team: 'Saved: you come with ' + me.mates + '.',
			match: 'Saved: we put you in a team with other participants.'
		};
		var next = {
			solo: 'Changed your mind? Come back with the same link.',
			team: (me.mates.indexOf(',') === -1 ? 'They register' : 'Each of them registers') + ' too, by ' + me.by + ', on roqteam.ro/register with their own motivation letter and your name among their teammates, so that we read your applications together.',
			match: 'We tell you about your team before the hackathon.'
		};
		$('done-text').textContent = text[me.team] || 'Saved.';
		$('done-next').textContent = next[me.team] || '';
		step('done');
	}

	$('change').addEventListener('click', function () {
		fill();
		error('');
		step('choice-form');
	});

	/* --- start ------------------------------------------------------------ */

	var code = codeFromLink();
	if (code) open(code, 0);
	else step('code-form');

})();
