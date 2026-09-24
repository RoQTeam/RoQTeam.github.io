/**
 * BreaQ 2026 registration backend: Google Apps Script.
 *
 * What it does
 *   - receives the JSON that register.html posts
 *   - appends one row per registration to a Google Sheet (tab "Registrations")
 *   - sends a confirmation email to the participant and a short notice to the team
 *   - ignores obvious bots (honeypot field, forms submitted in under 3 seconds)
 *   - answers a second registration with the same email without creating a duplicate row
 *
 * Setup (once, about five minutes; also in README.md)
 *   1. Create a Google Sheet, e.g. "BreaQ 2026 registrations".
 *   2. Extensions -> Apps Script. Replace the editor content with this file. Save.
 *   3. Deploy -> New deployment -> type "Web app".
 *      Execute as: Me. Who has access: Anyone. Deploy, then authorise the permissions it asks for.
 *   4. Copy the web app URL (ends in /exec) into register.html: data-endpoint="...".
 *   5. Test: fill the form on the site. A row appears in the sheet and two emails go out.
 *
 * To change this script later: edit, save, then Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy.
 * The URL stays the same. (Editing without a new version does not change what the site talks to.)
 *
 * Email quota: a personal Google account can send 100 emails a day from Apps Script, a Google Workspace
 * account 1,500. Two emails go out per registration.
 */

var SHEET_NAME = 'Registrations';
var NOTIFY = 'partnerships@roqteam.ro';       // where the "new registration" notices go; '' to disable
var REPLY_TO = 'partnerships@roqteam.ro';
var SENDER_NAME = 'RoQTeam · BreaQ 2026';
var SITE = 'https://roqteam.ro';

var COLUMNS = [
	'Timestamp', 'First name', 'Last name', 'Email', 'Phone', 'University or company', 'Status',
	'Experience', 'T-shirt', 'Attends', 'Tracks', 'Team', 'Team name and members', 'Motivation',
	'Dietary', 'Heard from', 'Consent', 'Conduct', 'Seconds on page', 'Page'
];

function doGet() {
	return json_({ ok: true, service: 'breaq-2026-registration' });
}

function doPost(e) {
	var data;
	try {
		data = JSON.parse(e.postData.contents);
	} catch (err) {
		return json_({ ok: false, error: 'Bad request' });
	}

	// bots: the hidden field is filled, or the form was sent faster than a person can type
	if (data.website || (data.seconds_on_page !== undefined && data.seconds_on_page < 3)) {
		return json_({ ok: true });
	}

	var email = String(data.email || '').trim().toLowerCase();
	if (!data.first_name || !data.last_name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !data.consent) {
		return json_({ ok: false, error: 'Please fill in your name and a valid email, and accept the data notice.' });
	}

	var lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		var sheet = sheet_();
		if (isRegistered_(sheet, email)) {
			return json_({ ok: true, duplicate: true });
		}
		sheet.appendRow([
			new Date(),
			clean_(data.first_name), clean_(data.last_name), email, clean_(data.phone),
			clean_(data.affiliation), clean_(data.status), clean_(data.experience), clean_(data.tshirt),
			clean_(data.attend), (data.tracks || []).join(', '), clean_(data.team), clean_(data.team_name),
			clean_(data.motivation), clean_(data.dietary), clean_(data.source),
			data.consent ? 'yes' : 'no', data.conduct ? 'yes' : 'no',
			data.seconds_on_page || '', clean_(data.page)
		]);
	} finally {
		lock.releaseLock();
	}

	try { sendConfirmation_(email, data); } catch (err) { Logger.log('confirmation failed: ' + err); }
	try { if (NOTIFY) sendNotice_(email, data); } catch (err) { Logger.log('notice failed: ' + err); }

	return json_({ ok: true });
}

/* ---------------------------------------------------------------- */

function sheet_() {
	var ss = SpreadsheetApp.getActiveSpreadsheet();
	var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
	if (sheet.getLastRow() === 0) {
		sheet.appendRow(COLUMNS);
		sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
		sheet.setFrozenRows(1);
	}
	return sheet;
}

function isRegistered_(sheet, email) {
	var last = sheet.getLastRow();
	if (last < 2) return false;
	var col = COLUMNS.indexOf('Email') + 1;
	var emails = sheet.getRange(2, col, last - 1, 1).getValues();
	for (var i = 0; i < emails.length; i++) {
		if (String(emails[i][0]).trim().toLowerCase() === email) return true;
	}
	return false;
}

function attendsText_(attend) {
	if (attend === 'hackathon') return 'the hackathon on 24–25 October at the CAMPUS Research Institute';
	if (attend === 'presentations') return 'the presentations day on 14 November at the Military Technical Academy “Ferdinand I”';
	return 'the hackathon on 24–25 October at the CAMPUS Research Institute and the presentations day on 14 November at the Military Technical Academy “Ferdinand I”';
}

function sendConfirmation_(email, data) {
	var name = clean_(data.first_name);
	var what = attendsText_(data.attend);
	var subject = 'You are registered for BreaQ 2026';
	var text =
		'Hi ' + name + ',\n\n' +
		'You are registered for ' + what + '.\n\n' +
		'What happens next: the Discord invite and the practical details (rooms, what to bring, the programme) ' +
		'come by email closer to the dates. Registration is free.\n\n' +
		'Add both dates to your calendar: ' + SITE + '/breaq-2026.ics\n' +
		'Event page: ' + SITE + '/breaq.html\n\n' +
		'Questions? Reply to this email.\n\n' +
		'See you there,\nRoQTeam';
	var html =
		'<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#2e3141;max-width:560px">' +
		'<p style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#ff8c00;margin:0 0 6px">BreaQ 2026</p>' +
		'<h2 style="margin:0 0 18px;font-weight:700">You are registered, ' + esc_(name) + '.</h2>' +
		'<p>You are in for ' + esc_(what) + '.</p>' +
		'<p>What happens next: the Discord invite and the practical details (rooms, what to bring, the programme) come by email closer to the dates. Registration is free.</p>' +
		'<p style="margin:24px 0"><a href="' + SITE + '/breaq-2026.ics" style="background:#4c5c96;color:#fff;text-decoration:none;padding:12px 20px;border-radius:3px;font-weight:700;letter-spacing:1px">Add both dates to calendar</a></p>' +
		'<p style="color:#666">Event page: <a href="' + SITE + '/breaq.html" style="color:#4c5c96">' + SITE + '/breaq.html</a><br>Questions? Just reply to this email.</p>' +
		'<p>See you there,<br>RoQTeam</p></div>';
	MailApp.sendEmail({ to: email, subject: subject, body: text, htmlBody: html, name: SENDER_NAME, replyTo: REPLY_TO });
}

function sendNotice_(email, data) {
	var lines = [
		clean_(data.first_name) + ' ' + clean_(data.last_name) + ' <' + email + '>',
		clean_(data.affiliation) + ' · ' + clean_(data.status) + ' · ' + clean_(data.experience),
		'Attends: ' + clean_(data.attend) + (data.tracks && data.tracks.length ? ' · Tracks: ' + data.tracks.join(', ') : ''),
		'Team: ' + clean_(data.team) + (data.team_name ? ' · ' + clean_(data.team_name) : ''),
		data.motivation ? 'Motivation: ' + clean_(data.motivation) : '',
		data.dietary ? 'Dietary: ' + clean_(data.dietary) : '',
		'Sheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
	].filter(String);
	MailApp.sendEmail({ to: NOTIFY, subject: 'BreaQ 2026 registration: ' + clean_(data.first_name) + ' ' + clean_(data.last_name), body: lines.join('\n'), name: SENDER_NAME });
}

function clean_(v) {
	return String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500);
}

function esc_(s) {
	return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function json_(obj) {
	return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
