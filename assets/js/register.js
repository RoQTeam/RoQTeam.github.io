/*
	BreaQ registration form
	- validates in the browser, posts JSON to the Apps Script endpoint in data-endpoint
	- keeps a draft in localStorage so a reload does not lose the answers
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
	var DRAFT_KEY = 'breaq-2026-registration';

	function forEach(list, fn) { Array.prototype.forEach.call(list, fn); }

	/* --- conditional fields --------------------------------------- */

	function syncConditionals() {
		var attend = form.querySelector('input[name="attend"]:checked');
		var hackathon = !attend || attend.value !== 'presentations';
		forEach(form.querySelectorAll('[data-hack]'), function (el) { el.hidden = !hackathon; });
		var team = form.querySelector('input[name="team"]:checked');
		forEach(form.querySelectorAll('[data-team]'), function (el) { el.hidden = !hackathon || !team || team.value !== 'team'; });
	}

	forEach(form.querySelectorAll('input[name="attend"], input[name="team"]'), function (input) {
		input.addEventListener('change', syncConditionals);
	});

	/* --- draft ------------------------------------------------------ */

	function collect() {
		var data = {};
		forEach(form.elements, function (el) {
			if (!el.name || el.name === 'website') return;
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
			if (!el.name || !(el.name in data) || el.name === 'website') return;
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
			if (el.required && el.type === 'checkbox' && !el.checked) {
				return setError(el.name === 'consent' ? 'We need your agreement to store the registration.' : 'Please confirm the last point too.', el), false;
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
		var ctrl = window.AbortController ? new AbortController() : null;
		var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, 20000) : null;

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
			setError('We could not reach the registration service. Check your connection and try again' + (fallback ? ', or <a href="' + fallback + '" target="_blank" rel="noopener">use the backup form</a>.' : '.'));
			errBox.innerHTML = errBox.textContent;
		});
	});

})();
