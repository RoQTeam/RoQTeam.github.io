# RoQTeam

## Entangling Minds. Empowering Romania

RoQTeam is Romania’s hub for quantum curiosity — a community where scientists, students, and dreamers connect to explore the most fascinating frontier of our time. Through events like BreaQ, we turn the mysteries of quantum physics into moments of clarity, creativity, and collaboration. Whether you’re here to learn, to share, or to shape the future, you’re already part of the quantum story we’re writing together.

## Registration form

`register.html` is the sign-up form for the BreaQ 2026 hackathon and `register-conference.html` the one for the conference. Both post JSON to a small Google Apps Script
(`tools/register-backend.gs`) that writes a Google Sheet and sends the confirmation email. Until the
script is deployed, the page sends people to the Google Form in `data-fallback`, so nothing is lost.

Switching it on (about five minutes):

1. Create a Google Sheet, for example "BreaQ 2026 registrations", from the account that should own the data.
2. In the sheet: Extensions -> Apps Script. Replace the editor content with `tools/register-backend.gs`. Save.
3. Deploy -> New deployment -> type "Web app". Execute as: **Me**. Who has access: **Anyone**. Deploy and authorise.
4. Copy the web app URL (it ends in `/exec`) into both `register.html` and `register-conference.html`: `data-endpoint="https://script.google.com/macros/s/.../exec"`.
5. Fill the form once on the live site: a row appears in the sheet, a confirmation reaches the email you used and a notice reaches registrations@roqteam.ro.

Changing the script later: edit, save, then Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy. The URL does not change.

Notes: two emails go out per registration: the confirmation, and a notice to registrations@roqteam.ro. Google allows 100 a day, on a personal account as on Google for Nonprofits (1,500 on paid Google Workspace). With fewer than 30 left for the day, the notice is left out, so the confirmations keep going, and the "Emails" column says so.

The web app's address is in every form's page, so the script itself guards what anyone can send it:

- **Deadlines:** nothing after the deadlines (the hackathon: 18 October; the conference: 5 November). Late registrations come by email.
- **Names:** only names that are names, with no links, addresses, digits or symbols, so nobody can put their own words in a confirmation email.
- **The same name with another email:** this no longer merges into the row already there. It goes in as a row of its own, marked ⚠ in "Merged" and listed under **Problems** on the admin page. If it is the same person, merge the two rows by hand.
- **Repeat confirmations:** at most one per address and event every 6 hours.
- **A flood of registrations:** past 25 registrations in an hour, their emails are held ("emails held" in "Emails", and listed under **Problems**). Past 60 new ones in an hour, the form is refused.
Someone who applies again for the same event, with the same email or with the same name and another email, updates their row instead of adding one: new answers replace the earlier ones, the tracks add up, every email they used is kept ("Email" and "Other emails"), and the "Merged" column logs what changed. The hackathon and the conference each get their own row, told apart by the Attends column. To merge the duplicates already in the sheet, run `findDuplicates` in the Apps Script editor to see what would be merged, then `mergeDuplicates` (it copies the tab first). The hidden "website" field and
submissions faster than three seconds are treated as bots and dropped silently.

## Votes

The five organisers (Andy, Cristi, Alex, Filip, Tudor) vote **Yes** or **No** on every hackathon registration, on the admin page. Three of the same vote make the decision: three Yes is accepted, three No is denied. Five is an odd number, so once everyone has voted, one side always has the majority.

- **Your own key.** In the Apps Script editor's function list pick `voterKeys` and press Run: the log shows each person's key. Give each one only theirs, as it votes in their name. A personal key opens everything the admin key opens (the admin page, the team dashboard, the mentor queue). The shared admin key still opens the page and shows the votes, but cannot vote.
- **Voting.** The table's Vote column has your Yes and No (pressing yours again takes it back), then a tag for each of you: green for yes, red and struck through for no, empty for not yet. Hover over the tags to see the names; the full view lists them. **To vote** above the table shows the registrations you have not voted on yet. In the **Teams** tab, the row above a team votes for all its members at once.
- **The sheet.** Each vote goes in its own column ("Vote Andy", …), next to "Decision". The vote that makes the third Yes or the third No sets the Decision. Taking a vote back so that neither side has three makes it undecided again. Typing a vote into the sheet by hand changes no Decision: vote on the admin page.
- **By hand.** For the exceptions (the waiting list, a tie while someone is away), the full view still has **Decide by hand**. That decision stays until a vote next makes or undoes a majority. The table marks it "by hand".
- **After an email.** A vote that would change the decision of someone already emailed asks first, as a change by hand does.

To change someone's key: Project Settings -> Script properties -> delete their `VOTE_KEY_<NAME>` (for example `VOTE_KEY_ANDY`), then run `voterKeys` again. The old key stops working at once. The names are `VOTERS` in `tools/register-backend.gs`.

## On their own or in a team

With Quantum AI or Quantum Hacking ticked, the hackathon form asks: **On my own**, **With a team I already have** (with the teammates' names) or **Put me in a team** (the organisers match them with others). The answer goes in the "Team" column (`solo`, `team`, `match`), and the admin page's **To match** tab lists who asked to be put in a team.

Quantum Hacking became a team challenge after people had registered for it, so one email asks each of them how they want to take part. In the Apps Script editor's function list:

- `previewHackingTeams` logs who would get it, with what their form says now. Sends nothing.
- `sendHackingTeamsSample` sends you the email (on your own, then with a team), to read first.
- `sendHackingTeams` emails every hackathon registration with the Quantum Hacking track, once each, except the denied. The "Emails" column records it. It stops before the day's emails run out (keeping 10 for new registrations until 18 October): run it again the next day for the rest.

The email's button opens `team-choice.html` (roqteam.ro/team-choice) with the person's own code, the same as their dashboard code (which opens the dashboard only once they are accepted). There they choose. The answer replaces "Team" and "Team name and members", and "Merged" logs what it replaced. The email asks for the answer, and the teammates' registrations, by Friday 16 October (`HACKING_BY` in the script). Paste the current `tools/register-backend.gs` and deploy a new version before sending, so the page can save the answers.

## Decision emails

Hackathon applicants hear back from the same script, when the organisers choose:

- The votes fill the "Decision" column of the sheet, and so do **Accept**, **Waitlist** and **Deny** by hand (in the full view, under **Decide by hand**). Nothing is sent.
- **Send decision emails** first shows who gets what: how many of each, the teams held back because their registered members are not all decided the same (one accepted and another waitlisted, denied or undecided: no one in that team is emailed until they match), and what to check (a teammate not registered under the name given, a team over 3). Then it sends each person the email for their decision, once, and the "Decision email" column records it. Changing a decision after its email asks first, and the next send emails the new one.
- It sends the accepted first, then the waiting list, then the denied. If the day's emails run out, those left are the denied, and Send the next day carries on; before sending, it says what goes out today and what waits. While registration is open, it keeps 10 of the day's emails for new registrations; after 18 October it uses them all. With about 150 registrations, the accepted and the waiting list hear on the first day and the rest of the denied on the second.

The same can be done from the Apps Script editor: `previewDecisions`, `sendDecisions`, and `sendDecisionSamples`, which sends you one of each email (personal and team version) to read first. The wording is in `decisionEmail_` in `tools/register-backend.gs`; after changing it, deploy a new version so the admin page's button uses it.

## Admin page

`admin.html` (roqteam.ro/admin) shows the registrations for the organisers: counts, registrations per day, what people answered (status, experience, tracks, T-shirts, universities, dietary needs) and the full list, searchable, with every registration in full, the emails to copy into Bcc and a CSV download. It reads the sheet through the same Apps Script, which answers only to the admin key or an organiser's own key.

Switching it on, once:

1. Paste the current `tools/register-backend.gs` into the Apps Script editor and save, then Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy. The URL does not change.
2. In the editor's function list pick `voterKeys` and press Run: the log shows each organiser's own key (see **Votes**). `adminKey` gives the shared key, which does not vote.
3. Open roqteam.ro/admin and paste your key. "Remember on this device" keeps it in that browser; otherwise it is forgotten when the tab closes.

To change the key (someone leaves the team, it was shared too widely): Project Settings -> Script properties -> delete `ADMIN_KEY`, then run `adminKey` again. The old key stops working at once.

The page keeps the registrations in memory only and drops them on Lock. The "Letter" links open the PDFs in the Drive of the account that owns the script: share the "BreaQ 2026 motivation letters" folder with whoever reviews them.

## Team dashboard

`teams.html` (roqteam.ro/teams) is the page for the hackathon's accepted teams: what is on now and next with the countdown to "Stop coding", the announcements (pinned first, then newest first; the page checks every minute and marks what is new), each challenge's resources, how to submit, the practical details (Wi-Fi, Discord, who to ask) and the schedule. Every time is in Bucharest time.

Only the accepted participants get in. Each has a personal code, which their acceptance email gives with a link that fills it in; the waiting list and the denied never get one. A code opens the dashboard only while that person's Decision is "accepted", so changing it shuts their code out at once, and someone accepted later gets in with the code in their new email. Someone lost the email? Their code is in their full view on the admin page (Registrations, then their name), with "Copy their link"; `dashboardCodes` in the Apps Script editor logs them all. The organisers open the dashboard with the admin key.

The organisers post from the admin page: **Team dashboard** at the top, then write, edit, pin or delete. Everything is kept in the "Team dashboard" tab of the same sheet, so rows can also be fixed there by hand.

Switching it on: paste the current `tools/register-backend.gs` into the Apps Script editor and deploy a new version (as for the admin page), before the decision emails go out, so the acceptance emails carry the link and each person's code. The schedule on the dashboard is in `assets/js/teams.js` (SCHEDULE). It is the draft schedule, not yet on `breaq-hackathon.html`: check it before the event, and keep the two the same once the schedule goes on the hackathon page.

Each participant also sees what is theirs:

- **Are you coming?** Until the event starts. The acceptance email asks for an answer by Wednesday 21 October (`CONFIRM_BY` in the script and in `teams.js`). Answers go in the "Coming" column, and the admin page counts them on **Teams** and **Check-in**: someone who cannot come frees a place for the waiting list.
- **Your team.** Its name, challenge, table, teammates and pitch time, from the admin page's **Teams** view. There, *Make teams from the registrations* puts the accepted people who registered together into a team each; *New team*, *Add someone* and *Put in a team* do the rest. Teams are kept in the sheet's "Teams" tab, and who is in which in the "Hackathon team" column. A team's place (1st, 2nd, 3rd in its challenge) goes on the certificates and shows on the dashboard after the awards.
- **Ask a mentor.** During the hackathon. A team asks with a line about what it is stuck on and where it sits (one request at a time), sees its place in the line, and sees who is on the way. The mentors work from `mentors.html` (roqteam.ro/mentors): the requests oldest first, "On my way", "Done" or "Put back". Their link carries the mentor key, which opens the queue and nothing else. Copy it on the admin page (**Team dashboard**, then *Mentors*), which can also change the key, or run `mentorKey` in the editor. Requests are kept in the "Mentor queue" tab.
- **Before you come.** A checklist the organisers post like the rest (Checklist, on **Team dashboard**): what to install, which accounts to make, what to pack. Each item is for every challenge or for one, and each participant ticks them off on their own device.
- **How was it?** From the awards on, a feedback form: 1 to 5, what worked, what to change, would you come again. Answers go in the "Feedback" tab without names. The admin page shows them under **After the event**.
- **Notifications** ("Notify me"). New announcements, a mentor on the way, what starts in 5 minutes, and 15 minutes before coding stops. They work while the dashboard is open, also in a background tab, on laptops and Android. iPhones show web notifications only for sites added to the home screen, so Discord covers them.

**Check-in** (admin page): type a name, press Enter or *Check in*. The tiles count who is here, who is not yet and who said they cannot come. The rows of people not here yet carry their phone number.

**Certificates** (admin page, **After the event**): a PDF for each accepted participant checked in at the door, emailed once, made from a Google Slides template with their name, team, challenge and place. Before the first send, pick `certificateTemplate` in the editor's function list and press Run once. It asks for permission to use Slides, makes a starter template in Drive and logs its link. Restyle it, keeping the `{{…}}` fields, then use *Send me a sample*. A copy of each certificate sent is kept in the Drive folder "BreaQ 2026 certificates", and the email links to the feedback form.
