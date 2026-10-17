/*
	BreaQ Hackathon: the check-in at the door (door.html, roqteam.ro/door)
	- opens with the admin key (kept on the phone, as the admin page keeps it), and reads the admin page's list (the
	  "list" action of tools/register-backend.gs): the accepted hackathon participants, each with their dashboard
	  code, team, T-shirt, diet and check-in; again every minute, so another phone's check-ins show
	- the camera fills the screen; a pass read (the QR code of the participant's code, on their team dashboard)
	  checks its owner in at once ("checkin"), and a sheet says who it was, with a buzz and a beep; here already, or
	  a code we do not know, it says that. The test pass, BREAQ-TEST, checks nobody in.
	- Chrome reads the codes with its own reader (BarcodeDetector); Safari and every browser on an iPhone with jsQR
	  (assets/js/vendor), loaded only there
	- keeps the screen on while it scans (where the browser can), and lets the camera go when the app is put away
*/

(function () {

	'use strict';

	var root = document.getElementById('door');
	if (!root) return;

	var endpoint = (root.getAttribute('data-endpoint') || '').trim();
	var KEY_STORE = 'breaq-2026-admin-key';   // as admin.js
	var JSQR_SRC = 'assets/js/vendor/jsqr-1.4.0.js';
	var TEST_CODE = 'BREAQTEST';
	var LIST_MS = 60000;
	var SAME_MS = 3000;     // the same pass is read again only once it has been out of view this long
	var CLOSE_MS = 2600;    // a check-in's sheet goes by itself after this

	var state = {
		key: '',
		people: [],         // { email, name, team, tshirt, diet, at (checked in), code (key, no dash) }
		scanning: false,
		stream: null,
		read: null,
		last: '', lastAt: 0,
		sheet: false,       // a sheet is up: the camera does not read meanwhile
		wake: null,
		audio: null,
		closeTimer: null,
		listTimer: null,
		listAt: 0
	};

	function $(id) { return document.getElementById(id); }

	function el(tag, cls, text) {
		var node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text !== undefined && text !== null) node.textContent = text;
		return node;
	}

	function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
	function codeKey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

	var hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' });

	/* --- the list -------------------------------------------------------------------- */

	function post(body, ms, done) {
		var ctrl = window.AbortController ? new AbortController() : null;
		var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, ms) : null;
		window.fetch(endpoint, { method: 'POST', body: JSON.stringify(body), cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
			.then(function (res) { return res.text(); })
			.then(function (text) {
				if (timer) window.clearTimeout(timer);
				var json = null;
				try { json = JSON.parse(text); } catch (e) {}
				done(json);
			})
			.catch(function () { if (timer) window.clearTimeout(timer); done(null); });
	}

	// the accepted hackathon participants, from the list's rows
	function take(json) {
		var cols = json.columns.map(function (c) { return String(c).trim(); });
		var at = function (c) { return cols.indexOf(c); };
		var people = [];
		json.rows.forEach(function (row) {
			var get = function (c) { var j = at(c); return j === -1 || row[j] === null || row[j] === undefined ? '' : String(row[j]).trim(); };
			if (!/hackathon|both/i.test(get('Attends')) || get('Decision').toLowerCase() !== 'accepted') return;
			var email = get('Email').toLowerCase();
			people.push({
				email: email,
				name: (get('First name') + ' ' + get('Last name')).trim(),
				team: get('Hackathon team'),
				tshirt: get('T-shirt'),
				diet: /^(n\/?a|none|no|nu|-|nothing)$/i.test(get('Dietary')) ? '' : get('Dietary'),
				at: get('Checked in'),
				code: codeKey((json.codes || {})[email])
			});
		});
		state.people = people;
		state.listAt = Date.now();
		renderCount();
	}

	function load(done) {
		post({ action: 'list', key: state.key }, 60000, function (json) {
			if (json && json.ok && json.columns && json.rows) { take(json); done(null); return; }
			done(json && json.denied ? 'denied' : 'failed');
		});
	}

	function here() { return state.people.filter(function (p) { return p.at; }).length; }

	function renderCount() {
		var text = here() + ' of ' + state.people.length + ' here';
		$('count').textContent = text;
		$('start-count').textContent = state.people.length ? text : 'Nobody is accepted yet.';
	}

	// another phone's check-ins: the list again every minute, while no sheet is up
	function keepListing() {
		window.clearTimeout(state.listTimer);
		state.listTimer = window.setTimeout(function () {
			if (state.sheet || document.hidden) { keepListing(); return; }
			load(function () { keepListing(); });
		}, LIST_MS);
	}

	/* --- the key ---------------------------------------------------------------------- */

	function storedKey() {
		try { return window.localStorage.getItem(KEY_STORE) || window.sessionStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
	}

	function show(id) {
		['lock', 'start', 'cam'].forEach(function (s) { $(s).hidden = s !== id; });
	}

	function open(key, fromStore) {
		$('lock-btn').disabled = true;
		$('lock-btn').textContent = 'Opening…';
		state.key = key;
		load(function (problem) {
			$('lock-btn').disabled = false;
			$('lock-btn').textContent = 'Open';
			if (!problem) {
				try { window.localStorage.setItem(KEY_STORE, key); } catch (e) {}
				$('start-title').textContent = 'Ready at the door.';
				show('start');
				keepListing();
				return;
			}
			show('lock');
			if (problem === 'denied') {
				try { if (fromStore) window.localStorage.removeItem(KEY_STORE); } catch (e) {}
				$('lock-err').textContent = 'That key does not open it: it is the admin key, from the Apps Script editor (adminKey).';
			} else $('lock-err').textContent = 'Could not reach the Apps Script. Check the connection and try again.';
			$('lock-err').hidden = false;
		});
	}

	$('lock-form').addEventListener('submit', function (ev) {
		ev.preventDefault();
		var key = $('key').value.trim();
		if (key) open(key, false);
	});

	/* --- the reader ------------------------------------------------------------------ */

	function loadJsQr(done) {
		if (window.jsQR) { done(true); return; }
		var s = document.createElement('script');
		s.src = JSQR_SRC;
		s.onload = function () { done(!!window.jsQR); };
		s.onerror = function () { done(false); };
		document.head.appendChild(s);
	}

	// read(video): a promise of the text of the QR code in the frame, or ''
	function reader(done) {
		if (state.read) { done(state.read); return; }
		function withJsQr() {
			loadJsQr(function (ok) {
				if (!ok) { done(null); return; }
				var canvas = document.createElement('canvas');
				var ctx = canvas.getContext('2d', { willReadFrequently: true });
				state.read = function (video) {
					var w = video.videoWidth, h = video.videoHeight;
					if (!w || !h) return Promise.resolve('');
					var scale = Math.min(1, 720 / Math.max(w, h));
					canvas.width = Math.round(w * scale);
					canvas.height = Math.round(h * scale);
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
					var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
					var code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
					return Promise.resolve(code ? code.data : '');
				};
				done(state.read);
			});
		}
		if (!('BarcodeDetector' in window)) { withJsQr(); return; }
		window.BarcodeDetector.getSupportedFormats().then(function (formats) {
			if (formats.indexOf('qr_code') === -1) { withJsQr(); return; }
			var det = new window.BarcodeDetector({ formats: ['qr_code'] });
			state.read = function (video) { return det.detect(video).then(function (c) { return c.length ? c[0].rawValue : ''; }); };
			done(state.read);
		}).catch(withJsQr);
	}

	/* --- the camera -------------------------------------------------------------------- */

	function startErr(msg) {
		$('start-err').textContent = msg;
		$('start-err').hidden = !msg;
	}

	function start() {
		startErr('');
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			startErr('This browser cannot open the camera. Use Find by name or code instead.');
			return;
		}
		// the tap that starts it lets the phone beep later (iPhones play sound only after one)
		try {
			if (!state.audio && (window.AudioContext || window.webkitAudioContext)) state.audio = new (window.AudioContext || window.webkitAudioContext)();
			if (state.audio && state.audio.state === 'suspended') state.audio.resume();
		} catch (e) {}
		$('go').disabled = true;
		var got = { read: null, stream: null }, failed = false;
		function both() {
			if (failed || !got.read || !got.stream) return;
			$('go').disabled = false;
			state.read = got.read;
			state.stream = got.stream;
			var v = $('video');
			v.srcObject = got.stream;
			var p = v.play();
			if (p && p.catch) p.catch(function () {});
			state.scanning = true;
			show('cam');
			awake(true);
			loop();
		}
		reader(function (read) {
			if (!read) {
				failed = true;
				$('go').disabled = false;
				if (got.stream) got.stream.getTracks().forEach(function (t) { t.stop(); });
				startErr('The QR reader did not load. Check the connection and try again.');
				return;
			}
			got.read = read;
			both();
		});
		navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then(function (s) {
			if (failed) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
			got.stream = s;
			both();
		}).catch(function (err) {
			failed = true;
			$('go').disabled = false;
			startErr(err && err.name === 'NotAllowedError'
				? 'The camera is not allowed. On an iPhone: Settings, then Safari (or the app), then Camera: Allow. Then try again.'
				: 'The camera did not open. Is another app using it?');
		});
	}

	function stop(toStart) {
		state.scanning = false;
		if (state.stream) state.stream.getTracks().forEach(function (t) { t.stop(); });
		state.stream = null;
		$('video').srcObject = null;
		awake(false);
		if (toStart) { renderCount(); show('start'); }
	}

	function loop() {
		window.setTimeout(function () {
			if (!state.scanning) return;
			if (state.sheet) { loop(); return; }
			state.read($('video')).then(function (raw) {
				if (!raw) return;
				// still held up after its sheet: not read again until it has been out of view a moment
				if (codeKey(raw) === state.last && Date.now() - state.lastAt < SAME_MS) { state.lastAt = Date.now(); return; }
				scanned(raw);
			}).catch(function () {}).then(loop);
		}, 180);
	}

	// the screen stays on while scanning, where the browser lets it
	function awake(on) {
		try {
			if (on && navigator.wakeLock && !state.wake) {
				navigator.wakeLock.request('screen').then(function (w) { state.wake = w; }).catch(function () {});
			} else if (!on && state.wake) {
				state.wake.release();
				state.wake = null;
			}
		} catch (e) {}
	}

	$('go').addEventListener('click', start);
	$('stop').addEventListener('click', function () { stop(true); });

	// put away: the camera goes; back: it comes again
	var wasScanning = false;
	document.addEventListener('visibilitychange', function () {
		if (document.hidden) {
			wasScanning = state.scanning;
			if (state.scanning) stop(false);
			state.wake = null;
		} else if (wasScanning && state.key) {
			wasScanning = false;
			start();
		}
	});

	/* --- a pass read ----------------------------------------------------------------------- */

	// a short buzz and a beep: high for in, low for a problem
	function feedback(ok) {
		try { if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]); } catch (e) {}
		var a = state.audio;
		if (!a) return;
		try {
			var o = a.createOscillator(), g = a.createGain();
			o.type = 'sine';
			o.frequency.value = ok ? 1046 : 220;
			g.gain.setValueAtTime(0.0001, a.currentTime);
			g.gain.exponentialRampToValueAtTime(0.25, a.currentTime + 0.01);
			g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + (ok ? 0.16 : 0.32));
			o.connect(g);
			g.connect(a.destination);
			o.start();
			o.stop(a.currentTime + 0.35);
		} catch (e) {}
	}

	function byCode(raw) {
		var k = codeKey(raw);
		if (k.length !== 8) return null;
		return state.people.filter(function (p) { return p.code === k; })[0] || null;
	}

	function scanned(raw) {
		var k = codeKey(raw);
		state.last = k;
		state.lastAt = Date.now();
		if (k === TEST_CODE) {
			feedback(true);
			sheet('test', { name: 'Test pass' }, 'The camera reads the passes. Nobody was checked in.');
			return;
		}
		var p = byCode(raw);
		if (!p) {
			feedback(false);
			sheet('bad', { name: 'Not a pass we know' }, 'Not an accepted participant’s code' + (k ? ' (' + String(raw).slice(0, 16) + ')' : '') + '. Find them by name instead, or send them to the desk.');
			return;
		}
		checkIn(p);
	}

	function checkIn(p) {
		if (p.at) {
			feedback(false);
			sheet('again', p, 'Already here, since ' + hm.format(new Date(p.at)) + '.');
			return;
		}
		feedback(true);
		sheet('ok', p, 'Saving…');
		save(p, false);
	}

	function save(p, undo) {
		var was = p.at;
		p.at = undo ? '' : new Date().toISOString();   // at once on the screen; put back if it does not go through
		renderCount();
		post({ action: 'checkin', key: state.key, email: p.email, undo: !!undo }, 30000, function (json) {
			var showing = $('res-name').getAttribute('data-email') === p.email;
			if (json && json.ok && json.action === 'checkin') {
				p.at = json.checkedIn ? String(json.checkedIn) : '';
				renderCount();
				if (showing && !undo) $('res-note').textContent = 'Checked in at ' + hm.format(new Date(p.at)) + '.';
				return;
			}
			p.at = was;
			renderCount();
			if (json && json.denied) { stop(false); state.key = ''; show('lock'); return; }
			feedback(false);
			sheet('bad', p, (undo ? 'Not undone' : 'Not checked in') + ': ' + (json && json.error ? json.error : 'the Apps Script did not answer. Check the connection, then scan again.'));
		});
	}

	/* --- the sheet ------------------------------------------------------------------------- */

	var KIND = {
		ok: { kicker: 'Checked in', icon: '#i-check' },
		again: { kicker: 'Already here', icon: '#i-clock' },
		bad: { kicker: 'Not checked in', icon: '#i-x' },
		test: { kicker: 'It works', icon: '#i-check' }
	};

	function sheet(kind, p, note) {
		window.clearTimeout(state.closeTimer);
		var box = $('result');
		box.className = 'sheet result is-' + kind;
		$('res-icon').setAttribute('href', KIND[kind].icon);
		$('res-kicker').textContent = KIND[kind].kicker;
		var name = $('res-name');
		name.textContent = '';
		name.setAttribute('data-email', p.email || '');
		var words = String(p.name || '').split(/\s+/).filter(Boolean);
		if (p.email && words.length > 1) {
			name.appendChild(document.createTextNode(words.slice(0, -1).join(' ') + ' '));
			name.appendChild(el('span', 'gold', words[words.length - 1]));
		} else name.textContent = p.name || '';
		$('res-team').textContent = p.email ? (p.team || 'No team yet') : '';
		var facts = $('res-facts');
		facts.textContent = '';
		if (p.tshirt) facts.appendChild(el('span', 'tag', 'T-shirt ' + p.tshirt));
		if (p.diet) facts.appendChild(el('span', 'tag tag-pin', p.diet));
		$('res-note').textContent = note || '';
		var undo = $('res-undo');
		undo.hidden = kind !== 'ok';
		undo.onclick = function () { save(p, true); closeSheet(); };
		box.hidden = false;
		state.sheet = true;
		// a check-in goes by itself; anything else waits for Next
		var timer = $('res-timer');
		timer.classList.remove('is-running');
		if (kind === 'ok' || kind === 'test') {
			void timer.offsetWidth;   // restart the bar's animation
			timer.classList.add('is-running');
			state.closeTimer = window.setTimeout(closeSheet, CLOSE_MS);
		}
		$('res-next').focus();
	}

	function closeSheet() {
		window.clearTimeout(state.closeTimer);
		state.lastAt = Date.now();   // the pass is likely still in front of the camera
		$('result').hidden = true;
		state.sheet = !$('find-sheet').hidden;
	}

	$('res-next').addEventListener('click', closeSheet);

	/* --- by hand ----------------------------------------------------------------------------- */

	function openFind() {
		$('find-sheet').hidden = false;
		state.sheet = true;
		$('find-q').value = '';
		renderFind();
		$('find-q').focus();
	}

	function closeFind() {
		$('find-sheet').hidden = true;
		state.sheet = !$('result').hidden;
	}

	function renderFind() {
		var q = fold($('find-q').value).trim();
		var k = codeKey(q);
		var list = $('find-list');
		list.textContent = '';
		var found = state.people.filter(function (p) {
			if (!q) return !p.at;
			return fold(p.name + ' ' + p.team + ' ' + p.email).indexOf(q) !== -1 || (k.length >= 4 && p.code.indexOf(k) === 0);
		}).sort(function (a, b) { return Number(!!a.at) - Number(!!b.at) || fold(a.name).localeCompare(fold(b.name)); }).slice(0, 40);
		if (!found.length) {
			list.appendChild(el('li', 'find-empty', q ? 'Nobody accepted matches that.' : 'Everyone is here.'));
			return;
		}
		found.forEach(function (p) {
			var li = el('li', 'find-row' + (p.at ? ' is-in' : ''));
			var main = el('div', 'find-main');
			main.appendChild(el('p', 'find-name', p.name));
			main.appendChild(el('p', 'find-sub', [p.team || 'No team', p.tshirt ? 'T-shirt ' + p.tshirt : ''].filter(Boolean).join(' · ')));
			li.appendChild(main);
			if (p.at) li.appendChild(el('span', 'find-at', 'Here · ' + hm.format(new Date(p.at))));
			else {
				var b = el('button', 'btn small primary', 'Check in');
				b.type = 'button';
				b.addEventListener('click', function () { closeFind(); checkIn(p); });
				li.appendChild(b);
			}
			list.appendChild(li);
		});
	}

	$('find').addEventListener('click', openFind);
	$('start-find').addEventListener('click', openFind);
	$('find-close').addEventListener('click', closeFind);
	$('find-q').addEventListener('input', renderFind);

	/* --- opening ----------------------------------------------------------------------------- */

	if (storedKey()) { $('start-title').textContent = 'Opening…'; show('start'); open(storedKey(), true); }
	else { show('lock'); $('key').focus(); }

})();
