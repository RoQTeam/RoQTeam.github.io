/*
	The service worker of the team dashboard (teams.html) and the mentor queue (mentors.html), registered by
	assets/js/notify.js for those two pages only. It shows their notifications (phones need a worker for that) and
	brings the page back when one is tapped. It caches nothing and answers no request: the site works as if it
	were not there.
*/

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (ev) { ev.waitUntil(self.clients.claim()); });

self.addEventListener('notificationclick', function (ev) {
	ev.notification.close();
	var page = self.registration.scope;
	ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
		for (var i = 0; i < list.length; i++) {
			if (list[i].url.indexOf(page) === 0 && 'focus' in list[i]) return list[i].focus();
		}
		return self.clients.openWindow(page);
	}));
});
