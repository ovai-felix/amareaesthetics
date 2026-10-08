// Amare Aesthetics: booking flow
// Steps: service -> provider -> date & time -> details -> review -> confirmation
// Settings and data live in booking-config.js.
(function () {
  var CFG = window.AMARE_BOOKING;
  var root = document.getElementById("booking");
  if (!CFG || !root) return;

  var STEPS = ["Service", "Provider", "Date & Time", "Your Details", "Review"];
  var STORE_KEY = "amare-demo-bookings";
  var state = { step: 0, service: null, provider: null, date: null, time: null, assigned: null, details: {}, query: "" };
  var viewMonth = startOfMonth(new Date());
  var mode = CFG.mode;            // resolved at startup ("auto" becomes "api" or "demo")
  var busyCache = {};             // api mode: date -> [{providerId, time, duration}]
  var loadedMonths = {};          // api mode: "YYYY-MM" -> promise

  // ---------- helpers ----------
  function el(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseYmd(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function toMin(hhmm) { var p = hhmm.split(":"); return +p[0] * 60 + +p[1]; }
  function fromMin(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
  function fmtTime(hhmm) {
    var m = toMin(hhmm), h = Math.floor(m / 60), mm = m % 60;
    return ((h + 11) % 12 + 1) + ":" + pad(mm) + (h < 12 ? " AM" : " PM");
  }
  function fmtDate(s, opts) { return parseYmd(s).toLocaleDateString(undefined, opts || { weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function offers(p, serviceId) { return p.services.indexOf("*") > -1 || p.services.indexOf(serviceId) > -1; }

  function loadBookings() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; } }
  function saveBooking(b) { try { var all = loadBookings(); all.push(b); localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch (e) { /* storage unavailable */ } }

  // ---------- availability ----------
  function eligibleProviders() {
    if (!state.service) return [];
    return CFG.providers.filter(function (p) { return offers(p, state.service.id); });
  }
  function candidateProviders() {
    return state.provider === "any" ? eligibleProviders() : [byId(CFG.providers, state.provider)].filter(Boolean);
  }
  // Returns { "HH:MM": [providerIds] } for a date
  function slotsFor(dateStr) {
    var out = {};
    var d = parseYmd(dateStr);
    if (CFG.closedDates.indexOf(dateStr) > -1) return out;
    var earliest = Date.now() + CFG.minNoticeHours * 3600e3;
    var dur = state.service.duration;
    var booked = mode === "api" ? (busyCache[dateStr] || []) : loadBookings().filter(function (b) { return b.date === dateStr; });
    candidateProviders().forEach(function (p) {
      if (p.days.indexOf(d.getDay()) === -1) return;
      for (var m = toMin(p.start); m + dur <= toMin(p.end); m += CFG.slotMinutes) {
        var startTs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60).getTime();
        if (startTs < earliest) continue;
        var clash = booked.some(function (b) {
          return b.providerId === p.id && m < toMin(b.time) + b.duration && toMin(b.time) < m + dur;
        });
        if (clash) continue;
        var key = fromMin(m);
        (out[key] = out[key] || []).push(p.id);
      }
    });
    return out;
  }
  function loadMonth(month) {
    if (mode !== "api") return Promise.resolve();
    var key = month.getFullYear() + "-" + pad(month.getMonth() + 1);
    if (!loadedMonths[key]) {
      var last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      loadedMonths[key] = window.Amare.api("/api/busy?from=" + ymd(month) + "&to=" + ymd(last)).then(function (r) {
        // Clear the month first so a refetch drops cancelled bookings
        for (var dd = new Date(month); dd <= last; dd.setDate(dd.getDate() + 1)) busyCache[ymd(dd)] = [];
        r.busy.forEach(function (b) { busyCache[b.date].push(b); });
      }, function (err) { delete loadedMonths[key]; throw err; });
    }
    return loadedMonths[key];
  }
  function refreshMonth(month) {
    delete loadedMonths[month.getFullYear() + "-" + pad(month.getMonth() + 1)];
    return loadMonth(month);
  }

  function dayBookable(d) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var last = new Date(today); last.setDate(last.getDate() + CFG.daysAhead);
    if (d < today || d > last) return false;
    return Object.keys(slotsFor(ymd(d))).length > 0;
  }

  // ---------- layout ----------
  root.innerHTML =
    '<ol class="bk-steps" aria-label="Booking progress"></ol>' +
    '<div class="bk-layout">' +
    '  <div class="bk-panel" aria-live="polite"></div>' +
    '  <aside class="bk-summary" aria-label="Your appointment"></aside>' +
    "</div>";
  var stepsEl = root.querySelector(".bk-steps");
  var panel = root.querySelector(".bk-panel");
  var summary = root.querySelector(".bk-summary");

  function go(step) {
    state.step = step;
    render();
    var top = root.getBoundingClientRect().top + window.scrollY - 90;
    if (window.scrollY > top) window.scrollTo({ top: top, behavior: "smooth" });
  }

  function render() {
    stepsEl.innerHTML = STEPS.map(function (s, i) {
      var cls = i === state.step ? "is-current" : i < state.step ? "is-done" : "";
      var inner = i < state.step ? '<button type="button" data-goto="' + i + '">' + esc(s) + "</button>" : "<span>" + esc(s) + "</span>";
      return '<li class="' + cls + '"' + (i === state.step ? ' aria-current="step"' : "") + '><span class="bk-num">' + (i + 1) + "</span>" + inner + "</li>";
    }).join("");
    stepsEl.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () { go(+b.getAttribute("data-goto")); });
    });
    [renderService, renderProvider, renderDateTime, renderDetails, renderReview][state.step]();
    renderSummary();
  }

  function renderSummary() {
    var s = state.service, rows = [];
    rows.push(row("Service", s ? esc(s.name) + '<small>' + s.duration + " min · " + esc(s.price) + "</small>" : "—"));
    var pName = "—";
    if (state.assigned) pName = esc(byId(CFG.providers, state.assigned).name);
    else if (state.provider === "any") pName = "First available";
    else if (state.provider) pName = esc(byId(CFG.providers, state.provider).name);
    rows.push(row("Provider", pName));
    rows.push(row("Date", state.date ? esc(fmtDate(state.date)) : "—"));
    rows.push(row("Time", state.time ? esc(fmtTime(state.time)) + " " + esc(CFG.timezoneLabel) : "—"));
    summary.innerHTML = '<p class="bk-summary__title">Your appointment</p>' + rows.join("") +
      '<p class="bk-summary__note">You won\'t be charged to book. Final pricing is confirmed at your visit.</p>';
    function row(k, v) { return '<div class="bk-summary__row"><span>' + k + "</span><strong>" + v + "</strong></div>"; }
  }

  function head(title, sub) {
    return '<div class="bk-head"><h2>' + esc(title) + "</h2>" + (sub ? '<p class="body-copy">' + sub + "</p>" : "") + "</div>";
  }
  function nav(backTo, nextLabel, nextEnabled) {
    return '<div class="bk-nav">' +
      (backTo != null ? '<button type="button" class="btn btn--outline" data-back>Back</button>' : "<span></span>") +
      (nextLabel ? '<button type="button" class="btn btn--white" data-next' + (nextEnabled ? "" : " disabled") + ">" + esc(nextLabel) + "</button>" : "") +
      "</div>";
  }
  function wireNav(backTo, onNext) {
    var b = panel.querySelector("[data-back]"); if (b) b.addEventListener("click", function () { go(backTo); });
    var n = panel.querySelector("[data-next]"); if (n) n.addEventListener("click", onNext);
  }

  // ---------- step 1: service ----------
  function renderService() {
    var cats = [];
    CFG.services.forEach(function (s) { if (cats.indexOf(s.category) === -1) cats.push(s.category); });
    panel.innerHTML = head("Select a service", "New to Amare? Start with a consultation.") +
      '<div class="bk-search"><input type="search" placeholder="Search services" aria-label="Search services" value="' + esc(state.query) + '"></div>' +
      '<div class="bk-list"></div>';
    var list = panel.querySelector(".bk-list");
    var input = panel.querySelector(".bk-search input");
    function draw() {
      var q = state.query.toLowerCase();
      var html = "";
      cats.forEach(function (c) {
        var items = CFG.services.filter(function (s) {
          return s.category === c && (!q || (s.name + " " + s.desc + " " + s.category).toLowerCase().indexOf(q) > -1);
        });
        if (!items.length) return;
        html += '<p class="bk-cat">' + esc(c) + "</p>" + items.map(function (s) {
          var sel = state.service && state.service.id === s.id;
          return '<button type="button" class="bk-option' + (sel ? " is-selected" : "") + '" data-id="' + s.id + '" aria-pressed="' + sel + '">' +
            '<span class="bk-option__main"><strong>' + esc(s.name) + "</strong><small>" + esc(s.desc) + "</small></span>" +
            '<span class="bk-option__meta">' + s.duration + " min<br>" + esc(s.price) + "</span></button>";
        }).join("");
      });
      list.innerHTML = html || '<p class="muted">No services match "' + esc(state.query) + '".</p>';
      list.querySelectorAll(".bk-option").forEach(function (b) {
        b.addEventListener("click", function () {
          var s = byId(CFG.services, b.getAttribute("data-id"));
          if (!state.service || state.service.id !== s.id) {
            state.service = s; state.date = state.time = state.assigned = null;
            if (state.provider && state.provider !== "any" && !offers(byId(CFG.providers, state.provider), s.id)) state.provider = null;
          }
          go(1);
        });
      });
    }
    input.addEventListener("input", function () { state.query = input.value; draw(); });
    draw();
  }

  // ---------- step 2: provider ----------
  function renderProvider() {
    var ps = eligibleProviders();
    var anySel = state.provider === "any";
    panel.innerHTML = head("Choose your provider", "Every provider offering " + esc(state.service.name) + " is shown.") +
      '<div class="bk-providers">' +
      '<button type="button" class="bk-provider bk-provider--any' + (anySel ? " is-selected" : "") + '" data-id="any" aria-pressed="' + anySel + '">' +
      '<span class="bk-provider__avatar">✦</span><span><strong>First available</strong><small>See the most open times</small></span></button>' +
      ps.map(function (p) {
        var sel = state.provider === p.id;
        return '<button type="button" class="bk-provider' + (sel ? " is-selected" : "") + '" data-id="' + p.id + '" aria-pressed="' + sel + '">' +
          '<img src="' + esc(p.photo) + '" alt="">' +
          "<span><strong>" + esc(p.name) + "</strong><small>" + esc(p.role) + "</small></span></button>";
      }).join("") + "</div>" + nav(0);
    panel.querySelectorAll(".bk-provider").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-id");
        if (state.provider !== id) { state.provider = id; state.date = state.time = state.assigned = null; }
        go(2);
      });
    });
    wireNav(0);
  }

  // ---------- step 3: date & time ----------
  function renderDateTime() {
    panel.innerHTML = head("Pick a date & time", "Times shown in " + esc(CFG.timezoneLabel) + ".") +
      '<div class="bk-dt"><div class="bk-cal"></div><div class="bk-times"></div></div>' + nav(1, "Continue", !!state.time);
    panel.querySelector(".bk-cal").innerHTML = '<p class="muted">Loading availability…</p>';
    loadMonth(viewMonth).then(function () { drawCalendar(); drawTimes(); }, function (err) {
      panel.querySelector(".bk-cal").innerHTML = '<p class="form-note bk-error">' + esc(err.message) + "</p>";
    });
    wireNav(1, function () { go(3); });
  }
  function drawCalendar() {
    var cal = panel.querySelector(".bk-cal");
    var today = startOfMonth(new Date());
    var maxMonth = startOfMonth(new Date(Date.now() + CFG.daysAhead * 864e5));
    var first = viewMonth.getDay();
    var days = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    var cells = "";
    for (var i = 0; i < first; i++) cells += "<span></span>";
    for (var dnum = 1; dnum <= days; dnum++) {
      var d = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), dnum);
      var key = ymd(d), ok = dayBookable(d), sel = state.date === key;
      cells += '<button type="button" class="bk-day' + (sel ? " is-selected" : "") + '" data-date="' + key + '"' +
        (ok ? "" : " disabled") + ' aria-label="' + esc(fmtDate(key)) + (ok ? "" : ", unavailable") + '" aria-pressed="' + sel + '">' + dnum + "</button>";
    }
    cal.innerHTML =
      '<div class="bk-cal__head">' +
      '<button type="button" class="bk-cal__nav" data-m="-1" aria-label="Previous month"' + (viewMonth <= today ? " disabled" : "") + ">←</button>" +
      "<strong>" + viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" }) + "</strong>" +
      '<button type="button" class="bk-cal__nav" data-m="1" aria-label="Next month"' + (viewMonth >= maxMonth ? " disabled" : "") + ">→</button></div>" +
      '<div class="bk-cal__dow">' + ["S", "M", "T", "W", "T", "F", "S"].map(function (x) { return "<span>" + x + "</span>"; }).join("") + "</div>" +
      '<div class="bk-cal__grid">' + cells + "</div>";
    cal.querySelectorAll("[data-m]").forEach(function (b) {
      b.addEventListener("click", function () {
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + +b.getAttribute("data-m"), 1);
        b.disabled = true;
        loadMonth(viewMonth).then(drawCalendar, function (err) {
          cal.innerHTML = '<p class="form-note bk-error">' + esc(err.message) + "</p>";
        });
      });
    });
    cal.querySelectorAll(".bk-day:not([disabled])").forEach(function (b) {
      b.addEventListener("click", function () {
        state.date = b.getAttribute("data-date"); state.time = state.assigned = null;
        drawCalendar(); drawTimes(); renderSummary(); toggleNext();
      });
    });
  }
  function drawTimes() {
    var wrap = panel.querySelector(".bk-times");
    if (!state.date) { wrap.innerHTML = '<p class="muted bk-times__empty">Select a date to see available times.</p>'; return; }
    var slots = slotsFor(state.date), keys = Object.keys(slots).sort();
    var groups = [["Morning", 0, 720], ["Afternoon", 720, 1020], ["Evening", 1020, 1440]];
    wrap.innerHTML = '<p class="bk-times__date">' + esc(fmtDate(state.date)) + "</p>" + groups.map(function (g) {
      var ks = keys.filter(function (k) { var m = toMin(k); return m >= g[1] && m < g[2]; });
      if (!ks.length) return "";
      return '<p class="bk-cat">' + g[0] + '</p><div class="bk-slots">' + ks.map(function (k) {
        var sel = state.time === k;
        return '<button type="button" class="bk-slot' + (sel ? " is-selected" : "") + '" data-time="' + k + '" aria-pressed="' + sel + '">' + fmtTime(k) + "</button>";
      }).join("") + "</div>";
    }).join("");
    wrap.querySelectorAll(".bk-slot").forEach(function (b) {
      b.addEventListener("click", function () {
        state.time = b.getAttribute("data-time");
        state.assigned = slots[state.time][0];
        drawTimes(); renderSummary(); toggleNext();
      });
    });
  }
  function toggleNext() { var n = panel.querySelector("[data-next]"); if (n) n.disabled = !state.time; }

  // ---------- step 4: details ----------
  function renderDetails() {
    var d = state.details;
    function f(label, name, type, req, auto) {
      return '<div class="field"><label for="bk-' + name + '">' + label + (req ? "" : ' <span class="muted">(optional)</span>') + "</label>" +
        '<input id="bk-' + name + '" name="' + name + '" type="' + type + '"' + (req ? " required" : "") + (auto ? ' autocomplete="' + auto + '"' : "") + ' value="' + esc(d[name]) + '"></div>';
    }
    panel.innerHTML = head("Your details", "We'll send your confirmation and reminders here.") +
      '<form class="form bk-form" novalidate>' +
      '<div class="form-row">' + f("First name", "first", "text", true, "given-name") + f("Last name", "last", "text", true, "family-name") + "</div>" +
      '<div class="form-row">' + f("Email", "email", "email", true, "email") + f("Phone", "phone", "tel", true, "tel") + "</div>" +
      '<div class="field"><span class="label">Have you visited Amare before?</span><div class="choices">' +
      '<label><input type="radio" name="returning" value="no"' + (d.returning !== "yes" ? " checked" : "") + "> First visit</label>" +
      '<label><input type="radio" name="returning" value="yes"' + (d.returning === "yes" ? " checked" : "") + "> Returning client</label></div></div>" +
      '<div class="field"><label for="bk-notes">Anything we should know? <span class="muted">(optional)</span></label><textarea id="bk-notes" name="notes" rows="4" maxlength="1000">' + esc(d.notes) + "</textarea></div>" +
      '<label class="check"><input type="checkbox" name="policy" required' + (d.policy ? " checked" : "") + '> I agree to the <a class="link" href="terms-of-use.html" target="_blank">cancellation policy and Terms of Use</a>.</label>' +
      '<label class="check"><input type="checkbox" name="sms"' + (d.sms ? " checked" : "") + "> Send me appointment reminders by text.</label>" +
      '<p class="form-note bk-error" role="alert"></p>' +
      "</form>" + nav(2, "Review booking", true);
    var form = panel.querySelector("form");
    wireNav(2, function () {
      var err = panel.querySelector(".bk-error");
      var fd = new FormData(form), data = {};
      fd.forEach(function (v, k) { data[k] = typeof v === "string" ? v.trim() : v; });
      data.policy = form.policy.checked; data.sms = form.sms.checked;
      state.details = data;
      var missing = [];
      if (!data.first) missing.push("first name");
      if (!data.last) missing.push("last name");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || "")) missing.push("a valid email");
      if ((data.phone || "").replace(/\D/g, "").length < 10) missing.push("a valid phone number");
      if (!data.policy) missing.push("agreement to the cancellation policy");
      if (missing.length) { err.textContent = "Please add " + missing.join(", ") + "."; return; }
      go(4);
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); panel.querySelector("[data-next]").click(); });
  }

  // ---------- step 5: review ----------
  function renderReview() {
    var s = state.service, p = byId(CFG.providers, state.assigned), d = state.details;
    panel.innerHTML = head("Review & confirm") +
      '<dl class="bk-review">' +
      item("Service", esc(s.name) + " · " + s.duration + " min") +
      item("Provider", esc(p.name) + ", " + esc(p.role)) +
      item("When", esc(fmtDate(state.date)) + " at " + esc(fmtTime(state.time)) + " " + esc(CFG.timezoneLabel)) +
      item("Price", esc(s.price)) +
      item("Name", esc(d.first + " " + d.last)) +
      item("Contact", esc(d.email) + "<br>" + esc(d.phone)) +
      (d.notes ? item("Notes", esc(d.notes)) : "") +
      "</dl>" +
      '<p class="form-note bk-error" role="alert"></p>' +
      nav(3, "Confirm booking", true);
    function item(k, v) { return "<div><dt>" + k + "</dt><dd>" + v + "</dd></div>"; }
    wireNav(3, submit);
  }

  function submit() {
    var btn = panel.querySelector("[data-next]"), err = panel.querySelector(".bk-error");
    var booking = {
      id: "AM-" + Date.now().toString(36).toUpperCase(),
      serviceId: state.service.id, service: state.service.name, duration: state.service.duration,
      providerId: state.assigned, provider: byId(CFG.providers, state.assigned).name,
      date: state.date, time: state.time, timezone: CFG.timezoneLabel,
      client: state.details, createdAt: new Date().toISOString()
    };
    // Re-check the slot in case it was taken while the client filled the form.
    var still = slotsFor(state.date)[state.time];
    if (!still || still.indexOf(state.assigned) === -1) {
      err.textContent = "Sorry, that time was just taken. Please choose another.";
      state.time = state.assigned = null;
      setTimeout(function () { go(2); }, 1600);
      return;
    }
    btn.disabled = true; btn.textContent = "Booking…";
    var done = function () { saveBooking(booking); renderConfirmation(booking); };
    if (mode === "api") {
      window.Amare.api("/api/bookings", { body: {
        serviceId: booking.serviceId, providerId: booking.providerId, date: booking.date, time: booking.time, client: booking.client
      } }).then(function (r) {
        booking.id = r.booking.id;
        renderConfirmation(booking);
      }, function (e) {
        btn.disabled = false; btn.textContent = "Confirm booking";
        err.textContent = e.message;
        if (e.status === 409) {
          state.time = state.assigned = null;
          refreshMonth(startOfMonth(parseYmd(booking.date))).then(function () { setTimeout(function () { go(2); }, 1600); });
        }
      });
      return;
    }
    if (mode === "webhook" && CFG.webhookUrl) {
      fetch(CFG.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(booking) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); done(); })
        .catch(function () {
          btn.disabled = false; btn.textContent = "Confirm booking";
          err.textContent = "We couldn't complete your booking. Please try again or call us.";
        });
    } else {
      setTimeout(done, 500); // demo mode
    }
  }

  // ---------- confirmation ----------
  function renderConfirmation(b) {
    stepsEl.innerHTML = "";
    summary.remove();
    root.querySelector(".bk-layout").classList.add("is-done");
    panel.innerHTML =
      '<div class="bk-confirm">' +
      '<div class="bk-confirm__mark" aria-hidden="true">✓</div>' +
      "<h2>You're booked</h2>" +
      '<p class="body-copy">' + esc(b.service) + " with " + esc(b.provider) + "<br>" + esc(fmtDate(b.date)) + " at " + esc(fmtTime(b.time)) + " " + esc(b.timezone) + "</p>" +
      '<p class="muted">Confirmation <strong>' + esc(b.id) + "</strong> · A confirmation email will be sent to " + esc(b.client.email) + "." +
      (mode === "demo" ? "<br><em>(Demo mode: nothing was actually sent.)</em>" : "") + "</p>" +
      (signedIn ? '<p><a class="link" href="account.html">View in your account</a></p>' : "") +
      '<div class="bk-nav" style="justify-content:center">' +
      '<button type="button" class="btn btn--white" data-ics>Add to calendar</button>' +
      '<a class="btn btn--outline" href="book.html">Book another</a></div></div>';
    panel.querySelector("[data-ics]").addEventListener("click", function () { downloadIcs(b); });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function downloadIcs(b) {
    var d = parseYmd(b.date), m = toMin(b.time);
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60);
    var end = new Date(start.getTime() + b.duration * 60000);
    function stamp(t) { return t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate()) + "T" + pad(t.getHours()) + pad(t.getMinutes()) + "00"; }
    var ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Amare Aesthetics//Booking//EN", "BEGIN:VEVENT",
      "UID:" + b.id + "@amareaesthetics", "DTSTAMP:" + stamp(new Date()),
      "DTSTART:" + stamp(start), "DTEND:" + stamp(end),
      "SUMMARY:" + b.service + " at Amare Aesthetics",
      "DESCRIPTION:Provider: " + b.provider + "\\nConfirmation: " + b.id,
      "LOCATION:[TODO] Studio address", "END:VEVENT", "END:VCALENDAR"
    ].join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "amare-appointment.ics";
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- start ----------
  if (CFG.mode === "external" && CFG.externalUrl) {
    root.innerHTML = head("Book online", "You'll continue to our secure booking partner.") +
      '<a class="btn btn--white" href="' + esc(CFG.externalUrl) + '">Continue to booking</a>';
    return;
  }
  var params = new URLSearchParams(location.search);
  var pre = params.get("service") && byId(CFG.services, params.get("service"));
  var preP = params.get("provider") && byId(CFG.providers, params.get("provider"));
  if (pre) { state.service = pre; state.step = 1; }
  if (preP) {
    state.provider = preP.id;
    if (state.service && !offers(preP, state.service.id)) state.service = null;
    state.step = state.service ? 2 : 0;
  }
  var signedIn = false;
  var useServer = (mode === "auto" || mode === "api") && window.Amare && location.protocol !== "file:";
  var ready = !useServer ? Promise.resolve(false) : window.Amare.api("/api/health").then(function () { return true; }, function () { return false; });
  ready.then(function (serverUp) {
    if (mode === "auto") mode = serverUp ? "api" : "demo";
    if (mode === "api" && !serverUp) {
      panel.innerHTML = '<p class="form-note bk-error">Online booking is temporarily unavailable. Please call us at [TODO] (000) 000-0000.</p>';
      return;
    }
    if (mode !== "api") { render(); return; }
    window.Amare.me().then(function (user) {
      if (user && user.role === "client") {
        signedIn = true;
        var parts = user.name.split(" ");
        state.details = { first: parts[0], last: parts.slice(1).join(" "), email: user.email, phone: user.phone, returning: "yes" };
      }
      render();
    });
  });
})();
