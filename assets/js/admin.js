/*
	BreaQ 2026 registrations: the admin page (admin.html)
	- asks for the admin key and posts { action: "list", key } to the Apps Script in data-endpoint
	  (tools/register-backend.gs, the same script the registration forms post to)
	- keeps the key for the tab, or on the device when asked; the registrations stay in memory only
	- counts, registrations per day and breakdowns for the chosen event; the table filters by event and search
	- copies the shown emails, downloads the shown rows as CSV, opens one registration in full
	- picks people with the boxes in the table, kept while one looks around, and emails them the one chosen ("mail")
	- the Teams view: who is in which team, each team's challenge, table, pitch and place, who said they are
	  coming ("team-save", "team-delete", "team-assign"; the sheet's "Teams" tab and "Hackathon team" column)
	- the Check-in view, at the door: "checkin" fills the "Checked in" column
	- the Team dashboard view: who can open it, the mentors' link ("mentor-key"), and the announcements, the
	  checklist, the resources, submission and practical details the teams see on teams.html (the "board-…"
	  actions; kept in the sheet's "Team dashboard" tab)
	- the After the event view: the certificates ("certificates") and the feedback sent from the dashboard
	- the In numbers view: counts and charts for the brochure, and CSVs for the report (the registrations without
	  names, the feedback)
*/

(function () {

	'use strict';

	var root = document.getElementById('admin');
	if (!root) return;

	var endpoint = (root.getAttribute('data-endpoint') || '').trim();
	var KEY_STORE = 'breaq-2026-admin-key';
	var EVENT_STORE = 'breaq-2026-admin-event';
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
		event: storedEvent(),     // conference (the first, since the hackathon's registration closed), hackathon or all
		query: '',
		problems: false,          // only the registrations with a failed email or letter
		kind: 'all',              // the Who tab: all, teams, solo (hackathon)
		decision: 'any',          // the Decision tab: any, tovote (not voted on by you), none, accepted, waitlist, denied
		facets: {},               // the bars clicked: breakdown id -> [{ k, label }], any of them (and every breakdown)
		extra: {},                // More filters: key -> the option picked
		from: '',                 // registered on or after this day (yyyy-mm-dd), and on or before "to"
		to: '',
		pending: {},              // emails whose decision is being saved
		tracking: {},             // emails whose track is being saved
		accessing: {},            // emails whose dashboard code is being turned off or on
		detail: null,             // the person open in the full view
		sort: { key: 'time', dir: -1 },
		view: 'regs',             // regs, teams, checkin, board (the team dashboard), after
		codes: {},                // email -> team dashboard code, for the accepted
		teams: [],                // the sheet's "Teams" tab: [{ name, challenge, table, pitch, room, award }]
		mentors: null,            // { key, page }: the mentors' link
		feedback: [],             // what the participants answered after the event, without names
		activity: null,           // the team dashboard in numbers: posts, mentor requests, the median wait
		numbersOf: 'applied',     // Edition in numbers: whose talent pool (applied, accepted, came, conference, everyone)
		certificate: '',          // the certificate template's link, '' while there is none
		voter: '',                // who votes: their own key's, or the one picked with the shared key ('' for nobody)
		shared: false,            // opened with the shared admin key: the voter is whoever says it is them
		looking: false,           // with the shared key, "Just looking": not voting
		voters: [],               // the organisers who vote on the hackathon registrations ([]: an older Apps Script)
		majority: 0,              // this many grades, and their average sets the Decision
		grades: null,             // { min, max, accept, waitlist }: the averages that accept and put on the waiting list
		handOpen: false,          // "Decide by hand" open in the full view
		picked: {},               // email -> true: the people picked for an email (kept in sessionStorage)
		onlyPicked: false,        // the table shows only them
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
		// a confirmation that went out later (sendConfirmations, the admin page, a merge) settles a failed or held one
		if (/confirmation sent/i.test(text)) return 'sent';
		if (/failed/i.test(text)) return 'failed';
		return /^emails held/i.test(text) ? 'held' : 'sent';
	}

	// at: the row's place among the sheet's rows, which stays as new ones come in (the reading mode deals by it)
	function toRecords(columns, rows) {
		return rows.map(function (row, at) {
			return { row: row, at: at };
		}).filter(function (x) {
			return x.row.some(function (v) { return v !== '' && v !== null; });
		}).map(function (x) {
			var row = x.row;
			var v = {};
			columns.forEach(function (c, j) {
				var x = row[j];
				v[c] = x === null || x === undefined ? '' : String(x).trim();
			});
			var time = v['Timestamp'] ? new Date(v['Timestamp']) : null;
			return {
				row: row,
				at: x.at,
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
		// the university as written in the registration it is counted from: "n/a" in the newest does not stand for it
		var counted = regs.filter(function (r) { return r.org; })[0];
		if (counted) v['University or company'] = get(counted, 'University or company');
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
			city: first('city'),
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

	// the track the organisers give each participant ("Hackathon track", the Apps Script's CHALLENGES); "Tracks" is
	// what they ticked on the form
	var TRACKS = ['Quantum Foundations', 'Quantum AI', 'Quantum Hacking'];
	var TRACK_SHORT = { 'Quantum Foundations': 'Foundations', 'Quantum AI': 'AI', 'Quantum Hacking': 'Hacking' };

	function trackOf(r) {
		var t = get(r, 'Hackathon track').toLowerCase();
		return TRACKS.filter(function (x) { return x.toLowerCase() === t; })[0] || '';
	}

	// what the "Decision email" column says went out: { decision, sent }, or null before any
	function emailedOf(r) {
		var m = /^([a-z ]+): (sent|FAILED)/.exec(get(r, 'Decision email'));
		return m ? { decision: m[1], sent: m[2] === 'sent' } : null;
	}

	// emailed by hand, outside the Apps Script, and recorded so (the email's "only record it")
	function byHand(r) { return / by hand/.test(get(r, 'Decision email')); }

	// an accepted participant who has their team dashboard link: in our acceptance, or in an email written on this
	// page about the dashboard (the Dashboard link one). An acceptance emailed by hand did not have it.
	function hasLink(r) {
		var m = emailedOf(r);
		if (m && m.sent && m.decision === 'accepted' && !byHand(r)) return true;
		return /email “[^”]*dashboard[^”]*” sent/i.test(get(r, 'Emails'));
	}

	// the day their dashboard link first went out, "2026-10-19" ('' for none): our acceptance, or an email about the
	// dashboard written on this page
	function linkSince(r) {
		var days = [];
		var d = /^accepted: sent (\d{4}-\d\d-\d\d)/.exec(get(r, 'Decision email'));
		if (d && !byHand(r)) days.push(d[1]);
		get(r, 'Emails').replace(/email “[^”]*dashboard[^”]*” sent (\d{4}-\d\d-\d\d)/gi, function (m, day) { days.push(day); return m; });
		return days.sort()[0] || '';
	}

	// the dashboard code turned off by the organisers ("Code off": since when)
	function codeOff(r) { return !!get(r, 'Code off'); }

	// the acceptance asked to say by Wednesday 21 October whether they are coming (CONFIRM_BY in the Apps Script):
	// accepted, the link sent before that day, and no answer since
	var ANSWER_BY = '2026-10-21';
	function silent(r) {
		var since = linkSince(r);
		return decisionOf(r) === 'accepted' && !comingOf(r) && !codeOff(r) && !!since && since < ANSWER_BY;
	}

	/* --- votes (hackathon) ------------------------------------------------------ */

	// each organiser grades from 1 to 10 in their "Vote <name>" column, with their own key; once state.majority have,
	// the average sets the Decision (state.grades.accept or more: accepted, .waitlist or more: the waiting list, below:
	// denied), as vote_ in tools/register-backend.gs does
	var GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

	function voting() { return state.voters.length > 0; }

	function voteCol(v) { return 'Vote ' + v; }

	// a grade, or 0 while there is none
	function voteOf(r, v) {
		var x = String(get(r, voteCol(v))).trim();
		var n = /^\d+$/.test(x) ? Number(x) : 0;
		return GRADES.indexOf(n) !== -1 ? n : 0;
	}

	// the grades given, with mine (when given; 0 takes it back) in place of the reader's own: { n, avg }
	function gradesOf(r, mine) {
		var n = 0, sum = 0;
		state.voters.forEach(function (v) {
			var x = v === state.voter && mine !== undefined ? mine : voteOf(r, v);
			if (x) { n++; sum += x; }
		});
		return { n: n, avg: n ? sum / n : 0 };
	}

	// accepted, waitlist or denied as the grades' average says, once state.majority of them are in
	function bandOf(avg) {
		return avg >= state.grades.accept ? 'accepted' : avg >= state.grades.waitlist ? 'waitlist' : 'denied';
	}

	function outcomeOf(r, mine) {
		var g = gradesOf(r, mine);
		return g.n >= state.majority ? bandOf(g.avg) : '';
	}

	// the Decision after the reader grades mine: set by the grade when it changes what the average says, else as it was
	function decisionAfter(r, mine) {
		var after = outcomeOf(r, mine);
		return after !== outcomeOf(r) ? after : decisionOf(r);
	}

	// 7.33, 8, 6.5
	function avgText(avg) { return String(Math.round(avg * 100) / 100); }

	function noteCol(v) { return 'Note ' + v; }

	function noteOf(r, v) { return get(r, noteCol(v)); }

	// Each registration goes first to state.majority of the voters, picked at random for it, so each reads about 3
	// letters in 5. At random, but the same on every device: the dice are its email and DEAL. A team counts as its
	// first registration, so its members go to the same voters, one after another.
	var DEAL = '2026-10-16';   // another word deals the letters out again

	function groupAt(h) {
		return h.team ? Math.min.apply(null, h.team.members.map(function (m) { return m.at; })) : h.at;
	}

	// the registration a team goes by: its first
	function groupHead(h) {
		return h.team ? h.team.members.reduce(function (a, m) { return m.at < a.at ? m : a; }) : h;
	}

	// numbers between 0 and 1 that look random, the same for the same words (FNV-1a, then mulberry32)
	function dice(words) {
		var x = 2166136261;
		for (var i = 0; i < words.length; i++) x = Math.imul(x ^ words.charCodeAt(i), 16777619) >>> 0;
		return function () {
			x = (x + 0x6D2B79F5) >>> 0;
			var t = Math.imul(x ^ (x >>> 15), x | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function assignees(h) {
		var roll = dice(DEAL + ' ' + groupHead(h).email);
		var order = state.voters.slice();
		for (var i = order.length - 1; i > 0; i--) {
			var j = Math.floor(roll() * (i + 1));
			var t = order[i]; order[i] = order[j]; order[j] = t;
		}
		return order.slice(0, Math.min(state.majority || order.length, order.length));
	}

	function votesIn(h) {
		return state.voters.filter(function (v) { return voteOf(h, v); }).length;
	}

	// waiting for the reader: one of theirs, undecided and not graded by them
	function needsMe(h) {
		var me = state.voter;
		if (!me || decisionOf(h) || voteOf(h, me)) return false;
		return assignees(h).indexOf(me) !== -1;
	}

	// the others' grades and notes show once the reader has graded (or it is decided), so each judges a letter alone;
	// the shared admin key, which does not vote, sees them all
	function revealed(regs) {
		return !state.voter || regs.every(function (r) { return voteOf(r, state.voter) || decisionOf(r); });
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

	// the words of a name, folded as nameKey has them, in the order written
	function nameWords(s) {
		return fold(s).split(/[^a-z0-9]+/).filter(Boolean);
	}

	// two words of a name that are one: the same, a short form ("alex" of "alexandru", never "stan" of "stanescu"), or
	// a typo (a letter off, two in a long word). Ioan and Ioana, Cristian and Cristina are two people.
	function nearWord(a, b) {
		if (a === b) return true;
		if ((a.slice(-1) === 'a') !== (b.slice(-1) === 'a')) return false;
		var s = a.length <= b.length ? a : b, l = s === a ? b : a;
		if (s.length < 4) return false;
		if (l.indexOf(s) === 0 && !/^(escu|eanu|anu)$/.test(l.slice(s.length))) return true;
		return distance(a, b) <= (l.length >= 8 ? 2 : 1);
	}

	// every word of part has its like in whole
	function within(part, whole) {
		return part.every(function (t) { return whole.some(function (u) { return nearWord(t, u); }); });
	}

	// one person in two names of two words or more: every word of the shorter in the longer
	function samePerson(a, b) {
		return a.length >= 2 && b.length >= 2 && (a.length <= b.length ? within(a, b) : within(b, a));
	}

	// A teammate's name that nobody registered under as written, matched to the same people written another way, as
	// similarMates_ in the Apps Script does. people: { words, mails (their emails before the @), mates (the names they
	// wrote) }, namer among them. { found: the people it is, left: what is still nobody's ("" for none) }:
	// - whole names in what was written: a longer form ("Cosmin-Eusebiu Patrașcu" for Cosmin Patrascu), or several
	//   run together without a comma ("Nitas Robert-Cristian Moise Robert-Alexandru"), the namer's own among them
	// - a shorter form, a typo or a short form ("David Munteanu" for David-Andrei Munteanu, "Pospai Alexandru" for
	//   alex pospai), when only one person fits
	// - the given names right and the family name in their email (registered with a teammate's family name)
	// - someone who named the namer back, with two words of it ("Radu Stan Pop" for Radu-Stefan Pop), or the one
	//   word written ("Bogdan")
	function similarMates(name, people, namer) {
		var words = nameWords(name);
		var none = { found: [], left: name };
		if (!words.length) return none;
		var inside = people.filter(function (p) { return p.words.length >= 2 && within(p.words, words); });
		if (inside.length) {
			var used = [].concat.apply([], inside.map(function (p) { return p.words; }));
			var left = words.filter(function (t) { return !used.some(function (u) { return nearWord(t, u); }); });
			// two words or more left over are someone else, named in the same breath
			var rest = left.length < 2 ? '' : String(name).trim().split(/[\s-]+/).filter(function (w) {
				return nameWords(w).some(function (t) { return left.indexOf(t) !== -1; });
			}).join(' ');
			return { found: inside.filter(function (p) { return p !== namer; }), left: rest };
		}
		if (namer && words.length >= 2 && within(words, namer.words)) return { found: [], left: '' };   // their own, shorter
		var others = people.filter(function (p) { return p !== namer; });
		var fit = words.length < 2 ? [] : others.filter(function (p) { return within(words, p.words); });
		if (fit.length) return fit.length === 1 ? { found: fit, left: '' } : none;
		var mail = others.filter(function (p) {
			var same = words.filter(function (t) { return p.words.some(function (u) { return nearWord(t, u); }); });
			return same.length >= 2 && words.every(function (t) {
				return same.indexOf(t) !== -1 || (t.length >= 4 && p.mails.some(function (m) { return m.indexOf(t) !== -1; }));
			});
		});
		if (mail.length === 1) return { found: mail, left: '' };
		if (namer) {
			var back = others.filter(function (p) {
				var same = words.filter(function (t) { return p.words.some(function (u) { return nearWord(t, u); }); }).length;
				return (same >= 2 || (words.length === 1 && same === 1)) &&
					p.mates.some(function (m) { var w = nameWords(m); return w.slice().sort().join(' ') === namer.words.slice().sort().join(' ') || samePerson(w, namer.words); });
			});
			if (back.length === 1) return { found: back, left: '' };
		}
		return none;
	}

	// Teams among the hackathon registrations: whoever named someone, or was named, joins them, with the names
	// nobody registered under. Each member's record gets r.team = { id, members, missing }; others get null. One
	// named another way than they registered (similarMates) gets r.namedAs, the names written for them.
	function buildTeams(records) {
		var hack = records.filter(function (r) { return r.event === 'hackathon' || r.event === 'both'; });
		var byName = {}, up = [], missing = [];
		var people = hack.map(function (r, i) {
			return {
				i: i,
				words: nameWords(r.name),
				mails: [r.email].concat(get(r, 'Other emails').split(/[,;\s]+/)).filter(Boolean).map(function (e) { return fold(e).split('@')[0]; }),
				mates: get(r, 'Team') === 'team' ? teammates(get(r, 'Team name and members')) : []
			};
		});
		hack.forEach(function (r, i) {
			r.team = null;
			r.namedAs = [];
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
				if (byName[k]) { byName[k].forEach(function (j) { up[root(j)] = root(i); }); return; }
				var m = similarMates(n, people, people[i]);
				m.found.forEach(function (p) {
					up[root(p.i)] = root(i);
					if (hack[p.i].namedAs.indexOf(n) === -1) hack[p.i].namedAs.push(n);
				});
				if (m.left) missing[i].push(m.left);
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

	/* --- answers sent in translation ------------------------------------------ */

	// The forms' options once went with the text shown, so a browser translating the page sent the translation
	// ("Student la licență" for "Bachelor student", "Universitatea mea" for "My university"): each such answer counts
	// as the option it translates, everywhere on the page. The forms now send the option itself.
	var TRANSLATED = {
		'Status': [[/\b(liceu|elev|eleva)\b/, 'High-school student'], [/\blicenta\b/, 'Bachelor student'], [/\bmaster/, 'Master student'],
			[/\bdoctor/, 'PhD student'], [/\bcercetator/, 'Researcher'], [/\bindustrie\b/, 'Working in industry'], [/^(altele|altul|alta|altceva)$/, 'Other']],
		'Experience': [[/^inca (nimic|niciuna|nicio)/, 'None yet, curious'], [/^incepator/, 'Beginner: a course or some tutorials'],
			[/^intermediar/, 'Intermediate: built circuits or small projects'], [/^avansat/, 'Advanced: research or work in the field']],
		'Heard from': [[/\b(universitatea|facultatea) mea\b/, 'My university'], [/\b(prieten|coleg)/, 'A friend or colleague'],
			[/\bam fost la breaq\b/, 'I was at BreaQ 2025'], [/^(altele|altul|alta|altceva)$/, 'Other']]
	};

	function untranslate(records) {
		records.forEach(function (r) {
			Object.keys(TRANSLATED).forEach(function (col) {
				var v = get(r, col);
				var rules = TRANSLATED[col];
				if (!v || rules.some(function (x) { return x[1] === v; })) return;
				var f = fold(v).replace(/[^a-z0-9]+/g, ' ').trim();
				for (var i = 0; i < rules.length; i++) if (rules[i][0].test(f)) { setCell(r, col, rules[i][1]); return; }
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

	// in order: the specific before the general (Politehnica Timișoara before Politehnica, ASE before "Bucharest University",
	// a faculty on its own after every university by name);
	// each with the city it is in, for the City breakdown and Edition in numbers
	var INSTITUTIONS = [
		['Universitatea Politehnica Timișoara (UPT)', /\bupt\b|\bpolitehnica\b.*\btimisoara\b|\btimisoara\b.*\bpolitehnica\b/, 'Timișoara'],
		['Universitatea Tehnică „Gheorghe Asachi” din Iași (TUIASI)', /\btuiasi\b|gheorghe asachi|\bpolitehnica\b.*\biasi\b|\biasi\b.*\bpolitehnica\b/, 'Iași'],
		['Universitatea Tehnică din Cluj-Napoca (UTCN)', /\butcn\b|universitatea tehnica (din )?cluj|technical universitatea (of )?cluj|\bpolitehnica\b.*\bcluj\b/, 'Cluj-Napoca'],
		['ASE București', /\base\b|academia de studii economice|economic studies/, 'București'],
		['UMF „Carol Davila” București', /carol davila/, 'București'],
		['SNSPA', /\bsnspa\b|studii politice|political studies/, 'București'],
		// abroad, before Politehnica: "National Polytechnic School" reads as politehnica. On its own, the École nationale
		// polytechnique is the one in Algiers; Oran and Constantine have theirs
		['École Nationale Polytechnique d’Alger (ENP)', /^(?!.*\b(oran|constantine)\b).*(ecole nationale polytechnique|national politehnica school|\benp\b.*\b(alger|algiers)\b)/, 'Alger'],
		['POLITEHNICA București (UNSTPB)', /\b(unstpb|upb|acs|etti|fils|faima|fiir)\b|\bpolitehnica\b|nationala de stiinta si tehnologie|national universitatea of science and technology|science and technology\b.*\bbucuresti|stiinta si tehnologie\b.*\bbucuresti/, 'București'],
		['Universitatea din București (UB)', /\b(ub|unibuc)\b|universitatea (din |of )?bucuresti|bucuresti universitatea|geologie si geofizica|geology and geophysics/, 'București'],
		['Academia Tehnică Militară „Ferdinand I” (ATM)', /\b(atm|mta)\b|academia tehnica militara|(military technical|technical military) academy/, 'București'],
		['Universitatea Babeș-Bolyai (UBB)', /\bubb\b|babes bolyai/, 'Cluj-Napoca'],
		['Universitatea „Alexandru Ioan Cuza” din Iași (UAIC)', /\buaic\b|alexandru ioan cuza/, 'Iași'],
		['Universitatea de Vest din Timișoara (UVT)', /\buvt\b|universitatea de vest|west universitatea/, 'Timișoara'],
		['Universitatea din Craiova', /\bucv\b|universitatea (din |of )?craiova|craiova universitatea/, 'Craiova'],
		['Universitatea Transilvania din Brașov', /\bunitbv\b|universitatea transilvania|transilvania universitatea/, 'Brașov'],
		['Universitatea Ovidius din Constanța', /\bovidius\b/, 'Constanța'],
		['Universitatea Tehnică de Construcții București (UTCB)', /\butcb\b|constructii bucuresti|civil engineering bucuresti/, 'București'],
		['Universitatea „Lucian Blaga” din Sibiu', /\bulbs\b|lucian blaga/, 'Sibiu'],
		['Universitatea „Ștefan cel Mare” din Suceava', /\busv\b|stefan cel mare/, 'Suceava'],
		['Universitatea „Dunărea de Jos” din Galați', /dunarea de jos/, 'Galați'],
		['Universitatea Româno-Americană', /romano americana|romanian american/, 'București'],
		['Universitatea Titu Maiorescu', /titu maiorescu/, 'București'],
		['IFIN-HH', /\bifin\b|horia hulubei/, 'Măgurele'],
		['ELI-NP', /\beli ?np\b|extreme light/, 'Măgurele'],
		['INFLPR', /\binflpr\b|fizica laserilor|lasers plasma and radiation/, 'Măgurele'],
		// last, once no university is named: a faculty written on its own, in Bucharest unless another city says it is
		// elsewhere ("Automatică și Calculatoare" is also in Iași, Cluj and Timișoara, "Matematică și Informatică" in
		// Cluj, Iași and Timișoara)
		['POLITEHNICA București (UNSTPB)', /^(?!.*\b(cluj|iasi|timisoara|craiova|brasov|galati|constanta|sibiu|suceava|oradea|pitesti|ploiesti)\b).*\b(automatica si calculatoare|automatic control (and )?computer|electronica telecomunicatii|electronics telecommunications|inginerie aerospatiala|aerospace engineering)\b/, 'București'],
		['Universitatea din București (UB)', /^(?!.*\b(cluj|iasi|timisoara|craiova|brasov|galati|constanta|sibiu|suceava|oradea|pitesti|ploiesti)\b).*\b(matematica si informatica|mathematics and computer science|facultatea de fizica|faculty of physics)\b/, 'București']
	];

	var CITY = {};
	INSTITUTIONS.forEach(function (i) { CITY[i[0]] = i[2]; });

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

	// a company, for someone working in industry: all of them count as one
	var INDUSTRY = 'Industry';

	// "-", "n/a", "none", "nu": written in the box, but not an answer (the words as words() leaves them)
	var NO_ANSWER = /^(n ?a|none|no|nope|nu|nimic|nicio|niciuna|x|null)?$/;

	// sets r.org on every record: the merged name, or '' when the question was not answered
	function groupOrgs(records) {
		var keys = {};
		records.forEach(function (r) {
			var raw = get(r, 'University or company');
			if (NO_ANSWER.test(words(raw))) raw = '';
			r.org = raw ? institution(raw) : '';
			if (raw && !r.org && get(r, 'Status') === 'Working in industry') r.org = INDUSTRY;
			r.orgKey = raw && !r.org ? orgKey(raw) : '';
			if (!r.orgKey) return;
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
			r.city = CITY[r.org] || '';
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

	// for a save that can go twice and change nothing more (a vote sets the same vote and note again) and for a
	// reading (a letter): when Google does not answer, answers with its error page or could not read just then
	// (temporary, only ever said of a reading), it is tried again, three times in all, as the list is. Not after a
	// time-out: the first one may still be at work.
	function postAgain(body, timeout, done) {
		var started = Date.now();
		var tries = 0;
		(function attempt() {
			tries++;
			post(body, timeout, function (json, err) {
				var again = json ? !!json.temporary : err && err.name !== 'AbortError';
				if (again && tries < 3 && Date.now() - started < 40000) window.setTimeout(attempt, tries * 1500);
				else done(json, err);
			});
		})();
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
		state.tracking = {};
		state.accessing = {};
		state.detail = null;
		if ($('detail').open) $('detail').close();
		if ($('send-dlg').open) $('send-dlg').close();
		if ($('mail-dlg').open) $('mail-dlg').close();
		state.picked = {};
		state.onlyPicked = false;
		keepPicked();
		renderPickBar();
		forgetLetters();
		stopScan();
		forEach(['tiles', 'days', 'breakdowns'], function (id) { $(id).textContent = ''; });
		$('people').tBodies[0].textContent = '';
		$('search').value = '';
		state.query = '';
		state.problems = false;
		state.facets = {};
		state.extra = {};
		state.from = state.to = '';
		board.loaded = false;
		board.items = [];
		board.busy = {};
		state.codes = {};
		state.teams = [];
		state.mentors = null;
		state.feedback = [];
		state.photos = null;
		pics.busy = {};
		renderPicsBadge();
		state.voter = '';
		state.voters = [];
		state.shared = false;
		state.looking = false;
		forgetVoter();
		if ($('who-dlg').open) $('who-dlg').close();
		if (state.decision === 'tovote') state.decision = 'any';
		teamsUi.editing = null;
		forEach(['board-list', 'teams-list', 'loose', 'checkin-list', 'cert-result', 'fb-best', 'fb-change', 'fb-learned', 'fb-other', 'pics-waiting', 'pics-up'], function (id) { $(id).textContent = ''; });
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
		if (!key) { lockError('Paste your key first.'); keyInput.focus(); return; }
		unlock(key, $('remember').checked);
	});

	$('lock-now').addEventListener('click', function () {
		if (poolSize() && !window.confirm(plural(poolSize(), 'grade is', 'grades are') + ' not sent yet, and Lock forgets them. Lock anyway?')) return;
		lock('');
	});

	/* --- who is reading, with the shared key ----------------------------------------- */

	// Only the organisers have the shared key: opened with it, the page asks who is reading and votes in their
	// name (the Apps Script takes "as" from the shared key only). The device keeps the answer as long as the key.
	var VOTER_STORE = 'breaq-2026-voter';
	var whoDlg = $('who-dlg');

	function chosenVoter() {
		try { return window.sessionStorage.getItem(VOTER_STORE) || window.localStorage.getItem(VOTER_STORE) || ''; }
		catch (e) { return ''; }
	}

	function chooseVoter(name) {
		try {
			window.sessionStorage.setItem(VOTER_STORE, name);
			if (remembered()) window.localStorage.setItem(VOTER_STORE, name);
			else window.localStorage.removeItem(VOTER_STORE);
		} catch (e) {}
	}

	function forgetVoter() {
		try { window.sessionStorage.removeItem(VOTER_STORE); window.localStorage.removeItem(VOTER_STORE); } catch (e) {}
	}

	function askWho() {
		var grid = $('who-grid');
		grid.textContent = '';
		state.voters.forEach(function (v) {
			var b = el('button', 'btn who-btn', v);
			b.type = 'button';
			b.setAttribute('aria-pressed', String(v === state.voter));
			b.addEventListener('click', function () { setWho(v); });
			grid.appendChild(b);
		});
		if (whoDlg.open) return;
		if (typeof whoDlg.showModal === 'function') whoDlg.showModal();
		else whoDlg.setAttribute('open', '');
	}

	function setWho(v) {
		if (v) chooseVoter(v);
		else forgetVoter();
		if (v !== state.voter) sendPool();   // the grades not sent yet go in the name they were made in
		state.voter = v;
		state.looking = !v;
		applyPool();
		if (whoDlg.open) {
			if (typeof whoDlg.close === 'function') whoDlg.close();
			else whoDlg.removeAttribute('open');
		}
		if (!v && state.decision === 'tovote') state.decision = 'any';
		renderMeta();
		renderEvent();
		renderView();
		if (dialog.open && state.detail) renderDetail(state.detail);
	}

	$('who-none').addEventListener('click', function () { setWho(''); });
	whoDlg.addEventListener('cancel', function (ev) { ev.preventDefault(); setWho(state.voter); });

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
		untranslate(state.records);
		groupOrgs(state.records);
		buildTeams(state.records);
		prunePicked();
		state.sheet = json.sheet || '';
		state.codes = json.codes || {};   // the dashboard code of each accepted participant, by email
		state.teams = json.teams || [];
		state.audience = json.audience || null;   // the audience award's vote (an older Apps Script: null)
		state.screenKey = typeof json.screenKey === 'string' ? json.screenKey : null;   // the big screen's password
		state.flash = json.flash === undefined ? undefined : json.flash;   // its live message (undefined: an older Apps Script)
		state.mentors = json.mentors || null;
		state.feedback = json.feedback || [];
		state.photos = json.photos;   // { waiting, shown }; null when Drive could not be read, undefined from an older Apps Script
		state.activity = json.activity || null;
		state.certificate = json.certificate || '';
		state.voters = json.voters || [];
		state.majority = json.majority || 0;
		state.grades = json.grades || null;
		// an Apps Script from before the grades still counts yes and no: no grading until it is deployed again
		var old = state.voters.length > 0 && !state.grades;
		if (old) state.voters = [];
		// a personal key votes as its own; the shared one as whoever this device says it is (asked below)
		state.shared = !json.voter && state.voters.length > 0;
		state.voter = old ? '' : json.voter || (state.shared && state.voters.indexOf(chosenVoter()) !== -1 ? chosenVoter() : '');
		if (state.decision === 'tovote' && !state.voter) state.decision = 'any';
		applyPool();
		state.at = json.at ? new Date(json.at) : new Date();
		state.emailsLeft = typeof json.emailsLeft === 'number' ? json.emailsLeft : null;
		$('lock').hidden = true;
		$('dash').hidden = false;
		renderMeta();
		renderTiles();
		renderEvent();
		renderView();
		renderPicsBadge();
		if (old) dashError('The Apps Script still counts Yes and No, and this page gives grades from 1 to 10: paste tools/register-backend.gs into the editor, then Deploy → Manage deployments → pencil → Version: New version → Deploy. Until then nobody can grade.');
		if (state.shared && !state.voter && !state.looking) askWho();
	}

	function renderMeta() {
		var parts = ['Updated ' + fmtClock.format(state.at)];
		if (state.emailsLeft !== null) parts.push(plural(state.emailsLeft, 'email', 'emails') + ' left today');
		if (voting()) parts.push(state.voter ? 'Grading as ' + state.voter : 'Just looking');
		var meta = $('meta');
		meta.textContent = parts.join(' · ');
		if (state.shared) {
			var who = el('button', 'meta-who', state.voter ? 'not ' + state.voter + '?' : 'who are you?');
			who.type = 'button';
			who.addEventListener('click', askWho);
			meta.appendChild(document.createTextNode(' · '));
			meta.appendChild(who);
		}
		var sheet = $('sheet-link');
		sheet.hidden = !isUrl(state.sheet);
		if (!sheet.hidden) sheet.href = state.sheet;
	}

	// everything that follows the event switch: the chart, the breakdowns and the table
	function renderEvent() {
		var rs = state.records.filter(function (r) { return inEvent(r, state.event); });
		state.people = people(rs);
		renderMore();
		renderFiltered();
		renderSendPanel();
		renderReviewPanel();
	}

	// what follows the filters: registrations per day (each registration), what people answered (each person once),
	// the table and the filters on
	function renderFiltered() {
		var regs = [];
		state.people.forEach(function (p) {
			if (passes(p)) p.regs.forEach(function (r) { if (inEvent(r, state.event)) regs.push(r); });
		});
		renderDays(regs);
		renderBreakdowns();
		renderTable();
		renderChips();
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
			['Conference', conf],
			['Hackathon', hack, 'Registration closed on 18 October', 'tile--shade'],
			['People', everyone.length, 'Each person once, also when registered for both events'],
			['Last 24 hours', recent]
		].forEach(function (t) {
			var tile = el('div', 'tile' + (t[3] ? ' ' + t[3] : ''));
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
				else renderFiltered();
				if (state.problems) $('people-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
			});
		} else {
			state.problems = false;
		}
		box.appendChild(tile);

		// the Quantum Hacking teams email without an answer: a button for the Team page filter, once it went out
		var emailed = 0, silent = 0, answered = 0, denied = 0;
		everyone.forEach(function (p) {
			var h = hackReg(p);
			if (!h || !/Quantum Hacking teams email sent/.test(get(h, 'Emails'))) return;
			emailed++;
			if (hackingSilent(h)) silent++;
			else if (get(h, 'Team answered') || /answered on the team page/.test(get(h, 'Merged'))) answered++;
			else if (!get(h, 'Team')) denied++;
		});
		if (!emailed) return;
		var had = emailed - silent - answered - denied;
		var qt = el('button', 'tile tile--ask');
		qt.type = 'button';
		qt.id = 'qh-silent';
		qt.appendChild(el('span', 'tile-label', 'Quantum Hacking: not answered yet'));
		qt.appendChild(el('span', 'tile-value', String(silent)));
		qt.appendChild(el('span', 'tile-sub', 'of ' + emailed + ' emailed: ' + answered + ' answered, ' + had + ' had answered on the form' + (denied ? ', ' + denied + ' denied' : '')));
		qt.title = 'Still to answer the Quantum Hacking teams email: those who had no answer on their form and have not answered on the team page (the denied left out). Those who had one were told there was nothing to do. Click to list only them';
		qt.setAttribute('aria-pressed', String(state.extra.tpage === 'qh'));
		qt.addEventListener('click', function () {
			if (state.extra.tpage === 'qh') delete state.extra.tpage;
			else state.extra.tpage = 'qh';
			if (state.extra.tpage && state.event === 'conference') setEvent('hackathon');
			else { renderMore(); renderFiltered(); }
			if (state.extra.tpage) $('people-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
		box.appendChild(qt);
	}

	/* --- event switch and search ----------------------------------------- */

	function setEvent(ev) {
		state.event = ev;
		pressEvent();
		renderEvent();
	}

	function pressEvent() {
		forEach($('f-event').querySelectorAll('button'), function (b) {
			b.setAttribute('aria-pressed', String(b.getAttribute('data-event') === state.event));
		});
	}

	// the event picked by hand stays on this browser; until then, the conference
	function storedEvent() {
		var ev = '';
		try { ev = window.localStorage.getItem(EVENT_STORE) || ''; } catch (e) {}
		return ev === 'hackathon' || ev === 'all' ? ev : 'conference';
	}

	forEach($('f-event').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () {
			var ev = b.getAttribute('data-event');
			try { window.localStorage.setItem(EVENT_STORE, ev); } catch (e) {}
			setEvent(ev);
		});
	});
	pressEvent();

	// the Who and Decision tabs above the table
	forEach($('f-kind').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () { state.kind = b.getAttribute('data-kind'); renderFiltered(); });
	});

	forEach($('f-decision').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () { state.decision = b.getAttribute('data-decision'); renderFiltered(); });
	});

	$('search').addEventListener('input', function () {
		state.query = fold(this.value).trim();
		renderFiltered();
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

	// the hackathon form's team question, as stored in the "Team" column (match: the organisers put them in a team)
	var TEAM_LABEL = { solo: 'On my own', team: 'With a team', match: 'Put me in a team' };

	function teamOf(r) {
		var t = get(r, 'Team');
		if (t === 'team') return 'With ' + (get(r, 'Team name and members') || 'a team');
		return TEAM_LABEL[t] || t;
	}

	// had the Quantum Hacking teams email (sendHackingTeams) without an answer on their form, and has not answered
	// it: any answer on the team page fills "Team". Those with an answer already were told there was nothing to
	// do, and the denied are out anyway.
	function hackingSilent(h) {
		return /Quantum Hacking teams email sent/.test(get(h, 'Emails')) && !get(h, 'Team') && decisionOf(h) !== 'denied';
	}

	// the forms' own order for the answers they offer; free text sorts by count
	// id: the breakdown's filter; value: what to count when it is not a column
	var BREAKDOWNS = [
		{ id: 'status', col: 'Status', title: 'You are', order: ['High-school student', 'Bachelor student', 'Master student', 'PhD student', 'Researcher', 'Working in industry', 'Other'] },
		{ id: 'exp', col: 'Experience', title: 'Experience', order: ['None yet, curious', 'Beginner: a course or some tutorials', 'Intermediate: built circuits or small projects', 'Advanced: research or work in the field'], short: true },
		{ id: 'tracks', col: 'Tracks', title: 'Tracks', order: ['Quantum Foundations', 'Quantum AI', 'Quantum Hacking', 'Not sure yet'], multi: true },
		// the track given, from the hackathon registration (where a change shows at once)
		{ id: 'htrack', title: 'Track given', order: TRACKS, done: 'given',
			value: function (p) { var h = hackReg(p); return h ? trackOf(h) : ''; } },
		{ id: 'tshirt', col: 'T-shirt', title: 'T-shirts', order: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
		// asked only with the Quantum AI or Quantum Hacking track (the first form asked everyone, so earlier answers
		// with neither are left out)
		{ id: 'team', col: 'Team', title: 'Alone or in a team', labels: TEAM_LABEL, order: [TEAM_LABEL.solo, TEAM_LABEL.team, TEAM_LABEL.match],
			only: function (r) { return /quantum (ai|hacking)/i.test(get(r, 'Tracks')); } },
		{ id: 'org', col: 'University or company', title: 'University or company', top: 15, merged: true },
		// the city of a known university (INSTITUTIONS); the others are not counted
		{ id: 'city', title: 'City', value: function (r) { return r.city; }, top: 8 },
		{ id: 'heard', col: 'Heard from', title: 'Heard about BreaQ from' }
	];

	// what a person answered for a breakdown; for the merged one, nothing when it was not an answer ("-", "n/a")
	function rawOf(r, b) { return b.merged && !r.org ? '' : b.value ? b.value(r) : get(r, b.col); }

	// the keys a person counts under in a breakdown, as tally makes them
	function bdKey(label) { return fold(label).replace(/\s+/g, ' '); }

	function facetValues(r, b) {
		var raw = rawOf(r, b);
		if (!raw || (b.only && !b.only(r))) return [];
		return (b.multi ? raw.split(/\s*,\s*/) : [raw]).filter(Boolean).map(function (val) {
			return bdKey(b.merged ? r.org : (b.labels && b.labels[val]) || val);
		});
	}

	// items: { label, n, spellings: { as written: n } }; for a merged column the label is the merged name (groupOrgs)
	function tally(rs, b) {
		var groups = {};
		rs.forEach(function (r) {
			var raw = rawOf(r, b);
			if (!raw || (b.only && !b.only(r))) return;
			(b.multi ? raw.split(/\s*,\s*/) : [raw]).forEach(function (val) {
				if (!val) return;
				var label = b.merged ? r.org : (b.labels && b.labels[val]) || val;
				var k = bdKey(label);
				var g = groups[k] || (groups[k] = { key: k, label: label, n: 0, spellings: {} });
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

	// each breakdown counts the people every other filter leaves (so its own bars stay to pick from); a bar is a
	// filter: click it to keep only those people, click more to add to them, click again to drop it
	function renderBreakdowns() {
		var box = $('breakdowns');
		box.textContent = '';

		BREAKDOWNS.forEach(function (b) {
			var rs = state.people.filter(function (p) { return passes(p, b); });
			var items = tally(rs, b);
			var on = state.facets[b.id] || [];
			if (!items.length && !on.length) return;
			var answered = rs.filter(function (r) { return rawOf(r, b) && (!b.only || b.only(r)); }).length;
			var max = Math.max.apply(null, items.map(function (it) { return it.n; }).concat(1));

			var panel = el('section', 'panel bd' + (on.length ? ' is-filtering' : ''));
			var h = el('h2', null, b.title);
			h.appendChild(el('span', 'count', answered + ' ' + (b.done || 'answered')));
			panel.appendChild(h);
			var list = el('ul', 'bars');
			items.forEach(function (it) {
				var picks = it.other ? it.members.map(function (m) { return { k: m.key, label: m.label }; }) : [{ k: it.key, label: it.label }];
				var picked = picks.every(function (x) { return on.some(function (o) { return o.k === x.k; }); });
				var li = el('li', (it.other ? 'is-other' : '') + (picked ? ' is-on' : on.length ? ' is-dim' : ''));
				li.tabIndex = 0;
				li.setAttribute('role', 'button');
				li.setAttribute('aria-pressed', String(picked));
				li.title = picked ? 'Click to drop this filter' : 'Click to keep only these people';
				li.addEventListener('click', function (ev) {
					if (ev.target.closest('details')) return;   // the spellings under a merged name
					toggleFacet(b, picks);
				});
				li.addEventListener('keydown', function (ev) {
					if (ev.target !== li || (ev.key !== 'Enter' && ev.key !== ' ')) return;
					ev.preventDefault();
					toggleFacet(b, picks);
				});
				var label = b.short ? it.label.split(':')[0] : it.label;
				var name = el('span', 'bar-label', label);
				if (label !== it.label) name.title = it.label;
				li.appendChild(name);
				var value = el('span', 'bar-value', String(it.n));
				value.appendChild(el('small', null, Math.round(it.n / (answered || 1) * 100) + '%'));
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
		var diet = state.people.filter(function (p) { return passes(p) && get(p, 'Dietary'); });
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

	/* --- filters -------------------------------------------------------------- */

	// More filters: what the bars do not show. hack: on the person's hackathon registration (and only in the
	// hackathon views); when: shown only then
	var EXTRAS = [
		{ key: 'myvote', label: 'Your grade', hack: true, when: function () { return !!state.voter; },
			options: [['none', 'Not graded yet'], ['accepted', 'High (accept)'], ['waitlist', 'Middle (waitlist)'], ['denied', 'Low (deny)']],
			test: function (h, v) { var x = voteOf(h, state.voter); return v === 'none' ? !x : !!x && bandOf(x) === v; } },
		{ key: 'votes', label: 'Grades', hack: true, when: voting,
			options: [['none', 'Nobody graded yet'], ['some', 'Some grades, undecided'], ['notes', 'With notes you can see']],
			test: function (h, v) {
				var n = votesIn(h);
				if (v === 'none') return !n;
				if (v === 'some') return n > 0 && !decisionOf(h);
				return revealed([h]) && state.voters.some(function (x) { return noteOf(h, x); });
			} },
		{ key: 'demail', label: 'Decision email', hack: true,
			options: [['due', 'Decided, not emailed yet'], ['sent', 'Emailed'], ['hand', 'Emailed by hand']],
			test: function (h, v) {
				var d = decisionOf(h), m = emailedOf(h);
				if (!d) return false;
				var sent = !!m && m.sent && m.decision === d;
				return v === 'due' ? !sent : v === 'hand' ? sent && byHand(h) : sent;
			} },
		{ key: 'link', label: 'Dashboard link', hack: true,
			options: [['no', 'Accepted, never emailed it'], ['yes', 'Accepted, has it']],
			test: function (h, v) { return decisionOf(h) === 'accepted' && hasLink(h) === (v === 'yes'); } },
		{ key: 'letter', label: 'Motivation letter', hack: true,
			options: [['yes', 'In Drive'], ['no', 'Missing or failed']],
			test: function (h, v) { return isUrl(get(h, 'Motivation letter')) === (v === 'yes'); } },
		{ key: 'coming', label: 'Coming', hack: true,
			options: [['yes', 'Yes'], ['no', 'Cannot come'], ['open', 'Accepted, not answered'], ['silent', 'No answer, had the link before 21 Oct'], ['off', 'Code off']],
			test: function (h, v) {
				if (v === 'off') return codeOff(h);
				if (v === 'silent') return silent(h);
				var c = comingOf(h);
				return v === 'open' ? decisionOf(h) === 'accepted' && !c && !codeOff(h) : c === v;
			} },
		{ key: 'checked', label: 'Checked in', hack: true,
			options: [['yes', 'Yes'], ['no', 'Not yet']],
			test: function (h, v) { return !!get(h, 'Checked in') === (v === 'yes'); } },
		{ key: 'tpage', label: 'Team page', hack: true,
			options: [['yes', 'Answered'], ['qh', 'Quantum Hacking email, no answer'], ['no', 'Emailed, not answered yet']],
			test: function (h, v) {
				if (v === 'qh') return hackingSilent(h);
				// before "Team answered" existed, only a change left a trace, in Merged
				if (get(h, 'Team answered') || /answered on the team page/.test(get(h, 'Merged'))) return v === 'yes';
				return v === 'no' && /Quantum Hacking teams email sent|Teammates reminder sent/.test(get(h, 'Emails'));
			} },
		{ key: 'htrack', label: 'Track given', hack: true,
			options: [['none', 'Not yet']].concat(TRACKS.map(function (t) { return [t, t]; })),
			test: function (h, v) { return trackOf(h) === (v === 'none' ? '' : v); } },
		{ key: 'hteam', label: 'Put in a team', hack: true,
			options: [['yes', 'Yes'], ['no', 'Not yet']],
			test: function (h, v) { return !!get(h, 'Hackathon team') === (v === 'yes'); } },
		{ key: 'applied', label: 'Applied',
			options: [['twice', 'More than once'], ['once', 'Once']],
			test: function (p, v) {
				var again = p.regs.some(function (r) { return /applied again/.test(get(r, 'Merged')); });
				return again === (v === 'twice');
			} },
		{ key: 'mail', label: 'Confirmation email',
			options: [['sent', 'Sent'], ['failed', 'Failed'], ['held', 'Held']],
			test: function (p, v) { return p.mail === v; } }
	];

	function filtersOn() {
		return Object.keys(state.facets).length > 0 || EXTRAS.some(extraOn) || !!(state.from || state.to);
	}

	function extraOn(x) {
		return !!state.extra[x.key] && (!x.when || x.when()) && !(x.hack && state.event === 'conference');
	}

	function firstTime(p) {
		var ts = p.regs.filter(function (r) { return r.time; }).map(function (r) { return r.time.getTime(); });
		return ts.length ? new Date(Math.min.apply(null, ts)) : null;
	}

	// everything that filters the table, the chart and the bars; skip: a breakdown whose own bars do not count
	function passes(p, skip) {
		if (state.onlyPicked && !isPicked(p)) return false;
		if (state.query && p.text.indexOf(state.query) === -1) return false;
		if (state.problems && !p.problem) return false;
		if (!inTabs(p)) return false;
		var h;
		for (var i = 0; i < EXTRAS.length; i++) {
			var x = EXTRAS[i];
			if (!extraOn(x)) continue;
			if (!x.hack) { if (!x.test(p, state.extra[x.key])) return false; continue; }
			h = h || hackReg(p);
			if (!h || !x.test(h, state.extra[x.key])) return false;
		}
		if (state.from || state.to) {
			var t = firstTime(p);
			if (!t || (state.from && dayKey(t) < state.from) || (state.to && dayKey(t) > state.to)) return false;
		}
		return BREAKDOWNS.every(function (b) {
			var on = state.facets[b.id];
			if (b === skip || !on || !on.length) return true;
			var mine = facetValues(p, b);
			return on.some(function (o) { return mine.indexOf(o.k) !== -1; });
		});
	}

	// a bar (or "N others"): on when not all of it was on, else off
	function toggleFacet(b, picks) {
		var on = state.facets[b.id] || [];
		var all = picks.every(function (x) { return on.some(function (o) { return o.k === x.k; }); });
		on = all
			? on.filter(function (o) { return !picks.some(function (x) { return x.k === o.k; }); })
			: on.concat(picks.filter(function (x) { return !on.some(function (o) { return o.k === x.k; }); }));
		if (on.length) state.facets[b.id] = on;
		else delete state.facets[b.id];
		renderFiltered();
	}

	function clearFilters() {
		state.onlyPicked = false;
		state.facets = {};
		state.extra = {};
		state.from = state.to = '';
		renderMore();
		renderFiltered();
	}

	// the filters on, each one click away from off; how many people they leave
	function renderChips() {
		var qt = $('qh-silent');
		if (qt) qt.setAttribute('aria-pressed', String(state.extra.tpage === 'qh'));
		var box = $('chips');
		box.textContent = '';
		var chips = [];
		if (state.onlyPicked) chips.push(['Only the selected', function () { state.onlyPicked = false; renderFiltered(); }]);
		BREAKDOWNS.forEach(function (b) {
			(state.facets[b.id] || []).forEach(function (o) {
				chips.push([b.title + ': ' + o.label, function () { toggleFacet(b, [o]); }]);
			});
		});
		var extras = 0;
		EXTRAS.forEach(function (x) {
			if (!extraOn(x)) return;
			extras++;
			var opt = x.options.filter(function (o) { return o[0] === state.extra[x.key]; })[0];
			chips.push([x.label + ': ' + (opt ? opt[1] : state.extra[x.key]), function () { delete state.extra[x.key]; renderMore(); renderFiltered(); }]);
		});
		if (state.from) { extras++; chips.push(['Registered from ' + fmtAxis.format(new Date(state.from + 'T12:00:00')), function () { state.from = ''; renderMore(); renderFiltered(); }]); }
		if (state.to) { extras++; chips.push(['Registered until ' + fmtAxis.format(new Date(state.to + 'T12:00:00')), function () { state.to = ''; renderMore(); renderFiltered(); }]); }
		chips.forEach(function (c) {
			var b = el('button', 'chip', c[0]);
			b.type = 'button';
			b.appendChild(el('span', 'chip-x', '✕'));
			b.setAttribute('aria-label', 'Remove the filter ' + c[0]);
			b.addEventListener('click', c[1]);
			box.appendChild(b);
		});
		if (chips.length > 1) {
			var all = el('button', 'chip-clear', 'Clear all');
			all.type = 'button';
			all.addEventListener('click', clearFilters);
			box.appendChild(all);
		}
		var left = state.people.filter(function (p) { return passes(p); }).length;
		$('filter-count').textContent = chips.length ? plural(left, 'person', 'people') + ' of ' + state.people.length : '';
		$('more-filters').textContent = 'More filters' + (extras ? ' · ' + extras : '');
	}

	// the More filters panel: the dates, then a choice for each filter that applies here
	function renderMore() {
		var box = $('more-panel');
		box.textContent = '';
		var grid = el('div', 'more-grid');
		[['from', 'Registered from'], ['to', 'Registered until']].forEach(function (d) {
			var f = el('label', 'more-field');
			f.appendChild(el('span', 'more-label', d[1]));
			var input = el('input');
			input.type = 'date';
			input.value = state[d[0]];
			input.addEventListener('change', function () { state[d[0]] = input.value; renderFiltered(); });
			f.appendChild(input);
			grid.appendChild(f);
		});
		EXTRAS.forEach(function (x) {
			if ((x.when && !x.when()) || (x.hack && state.event === 'conference')) return;
			var f = el('label', 'more-field');
			f.appendChild(el('span', 'more-label', x.label));
			var sel = el('select');
			[['', 'Any']].concat(x.options).forEach(function (o) {
				var opt = el('option', null, o[1]);
				opt.value = o[0];
				sel.appendChild(opt);
			});
			sel.value = state.extra[x.key] || '';
			sel.addEventListener('change', function () {
				if (sel.value) state.extra[x.key] = sel.value;
				else delete state.extra[x.key];
				renderFiltered();
			});
			f.appendChild(sel);
			grid.appendChild(f);
		});
		box.appendChild(grid);
		var clear = el('button', 'btn small ghost', 'Clear every filter');
		clear.type = 'button';
		clear.addEventListener('click', clearFilters);
		box.appendChild(clear);
	}

	$('more-filters').addEventListener('click', function () {
		var panel = $('more-panel');
		panel.hidden = !panel.hidden;
		this.setAttribute('aria-expanded', String(!panel.hidden));
	});

	/* --- the table -------------------------------------------------------- */

	function cellText(text, cls) { var td = el('td', cls, text); return td; }

	var COLUMNS = [
		// picked for an email; in the head, everyone the table shows
		{ key: 'pick', label: '', always: true, cls: 'c-pick',
			head: function (rs) { return pickBox(rs, 'Select everyone in the list'); },
			cell: function (r, i) {
				var td = el('td', 'c-pick');
				var label = el('label');
				label.appendChild(pickBox([r], 'Select ' + (r.name || r.email), i));
				td.appendChild(label);
				return td;
			} },
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
		// the hackathon decision, or the grades that make it: with grades, the highest average first when sorted (one
		// the reader may not see yet goes with the ungraded), else undecided first
		{ key: 'decision', label: function () { return voting() ? 'Grade' : 'Decision'; }, always: true,
			when: function () { return state.event !== 'conference'; },
			sort: function (r) {
				var h = hackReg(r);
				if (!h) return voting() ? -1 : 99;
				if (!voting()) return DECISIONS.indexOf(decisionOf(h)) + 1;
				var g = gradesOf(h);
				return g.n && revealed([h]) ? g.avg : 0;
			},
			cell: function (r) {
				var td = el('td', 'c-decision');
				var h = hackReg(r);
				if (h) td.appendChild(voting() ? voteCell([h], r.name || 'this person') : decisionControl([h], r.name || 'this person'));
				return td;
			} },
		// the track given, in a list (the ones they ticked have a ✓)
		{ key: 'track', label: 'Track', always: true, cls: 'c-track hide-sm',
			when: function () { return state.event !== 'conference'; },
			sort: function (r) { var h = hackReg(r); return h ? TRACKS.indexOf(trackOf(h)) : 9; },
			cell: function (r) {
				var td = el('td', 'c-track hide-sm');
				var h = hackReg(r);
				if (h) td.appendChild(trackControl([h], r.name || 'this person'));
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
			cell: function (r) {
				var h = hackReg(r), at = h && get(h, 'Team answered');
				if (h && hackingSilent(h)) {
					var quiet = cellText('No answer', 'hide-md c-team c-silent');
					quiet.title = 'Had the Quantum Hacking teams email and has not answered it';
					return quiet;
				}
				var td = cellText(teamOf(r), 'hide-md c-team');
				if (at && !isNaN(new Date(at))) td.title = 'Answered on the team page ' + fmtShort.format(new Date(at));
				return td;
			} },
		// the hackathon itself, once there is something in these: the team they are in, their "are you coming?"
		{ key: 'hteam', label: 'In team', col: 'Hackathon team', cls: 'hide-md' },
		// once someone is accepted: their answer, or that their code is off
		{ key: 'coming', label: 'Coming', cls: 'hide-sm',
			when: function () { return state.event !== 'conference' && state.people.some(function (p) { var h = hackReg(p); return h && decisionOf(h) === 'accepted'; }); },
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

	// the Who tab a hackathon registration is under: in a team (named, or naming someone), to be put in one, or
	// on their own
	function whoKind(h) {
		if (h.team) return 'teams';
		return get(h, 'Team') === 'match' ? 'match' : 'solo';
	}

	// the Who and Decision tabs are about the hackathon: any other choice than All and Any leaves out people
	// who are only at the conference
	function inTabs(p) {
		if (state.event === 'conference' || (state.kind === 'all' && state.decision === 'any')) return true;
		var h = hackReg(p);
		if (!h) return false;
		if (state.kind !== 'all' && state.kind !== whoKind(h)) return false;
		if (state.decision === 'tovote') return needsMe(h);
		return state.decision === 'any' || decisionOf(h) === (state.decision === 'none' ? '' : state.decision);
	}

	function visible() {
		var rs = state.people.filter(function (p) { return passes(p); });
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
			if (c.head) {
				th.appendChild(c.head(rs));
				headRow.appendChild(th);
				return;
			}
			var b = el('button', 'sort-btn', typeof c.label === 'function' ? c.label() : c.label);
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
			var tr = el('tr', isPicked(r) ? 'is-picked' : null);
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
		renderPickBar();
	}

	// the Who and Decision tabs, with how many people each holds (the decisions within the Who tab chosen)
	function renderTabs() {
		$('filters').hidden = state.event === 'conference';
		if (state.event === 'conference') return;
		var counts = { all: state.people.length, teams: 0, solo: 0, match: 0, tovote: 0, none: 0, accepted: 0, waitlist: 0, denied: 0 };
		state.people.forEach(function (p) {
			var h = hackReg(p);
			if (!h) return;
			var kind = whoKind(h);
			counts[kind]++;
			if (state.kind !== 'all' && state.kind !== kind) return;
			counts[decisionOf(h) || 'none']++;
			if (needsMe(h)) counts.tovote++;
		});
		forEach($('f-kind').querySelectorAll('button'), function (b) {
			var k = b.getAttribute('data-kind');
			b.setAttribute('aria-pressed', String(k === state.kind));
			b.querySelector('.n').textContent = counts[k];
		});
		forEach($('f-decision').querySelectorAll('button'), function (b) {
			var d = b.getAttribute('data-decision');
			var n = b.querySelector('.n');
			b.hidden = d === 'tovote' && !state.voter;
			b.setAttribute('aria-pressed', String(d === state.decision));
			if (n) n.textContent = counts[d];
		});
	}

	// "ALEX-BOGDAN FEHER (named “Farcas Alex-Bogdan”)": a teammate matched by a name written another way, to check
	function namedAsText(r) {
		return r.name + ' (named ' + r.namedAs.map(function (n) { return '“' + n + '”'; }).join(', ') + ')';
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
			if (c.key === 'pick') td.appendChild(pickBox(team.members, 'Select the whole team'));
			if (j === at - 1) td.appendChild(el('span', 'team-size', 'Team of ' + size));
			tr.appendChild(td);
		});
		var mid = el('td', 'c-decision');
		mid.appendChild(voting() ? voteCell(team.members, 'the whole team') : decisionControl(team.members, 'the whole team'));
		var rest = el('td');
		rest.colSpan = cols.length - at - 1;
		var info = el('div', 'team-info');
		var given = el('span', 'team-track');
		given.appendChild(el('span', 'team-track-label', 'Track'));
		given.appendChild(trackControl(team.members, 'the whole team'));
		info.appendChild(given);
		info.appendChild(el('span', 'team-names', team.members.map(function (r) { return r.name; }).join(', ')));
		if (team.missing.length) info.appendChild(el('span', 'team-warn', '⚠ Not registered: ' + team.missing.join(', ')));
		if (size > 3) info.appendChild(el('span', 'team-warn', '⚠ Over 3 people'));
		var named = team.members.filter(function (r) { return r.namedAs.length; });
		if (named.length) info.appendChild(el('span', 'team-named', 'Named another way: ' + named.map(namedAsText).join(', ')));
		rest.appendChild(info);
		tr.appendChild(mid);
		tr.appendChild(rest);
		return tr;
	}

	$('people').tHead.addEventListener('click', function (ev) {
		var b = ev.target.closest('[data-sort]');
		if (!b) return;
		var key = b.getAttribute('data-sort');
		// a new column starts with the newest, the highest average or A to Z; a second click turns it round
		state.sort = state.sort.key === key ? { key: key, dir: -state.sort.dir } : { key: key, dir: key === 'time' || key === 'decision' && voting() ? -1 : 1 };
		renderTable();
	});

	$('people').tBodies[0].addEventListener('click', function (ev) {
		if (ev.target.closest('a, .c-pick, .c-track')) return;
		var tr = ev.target.closest('tr[data-i]');
		if (tr) openDetail(state.shown[+tr.getAttribute('data-i')]);
	});

	/* --- one registration in full ------------------------------------------- */

	var dialog = $('detail');

	function openDetail(p) {
		if (!p) return;
		state.handOpen = false;
		renderDetail(p);
		if (typeof dialog.showModal === 'function') dialog.showModal();
		else dialog.setAttribute('open', '');
	}

	function renderDetail(p) {
		state.detail = p;
		renderDetailDecision(p);
		$('detail-name').textContent = p.name || '(no name)';
		$('detail-pick').checked = isPicked(p);
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
		if (voting()) renderDetailVotes(box, h, p.name || 'this person');
		else {
			box.appendChild(el('span', 'detail-decision-label', 'Hackathon decision'));
			box.appendChild(decisionControl([h], p.name || 'this person'));
		}
		if (h.team) {
			var mates = h.team.members.filter(function (m) { return m !== h; }).map(function (m) {
				return m.namedAs.length ? namedAsText(m) : m.name;
			}).concat(h.team.missing.map(function (n) { return n + ' (not registered)'; }));
			if (mates.length) box.appendChild(el('p', 'detail-team', 'Team with ' + mates.join(', ')));
		}
		if (decisionOf(h) === 'accepted') box.appendChild(dashboardLine(h));
		var track = el('div', 'detail-track');
		track.appendChild(el('span', 'detail-decision-label', 'Track'));
		track.appendChild(trackControl([h], p.name || 'this person', true));
		track.appendChild(el('span', 'detail-ticked', get(h, 'Tracks') ? 'Ticked on the form: ' + get(h, 'Tracks') : 'Ticked none on the form'));
		box.appendChild(track);
	}

	// the full view with grades: the reader's, everyone's, what they add up to, and the decision by hand for the
	// exceptions, folded away
	function renderDetailVotes(box, h, who) {
		box.appendChild(el('span', 'detail-decision-label', state.voter ? 'Your grade' : 'Grades'));
		if (state.voter) box.appendChild(voteControl([h], who, true));
		var open = revealed([h]);
		var list = el('div', 'vote-list');
		state.voters.forEach(function (v) {
			var x = voteOf(h, v);
			if (!open && v !== state.voter) list.appendChild(el('span', 'vote-chip' + (x ? ' is-in' : ''), v + ' ' + (x ? '·' : '–')));
			else list.appendChild(el('span', 'vote-chip' + gradeClass(x), v + ' ' + (x || '–')));
		});
		box.appendChild(list);
		if (!open) box.appendChild(el('p', 'vote-hidden muted', 'Grade first: then you see the others’ grades, and their notes.'));
		else state.voters.forEach(function (v) {
			if (noteOf(h, v)) box.appendChild(el('p', 'vote-note', v + ': “' + noteOf(h, v) + '”'));
		});
		box.appendChild(voteResult([h]));
		var hand = el('details', 'by-hand');
		hand.open = state.handOpen;
		hand.addEventListener('toggle', function () { state.handOpen = hand.open; });
		hand.appendChild(el('summary', null, 'Decide by hand'));
		hand.appendChild(decisionControl([h], who));
		hand.appendChild(el('p', 'muted', 'For the exceptions: someone away, an average just under the line. The next grade that changes what the average says sets the decision again.'));
		box.appendChild(hand);
	}

	// an accepted participant's team dashboard code, to read out or send again
	function dashboardLine(h) {
		var line = el('p', 'detail-code');
		var turn = el('button', 'btn small ghost', codeOff(h) ? 'Turn it on' : 'Turn code off');
		turn.type = 'button';
		turn.disabled = !!state.accessing[h.email];
		turn.addEventListener('click', function () { setAccess([h], !codeOff(h)); });
		if (codeOff(h)) {
			var since = new Date(get(h, 'Code off'));
			line.appendChild(el('span', 'bad', 'Their dashboard code is off' + (isNaN(since) ? '' : ' since ' + fmtShort.format(since)) + '. '));
			line.appendChild(turn);
			return line;
		}
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
		line.appendChild(turn);
		return line;
	}

	// one registration, every answer it has
	function fields(r) {
		var dl = el('dl');
		state.columns.forEach(function (col) {
			var v = get(r, col);
			if (!v || col === 'First name' || col === 'Last name') return;
			if (voting() && state.voters.some(function (x) { return voteCol(x) === col || noteCol(x) === col; })) return;   // the votes are at the top
			var dd = el('dd');
			if (col === 'Timestamp' && r.time) dd.textContent = fmtLong.format(r.time);
			else if ((col === 'Coming answered' || col === 'Checked in' || col === 'Team answered') && !isNaN(new Date(v))) dd.textContent = fmtLong.format(new Date(v));
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

	/* --- tracks ------------------------------------------------------------------------ */

	// the track given to one registration, a whole team or everyone picked: in the table and the bar a list, in the
	// full view buttons (pressing the chosen one again takes it back); the tracks one person ticked have a ✓
	function trackControl(regs, who, wide) {
		var ts = regs.map(trackOf);
		var current = ts.every(function (t) { return t === ts[0]; }) ? ts[0] : null;   // null: given different ones
		var saving = regs.some(function (r) { return state.tracking[r.email]; });
		var ticked = regs.length === 1 ? get(regs[0], 'Tracks').split(/\s*,\s*/) : [];
		var group = el(wide ? 'div' : 'span', 'dec ' + (wide ? 'track' : 'track-pick') + (saving ? ' is-saving' : ''));
		group.setAttribute('data-key', regs.map(function (r) { return r.email; }).join(' '));
		group.addEventListener('click', function (ev) { ev.stopPropagation(); });   // a click here does not open the registration
		if (!wide) {
			var pick = el('select', 'grade-select track-select' + (current ? ' is-given' : ''));
			pick.setAttribute('data-d', 'track');
			pick.setAttribute('aria-label', 'Track for ' + who);
			if (current === null) pick.appendChild(new Option('Mixed', 'mixed'));
			pick.appendChild(new Option('–', ''));
			TRACKS.forEach(function (t) { pick.appendChild(new Option(TRACK_SHORT[t] + (ticked.indexOf(t) !== -1 ? ' ✓' : ''), t)); });
			pick.value = current === null ? 'mixed' : current;
			if (regs.length === 1) pick.title = get(regs[0], 'Tracks') ? 'Ticked on the form (✓): ' + get(regs[0], 'Tracks') : 'Ticked none on the form';
			if (saving) pick.setAttribute('aria-disabled', 'true');   // not disabled: that would lose the focus
			pick.addEventListener('change', function () {
				if (saving || pick.value === 'mixed') { pick.value = current === null ? 'mixed' : current; return; }
				setTrack(regs, pick.value);
			});
			group.appendChild(pick);
			return group;
		}
		group.setAttribute('role', 'group');
		group.setAttribute('aria-label', 'Track for ' + who);
		if (saving) group.setAttribute('aria-busy', 'true');
		TRACKS.forEach(function (t) {
			var b = el('button', 'dec-t', TRACK_SHORT[t] + (ticked.indexOf(t) !== -1 ? ' ✓' : ''));
			b.type = 'button';
			b.title = t + (ticked.indexOf(t) !== -1 ? ', ticked on the form' : '');
			b.setAttribute('data-d', t);
			b.setAttribute('aria-pressed', String(current === t));
			if (saving) b.setAttribute('aria-disabled', 'true');
			group.appendChild(b);
		});
		group.addEventListener('click', function (ev) {
			var b = ev.target.closest('button[data-d]');
			if (!b || saving) return;
			var t = b.getAttribute('data-d');
			setTrack(regs, current === t ? '' : t);
		});
		return group;
	}

	// shows the track at once and saves it in the sheet; put back as it was if the save fails
	function setTrack(regs, t) {
		// several at once over tracks given before: ask
		var other = regs.filter(function (r) { var x = trackOf(r); return x && x !== t; });
		if (regs.length > 1 && other.length) {
			var q = other.length + ' of these ' + regs.length + ' people have another track already. ' +
				(t ? 'Give all ' + regs.length + ' ' + t + '?' : 'Take the track back from all ' + regs.length + '?');
			if (!window.confirm(q)) { refreshTracks(); return; }
		}
		var before = regs.map(function (r) { return get(r, 'Hackathon track'); });
		regs.forEach(function (r) { setCol(r, 'Hackathon track', t); state.tracking[r.email] = true; });
		refreshTracks();
		post({ action: 'track', key: state.key, emails: regs.map(function (r) { return r.email; }), track: t }, 60000, function (json, err) {
			regs.forEach(function (r) { delete state.tracking[r.email]; });
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.action === 'track') {
				var missing = json.missing || [];
				regs.forEach(function (r, i) { if (missing.indexOf(r.email) !== -1) setCol(r, 'Hackathon track', before[i]); });
				dashError(missing.length ? 'Not saved, as the sheet has no hackathon registration for ' + missing.join(', ') + ' any more. Refresh the page.' : '');
			} else {
				regs.forEach(function (r, i) { setCol(r, 'Hackathon track', before[i]); });
				dashError('The track was not saved. ' + actionProblem(json, err, 'give tracks'));
			}
			refreshTracks();
		});
	}

	// the Track given bars count the change too
	function refreshTracks() {
		renderBreakdowns();
		renderChips();
		refreshDecisions();
	}

	/* --- dashboard codes off ---------------------------------------------------------------- */

	// Turns accepted participants' dashboard codes off (or on again): the dashboard then tells them we did not hear
	// from them and to write to us. Their decision stays. Shown at once, put back if the save fails.
	function setAccess(regs, off) {
		regs = regs.filter(function (r) { return decisionOf(r) === 'accepted' && codeOff(r) !== off; });
		if (!regs.length) return;
		var who = regs.length === 1 ? (regs[0].name || regs[0].email) : regs.length + ' people';
		var answered = regs.filter(function (r) { return comingOf(r) === 'yes'; }).length;
		var q = off
			? 'Turn off the dashboard code of ' + who + '? The dashboard tells them we did not hear from them by Wednesday and to write to us. Their decision stays; you can turn it on again.' +
				(answered ? '\n\n' + answered + ' of them said they are coming.' : '')
			: 'Turn the dashboard code of ' + who + ' on again? The code they had works again.';
		if (!window.confirm(q)) return;
		var before = regs.map(function (r) { return get(r, 'Code off'); });
		regs.forEach(function (r) { setCol(r, 'Code off', off ? new Date().toISOString() : ''); state.accessing[r.email] = true; });
		refreshTracks();
		post({ action: 'access', key: state.key, emails: regs.map(function (r) { return r.email; }), off: off }, 60000, function (json, err) {
			regs.forEach(function (r) { delete state.accessing[r.email]; });
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.action === 'access') {
				var missing = json.missing || [];
				regs.forEach(function (r, i) { if (missing.indexOf(r.email) !== -1) setCol(r, 'Code off', before[i]); });
				dashError(missing.length ? 'Not saved, as the sheet has no hackathon registration for ' + missing.join(', ') + ' any more. Refresh the page.' : '');
				pickNote(off ? 'Code off for ' + plural(regs.length - missing.length, 'person', 'people') : 'Code on again for ' + plural(regs.length - missing.length, 'person', 'people'));
			} else {
				regs.forEach(function (r, i) { setCol(r, 'Code off', before[i]); });
				dashError('The codes were not changed. ' + actionProblem(json, err, 'turn dashboard codes off'));
			}
			refreshTracks();
		});
	}

	$('pick-code').addEventListener('click', function () {
		var hs = pickedPeople().map(hackReg).filter(function (h) { return h && decisionOf(h) === 'accepted'; });
		setAccess(hs, !hs.every(codeOff));
	});

	/* --- votes -------------------------------------------------------------------- */

	// the table's cell, or a team's: the reader's grade (none with the shared key), everyone's, and the result
	function voteCell(regs, who) {
		var box = el('div', 'dec-box');
		if (state.voter) box.appendChild(voteControl(regs, who));
		box.appendChild(voteChips(regs));
		box.appendChild(voteResult(regs));
		return box;
	}

	// ' is-accepted', ' is-waitlist' or ' is-denied' for a grade, by where it would put the average
	function gradeClass(x) { return x ? ' is-' + bandOf(x) : ''; }

	// the reader's grade, on one registration or a whole team: in the table a list (– takes it back), in the full view
	// the ten buttons (pressing the chosen one again takes it back)
	function voteControl(regs, who, wide) {
		var mine = regs.map(function (r) { return voteOf(r, state.voter); });
		var current = mine.every(function (x) { return x === mine[0]; }) ? mine[0] : null;   // null: a team graded differently
		var saving = regs.some(function (r) { return state.pending[r.email]; });
		var group = el(wide ? 'div' : 'span', 'dec ' + (wide ? 'grade' : 'grade-pick') + (saving ? ' is-saving' : ''));
		group.setAttribute('data-key', regs.map(function (r) { return r.email; }).join(' '));
		group.addEventListener('click', function (ev) { ev.stopPropagation(); });   // a click here does not open the registration
		if (!wide) {
			var pick = el('select', 'grade-select' + gradeClass(current));
			pick.setAttribute('data-d', 'pick');
			pick.setAttribute('aria-label', 'Your grade for ' + who + ', from 1 to 10');
			if (current === null) pick.appendChild(new Option('Mixed', 'mixed'));
			pick.appendChild(new Option('–', ''));
			GRADES.forEach(function (g) { pick.appendChild(new Option(String(g), String(g))); });
			pick.value = current === null ? 'mixed' : String(current || '');
			if (saving) pick.setAttribute('aria-disabled', 'true');   // not disabled: that would lose the focus
			pick.addEventListener('change', function () {
				if (saving || pick.value === 'mixed') { pick.value = current === null ? 'mixed' : String(current || ''); return; }
				setVote(regs, Number(pick.value) || 0);
			});
			group.appendChild(pick);
			return group;
		}
		group.setAttribute('role', 'group');
		group.setAttribute('aria-label', 'Your grade for ' + who + ', from 1 to 10');
		if (saving) group.setAttribute('aria-busy', 'true');
		GRADES.forEach(function (g) {
			var b = el('button', 'dec-g' + gradeClass(g), String(g));
			b.type = 'button';
			b.setAttribute('data-d', String(g));
			b.setAttribute('aria-pressed', String(current === g));
			if (saving) b.setAttribute('aria-disabled', 'true');
			group.appendChild(b);
		});
		group.addEventListener('click', function (ev) {
			var b = ev.target.closest('button[data-d]');
			if (!b || saving) return;
			var g = Number(b.getAttribute('data-d'));
			setVote(regs, current === g ? 0 : g);
		});
		return group;
	}

	// one tag per organiser: their grade, or not yet (and, for a team, members graded differently); the names in the
	// title
	function voteChips(regs) {
		var box = el('div', 'votes');
		var said = [];
		var open = revealed(regs);
		state.voters.forEach(function (v) {
			var xs = regs.map(function (r) { return voteOf(r, v); });
			// before the reader votes: who has voted, not how
			if (!open && v !== state.voter) {
				var any = xs.some(Boolean);
				box.appendChild(el('span', 'vote-chip' + (any ? ' is-in' : ''), v.slice(0, 2)));
				said.push(v + ': ' + (any ? 'graded' : 'not yet'));
				return;
			}
			var x = xs.every(function (y) { return y === xs[0]; }) ? xs[0] : 'mixed';
			box.appendChild(el('span', 'vote-chip' + (x === 'mixed' ? ' is-mixed' : gradeClass(x)), v.slice(0, 2) + (x && x !== 'mixed' ? ' ' + x : '')));
			said.push(v + ': ' + (x === 'mixed' ? 'not the same for everyone' : x || 'not yet'));
		});
		if (!open) said.push('grade to see theirs');
		box.title = said.join(' · ');
		box.setAttribute('aria-label', said.join(', '));
		return box;
	}

	// what the grades came to: the Decision, the average (or how many graded, before the reader has), "by hand" when
	// it is not what the average says, and the note on the email
	function voteResult(regs) {
		var ds = regs.map(decisionOf);
		var current = ds.every(function (d) { return d === ds[0]; }) ? ds[0] : null;
		var line = el('div', 'vote-result');
		if (current !== null) {
			var g = regs.length === 1 ? gradesOf(regs[0]) : null;
			var text = DECISION_LABEL[current];
			if (g && g.n) text += revealed(regs) ? ' · average ' + avgText(g.avg) + ' of ' + g.n : ' · ' + plural(g.n, 'grade', 'grades') + ' in';
			if (g && current && current !== outcomeOf(regs[0])) text += ' · by hand';
			line.appendChild(el('span', 'dec-state is-' + (current || 'none'), text));
		}
		var note = decisionNote(regs, current);
		if (note) line.appendChild(note);
		return line;
	}

	function setCell(r, col, v) {
		r.v[col] = v;
		var j = state.columns.indexOf(col);
		if (j !== -1) r.row[j] = v;
	}

	// a grade that changes the decision of someone already emailed another: asked first, as for a decision by hand
	function voteConfirmed(regs, next) {
		var told = regs.filter(function (r, i) {
			var m = emailedOf(r);
			return m && m.sent && next[i] !== decisionOf(r) && next[i] !== m.decision;
		});
		if (!told.length) return true;
		var r0 = told[0], d = next[regs.indexOf(r0)], was = emailedOf(r0).decision;
		return window.confirm((regs.length > 1 ? told.length + ' of them were' : (r0.name || 'This person') + ' was') +
			' already emailed “' + (DECISION_LABEL[was] || was) + '”. ' +
			(d ? 'Your grade makes it ' + DECISION_LABEL[d] + ': the next send emails that.'
				: 'Without your grade there are too few: Undecided again, and no email goes out about that, so tell them yourself.') +
			' Grade anyway?');
	}

	// shows the grade (0: taken back), and the decision it makes, at once and saves it; the Apps Script answers
	// everyone's grades as they are now, which the page then shows. Put back as it was if the save fails.
	function setVote(regs, x) {
		var col = voteCol(state.voter);
		var next = regs.map(function (r) { return decisionAfter(r, x); });
		if (!voteConfirmed(regs, next)) return;
		var before = regs.map(function (r) { return { vote: get(r, col), decision: get(r, 'Decision') }; });
		regs.forEach(function (r, i) {
			setCell(r, col, x || '');
			setLocal(r, next[i]);
			state.pending[r.email] = true;
			delete rv.pool[r.email];   // the newest grade wins over one of the reading mode not sent yet
		});
		keepPool();
		refreshDecisions();
		var body = { action: 'vote', key: state.key, emails: regs.map(function (r) { return r.email; }), vote: x || '' };
		if (state.shared) body.as = state.voter;
		postAgain(body, 60000, function (json, err) {
			regs.forEach(function (r) { delete state.pending[r.email]; });
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.action === 'vote') {
				var got = {};
				(json.set || []).forEach(function (s) { got[s.email] = s; });
				var missing = [];
				regs.forEach(function (r, i) {
					if (got[r.email]) { answered(r, got[r.email]); return; }
					missing.push(r.email);
					setCell(r, col, before[i].vote);
					setLocal(r, before[i].decision);
				});
				dashError(missing.length ? notThere(missing) : '');
			} else {
				regs.forEach(function (r, i) {
					setCell(r, col, before[i].vote);
					setLocal(r, before[i].decision);
				});
				dashError('The grade was not saved. ' + actionProblem(json, err, 'vote'));
			}
			refreshDecisions();
		});
	}

	// what the Apps Script answered for one registration: everyone's grades and notes, and the Decision they make
	function answered(r, s) {
		Object.keys(s.votes || {}).forEach(function (v) { setCell(r, voteCol(v), s.votes[v]); });
		Object.keys(s.notes || {}).forEach(function (v) { setCell(r, noteCol(v), s.notes[v]); });
		setLocal(r, s.decision);
	}

	function notThere(emails) {
		return 'Not saved, as the sheet has no hackathon registration for ' + emails.join(', ') + ' any more. Refresh the page.';
	}

	// after a decision: the table and its tabs, the send panel and the open registration, with the focus kept on
	// the button that was pressed
	function refreshDecisions() {
		var a = document.activeElement;
		var g = a && a.closest ? a.closest('.dec') : null;
		var keep = g ? { key: g.getAttribute('data-key'), d: a.getAttribute('data-d'), scope: a.closest('dialog') || $('people') } : null;
		renderTable();
		renderSendPanel();
		renderReviewPanel();
		if (dialog.open && state.detail) renderDetail(state.detail);
		if (!keep) return;
		forEach(keep.scope.querySelectorAll('.dec'), function (box) {
			if (box.getAttribute('data-key') !== keep.key) return;
			var b = box.querySelector('[data-d="' + keep.d + '"]');
			if (b) b.focus();
		});
	}

	/* --- edition in numbers ------------------------------------------------------------- */

	// For the sponsorship brochure: counts only, never a name. Each chart is an SVG drawn here, so it downloads as an
	// SVG a designer can restyle, or as a PNG; every number shown also goes in one CSV.

	// BreaQ 2025, for the "vs 2025" lines: fill these in from last year's records (null: the line is left out)
	var LAST_EDITION = { year: 2025, applications: null, conference: null, participants: null, universities: null };

	var NUM = { bg: '#2e3141', fg: '#ffffff', muted: 'rgba(255,255,255,0.62)', line: 'rgba(255,255,255,0.14)', bar: '#7f8cd6', hot: '#ff8c00', font: "'Source Sans Pro', Helvetica, Arial, sans-serif" };
	var POOLS = [
		['applied', 'Applied to the hackathon'],
		['accepted', 'Accepted'],
		['came', 'Came (checked in)'],
		['conference', 'Conference'],
		['everyone', 'Everyone']
	];
	var numRows = [];   // [section, metric, value] for the CSV

	function svgEl(tag, attrs, text) {
		var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
		Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
		if (text !== undefined) n.textContent = text;
		return n;
	}

	function svgRoot(w, h, label) {
		var svg = svgEl('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, role: 'img', 'aria-label': label, 'font-family': NUM.font });
		svg.appendChild(svgEl('rect', { x: 0, y: 0, width: w, height: h, fill: NUM.bg, rx: 8 }));
		return svg;
	}

	function clip(t, n) { t = String(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

	function pct(n, of) { return of ? Math.round(n / of * 100) : 0; }

	// horizontal bars: items [{ label, n }], each with its share of total; hot: the bars in orange (a funnel)
	function barsSvg(title, items, total, hot) {
		var w = 600, top = 52, row = 34, h = top + items.length * row + 16;
		var svg = svgRoot(w, h, title + ': ' + items.map(function (it) { return it.label + ' ' + it.n; }).join(', '));
		svg.appendChild(svgEl('text', { x: 24, y: 34, fill: NUM.fg, 'font-size': 17, 'font-weight': 700 }, title));
		var max = Math.max.apply(null, items.map(function (it) { return it.n; }).concat(1));
		var labelW = 210, barX = 24 + labelW, barW = w - barX - 110;
		items.forEach(function (it, i) {
			var y = top + i * row;
			svg.appendChild(svgEl('text', { x: 24, y: y + 19, fill: NUM.fg, 'font-size': 14 }, clip(it.label, 30)));
			svg.appendChild(svgEl('rect', { x: barX, y: y + 7, width: barW, height: 16, rx: 3, fill: NUM.line }));
			svg.appendChild(svgEl('rect', { x: barX, y: y + 7, width: Math.max(2, barW * it.n / max), height: 16, rx: 3, fill: hot ? NUM.hot : NUM.bar }));
			var v = svgEl('text', { x: w - 24, y: y + 20, fill: NUM.fg, 'font-size': 14, 'font-weight': 600, 'text-anchor': 'end' }, String(it.n));
			if (total) v.appendChild(svgEl('tspan', { fill: NUM.muted, 'font-weight': 400, dx: 6 }, pct(it.n, total) + '%'));
			svg.appendChild(v);
		});
		return svg;
	}

	// registrations so far, day by day: one line per series [{ label, color, days: { yyyy-mm-dd: n } }]
	function cumulativeSvg(title, series) {
		var w = 600, h = 260, l = 24, r = 24, t = 70, b = 36;
		var keys = [];
		series.forEach(function (s) { keys = keys.concat(Object.keys(s.days)); });
		keys.sort();
		var svg = svgRoot(w, h, title);
		svg.appendChild(svgEl('text', { x: 24, y: 34, fill: NUM.fg, 'font-size': 17, 'font-weight': 700 }, title));
		if (!keys.length) return svg;
		var first = new Date(keys[0] + 'T12:00:00'), last = new Date(keys[keys.length - 1] + 'T12:00:00');
		var days = [];
		for (var d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) days.push(dayKey(d));
		var totals = series.map(function (s) {
			var run = 0;
			return days.map(function (k) { run += s.days[k] || 0; return run; });
		});
		var max = Math.max.apply(null, totals.map(function (t) { return t[t.length - 1]; }).concat(1));
		var x = function (i) { return l + (days.length > 1 ? i / (days.length - 1) : 0.5) * (w - l - r); };
		var y = function (v) { return h - b - v / max * (h - t - b); };
		svg.appendChild(svgEl('line', { x1: l, x2: w - r, y1: h - b, y2: h - b, stroke: NUM.line }));
		series.forEach(function (s, j) {
			var pts = totals[j].map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); });
			svg.appendChild(svgEl('polyline', { points: pts.join(' '), fill: 'none', stroke: s.color, 'stroke-width': 3, 'stroke-linejoin': 'round' }));
			var end = totals[j][totals[j].length - 1];
			svg.appendChild(svgEl('text', { x: w - r, y: y(end) - 8, fill: s.color, 'font-size': 14, 'font-weight': 700, 'text-anchor': 'end' }, s.label + ': ' + end));
		});
		svg.appendChild(svgEl('text', { x: l, y: h - 12, fill: NUM.muted, 'font-size': 12 }, fmtAxis.format(first)));
		svg.appendChild(svgEl('text', { x: w - r, y: h - 12, fill: NUM.muted, 'font-size': 12, 'text-anchor': 'end' }, fmtAxis.format(last)));
		return svg;
	}

	function download(name, blob) {
		var a = el('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
	}

	function svgText(svg) { return new XMLSerializer().serializeToString(svg); }

	// the SVG drawn twice its size, as a PNG (the page's fonts do not reach an image: the system's sans serif)
	function savePng(svg, name) {
		var w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
		var img = new Image();
		img.onload = function () {
			var c = document.createElement('canvas');
			c.width = w * 2;
			c.height = h * 2;
			var g = c.getContext('2d');
			g.scale(2, 2);
			g.drawImage(img, 0, 0, w, h);
			c.toBlob(function (blob) { if (blob) download(name + '.png', blob); }, 'image/png');
		};
		img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText(svg));
	}

	function slug(t) { return 'breaq-2026-' + fold(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

	// a chart with its two downloads
	function chartCard(svg, title) {
		var card = el('figure', 'num-chart');
		card.appendChild(svg);
		var bar = el('figcaption', 'num-chart-actions');
		[['SVG', function () { download(slug(title) + '.svg', new Blob([svgText(svg)], { type: 'image/svg+xml' })); }],
			['PNG', function () { savePng(svg, slug(title)); }]].forEach(function (x) {
			var b = el('button', 'btn small ghost', 'Download ' + x[0]);
			b.type = 'button';
			b.addEventListener('click', x[1]);
			bar.appendChild(b);
		});
		card.appendChild(bar);
		return card;
	}

	function numSection(box, title, help) {
		var sec = el('section', 'panel num-section');
		sec.appendChild(el('h2', null, title));
		if (help) sec.appendChild(el('p', 'muted num-help', help));
		box.appendChild(sec);
		return sec;
	}

	// a row of big numbers: [label, value, note], each also in the CSV under section
	function numTiles(sec, section, tiles) {
		var row = el('div', 'tiles num-tiles');
		tiles.forEach(function (t) {
			if (t[1] === null || t[1] === undefined) return;
			var tile = el('div', 'tile');
			tile.appendChild(el('span', 'tile-label', t[0]));
			tile.appendChild(el('span', 'tile-value', typeof t[1] === 'number' ? t[1].toLocaleString('en-GB') : t[1]));
			if (t[2]) tile.appendChild(el('span', 'tile-note', t[2]));
			row.appendChild(tile);
			numRows.push([section, t[0], t[1]]);
		});
		sec.appendChild(row);
	}

	function versus(now, then) {
		if (!then) return '';
		var d = Math.round((now - then) / then * 100);
		return (d >= 0 ? '+' : '') + d + '% vs ' + LAST_EDITION.year + ' (' + then + ')';
	}

	// a breakdown's bars as a chart, with its rows in the CSV
	function bdChart(grid, section, b, rs, title) {
		var items = tally(rs, b);
		if (!items.length) return;
		var answered = rs.filter(function (r) { return rawOf(r, b) && (!b.only || b.only(r)); }).length;
		var shown = items.map(function (it) { return { label: b.short ? it.label.split(':')[0] : it.label, n: it.n }; });
		shown.forEach(function (it) { numRows.push([section, title + ': ' + it.label, it.n]); });
		grid.appendChild(chartCard(barsSvg(title, shown, answered), title));
	}

	// the utm_source of the address someone registered from (roqteam.ro/register?utm_source=instagram)
	function sourceOf(r) {
		var m = /[?&](?:utm_source|ref|src)=([^&#]+)/i.exec(get(r, 'Page'));
		if (!m) return '';
		try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim().toLowerCase(); } catch (e) { return m[1].toLowerCase(); }
	}

	function renderNumbers() {
		var box = $('nums');
		box.textContent = '';
		numRows = [];
		var everyone = people(state.records);
		var hack = everyone.filter(function (p) { return hackReg(p); });
		var conf = state.records.filter(function (r) { return inEvent(r, 'conference'); }).length;
		var hackRegs = hack.length;
		var accepted = hack.filter(function (p) { return decisionOf(hackReg(p)) === 'accepted'; });
		var decided = hack.filter(function (p) { return decisionOf(hackReg(p)); }).length;
		var orgs = {}, cities = {};
		everyone.forEach(function (p) {
			if (p.org && p.org !== INDUSTRY) orgs[bdKey(p.org)] = true;
			if (p.city) cities[p.city] = true;
		});
		var nOrgs = Object.keys(orgs).length, nCities = Object.keys(cities).length;

		// the edition at a glance
		var sec = numSection(box, 'At a glance', 'Every number on this page counts people (someone registered for both events counts once where it says people).');
		numTiles(sec, 'At a glance', [
			['Hackathon applications', hackRegs, versus(hackRegs, LAST_EDITION.applications)],
			['Conference registrations', conf, versus(conf, LAST_EDITION.conference)],
			['People', everyone.length, 'registered for either event'],
			['Universities and organisations', nOrgs, versus(nOrgs, LAST_EDITION.universities)],
			['Cities', nCities || null, 'of the universities we recognise'],
			['Accepted', accepted.length || null, versus(accepted.length, LAST_EDITION.participants)],
			['Applicants per place', accepted.length && decided === hackRegs ? (hackRegs / accepted.length).toFixed(1) : null, 'once everyone is decided'],
			['Acceptance rate', accepted.length && decided === hackRegs ? pct(accepted.length, hackRegs) + '%' : null]
		]);

		// demand over time
		sec = numSection(box, 'Registrations over time', 'Counted on the day each registration first came in.');
		var series = [['Hackathon', NUM.hot, function (r) { return inEvent(r, 'hackathon'); }], ['Conference', NUM.bar, function (r) { return inEvent(r, 'conference'); }]].map(function (s) {
			var days = {};
			state.records.forEach(function (r) { if (r.time && s[2](r)) { var k = dayKey(r.time); days[k] = (days[k] || 0) + 1; } });
			return { label: s[0], color: s[1], days: days };
		}).filter(function (s) { return Object.keys(s.days).length; });
		var grid = el('div', 'num-charts');
		grid.appendChild(chartCard(cumulativeSvg('Registrations so far', series), 'Registrations so far'));
		sec.appendChild(grid);
		var perDay = {};
		state.records.forEach(function (r) { if (r.time) { var k = dayKey(r.time); perDay[k] = (perDay[k] || 0) + 1; } });
		var peak = Object.keys(perDay).sort(function (a, b) { return perDay[b] - perDay[a]; })[0];
		if (peak) numTiles(sec, 'Registrations over time', [['Busiest day', perDay[peak], fmtDay.format(new Date(peak + 'T12:00:00'))]]);

		// the talent pool, for the group picked
		sec = numSection(box, 'Who they are', 'Pick the group: the applicants show the demand, the accepted and those who came show who the sponsors meet.');
		var seg = el('div', 'seg num-pools');
		POOLS.forEach(function (pl) {
			var b = el('button', null, pl[1]);
			b.type = 'button';
			b.setAttribute('aria-pressed', String(state.numbersOf === pl[0]));
			b.addEventListener('click', function () { state.numbersOf = pl[0]; renderNumbers(); });
			seg.appendChild(b);
		});
		sec.appendChild(seg);
		var pool = everyone.filter(function (p) {
			var h = hackReg(p);
			if (state.numbersOf === 'applied') return !!h;
			if (state.numbersOf === 'accepted') return h && decisionOf(h) === 'accepted';
			if (state.numbersOf === 'came') return h && !!get(h, 'Checked in');
			if (state.numbersOf === 'conference') return p.regs.some(function (r) { return inEvent(r, 'conference'); });
			return true;
		});
		var poolName = POOLS.filter(function (pl) { return pl[0] === state.numbersOf; })[0][1];
		var section = 'Who they are (' + poolName + ')';
		if (!pool.length) sec.appendChild(el('p', 'muted', 'Nobody in this group yet.'));
		else {
			var withStatus = pool.filter(function (p) { return get(p, 'Status'); });
			var senior = withStatus.filter(function (p) { return /master|phd|researcher/i.test(get(p, 'Status')); }).length;
			var industry = withStatus.filter(function (p) { return /industry/i.test(get(p, 'Status')); }).length;
			var withExp = pool.filter(function (p) { return get(p, 'Experience'); });
			var some = withExp.filter(function (p) { return !/^none/i.test(get(p, 'Experience')); }).length;
			numTiles(sec, section, [
				['People', pool.length],
				['Master’s, PhD or research', withStatus.length ? pct(senior, withStatus.length) + '%' : null, senior + ' of ' + withStatus.length],
				['Working in industry', withStatus.length ? pct(industry, withStatus.length) + '%' : null, industry + ' of ' + withStatus.length],
				['Some quantum experience', withExp.length ? pct(some, withExp.length) + '%' : null, 'a course or more: ' + some + ' of ' + withExp.length]
			]);
			grid = el('div', 'num-charts');
			BREAKDOWNS.forEach(function (b) {
				if (b.id === 'tshirt' || b.id === 'heard') return;   // not for a brochure; where they heard of it: below
				bdChart(grid, section, b, pool, b.title);
			});
			sec.appendChild(grid);
		}

		// the hackathon's funnel
		sec = numSection(box, 'From application to the end', 'Each step out of everyone who applied to the hackathon.');
		var steps = [
			['Applied', hackRegs],
			['Accepted', accepted.length],
			['Said they are coming', hack.filter(function (p) { return comingOf(hackReg(p)) === 'yes'; }).length],
			['Came (checked in)', hack.filter(function (p) { return get(hackReg(p), 'Checked in'); }).length],
			['Got a certificate', hack.filter(function (p) { return /^sent/i.test(get(hackReg(p), 'Certificate')); }).length],
			['Gave feedback', state.feedback.length]
		];
		steps.forEach(function (st) { numRows.push(['From application to the end', st[0], st[1]]); });
		grid = el('div', 'num-charts');
		grid.appendChild(chartCard(barsSvg('From application to the end', steps.map(function (st) { return { label: st[0], n: st[1] }; }), hackRegs, true), 'From application to the end'));
		sec.appendChild(grid);

		// how it went: the feedback, and the hackathon on the dashboard
		sec = numSection(box, 'How it went', 'From the feedback form on the team dashboard (no names), and from the dashboard itself.');
		var fb = state.feedback;
		var rated = fb.filter(function (f) { return f.overall; });
		var avg = rated.length ? (rated.reduce(function (s, f) { return s + f.overall; }, 0) / rated.length).toFixed(1) : null;
		var again = fb.filter(function (f) { return f.again; });
		var a = state.activity || {};
		numTiles(sec, 'How it went', [
			['Feedback answers', fb.length || null],
			['Overall rating', avg ? avg + ' / 5' : null, rated.length ? 'from ' + rated.length + ' ratings' : ''],
			['Would come again', again.length ? pct(again.filter(function (f) { return f.again === 'yes'; }).length, again.length) + '%' : null, again.length ? 'yes, of ' + again.length + ' answers' : ''],
			['Teams', state.teams.length || null],
			['Announcements', a.announcements || null],
			['Mentor requests answered', a.requests ? a.answered : null, a.requests ? 'of ' + a.requests + (a.medianWait !== null && a.medianWait !== undefined ? ', a mentor on the way in ' + a.medianWait + ' min (median)' : '') : '']
		]);
		if (rated.length) {
			grid = el('div', 'num-charts');
			var scores = [5, 4, 3, 2, 1].map(function (n) { return { label: n + ' of 5', n: rated.filter(function (f) { return f.overall === n; }).length }; });
			scores.forEach(function (it) { numRows.push(['How it went', 'Rated ' + it.label, it.n]); });
			grid.appendChild(chartCard(barsSvg('How was it overall?', scores, rated.length), 'How was it overall'));
			sec.appendChild(grid);
		}
		var quotes = fb.filter(function (f) { return f.best && f.best.length > 30; }).slice(0, 6);
		if (quotes.length) {
			var ul = el('ul', 'num-quotes');
			quotes.forEach(function (f) { ul.appendChild(el('li', null, '“' + f.best + '”' + (f.challenge ? ' · ' + f.challenge : ''))); });
			sec.appendChild(el('h3', null, 'What worked best, in their words'));
			sec.appendChild(ul);
		}
		if (!fb.length && !state.teams.length && !a.announcements) sec.appendChild(el('p', 'muted', 'This fills in during and after the hackathon.'));

		// reach: where people heard of it, and the tagged links they came through
		sec = numSection(box, 'How they found us', 'The tagged links count the registrations that came through an address with ?utm_source= (roqteam.ro/register?utm_source=instagram).');
		grid = el('div', 'num-charts');
		bdChart(grid, 'How they found us', BREAKDOWNS.filter(function (b) { return b.id === 'heard'; })[0], everyone, 'Heard about BreaQ from');
		var src = {};
		state.records.forEach(function (r) { var k = sourceOf(r); if (k) src[k] = (src[k] || 0) + 1; });
		var tagged = Object.keys(src).sort(function (x, y) { return src[y] - src[x]; }).map(function (k) { return { label: k, n: src[k] }; });
		if (tagged.length) {
			tagged.forEach(function (it) { numRows.push(['How they found us', 'Tagged link: ' + it.label, it.n]); });
			grid.appendChild(chartCard(barsSvg('Registrations by tagged link', tagged, state.records.length), 'Registrations by tagged link'));
		}
		sec.appendChild(grid);
		if (!tagged.length) sec.appendChild(el('p', 'muted', 'No registration has come through a tagged link yet.'));
	}

	$('nums-csv').addEventListener('click', function () {
		var esc = function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
		var text = [['Section', 'Number', 'Value']].concat(numRows).map(function (r) { return r.map(esc).join(','); }).join('\r\n');
		download('breaq-2026-in-numbers-' + dayKey(new Date()) + '.csv', new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
	});

	// For the report: a CSV of one row each, with nothing that names anyone. Registrations without names: everyone who
	// registered, oldest first, with what became of them (the decision, coming, the check-in, the team as a number and
	// its hand-in), and no name, email, phone, letter, team name, dietary need or organiser's grade or note
	function csvFile(name, rows) {
		var text = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
		download(name + '-' + dayKey(new Date()) + '.csv', new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }));
	}

	$('nums-people').addEventListener('click', function () {
		var teamOf = {};   // by email: { n, size, t }
		teamsWithMembers(acceptedPeople()).filter(function (x) { return x.members.length; }).forEach(function (x, i) {
			x.members.forEach(function (m) { teamOf[m.h.email] = { n: i + 1, size: x.members.length, t: x.t }; });
		});
		var rows = [['Registered', 'Event', 'University or company', 'City', 'Status', 'Experience', 'Tracks ticked', 'Hackathon track', 'Heard from',
			'Decision', 'Coming', 'Checked in', 'Outcome', 'Team', 'Team size', 'Team handed in', 'Award']];
		// when they registered: for the hackathon, if they did
		var when = function (p) { return (hackReg(p) || p).time; };
		people(state.records).sort(function (a, b) { return (when(a) || 0) - (when(b) || 0); }).forEach(function (p) {
			var h = hackReg(p);
			var d = h ? decisionOf(h) : '';
			var yes = d === 'accepted';
			var c = yes ? comingOf(h) : '';
			var here = yes && !!get(h, 'Checked in');
			var team = yes ? teamOf[h.email] : null;
			var t = team ? team.t : null;
			rows.push([
				when(p) ? dayKey(when(p)) : '',
				EVENT_LABEL[p.event] || get(p, 'Attends'),
				get(p, 'University or company'),
				p.city,
				get(p, 'Status'),
				get(p, 'Experience'),
				get(h || p, 'Tracks'),
				h ? trackOf(h) : '',
				get(p, 'Heard from'),
				h ? DECISION_LABEL[d] : '',
				yes ? (c === 'yes' ? 'Yes' : c === 'no' ? 'Cannot come' : 'No answer') : '',
				yes ? (here ? 'Yes' : 'No') : '',
				!h ? 'Conference only' : here ? 'Came' : yes ? (c === 'no' ? 'Accepted, could not come' : 'Accepted, did not come') : DECISION_LABEL[d],
				team ? team.n : '',
				team ? team.size : '',
				// Quantum Foundations hands in on a site of its own
				!t ? '' : t.handedIn ? 'Yes' : t.challenge === 'Quantum Foundations' ? '' : 'No',
				t && t.award ? PLACE[t.award] || t.award : ''
			]);
		});
		csvFile('breaq-2026-registrations-no-names', rows);
	});

	// the feedback answers, oldest first (they come without names)
	function feedbackCsv() {
		var rows = [['Sent', 'Challenge', 'Overall', 'Challenge rating', 'Mentors', 'Organisation', 'Food and venue', 'Difficulty', 'Would come again',
			'What worked best', 'What to change', 'What they learned', 'Anything else']];
		state.feedback.filter(function (f) { return f.overall; })
			.sort(function (a, b) { return String(a.sent).localeCompare(String(b.sent)); })
			.forEach(function (f) {
				var sent = new Date(f.sent);
				rows.push([isNaN(sent) ? '' : csvTime(sent), f.challenge, f.overall, f.rChallenge || '', f.rMentors || '', f.rOrganisation || '', f.rVenue || '',
					f.difficulty, f.again, f.best, f.change, f.learned, f.other]);
			});
		csvFile('breaq-2026-feedback', rows);
	}

	$('nums-feedback').addEventListener('click', feedbackCsv);
	$('fb-csv').addEventListener('click', feedbackCsv);

	/* --- reading the letters --------------------------------------------------------- */

	// One registration at a time, its letter beside the facts: 1 to 9 and 0 (for 10) grade and move on, S skips (it
	// comes back at the end), ← goes back. The queue is what needsMe says: the reader's own, a team's members one after
	// another, and the ones skipped after all of them. Every BREAK_EVERY grades, a pause. The letters come through the Apps Script (the
	// "letter" action) as PDFs shown in the page, the next two fetched while the reader reads.

	var BREAK_EVERY = 20;
	var KEEP_LETTERS = 8;   // letters kept in memory, the oldest let go

	var rv = {
		current: null,    // the registration on screen
		trail: [],        // the emails graded or skipped this time, for Back
		skipped: {},      // emails skipped this time: at the end of the queue
		done: 0,          // grades this time, for the pauses
		resting: false,
		letters: {},      // email -> { loading, url, none, error }
		pool: {},         // email -> { vote, note, before }: the grades not sent yet
		poolVoter: '',    // whose they are
		sending: false,
		order: []         // the emails of the letters kept, oldest first
	};
	var review = $('review');

	function hackRecords() {
		return state.records.filter(function (r) { return r.event === 'hackathon' || r.event === 'both'; });
	}

	function reviewQueue() {
		return hackRecords().filter(needsMe).sort(function (a, b) {
			return Number(!!rv.skipped[a.email]) - Number(!!rv.skipped[b.email]) ||
				groupAt(a) - groupAt(b) || a.at - b.at;
		});
	}

	// above the table, for a voter: how many letters wait for them
	function renderReviewPanel() {
		renderPool();
		var panel = $('review-panel');
		panel.hidden = !state.voter || state.event === 'conference';
		if (panel.hidden) return;
		var q = reviewQueue();
		var voted = hackRecords().filter(function (h) { return voteOf(h, state.voter); }).length;
		$('review-status').textContent = (q.length ? plural(q.length, 'letter waits', 'letters wait') + ' for you' : 'No letter waits for you now') +
			' · you have graded ' + voted +
			(poolSize() ? ', ' + plural(poolSize(), 'grade', 'grades') + ' not sent yet' : '');
		$('review-open').disabled = !q.length;
	}

	$('review-open').addEventListener('click', function () {
		rv.trail = [];
		rv.resting = false;
		nextLetter();
		if (typeof review.showModal === 'function') review.showModal();
		else review.setAttribute('open', '');
	});

	function closeReview() {
		if (review.open) {
			if (typeof review.close === 'function') review.close();
			else review.removeAttribute('open');
		}
		rv.current = null;
		sendPool();
		refreshDecisions();
	}

	$('rv-close').addEventListener('click', closeReview);
	review.addEventListener('cancel', function (ev) { ev.preventDefault(); closeReview(); });

	// the letters kept go at Lock, with everything else
	function forgetLetters() {
		rv.order.forEach(function (email) { var L = rv.letters[email]; if (L && L.url) URL.revokeObjectURL(L.url); });
		rv.letters = {};
		rv.order = [];
		rv.skipped = {};
		rv.done = 0;
		rv.pool = {};
		keepPool();
		if (review.open) closeReview();
	}

	function nextLetter() {
		rv.current = reviewQueue()[0] || null;
		renderReview();
	}

	function loadLetter(h) {
		var L = rv.letters[h.email];
		if (L) return L;
		L = rv.letters[h.email] = { loading: true };
		var drive = get(h, 'Motivation letter');
		if (!isUrl(drive)) {
			L.loading = false;
			L.none = drive ? 'The letter did not reach Drive: ' + drive : 'There is no letter in this registration.';
			return L;
		}
		rv.order.push(h.email);
		while (rv.order.length > KEEP_LETTERS) {
			var old = rv.order.shift();
			if (rv.letters[old] && rv.letters[old].url) URL.revokeObjectURL(rv.letters[old].url);
			delete rv.letters[old];
		}
		postAgain({ action: 'letter', key: state.key, email: h.email }, 90000, function (json, err) {
			if (rv.letters[h.email] !== L) return;   // let go meanwhile
			L.loading = false;
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.data) {
				var bin = window.atob(json.data);
				var bytes = new Uint8Array(bin.length);
				for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				L.url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
			} else if (json && json.ok) L.none = json.none || 'There is no letter in this registration.';
			else L.error = actionProblem(json, err, 'send the letters');
			if (review.open && rv.current === h) renderLetter(h);
		});
		return L;
	}

	// a letter that did not come is asked for again the next time it is shown, or at "Try again"
	function forgetFailed(h) {
		var L = rv.letters[h.email];
		if (!L || !L.error) return;
		delete rv.letters[h.email];
		rv.order = rv.order.filter(function (email) { return email !== h.email; });
	}

	function renderReview() {
		var q = reviewQueue();
		var total = rv.done + q.length;
		$('rv-count').textContent = rv.done ? rv.done + ' graded this time · ' + plural(q.length, 'left', 'left') : plural(q.length, 'letter', 'letters') + ' for you';
		$('rv-bar').style.width = (total ? Math.round(100 * rv.done / total) : 100) + '%';
		$('rv-main').hidden = rv.resting || !rv.current;
		$('rv-msg').hidden = !$('rv-main').hidden;
		if (rv.resting) return renderPause();
		if (!rv.current) return renderDone();
		// the next two come while this one is read
		var next = q.filter(function (h) { return h !== rv.current; }).slice(0, 2);
		[rv.current].concat(next).forEach(forgetFailed);
		renderLetter(rv.current);
		renderCard(rv.current);
		next.forEach(loadLetter);
	}

	$('rv-letter').addEventListener('mouseleave', function () {
		var frame = $('rv-letter').querySelector('iframe');
		if (frame && document.activeElement === frame) $('rv-card').focus();
	});

	function renderLetter(h) {
		var box = $('rv-letter');
		box.textContent = '';
		var L = loadLetter(h);
		if (L.url) {
			var frame = el('iframe', 'rv-pdf');
			frame.title = 'Motivation letter of ' + (h.name || 'this person');
			frame.src = L.url + '#navpanes=0&view=FitH';
			box.appendChild(frame);
		} else {
			box.appendChild(el('p', 'rv-letter-msg' + (L.error ? ' bad' : ''), L.loading ? 'Loading the letter…' : L.none || L.error));
		}
		var links = el('p', 'rv-letter-links');
		if (L.url) {
			var tab = el('a', null, 'Open in a new tab');
			tab.href = L.url;
			tab.target = '_blank';
			links.appendChild(tab);
		}
		if (L.error) {
			var retry = el('a', null, 'Try again');
			retry.href = '#';
			retry.addEventListener('click', function (e) {
				e.preventDefault();
				forgetFailed(h);
				renderLetter(h);
			});
			links.appendChild(retry);
		}
		if (isUrl(get(h, 'Motivation letter'))) links.appendChild(link(get(h, 'Motivation letter'), 'Open in Drive'));
		if (links.childNodes.length) box.appendChild(links);
	}

	function fact(dl, label, value) {
		if (!value) return;
		dl.appendChild(el('dt', null, label));
		dl.appendChild(el('dd', null, value));
	}

	function teamText(h) {
		if (!h.team) return TEAM_LABEL[get(h, 'Team')] || '';
		var mates = h.team.members.filter(function (m) { return m !== h; }).map(function (m) { return m.name; })
			.concat(h.team.missing.map(function (n) { return n + ' (not registered)'; }));
		return 'With ' + mates.join(', ');
	}

	function renderCard(h) {
		var card = $('rv-card');
		card.textContent = '';
		var mine = voteOf(h, state.voter);
		card.appendChild(el('p', 'eyebrow', mine ? 'You gave it ' + mine + (rv.pool[h.email] ? ' · not sent yet' : '') : 'One of yours'));
		card.appendChild(el('h2', 'rv-name', h.name || '(no name)'));
		var dl = el('dl', 'rv-facts');
		// the merged name, and what they wrote when it says more than a spelling of it ("Facultatea de Geologie")
		var raw = get(h, 'University or company');
		var bare = function (t) { return fold(t).replace(/[^a-z0-9]/g, ''); };
		fact(dl, 'University', h.org && bare(h.org).indexOf(bare(raw)) === -1 ? h.org + ' (as “' + raw + '”)' : h.org || raw);
		fact(dl, 'Status', get(h, 'Status'));
		fact(dl, 'Experience', get(h, 'Experience'));
		fact(dl, 'Tracks', get(h, 'Tracks'));
		fact(dl, 'Team', teamText(h));
		fact(dl, 'Motivation', get(h, 'Motivation'));
		card.appendChild(dl);

		// the others: who has graded, and their grades once the reader has
		var others = state.voters.filter(function (v) { return v !== state.voter; });
		var box = el('div', 'rv-others');
		if (!revealed([h])) {
			var n = others.filter(function (v) { return voteOf(h, v); }).length;
			box.appendChild(el('p', 'muted', n ? plural(n, 'other has', 'others have') + ' graded it: you see theirs once you grade.' : 'Nobody else has graded it yet.'));
		} else {
			others.forEach(function (v) {
				var x = voteOf(h, v);
				var line = el('p', 'rv-other');
				line.appendChild(el('span', 'vote-chip' + gradeClass(x), v + ' ' + (x || '–')));
				if (noteOf(h, v)) line.appendChild(el('span', 'rv-other-note', '“' + noteOf(h, v) + '”'));
				box.appendChild(line);
			});
		}
		card.appendChild(box);

		var label = el('label', 'rv-note-label', 'A note for the others');
		label.htmlFor = 'rv-note';
		label.appendChild(el('span', 'rv-opt', ' · optional'));
		card.appendChild(label);
		var note = el('input', 'rv-note');
		note.type = 'text';
		note.id = 'rv-note';
		note.maxLength = 200;
		note.placeholder = 'What tipped it, in a few words';
		note.value = noteOf(h, state.voter);
		card.appendChild(note);

		var row = el('div', 'rv-vote');
		row.setAttribute('role', 'group');
		row.setAttribute('aria-label', 'Your grade, from 1 to 10');
		GRADES.forEach(function (g) {
			var btn = el('button', 'btn rv-grade' + gradeClass(g), String(g));
			btn.type = 'button';
			btn.setAttribute('aria-pressed', String(mine === g));
			btn.addEventListener('click', function () { reviewVote(g); });
			row.appendChild(btn);
		});
		card.appendChild(row);
		card.appendChild(el('p', 'rv-scale muted', 'An average of ' + state.grades.accept + ' or more accepts, ' + state.grades.waitlist + ' or more puts on the waiting list, below that denies.'));
		var more = el('div', 'rv-more');
		var back = el('button', 'btn small ghost', '← Back');
		back.type = 'button';
		back.disabled = !rv.trail.length;
		back.addEventListener('click', reviewBack);
		var skip = el('button', 'btn small ghost', mine ? 'Next →' : 'Skip for now →');
		skip.type = 'button';
		skip.addEventListener('click', reviewSkip);
		more.appendChild(back);
		more.appendChild(skip);
		card.appendChild(more);
		card.appendChild(el('p', 'rv-keys muted', '1 to 9, 0 for 10 · S or → ' + (mine ? 'next' : 'skip') + ' · ← back · Esc close'));
	}

	function reviewVote(x) {
		var h = rv.current;
		if (!h || state.pending[h.email]) return;
		var note = $('rv-note') ? $('rv-note').value.trim() : '';
		var again = !!voteOf(h, state.voter);   // a grade changed after Back
		if (!poolVote(h, x, note)) return;   // asked first, and not confirmed
		var said = state.voters.filter(function (v) { return v !== state.voter && voteOf(h, v); })
			.map(function (v) { return v + ' ' + voteOf(h, v); });
		toast(x + ' for ' + (h.name || 'this one') +
			(said.length ? ' · ' + said.join(', ') + ' · average ' + avgText(gradesOf(h).avg) : '') +
			(decisionOf(h) ? ' · ' + DECISION_LABEL[decisionOf(h)] : '') +
			' · ' + plural(poolSize(), 'grade', 'grades') + ' to send');
		if (rv.trail[rv.trail.length - 1] !== h.email) rv.trail.push(h.email);
		delete rv.skipped[h.email];
		if (!again) {
			rv.done++;
			if (rv.done % BREAK_EVERY === 0) {
				rv.resting = true;
				sendPool();   // the pause sends what was read since the last one
			}
		}
		nextLetter();
	}

	// skipped: back at the end of the queue; one already graded (after Back): on to the next
	function reviewSkip() {
		var h = rv.current;
		if (!h) return;
		if (!voteOf(h, state.voter)) rv.skipped[h.email] = true;
		if (rv.trail[rv.trail.length - 1] !== h.email) rv.trail.push(h.email);
		nextLetter();
	}

	// the one before: graded or skipped, to see the others' grades or change one's own
	function reviewBack() {
		var email = rv.trail.pop();
		if (!email) return;
		var h = hackRecords().filter(function (r) { return r.email === email; })[0];
		rv.resting = false;
		rv.current = h || null;
		if (!h) return nextLetter();
		renderReview();
	}

	function renderPause() {
		var box = $('rv-msg');
		box.textContent = '';
		box.appendChild(el('h2', null, plural(rv.done, 'letter', 'letters') + ' read. Take five minutes.'));
		box.appendChild(el('p', 'muted', 'Stand up, drink some water, look at something far away. The next letters wait for you.'));
		var go = el('button', 'btn primary', 'Go on');
		go.type = 'button';
		go.addEventListener('click', function () { rv.resting = false; nextLetter(); });
		var stop = el('button', 'btn ghost', 'Stop for now');
		stop.type = 'button';
		stop.addEventListener('click', function () { rv.resting = false; closeReview(); });
		var row = el('div', 'rv-msg-actions');
		row.appendChild(go);
		row.appendChild(stop);
		box.appendChild(row);
		go.focus();
	}

	function renderDone() {
		var box = $('rv-msg');
		box.textContent = '';
		box.appendChild(el('h2', null, rv.done ? 'That was all of yours. Thank you!' : 'Nothing waits for you now.'));
		box.appendChild(el('p', 'muted', 'New registrations come here too: Refresh the page later to see them.'));
		var close = el('button', 'btn primary', 'Close');
		close.type = 'button';
		close.addEventListener('click', closeReview);
		box.appendChild(close);
		close.focus();
	}

	/* the reading mode's grades: on the page at once, and sent together when the reader presses Send, at each pause
	   and when the letters close. This tab keeps them (sessionStorage) through a reload until they are sent. */
	var POOL_STORE = 'breaq-2026-votes';

	function poolSize() { return Object.keys(rv.pool).length; }

	function keepPool() {
		try {
			if (poolSize()) window.sessionStorage.setItem(POOL_STORE, JSON.stringify({ voter: rv.poolVoter, pool: rv.pool }));
			else window.sessionStorage.removeItem(POOL_STORE);
		} catch (e) {}
	}

	function hackByEmail(email) {
		return hackRecords().filter(function (r) { return r.email === email; })[0] || null;
	}

	// one grade of the pool on the page: the grade and note in the reader's columns and the decision they make; what
	// was there before stays from the first time, to put back if the sheet no longer has the registration
	function poolOn(h, x, note) {
		var had = rv.pool[h.email];
		var before = had && had.before ? had.before : { vote: get(h, voteCol(state.voter)), note: noteOf(h, state.voter), decision: get(h, 'Decision') };
		var next = decisionAfter(h, x);
		setCell(h, voteCol(state.voter), x || '');
		setCell(h, noteCol(state.voter), note);
		setLocal(h, next);
		rv.pool[h.email] = { vote: x, note: note, before: before };
	}

	function poolVote(h, x, note) {
		if (!voteConfirmed([h], [decisionAfter(h, x)])) return false;
		if (rv.poolVoter !== state.voter && poolSize()) sendPool();
		rv.poolVoter = state.voter;
		poolOn(h, x, note);
		keepPool();
		renderPool();
		return true;
	}

	// after the list comes (a Refresh, a reload of the tab): the grades not sent yet, on the registrations as the sheet
	// has them now
	function applyPool() {
		if (!state.voter) return;
		if (!poolSize()) {
			try {
				var kept = JSON.parse(window.sessionStorage.getItem(POOL_STORE) || 'null');
				if (kept && kept.voter === state.voter && kept.pool) { rv.pool = kept.pool; rv.poolVoter = kept.voter; }
			} catch (e) {}
		}
		if (rv.poolVoter !== state.voter) return;
		Object.keys(rv.pool).forEach(function (email) {
			var p = rv.pool[email];
			var h = hackByEmail(email);
			delete rv.pool[email];
			if (h && !state.pending[email]) poolOn(h, p.vote, p.note);   // one no longer in the sheet goes
			else if (h) rv.pool[email] = p;
		});
		keepPool();
	}

	// the pool to the Apps Script in one request, as many grades; what does not go through stays, for Send again
	function sendPool() {
		var emails = Object.keys(rv.pool);
		if (!emails.length || rv.sending) return;
		var sent = {};
		emails.forEach(function (e) { sent[e] = rv.pool[e]; state.pending[e] = true; });
		var voter = rv.poolVoter;
		rv.sending = true;
		renderPool();
		var body = { action: 'votes', key: state.key, items: emails.map(function (e) { return { emails: [e], vote: sent[e].vote, note: sent[e].note }; }) };
		if (state.shared) body.as = voter;
		postAgain(body, 120000, function (json, err) {
			rv.sending = false;
			emails.forEach(function (e) { delete state.pending[e]; });
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.action === 'votes') {
				var got = {};
				(json.set || []).forEach(function (s) { got[s.email] = s; });
				var missing = [];
				emails.forEach(function (e) {
					var h = hackByEmail(e), p = sent[e];
					if (rv.pool[e] === p) delete rv.pool[e];
					if (!h) return;
					if (got[e]) { answered(h, got[e]); return; }
					missing.push(e);
					setCell(h, voteCol(voter), p.before.vote);
					setCell(h, noteCol(voter), p.before.note);
					setLocal(h, p.before.decision);
				});
				keepPool();
				poolNote(missing.length ? notThere(missing) : plural(emails.length, 'grade', 'grades') + ' saved', !!missing.length);
			} else {
				poolNote('The grades were not sent. ' + actionProblem(json, err, 'take several grades at once') + ' They are kept on this page: press Send again.', true);
			}
			refreshDecisions();
			if (review.open && rv.current && !rv.resting) renderCard(rv.current);
		});
		refreshDecisions();
	}

	function poolNote(text, bad) {
		if (review.open) toast(text, bad);
		else dashError(bad ? text : '');
	}

	// Send, in the reading mode and above the table, while there is something to send
	function renderPool() {
		var n = poolSize();
		forEach([$('rv-send'), $('review-send')], function (b) {
			b.hidden = !n && !rv.sending;
			b.disabled = rv.sending;
			b.textContent = rv.sending ? 'Sending…' : 'Send ' + plural(n, 'grade', 'grades');
		});
	}

	$('rv-send').addEventListener('click', sendPool);
	$('review-send').addEventListener('click', sendPool);

	// leaving the page with grades not sent: the browser asks first
	window.addEventListener('beforeunload', function (ev) {
		if (!poolSize() && !rv.sending) return;
		ev.preventDefault();
		ev.returnValue = '';
	});

	var toastTimer = null;
	function toast(text, bad) {
		var t = $('rv-toast');
		t.textContent = text;
		t.className = 'rv-toast' + (bad ? ' bad' : '');
		t.hidden = false;
		window.clearTimeout(toastTimer);
		toastTimer = window.setTimeout(function () { t.hidden = true; }, bad ? 8000 : 4000);
	}

	// the keys, wherever the focus is in the page, except while typing the note (Enter or Esc leaves it). A click
	// in the letter gives the keys to the PDF viewer: the mouse leaving it takes them back.
	document.addEventListener('keydown', function (ev) {
		if (!review.open || ev.ctrlKey || ev.metaKey || ev.altKey) return;
		if (ev.target && ev.target.id === 'rv-note') {
			if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); $('rv-card').focus(); }
			return;
		}
		if (rv.resting || !rv.current) return;
		var k = ev.key.toLowerCase();
		if (/^[0-9]$/.test(k)) reviewVote(Number(k) || 10);
		else if (k === 's' || ev.key === 'ArrowRight') reviewSkip();
		else if (ev.key === 'ArrowLeft') reviewBack();
		else return;
		ev.preventDefault();
	});

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
		if (state.grades) $('grade-scale').textContent = state.grades.accept + ' or more: accepted, ' + state.grades.waitlist + ' or more: the waiting list, below: denied';
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
		a.download = 'breaq-2026-registrations-' + (state.event === 'all' ? 'all' : state.event) + (state.query || state.problems || inTabsFiltered() || filtersOn() ? '-filtered' : '') + '-' + dayKey(new Date()) + '.csv';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
		note('Downloaded ' + plural(lines.length - 1, 'registration', 'registrations'));
	});

	/* --- picked: people chosen for an email ------------------------------------------- */

	// A box on each row (and on each team) picks people, as in a basket: they stay picked through the views, the
	// filters, the search, a Refresh and a reload of this tab (sessionStorage), until Clear, Lock or the email that
	// goes to them. The bar at the bottom counts them, shows only them, copies their emails and emails them.
	var PICK_STORE = 'breaq-2026-admin-picked';
	var lastPick = null;   // the row clicked last, for a Shift-click from there

	function loadPicked() {
		try {
			JSON.parse(window.sessionStorage.getItem(PICK_STORE) || '[]').forEach(function (e) { state.picked[e] = true; });
		} catch (e) {}
	}

	function keepPicked() {
		try {
			var list = Object.keys(state.picked);
			if (list.length) window.sessionStorage.setItem(PICK_STORE, JSON.stringify(list));
			else window.sessionStorage.removeItem(PICK_STORE);
		} catch (e) {}
	}

	// someone no longer in the sheet (or under another email now) is no longer picked
	function prunePicked() {
		var have = {};
		state.records.forEach(function (r) { if (r.email) have[r.email] = true; });
		Object.keys(state.picked).forEach(function (e) { if (!have[e]) delete state.picked[e]; });
		if (!Object.keys(state.picked).length) state.onlyPicked = false;
		keepPicked();
	}

	function isPicked(r) { return !!(r.email && state.picked[r.email]); }

	// the people picked, every event's
	function pickedPeople() {
		return people(state.records).filter(isPicked);
	}

	function pick(rs, on) {
		rs.forEach(function (r) {
			if (!r.email) return;
			if (on) state.picked[r.email] = true;
			else delete state.picked[r.email];
		});
		if (!Object.keys(state.picked).length) state.onlyPicked = false;
		keepPicked();
		// the table again, with the focus back on the box pressed
		var a = document.activeElement;
		var key = a && a.getAttribute ? a.getAttribute('data-pick') : null;
		if (state.onlyPicked) renderFiltered();
		else renderTable();
		if (dialog.open && state.detail) $('detail-pick').checked = isPicked(state.detail);
		if (key === null) return;
		forEach($('people').querySelectorAll('[data-pick]'), function (b) { if (b.getAttribute('data-pick') === key) b.focus(); });
	}

	// a box for one person (i: their row in the table, for Shift-click) or for several (a team, everyone shown)
	function pickBox(rs, label, i) {
		var box = el('input', 'pick');
		box.type = 'checkbox';
		box.setAttribute('aria-label', label);
		box.setAttribute('data-pick', rs.map(function (r) { return r.email; }).join(' '));
		var n = rs.filter(isPicked).length;
		box.checked = n > 0 && n === rs.length;
		box.indeterminate = n > 0 && n < rs.length;
		box.addEventListener('click', function (ev) {
			ev.stopPropagation();   // a click here does not open the registration
			var range = rs;
			if (ev.shiftKey && i !== undefined && lastPick !== null && state.shown[lastPick])
				range = state.shown.slice(Math.min(i, lastPick), Math.max(i, lastPick) + 1);
			if (i !== undefined) lastPick = i;
			pick(range, box.checked);
		});
		return box;
	}

	function renderPickBar() {
		var ps = pickedPeople();
		$('pickbar').hidden = !ps.length;
		$('dash').classList.toggle('has-picks', ps.length > 0);
		if (!ps.length) return;
		var shown = {};
		state.shown.forEach(function (p) { shown[p.email] = true; });
		var away = ps.filter(function (p) { return !shown[p.email]; }).length;
		var count = $('pick-count');
		count.textContent = plural(ps.length, 'person', 'people') + ' selected';
		if (away && state.view === 'regs') count.appendChild(el('em', null, ' · ' + away + ' not in this list'));
		$('pick-only').setAttribute('aria-pressed', String(state.onlyPicked));
		// their dashboard codes, off or on again (the accepted among them)
		var acc = ps.map(hackReg).filter(function (h) { return h && decisionOf(h) === 'accepted'; });
		$('pick-code').hidden = !acc.length;
		$('pick-code').textContent = acc.length && acc.every(codeOff) ? 'Code on again' : 'Code off…';
		// their track, all at once (those only at the conference have none)
		var hs = ps.map(hackReg).filter(Boolean);
		var box = $('pick-track');
		box.textContent = '';
		box.hidden = !hs.length;
		if (!hs.length) return;
		box.appendChild(el('span', 'pick-track-label', 'Track'));
		box.appendChild(trackControl(hs, hs.length === 1 ? 'the person selected' : 'the ' + hs.length + ' people selected'));
	}

	var pickTimer = null;
	function pickNote(msg) {
		$('pick-note').textContent = msg;
		window.clearTimeout(pickTimer);
		pickTimer = window.setTimeout(function () { $('pick-note').textContent = ''; }, 4000);
	}

	$('pick-only').addEventListener('click', function () {
		state.onlyPicked = !state.onlyPicked;
		if (state.view !== 'regs') setView('regs');
		renderFiltered();
	});

	$('pick-copy').addEventListener('click', function () {
		var list = pickedPeople().map(function (p) { return p.email; });
		copyText(list.join(', '), function (ok) {
			pickNote(ok ? 'Copied ' + plural(list.length, 'address', 'addresses') : 'Could not copy: your browser blocked it');
		});
	});

	$('pick-clear').addEventListener('click', function () {
		var n = pickedPeople().length;
		if (n > 3 && !window.confirm('Clear the ' + n + ' people selected?')) return;
		state.picked = {};
		pick([], false);
	});

	$('detail-pick').addEventListener('change', function () {
		if (state.detail) pick([state.detail], $('detail-pick').checked);
	});

	loadPicked();

	/* --- emailing the people picked ------------------------------------------------------ */

	var mailDlg = $('mail-dlg');
	var mailBody = $('mail-body');
	var mailGo = $('mail-go');
	var mailKind = 'accepted';

	var MAIL_HELP = {
		accepted: 'Sets their hackathon decision to Accepted and sends the acceptance: their team dashboard link and code, and the ask to say there that they are coming. The regular Send then counts them as emailed.',
		waitlist: 'Sets their hackathon decision to Waitlist and sends the waiting-list email.',
		denied: 'Sets their hackathon decision to Denied and sends it. Those registered for the conference read that we look forward to seeing them there; the others are invited to register for it.',
		confirmation: 'The “You are registered” email again, one for each event they registered for.',
		custom: 'Your own email, in the look of ours: “Hi” and their first name at the top, your sign-off and RoQTeam at the end. Links starting with https:// can be clicked.',
		eve: 'The last details before the hackathon, in a look of its own: their challenge, the schedule, how to find CAMPUS, the laptop and the WhatsApp group. Only the accepted get it (not those whose code is off); for those with no track, it leaves the challenge out.',
		link: 'For the accepted whose acceptance went out by hand, without their link (More filters → Dashboard link: Accepted, never emailed it): each one’s own team dashboard link, which signs them in, and the ask to press “I am coming” there. Change the text as you like; it goes out as one of your own.'
	};

	// what Your own and Dashboard link start with; each keeps what is typed in it while the other is open
	var MAIL_DRAFTS = {
		custom: { subject: '', text: '', sign: 'Best regards,' },
		link: {
			subject: 'Your link to the BreaQ Hackathon dashboard',
			text: 'You are in the BreaQ Hackathon this weekend, 24–25 October, as our email said. Here is what that email did not have: your own link to the team dashboard.\n\n' +
				'{dashboard}\n\n' +
				'It is where we post everything for the hackathon: the schedule, your team, the challenge resources, a checklist for the day and how to submit. The link signs you in by itself. Keep it to yourself: it is yours alone.\n\n' +
				'Please press “I am coming” there, even if you already told us by replying to our email: it keeps every answer in one place.',
			sign: 'See you on Saturday,'
		}
	};

	function written(kind) { return kind === 'custom' || kind === 'link'; }

	function keepDraft(kind) {
		if (written(kind)) MAIL_DRAFTS[kind] = { subject: $('mail-subject').value, text: $('mail-text').value, sign: $('mail-sign').value };
	}

	function loadDraft(kind) {
		if (!written(kind)) return;
		$('mail-subject').value = MAIL_DRAFTS[kind].subject;
		$('mail-text').value = MAIL_DRAFTS[kind].text;
		$('mail-sign').value = MAIL_DRAFTS[kind].sign;
	}

	function recording() { return DECISIONS.indexOf(mailKind) !== -1 && $('mail-record').checked; }

	function mailLine(cls, text) { mailBody.appendChild(el('p', cls, text)); }

	function mailList(title, items, help) {
		if (!items.length) return;
		var box = el('div', 'send-list');
		box.appendChild(el('h3', null, title + ' · ' + items.length));
		if (help) box.appendChild(el('p', 'muted', help));
		var ul = el('ul');
		items.forEach(function (it) {
			var li = el('li');
			li.appendChild(el('span', 'send-who', (it.name || it.email) + (it.what ? ' · ' + EVENT_LABEL[it.what] : '')));
			if (it.note) li.appendChild(el('span', 'send-note' + (it.warn ? ' warn' : ''), it.note));
			ul.appendChild(li);
		});
		box.appendChild(ul);
		mailBody.appendChild(box);
	}

	function withStatus(items, status) {
		return items.filter(function (it) { return status.indexOf(it.status) !== -1; });
	}

	function renderMailForm() {
		var decision = DECISIONS.indexOf(mailKind) !== -1;
		forEach($('mail-kind').querySelectorAll('button'), function (b) {
			b.setAttribute('aria-pressed', String(b.getAttribute('data-kind') === mailKind));
		});
		$('mail-help').textContent = recording()
			? 'Sets their hackathon decision to ' + DECISION_LABEL[mailKind] + ' and records that they had the email by hand. Sends nothing: the regular Send then leaves them out.'
			: MAIL_HELP[mailKind];
		$('mail-custom').hidden = !written(mailKind);
		$('mail-record-field').hidden = !decision;
		$('mail-note-field').hidden = $('mail-mates-field').hidden = !decision || recording();
		$('mail-fill').hidden = mailKind === 'confirmation' || mailKind === 'eve' || recording();
		$('mail-check').textContent = recording() ? 'Check who it records' : 'Check who gets it';
	}

	// what the preview showed no longer holds once the form changes: check again before sending
	function mailStale() {
		mailGo.hidden = true;
		if (mailBody.childNodes.length) mailBody.classList.add('is-stale');
	}

	function mailRequest(send) {
		return {
			action: 'mail',
			key: state.key,
			send: send,
			kind: mailKind === 'link' ? 'custom' : mailKind,
			record: recording(),
			emails: pickedPeople().map(function (p) { return p.email; }),
			note: $('mail-note').value,
			mates: $('mail-mates').checked,
			again: $('mail-again').checked,
			subject: $('mail-subject').value,
			text: $('mail-text').value,
			sign: $('mail-sign').value
		};
	}

	function openMail() {
		var n = pickedPeople().length;
		if (!n) return;
		$('mail-who').textContent = plural(n, 'person', 'people') + ' selected';
		renderMailForm();
		mailBody.textContent = '';
		mailBody.classList.remove('is-stale');
		mailLine('muted', 'Choose the email, then Check who gets it: you see the list and the email before anything goes out.');
		mailGo.hidden = true;
		if (typeof mailDlg.showModal === 'function') mailDlg.showModal();
		else mailDlg.setAttribute('open', '');
	}

	function closeMail() {
		if (typeof mailDlg.close === 'function') mailDlg.close();
		else mailDlg.removeAttribute('open');
	}

	forEach($('mail-kind').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () {
			keepDraft(mailKind);
			mailKind = b.getAttribute('data-kind');
			loadDraft(mailKind);
			renderMailForm();
			mailStale();
		});
	});

	$('mail-record').addEventListener('change', renderMailForm);

	$('mail-form').addEventListener('input', mailStale);
	$('mail-form').addEventListener('change', mailStale);

	$('mail-form').addEventListener('submit', function (ev) {
		ev.preventDefault();
		if (written(mailKind) && (!$('mail-subject').value.trim() || !$('mail-text').value.trim())) {
			mailBody.textContent = '';
			mailBody.classList.remove('is-stale');
			mailLine('err', 'Write the subject and the message first.');
			($('mail-subject').value.trim() ? $('mail-text') : $('mail-subject')).focus();
			return;
		}
		var check = $('mail-check');
		check.disabled = true;
		mailBody.textContent = '';
		mailBody.classList.remove('is-stale');
		mailLine('muted', 'Checking who gets it…');
		mailGo.hidden = true;
		post(mailRequest(false), 60000, function (json, err) {
			check.disabled = false;
			if (json && json.ok && json.action === 'mail') mailPreview(json);
			else mailFailed(json, err, false);
		});
	});

	// before sending: how many, who has it already, who is left out and why, and the email as the first one reads it
	function mailPreview(json) {
		var items = json.items || [];
		var due = withStatus(items, ['to send']);
		mailBody.textContent = '';
		// a script from before "only record it" would send the emails: it has to say it records
		if (recording() && json.record !== true) {
			mailLine('err', actionProblem({}, null, 'record emails sent by hand'));
			mailGo.hidden = true;
			return;
		}
		if (recording()) { recordPreview(due, items); return; }
		var can = typeof json.emailsLeft === 'number' ? Math.max(0, json.emailsLeft - json.reserve) : due.length;
		mailLine('send-big', due.length ? plural(due.length, 'email', 'emails') + ' to send' : 'Nothing to send');
		dashboardWarnings(due);
		if (due.length > can)
			mailLine('send-warn', 'Google allows ' + json.emailsLeft + ' more emails today' + (json.reserve ? ' and ' + json.reserve + ' stay free for new registrations' : '') + ', so ' +
				(can ? 'the first ' + can + ' go today. Send again tomorrow for the other ' + (due.length - can) + ': they stay selected.' : 'none can go out today. Try again tomorrow.'));
		var changing = due.filter(function (it) { return / until now/.test(it.note); }).length;
		if (changing) mailLine('send-warn', plural(changing, 'decision changes', 'decisions change') + ' with this email (“until now” below).');
		mailList('To send', due, due.some(function (it) { return it.warn; }) ? 'The ones marked go out as they are: check them first (a team, a track not given yet).' : '');
		mailList('Had it already', withStatus(items, ['sent before']), 'Tick “Also to those who already had this email” to send it again.');
		mailList('Left out', withStatus(items, ['skipped', 'missing']));
		if (json.sample) {
			var box = el('div', 'mail-sample');
			box.appendChild(el('h3', null, 'As ' + (json.sample.name || json.sample.email) + ' reads it'));
			box.appendChild(el('p', 'mail-subject', 'Subject: ' + json.sample.subject));
			var frame = el('iframe', 'mail-frame');
			frame.setAttribute('sandbox', '');   // our own HTML, shown without running anything or following its links
			frame.title = 'The email as ' + (json.sample.name || json.sample.email) + ' reads it';
			frame.srcdoc = json.sample.html;
			box.appendChild(frame);
			mailBody.appendChild(box);
		}
		mailGo.hidden = !due.length || !can;
		mailGo.disabled = false;
		mailGo.textContent = 'Send ' + plural(Math.min(due.length, can), 'email', 'emails');
	}

	// {dashboard} for someone it does not open for, or who has the link already
	function dashboardWarnings(due) {
		if (!written(mailKind) || !/\{dashboard\}/i.test($('mail-subject').value + $('mail-text').value)) return;
		var rs = due.map(function (it) {
			var p = state.records.filter(function (r) { return r.email === it.email && (r.event === 'hackathon' || r.event === 'both'); })[0];
			return { name: it.name || it.email, h: p || null };
		});
		var shut = rs.filter(function (x) { return !x.h || decisionOf(x.h) !== 'accepted'; });
		var had = rs.filter(function (x) { return x.h && decisionOf(x.h) === 'accepted' && hasLink(x.h); });
		if (shut.length) mailLine('send-warn', 'Not accepted, so the link does not open the dashboard for them: ' + shut.map(function (x) { return x.name; }).join(', ') + '. Unselect them first.');
		if (had.length) mailLine('send-warn', 'Had their link already, in our acceptance or an email about the dashboard: ' + had.map(function (x) { return x.name; }).join(', ') + '.');
	}

	// "only record it": who it records, and the decision it sets
	function recordPreview(due, items) {
		var label = DECISION_LABEL[mailKind];
		mailLine('send-big', due.length ? 'To record for ' + plural(due.length, 'person', 'people') : 'Nothing to record');
		mailLine('muted', 'No email goes out. Their decision becomes ' + label + ' and “Decision email” says it was sent by hand, so the regular Send leaves them out.');
		var changing = due.filter(function (it) { return / until now/.test(it.note); }).length;
		if (changing) mailLine('send-warn', plural(changing, 'decision changes', 'decisions change') + ' with this (“until now” below).');
		mailList('To record', due);
		mailList('Recorded or emailed already', withStatus(items, ['sent before']));
		mailList('Left out', withStatus(items, ['skipped', 'missing']));
		mailGo.hidden = !due.length;
		mailGo.disabled = false;
		mailGo.textContent = 'Record for ' + plural(due.length, 'person', 'people');
	}

	mailGo.addEventListener('click', function () {
		var rec = recording();
		mailGo.disabled = true;
		mailGo.classList.add('is-busy');
		mailGo.textContent = rec ? 'Recording…' : 'Sending…';
		$('mail-check').disabled = true;
		mailLine('muted', rec ? 'Recording.' : 'Sending. This can take a few minutes; the page waits for the Apps Script to finish.');
		post(mailRequest(true), 6.5 * 60 * 1000, function (json, err) {
			mailGo.classList.remove('is-busy');
			mailGo.hidden = true;
			$('mail-check').disabled = false;
			if (json && json.ok && json.action === 'mail') mailSent(json);
			else mailFailed(json, err, true);
			if (!(json && json.denied)) refresh();
		});
	});

	// after: those who got it are no longer picked; the rest stay, for another try
	function mailSent(json) {
		var items = json.items || [];
		var done = withStatus(items, ['sent', 'recorded']);
		pick(done, false);
		var left = pickedPeople().length;
		mailBody.textContent = '';
		if (json.record) mailLine('send-big', done.length ? 'Recorded for ' + plural(done.length, 'person', 'people') : 'Nothing recorded');
		else mailLine('send-big', done.length ? plural(done.length, 'email', 'emails') + ' sent' : 'No email sent');
		if (done.length) mailLine('muted', 'Those ' + (json.record ? 'recorded' : 'who got it') + ' are no longer selected' + (left ? '; the other ' + left + ' still are.' : '.'));
		if (json.stopped === 'quota') mailLine('send-warn', (json.reserve ? 'Stopped with ' + json.reserve + ' of today’s emails left for new registrations.' : 'Today’s emails are used up.') + ' Send again tomorrow for the rest: they stay selected.');
		if (json.stopped === 'time') mailLine('send-warn', 'Stopped before the Apps Script’s time limit. Send again for the rest: they stay selected.');
		mailList('Failed', withStatus(items, ['failed']), 'They stay selected: send again to try once more.');
	}

	function mailFailed(json, err, sending) {
		if (json && json.denied) { closeMail(); lock(json.error); return; }
		mailBody.textContent = '';
		var msg = actionProblem(json, err, 'email the selected');
		if (sending && !(json && json.action)) msg += ' Some emails may have gone out: the table shows who was emailed once the page has refreshed.';
		mailLine('err', msg);
		mailGo.hidden = true;
	}

	$('pick-mail').addEventListener('click', openMail);
	$('mail-close').addEventListener('click', closeMail);
	mailDlg.addEventListener('click', function (ev) { if (ev.target === mailDlg) closeMail(); });

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

	var VIEWS = ['regs', 'teams', 'checkin', 'board', 'after', 'numbers'];

	function setView(view) {
		if (view !== 'checkin') stopScan();   // the camera goes off with the Check-in view
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
		else if (state.view === 'board') { renderBoardAccess(); renderMentors(); renderAudience(); renderScreenKey(); renderFlash(); }
		else if (state.view === 'after') renderAfter();
		else if (state.view === 'numbers') renderNumbers();
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

	// as the Apps Script's comingOf_ reads it: the dashboard writes yes or no, and "confirmed", "da" or "nu" typed in
	// the sheet by hand (an answer by email) read the same
	function comingOf(h) {
		var c = get(h, 'Coming').trim().toLowerCase();
		if (/^(yes|y|da|confirm[a-z]*|coming|vine|true|✓|✔)(?![a-z])/.test(c)) return 'yes';
		if (/^(no|n|nu|false|declined|cancel[a-z]*)$|^(not|cannot|can't|nu) (com|vine)/.test(c)) return 'no';
		return '';
	}

	function comingTag(h) {
		var c = comingOf(h);
		if (codeOff(h) && !c) {
			var off = el('span', 'ctag ctag-off', 'Code off');
			off.title = 'Their dashboard code is off' + (isNaN(new Date(get(h, 'Code off'))) ? '' : ' since ' + fmtShort.format(new Date(get(h, 'Code off'))));
			return off;
		}
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
			['No answer yet', list.filter(function (x) { return !comingOf(x.h) && !codeOff(x.h); }).length],
			['Code off', list.filter(function (x) { return codeOff(x.h); }).length],
			['Teams', teams.length],
			['Not in a team', loose.length, loose.length ? 'tile--warn' : ''],
			['Handed in', teams.filter(function (x) { return x.t.repo; }).length + ' of ' + teams.length]
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
		card.appendChild(el('p', 'tcard-facts', t.pitch ? 'Pitch ' + t.pitch + (t.room ? ' · ' + t.room : '') : 'No pitch time yet'));
		card.appendChild(handinBlock(t));
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

	// what the team handed in from its dashboard, for the jury: the links, the line, when and who; or that it has not
	function handinBlock(t) {
		var box = el('div', 'thandin' + (t.repo ? ' is-in' : ''));
		if (!t.repo) {
			box.appendChild(el('p', 'thandin-none', 'Not handed in yet'));
			return box;
		}
		box.appendChild(el('p', 'thandin-when', '✓ Handed in' + (t.handedIn ? ' ' + fmtShort.format(new Date(t.handedIn)) : '') + (t.handedInBy ? ' by ' + t.handedInBy : '')));
		var links = el('p', 'thandin-links');
		[['Code', t.repo], ['Slides', t.slides], ['Video', t.video]].forEach(function (x) {
			if (!x[1]) return;
			if (links.childNodes.length) links.appendChild(document.createTextNode(' · '));
			links.appendChild(link(x[1], x[0]));
		});
		box.appendChild(links);
		if (t.about) box.appendChild(el('p', 'thandin-about', '“' + t.about + '”'));
		return box;
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
		var pitch = input(t.pitch, { maxlength: '20', placeholder: '10:15' });
		var room = input(t.room, { maxlength: '40', placeholder: 'Room B' });
		var award = select([['', 'None'], ['1st', 'First place'], ['2nd', 'Second place'], ['3rd', 'Third place']], t.award);
		form.appendChild(labelled('Team name', name));
		form.appendChild(labelled('Challenge', challenge));
		var row = el('div', 'tform-row');
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
			var team = { was: t.name, name: name.value.trim(), challenge: challenge.value, table: t.table || '', pitch: pitch.value.trim(), room: room.value.trim(), award: award.value };
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
			var code = state.codes[x.h.email] || '';
			return !q || fold(x.p.name + ' ' + x.h.email + ' ' + teamOfH(x.h) + ' ' + code + ' ' + code.replace(/-/g, '')).indexOf(q) !== -1;
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

	/* the passes: the QR code on each participant's dashboard (their personal code), read by the camera. Chrome reads
	   them with its own reader (BarcodeDetector); Safari, and every browser on an iPhone, has none, so jsQR
	   (assets/js/vendor, Apache 2.0) reads the camera's frames there, loaded the first time it is needed. */

	var JSQR_SRC = 'assets/js/vendor/jsqr-1.4.0.js';
	var scanUi = { stream: null, timer: null, read: null, last: '', lastAt: 0 };

	function loadJsQr(done) {
		if (window.jsQR) { done(true); return; }
		var s = document.createElement('script');
		s.src = JSQR_SRC;
		s.onload = function () { done(!!window.jsQR); };
		s.onerror = function () { done(false); };
		document.head.appendChild(s);
	}

	// read(video) gives a promise of the text of the QR code in the frame, or ''; done(null) when there is no reader
	function qrReader(done) {
		if (scanUi.read) { done(scanUi.read); return; }
		function withJsQr() {
			loadJsQr(function (ok) {
				if (!ok) { done(null); return; }
				var canvas = document.createElement('canvas');
				var ctx = canvas.getContext('2d', { willReadFrequently: true });
				scanUi.read = function (video) {
					var w = video.videoWidth, h = video.videoHeight;
					if (!w || !h) return Promise.resolve('');
					var scale = Math.min(1, 720 / Math.max(w, h));   // enough for a pass held up close, and quick on a phone
					canvas.width = Math.round(w * scale);
					canvas.height = Math.round(h * scale);
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
					var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
					var code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
					return Promise.resolve(code ? code.data : '');
				};
				done(scanUi.read);
			});
		}
		if (!('BarcodeDetector' in window)) { withJsQr(); return; }
		window.BarcodeDetector.getSupportedFormats().then(function (formats) {
			if (formats.indexOf('qr_code') === -1) { withJsQr(); return; }
			var det = new window.BarcodeDetector({ formats: ['qr_code'] });
			scanUi.read = function (video) {
				return det.detect(video).then(function (codes) { return codes.length ? codes[0].rawValue : ''; });
			};
			done(scanUi.read);
		}).catch(withJsQr);
	}

	function codeKeyOf(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

	// the accepted participant whose pass this is, or null
	function byCode(raw) {
		var key = codeKeyOf(raw);
		if (key.length !== 8) return null;
		var email = Object.keys(state.codes).filter(function (e) { return codeKeyOf(state.codes[e]) === key; })[0];
		if (!email) return null;
		return acceptedPeople().filter(function (x) { return x.h.email === email; })[0] || null;
	}

	function scanSay(cls, title, sub) {
		var box = $('scan-result');
		box.textContent = '';
		box.className = 'scan-result ' + cls;
		box.appendChild(el('p', 'scan-title', title));
		if (sub) box.appendChild(el('p', 'scan-sub', sub));
	}

	function scanned(raw) {
		var key = codeKeyOf(raw);
		var now = Date.now();
		if (key === scanUi.last && now - scanUi.lastAt < 5000) return;   // the same pass, still in front of the camera
		scanUi.last = key;
		scanUi.lastAt = now;
		// the test pass, for trying the camera at the door before anyone comes: read, and nobody checked in
		if (key === 'BREAQTEST') { scanSay('is-ok', '✓ Test pass', 'The camera reads the passes. Nobody was checked in.'); return; }
		var x = byCode(raw);
		if (!x) { scanSay('is-bad', 'Not a pass we know', 'Not an accepted participant’s code (' + raw.slice(0, 20) + '), or the page is older than their acceptance: press Refresh.'); return; }
		var facts = [teamOfH(x.h) || 'No team', get(x.h, 'T-shirt') ? 'T-shirt ' + get(x.h, 'T-shirt') : '', get(x.h, 'Dietary')].filter(Boolean).join(' · ');
		if (get(x.h, 'Checked in')) { scanSay('is-again', 'Already here: ' + x.p.name, 'Since ' + fmtClock.format(new Date(get(x.h, 'Checked in'))) + ' · ' + facts); return; }
		scanSay('is-ok', '✓ ' + x.p.name, facts);
		checkIn(x, false);
	}

	function scanLoop() {
		scanUi.timer = window.setTimeout(function () {
			if (!scanUi.stream) return;
			scanUi.read($('scan-video')).then(function (raw) {
				if (raw) scanned(raw);
			}).catch(function () {}).then(scanLoop);
		}, 250);
	}

	function stopScan() {
		window.clearTimeout(scanUi.timer);
		if (scanUi.stream) scanUi.stream.getTracks().forEach(function (t) { t.stop(); });
		scanUi.stream = null;
		$('scan-video').srcObject = null;
		$('scan').hidden = true;
		$('scan-open').hidden = false;
	}

	$('scan-open').addEventListener('click', function () {
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			viewError('checkin-err', 'This browser cannot open the camera here. Type the code under the pass in the search instead.');
			return;
		}
		viewError('checkin-err', '');
		var reader = null, stream = null, failed = false;
		// the camera and the reader together; the scanning starts once both are there
		function start() {
			if (failed || !reader || !stream) return;
			scanUi.stream = stream;
			scanUi.read = reader;
			var v = $('scan-video');
			v.srcObject = stream;
			var playing = v.play();
			if (playing && playing.catch) playing.catch(function () {});
			$('scan').hidden = false;
			$('scan-open').hidden = true;
			scanSay('', 'Ready', 'Hold a pass up to the camera: each one checks its owner in at once.');
			scanLoop();
		}
		qrReader(function (read) {
			if (!read) {
				failed = true;
				if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
				viewError('checkin-err', 'The QR reader did not load. Check the connection and press Scan passes again, or type the code under the pass in the search.');
				return;
			}
			reader = read;
			start();
		});
		navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
			if (failed) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
			stream = s;
			start();
		}).catch(function (err) {
			failed = true;
			viewError('checkin-err', 'The camera did not open' + (err && err.name === 'NotAllowedError' ? ': allow it for roqteam.ro in the browser (on an iPhone: Settings, Safari, Camera), then press Scan passes again.' : '. Is another app using it?'));
		});
	});

	$('scan-close').addEventListener('click', stopScan);

	/* the big screen's live message: shown at once, for a few minutes, or taken down */

	function renderFlash() {
		var form = $('flash-form');
		form.hidden = state.flash === undefined;   // an older Apps Script
		if (form.hidden) return;
		var f = state.flash && Date.now() < Date.parse(state.flash.until) ? state.flash : null;
		$('flash-now').textContent = f ? 'On the screen until ' + fmtClock.format(new Date(f.until)) + ': “' + f.text + '”' : 'Nothing on the screen now: a message here goes up on it within a few seconds.';
		$('flash-now').classList.toggle('is-on', !!f);
		$('flash-off').hidden = !f;
	}

	forEach($('flash-presets').querySelectorAll('button'), function (b) {
		b.addEventListener('click', function () {
			$('flash-text').value = b.getAttribute('data-text');
			$('flash-sub').value = b.getAttribute('data-sub');
			$('flash-text').focus();
		});
	});

	function sendFlash(body, done) {
		$('flash-go').disabled = $('flash-off').disabled = true;
		$('flash-note').textContent = 'Sending…';
		body.action = 'screen-flash';
		body.key = state.key;
		post(body, 30000, function (json, err) {
			$('flash-go').disabled = $('flash-off').disabled = false;
			$('flash-note').textContent = '';
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok) {
				state.flash = json.flash;
				viewError('board-err', '');
				boardNote('flash-note', done(json));
				if (json.posted) loadBoard();   // the announcement it also made
			} else viewError('board-err', 'Nothing went up on the screen. ' + actionProblem(json, err, 'show a message on the big screen'));
			renderFlash();
		});
	}

	$('flash-form').addEventListener('submit', function (ev) {
		ev.preventDefault();
		var text = $('flash-text').value.trim();
		if (!text) { $('flash-note').textContent = 'Write the message first.'; $('flash-text').focus(); return; }
		sendFlash({ text: text, sub: $('flash-sub').value.trim(), minutes: Number($('flash-min').value), post: $('flash-post').checked }, function (json) {
			$('flash-text').value = '';
			$('flash-sub').value = '';
			$('flash-post').checked = false;
			return 'On the screen within a few seconds' + (json.posted ? ', and posted on the dashboards.' : '.');
		});
	});

	$('flash-off').addEventListener('click', function () {
		sendFlash({ text: '' }, function () { return 'Taken down: the screen is back within a few seconds.'; });
	});

	/* the big screen's password: set here, kept in the Apps Script (SCREEN_KEY) */

	function renderScreenKey() {
		var form = $('screen-key-form');
		form.hidden = state.screenKey === null;   // an older Apps Script
		if (form.hidden || document.activeElement === $('screen-key')) return;
		$('screen-key').value = state.screenKey || '';
	}

	$('screen-key-form').addEventListener('submit', function (ev) {
		ev.preventDefault();
		var value = $('screen-key').value.trim();
		$('screen-key-save').disabled = true;
		$('screen-key-note').textContent = 'Saving…';
		post({ action: 'screen-key', key: state.key, screenKey: value }, 30000, function (json, err) {
			$('screen-key-save').disabled = false;
			$('screen-key-note').textContent = '';
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok) {
				state.screenKey = json.screenKey;
				viewError('board-err', '');
				boardNote('screen-key-note', json.screenKey ? 'Saved: the screen opens with ' + json.screenKey + '.' : 'Cleared: only the admin key opens the screen.');
			} else viewError('board-err', 'The password was not saved. ' + actionProblem(json, err, 'keep a password for the big screen'));
		});
	});

	/* the audience award: the organisers open the vote at the awards, then close it and show the result */

	var AUD_STATUS = {
		'': 'Not open. Open it at the awards: each participant checked in at the door votes on their dashboard for one team, not their own, and the big screen counts the votes.',
		open: 'Open: the dashboards show the teams, and the big screen the number of votes. Close it to show the result there and on the dashboards.',
		shown: 'Closed: the result is on the big screen and on the dashboards.'
	};

	function renderAudience() {
		var a = state.audience;
		var panel = document.querySelector('.aud-panel');
		panel.hidden = !a;   // an older Apps Script
		if (!a) return;
		$('aud-count').textContent = a.total ? plural(a.total, 'vote', 'votes') : '';
		$('aud-status').textContent = AUD_STATUS[a.state] || '';
		$('aud-open').hidden = a.state === 'open';
		$('aud-open').textContent = a.state === 'shown' ? 'Open it again' : 'Open the vote';
		$('aud-show').hidden = a.state !== 'open';
		$('aud-back').hidden = !a.state;
		$('aud-clear').hidden = !a.total || a.state === 'open';
		var ol = $('aud-list');
		ol.textContent = '';
		(a.teams || []).filter(function (t) { return t.votes; }).forEach(function (t) {
			var li = el('li');
			li.appendChild(el('span', 'aud-name', t.name));
			li.appendChild(el('span', 'aud-n', plural(t.votes, 'vote', 'votes')));
			ol.appendChild(li);
		});
	}

	function setAudience(next, clear, done) {
		var buttons = ['aud-open', 'aud-show', 'aud-back', 'aud-clear'];
		buttons.forEach(function (id) { $(id).disabled = true; });
		$('aud-note').textContent = 'Saving…';
		post({ action: 'audience-state', key: state.key, state: next, clear: !!clear }, 30000, function (json, err) {
			buttons.forEach(function (id) { $(id).disabled = false; });
			$('aud-note').textContent = '';
			if (json && json.denied) { lock(json.error); return; }
			if (json && json.ok && json.audience) {
				state.audience = json.audience;
				viewError('board-err', '');
				$('aud-note').textContent = done || '';
			} else viewError('board-err', 'The vote did not change. ' + actionProblem(json, err, 'run the audience award'));
			renderAudience();
		});
	}

	$('aud-open').addEventListener('click', function () { setAudience('open', false, 'The vote is open.'); });
	$('aud-show').addEventListener('click', function () {
		if (window.confirm('Close the vote, and show the result on the big screen and on every dashboard?')) setAudience('shown', false, 'Closed: the result is up.');
	});
	$('aud-back').addEventListener('click', function () {
		if (window.confirm('Put the vote back as before it opened? The votes stay, and nothing shows on the dashboards or the big screen.')) setAudience('', false, 'Back as before.');
	});
	$('aud-clear').addEventListener('click', function () {
		var a = state.audience || {};
		if (window.confirm('Delete all ' + plural(a.total || 0, 'vote', 'votes') + '? For after a test: it cannot be undone.')) setAudience(a.state === 'shown' ? '' : a.state || '', true, 'The votes are cleared.');
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
		renderPics();
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

	/* the participants' photos (breaq-2026-photos.html): waiting for one of you, or on the page */

	var pics = { busy: {} };   // the ids being put up or taken off

	// the After view's button says how many wait, whichever view is open
	function renderPicsBadge() {
		var n = state.photos ? state.photos.waiting.length : 0;
		$('f-view').querySelector('[data-view="after"]').textContent = 'After the event' + (n ? ' · ' + plural(n, 'new photo', 'new photos') : '');
	}

	function renderPics() {
		renderPicsBadge();
		var p = state.photos;
		$('pics-count').textContent = p && p.waiting.length ? p.waiting.length + ' waiting' : '';
		$('pics-status').textContent = p === undefined
			? 'The Apps Script does not show the photos here yet: paste tools/register-backend.gs into the editor, then Deploy → Manage deployments → pencil → Version: New version → Deploy.'
			: !p ? 'Google could not read the photos just now: Refresh in a minute.'
			: plural(p.shown.length, 'photo', 'photos') + ' on the page, under From you';
		picsInto('pics-waiting', p ? p.waiting : [], true);
		picsInto('pics-up', p ? p.shown : [], false);
	}

	function picsInto(id, list, waiting) {
		var box = $(id);
		box.textContent = '';
		if (!list.length) { box.appendChild(el('p', 'muted', waiting ? 'Nothing waiting.' : 'None yet.')); return; }
		list.forEach(function (p) {
			var fig = el('figure', 'pic' + (pics.busy[p.id] ? ' is-busy' : ''));
			var a = link('https://drive.google.com/file/d/' + encodeURIComponent(p.id) + '/view');
			a.className = 'pic-img';
			var img = el('img');
			img.alt = 'Sent by ' + (p.name || 'someone');
			img.loading = 'lazy';
			img.src = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(p.id) + '&sz=w400';
			a.appendChild(img);
			fig.appendChild(a);
			var cap = el('figcaption', null, (p.name || 'Put in Drive by hand') + ' · ' + fmtShort.format(new Date(p.at)));
			if (p.email) cap.title = p.email;
			fig.appendChild(cap);
			var row = el('div', 'pic-actions');
			if (waiting) row.appendChild(picButton(p, true));
			row.appendChild(picButton(p, false));
			fig.appendChild(row);
			box.appendChild(fig);
		});
	}

	function picButton(p, put) {
		var b = el('button', 'btn small' + (put ? ' primary' : ''), put ? 'Put up' : 'Take off');
		b.type = 'button';
		b.disabled = !!pics.busy[p.id];
		b.addEventListener('click', function () { reviewPic(p, put); });
		return b;
	}

	function reviewPic(p, put) {
		pics.busy[p.id] = true;
		viewError('after-err', '');
		renderPics();
		post({ action: 'photo-review', key: state.key, id: p.id, put: put }, 60000, function (json, err) {
			delete pics.busy[p.id];
			if (json && json.denied) { lock(json.error); return; }
			var ph = state.photos;
			if (json && json.ok && ph) {
				ph.waiting = ph.waiting.filter(function (x) { return x.id !== p.id; });
				ph.shown = ph.shown.filter(function (x) { return x.id !== p.id; });
				if (put) ph.shown = [p].concat(ph.shown).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
			} else if (!(json && json.ok)) viewError('after-err', actionProblem(json, err, 'put photos up or take them off'));
			if (state.view === 'after') renderPics(); else renderPicsBadge();
		});
	}

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
		// the parts rated besides Overall, each out of those who rated it
		[['rChallenge', 'Challenge'], ['rMentors', 'Mentors'], ['rOrganisation', 'Organisation'], ['rVenue', 'Food and venue']].forEach(function (x) {
			var rated = fb.filter(function (f) { return f[x[0]]; });
			if (rated.length) tiles.push([x[1] + ', out of 5', (rated.reduce(function (s, f) { return s + f[x[0]]; }, 0) / rated.length).toFixed(1) + ' (' + rated.length + ')']);
		});
		var hard = function (v) { return fb.filter(function (f) { return f.difficulty === v; }).length; };
		if (hard('easy') + hard('right') + hard('hard')) tiles.push(['Challenge: easy · right · hard', hard('easy') + ' · ' + hard('right') + ' · ' + hard('hard')]);
		tilesInto('fb-tiles', tiles);
		$('fb-cols').hidden = !fb.length;
		[['fb-best', 'best'], ['fb-change', 'change'], ['fb-learned', 'learned'], ['fb-other', 'other']].forEach(function (x) {
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
