/*
	BreaQ 2026 in photos (breaq-2026-photos.html): the photos the participants send, and the form that sends them
	- reads them with { action: "photos" } from the Apps Script in data-endpoint (tools/register-backend.gs), newest
	  first, each shown through Drive; the lightbox (breaq.js) takes them in as they come
	- sends each photo chosen with { action: "photo", code, photo, w, h }, one after another: turned upright and made
	  at most 2560 px here, as a JPEG, which leaves out where it was taken. The code is the team dashboard's,
	  filled in when this device has it (teams.js keeps it)
*/

(function () {

	'use strict';

	var root = document.getElementById('yours');
	if (!root) return;

	var endpoint = (root.getAttribute('data-endpoint') || '').trim();
	var CODE_STORE = 'breaq-2026-team-code';
	var MAX_PX = 2560;
	var QUALITY = 0.85;

	var grid = document.getElementById('theirs');
	var state = document.getElementById('theirs-state');
	var count = document.getElementById('yours-n');
	var form = document.getElementById('ph-form');
	var codeIn = document.getElementById('ph-code');
	var filesIn = document.getElementById('ph-files');
	var okIn = document.getElementById('ph-ok');
	var sendBtn = document.getElementById('ph-send');
	var status = document.getElementById('ph-status');

	function post(body, timeout, done) {
		var ctrl = window.AbortController ? new AbortController() : null;
		var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, timeout) : null;
		window.fetch(endpoint, {
			method: 'POST',
			body: JSON.stringify(body),
			cache: 'no-store',
			signal: ctrl ? ctrl.signal : undefined
		}).then(function (res) {
			return res.text();
		}).then(function (text) {
			if (timer) window.clearTimeout(timer);
			var json = null;
			try { json = JSON.parse(text); } catch (e) {}
			done(json);
		}).catch(function () {
			if (timer) window.clearTimeout(timer);
			done(null);
		});
	}

	/* --- the photos sent ---------------------------------------------------- */

	function drive(id, px) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + px; }

	function render(list) {
		grid.textContent = '';
		list.forEach(function (p, i) {
			var fig = document.createElement('figure');
			fig.className = 'ph';
			fig.style.aspectRatio = p.w && p.h ? p.w + ' / ' + p.h : '4 / 3';
			fig.setAttribute('data-cap', 'From you · ' + (i + 1) + ' of ' + list.length +
				' · <a href="https://drive.google.com/uc?export=download&amp;id=' + encodeURIComponent(p.id) + '">Download</a>');
			var img = document.createElement('img');
			img.alt = 'BreaQ 2026, a participant’s photo';
			img.loading = 'lazy';
			img.decoding = 'async';
			img.setAttribute('data-full', drive(p.id, 2048));
			// one put in the folder by hand comes without its size
			if (!(p.w && p.h)) img.addEventListener('load', function () { fig.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight; });
			// taken down meanwhile
			img.addEventListener('error', function () { fig.hidden = true; });
			img.src = drive(p.id, 640);
			fig.appendChild(img);
			grid.appendChild(fig);
		});
		count.textContent = list.length ? String(list.length) : '';
		state.textContent = list.length ? '' : 'None yet: yours can be the first.';
		state.hidden = !!list.length;
	}

	function load(tries) {
		post({ action: 'photos' }, 30000, function (json) {
			if (json && json.ok && json.photos) { render(json.photos); return; }
			if (tries < 2) { window.setTimeout(function () { load(tries + 1); }, 3000); return; }
			state.hidden = false;
			state.textContent = 'Could not read the participants’ photos just now. Reload the page in a minute.';
		});
	}

	/* --- sending ------------------------------------------------------------- */

	try { codeIn.value = window.localStorage.getItem(CODE_STORE) || window.sessionStorage.getItem(CODE_STORE) || ''; } catch (e) {}
	if (codeIn.value) document.getElementById('ph-code-help').textContent = 'Filled in from your team dashboard on this device.';

	function say(text, bad) {
		status.hidden = !text;
		status.textContent = text;
		status.classList.toggle('is-bad', !!bad);
	}

	function busy(on) {
		sendBtn.disabled = codeIn.disabled = filesIn.disabled = okIn.disabled = on;
		sendBtn.classList.toggle('is-busy', on);
		sendBtn.textContent = on ? 'Sending…' : 'Send photos';
	}

	// a photo as a JPEG of at most MAX_PX, upright (the browser turns it as the camera says): { b64, w, h }, or why not
	function shrink(file, done) {
		var url = URL.createObjectURL(file);
		var img = new Image();
		img.onload = function () {
			var k = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
			var w = Math.max(1, Math.round(img.naturalWidth * k));
			var h = Math.max(1, Math.round(img.naturalHeight * k));
			var canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			canvas.getContext('2d').drawImage(img, 0, 0, w, h);
			URL.revokeObjectURL(url);
			canvas.toBlob(function (blob) {
				if (!blob) { done(null, 'this browser could not make it smaller'); return; }
				var reader = new FileReader();
				reader.onload = function () { done({ b64: String(reader.result).split(',')[1], w: w, h: h }); };
				reader.onerror = function () { done(null, 'could not be read'); };
				reader.readAsDataURL(blob);
			}, 'image/jpeg', QUALITY);
		};
		img.onerror = function () {
			URL.revokeObjectURL(url);
			done(null, /\.hei[cf]$/i.test(file.name)
				? 'this browser cannot open HEIC photos: send it from your phone, or save it as JPEG first'
				: 'not a photo this browser can open');
		};
		img.src = url;
	}

	form.addEventListener('submit', function (ev) {
		ev.preventDefault();
		var code = codeIn.value.trim();
		var files = Array.prototype.slice.call(filesIn.files || []);
		if (!code) { say('Fill in your dashboard code: it is in your acceptance email.', true); codeIn.focus(); return; }
		if (!files.length) { say('Choose the photos to send.', true); filesIn.focus(); return; }
		if (!okIn.checked) { say('Tick the box first: the photos are yours to share, and fine for the people in them.', true); okIn.focus(); return; }
		busy(true);
		var sent = 0;
		var failed = [];   // [file name, why]
		(function next(i) {
			if (i === files.length) {
				busy(false);
				var text = sent ? 'Sent ' + sent + (sent === 1 ? ' photo' : ' photos') + '. Thank you! ' + (sent === 1 ? 'It is' : 'They are') + ' first below.' : '';
				if (failed.length) text += (text ? ' ' : '') + 'Not sent: ' + failed.map(function (f) { return f[0] + ' (' + f[1] + ')'; }).join('; ') + '.';
				say(text, !sent);
				if (sent) { filesIn.value = ''; load(0); }
				return;
			}
			var file = files[i];
			say('Sending ' + (i + 1) + ' of ' + files.length + '…');
			shrink(file, function (shot, why) {
				if (!shot) { failed.push([file.name, why]); next(i + 1); return; }
				post({ action: 'photo', code: code, photo: shot.b64, w: shot.w, h: shot.h }, 120000, function (json) {
					if (json && json.ok) { sent++; next(i + 1); return; }
					// a wrong code stops it all; anything else, that photo only
					if (json && json.denied) {
						busy(false);
						say((sent ? 'Sent ' + sent + ', then: ' : '') + json.error, true);
						if (sent) load(0);
						return;
					}
					failed.push([file.name, json && json.error ? json.error.replace(/\.$/, '') : 'could not reach us']);
					next(i + 1);
				});
			});
		})(0);
	});

	if (!endpoint) {
		state.textContent = 'The participants’ photos are not here yet.';
		sendBtn.disabled = true;
		return;
	}
	load(0);

})();
