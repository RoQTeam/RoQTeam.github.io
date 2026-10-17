/*
	BreaQ Hackathon: the big screen (screen.html, roqteam.ro/screen)
	- opens with the admin key (the one the admin page remembers on this laptop, or typed once), and reads the team
	  dashboard's "board" action (tools/register-backend.gs) every half minute: the announcements, the mentor queue in
	  numbers, the audience award's vote
	- shows what the moment calls for: before, the countdown to the opening; during, now and next with the countdown
	  to the end of coding; then the judging, the awards with the audience vote (its count while it is open, the
	  podium once the organisers show the result), and the thank-you
	- every PARTNERS_EVERY, for PARTNERS_MS, the partners take the screen, tier by tier (P plays it now); not in the
	  last minutes before coding stops, nor while the audience vote is up
	- the organisers' live message (the admin page's "Show it on the screen"), asked for every FLASH_MS ("flash"):
	  over everything until it runs out or is taken down; an announcement posted while the screen is up comes the same
	  way for NEWS_MS, and stays "New" on the side for NEW_FOR. Each comes in with a gold band across the screen and a
	  chime (once someone has touched the screen: browsers keep a page quiet until then)
	- the schedule is assets/js/schedule.js, as on the dashboard; every time in Bucharest time
*/

(function () {

	'use strict';

	var root = document.getElementById('screen');
	if (!root) return;

	var endpoint = (root.getAttribute('data-endpoint') || '').trim();
	var KEY_STORE = 'breaq-2026-screen-key';  // the screen's password, kept on this screen
	var ADMIN_STORE = 'breaq-2026-admin-key'; // an organiser's laptop: the admin page's key opens it too
	var POLL_MS = 30000;
	var TZ = 'Europe/Bucharest';

	var SCHEDULE = window.BREAQ_SCHEDULE;
	var START = SCHEDULE[0].from;
	var END = SCHEDULE[SCHEDULE.length - 1].to;
	var STOP = SCHEDULE.filter(function (s) { return s.kind === 'stop'; })[0].from;
	var JUDGING = SCHEDULE.filter(function (s) { return s.title === 'Judging'; })[0].from;
	var AWARDS = SCHEDULE.filter(function (s) { return s.kind === 'award'; })[0].from;

	var PARTNERS_EVERY = 4 * 60000;
	var PARTNERS_MS = 22000;
	var FLASH_MS = 6000;
	var NEWS_MS = 25000;
	var NEW_FOR = 10 * 60000;
	var ANN_EVERY = 9000;   // the announcements on the side take turns, one at a time
	var ANN_MAX = 6;        // the newest few

	var state = { key: '', items: [], audience: null, queue: null, at: 0, failing: false, drawn: '', partnersAt: 0, partnersOn: false,
		flash: null, news: null, shown: '', seen: null, fresh: {}, annIndex: 0, annNext: 0 };

	function $(id) { return document.getElementById(id); }

	function el(tag, cls, text) {
		var node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text !== undefined && text !== null) node.textContent = text;
		return node;
	}

	var fmt = {
		time: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
		long: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
	};

	function hm(t) { return fmt.time.format(t); }
	function pad(n) { return n < 10 ? '0' + n : String(n); }

	function clock(ms) {
		var s = Math.max(0, Math.floor(ms / 1000));
		return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
	}

	// "2 d 4 h", "4 h 12 min", "12 min"
	function span(ms) {
		var m = Math.max(0, Math.floor(ms / 60000));
		var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
		if (d) return d + ' d ' + h + ' h';
		if (h) return h + ' h ' + pad(min) + ' min';
		return min + ' min';
	}

	// a countdown: hours, minutes and seconds within a day, else days and hours, the units small
	function countdown(ms) {
		var p = el('p', 'big-clock');
		if (ms <= 86400000) { p.textContent = clock(ms); p.setAttribute('data-to', ''); return p; }
		span(ms).split(' ').forEach(function (w, i) {
			if (i) p.appendChild(document.createTextNode(' '));
			p.appendChild(/^\d+$/.test(w) ? el('b', null, w) : el('small', null, w));
		});
		return p;
	}

	function current(now) {
		return SCHEDULE.filter(function (s) { return now >= s.from && now < (s.to || s.from + 30 * 60000); })[0] || null;
	}

	function upcoming(now, n) {
		return SCHEDULE.filter(function (s) { return s.from > now; }).slice(0, n);
	}

	/* --- the stage: what the moment calls for ------------------------------------------ */

	function kicker(text) { return el('p', 'kicker', text); }

	function renderStage(now) {
		var box = $('stage');
		var a = state.audience;
		box.textContent = '';
		box.className = 'stage';
		var target = null;   // what the big clock counts to

		// the vote, from when the organisers open it until they put it back
		if (a && (a.state === 'open' || a.state === 'shown')) {
			box.classList.add('is-award');
			box.appendChild(kicker('Audience award'));
			if (a.state === 'open') {
				box.appendChild(el('h1', 'stage-title', 'Vote for the team that impressed you most.'));
				box.appendChild(el('p', 'stage-sub', 'On your team dashboard, roqteam.ro/teams: one vote each, not for your own team.'));
				var n = el('p', 'big-clock');
				n.appendChild(el('b', null, String(a.total || 0)));
				n.appendChild(el('small', null, a.total === 1 ? ' vote' : ' votes'));
				box.appendChild(n);
			} else {
				box.appendChild(el('h1', 'stage-title', 'The audience has voted.'));
				var podium = el('ol', 'podium');
				(a.teams || []).filter(function (t) { return t.votes; }).slice(0, 3).forEach(function (t, i) {
					var li = el('li', 'podium-' + (i + 1));
					li.appendChild(el('span', 'podium-place', String(i + 1)));
					var name = el('span', 'podium-name', t.name);
					li.appendChild(name);
					li.appendChild(el('span', 'podium-votes', t.votes + (t.votes === 1 ? ' vote' : ' votes')));
					podium.appendChild(li);
				});
				if (!podium.children.length) podium.appendChild(el('li', 'empty', 'No votes yet.'));
				box.appendChild(podium);
			}
			return;
		}

		if (now < START) {
			box.classList.add('is-before');
			box.appendChild(kicker('The hackathon starts in'));
			box.appendChild(countdown(START - now));
			box.appendChild(el('p', 'stage-sub', fmt.long.format(START) + ', ' + hm(START) + ' · ' + SCHEDULE[0].title));
			return;
		}
		if (now >= END) {
			box.classList.add('is-after');
			box.appendChild(kicker('That was the BreaQ 2026 Hackathon'));
			box.appendChild(el('h1', 'stage-title', 'Thank you, teams.'));
			box.appendChild(el('p', 'stage-sub', 'See you at the BreaQ Conference on 14 November, at the Military Technical Academy.'));
			return;
		}

		var cur = current(now);
		var next = upcoming(now, 1)[0];
		box.appendChild(kicker(cur ? 'Now · ' + hm(cur.from) + (cur.to ? ' – ' + hm(cur.to) : '') : 'Now'));
		box.appendChild(el('h1', 'stage-title', cur ? cur.title : 'A short break'));
		if (cur && cur.to) {
			var bar = el('div', 'stage-bar');
			var fill = el('i');
			fill.style.width = Math.min(100, (now - cur.from) / (cur.to - cur.from) * 100).toFixed(1) + '%';
			bar.appendChild(fill);
			box.appendChild(bar);
		}
		if (next) box.appendChild(el('p', 'stage-next', 'Next, in ' + span(next.from - now) + ': ' + next.title + ' at ' + hm(next.from)));

		if (now < STOP) target = { label: 'Coding stops in', at: STOP };
		else if (now < AWARDS) target = { label: 'The awards start in', at: AWARDS };
		if (target) {
			var c = el('div', 'stage-count');
			c.appendChild(kicker(target.label));
			c.appendChild(countdown(target.at - now));
			box.appendChild(c);
		}
	}

	/* --- the side: announcements, mentors, what comes up ----------------------------- */

	function announcements() {
		return state.items.filter(function (it) { return it.section === 'announcement'; }).sort(function (a, b) {
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			return (b.posted || 0) - (a.posted || 0);
		});
	}

	function isNew(it, now) { return now - (state.fresh[it.id] || 0) < NEW_FOR; }

	// the announcements on the side, in turn: the ones posted while the screen is up first, then the pinned, then the
	// newest; the card keeps its height (the space the mentors and what comes up leave), whichever is showing
	function rotation(now) {
		var all = announcements();
		return all.filter(function (it) { return isNew(it, now); })
			.concat(all.filter(function (it) { return !isNew(it, now); }))
			.slice(0, ANN_MAX);
	}

	// turning: the next one comes in, and the card glows if it is a new one
	function annCard(now, list, turning) {
		state.annIndex %= list.length;
		var it = list[state.annIndex];
		var fresh = isNew(it, now);
		var card = el('section', 'side-card side-ann' + (turning && fresh ? ' has-new' : ''));
		var head = el('div', 'ann-head');
		head.appendChild(kicker('Announcements'));
		if (list.length > 1) {
			var dots = el('span', 'ann-dots');
			list.forEach(function (x, i) { dots.appendChild(el('i', i === state.annIndex ? 'is-on' : null)); });
			head.appendChild(dots);
		}
		card.appendChild(head);
		var art = el('article', 'wall-ann' + (it.pinned ? ' is-pinned' : '') + (fresh ? ' is-new' : '') + (turning ? ' is-in' : ''));
		var meta = el('p', 'wall-ann-time');
		if (fresh) meta.appendChild(el('span', 'chip', 'New'));
		if (it.posted) meta.appendChild(el('span', null, hm(it.posted)));
		if (meta.childNodes.length) art.appendChild(meta);
		if (it.title) art.appendChild(el('h2', null, it.title));
		if (it.text) art.appendChild(el('p', 'wall-ann-text', it.text.replace(/\s*\n+\s*/g, ' ')));
		card.appendChild(art);
		return card;
	}

	function turnAnnouncements(now) {
		state.annNext = now + ANN_EVERY;
		var old = document.querySelector('.side-ann');
		var list = rotation(now);
		if (!old || list.length < 2) return;
		state.annIndex = (state.annIndex + 1) % list.length;
		old.parentNode.replaceChild(annCard(now, list, true), old);
	}

	function renderSide(now) {
		var box = $('side');
		box.textContent = '';
		var q = state.queue;
		if (q && now >= START && now < STOP) {
			var m = el('section', 'side-card side-mentors');
			m.appendChild(kicker('Mentors'));
			var row = el('div', 'mentor-row');
			var w = el('p', 'mentor-n');
			w.appendChild(el('b', null, String(q.waiting)));
			w.appendChild(el('span', null, q.waiting === 1 ? 'team waiting' : 'teams waiting'));
			row.appendChild(w);
			var t = el('p', 'mentor-n');
			t.appendChild(el('b', null, String(q.taken)));
			t.appendChild(el('span', null, q.taken === 1 ? 'mentor on the way' : 'mentors on the way'));
			row.appendChild(t);
			m.appendChild(row);
			m.appendChild(el('p', 'side-note', 'Stuck? “Ask a mentor” on your dashboard.'));
			box.appendChild(m);
		}
		var list = rotation(now);
		if (list.length) box.appendChild(annCard(now, list, false));
		// always, until the awards: two beside the mentors, else three
		var up = upcoming(now, 4).filter(function (s) { return s.title !== 'Coding time'; }).slice(0, box.querySelector('.side-mentors') ? 2 : 3);
		if (up.length && now < AWARDS) {
			var u = el('section', 'side-card side-up');
			u.appendChild(kicker('Coming up'));
			var ol = el('ol', 'sched');
			up.forEach(function (s) {
				var li = el('li', 'kind-' + s.kind);
				li.appendChild(el('span', 'sched-time', hm(s.from)));
				li.appendChild(el('span', 'sched-title', s.title));
				ol.appendChild(li);
			});
			u.appendChild(ol);
			box.appendChild(u);
		}
	}

	function render() {
		var now = Date.now();
		renderStage(now);
		renderSide(now);
		renderStatus();
	}

	function renderStatus() {
		var s = state.at ? (state.failing ? 'Could not update · last ' : 'Updated ') + hm(state.at) : '';
		if (canSound() && !soundOn()) s += (s ? ' · ' : '') + 'Touch the screen once for the chime';
		$('status').textContent = s;
	}

	/* --- the data ---------------------------------------------------------------------- */

	function post(body, ms, done) {
		var ctrl = window.AbortController ? new AbortController() : null;
		var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, ms) : null;
		window.fetch(endpoint, {
			method: 'POST',
			body: JSON.stringify(body),   // a string body: no CORS preflight against Apps Script
			cache: 'no-store',
			signal: ctrl ? ctrl.signal : undefined
		}).then(function (res) { return res.text(); }).then(function (text) {
			if (timer) window.clearTimeout(timer);
			var json = null;
			try { json = JSON.parse(text); } catch (e) {}
			done(json);
		}).catch(function () {
			if (timer) window.clearTimeout(timer);
			done(null);
		});
	}

	function load(key, done) {
		post({ action: 'board', code: key }, 45000, done);
	}

	function take(json) {
		state.items = (json.items || []).map(function (it) {
			return { id: String(it.id || ''), section: it.section, title: it.title || '', text: it.text || '', pinned: !!it.pinned, posted: it.posted ? Date.parse(it.posted) || 0 : 0 };
		});
		state.audience = json.audience || null;
		state.queue = json.queue || null;
		if (json.flash !== undefined) state.flash = json.flash || null;
		spot();
		paint();
		state.at = Date.now();
		state.failing = false;
	}

	var pollTimer = null;

	function poll() {
		window.clearTimeout(pollTimer);
		pollTimer = window.setTimeout(function () {
			load(state.key, function (json) {
				// the password changed on the admin page: back to asking for it
				if (json && json.denied) {
					try { window.localStorage.removeItem(KEY_STORE); window.sessionStorage.removeItem(KEY_STORE); } catch (e) {}
					$('wall').hidden = true;
					$('lock').hidden = false;
					$('lock-err').textContent = 'The password changed: type the new one.';
					$('lock-err').hidden = false;
					return;
				}
				if (json && json.ok && json.items) take(json);
				else state.failing = true;
				render();
				poll();
			});
		}, POLL_MS);
	}

	/* --- the key --------------------------------------------------------------------- */

	function storedKey() {
		try {
			return window.localStorage.getItem(KEY_STORE) || window.sessionStorage.getItem(KEY_STORE) ||
				window.localStorage.getItem(ADMIN_STORE) || window.sessionStorage.getItem(ADMIN_STORE) || '';
		} catch (e) { return ''; }
	}

	function open(key, remember) {
		$('lock-btn').disabled = true;
		$('lock-btn').textContent = 'Opening…';
		$('lock-err').hidden = true;
		load(key, function (json) {
			$('lock-btn').disabled = false;
			$('lock-btn').textContent = 'Open';
			if (json && json.ok && json.items) {
				state.key = key;
				try {
					window.sessionStorage.setItem(KEY_STORE, key);
					if (remember) window.localStorage.setItem(KEY_STORE, key);
				} catch (e) {}
				take(json);
				$('lock').hidden = true;
				$('wall').hidden = false;
				render();
				poll();
				pollFlash();
				return;
			}
			if (json && json.denied) { try { window.localStorage.removeItem(KEY_STORE); } catch (e) {} }
			$('lock').hidden = false;
			$('wall').hidden = true;
			$('lock-err').textContent = json && json.denied ? 'That password does not open it. It is set on the admin page: Team dashboard, then Big screen.' : 'Could not reach the Apps Script. Check the connection and try again.';
			$('lock-err').hidden = false;
		});
	}

	$('lock-form').addEventListener('submit', function (ev) {
		ev.preventDefault();
		var key = $('key').value.trim();
		if (key) open(key, $('remember').checked);
	});

	/* --- the partners ---------------------------------------------------------------------- */

	// the moments that keep the screen: the last minutes before coding stops, the audience vote and its podium
	function busyMoment(now) {
		var a = state.audience;
		return (now >= STOP - 10 * 60000 && now < STOP) || (a && (a.state === 'open' || a.state === 'shown'));
	}

	function playPartners() {
		var p = $('partners');
		if (state.partnersOn || state.shown) return;   // a live message keeps the screen
		state.partnersOn = true;
		p.style.setProperty('--p-ms', PARTNERS_MS + 'ms');
		p.classList.remove('is-on', 'is-out');
		p.hidden = false;
		void p.offsetWidth;   // so the animations start from the top
		p.classList.add('is-on');
		window.setTimeout(function () {
			p.classList.add('is-out');
			window.setTimeout(function () {
				p.hidden = true;
				p.classList.remove('is-on', 'is-out');
				state.partnersOn = false;
			}, 800);
		}, PARTNERS_MS);
	}

	// a live message cuts the partners short
	function stopPartners() {
		var p = $('partners');
		if (!state.partnersOn) return;
		p.hidden = true;
		p.classList.remove('is-on', 'is-out');
		state.partnersOn = false;
	}

	/* --- the live message ------------------------------------------------------------------ */

	// f: { id, text, sub, at, until } while it is up, or null
	function showFlash(f) {
		state.flash = f || null;
		paint();
	}

	// an announcement posted since the screen opened takes the screen for NEWS_MS (the newest, when several came at
	// once); the ones there when it opened do not. One posted along with a live message is that message: not twice.
	function spot() {
		var list = announcements();
		if (!state.seen) {
			state.seen = {};
			list.forEach(function (it) { state.seen[it.id] = true; });
			return;
		}
		var now = Date.now();
		var news = list.filter(function (it) { return !state.seen[it.id]; });
		news.forEach(function (it) { state.seen[it.id] = true; state.fresh[it.id] = now; });
		if (!news.length) return;
		state.annIndex = 0;
		state.annNext = now + NEWS_MS + ANN_EVERY;
		var it = news.sort(function (a, b) { return (b.posted || 0) - (a.posted || 0); })[0];
		var f = state.flash;
		if (f && (it.title === f.text || it.text === f.text)) return;
		var text = it.title || it.text.replace(/\s*\n+\s*/g, ' ');
		state.news = { id: 'news-' + it.id, kind: 'New announcement', text: text, sub: it.title ? it.text.replace(/\s*\n+\s*/g, ' ') : '', at: it.posted || now, until: now + NEWS_MS };
	}

	// what the overlay shows: the live message first, else a new announcement; when neither, it goes
	function paint() {
		var now = Date.now();
		var f = state.flash && now < Date.parse(state.flash.until) ? state.flash : null;
		if (state.news && now >= state.news.until) state.news = null;
		var show = f ? { id: f.id, kind: 'Live', text: f.text, sub: f.sub || '', at: Date.parse(f.at), until: Date.parse(f.until) } : state.news;
		var box = $('flash');
		if (!show) {
			if (state.shown) {
				state.shown = '';
				box.classList.add('is-out');
				window.setTimeout(function () {
					if (state.shown) return;
					box.hidden = true;
					box.classList.remove('is-on', 'is-out');
				}, 600);
			}
			return;
		}
		if (state.shown === show.id) return;   // the same one: it carries on as it is
		state.shown = show.id;
		stopPartners();
		$('flash-kind').textContent = show.kind;
		$('flash-text').textContent = show.text;
		$('flash-sub').textContent = show.sub;
		$('flash-at').textContent = hm(show.at);
		box.classList.toggle('is-long', show.text.length > 34);
		box.style.setProperty('--f-ms', Math.max(1000, show.until - now - 1600) + 'ms');
		box.classList.remove('is-on', 'is-out');
		box.hidden = false;
		void box.offsetWidth;   // so the animations start from the top
		box.classList.add('is-on');
		chime();
	}

	/* --- the chime: a bright rising arpeggio as the band comes in, as before an announcement at a station. Browsers
	   let a page make a sound only once someone has touched it: the first touch, click or key turns it on. --- */

	var audio = null;

	function canSound() { return !!(window.AudioContext || window.webkitAudioContext); }
	function soundOn() { return !!audio && audio.state === 'running'; }

	function unlockSound() {
		if (!canSound()) return;
		try {
			if (!audio) {
				audio = new (window.AudioContext || window.webkitAudioContext)();
				audio.onstatechange = renderStatus;
			}
			if (audio.state === 'suspended') audio.resume().then(renderStatus, function () {});
		} catch (e) {}
	}

	['pointerdown', 'touchend', 'keydown'].forEach(function (type) {
		document.addEventListener(type, unlockSound, true);
	});

	function chime() {
		if (!soundOn()) return;
		var t0 = audio.currentTime + 0.05;
		var out = audio.createGain();
		out.gain.value = 0.55;
		out.connect(audio.destination);
		// E, G sharp, B and the E above: each a sine with a little of its octave, struck and dying away
		[659.25, 830.61, 987.77, 1318.51].forEach(function (hz, i) {
			var t = t0 + i * 0.13;
			var ring = i === 3 ? 2.2 : 1.4;
			[[1, 0.5], [2, 0.1]].forEach(function (part) {
				var o = audio.createOscillator();
				var g = audio.createGain();
				o.type = 'sine';
				o.frequency.value = hz * part[0];
				g.gain.setValueAtTime(0.0001, t);
				g.gain.exponentialRampToValueAtTime(part[1], t + 0.012);
				g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
				o.connect(g);
				g.connect(out);
				o.start(t);
				o.stop(t + ring + 0.05);
			});
		});
	}

	var flashTimer = null;

	function pollFlash() {
		window.clearTimeout(flashTimer);
		flashTimer = window.setTimeout(function () {
			post({ action: 'flash', code: state.key }, 20000, function (json) {
				if (json && json.denied) return;   // the password changed: the screen asks for it again (poll)
				if (json && json.ok && json.action === 'flash') showFlash(json.flash);
				pollFlash();
			});
		}, FLASH_MS);
	}

	/* --- the wall: the clock every second, full screen, the cursor out of the way ------------------ */

	var lastMinute = -1;
	window.setInterval(function () {
		if ($('wall').hidden) return;
		var now = Date.now();
		$('clock').textContent = hm(now);
		if (state.shown) paint();   // the message or the announcement ran out
		if (!state.annNext) state.annNext = now + ANN_EVERY;
		else if (now >= state.annNext) turnAnnouncements(now);
		// the partners: a minute after the screen opens, then every PARTNERS_EVERY
		if (!state.partnersAt) state.partnersAt = now + 60000;
		if (now >= state.partnersAt) {
			state.partnersAt = now + PARTNERS_EVERY;
			if (!busyMoment(now)) playPartners();
		}
		var minute = Math.floor(now / 60000);
		if (minute !== lastMinute) { lastMinute = minute; render(); return; }
		var c = document.querySelector('[data-to]');
		if (!c) return;
		var to = now < START ? START : now < STOP ? STOP : AWARDS;
		if (to - now <= 86400000) c.textContent = clock(to - now);
	}, 1000);

	function fullScreen() {
		var d = document.documentElement;
		if (document.fullscreenElement) document.exitFullscreen();
		else if (d.requestFullscreen) d.requestFullscreen();
	}

	$('full').addEventListener('click', fullScreen);
	document.addEventListener('keydown', function (ev) {
		if ($('wall').hidden || ev.target !== document.body) return;
		if (ev.key === 'f' || ev.key === 'F') fullScreen();
		if (ev.key === 'p' || ev.key === 'P') playPartners();
	});
	document.addEventListener('fullscreenchange', function () {
		$('full').hidden = !!document.fullscreenElement;
	});

	var idle = null;
	document.addEventListener('mousemove', function () {
		document.body.classList.remove('is-idle');
		window.clearTimeout(idle);
		idle = window.setTimeout(function () { document.body.classList.add('is-idle'); }, 3000);
	});

	if (storedKey()) open(storedKey(), false);
	else $('key').focus();

})();
