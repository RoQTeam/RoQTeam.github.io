/*
	BreaQ Hackathon: the mentor queue (mentors.html, roqteam.ro/mentors)
	- for the mentors: asks for their name (the team sees who is coming) and the mentor key (in the organisers'
	  link, #key=…, or the admin key), and posts { action: "mentor-queue", key } to the Apps Script in data-endpoint
	  (tools/register-backend.gs)
	- the requests from "Ask a mentor" on the team dashboard: waiting (oldest first), on the way, done in the last
	  three hours; "On my way" takes one ("mentor-take"), then "Done" ("mentor-done") or "Put back"
	  ("mentor-release"); filtered by challenge, remembered on the device
	- asks again every 20 seconds while the tab is shown (also when hidden, with notifications on: one for each new
	  request in the challenge shown)
*/

(function () {

	'use strict';

	var root = document.getElementById('mentors');
	if (!root) return;

	var endpoint = (root.getAttribute('data-endpoint') || '').trim();
	var KEY_STORE = 'breaq-2026-mentor-key';
	var NAME_STORE = 'breaq-2026-mentor-name';
	var FILTER_STORE = 'breaq-2026-mentor-filter';
	var POLL_MS = 20000;
	var TZ = 'Europe/Bucharest';

	function $(id) { return document.getElementById(id); }
	function forEach(list, fn) { Array.prototype.forEach.call(list, fn); }

	var state = {
		key: '',
		name: '',
		items: [],
		challenges: ['Quantum Foundations', 'Quantum AI', 'Quantum Hacking'],
		filter: 'all',
		at: null,
		failing: false,
		known: null,   // ids of the requests seen waiting, for the notifications (null before the first answer)
		busy: {}       // ids being moved
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

	var fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

	function hm(t) { return fmtTime.format(t); }

	// "just now", "6 min", "1 h 05 min"
	function ago(t) {
		var m = Math.max(0, Math.floor((Date.now() - t) / 60000));
		if (m < 1) return 'just now';
		if (m < 60) return m + ' min ago';
		return Math.floor(m / 60) + ' h ' + (m % 60 < 10 ? '0' : '') + (m % 60) + ' min ago';
	}

	function store(k, v, local) {
		try {
			window.sessionStorage.setItem(k, v);
			if (local) window.localStorage.setItem(k, v);
			else window.localStorage.removeItem(k);
		} catch (e) {}
	}

	function stored(k) {
		try { return window.sessionStorage.getItem(k) || window.localStorage.getItem(k) || ''; } catch (e) { return ''; }
	}

	function forget(k) {
		try { window.sessionStorage.removeItem(k); window.localStorage.removeItem(k); } catch (e) {}
	}

	/* --- the request ---------------------------------------------------- */

	// patient: the first opening tries up to three times within 40 s (Apps Script can take a while to wake up); the
	// updates and the moves try once
	function post(body, patient, done) {
		var started = Date.now();
		var tries = 0;
		function again(json, err) {
			if (patient && tries < 3 && Date.now() - started < 40000) window.setTimeout(attempt, tries * 1500);
			else done(json, err);
		}
		function attempt() {
			tries++;
			var ctrl = window.AbortController ? new AbortController() : null;
			var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, 30000) : null;
			window.fetch(endpoint, {
				method: 'POST',
				body: JSON.stringify(body),   // a string body: no CORS preflight against Apps Script
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

	function problem(json, err) {
		if (json && json.error) return json.error;
		if (json) return 'The mentor queue is not open yet. Ask the organisers.';
		if (err && err.name === 'AbortError') return 'The queue took too long to answer. Try again.';
		return 'Could not reach the queue. Check the connection and try again.';
	}

	/* --- lock ------------------------------------------------------------ */

	var lockForm = $('lock-form');
	var lockBtn = $('lock-btn');

	function lockError(msg) {
		$('lock-err').textContent = msg || '';
		$('lock-err').hidden = !msg;
	}

	function unlock(key, name, remember) {
		lockError('');
		lockBtn.disabled = true;
		lockBtn.textContent = 'Opening…';
		post({ action: 'mentor-queue', key: key }, true, function (json, err) {
			lockBtn.disabled = false;
			lockBtn.textContent = 'Open the queue';
			if (json && json.ok && json.items) {
				state.key = key;
				state.name = name;
				store(KEY_STORE, key, remember);
				store(NAME_STORE, name, true);
				$('key').value = '';
				show(json);
				return;
			}
			if (json && json.denied) forget(KEY_STORE);
			lockError(problem(json, err));
		});
	}

	function lock(msg) {
		forget(KEY_STORE);
		state.key = '';
		state.items = [];
		state.known = null;
		window.clearTimeout(pollTimer);
		forEach(['waiting', 'onway', 'done'], function (id) { $(id).textContent = ''; });
		$('dash').hidden = true;
		$('lock').hidden = false;
		$('name').value = state.name || stored(NAME_STORE);
		lockError(msg || '');
		$('key').focus();
	}

	lockForm.addEventListener('submit', function (ev) {
		ev.preventDefault();
		var name = $('name').value.trim();
		var key = $('key').value.trim() || stored(KEY_STORE);
		if (!name) { lockError('Type your name first: the team sees who is coming.'); $('name').focus(); return; }
		if (!key) { lockError('Paste the mentor key: it is in the link the organisers sent you.'); $('key').focus(); return; }
		unlock(key, name, $('remember').checked);
	});

	$('lock-now').addEventListener('click', function () { lock(''); });

	/* --- your name ---------------------------------------------------------- */

	function renderWho() { $('who').textContent = 'You are ' + state.name + '.'; }

	$('rename').addEventListener('click', function () {
		$('rename-input').value = state.name;
		$('rename-form').hidden = false;
		$('rename').hidden = true;
		$('rename-input').focus();
	});

	function closeRename() {
		$('rename-form').hidden = true;
		$('rename').hidden = false;
	}

	$('rename-cancel').addEventListener('click', closeRename);

	$('rename-form').addEventListener('submit', function (ev) {
		ev.preventDefault();
		var name = $('rename-input').value.trim();
		if (!name) { $('rename-input').focus(); return; }
		state.name = name;
		store(NAME_STORE, name, true);
		renderWho();
		closeRename();
		render();
	});

	/* --- the queue ---------------------------------------------------------- */

	function dashError(msg) {
		$('dash-err').textContent = msg || '';
		$('dash-err').hidden = !msg;
	}

	function refresh(byHand) {
		if (!state.key) return;
		if (byHand) { $('refresh').disabled = true; $('refresh').textContent = 'Updating…'; }
		post({ action: 'mentor-queue', key: state.key }, !!byHand, function (json, err) {
			if (byHand) { $('refresh').disabled = false; $('refresh').textContent = 'Refresh'; }
			if (json && json.ok && json.items) { state.failing = false; dashError(''); show(json); return; }
			if (json && json.denied) { lock('That key no longer opens the queue: the organisers changed it. Ask them for the new link.'); return; }
			state.failing = true;
			renderMeta();
			if (byHand) dashError(problem(json, err));
			schedulePoll();
		});
	}

	$('refresh').addEventListener('click', function () { refresh(true); });

	function take(json) {
		state.items = json.items.map(function (it) {
			return {
				id: String(it.id),
				asked: it.asked ? Date.parse(it.asked) || 0 : 0,
				name: it.name || '',
				team: it.team || '',
				challenge: it.challenge || '',
				where: it.where || '',
				question: it.question || '',
				status: it.status || 'waiting',
				mentor: it.mentor || '',
				taken: it.taken ? Date.parse(it.taken) || 0 : 0,
				closed: it.closed ? Date.parse(it.closed) || 0 : 0
			};
		});
		if (json.challenges && json.challenges.length) state.challenges = json.challenges;
		state.at = Date.now();
	}

	function show(json) {
		var first = state.known === null;
		take(json);
		$('lock').hidden = true;
		$('dash').hidden = false;
		renderWho();
		renderMeta();
		render();
		announce(first);
		if (first && window.breaqNotify) window.breaqNotify.start('mentors');
		renderBell();
		schedulePoll();
	}

	function renderMeta() {
		$('meta').textContent = state.at ? (state.failing ? 'Could not update · last ' : 'Updated ') + hm(state.at) : '';
	}

	function shown(it) { return state.filter === 'all' || !it.challenge || it.challenge === state.filter; }

	function mine(it) { return it.mentor && it.mentor.toLowerCase() === state.name.toLowerCase(); }

	function render() {
		var list = state.items.filter(shown);
		var waiting = list.filter(function (it) { return it.status === 'waiting'; });
		var onway = list.filter(function (it) { return it.status === 'taken'; })
			.sort(function (a, b) { return (mine(b) ? 1 : 0) - (mine(a) ? 1 : 0); });   // yours first
		var done = list.filter(function (it) { return it.status === 'done' || it.status === 'cancelled'; })
			.sort(function (a, b) { return b.closed - a.closed; });
		fill('waiting', waiting, 'Nobody is waiting' + (state.filter === 'all' ? '.' : ' in ' + state.filter + '.') + ' New requests show here; this page checks every 20 seconds.');
		fill('onway', onway, 'Nobody is on the way right now.');
		$('wait-count').textContent = waiting.length ? String(waiting.length) : '';
		$('way-count').textContent = onway.length ? String(onway.length) : '';
		$('done-count').textContent = done.length ? String(done.length) : '';
		var box = $('done');
		box.textContent = '';
		if (!done.length) { box.appendChild(el('p', 'empty', 'Nothing yet.')); }
		else {
			var ul = el('ul', 'mq-done');
			done.forEach(function (it) {
				var li = el('li');
				li.appendChild(el('span', 'mq-done-time', hm(it.closed)));
				li.appendChild(el('span', null, (it.team || it.name) + ' · ' + (it.status === 'cancelled' ? 'cancelled by the team' : 'done' + (it.mentor ? ' by ' + it.mentor : ''))));
				ul.appendChild(li);
			});
			box.appendChild(ul);
		}
		renderFilter();
		document.title = (waiting.length ? '(' + waiting.length + ') ' : '') + baseTitle;
	}

	var baseTitle = document.title;

	function fill(id, list, empty) {
		var box = $(id);
		box.textContent = '';
		if (!list.length) { box.appendChild(el('p', 'empty', empty)); return; }
		list.forEach(function (it, i) { box.appendChild(card(it, i)); });
	}

	function card(it, i) {
		var c = el('article', 'mq-card is-' + it.status + (mine(it) ? ' is-mine' : '') + (state.busy[it.id] ? ' is-busy' : ''));
		var head = el('div', 'mq-head');
		var who = el('p', 'mq-who');
		if (it.status === 'waiting') who.appendChild(el('span', 'mq-n', String(i + 1)));
		who.appendChild(document.createTextNode(it.team || it.name));
		head.appendChild(who);
		if (it.challenge) head.appendChild(el('span', 'tag', it.challenge));
		c.appendChild(head);
		var where = el('p', 'mq-where');
		where.appendChild(icon('fa-map-marker-alt'));
		where.appendChild(document.createTextNode(it.where + (it.team ? ' · asked by ' + it.name : '')));
		c.appendChild(where);
		c.appendChild(el('blockquote', 'mq-question', it.question));
		var meta = it.status === 'taken'
			? (mine(it) ? 'You are on the way' : it.mentor + ' is on the way') + ' · since ' + hm(it.taken) + ' · asked ' + hm(it.asked)
			: 'Asked ' + hm(it.asked) + ' · ' + ago(it.asked);
		c.appendChild(el('p', 'mq-meta', meta));
		var actions = el('div', 'mq-actions');
		if (it.status === 'waiting') {
			actions.appendChild(move(it, 'mentor-take', 'On my way', 'primary'));
		} else if (it.status === 'taken') {
			actions.appendChild(move(it, 'mentor-done', 'Done', mine(it) ? 'primary' : ''));
			actions.appendChild(move(it, 'mentor-release', 'Put back', 'ghost'));
		}
		c.appendChild(actions);
		return c;
	}

	function move(it, action, label, cls) {
		var b = el('button', 'btn small ' + cls, label);
		b.type = 'button';
		b.disabled = !!state.busy[it.id];
		b.addEventListener('click', function () {
			state.busy[it.id] = true;
			render();
			post({ action: action, key: state.key, id: it.id, mentor: state.name }, false, function (json, err) {
				delete state.busy[it.id];
				if (json && json.denied) { lock('That key no longer opens the queue: the organisers changed it. Ask them for the new link.'); return; }
				if (json && json.items) { take(json); renderMeta(); }
				render();
				dashError(json && json.ok ? '' : problem(json, err));
			});
		});
		return b;
	}

	/* --- the challenge filter ------------------------------------------------- */

	function renderFilter() {
		var box = $('filter');
		box.textContent = '';
		['all'].concat(state.challenges).forEach(function (c) {
			var n = state.items.filter(function (it) { return it.status === 'waiting' && (c === 'all' || !it.challenge || it.challenge === c); }).length;
			var b = el('button', null, c === 'all' ? 'All challenges' : c);
			b.type = 'button';
			b.setAttribute('aria-pressed', String(state.filter === c));
			if (n) b.appendChild(el('span', 'n', ' ' + n));
			b.addEventListener('click', function () {
				state.filter = c;
				try { window.localStorage.setItem(FILTER_STORE, c); } catch (e) {}
				render();
			});
			box.appendChild(b);
		});
	}

	/* --- notifications -------------------------------------------------------- */

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
			: 'A notification for each new request in the challenge shown, while this page is open (also in a background tab).' + (s === 'on' ? ' Click to turn them off.' : '');
	}

	notifyBtn.addEventListener('click', function () {
		if (notifyState() === 'on') { window.breaqNotify.disable(); renderBell(); return; }
		window.breaqNotify.enable('mentors', function (s) {
			renderBell();
			if (s === 'on') window.breaqNotify.show('Notifications are on', 'One for each new request, while this page is open.', 'breaq-on');
		});
	});

	// a notification for each request that came in since the last look, in the challenge shown, when the tab is hidden
	function announce(first) {
		var known = state.known || {};
		var fresh = state.items.filter(function (it) { return it.status === 'waiting' && !known[it.id] && shown(it); });
		state.known = {};
		state.items.forEach(function (it) { state.known[it.id] = true; });
		if (first || !fresh.length || !document.hidden || notifyState() !== 'on') return;
		if (fresh.length === 1) window.breaqNotify.show((fresh[0].team || fresh[0].name) + ' asks for help', fresh[0].where + ': ' + fresh[0].question, 'breaq-queue');
		else window.breaqNotify.show(fresh.length + ' new requests', fresh.map(function (it) { return it.team || it.name; }).join(', '), 'breaq-queue');
	}

	/* --- time passing ----------------------------------------------------------- */

	var pollTimer = null;

	function schedulePoll() {
		window.clearTimeout(pollTimer);
		if (!state.key) return;
		pollTimer = window.setTimeout(function () {
			if (state.key && (!document.hidden || notifyState() === 'on')) refresh(false);
			else schedulePoll();
		}, POLL_MS);
	}

	document.addEventListener('visibilitychange', function () {
		if (state.key && !document.hidden && (!state.at || Date.now() - state.at > 15000)) refresh(false);
	});

	// "6 min ago" moves on between updates
	window.setInterval(function () {
		if (state.key && !$('dash').hidden && !document.querySelector('.mq-card.is-busy')) render();
	}, 60000);

	/* --- opening ------------------------------------------------------------- */

	if (!endpoint) {
		lockError('No Apps Script URL in data-endpoint on mentors.html.');
		lockBtn.disabled = true;
		return;
	}

	try { state.filter = window.localStorage.getItem(FILTER_STORE) || 'all'; } catch (e) {}
	$('name').value = stored(NAME_STORE);

	// the organisers' link carries the key after #key=: fill it in, then take it out of the address bar
	var fromLink = (location.hash.match(/[#&]key=([^&]+)/) || [])[1];
	if (fromLink) {
		try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
		$('key').value = decodeURIComponent(fromLink);
	}
	var key = $('key').value || stored(KEY_STORE);
	if (key && stored(NAME_STORE)) unlock(key, stored(NAME_STORE), true);
	else if (!$('name').value) $('name').focus();
	else $('key').focus();

})();
