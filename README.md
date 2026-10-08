# Amare Aesthetics — local website

Plain HTML/CSS/JS pages plus a small Python server (`server.py`) for logins and bookings.
It uses only Python's standard library, so there's nothing to install.

## Run it
```bash
cd ~/Desktop/amareaesthetics
python3 server.py
```
Then open http://localhost:8000. Stop the server with Ctrl+C.
Use `python3 server.py --port 8080` for a different port.

You can still open the `.html` files directly, but logins need the server. Booking falls back to demo mode without it.

## Pages
| Page | File | Sub-links |
|---|---|---|
| Home | `index.html` | |
| About | `about.html` | `#team` (Leadership), `#faq` (FAQs), `#testimonials` |
| Services | `services.html` | `#injectables`, `#skin`, `#wellness`, `#pricing` |
| Providers | `providers.html` | `lookbook.html`, `provider-login.html` |
| Contact | `contact.html` | `book.html`, `contact-botox-party.html`, `partnerships.html`, `#gift-cards` |
| Client login | `login.html` → `account.html` | |
| Provider & staff login | `provider-login.html` → `provider-portal.html` or `admin.html` | |
| Legal | `terms-of-use.html`, `privacy-policy.html` | |

## Logins
There are three personas, each with its own portal:

| Persona | Signs in at | Lands on | Can do |
|---|---|---|---|
| **Client** | `login.html` (or creates an account there) | `account.html` | See upcoming and past appointments, cancel (up to `cancelCutoffHours` before), book, edit profile, change password |
| **Provider** | `provider-login.html` | `provider-portal.html` | See their own day-by-day schedule and next 14 days, view client contact details and notes, mark appointments complete or cancelled, change password |
| **Admin** (studio manager) | `provider-login.html` | `admin.html` | Stats; all bookings with filters (date, provider, status, search); complete or cancel any booking; add users of any role; deactivate or reactivate users; reset passwords |

- **Demo accounts:** the first time the server starts, it creates `data/seed.json` from `data/seed.template.json`, giving each demo account a random password, and loads it. Find the logins in `data/seed.json`. That file and the database are git-ignored, so passwords and client data never reach GitHub. To reset to fresh demo data, stop the server, delete `data/amare.db` (and `data/seed.json` too if you want new passwords), and start it again.
- **Guest bookings:** a client who booked as a guest and later creates an account with the same email sees those bookings in their account.
- **New providers:** an admin adds a provider in the Users tab and links them to a provider `id` in `booking-config.js`. That link decides whose schedule they see.
- **Wrong login page:** client accounts can only sign in on `login.html`, and staff accounts only on `provider-login.html`.

**Security built in:**
- Passwords are hashed with PBKDF2-SHA256, and login cookies are HttpOnly, SameSite.
- Sign-in locks for 15 minutes after 5 failed attempts.
- The server checks permissions on every request, not just in the browser.
- The API only accepts JSON, which blocks cross-site form attacks.
- `data/`, `server.py` and hidden files are never served to browsers.

## Online booking (`book.html`)
The booking flow goes Service → Provider → Date & Time → Your Details → Review → Confirmation, with an "Add to calendar" (.ics) download at the end.

**Everything you'd change is in `assets/js/booking-config.js`.** Both the site and the server read this file, so keep the `{ … }` part strict JSON: quoted keys, no trailing commas, comments only on their own line. The server reports an error at startup if the file isn't valid.
- `services`: name, category, duration (minutes), display price, description
- `providers`: which services each one offers, working days and hours, photo
- `slotMinutes`, `daysAhead`, `minNoticeHours`, `cancelCutoffHours`, `closedDates`, `timezoneLabel`
- `mode`: where bookings go:
  - `"auto"` (default): uses the server when it's running (bookings are saved in `data/amare.db` and double-booking is blocked), otherwise demo
  - `"api"`: always uses the server
  - `"demo"`: shows the confirmation only and nothing is sent
  - `"webhook"`: POSTs each booking as JSON to `webhookUrl` (Formspree, Zapier, Make…)
  - `"external"`: sends visitors to `externalUrl` instead (Square Appointments, Vagaro, Boulevard, Calendly…)

**Deep links:** `book.html?service=neurotoxin` and `book.html?provider=rn1` skip ahead with the choice already made. The site's "Book" buttons already use these.

Signed-in clients get their details pre-filled, and their bookings appear in **My Account**.

## Design
The design uses a black/charcoal palette with white text, a fixed 268px left sidebar on desktop (it becomes a top bar with a menu button on mobile), a full-screen hero and a dark footer with a newsletter band.
Fonts are Montserrat (body) and Playfair Display (headings), both free on Google Fonts. If you license a different display font, change `--font-display`.

## Customizing
- **Brand colors and fonts:** edit the `:root` block at the top of `assets/css/styles.css`.
- **Hero video:** each hero has a commented-out `<video>` tag. Put an `.mp4` in `assets/video/`, uncomment the tag and remove the `<img class="hero__media">` line.
- **Content:** search the project for `[TODO]` to find every placeholder (phone, address, bios, prices, testimonials, policies).
- **Images:** the files in `assets/img/` are labeled SVG placeholders. Replace them with your photos (keep the same file names, or update the `src` attributes).
- **Header and footer:** these are repeated in every page. When you change a nav link, use find-and-replace across all `.html` files.
- **Forms:** the contact, party and partnership forms only show a confirmation message for now. Connect them to a form service (Formspree, Mailchimp, etc.) before going live. See `assets/js/main.js`.

## Before going live
The server is built for running on your laptop. Before real clients use it:
1. **Hosting + HTTPS:** run it behind HTTPS and set `AMARE_SECURE_COOKIES=1` so login cookies are only sent over HTTPS.
2. **Remove demo accounts:** start with a fresh database. Edit `data/seed.json` so it only contains your real admin account with a strong password, or create users from the admin portal and deactivate the demo ones.
3. **HIPAA:** appointment and contact details for a medical practice are protected health information. Host with a provider that will sign a BAA, keep backups of `data/amare.db` encrypted, and limit admin accounts.
4. **Email:** confirmation and reminder emails and password-reset emails aren't wired up yet. Admins can reset passwords from the portal in the meantime.
5. **Alternative:** if you'd rather not run your own server, set booking `mode` to `"external"` and use your booking platform's own client and staff logins.
