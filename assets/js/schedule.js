/*
	BreaQ Hackathon: the schedule, for the team dashboard (teams.js) and the big screen (screen.js), the times in
	Bucharest time. As planned (not on breaq-hackathon.html yet): change it here, and both follow. Full timestamps
	with their offset: summer time ends in the night (04:00 → 03:00 on Sunday), so the night's coding block is five
	hours. kind: key (the moments that matter), code, talk, meal, stop (coding stops: the hand-in closes, as
	HANDIN_BY in tools/register-backend.gs), award.
*/

window.BREAQ_SCHEDULE = [
	['2026-10-24T09:00:00+03:00', '2026-10-24T10:00:00+03:00', 'Official opening', 'key'],
	['2026-10-24T10:30:00+03:00', '2026-10-24T13:30:00+03:00', 'Start hacking', 'code'],
	['2026-10-24T14:00:00+03:00', '2026-10-24T14:30:00+03:00', 'Workshop', 'talk'],
	['2026-10-24T14:30:00+03:00', '2026-10-24T15:00:00+03:00', 'Coding time', 'code'],
	['2026-10-24T15:00:00+03:00', '2026-10-24T15:30:00+03:00', 'Lunch', 'meal'],
	['2026-10-24T15:30:00+03:00', '2026-10-24T20:00:00+03:00', 'Coding time', 'code'],
	['2026-10-24T20:00:00+03:00', '2026-10-24T20:30:00+03:00', 'Workshop', 'talk'],
	['2026-10-24T20:30:00+03:00', '2026-10-24T22:00:00+03:00', 'Coding time', 'code'],
	['2026-10-24T22:00:00+03:00', '2026-10-24T22:30:00+03:00', 'Dinner', 'meal'],
	['2026-10-24T22:30:00+03:00', '2026-10-25T02:00:00+03:00', 'Coding time', 'code'],
	['2026-10-25T02:00:00+03:00', '2026-10-25T02:30:00+03:00', 'Snack', 'meal'],
	['2026-10-25T02:30:00+03:00', '2026-10-25T06:30:00+02:00', 'Coding time', 'code'],
	['2026-10-25T06:30:00+02:00', '2026-10-25T07:00:00+02:00', 'Breakfast', 'meal'],
	['2026-10-25T07:00:00+02:00', '2026-10-25T09:00:00+02:00', 'Coding time', 'code'],
	['2026-10-25T09:00:00+02:00', null, 'Stop coding', 'stop'],
	['2026-10-25T09:30:00+02:00', '2026-10-25T12:00:00+02:00', 'Judging', 'key'],
	['2026-10-25T12:00:00+02:00', '2026-10-25T14:00:00+02:00', 'Awards', 'award']
].map(function (s) {
	return { from: Date.parse(s[0]), to: s[1] ? Date.parse(s[1]) : null, title: s[2], kind: s[3] };
});
