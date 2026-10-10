/*
	BreaQ 2026 registrations: the admin page (admin.html)
	- asks for the admin key and posts { action: "list", key } to the Apps Script in data-endpoint
	  (tools/register-backend.gs, the same script the registration forms post to)
	- keeps the key for the tab, or on the device when asked; the registrations stay in memory only
	- counts, registrations per day and breakdowns for the chosen event; the table filters by event and search
	- copies the shown emails, downloads the shown rows as CSV, opens one registration in full
	- the Teams view: who is in which team, each team's challenge, table, pitch and place, who said they are
	  coming ("team-save", "team-delete", "team-assign"; the sheet's "Teams" tab and "Hackathon team" column)
	- the Check-in view, at the door: "checkin" fills the "Checked in" column
	- the Team dashboard view: who can open it, the mentors' link ("mentor-key"), and the announcements, the
	  checklist, the resources, submission and practical details the teams see on teams.html (the "board-…"
	  actions; kept in the sheet's "Team dashboard" tab)
	- the After the event view: the certificates ("certificates") and the feedback sent from the dashboard
*/

(function () {

	'use strict';

	var root = document.getElementById('admin');
	if (!root) return;

	var endpoint = (root.getAttribute('data-endpoint') || '').trim();
	var KEY_STORE = 'breaq-2026-admin-key';
	var DAY_MS = 24 * 60 * 60 * 1000;
	var MAX_DAYS = 92;   // the per-day chart shows at most the last three months

	function $(id) { return document.getElementById(id); }
	function forEach(list, fn) { Array.prototype.forEach.call(list, fn); }

	var state = {
		key: '',
		columns: [],
		records: [],
		sheet: '',
		at: null,
		emailsLeft: null,
		event: 'all',
		query: '',
		problems: false,          // only the registrations with a failed email or letter
		kind: 'all',              // the Who tab: all, teams, solo (hackathon)
		decision: 'any',          // the Decision tab: any, none, accepted, waitlist, denied
		pending: {},              // emails whose decision is being saved
		detail: null,             // the person open in the full view
		sort: { key: 'time', dir: -1 },
		view: 'regs',             // regs, teams, checkin, board (the team dashboard), after
		codes: {},                // email -> team dashboard code, for the accepted
		teams: [],                // the sheet's "Teams" tab: [{ name, challenge, table, pitch, room, award }]
		mentors: null,            // { key, page }: the mentors' link
		feedback: [],             // what the participants answered after the event, without names
		certificate: '',          // the certificate template's link, '' while there is none
		people: [],               // the chosen event's registrations, one entry per person
		shown: []
	};

	/* --- small helpers ---------------------------------------------- */

	// lower case, no diacritics: "Ștefan" is found by "stefan"
	function fold(s) {
		return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
	}

	function el(tag, cls, text) {
		var node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text !== undefined && text !== null) node.textContent = text;
		return node;
	}

	function link(href, text) {
		var a = el('a', null, text);
		a.href = href;
		if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
		return a;
	}

	function isUrl(s) { return /^https?:\/\/\S+$/i.test(s); }

	function pad(n) { return n < 10 ? '0' + n : String(n); }

	function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

	function plural(n, one, many) { return n.toLocaleString('en-GB') + ' ' + (n === 1 ? one : many); }

	var fmtShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	var fmtLong = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	var fmtDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
	var fmtAxis = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
	var fmtClock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

	/* --- the rows ------------------------------------------------------ */

	// "attend" values: hackathon and conference today; presentations and both from the first, single form
	function eventOf(attend) {
		var a = String(attend || '').trim().toLowerCase();
		if (a === 'conference' || a === 'presentations') return 'conference';
		if (a === 'hackathon' || a === 'both') return a;
		return '';
	}

	var EVENT_LABEL = { hackathon: 'Hackathon', conference: 'Conference', both: 'Both', '': '' };

	function inEvent(r, ev) {
		return ev === 'all' || r.event === ev || r.event === 'both';
	}

	// what the "Emails" column says: nothing (registrations from before the column existed), sent, FAILED, or held
	// (none sent, in a flood of registrations)
	function mailOf(text) {
		if (!text) return '';
		if (/failed/i.test(text)) return 'failed';
		return /^emails held/i.test(text) ? 'held' : 'sent';
	}

	function toRecords(columns, rows) {
		return rows.filter(function (row) {
			return row.some(function (v) { return v !== '' && v !== null; });
		}).map(function (row) {
			var v = {};
			columns.forEach(function (c, j) {
				var x = row[j];
				v[c] = x === null || x === undefined ? '' : String(x).trim();
			});
			var time = v['Timestamp'] ? new Date(v['Timestamp']) : null;
			return {
				row: row,
				v: v,
				time: time && !isNaN(time) ? time : null,
				event: eventOf(v['Attends']),
				email: (v['Email'] || '').toLowerCase(),
				name: ((v['First name'] || '') + ' ' + (v['Last name'] || '')).trim(),
				mail: mailOf(v['Emails']),
				// the email did not go out, the motivation letter did not reach Drive, or the same name came with another
				// email (kept apart: the same person, or someone else?)
				problem: mailOf(v['Emails']) === 'failed' || mailOf(v['Emails']) === 'held' || /^upload failed/i.test(v['Motivation letter'] || '') || /^⚠/.test(v['Merged'] || ''),
				text: fold(row.join(' '))
			};
		});
	}

	function get(r, col) { return r.v[col] || ''; }

	// One entry per person: the same email registered for the hackathon and for the conference is one person,
	// counted once in the breakdowns and listed once ("Both") in the table; the full view shows each registration.
	// A person has what a record has (v, name, time, event, org, mail, problem, text), plus regs, newest first.
	function people(rs) {
		var groups = {}, list = [];
		rs.forEach(function (r, i) {
			var k = r.email || '#' + i;   // no email: a row on its own
			if (!groups[k]) list.push(groups[k] = []);
			groups[k].push(r);
		});
		return list.map(person);
	}

	function person(regs) {
		regs = regs.slice().sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
		function first(key) {
			for (var i = 0; i < regs.length; i++) if (regs[i][key]) return regs[i][key];
			return '';
		}
		// each answer from the newest registration that has it
		var v = {};
		state.columns.forEach(function (c) {
			for (var i = 0; i < regs.length; i++) if (regs[i].v[c]) { v[c] = regs[i].v[c]; return; }
		});
		if (regs.length > 1) {
			v['Emails'] = regs.filter(function (r) { return get(r, 'Emails'); }).map(function (r) {
				return (EVENT_LABEL[r.event] || get(r, 'Attends')) + ': ' + get(r, 'Emails');
			}).join(' · ');
		}
		var events = regs.map(function (r) { return r.event; });
		var both = events.indexOf('both') !== -1 || (events.indexOf('hackathon') !== -1 && events.indexOf('conference') !== -1);
		var mails = regs.map(function (r) { return r.mail; });
		return {
			regs: regs,
			v: v,
			email: regs[0].email,
			name: first('name'),
			time: regs[0].time,
			event: both ? 'both' : regs[0].event,
			org: first('org'),
			mail: mails.indexOf('failed') !== -1 ? 'failed' : mails.indexOf('held') !== -1 ? 'held' : mails.indexOf('sent') !== -1 ? 'sent' : '',
			problem: regs.some(function (r) { return r.problem; }),
			text: regs.map(function (r) { return r.text; }).join(' ')
		};
	}

	/* --- decisions and teams (hackathon) ------------------------------------- */

	// the "Decision" column, as tools/register-backend.gs writes it; empty is undecided
	var DECISIONS = ['accepted', 'waitlist', 'denied'];
	var DECISION_VERB = { accepted: 'Accept', waitlist: 'Waitlist', denied: 'Deny' };
	var DECISION_LABEL = { accepted: 'Accepted', waitlist: 'Waitlist', denied: 'Denied', '': 'Undecided' };

	// a person's hackathon registration, the one a decision belongs to (null: only at the conference)
	function hackReg(p) {
		for (var i = 0; i < p.regs.length; i++) if (p.regs[i].event === 'hackathon' || p.regs[i].event === 'both') return p.regs[i];
		return null;
	}

	function decisionOf(r) {
		var d = get(r, 'Decision').toLowerCase();
		return DECISIONS.indexOf(d) !== -1 ? d : '';
	}

	// what the "Decision email" column says went out: { decision, sent }, or null before any
	function emailedOf(r) {
		var m = /^([a-z ]+): (sent|FAILED)/.exec(get(r, 'Decision email'));
		return m ? { decision: m[1], sent: m[2] === 'sent' } : null;
	}

	// as nameKey_ in the Apps Script: "Ana-Maria Popescu" and "POPESCU ana maria" are one name
	function nameKey(s) {
		return fold(s).split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
	}

	// "Ana Popescu, Mihai Ionescu și Ioana Marin" -> the three names, as teammates_ in the Apps Script
	function teammates(text) {
		return String(text || '').split(/\s*[,;\n+&\/]\s*|\s+(?:and|și|si)\s+/i)
			.map(function (s) { return s.trim(); })
			.filter(Boolean);
	}

	// Teams among the hackathon registrations: whoever named someone, or was named, joins them, with the names
	// nobody registered under. Each member's record gets r.team = { id, members, missing }; others get null.
	function buildTeams(records) {
		var hack = records.filter(function (r) { return r.event === 'hackathon' || r.event === 'both'; });
		var byName = {}, up = [], missing = [];
		hack.forEach(function (r, i) {
			r.team = null;
			r.nameKey = nameKey(r.name);
			(byName[r.nameKey] = byName[r.nameKey] || []).push(i);
			up.push(i);
			missing.push([]);
		});
		function root(i) { while (up[i] !== i) i = up[i] = up[up[i]]; return i; }
		hack.forEach(function (r, i) {
			if (get(r, 'Team') !== 'team') return;
			teammates(get(r, 'Team name and members')).forEach(function (n) {
				var k = nameKey(n);
				if (!k || k === r.nameKey) return;
				if (byName[k]) byName[k].forEach(function (j) { up[root(j)] = root(i); });
				else missing[i].push(n);
			});
		});
		var groups = {}, id = 0;
		hack.forEach(function (r, i) { var k = root(i); (groups[k] = groups[k] || []).push(i); });
		Object.keys(groups).forEach(function (k) {
			var idx = groups[k];
			if (idx.length < 2 && get(hack[idx[0]], 'Team') !== 'team') return;
			var team = { id: ++id, members: [], missing: [] }, seen = {};
			idx.forEach(function (i) {
				team.members.push(hack[i]);
				hack[i].team = team;
				missing[i].forEach(function (n) {
					var nk = nameKey(n);
					if (!seen[nk]) { seen[nk] = true; team.missing.push(n); }
				});
			});
		});
	}

	/* --- one name for each university or company ------------------------- */

	// "University Politehinca Bucharest (UNSTPB)", "UNTSPB" and "Universitatea Națională de Știință și Tehnologie
	// POLITEHNICA București" are one university. Known ones go by the rules in INSTITUTIONS; anything else counts
	// once however it is capitalised, and a typo away from a more common spelling counts under that one. The table
	// and the breakdown show the merged name; the full registration shows what the person wrote.

	// Damerau-Levenshtein (optimal string alignment): letters added, dropped, changed or swapped
	function distance(a, b) {
		var d = [], i, j;
		for (i = 0; i <= a.length; i++) d[i] = [i];
		for (j = 1; j <= b.length; j++) d[0][j] = j;
		for (i = 1; i <= a.length; i++) {
			for (j = 1; j <= b.length; j++) {
				d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
				if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
			}
		}
		return d[a.length][b.length];
	}

	// words written in English, abbreviated or misspelt, and the one form the rules look for
	var WORDS = {
		politehnica: ['politehnica', 'polytechnic', 'politechnica', 'politecnica', 'polytechnica', 'polytehnica'],
		universitatea: ['universitatea', 'university', 'universitate', 'universitatii', 'univ'],
		bucuresti: ['bucuresti', 'bucharest', 'bucurest', 'bucarest'],
		timisoara: ['timisoara'],
		unstpb: ['unstpb'],
		sfantul: ['sfantul', 'sf'],                     // high schools: "C.N. Sf. Sava" is "Colegiul Național Sfântul Sava"
		'colegiul national': ['cn']
	};

	function word(t) {
		for (var canon in WORDS) {
			var forms = WORDS[canon];
			for (var i = 0; i < forms.length; i++) {
				var f = forms[i];
				if (t === f) return canon;
				// a typo: one letter off (two in a long word), never a different word such as "polytechnique"
				if (t.length >= 5 && Math.abs(t.length - f.length) <= 1 && distance(t, f) <= (f.length >= 9 ? 2 : 1)) return canon;
			}
		}
		return t;
	}

	// lower case, no diacritics or punctuation, the words above in their one form
	function words(s) {
		return fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map(word).join(' ');
	}

	// in order: the specific before the general (Politehnica Timișoara before Politehnica, ASE before "Bucharest University")
	var INSTITUTIONS = [
		['Universitatea Politehnica Timișoara (UPT)', /\bupt\b|\bpolitehnica\b.*\btimisoara\b|\btimisoara\b.*\bpolitehnica\b/],
		['Universitatea Tehnică „Gheorghe Asachi” din Iași (TUIASI)', /\btuiasi\b|gheorghe asachi|\bpolitehnica\b.*\biasi\b|\biasi\b.*\bpolitehnica\b/],
		['Universitatea Tehnică din Cluj-Napoca (UTCN)', /\butcn\b|universitatea tehnica (din )?cluj|technical universitatea (of )?cluj|\bpolitehnica\b.*\bcluj\b/],
		['ASE București', /\base\b|academia de studii economice|economic studies/],
		['UMF „Carol Davila” București', /carol davila/],
		['SNSPA', /\bsnspa\b|studii politice|political studies/],
		['POLITEHNICA București (UNSTPB)', /\b(unstpb|upb|acs|etti|fils|faima|fiir)\b|\bpolitehnica\b|nationala de stiinta si tehnologie|national universitatea of science and technology/],
		['Universitatea din București (UB)', /\b(ub|unibuc)\b|universitatea (din |of )?bucuresti|bucuresti universitatea/],
		['Academia Tehnică Militară „Ferdinand I” (ATM)', /\b(atm|mta)\b|academia tehnica militara|military technical academy/],
		['Universitatea Babeș-Bolyai (UBB)', /\bubb\b|babes bolyai/],
		['Universitatea „Alexandru Ioan Cuza” din Iași (UAIC)', /\buaic\b|alexandru ioan cuza/],
		['Universitatea de Vest din Timișoara (UVT)', /\buvt\b|universitatea de vest|west universitatea/],
		['Universitatea din Craiova', /\bucv\b|universitatea (din |of )?craiova|craiova universitatea/],
		['Universitatea Transilvania din Brașov', /\bunitbv\b|universitatea transilvania|transilvania universitatea/],
		['Universitatea Ovidius din Constanța', /\bovidius\b/],
		['Universitatea Tehnică de Construcții București (UTCB)', /\butcb\b|constructii bucuresti|civil engineering bucuresti/],
		['Universitatea „Lucian Blaga” din Sibiu', /\bulbs\b|lucian blaga/],
		['Universitatea „Ștefan cel Mare” din Suceava', /\busv\b|stefan cel mare/],
		['Universitatea „Dunărea de Jos” din Galați', /dunarea de jos/],
		['Universitatea Româno-Americană', /romano americana|romanian american/],
		['Universitatea Titu Maiorescu', /titu maiorescu/],
		['IFIN-HH', /\bifin\b|horia hulubei/],
		['ELI-NP', /\beli ?np\b|extreme light/],
		['INFLPR', /\binflpr\b|fizica laserilor|lasers plasma and radiation/]
	];

	// a high school named after someone ("Colegiul Național Alexandru Ioan Cuza") is not that person's university
	var SCHOOL = /\b(liceul|liceu|colegiul|colegiu|high ?school|lyceum)\b|\bscoala\b(?! nationala de studii)/;

	function institution(raw) {
		var s = words(raw);
		if (SCHOOL.test(s)) return '';
		for (var i = 0; i < INSTITUTIONS.length; i++) {
			if (INSTITUTIONS[i][1].test(s)) return INSTITUTIONS[i][0];
		}
		return '';
	}

	// anything else: "Bitdefender", "bitdefender SRL" and "Bitdefender Romania" are one company
	function orgKey(raw) {
		var s = words(raw);
		return s.replace(/\b(s r l|srl|s a|ltd|inc|gmbh|llc|romania)\b/g, ' ').replace(/\s+/g, ' ').trim() || s;
	}

	// a typo apart: one letter in a short name, two in a long one; numbers must match ("Liceul 1" is not "Liceul 2")
	function typoApart(a, b) {
		var n = Math.min(a.length, b.length);
		var most = n >= 12 ? 2 : n >= 6 ? 1 : 0;
		if (!most || Math.abs(a.length - b.length) > most) return false;
		if (a.replace(/\D/g, '') !== b.replace(/\D/g, '')) return false;
		return distance(a, b) <= most;
	}

	// sets r.org on every record: the merged name, or '' when the question was not answered
	function groupOrgs(records) {
		var keys = {};
		records.forEach(function (r) {
			var raw = get(r, 'University or company');
			r.org = raw ? institution(raw) : '';
			r.orgKey = raw && !r.org ? orgKey(raw) : '';
			if (!r.orgKey) {
				if (raw && !r.org) r.org = raw;   // nothing but punctuation ("-"): kept as written
				return;
			}
			var k = keys[r.orgKey] || (keys[r.orgKey] = { n: 0, spellings: {} });
			k.n++;
			k.spellings[raw] = (k.spellings[raw] || 0) + 1;
		});

		// the most common spelling leads; a key a typo away from one before it joins that one
		var order = Object.keys(keys).sort(function (a, b) { return keys[b].n - keys[a].n || a.localeCompare(b); });
		var leads = [], into = {};
		order.forEach(function (k) {
			var lead = leads.filter(function (l) { return typoApart(k, l); })[0];
			if (lead) into[k] = lead;
			else { into[k] = k; leads.push(k); }
		});

		var name = {};
		leads.forEach(function (lead) {
			var counts = {};
			order.forEach(function (k) {
				if (into[k] !== lead) return;
				Object.keys(keys[k].spellings).forEach(function (sp) { counts[sp] = (counts[sp] || 0) + keys[k].spellings[sp]; });
			});
			// a tie goes to the shorter spelling: "Bitdefender" over "Bitdefender SRL"
			name[lead] = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.length - b.length; })[0];
		});

		records.forEach(function (r) {
			if (r.orgKey) r.org = name[into[r.orgKey]];
			if (r.org) r.text += ' ' + fold(r.org);   // a search for "politehnica" finds "UNTSPB" too
		});
	}

	/* --- the key and the request -------------------------------------- */

	function storedKey() {
		try { return window.sessionStorage.getItem(KEY_STORE) || window.localStorage.getItem(KEY_STORE) || ''; }
		catch (e) { return ''; }
	}

	function storeKey(key, remember) {
		try {
			window.sessionStorage.setItem(KEY_STORE, key);
			if (remember) window.localStorage.setItem(KEY_STORE, key);
			else window.localStorage.removeItem(KEY_STORE);
		} catch (e) {}
	}

	function forgetKey() {
		try { window.sessionStorage.removeItem(KEY_STORE); window.localStorage.removeItem(KEY_STORE); } catch (e) {}
	}

	function remembered() {
		try { return !!window.localStorage.getItem(KEY_STORE); } catch (e) { return false; }
	}

	// Apps Script can take 10-15 s to wake up: a minute in all, as on the registration forms. Now and then Google
	// answers with an HTML error page instead of the data (a hiccup, a time-out on its side): a second or third
	// try usually goes through, so the page tries three times before it says so.
	function load(key, done) {
		var started = Date.now();
		var tries = 0;

		function again(json, err) {
			if (tries < 3 && Date.now() - started < 40000) window.setTimeout(attempt, tries * 1500);
			else done(json, err);
		}

		function attempt() {
			tries++;
			var ctrl = window.AbortController ? new AbortController() : null;
			var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, Math.max(10000, 60000 - (Date.now() - started))) : null;
			window.fetch(endpoint, {
				method: 'POST',
				body: JSON.stringify({ action: 'list', key: key }),   // a string body: no CORS preflight against Apps Script
				cache: 'no-store',
				signal: ctrl ? ctrl.signal : undefined
			}).then(function (res) {
				return res.text();
			}).then(function (text) {
				if (timer) window.clearTimeout(timer);
				var json = null;
				try { json = JSON.parse(text); } catch (e) {}
				if (!json) return again(null, { name: 'NotData', detail: pageText(text) });
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

	// the words of Google's error page, which usually say what went wrong ("Exceeded maximum execution time"…)
	function pageText(html) {
		try {
			var doc = new DOMParser().parseFromString(String(html), 'text/html');   // parsed, never run or shown
			var text = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim();
			return text.length > 220 ? text.slice(0, 220) + '…' : text;
		} catch (e) {
			return '';
		}
	}

	// one request to the Apps Script, without the list's retries: a decision or a send is never repeated by itself
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
			done(json, json ? null : { name: 'NotData', detail: pageText(text) });
		}).catch(function (err) {
			if (timer) window.clearTimeout(timer);
			done(null, err);
		});
	}

	// why a decision or a send did not go through; an answer without "action" comes from a script older than the page
	function actionProblem(json, err, what) {
		if (json && json.action && json.error) return json.error;
		if (json) return 'The Apps Script cannot ' + what + ' yet: paste tools/register-backend.gs into the editor, then Deploy → Manage deployments → pencil → Version: New version → Deploy.';
		if (err && err.name === 'AbortError') return 'The Apps Script took too long to answer.';
		if (err && err.name === 'NotData') return 'Google sent back an error page' + (err.detail ? ': “' + err.detail + '”.' : '.');
		return 'Could not reach the Apps Script. Check the connection.';
	}

	function loaded(json) { return !!(json && json.ok && json.columns && json.rows); }

	function problem(json, err) {
		if (json && json.denied) return json.error || 'That key is not right.';
		if (json && json.temporary) return json.error + ' The page tried three times. Try again in a minute; if it keeps failing, the Executions page of the Apps Script editor shows why.';
		// the deployed script is older than the admin page: it reads the request as a registration
		if (json) return 'The Apps Script does not answer the admin page yet: paste tools/register-backend.gs into the editor, then Deploy → Manage deployments → pencil → Version: New version → Deploy.';
		if (err && err.name === 'AbortError') return 'The sheet took more than a minute to answer. Try again.';
		if (err && err.name === 'NotData') return 'Google sent back an error page instead of the data, three times in a row' + (err.detail ? ': “' + err.detail + '”.' : '.') + ' Try again in a minute; if it keeps failing, the Executions page of the Apps Script editor shows why.';
		return 'Could not reach the Apps Script. Check the connection and try again.';
	}

	/* --- lock ------------------------------------------------------------ */

	var lockForm = $('lock-form');
	var keyInput = $('key');
	var lockBtn = $('lock-btn');
	var lockErr = $('lock-err');

	function lockBusy(on) {
		lockBtn.disabled = on;
		lockBtn.classList.toggle('is-busy', on);
		lockBtn.textContent = on ? 'Reading the sheet…' : 'Open';
	}

	function lockError(msg) {
		lockErr.textContent = msg || '';
		lockErr.hidden = !msg;
	}

	function unlock(key, remember) {
		lockError('');
		lockBusy(true);
		load(key, function (json, err) {
			lockBusy(false);
			if (loaded(json)) {
				state.key = key;
				storeKey(key, remember);
				keyInput.value = '';
				show(json);
				return;
			}
			if (json && json.denied) forgetKey();
			lockError(problem(json, err));
			keyInput.focus();
		});
	}

	// back to the key, and the registrations out of memory and off the page
	function lock(msg) {
		forgetKey();
		state.key = '';
		state.records = [];
		state.people = [];
		state.shown = [];
		state.pending = {};
		state.detail = null;
		if ($('detail').open) $('detail').close();
		if ($('send-dlg').open) $('send-dlg').close();
		forEach(['tiles', 'days', 'breakdowns'], function (id) { $(id).textContent = ''; });
		$('people').tBodies[0].textContent = '';
		$('search').value = '';
		state.query = '';
		state.problems = false;
		board.loaded = false;
		board.items = [];
		board.busy = {};
		state.codes = {};
		state.teams = [];
		state.mentors = null;
		state.feedback = [];
		teamsUi.editing = null;
		forEach(['board-list', 'teams-list', 'loose', 'checkin-list', 'cert-result', 'fb-best', 'fb-change'], function (id) { $(id).textContent = ''; });
		$('checkin-search').value = '';
		checkinUi.query = '';
		resetForm();
		setView('regs');
		$('dash').hidden = true;
		$('lock').hidden = false;
		lockError(msg || '');
		keyInput.focus();
	}

	lockForm.addEventListener('submit', function (ev) {
		ev.preventDefault();
		// an empty field after a failed start (no connection, say) retries with the key already kept
		var key = keyInput.value.trim() || storedKey();
		if (!key) { lockError('Paste the admin key first.'); keyInput.focus(); return; }
		unlock(key, $('remember').checked);
	});

	$('lock-now').addEventListener('click', function () { lock(''); });

	/* --- dashboard -------------------------------------------------------- */

	var refreshBtn = $('refresh');

	function dashError(msg) {
		$('dash-err').textContent = msg || '';
		$('dash-err').hidden = !msg;
	}

	function refresh() {
		refreshBtn.disabled = true;
		refreshBtn.classList.add('is-busy');
		refreshBtn.textContent = 'Reading…';
		load(state.key, function (json, err) {
			refreshBtn.disabled = false;
			refreshBtn.classList.remove('is-busy');
			refreshBtn.textContent = 'Refresh';
			if (loaded(json)) { dashError(''); show(json); return; }
			if (json && json.denied) { lock(json.error); return; }   // the key was changed in the meantime
			dashError(problem(json, err));
		});
	}

	refreshBtn.addEventListener('click', function () {
		if (state.view !== 'board') { refresh(); return; }   // the Teams, Check-in and After views come with the list
		refreshBtn.disabled = true;
		refreshBtn.textContent = 'Reading…';
		loadBoard(function () {
			refreshBtn.disabled = false;
			refreshBtn.textContent = 'Refresh';
		});
	});

	function show(json) {
		state.columns = json.columns.map(function (c) { return String(c).trim(); });
		state.records = toRecords(state.columns, json.rows);
		groupOrgs(state.records);
		buildTeams(state.records);
		state.sheet = json.sheet || '';
		state.codes = json.codes || {};   // the dashboard code of each accepted participant, by email
		state.teams = json.teams || [];
		state.mentors = json.mentors || null;
		state.feedback = json.feedback || [];
		state.certificate = json.certificate || '';
		state.at = json.at ? new Date(json.at) : new Date();
		state.emailsLeft = typeof json.emailsLeft === 'number' ? json.emailsLeft : null;
		$('lock').hidden = true;
		$('dash').hidden = false;
		renderMeta();
		renderTiles();
		renderEvent();
		renderView();
	}

	function renderMeta() {
		var parts = ['Updated ' + fmtClock.format(state.at)];
		if (state.emailsLeft !== null) parts.push(plural(state.emailsLeft, 'email', 'emails') + ' left today');
		$('meta').textContent = parts.join(' · ');
		var sheet = $('sheet-link');
		sheet.hidden = !isUrl(state.sheet);
		if (!sheet.hidden) sheet.href = state.sheet;
	}

	// everything that follows the event switch: the chart, the breakdowns and the table
	function renderEvent() {
		var rs = state.records.filter(function (r) { return inEvent(r, state.event); });
		state.people = people(rs);
		renderDays(rs);                    // registrations per day: each registration
		renderBreakdowns(state.people);    // what people answered: each person once
		renderTable();
		renderSendPanel();
	}

	/* --- tiles ------------------------------------------------------------ */

	function renderTiles() {
		var rs = state.records;
		var since = Date.now() - DAY_MS;
		var everyone = people(rs);
		var problems = everyone.filter(function (p) { return p.problem; }).length;
		var recent = 0, hack = 0, conf = 0;
		rs.forEach(function (r) {
			if (r.time && r.time.getTime() > since) recent++;
			if (inEvent(r, 'hackathon')) hack++;
			if (inEvent(r, 'conference')) conf++;
		});

		var box = $('tiles');
		box.textContent = '';
		[
			['Registrations', rs.length],
			['Hackathon', hack],
			['Conference', conf],
			['People', everyone.length, 'Each person once, also when registered for both events'],
			['Last 24 hours', recent]
		].forEach(function (t) {
			var tile = el('div', 'tile');
			tile.appendChild(el('span', 'tile-label', t[0]));
			tile.appendChild(el('span', 'tile-value', t[1].toLocaleString('en-GB')));
			if (t[2]) tile.title = t[2];
			box.appendChild(tile);
		});

		// problems: a button that shows only those rows (and back); quiet when there are none
		var tile = el(problems ? 'button' : 'div', 'tile' + (problems ? ' tile--bad' : ''));
		tile.appendChild(el('span', 'tile-label', (problems ? '⚠ ' : '') + 'Problems'));
		tile.appendChild(el('span', 'tile-value', String(problems)));
		if (problems) {
			tile.type = 'button';
			tile.id = 'problems';
			tile.title = 'Registrations whose emails failed or were held, whose motivation letter failed, or with the same name as another registration and another email (⚠ in Merged): click to list only them';
			tile.setAttribute('aria-pressed', String(state.problems));
			tile.addEventListener('click', function () {
				state.problems = !state.problems;
				tile.setAttribute('aria-pressed', String(state.problems));
				if (state.problems && state.event !== 'all') setEvent('all');
				else renderTable();
				if (state.problems) $('people-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
			});
		} else {
			state.problems = false;
		}
		box.appendChild(tile);
	}

	/* --- event switch and search ----------------------------------------- */

	function setEvent(ev) {
		state.event = ev;
		forEach($('f-event').querySelectorAll('button'), function (b) {
			b.setAttribute('aria-pressed', String(b.getAttribute('data-event') === ev));
		});
		renderEvent();
	}

	forEach($('f-event').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () { setEvent(b.getAttribute('data-event')); });
	});

	// the Who and Decision tabs above the table
	forEach($('f-kind').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () { state.kind = b.getAttribute('data-kind'); renderTable(); });
	});

	forEach($('f-decision').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () { state.decision = b.getAttribute('data-decision'); renderTable(); });
	});

	$('search').addEventListener('input', function () {
		state.query = fold(this.value).trim();
		renderTable();
	});

	/* --- registrations per day ------------------------------------------ */

	var tip = $('tip');

	function showTip(target, text) {
		tip.textContent = text;
		tip.hidden = false;
		var r = target.getBoundingClientRect();
		var w = tip.offsetWidth;
		var x = Math.min(Math.max(r.left + r.width / 2, w / 2 + 8), window.innerWidth - w / 2 - 8);
		tip.style.left = x + 'px';
		tip.style.top = (r.top - 8) + 'px';
	}

	function hideTip() { tip.hidden = true; }

	window.addEventListener('scroll', hideTip, { passive: true });

	function renderDays(rs) {
		var box = $('days');
		box.textContent = '';
		var times = rs.filter(function (r) { return r.time; }).map(function (r) { return r.time; });
		if (!times.length) {
			box.appendChild(el('p', 'muted', 'No registrations yet.'));
			return;
		}

		var counts = {};
		times.forEach(function (t) { var k = dayKey(t); counts[k] = (counts[k] || 0) + 1; });

		// every day from the first registration to today, so quiet days show as gaps
		var first = new Date(Math.min.apply(null, times));
		var last = new Date(Math.max(Date.now(), Math.max.apply(null, times)));
		var day = new Date(first.getFullYear(), first.getMonth(), first.getDate());
		var end = new Date(last.getFullYear(), last.getMonth(), last.getDate());
		var days = [];
		while (day <= end) {
			days.push({ date: new Date(day), n: counts[dayKey(day)] || 0 });
			day.setDate(day.getDate() + 1);
		}
		var cut = days.length > MAX_DAYS;
		if (cut) days = days.slice(-MAX_DAYS);

		var max = 0, peak = 0;
		days.forEach(function (d, i) { if (d.n >= max) { max = d.n; peak = i; } });

		var plot = el('div', 'days-plot');
		plot.setAttribute('role', 'img');
		plot.setAttribute('aria-label', plural(times.length, 'registration', 'registrations') + ' over ' + plural(days.length, 'day', 'days') +
			'; the most on ' + fmtDay.format(days[peak].date) + ': ' + max + '.');
		days.forEach(function (d, i) {
			var col = el('div', 'day');
			var bar = el('div', 'day-bar');
			bar.style.height = (max ? d.n / max * 100 : 0) + '%';
			if (!d.n) bar.classList.add('is-zero');
			col.appendChild(bar);
			if (i === peak && max) {
				var label = el('span', 'day-peak', String(max));
				label.style.bottom = (d.n / max * 100) + '%';
				col.appendChild(label);
			}
			var text = fmtDay.format(d.date) + ' · ' + plural(d.n, 'registration', 'registrations');
			col.addEventListener('mouseenter', function () { showTip(col, text); });
			col.addEventListener('mouseleave', hideTip);
			plot.appendChild(col);
		});
		box.appendChild(plot);

		var axis = el('div', 'days-axis');
		axis.appendChild(el('span', null, fmtAxis.format(days[0].date) + (cut ? ' (last ' + MAX_DAYS + ' days)' : '')));
		axis.appendChild(el('span', null, days.length > 1 ? fmtAxis.format(days[days.length - 1].date) : ''));
		box.appendChild(axis);
	}

	/* --- breakdowns ------------------------------------------------------ */

	// the hackathon form's team question, as stored in the "Team" column
	var TEAM_LABEL = { solo: 'On my own', team: 'With a team' };

	function teamOf(r) {
		var t = get(r, 'Team');
		if (t === 'team') return 'With ' + (get(r, 'Team name and members') || 'a team');
		return TEAM_LABEL[t] || t;
	}

	// the forms' own order for the answers they offer; free text sorts by count
	var BREAKDOWNS = [
		{ col: 'Status', title: 'You are', order: ['High-school student', 'Bachelor student', 'Master student', 'PhD student', 'Researcher', 'Working in industry', 'Other'] },
		{ col: 'Experience', title: 'Experience', order: ['None yet, curious', 'Beginner: a course or some tutorials', 'Intermediate: built circuits or small projects', 'Advanced: research or work in the field'], short: true },
		{ col: 'Tracks', title: 'Tracks', order: ['Quantum Foundations', 'Quantum AI', 'Quantum Hacking', 'Not sure yet'], multi: true },
		{ col: 'T-shirt', title: 'T-shirts', order: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
		// asked only with the Quantum AI track (the first form asked everyone, so earlier answers are left out)
		{ col: 'Team', title: 'Quantum AI', labels: TEAM_LABEL, order: [TEAM_LABEL.solo, TEAM_LABEL.team],
			only: function (r) { return /quantum ai/i.test(get(r, 'Tracks')); } },
		{ col: 'University or company', title: 'University or company', top: 8, merged: true },
		{ col: 'Heard from', title: 'Heard about BreaQ from' }
	];

	// items: { label, n, spellings: { as written: n } }; for a merged column the label is the merged name (groupOrgs)
	function tally(rs, b) {
		var groups = {};
		rs.forEach(function (r) {
			var raw = get(r, b.col);
			if (!raw || (b.only && !b.only(r))) return;
			(b.multi ? raw.split(/\s*,\s*/) : [raw]).forEach(function (val) {
				if (!val) return;
				var label = b.merged ? r.org : (b.labels && b.labels[val]) || val;
				var k = fold(label).replace(/\s+/g, ' ');
				var g = groups[k] || (groups[k] = { label: label, n: 0, spellings: {} });
				g.n++;
				g.spellings[val] = (g.spellings[val] || 0) + 1;
			});
		});
		var items = Object.keys(groups).map(function (k) { return groups[k]; });
		if (b.order) {
			var at = function (it) { var i = b.order.indexOf(it.label); return i === -1 ? b.order.length : i; };
			items.sort(function (x, y) { return at(x) - at(y) || y.n - x.n; });
		} else {
			items.sort(function (x, y) { return y.n - x.n || x.label.localeCompare(y.label); });
		}
		if (b.top && items.length > b.top + 1) {
			var rest = items.slice(b.top);
			items = items.slice(0, b.top);
			items.push({ label: plural(rest.length, 'other', 'others'), n: rest.reduce(function (s, it) { return s + it.n; }, 0), other: true, members: rest });
		}
		return items;
	}

	function countedList(entries) {
		var ul = el('ul');
		entries.forEach(function (e) {
			var li = el('li');
			li.appendChild(el('span', null, e[0]));
			li.appendChild(el('span', 'n', String(e[1])));
			ul.appendChild(li);
		});
		return ul;
	}

	// how the people behind a merged name wrote it: one other way inline, several behind a toggle
	function mergedFrom(it) {
		var spellings = Object.keys(it.spellings).sort(function (a, b) { return it.spellings[b] - it.spellings[a] || a.localeCompare(b); });
		if (spellings.length === 1) return el('p', 'merged', 'Written as “' + spellings[0] + '”');
		var box = el('details', 'merged');
		box.appendChild(el('summary', null, 'Merged from ' + spellings.length + ' spellings'));
		box.appendChild(countedList(spellings.map(function (sp) { return [sp, it.spellings[sp]]; })));
		return box;
	}

	function theOthers(members) {
		var box = el('details', 'merged');
		box.appendChild(el('summary', null, 'Show them'));
		box.appendChild(countedList(members.map(function (m) { return [m.label, m.n]; })));
		return box;
	}

	function renderBreakdowns(rs) {
		var box = $('breakdowns');
		box.textContent = '';

		BREAKDOWNS.forEach(function (b) {
			var items = tally(rs, b);
			if (!items.length) return;
			var answered = rs.filter(function (r) { return get(r, b.col) && (!b.only || b.only(r)); }).length;
			var max = Math.max.apply(null, items.map(function (it) { return it.n; }));

			var panel = el('section', 'panel bd');
			var h = el('h2', null, b.title);
			h.appendChild(el('span', 'count', answered + ' answered'));
			panel.appendChild(h);
			var list = el('ul', 'bars');
			items.forEach(function (it) {
				var li = el('li', it.other ? 'is-other' : null);
				var label = b.short ? it.label.split(':')[0] : it.label;
				var name = el('span', 'bar-label', label);
				if (label !== it.label) name.title = it.label;
				li.appendChild(name);
				var value = el('span', 'bar-value', String(it.n));
				value.appendChild(el('small', null, Math.round(it.n / answered * 100) + '%'));
				li.appendChild(value);
				var track = el('span', 'bar-track');
				var fill = el('span', 'bar-fill');
				fill.style.width = (it.n / max * 100) + '%';
				track.appendChild(fill);
				li.appendChild(track);
				if (b.merged && !it.other) {
					var spellings = Object.keys(it.spellings);
					if (spellings.length > 1 || spellings[0] !== it.label) li.appendChild(mergedFrom(it));
				}
				if (it.other) li.appendChild(theOthers(it.members));
				list.appendChild(li);
			});
			panel.appendChild(list);
			box.appendChild(panel);
		});

		// dietary needs: free text the caterer needs word for word, with whose it is
		var diet = rs.filter(function (r) { return get(r, 'Dietary'); });
		if (diet.length) {
			var panel = el('section', 'panel bd');
			var h = el('h2', null, 'Dietary needs');
			h.appendChild(el('span', 'count', String(diet.length)));
			panel.appendChild(h);
			var list = el('ul', 'diet');
			diet.forEach(function (r) {
				var li = el('li');
				li.appendChild(el('span', 'diet-what', get(r, 'Dietary')));
				li.appendChild(el('span', 'diet-who', r.name));
				list.appendChild(li);
			});
			panel.appendChild(list);
			box.appendChild(panel);
		}
	}

	/* --- the table -------------------------------------------------------- */

	function cellText(text, cls) { var td = el('td', cls, text); return td; }

	var COLUMNS = [
		// on a phone the decision buttons need the room more than the date
		{ key: 'time', label: 'Registered', always: true, cls: 'c-time hide-sm',
			sort: function (r) { return r.time ? r.time.getTime() : 0; },
			cell: function (r) {
				var td = cellText(r.time ? fmtShort.format(r.time) : get(r, 'Timestamp'), 'c-time hide-sm');
				if (r.regs.length > 1) td.title = r.regs.map(function (x) { return EVENT_LABEL[x.event] + ': ' + (x.time ? fmtShort.format(x.time) : ''); }).join(' · ');
				return td;
			} },
		{ key: 'name', label: 'Name', always: true,
			sort: function (r) { return fold(get(r, 'Last name') + ' ' + get(r, 'First name')); },
			cell: function (r, i) {
				var td = el('td', 'c-name');
				var b = el('button', 'name-btn', r.name || '(no name)');
				b.type = 'button';
				b.setAttribute('data-i', i);
				td.appendChild(b);
				return td;
			} },
		// the hackathon decision: undecided first when sorted
		{ key: 'decision', label: 'Decision', always: true,
			when: function () { return state.event !== 'conference'; },
			sort: function (r) { var h = hackReg(r); return h ? DECISIONS.indexOf(decisionOf(h)) + 1 : 9; },
			cell: function (r) {
				var td = el('td', 'c-decision');
				var h = hackReg(r);
				if (h) td.appendChild(decisionControl([h], r.name || 'this person'));
				return td;
			} },
		{ key: 'email', label: 'Email', always: true, sort: function (r) { return r.email; },
			cell: function (r) { return cellText(get(r, 'Email'), 'c-email'); } },
		{ key: 'event', label: 'Event', when: function () { return state.event === 'all'; },
			sort: function (r) { return r.event; },
			cell: function (r) { return cellText(EVENT_LABEL[r.event] || get(r, 'Attends'), 'c-event'); } },
		{ key: 'aff', label: 'University or company', col: 'University or company', cls: 'hide-sm',
			sort: function (r) { return fold(r.org); },
			cell: function (r) {
				var td = cellText(r.org, 'hide-sm');
				if (r.org !== get(r, 'University or company')) td.title = 'Written as “' + get(r, 'University or company') + '”';
				return td;
			} },
		{ key: 'status', label: 'Status', col: 'Status', cls: 'hide-md' },
		{ key: 'exp', label: 'Experience', col: 'Experience', cls: 'hide-md',
			cell: function (r) { var td = cellText(get(r, 'Experience').split(':')[0], 'hide-md'); td.title = get(r, 'Experience'); return td; } },
		{ key: 'tshirt', label: 'T-shirt', col: 'T-shirt', cls: 'hide-sm' },
		{ key: 'team', label: 'Team', col: 'Team', cls: 'hide-md',
			sort: function (r) { return fold(teamOf(r)); },
			cell: function (r) { return cellText(teamOf(r), 'hide-md c-team'); } },
		// the hackathon itself, once there is something in these: the team they are in, their "are you coming?"
		{ key: 'hteam', label: 'In team', col: 'Hackathon team', cls: 'hide-md' },
		{ key: 'coming', label: 'Coming', col: 'Coming', cls: 'hide-sm',
			sort: function (r) { var h = hackReg(r); return h ? ['yes', '', 'no'].indexOf(comingOf(h)) : 9; },
			cell: function (r) {
				var td = el('td', 'hide-sm');
				var h = hackReg(r);
				if (h && decisionOf(h) === 'accepted') td.appendChild(comingTag(h));
				return td;
			} },
		{ key: 'letter', label: 'Letter', col: 'Motivation letter', cls: 'hide-sm',
			cell: function (r) {
				var v = get(r, 'Motivation letter'), td = el('td', 'hide-sm');
				if (isUrl(v)) td.appendChild(link(v, 'PDF'));
				else if (v) { td.appendChild(el('span', 'bad', '✕ Failed')); td.title = v; }
				return td;
			} },
		{ key: 'mail', label: 'Emails', always: true, sort: function (r) { return r.mail; },
			cell: function (r) {
				var td = el('td', 'c-mail');
				if (r.mail === 'failed') td.appendChild(el('span', 'bad', '✕ Failed'));
				else if (r.mail === 'held') td.appendChild(el('span', 'held', '– Held'));
				else if (r.mail === 'sent') td.appendChild(el('span', 'ok', '✓ Sent'));
				else td.appendChild(el('span', 'muted', '—'));
				if (get(r, 'Emails')) td.title = get(r, 'Emails');
				return td;
			} }
	];

	function inTabsFiltered() { return state.event !== 'conference' && (state.kind !== 'all' || state.decision !== 'any'); }

	function teamsView() { return state.kind === 'teams' && state.event !== 'conference'; }

	// the Who and Decision tabs are about the hackathon: any other choice than All and Any leaves out people
	// who are only at the conference
	function inTabs(p) {
		if (state.event === 'conference' || (state.kind === 'all' && state.decision === 'any')) return true;
		var h = hackReg(p);
		if (!h) return false;
		if (state.kind === 'teams' && !h.team) return false;
		if (state.kind === 'solo' && h.team) return false;
		return state.decision === 'any' || decisionOf(h) === (state.decision === 'none' ? '' : state.decision);
	}

	function visible() {
		var q = state.query;
		var rs = state.people.filter(function (p) {
			return (!q || p.text.indexOf(q) !== -1) && (!state.problems || p.problem) && inTabs(p);
		});
		var c = COLUMNS.filter(function (col) { return col.key === state.sort.key; })[0];
		var by = c.sort || function (r) { return fold(get(r, c.col)); };
		var dir = state.sort.dir;
		rs.sort(function (a, b) {
			var x = by(a), y = by(b);
			return (x < y ? -1 : x > y ? 1 : 0) * dir || (b.time || 0) - (a.time || 0);
		});
		if (!teamsView()) return rs;
		// teammates together, each team where its first member falls in the sort
		var at = {}, groups = [];
		rs.forEach(function (p) {
			var id = hackReg(p).team.id;
			if (!at[id]) groups.push(at[id] = []);
			at[id].push(p);
		});
		return [].concat.apply([], groups);
	}

	function renderTable() {
		var rs = visible();
		state.shown = rs;

		// a column shows when it applies and someone answered it (no T-shirts in the conference view)
		var cols = COLUMNS.filter(function (c) {
			if (c.when && !c.when()) return false;
			if (c.always || !c.col) return true;
			return rs.some(function (r) { return get(r, c.col); });
		});

		var table = $('people');
		var headRow = el('tr');
		cols.forEach(function (c) {
			var th = el('th', c.cls || null);
			var b = el('button', 'sort-btn', c.label);
			b.type = 'button';
			b.setAttribute('data-sort', c.key);
			if (state.sort.key === c.key) th.setAttribute('aria-sort', state.sort.dir > 0 ? 'ascending' : 'descending');
			th.appendChild(b);
			headRow.appendChild(th);
		});
		table.tHead.textContent = '';
		table.tHead.appendChild(headRow);

		var body = document.createDocumentFragment();
		var lastTeam = null;
		rs.forEach(function (r, i) {
			if (teamsView() && hackReg(r).team !== lastTeam) {
				lastTeam = hackReg(r).team;
				body.appendChild(teamRow(lastTeam, cols));
			}
			var tr = el('tr');
			tr.setAttribute('data-i', i);
			cols.forEach(function (c) {
				tr.appendChild(c.cell ? c.cell(r, i) : cellText(get(r, c.col), c.cls || null));
			});
			body.appendChild(tr);
		});
		table.tBodies[0].textContent = '';
		table.tBodies[0].appendChild(body);

		var total = state.people.length;
		var teams = {};
		if (teamsView()) rs.forEach(function (p) { teams[hackReg(p).team.id] = true; });
		$('shown').textContent = (rs.length === total ? String(total) : rs.length + ' of ' + total) +
			(teamsView() ? ' in ' + plural(Object.keys(teams).length, 'team', 'teams') : '') +
			(state.problems ? ' · problems only' : '');
		$('empty').hidden = rs.length > 0;
		$('copy-emails').disabled = $('download').disabled = !rs.length;
		renderTabs();
	}

	// the Who and Decision tabs, with how many people each holds (the decisions within the Who tab chosen)
	function renderTabs() {
		$('filters').hidden = state.event === 'conference';
		if (state.event === 'conference') return;
		var counts = { all: state.people.length, teams: 0, solo: 0, none: 0, accepted: 0, waitlist: 0, denied: 0 };
		state.people.forEach(function (p) {
			var h = hackReg(p);
			if (!h) return;
			var kind = h.team ? 'teams' : 'solo';
			counts[kind]++;
			if (state.kind === 'all' || state.kind === kind) counts[decisionOf(h) || 'none']++;
		});
		forEach($('f-kind').querySelectorAll('button'), function (b) {
			var k = b.getAttribute('data-kind');
			b.setAttribute('aria-pressed', String(k === state.kind));
			b.querySelector('.n').textContent = counts[k];
		});
		forEach($('f-decision').querySelectorAll('button'), function (b) {
			var d = b.getAttribute('data-decision');
			var n = b.querySelector('.n');
			b.setAttribute('aria-pressed', String(d === state.decision));
			if (n) n.textContent = counts[d];
		});
	}

	// the Teams tab: a row above each team's members, with the decision for all of them at once in the Decision
	// column, and who is in it after
	function teamRow(team, cols) {
		var tr = el('tr', 'team-row');
		var at = cols.map(function (c) { return c.key; }).indexOf('decision');
		var size = team.members.length + team.missing.length;
		// one cell per column before the decision, so a column hidden on a small screen is hidden here too
		cols.slice(0, at).forEach(function (c, j) {
			var td = el('td', c.cls || null);
			if (j === at - 1) td.appendChild(el('span', 'team-size', 'Team of ' + size));
			tr.appendChild(td);
		});
		var mid = el('td', 'c-decision');
		mid.appendChild(decisionControl(team.members, 'the whole team'));
		var rest = el('td');
		rest.colSpan = cols.length - at - 1;
		var info = el('div', 'team-info');
		info.appendChild(el('span', 'team-names', team.members.map(function (r) { return r.name; }).join(', ')));
		if (team.missing.length) info.appendChild(el('span', 'team-warn', '⚠ Not registered: ' + team.missing.join(', ')));
		if (size > 3) info.appendChild(el('span', 'team-warn', '⚠ Over 3 people'));
		rest.appendChild(info);
		tr.appendChild(mid);
		tr.appendChild(rest);
		return tr;
	}

	$('people').tHead.addEventListener('click', function (ev) {
		var b = ev.target.closest('[data-sort]');
		if (!b) return;
		var key = b.getAttribute('data-sort');
		// a new column starts with the newest or A to Z; a second click turns it round
		state.sort = state.sort.key === key ? { key: key, dir: -state.sort.dir } : { key: key, dir: key === 'time' ? -1 : 1 };
		renderTable();
	});

	$('people').tBodies[0].addEventListener('click', function (ev) {
		if (ev.target.closest('a')) return;
		var tr = ev.target.closest('tr[data-i]');
		if (tr) openDetail(state.shown[+tr.getAttribute('data-i')]);
	});

	/* --- one registration in full ------------------------------------------- */

	var dialog = $('detail');

	function openDetail(p) {
		if (!p) return;
		renderDetail(p);
		if (typeof dialog.showModal === 'function') dialog.showModal();
		else dialog.setAttribute('open', '');
	}

	function renderDetail(p) {
		state.detail = p;
		renderDetailDecision(p);
		$('detail-name').textContent = p.name || '(no name)';
		$('detail-event').textContent = p.event === 'both' ? 'Hackathon + Conference' : EVENT_LABEL[p.event] || get(p, 'Attends');
		var box = $('detail-fields');
		box.textContent = '';
		p.regs.forEach(function (r) {
			if (p.regs.length > 1) box.appendChild(el('h3', null, (EVENT_LABEL[r.event] || get(r, 'Attends')) + ' registration'));
			box.appendChild(fields(r));
		});
	}

	// the hackathon decision at the top of the full view, with the team it goes with
	function renderDetailDecision(p) {
		var box = $('detail-decision');
		var h = hackReg(p);
		box.textContent = '';
		box.hidden = !h;
		if (!h) return;
		box.appendChild(el('span', 'detail-decision-label', 'Hackathon decision'));
		box.appendChild(decisionControl([h], p.name || 'this person'));
		if (h.team) {
			var mates = h.team.members.filter(function (m) { return m !== h; }).map(function (m) { return m.name; })
				.concat(h.team.missing.map(function (n) { return n + ' (not registered)'; }));
			if (mates.length) box.appendChild(el('p', 'detail-team', 'Team with ' + mates.join(', ')));
		}
		if (decisionOf(h) === 'accepted') box.appendChild(dashboardLine(h));
	}

	// an accepted participant's team dashboard code, to read out or send again
	function dashboardLine(h) {
		var line = el('p', 'detail-code');
		var code = state.codes[h.email];
		if (!code) {
			line.textContent = 'Their team dashboard code shows after a Refresh.';
			return line;
		}
		line.appendChild(document.createTextNode('Team dashboard code '));
		line.appendChild(el('code', 'code-small', code));
		var copy = el('button', 'btn small ghost', 'Copy their link');
		copy.type = 'button';
		copy.addEventListener('click', function () {
			copyText(teamsLink(code), function (ok) { copy.textContent = ok ? 'Copied' : 'Could not copy'; });
		});
		line.appendChild(copy);
		return line;
	}

	// one registration, every answer it has
	function fields(r) {
		var dl = el('dl');
		state.columns.forEach(function (col) {
			var v = get(r, col);
			if (!v || col === 'First name' || col === 'Last name') return;
			var dd = el('dd');
			if (col === 'Timestamp' && r.time) dd.textContent = fmtLong.format(r.time);
			else if ((col === 'Coming answered' || col === 'Checked in') && !isNaN(new Date(v))) dd.textContent = fmtLong.format(new Date(v));
			else if (col === 'Email' && /^[^\s@?&#]+@[^\s@?&#]+$/.test(v)) dd.appendChild(link('mailto:' + v, v));
			else if (col === 'Phone') dd.appendChild(link('tel:' + v.replace(/[^\d+]/g, ''), v));
			else if (col === 'Motivation letter' && isUrl(v)) dd.appendChild(link(v, 'Open the PDF in Drive'));
			else if (col === 'Emails' && r.mail === 'failed') { dd.textContent = v; dd.className = 'bad'; }
			else if (col === 'Emails' && r.mail === 'held') { dd.textContent = v; dd.className = 'held'; }
			else if (col === 'Merged' && /^⚠/.test(v)) { dd.textContent = v; dd.className = 'held'; }
			else if (col === 'Team') dd.textContent = TEAM_LABEL[v] || v;
			else if (isUrl(v)) dd.appendChild(link(v, v));
			else dd.textContent = col === 'Seconds on page' ? v + ' s' : v;
			if (col === 'University or company' && r.org && r.org !== v) dd.appendChild(el('span', 'counted', 'Counted as ' + r.org));
			if (col === 'Motivation' || col === 'Team name and members' || col === 'Merged') dd.classList.add('long');
			dl.appendChild(el('dt', null, col));
			dl.appendChild(dd);
		});
		return dl;
	}

	function closeDetail() {
		state.detail = null;
		if (typeof dialog.close === 'function') dialog.close();
		else dialog.removeAttribute('open');
	}

	/* --- decisions -------------------------------------------------------------- */

	// Accept, Waitlist and Deny for one registration or a whole team; pressing the chosen one again takes it back
	function decisionControl(regs, who) {
		var ds = regs.map(decisionOf);
		var current = ds.every(function (d) { return d === ds[0]; }) ? ds[0] : null;   // null: a team decided differently
		var saving = regs.some(function (r) { return state.pending[r.email]; });
		var box = el('div', 'dec-box');
		var group = el('div', 'dec' + (saving ? ' is-saving' : ''));
		group.setAttribute('role', 'group');
		group.setAttribute('aria-label', 'Decision for ' + who);
		group.setAttribute('data-key', regs.map(function (r) { return r.email; }).join(' '));
		if (saving) group.setAttribute('aria-busy', 'true');
		DECISIONS.forEach(function (d) {
			var b = el('button', 'dec-' + d, DECISION_VERB[d]);
			b.type = 'button';
			b.setAttribute('data-d', d);
			b.setAttribute('aria-pressed', String(current === d));
			if (saving) b.setAttribute('aria-disabled', 'true');   // not disabled: the focus stays on it
			group.appendChild(b);
		});
		group.addEventListener('click', function (ev) {
			ev.stopPropagation();   // a click here does not open the registration
			var b = ev.target.closest('button[data-d]');
			if (!b || saving) return;
			var d = b.getAttribute('data-d');
			setDecision(regs, current === d ? '' : d);
		});
		box.appendChild(group);
		var note = decisionNote(regs, current);
		if (note) box.appendChild(note);
		return box;
	}

	// what went out: emailed, failed, or emailed a decision that has changed since (the next send emails the new one)
	function decisionNote(regs, current) {
		var ds = regs.map(decisionOf);
		if (current === null) return el('span', 'dec-note warn', (ds.indexOf('') !== -1 ? 'Not everyone decided yet' : 'Decided differently') + ': no emails');
		var mails = regs.map(emailedOf);
		var sent = mails.filter(function (m) { return m && m.sent && m.decision === current; }).length;
		var failed = mails.some(function (m) { return m && !m.sent && m.decision === current; });
		var stale = mails.filter(function (m) { return m && m.sent && m.decision !== current; });
		if (failed) return el('span', 'dec-note bad', '✕ Email failed');
		if (stale.length) return el('span', 'dec-note warn', regs.length > 1 ? 'Emailed before a change' : 'Emailed “' + (DECISION_LABEL[stale[0].decision] || stale[0].decision) + '” before');
		if (current && sent === regs.length) return el('span', 'dec-note ok', '✓ Emailed');
		if (current && sent) return el('span', 'dec-note ok', sent + ' of ' + regs.length + ' emailed');
		return null;
	}

	function setLocal(r, d) {
		r.v['Decision'] = d;
		var j = state.columns.indexOf('Decision');
		if (j !== -1) r.row[j] = d;
	}

	// shows the decision at once and saves it in the sheet; put back as it was if the save fails
	function setDecision(regs, d) {
		// someone already emailed another decision hears again at the next send (taken back: not at all), so ask
		var told = regs.filter(function (r) { var m = emailedOf(r); return m && m.sent && m.decision !== d; });
		if (told.length) {
			var was = emailedOf(told[0]).decision;
			var q = (regs.length > 1 ? told.length + ' of them were' : (told[0].name || 'This person') + ' was') +
				' already emailed “' + (DECISION_LABEL[was] || was) + '”. ' +
				(d ? 'Change to ' + DECISION_LABEL[d] + '? The next send emails the new decision.'
					: 'Take the decision back? No email goes out about that: tell them yourself.');
			if (!window.confirm(q)) return;
		}
		var before = regs.map(function (r) { return get(r, 'Decision'); });
		regs.forEach(function (r) { setLocal(r, d); state.pending[r.email] = true; });
		refreshDecisions();
		post({ action: 'decide', key: state.key, emails: regs.map(function (r) { return r.email; }), decision: d }, 60000, function (json, err) {
			regs.forEach(function (r) { delete state.pending[r.email]; });
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.action === 'decide') {
				var missing = json.missing || [];
				regs.forEach(function (r, i) { if (missing.indexOf(r.email) !== -1) setLocal(r, before[i]); });
				dashError(missing.length ? 'Not saved, as the sheet has no hackathon registration for ' + missing.join(', ') + ' any more. Refresh the page.' : '');
			} else {
				regs.forEach(function (r, i) { setLocal(r, before[i]); });
				dashError('The decision was not saved. ' + actionProblem(json, err, 'save decisions'));
			}
			refreshDecisions();
		});
	}

	// after a decision: the table and its tabs, the send panel and the open registration, with the focus kept on
	// the button that was pressed
	function refreshDecisions() {
		var a = document.activeElement;
		var g = a && a.closest ? a.closest('.dec') : null;
		var keep = g ? { key: g.getAttribute('data-key'), d: a.getAttribute('data-d'), scope: a.closest('dialog') || $('people') } : null;
		renderTable();
		renderSendPanel();
		if (dialog.open && state.detail) renderDetail(state.detail);
		if (!keep) return;
		forEach(keep.scope.querySelectorAll('.dec'), function (box) {
			if (box.getAttribute('data-key') !== keep.key) return;
			var b = box.querySelector('[data-d="' + keep.d + '"]');
			if (b) b.focus();
		});
	}

	/* --- decision emails ---------------------------------------------------------- */

	// registration closes at the end of 18 October (as on breaq-hackathon.html)
	var CLOSES = new Date('2026-10-19T00:00:00+03:00').getTime();

	var sendDlg = $('send-dlg');
	var sendBody = $('send-body');
	var sendGo = $('send-go');

	// what the decisions add up to and how many emails are due; the Apps Script has the last word when Send is
	// pressed (a team still being decided waits)
	function renderSendPanel() {
		$('send-panel').hidden = state.event === 'conference';
		var c = { accepted: 0, waitlist: 0, denied: 0, '': 0 }, due = 0, done = 0, held = 0;
		state.records.forEach(function (r) {
			if (r.event !== 'hackathon' && r.event !== 'both') return;
			var d = decisionOf(r);
			c[d]++;
			if (!d) return;
			var m = emailedOf(r);
			if (m && m.sent && m.decision === d) done++;
			else if (r.team && r.team.members.some(function (t) { return decisionOf(t) !== d; })) held++;
			else due++;
		});
		$('send-status').textContent = c.accepted + ' accepted · ' + c.waitlist + ' waitlist · ' + c.denied + ' denied · ' + c[''] + ' undecided — ' +
			(due ? plural(due, 'email', 'emails') + ' to send' : 'nothing to send') + (done ? ', ' + done + ' sent' : '') +
			(held ? ', ' + held + ' held back (team not all decided the same)' : '');
		$('send-open').disabled = !due;
	}

	function byStatus(items, status) {
		return items.filter(function (it) { return it.status === status; });
	}

	function sendLine(cls, text) { sendBody.appendChild(el('p', cls, text)); }

	function sendList(title, items, help) {
		if (!items.length) return;
		var box = el('div', 'send-list');
		box.appendChild(el('h3', null, title + ' · ' + items.length));
		if (help) box.appendChild(el('p', 'muted', help));
		var ul = el('ul');
		items.forEach(function (it) {
			var li = el('li');
			li.appendChild(el('span', 'send-who', it.name + ' · ' + (DECISION_LABEL[it.decision] || it.decision)));
			if (it.note) li.appendChild(el('span', 'send-note', it.note));
			ul.appendChild(li);
		});
		box.appendChild(ul);
		sendBody.appendChild(box);
	}

	function openSend() {
		sendBody.textContent = '';
		sendLine('muted', 'Checking who gets what…');
		sendGo.hidden = true;
		if (typeof sendDlg.showModal === 'function') sendDlg.showModal();
		else sendDlg.setAttribute('open', '');
		post({ action: 'decisions', key: state.key, send: false }, 60000, function (json, err) {
			if (json && json.ok && json.action === 'decisions') preview(json);
			else sendFailed(json, err, false);
		});
	}

	// before sending: how many emails of each kind, what waits, what to check
	function preview(json) {
		var items = json.items || [];
		var due = byStatus(items, 'to send');
		var held = byStatus(items, 'held');
		var can = typeof json.emailsLeft === 'number' ? Math.max(0, json.emailsLeft - json.reserve) : due.length;
		sendBody.textContent = '';
		if (due.length) {
			var per = {};
			due.forEach(function (it) { per[it.decision] = (per[it.decision] || 0) + 1; });
			sendLine('send-big', plural(due.length, 'email', 'emails') + ' to send');
			sendLine('muted', DECISIONS.filter(function (d) { return per[d]; }).map(function (d) { return per[d] + ' ' + DECISION_LABEL[d].toLowerCase(); }).join(' · '));
			if (can < due.length) {
				// the Apps Script sends the accepted first, then the waiting list, then the denied
				var today = [], later = [], room = can;
				DECISIONS.forEach(function (d) {
					if (!per[d]) return;
					var now = Math.min(per[d], room);
					room -= now;
					if (now) today.push((now === per[d] ? 'all ' : now + ' of the ') + per[d] + ' ' + DECISION_LABEL[d].toLowerCase());
					if (per[d] - now) later.push(per[d] - now + ' ' + DECISION_LABEL[d].toLowerCase());
				});
				sendLine('send-warn', 'Google allows ' + json.emailsLeft + ' more emails today' + (json.reserve ? ' and ' + json.reserve + ' stay free for new registrations' : '') + ', so ' +
					(can ? 'today: ' + today.join(', ') + '. Press Send again tomorrow for the other ' + (due.length - can) + ' (' + later.join(', ') + ').'
						: 'none can go out today. Try again tomorrow.'));
			}
			if (Date.now() < CLOSES) sendLine('send-warn', 'Registration is open until 18 October at 23:59. Anyone who registers after this send needs a decision and another send.');
		} else {
			sendLine('send-big', 'Nothing to send');
			sendLine('muted', held.length ? 'Everyone else with a decision has had their email.' : 'Everyone with a decision has had their email.');
		}
		sendList('Held back: team not all decided the same', held, 'No one in a team is emailed until every registered teammate has the same decision.');
		sendList('To check', items.filter(function (it) { return it.warn && (it.status === 'to send' || it.status === 'skipped'); }),
			'These go out as they are. A team email names only the teammates who registered.');
		var before = byStatus(items, 'sent before').length;
		if (before) sendLine('muted', plural(before, 'person has', 'people have') + ' had their email already and will not get it again.');
		sendGo.hidden = !due.length || !can;
		sendGo.disabled = false;
		sendGo.textContent = 'Send ' + plural(Math.min(due.length, can), 'email', 'emails');
	}

	sendGo.addEventListener('click', function () {
		sendGo.disabled = true;
		sendGo.classList.add('is-busy');
		sendGo.textContent = 'Sending…';
		sendLine('muted', 'Sending. This can take a few minutes; the page waits for the Apps Script to finish.');
		// Apps Script stops a run after 6 minutes, and the script stops sending well before that
		post({ action: 'decisions', key: state.key, send: true }, 6.5 * 60 * 1000, function (json, err) {
			sendGo.classList.remove('is-busy');
			sendGo.hidden = true;
			if (json && json.ok && json.action === 'decisions') sent(json);
			else sendFailed(json, err, true);
			if (!(json && json.denied)) refresh();
		});
	});

	function sent(json) {
		var items = json.items || [];
		var done = byStatus(items, 'sent');
		var left = byStatus(items, 'to send').length;
		sendBody.textContent = '';
		sendLine('send-big', done.length ? plural(done.length, 'email', 'emails') + ' sent' : 'No email sent');
		if (json.stopped === 'quota') sendLine('send-warn', (json.reserve ? 'Stopped with ' + json.reserve + ' of today’s emails left for new registrations.' : 'Today’s emails are used up.') + ' Press Send tomorrow for the other ' + left + '.');
		if (json.stopped === 'time') sendLine('send-warn', 'Stopped before the Apps Script’s time limit. Press Send again for the other ' + left + '.');
		sendList('Failed', byStatus(items, 'failed'), 'The next send tries them again.');
		sendList('Held back: team not all decided the same', byStatus(items, 'held'), 'No one in a team is emailed until every registered teammate has the same decision.');
	}

	function sendFailed(json, err, sending) {
		if (json && json.denied) { closeSend(); lock(json.error); return; }
		sendBody.textContent = '';
		var msg = actionProblem(json, err, 'send decision emails');
		if (sending && !(json && json.action)) msg += ' Some emails may have gone out: the table shows who was emailed once the page has refreshed.';
		sendLine('err', msg);
		sendGo.hidden = true;
	}

	function closeSend() {
		if (typeof sendDlg.close === 'function') sendDlg.close();
		else sendDlg.removeAttribute('open');
	}

	$('send-open').addEventListener('click', openSend);
	$('send-close').addEventListener('click', closeSend);
	sendDlg.addEventListener('click', function (ev) { if (ev.target === sendDlg) closeSend(); });

	$('detail-close').addEventListener('click', closeDetail);
	// a click on the backdrop lands on the dialog itself
	dialog.addEventListener('click', function (ev) { if (ev.target === dialog) closeDetail(); });

	/* --- copy emails, download CSV ------------------------------------------ */

	var copiedTimer = null;

	function note(msg) {
		$('copied').textContent = msg;
		window.clearTimeout(copiedTimer);
		copiedTimer = window.setTimeout(function () { $('copied').textContent = ''; }, 4000);
	}

	function copyText(text, done) {
		if (navigator.clipboard && window.isSecureContext) {
			navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
		} else {
			done(fallbackCopy(text));
		}
	}

	function fallbackCopy(text) {
		var ta = el('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.className = 'offscreen';
		document.body.appendChild(ta);
		ta.select();
		var ok = false;
		try { ok = document.execCommand('copy'); } catch (e) {}
		document.body.removeChild(ta);
		return ok;
	}

	// ready to paste into Bcc
	$('copy-emails').addEventListener('click', function () {
		var seen = {}, list = [];
		state.shown.forEach(function (r) {
			if (r.email && !seen[r.email]) { seen[r.email] = true; list.push(r.email); }
		});
		copyText(list.join(', '), function (ok) {
			note(ok ? 'Copied ' + plural(list.length, 'address', 'addresses') : 'Could not copy: your browser blocked it');
		});
	});

	function csvCell(v) {
		var s = v === null || v === undefined ? '' : String(v);
		if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s;   // so Excel or Sheets never runs a registrant's text as a formula
		return '"' + s.replace(/"/g, '""') + '"';
	}

	function csvTime(d) {
		return dayKey(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
	}

	// the registrations of the people the table shows, in its order, with every column of the sheet: someone
	// registered for both events has two rows, as in the sheet
	$('download').addEventListener('click', function () {
		var t = state.columns.indexOf('Timestamp');
		var lines = [state.columns.map(csvCell).join(',')];
		state.shown.forEach(function (p) {
			p.regs.forEach(function (r) {
				lines.push(state.columns.map(function (col, j) {
					return csvCell(j === t && r.time ? csvTime(r.time) : r.row[j]);
				}).join(','));
			});
		});
		// the byte-order mark makes Excel read ă, î, ș, ț right
		var blob = new Blob(['\ufeff' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
		var a = el('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'breaq-2026-registrations-' + (state.event === 'all' ? 'all' : state.event) + (state.query || state.problems || inTabsFiltered() ? '-filtered' : '') + '-' + dayKey(new Date()) + '.csv';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
		note('Downloaded ' + plural(lines.length - 1, 'registration', 'registrations'));
	});

	/* --- the team dashboard (teams.html): the code and what the teams see ------ */

	var TEAMS_PAGE = 'https://roqteam.ro/teams';
	var BOARD_SECTIONS = ['announcement', 'resource', 'checklist', 'submission', 'practical'];
	var BOARD_LABEL = { announcement: 'Announcements', resource: 'Challenge resources', checklist: 'Before you come (checklist)', submission: 'Submission', practical: 'Practical info' };
	var BOARD_HELP = {
		announcement: 'The feed: newest first, pinned ones on top. The dashboard checks every minute, so it shows within a minute.',
		resource: 'Starter kits, repositories, datasets, docs: under one challenge, or above all three.',
		checklist: 'One thing to do before the day each (install this, make that account, pack a charger): the teams tick them off. For every challenge, or one; a team with a challenge sees only its own and the common ones.',
		submission: 'How and where to hand in, next to the countdown to 09:00 on Sunday.',
		practical: 'Wi-Fi, Discord, the room, who to ask for help.'
	};

	var board = {
		loaded: false,
		loading: false,
		items: [],
		page: TEAMS_PAGE,
		section: 'announcement',   // what the form posts
		editing: null,             // the id of the item in the form, or null for a new one
		busy: {}                   // ids being saved or deleted
	};

	var VIEWS = ['regs', 'teams', 'checkin', 'board', 'after'];

	function setView(view) {
		state.view = view;
		VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== view; });
		forEach($('f-view').querySelectorAll('button'), function (b) {
			b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
		});
		renderView();
		if (view === 'board' && !board.loaded && !board.loading) loadBoard();
		if (view === 'checkin' && window.matchMedia('(min-width: 601px)').matches) $('checkin-search').focus();
	}

	// the view shown, drawn from the registrations as they are now
	function renderView() {
		if (state.view === 'teams') renderTeams();
		else if (state.view === 'checkin') renderCheckin();
		else if (state.view === 'board') { renderBoardAccess(); renderMentors(); }
		else if (state.view === 'after') renderAfter();
	}

	forEach($('f-view').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
	});

	// a short "done" next to a button, gone after a few seconds
	var noteTimers = {};
	function boardNote(id, msg) {
		$(id).textContent = msg;
		window.clearTimeout(noteTimers[id]);
		noteTimers[id] = window.setTimeout(function () { $(id).textContent = ''; }, 5000);
	}

	function boardError(msg) {
		$('board-err').textContent = msg || '';
		$('board-err').hidden = !msg;
	}

	function loadBoard(done) {
		board.loading = true;
		if (!board.loaded) $('board-list').textContent = 'Reading the dashboard…';
		post({ action: 'board-admin', key: state.key }, 60000, function (json, err) {
			board.loading = false;
			if (done) done();
			if (json && json.ok && json.items) {
				board.loaded = true;
				board.page = json.page || TEAMS_PAGE;
				boardError('');
				boardItems(json.items);
				renderBoardAccess();
				return;
			}
			if (json && json.denied) { lock(json.error); return; }
			if (!board.loaded) $('board-list').textContent = '';
			boardError(actionProblem(json, err, 'run the team dashboard'));
		});
	}

	function boardItems(items) {
		board.items = items.map(function (it) {
			return {
				id: String(it.id), section: it.section, challenge: it.challenge || '', title: it.title || '',
				text: it.text || '', link: it.link || '', pinned: !!it.pinned,
				posted: it.posted ? new Date(it.posted) : null, edited: it.edited ? new Date(it.edited) : null
			};
		});
		renderBoardList();
	}

	// a participant's own link: opens the dashboard with their code filled in
	function teamsLink(code) { return board.page + '#code=' + encodeURIComponent(code); }

	// how many can open it: the accepted hackathon participants
	function acceptedCount() {
		return people(state.records).filter(function (p) {
			var h = hackReg(p);
			return h && decisionOf(h) === 'accepted';
		}).length;
	}

	function renderBoardAccess() {
		var n = acceptedCount();
		$('board-access').textContent = n ? plural(n, 'accepted participant', 'accepted participants') : 'nobody accepted yet';
		$('board-open').href = board.page;
		$('board-page').href = board.page;
		$('board-page').textContent = board.page.replace(/^https?:\/\//, '');
	}

	/* the form */

	function setSection(name) {
		board.section = name;
		forEach($('board-section').querySelectorAll('button'), function (b) {
			b.setAttribute('aria-pressed', b.getAttribute('data-section') === name ? 'true' : 'false');
		});
		$('board-challenge-field').hidden = name !== 'resource' && name !== 'checklist';
		$('board-pinned-field').hidden = name !== 'announcement';
		$('board-help').textContent = BOARD_HELP[name];
	}

	forEach($('board-section').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () { setSection(b.getAttribute('data-section')); });
	});

	function formError(msg) {
		$('board-form-err').textContent = msg || '';
		$('board-form-err').hidden = !msg;
	}

	function resetForm() {
		board.editing = null;
		$('board-form').reset();
		$('board-form-h').textContent = 'Post on the dashboard';
		$('board-submit').textContent = 'Post';
		$('board-cancel').hidden = true;
		formError('');
		setSection(board.section);
	}

	function editItem(it) {
		board.editing = it.id;
		setSection(it.section);
		$('board-challenge').value = it.challenge;
		$('board-title').value = it.title;
		$('board-text').value = it.text;
		$('board-link').value = it.link;
		$('board-pinned').checked = it.pinned;
		$('board-form-h').textContent = 'Edit';
		$('board-submit').textContent = 'Save changes';
		$('board-cancel').hidden = false;
		formError('');
		$('board-form').scrollIntoView({ block: 'start', behavior: 'smooth' });
		$('board-title').focus({ preventScroll: true });
	}

	$('board-cancel').addEventListener('click', resetForm);

	function saveItem(item, done) {
		post({ action: 'board-save', key: state.key, item: item }, 30000, function (json, err) {
			if (json && json.ok && json.items) { boardItems(json.items); done(null); return; }
			if (json && json.denied) { lock(json.error); return; }
			done(actionProblem(json, err, 'post on the team dashboard'));
		});
	}

	$('board-form').addEventListener('submit', function (ev) {
		ev.preventDefault();
		var item = {
			id: board.editing || '',
			section: board.section,
			challenge: board.section === 'resource' || board.section === 'checklist' ? $('board-challenge').value : '',
			title: $('board-title').value.trim(),
			text: $('board-text').value.trim(),
			link: $('board-link').value.trim(),
			pinned: board.section === 'announcement' && $('board-pinned').checked
		};
		if (!item.title && !item.text) { formError('Write a title or a text first.'); $('board-title').focus(); return; }
		if (item.link && !isUrl(item.link)) { formError('The link has to be a web address that starts with https://'); $('board-link').focus(); return; }
		var btn = $('board-submit');
		var label = btn.textContent;
		btn.disabled = true;
		btn.classList.add('is-busy');
		btn.textContent = item.id ? 'Saving…' : 'Posting…';
		formError('');
		saveItem(item, function (problem) {
			btn.disabled = false;
			btn.classList.remove('is-busy');
			btn.textContent = label;
			if (problem) { formError(problem); return; }
			var edited = !!item.id;
			resetForm();
			boardNote('board-note', edited ? 'Saved. The dashboard shows it within a minute.' : 'Posted. The dashboard shows it within a minute.');
		});
	});

	/* the list */

	function boardSorted(name) {
		var list = board.items.filter(function (it) { return it.section === name; });
		if (name === 'announcement') {
			list.sort(function (a, b) {
				if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
				return (b.posted ? b.posted.getTime() : 0) - (a.posted ? a.posted.getTime() : 0);
			});
		}
		return list;
	}

	function renderBoardList() {
		var box = $('board-list');
		box.textContent = '';
		$('board-count').textContent = board.items.length ? String(board.items.length) : '';
		BOARD_SECTIONS.forEach(function (name) {
			var list = boardSorted(name);
			var group = el('div', 'bgroup');
			group.appendChild(el('h3', null, BOARD_LABEL[name] + (list.length ? ' · ' + list.length : '')));
			if (!list.length) {
				group.appendChild(el('p', 'muted bempty', name === 'announcement' ? 'Nothing posted yet.' : 'Nothing yet: the dashboard says it is coming.'));
			} else {
				var ul = el('ul', 'blist');
				list.forEach(function (it) { ul.appendChild(boardRow(it)); });
				group.appendChild(ul);
			}
			box.appendChild(group);
		});
	}

	function boardRow(it) {
		var li = el('li', 'bitem' + (it.pinned ? ' is-pinned' : '') + (board.busy[it.id] ? ' is-busy' : ''));
		var main = el('div', 'bitem-main');
		var meta = [];
		if (it.challenge) meta.push(it.challenge);
		else if (it.section === 'resource' || it.section === 'checklist') meta.push('All challenges');
		if (it.posted) meta.push('Posted ' + fmtShort.format(it.posted));
		if (it.edited) meta.push('edited ' + fmtShort.format(it.edited));
		var m = el('p', 'bitem-meta');
		if (it.pinned) m.appendChild(el('span', 'btag', 'Pinned'));
		m.appendChild(document.createTextNode(meta.join(' · ')));
		main.appendChild(m);
		if (it.title) main.appendChild(el('p', 'bitem-title', it.title));
		if (it.text) main.appendChild(el('p', 'bitem-text', it.text.length > 240 ? it.text.slice(0, 240) + '…' : it.text));
		if (it.link) {
			var a = link(it.link, it.link.replace(/^https?:\/\//, ''));
			a.className = 'bitem-link';
			main.appendChild(a);
		}
		li.appendChild(main);

		var actions = el('div', 'bitem-actions');
		var edit = el('button', 'btn small', 'Edit');
		edit.type = 'button';
		edit.addEventListener('click', function () { editItem(it); });
		actions.appendChild(edit);
		if (it.section === 'announcement') {
			var pin = el('button', 'btn small ghost', it.pinned ? 'Unpin' : 'Pin');
			pin.type = 'button';
			pin.addEventListener('click', function () { togglePin(it); });
			actions.appendChild(pin);
		}
		var del = el('button', 'btn small ghost bitem-del', 'Delete');
		del.type = 'button';
		del.addEventListener('click', function () { deleteItem(it); });
		actions.appendChild(del);
		if (board.busy[it.id]) forEach(actions.querySelectorAll('button'), function (b) { b.disabled = true; });
		li.appendChild(actions);
		return li;
	}

	function togglePin(it) {
		board.busy[it.id] = true;
		renderBoardList();
		saveItem({ id: it.id, section: it.section, challenge: it.challenge, title: it.title, text: it.text, link: it.link, pinned: !it.pinned }, function (problem) {
			delete board.busy[it.id];
			renderBoardList();
			if (problem) boardError(problem);
		});
	}

	function deleteItem(it) {
		if (!window.confirm('Take “' + (it.title || it.text.slice(0, 60)) + '” off the team dashboard? This cannot be undone.')) return;
		board.busy[it.id] = true;
		renderBoardList();
		post({ action: 'board-delete', key: state.key, id: it.id }, 30000, function (json, err) {
			delete board.busy[it.id];
			if (json && json.ok && json.items) {
				if (board.editing === it.id) resetForm();
				boardItems(json.items);
				return;
			}
			if (json && json.denied) { lock(json.error); return; }
			renderBoardList();
			boardError(actionProblem(json, err, 'delete from the team dashboard'));
		});
	}

	/* --- the accepted participants: teams, "are you coming?", the check-in, the certificates ----------- */

	var CHALLENGES = ['Quantum Foundations', 'Quantum AI', 'Quantum Hacking'];
	var PLACE = { '1st': 'First place', '2nd': 'Second place', '3rd': 'Third place' };
	var COMING_LABEL = { yes: '✓ Coming', no: '✕ Cannot come', '': 'No answer yet' };

	// each accepted hackathon participant once: { p (the person), h (their hackathon registration) }, by last name
	function acceptedPeople() {
		return people(state.records).map(function (p) { return { p: p, h: hackReg(p) }; })
			.filter(function (x) { return x.h && decisionOf(x.h) === 'accepted'; })
			.sort(function (a, b) { return fold(get(a.p, 'Last name') + ' ' + get(a.p, 'First name')) < fold(get(b.p, 'Last name') + ' ' + get(b.p, 'First name')) ? -1 : 1; });
	}

	// a column of one registration, here and in its row (the CSV download reads the rows)
	function setCol(r, col, v) {
		r.v[col] = v;
		var j = state.columns.indexOf(col);
		if (j !== -1) r.row[j] = v;
	}

	function teamOfH(h) { return get(h, 'Hackathon team').trim(); }

	function comingOf(h) {
		var c = get(h, 'Coming').toLowerCase();
		return c === 'yes' || c === 'no' ? c : '';
	}

	function comingTag(h) {
		var c = comingOf(h);
		var t = el('span', 'ctag ctag-' + (c || 'none'), COMING_LABEL[c]);
		if (get(h, 'Coming answered')) t.title = 'Answered ' + fmtShort.format(new Date(get(h, 'Coming answered')));
		return t;
	}

	function tilesInto(id, list) {
		var box = $(id);
		box.textContent = '';
		list.forEach(function (t) {
			var tile = el('div', 'tile' + (t[2] ? ' ' + t[2] : ''));
			tile.appendChild(el('span', 'tile-label', t[0]));
			tile.appendChild(el('span', 'tile-value', String(t[1])));
			box.appendChild(tile);
		});
	}

	function viewError(id, msg) {
		$(id).textContent = msg || '';
		$(id).hidden = !msg;
	}

	/* the teams */

	var teamsUi = {
		editing: null,   // the name of the team in its form, '' for a new one, null for none
		busy: false
	};

	// the teams: the Teams tab, then any typed in the "Hackathon team" column only; each with its members
	function teamsWithMembers(list) {
		var teams = state.teams.map(function (t) { return { t: t, members: [] }; });
		var at = {};
		teams.forEach(function (x) { at[x.t.name.toLowerCase()] = x; });
		list.forEach(function (x) {
			var name = teamOfH(x.h);
			if (!name) return;
			var k = name.toLowerCase();
			if (!at[k]) teams.push(at[k] = { t: { name: name, challenge: '', table: '', pitch: '', room: '', award: '' }, members: [] });
			at[k].members.push(x);
		});
		return teams;
	}

	function renderTeams() {
		var list = acceptedPeople();
		var teams = teamsWithMembers(list);
		var loose = list.filter(function (x) { return !teamOfH(x.h); });
		var n = function (c) { return list.filter(function (x) { return comingOf(x.h) === c; }).length; };
		tilesInto('teams-tiles', [
			['Accepted', list.length],
			['Coming', n('yes')],
			['Cannot come', n('no'), n('no') ? 'tile--warn' : ''],
			['No answer yet', n('')],
			['Teams', teams.length],
			['Not in a team', loose.length, loose.length ? 'tile--warn' : '']
		]);
		$('teams-count').textContent = teams.length ? String(teams.length) : '';
		$('loose-count').textContent = loose.length ? String(loose.length) : '';

		var box = $('teams-list');
		box.textContent = '';
		if (teamsUi.editing === '') box.appendChild(teamForm(null));
		teams.forEach(function (x) { box.appendChild(teamCard(x.t, x.members, loose)); });
		if (!teams.length && teamsUi.editing !== '') box.appendChild(el('p', 'muted', 'No teams yet. Make them from the registrations, or one by one with New team.'));

		var lb = $('loose');
		lb.textContent = '';
		if (!loose.length) { lb.appendChild(el('p', 'muted', list.length ? 'Everyone accepted is in a team.' : 'Nobody is accepted yet.')); return; }
		var ul = el('ul', 'loose');
		loose.forEach(function (x) { ul.appendChild(looseRow(x, teams)); });
		lb.appendChild(ul);
	}

	function teamCard(t, members, loose) {
		if (teamsUi.editing !== null && teamsUi.editing.toLowerCase() === t.name.toLowerCase()) return teamForm(t);
		var card = el('article', 'tcard');
		var head = el('div', 'tcard-head');
		head.appendChild(el('h3', null, t.name));
		var tags = el('div', 'tcard-tags');
		tags.appendChild(el('span', 'btag' + (t.challenge ? '' : ' btag-warn'), t.challenge || 'No challenge yet'));
		if (t.award) tags.appendChild(el('span', 'btag btag-award', PLACE[t.award] || t.award));
		head.appendChild(tags);
		card.appendChild(head);
		card.appendChild(el('p', 'tcard-facts', [
			t.table ? 'Table ' + t.table : 'No table yet',
			t.pitch ? 'Pitch ' + t.pitch + (t.room ? ' · ' + t.room : '') : 'No pitch time yet'
		].join(' · ')));
		var ul = el('ul', 'tmembers');
		members.forEach(function (x) {
			var li = el('li');
			var nm = el('button', 'name-btn', x.p.name);
			nm.type = 'button';
			nm.addEventListener('click', function () { openDetail(x.p); });
			li.appendChild(nm);
			li.appendChild(comingTag(x.h));
			if (get(x.h, 'Checked in')) li.appendChild(el('span', 'ctag ctag-yes', 'Here'));
			var out = el('button', 'btn small ghost tmember-out', 'Take out');
			out.type = 'button';
			out.disabled = teamsUi.busy;
			out.addEventListener('click', function () { assign([{ team: '', emails: [x.h.email] }]); });
			li.appendChild(out);
			ul.appendChild(li);
		});
		if (!members.length) ul.appendChild(el('li', 'muted', 'Nobody in it yet.'));
		card.appendChild(ul);
		if (members.length > 3) card.appendChild(el('p', 'team-warn', '⚠ ' + members.length + ' people: teams have at most 3'));
		var foot = el('div', 'tcard-foot');
		if (loose.length) {
			var add = el('select', 'tcard-add');
			add.setAttribute('aria-label', 'Add someone to ' + t.name);
			add.appendChild(el('option', null, 'Add someone…')).value = '';
			loose.forEach(function (x) { add.appendChild(el('option', null, x.p.name)).value = x.h.email; });
			add.disabled = teamsUi.busy;
			add.addEventListener('change', function () { if (add.value) assign([{ team: t.name, emails: [add.value] }]); });
			foot.appendChild(add);
		}
		var edit = el('button', 'btn small', 'Edit');
		edit.type = 'button';
		edit.addEventListener('click', function () { teamsUi.editing = t.name; renderTeams(); });
		foot.appendChild(edit);
		var del = el('button', 'btn small ghost bitem-del', 'Delete');
		del.type = 'button';
		del.disabled = teamsUi.busy;
		del.addEventListener('click', function () { deleteTeam(t, members); });
		foot.appendChild(del);
		card.appendChild(foot);
		return card;
	}

	function input(value, attrs) {
		var i = el('input');
		i.type = 'text';
		i.value = value || '';
		Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
		return i;
	}

	function select(options, value) {
		var s = el('select');
		options.forEach(function (o) { s.appendChild(el('option', null, o[1])).value = o[0]; });
		s.value = value || '';
		return s;
	}

	function labelled(text, control) {
		var l = el('label', 'bform-field');
		l.appendChild(el('span', null, text));
		l.appendChild(control);
		return l;
	}

	// a team's form: t is the team being changed, or null for a new one
	function teamForm(t) {
		t = t || { name: '', challenge: '', table: '', pitch: '', room: '', award: '' };
		var form = el('form', 'tcard tform bform');
		form.noValidate = true;
		var name = input(t.name, { maxlength: '60', placeholder: 'Qubits', 'aria-label': 'Team name' });
		var challenge = select([['', 'No challenge yet']].concat(CHALLENGES.map(function (c) { return [c, c]; })), t.challenge);
		var table = input(t.table, { maxlength: '30', placeholder: '12' });
		var pitch = input(t.pitch, { maxlength: '20', placeholder: '10:15' });
		var room = input(t.room, { maxlength: '40', placeholder: 'Room B' });
		var award = select([['', 'None'], ['1st', 'First place'], ['2nd', 'Second place'], ['3rd', 'Third place']], t.award);
		form.appendChild(labelled('Team name', name));
		form.appendChild(labelled('Challenge', challenge));
		var row = el('div', 'tform-row');
		row.appendChild(labelled('Table', table));
		row.appendChild(labelled('Pitch (Sunday)', pitch));
		row.appendChild(labelled('Room', room));
		form.appendChild(row);
		form.appendChild(labelled('Place in its challenge', award));
		var err = el('p', 'err');
		err.hidden = true;
		form.appendChild(err);
		var actions = el('div', 'bform-actions');
		var save = el('button', 'btn primary', t.name ? 'Save' : 'Add the team');
		save.type = 'submit';
		var cancel = el('button', 'btn ghost', 'Cancel');
		cancel.type = 'button';
		cancel.addEventListener('click', function () { teamsUi.editing = null; renderTeams(); });
		actions.appendChild(save);
		actions.appendChild(cancel);
		form.appendChild(actions);
		form.addEventListener('submit', function (ev) {
			ev.preventDefault();
			if (!name.value.trim()) { err.textContent = 'Give the team a name.'; err.hidden = false; name.focus(); return; }
			save.disabled = true;
			save.classList.add('is-busy');
			save.textContent = 'Saving…';
			var team = { was: t.name, name: name.value.trim(), challenge: challenge.value, table: table.value.trim(), pitch: pitch.value.trim(), room: room.value.trim(), award: award.value };
			post({ action: 'team-save', key: state.key, team: team }, 30000, function (json, e) {
				if (json && json.denied) { lock(json.error); return; }
				if (json && json.ok && json.teams) {
					state.teams = json.teams;
					// a new name moves the members with it, as the sheet did
					if (t.name && t.name.toLowerCase() !== team.name.toLowerCase()) {
						acceptedPeople().forEach(function (x) { if (teamOfH(x.h).toLowerCase() === t.name.toLowerCase()) setCol(x.h, 'Hackathon team', team.name); });
					}
					teamsUi.editing = null;
					renderTeams();
					boardNote('teams-note', 'Saved. The team sees it within a minute.');
					return;
				}
				save.disabled = false;
				save.classList.remove('is-busy');
				save.textContent = t.name ? 'Save' : 'Add the team';
				err.textContent = actionProblem(json, e, 'save teams');
				err.hidden = false;
			});
		});
		window.setTimeout(function () { name.focus(); }, 0);
		return form;
	}

	$('team-new').addEventListener('click', function () {
		teamsUi.editing = '';
		renderTeams();
	});

	// people into a team ("" takes them out): [{ team, emails }]
	function assign(groups, done) {
		teamsUi.busy = true;
		renderTeams();
		post({ action: 'team-assign', key: state.key, groups: groups }, 30000, function (json, err) {
			teamsUi.busy = false;
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.set) {
				state.teams = json.teams || state.teams;
				var by = {};
				json.set.forEach(function (x) { by[x.email] = x.team; });
				acceptedPeople().forEach(function (x) { if (x.h.email in by) setCol(x.h, 'Hackathon team', by[x.h.email]); });
				viewError('teams-err', json.missing && json.missing.length ? 'Not in the sheet any more: ' + json.missing.join(', ') + '. Refresh the page.' : '');
			} else {
				viewError('teams-err', actionProblem(json, err, 'put people in teams'));
			}
			renderTeams();
			if (done) done(json && json.ok);
		});
	}

	function deleteTeam(t, members) {
		if (!window.confirm('Delete the team “' + t.name + '”?' + (members.length ? ' Its ' + plural(members.length, 'member goes', 'members go') + ' back to “Not in a team yet”.' : ''))) return;
		teamsUi.busy = true;
		renderTeams();
		post({ action: 'team-delete', key: state.key, name: t.name }, 30000, function (json, err) {
			teamsUi.busy = false;
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.teams) {
				state.teams = json.teams;
				members.forEach(function (x) { setCol(x.h, 'Hackathon team', ''); });
				viewError('teams-err', '');
			} else {
				viewError('teams-err', actionProblem(json, err, 'delete teams'));
			}
			renderTeams();
		});
	}

	function looseRow(x, teams) {
		var li = el('li', 'loose-row');
		var main = el('div', 'loose-main');
		var nm = el('button', 'name-btn', x.p.name);
		nm.type = 'button';
		nm.addEventListener('click', function () { openDetail(x.p); });
		main.appendChild(nm);
		main.appendChild(comingTag(x.h));
		var about = [get(x.h, 'Tracks'), get(x.h, 'Experience').split(':')[0]].filter(Boolean).join(' · ');
		if (about) main.appendChild(el('p', 'loose-sub', about));
		if (get(x.h, 'Team') === 'team' && get(x.h, 'Team name and members')) main.appendChild(el('p', 'loose-sub', 'Registered with ' + get(x.h, 'Team name and members')));
		li.appendChild(main);
		if (teams.length) {
			var put = select([['', 'Put in a team…']].concat(teams.map(function (t) { return [t.t.name, t.t.name + ' (' + t.members.length + ')']; })), '');
			put.setAttribute('aria-label', 'Put ' + x.p.name + ' in a team');
			put.disabled = teamsUi.busy;
			put.addEventListener('change', function () { if (put.value) assign([{ team: put.value, emails: [x.h.email] }]); });
			li.appendChild(put);
		}
		return li;
	}

	// the registrations' teams (who named whom), as their accepted members not in a team yet, two or more each
	function suggestedTeams() {
		var seen = {}, groups = [];
		state.records.forEach(function (r) {
			if (!r.team || seen[r.team.id]) return;
			seen[r.team.id] = true;
			var free = r.team.members.filter(function (m) { return decisionOf(m) === 'accepted' && !teamOfH(m); });
			if (free.length >= 2) groups.push(free);
		});
		return groups;
	}

	$('teams-suggest').addEventListener('click', function () {
		var groups = suggestedTeams();
		if (!groups.length) { boardNote('teams-note', 'Nobody to group: the accepted people who registered together are in teams already.'); return; }
		var taken = {};
		state.teams.forEach(function (t) { taken[t.name.toLowerCase()] = true; });
		var named = groups.map(function (members) {
			var base = 'Team ' + and(members.map(function (m) { return get(m, 'First name') || m.name; }));
			var name = base, i = 2;
			while (taken[name.toLowerCase()]) name = base + ' ' + i++;
			taken[name.toLowerCase()] = true;
			return { team: name, emails: members.map(function (m) { return m.email; }) };
		});
		if (!window.confirm('Make ' + plural(named.length, 'team', 'teams') + ' from the registrations?\n\n' + named.map(function (g) { return g.team; }).join('\n') + '\n\nRename them after with Edit.')) return;
		assign(named, function (okay) { if (okay) boardNote('teams-note', 'Made ' + plural(named.length, 'team', 'teams') + '.'); });
	});

	function and(names) {
		return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
	}

	/* the check-in at the door */

	var checkinUi = {
		filter: 'out',   // out (not here yet), in, all
		query: '',
		busy: {}         // emails being saved
	};

	function renderCheckin() {
		var list = acceptedPeople();
		var here = list.filter(function (x) { return get(x.h, 'Checked in'); });
		var cannot = list.filter(function (x) { return !get(x.h, 'Checked in') && comingOf(x.h) === 'no'; });
		tilesInto('checkin-tiles', [
			['Here', here.length + ' of ' + list.length],
			['Not here yet', list.length - here.length],
			['Said they cannot come', cannot.length, cannot.length ? 'tile--warn' : '']
		]);
		var counts = { out: list.length - here.length, 'in': here.length, all: list.length };
		forEach($('checkin-filter').querySelectorAll('button'), function (b) {
			var f = b.getAttribute('data-f');
			b.setAttribute('aria-pressed', String(f === checkinUi.filter));
			b.querySelector('.n').textContent = counts[f];
		});
		var q = checkinUi.query;
		var shown = list.filter(function (x) {
			var isIn = !!get(x.h, 'Checked in');
			if (checkinUi.filter === 'out' && isIn) return false;
			if (checkinUi.filter === 'in' && !isIn) return false;
			return !q || fold(x.p.name + ' ' + x.h.email + ' ' + teamOfH(x.h)).indexOf(q) !== -1;
		});
		var ul = $('checkin-list');
		ul.textContent = '';
		shown.forEach(function (x) { ul.appendChild(checkinRow(x)); });
		var empty = $('checkin-empty');
		empty.hidden = shown.length > 0;
		empty.textContent = !list.length ? 'Nobody is accepted yet.' : q ? 'Nobody accepted matches “' + $('checkin-search').value.trim() + '”' + (checkinUi.filter !== 'all' ? ' here: try Everyone.' : '. Not accepted? Accept them under Registrations first.') : checkinUi.filter === 'out' ? 'Everyone is here.' : 'Nobody checked in yet.';
	}

	function checkinRow(x) {
		var at = get(x.h, 'Checked in');
		var busy = !!checkinUi.busy[x.h.email];
		var li = el('li', 'crow' + (at ? ' is-in' : '') + (busy ? ' is-busy' : ''));
		var main = el('div', 'crow-main');
		var nm = el('p', 'crow-name', x.p.name);
		main.appendChild(nm);
		var sub = el('p', 'crow-sub');
		var bits = [teamOfH(x.h) || 'No team', get(x.h, 'T-shirt') ? 'T-shirt ' + get(x.h, 'T-shirt') : '', get(x.h, 'Dietary')].filter(Boolean);
		sub.appendChild(document.createTextNode(bits.join(' · ')));
		if (!at && get(x.h, 'Phone')) {
			sub.appendChild(document.createTextNode(' · '));
			sub.appendChild(link('tel:' + get(x.h, 'Phone').replace(/[^\d+]/g, ''), get(x.h, 'Phone')));
		}
		main.appendChild(sub);
		li.appendChild(main);
		if (!at) li.appendChild(comingTag(x.h));
		var act = el('div', 'crow-act');
		if (at) {
			act.appendChild(el('span', 'crow-time', '✓ Here since ' + fmtClock.format(new Date(at))));
			var undo = el('button', 'btn small ghost', 'Undo');
			undo.type = 'button';
			undo.disabled = busy;
			undo.addEventListener('click', function () { checkIn(x, true); });
			act.appendChild(undo);
		} else {
			var go = el('button', 'btn primary', busy ? 'Saving…' : 'Check in');
			go.type = 'button';
			go.disabled = busy;
			go.addEventListener('click', function () { checkIn(x, false); });
			act.appendChild(go);
		}
		li.appendChild(act);
		return li;
	}

	function checkIn(x, undo) {
		checkinUi.busy[x.h.email] = true;
		renderCheckin();
		post({ action: 'checkin', key: state.key, email: x.h.email, undo: undo }, 30000, function (json, err) {
			delete checkinUi.busy[x.h.email];
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.action === 'checkin') {
				setCol(x.h, 'Checked in', json.checkedIn ? String(json.checkedIn) : '');
				viewError('checkin-err', '');
			} else {
				viewError('checkin-err', (undo ? 'Not undone. ' : x.p.name + ' is not checked in. ') + actionProblem(json, err, 'check people in'));
			}
			renderCheckin();
			// the next person: the search starts again
			if (!undo && json && json.ok && checkinUi.query) {
				$('checkin-search').value = '';
				checkinUi.query = '';
				renderCheckin();
				$('checkin-search').focus();
			}
		});
	}

	$('checkin-search').addEventListener('input', function () {
		checkinUi.query = fold(this.value).trim();
		renderCheckin();
	});

	// Enter checks in the only one found
	$('checkin-search').addEventListener('keydown', function (ev) {
		if (ev.key !== 'Enter') return;
		var rows = $('checkin-list').querySelectorAll('.crow:not(.is-in) .crow-act .btn.primary');
		if (rows.length === 1) { ev.preventDefault(); rows[0].click(); }
	});

	forEach($('checkin-filter').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () { checkinUi.filter = b.getAttribute('data-f'); renderCheckin(); });
	});

	/* the mentors' link */

	function mentorsLink() { return state.mentors ? state.mentors.page + '#key=' + encodeURIComponent(state.mentors.key) : ''; }

	function renderMentors() {
		var ok = !!(state.mentors && state.mentors.key);
		$('mentor-copy').disabled = $('mentor-renew').disabled = !ok;
		if (!ok) return;
		$('mentor-page').href = state.mentors.page;
		$('mentor-page').textContent = state.mentors.page.replace(/^https?:\/\//, '');
		$('mentor-open').href = mentorsLink();
	}

	$('mentor-copy').addEventListener('click', function () {
		copyText(mentorsLink(), function (ok) { boardNote('mentor-note', ok ? 'Copied: send it to the mentors.' : 'Could not copy: your browser blocked it'); });
	});

	$('mentor-renew').addEventListener('click', function () {
		if (!window.confirm('Make a new mentor key? The link the mentors have stops working at once, and they need the new one.')) return;
		var b = $('mentor-renew');
		b.disabled = true;
		post({ action: 'mentor-key', key: state.key, renew: true }, 30000, function (json, err) {
			b.disabled = false;
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.key) {
				state.mentors = { key: json.key, page: json.page || (state.mentors && state.mentors.page) };
				renderMentors();
				boardNote('mentor-note', 'New key made: copy the link again and send it to the mentors.');
			} else {
				boardError(actionProblem(json, err, 'change the mentor key'));
			}
		});
	});

	/* after the event: the certificates and the feedback */

	function renderAfter() {
		var due = acceptedPeople().filter(function (x) { return get(x.h, 'Checked in'); });
		var sent = due.filter(function (x) { return /^sent/i.test(get(x.h, 'Certificate')); });
		var failed = due.filter(function (x) { return /^failed/i.test(get(x.h, 'Certificate')); });
		$('cert-count').textContent = due.length ? sent.length + ' of ' + due.length + ' sent' : '';
		$('cert-status').textContent = !due.length
			? 'Nobody is checked in yet: the certificates go to the people who were there.'
			: (due.length - sent.length ? plural(due.length - sent.length, 'certificate', 'certificates') + ' to send' : 'All sent') +
				(failed.length ? ' · ' + failed.length + ' failed before: Send tries them again' : '');
		var tpl = $('cert-template');
		tpl.textContent = '';
		if (isUrl(state.certificate)) {
			tpl.appendChild(document.createTextNode('Restyle it in '));
			tpl.appendChild(link(state.certificate, 'the template'));
			tpl.appendChild(document.createTextNode(' (keep the {{…}} fields), then send yourself a sample.'));
		} else {
			tpl.appendChild(el('b', null, 'No template yet: in the Apps Script editor, pick certificateTemplate in the function list and press Run once, then Refresh here.'));
		}
		$('cert-sample').disabled = !state.certificate;
		$('cert-send').disabled = !state.certificate || !due.length || sent.length === due.length;
		renderFeedback();
	}

	function certFailed(json, err) {
		$('cert-result').textContent = '';
		viewError('after-err', actionProblem(json, err, 'send certificates'));
	}

	$('cert-sample').addEventListener('click', function () {
		var b = $('cert-sample');
		b.disabled = true;
		b.textContent = 'Sending…';
		viewError('after-err', '');
		post({ action: 'certificates', key: state.key, sample: true }, 120000, function (json, err) {
			b.disabled = false;
			b.textContent = 'Send me a sample';
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.sample) { boardNote('cert-result', 'A sample is on its way to ' + json.sample + '.'); return; }
			certFailed(json, err);
		});
	});

	$('cert-send').addEventListener('click', function () {
		var due = acceptedPeople().filter(function (x) { return get(x.h, 'Checked in') && !/^sent/i.test(get(x.h, 'Certificate')); });
		if (!window.confirm('Email ' + plural(due.length, 'certificate', 'certificates') + ' now, one to each person checked in who has not had theirs?')) return;
		var b = $('cert-send');
		b.disabled = true;
		b.classList.add('is-busy');
		b.textContent = 'Sending…';
		viewError('after-err', '');
		$('cert-result').textContent = 'Making and sending the certificates: a few seconds each…';
		post({ action: 'certificates', key: state.key, send: true }, 7 * 60 * 1000, function (json, err) {
			b.classList.remove('is-busy');
			b.textContent = 'Send certificates';
			if (json && json.denied) { lock(json.error); return; }
			if (!(json && json.ok && json.items)) { certFailed(json, err); renderAfter(); return; }
			var byEmail = {};
			json.items.forEach(function (it) { byEmail[String(it.email).toLowerCase()] = it; });
			acceptedPeople().forEach(function (x) {
				var it = byEmail[x.h.email];
				if (it && it.status === 'sent') setCol(x.h, 'Certificate', 'sent');
				if (it && it.status === 'failed') setCol(x.h, 'Certificate', 'FAILED: ' + it.note);
			});
			var n = function (s) { return json.items.filter(function (it) { return it.status === s; }); };
			var box = $('cert-result');
			box.textContent = '';
			box.appendChild(el('p', 'send-big', 'Sent ' + plural(n('sent').length, 'certificate', 'certificates') + '.'));
			if (n('failed').length) box.appendChild(el('p', 'bad', 'Failed: ' + n('failed').map(function (it) { return it.name + ' (' + it.note + ')'; }).join('; ')));
			if (json.stopped === 'quota') box.appendChild(el('p', 'send-warn', 'Stopped with ' + json.reserve + ' emails left for today: send again tomorrow for the other ' + n('to send').length + '.'));
			if (json.stopped === 'time') box.appendChild(el('p', 'send-warn', 'Stopped before Apps Script’s time limit: press Send again for the other ' + n('to send').length + '.'));
			renderAfter();
		});
	});

	function renderFeedback() {
		var fb = state.feedback.filter(function (f) { return f.overall; });
		$('fb-count').textContent = fb.length ? String(fb.length) : '';
		var avg = function (list) { return list.length ? (list.reduce(function (s, f) { return s + f.overall; }, 0) / list.length).toFixed(1) : '–'; };
		var again = function (v) { return fb.filter(function (f) { return f.again === v; }).length; };
		var tiles = [['Answers', fb.length], ['Overall, out of 5', avg(fb)], ['Would come again', again('yes')], ['Maybe again', again('maybe')], ['Would not', again('no')]];
		CHALLENGES.forEach(function (c) {
			var mine = fb.filter(function (f) { return f.challenge === c; });
			if (mine.length) tiles.push([c, avg(mine) + ' (' + mine.length + ')']);
		});
		tilesInto('fb-tiles', tiles);
		$('fb-cols').hidden = !fb.length;
		[['fb-best', 'best'], ['fb-change', 'change']].forEach(function (x) {
			var ul = $(x[0]);
			ul.textContent = '';
			fb.filter(function (f) { return String(f[x[1]] || '').trim(); })
				.sort(function (a, b) { return String(b.sent).localeCompare(String(a.sent)); })
				.forEach(function (f) {
					var li = el('li');
					li.appendChild(el('p', null, f[x[1]]));
					li.appendChild(el('p', 'fb-meta', f.overall + '/5' + (f.challenge ? ' · ' + f.challenge : '')));
					ul.appendChild(li);
				});
			if (!ul.children.length) ul.appendChild(el('li', 'muted', 'Nothing yet.'));
		});
	}

	setSection('announcement');

	/* --- start ------------------------------------------------------------ */

	if (!endpoint) {
		lockError('No Apps Script URL in data-endpoint on admin.html.');
		lockBtn.disabled = true;
		return;
	}

	var saved = storedKey();
	if (saved) {
		$('remember').checked = remembered();
		unlock(saved, remembered());
	} else {
		keyInput.focus();
	}

})();
