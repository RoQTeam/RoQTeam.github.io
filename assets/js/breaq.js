/*
	BreaQ page behaviours: speaker cards, day-by-day schedule, last-edition gallery.
	Plain JS, no dependencies. Loaded after main.js.
*/

(function () {
	'use strict';

	var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;

	function forEach(list, fn) { Array.prototype.forEach.call(list, fn); }
	function pad2(n) { return (n < 10 ? '0' : '') + n; }

	/* ------------------------------------------------------------ */
	/* Background video: only load it where it is worth the bytes    */
	/* ------------------------------------------------------------ */

	var bgVideo = document.querySelector('.video-bg video[data-src]');

	if (bgVideo) {
		var conn = navigator.connection || {};
		var smallScreen = window.matchMedia && window.matchMedia('(max-width: 736px)').matches;
		if (!reduceMotion && !smallScreen && !conn.saveData) {
			var source = document.createElement('source');
			source.src = bgVideo.getAttribute('data-src');
			source.type = 'video/mp4';
			bgVideo.appendChild(source);
			bgVideo.load();
			var playing = bgVideo.play();
			if (playing && playing.catch) playing.catch(function () {});
		}
	}

	/* ------------------------------------------------------------ */
	/* Menu                                                           */
	/* ------------------------------------------------------------ */

	var dropdown = document.querySelector('#header .dropdown');

	if (dropdown) {
		var menuBtn = dropdown.querySelector('.dropbtn');
		var menuPanel = dropdown.querySelector('.dropdown-content');
		var menuLinks = Array.prototype.slice.call(menuPanel.querySelectorAll('a'));

		function setMenu(open) {
			dropdown.classList.toggle('is-open', open);
			menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
		}

		menuBtn.setAttribute('aria-haspopup', 'true');
		setMenu(false);

		menuBtn.addEventListener('click', function (ev) {
			ev.stopPropagation();
			setMenu(!dropdown.classList.contains('is-open'));
		});

		menuPanel.addEventListener('click', function (ev) {
			if (ev.target.closest('a')) setMenu(false);
		});

		document.addEventListener('click', function (ev) {
			if (!ev.target.closest('#header .dropdown')) setMenu(false);
		});

		dropdown.addEventListener('keydown', function (ev) {
			var i = menuLinks.indexOf(document.activeElement);
			if (ev.key === 'Escape') {
				setMenu(false);
				menuBtn.focus();
			} else if (ev.key === 'ArrowDown') {
				ev.preventDefault();
				setMenu(true);
				(menuLinks[i + 1] || menuLinks[0]).focus();
			} else if (ev.key === 'ArrowUp') {
				ev.preventDefault();
				(menuLinks[i - 1] || menuLinks[menuLinks.length - 1]).focus();
			}
		});

		// Scroll-spy: the section on screen gets a dot in the menu.
		var spyLinks = menuLinks.filter(function (a) {
			var h = a.getAttribute('href') || '';
			return h.charAt(0) === '#' && document.getElementById(h.slice(1));
		});
		var spyTick = null;

		function spy() {
			spyTick = null;
			var line = window.scrollY + window.innerHeight * 0.3;
			var current = null;
			spyLinks.forEach(function (a) {
				var sec = document.getElementById(a.getAttribute('href').slice(1));
				var top = sec.getBoundingClientRect().top + window.scrollY;
				if (top <= line) current = a;
			});
			spyLinks.forEach(function (a) { a.classList.toggle('is-current', a === current); });
		}

		window.addEventListener('scroll', function () {
			if (spyTick === null) spyTick = window.requestAnimationFrame(spy);
		}, { passive: true });
		window.addEventListener('load', spy);
		spy();
	}

	/* ------------------------------------------------------------ */
	/* Speakers                                                       */
	/* ------------------------------------------------------------ */

	// Used by both Speakers and the Organizing Committee.
	var cards = document.querySelectorAll('.sp-card');

	forEach(document.querySelectorAll('.sp-grid, .fc-grid'), function (grid) {
		// Staggered entrance once the grid scrolls into view.
		if ('IntersectionObserver' in window) {
			var io = new IntersectionObserver(function (entries) {
				forEach(entries, function (entry) {
					if (entry.isIntersecting) {
						grid.classList.add('is-in');
						io.disconnect();
					}
				});
			}, { rootMargin: '0px 0px -12% 0px' });
			io.observe(grid);
		} else {
			grid.classList.add('is-in');
		}
	});

	if (cards.length) {

		function closeCards(except) {
			forEach(cards, function (card) {
				if (card !== except) card.classList.remove('is-open');
			});
		}

		function toggleCard(card) {
			var open = !card.classList.contains('is-open');
			closeCards(card);
			card.classList.toggle('is-open', open);
		}

		// Touch devices have no hover: a tap opens the card, a second tap closes it.
		// Anywhere else, a click outside the cards closes them.
		document.addEventListener('click', function (ev) {
			var card = ev.target.closest('.sp-card');
			if (!card) { closeCards(null); return; }
			if (ev.target.closest('a') || canHover) return;
			toggleCard(card);
		});

		// Keyboard: Enter / Space toggles, Escape closes.
		document.addEventListener('keydown', function (ev) {
			var card = ev.target.closest('.sp-card');
			if (!card || ev.target !== card) return;
			if (ev.key === 'Enter' || ev.key === ' ') {
				ev.preventDefault();
				toggleCard(card);
			} else if (ev.key === 'Escape') {
				card.classList.remove('is-open');
			}
		});
	}

	/* ------------------------------------------------------------ */
	/* Flip cards (breaq-flip.html): click turns a card, one at a time */
	/* ------------------------------------------------------------ */

	var flips = document.querySelectorAll('.fc');

	if (flips.length) {

		function setFlip(card, on) {
			card.classList.toggle('is-flipped', on);
			card.setAttribute('aria-expanded', on ? 'true' : 'false');
		}

		function flipOnly(card) {
			var on = !card.classList.contains('is-flipped');
			forEach(flips, function (c) { if (c !== card) setFlip(c, false); });
			setFlip(card, on);
		}

		forEach(flips, function (card) { setFlip(card, false); });

		document.addEventListener('click', function (ev) {
			var card = ev.target.closest('.fc');
			if (!card || ev.target.closest('a')) return;
			flipOnly(card);
		});

		document.addEventListener('keydown', function (ev) {
			var card = ev.target.closest('.fc');
			if (!card || ev.target !== card) return;
			if (ev.key === 'Enter' || ev.key === ' ') {
				ev.preventDefault();
				flipOnly(card);
			} else if (ev.key === 'Escape') {
				setFlip(card, false);
			}
		});
	}

	/* ------------------------------------------------------------ */
	/* FAQ                                                            */
	/* ------------------------------------------------------------ */

	forEach(document.querySelectorAll('.faq-item'), function (item) {
		var head = item.querySelector('button.faq-q');
		if (!head) return;
		head.addEventListener('click', function () {
			var open = !item.classList.contains('is-open');
			item.classList.toggle('is-open', open);
			head.setAttribute('aria-expanded', open ? 'true' : 'false');
		});
	});

	/* ------------------------------------------------------------ */
	/* Schedule                                                       */
	/* ------------------------------------------------------------ */

	forEach(document.querySelectorAll('[data-sched]'), function (sched) {

		var strip = sched.querySelector('.sched-tabs');
		var tabs = Array.prototype.slice.call(sched.querySelectorAll('.sched-tab'));
		var panels = tabs.map(function (tab) {
			return document.getElementById(tab.getAttribute('aria-controls'));
		});
		var ink = sched.querySelector('.sched-ink');
		var current = Math.max(0, tabs.findIndex(function (t) { return t.classList.contains('is-active'); }));

		function moveInk(tab) {
			if (!ink || !tab) return;
			ink.style.width = tab.offsetWidth + 'px';
			ink.style.transform = 'translateX(' + tab.offsetLeft + 'px)';
		}

		function revealTab(tab) {
			// Keep the active tab visible when the strip scrolls horizontally.
			if (!strip || strip.scrollWidth <= strip.clientWidth) return;
			var target = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
			strip.scrollTo({ left: Math.max(0, target), behavior: reduceMotion ? 'auto' : 'smooth' });
		}

		function activate(index, focus) {
			if (index < 0 || index >= tabs.length) return;
			current = index;
			tabs.forEach(function (tab, i) {
				var on = i === index;
				var panel = panels[i];
				tab.classList.toggle('is-active', on);
				tab.setAttribute('aria-selected', on ? 'true' : 'false');
				tab.tabIndex = on ? 0 : -1;
				if (!panel) return;
				if (on) {
					panel.hidden = false;
					void panel.offsetWidth; // restart the stagger
					panel.classList.add('is-active');
				} else {
					panel.classList.remove('is-active');
					panel.hidden = true;
				}
			});
			moveInk(tabs[index]);
			revealTab(tabs[index]);
			if (focus) tabs[index].focus({ preventScroll: true });
		}

		tabs.forEach(function (tab, i) {
			tab.addEventListener('click', function () { activate(i); });
			tab.addEventListener('keydown', function (ev) {
				var next = null;
				if (ev.key === 'ArrowRight') next = (i + 1) % tabs.length;
				else if (ev.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
				else if (ev.key === 'Home') next = 0;
				else if (ev.key === 'End') next = tabs.length - 1;
				if (next === null) return;
				ev.preventDefault();
				activate(next, true);
			});
		});

		// Abstracts fold open under their talk.
		forEach(sched.querySelectorAll('.tl-item'), function (item) {
			var head = item.querySelector('button.tl-head');
			if (!head) return;
			head.addEventListener('click', function () {
				var open = !item.classList.contains('is-open');
				item.classList.toggle('is-open', open);
				head.setAttribute('aria-expanded', open ? 'true' : 'false');
			});
		});

		// Deep links (#talk-…): switch day, open the abstract, scroll to it.
		function revealTalk(id, smooth) {
			var item = document.getElementById(id);
			if (!item || !item.classList.contains('tl-item')) return false;
			var panel = item.closest('.sched-panel');
			var index = panels.indexOf(panel);
			if (index < 0) return false;

			activate(index);
			var head = item.querySelector('button.tl-head');
			if (head && !item.classList.contains('is-open')) head.click();

			item.classList.remove('is-hilite');
			void item.offsetWidth;
			item.classList.add('is-hilite');

			window.setTimeout(function () {
				item.scrollIntoView({ behavior: (smooth && !reduceMotion) ? 'smooth' : 'auto', block: 'center' });
			}, 40);
			return true;
		}

		document.addEventListener('click', function (ev) {
			var link = ev.target.closest('a[href^="#talk-"]');
			if (!link) return;
			var id = link.getAttribute('href').slice(1);
			if (revealTalk(id, true)) {
				ev.preventDefault();
				if (history.replaceState) history.replaceState(null, '', '#' + id);
			}
		});

		// "Add to calendar": one .ics per day, built from the timeline itself.
		// Times on the page are Bucharest time (EET, UTC+2 in November).
		function icsEscape(text) {
			return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\s*\n\s*/g, '\\n').trim();
		}

		function icsFold(line) {
			var out = '';
			while (line.length > 72) { out += line.slice(0, 72) + '\r\n '; line = line.slice(72); }
			return out + line;
		}

		function icsStamp(dateStr, hm) {
			var p = dateStr.split('-');
			var t = hm.split(':');
			var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], +t[0] - 2, +t[1]));
			return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + '00Z';
		}

		function itemTimes(item) {
			// Only the time node's own text, not the small label.
			var text = '';
			forEach(item.querySelector('.tl-time').childNodes, function (n) {
				if (n.nodeType === 3) text += n.textContent + ' ';
			});
			return text.match(/\d{1,2}:\d{2}/g) || [];
		}

		function buildIcs(panel) {
			var date = panel.getAttribute('data-date');
			var where = panel.querySelector('.sched-where strong');
			var location = where ? where.textContent.trim() : '';
			var events = [];
			var items = Array.prototype.slice.call(panel.querySelectorAll('.tl-item:not(.tl-break)'));
			var single = panel.getAttribute('data-ics-single');

			if (single && items.length) {
				var first = items[0], last = items[items.length - 1];
				var ft = itemTimes(first), lt = itemTimes(last);
				events.push({
					start: icsStamp(first.getAttribute('data-date') || date, ft[0]),
					end: icsStamp(last.getAttribute('data-date') || date, lt[lt.length - 1]),
					summary: single,
					description: items.map(function (it) {
						return (it.getAttribute('data-date') || date).slice(5) + ' ' + itemTimes(it)[0] + ' ' + it.querySelector('.tl-title').textContent.trim();
					}).join('\n')
				});
			} else {
				items.forEach(function (it) {
					var day = it.getAttribute('data-date') || date;
					var times = itemTimes(it);
					var title = it.querySelector('.tl-title').textContent.trim();
					var who = it.querySelector('.tl-who');
					var abs = it.querySelector('.tl-abs');
					for (var k = 0; k < times.length; k += 2) {
						var start = times[k];
						var end = times[k + 1] || (pad2(+start.split(':')[0]) + ':' + pad2((+start.split(':')[1] + 30) % 60));
						events.push({
							start: icsStamp(day, start),
							end: icsStamp(day, end),
							summary: 'BreaQ: ' + title + (who ? ' (' + who.textContent.trim() + ')' : ''),
							description: abs ? abs.textContent.replace(/\s+/g, ' ').trim() : ''
						});
					}
				});
			}

			var now = new Date();
			var stamp = now.getUTCFullYear() + pad2(now.getUTCMonth() + 1) + pad2(now.getUTCDate()) + 'T' + pad2(now.getUTCHours()) + pad2(now.getUTCMinutes()) + '00Z';
			var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RoQTeam//BreaQ//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
			events.forEach(function (e, i) {
				lines.push('BEGIN:VEVENT');
				lines.push('UID:' + panel.id + '-' + i + '-' + e.start + '@roqteam.github.io');
				lines.push('DTSTAMP:' + stamp);
				lines.push('DTSTART:' + e.start);
				lines.push('DTEND:' + e.end);
				lines.push(icsFold('SUMMARY:' + icsEscape(e.summary)));
				if (location) lines.push(icsFold('LOCATION:' + icsEscape(location)));
				if (e.description) lines.push(icsFold('DESCRIPTION:' + icsEscape(e.description)));
				lines.push('URL:https://roqteam.github.io/breaq.html#schedule');
				lines.push('END:VEVENT');
			});
			lines.push('END:VCALENDAR');
			return lines.join('\r\n') + '\r\n';
		}

		panels.forEach(function (panel, i) {
			var link = panel ? panel.querySelector('[data-ics]') : null;
			if (!link || !panel.getAttribute('data-date')) return;
			link.addEventListener('click', function (ev) {
				ev.preventDefault();
				var blob = new Blob([buildIcs(panel)], { type: 'text/calendar;charset=utf-8' });
				var url = URL.createObjectURL(blob);
				var a = document.createElement('a');
				a.href = url;
				a.download = 'breaq-day-' + (i + 1) + '.ics';
				document.body.appendChild(a);
				a.click();
				a.remove();
				window.setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
			});
		});

		// On an event day, open that day and flag the talk in progress.
		function localIso(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

		function markNow() {
			var now = new Date();
			var today = localIso(now);
			var minutes = now.getHours() * 60 + now.getMinutes();
			forEach(sched.querySelectorAll('.tl-item'), function (item) {
				var panel = item.closest('.sched-panel');
				var day = item.getAttribute('data-date') || (panel && panel.getAttribute('data-date'));
				var times = itemTimes(item);
				var on = false;
				if (day === today) {
					for (var k = 0; k + 1 < times.length; k += 2) {
						var s = times[k].split(':'), e = times[k + 1].split(':');
						var sm = +s[0] * 60 + +s[1], em = +e[0] * 60 + +e[1];
						if (minutes >= sm && minutes < em) on = true;
					}
				}
				item.classList.toggle('is-now', on);
			});
		}

		var todayIso = localIso(new Date());
		var todayIndex = panels.findIndex(function (p) {
			if (!p || !p.getAttribute('data-date')) return false;
			var start = p.getAttribute('data-date');
			var end = p.getAttribute('data-date-end') || start;
			return todayIso >= start && todayIso <= end;
		});
		if (todayIndex >= 0 && location.hash.indexOf('#talk-') !== 0) current = todayIndex;
		markNow();
		window.setInterval(markNow, 60000);

		// Initial state (fonts can shift tab widths, so re-measure after they load).
		activate(current);
		window.addEventListener('resize', function () { moveInk(tabs[current]); });
		window.addEventListener('load', function () { moveInk(tabs[current]); });
		if (document.fonts && document.fonts.ready) {
			document.fonts.ready.then(function () { moveInk(tabs[current]); });
		}

		if (location.hash && location.hash.indexOf('#talk-') === 0) {
			window.setTimeout(function () { revealTalk(location.hash.slice(1), false); }, 120);
		}
	});

	/* ------------------------------------------------------------ */
	/* Gallery                                                        */
	/* ------------------------------------------------------------ */

	forEach(document.querySelectorAll('[data-gal]'), function (gal) {

		var track = gal.querySelector('.gal-track');
		var slides = Array.prototype.slice.call(gal.querySelectorAll('.gal-slide'));
		var cur = gal.querySelector('.gal-cur');
		var total = gal.querySelector('.gal-total');
		var bar = gal.querySelector('.gal-progress i');
		var prev = gal.querySelector('.gal-prev');
		var next = gal.querySelector('.gal-next');
		var count = slides.length;
		var index = 0;
		var paused = false;
		var inView = true;
		var timer = null;
		var settle = null;

		if (!track || !count) return;

		function pad(n) { return (n < 10 ? '0' : '') + n; }

		if (total) total.textContent = pad(count);

		function setCurrent(i) {
			index = i;
			slides.forEach(function (slide, j) { slide.classList.toggle('is-current', j === i); });
			if (cur) cur.textContent = pad(i + 1);
			if (bar) bar.style.transform = 'scaleX(' + ((i + 1) / count) + ')';
		}

		function goTo(i) {
			i = ((i % count) + count) % count;
			track.scrollTo({ left: slides[i].offsetLeft, behavior: reduceMotion ? 'auto' : 'smooth' });
			setCurrent(i);
		}

		// Photos have different widths, so the spacer after the last one is measured.
		function sizeTail() {
			var last = slides[count - 1];
			track.style.setProperty('--gal-tail', Math.max(0, track.clientWidth - last.offsetWidth) + 'px');
		}

		// Once a scroll settles (swipe, keyboard, or a finished goTo), the nearest slide wins.
		function syncFromScroll() {
			settle = null;
			var left = track.scrollLeft;
			var best = 0;
			var bestDist = Infinity;
			slides.forEach(function (slide, j) {
				var d = Math.abs(slide.offsetLeft - left);
				if (d < bestDist) { bestDist = d; best = j; }
			});
			if (best !== index) setCurrent(best);
		}

		track.addEventListener('scroll', function () {
			if (settle) window.clearTimeout(settle);
			settle = window.setTimeout(syncFromScroll, 120);
		}, { passive: true });

		if (prev) prev.addEventListener('click', function () { goTo(index - 1); });
		if (next) next.addEventListener('click', function () { goTo(index + 1); });

		track.addEventListener('keydown', function (ev) {
			if (ev.key === 'ArrowRight') { ev.preventDefault(); goTo(index + 1); }
			else if (ev.key === 'ArrowLeft') { ev.preventDefault(); goTo(index - 1); }
		});

		// Autoplay: gentle, and only while the gallery is on screen and untouched.
		function tick() {
			if (paused || !inView || document.hidden) return;
			goTo(index + 1);
		}

		function startAuto() {
			if (reduceMotion || count < 2 || timer) return;
			timer = window.setInterval(tick, 5000);
		}

		function stopAuto() {
			if (timer) { window.clearInterval(timer); timer = null; }
		}

		gal.addEventListener('mouseenter', function () { paused = true; });
		gal.addEventListener('mouseleave', function () { paused = false; });
		gal.addEventListener('focusin', function () { paused = true; });
		gal.addEventListener('focusout', function () { paused = false; });
		track.addEventListener('touchstart', function () { paused = true; }, { passive: true });
		track.addEventListener('touchend', function () {
			window.setTimeout(function () { paused = false; }, 4000);
		}, { passive: true });

		if ('IntersectionObserver' in window) {
			new IntersectionObserver(function (entries) {
				forEach(entries, function (entry) { inView = entry.isIntersecting; });
			}, { threshold: 0.35 }).observe(gal);
		}

		sizeTail();
		setCurrent(0);
		startAuto();
		window.addEventListener('resize', sizeTail);
		window.addEventListener('load', sizeTail);
		window.addEventListener('pagehide', stopAuto);
	});

})();
