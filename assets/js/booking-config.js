// =========================================================
// Amare Aesthetics: booking settings
// Both the website and server.py read this file, so keep the
// part between the outer { } as strict JSON: "quoted" keys,
// no trailing commas, and comments only on their own line.
//
// mode:
//   "auto"     - uses the local server (server.py) when it's running, otherwise demo
//   "api"      - always uses server.py (bookings saved to the database, double-booking blocked)
//   "demo"     - confirmation only, nothing sent (remembers bookings in this browser)
//   "webhook"  - POSTs each booking as JSON to webhookUrl (Formspree, Zapier, Make...)
//   "external" - sends visitors to externalUrl (Square, Vagaro, Boulevard, Calendly...)
// services: duration in minutes; "price" is display text only
// providers: "services" lists service ids ("*" = all); "days" uses 0=Sun ... 6=Sat; hours are 24h "HH:MM"
// =========================================================
window.AMARE_BOOKING = {
  "mode": "auto",
  "webhookUrl": "",
  "externalUrl": "",

  "timezoneLabel": "ET",
  "slotMinutes": 30,
  "daysAhead": 60,
  "minNoticeHours": 12,
  "cancelCutoffHours": 24,

  // Studio closures (YYYY-MM-DD). TODO: update yearly
  "closedDates": ["2026-11-26", "2026-12-25", "2027-01-01"],

  "services": [
    { "id": "consult",     "category": "Consultation", "name": "New Client Consultation", "duration": 30, "price": "Complimentary", "desc": "Meet your provider, review your goals and build a personalized plan." },
    { "id": "neurotoxin",  "category": "Injectables",  "name": "Neurotoxin",             "duration": 30, "price": "From $[TODO] / unit", "desc": "Soften expression lines on the forehead, frown lines and crow's feet." },
    { "id": "lip-filler",  "category": "Injectables",  "name": "Lip Filler",             "duration": 45, "price": "From $[TODO]", "desc": "Hydrate, define and add subtle volume to the lips." },
    { "id": "filler",      "category": "Injectables",  "name": "Dermal Filler",          "duration": 60, "price": "From $[TODO] / syringe", "desc": "Restore volume and contour the cheeks, chin and jawline." },
    { "id": "booster",     "category": "Skin",         "name": "Skin Booster",           "duration": 45, "price": "From $[TODO]", "desc": "Deep hydration that improves texture, glow and elasticity." },
    { "id": "microneedle", "category": "Skin",         "name": "Microneedling",          "duration": 60, "price": "From $[TODO]", "desc": "Collagen induction for scarring, pores and uneven texture." },
    { "id": "peel",        "category": "Skin",         "name": "Chemical Peel",          "duration": 45, "price": "From $[TODO]", "desc": "Customized resurfacing for brightness, clarity and tone." },
    { "id": "iv",          "category": "Wellness",     "name": "IV Wellness Drip",       "duration": 60, "price": "From $[TODO]", "desc": "Restorative vitamin infusions designed around how you want to feel." }
  ],

  "providers": [
    { "id": "founder", "name": "[Founder Name]",  "role": "Founder & Medical Director", "photo": "assets/img/team-1.svg", "services": ["*"],
      "days": [2, 3, 4], "start": "10:00", "end": "17:00" },
    { "id": "rn1",     "name": "[Provider Name]", "role": "Nurse Injector, RN",          "photo": "assets/img/team-2.svg", "services": ["consult", "neurotoxin", "lip-filler", "filler"],
      "days": [1, 2, 3, 4, 5], "start": "09:30", "end": "18:30" },
    { "id": "np1",     "name": "[Provider Name]", "role": "Nurse Practitioner, NP",      "photo": "assets/img/team-3.svg", "services": ["*"],
      "days": [1, 3, 5, 6], "start": "10:00", "end": "18:00" },
    { "id": "esthetician", "name": "[Provider Name]", "role": "Licensed Aesthetician",   "photo": "assets/img/team-4.svg", "services": ["consult", "booster", "microneedle", "peel"],
      "days": [2, 4, 5, 6], "start": "09:00", "end": "16:00" },
    { "id": "rn2",     "name": "[Provider Name]", "role": "Nurse Injector, RN",          "photo": "assets/img/team-5.svg", "services": ["consult", "neurotoxin", "lip-filler", "filler"],
      "days": [3, 4, 5, 6], "start": "11:00", "end": "19:00" },
    { "id": "pa1",     "name": "[Provider Name]", "role": "Physician Assistant, PA",     "photo": "assets/img/team-6.svg", "services": ["*"],
      "days": [1, 2, 5], "start": "09:30", "end": "17:30" }
  ]
};
