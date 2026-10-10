/**
 * BreaQ 2026 registration backend: Google Apps Script.
 *
 * What it does
 *   - receives the JSON that register.html (the hackathon) and register-conference.html post;
 *     the "attend" field says which: "hackathon" or "conference"
 *   - appends one row per registration to a Google Sheet (tab "Registrations")
 *   - saves the hackathon's motivation letter (a PDF) in the Drive folder LETTERS_FOLDER and links it in the row
 *   - sends a confirmation email to the participant and a short notice to the team
 *   - ignores obvious bots (honeypot field, forms submitted in under 3 seconds)
 *   - merges a second application for the same event (the same email, or the same name with another email)
 *     into the row already there, instead of adding a row; the same person registering for both events
 *     gets one row per event. See "Applying twice" below
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
 * The admin page: admin.html reads every registration through this script, for whoever has the admin key.
 * Pick "adminKey" in the editor's function list and press Run: the log shows the key (made on the first run).
 * To change it: Project Settings -> Script properties -> delete ADMIN_KEY, then run adminKey again; the old
 * key stops working at once, no new deployment needed.
 *
 * Applying twice: someone who sends the form again for an event they are already in (the same email, or the
 * same name however it is written, with another email) updates their row. Each new answer replaces the earlier
 * one, an empty answer keeps it, the tracks add up, the newest email becomes "Email" and the earlier ones move
 * to "Other emails". The "Merged" column logs when it happened, why the two were matched and what each changed
 * answer was before, earlier letters included, so a wrong match can be undone by hand. The same form sent twice
 * unchanged (a second click, a retry after a timeout) changes nothing and sends no email.
 * Rows from before this existed: pick "findDuplicates" in the editor's function list and press Run to see in
 * the log what would be merged, then "mergeDuplicates" to merge them. It first copies the tab as a backup,
 * sends no emails and deletes the rows it merged into an earlier one.
 *
 * Decision emails (hackathon only): the admin page's Accept, Waitlist and Deny buttons fill the "Decision"
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
 *   - sendDecisionSamples: sends you one of each email, personal and team, to read before anyone else does.
 * The wording is in decisionEmail_. Someone whose registered teammates got the same decision gets the team
 * version naming them. After changing the wording, deploy a new version for the admin page's button.
 *
 * The team dashboard (teams.html, roqteam.ro/teams): what the organisers post for the hackathon's teams, the
 * announcements, each challenge's resources, how to submit and the practical details, one row each in the tab
 * BOARD_SHEET. The admin page writes it (its "Team dashboard" view); rows can also be typed in the tab by hand.
 * It is for the accepted participants only: each has a personal code, made from their email with a secret kept
 * in the script properties (TEAM_SECRET), which their acceptance email gives with a link that fills it in. A code
 * opens the dashboard only while that person's Decision is "accepted": the waiting list and the denied never get
 * one, and changing an accepted person's decision shuts their code out at once. The organisers open it with the
 * admin key. The admin page shows each accepted person's code (in their full view), for anyone who lost the
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
var SENDER_NAME = "RoQTeam · BreaQ 2026";
var SITE = "https://roqteam.ro";
var LETTERS_FOLDER = "BreaQ 2026 motivation letters"; // Drive folder, created on first use (or by setup)
var LETTER_MAX_BYTES = 5 * 1024 * 1024; // register.js has the same limit

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
  // the hackathon itself, for the accepted: the team the organisers put them in, their answer to "are you coming?"
  // on the team dashboard, the check-in at the door and the certificate emailed after
  "Hackathon team",
  "Coming",
  "Coming answered",
  "Checked in",
  "Certificate",
];

// not the person's answers: a second application that differs only in these changes nothing
var NOT_ANSWERS = [
  "Timestamp",
  "Seconds on page",
  "Page",
  "Emails",
  "Merged",
  "Decision",
  "Decision email",
  "Hackathon team",
  "Coming",
  "Coming answered",
  "Checked in",
  "Certificate",
];

// what the organisers can pick in the "Decision" column; each has its email in decisionEmail_
var DECISIONS = ["accepted", "waitlist", "denied"];
var DECISION_RESERVE = 10; // while registration is open, the sends leave this many of the day's emails for new registrations
var REGISTRATION_CLOSES = "2026-10-19T00:00:00+03:00"; // the end of 18 October: no confirmations to keep emails for after
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
var CHALLENGES = ["Quantum Foundations", "Quantum AI", "Quantum Hacking"];
var TEAMS_PAGE = SITE + "/teams";
var MENTORS_PAGE = SITE + "/mentors";
var CONFIRM_BY = "Wednesday 21 October"; // the acceptance email asks to answer "are you coming?" by then

// the hackathon's teams, one row each; who is in which is the "Hackathon team" column of the registrations
var TEAMS_SHEET = "Teams";
var TEAM_COLUMNS = ["Team", "Challenge", "Table", "Pitch", "Room", "Award"];
var AWARDS = ["1st", "2nd", "3rd"]; // a challenge's podium; the certificate says it

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
  var TEAM_ACTIONS = ["board", "coming", "help", "help-cancel", "feedback"];
  if (TEAM_ACTIONS.indexOf(data.action) !== -1) {
    try {
      var who = dashboardWho_(data.code);
      if (who.denied) return json_(who);
      if (data.action === "board") return json_(board_(who));
      if (who.organiser)
        return json_({
          ok: false,
          action: data.action,
          error: "You are signed in with the admin key: this is for the participants. Their answers show on the admin page.",
        });
      if (data.action === "coming") return json_(coming_(who, data));
      if (data.action === "help") return json_(helpAsk_(who, data));
      if (data.action === "help-cancel") return json_(helpCancel_(who, data));
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

  // admin.html: the registrations, a decision, the decision emails, the team dashboard, the teams, the check-in, the
  // mentors' key and the certificates; all only for the admin key
  var ADMIN_ACTIONS = [
    "list",
    "decide",
    "decisions",
    "board-admin",
    "board-save",
    "board-delete",
    "team-save",
    "team-delete",
    "team-assign",
    "checkin",
    "mentor-key",
    "certificates",
  ];
  if (ADMIN_ACTIONS.indexOf(data.action) !== -1) {
    // an exception here would make Apps Script answer with an HTML error page: send the admin page the reason instead
    var reading = data.action === "list" || data.action === "board-admin";
    try {
      var denied = checkKey_(data.key);
      if (denied) return json_(denied);
      if (data.action === "decide") return json_(decide_(data));
      if (data.action === "decisions") return json_(decisions_(!!data.send));
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
      return json_(list_());
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
  var letterUrl = "";
  var merge = null; // set when this application updates a row already there

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheet_();
    var values = sheet.getDataRange().getValues();
    var header = header_(values);
    var rec = record_(data, email);
    var match = findMatch_(values, header, rec, values.length, {});
    var older = match ? toRecord_(header, values[match.index]) : null;
    // the same PDF as the one already in the row: no second copy in Drive
    if (letter && older && sameLetter_(older["Motivation letter"], letter))
      letter = null;
    // a Drive hiccup must not lose the registration: the row still goes in, with a note instead of the link
    if (letter) {
      try {
        letterUrl = saveLetter_(letter, email, data);
      } catch (err) {
        Logger.log("letter not saved: " + err);
        letterUrl = "upload failed: " + err;
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
  } finally {
    lock.releaseLock();
  }

  // a failed email must not fail the registration, but it has to show: the "Emails" column says what happened
  var sent = [];
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
        "notice sent via " + sendNotice_(email, data, letterUrl, merge, row),
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
        to: me,
        subject: "[sample] " + mail.subject,
        body: mail.text,
        htmlBody: mail.html,
        name: SENDER_NAME,
        replyTo: REPLY_TO,
      });
    });
  });
  Logger.log("Sent " + DECISIONS.length * 2 + " sample emails to " + me);
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
    var team = teamOf_(values, header, p.mates);
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

// the teammates someone named, each with the decision in their own row, found by name among the hackathon
// registrations: { name, decision } ("" not decided yet, null not registered under that name)
function teamOf_(values, header, mates) {
  return mates.map(function (m) {
    var key = nameKey_(m, "");
    for (var i = 1; i < values.length; i++) {
      var t = toRecord_(header, values[i]);
      if (
        eventKey_(t["Attends"]) === "hackathon" &&
        nameKey_(t["First name"], t["Last name"]) === key
      )
        return { name: m, decision: String(t["Decision"]).trim().toLowerCase() };
    }
    return { name: m, decision: null };
  });
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
    heading: "Thank you for applying, " + p.name + ".",
    paras: [
      "We read every application to the BreaQ Hackathon, and there were many more than we have places. We are sorry to tell you that we cannot offer " +
        (team ? "your team" : "you") +
        " a place this year.",
      "It was a hard choice, and we hope you apply again next year.",
      p.conference
        ? "You are registered for the BreaQ Conference on 14 November, and we look forward to seeing you there."
        : "The BreaQ Conference on 14 November, at the Military Technical Academy “Ferdinand I”, is free and open to everyone, and we would be glad to see you there. Registration takes a couple of minutes and closes on 5 November: " +
          SITE +
          "/register-conference.html",
    ],
    button: null,
    sign: "Warm regards,",
  };
}

// a decisionEmail_ as plain text and HTML, in the look of the confirmation email
function renderEmail_(name, t) {
  var linked = function (s) {
    return esc_(s).replace(/https:\/\/[^\s<]*[^\s<.,:;)]/g, function (u) {
      return '<a href="' + u + '" style="color:#4c5c96">' + u + "</a>";
    });
  };
  var text =
    "Hi " +
    name +
    ",\n\n" +
    t.paras.join("\n\n") +
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
    t.paras
      .map(function (s) {
        return "<p>" + linked(s) + "</p>";
      })
      .join("") +
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
    Team: clean_(data.team),
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
  var rec = {};
  header.forEach(function (col) {
    var v = newer[col];
    rec[col] = v === undefined || v === null || v === "" ? older[col] : v;
  });
  rec["Timestamp"] = older["Timestamp"] || newer["Timestamp"];
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

  var when = newer["Timestamp"] instanceof Date ? newer["Timestamp"] : new Date();
  var entry =
    Utilities.formatDate(when, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") +
    " · applied again" +
    (by === "name"
      ? " as " + newer["Email"] + " (same name, another email)"
      : " (same email)") +
    (before.length ? " · before: " + before.join("; ") : "");
  rec["Merged"] = [older["Merged"], newer["Merged"], entry]
    .filter(Boolean)
    .join("\n");
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
function list_() {
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
    mentors: { key: mentorKey_(false), page: MENTORS_PAGE },
    feedback: feedbackRows_(),
    certificate: tpl ? tpl.getUrl() : "",
    sheet: ss.getUrl(),
    emailsLeft: emailsLeft_(),
    at: new Date(),
  };
}

// the admin key: null when it is right, else the answer to send back
function checkKey_(key) {
  var expected =
    PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  if (!expected)
    return {
      ok: false,
      denied: true,
      error:
        "There is no admin key yet: run adminKey once in the Apps Script editor.",
    };
  if (String(key || "") !== expected) {
    Utilities.sleep(1500); // a wrong key costs time, so guessing does not pay
    return { ok: false, denied: true, error: "That key is not right." };
  }
  return null;
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
//     teams: { lower-case name: { name, challenge, table, pitch, room, award, members: [names] } } }
function roster_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("roster");
  if (hit) return JSON.parse(hit);
  var values = sheet_().getDataRange().getValues();
  var header = header_(values);
  var out = { codes: {}, people: [], teams: {} };
  teamsList_().forEach(function (t) {
    out.teams[t.name.toLowerCase()] = merged_(t, { members: [] });
  });
  for (var i = 1; i < values.length; i++) {
    var r = toRecord_(header, values[i]);
    if (!accepted_(r)) continue;
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

// the "Coming" column: "yes", "no", or "" (no answer yet)
function comingOf_(v) {
  v = String(v || "").trim().toLowerCase();
  return v === "yes" || v === "no" ? v : "";
}

// whose dashboard this is: { name, email, at (in roster_().people) } for an accepted participant,
// { organiser: true } for the admin key, else the answer to send back
function dashboardWho_(code) {
  var admin = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  if (admin && String(code || "").trim() === admin)
    return { name: "", organiser: true };
  var key = codeKey_(code);
  var roster = key.length === 8 ? roster_() : null;
  var at = roster ? roster.codes[key] : undefined;
  if (at !== undefined)
    return { name: roster.people[at].name, email: roster.people[at].email, at: at, organiser: false };
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
  return {
    ok: true,
    action: "board",
    items: items,
    who: { name: who.name, organiser: who.organiser },
    me: meOf_(who),
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

// the Teams tab: [{ name, challenge, table, pitch, room, award }], in its order
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
    });
  }
  return out;
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

// null when the key opens the mentor queue (the mentor key or the admin key), else the answer to send back
function checkMentor_(key) {
  var props = PropertiesService.getScriptProperties();
  var k = String(key || "").trim();
  if (k && (k === props.getProperty("MENTOR_KEY") || k === props.getProperty("ADMIN_KEY"))) return null;
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
  if (!where) return fail("Say where you are (your table), so the mentor finds you.");
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
    var mail = certEmail_(who, dashboardCode_(who.email));
    send_({
      to: me,
      subject: "[sample] " + mail.subject,
      body: mail.text,
      htmlBody: mail.html,
      name: SENDER_NAME,
      replyTo: REPLY_TO,
      attachments: [certificatePdf_(tpl, who)],
    });
    return answer({ sample: me });
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
  } else {
    // a sheet made by an older version: add the headers of the newer columns after the last one, past any
    // column the team added by hand (rows are written by header, not by position)
    var have = header_(
      sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues(),
    );
    var missing = COLUMNS.filter(function (col) {
      return have.indexOf(col) === -1;
    });
    if (missing.length)
      sheet
        .getRange(1, have.length + 1, 1, missing.length)
        .setValues([missing])
        .setFontWeight("bold");
    if (missing.indexOf("Decision") !== -1)
      decisionColumn_(sheet, have.concat(missing));
  }
  return sheet;
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
  return send_({
    to: email,
    subject: subject,
    body: text,
    htmlBody: html,
    name: SENDER_NAME,
    replyTo: REPLY_TO,
  });
}

function sendNotice_(email, data, letterUrl, merge, row) {
  var lines = [
    clean_(data.first_name) + " " + clean_(data.last_name) + " <" + email + ">",
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
    // the Quantum AI question: "solo" or "team", with the teammates
    data.team === "team"
      ? "Quantum AI with a team: " + clean_(data.team_name)
      : data.team
        ? "Quantum AI: on their own"
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
