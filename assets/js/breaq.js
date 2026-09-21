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
		// Cards in an .sp-grid--open grid are always open and never toggle.
		document.addEventListener('click', function (ev) {
			var card = ev.target.closest('.sp-card');
			if (!card) { closeCards(null); return; }
			if (ev.target.closest('a') || canHover || card.closest('.sp-grid--open')) return;
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
	/* What's next: countdown to the hackathon, orbit animation       */
	/* ------------------------------------------------------------ */

	// Staged countdown: data-countdown-stages is a JSON list, in order. A stage with "target"
	// counts down to that time; one with "until" shows its label (no digits) until that time;
	// the last stage, with neither, is the message that stays after the event.
	forEach(document.querySelectorAll('[data-countdown-stages]'), function (box) {
		var stages;
		try { stages = JSON.parse(box.getAttribute('data-countdown-stages')); } catch (e) { return; }
		var label = box.querySelector('.next-count-label');
		var digits = box.querySelector('.next-digits');
		var units = {};
		forEach(box.querySelectorAll('[data-unit]'), function (el) { units[el.getAttribute('data-unit')] = el; });

		function show(el, value) {
			var text = String(value);
			if (el.textContent === text) return;
			el.textContent = text;
			el.classList.remove('is-tick');
			void el.offsetWidth;
			el.classList.add('is-tick');
		}

		function current() {
			var now = Date.now();
			for (var i = 0; i < stages.length; i++) {
				var st = stages[i];
				var at = new Date(st.target || st.until || 0).getTime();
				if ((st.target || st.until) && at > now) return st;
			}
			return stages[stages.length - 1];
		}

		function update() {
			var st = current();
			if (label && label.textContent !== st.label) label.textContent = st.label;
			if (!st.target) {
				if (digits) digits.hidden = true;
				return !!st.until;              // keep ticking while a hold stage is running
			}
			if (digits) digits.hidden = false;
			var sec = Math.max(0, Math.floor((new Date(st.target).getTime() - Date.now()) / 1000));
			var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
			if (units.d) show(units.d, d);
			if (units.h) show(units.h, pad2(h));
			if (units.m) show(units.m, pad2(m));
			if (units.s) show(units.s, pad2(s));
			return true;
		}

		if (update()) {
			var timer = window.setInterval(function () { if (!update()) window.clearInterval(timer); }, 1000);
		}
	});

	/* ------------------------------------------------------------ */
	/* Lightbox: carousel slides and gallery tiles open large.        */
	/* A tile with data-video plays that file instead of an image.    */
	/* ------------------------------------------------------------ */

	var lbItems = Array.prototype.slice.call(document.querySelectorAll('.gal-slide, [data-lightbox] figure'));

	if (lbItems.length) {
		var lb = document.createElement('div');
		lb.className = 'lightbox';
		lb.setAttribute('role', 'dialog');
		lb.setAttribute('aria-modal', 'true');
		lb.setAttribute('aria-label', 'Photo viewer');
		lb.hidden = true;
		lb.innerHTML =
			'<button class="lb-close" type="button" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
			'<button class="lb-prev" type="button" aria-label="Previous"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
			'<figure class="lb-figure"><div class="lb-stage"><img alt="" /></div><figcaption></figcaption></figure>' +
			'<button class="lb-next" type="button" aria-label="Next"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>' +
			'<span class="lb-count" aria-live="polite"></span>';
		document.body.appendChild(lb);
		var lbStage = lb.querySelector('.lb-stage'), lbImg = lb.querySelector('img'), lbCap = lb.querySelector('figcaption'), lbCount = lb.querySelector('.lb-count');
		var lbVideo = null, lbIndex = 0, lbOpen = false, lbLast = null;

		function lbSource(item) {
			var img = item.querySelector('img');
			return img ? (img.getAttribute('data-full') || img.currentSrc || img.src) : '';
		}

		function lbStopVideo() {
			if (lbVideo) { lbVideo.pause(); lbVideo.removeAttribute('src'); lbVideo.load(); lbVideo.parentNode.removeChild(lbVideo); lbVideo = null; }
		}

		function lbShow(i) {
			lbIndex = (i + lbItems.length) % lbItems.length;
			var item = lbItems[lbIndex];
			var img = item.querySelector('img');
			var cap = item.querySelector('figcaption');
			var video = item.getAttribute('data-video');
			lbStopVideo();
			lbImg.classList.remove('is-ready');
			if (video) {
				lbImg.hidden = true;
				lbVideo = document.createElement('video');
				lbVideo.setAttribute('controls', ''); lbVideo.setAttribute('playsinline', ''); lbVideo.setAttribute('loop', '');
				lbVideo.muted = true; lbVideo.autoplay = true;
				if (img) lbVideo.poster = img.currentSrc || img.src;
				lbVideo.src = video;
				lbStage.appendChild(lbVideo);
				var p = lbVideo.play(); if (p && p.catch) p.catch(function () {});
			} else {
				lbImg.hidden = false;
				lbImg.onload = function () { lbImg.classList.add('is-ready'); };
				lbImg.src = lbSource(item);
				lbImg.alt = img ? (img.alt || '') : '';
			}
			lbCap.innerHTML = cap ? cap.innerHTML : (item.getAttribute('data-cap') || (img && img.alt) || '');
			lbCount.textContent = (lbIndex + 1) + ' / ' + lbItems.length;
			[lbIndex + 1, lbIndex - 1].forEach(function (j) {
				var n = lbItems[(j + lbItems.length) % lbItems.length];
				if (!n.getAttribute('data-video')) { var pre = new Image(); pre.src = lbSource(n); }
			});
		}

		function lbOpenAt(i, origin) {
			lbLast = origin || document.activeElement;
			lb.hidden = false;
			document.body.classList.add('has-lightbox');
			lbOpen = true;
			lbShow(i);
			window.requestAnimationFrame(function () { lb.classList.add('is-open'); lb.querySelector('.lb-close').focus(); });
		}

		function lbClose() {
			if (!lbOpen) return;
			lbOpen = false;
			lb.classList.remove('is-open');
			document.body.classList.remove('has-lightbox');
			window.setTimeout(function () { if (!lbOpen) { lb.hidden = true; lbImg.removeAttribute('src'); lbStopVideo(); } }, 250);
			if (lbLast && lbLast.focus) lbLast.focus();
		}

		lbItems.forEach(function (item, i) {
			item.classList.add('lb-item');
			if (!item.hasAttribute('tabindex')) item.setAttribute('tabindex', '0');
			if (!item.hasAttribute('role')) item.setAttribute('role', 'button');
			item.addEventListener('click', function (ev) { ev.preventDefault(); lbOpenAt(i, item); });
			item.addEventListener('keydown', function (ev) {
				if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); lbOpenAt(i, item); }
			});
		});

		lb.querySelector('.lb-close').addEventListener('click', lbClose);
		lb.querySelector('.lb-prev').addEventListener('click', function () { lbShow(lbIndex - 1); });
		lb.querySelector('.lb-next').addEventListener('click', function () { lbShow(lbIndex + 1); });
		lb.addEventListener('click', function (ev) { if (ev.target === lb || ev.target === lbStage) lbClose(); });
		document.addEventListener('keydown', function (ev) {
			if (!lbOpen) return;
			if (ev.key === 'Escape') lbClose();
			else if (ev.key === 'ArrowRight') lbShow(lbIndex + 1);
			else if (ev.key === 'ArrowLeft') lbShow(lbIndex - 1);
		});
		var touchX = null;
		lb.addEventListener('touchstart', function (ev) { touchX = ev.touches[0].clientX; }, { passive: true });
		lb.addEventListener('touchend', function (ev) {
			if (touchX === null) return;
			var dx = ev.changedTouches[0].clientX - touchX;
			touchX = null;
			if (Math.abs(dx) > 50) lbShow(lbIndex + (dx < 0 ? 1 : -1));
		}, { passive: true });
	}

	/* ------------------------------------------------------------ */
	/* Motion system (body.page-motion)                               */
	/* ------------------------------------------------------------ */

	if (document.body.classList.contains('page-motion')) {

		var header = document.getElementById('header');
		var progress = document.querySelector('.progress i');
		var motionTick = null;

		var pending = [];   // reveal elements not yet shown; a fallback in case the observer is late

		function onScroll() {
			motionTick = null;
			var y = window.scrollY;
			if (header) header.classList.toggle('is-scrolled', y > 40);
			if (progress) {
				var max = document.documentElement.scrollHeight - window.innerHeight;
				progress.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
			}
			if (pending.length) {
				var limit = window.innerHeight * 0.92;
				pending = pending.filter(function (el) {
					if (el.classList.contains('is-in')) return false;
					if (el.getBoundingClientRect().top < limit) { el.classList.add('is-in'); return false; }
					return true;
				});
			}
		}

		window.addEventListener('scroll', function () {
			if (motionTick === null) motionTick = window.requestAnimationFrame(onScroll);
		}, { passive: true });
		window.addEventListener('resize', onScroll);
		onScroll();

		// Hero drawing leans towards the pointer (hover devices only).
		var hero = document.querySelector('#wrapper > header');
		var art = document.querySelector('.ch-hero-art img');
		if (hero && art && canHover && !reduceMotion) {
			hero.addEventListener('mousemove', function (ev) {
				var r = hero.getBoundingClientRect();
				var dx = (ev.clientX - (r.left + r.width / 2)) / r.width;
				var dy = (ev.clientY - (r.top + r.height / 2)) / r.height;
				art.style.setProperty('--rx', (dx * 14).toFixed(1) + 'deg');
				art.style.setProperty('--ry', (-dy * 10).toFixed(1) + 'deg');
			});
			hero.addEventListener('mouseleave', function () {
				art.style.setProperty('--rx', '0deg');
				art.style.setProperty('--ry', '0deg');
			});
		}

		// Scroll reveals: headings and blocks rise in as they enter; grouped items stagger.
		if (!reduceMotion && 'IntersectionObserver' in window) {
			var revealIO = new IntersectionObserver(function (entries) {
				forEach(entries, function (entry) {
					if (entry.isIntersecting) {
						entry.target.classList.add('is-in');
						revealIO.unobserve(entry.target);
					}
				});
			}, { rootMargin: '0px 0px -8% 0px' });

			function reveal(el, delay) {
				el.setAttribute('data-reveal', '');
				if (delay) el.style.setProperty('--d', delay);
				revealIO.observe(el);
				pending.push(el);
			}

			var singles = ':scope > h3.major, :scope > p, :scope > .button, :scope > a.special, :scope > .sp-hint, :scope > .tier, :scope > .logos-note, :scope > .gal, :scope > h4';
			var groups = ':scope > .glance, :scope > .kit, :scope > .logos, :scope > .venues, :scope > .faq, :scope > .ch-grid, :scope > .next-wrap, :scope > .soon-grid, :scope > .res, :scope > .ch-cols, :scope > .ch-list, :scope > .catalog, :scope > .mosaic';

			forEach(document.querySelectorAll('.wrapper .inner > section'), function (section) {
				// only what is below the first screen: the hero has its own entrance
				if (section.getBoundingClientRect().bottom < window.innerHeight * 0.6 && window.scrollY === 0) return;
				forEach(section.querySelectorAll(singles), function (el) { reveal(el, 0); });
				forEach(section.querySelectorAll(groups), function (box) {
					forEach(box.children, function (child, i) { reveal(child, Math.min(i, 10) * 70); });
				});
			});
		}
	}

	/* ------------------------------------------------------------ */
	/* Chapter strip (album page): highlights the chapter in view     */
	/* ------------------------------------------------------------ */

	var chapNav = document.querySelector('.chap-nav');

	if (chapNav && 'IntersectionObserver' in window) {
		var chapLinks = Array.prototype.slice.call(chapNav.querySelectorAll('a[href^="#"]'));
		var chapIO = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (!entry.isIntersecting) return;
				chapLinks.forEach(function (a) {
					var on = a.getAttribute('href') === '#' + entry.target.id;
					a.classList.toggle('is-current', on);
					if (on && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
				});
			});
		}, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });
		chapLinks.forEach(function (a) {
			var target = document.getElementById(a.getAttribute('href').slice(1));
			if (target) chapIO.observe(target);
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
				lines.push('UID:' + panel.id + '-' + i + '-' + e.start + '@roqteam.ro');
				lines.push('DTSTAMP:' + stamp);
				lines.push('DTSTART:' + e.start);
				lines.push('DTEND:' + e.end);
				lines.push(icsFold('SUMMARY:' + icsEscape(e.summary)));
				if (location) lines.push(icsFold('LOCATION:' + icsEscape(location)));
				if (e.description) lines.push(icsFold('DESCRIPTION:' + icsEscape(e.description)));
				lines.push('URL:https://roqteam.ro/breaq.html#schedule');
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
		var playBtn = gal.querySelector('.gal-play');
		var count = slides.length;
		var index = 0;
		var paused = false;             // a hold: pointer or focus on the photos, tab hidden
		var auto = !reduceMotion && count > 1;   // the slideshow runs when idle; the play/pause button flips this
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

		// While a requested slide is still scrolling into place, the scroll sync below must not
		// pull the index back to whichever slide happens to be nearest mid-way.
		var target = null;
		var targetTimer = null;

		function goTo(i) {
			i = ((i % count) + count) % count;
			target = i;
			if (targetTimer) window.clearTimeout(targetTimer);
			targetTimer = window.setTimeout(function () { target = null; }, 1500);
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
			if (target !== null) {
				if (best === target) { target = null; window.clearTimeout(targetTimer); }
				return;
			}
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
		// Off from the start under reduced motion; the play button can still start it on request.
		function tick() {
			if (paused || !inView || document.hidden) return;
			goTo(index + 1);
		}

		function startAuto() {
			if (!auto || timer) return;
			timer = window.setInterval(tick, 5000);
		}

		function stopAuto() {
			if (timer) { window.clearInterval(timer); timer = null; }
		}

		// Pointer or focus on the photos holds the slideshow; the controls under them do not,
		// so pressing play starts it even though the pointer is still on the button.
		track.addEventListener('mouseenter', function () { paused = true; });
		track.addEventListener('mouseleave', function () { paused = false; });
		track.addEventListener('focusin', function () { paused = true; });
		track.addEventListener('focusout', function () { paused = false; });
		track.addEventListener('touchstart', function () { paused = true; }, { passive: true });
		track.addEventListener('touchend', function () {
			window.setTimeout(function () { paused = false; }, 4000);
		}, { passive: true });

		if (playBtn && count > 1) {
			var syncPlay = function () {
				gal.classList.toggle('is-playing', auto);
				playBtn.setAttribute('aria-label', auto ? 'Pause slideshow' : 'Play slideshow');
			};
			playBtn.addEventListener('click', function () {
				auto = !auto;
				if (auto) { startAuto(); goTo(index + 1); } else { stopAuto(); }
				syncPlay();
			});
			syncPlay();
			playBtn.hidden = false;
		}

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
