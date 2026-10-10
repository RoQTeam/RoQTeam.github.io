/*
	BreaQ Hackathon: the team dashboard (teams.html, roqteam.ro/teams)
	- for the accepted participants: asks for their personal code (in their acceptance email, whose link fills it in
	  through #code=…) and posts { action: "board", code } to the Apps Script in data-endpoint
	  (tools/register-backend.gs), which checks that the code is an accepted participant's; the admin key opens it too
	  (an organiser whose admin page remembers the key on this device gets in without typing it)
	- shows what the organisers post from the admin page: announcements (pinned first, then newest first), the
	  checklist for the day (ticked off on this device), each challenge's resources, how to submit, the practical
	  details; asks again every minute while the tab is shown (also when hidden, with notifications on)
	- and what is the participant's own: their team (the admin page's Teams view), "are you coming?" until the
	  event starts ("coming"), "ask a mentor" during it ("help", "help-cancel"; the mentors answer on mentors.html),
	  the feedback form from the awards on ("feedback")
	- notifications (assets/js/notify.js), when asked for: new announcements, a mentor on the way, what starts in
	  5 minutes, 15 minutes before coding stops; only while the tab is hidden
	- the live strip and the schedule come from SCHEDULE below: keep it the same as breaq-hackathon.html#schedule
	- every time is shown in Bucharest time, whatever the device's time zone
*/

(function () {

	'use strict';

	var root = document.getElementById('teams');
	if (!root) return;

	var endpoint = (root.getAttribute('data-endpoint') || '').trim();
	var CODE_STORE = 'breaq-2026-team-code';
	var ADMIN_STORE = 'breaq-2026-admin-key';   // admin.js keeps the key there when asked to remember it
	var SEEN_STORE = 'breaq-2026-team-seen';   // when the newest announcement read was posted, for the "New" marks
	var CHECK_STORE = 'breaq-2026-checklist';   // the checklist items ticked on this device
	var POLL_MS = 60000;
	var HELP_POLL_MS = 20000;   // while a mentor request is open
	var CONFIRM_BY = 'Wednesday 21 October';   // as CONFIRM_BY in tools/register-backend.gs
	var CONFIRM_END = Date.parse('2026-10-22T00:00:00+03:00');
	var PLACE = { '1st': 'First place', '2nd': 'Second place', '3rd': 'Third place' };
	var CHALLENGES = ['Quantum Foundations', 'Quantum AI', 'Quantum Hacking'];
	var SUB_EMPTY = 'How and where to hand in your work is posted here before Sunday.';
	var TZ = 'Europe/Bucharest';

	// The hackathon, as on breaq-hackathon.html#schedule. Full timestamps with their offset: summer time ends in the
	// night (04:00 → 03:00 on Sunday), so the night's coding block is five hours.
	var SCHEDULE = [
		['2026-10-24T09:00:00+03:00', '2026-10-24T10:00:00+03:00', 'Official opening', 'key'],
		['2026-10-24T10:30:00+03:00', '2026-10-24T13:30:00+03:00', 'Start hacking!', 'code'],
		['2026-10-24T14:00:00+03:00', '2026-10-24T14:30:00+03:00', 'Workshop', 'talk'],
		['2026-10-24T14:30:00+03:00', '2026-10-24T15:00:00+03:00', 'Coding time', 'code'],
		['2026-10-24T15:00:00+03:00', '2026-10-24T15:30:00+03:00', 'Lunch', 'meal'],
		['2026-10-24T15:30:00+03:00', '2026-10-24T20:00:00+03:00', 'Coding time', 'code'],
		['2026-10-24T20:00:00+03:00', '2026-10-24T20:30:00+03:00', 'Workshop', 'talk'],
		['2026-10-24T20:30:00+03:00', '2026-10-24T22:00:00+03:00', 'Coding time', 'code'],
		['2026-10-24T22:00:00+03:00', '2026-10-24T22:30:00+03:00', 'Dinner', 'meal'],
		['2026-10-24T22:30:00+03:00', '2026-10-25T02:00:00+03:00', 'Coding time', 'code'],
		['2026-10-25T02:00:00+03:00', '2026-10-25T02:30:00+03:00', 'Snack', 'meal'],
		['2026-10-25T02:30:00+03:00', '2026-10-25T06:30:00+02:00', 'Coding time', 'code'],
		['2026-10-25T06:30:00+02:00', '2026-10-25T07:00:00+02:00', 'Breakfast', 'meal'],
		['2026-10-25T07:00:00+02:00', '2026-10-25T09:00:00+02:00', 'Coding time', 'code'],
		['2026-10-25T09:00:00+02:00', null, 'Stop coding', 'stop'],
		['2026-10-25T09:30:00+02:00', '2026-10-25T12:00:00+02:00', 'Judging', 'key'],
		['2026-10-25T12:00:00+02:00', '2026-10-25T14:00:00+02:00', 'Awards', 'award']
	].map(function (s) {
		return { from: Date.parse(s[0]), to: s[1] ? Date.parse(s[1]) : null, title: s[2], kind: s[3] };
	});

	var START = SCHEDULE[0].from;
	var END = SCHEDULE[SCHEDULE.length - 1].to;
	var STOP = SCHEDULE.filter(function (s) { return s.kind === 'stop'; })[0].from;
	var JUDGING = SCHEDULE.filter(function (s) { return s.title === 'Judging'; })[0].from;
	var AWARDS = SCHEDULE.filter(function (s) { return s.kind === 'award'; })[0].from;

	// what the participant is asked for: before (are you coming?), during (ask a mentor), judging (their pitch),
	// after (the feedback)
	function phase(now) {
		if (now < START) return 'before';
		if (now < JUDGING) return 'during';
		if (now < AWARDS) return 'judging';
		return 'after';
	}

	function $(id) { return document.getElementById(id); }
	function forEach(list, fn) { Array.prototype.forEach.call(list, fn); }

	var state = {
		code: '',
		items: [],
		at: null,          // when the dashboard last came in
		seen: 0,           // announcements posted after this get "New" (this visit)
		known: {},         // ids already shown, so a new one flashes when it arrives
		failing: false,
		me: null,          // the participant's own: team, answer, mentor request, feedback (null for an organiser)
		organiser: false,
		actKey: '',        // what the action panel shows: drawn again only when that changes, so typing is kept
		confirmNo: false,  // "I cannot come" pressed once: asks to be sure
		draft: {},         // what is typed in the action panel's forms
		nudged: {}         // the schedule's reminders already shown
	};

	/* --- small helpers ---------------------------------------------- */

	function el(tag, cls, text) {
		var node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text !== undefined && text !== null) node.textContent = text;
		return node;
	}

	function icon(name) {
		var i = el('span', 'icon solid ' + name);
		i.setAttribute('aria-hidden', 'true');
		return i;
	}

	function link(href, text) {
		var a = el('a', null, text);
		a.href = href;
		a.target = '_blank';
		a.rel = 'noopener';
		return a;
	}

	function isUrl(s) { return /^https?:\/\/\S+$/i.test(s || ''); }

	// "Mihai" / "Mihai and Ioana" / "Mihai, Ioana and Radu"
	function and(names) {
		return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
	}

	function button(cls, text, onClick) {
		var b = el('button', 'btn ' + cls, text);
		b.type = 'button';
		if (onClick) b.addEventListener('click', onClick);
		return b;
	}

	function pad(n) { return n < 10 ? '0' + n : String(n); }

	var fmt = {
		time: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
		day: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }),
		dayKey: new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }),
		long: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
	};

	function hm(t) { return fmt.time.format(t); }

	// "14:05" today, "Sat 24 Oct, 14:05" another day
	function when(t) {
		var d = new Date(t);
		if (fmt.dayKey.format(d) === fmt.dayKey.format(new Date())) return 'Today, ' + hm(d);
		return fmt.day.format(d) + ', ' + hm(d);
	}

	// "2 d 4 h", "4 h 12 min", "12 min", "under a minute"
	function span(ms) {
		var m = Math.max(0, Math.floor(ms / 60000));
		var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
		if (d) return d + ' d ' + h + ' h';
		if (h) return h + ' h ' + pad(min) + ' min';
		if (min) return min + ' min';
		return 'under a minute';
	}

	// 18:42:07
	function clock(ms) {
		var s = Math.max(0, Math.floor(ms / 1000));
		return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
	}

	// Text as typed in the admin page: blank lines make paragraphs, line breaks stay, web addresses become links.
	// Built from text nodes and <a>, never from HTML, so nothing posted can run on the page.
	function richText(text) {
		var box = el('div', 'rich');
		String(text || '').split(/\n{2,}/).forEach(function (para) {
			if (!para.trim()) return;
			var p = el('p');
			para.split('\n').forEach(function (line, i) {
				if (i) p.appendChild(document.createElement('br'));
				var rest = line;
				var m;
				var re = /https?:\/\/[^\s<>"]*[^\s<>".,:;!?)\]]/i;
				while ((m = re.exec(rest))) {
					if (m.index) p.appendChild(document.createTextNode(rest.slice(0, m.index)));
					p.appendChild(link(m[0], m[0].replace(/^https?:\/\//i, '')));
					rest = rest.slice(m.index + m[0].length);
				}
				if (rest) p.appendChild(document.createTextNode(rest));
			});
			box.appendChild(p);
		});
		return box;
	}

	/* --- the code and the request -------------------------------------- */

	function storedCode() {
		try { return window.localStorage.getItem(CODE_STORE) || window.sessionStorage.getItem(CODE_STORE) || ''; }
		catch (e) { return ''; }
	}

	function storeCode(code, remember) {
		try {
			window.sessionStorage.setItem(CODE_STORE, code);
			if (remember) window.localStorage.setItem(CODE_STORE, code);
			else window.localStorage.removeItem(CODE_STORE);
		} catch (e) {}
	}

	function rememberedCode() {
		try { return window.localStorage.getItem(CODE_STORE) || ''; } catch (e) { return ''; }
	}

	function adminKey() {
		try { return window.localStorage.getItem(ADMIN_STORE) || ''; } catch (e) { return ''; }
	}

	function forgetCode() {
		try { window.sessionStorage.removeItem(CODE_STORE); window.localStorage.removeItem(CODE_STORE); } catch (e) {}
	}

	function storedSeen() {
		try { return +(window.localStorage.getItem(SEEN_STORE) || 0) || 0; } catch (e) { return 0; }
	}

	function storeSeen(t) {
		try { window.localStorage.setItem(SEEN_STORE, String(t)); } catch (e) {}
	}

	// Apps Script can take 10-15 s to wake up, and now and then answers with an error page: the first opening
	// tries up to three times within 40 s; the minute-by-minute updates try once and keep what is shown.
	function load(code, patient, done) {
		var started = Date.now();
		var tries = 0;

		function again(json, err) {
			if (patient && tries < 3 && Date.now() - started < 40000) window.setTimeout(attempt, tries * 1500);
			else done(json, err);
		}

		function attempt() {
			tries++;
			var ctrl = window.AbortController ? new AbortController() : null;
			var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, patient ? Math.max(10000, 60000 - (Date.now() - started)) : 30000) : null;
			window.fetch(endpoint, {
				method: 'POST',
				body: JSON.stringify({ action: 'board', code: code }),   // a string body: no CORS preflight against Apps Script
				cache: 'no-store',
				signal: ctrl ? ctrl.signal : undefined
			}).then(function (res) {
				return res.text();
			}).then(function (text) {
				if (timer) window.clearTimeout(timer);
				var json = null;
				try { json = JSON.parse(text); } catch (e) {}
				if (!json) return again(null, { name: 'NotData' });
				if (json.temporary) return again(json, null);
				done(json, null);
			}).catch(function (err) {
				if (timer) window.clearTimeout(timer);
				if (err && err.name === 'AbortError') done(null, err);
				else again(null, err);
			});
		}

		attempt();
	}

	// one answer from the participant ("coming", "help", "help-cancel", "feedback"): sent once, never repeated by
	// itself; done(problem) gets null when it went through, and the panels show what the answer brought back
	function ask(body, done) {
		body.code = state.code;
		var ctrl = window.AbortController ? new AbortController() : null;
		var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, 30000) : null;
		function finish(json, err) {
			if (timer) window.clearTimeout(timer);
			if (json && json.denied) { lock('This code no longer opens the team dashboard. Questions? Reply to your acceptance email, or ask at the desk.'); return; }
			if (json && json.ok && json.me) {
				var old = state.me;
				state.me = json.me;
				done(null);
				renderMine();
				helpNotice(old && old.help, json.me.help);
				schedulePoll();
				return;
			}
			done(json && json.error ? json.error : problem(json, err));
		}
		window.fetch(endpoint, {
			method: 'POST',
			body: JSON.stringify(body),
			cache: 'no-store',
			signal: ctrl ? ctrl.signal : undefined
		}).then(function (res) {
			return res.text();
		}).then(function (text) {
			var json = null;
			try { json = JSON.parse(text); } catch (e) {}
			finish(json, json ? null : { name: 'NotData' });
		}).catch(function (err) {
			finish(null, err);
		});
	}

	function loaded(json) { return !!(json && json.ok && json.items); }

	function problem(json, err) {
		if (json && json.denied) return json.error || 'That code is not right.';
		if (json && json.error && json.action === 'board') return json.error + ' Try again in a minute.';
		// the deployed script is older than this page: it reads the request as a registration
		if (json) return 'The dashboard is not open yet. Try again later.';
		if (err && err.name === 'AbortError') return 'The dashboard took too long to answer. Try again.';
		return 'Could not reach the dashboard. Check the connection and try again.';
	}

	/* --- lock ------------------------------------------------------------ */

	var lockForm = $('lock-form');
	var codeInput = $('code');
	var lockBtn = $('lock-btn');
	var lockErr = $('lock-err');

	function lockBusy(on) {
		lockBtn.disabled = on;
		lockBtn.classList.toggle('is-busy', on);
		lockBtn.textContent = on ? 'Opening…' : 'Open';
	}

	function lockError(msg) {
		lockErr.textContent = msg || '';
		lockErr.hidden = !msg;
	}

	// quiet: the admin key tried on its own, which is not kept under the dashboard's name and, refused, says nothing
	function unlock(code, remember, quiet) {
		lockError('');
		lockBusy(true);
		load(code, true, function (json, err) {
			lockBusy(false);
			if (loaded(json)) {
				state.code = code;
				if (!quiet) storeCode(code, remember);
				codeInput.value = '';
				state.seen = storedSeen();
				show(json, true);
				return;
			}
			if (quiet) { codeInput.focus(); return; }
			if (json && json.denied) forgetCode();
			lockError(problem(json, err));
			codeInput.focus();
		});
	}

	function lock(msg) {
		forgetCode();
		state.code = '';
		state.items = [];
		state.known = {};
		state.me = null;
		state.organiser = false;
		state.actKey = '';
		state.draft = {};
		window.clearTimeout(pollTimer);
		forEach(['live', 'ann', 'res', 'sub', 'prac', 'sched', 'act', 'team', 'check'], function (id) { $(id).textContent = ''; });
		$('act').hidden = true;
		$('team-panel').hidden = true;
		$('mine').hidden = true;
		$('who').textContent = '';
		$('dash').hidden = true;
		$('lock').hidden = false;
		document.title = baseTitle;
		lockError(msg || '');
		codeInput.focus();
	}

	lockForm.addEventListener('submit', function (ev) {
		ev.preventDefault();
		var code = codeInput.value.trim() || storedCode();
		if (!code) { lockError('Type your code first: it is in your acceptance email.'); codeInput.focus(); return; }
		unlock(code, $('remember').checked);
	});

	$('lock-now').addEventListener('click', function () { lock(''); });

	/* --- the dashboard ---------------------------------------------------- */

	var baseTitle = document.title;
	var refreshBtn = $('refresh');

	function dashError(msg) {
		$('dash-err').textContent = msg || '';
		$('dash-err').hidden = !msg;
	}

	function refresh(byHand) {
		if (!state.code) return;
		if (byHand) {
			refreshBtn.disabled = true;
			refreshBtn.textContent = 'Updating…';
		}
		load(state.code, !!byHand, function (json, err) {
			if (byHand) {
				refreshBtn.disabled = false;
				refreshBtn.textContent = 'Refresh';
			}
			if (loaded(json)) { state.failing = false; dashError(''); show(json, false); return; }
			if (json && json.denied) { lock('This code no longer opens the team dashboard. Questions? Reply to your acceptance email, or ask at the desk.'); return; }
			// a missed update keeps what is on the screen; asked by hand, it says why
			state.failing = true;
			renderMeta();
			if (byHand) dashError(problem(json, err));
			schedulePoll();
		});
	}

	refreshBtn.addEventListener('click', function () { refresh(true); });

	function show(json, first) {
		state.items = json.items.map(function (it) {
			return {
				id: String(it.id),
				section: it.section,
				challenge: it.challenge || '',
				title: it.title || '',
				text: it.text || '',
				link: isUrl(it.link) ? it.link : '',
				pinned: !!it.pinned,
				posted: it.posted ? Date.parse(it.posted) || 0 : 0,
				edited: it.edited ? Date.parse(it.edited) || 0 : 0
			};
		});
		state.at = Date.now();
		var who = json.who || {};
		var old = state.me;
		state.me = json.me || null;
		state.organiser = !!who.organiser;
		$('who').textContent = who.organiser ? 'Organiser view: what the accepted teams see (each also sees their own team and answers)' : who.name ? 'Signed in as ' + who.name : '';
		$('lock').hidden = true;
		$('dash').hidden = false;
		renderMeta();
		renderAnnouncements(first);
		renderMine();
		if (!first) helpNotice(old && old.help, state.me && state.me.help);
		renderResources();
		renderList('sub', 'submission', SUB_EMPTY, submissionLead);
		renderList('prac', 'practical', 'Wi-Fi, Discord, the room and who to ask for help: posted here before the event.');
		renderLive();
		renderSchedule();
		if (!document.hidden) markSeen();
		else markTitle();
		if (first && window.breaqNotify) window.breaqNotify.start('teams');
		renderBell();
		schedulePoll();
	}

	// what is the participant's own: their team, the action panel, the checklist (which follows their challenge)
	function renderMine() {
		renderTeam();
		renderChecklist();
		renderActRow();
	}

	// the action panel and the team card share a row: one of them alone takes all of it
	function renderActRow() {
		renderAct();
		$('mine').hidden = $('act').hidden && $('team-panel').hidden;
		$('mine').classList.toggle('is-single', $('act').hidden !== $('team-panel').hidden);
	}

	function section(name) {
		return state.items.filter(function (it) { return it.section === name; });
	}

	function renderMeta() {
		if (!state.at) { $('meta').textContent = ''; return; }
		$('meta').textContent = (state.failing ? 'Could not update · last ' : 'Updated ') + hm(state.at);
	}

	/* --- announcements ---------------------------------------------------- */

	function announcements() {
		return section('announcement').sort(function (a, b) {
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			return (b.posted || 0) - (a.posted || 0);
		});
	}

	function newest() {
		return section('announcement').reduce(function (m, it) { return Math.max(m, it.posted || 0); }, 0);
	}

	function renderAnnouncements(first) {
		var box = $('ann');
		var list = announcements();
		box.textContent = '';
		$('ann-count').textContent = list.length ? String(list.length) : '';
		if (!list.length) {
			box.appendChild(el('p', 'empty', 'Nothing yet. Announcements show up here as soon as we post them, and this page checks every minute.'));
			return;
		}
		var fresh = [];
		list.forEach(function (it) {
			var card = el('article', 'ann' + (it.pinned ? ' is-pinned' : ''));
			var head = el('div', 'ann-head');
			var meta = el('span', 'ann-time', it.posted ? when(it.posted) : '');
			// a fix right after posting is not news: "edited" only from two minutes on
			if (it.edited && it.edited - it.posted > 120000) meta.appendChild(el('span', 'ann-edited', ' · edited ' + when(it.edited)));
			head.appendChild(meta);
			if (it.pinned) {
				var pin = el('span', 'tag tag-pin');
				pin.appendChild(icon('fa-thumbtack'));
				pin.appendChild(document.createTextNode('Pinned'));
				head.appendChild(pin);
			}
			if (state.seen && it.posted > state.seen) head.appendChild(el('span', 'tag tag-new', 'New'));
			card.appendChild(head);
			if (it.title) card.appendChild(el('h3', null, it.title));
			if (it.text) card.appendChild(richText(it.text));
			if (it.link) {
				var go = link(it.link, 'Open the link');
				go.className = 'btn small';
				card.appendChild(go);
			}
			// arrived while the page was open: a short flash, and a notification when the tab is hidden
			if (!first && !state.known[it.id]) { card.classList.add('is-fresh'); fresh.push(it); }
			state.known[it.id] = true;
			box.appendChild(card);
		});
		if (fresh.length === 1) notify(fresh[0].title || 'New announcement', (fresh[0].text || '').slice(0, 160), 'breaq-ann');
		else if (fresh.length) notify(fresh.length + ' new announcements', fresh.map(function (it) { return it.title; }).filter(Boolean).join(' · '), 'breaq-ann');
	}

	// read: the "New" marks stay for this visit, and the next visit marks only what came after
	function markSeen() {
		var t = newest();
		if (!state.seen) state.seen = t || Date.now();   // a first visit: nothing is "new", it is all there is
		if (t > storedSeen()) storeSeen(t);
		document.title = baseTitle;
	}

	// in a hidden tab: "(2) Team dashboard" until it is looked at
	function markTitle() {
		var since = storedSeen();
		var n = section('announcement').filter(function (it) { return it.posted > since; }).length;
		document.title = (n && since ? '(' + n + ') ' : '') + baseTitle;
	}

	/* --- resources, submission, practical ------------------------------------ */

	function itemRow(it) {
		var row = el('li', 'item');
		var title = it.title || it.link.replace(/^https?:\/\//i, '');
		if (it.link) {
			var a = link(it.link, title);
			a.className = 'item-title';
			a.appendChild(icon('fa-external-link-alt'));
			row.appendChild(a);
		} else if (title) {
			row.appendChild(el('span', 'item-title', title));
		}
		if (it.text) row.appendChild(richText(it.text));
		return row;
	}

	function itemList(items) {
		var ul = el('ul', 'items');
		items.forEach(function (it) { ul.appendChild(itemRow(it)); });
		return ul;
	}

	function renderResources() {
		var box = $('res');
		var all = section('resource');
		box.textContent = '';
		var common = all.filter(function (it) { return CHALLENGES.indexOf(it.challenge) === -1; });
		if (common.length) {
			var c = el('div', 'res-common');
			c.appendChild(el('h3', null, 'For every challenge'));
			c.appendChild(itemList(common));
			box.appendChild(c);
		}
		var grid = el('div', 'res-grid');
		CHALLENGES.forEach(function (name) {
			var mine = all.filter(function (it) { return it.challenge === name; });
			var card = el('div', 'res-card');
			card.appendChild(el('h3', null, name));
			if (mine.length) card.appendChild(itemList(mine));
			else card.appendChild(el('p', 'empty', 'The starter kit and the links arrive here before coding starts.'));
			grid.appendChild(card);
		});
		box.appendChild(grid);
	}

	// the submission panel opens with the deadline, from the schedule
	function submissionLead(box) {
		var now = Date.now();
		var p = el('p', 'deadline');
		p.appendChild(icon('fa-hourglass-half'));
		var txt = el('span');
		var b = el('b', null, 'Stop coding: ' + fmt.long.format(STOP) + ', ' + hm(STOP));
		txt.appendChild(b);
		txt.appendChild(document.createTextNode(now < STOP ? ' · in ' + span(STOP - now) : ' · coding is over'));
		p.appendChild(txt);
		box.appendChild(p);
	}

	function renderList(id, name, empty, lead) {
		var box = $(id);
		var items = section(name);
		box.textContent = '';
		if (lead) lead(box);
		if (items.length) box.appendChild(itemList(items));
		else box.appendChild(el('p', 'empty', empty));
	}

	/* --- your team ---------------------------------------------------------- */

	function fact(dl, label, value) {
		dl.appendChild(el('dt', null, label));
		dl.appendChild(el('dd', null, value));
	}

	function renderTeam() {
		var panel = $('team-panel');
		var box = $('team');
		var me = state.me;
		box.textContent = '';
		panel.hidden = !me;
		if (!me) return;
		var t = me.team;
		var now = Date.now();
		if (!t) {
			box.appendChild(el('p', 'empty', now < START
				? 'We are putting the teams together: yours shows here before the event, with your table and your teammates.'
				: 'Not in a team yet? Ask at the desk.'));
		} else {
			box.appendChild(el('p', 'team-name', t.name));
			var dl = el('dl', 'team-facts');
			fact(dl, 'Challenge', t.challenge || 'To be confirmed');
			if (t.table) fact(dl, 'Table', t.table);
			if (t.pitch) fact(dl, 'Pitch', 'Sunday, ' + t.pitch + (t.room ? ' · ' + t.room : ''));
			box.appendChild(dl);
			box.appendChild(el('p', 'team-mates', t.mates.length ? 'With ' + and(t.mates) + '.' : 'Just you so far: your teammates show here when we add them.'));
			if (t.award && PLACE[t.award]) {
				var won = el('p', 'team-award');
				won.appendChild(icon('fa-trophy'));
				won.appendChild(document.createTextNode(PLACE[t.award] + (t.challenge ? ' · ' + t.challenge : '') + '. Congratulations!'));
				box.appendChild(won);
			}
		}
		if (me.checkedIn) {
			var here = el('p', 'team-in');
			here.appendChild(icon('fa-check'));
			here.appendChild(document.createTextNode('Checked in ' + when(Date.parse(me.checkedIn))));
			box.appendChild(here);
		}
	}

	/* --- the action panel: are you coming?, ask a mentor, your pitch, the feedback -------- */

	// drawn again only when what it shows changes, so a poll never wipes what is being typed
	function renderAct() {
		var now = Date.now();
		var me = state.me;
		var h = me && me.help;
		var key = JSON.stringify([
			phase(now), state.organiser, now < CONFIRM_END, state.confirmNo,
			me && me.coming, me && me.team && [me.team.challenge, me.team.table, me.team.pitch, me.team.room],
			h && [h.id, h.status, h.mentor, h.ahead], me && me.feedback && me.feedback.sent, me && me.certificate, me && !!me.checkedIn
		]);
		if (key === state.actKey) return;
		state.actKey = key;
		var box = $('act');
		var card = null;
		if (me || state.organiser) {
			var p = phase(now);
			if (p === 'before') card = comingCard();
			else if (p === 'during') card = h && (h.status === 'waiting' || h.status === 'taken') ? helpStatus(h) : helpForm(h);
			else if (p === 'judging') card = pitchCard();
			else card = feedbackCard();
		}
		box.textContent = '';
		box.hidden = !card;
		if (card) box.appendChild(card);
	}

	function actCard(cls, label, title, sub) {
		var card = el('div', 'act-card ' + cls);
		var text = el('div', 'act-text');
		if (label) text.appendChild(el('p', 'act-label', label));
		text.appendChild(el('h2', 'act-title', title));
		if (sub) text.appendChild(el('p', 'act-sub', sub));
		card.appendChild(text);
		return card;
	}

	// the organiser's view of a participant's card: everything shown, nothing to press
	function preview(card) {
		forEach(card.querySelectorAll('button, input, textarea, select'), function (c) { c.disabled = true; });
		card.appendChild(el('p', 'act-note', 'Preview: each participant answers here. You are signed in with the admin key; their answers show on the admin page.'));
		return card;
	}

	function actError(card, msg) {
		var p = card.querySelector('.act-err');
		if (!p) { p = el('p', 'err act-err'); p.setAttribute('role', 'alert'); card.appendChild(p); }
		p.textContent = msg;
	}

	// a button that sends one answer: busy while it goes, the reason under the card when it does not
	function sending(btn, card, label, body) {
		var was = btn.textContent;
		btn.disabled = true;
		btn.classList.add('is-busy');
		btn.textContent = label;
		ask(body, function (problem) {
			btn.disabled = false;
			btn.classList.remove('is-busy');
			btn.textContent = was;
			if (problem) actError(card, problem);
		});
	}

	function comingCard() {
		var me = state.me;
		var coming = me ? me.coming : '';
		var by = Date.now() < CONFIRM_END ? 'Please answer by ' + CONFIRM_BY : 'Please answer now';
		var card, buttons = el('div', 'act-buttons');
		if (coming === 'yes') {
			card = actCard('act-coming is-yes', 'Your answer', 'You are coming. See you on Saturday!', 'Doors open before the opening at ' + hm(START) + ' on ' + fmt.long.format(START) + '. Cannot come after all? Tell us, so your place goes to someone on the waiting list.');
			buttons.appendChild(button('small ghost', 'I cannot come after all', function () { state.confirmNo = true; renderActRow(); }));
		} else if (coming === 'no') {
			card = actCard('act-coming is-no', 'Your answer', 'You told us you cannot come', 'Thank you for letting us know: your place goes to someone on the waiting list. Changed your mind? Tell us straight away.');
			buttons.appendChild(button('small', 'I am coming after all', function () { sending(this, card, 'Saving…', { action: 'coming', coming: 'yes' }); }));
		} else {
			card = actCard('act-coming', by, 'Are you coming on ' + fmt.long.format(START) + '?', 'One click. A place nobody uses can still go to someone on the waiting list.');
			buttons.appendChild(button('primary', 'Yes, I am coming', function () { sending(this, card, 'Saving…', { action: 'coming', coming: 'yes' }); }));
			buttons.appendChild(button('', 'I cannot come', function () { state.confirmNo = true; renderActRow(); }));
		}
		// "I cannot come": once more, to be sure
		if (state.confirmNo && coming !== 'no') {
			buttons.textContent = '';
			card.querySelector('.act-sub').textContent = 'Sure? Your place goes to someone on the waiting list.';
			buttons.appendChild(button('primary', 'Yes, I cannot come', function () {
				var b = this;
				state.confirmNo = false;
				sending(b, card, 'Saving…', { action: 'coming', coming: 'no' });
			}));
			buttons.appendChild(button('ghost', 'Back', function () { state.confirmNo = false; renderActRow(); }));
		}
		card.appendChild(buttons);
		return state.organiser ? preview(card) : card;
	}

	function field(label, control, hint) {
		var f = el('label', 'field');
		f.appendChild(el('span', 'field-label', label));
		f.appendChild(control);
		if (hint) f.appendChild(el('span', 'field-hint', hint));
		return f;
	}

	// a text box that keeps what is typed in state.draft, should the panel be drawn again
	function drafted(tag, name, value, attrs) {
		var c = el(tag);
		if (tag === 'input') c.type = 'text';
		Object.keys(attrs || {}).forEach(function (k) { c.setAttribute(k, attrs[k]); });
		c.value = state.draft[name] !== undefined ? state.draft[name] : value || '';
		c.addEventListener('input', function () { state.draft[name] = c.value; });
		return c;
	}

	function helpForm(last) {
		var me = state.me;
		var t = me && me.team;
		var card = actCard('act-help', 'During the hackathon', 'Stuck? Ask a mentor', 'A mentor comes to your table. Your team has one request at a time, and any of you can see it here.');
		if (last) {
			var said = last.status === 'done'
				? '✓ ' + (last.mentor || 'A mentor') + ' marked your last request done' + (last.closed ? ' at ' + hm(Date.parse(last.closed)) : '') + '.'
				: 'Your last request was cancelled.';
			card.querySelector('.act-text').appendChild(el('p', 'act-done', said));
		}
		var form = el('form', 'act-form');
		form.noValidate = true;
		var where = drafted('input', 'where', t && t.table ? 'Table ' + t.table : '', { maxlength: '80', placeholder: 'Table 12', autocomplete: 'off' });
		var question = drafted('textarea', 'question', '', { maxlength: '300', rows: '2', placeholder: 'Our circuit gives the same result for every input…' });
		var challenge = null;
		form.appendChild(field('What are you stuck on?', question, 'A line or two, so the right mentor comes.'));
		var row = el('div', 'field-row');
		row.appendChild(field('Where are you?', where));
		if (!t || !t.challenge) {
			challenge = el('select');
			[''].concat(CHALLENGES).forEach(function (c) {
				var o = el('option', null, c || 'Which challenge?');
				o.value = c;
				challenge.appendChild(o);
			});
			challenge.value = state.draft.challenge || '';
			challenge.addEventListener('change', function () { state.draft.challenge = challenge.value; });
			row.appendChild(field('Challenge', challenge));
		}
		form.appendChild(row);
		var go = el('button', 'btn primary', 'Ask a mentor');
		go.type = 'submit';
		var buttons = el('div', 'act-buttons');
		buttons.appendChild(go);
		form.appendChild(buttons);
		form.addEventListener('submit', function (ev) {
			ev.preventDefault();
			if (!question.value.trim()) { actError(card, 'Say in a line or two what you are stuck on.'); question.focus(); return; }
			if (!where.value.trim()) { actError(card, 'Say where you are, so the mentor finds you.'); where.focus(); return; }
			state.draft.question = '';   // the next request starts empty
			sending(go, card, 'Asking…', {
				action: 'help',
				question: question.value.trim(),
				where: where.value.trim(),
				challenge: challenge ? challenge.value : t.challenge
			});
		});
		card.appendChild(form);
		return state.organiser ? preview(card) : card;
	}

	function helpStatus(h) {
		var asked = h.asked ? hm(Date.parse(h.asked)) : '';
		var card;
		if (h.status === 'taken') {
			card = actCard('act-help is-taken', 'Mentor request', (h.mentor || 'A mentor') + ' is on the way', 'Coming to ' + h.where + (h.taken ? ' · since ' + hm(Date.parse(h.taken)) : '') + '.');
		} else {
			card = actCard('act-help is-waiting', 'Mentor request · asked at ' + asked, 'Waiting for a mentor',
				h.ahead ? (h.ahead === 1 ? 'One team asked before you.' : h.ahead + ' teams asked before you.') + ' This page checks every 20 seconds.' : 'You are next. This page checks every 20 seconds.');
		}
		var q = el('blockquote', 'act-question', h.question);
		card.querySelector('.act-text').appendChild(q);
		var buttons = el('div', 'act-buttons');
		buttons.appendChild(button('small ghost', 'We sorted it: cancel', function () {
			sending(this, card, 'Cancelling…', { action: 'help-cancel', id: h.id });
		}));
		card.appendChild(buttons);
		return card;
	}

	function pitchCard() {
		var t = state.me && state.me.team;
		if (!t || !t.pitch) return null;
		return actCard('act-pitch', 'Judging · ' + hm(JUDGING) + ' – ' + hm(AWARDS), 'Your pitch: ' + t.pitch + (t.room ? ' · ' + t.room : ''), 'Be there five minutes before, with your demo open.');
	}

	function feedbackCard() {
		var me = state.me;
		var fb = me && me.feedback;
		var card = actCard('act-feedback', 'After the hackathon', fb ? 'Thank you for your feedback!' : 'How was it?',
			fb ? 'Your answers are in. Change them any time: we read every answer, without your name.'
				: 'Two minutes, and we read every answer. We keep them without your name.');
		if (me && (me.certificate || me.checkedIn)) {
			card.querySelector('.act-text').appendChild(el('p', 'act-done', me.certificate
				? '✓ Your certificate is in your inbox.'
				: 'Your certificate comes by email in the days after the hackathon.'));
		}
		var form = el('form', 'act-form');
		form.noValidate = true;
		var overall = state.draft.overall || (fb ? fb.overall : 0);
		var again = state.draft.again !== undefined ? state.draft.again : fb ? fb.again : '';
		var stars = el('div', 'stars');
		stars.setAttribute('role', 'group');
		stars.setAttribute('aria-label', 'Overall, from 1 to 5');
		[1, 2, 3, 4, 5].forEach(function (n) {
			var b = el('button', 'star', String(n));
			b.type = 'button';
			b.setAttribute('aria-pressed', String(n === overall));
			b.addEventListener('click', function () {
				overall = state.draft.overall = n;
				forEach(stars.children, function (c, i) { c.setAttribute('aria-pressed', String(i + 1 === n)); });
			});
			stars.appendChild(b);
		});
		var scale = el('div', 'stars-wrap');
		scale.appendChild(stars);
		scale.appendChild(el('span', 'field-hint', '1: not good · 5: loved it'));
		form.appendChild(field('Overall', scale));
		var best = drafted('textarea', 'best', fb ? fb.best : '', { maxlength: '2000', rows: '2' });
		var change = drafted('textarea', 'change', fb ? fb.change : '', { maxlength: '2000', rows: '2' });
		form.appendChild(field('What worked best?', best));
		form.appendChild(field('What should we change?', change));
		var seg = el('div', 'seg');
		seg.setAttribute('role', 'group');
		[['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']].forEach(function (o) {
			var b = el('button', null, o[1]);
			b.type = 'button';
			b.setAttribute('aria-pressed', String(again === o[0]));
			b.addEventListener('click', function () {
				again = state.draft.again = again === o[0] ? '' : o[0];
				forEach(seg.children, function (c) { c.setAttribute('aria-pressed', 'false'); });
				if (again) b.setAttribute('aria-pressed', 'true');
			});
			seg.appendChild(b);
		});
		form.appendChild(field('Would you come again?', seg));
		var go = el('button', 'btn primary', fb ? 'Update my answers' : 'Send');
		go.type = 'submit';
		var buttons = el('div', 'act-buttons');
		buttons.appendChild(go);
		form.appendChild(buttons);
		form.addEventListener('submit', function (ev) {
			ev.preventDefault();
			if (!overall) { actError(card, 'Pick how it was overall, from 1 to 5.'); stars.firstChild.focus(); return; }
			sending(go, card, 'Sending…', { action: 'feedback', overall: overall, best: best.value, change: change.value, again: again });
		});
		card.appendChild(form);
		return state.organiser ? preview(card) : card;
	}

	/* --- the checklist: what to set up and bring, ticked off on this device ------------ */

	function ticked() {
		try { return JSON.parse(window.localStorage.getItem(CHECK_STORE) || '{}') || {}; } catch (e) { return {}; }
	}

	function tick(id, on) {
		var t = ticked();
		if (on) t[id] = 1;
		else delete t[id];
		try { window.localStorage.setItem(CHECK_STORE, JSON.stringify(t)); } catch (e) {}
	}

	// for every challenge first, then each challenge's own; once their team has a challenge, only theirs
	function renderChecklist() {
		var box = $('check');
		var mine = state.me && state.me.team ? state.me.team.challenge : '';
		var list = section('checklist').filter(function (it) { return !it.challenge || !mine || it.challenge === mine; });
		var done = ticked();
		box.textContent = '';
		if (!list.length) {
			box.appendChild(el('p', 'empty', 'What to install, which accounts to make and what to pack: posted here before the event.'));
			checkCount();
			return;
		}
		[''].concat(CHALLENGES).forEach(function (c) {
			var group = list.filter(function (it) { return c ? it.challenge === c : CHALLENGES.indexOf(it.challenge) === -1; });
			if (!group.length) return;
			if (c) box.appendChild(el('h3', 'check-group', c));
			var ul = el('ul', 'checks');
			group.forEach(function (it) { ul.appendChild(checkRow(it, done)); });
			box.appendChild(ul);
		});
		checkCount();
	}

	function checkRow(it, done) {
		var li = el('li', 'check-item' + (done[it.id] ? ' is-done' : ''));
		var id = 'chk-' + it.id;
		var box = el('input');
		box.type = 'checkbox';
		box.id = id;
		box.checked = !!done[it.id];
		box.addEventListener('change', function () {
			tick(it.id, box.checked);
			li.classList.toggle('is-done', box.checked);
			checkCount();
		});
		li.appendChild(box);
		var body = el('div', 'check-body');
		var title = el('label', 'item-title', it.title || it.link.replace(/^https?:\/\//i, ''));
		title.htmlFor = id;
		body.appendChild(title);
		if (it.text) body.appendChild(richText(it.text));
		if (it.link) {
			var a = link(it.link, it.link.replace(/^https?:\/\//i, ''));
			a.className = 'check-link';
			a.appendChild(icon('fa-external-link-alt'));
			body.appendChild(a);
		}
		li.appendChild(body);
		return li;
	}

	function checkCount() {
		var boxes = $('check').querySelectorAll('input[type="checkbox"]');
		var n = 0;
		forEach(boxes, function (b) { if (b.checked) n++; });
		$('check-count').textContent = boxes.length ? n + ' of ' + boxes.length + ' done' : '';
	}

	/* --- notifications ------------------------------------------------------------ */

	var notifyBtn = $('notify');

	function notifyState() { return window.breaqNotify ? window.breaqNotify.state() : 'unsupported'; }

	function renderBell() {
		var s = notifyState();
		notifyBtn.hidden = s === 'unsupported';
		notifyBtn.disabled = s === 'blocked';
		notifyBtn.setAttribute('aria-pressed', String(s === 'on'));
		notifyBtn.querySelector('.notify-label').textContent = s === 'on' ? 'Notifications on' : s === 'blocked' ? 'Notifications blocked' : 'Notify me';
		notifyBtn.title = s === 'blocked'
			? 'This browser was told not to show notifications from this site: allow them in its site settings, then reload.'
			: 'New announcements, a mentor on the way and what starts in 5 minutes, while this page is open (also in a background tab).' + (s === 'on' ? ' Click to turn them off.' : '');
	}

	notifyBtn.addEventListener('click', function () {
		if (notifyState() === 'on') { window.breaqNotify.disable(); renderBell(); return; }
		window.breaqNotify.enable('teams', function (s) {
			renderBell();
			if (s === 'on') window.breaqNotify.show('Notifications are on', 'While this page is open, also in a background tab.', 'breaq-on');
		});
	});

	// only while the tab is hidden: on screen, the page shows it
	function notify(title, body, tag) {
		if (document.hidden && notifyState() === 'on') window.breaqNotify.show(title, body, tag);
	}

	function helpNotice(old, now) {
		if (now && now.status === 'taken' && !(old && old.id === now.id && old.status === 'taken'))
			notify((now.mentor || 'A mentor') + ' is on the way', 'To ' + now.where + ': ' + now.question, 'breaq-help');
	}

	// 5 minutes before what is not coding, and 15 minutes before coding stops
	function nudges(now) {
		if (notifyState() !== 'on') return;
		SCHEDULE.forEach(function (s) {
			if (s.title === 'Coding time' || state.nudged[s.from]) return;
			if (now >= s.from - 5 * 60000 && now < s.from) {
				state.nudged[s.from] = true;
				notify(s.title + ' at ' + hm(s.from), 'In 5 minutes.', 'breaq-schedule');
			}
		});
		if (!state.nudged.stop && now >= STOP - 15 * 60000 && now < STOP) {
			state.nudged.stop = true;
			notify('Coding stops in 15 minutes', 'At ' + hm(STOP) + '. Push your code and get your submission ready.', 'breaq-stop');
		}
	}

	/* --- now, next and the countdown -------------------------------------- */

	function current(now) {
		return SCHEDULE.filter(function (s) {
			var to = s.to || s.from + 30 * 60000;
			return now >= s.from && now < to;
		})[0] || null;
	}

	function upcoming(now) {
		return SCHEDULE.filter(function (s) { return s.from > now; })[0] || null;
	}

	function block(cls, label, title, sub) {
		var b = el('div', 'live-block ' + cls);
		b.appendChild(el('p', 'live-label', label));
		b.appendChild(el('p', 'live-title', title));
		if (sub) b.appendChild(el('p', 'live-sub', sub));
		return b;
	}

	function renderLive() {
		var box = $('live');
		var now = Date.now();
		box.textContent = '';
		box.className = 'live';

		if (now < START) {
			box.classList.add('is-before');
			box.appendChild(block('live-now', 'The hackathon starts in', span(START - now), fmt.long.format(START) + ', ' + hm(START) + ' · ' + SCHEDULE[0].title + ' at the CAMPUS Research Institute'));
			box.appendChild(block('live-next kind-code', 'Then', SCHEDULE[1].title, hm(SCHEDULE[1].from) + ' on Saturday'));
			box.appendChild(block('live-count', 'Coding stops', fmt.long.format(STOP) + ', ' + hm(STOP), 'Then judging and the awards'));
			return;
		}
		if (now >= END) {
			box.classList.add('is-after');
			box.appendChild(block('live-now', 'That was the BreaQ 2026 Hackathon', 'Thank you, teams!', 'See you at the BreaQ Conference on 14 November.'));
			return;
		}

		var cur = current(now);
		var next = upcoming(now);
		if (cur) {
			var b = block('live-now kind-' + cur.kind, 'Now', cur.title, hm(cur.from) + (cur.to ? ' – ' + hm(cur.to) : ''));
			if (cur.to) {
				var bar = el('div', 'live-bar');
				var fill = el('i');
				fill.style.width = Math.min(100, (now - cur.from) / (cur.to - cur.from) * 100).toFixed(1) + '%';
				bar.appendChild(fill);
				b.appendChild(bar);
			}
			box.appendChild(b);
		} else {
			box.appendChild(block('live-now', 'Now', 'A short break', next ? 'Back at ' + hm(next.from) : ''));
		}
		if (next) box.appendChild(block('live-next kind-' + next.kind, 'Next · in ' + span(next.from - now), next.title, hm(next.from)));
		if (now < STOP) box.appendChild(countdown('Coding stops in', STOP - now, 'Sunday, ' + hm(STOP)));
		else box.appendChild(block('live-count is-over', 'Coding', 'Stopped at ' + hm(STOP), 'Judging, then the awards'));
	}

	function countdown(label, ms, sub) {
		var b = el('div', 'live-block live-count');
		b.appendChild(el('p', 'live-label', label));
		var c = el('p', 'live-clock', ms > 86400000 ? span(ms) : clock(ms));
		c.setAttribute('data-clock', '');
		b.appendChild(c);
		b.appendChild(el('p', 'live-sub', sub));
		return b;
	}

	/* --- the schedule ------------------------------------------------------ */

	function renderSchedule() {
		var box = $('sched');
		var now = Date.now();
		var day = '';
		var ol = null;
		box.textContent = '';
		SCHEDULE.forEach(function (s) {
			var d = fmt.long.format(s.from);
			if (d !== day) {
				day = d;
				box.appendChild(el('h3', null, d));
				ol = el('ol', 'sched');
				box.appendChild(ol);
			}
			var to = s.to || s.from + 30 * 60000;
			var li = el('li', 'kind-' + s.kind + (now >= to ? ' is-past' : '') + (now >= s.from && now < to ? ' is-now' : ''));
			li.appendChild(el('span', 'sched-time', hm(s.from) + (s.to ? ' – ' + hm(s.to) : '')));
			li.appendChild(el('span', 'sched-title', s.title));
			ol.appendChild(li);
		});
	}

	/* --- time passing ----------------------------------------------------- */

	// the countdown every second; now, next, the schedule and what is asked of the participant every minute
	var lastMinute = -1;
	window.setInterval(function () {
		if ($('dash').hidden) return;
		var now = Date.now();
		var minute = Math.floor(now / 60000);
		if (minute !== lastMinute) {
			lastMinute = minute;
			renderLive();
			renderSchedule();
			renderList('sub', 'submission', SUB_EMPTY, submissionLead);
			renderActRow();
			nudges(now);
			return;
		}
		var c = document.querySelector('[data-clock]');
		if (c && now < STOP && STOP - now <= 86400000) c.textContent = clock(STOP - now);
	}, 1000);

	// new posts: every minute while the tab is shown (every 20 seconds while a mentor request is open), also while
	// it is hidden when notifications are on, and at once when it is shown again after a while
	var pollTimer = null;

	function schedulePoll() {
		window.clearTimeout(pollTimer);
		if (!state.code) return;
		var h = state.me && state.me.help;
		var open = h && (h.status === 'waiting' || h.status === 'taken');
		pollTimer = window.setTimeout(function () {
			if (state.code && (!document.hidden || notifyState() === 'on')) refresh(false);
			else schedulePoll();
		}, open ? HELP_POLL_MS : POLL_MS);
	}

	document.addEventListener('visibilitychange', function () {
		if (!state.code || document.hidden) return;
		if (!state.at || Date.now() - state.at > 30000) refresh(false);
		else markSeen();
	});

	/* --- opening ------------------------------------------------------------ */

	// the acceptance email's link carries the code after #code=: fill it in, then take it out of the address bar
	var fromLink = (location.hash.match(/[#&]code=([^&]+)/) || [])[1];
	if (fromLink) {
		try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
		unlock(decodeURIComponent(fromLink), true);
	} else if (storedCode()) {
		unlock(storedCode(), !!rememberedCode());
	} else if (adminKey()) {
		unlock(adminKey(), false, true);
	} else {
		codeInput.focus();
	}

})();
