/*
	BreaQ Hackathon: notifications for the team dashboard and the mentor queue (teams.js, mentors.js)
	- asked for on each device by the page's "Notify me" button, and kept there (localStorage)
	- shown while the page is open, also in a background tab; nothing reaches a closed page
	- through the service worker notify-sw.js where the browser has one (Android needs it), else new Notification()
	- iPhones and iPads show web notifications only for a site added to the home screen: elsewhere on them
	  the button stays hidden
*/

(function () {

	'use strict';

	var STORE = 'breaq-2026-notify';
	var reg = null;

	function supported() { return 'Notification' in window; }

	function wanted() {
		try { return window.localStorage.getItem(STORE) === '1'; } catch (e) { return false; }
	}

	function setWanted(on) {
		try {
			if (on) window.localStorage.setItem(STORE, '1');
			else window.localStorage.removeItem(STORE);
		} catch (e) {}
	}

	// on, off, blocked (the browser was told no) or unsupported
	function state() {
		if (!supported()) return 'unsupported';
		if (Notification.permission === 'denied') return 'blocked';
		return wanted() && Notification.permission === 'granted' ? 'on' : 'off';
	}

	// scope: the page's own address ("teams", "mentors"), so the worker covers that page only
	function worker(scope) {
		if (reg || !('serviceWorker' in navigator)) return;
		navigator.serviceWorker.register('notify-sw.js', { scope: scope }).then(function () {
			return navigator.serviceWorker.ready;
		}).then(function (r) { reg = r; }, function () {});
	}

	function enable(scope, done) {
		if (!supported()) { done(state()); return; }
		var finished = false;
		function finish(perm) {
			if (finished) return;
			finished = true;
			setWanted(perm === 'granted');
			if (perm === 'granted') worker(scope);
			done(state());
		}
		var p = Notification.requestPermission(finish);   // older Safari answers through the callback only
		if (p && p.then) p.then(finish, function () { finish('default'); });
	}

	function disable() { setWanted(false); }

	function show(title, body, tag) {
		if (state() !== 'on') return;
		var opts = { body: body || '', icon: 'images/favicon-2026.png', badge: 'images/favicon-2026.png' };
		if (tag) opts.tag = tag;
		function plain() {
			try {
				var n = new Notification(title, opts);
				n.onclick = function () { window.focus(); n.close(); };
			} catch (e) {}   // a phone without the worker: nothing to show it with
		}
		if (reg && reg.showNotification) reg.showNotification(title, opts).then(null, plain);
		else plain();
	}

	window.breaqNotify = {
		state: state,
		enable: enable,
		disable: disable,
		show: show,
		// on a page opened again with notifications on: the worker is there for the first one
		start: function (scope) { if (state() === 'on') worker(scope); }
	};

})();
