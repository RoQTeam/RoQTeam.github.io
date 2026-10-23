/**
 * BreaQ 2026 registration backend: Google Apps Script.
 *
 * What it does
 *   - receives the JSON that register.html (the hackathon) and register-conference.html post;
 *     the "attend" field says which: "hackathon" or "conference"
 *   - appends one row per registration to a Google Sheet (tab "Registrations")
 *   - saves the hackathon's motivation letter (a PDF, which it requires) in the Drive folder LETTERS_FOLDER and links
 *     it in the row
 *   - sends a confirmation email to the participant and a short notice to the team
 *   - ignores obvious bots (honeypot field, forms submitted in under 3 seconds), takes only names that are names,
 *     and nothing after the deadlines (REGISTRATION_CLOSES, CONFERENCE_CLOSES)
 *   - guards the day's emails: one confirmation per address and event every 6 hours; past MAILS_PER_HOUR
 *     registrations in an hour their emails are held ("Emails" says so), past ROWS_PER_HOUR the form is refused
 *   - merges a second application for the same event with the same email into the row already there, instead
 *     of adding a row; the same person registering for both events gets one row per event. See "Applying twice"
 *     below
 *   - hands admin.html the whole sheet, for whoever sends the admin key (see "The admin page" below)
 *
 * Setup (once, about five minutes; also in README.md)
 *   1. Create a Google Sheet, e.g. "BreaQ 2026 registrations".
 *   2. Extensions -> Apps Script. Replace the editor content with this file. Save.
 *   3. Deploy -> New deployment -> type "Web app".
 *      Execute as: Me. Who has access: Anyone. Deploy, then authorise the permissions it asks for.
 *   4. Copy the web app URL (ends in /exec) into register.html and register-conference.html: data-endpoint="...".
 *   5. Test: fill the form on the site. A row appears in the sheet and two emails go out.
 *
 * To change this script later: edit, save, then Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy.
 * The URL stays the same. (Editing without a new version does not change what the site talks to.)
 *
 * Motivation letters: after pasting a version that saves them, pick "setup" in the editor's function list and press Run
 * once. Google asks for permission to use Drive, and the folder is created in the Drive of the account that owns the script.
 *
 * Email quota: a personal Google account can send 100 emails a day from Apps Script (and so does a Google for
 * Nonprofits one), a paid Google Workspace account 1,500. Two emails go out per registration: the confirmation,
 * and the notice to NOTIFY, which is left out when fewer than NOTICE_MIN emails are left for the day, so the
 * confirmations do not run out on a busy day. The "Emails" column says when it was.
 *
 * Emails not arriving: the "Emails" column says, per registration, whether the confirmation and the notice went
 * out or why not. To test sending on its own, pick "checkEmail" in the editor's function list and press Run:
 * the log shows the sending account, the quota left today and the result of the test emails.
 *
 * Confirmations owed: a registration whose confirmation failed (the day's emails ran out) or was held (past
 * MAILS_PER_HOUR) has no "confirmation sent" in "Emails". From the editor's function list:
 *   - previewConfirmations: logs who is owed one. Sends nothing.
 *   - sendConfirmations: sends each of them the confirmation, once, oldest first, without the notice to NOTIFY.
 *     It stops when the day's emails run out, as sendDecisions does: run it again the next day for the rest.
 * Left out: rows with nothing in "Emails" (from before it was recorded) and anyone who has a decision email.
 *
 * The admin page: admin.html reads every registration through this script, for whoever has the admin key or their own (voterKeys).
 * Pick "adminKey" in the editor's function list and press Run: the log shows the key (made on the first run).
 * To change it: Project Settings -> Script properties -> delete ADMIN_KEY, then run adminKey again; the old
 * key stops working at once, no new deployment needed.
 *
 * Applying twice: someone who sends the form again for an event they are already in, with the same email,
 * updates their row. The same name with another email does not (it could be anyone): it goes in as a row of its
 * own, marked ⚠ in "Merged" and in the notice, for the organisers to merge by hand when it is the same person.
 * In an update each new answer replaces the earlier one, an empty answer keeps it, the tracks add up, the newest email becomes "Email" and the earlier ones move
 * to "Other emails". The "Merged" column logs when it happened, why the two were matched and what each changed
 * answer was before, earlier letters included, so a wrong match can be undone by hand. The same form sent twice
 * unchanged (a second click, a retry after a timeout) changes nothing and sends no email.
 * Rows from before this existed: pick "findDuplicates" in the editor's function list and press Run to see in
 * the log what would be merged, then "mergeDuplicates" to merge them. It first copies the tab as a backup,
 * sends no emails and deletes the rows it merged into an earlier one.
 * Two rows of the same person that nothing matched (another email, the name written another way): in the sheet,
 * BreaQ -> Merge two rows of the same person… asks for the two row numbers, shows both and merges them once you
 * say yes: the later row's answers go into the earlier one, which keeps the grades and the decision it has, and
 * the later row is deleted. (After pasting this script, reload the sheet for the BreaQ menu to show.)
 *
 * Votes (hackathon only): each of the VOTERS grades registrations from 1 to 10, on the admin page. Opened with
 * the shared admin key, the page asks who you are and votes as the one picked (sharedAs_): only the five have the
 * key. A personal key (pick "voterKeys" in the editor's function list and press Run) votes as its own, without
 * asking. Each grade goes in that person's "Vote <name>" column. Once MAJORITY of them have graded, the average of
 * the grades sets the Decision: ACCEPT_FROM or more is accepted, WAITLIST_FROM or more the waiting list, below that
 * denied. Taking a grade back below MAJORITY makes it undecided again. A Decision set by hand (someone away, an
 * average just under the line) stays until a grade next changes what the average says. A grade typed in the sheet
 * by hand changes no Decision: grade on the admin page. To change someone's key: Project Settings -> Script
 * properties -> delete their VOTE_KEY_<NAME>, then run voterKeys again.
 * The admin page's reading mode shows one letter at a time (the "letter" action sends the PDF itself, so nobody
 * needs the Drive folder shared), each registration first to three of the voters picked at random, and a grade there can
 * carry a short note for the others ("Note <name>", next to the grades). The reading mode keeps its grades on the page and
 * sends them together (the "votes" action), when the reader presses Send or closes it.
 *
 * Decision emails (hackathon only): the grades, or the admin page's Accept, Waitlist and Deny buttons, fill the "Decision"
 * column (accepted, waitlist, denied; empty is undecided), and deciding sends nothing. The emails go out when
 * someone presses "Send decision emails" on the admin page, or from the editor's function list:
 *   - previewDecisions: logs who would get which email, and flags teams with members decided differently, a
 *     teammate not registered under the name given, or over 3 people. Sends nothing.
 *   - sendDecisions: sends each person the email for their decision, once; the "Decision email" column records
 *     it. Changing a decision later sends the new one. A team is sent only when every registered member has
 *     the same decision: until then (someone undecided, or decided otherwise) its emails are held back.
 *     The accepted go first, then the waiting list, then the denied, so a day's emails reach the people who have
 *     something to do. It stops when the day's emails run out (while registration is open, with
 *     DECISION_RESERVE left for new registrations): send again the next day for the rest.
 *   - sendDecisionSamples: sends you (and SAMPLES_TO) one of each email, personal and team, to read before anyone else does.
 * The wording is in decisionEmail_. Someone whose registered teammates got the same decision gets the team
 * version naming them. After changing the wording, deploy a new version for the admin page's button.
 *
 * Emails to the people picked (mail_): on the admin page a box on each row (and on each team) picks people, kept
 * while one looks around; the bar at the bottom emails them the one chosen there: a decision email (accepted,
 * waitlist, denied, which also sets their Decision, so the regular send counts it as sent), the confirmation again,
 * or one written on the page in the same look. It first shows who gets it and the email as the first of them reads
 * it, and stops at the day's emails as sendDecisions does. A decision emailed by hand, outside this script (the day's
 * emails ran out), is recorded there instead ("only record it"): it sets the Decision and writes "<decision>: sent by
 * hand" in "Decision email", sending nothing, so that sendDecisions and the page's Send do not email it again.
 *
 * The track each participant is given (track_): on the admin page, a list on each row, on each team and on the bar of
 * the people picked, and buttons in the full view, fill the "Hackathon track" column with one of the CHALLENGES (or
 * empty it). The "Tracks" they ticked on the form stay as they were. In an email written on the admin page, {track}
 * becomes it.
 *
 * On their own or in a team: the "Team" column is solo, team (with the names in "Team name and members") or
 * match (the organisers put them in a team). The form asks with Quantum AI or Quantum Hacking ticked. Quantum
 * Hacking became a team challenge after people had registered for it, so one email asks each of them, from the
 * editor's function list:
 *   - previewHackingTeams: logs who would get it. Sends nothing.
 *   - sendHackingTeams: emails every hackathon registration with the Quantum Hacking track, once (HACKING_SENT in
 *     the "Emails" column), the denied left out. It stops when the day's emails run out, as sendDecisions does:
 *     run it again the next day for the rest.
 *   - sendHackingTeamsSample: sends you (and SAMPLES_TO) the email, to read first.
 * The email links to team-choice.html with the person's code (the dashboard's, which opens the dashboard only once
 * they are accepted): there they choose, and the answer goes in "Team" and "Team name and members", with what it
 * replaced logged in "Merged" and when in "Team answered" (each time, the same answer again included, so the
 * admin page can tell who answered). The wording is in hackingTeamsEmail_.
 * Teammates who have not registered: someone who came with a team, but whose named teammates have no hackathon
 * registration under those names yet, gets a reminder, from the editor's function list:
 *   - previewTeammatesReminder: logs who would get it and which teammates are missing. Sends nothing.
 *   - sendTeammatesReminder: emails each of them, once (MATES_SENT in the "Emails" column), the denied left out,
 *     and stops at the day's emails as sendHackingTeams does.
 *   - sendTeammatesReminderSample: sends you (and SAMPLES_TO) the email, to read first.
 * Its button opens the same team page, to correct a name written differently or change the answer. The wording is
 * in teammatesReminderEmail_.
 *
 * The team dashboard (teams.html, roqteam.ro/teams): what the organisers post for the hackathon's teams, the
 * announcements, each challenge's resources, how to submit and the practical details, one row each in the tab
 * BOARD_SHEET. The admin page writes it (its "Team dashboard" view); rows can also be typed in the tab by hand.
 * It is for the accepted participants only: each has a personal code, made from their email with a secret kept
 * in the script properties (TEAM_SECRET), which their acceptance email gives with a link that fills it in. A code
 * opens the dashboard only while that person's Decision is "accepted": the waiting list and the denied never get
 * one, and changing an accepted person's decision shuts their code out at once. The organisers can also turn an
 * accepted person's code off on the admin page (access_), for someone who did not say by CONFIRM_BY whether they are
 * coming: the "Code off" column says since when, their Decision stays, and the dashboard tells them to write to
 * us; turned on again, the same code works. The organisers open it with the admin key. The admin page shows each accepted person's code (in their full view), for anyone who lost the
 * email; "dashboardCodes" in the editor's function list logs them all.
 *
 * On the dashboard each participant also sees:
 *   - "Are you coming?" until the event starts: their answer goes in the "Coming" column, and the admin page counts
 *     who said yes, who cannot come and who has not answered (the acceptance email asks by CONFIRM_BY)
 *   - their team: the admin page's Teams view puts people in teams (the "Hackathon team" column) and gives each
 *     team its challenge, table, pitch time and room (the tab TEAMS_SHEET)
 *   - "Ask a mentor" during the hackathon: each request is a row in QUEUE_SHEET, and the mentors take them on
 *     mentors.html (roqteam.ro/mentors), opened with the mentor key: run "mentorKey" for the link, or copy it from
 *     the admin page, which can also change the key
 *   - a feedback form after the awards: the answers go in FEEDBACK_SHEET without names
 * The check-in at the door is a view of the admin page: it fills "Checked in".
 *
 * Certificates: after the event, the admin page sends each accepted participant checked in at the door a PDF
 * certificate (the "Certificate" column records it), made from a Google Slides template. Pick
 * "certificateTemplate" in the editor's function list and press Run once: it asks for permission to use Slides,
 * makes a starter template in Drive and logs its link. Restyle it in Slides as you like, keeping the {{…}} fields.
 */

var SHEET_NAME = "Registrations";
var NOTIFY = "registrations@roqteam.ro"; // where the "new registration" notices go; '' to disable
var REPLY_TO = "registrations@roqteam.ro";
var SAMPLES_TO = "alexionita46@gmail.com"; // the [sample] emails go here too, besides the account running the script; '' for that account only
var SENDER_NAME = "RoQTeam · BreaQ 2026";
var SITE = "https://roqteam.ro";
var LETTERS_FOLDER = "BreaQ 2026 motivation letters"; // Drive folder, created on first use (or by setup)
var LETTER_MAX_BYTES = 5 * 1024 * 1024; // register.js has the same limit

// the organisers who grade each hackathon registration from 1 to 10, on the admin page, each with their own key
// (voterKeys)
var VOTERS = ["Andy", "Cristi", "Alex", "Filip", "Tudor"];
var MAJORITY = Math.floor(VOTERS.length / 2) + 1; // 3 of 5: this many grades, and their average sets the Decision
var GRADE_MIN = 1;
var GRADE_MAX = 10;
// the average that accepts, and the one that puts on the waiting list; below WAITLIST_FROM is denied. The admin
// page reads them from here. Changed later, they apply to each registration at its next grade.
var ACCEPT_FROM = 7;
var WAITLIST_FROM = 5;
var VOTE_COLUMNS = VOTERS.map(function (v) {
  return "Vote " + v; // a grade from 1 to 10, or empty while they have not graded
});
var NOTE_COLUMNS = VOTERS.map(function (v) {
  return "Note " + v; // a line the voter may add to their vote, for the others ("copied from the web")
});
var NOTE_MAX = 200;

var COLUMNS = [
  "Timestamp",
  "First name",
  "Last name",
  "Email",
  "Phone",
  "University or company",
  "Status",
  "Experience",
  "T-shirt",
  "Attends",
  "Tracks",
  "Team",
  "Team name and members",
  "Motivation",
  "Dietary",
  "Heard from",
  "Consent",
  "Conduct",
  "Seconds on page",
  "Page",
  "Motivation letter",
  "Emails",
  "Other emails",
  "Merged",
  "Decision",
  "Decision email",
  // when they last answered on the team page (team-choice.html), each time, the same answer as before included
  "Team answered",
  // the hackathon itself, for the accepted: the team the organisers put them in, their answer to "are you coming?"
  // on the team dashboard, the check-in at the door and the certificate emailed after
  "Hackathon team",
  "Coming",
  "Coming answered",
  "Checked in",
  "Certificate",
  // the track the organisers give them (track_), one of the CHALLENGES; "Tracks" is what they ticked
  "Hackathon track",
  // since when their dashboard code is off (access_); empty while it works
  "Code off",
];
// each organiser's note and grade, just before the Decision the grades add up to
COLUMNS.splice.apply(COLUMNS, [COLUMNS.indexOf("Decision"), 0].concat(NOTE_COLUMNS, VOTE_COLUMNS));

// not the person's answers: a second application that differs only in these changes nothing
var NOT_ANSWERS = [
  "Timestamp",
  "Seconds on page",
  "Page",
  "Emails",
  "Merged",
  "Decision",
  "Decision email",
  "Team answered",
  "Hackathon team",
  "Coming",
  "Coming answered",
  "Checked in",
  "Certificate",
  "Hackathon track",
  "Code off",
].concat(VOTE_COLUMNS, NOTE_COLUMNS);

// what the organisers and the dashboard write in a row: a merge keeps the earlier row's, the later one's only fills
// a gap (a second application never has any; two rows graded apart may)
var ORGANISER_COLUMNS = [
  "Decision",
  "Decision email",
  "Hackathon team",
  "Coming",
  "Coming answered",
  "Checked in",
  "Certificate",
  "Hackathon track",
  "Code off",
].concat(VOTE_COLUMNS, NOTE_COLUMNS);

// what the organisers can pick in the "Decision" column; each has its email in decisionEmail_
var DECISIONS = ["accepted", "waitlist", "denied"];
var DECISION_RESERVE = 10; // while registration is open, the sends leave this many of the day's emails for new registrations
var REGISTRATION_CLOSES = "2026-10-19T00:00:00+03:00"; // the hackathon's registration closes at the end of 18 October
var CONFERENCE_CLOSES = "2026-11-06T00:00:00+02:00"; // and the conference's at the end of 5 November
var ROWS_PER_HOUR = 60; // new registrations in an hour past which the form is refused: a script, not people
var MAILS_PER_HOUR = 25; // registrations in an hour past which their emails are held (the row still goes in)
var NOTICE_MIN = 30; // fewer emails left today: the "new registration" notice is left out, the confirmation still goes
var DECISION_ORDER = ["accepted", "waitlist", "denied"]; // who is emailed first when a day's emails do not reach everyone

// the team dashboard: one row per item posted, in its own tab
var BOARD_SHEET = "Team dashboard";
var BOARD_COLUMNS = [
  "ID",
  "Section",
  "Challenge",
  "Title",
  "Text",
  "Link",
  "Pinned",
  "Posted",
  "Edited",
];
// announcement: the feed (an empty Section counts as one); resource: links for a challenge, or for all three
// with no Challenge; checklist: what to set up and bring before the day, ticked off on the dashboard (for a
// challenge, or for all with no Challenge); submission: how to hand in; practical: Wi-Fi, Discord, who to ask
var BOARD_SECTIONS = ["announcement", "resource", "checklist", "submission", "practical"];
// From when the teams get a section: the checklist and the challenges' resources from Friday 09:00 (a day to get
// ready), the submission posts from Sunday 00:00. Until then the board leaves them out for everyone but the
// organisers, so they are not in the page's data either (PREP_FROM and SUBMIT_FROM in assets/js/teams.js show the
// sections at the same times).
var BOARD_FROM = {
  checklist: "2026-10-23T09:00:00+03:00",
  resource: "2026-10-23T09:00:00+03:00",
  submission: "2026-10-25T00:00:00+03:00",
};
var CHALLENGES = ["Quantum Foundations", "Quantum AI", "Quantum Hacking"];
var TEAMS_PAGE = SITE + "/teams";
var MENTORS_PAGE = SITE + "/mentors";
var CONFIRM_BY = "Wednesday 21 October"; // the acceptance email asks to answer "are you coming?" by then

// the day-before email (eveEmail_, "The day before" on the admin page): the hackathon's WhatsApp group, which it
// cannot go out without, and CAMPUS on Google Maps
var WHATSAPP_GROUP = "https://chat.whatsapp.com/ILDYZn3dlC62gLnXZ5rLmV";
var CAMPUS_MAP =
  "https://www.google.com/maps/search/?api=1&query=Centrul%20CAMPUS%2C%20Splaiul%20Independen%C8%9Bei%20313%2C%20Bucure%C8%99ti";
var EVE_LOG = "the day-before email"; // how the Emails column records it
var EVE_SCHEDULE = [
  {
    day: "Saturday · 24 October",
    rows: [
      ["9:00", "Doors open: come in and settle down"],
      ["9:30", "A short kick-off: we show you the rooms and you split into the challenges"],
      ["10:00", "Coding starts 🚀"],
    ],
  },
  {
    day: "Sunday · 25 October",
    rows: [
      ["9:00", "Coding stops. Still a full 24 hours: the clocks go back an hour that night"],
      ["", "Each challenge gathers in its room, and every team presents its work to the jury"],
      ["", "The jury decides"],
      ["12:00", "The awards ceremony 🏆 Then we can all go home and sleep 😴"],
    ],
  },
];
var EVE_WAY = [
  "On the Politehnica campus, on the Iuliu Maniu side: one of the two newer buildings, the one closest to the gate for cars.",
  "The entrance is on the side towards the boulevard, up the stairs.",
  "Door closed? There is a doorbell on the right: tell security you are here for the hackathon.",
];
// each challenge's colour in that email, and the tint of its card
var TRACK_COLOR = {
  "Quantum Foundations": ["#4c5c96", "#eef0f8"],
  "Quantum AI": ["#7a5cc7", "#f3effb"],
  "Quantum Hacking": ["#e8590c", "#fdf1e8"],
};

// the hackathon's "Team" column: on their own, with the teammates they name ("Team name and members"), or put in
// a team by the organisers. register.html asks it with Quantum AI or Quantum Hacking ticked; team-choice.html
// (roqteam.ro/team-choice) lets a registered participant change it, with their personal code
var TEAM_ANSWERS = ["solo", "team", "match"];
var TEAM_PAGE = SITE + "/team-choice";
// the Quantum Hacking email (sendHackingTeams): asks for an answer, and the teammates' registrations, by then;
// HACKING_SENT in the "Emails" column marks who has it. The teammates reminder (sendTeammatesReminder) gives the
// same date, and MATES_SENT marks who has that one
var HACKING_BY = "Saturday 17 October";
var HACKING_SENT = "Quantum Hacking teams email sent";
var MATES_SENT = "Teammates reminder sent";

// the hackathon's teams, one row each; who is in which is the "Hackathon team" column of the registrations. The
// last columns are the team's hand-in, from the dashboard (handin_)
var TEAMS_SHEET = "Teams";
var TEAM_COLUMNS = ["Team", "Challenge", "Table", "Pitch", "Room", "Award", "Repository", "Slides", "Video", "About", "Handed in", "Handed in by"];
var AWARDS = ["1st", "2nd", "3rd"]; // a challenge's podium; the certificate says it
var HANDIN_BY = "2026-10-25T09:00:00+02:00"; // coding stops: the hand-in closes (STOP in assets/js/schedule.js)

// The audience award: the organisers open the vote at the awards (the admin page, Team dashboard view); each
// participant checked in at the door gives one vote, to a team not their own, and can change it while the vote is
// open. The AUDIENCE script property is its state: "" before, "open", then "shown" (closed, the result on the
// dashboards and on the big screen, screen.html).
var AUDIENCE_SHEET = "Audience vote";
var AUDIENCE_COLUMNS = ["Email", "Team", "Voted"];
var AUDIENCE_STATES = ["", "open", "shown"];

// "Ask a mentor" on the dashboard: one row per request; mentors.html shows the queue and moves each on
var QUEUE_SHEET = "Mentor queue";
var QUEUE_COLUMNS = ["ID", "Asked", "Name", "Email", "Team", "Challenge", "Where", "Question", "Status", "Mentor", "Taken", "Closed"];
var QUEUE_OPEN = ["waiting", "taken"]; // then done (by the mentor) or cancelled (by the team)

// what the participants say after the event, without their names: Key only lets someone change their answers
var FEEDBACK_SHEET = "Feedback";
var FEEDBACK_COLUMNS = ["Sent", "Challenge", "Overall", "Best", "Change", "Again", "Key"];
var AGAIN = ["yes", "maybe", "no"];

var CERTIFICATES_FOLDER = "BreaQ 2026 certificates"; // Drive folder with a copy of each certificate sent
var EVENT_DATES = "24–25 October 2026";
var EVENT_END = "2026-10-25T14:00:00+02:00"; // the end of the awards: a team sees its place on the dashboard from then

// run once from the editor: asks for Drive access and creates the letters folder
function setup() {
  Logger.log("Motivation letters go to " + lettersFolder_().getUrl());
}

// run from the editor when emails do not arrive; put your own outside address in TEST_TO to test delivery
// beyond roqteam.ro too
function checkEmail() {
  var TEST_TO = "";
  var me = Session.getEffectiveUser().getEmail();
  Logger.log("Sending as: " + me);
  Logger.log("Emails left today: " + MailApp.getRemainingDailyQuota());
  // one test per channel: GmailApp sends like the Gmail inbox does, MailApp is Apps Script's own mail service
  [me, NOTIFY, TEST_TO].filter(String).forEach(function (to) {
    ["GmailApp", "MailApp"].forEach(function (via) {
      var msg = {
        to: to,
        subject: "BreaQ registration: test via " + via,
        body:
          "If this arrived, the registration script can send email to " +
          to +
          " through " +
          via +
          ".",
        name: SENDER_NAME,
        replyTo: REPLY_TO,
      };
      try {
        if (via === "GmailApp")
          GmailApp.sendEmail(msg.to, msg.subject, msg.body, {
            name: msg.name,
            replyTo: msg.replyTo,
          });
        else MailApp.sendEmail(msg);
        Logger.log("Test via " + via + " to " + to + ": sent");
      } catch (err) {
        Logger.log("Test via " + via + " to " + to + ": FAILED: " + err);
      }
    });
  });
  Logger.log(
    "Emails left today after the test: " + MailApp.getRemainingDailyQuota(),
  );
}

// run from the editor: the key admin.html asks for, made on the first run and kept in the script properties
function adminKey() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("ADMIN_KEY");
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, "");
    props.setProperty("ADMIN_KEY", key);
  }
  Logger.log("Admin key: " + key);
}

// run from the editor: each voter's own key for the admin page, made on the first run and kept in the script
// properties (VOTE_KEY_ANDY, ...). Give each one only theirs: it votes in their name.
function voterKeys() {
  VOTERS.forEach(function (v) {
    Logger.log(v + ": " + voterKey_(v));
  });
  Logger.log("Each opens " + SITE + "/admin with their own key. The shared admin key still opens the page, but does not vote.");
}

function voterKey_(name) {
  var props = PropertiesService.getScriptProperties();
  var prop = "VOTE_KEY_" + name.toUpperCase();
  var key = props.getProperty(prop);
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, "");
    props.setProperty(prop, key);
  }
  return key;
}

// whose personal key this is: one of VOTERS, or "" (the admin key, a wrong key, none)
function voterOf_(key) {
  var k = String(key || "").trim();
  if (!k) return "";
  var props = PropertiesService.getScriptProperties().getProperties();
  for (var i = 0; i < VOTERS.length; i++) {
    var mine = props["VOTE_KEY_" + VOTERS[i].toUpperCase()];
    if (mine && k === mine) return VOTERS[i];
  }
  return "";
}

// run from the editor: the dashboard code of every accepted participant (the admin page shows each in its full view)
function dashboardCodes() {
  var values = sheet_().getDataRange().getValues();
  var header = header_(values);
  var n = 0;
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    if (!accepted_(r)) continue;
    n++;
    Logger.log(
      String(r["First name"] + " " + r["Last name"]).trim() +
        " <" + r["Email"] + ">: " + dashboardCode_(r["Email"]),
    );
  }
  Logger.log(n + " accepted participants. The team dashboard: " + TEAMS_PAGE);
}

// run from the editor: the mentors' link, with the key it opens the queue with (the admin page shows it too)
function mentorKey() {
  Logger.log("The mentor queue: " + MENTORS_PAGE + "#key=" + mentorKey_(false));
}

// run from the editor once before the certificates go out: makes a starter template in Google Slides, in the Drive
// of the account running the script, and logs its link (or the link of the one already made). Restyle it as you
// like: each certificate is a copy with {{NAME}}, {{TITLE}}, {{AWARD}}, {{TEAM}}, {{CHALLENGE}}, {{PLACE}} and
// {{DATE}} filled in. To use another deck instead, put its file ID in the script property CERT_TEMPLATE.
function certificateTemplate() {
  var props = PropertiesService.getScriptProperties();
  var have = certTemplate_();
  if (have) {
    Logger.log("The certificate template: " + have.getUrl());
    return;
  }
  var deck = SlidesApp.create("BreaQ 2026 Hackathon certificate (template)");
  var slide = deck.getSlides()[0];
  slide.getPageElements().forEach(function (e) {
    e.remove();
  });
  slide.getBackground().setSolidFill("#2e3141");
  var w = deck.getPageWidth();
  var line = function (text, top, height, size, color, bold) {
    var t = slide.insertTextBox(text, 40, top, w - 80, height).getText();
    t.getTextStyle().setFontFamily("Raleway").setFontSize(size).setForegroundColor(color).setBold(!!bold);
    t.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  };
  line("BREAQ 2026 · HACKATHON", 38, 24, 11, "#ff8c00", true);
  line("{{TITLE}}", 70, 44, 26, "#ffffff", true);
  line("This certifies that", 132, 24, 13, "#c9cbd6", false);
  line("{{NAME}}", 160, 54, 34, "#ffffff", true);
  line("{{AWARD}}", 222, 56, 14, "#ffffff", false);
  line("{{DATE}} · CAMPUS Research Institute, Bucharest", 300, 24, 11, "#c9cbd6", false);
  line("RoQTeam", 336, 30, 15, "#ff8c00", true);
  deck.saveAndClose();
  props.setProperty("CERT_TEMPLATE", deck.getId());
  Logger.log("Made the certificate template: " + DriveApp.getFileById(deck.getId()).getUrl());
}

function doGet() {
  return json_({ ok: true, service: "breaq-2026-registration" });
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "Bad request" });
  }

  // teams.html: the team dashboard, for the accepted participants (their own code) and the organisers (the admin
  // key); the participants also answer "are you coming?", ask for a mentor and send their feedback through it
  var TEAM_ACTIONS = ["board", "coming", "help", "help-cancel", "feedback", "handin", "audience", "team-name", "flash"];
  if (TEAM_ACTIONS.indexOf(data.action) !== -1) {
    try {
      var who = dashboardWho_(data.code);
      if (who.denied) return json_(who);
      if (data.action === "board") return json_(board_(who));
      // the big screen's live message, asked every few seconds: for the screen and the organisers
      if (data.action === "flash") return json_({ ok: true, action: "flash", flash: who.screen || who.organiser ? flashOf_() : null });
      if (who.organiser || who.screen)
        return json_({
          ok: false,
          action: data.action,
          error: who.screen
            ? "The big screen's password only shows the screen."
            : "You are signed in with the admin key: this is for the participants. Their answers show on the admin page.",
        });
      if (data.action === "coming") return json_(coming_(who, data));
      if (data.action === "help") return json_(helpAsk_(who, data));
      if (data.action === "help-cancel") return json_(helpCancel_(who, data));
      if (data.action === "handin") return json_(handin_(who, data));
      if (data.action === "audience") return json_(audienceVote_(who, data));
      if (data.action === "team-name") return json_(teamName_(who, data));
      return json_(feedback_(who, data));
    } catch (err) {
      console.error(data.action + " failed: " + err);
      return json_({
        ok: false,
        action: data.action,
        temporary: data.action === "board", // the page tries a reading again by itself, never an answer
        error:
          data.action === "board"
            ? "Google could not read the dashboard just now (" + err + ")."
            : "That did not go through (" + err + "). Try again in a minute.",
      });
    }
  }

  // mentors.html: the queue of teams asking for help, for the mentor key (or the admin key)
  var MENTOR_ACTIONS = ["mentor-queue", "mentor-take", "mentor-done", "mentor-release"];
  if (MENTOR_ACTIONS.indexOf(data.action) !== -1) {
    try {
      var no = checkMentor_(data.key);
      if (no) return json_(no);
      if (data.action === "mentor-queue") return json_(mentorQueue_());
      return json_(mentorMove_(data));
    } catch (err) {
      console.error(data.action + " failed: " + err);
      return json_({
        ok: false,
        action: data.action,
        temporary: data.action === "mentor-queue",
        error: "Google could not " + (data.action === "mentor-queue" ? "read" : "update") + " the queue just now (" + err + ").",
      });
    }
  }

  // team-choice.html: a hackathon participant reads, or changes, how they take part (on their own, with a team,
  // matched), with the personal code in the email that asked them
  if (data.action === "team-choice") {
    try {
      return json_(teamChoice_(data));
    } catch (err) {
      console.error("team-choice failed: " + err);
      return json_({
        ok: false,
        action: "team-choice",
        temporary: data.team === undefined, // the page tries a reading again by itself, never an answer
        error: "That did not go through (" + err + "). Try again in a minute.",
      });
    }
  }

  // admin.html: the registrations, a vote, a decision, the decision emails, the team dashboard, the teams, the
  // check-in, the mentors' key and the certificates; all only for the admin key or a voter's own key
  var ADMIN_ACTIONS = [
    "list",
    "vote",
    "votes",
    "letter",
    "decide",
    "decisions",
    "mail",
    "track",
    "access",
    "board-admin",
    "board-save",
    "board-delete",
    "team-save",
    "team-delete",
    "team-assign",
    "checkin",
    "mentor-key",
    "certificates",
    "audience-state",
    "screen-key",
    "screen-flash",
  ];
  if (ADMIN_ACTIONS.indexOf(data.action) !== -1) {
    // an exception here would make Apps Script answer with an HTML error page: send the admin page the reason instead
    var reading = data.action === "list" || data.action === "board-admin" || data.action === "letter";
    try {
      var denied = checkKey_(data.key);
      if (denied) return json_(denied);
      if (data.action === "vote" || data.action === "votes") return json_(vote_(data));
      if (data.action === "letter") return json_(letter_(data));
      if (data.action === "decide") return json_(decide_(data));
      if (data.action === "decisions") return json_(decisions_(!!data.send));
      if (data.action === "mail") return json_(mail_(data));
      if (data.action === "track") return json_(track_(data));
      if (data.action === "access") return json_(access_(data));
      if (data.action === "board-admin") return json_(boardAdmin_());
      if (data.action === "board-save") return json_(boardSave_(data));
      if (data.action === "board-delete") return json_(boardDelete_(data));
      if (data.action === "team-save") return json_(teamSave_(data));
      if (data.action === "team-delete") return json_(teamDelete_(data));
      if (data.action === "team-assign") return json_(teamAssign_(data));
      if (data.action === "checkin") return json_(checkin_(data));
      if (data.action === "mentor-key")
        return json_({ ok: true, action: "mentor-key", key: mentorKey_(!!data.renew), page: MENTORS_PAGE });
      if (data.action === "certificates") return json_(certificates_(!!data.send, !!data.sample));
      if (data.action === "audience-state") return json_(audienceSet_(data));
      if (data.action === "screen-key") return json_(screenKeySet_(data));
      if (data.action === "screen-flash") return json_(flashSet_(data));
      return json_(list_(data.key));
    } catch (err) {
      console.error(data.action + " failed: " + err);
      return json_({
        ok: false,
        action: data.action,
        temporary: reading, // the page tries a reading again by itself, never a send or a save
        error: reading
          ? "Google could not read the sheet just now (" + err + ")."
          : "The Apps Script stopped with an error (" + err + ").",
      });
    }
  }

  // bots: the hidden field is filled, or the form was sent faster than a person can type
  if (
    data.website ||
    (data.seconds_on_page !== undefined && data.seconds_on_page < 3)
  ) {
    return json_({ ok: true });
  }

  var email = String(data.email || "")
    .trim()
    .toLowerCase();
  if (
    !data.first_name ||
    !data.last_name ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ||
    !data.consent ||
    !data.conduct
  ) {
    return json_({
      ok: false,
      error:
        "Please fill in your name and a valid email, and tick both boxes at the end of the form.",
    });
  }
  // just a name: someone else's words in the name (a link, an address) would go out in our confirmation email
  var badName = nameProblem_(data.first_name) || nameProblem_(data.last_name);
  if (badName) return json_({ ok: false, error: badName });
  var ev = eventKey_(data.attend);
  if (Date.now() >= Date.parse(ev === "conference" ? CONFERENCE_CLOSES : REGISTRATION_CLOSES))
    return json_({
      ok: false,
      error:
        "Registration for " + event_(data.attend).name + " closed on " + (ev === "conference" ? "5 November" : "18 October") +
        ". Write to us at " + REPLY_TO + " if you think we can still fit you in.",
    });

  // the motivation letter (hackathon form): checked here, saved once we know the registration is new
  var letter = null;
  if (data.letter && data.letter.data) {
    try {
      letter = Utilities.base64Decode(String(data.letter.data));
    } catch (err) {
      return json_({
        ok: false,
        error:
          "We could not read the motivation letter. Please choose the PDF again.",
      });
    }
    if (letter.length > LETTER_MAX_BYTES) {
      return json_({
        ok: false,
        error:
          "The motivation letter is over 5 MB. Please upload a smaller PDF.",
      });
    }
    if (
      letter.length < 4 ||
      letter[0] !== 37 ||
      letter[1] !== 80 ||
      letter[2] !== 68 ||
      letter[3] !== 70
    ) {
      // "%PDF"
      return json_({
        ok: false,
        error: "The motivation letter has to be a PDF.",
      });
    }
  }
  // no hackathon registration without its letter: register.js asks for it, this stops what gets past it (an empty
  // file, a phone's cloud file not downloaded yet, a request sent by hand)
  if (ev === "hackathon" && !letter)
    return json_({ ok: false, error: "Please attach your motivation letter as a PDF." });
  var letterUrl = "";
  var merge = null; // set when this application updates a row already there
  var namesake = null; // the row with the same name and another email, which this one stays apart from
  var held = ""; // why the emails are not sent, when they are not
  var cache = CacheService.getScriptCache();
  var hour = Math.floor(Date.now() / 3600000);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var rec = record_(data, email);
    var match = findMatch_(values, header, rec, values.length, {});
    // The same name with another email may be the same person with a new address, or someone else: a namesake,
    // or someone after another's place, as nothing proves who sent the form. So it changes nothing in that row
    // (whose email the decision and the dashboard code go to): it goes in as a row of its own, flagged for the
    // organisers, and the answer is the one anyone new gets.
    if (match && match.by === "name") {
      namesake = { row: match.index + 1, email: String(values[match.index][header.indexOf("Email")]) };
      rec["Merged"] =
        "⚠ " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") +
        " · the same name as row " + namesake.row + " (" + namesake.email + "), with another email: kept apart." +
        " If it is the same person, merge the two by hand (or with mergeDuplicates).";
      match = null;
    }
    // a flood of new registrations is a script, not people: refused before anything is saved
    if (!match) {
      var rows = Number(cache.get("rows:" + hour) || 0);
      if (rows >= ROWS_PER_HOUR)
        return json_({ ok: false, error: "We are getting a lot of registrations right now. Please try again in an hour." });
      cache.put("rows:" + hour, String(rows + 1), 3700);
    }
    var older = match ? toRecord_(header, values[match.index]) : null;
    // the same PDF as the one already in the row: no second copy in Drive
    if (letter && older && sameLetter_(older["Motivation letter"], letter))
      letter = null;
    // a Drive hiccup: nothing is saved yet, so the person sends it again rather than registering without the letter
    if (letter) {
      try {
        letterUrl = saveLetter_(letter, email, data);
      } catch (err) {
        Logger.log("letter not saved: " + err);
        return json_({
          ok: false,
          error: "We could not save your motivation letter just now. Please send the form again in a minute.",
        });
      }
    }
    rec["Motivation letter"] = letterUrl;
    var row;
    if (!match) {
      sheet.appendRow(
        header.map(function (col) {
          return cellFor_(col, rec[col]);
        }),
      );
      row = sheet.getLastRow();
    } else {
      merge = merge_(header, older, rec, match.by);
      if (!merge.changed) return json_({ ok: true, duplicate: true });
      row = match.index + 1;
      writeMerged_(sheet, row, header, older, merge.rec);
    }
    // the day's 100 emails are not for anyone to spend: one confirmation per address and event every 6 hours
    // (the longest the cache keeps anything), and the emails of a flood are held
    var mails = Number(cache.get("mails:" + hour) || 0);
    if (cache.get("mail-to:" + ev + ":" + email))
      held = (older && older["Emails"] ? older["Emails"] + "; " : "") + "this update not emailed: an email went to this address less than 6 hours ago";
    else if (mails >= MAILS_PER_HOUR) held = "emails held: over " + MAILS_PER_HOUR + " registrations this hour";
    else {
      cache.put("mail-to:" + ev + ":" + email, "1", 21600);
      cache.put("mails:" + hour, String(mails + 1), 3700);
    }
  } finally {
    lock.releaseLock();
  }

  // a failed email must not fail the registration, but it has to show: the "Emails" column says what happened
  var sent = [];
  if (held) {
    try {
      sheet.getRange(row, header.indexOf("Emails") + 1).setValue(held);
    } catch (err) {
      console.error("could not record the emails: " + err);
    }
    return json_({ ok: true, updated: !!merge });
  }
  try {
    sent.push("confirmation sent via " + sendConfirmation_(email, data, merge));
  } catch (err) {
    console.error("confirmation failed: " + err);
    sent.push("confirmation FAILED: " + err);
  }
  // the notice is for the organisers, who see every registration on the admin page anyway: on a day short of
  // emails it gives way to the participants' confirmations
  var left = NOTIFY ? emailsLeft_() : null;
  if (NOTIFY && left !== null && left < NOTICE_MIN) {
    sent.push("notice skipped: " + left + " emails left today, kept for the confirmations");
  } else if (NOTIFY) {
    try {
      sent.push(
        "notice sent via " + sendNotice_(email, data, letterUrl, merge, row, namesake),
      );
    } catch (err) {
      console.error("notice failed: " + err);
      sent.push("notice FAILED: " + err);
    }
  }
  try {
    sheet
      .getRange(row, header.indexOf("Emails") + 1)
      .setValue(sent.join("; "));
  } catch (err) {
    console.error("could not record the emails: " + err);
  }

  return json_({ ok: true, updated: !!merge });
}

/* --- confirmations owed ----------------------------------------- */

// run from the editor: who is owed a confirmation (theirs failed or was held). Sends nothing.
function previewConfirmations() {
  confirmations_(false);
}

// run from the editor: sends each of them the confirmation, once
function sendConfirmations() {
  confirmations_(true);
}

// previewConfirmations and sendConfirmations: the registrations with no "confirmation sent" in "Emails", oldest
// first, but those with nothing there (rows from before it was recorded) and those with a decision email, which
// says more. Stops as decisions_ does, at the day's emails and well before Apps Script's 6 minutes.
function confirmations_(send) {
  var lock = send ? LockService.getDocumentLock() : null;
  if (lock && !lock.tryLock(2000)) {
    Logger.log("Someone else is sending emails from this script right now. Try again in a minute.");
    return null;
  }
  try {
    var started = Date.now();
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var col = header.indexOf("Emails") + 1;
    var stamp = function () {
      return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
    };
    var due = [];
    var unknown = 0;
    var decided = 0;
    for (var i = 1; i < values.length; i++) {
      var r = toRecord_(header, values[i]);
      var had = String(r["Emails"]).trim();
      if (had.indexOf("confirmation sent") !== -1) continue;
      var name = String(r["First name"] + " " + r["Last name"]).trim();
      var email = String(r["Email"]).trim().toLowerCase();
      if (!had) {
        unknown++;
        if (!send) Logger.log("Row " + (i + 1) + " · " + name + " <" + email + "> · nothing in Emails · left out");
        continue;
      }
      if (String(r["Decision email"]).indexOf(": sent") !== -1) {
        decided++;
        continue;
      }
      due.push({ row: i + 1, r: r, had: had, name: name, email: email });
    }
    var reserve = reserve_();
    var cache = CacheService.getScriptCache();
    var sent = 0;
    var failed = 0;
    var stopped = "";
    due.forEach(function (d) {
      if (!send) {
        Logger.log("Row " + d.row + " · " + d.name + " <" + d.email + "> · " + d.had + " · to send");
        return;
      }
      if (stopped) return;
      var left = emailsLeft_();
      if (left !== null && left <= reserve) stopped = "quota";
      else if (Date.now() - started > 4.5 * 60 * 1000) stopped = "time";
      if (stopped) return;
      var note;
      try {
        var data = { first_name: d.r["First name"], attend: String(d.r["Attends"]).trim() };
        note = "confirmation sent " + stamp() + " via " + sendConfirmation_(d.email, data, null) + ", late";
        sent++;
        // as doPost does: registering again within 6 hours sends no second email
        cache.put("mail-to:" + eventKey_(d.r["Attends"]) + ":" + d.email, "1", 21600);
      } catch (err) {
        note = "confirmation FAILED again " + stamp() + ": " + err;
        failed++;
      }
      sheet.getRange(d.row, col).setValue(cellFor_("Emails", emailsWith_(d.had, note)));
      Logger.log("Row " + d.row + " · " + d.name + " <" + d.email + "> · " + note);
    });
    var waiting = due.length - sent - failed;
    var rest =
      (decided ? ", " + decided + " left out with a decision email" : "") +
      (unknown ? ", " + unknown + " left out with nothing in Emails" : "");
    Logger.log(
      send
        ? sent + " sent, " + failed + " failed" + rest +
            (stopped === "quota"
              ? (reserve
                  ? ". Stopped with " + reserve + " emails left for today, kept for new registrations"
                  : ". Stopped: today's emails are used up") +
                ": run sendConfirmations again tomorrow for the other " + waiting + "."
              : stopped === "time"
                ? ". Stopped before Apps Script's time limit: run sendConfirmations again for the other " + waiting + "."
                : failed
                  ? ". Run sendConfirmations again to retry the failed ones."
                  : "")
        : due.length + " to send" + rest + ". Run sendConfirmations to send them.",
    );
    return { sent: sent, failed: failed, left: send ? waiting : due.length, stopped: stopped };
  } finally {
    if (lock) lock.releaseLock();
  }
}

// "Emails" with a note added after what it says. The cell keeps 500 characters (clean_): past that the oldest part
// goes, as the newest note is the one the sends look for (so an email is not sent twice)
function emailsWith_(had, note) {
  var text = (had ? had + "; " : "") + note;
  return text.length > 500 ? "…" + text.slice(-499) : text;
}

/* ---------------------------------------------------------------- */

// run from the editor: logs which rows mergeDuplicates would merge, and changes nothing
function findDuplicates() {
  mergeAll_(false);
}

// run from the editor: merges the rows of people who applied twice for the same event, oldest row kept.
// Copies the tab first, sends no emails.
function mergeDuplicates() {
  mergeAll_(true);
}

function mergeAll_(apply) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var original = values.map(function (r) {
      return r.slice();
    });
    var gone = {}; // rows merged into an earlier one, deleted at the end
    var kept = {}; // rows that took in a later one
    var count = 0;
    for (var i = 2; i < values.length; i++) {
      var rec = toRecord_(header, values[i]);
      var match = findMatch_(values, header, rec, i, gone);
      if (!match) continue;
      var older = toRecord_(header, values[match.index]);
      var merge = merge_(header, older, rec, match.by);
      Logger.log(
        "Row " +
          (i + 1) +
          " (" +
          rec["First name"] +
          " " +
          rec["Last name"] +
          ", " +
          rec["Email"] +
          ") into row " +
          (match.index + 1) +
          " (" +
          older["First name"] +
          " " +
          older["Last name"] +
          ", " +
          older["Email"] +
          "): " +
          (match.by === "email" ? "same email" : "same name"),
      );
      // later rows are matched against the merged row, with all its emails
      values[match.index] = header.map(function (col) {
        return merge.rec[col];
      });
      kept[match.index] = true;
      gone[i] = true;
      count++;
    }
    if (apply && count) {
      var backup =
        SHEET_NAME +
        " before merge " +
        Utilities.formatDate(
          new Date(),
          Session.getScriptTimeZone(),
          "yyyy-MM-dd HH:mm:ss",
        );
      sheet.copyTo(sheet.getParent()).setName(backup);
      Logger.log('Backup of the sheet as it was: tab "' + backup + '"');
      Object.keys(kept).forEach(function (k) {
        writeMerged_(
          sheet,
          Number(k) + 1,
          header,
          toRecord_(header, original[k]),
          toRecord_(header, values[k]),
        );
      });
      Object.keys(gone)
        .map(Number)
        .sort(function (a, b) {
          return b - a;
        })
        .forEach(function (i) {
          sheet.deleteRow(i + 1);
        });
    }
    Logger.log(
      count === 0
        ? "No one applied twice."
        : count +
            (apply ? " rows merged and deleted." : " rows to merge. Run mergeDuplicates to merge them."),
    );
  } finally {
    lock.releaseLock();
  }
}

// the sheet's own menu, for what is done by hand in it (Google runs onOpen when the sheet is opened)
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("BreaQ")
    .addItem("Merge two rows of the same person…", "mergeRowsByHand")
    .addToUi();
}

// BreaQ -> Merge two rows of the same person…: two rows nothing matched (another email, the name written another
// way), merged as a second application is (merge_): the later row's answers into the earlier one, which keeps its
// grades and decision, and the later row deleted. Nothing is held while the dialogs wait for an answer: the rows
// are read again before merging, and left alone if they changed meanwhile.
function mergeRowsByHand() {
  var ui = SpreadsheetApp.getUi();
  var asked = ui.prompt(
    "Merge two rows of the same person",
    "The two row numbers in the " + SHEET_NAME + " tab, e.g. 23 276:",
    ui.ButtonSet.OK_CANCEL,
  );
  if (asked.getSelectedButton() !== ui.Button.OK) return;
  var rows = (asked.getResponseText().match(/\d+/g) || []).map(Number).sort(function (a, b) {
    return a - b;
  });
  if (rows.length !== 2 || rows[0] === rows[1]) {
    ui.alert("Give two different row numbers, e.g. 23 276.");
    return;
  }
  var sheet = sheet_();
  var read = function () {
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    if (rows[0] < 2 || rows[1] > values.length) return null;
    return {
      header: header,
      older: toRecord_(header, values[rows[0] - 1]),
      newer: toRecord_(header, values[rows[1] - 1]),
    };
  };
  var line = function (n, r) {
    return (
      "Row " + n + ": " + String(r["First name"] + " " + r["Last name"]).trim() + " <" + r["Email"] + ">, " +
      eventKey_(r["Attends"]) +
      (r["Timestamp"] instanceof Date
        ? ", registered " + Utilities.formatDate(r["Timestamp"], Session.getScriptTimeZone(), "d MMM HH:mm")
        : "")
    );
  };
  var seen = read();
  if (!seen) {
    ui.alert("The registrations are in rows 2 to " + sheet.getLastRow() + ".");
    return;
  }
  if (eventKey_(seen.older["Attends"]) !== eventKey_(seen.newer["Attends"])) {
    ui.alert(
      "These stay apart",
      line(rows[0], seen.older) + "\n" + line(rows[1], seen.newer) +
        "\n\nOne is for the hackathon and the other for the conference: someone at both has a row for each.",
      ui.ButtonSet.OK,
    );
    return;
  }
  var sure = ui.alert(
    "Merge these two?",
    line(rows[1], seen.newer) + "\ninto\n" + line(rows[0], seen.older) +
      "\n\nRow " + rows[1] + "'s answers replace row " + rows[0] + "'s where it has them (the Merged column keeps the " +
      "earlier ones), both emails stay, the grades and the decision row " + rows[0] + " has stay, and row " + rows[1] +
      " is deleted.",
    ui.ButtonSet.YES_NO,
  );
  if (sure !== ui.Button.YES) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = read();
    var same = function (a, b) {
      return String(a["Email"]) === String(b["Email"]) && String(a["Last name"]) === String(b["Last name"]);
    };
    if (!now || !same(now.older, seen.older) || !same(now.newer, seen.newer)) {
      ui.alert("The rows moved while you were deciding (a registration came in, or rows were deleted). Nothing was merged: try again.");
      return;
    }
    var merge = merge_(now.header, now.older, now.newer, "hand");
    writeMerged_(sheet, rows[0], now.header, now.older, merge.rec);
    sheet.deleteRow(rows[1]);
    rosterChanged_(); // the dashboard's access follows the merged row's emails and decision
  } finally {
    lock.releaseLock();
  }
  ui.alert("Merged: row " + rows[1] + " is now part of row " + rows[0] + ".");
}

/* --- decision emails ------------------------------------------- */

// run from the editor: who would get which decision email, with the teams to check first. Sends nothing.
function previewDecisions() {
  decisions_(false);
}

// run from the editor: sends each hackathon participant the email for the decision in their row, once
function sendDecisions() {
  decisions_(true);
}

// run from the editor: one of each decision email, personal and team, to the account running it
function sendDecisionSamples() {
  var me = Session.getEffectiveUser().getEmail();
  var to = sampleTo_();
  var alone = { name: "Ana", email: me, mates: [], conference: false };
  var team = {
    name: "Ana",
    email: me,
    mates: ["Mihai Ionescu", "Ioana Marin"],
    conference: true,
  };
  DECISIONS.forEach(function (kind) {
    [alone, team].forEach(function (p) {
      var mail = renderEmail_(p.name, decisionEmail_(kind, p));
      send_({
        to: to,
        subject: "[sample] " + mail.subject,
        body: mail.text,
        htmlBody: mail.html,
        name: SENDER_NAME,
        replyTo: REPLY_TO,
      });
    });
  });
  Logger.log("Sent " + DECISIONS.length * 2 + " sample emails to " + to);
}

// previewDecisions, sendDecisions and the admin page's Send button: what happens to each person with a
// decision, in the log and in the answer ({ items: [{ name, email, decision, status, note, warn }] }).
// status: "to send", "sent", "failed", "sent before", "held" (a teammate undecided or decided otherwise) or
// "skipped".
function decisions_(send) {
  // two organisers pressing Send at once must not email anyone twice
  var lock = send ? LockService.getDocumentLock() : null;
  if (lock && !lock.tryLock(2000))
    return {
      ok: false,
      action: "decisions",
      error:
        "Someone else is sending the decision emails right now. Wait a minute, then refresh to see what went out.",
    };
  try {
    return decisionsLocked_(send);
  } finally {
    if (lock) lock.releaseLock();
  }
}

function decisionsLocked_(send) {
  var started = Date.now();
  var sheet = sheet_();
  var values = sheet.getDataRange().getValues();
  var header = header_(values);
  decisionColumn_(sheet, header);
  var col = header.indexOf("Decision email") + 1;
  var stamp = function () {
    return Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd HH:mm",
    );
  };
  var items = [];
  var due = []; // the emails to send: { item, r, p, kind }
  var stopped = ""; // "quota" or "time": the rest waits for the next send
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    var kind = String(r["Decision"]).trim().toLowerCase();
    if (!kind) continue;
    var item = {
      row: i + 1,
      name: String(r["First name"] + " " + r["Last name"]).trim(),
      email: String(r["Email"]),
      decision: kind,
      status: "",
      note: "",
      warn: false,
    };
    items.push(item);
    if (DECISIONS.indexOf(kind) === -1) {
      item.status = "skipped";
      item.note = "not a decision (" + DECISIONS.join(", ") + ")";
      item.warn = true;
      continue;
    }
    if (eventKey_(r["Attends"]) !== "hackathon") {
      item.status = "skipped";
      item.note = "a conference registration, which gets no decision email";
      continue;
    }
    var p = person_(values, header, r);
    var team = teamOf_(values, header, p.mates, r);
    item.note = teamLine_(team, kind);
    item.warn = item.note.indexOf("⚠") !== -1;
    if (String(r["Decision email"]).indexOf(kind + ": sent") === 0) {
      item.status = "sent before";
      continue;
    }
    // one team, one decision: nobody hears "your team is in" while a teammate is undecided, waitlisted or denied
    if (
      team.some(function (t) {
        return t.decision !== null && t.decision !== kind;
      })
    ) {
      item.status = "held";
      continue;
    }
    // the email names the registered teammates (all with this same decision); with none, it is the personal one
    p.mates = team
      .filter(function (t) {
        return t.decision === kind;
      })
      .map(function (t) {
        return t.name;
      });
    item.status = "to send";
    due.push({ item: item, r: r, p: p, kind: kind });
  }

  // the accepted first, then the waiting list, then the denied (each in the sheet's order): when the day's emails
  // run out, those left for the next send are the ones with nothing to do
  var reserve = reserve_();
  due.sort(function (a, b) {
    return DECISION_ORDER.indexOf(a.kind) - DECISION_ORDER.indexOf(b.kind) || a.item.row - b.item.row;
  });
  due.forEach(function (d) {
    if (!send || stopped) return;
    var item = d.item;
    var left = emailsLeft_();
    if (left !== null && left <= reserve) stopped = "quota";
    // Apps Script stops a run at 6 minutes: stop sending well before, the next send carries on
    else if (Date.now() - started > 4.5 * 60 * 1000) stopped = "time";
    if (stopped) return;
    var mail = renderEmail_(d.p.name, decisionEmail_(d.kind, d.p));
    var status;
    try {
      var via = send_({
        to: d.r["Email"],
        subject: mail.subject,
        body: mail.text,
        htmlBody: mail.html,
        name: SENDER_NAME,
        replyTo: REPLY_TO,
      });
      status = d.kind + ": sent " + stamp() + " via " + via;
      item.status = "sent";
    } catch (err) {
      status = d.kind + ": FAILED " + stamp() + ": " + err;
      item.status = "failed";
      item.note = (item.note ? item.note + " · " : "") + String(err);
    }
    sheet.getRange(item.row, col).setValue(cellFor_("Decision email", status));
  });

  var count = function (status) {
    return items.filter(function (it) {
      return it.status === status;
    }).length;
  };
  items.forEach(function (it) {
    Logger.log(
      "Row " + it.row + " · " + it.name + " <" + it.email + "> · " + it.decision +
        (it.note ? " · " + it.note : "") + " · " + it.status,
    );
  });
  var rest =
    ", " + count("sent before") + " sent before" +
    (count("held")
      ? ", " + count("held") + " held back (a team not all decided the same)"
      : "") +
    (items.some(function (it) {
      return it.warn;
    })
      ? ", some to check (⚠ above)"
      : "");
  Logger.log(
    send
      ? count("sent") + " sent, " + count("failed") + " failed" + rest +
          (stopped === "quota"
            ? (reserve
                ? ". Stopped with " + reserve + " emails left for today, kept for new registrations"
                : ". Stopped: today's emails are used up") +
              ": send again tomorrow for the other " + count("to send") + "."
            : stopped === "time"
              ? ". Stopped before Apps Script's time limit: send again for the other " + count("to send") + "."
              : "")
      : count("to send") + " to send" + rest + ". Run sendDecisions to send them.",
  );
  return {
    ok: true,
    action: "decisions",
    sent: send,
    stopped: stopped,
    items: items,
    emailsLeft: emailsLeft_(),
    reserve: reserve,
  };
}

// how many of the day's emails a send leaves for new registrations: none once registration has closed
function reserve_() {
  return Date.now() < Date.parse(REGISTRATION_CLOSES) ? DECISION_RESERVE : 0;
}

/* --- emails to the people picked on the admin page ------------------------------- */

// what the admin page can send the people picked in it: the decision emails (which set the Decision too, so the
// dashboard, the regular send and the page agree), the registration's confirmation again, or one written there
var MAIL_KINDS = ["accepted", "waitlist", "denied", "confirmation", "custom", "eve"];
var MAIL_TEXT_MAX = 5000;
var MAIL_SUBJECT_MAX = 150;

// admin.html: { emails, kind, note, mates, again, subject, text, sign, record, send }. note: a paragraph of the
// organisers' own after a decision email's text; mates: a decision email names the registered teammates with the same
// decision (or picked for it now), else it is the personal one; again: also to those who had this email already;
// subject, text and sign: the custom email; record: a decision email they had by hand, only recorded (no email). Without send: who would get it (items) and the email as the first of them reads
// it (sample). Stops as decisions_ does, at the day's emails and well before Apps Script's 6 minutes.
function mail_(data) {
  var kind = String(data.kind || "");
  if (MAIL_KINDS.indexOf(kind) === -1)
    return { ok: false, action: "mail", error: "Choose which email to send." };
  var emails = emailsOf_({ Email: "", "Other emails": [].concat(data.emails || []).join(",") });
  if (!emails.length) return { ok: false, action: "mail", error: "Pick at least one person." };
  var text = function (v) {
    return String(v || "").replace(/\r\n?/g, "\n").trim().slice(0, MAIL_TEXT_MAX);
  };
  var opts = {
    note: text(data.note),
    subject: clean_(data.subject).slice(0, MAIL_SUBJECT_MAX),
    body: text(data.text),
    sign: clean_(data.sign).slice(0, 60) || "Best regards,",
    mates: data.mates !== false,
    again: !!data.again,
    record: !!data.record && DECISIONS.indexOf(kind) !== -1,
  };
  if (kind === "custom" && (!opts.subject || !opts.body))
    return { ok: false, action: "mail", error: "Write the subject and the message first." };
  if (kind === "eve" && !WHATSAPP_GROUP)
    return {
      ok: false,
      action: "mail",
      error: "Paste the WhatsApp group’s link into WHATSAPP_GROUP in the Apps Script first (and deploy a new version).",
    };
  // two organisers pressing Send at once must not email anyone twice
  var lock = data.send ? LockService.getDocumentLock() : null;
  if (lock && !lock.tryLock(2000))
    return {
      ok: false,
      action: "mail",
      error: "Someone else is sending emails from this script right now. Wait a minute, then try again.",
    };
  try {
    return mailLocked_(kind, emails, opts, !!data.send);
  } finally {
    if (lock) lock.releaseLock();
  }
}

function mailLocked_(kind, emails, opts, send) {
  var started = Date.now();
  var sheet = sheet_();
  var values = sheet.getDataRange().getValues();
  var header = header_(values);
  var decision = DECISIONS.indexOf(kind) !== -1;
  var stamp = function () {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  };
  // each email's registrations, the hackathon's first
  var rowsOf = {};
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    var x = { row: i + 1, r: r, ev: eventKey_(r["Attends"]) };
    emailsOf_(r).forEach(function (e) {
      (rowsOf[e] = rowsOf[e] || [])[x.ev === "hackathon" ? "unshift" : "push"](x);
    });
  }
  var picked = {};
  emails.forEach(function (e) {
    picked[e] = true;
  });

  // one item per email to send: { email, name, what (the event, for a confirmation), status, note, warn }, with the
  // row it is for and, for a decision email, the person (person_)
  var items = [];
  var add = function (email, x, what) {
    var it = {
      email: email,
      name: x ? String(x.r["First name"] + " " + x.r["Last name"]).trim() : "",
      what: what || "",
      status: "to send",
      note: "",
      warn: false,
      x: x,
    };
    items.push(it);
    return it;
  };
  // {track} in what the organisers wrote, for someone given no track yet: it would come out empty
  var trackless = function (r, text) {
    return /\{track\}/i.test(text) && !String(r["Hackathon track"] || "").trim() ? "⚠ no track given yet: {track} is empty" : "";
  };
  emails.forEach(function (email) {
    var rows = rowsOf[email] || [];
    if (!rows.length) {
      var gone = add(email, null);
      gone.status = "missing";
      gone.note = "not in the sheet any more: refresh the page";
      return;
    }
    if (decision) {
      var it = add(email, rows[0]);
      if (rows[0].ev !== "hackathon") {
        it.status = "skipped";
        it.note = "registered for the conference only, which has no decision emails";
        return;
      }
      var r = rows[0].r;
      var p = person_(values, header, r);
      // the team as it will be: the teammates picked here get this same decision
      var team = teamOf_(values, header, p.mates, r).map(function (t) {
        return picked[t.email] ? { name: t.name, decision: kind, email: t.email } : t;
      });
      p.mates = opts.mates
        ? team
            .filter(function (t) {
              return t.decision === kind;
            })
            .map(function (t) {
              return t.name;
            })
        : [];
      it.p = p;
      var now = String(r["Decision"]).trim().toLowerCase();
      it.note = [now && now !== kind ? "decided " + now + " until now" : "", teamLine_(team, kind), trackless(r, opts.note)]
        .filter(String)
        .join(" · ");
      it.warn = it.note.indexOf("⚠") !== -1;
      if (!opts.again && String(r["Decision email"]).indexOf(kind + ": sent") === 0) it.status = "sent before";
      return;
    }
    if (kind === "confirmation") {
      // one for each event they registered for
      rows.forEach(function (x) {
        var c = add(email, x, x.ev);
        if (!opts.again && String(x.r["Emails"]).indexOf("confirmation sent") !== -1) c.status = "sent before";
      });
      return;
    }
    if (kind === "eve") {
      var eve = add(email, rows[0]);
      var h = rows[0].r;
      if (rows[0].ev !== "hackathon") {
        eve.status = "skipped";
        eve.note = "registered for the conference only";
      } else if (String(h["Decision"]).trim().toLowerCase() !== "accepted" || codeOff_(h)) {
        eve.status = "skipped";
        eve.note = codeOff_(h) ? "their code is off" : "not accepted";
      } else {
        if (!String(h["Hackathon track"] || "").trim()) {
          eve.note = "⚠ no track given yet: the email says they hear it at the kick-off";
          eve.warn = true;
        }
        if (!opts.again && String(h["Emails"]).indexOf(EVE_LOG + " sent") !== -1) eve.status = "sent before";
      }
      return;
    }
    var mine = add(email, rows[0]);
    mine.note = trackless(rows[0].r, opts.subject + "\n" + opts.body);
    mine.warn = !!mine.note;
    if (!opts.again && String(rows[0].r["Emails"]).indexOf("email “" + opts.subject + "” sent") !== -1)
      mine.status = "sent before";
  });

  var mailFor = function (it) {
    var r = it.x.r;
    var first = String(r["First name"]).trim();
    if (decision) {
      var t = decisionEmail_(kind, it.p);
      if (opts.note) t.paras = t.paras.concat(paras_(fill_(opts.note, r)));
      return renderEmail_(first, t);
    }
    if (kind === "confirmation") return confirmationEmail_({ first_name: first, attend: String(r["Attends"]).trim() }, null);
    if (kind === "eve") return eveEmail_(r);
    return renderEmail_(first, {
      subject: fill_(opts.subject, r),
      heading: "Hi " + first + ",",
      paras: paras_(fill_(opts.body, r)),
      button: null,
      sign: opts.sign,
    });
  };

  var reserve = reserve_();
  var stopped = "";
  var changed = false;
  var col = function (name) {
    return header.indexOf(name) + 1;
  };
  if (send)
    items.forEach(function (it) {
      if (it.status !== "to send" || stopped) return;
      var r = it.x.r;
      // emailed by hand already: the Decision and the record of it, as a send would leave them, and no email
      if (opts.record) {
        if (String(r["Decision"]).trim().toLowerCase() !== kind) {
          sheet.getRange(it.x.row, col("Decision")).setValue(kind);
          r["Decision"] = kind;
          changed = true;
        }
        sheet
          .getRange(it.x.row, col("Decision email"))
          .setValue(cellFor_("Decision email", kind + ": sent by hand, recorded " + stamp() + " on the admin page"));
        it.status = "recorded";
        return;
      }
      var left = emailsLeft_();
      if (left !== null && left <= reserve) stopped = "quota";
      else if (Date.now() - started > 4.5 * 60 * 1000) stopped = "time";
      if (stopped) return;
      // the decision first: the email says it, and the dashboard opens for the accepted only
      if (decision && String(r["Decision"]).trim().toLowerCase() !== kind) {
        sheet.getRange(it.x.row, col("Decision")).setValue(kind);
        r["Decision"] = kind;
        changed = true;
      }
      var how;
      try {
        var mail = mailFor(it);
        how = " sent " + stamp() + " via " + send_({
          to: String(r["Email"]).trim(),
          subject: mail.subject,
          body: mail.text,
          htmlBody: mail.html,
          name: SENDER_NAME,
          replyTo: REPLY_TO,
        });
        it.status = "sent";
      } catch (err) {
        how = " FAILED " + stamp() + ": " + err;
        it.status = "failed";
        it.note = (it.note ? it.note + " · " : "") + String(err);
      }
      how += ", from the admin page";
      // as the regular sends write it, so that they count it
      if (decision) sheet.getRange(it.x.row, col("Decision email")).setValue(cellFor_("Decision email", kind + ":" + how));
      else {
        var had = String(r["Emails"]).trim();
        r["Emails"] = emailsWith_(
          had,
          (kind === "confirmation" ? "confirmation" : kind === "eve" ? EVE_LOG : "email “" + opts.subject + "”") + how,
        );
        sheet.getRange(it.x.row, col("Emails")).setValue(cellFor_("Emails", r["Emails"]));
      }
    });
  if (changed) rosterChanged_(); // the dashboard's access follows the decision at once

  // the email as the first one due reads it (or the first who had it already)
  var sample = null;
  var first = items.filter(function (it) {
    return it.status === "to send" || it.status === "sent before";
  })[0];
  if (!send && first && !opts.record) {
    var m = mailFor(first);
    sample = { name: first.name, email: first.email, subject: m.subject, html: m.html };
  }
  return {
    ok: true,
    action: "mail",
    kind: kind,
    sent: send,
    record: opts.record, // the page sends a record only to a script that says it records
    stopped: stopped,
    items: items.map(function (it) {
      return { email: it.email, name: it.name, what: it.what, status: it.status, note: it.note, warn: it.warn };
    }),
    sample: sample,
    emailsLeft: emailsLeft_(),
    reserve: reserve,
  };
}

// {first name}, {name}, {track} (the one they were given) and {dashboard} (the link with their code) in what the
// organisers write, each person's own
function fill_(s, r) {
  var email = String(r["Email"]).trim().toLowerCase();
  var put = function (v) {
    return function () {
      return v;
    };
  };
  return String(s)
    .replace(/\{first name\}/gi, put(String(r["First name"]).trim()))
    .replace(/\{name\}/gi, put(String(r["First name"] + " " + r["Last name"]).trim()))
    .replace(/\{track\}/gi, put(String(r["Hackathon track"] || "").trim()))
    .replace(/\{dashboard\}/gi, function () {
      return TEAMS_PAGE + "#code=" + dashboardCode_(email);
    });
}

// paragraphs: a blank line between them
function paras_(s) {
  return String(s)
    .split(/\n\s*\n/)
    .map(function (p) {
      return p.trim();
    })
    .filter(String);
}

// the Decision column as a dropdown of DECISIONS
function decisionColumn_(sheet, header) {
  var c = header.indexOf("Decision") + 1;
  var rows = sheet.getMaxRows() - 1;
  if (!c || rows < 1) return;
  sheet
    .getRange(2, c, rows, 1)
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(DECISIONS, true)
        .setAllowInvalid(false)
        .build(),
    );
}

// the Hackathon track column as a dropdown of CHALLENGES
function trackColumn_(sheet, header) {
  var c = header.indexOf("Hackathon track") + 1;
  var rows = sheet.getMaxRows() - 1;
  if (!c || rows < 1) return;
  sheet
    .getRange(2, c, rows, 1)
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(CHALLENGES, true)
        .setAllowInvalid(false)
        .build(),
    );
}

// the vote columns among cols as whole grades from GRADE_MIN to GRADE_MAX (a decimal one is refused by vote_)
function voteColumns_(sheet, header, cols) {
  var rows = sheet.getMaxRows() - 1;
  cols.forEach(function (col) {
    var c = header.indexOf(col) + 1;
    if (!c || rows < 1 || VOTE_COLUMNS.indexOf(col) === -1) return;
    sheet
      .getRange(2, c, rows, 1)
      .setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireNumberBetween(GRADE_MIN, GRADE_MAX)
          .setAllowInvalid(false)
          .build(),
      );
  });
}

// what a decision email needs about the person: their first name, the teammates they named (none when they
// applied on their own) and whether this same email is registered for the conference too
function person_(values, header, r) {
  var own = nameKey_(r["First name"], r["Last name"]);
  var mates =
    r["Team"] === "team"
      ? teammates_(r["Team name and members"]).filter(function (n) {
          return nameKey_(n, "") !== own;
        })
      : [];
  var conf = {};
  header.forEach(function (col) {
    conf[col] = r[col];
  });
  conf["Attends"] = "conference";
  var m = findMatch_(values, header, conf, values.length, {});
  return {
    name: String(r["First name"]).trim(),
    email: String(r["Email"]).trim().toLowerCase(),
    mates: mates,
    conference: !!(m && m.by === "email"),
  };
}

// "Ana Popescu, Mihai Ionescu și Ioana Marin" -> the three names
function teammates_(text) {
  return String(text || "")
    .split(/\s*[,;\n+&\/]\s*|\s+(?:and|și|si)\s+/i)
    .map(function (s) {
      return s.trim();
    })
    .filter(String);
}

// the teammates r named, each with the decision in their own row, found by name among the hackathon
// registrations: { name, decision, email } ("" not decided yet, null not registered under that name). A name written
// another way than its registration still finds it (similarMates_); several run together without a comma come
// back one by one, each under the name they registered with.
function teamOf_(values, header, mates, r) {
  var people = hackPeople_(values, header);
  var email = r ? String(r["Email"]).trim().toLowerCase() : "";
  var namer = null;
  people.forEach(function (p) {
    if (email && p.email === email) namer = p;
  });
  var team = [];
  mates.forEach(function (m) {
    var key = nameKey_(m, "");
    for (var i = 0; i < people.length; i++)
      if (people[i].key === key) return team.push({ name: m, decision: people[i].decision, email: people[i].email });
    var found = similarMates_(m, people, namer);
    found.found.forEach(function (p) {
      team.push({ name: found.found.length === 1 && !found.left ? m : p.name, decision: p.decision, email: p.email });
    });
    if (found.left) team.push({ name: found.left, decision: null, email: "" });
  });
  return team;
}

// the hackathon registrations, for finding the teammates named: { key, words, email, mails (their emails before
// the @), mates (the names they wrote), decision, name }. Read once for the same values.
var hackPeople = { values: null, people: [] };
function hackPeople_(values, header) {
  if (hackPeople.values === values) return hackPeople.people;
  var people = [];
  for (var i = 1; i < values.length; i++) {
    var t = toRecord_(header, values[i]);
    if (eventKey_(t["Attends"]) !== "hackathon") continue;
    people.push({
      key: nameKey_(t["First name"], t["Last name"]),
      words: nameWords_(t["First name"] + " " + t["Last name"]),
      email: String(t["Email"]).trim().toLowerCase(),
      mails: emailsOf_(t).map(function (e) {
        return e.split("@")[0];
      }),
      mates: String(t["Team"]).trim() === "team" ? teammates_(t["Team name and members"]) : [],
      decision: String(t["Decision"]).trim().toLowerCase(),
      name: String(t["First name"] + " " + t["Last name"]).trim(),
    });
  }
  hackPeople = { values: values, people: people };
  return people;
}

// the words of a name, as nameKey_ has them, in the order written
function nameWords_(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(String);
}

// two words of a name that are one: the same, a short form ("alex" of "alexandru", never "stan" of "stanescu"), or a
// typo (a letter off, two in a long word). Ioan and Ioana, Cristian and Cristina are two people.
function nearWord_(a, b) {
  if (a === b) return true;
  if ((a.slice(-1) === "a") !== (b.slice(-1) === "a")) return false;
  var s = a.length <= b.length ? a : b;
  var l = s === a ? b : a;
  if (s.length < 4) return false;
  if (l.indexOf(s) === 0 && !/^(escu|eanu|anu)$/.test(l.slice(s.length))) return true;
  return distance_(a, b) <= (l.length >= 8 ? 2 : 1);
}

// every word of part has its like in whole
function within_(part, whole) {
  return part.every(function (t) {
    return whole.some(function (u) {
      return nearWord_(t, u);
    });
  });
}

// Damerau-Levenshtein (optimal string alignment): letters added, dropped, changed or swapped
function distance_(a, b) {
  var d = [];
  var i, j;
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

// A teammate's name that nobody registered under as written, matched to the same people written another way (the
// admin page's similarMates does the same). people from hackPeople_, namer among them. { found: the people it is,
// left: what is still nobody's ("" for none) }:
// - whole names in what was written: a longer form ("Cosmin-Eusebiu Patrașcu" for Cosmin Patrascu), or several run
//   together without a comma ("Nitas Robert-Cristian Moise Robert-Alexandru"), the namer's own among them
// - a shorter form, a typo or a short form ("David Munteanu" for David-Andrei Munteanu, "Pospai Alexandru" for alex
//   pospai), when only one person fits
// - the given names right and the family name in their email (registered with a teammate's family name)
// - someone who named the namer back, with two words of it ("Radu Stan Pop" for Radu-Stefan Pop), or the one word
//   written ("Bogdan")
function similarMates_(name, people, namer) {
  var words = nameWords_(name);
  var none = { found: [], left: name };
  if (!words.length) return none;
  var inside = people.filter(function (p) {
    return p.words.length >= 2 && within_(p.words, words);
  });
  if (inside.length) {
    var used = [].concat.apply(
      [],
      inside.map(function (p) {
        return p.words;
      }),
    );
    var left = words.filter(function (t) {
      return !used.some(function (u) {
        return nearWord_(t, u);
      });
    });
    // two words or more left over are someone else, named in the same breath
    var rest =
      left.length < 2
        ? ""
        : String(name)
            .trim()
            .split(/[\s-]+/)
            .filter(function (w) {
              return nameWords_(w).some(function (t) {
                return left.indexOf(t) !== -1;
              });
            })
            .join(" ");
    return {
      found: inside.filter(function (p) {
        return p !== namer;
      }),
      left: rest,
    };
  }
  if (namer && words.length >= 2 && within_(words, namer.words)) return { found: [], left: "" }; // their own, shorter
  var others = people.filter(function (p) {
    return p !== namer;
  });
  var fit =
    words.length < 2
      ? []
      : others.filter(function (p) {
          return within_(words, p.words);
        });
  if (fit.length) return fit.length === 1 ? { found: fit, left: "" } : none;
  var mail = others.filter(function (p) {
    var same = words.filter(function (t) {
      return p.words.some(function (u) {
        return nearWord_(t, u);
      });
    });
    return (
      same.length >= 2 &&
      words.every(function (t) {
        return (
          same.indexOf(t) !== -1 ||
          (t.length >= 4 &&
            p.mails.some(function (m) {
              return m.indexOf(t) !== -1;
            }))
        );
      })
    );
  });
  if (mail.length === 1) return { found: mail, left: "" };
  if (namer) {
    var back = others.filter(function (p) {
      var same = words.filter(function (t) {
        return p.words.some(function (u) {
          return nearWord_(t, u);
        });
      }).length;
      return (
        (same >= 2 || (words.length === 1 && same === 1)) &&
        p.mates.some(function (m) {
          var w = nameWords_(m);
          return (
            w.slice().sort().join(" ") === namer.key ||
            (w.length >= 2 &&
              namer.words.length >= 2 &&
              (w.length <= namer.words.length ? within_(w, namer.words) : within_(namer.words, w)))
          );
        })
      );
    });
    if (back.length === 1) return { found: back, left: "" };
  }
  return none;
}

// the team and what to check before sending, marked ⚠: a teammate with another decision (the team is held back
// until they match), one not registered under the name given, a team over 3
function teamLine_(team, kind) {
  if (!team.length) return "";
  var size = team.length + 1;
  return (
    "team: " +
    team
      .map(function (t) {
        if (t.decision === null) return t.name + " (not registered ⚠)";
        if (t.decision === "") return t.name + " (not decided yet)";
        return t.name + " (" + t.decision + (t.decision === kind ? ")" : " ⚠)");
      })
      .join(", ") +
    (size > 3 ? " · ⚠ " + size + " people, over 3" : "")
  );
}

// "Mihai" / "Mihai and Ioana" / "Mihai, Ioana and Radu"
function and_(names) {
  return names.length < 2
    ? names.join("")
    : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

// The decision emails. p: { name, email (the acceptance gives that email's dashboard code), mates (the
// teammates' names, none for someone on their own), conference (registered for it with the same email) }. Change the wording here; sendDecisionSamples shows the result.
function decisionEmail_(kind, p) {
  var team = p.mates.length > 0;
  var where =
    "on 24–25 October at the CAMPUS Research Institute (Splaiul Independenței 313, Bucharest)";
  if (kind === "accepted") {
    return {
      subject: team
        ? "Your team is in: the BreaQ Hackathon"
        : "You are in: the BreaQ Hackathon",
      heading: (team ? "Your team is in, " : "You are in, ") + p.name + ".",
      paras: [
        team
          ? "Good news: we read your team’s applications together, and we would love to have " +
            and_(["you"].concat(p.mates)) +
            " at the BreaQ Hackathon, " +
            where +
            "."
          : "Good news: we read your application, and we would love to have you at the BreaQ Hackathon, " +
            where +
            ".",
        "What happens next: the Discord invite and the practical details (the schedule, what to bring, the challenges) reach you by email before the event.",
        "Everything we announce goes on the team dashboard, with your team, the schedule, the challenge resources, a checklist for the day and how to submit: " +
          TEAMS_PAGE +
          "#code=" +
          dashboardCode_(p.email) +
          " (if it asks, your personal code is " +
          dashboardCode_(p.email) +
          "; keep it to yourself, each participant has their own).",
        "Please tell us there by " +
          CONFIRM_BY +
          " that you are coming: it takes one click, and a place nobody uses can still go to someone on the waiting list. Cannot come after all? Say so on the dashboard, or reply to this email.",
      ],
      button: {
        label: "Add to calendar",
        href: SITE + "/breaq-2026-hackathon.ics",
      },
      sign: "See you there,",
    };
  }
  if (kind === "waitlist") {
    return {
      subject: team
        ? "BreaQ Hackathon: your team is on the waiting list"
        : "BreaQ Hackathon: you are on the waiting list",
      heading:
        (team ? "Your team is on the waiting list, " : "You are on the waiting list, ") +
        p.name +
        ".",
      paras: [
        "Thank you for applying to the BreaQ Hackathon. We received more applications than we have places, so for now " +
          (team
            ? and_(["you"].concat(p.mates)) +
              " are on our waiting list as a team."
            : "you are on our waiting list."),
        "Places do free up when someone cannot come. When there is room for " +
          (team ? "your team" : "you") +
          ", we write to you straight away, and either way you hear from us before the hackathon on 24–25 October.",
        "There is nothing to do for now. If your plans change and you can no longer come, a short reply to this email helps us.",
      ],
      button: null,
      sign: "Thank you for your patience,",
    };
  }
  return {
    subject: team
      ? "Your team’s BreaQ Hackathon application"
      : "Your BreaQ Hackathon application",
    heading: "Dear " + p.name + ",",
    paras: [
      "Thank you for applying to the BreaQ Hackathon. Competition was tough, with over four applicants per spot, and we’re sorry that we cannot offer you a place this year.",
      // "We read every application to the BreaQ Hackathon, and there were many more than we have places. We are sorry to tell you that we cannot offer " +
      //   (team ? "your team" : "you") +
      //   " a place this year.",
      // "It was a hard choice, and we hope you apply again next year.",

      p.conference 
        ? "You are registered for the BreaQ Conference on 14 November, and we look forward to seeing you there."
        : "In case you missed it, the BreaQ Conference on 14 November, at the Military Technical Academy “Ferdinand I”, is free and open to everyone, and we’d be glad to see you there. Registration takes a couple of minutes and closes on 5 November: " + SITE + "/register-conference.html",

      "We appreciate your interest in quantum and hope this outcome won’t kill your enthusiasm. We’re already organizing more events, hackathons, and seminars for the spring to accommodate everyone interested.",

      "Follow RoQTeam on " + "LinkedIn (https://www.linkedin.com/company/roqteam)" + " and "+ "Instagram (https://www.instagram.com/roqteam)" + " to stay tuned. We’ll share all upcoming events there."

    ],
    button: null,
    sign: "Warm regards,",
  };
}

// a decisionEmail_ as plain text and HTML, in the look of the confirmation email. What the organisers write on the
// admin page may have **bold**, [a label](https://…) for a link and lines that start with "- " (a list)
function renderEmail_(name, t) {
  var linked = function (s) {
    return esc_(s)
      .replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)<]+)\)|https:\/\/[^\s<]*[^\s<.,:;)]/g, function (m, label, href) {
        var u = href || m;
        return '<a href="' + u + '" style="color:#4c5c96">' + (label || u) + "</a>";
      })
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  };
  var item = /^- /;
  var block = function (s) {
    var lines = s.split("\n");
    if (!lines.some(function (l) { return item.test(l); }))
      return "<p>" + linked(s).replace(/\n/g, "<br>") + "</p>"; // a line break typed on the admin page
    // the lines of a list as one, the lines around it as a paragraph each side
    var html = "";
    for (var i = 0; i < lines.length; ) {
      var list = item.test(lines[i]);
      var run = [];
      while (i < lines.length && item.test(lines[i]) === list) run.push(lines[i++]);
      html += list
        ? '<ul style="margin:0 0 1em;padding-left:22px">' +
          run
            .map(function (l) {
              return '<li style="margin:3px 0">' + linked(l.slice(2)) + "</li>";
            })
            .join("") +
          "</ul>"
        : '<p style="margin:1em 0 4px">' + run.map(function (l) { return linked(l); }).join("<br>") + "</p>";
    }
    return html;
  };
  var plain = function (s) {
    return s.replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g, "$1: $2").replace(/\*\*([^*\n]+)\*\*/g, "$1");
  };
  var text =
    "Hi " +
    name +
    ",\n\n" +
    t.paras.map(plain).join("\n\n") +
    (t.button ? "\n\n" + t.button.label + ": " + t.button.href : "") +
    "\n\n" +
    t.sign +
    "\nRoQTeam";
  var html =
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#2e3141;max-width:560px">' +
    '<p style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#ff8c00;margin:0 0 6px">BreaQ 2026</p>' +
    '<h2 style="margin:0 0 18px;font-weight:700">' +
    esc_(t.heading) +
    "</h2>" +
    t.paras.map(block).join("") +
    (t.button
      ? '<p style="margin:24px 0"><a href="' +
        t.button.href +
        '" style="background:#4c5c96;color:#fff;text-decoration:none;padding:12px 20px;border-radius:3px;font-weight:700;letter-spacing:1px">' +
        esc_(t.button.label) +
        "</a></p>"
      : "") +
    '<p style="color:#666">Questions? Just reply to this email.</p>' +
    "<p>" +
    esc_(t.sign) +
    "<br>RoQTeam</p></div>";
  return { subject: t.subject, text: text, html: html };
}

// the day before the hackathon, in a look of its own: their challenge, the schedule, how to find CAMPUS, the laptop
// and the WhatsApp group. Tables and inline styles, as email clients want them; the plain text says the same.
function eveEmail_(r) {
  var first = String(r["First name"]).trim();
  var track = String(r["Hackathon track"] || "").trim();
  var tint = TRACK_COLOR[track] || ["#4c5c96", "#eef0f8"];
  var font = "font-family:Helvetica,Arial,sans-serif;";
  var ink = "#2e3141";
  var soft = "#5b6075";
  var label = function (s, c) {
    return (
      '<p style="' + font + "margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:" +
      (c || "#ff8c00") + '">' + esc_(s) + "</p>"
    );
  };
  var box = function (bg, inner, extra) {
    return (
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 26px">' +
      '<tr><td style="background:' + bg + ";border-radius:10px;padding:20px 22px;" + (extra || "") + '">' + inner + "</td></tr></table>"
    );
  };
  var button = function (href, text, bg) {
    return (
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:6px;background:' + bg + '">' +
      '<a href="' + esc_(href) + '" style="display:inline-block;padding:13px 24px;' + font +
      'font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px">' + esc_(text) + "</a></td></tr></table>"
    );
  };
  var p = function (s, style) {
    return '<p style="' + font + "margin:0;font-size:15px;line-height:1.55;color:" + ink + ";" + (style || "") + '">' + s + "</p>";
  };

  var challenge = track
    ? label("Your challenge", tint[0]) +
      p(esc_(track), "font-size:24px;font-weight:800;line-height:1.2;margin:0 0 8px") +
      p("One challenge each: if you ticked more than one, we picked yours from your preferences and the places left in each.", "font-size:13px;color:" + soft)
    : label("Your challenge", tint[0]) + p("You hear it at the kick-off, with everyone else.", "font-size:17px;font-weight:700");

  var schedule = EVE_SCHEDULE.map(function (d, i) {
    return (
      p(esc_(d.day), "font-weight:700;margin:" + (i ? "20px" : "0") + " 0 8px") +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      d.rows
        .map(function (row) {
          return (
            '<tr><td width="66" valign="top" style="padding:5px 0"><span style="display:inline-block;width:52px;padding:3px 0;border-radius:12px;' +
            "background:" + (row[0] ? ink : "#e6e8f0") + ";color:" + (row[0] ? "#ffffff" : "#6b7088") + ";" + font +
            'font-size:12px;font-weight:700;text-align:center">' + esc_(row[0] || "then") + "</span></td>" +
            '<td valign="top" style="padding:5px 0;' + font + "font-size:15px;line-height:1.5;color:" + ink + '">' + esc_(row[1]) + "</td></tr>"
          );
        })
        .join("") +
      "</table>"
    );
  }).join("");

  var way = EVE_WAY.map(function (s, i) {
    return (
      '<tr><td width="34" valign="top" style="padding:4px 0"><span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;' +
      "background:#4c5c96;color:#ffffff;" + font + 'font-size:12px;font-weight:700;text-align:center">' + (i + 1) + "</span></td>" +
      '<td valign="top" style="padding:4px 0;' + font + "font-size:14px;line-height:1.5;color:" + ink + '">' + esc_(s) + "</td></tr>"
    );
  }).join("");

  var html =
    '<div style="display:none;max-height:0;overflow:hidden">Your challenge, the schedule, how to find CAMPUS and the WhatsApp group.</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f5"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">' +
    // the header: the logo, who it is for, when and where
    '<tr><td style="background:#2e3141;background-image:linear-gradient(135deg,#454d84 0%,#2e3141 65%);padding:28px 28px 24px">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="64" valign="middle"><img src="' + SITE + '/images/favicon-2026.png" width="56" height="56" alt="BreaQ 2026" style="display:block;border:0;border-radius:12px"></td>' +
    '<td valign="middle" style="padding-left:16px">' + label("BreaQ Hackathon · tomorrow") +
    '<h1 style="' + font + 'margin:0;font-size:26px;line-height:1.2;font-weight:800;color:#ffffff">See you tomorrow, ' + esc_(first) + "!</h1></td>" +
    "</tr></table>" +
    p("Saturday 24 – Sunday 25 October · CAMPUS Research Institute, Bucharest", "margin:18px 0 0;font-size:14px;color:#c9cce0") +
    "</td></tr>" +
    '<tr><td style="padding:28px 28px 8px">' +
    p("We can’t wait to get together and meet you all. Here is everything for the weekend, in one place.", "margin:0 0 24px") +
    box(tint[1], challenge, "border-left:5px solid " + tint[0] + ";") +
    label("The schedule") + schedule + '<div style="height:28px;line-height:28px">&nbsp;</div>' +
    label("How to find us") +
    box(
      "#f5f6fa",
      p("📍 CAMPUS Research Institute", "font-size:17px;font-weight:700") +
        p("Splaiul Independenței 313, Bucharest", "font-size:14px;color:" + soft + ";margin:2px 0 14px") +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px">' + way + "</table>" +
        button(CAMPUS_MAP, "Open in Google Maps", "#4c5c96"),
    ) +
    box(
      "#fff4e5",
      p("💻 Bring your own laptop, and its charger", "font-size:16px;font-weight:700") +
        p("Meals and refreshments are on us.", "font-size:14px;color:" + soft + ";margin:4px 0 0"),
      "border-left:5px solid #ff8c00;",
    ) +
    box(
      "#e9f8ef",
      '<div style="text-align:center">' +
        p("Join the hackathon’s WhatsApp group", "font-size:17px;font-weight:700;margin:0 0 4px") +
        p("For everyone taking part this weekend.", "font-size:14px;color:" + soft + ";margin:0 0 16px") +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>' +
        button(WHATSAPP_GROUP || "https://chat.whatsapp.com/", "Join the group", "#1f9d55") +
        "</td></tr></table></div>",
    ) +
    p("Questions? Just reply to this email.", "color:#666;margin:0 0 16px") +
    p("See you tomorrow,<br>RoQTeam", "margin:0 0 28px") +
    "</td></tr>" +
    '<tr><td style="background:#f5f6fa;padding:14px 28px;' + font + 'font-size:12px;color:#8a8fa3">BreaQ 2026 · <a href="' + SITE +
    '/breaq-hackathon.html" style="color:#8a8fa3">roqteam.ro</a></td></tr>' +
    "</table></td></tr></table>";

  var text =
    "Hi " + first + ",\n\n" +
    "See you tomorrow at the BreaQ Hackathon! We can’t wait to get together and meet you all. Here is everything for the weekend, in one place.\n\n" +
    (track
      ? "YOUR CHALLENGE: " + track + "\nOne challenge each: if you ticked more than one, we picked yours from your preferences and the places left in each."
      : "YOUR CHALLENGE: you hear it at the kick-off, with everyone else.") +
    "\n\n" +
    EVE_SCHEDULE.map(function (d) {
      return d.day.toUpperCase() + "\n" + d.rows.map(function (row) { return (row[0] || "then") + "  " + row[1]; }).join("\n");
    }).join("\n\n") +
    "\n\nHOW TO FIND US\nCAMPUS Research Institute, Splaiul Independenței 313, Bucharest\nGoogle Maps: " + CAMPUS_MAP + "\n" +
    EVE_WAY.map(function (s, i) { return i + 1 + ". " + s; }).join("\n") +
    "\n\nBRING YOUR OWN LAPTOP, and its charger. Meals and refreshments are on us." +
    "\n\nThe hackathon’s WhatsApp group: " + WHATSAPP_GROUP +
    "\n\nQuestions? Just reply to this email.\n\nSee you tomorrow,\nRoQTeam";

  return { subject: "See you tomorrow at the BreaQ Hackathon 🚀", text: text, html: html };
}

/* --- on their own or in a team ------------------------------------------- */

// team-choice.html: { code } reads how the person takes part, { code, team, mates } changes it. The code is the
// dashboard's (dashboardCode_), which here opens any hackathon registration, decided or not.
function teamChoice_(data) {
  var fail = function (msg) {
    return { ok: false, action: "team-choice", error: msg };
  };
  var answer = data.team === undefined || data.team === null ? null : String(data.team);
  if (answer !== null && TEAM_ANSWERS.indexOf(answer) === -1)
    return fail("Choose one: on your own, with a team, or put in a team.");
  var names = answer === "team" ? teammates_(clean_(data.mates).slice(0, 200)) : [];
  if (answer === "team" && !names.length) return fail("Write your teammates’ names.");
  for (var n = 0; n < names.length; n++)
    if (nameProblem_(names[n]))
      return fail("Write just your teammates’ names, without links, digits or symbols.");
  var key = codeKey_(data.code);
  var lock = answer === null ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(10000);
  try {
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var row = -1;
    var r = null;
    for (var i = 1; key.length === 8 && i < values.length; i++) {
      var t = toRecord_(header, values[i]);
      if (eventKey_(t["Attends"]) !== "hackathon" || !String(t["Email"]).trim()) continue;
      if (codeKey_(dashboardCode_(t["Email"])) === key) {
        row = i + 1;
        r = t;
        break;
      }
    }
    if (row === -1) {
      Utilities.sleep(1500); // a wrong code costs time, so guessing does not pay
      return {
        ok: false,
        action: "team-choice",
        denied: true,
        error:
          "This link does not open a hackathon registration. Use the link in the email we sent you, or reply to that email.",
      };
    }
    // their own name among the teammates (people write the whole team) is not a teammate
    var own = nameKey_(r["First name"], r["Last name"]);
    names = names.filter(function (m) {
      return nameKey_(m, "") !== own;
    });
    if (answer === "team" && !names.length) return fail("Write your teammates’ names: the others in your team.");
    if (names.length > 2)
      return fail("A team has at most 3 people, you included: name two teammates at most.");
    var mates = names.join(", ");
    var was = String(r["Team"]).trim();
    var wasMates = String(r["Team name and members"]).trim();
    if (answer !== null && (was !== answer || wasMates !== mates)) {
      var before = [];
      if (was) before.push("Team: " + was);
      if (wasMates) before.push("Team name and members: " + wasMates);
      var entry =
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") +
        " · answered on the team page" +
        (before.length ? " · before: " + before.join("; ") : "");
      sheet.getRange(row, header.indexOf("Team") + 1).setValue(cellFor_("Team", answer));
      sheet
        .getRange(row, header.indexOf("Team name and members") + 1)
        .setValue(cellFor_("Team name and members", mates));
      if (header.indexOf("Merged") !== -1)
        sheet
          .getRange(row, header.indexOf("Merged") + 1)
          .setValue([r["Merged"], entry].filter(Boolean).join("\n"));
      was = answer;
      wasMates = mates;
    }
    if (answer !== null) sheet.getRange(row, header.indexOf("Team answered") + 1).setValue(new Date());
    return {
      ok: true,
      action: "team-choice",
      saved: answer !== null,
      me: {
        name: String(r["First name"]).trim(),
        team: was,
        mates: wasMates,
        tracks: listOf_(r["Tracks"]).filter(String),
        by: HACKING_BY,
      },
    };
  } finally {
    if (lock) lock.releaseLock();
  }
}

// run from the editor: who would get the Quantum Hacking teams email, with what the form says now. Sends nothing.
function previewHackingTeams() {
  hackingTeams_(false);
}

// run from the editor: emails each hackathon registration with the Quantum Hacking track, once
function sendHackingTeams() {
  hackingTeams_(true);
}

// run from the editor: the email to the account running it, as someone on their own and as someone with a team
function sendHackingTeamsSample() {
  var me = Session.getEffectiveUser().getEmail();
  var to = sampleTo_();
  [
    { name: "Ana", email: me, team: "solo", mates: "" },
    { name: "Ana", email: me, team: "team", mates: "Mihai Ionescu, Ioana Marin" },
  ].forEach(function (p) {
    var mail = renderEmail_(p.name, hackingTeamsEmail_(p));
    send_({
      to: to,
      subject: "[sample] " + mail.subject,
      body: mail.text,
      htmlBody: mail.html,
      name: SENDER_NAME,
      replyTo: REPLY_TO,
    });
  });
  Logger.log("Sent 2 sample emails to " + to);
}

// previewHackingTeams and sendHackingTeams: the hackathon registrations with the Quantum Hacking track, but the
// denied, that have not had the email yet (HACKING_SENT in "Emails"); stops as decisions_ does, at the day's
// emails and well before Apps Script's 6 minutes. Returns { sent, failed, before, left, stopped } for the tests.
function hackingTeams_(send) {
  var lock = send ? LockService.getDocumentLock() : null;
  if (lock && !lock.tryLock(2000)) {
    Logger.log("Someone else is sending emails from this script right now. Try again in a minute.");
    return null;
  }
  try {
    var started = Date.now();
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var col = header.indexOf("Emails") + 1;
    var stamp = function () {
      return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
    };
    var due = [];
    var before = 0;
    var denied = 0;
    for (var i = 1; i < values.length; i++) {
      var r = toRecord_(header, values[i]);
      if (eventKey_(r["Attends"]) !== "hackathon") continue;
      if (listOf_(r["Tracks"]).indexOf("Quantum Hacking") === -1) continue;
      if (String(r["Decision"]).trim().toLowerCase() === "denied") {
        denied++;
        continue;
      }
      if (String(r["Emails"]).indexOf(HACKING_SENT) !== -1) {
        before++;
        continue;
      }
      due.push({ row: i + 1, r: r, name: String(r["First name"] + " " + r["Last name"]).trim() });
    }
    var reserve = reserve_();
    var sent = 0;
    var failed = 0;
    var stopped = "";
    due.forEach(function (d) {
      var p = {
        name: String(d.r["First name"]).trim(),
        email: String(d.r["Email"]).trim(),
        team: String(d.r["Team"]).trim(),
        mates: String(d.r["Team name and members"]).trim(),
      };
      var now =
        p.team === "team"
          ? "with " + (p.mates || "a team")
          : p.team === "match"
            ? "to be put in a team"
            : p.team === "solo"
              ? "on their own"
              : "not asked yet";
      if (!send) {
        Logger.log("Row " + d.row + " · " + d.name + " <" + p.email + "> · now: " + now + " · to send");
        return;
      }
      if (stopped) return;
      var left = emailsLeft_();
      if (left !== null && left <= reserve) stopped = "quota";
      else if (Date.now() - started > 4.5 * 60 * 1000) stopped = "time";
      if (stopped) return;
      var mail = renderEmail_(p.name, hackingTeamsEmail_(p));
      var note;
      try {
        var via = send_({
          to: p.email,
          subject: mail.subject,
          body: mail.text,
          htmlBody: mail.html,
          name: SENDER_NAME,
          replyTo: REPLY_TO,
        });
        note = HACKING_SENT + " " + stamp() + " via " + via;
        sent++;
      } catch (err) {
        note = "Quantum Hacking teams email FAILED " + stamp() + ": " + err;
        failed++;
      }
      var had = String(d.r["Emails"]).trim();
      sheet.getRange(d.row, col).setValue(cellFor_("Emails", (had ? had + "; " : "") + note));
      Logger.log("Row " + d.row + " · " + d.name + " <" + p.email + "> · now: " + now + " · " + note);
    });
    var waiting = due.length - sent - failed;
    var rest = ", " + before + " sent before" + (denied ? ", " + denied + " denied left out" : "");
    Logger.log(
      send
        ? sent + " sent, " + failed + " failed" + rest +
            (stopped === "quota"
              ? (reserve
                  ? ". Stopped with " + reserve + " emails left for today, kept for new registrations"
                  : ". Stopped: today's emails are used up") +
                ": run sendHackingTeams again tomorrow for the other " + waiting + "."
              : stopped === "time"
                ? ". Stopped before Apps Script's time limit: run sendHackingTeams again for the other " + waiting + "."
                : failed
                  ? ". Run sendHackingTeams again to retry the failed ones."
                  : "")
        : due.length + " to send" + rest + ". Run sendHackingTeams to send them.",
    );
    return { sent: sent, failed: failed, before: before, denied: denied, left: send ? waiting : due.length, stopped: stopped };
  } finally {
    if (lock) lock.releaseLock();
  }
}

// The Quantum Hacking email. p: { name, email (the button carries that email's code), team, mates: what the form
// says now }. Change the wording here; sendHackingTeamsSample shows the result.
function hackingTeamsEmail_(p) {
  var now =
    p.team === "team" && p.mates
      ? "On the form you named your teammates: " + p.mates + ". If that still holds, there is nothing to do."
      : p.team === "match"
        ? "On the form you asked us to put you in a team, and we will: there is nothing to do."
        : p.team === "solo"
          ? "On the form you are down as taking part on your own."
          : "";
  return {
    subject: "BreaQ Hackathon: a small change to Quantum Hacking",
    heading: "A small change to Quantum Hacking, " + p.name + ".",
    paras: [
      "You registered for the BreaQ Hackathon with the Quantum Hacking track. This email is not about your application: we are still reading them all, and our decision reaches you in a separate email. We are only writing because we have changed the challenge’s format a little.",
      "Quantum Hacking can now be done in teams as well, of up to 3 people, you included. So you choose: take part on your own, or in a team, either with people you already know or with other participants we put you with.",
      now,
      "Tell us which by " + HACKING_BY + ", with the button below: it takes a minute.",
      "Coming with teammates? Each of them registers too, on " +
        SITE +
        "/register, with their own motivation letter, by " +
        HACKING_BY +
        ". Write their names as they write them on their own registrations, so that we read your applications together.",
    ].filter(String),
    button: { label: "On my own or in a team", href: TEAM_PAGE + "#code=" + dashboardCode_(p.email) },
    sign: "Thank you,",
  };
}

// run from the editor: who would get the teammates reminder, and which of their teammates are missing. Sends nothing.
function previewTeammatesReminder() {
  teammatesReminder_(false);
}

// run from the editor: reminds each hackathon registration with a teammate not registered yet, once
function sendTeammatesReminder() {
  teammatesReminder_(true);
}

// run from the editor: the email to the account running it, one teammate missing and then two, one of them
// registered for the conference only
function sendTeammatesReminderSample() {
  var me = Session.getEffectiveUser().getEmail();
  var to = sampleTo_();
  [
    { name: "Ana", email: me, mates: ["Mihai Ionescu"], missing: ["Mihai Ionescu"], conference: [] },
    {
      name: "Ana",
      email: me,
      mates: ["Mihai Ionescu", "Ioana Marin"],
      missing: ["Mihai Ionescu", "Ioana Marin"],
      conference: ["Ioana Marin"],
    },
  ].forEach(function (p) {
    var mail = renderEmail_(p.name, teammatesReminderEmail_(p));
    send_({
      to: to,
      subject: "[sample] " + mail.subject,
      body: mail.text,
      htmlBody: mail.html,
      name: SENDER_NAME,
      replyTo: REPLY_TO,
    });
  });
  Logger.log("Sent 2 sample emails to " + to);
}

// previewTeammatesReminder and sendTeammatesReminder: the hackathon registrations, but the denied, that came with
// a team ("Team" is team) and named someone with no hackathon registration under that name, and that have not
// had the reminder yet (MATES_SENT in "Emails"); stops as hackingTeams_ does. Returns { sent, failed, before,
// denied, left, stopped } for the tests.
function teammatesReminder_(send) {
  var lock = send ? LockService.getDocumentLock() : null;
  if (lock && !lock.tryLock(2000)) {
    Logger.log("Someone else is sending emails from this script right now. Try again in a minute.");
    return null;
  }
  try {
    var started = Date.now();
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var col = header.indexOf("Emails") + 1;
    var stamp = function () {
      return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
    };
    // the names on the conference's registrations: a teammate there only may have used the wrong form
    var conference = {};
    for (var c = 1; c < values.length; c++) {
      var t = toRecord_(header, values[c]);
      if (eventKey_(t["Attends"]) === "conference") conference[nameKey_(t["First name"], t["Last name"])] = true;
    }
    var due = [];
    var before = 0;
    var denied = 0;
    for (var i = 1; i < values.length; i++) {
      var r = toRecord_(header, values[i]);
      if (eventKey_(r["Attends"]) !== "hackathon" || String(r["Team"]).trim() !== "team") continue;
      var p = person_(values, header, r);
      var team = teamOf_(values, header, p.mates, r);
      var missing = team
        .filter(function (m) {
          return m.decision === null;
        })
        .map(function (m) {
          return m.name;
        });
      if (!missing.length) continue;
      if (String(r["Decision"]).trim().toLowerCase() === "denied") {
        denied++;
        continue;
      }
      if (String(r["Emails"]).indexOf(MATES_SENT) !== -1) {
        before++;
        continue;
      }
      p.missing = missing;
      p.here = team
        .filter(function (m) {
          return m.decision !== null;
        })
        .map(function (m) {
          return m.name;
        });
      p.conference = missing.filter(function (m) {
        return conference[nameKey_(m, "")];
      });
      due.push({ row: i + 1, r: r, p: p, name: String(r["First name"] + " " + r["Last name"]).trim() });
    }
    var reserve = reserve_();
    var sent = 0;
    var failed = 0;
    var stopped = "";
    due.forEach(function (d) {
      var p = d.p;
      var what =
        "missing: " +
        p.missing
          .map(function (m) {
            return m + (p.conference.indexOf(m) !== -1 ? " (conference only)" : "");
          })
          .join(", ");
      if (!send) {
        Logger.log("Row " + d.row + " · " + d.name + " <" + p.email + "> · " + what + " · to send");
        return;
      }
      if (stopped) return;
      var left = emailsLeft_();
      if (left !== null && left <= reserve) stopped = "quota";
      else if (Date.now() - started > 4.5 * 60 * 1000) stopped = "time";
      if (stopped) return;
      var mail = renderEmail_(p.name, teammatesReminderEmail_(p));
      var note;
      try {
        var via = send_({
          to: p.email,
          subject: mail.subject,
          body: mail.text,
          htmlBody: mail.html,
          name: SENDER_NAME,
          replyTo: REPLY_TO,
        });
        note = MATES_SENT + " " + stamp() + " via " + via;
        sent++;
      } catch (err) {
        note = "Teammates reminder FAILED " + stamp() + ": " + err;
        failed++;
      }
      var had = String(d.r["Emails"]).trim();
      sheet.getRange(d.row, col).setValue(cellFor_("Emails", (had ? had + "; " : "") + note));
      Logger.log("Row " + d.row + " · " + d.name + " <" + p.email + "> · " + what + " · " + note);
    });
    var waiting = due.length - sent - failed;
    var rest = ", " + before + " reminded before" + (denied ? ", " + denied + " denied left out" : "");
    Logger.log(
      send
        ? sent + " sent, " + failed + " failed" + rest +
            (stopped === "quota"
              ? (reserve
                  ? ". Stopped with " + reserve + " emails left for today, kept for new registrations"
                  : ". Stopped: today's emails are used up") +
                ": run sendTeammatesReminder again tomorrow for the other " + waiting + "."
              : stopped === "time"
                ? ". Stopped before Apps Script's time limit: run sendTeammatesReminder again for the other " + waiting + "."
                : failed
                  ? ". Run sendTeammatesReminder again to retry the failed ones."
                  : "")
        : due.length + " to send" + rest + ". Run sendTeammatesReminder to send them.",
    );
    return { sent: sent, failed: failed, before: before, denied: denied, left: send ? waiting : due.length, stopped: stopped };
  } finally {
    if (lock) lock.releaseLock();
  }
}

// The teammates reminder. p: { name, email (the button carries that email's code), mates (every teammate they
// named), missing (those with no hackathon registration under that name), here (those registered, when known),
// conference (of the missing, those registered for the conference) }. Change the wording here;
// sendTeammatesReminderSample shows the result.
function teammatesReminderEmail_(p) {
  var one = p.missing.length === 1;
  var here =
    p.here ||
    p.mates.filter(function (m) {
      return p.missing.indexOf(m) === -1;
    });
  return {
    subject: "BreaQ Hackathon: your team" + (one ? "mate has" : "mates have") + " not registered yet",
    heading: "Your team is not complete yet, " + p.name + ".",
    paras: [
      "On your BreaQ Hackathon registration you named your " +
        (p.mates.length === 1 ? "teammate: " : "teammates: ") +
        and_(p.mates) +
        ". " +
        (here.length ? and_(here) + (here.length === 1 ? " has" : " have") + " registered, but we" : "We") +
        " have no registration from " +
        and_(p.missing) +
        " yet.",
      "Each teammate registers on their own, on " +
        SITE +
        "/register, with their own motivation letter, by " +
        HACKING_BY +
        ", and writes your name among their teammates, so that we read your applications together.",
      p.conference.length
        ? and_(p.conference) +
          (p.conference.length === 1 ? " is" : " are") +
          " registered for the conference only: the hackathon has its own form, the one above."
        : "",
      "Did " +
        (one ? "they" : "some of them") +
        " register under a name written differently? Use the button below to correct the names.",
      // a teammate named on the form who has since dropped out: the team can change without them
      "If " +
        (one ? p.missing[0] + " is" : "any of them are") +
        " no longer taking part, that is fine: you can change your team with the same button, by " +
        HACKING_BY +
        ". Take " +
        (one ? "them" : "off whoever is not coming") +
        (one ? " off" : "") +
        (here.length ? " and stay with " + and_(here) : "") +
        ", take part on your own, or ask us to put you in a team with other participants.",
      "This email is not about your application: we are still reading them all, and our decision reaches you in a separate email.",
    ].filter(String),
    button: { label: "Check my team", href: TEAM_PAGE + "#code=" + dashboardCode_(p.email) },
    sign: "Thank you,",
  };
}

// a registration as the sheet's columns, each value as the person sent it (cellFor_ makes it safe for the sheet)
function record_(data, email) {
  return {
    Timestamp: new Date(),
    "First name": clean_(data.first_name),
    "Last name": clean_(data.last_name),
    Email: email,
    Phone: clean_(data.phone),
    "University or company": clean_(data.affiliation),
    Status: clean_(data.status),
    Experience: clean_(data.experience),
    "T-shirt": clean_(data.tshirt),
    Attends: clean_(data.attend),
    Tracks: clean_((data.tracks || []).join(", ")),
    Team: TEAM_ANSWERS.indexOf(clean_(data.team)) !== -1 ? clean_(data.team) : "",
    "Team name and members": clean_(data.team_name),
    Motivation: clean_(data.motivation),
    Dietary: clean_(data.dietary),
    "Heard from": clean_(data.source),
    Consent: data.consent ? "yes" : "no",
    Conduct: data.conduct ? "yes" : "no",
    "Seconds on page": Number(data.seconds_on_page) || "",
    Page: clean_(data.page),
  };
}

// everything a visitor typed goes through cell_, so the sheet keeps it as text. The log in "Merged" keeps its
// line breaks, and columns the team added to the sheet by hand are written back as they were.
function cellFor_(col, v) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || col === "Merged" || COLUMNS.indexOf(col) === -1)
    return v;
  return cell_(v);
}

function header_(values) {
  return values[0].map(function (h) {
    return String(h).trim();
  });
}

function toRecord_(header, row) {
  var rec = {};
  header.forEach(function (col, j) {
    rec[col] = row[j] === undefined || row[j] === null ? "" : row[j];
  });
  return rec;
}

// the row a registration belongs to, among rows 1 to upTo - 1 not in skip: the same event and one of the same
// emails, or failing that the same name. { index, by: "email" | "name" }, or null
function findMatch_(values, header, rec, upTo, skip) {
  var ev = eventKey_(rec["Attends"]);
  var emails = emailsOf_(rec);
  var name = nameKey_(rec["First name"], rec["Last name"]);
  var byName = null;
  for (var i = 1; i < upTo; i++) {
    if (skip[i]) continue;
    var r = toRecord_(header, values[i]);
    if (eventKey_(r["Attends"]) !== ev) continue;
    var theirs = emailsOf_(r);
    var shared = emails.some(function (e) {
      return theirs.indexOf(e) !== -1;
    });
    if (shared) return { index: i, by: "email" };
    if (!byName && name && nameKey_(r["First name"], r["Last name"]) === name)
      byName = { index: i, by: "name" };
  }
  return byName;
}

// "presentations" is the older name of the conference (as in event_)
function eventKey_(attend) {
  attend = String(attend).trim();
  return attend === "conference" || attend === "presentations"
    ? "conference"
    : "hackathon";
}

// a name however it is written: "Ana-Maria Popescu", "POPESCU Ana Maria" and "Ana Maria Popescu" are one name
function nameKey_(first, last) {
  return (String(first) + " " + String(last))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(String)
    .sort()
    .join(" ");
}

// the row's emails in lower case, the one in "Email" first
function emailsOf_(rec) {
  return unique_(
    [rec["Email"]].concat(String(rec["Other emails"] || "").split(/[,;\s]+/)),
  ).map(function (e) {
    return e.toLowerCase();
  });
}

// "Quantum AI, Quantum Hacking" -> ["Quantum AI", "Quantum Hacking"]
function listOf_(v) {
  return String(v || "").split(/\s*,\s*/);
}

function unique_(list) {
  var seen = {};
  return list
    .map(function (s) {
      return String(s || "").trim();
    })
    .filter(function (s) {
      var k = s.toLowerCase();
      if (!s || seen[k]) return false;
      return (seen[k] = true);
    });
}

// a second application on top of the row already there: { rec, changed }. See "Applying twice" at the top.
function merge_(header, older, newer, by) {
  var has = function (v) {
    return v !== undefined && v !== null && v !== "";
  };
  var rec = {};
  header.forEach(function (col) {
    var keep = ORGANISER_COLUMNS.indexOf(col) !== -1 && has(older[col]);
    rec[col] = has(newer[col]) && !keep ? newer[col] : older[col];
  });
  rec["Timestamp"] = older["Timestamp"] || newer["Timestamp"];
  // what each was emailed, the earlier row's first
  if (has(newer["Emails"])) rec["Emails"] = emailsWith_(String(older["Emails"] || ""), String(newer["Emails"]));
  // the same name written another way ("ana maria POPESCU") keeps the first spelling
  if (
    nameKey_(older["First name"], older["Last name"]) ===
    nameKey_(newer["First name"], newer["Last name"])
  ) {
    rec["First name"] = older["First name"];
    rec["Last name"] = older["Last name"];
  }
  var emails = unique_(emailsOf_(newer).concat(emailsOf_(older)));
  rec["Email"] = emails[0] || "";
  rec["Other emails"] = emails.slice(1).join(", ");
  rec["Tracks"] = unique_(
    listOf_(older["Tracks"]).concat(listOf_(newer["Tracks"])),
  ).join(", ");
  // the team question and the teammates go together: "on my own" clears the teammates named before
  if (newer["Team"]) rec["Team name and members"] = newer["Team name and members"];

  var changed = false;
  var before = [];
  header.forEach(function (col) {
    if (NOT_ANSWERS.indexOf(col) !== -1) return;
    var was = String(older[col]);
    if (was === String(rec[col])) return;
    changed = true;
    if (was && col !== "Email" && col !== "Other emails")
      before.push(col + ": " + was);
  });

  // the later row's grades or decision where the earlier row has its own: logged, not lost
  var aside = ORGANISER_COLUMNS.filter(function (col) {
    return has(newer[col]) && String(newer[col]) !== String(rec[col]);
  }).map(function (col) {
    return col + ": " + newer[col];
  });

  var when = newer["Timestamp"] instanceof Date ? newer["Timestamp"] : new Date();
  var entry =
    Utilities.formatDate(when, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") +
    " · applied again" +
    (by === "hand"
      ? " as " + newer["Email"] + " (merged by hand)"
      : by === "name"
        ? " as " + newer["Email"] + " (same name, another email)"
        : " (same email)") +
    (before.length ? " · before: " + before.join("; ") : "") +
    (aside.length ? " · its own, set aside for the earlier row's: " + aside.join("; ") : "");
  rec["Merged"] = [older["Merged"], newer["Merged"], entry]
    .filter(Boolean)
    .join("\n");
  // the same name kept apart as maybe someone else (⚠): settled, once merged as one person
  if (by !== "email") rec["Merged"] = rec["Merged"].replace(/^⚠ /gm, "");
  return { rec: rec, changed: changed, by: by, before: before };
}

// writes the cells of a row that a merge changed, and leaves the rest (formulas included) alone
function writeMerged_(sheet, row, header, older, rec) {
  header.forEach(function (col, j) {
    if (String(older[col]) === String(rec[col])) return;
    sheet.getRange(row, j + 1).setValue(cellFor_(col, rec[col]));
  });
}

// whether a letter link in the sheet points at this same PDF
function sameLetter_(url, bytes) {
  var id = (String(url).match(/\/d\/([-\w]{20,})/) || [])[1];
  if (!id) return false;
  try {
    return (
      digest_(DriveApp.getFileById(id).getBlob().getBytes()) === digest_(bytes)
    );
  } catch (err) {
    return false;
  }
}

function digest_(bytes) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes),
  );
}

// admin.html: every row of the sheet, the header row first, for whoever sends the admin key
function list_(key) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = sheet_(); // with the headers of any column added since the sheet was made
  var values = sheet.getDataRange().getValues();
  // the dashboard code of each accepted participant, by email, for the admin page's full view
  var header = header_(values);
  var codes = {};
  values.slice(1).forEach(function (row) {
    var r = toRecord_(header, row);
    if (accepted_(r)) codes[String(r["Email"]).trim().toLowerCase()] = dashboardCode_(r["Email"]);
  });
  var tpl = null;
  try {
    tpl = certTemplate_();
  } catch (err) {} // Drive not reachable: the page says there is no template, never fails the list
  return {
    ok: true,
    columns: values[0],
    rows: values.slice(1), // dates arrive as ISO strings
    codes: codes,
    teams: teamsList_(),
    audience: audienceOrNull_(),
    screenKey: screenKey_(),
    flash: flashOf_(),
    mentors: { key: mentorKey_(false), page: MENTORS_PAGE },
    feedback: feedbackRows_(),
    activity: activity_(),
    certificate: tpl ? tpl.getUrl() : "",
    sheet: ss.getUrl(),
    // who is reading, by their key ("" for the admin key), and who votes: the page shows the votes and theirs
    voter: voterOf_(key),
    voters: VOTERS,
    majority: MAJORITY,
    grades: { min: GRADE_MIN, max: GRADE_MAX, accept: ACCEPT_FROM, waitlist: WAITLIST_FROM },
    emailsLeft: emailsLeft_(),
    at: new Date(),
  };
}

// the team dashboard in numbers, for the admin page's Edition in numbers: what the organisers posted, and what the
// mentors answered and how fast (the median minutes from a request to a mentor on the way). Never fails the list.
function activity_() {
  var out = { announcements: 0, resources: 0, requests: 0, answered: 0, medianWait: null };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var board = ss.getSheetByName(BOARD_SHEET);
    if (board && board.getLastRow() > 1)
      boardItems_(board.getDataRange().getValues()).forEach(function (it) {
        if (it.section === "announcement") out.announcements++;
        if (it.section === "resource") out.resources++;
      });
    var queue = ss.getSheetByName(QUEUE_SHEET);
    if (queue && queue.getLastRow() > 1) {
      var values = queue.getDataRange().getValues();
      var header = header_(values);
      var waits = [];
      values.slice(1).forEach(function (row) {
        var r = toRecord_(header, row);
        if (!isDate_(r["Asked"])) return;
        out.requests++;
        var status = String(r["Status"]).trim().toLowerCase();
        if (status === "taken" || status === "done") out.answered++;
        if (isDate_(r["Taken"])) waits.push((r["Taken"].getTime() - r["Asked"].getTime()) / 60000);
      });
      waits.sort(function (x, y) {
        return x - y;
      });
      if (waits.length) out.medianWait = Math.round(waits[Math.floor((waits.length - 1) / 2)]);
    }
  } catch (err) {
    console.error("activity_ failed: " + err);
  }
  return out;
}

// the admin key or a voter's own key: null when it is one of them, else the answer to send back
function checkKey_(key) {
  var expected =
    PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  if (expected && String(key || "") === expected) return null;
  if (voterOf_(key)) return null;
  if (!expected && !voterKeysMade_())
    return {
      ok: false,
      denied: true,
      error:
        "There is no admin key yet: run adminKey (or voterKeys) once in the Apps Script editor.",
    };
  Utilities.sleep(1500); // a wrong key costs time, so guessing does not pay
  return { ok: false, denied: true, error: "That key is not right." };
}

// the shared admin key votes as the organiser who says it is them (data.as, one of VOTERS): only the five have
// it, and they trust each other. A personal key always votes as its own.
function sharedAs_(data) {
  var admin = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  var as = String(data.as || "").trim();
  return admin && String(data.key || "") === admin && VOTERS.indexOf(as) !== -1 ? as : "";
}

function voterKeysMade_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  return VOTERS.some(function (v) {
    return !!props["VOTE_KEY_" + v.toUpperCase()];
  });
}

// admin.html: the decision for hackathon registrations, each found by one of its emails; "" takes it back.
// Sends nothing: the emails go out with sendDecisions or the page's Send button.
function decide_(data) {
  var decision = String(data.decision || "")
    .trim()
    .toLowerCase();
  if (decision && DECISIONS.indexOf(decision) === -1)
    return { ok: false, action: "decide", error: "Not a decision: " + decision };
  var emails = emailsOf_({ Email: "", "Other emails": [].concat(data.emails || []).join(",") });
  if (!emails.length)
    return { ok: false, action: "decide", error: "No registration given." };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var col = header.indexOf("Decision") + 1;
    var set = [];
    var missing = [];
    emails.forEach(function (email) {
      for (var i = 1; i < values.length; i++) {
        var r = toRecord_(header, values[i]);
        if (
          eventKey_(r["Attends"]) === "hackathon" &&
          emailsOf_(r).indexOf(email) !== -1
        ) {
          sheet.getRange(i + 1, col).setValue(decision);
          set.push({ email: email, decision: decision });
          return;
        }
      }
      missing.push(email);
    });
    rosterChanged_(); // the dashboard's access follows the decision at once
    return { ok: true, action: "decide", set: set, missing: missing };
  } finally {
    lock.releaseLock();
  }
}

// admin.html: the track given to hackathon registrations, each found by one of its emails: one of the CHALLENGES,
// or "" to take it back. Sends nothing.
function track_(data) {
  var track = clean_(data.track);
  var known = CHALLENGES.filter(function (c) {
    return c.toLowerCase() === track.toLowerCase();
  })[0];
  if (track && !known) return { ok: false, action: "track", error: "Not a track: " + track };
  track = known || "";
  var emails = emailsOf_({ Email: "", "Other emails": [].concat(data.emails || []).join(",") });
  if (!emails.length) return { ok: false, action: "track", error: "No registration given." };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheet_(); // with the column, the first time
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var col = header.indexOf("Hackathon track") + 1;
    var set = [];
    var missing = [];
    emails.forEach(function (email) {
      var row = regRow_(values, header, email);
      if (row === -1) {
        missing.push(email);
        return;
      }
      sheet.getRange(row, col).setValue(track);
      set.push({ email: email, track: track });
    });
    return { ok: true, action: "track", set: set, missing: missing };
  } finally {
    lock.releaseLock();
  }
}

// admin.html: accepted participants' dashboard codes off ({ emails, off: true }) or on again ({ emails, off: false }).
// Their Decision stays as it is, and so does the code itself: on again, it works as before. Sends nothing.
function access_(data) {
  var emails = emailsOf_({ Email: "", "Other emails": [].concat(data.emails || []).join(",") });
  if (!emails.length) return { ok: false, action: "access", error: "No registration given." };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheet_(); // with the column, the first time
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var col = header.indexOf("Code off") + 1;
    var since = data.off ? new Date() : "";
    var set = [];
    var missing = [];
    emails.forEach(function (email) {
      var row = regRow_(values, header, email);
      if (row === -1) {
        missing.push(email);
        return;
      }
      sheet.getRange(row, col).setValue(since);
      set.push({ email: email, off: since });
    });
    rosterChanged_(); // the dashboard follows at once
    return { ok: true, action: "access", set: set, missing: missing };
  } finally {
    lock.releaseLock();
  }
}

// a code the organisers turned off (access_)
function codeOff_(r) {
  return String(r["Code off"] === undefined || r["Code off"] === null ? "" : r["Code off"]).trim() !== "";
}

// admin.html: one organiser's grade on hackathon registrations, each found by one of its emails: a whole number from
// GRADE_MIN to GRADE_MAX, or "" to take it back. Only a voter's own key votes, in their column. A grade that changes
// what the average says (outcome_) sets the Decision (accepted, waitlist, denied, or undecided again); any other
// leaves it as it is, so a decision made by hand stays until then. Sends nothing. Answers each registration's grades
// and Decision as they are now, with everyone's grades, for the page to show. "vote" is one grade for all the emails
// given ({ emails, vote, note? }); "votes" is the reading mode's grades, sent together ({ items: [{ emails, vote, note }] }).
function vote_(data) {
  var action = data.action === "votes" ? "votes" : "vote";
  var voter = voterOf_(data.key) || sharedAs_(data);
  if (!voter)
    return {
      ok: false,
      action: action,
      error: "Say who you are first: the admin page asks when it is opened with the shared key.",
    };
  var items = action === "votes" ? [].concat(data.items || []) : [{ emails: data.emails, vote: data.vote, note: data.note }];
  for (var k = 0; k < items.length; k++) {
    items[k] = {
      emails: emailsOf_({ Email: "", "Other emails": [].concat(items[k].emails || []).join(",") }),
      vote: String(items[k].vote || "").trim(),
      note: items[k].note,
    };
    if (items[k].vote && !gradeOf_(items[k].vote))
      return { ok: false, action: action, error: "Not a grade from " + GRADE_MIN + " to " + GRADE_MAX + ": " + items[k].vote };
    items[k].vote = gradeOf_(items[k].vote) || "";
    if (!items[k].emails.length) return { ok: false, action: action, error: "No registration given." };
  }
  if (!items.length) return { ok: false, action: action, error: "No registration given." };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    voteList_(sheet, header);
    var mine = header.indexOf("Vote " + voter);
    var note = header.indexOf("Note " + voter);
    var dec = header.indexOf("Decision");
    // whatever rule the note column has (a dropdown it got by mistake) would refuse the note
    var noting = note !== -1 && items.some(function (it) { return clean_(it.note); });
    if (noting && sheet.getMaxRows() > 1 && sheet.getRange(2, note + 1).getDataValidation()) {
      sheet.getRange(2, note + 1, sheet.getMaxRows() - 1, 1).clearDataValidations();
      console.log("vote_: took the rule off Note " + voter);
    }
    // each email's hackathon row, read once for all the votes
    var rowOf = {};
    var records = [];
    for (var i = 1; i < values.length; i++) {
      var rec = (records[i] = toRecord_(header, values[i]));
      if (eventKey_(rec["Attends"]) !== "hackathon") continue;
      emailsOf_(rec).forEach(function (e) {
        if (!(e in rowOf)) rowOf[e] = i;
      });
    }
    var set = [];
    var missing = [];
    var decided = false;
    items.forEach(function (item) {
      item.emails.forEach(function (email) {
        if (!(email in rowOf)) {
          missing.push(email);
          return;
        }
        var i = rowOf[email];
        var r = records[i];
        var before = outcome_(r);
        values[i][mine] = r["Vote " + voter] = item.vote;
        sheet.getRange(i + 1, mine + 1).setValue(item.vote);
        // the note comes with a vote from the reading mode; a vote from the table leaves it as it is
        if (item.note !== undefined && note !== -1) {
          var text = clean_(item.note).replace(/\s+/g, " ").slice(0, NOTE_MAX);
          values[i][note] = r["Note " + voter] = text;
          sheet.getRange(i + 1, note + 1).setValue(cellFor_("Note " + voter, text));
        }
        var after = outcome_(r);
        if (after !== before) {
          values[i][dec] = r["Decision"] = after;
          sheet.getRange(i + 1, dec + 1).setValue(after);
          decided = true;
        }
        var votes = {};
        var notes = {};
        VOTERS.forEach(function (v) {
          votes[v] = voteOf_(r, v) || "";
          notes[v] = String(r["Note " + v] || "").trim();
        });
        set.push({ email: email, votes: votes, notes: notes, decision: String(r["Decision"]).trim().toLowerCase() });
      });
    });
    // saved now, so that a write the sheet refuses fails here, with its reason, rather than after the answer (the
    // page would only see Google's error page)
    SpreadsheetApp.flush();
    if (decided) rosterChanged_(); // the dashboard's access follows the decision at once
    return { ok: true, action: action, voter: voter, set: set, missing: missing };
  } finally {
    lock.releaseLock();
  }
}

// the vote columns' rule as voteColumns_ says, once after it changes (the grades came after yes, no and waitlist): the
// old dropdown would refuse a grade
function voteList_(sheet, header) {
  var props = PropertiesService.getScriptProperties();
  var rule = "grades " + GRADE_MIN + "-" + GRADE_MAX;
  if (props.getProperty("VOTE_LIST") === rule) return;
  voteColumns_(sheet, header, VOTE_COLUMNS);
  props.setProperty("VOTE_LIST", rule);
}

// the admin page's reading mode: one hackathon registration's motivation letter, the PDF itself in base64, so
// that the organisers read it in the page without access to the Drive folder. { email } -> { ok, email, name,
// data } or, without a letter in Drive, { ok, email, none: why }
function letter_(data) {
  var email = String(data.email || "").trim().toLowerCase();
  var values = sheet_().getDataRange().getValues();
  var header = header_(values);
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    if (eventKey_(r["Attends"]) !== "hackathon" || emailsOf_(r).indexOf(email) === -1) continue;
    var url = String(r["Motivation letter"]).trim();
    var id = /\/d\/([\w-]{20,})/.exec(url) || /[?&]id=([\w-]{20,})/.exec(url);
    if (!id)
      return {
        ok: true,
        action: "letter",
        email: email,
        none: url ? "The letter did not reach Drive (" + url + ")." : "There is no letter in this registration.",
      };
    var file = DriveApp.getFileById(id[1]);
    return {
      ok: true,
      action: "letter",
      email: email,
      name: file.getName(),
      data: Utilities.base64Encode(file.getBlob().getBytes()),
    };
  }
  return { ok: false, action: "letter", error: "The sheet has no hackathon registration for " + email + " any more. Refresh the page." };
}

// a whole grade from GRADE_MIN to GRADE_MAX, or 0 for anything else (empty, a word, 7.5)
function gradeOf_(x) {
  var s = String(x === undefined || x === null ? "" : x).trim();
  var n = /^\d+$/.test(s) ? Number(s) : 0;
  return n >= GRADE_MIN && n <= GRADE_MAX ? n : 0;
}

// the voter's grade, 0 while they have not graded
function voteOf_(r, voter) {
  return gradeOf_(r["Vote " + voter]);
}

// what the grades add up to: "" before MAJORITY of them, then by their average "accepted" (ACCEPT_FROM or more),
// "waitlist" (WAITLIST_FROM or more) or "denied"
function outcome_(r) {
  var n = 0;
  var sum = 0;
  VOTERS.forEach(function (v) {
    var x = voteOf_(r, v);
    if (x) {
      n++;
      sum += x;
    }
  });
  if (n < MAJORITY) return "";
  var avg = sum / n;
  return avg >= ACCEPT_FROM ? "accepted" : avg >= WAITLIST_FROM ? "waitlist" : "denied";
}

/* --- the team dashboard ------------------------------------------------- */

// a hackathon registration with the decision "accepted": the people the team dashboard is for
function accepted_(r) {
  return (
    eventKey_(r["Attends"]) === "hackathon" &&
    String(r["Decision"]).trim().toLowerCase() === "accepted"
  );
}

// the secret the dashboard codes are made with, made on first use. Deleting TEAM_SECRET in the script properties
// changes every code, including those in the acceptance emails already sent: only for a leak.
function codeSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty("TEAM_SECRET");
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty("TEAM_SECRET", secret);
  }
  return secret;
}

// someone's dashboard code: eight letters and digits in two groups, without 0/O, 1/I/L, the same for the same
// email every time (so it needs no column), and not guessable without the secret
function dashboardCode_(email) {
  var abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  var bytes = Utilities.computeHmacSha256Signature(
    String(email || "").trim().toLowerCase(),
    codeSecret_(),
  );
  var code = "";
  for (var i = 0; i < 8; i++) code += abc.charAt(((bytes[i] + 256) % 256) % abc.length);
  return code.slice(0, 4) + "-" + code.slice(4);
}

// "abcd efgh", "ABCD-EFGH" and "abcdefgh" are the same code
function codeKey_(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

// The accepted participants as the dashboard needs them: who each code opens it for (one code per email they
// registered with, so an email changed by a second application keeps the old code working), their team, their
// answer to "are you coming?", their check-in. Kept a minute in the cache; whatever changes one of these clears it
// (rosterChanged_), so a change of decision, say, counts at once.
//   { codes: { codeKey: i }, people: [{ name, email, team, coming, checkedIn, certificate }],
//     teams: { lower-case name: { name, challenge, table, pitch, room, award, members: [names] } },
//     off: { codeKey: true } (the codes turned off, access_) }
function roster_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("roster");
  if (hit) return JSON.parse(hit);
  var values = sheet_().getDataRange().getValues();
  var header = header_(values);
  var out = { codes: {}, people: [], teams: {}, off: {} };
  teamsList_().forEach(function (t) {
    out.teams[t.name.toLowerCase()] = merged_(t, { members: [] });
  });
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    if (!accepted_(r)) continue;
    if (codeOff_(r)) {
      emailsOf_(r).forEach(function (email) {
        out.off[codeKey_(dashboardCode_(email))] = true;
      });
      continue;
    }
    var p = {
      name: String(r["First name"] + " " + r["Last name"]).trim(),
      email: String(r["Email"]).trim().toLowerCase(),
      team: String(r["Hackathon team"]).trim(),
      coming: comingOf_(r["Coming"]),
      checkedIn: isDate_(r["Checked in"]) ? r["Checked in"] : null,
      certificate: /^sent/i.test(String(r["Certificate"])),
    };
    var at = out.people.push(p) - 1;
    emailsOf_(r).forEach(function (email) {
      out.codes[codeKey_(dashboardCode_(email))] = at;
    });
    if (p.team) {
      var k = p.team.toLowerCase();
      // a team typed in the column by hand, not in the Teams tab yet: it still shows, without its details
      if (!out.teams[k]) out.teams[k] = { name: p.team, challenge: "", table: "", pitch: "", room: "", award: "", members: [] };
      out.teams[k].members.push(p.name);
    }
  }
  try {
    cache.put("roster", JSON.stringify(out), 60);
  } catch (err) {}
  return out;
}

function rosterChanged_() {
  CacheService.getScriptCache().remove("roster");
}

function merged_(a, b) {
  var o = {};
  [a, b].forEach(function (x) {
    Object.keys(x).forEach(function (k) {
      o[k] = x[k];
    });
  });
  return o;
}

// the "Coming" column: "yes", "no", or "" (no answer yet). The dashboard writes yes or no; typed in the sheet by hand
// for someone who answered by email, "confirmed", "da" or "nu" read the same
function comingOf_(v) {
  v = String(v || "").trim().toLowerCase();
  if (/^(yes|y|da|confirm[a-z]*|coming|vine|true|✓|✔)(?![a-z])/.test(v)) return "yes";
  if (/^(no|n|nu|false|declined|cancel[a-z]*)$|^(not|cannot|can't|nu) (com|vine)/.test(v)) return "no";
  return "";
}

// whose dashboard this is: { name, email, at (in roster_().people) } for an accepted participant,
// { organiser: true } for the admin key or a voter's own key, else the answer to send back
function dashboardWho_(code) {
  var admin = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  if ((admin && String(code || "").trim() === admin) || voterOf_(code))
    return { name: "", organiser: true };
  var screen = screenKey_();
  if (screen && String(code || "").trim().toLowerCase() === screen.toLowerCase()) return { name: "", organiser: false, screen: true };
  var key = codeKey_(code);
  var roster = key.length === 8 ? roster_() : null;
  var at = roster ? roster.codes[key] : undefined;
  if (at !== undefined)
    return { name: roster.people[at].name, email: roster.people[at].email, at: at, organiser: false };
  if (roster && roster.off && roster.off[key])
    return {
      ok: false,
      denied: true,
      off: true,
      error:
        "We did not hear from you by " + CONFIRM_BY + " whether you are coming, so your code is off and your place may go " +
        "to someone on the waiting list. Still want to come? Write to us at " + REPLY_TO + " as soon as you can.",
    };
  Utilities.sleep(1500); // a wrong code costs time, so guessing does not pay
  return {
    ok: false,
    denied: true,
    error:
      "This code does not open the team dashboard. It is for the accepted participants, and each has their own code in their acceptance email.",
  };
}

function boardSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BOARD_SHEET) || ss.insertSheet(BOARD_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(BOARD_COLUMNS);
    sheet.getRange(1, 1, 1, BOARD_COLUMNS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// the items in the sheet's order (the pages sort the announcements, newest first); rows typed by hand without
// an ID get "row" and their number, which the admin page replaces with a real ID when it opens the dashboard
function boardItems_(values) {
  var header = header_(values);
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    var section = String(r["Section"]).trim().toLowerCase() || "announcement";
    if (!String(r["Title"]).trim() && !String(r["Text"]).trim()) continue;
    if (BOARD_SECTIONS.indexOf(section) === -1) continue;
    items.push({
      id: String(r["ID"]).trim() || "row" + (i + 1),
      section: section,
      challenge: String(r["Challenge"]).trim(),
      title: String(r["Title"]).trim(),
      text: String(r["Text"]).trim(),
      link: /^https?:\/\/\S+$/i.test(String(r["Link"]).trim()) ? String(r["Link"]).trim() : "",
      pinned: r["Pinned"] === true || /^(true|yes|x)$/i.test(String(r["Pinned"]).trim()),
      posted: isDate_(r["Posted"]) ? r["Posted"] : null,
      edited: isDate_(r["Edited"]) ? r["Edited"] : null,
    });
  }
  return items;
}

// teams.html asks every minute or so from every open dashboard: the items stay a minute in the cache, and a save
// or a delete clears it, so what the organisers post shows at the next ask
function board_(who) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("board");
  var items = hit ? JSON.parse(hit) : null;
  if (!items) {
    items = boardItems_(boardSheet_().getDataRange().getValues());
    try {
      cache.put("board", JSON.stringify(items), 60);
    } catch (err) {} // over the cache's 100 KB: read from the sheet each time
  }
  if (!who.organiser) {
    var now = Date.now();
    items = items.filter(function (it) {
      var from = BOARD_FROM[it.section];
      return (!from || now >= Date.parse(from)) && (!who.screen || it.section === "announcement");
    });
  }
  return {
    ok: true,
    action: "board",
    items: items,
    who: { name: who.name, organiser: who.organiser, screen: !!who.screen },
    me: meOf_(who),
    handinBy: HANDIN_BY,
    audience: audienceOrNull_(who),
    queue: who.organiser || who.screen ? queueCounts_() : null,
    flash: who.organiser || who.screen ? flashOf_() : null,
    at: new Date(),
  };
}

// what the dashboard shows one participant about themselves (null for the organisers): their team with its table,
// pitch and teammates, their "are you coming?" answer, their check-in, their latest mentor request and feedback
function meOf_(who) {
  if (who.organiser) return null;
  var roster = roster_();
  var p = personOf_(roster, who.email);
  if (!p) return null;
  var t = p.team ? roster.teams[p.team.toLowerCase()] : null;
  return {
    name: p.name,
    coming: p.coming,
    checkedIn: p.checkedIn,
    certificate: p.certificate,
    team: t
      ? {
          name: t.name,
          challenge: t.challenge,
          table: t.table,
          pitch: t.pitch,
          room: t.room,
          award: Date.now() >= Date.parse(EVENT_END) ? t.award : "", // no spoilers before the awards
          mates: t.members.filter(function (n) {
            return n !== p.name;
          }),
          handin: t.repo ? { repo: t.repo, slides: t.slides, video: t.video, about: t.about, at: t.handedIn, by: t.handedInBy } : null,
        }
      : null,
    help: helpOf_(p),
    feedback: feedbackOf_(p.email),
  };
}

function personOf_(roster, email) {
  for (var i = 0; i < roster.people.length; i++) if (roster.people[i].email === email) return roster.people[i];
  return null;
}

// the hackathon registration of one of these emails: its sheet row (1-based), or -1
function regRow_(values, header, email) {
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    if (eventKey_(r["Attends"]) === "hackathon" && emailsOf_(r).indexOf(email) !== -1) return i + 1;
  }
  return -1;
}

// a tab of its own (the teams, the mentor queue, the feedback), with its header row made on first use
function tab_(name, columns) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(columns);
    sheet.getRange(1, 1, 1, columns.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// a time from the sheet or from the cache (where dates are ISO strings): milliseconds, or 0
function ms_(v) {
  if (isDate_(v)) return v.getTime();
  var t = v ? Date.parse(v) : NaN;
  return isNaN(t) ? 0 : t;
}

/* --- are you coming? -------------------------------------------------- */

// teams.html: "I am coming" or "I cannot come", as often as they change their mind; the admin page shows it
function coming_(who, data) {
  var v = comingOf_(data.coming);
  if (!v) return { ok: false, action: "coming", error: "Answer yes or no." };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var row = regRow_(values, header, who.email);
    if (row === -1) return { ok: false, action: "coming", error: "Your registration is not in the sheet any more. Reply to your acceptance email." };
    sheet.getRange(row, header.indexOf("Coming") + 1).setValue(v);
    sheet.getRange(row, header.indexOf("Coming answered") + 1).setValue(new Date());
    rosterChanged_();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "coming", me: meOf_(who) };
}

/* --- the teams --------------------------------------------------------- */

// the Teams tab: [{ name, challenge, table, pitch, room, award, repo, slides, video, about, handedIn, handedInBy }],
// in its order
function teamsList_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TEAMS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var header = header_(values);
  var seen = {};
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    var name = String(r["Team"]).trim();
    if (!name || seen[name.toLowerCase()]) continue;
    seen[name.toLowerCase()] = true;
    var challenge = String(r["Challenge"]).trim();
    var award = String(r["Award"]).trim().toLowerCase();
    out.push({
      name: name,
      challenge: CHALLENGES.indexOf(challenge) !== -1 ? challenge : "",
      table: String(r["Table"]).trim(),
      pitch: hhmm_(r["Pitch"]),
      room: String(r["Room"]).trim(),
      award: AWARDS.indexOf(award) !== -1 ? award : "",
      repo: webLink_(r["Repository"]),
      slides: webLink_(r["Slides"]),
      video: webLink_(r["Video"]),
      about: String(r["About"] || "").trim(),
      handedIn: isDate_(r["Handed in"]) ? r["Handed in"] : null,
      handedInBy: String(r["Handed in by"] || "").trim(),
    });
  }
  return out;
}

// a web address as typed: "github.com/team/repo" gets its https://; anything that is not one, ""
function webLink_(v) {
  var s = String(v || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) s = "https://" + s;
  return /^https?:\/\/[^\s"<>]+\.[^\s"<>]+$/i.test(s) ? s : "";
}

// the Teams tab, with the columns that came later (the hand-in's) added after the others on a tab made before them
function teamsTab_() {
  var sheet = tab_(TEAMS_SHEET, TEAM_COLUMNS);
  var have = header_(sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues());
  var missing = TEAM_COLUMNS.filter(function (c) {
    return have.indexOf(c) === -1;
  });
  if (missing.length) sheet.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
  return sheet;
}

/* --- the team's own name ------------------------------------------------------------------ */

var TEAM_NAME_MAX = 40;

// teams.html: a team of two or more names itself (the organisers' "Team Ana, Mihai and Ioana" until then), as often
// as it likes until coding stops; any of its members can, and the last one counts. The new name goes everywhere the
// old one was: the Teams tab, the members' "Hackathon team", the mentor queue and the audience votes. The admin
// page can still change it (Teams, Edit).
function teamName_(who, data) {
  var fail = function (msg) {
    return { ok: false, action: "team-name", error: msg };
  };
  if (Date.now() >= Date.parse(HANDIN_BY)) return fail("Coding has stopped, and the team names with it. Ask at the desk for a change.");
  var roster = roster_();
  var p = personOf_(roster, who.email);
  if (!p) return fail("Your registration is not in the sheet any more. Ask at the desk.");
  if (!p.team) return fail("You are not in a team yet.");
  var t = roster.teams[p.team.toLowerCase()];
  if (!t || t.members.length < 2) return fail("A name is for a team of two or more: for now you are on your own.");
  var name = clean_(data.name).replace(/\s+/g, " ").trim();
  if (name.length < 2) return fail("Give your team a name of at least two letters.");
  if (name.length > TEAM_NAME_MAX) return fail("Keep it to " + TEAM_NAME_MAX + " letters, so it fits on the big screen.");
  if (/https?:|www\.|@|[<>{}\[\]\\|]/i.test(name)) return fail("Just a name, without links or symbols.");
  var was = t.name;
  if (name === was) return { ok: true, action: "team-name", me: meOf_(who) };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = teamsTab_();
    var values = sheet.getDataRange().getValues();
    var at = teamRow_(values, was);
    var clash = teamRow_(values, name);
    if (clash !== -1 && clash !== at) return fail("Another team is called " + String(values[clash - 1][0]).trim() + " already: pick another name.");
    if (at === -1) sheet.appendRow([cell_(name), "", "", "", "", ""]);
    else sheet.getRange(at, 1).setValue(cell_(name));
    renameMembers_(was, name);
    renameInTab_(QUEUE_SHEET, "Team", was, name);
    renameInTab_(AUDIENCE_SHEET, "Team", was, name);
    SpreadsheetApp.flush();
    queueChanged_();
    CacheService.getScriptCache().remove("audience");
    rosterChanged_();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "team-name", me: meOf_(who) };
}

// a team's new name in a tab of its own (the mentor queue, the audience votes), where its old one was
function renameInTab_(tab, column, from, to) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
  if (!sheet || sheet.getLastRow() < 2) return;
  var values = sheet.getDataRange().getValues();
  var col = header_(values).indexOf(column);
  if (col === -1) return;
  for (var i = 1; i < values.length; i++)
    if (String(values[i][col]).trim().toLowerCase() === from.toLowerCase()) sheet.getRange(i + 1, col + 1).setValue(cell_(to));
}

/* --- the hand-in ------------------------------------------------------------------------ */

// teams.html: the team's hand-in, as often as they like until coding stops (HANDIN_BY): where the code is (a
// repository, a Colab or Drive link: required), the slides and a demo video (optional), a line on what they built.
// Any of the team can change it, and the last one counts. The admin page shows it to the jury, team by team.
function handin_(who, data) {
  var fail = function (msg) {
    return { ok: false, action: "handin", error: msg };
  };
  if (Date.now() >= Date.parse(HANDIN_BY))
    return fail("Coding has stopped, and the hand-in with it. Talk to an organiser at the desk.");
  var roster = roster_();
  var p = personOf_(roster, who.email);
  if (!p) return fail("Your registration is not in the sheet any more. Ask at the desk.");
  if (!p.team) return fail("You are not in a team yet. Ask at the desk, then hand in from here.");
  var links = {};
  var names = { repo: "your code", slides: "the slides", video: "the video" };
  for (var k in names) {
    var raw = String(data[k] || "").trim();
    links[k] = webLink_(raw);
    if (raw && !links[k]) return fail("The link to " + names[k] + " has to be a web address, like https://github.com/your-team/project.");
  }
  if (!links.repo) return fail("Give the link to your code: a repository, or a Colab or Drive link anyone with it can open.");
  var about = clean_(data.about).slice(0, 280);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = teamsTab_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var row = teamRow_(values, p.team);
    if (row === -1) {
      // a team typed only in the registrations' "Hackathon team" column: it goes in the Teams tab now
      sheet.appendRow([cell_(p.team), "", "", "", "", ""]);
      row = sheet.getLastRow();
    }
    var put = {
      Repository: links.repo,
      Slides: links.slides,
      Video: links.video,
      About: cell_(about),
      "Handed in": new Date(),
      "Handed in by": cell_(p.name),
    };
    Object.keys(put).forEach(function (col) {
      sheet.getRange(row, header.indexOf(col) + 1).setValue(put[col]);
    });
    SpreadsheetApp.flush();
    rosterChanged_(); // the team's dashboards show the hand-in at their next ask
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "handin", me: meOf_(who) };
}

/* --- the audience award -------------------------------------------------------------------- */

function audienceState_() {
  var s = PropertiesService.getScriptProperties().getProperty("AUDIENCE") || "";
  return AUDIENCE_STATES.indexOf(s) === -1 ? "" : s;
}

// every vote, { email: team }: half a minute in the cache, cleared by each vote
function audienceVotes_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("audience");
  if (hit) return JSON.parse(hit);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIENCE_SHEET);
  var votes = {};
  if (sheet && sheet.getLastRow() > 1) {
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    for (var i = 1; i < values.length; i++) {
      var r = toRecord_(header, values[i]);
      var email = String(r["Email"]).trim().toLowerCase();
      var team = String(r["Team"]).trim();
      if (email && team) votes[email] = team;
    }
  }
  try {
    cache.put("audience", JSON.stringify(votes), 30);
  } catch (err) {}
  return votes;
}

// the teams with someone in them, each with its votes, the most first
function audienceTally_(roster) {
  var votes = audienceVotes_();
  var n = {};
  Object.keys(votes).forEach(function (e) {
    var k = votes[e].toLowerCase();
    n[k] = (n[k] || 0) + 1;
  });
  var teams = Object.keys(roster.teams)
    .map(function (k) {
      return roster.teams[k];
    })
    .filter(function (t) {
      return t.members.length;
    })
    .map(function (t) {
      return { name: t.name, challenge: t.challenge, votes: n[t.name.toLowerCase()] || 0 };
    });
  teams.sort(function (a, b) {
    return b.votes - a.votes || a.name.localeCompare(b.name);
  });
  return { total: Object.keys(votes).length, teams: teams };
}

// what a page is told about the vote: the organisers (the admin page, the big screen) everything; a participant
// the state, the teams they can vote for, their own vote, and the votes once the result is shown
function audienceFor_(who) {
  var state = audienceState_();
  var roster = roster_();
  var tally = audienceTally_(roster);
  if (who.organiser) return { state: state, total: tally.total, teams: tally.teams };
  if (!state) return { state: "" };
  var p = personOf_(roster, who.email);
  var own = p && p.team ? p.team.toLowerCase() : "";
  return {
    state: state,
    total: tally.total,
    mine: audienceVotes_()[who.email] || "",
    canVote: !!(p && p.checkedIn),
    teams: tally.teams
      .filter(function (t) {
        return t.name.toLowerCase() !== own || state === "shown";
      })
      .map(function (t) {
        return state === "shown" ? t : { name: t.name, challenge: t.challenge };
      }),
  };
}

// never a reason for the board or the list to fail
function audienceOrNull_(who) {
  try {
    return audienceFor_(who || { organiser: true });
  } catch (err) {
    console.error("audience failed: " + err);
    return null;
  }
}

// teams.html: a participant's vote, while the vote is open: one each, for a team not their own, changed as often
// as they like
function audienceVote_(who, data) {
  var fail = function (msg) {
    return { ok: false, action: "audience", error: msg };
  };
  if (audienceState_() !== "open") return fail("The vote is not open now.");
  var roster = roster_();
  var p = personOf_(roster, who.email);
  if (!p) return fail("Your registration is not in the sheet any more. Ask at the desk.");
  if (!p.checkedIn) return fail("Only those at the hackathon vote: check in at the desk first.");
  var name = String(data.team || "").trim();
  var t = roster.teams[name.toLowerCase()];
  if (!t || !t.members.length) return fail("That team is not on the list. Refresh the page.");
  if (p.team && p.team.toLowerCase() === t.name.toLowerCase()) return fail("Vote for another team: not your own.");
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = tab_(AUDIENCE_SHEET, AUDIENCE_COLUMNS);
    var values = sheet.getDataRange().getValues();
    var row = -1;
    for (var i = 1; i < values.length; i++) if (String(values[i][0]).trim().toLowerCase() === who.email) row = i + 1;
    var line = [who.email, cell_(t.name), new Date()];
    if (row === -1) sheet.appendRow(line);
    else sheet.getRange(row, 1, 1, line.length).setValues([line]);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove("audience");
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "audience", me: meOf_(who), audience: audienceFor_(who) };
}

// admin.html: opens the vote ("open"), closes it and shows the result ("shown"), or puts it back as before ("");
// clear: deletes every vote (after a test)
function audienceSet_(data) {
  var state = String(data.state || "").trim().toLowerCase();
  if (AUDIENCE_STATES.indexOf(state) === -1) return { ok: false, action: "audience-state", error: "Not a state of the vote: " + state };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    PropertiesService.getScriptProperties().setProperty("AUDIENCE", state);
    if (data.clear) {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIENCE_SHEET);
      if (sheet && sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
      CacheService.getScriptCache().remove("audience");
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "audience-state", audience: audienceFor_({ organiser: true }) };
}

// The big screen's own password (screen.html, for a smart board or a laptop left at the venue), set on the admin
// page (Team dashboard, Big screen) and kept in the SCREEN_KEY script property, never in this file: it opens the
// screen's view of the board (the announcements, the mentor queue in numbers, the audience vote as the teams see it)
// and nothing else. Empty: only the admin key opens the screen.
function screenKey_() {
  return PropertiesService.getScriptProperties().getProperty("SCREEN_KEY") || "";
}

function screenKeySet_(data) {
  var key = String(data.screenKey || "").trim();
  if (key && !/^[A-Za-z0-9-]{6,40}$/.test(key))
    return { ok: false, action: "screen-key", error: "Letters, digits and dashes only, from 6 to 40 of them." };
  var props = PropertiesService.getScriptProperties();
  if (key && (key === props.getProperty("ADMIN_KEY") || key === props.getProperty("MENTOR_KEY")))
    return { ok: false, action: "screen-key", error: "Pick a password of its own, not one of the other keys." };
  if (key) props.setProperty("SCREEN_KEY", key);
  else props.deleteProperty("SCREEN_KEY");
  return { ok: true, action: "screen-key", screenKey: key };
}

// The big screen's live message ("Food is served: come and eat."): the admin page puts it on the screen at once
// (screen.html asks every few seconds, the "flash" action), for a few minutes or until it is taken down; it can go
// on the team dashboards too, as an announcement. Kept in the SCREEN_FLASH script property.
var FLASH_TEXT_MAX = 80;
var FLASH_SUB_MAX = 140;

// the message while it is up: { id, text, sub, at, until }, else null
function flashOf_() {
  var raw = PropertiesService.getScriptProperties().getProperty("SCREEN_FLASH");
  if (!raw) return null;
  try {
    var f = JSON.parse(raw);
    return f && f.text && Date.now() < Date.parse(f.until) ? f : null;
  } catch (err) {
    return null;
  }
}

// admin.html: { text, sub, minutes, post } shows it; an empty text takes it down
function flashSet_(data) {
  var text = clean_(data.text).replace(/\s+/g, " ").trim();
  var sub = clean_(data.sub).replace(/\s+/g, " ").trim();
  var props = PropertiesService.getScriptProperties();
  if (!text) {
    props.deleteProperty("SCREEN_FLASH");
    return { ok: true, action: "screen-flash", flash: null };
  }
  if (text.length > FLASH_TEXT_MAX) return { ok: false, action: "screen-flash", error: "Keep the message to " + FLASH_TEXT_MAX + " letters, so it reads from the back of the room; the line under it can say more." };
  if (sub.length > FLASH_SUB_MAX) return { ok: false, action: "screen-flash", error: "Keep the line under it to " + FLASH_SUB_MAX + " letters." };
  var minutes = Math.min(60, Math.max(1, Math.round(Number(data.minutes) || 5)));
  var now = new Date();
  var flash = { id: newBoardId_(), text: text, sub: sub, at: now.toISOString(), until: new Date(now.getTime() + minutes * 60000).toISOString() };
  props.setProperty("SCREEN_FLASH", JSON.stringify(flash));
  var posted = null;
  if (data.post) posted = boardSave_({ item: { section: "announcement", title: text, text: sub } });
  return { ok: true, action: "screen-flash", flash: flash, posted: !!(posted && posted.ok) };
}

// the mentor queue in numbers, for the big screen
function queueCounts_() {
  try {
    var waiting = 0;
    var taken = 0;
    queue_().forEach(function (it) {
      if (it.status === "waiting") waiting++;
      if (it.status === "taken") taken++;
    });
    return { waiting: waiting, taken: taken };
  } catch (err) {
    return null;
  }
}

// a time typed in the sheet ("10:15", which Sheets may keep as a time of day) as "10:15"
function hhmm_(v) {
  // a time of day comes back as a date in 1899, right only in the spreadsheet's own time zone
  if (isDate_(v)) return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), "HH:mm");
  return String(v || "").trim();
}

function teamRow_(values, name) {
  var key = String(name || "").trim().toLowerCase();
  for (var i = 1; i < values.length; i++) if (String(values[i][0]).trim().toLowerCase() === key) return i + 1;
  return -1;
}

// admin.html: a new team (no "was") or a change to one (was: its name before); a new name moves its members too
function teamSave_(data) {
  var t = data.team || {};
  var fail = function (msg) {
    return { ok: false, action: "team-save", error: msg };
  };
  var name = clean_(t.name).slice(0, 60);
  var was = clean_(t.was);
  var challenge = String(t.challenge || "").trim();
  var award = String(t.award || "").trim().toLowerCase();
  if (!name) return fail("Give the team a name.");
  if (challenge && CHALLENGES.indexOf(challenge) === -1) return fail("Not a challenge: " + challenge);
  if (award && AWARDS.indexOf(award) === -1) return fail("Not a place on the podium: " + award);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = tab_(TEAMS_SHEET, TEAM_COLUMNS);
    var values = sheet.getDataRange().getValues();
    var at = was ? teamRow_(values, was) : -1;
    var clash = teamRow_(values, name);
    if (clash !== -1 && clash !== at) return fail("There is a team called " + values[clash - 1][0] + " already.");
    var line = [cell_(name), challenge, cell_(t.table).slice(0, 30), cell_(t.pitch).slice(0, 20), cell_(t.room).slice(0, 40), award];
    if (at === -1) sheet.appendRow(line);
    else sheet.getRange(at, 1, 1, line.length).setValues([line]);
    var moved = was && was.toLowerCase() !== name.toLowerCase() ? renameMembers_(was, name) : 0;
    rosterChanged_();
    return { ok: true, action: "team-save", teams: teamsList_(), moved: moved };
  } finally {
    lock.releaseLock();
  }
}

// the members of a team, in the registrations, under its new name ("" takes them out of it); how many
function renameMembers_(from, to) {
  var sheet = sheet_();
  var values = sheet.getDataRange().getValues();
  var header = header_(values);
  var col = header.indexOf("Hackathon team");
  var n = 0;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][col]).trim().toLowerCase() !== from.toLowerCase()) continue;
    sheet.getRange(i + 1, col + 1).setValue(to ? cell_(to) : "");
    n++;
  }
  return n;
}

// admin.html: a team off the list, its members back to no team
function teamDelete_(data) {
  var name = clean_(data.name);
  if (!name) return { ok: false, action: "team-delete", error: "No team given." };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = tab_(TEAMS_SHEET, TEAM_COLUMNS);
    var at = teamRow_(sheet.getDataRange().getValues(), name);
    if (at !== -1) sheet.deleteRow(at);
    renameMembers_(name, "");
    rosterChanged_();
    return { ok: true, action: "team-delete", teams: teamsList_() };
  } finally {
    lock.releaseLock();
  }
}

// admin.html: people into a team ("" takes them out), several groups at once: { groups: [{ team, emails }] }.
// A team not in the Teams tab yet is added to it.
function teamAssign_(data) {
  var groups = [].concat(data.groups || []);
  if (!groups.length) return { ok: false, action: "team-assign", error: "No one given." };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var teams = tab_(TEAMS_SHEET, TEAM_COLUMNS);
    var tv = teams.getDataRange().getValues();
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var col = header.indexOf("Hackathon team") + 1;
    var set = [];
    var missing = [];
    groups.forEach(function (g) {
      var team = clean_(g.team).slice(0, 60);
      if (team) {
        var at = teamRow_(tv, team);
        if (at === -1) {
          teams.appendRow([cell_(team), "", "", "", "", ""]);
          tv.push([team, "", "", "", "", ""]);
        } else {
          team = String(tv[at - 1][0]).trim(); // as the Teams tab writes it
        }
      }
      [].concat(g.emails || []).forEach(function (e) {
        var email = String(e || "").trim().toLowerCase();
        var row = regRow_(values, header, email);
        if (row === -1) {
          missing.push(email);
          return;
        }
        sheet.getRange(row, col).setValue(team ? cell_(team) : "");
        set.push({ email: email, team: team });
      });
    });
    rosterChanged_();
    return { ok: true, action: "team-assign", set: set, missing: missing, teams: teamsList_() };
  } finally {
    lock.releaseLock();
  }
}

/* --- the check-in at the door ------------------------------------------------ */

// admin.html: someone is here (or, undo, not after all)
function checkin_(data) {
  var email = String(data.email || "").trim().toLowerCase();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var row = regRow_(values, header, email);
    if (row === -1) return { ok: false, action: "checkin", error: "There is no hackathon registration for " + email + " in the sheet any more. Refresh the page." };
    var at = data.undo ? "" : new Date();
    sheet.getRange(row, header.indexOf("Checked in") + 1).setValue(at);
    rosterChanged_();
    return { ok: true, action: "checkin", email: email, checkedIn: at || null };
  } finally {
    lock.releaseLock();
  }
}

/* --- ask a mentor ------------------------------------------------------------- */

// the mentor key, made on first use (renew: a new one, and the old link stops working at once)
function mentorKey_(renew) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("MENTOR_KEY");
  if (!key || renew) {
    key = "M" + Utilities.getUuid().replace(/-/g, "").slice(0, 15);
    props.setProperty("MENTOR_KEY", key);
  }
  return key;
}

// null when the key opens the mentor queue (the mentor key, the admin key or a voter's), else the answer to send back
function checkMentor_(key) {
  var props = PropertiesService.getScriptProperties();
  var k = String(key || "").trim();
  if (k && (k === props.getProperty("MENTOR_KEY") || k === props.getProperty("ADMIN_KEY") || voterOf_(k))) return null;
  Utilities.sleep(1500);
  return { ok: false, denied: true, error: "That key does not open the mentor queue. The link from the organisers has it." };
}

// the requests that are open, or closed in the last three hours, oldest first; a minute in the cache, cleared by
// every change, so the mentors and the teams see a change at their next ask
function queue_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("queue");
  if (hit) return JSON.parse(hit);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(QUEUE_SHEET);
  var values = sheet ? sheet.getDataRange().getValues() : [];
  var items = queueItems_(values);
  try {
    cache.put("queue", JSON.stringify(items), 60);
  } catch (err) {}
  return items;
}

function queueItems_(values) {
  if (values.length < 2) return [];
  var header = header_(values);
  var since = Date.now() - 3 * 3600 * 1000;
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    var status = String(r["Status"]).trim().toLowerCase();
    if (!String(r["ID"]).trim()) continue;
    if (QUEUE_OPEN.indexOf(status) === -1 && ms_(r["Closed"]) < since) continue;
    items.push({
      id: String(r["ID"]).trim(),
      asked: isDate_(r["Asked"]) ? r["Asked"] : null,
      name: String(r["Name"]).trim(),
      email: String(r["Email"]).trim().toLowerCase(),
      team: String(r["Team"]).trim(),
      challenge: String(r["Challenge"]).trim(),
      where: String(r["Where"]).trim(),
      question: String(r["Question"]).trim(),
      status: status || "waiting",
      mentor: String(r["Mentor"]).trim(),
      taken: isDate_(r["Taken"]) ? r["Taken"] : null,
      closed: isDate_(r["Closed"]) ? r["Closed"] : null,
    });
  }
  return items;
}

function queueChanged_() {
  CacheService.getScriptCache().remove("queue");
}

// a request is the team's (any of them sees it and can cancel it), or the person's when they have no team yet
function ownsHelp_(it, p) {
  return p.team ? it.team.toLowerCase() === p.team.toLowerCase() : it.email === p.email;
}

// the participant's latest request: open, or closed in the last 15 minutes (so they see "done"), with how many
// asked before it are still waiting (in the same challenge, when it has one)
function helpOf_(p) {
  var items = queue_();
  var at = -1;
  items.forEach(function (it, i) {
    if (ownsHelp_(it, p)) at = i;
  });
  if (at === -1) return null;
  var mine = items[at];
  var open = QUEUE_OPEN.indexOf(mine.status) !== -1;
  if (!open && ms_(mine.closed) < Date.now() - 15 * 60 * 1000) return null;
  // the rows are in the order asked
  var ahead = 0;
  if (mine.status === "waiting")
    items.slice(0, at).forEach(function (it) {
      if (it.status === "waiting" && (!mine.challenge || !it.challenge || it.challenge === mine.challenge)) ahead++;
    });
  return {
    id: mine.id,
    status: mine.status,
    asked: mine.asked,
    challenge: mine.challenge,
    where: mine.where,
    question: mine.question,
    mentor: mine.mentor,
    taken: mine.taken,
    closed: mine.closed,
    ahead: ahead,
    byMe: mine.email === p.email,
  };
}

// teams.html: "Ask a mentor". A team with a request still open gets that one back, not a second one.
function helpAsk_(who, data) {
  var fail = function (msg) {
    return { ok: false, action: "help", error: msg };
  };
  var roster = roster_();
  var p = personOf_(roster, who.email);
  if (!p) return fail("Your registration is not in the sheet any more. Ask at the desk.");
  var team = p.team ? roster.teams[p.team.toLowerCase()] : null;
  var challenge = String(data.challenge || "").trim();
  if (CHALLENGES.indexOf(challenge) === -1) challenge = team ? team.challenge : "";
  var question = clean_(data.question).slice(0, 300);
  var where = clean_(data.where).slice(0, 80);
  if (!question) return fail("Say in a line or two what you are stuck on, so the right mentor comes.");
  if (!where) return fail("Say where you are (the room, the spot), so the mentor finds you.");
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = tab_(QUEUE_SHEET, QUEUE_COLUMNS);
    var open = queueItems_(sheet.getDataRange().getValues()).filter(function (it) {
      return QUEUE_OPEN.indexOf(it.status) !== -1 && ownsHelp_(it, p);
    });
    if (!open.length) {
      sheet.appendRow([newBoardId_(), new Date(), cell_(p.name), p.email, cell_(p.team), challenge, cell_(where), cell_(question), "waiting", "", "", ""]);
      queueChanged_();
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "help", me: meOf_(who) };
}

// teams.html: "Cancel" (solved it ourselves), while the request is still open
function helpCancel_(who, data) {
  var roster = roster_();
  var p = personOf_(roster, who.email);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = tab_(QUEUE_SHEET, QUEUE_COLUMNS);
    var values = sheet.getDataRange().getValues();
    var row = boardRow_(values, header_(values), String(data.id || ""));
    var it = row === -1 ? null : queueItems_([values[0], values[row - 1]])[0];
    if (it && p && ownsHelp_(it, p) && QUEUE_OPEN.indexOf(it.status) !== -1) {
      var header = header_(values);
      sheet.getRange(row, header.indexOf("Status") + 1).setValue("cancelled");
      sheet.getRange(row, header.indexOf("Closed") + 1).setValue(new Date());
      queueChanged_();
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "help-cancel", me: meOf_(who) };
}

// mentors.html: the queue, without the emails
function mentorQueue_() {
  return {
    ok: true,
    action: "mentor-queue",
    items: queue_().map(function (it) {
      var o = merged_(it, {});
      delete o.email;
      return o;
    }),
    challenges: CHALLENGES,
    at: new Date(),
  };
}

// mentors.html: "On my way" (take), "Done", "Put back" (release); answers with the queue as it is now
function mentorMove_(data) {
  var fail = function (msg) {
    var q = mentorQueue_();
    q.ok = false;
    q.action = data.action;
    q.error = msg;
    return q;
  };
  var mentor = clean_(data.mentor).slice(0, 60);
  if (data.action === "mentor-take" && !mentor) return fail("Type your name first: the team sees who is coming.");
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = tab_(QUEUE_SHEET, QUEUE_COLUMNS);
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var row = boardRow_(values, header, String(data.id || ""));
    if (row === -1) return fail("That request is not in the queue any more.");
    var it = queueItems_([values[0], values[row - 1]])[0] || { status: "done", mentor: "" };
    var set = function (col, v) {
      sheet.getRange(row, header.indexOf(col) + 1).setValue(v);
    };
    if (it.status === "cancelled") return fail("The team cancelled that request: they sorted it out.");
    if (data.action === "mentor-take") {
      if (it.status === "done") return fail("That request is done already.");
      if (it.status === "taken" && it.mentor.toLowerCase() !== mentor.toLowerCase())
        return fail(it.mentor + " is on the way there already.");
      set("Status", "taken");
      set("Mentor", cell_(mentor));
      set("Taken", new Date());
    } else if (data.action === "mentor-done") {
      set("Status", "done");
      set("Closed", new Date());
      if (!it.mentor && mentor) set("Mentor", cell_(mentor));
    } else {
      set("Status", "waiting");
      set("Mentor", "");
      set("Taken", "");
      set("Closed", "");
    }
    queueChanged_();
  } finally {
    lock.releaseLock();
  }
  var q = mentorQueue_();
  q.action = data.action;
  return q;
}

/* --- feedback ------------------------------------------------------------------- */

// someone's row in the Feedback tab, not their name: the same for the same email, not readable back without the secret
function feedbackKey_(email) {
  var bytes = Utilities.computeHmacSha256Signature("feedback:" + String(email || "").trim().toLowerCase(), codeSecret_());
  return bytes
    .slice(0, 8)
    .map(function (b) {
      return ("0" + ((b + 256) % 256).toString(16)).slice(-2);
    })
    .join("");
}

// the feedback by key, a minute in the cache: { key: { sent, overall, best, change, again } }
function feedbackMap_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("feedback");
  if (hit) return JSON.parse(hit);
  var map = {};
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEEDBACK_SHEET);
  var values = sheet ? sheet.getDataRange().getValues() : [];
  var header = values.length ? header_(values) : [];
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    var k = String(r["Key"]).trim();
    if (k) map[k] = { sent: r["Sent"], overall: Number(r["Overall"]) || 0, best: String(r["Best"]), change: String(r["Change"]), again: String(r["Again"]) };
  }
  try {
    cache.put("feedback", JSON.stringify(map), 60);
  } catch (err) {}
  return map;
}

function feedbackOf_(email) {
  return feedbackMap_()[feedbackKey_(email)] || null;
}

// admin.html: every answer, without the key
function feedbackRows_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEEDBACK_SHEET);
  var values = sheet ? sheet.getDataRange().getValues() : [];
  if (values.length < 2) return [];
  var header = header_(values);
  return values.slice(1).map(function (row) {
    var r = toRecord_(header, row);
    return { sent: r["Sent"], challenge: String(r["Challenge"]), overall: Number(r["Overall"]) || 0, best: String(r["Best"]), change: String(r["Change"]), again: String(r["Again"]) };
  }).filter(function (f) {
    return f.overall || f.best || f.change || f.again;
  });
}

// teams.html: the feedback form; sent again, it replaces the earlier answers
function feedback_(who, data) {
  var overall = Math.round(Number(data.overall));
  var again = String(data.again || "").trim().toLowerCase();
  if (!(overall >= 1 && overall <= 5)) return { ok: false, action: "feedback", error: "Pick how it was overall, from 1 to 5." };
  if (again && AGAIN.indexOf(again) === -1) again = "";
  var roster = roster_();
  var p = personOf_(roster, who.email);
  var team = p && p.team ? roster.teams[p.team.toLowerCase()] : null;
  var key = feedbackKey_(who.email);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = tab_(FEEDBACK_SHEET, FEEDBACK_COLUMNS);
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var line = [new Date(), team ? team.challenge : "", overall, longText_(data.best).slice(0, 2000), longText_(data.change).slice(0, 2000), again, key];
    var at = -1;
    for (var i = 1; i < values.length; i++) if (String(values[i][header.indexOf("Key")]).trim() === key) at = i + 1;
    if (at === -1) sheet.appendRow(line);
    else sheet.getRange(at, 1, 1, line.length).setValues([line]);
    CacheService.getScriptCache().remove("feedback");
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "feedback", me: meOf_(who) };
}

/* --- certificates ------------------------------------------------------------------ */

// the template deck (a Drive file), or null when there is none yet or it was deleted
function certTemplate_() {
  var id = PropertiesService.getScriptProperties().getProperty("CERT_TEMPLATE");
  if (!id) return null;
  try {
    var f = DriveApp.getFileById(id);
    return f.isTrashed() ? null : f;
  } catch (err) {
    return null;
  }
}

var PLACE = { "1st": "First place", "2nd": "Second place", "3rd": "Third place" };

// what goes into a certificate's {{…}}
function certFields_(p) {
  var place = PLACE[p.award] || "";
  var team = p.team ? ", with team " + p.team : "";
  return {
    NAME: p.name,
    TITLE: place ? "Certificate of achievement" : "Certificate of participation",
    AWARD: place
      ? "won " + place.toLowerCase() + " in the " + p.challenge + " challenge of the BreaQ 2026 Hackathon" + team + "."
      : "took part in the BreaQ 2026 Hackathon" + (p.challenge ? ", in the " + p.challenge + " challenge" : "") + team + ".",
    TEAM: p.team || "",
    CHALLENGE: p.challenge || "",
    PLACE: place,
    DATE: EVENT_DATES,
  };
}

// one certificate as a PDF: a copy of the template, filled in, exported, then thrown away
function certificatePdf_(tpl, p) {
  var name = "BreaQ 2026 Hackathon certificate - " + p.name;
  var copy = tpl.makeCopy(name);
  try {
    var deck = SlidesApp.openById(copy.getId());
    var fields = certFields_(p);
    Object.keys(fields).forEach(function (k) {
      deck.replaceAllText("{{" + k + "}}", fields[k]);
    });
    deck.saveAndClose();
    return copy.getAs(MimeType.PDF).setName(name + ".pdf");
  } finally {
    copy.setTrashed(true);
  }
}

function certEmail_(p, code) {
  var t = {
    subject: "Your BreaQ 2026 Hackathon certificate",
    heading: "Thank you for coming, " + p.first + ".",
    paras: [
      "Your certificate for the BreaQ Hackathon is attached" + (PLACE[p.award] ? ", with your team’s " + PLACE[p.award].toLowerCase() + ". Congratulations!" : "."),
      "How was it? Two minutes of feedback on the team dashboard help us make the next one better, and we read every answer: " +
        TEAMS_PAGE + "#code=" + code,
      "The BreaQ Conference follows on 14 November at the Military Technical Academy “Ferdinand I”, free and open to everyone: " +
        SITE + "/breaq-conference.html",
    ],
    button: null,
    sign: "See you next time,",
  };
  return renderEmail_(p.first, t);
}

// admin.html: who gets a certificate (the accepted participants checked in at the door), and with send, sends each
// theirs once; with sample, sends the account running the script one, made out to the first of them (or to a
// made-up participant). The "Certificate" column records each one sent.
function certificates_(send, sample) {
  var lock = send || sample ? LockService.getDocumentLock() : null;
  if (lock && !lock.tryLock(2000))
    return { ok: false, action: "certificates", error: "Someone else is sending the certificates right now. Wait a minute, then refresh." };
  try {
    return certificatesLocked_(send, sample);
  } finally {
    if (lock) lock.releaseLock();
  }
}

function certificatesLocked_(send, sample) {
  var started = Date.now();
  var tpl = certTemplate_();
  var roster = roster_();
  var sheet = sheet_();
  var values = sheet.getDataRange().getValues();
  var header = header_(values);
  var col = header.indexOf("Certificate") + 1;
  var stamp = function () {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  };
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    if (!accepted_(r) || !isDate_(r["Checked in"])) continue;
    var team = String(r["Hackathon team"]).trim();
    var t = team ? roster.teams[team.toLowerCase()] : null;
    items.push({
      row: i + 1,
      name: String(r["First name"] + " " + r["Last name"]).trim(),
      first: String(r["First name"]).trim(),
      email: String(r["Email"]).trim(),
      team: team,
      challenge: t ? t.challenge : "",
      award: t ? t.award : "",
      status: /^sent/i.test(String(r["Certificate"])) ? "sent before" : "to send",
      note: /^failed/i.test(String(r["Certificate"])) ? String(r["Certificate"]) : "",
    });
  }
  var answer = function (extra) {
    return merged_(
      {
        ok: true,
        action: "certificates",
        template: tpl ? tpl.getUrl() : "",
        items: items.map(function (it) {
          return { name: it.name, email: it.email, team: it.team, award: it.award, status: it.status, note: it.note };
        }),
        emailsLeft: emailsLeft_(),
        reserve: reserve_(),
      },
      extra || {},
    );
  };
  if (!send && !sample) return answer();
  if (!tpl)
    return merged_(answer(), {
      ok: false,
      error: "There is no certificate template yet: pick certificateTemplate in the Apps Script editor's function list and press Run once.",
    });

  if (sample) {
    var me = Session.getEffectiveUser().getEmail();
    var who = items[0] || { name: "Ana Popescu", first: "Ana", email: me, team: "Qubits", challenge: "Quantum AI", award: "1st" };
    var to = sampleTo_();
    var mail = certEmail_(who, dashboardCode_(who.email));
    send_({
      to: to,
      subject: "[sample] " + mail.subject,
      body: mail.text,
      htmlBody: mail.html,
      name: SENDER_NAME,
      replyTo: REPLY_TO,
      attachments: [certificatePdf_(tpl, who)],
    });
    return answer({ sample: to });
  }

  var folder = null;
  var stopped = "";
  items.forEach(function (it) {
    if (it.status !== "to send" || stopped) return;
    var left = emailsLeft_();
    if (left !== null && left <= reserve_()) stopped = "quota";
    else if (Date.now() - started > 4.5 * 60 * 1000) stopped = "time";
    if (stopped) return;
    var status;
    try {
      var pdf = certificatePdf_(tpl, it);
      var mail = certEmail_(it, dashboardCode_(it.email));
      var via = send_({
        to: it.email,
        subject: mail.subject,
        body: mail.text,
        htmlBody: mail.html,
        name: SENDER_NAME,
        replyTo: REPLY_TO,
        attachments: [pdf],
      });
      try {
        folder = folder || folderNamed_(CERTIFICATES_FOLDER);
        folder.createFile(pdf);
      } catch (err) {
        console.error("certificate copy not kept: " + err);
      }
      status = "sent " + stamp() + " via " + via;
      it.status = "sent";
    } catch (err) {
      status = "FAILED " + stamp() + ": " + err;
      it.status = "failed";
      it.note = String(err);
    }
    sheet.getRange(it.row, col).setValue(status);
  });
  rosterChanged_();
  return answer({ sent: true, stopped: stopped });
}

function folderNamed_(name) {
  var found = DriveApp.getFoldersByName(name);
  return found.hasNext() ? found.next() : DriveApp.createFolder(name);
}

// admin.html: the items and the participant code
function boardAdmin_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = boardSheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    // rows typed by hand: an ID each, so the page can edit and delete them
    var col = header.indexOf("ID");
    var filled = false;
    for (var i = 1; col !== -1 && i < values.length; i++) {
      var title = values[i][header.indexOf("Title")];
      var text = values[i][header.indexOf("Text")];
      if (!String(values[i][col]).trim() && (String(title).trim() || String(text).trim())) {
        values[i][col] = newBoardId_();
        sheet.getRange(i + 1, col + 1).setValue(values[i][col]);
        filled = true;
      }
    }
    if (filled) CacheService.getScriptCache().remove("board");
    return {
      ok: true,
      action: "board-admin",
      items: boardItems_(values),
      page: TEAMS_PAGE,
      challenges: CHALLENGES,
    };
  } finally {
    lock.releaseLock();
  }
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime());
}

function newBoardId_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 10);
}

// the sheet row (1-based) of an item, or -1
function boardRow_(values, header, id) {
  var col = header.indexOf("ID");
  for (var i = 1; i < values.length; i++)
    if (String(values[i][col]).trim() === id || "row" + (i + 1) === id) return i + 1;
  return -1;
}

// a text of several lines and paragraphs, as typed, made safe for the sheet like cell_ does for one line
function longText_(v) {
  var s = String(v === undefined || v === null ? "" : v)
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 5000);
  return /^[=+\-@]/.test(s) || /^[\d\s().\/:,%-]+$/.test(s) ? "'" + s : s;
}

// admin.html: a new item (no id) or an edit (the id of one); answers with all the items, as the dashboard shows them
function boardSave_(data) {
  var it = data.item || {};
  var fail = function (msg) {
    return { ok: false, action: "board-save", error: msg };
  };
  var section = String(it.section || "").trim().toLowerCase();
  if (BOARD_SECTIONS.indexOf(section) === -1) return fail("Not a section: " + section);
  var challenge = section === "resource" || section === "checklist" ? String(it.challenge || "").trim() : "";
  if (challenge && CHALLENGES.indexOf(challenge) === -1)
    return fail("Not a challenge: " + challenge);
  var title = clean_(it.title).slice(0, 160);
  var text = longText_(it.text);
  var link = String(it.link || "").trim();
  if (link && !/^https?:\/\/[^\s"<>]+$/i.test(link))
    return fail("The link has to be a web address that starts with https://");
  if (!title && !text) return fail("Write a title or a text first.");

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = boardSheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var row = {
      Section: section,
      Challenge: challenge,
      Title: cell_(title),
      Text: text,
      Link: link,
      Pinned: section === "announcement" && !!it.pinned,
    };
    var id = String(it.id || "");
    var at = -1;
    if (id) {
      at = boardRow_(values, header, id);
      if (at === -1)
        return fail("That item is not on the dashboard any more: someone deleted it. Refresh to see the dashboard as it is.");
      row.ID = String(values[at - 1][header.indexOf("ID")]).trim() || newBoardId_();
      row.Edited = new Date();
      var line = values[at - 1].slice();
      header.forEach(function (col, j) {
        if (col in row) line[j] = row[col];
      });
      sheet.getRange(at, 1, 1, line.length).setValues([line]);
    } else {
      row.ID = newBoardId_();
      row.Posted = new Date();
      sheet.appendRow(
        header.map(function (col) {
          return col in row ? row[col] : "";
        }),
      );
    }
    CacheService.getScriptCache().remove("board");
    // read back: the sheet keeps "'=…" as the text "=…", and that is what the pages should show
    return {
      ok: true,
      action: "board-save",
      id: row.ID,
      items: boardItems_(sheet.getDataRange().getValues()),
    };
  } finally {
    lock.releaseLock();
  }
}

// admin.html: one item off the dashboard (its row goes); one already gone is not an error
function boardDelete_(data) {
  var id = String(data.id || "");
  if (!id) return { ok: false, action: "board-delete", error: "No item given." };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = boardSheet_();
    var values = sheet.getDataRange().getValues();
    var at = boardRow_(values, header_(values), id);
    if (at !== -1) {
      sheet.deleteRow(at);
      values.splice(at - 1, 1);
      CacheService.getScriptCache().remove("board");
    }
    return { ok: true, action: "board-delete", items: boardItems_(values) };
  } finally {
    lock.releaseLock();
  }
}

// a nice-to-have on the admin page, never a reason for the list to fail
function emailsLeft_() {
  try {
    return MailApp.getRemainingDailyQuota();
  } catch (err) {
    return null;
  }
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    decisionColumn_(sheet, COLUMNS);
    trackColumn_(sheet, COLUMNS);
    voteColumns_(sheet, COLUMNS, VOTE_COLUMNS);
  } else {
    // a sheet made by an older version: add the headers of the newer columns after the last one, past any
    // column the team added by hand (rows are written by header, not by position)
    var have = header_(
      sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues(),
    );
    var missing = COLUMNS.filter(function (col) {
      return have.indexOf(col) === -1;
    });
    if (missing.length) {
      sheet
        .getRange(1, have.length + 1, 1, missing.length)
        .setValues([missing])
        .setFontWeight("bold");
      // a column added at the edge can come with the rule of the one before it: the new ones start without any
      if (sheet.getMaxRows() > 1)
        sheet.getRange(2, have.length + 1, sheet.getMaxRows() - 1, missing.length).clearDataValidations();
    }
    if (missing.indexOf("Decision") !== -1)
      decisionColumn_(sheet, have.concat(missing));
    if (missing.indexOf("Hackathon track") !== -1)
      trackColumn_(sheet, have.concat(missing));
    voteColumns_(sheet, have.concat(missing), missing);
    fixRules_(sheet, have.concat(missing));
  }
  return sheet;
}

// The Note columns came with the vote dropdown (yes, no, waitlist) of the column before them, which refused every
// note: Sheets only refuses it when it saves, after the answer, so the admin page could not even say why. Once
// (RULES_FIXED), each column keeps only its own rule: the Decision its dropdown, the votes their 1 to 10, and any
// other column loses a dropdown of votes or decisions, or a 1 to 10, it can only have been given by mistake. A rule
// of another kind (a checkbox the team added) stays.
var RULES_FIXED = "2026-10-17";

function fixRules_(sheet, header) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("RULES_FIXED") === RULES_FIXED) return;
  var rows = sheet.getMaxRows() - 1;
  if (rows >= 1 && header.length) {
    var rules = sheet.getRange(2, 1, 1, header.length).getDataValidations()[0];
    var cleared = [];
    header.forEach(function (col, j) {
      if (col === "Decision" || VOTE_COLUMNS.indexOf(col) !== -1 || !rules[j] || !strayRule_(rules[j])) return;
      sheet.getRange(2, j + 1, rows, 1).clearDataValidations();
      cleared.push(col || "column " + (j + 1));
    });
    decisionColumn_(sheet, header);
    voteColumns_(sheet, header, VOTE_COLUMNS);
    console.log("fixRules_: " + (cleared.length ? "took the stray rule off " + cleared.join(", ") : "every column had its own rule"));
  }
  props.setProperty("RULES_FIXED", RULES_FIXED);
}

// a dropdown of votes or decisions, or a number between: the rules this script gives the Vote and Decision columns
function strayRule_(rule) {
  var C = SpreadsheetApp.DataValidationCriteria;
  var type = rule.getCriteriaType();
  if (type === C.NUMBER_BETWEEN) return true;
  if (type !== C.VALUE_IN_LIST) return false;
  var list = rule.getCriteriaValues()[0] || [];
  return list.length > 0 && list.every(function (x) {
    return ["yes", "no", "waitlist", "accepted", "denied"].indexOf(String(x).trim().toLowerCase()) !== -1;
  });
}

function lettersFolder_() {
  var found = DriveApp.getFoldersByName(LETTERS_FOLDER);
  return found.hasNext() ? found.next() : DriveApp.createFolder(LETTERS_FOLDER);
}

// "Popescu Ana - ana@example.com.pdf", so the folder sorts by name
function saveLetter_(bytes, email, data) {
  var name =
    clean_(data.last_name) +
    " " +
    clean_(data.first_name) +
    " - " +
    email +
    ".pdf";
  return lettersFolder_()
    .createFile(Utilities.newBlob(bytes, "application/pdf", name))
    .getUrl();
}

// what each form registers for; "presentations" is the older name of the conference
function event_(attend) {
  if (attend === "conference" || attend === "presentations") {
    return {
      name: "the BreaQ Conference",
      what: "the BreaQ Conference on 14 November at the Military Technical Academy “Ferdinand I”",
      next: "the practical details (the programme, the room, how to get in) come by email closer to the date.",
      ics: SITE + "/breaq-2026-conference.ics",
      page: SITE + "/breaq-conference.html",
    };
  }
  return {
    name: "the BreaQ Hackathon",
    what: "the BreaQ Hackathon on 24–25 October at the CAMPUS Research Institute",
    next: "the Discord invite and the practical details (rooms, what to bring, the challenges) come by email closer to the date.",
    ics: SITE + "/breaq-2026-hackathon.ics",
    page: SITE + "/breaq.html",
  };
}

// merge: set when this application updated a registration already there (merge_)
function sendConfirmation_(email, data, merge) {
  var mail = confirmationEmail_(data, merge);
  return send_({
    to: email,
    subject: mail.subject,
    body: mail.text,
    htmlBody: mail.html,
    name: SENDER_NAME,
    replyTo: REPLY_TO,
  });
}

// the confirmation as { subject, text, html }, for sendConfirmation_ and the admin page's preview (mail_)
function confirmationEmail_(data, merge) {
  var name = clean_(data.first_name);
  var ev = event_(data.attend);
  var subject = merge
    ? "Your registration for " + ev.name + " is updated"
    : "You are registered for " + ev.name;
  var again = merge
    ? " We already had a registration from you, so the answers you just sent update it."
    : "";
  var text =
    "Hi " +
    name +
    ",\n\n" +
    "You are registered for " +
    ev.what +
    "." +
    again +
    "\n\n" +
    "What happens next: " +
    ev.next +
    " Registration is free.\n\n" +
    "Add it to your calendar: " +
    ev.ics +
    "\n" +
    "Event page: " +
    ev.page +
    "\n\n" +
    "Questions? Reply to this email.\n\n" +
    "See you there,\nRoQTeam";
  var html =
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#2e3141;max-width:560px">' +
    '<p style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#ff8c00;margin:0 0 6px">BreaQ 2026</p>' +
    '<h2 style="margin:0 0 18px;font-weight:700">You are registered, ' +
    esc_(name) +
    ".</h2>" +
    "<p>You are in for " +
    esc_(ev.what) +
    "." +
    esc_(again) +
    "</p>" +
    "<p>What happens next: " +
    esc_(ev.next) +
    " Registration is free.</p>" +
    '<p style="margin:24px 0"><a href="' +
    ev.ics +
    '" style="background:#4c5c96;color:#fff;text-decoration:none;padding:12px 20px;border-radius:3px;font-weight:700;letter-spacing:1px">Add to calendar</a></p>' +
    '<p style="color:#666">Event page: <a href="' +
    ev.page +
    '" style="color:#4c5c96">' +
    ev.page +
    "</a><br>Questions? Just reply to this email.</p>" +
    "<p>See you there,<br>RoQTeam</p></div>";
  return { subject: subject, text: text, html: html };
}

function sendNotice_(email, data, letterUrl, merge, row, namesake) {
  var lines = [
    clean_(data.first_name) + " " + clean_(data.last_name) + " <" + email + ">",
    namesake
      ? "⚠ The same name as row " + namesake.row + " (" + namesake.email + "), with another email: kept apart as row " +
        row + ". Check whether it is the same person."
      : "",
    // a second application: matched by name, it may be someone else with the same name
    merge
      ? merge.by === "name"
        ? "Applied again with another email, merged by name into row " +
          row +
          ": check it is the same person (the Merged column has the earlier answers)."
        : "Applied again with the same email: row " + row + " updated."
      : "",
    merge && merge.before.length
      ? "Before: " + merge.before.join("; ")
      : "",
    clean_(data.affiliation) +
      " · " +
      clean_(data.status) +
      " · " +
      clean_(data.experience),
    "Attends: " +
      clean_(data.attend) +
      (data.tracks && data.tracks.length
        ? " · Tracks: " + data.tracks.join(", ")
        : ""),
    // the team question (Quantum AI, Quantum Hacking): "solo", "team" with the teammates, or "match"
    data.team === "team"
      ? "With a team: " + clean_(data.team_name)
      : data.team === "match"
        ? "Wants to be put in a team"
        : data.team
          ? "On their own"
          : "",
    data.motivation ? "Motivation: " + clean_(data.motivation) : "",
    data.dietary ? "Dietary: " + clean_(data.dietary) : "",
    letterUrl ? "Motivation letter: " + letterUrl : "",
    "Sheet: " + SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  ].filter(String);
  return send_({
    to: NOTIFY,
    subject:
      "BreaQ 2026 " +
      clean_(data.attend) +
      (merge ? " registration updated: " : " registration: ") +
      clean_(data.first_name) +
      " " +
      clean_(data.last_name),
    body: lines.join("\n"),
    name: SENDER_NAME,
  });
}

// GmailApp first: it sends through the account's Gmail, as the inbox does, where MailApp's messages to outside
// addresses bounced; MailApp stays as the fallback. Returns which one sent, for the "Emails" column.
// where the [sample] emails go: the account running the script, and SAMPLES_TO
function sampleTo_() {
  return [Session.getEffectiveUser().getEmail(), SAMPLES_TO].filter(String).join(", ");
}

function send_(msg) {
  var options = { name: msg.name };
  if (msg.htmlBody) options.htmlBody = msg.htmlBody;
  if (msg.replyTo) options.replyTo = msg.replyTo;
  if (msg.attachments) options.attachments = msg.attachments;
  try {
    GmailApp.sendEmail(msg.to, msg.subject, msg.body, options);
    return "GmailApp";
  } catch (err) {
    console.error("GmailApp failed, trying MailApp: " + err);
    MailApp.sendEmail(msg);
    return "MailApp";
  }
}

// why a first or last name is not just a name ("" when it is): letters of any alphabet, spaces, hyphens,
// apostrophes, a dot after an initial
function nameProblem_(v) {
  var s = String(v || "").trim();
  if (s.length > 80) return "Please write a shorter name: 80 characters at most.";
  if (/https?:|www\.|[@<>\/\\:;=_{}\[\]|#$%^*+~`"0-9]|\.[a-z]{2,}/i.test(s))
    return "Please write just your name, without links, digits or symbols.";
  return "";
}

function clean_(v) {
  return String(v === undefined || v === null ? "" : v)
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
}

// a value for the sheet. Sheets reads text that starts with = + - @ as a formula (one that could send other rows
// to a website when someone opens the sheet), and turns "0721 234 567" into the number 721234567, "1/2" into a
// date, "true" into a checkbox value. A leading apostrophe keeps such text exactly as typed; the apostrophe does
// not show in the cell and is not part of what getValues returns.
function cell_(v) {
  var s = clean_(v);
  return /^[=+\-@]/.test(s) ||
    /^[\d\s().\/:,%-]+$/.test(s) ||
    /^(true|false)$/i.test(s)
    ? "'" + s
    : s;
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c];
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
