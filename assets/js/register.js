/*
	BreaQ registration form
	- validates in the browser, posts JSON to the Apps Script endpoint in data-endpoint
	- keeps a draft in localStorage so a reload does not lose the answers (not the PDF: a file cannot be kept)
	- reads the motivation letter (register.html) and sends it base64-encoded with the rest
	- falls back to the link in data-fallback while no endpoint is configured
*/

(function () {

	'use strict';

	var form = document.getElementById('reg');
	if (!form) return;

	var endpoint = (form.getAttribute('data-endpoint') || window.BREAQ_REGISTER_ENDPOINT || '').trim();
	var fallback = form.getAttribute('data-fallback') || '';
	var errBox = form.querySelector('.reg-err');
	var submitBtn = form.querySelector('button[type="submit"]');
	var done = document.getElementById('reg-done');
	var openedAt = Date.now();
	// one draft per form: register.html (hackathon) and register-conference.html
	var DRAFT_KEY = form.getAttribute('data-draft') || 'breaq-2026-registration';
	var LETTER_MAX = 5 * 1024 * 1024;   // the motivation letter; tools/register-backend.gs has the same limit

	function forEach(list, fn) { Array.prototype.forEach.call(list, fn); }

	/* --- conditional fields --------------------------------------- */

	// a question that belongs to one track (data-track, the team question for Quantum AI) shows while that
	// track is ticked; the teammates field shows when the answer is "with a team"
	function syncConditionals() {
		var asked = true;
		forEach(form.querySelectorAll('[data-track]'), function (el) {
			var box = form.querySelector('input[name="tracks"][value="' + el.getAttribute('data-track') + '"]');
			el.hidden = !box || !box.checked;
			if (el.querySelector('input[name="team"]')) asked = !el.hidden;
		});
		var team = form.querySelector('input[name="team"]:checked');
		forEach(form.querySelectorAll('[data-team]'), function (el) { el.hidden = !asked || !team || team.value !== 'team'; });
	}

	form.addEventListener('change', syncConditionals);

	/* --- draft ------------------------------------------------------ */

	function collect() {
		var data = {};
		forEach(form.elements, function (el) {
			if (!el.name || el.name === 'website' || el.type === 'file') return;
			if (el.type === 'checkbox') {
				if (el.name === 'tracks') { data.tracks = data.tracks || []; if (el.checked) data.tracks.push(el.value); }
				else data[el.name] = el.checked;
			} else if (el.type === 'radio') {
				if (el.checked) data[el.name] = el.value;
			} else {
				data[el.name] = el.value.trim();
			}
		});
		return data;
	}

	function saveDraft() {
		try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); } catch (e) {}
	}

	function restoreDraft() {
		var raw;
		try { raw = window.localStorage.getItem(DRAFT_KEY); } catch (e) { return; }
		if (!raw) return;
		var data;
		try { data = JSON.parse(raw); } catch (e) { return; }
		forEach(form.elements, function (el) {
			// hidden fields (which event the form is for) come from the page, never from a draft
			if (!el.name || !(el.name in data) || el.name === 'website' || el.type === 'hidden' || el.type === 'file') return;
			if (el.type === 'checkbox') el.checked = el.name === 'tracks' ? data.tracks.indexOf(el.value) !== -1 : !!data[el.name];
			else if (el.type === 'radio') el.checked = data[el.name] === el.value;
			else el.value = data[el.name];
		});
	}

	form.addEventListener('input', saveDraft);
	form.addEventListener('change', saveDraft);
	restoreDraft();
	syncConditionals();

	/* --- validation ------------------------------------------------- */

	function fieldOf(el) {
		var node = el;
		while (node && node !== form && !(node.classList && node.classList.contains('field'))) node = node.parentNode;
		return node === form ? null : node;
	}

	function setError(message, el) {
		errBox.textContent = message;
		errBox.hidden = !message;
		forEach(form.querySelectorAll('.field.is-invalid'), function (f) { f.classList.remove('is-invalid'); });
		if (el) {
			var field = fieldOf(el);
			if (field) field.classList.add('is-invalid');
			el.focus();
			if (field && field.scrollIntoView) field.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	}

	function validate() {
		var els = Array.prototype.slice.call(form.elements);
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			if (!el.name || el.disabled) continue;
			var field = fieldOf(el);
			if (field && field.hidden) continue;
			if (el.type === 'file') {
				var file = el.files && el.files[0];
				if (el.required && !file) return setError('Please attach your motivation letter as a PDF.', el), false;
				if (file && !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return setError('The motivation letter has to be a PDF.', el), false;
				if (file && file.size > LETTER_MAX) return setError('The motivation letter is over 5 MB. Please upload a smaller PDF.', el), false;
				continue;
			}
			if (el.required && el.type === 'checkbox' && !el.checked) {
				return setError(el.name === 'consent' ? 'Please tick the GDPR box: we need your agreement to store the registration.' : 'Please confirm the last point too.', el), false;
			}
			if (el.required && el.type !== 'checkbox' && !el.value.trim()) {
				var label = field ? field.querySelector('label, .lbl') : null;
				return setError('Please fill in "' + (label ? label.textContent.replace(/optional|pick any/g, '').trim() : el.name) + '".', el), false;
			}
			if (el.type === 'email' && el.value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.value.trim())) {
				return setError('That email address does not look right.', el), false;
			}
		}
		return true;
	}

	/* --- submit ------------------------------------------------------ */

	function busy(on) {
		submitBtn.disabled = on;
		submitBtn.classList.toggle('is-busy', on);
		submitBtn.textContent = on ? 'Sending…' : 'Send my registration';
	}

	function showDone(data) {
		form.hidden = true;
		done.hidden = false;
		var name = done.querySelector('[data-name]'), email = done.querySelector('[data-email]');
		if (name) name.textContent = data.first_name;
		if (email) email.textContent = data.email;
		try { window.localStorage.removeItem(DRAFT_KEY); } catch (e) {}
		done.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	if (!endpoint) {
		var note = form.querySelector('.reg-fallback');
		if (note) note.hidden = false;
	}

	form.addEventListener('submit', function (ev) {
		ev.preventDefault();
		if (!validate()) return;
		setError('');
		var data = collect();
		// answers to questions that are not showing (the team, once Quantum AI is unticked) do not go out
		forEach(form.querySelectorAll('.field[hidden] [name]'), function (el) { delete data[el.name]; });
		data.website = form.querySelector('[name="website"]').value;   // honeypot: bots fill it, people never see it
		data.seconds_on_page = Math.round((Date.now() - openedAt) / 1000);
		data.page = window.location.href;

		if (!endpoint) {
			// nothing configured yet: hand over to the fallback form so no registration is lost
			if (fallback) window.open(fallback, '_blank', 'noopener');
			setError('Online registration here is not switched on yet, so we opened the current form in a new tab.');
			return;
		}

		busy(true);
		var fileInput = form.querySelector('input[type="file"]');
		readLetter(fileInput && fileInput.files ? fileInput.files[0] : null, function (letter, failed) {
			if (failed) {
				busy(false);
				return setError('We could not read the PDF. Please choose it again.', fileInput);
			}
			if (letter) data.letter = letter;
			send(data);
		});
	});

	// the PDF as base64, the way Apps Script can turn it back into a file
	function readLetter(file, cb) {
		if (!file || !window.FileReader) return cb(null);
		var reader = new FileReader();
		reader.onload = function () {
			var url = String(reader.result || '');
			cb({ name: file.name, size: file.size, data: url.slice(url.indexOf(',') + 1) });
		};
		reader.onerror = function () { cb(null, true); };
		reader.readAsDataURL(file);
	}

	function send(data) {
		// Apps Script can take 10-15 s just to wake up, then it writes the row and sends two emails:
		// give it a full minute before calling it a timeout
		var ctrl = window.AbortController ? new AbortController() : null;
		var timedOut = false;
		var timer = ctrl ? window.setTimeout(function () { timedOut = true; ctrl.abort(); }, 60000) : null;

		window.fetch(endpoint, {
			method: 'POST',
			body: JSON.stringify(data),        // a string body is a "simple" request: no CORS preflight against Apps Script
			signal: ctrl ? ctrl.signal : undefined
		}).then(function (res) {
			return res.json();
		}).then(function (json) {
			if (timer) window.clearTimeout(timer);
			busy(false);
			if (json && json.ok) showDone(data);
			else setError((json && json.error) || 'Something went wrong on our side. Please try again in a minute.');
		}).catch(function () {
			if (timer) window.clearTimeout(timer);
			busy(false);
			// a timeout does not mean it failed: the script keeps going after the page stops waiting
			if (timedOut) setError('This is taking longer than usual, and your registration may already have gone through. Check your inbox (and spam) for our email in the next few minutes before you try again.');
			else setError('We could not reach the registration service. Check your connection and try again' + (fallback ? ', or <a href="' + fallback + '" target="_blank" rel="noopener">use the backup form</a>.' : '.'));
			errBox.innerHTML = errBox.textContent;
		});
	}

})();
