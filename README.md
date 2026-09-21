# RoQTeam

## Entangling Minds. Empowering Romania

RoQTeam is Romania’s hub for quantum curiosity — a community where scientists, students, and dreamers connect to explore the most fascinating frontier of our time. Through events like BreaQ, we turn the mysteries of quantum physics into moments of clarity, creativity, and collaboration. Whether you’re here to learn, to share, or to shape the future, you’re already part of the quantum story we’re writing together.

## Registration form

`register.html` is the sign-up form for BreaQ 2026. It posts JSON to a small Google Apps Script
(`tools/register-backend.gs`) that writes a Google Sheet and sends the confirmation email. Until the
script is deployed, the page sends people to the Google Form in `data-fallback`, so nothing is lost.

Switching it on (about five minutes):

1. Create a Google Sheet, for example "BreaQ 2026 registrations", from the account that should own the data.
2. In the sheet: Extensions -> Apps Script. Replace the editor content with `tools/register-backend.gs`. Save.
3. Deploy -> New deployment -> type "Web app". Execute as: **Me**. Who has access: **Anyone**. Deploy and authorise.
4. Copy the web app URL (it ends in `/exec`) into `register.html`: `data-endpoint="https://script.google.com/macros/s/.../exec"`.
5. Fill the form once on the live site: a row appears in the sheet, a confirmation reaches the email you used and a notice reaches partnerships@roqteam.ro.

Changing the script later: edit, save, then Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy. The URL does not change.

Notes: two emails go out per registration (100 a day on a personal Google account, 1,500 on Google Workspace).
A second registration with the same email does not create a duplicate row. The hidden "website" field and
submissions faster than three seconds are treated as bots and dropped silently.
