// Amare Aesthetics: login pages and the client / provider / admin portals.
// The server enforces every permission; these checks just route people to the right page.
(function () {
  var A = window.Amare, esc = A.esc;
  var root = document.getElementById("portal");
  if (!root) return;
  var CFG = window.AMARE_BOOKING || { providers: [], services: [] };

  function h(html) { root.innerHTML = html; }
  function $(sel, ctx) { return (ctx || root).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || root).querySelectorAll(sel)); }
  function formData(form) {
    var o = {};
    new FormData(form).forEach(function (v, k) { o[k] = typeof v === "string" ? v.trim() : v; });
    return o;
  }
  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "Please wait…"; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }
  function note(el, msg, ok) { el.textContent = msg || ""; el.classList.toggle("is-ok", !!ok); }
  function nextParam(fallback) {
    var n = new URLSearchParams(location.search).get("next");
    return n && /^[a-z0-9-]+\.html$/i.test(n) ? n : fallback;
  }
  function field(label, name, type, attrs) {
    return '<div class="field"><label for="f-' + name + '">' + label + '</label><input id="f-' + name + '" name="' + name +
      '" type="' + (type || "text") + '" ' + (attrs || "") + "></div>";
  }
  function serverDown(err) {
    return err.status === 0
      ? '<div class="pt-alert">Logins need the local server. In Terminal, run <code>python3 server.py</code> in the project folder, then open <a class="link" href="http://localhost:8000/">http://localhost:8000</a>.</div>'
      : "";
  }
  function statusBadge(s) { return '<span class="pt-badge pt-badge--' + s + '">' + s + "</span>"; }
  function providerName(id) { var p = (CFG.providers || []).filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; }

  // Inline "are you sure?" instead of browser dialogs
  function confirmClick(btn, label, action) {
    btn.addEventListener("click", function () {
      if (btn.dataset.armed) { action(); return; }
      btn.dataset.armed = "1"; var orig = btn.textContent; btn.textContent = label;
      btn.classList.add("is-armed");
      setTimeout(function () { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = orig; btn.classList.remove("is-armed"); } }, 4000);
    });
  }

  // Shared "change password" form
  function passwordForm() {
    return '<form class="form pt-card" data-pw><h3>Change password</h3>' +
      field("Current password", "current", "password", 'autocomplete="current-password" required') +
      field("New password (8+ characters)", "new", "password", 'autocomplete="new-password" minlength="8" required') +
      '<button class="btn btn--outline" type="submit">Update password</button><p class="form-note"></p></form>';
  }
  function wirePasswordForm() {
    var f = $("[data-pw]"); if (!f) return;
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = f.querySelector("button"), n = f.querySelector(".form-note");
      busy(btn, true);
      A.api("/api/password", { body: formData(f) }).then(function () {
        f.reset(); note(n, "Password updated. Other devices have been signed out.", true);
      }, function (err) { note(n, err.message); }).then(function () { busy(btn, false); });
    });
  }
  function header(user, sub) {
    return '<div class="pt-head"><div><span class="pt-eyebrow">' + esc(sub) + "</span><h1>" + esc(user.name) + "</h1></div>" +
      '<button class="btn btn--outline" type="button" data-logout>Sign out</button></div>';
  }
  function wireLogout() { var b = $("[data-logout]"); if (b) b.addEventListener("click", function () { A.logout(); }); }
  function tabs(names, active) {
    return '<div class="pt-tabs" role="tablist">' + names.map(function (n) {
      return '<button type="button" role="tab" data-tab="' + n + '" aria-selected="' + (n === active) + '">' + n + "</button>";
    }).join("") + "</div>";
  }
  function wireTabs(onChange) {
    $$("[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        $$("[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", x === b); });
        $$("[data-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== b.getAttribute("data-tab"); });
        if (onChange) onChange(b.getAttribute("data-tab"));
      });
    });
  }

  // ======================================================= login pages
  function loginPage(portal) {
    var isClient = portal === "client";
    A.me().then(function (user) {
      if (user && ((isClient && user.role === "client") || (!isClient && user.role !== "client"))) {
        location.replace(nextParam(A.portalFor(user))); return;
      }
      h(
        (isClient ? tabs(["Sign in", "Create account"], "Sign in") : "") +
        '<div data-panel="Sign in"><form class="form pt-auth" data-login novalidate>' +
        field("Email", "email", "email", 'autocomplete="username" required') +
        field("Password", "password", "password", 'autocomplete="current-password" required') +
        '<button class="btn btn--white btn--full" type="submit">Sign in</button><p class="form-note" role="alert"></p>' +
        (isClient ? '<p class="muted pt-small">Staff member? <a class="link" href="provider-login.html">Provider &amp; Staff Login</a></p>'
                  : '<p class="muted pt-small">Client? <a class="link" href="login.html">Client Login</a></p>') +
        "</form></div>" +
        (isClient ? '<div data-panel="Create account" hidden><form class="form pt-auth" data-register novalidate>' +
          field("Full name", "name", "text", 'autocomplete="name" required') +
          field("Email", "email", "email", 'autocomplete="email" required') +
          field("Phone", "phone", "tel", 'autocomplete="tel"') +
          field("Password (8+ characters)", "password", "password", 'autocomplete="new-password" minlength="8" required') +
          '<button class="btn btn--white btn--full" type="submit">Create account</button><p class="form-note" role="alert"></p>' +
          '<p class="muted pt-small">Already booked as a guest? Use the same email and your past bookings will appear in your account.</p>' +
          "</form></div>" : "")
      );
      wireTabs();
      var lf = $("[data-login]");
      lf.addEventListener("submit", function (e) {
        e.preventDefault();
        var btn = lf.querySelector("button"), n = lf.querySelector(".form-note"), d = formData(lf);
        if (!d.email || !d.password) { note(n, "Please enter your email and password."); return; }
        d.portal = portal;
        busy(btn, true, "Signing in…");
        A.api("/api/login", { body: d }).then(function (r) {
          location.href = nextParam(A.portalFor(r.user));
        }, function (err) {
          busy(btn, false); note(n, err.message);
          if (err.status === 0) lf.insertAdjacentHTML("afterbegin", serverDown(err));
        });
      });
      var rf = $("[data-register]");
      if (rf) rf.addEventListener("submit", function (e) {
        e.preventDefault();
        var btn = rf.querySelector("button"), n = rf.querySelector(".form-note");
        busy(btn, true, "Creating account…");
        A.api("/api/register", { body: formData(rf) }).then(function () {
          location.href = nextParam("account.html");
        }, function (err) { busy(btn, false); note(n, err.message); });
      });
    });
  }

  // ======================================================= client account
  function clientPortal(user) {
    var cutoff = CFG.cancelCutoffHours || 24;
    h(header(user, "My Account") + tabs(["Appointments", "Profile"], "Appointments") +
      '<div data-panel="Appointments"><div class="pt-actions"><a class="btn btn--white" href="book.html">Book an appointment</a></div>' +
      '<h2 class="pt-h2">Upcoming</h2><div data-upcoming class="pt-list"><p class="muted">Loading…</p></div>' +
      '<h2 class="pt-h2">Past &amp; cancelled</h2><div data-past class="pt-list"></div></div>' +
      '<div data-panel="Profile" hidden><div class="pt-grid2">' +
      '<form class="form pt-card" data-profile><h3>Your details</h3>' +
      '<div class="field"><label>Email</label><input type="email" value="' + esc(user.email) + '" disabled></div>' +
      field("Full name", "name", "text", 'required value="' + esc(user.name) + '"') +
      field("Phone", "phone", "tel", 'value="' + esc(user.phone) + '"') +
      '<button class="btn btn--outline" type="submit">Save</button><p class="form-note"></p></form>' +
      passwordForm() + "</div></div>");
    wireLogout(); wireTabs(); wirePasswordForm();
    var pf = $("[data-profile]");
    pf.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = pf.querySelector("button"), n = pf.querySelector(".form-note");
      busy(btn, true);
      A.api("/api/profile", { body: formData(pf) }).then(function (r) {
        note(n, "Saved.", true); $(".pt-head h1").textContent = r.user.name;
      }, function (err) { note(n, err.message); }).then(function () { busy(btn, false); });
    });
    load();

    function load() {
      A.api("/api/bookings").then(function (d) {
        var now = Date.now(), up = [], past = [];
        d.bookings.forEach(function (b) {
          var start = new Date(b.date + "T" + b.time).getTime();
          (b.status === "booked" && start > now ? up : past).push(b);
        });
        past.reverse();
        $("[data-upcoming]").innerHTML = up.length ? up.map(card).join("") : '<p class="muted">No upcoming appointments.</p>';
        $("[data-past]").innerHTML = past.length ? past.map(card).join("") : '<p class="muted">Nothing here yet.</p>';
        $$("[data-cancel]").forEach(function (btn) {
          confirmClick(btn, "Tap again to cancel", function () {
            busy(btn, true, "Cancelling…");
            A.api("/api/bookings/" + btn.getAttribute("data-cancel") + "/cancel", { body: {} }).then(load, function (err) {
              busy(btn, false); btn.closest(".pt-appt").querySelector(".form-note").textContent = err.message;
            });
          });
        });
      }, function (err) { $("[data-upcoming]").innerHTML = '<p class="form-note">' + esc(err.message) + "</p>"; });
    }
    function card(b) {
      var start = new Date(b.date + "T" + b.time).getTime();
      var canCancel = b.status === "booked" && start - Date.now() > cutoff * 3600e3;
      var late = b.status === "booked" && !canCancel && start > Date.now();
      return '<article class="pt-appt"><div class="pt-appt__when"><strong>' + esc(A.fmtDate(b.date, { month: "short", day: "numeric" })) +
        "</strong><span>" + esc(A.fmtTime(b.time)) + "</span></div>" +
        '<div class="pt-appt__main"><strong>' + esc(b.service) + "</strong><span>with " + esc(b.provider) + " · " + b.duration + " min</span>" +
        '<span class="pt-small muted">' + esc(A.fmtDate(b.date)) + " · Ref " + esc(b.id) + "</span>" +
        (late ? '<span class="pt-small muted">Within ' + cutoff + ' hours. Call us to change this appointment.</span>' : "") +
        '<p class="form-note"></p></div><div class="pt-appt__side">' + statusBadge(b.status) +
        (canCancel ? '<button class="btn btn--outline pt-btn-sm" type="button" data-cancel="' + esc(b.id) + '">Cancel</button>' : "") +
        "</div></article>";
    }
  }

  // ======================================================= provider portal
  function providerPortal(user) {
    var day = A.todayYmd();
    var me = (CFG.providers || []).filter(function (p) { return p.id === user.providerId; })[0];
    var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    h(header(user, me ? me.role : "Provider") + tabs(["Schedule", "Upcoming", "Account"], "Schedule") +
      '<div data-panel="Schedule"><div class="pt-daynav">' +
      '<button class="bk-cal__nav" type="button" data-day="-1" aria-label="Previous day">←</button>' +
      '<input type="date" data-date value="' + day + '" aria-label="Date">' +
      '<button class="bk-cal__nav" type="button" data-day="1" aria-label="Next day">→</button>' +
      '<button class="btn btn--outline pt-btn-sm" type="button" data-today>Today</button>' +
      '<span class="pt-daylabel" data-daylabel></span></div><div data-day-list class="pt-list"></div></div>' +
      '<div data-panel="Upcoming" hidden><p class="muted pt-small">Next 14 days</p><div data-upcoming class="pt-list"></div></div>' +
      '<div data-panel="Account" hidden><div class="pt-grid2"><div class="pt-card"><h3>My hours</h3>' +
      (me ? '<p>' + me.days.map(function (d) { return dayNames[d]; }).join(", ") + "</p><p>" + esc(A.fmtTime(me.start)) + " – " + esc(A.fmtTime(me.end)) +
        '</p><p class="muted pt-small">Hours are set in booking-config.js. Ask the studio manager to change them.</p>'
          : '<p class="muted">This account isn\'t linked to a provider schedule.</p>') +
      "</div>" + passwordForm() + "</div></div>");
    wireLogout(); wireTabs(function (t) { if (t === "Upcoming") loadUpcoming(); }); wirePasswordForm();
    var input = $("[data-date]");
    $$("[data-day]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = day.split("-"), d = new Date(+p[0], +p[1] - 1, +p[2] + +b.getAttribute("data-day"));
        setDay(d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2));
      });
    });
    $("[data-today]").addEventListener("click", function () { setDay(A.todayYmd()); });
    input.addEventListener("change", function () { if (input.value) setDay(input.value); });
    setDay(day);

    function setDay(d) {
      day = d; input.value = d;
      $("[data-daylabel]").textContent = A.fmtDate(d, { weekday: "long", month: "long", day: "numeric" });
      var list = $("[data-day-list]");
      list.innerHTML = '<p class="muted">Loading…</p>';
      A.api("/api/bookings?from=" + d + "&to=" + d).then(function (r) {
        var items = r.bookings;
        var working = me && me.days.indexOf(new Date(d + "T12:00").getDay()) > -1;
        list.innerHTML = items.length ? items.map(staffRow).join("")
          : '<p class="muted">' + (working ? "No appointments booked." : "You're not scheduled to work this day.") + "</p>";
        wireStaffActions(list, function () { setDay(day); });
      }, function (err) { list.innerHTML = '<p class="form-note">' + esc(err.message) + "</p>"; });
    }
    function loadUpcoming() {
      var list = $("[data-upcoming]");
      list.innerHTML = '<p class="muted">Loading…</p>';
      A.api("/api/bookings?status=booked&from=" + A.todayYmd() + "&to=" + A.todayYmd(14)).then(function (r) {
        list.innerHTML = r.bookings.length ? r.bookings.map(function (b) { return staffRow(b, true); }).join("") : '<p class="muted">No upcoming appointments.</p>';
        wireStaffActions(list, loadUpcoming);
      });
    }
  }

  // Appointment row for providers and admins
  function staffRow(b, showDate, showProvider) {
    var c = b.client;
    return '<article class="pt-appt"><div class="pt-appt__when">' +
      (showDate ? "<strong>" + esc(A.fmtDate(b.date, { month: "short", day: "numeric" })) + "</strong>" : "") +
      "<span>" + esc(A.fmtTime(b.time)) + '</span><span class="pt-small muted">' + b.duration + " min</span></div>" +
      '<div class="pt-appt__main"><strong>' + esc(c.first + " " + c.last) + (c.returning ? "" : ' <span class="pt-tag">New client</span>') + "</strong>" +
      "<span>" + esc(b.service) + (showProvider ? " · " + esc(b.provider) : "") + "</span>" +
      '<span class="pt-small muted"><a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a> · <a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a> · " + esc(b.id) + "</span>" +
      (c.notes ? '<span class="pt-small pt-notes">“' + esc(c.notes) + "”</span>" : "") +
      '<p class="form-note"></p></div><div class="pt-appt__side">' + statusBadge(b.status) +
      (b.status === "booked" ? '<button class="btn btn--outline pt-btn-sm" type="button" data-act="complete" data-id="' + esc(b.id) + '">Complete</button>' +
        '<button class="btn btn--outline pt-btn-sm" type="button" data-act="cancel" data-id="' + esc(b.id) + '">Cancel</button>' : "") +
      "</div></article>";
  }
  function wireStaffActions(scope, reload) {
    $$("[data-act]", scope).forEach(function (btn) {
      var act = btn.getAttribute("data-act");
      var run = function () {
        busy(btn, true, "…");
        A.api("/api/bookings/" + btn.getAttribute("data-id") + "/" + act, { body: {} }).then(reload, function (err) {
          busy(btn, false); btn.closest(".pt-appt").querySelector(".form-note").textContent = err.message;
        });
      };
      if (act === "cancel") confirmClick(btn, "Confirm cancel", run); else btn.addEventListener("click", run);
    });
  }

  // ======================================================= admin
  function adminPortal(user) {
    var provOpts = (CFG.providers || []).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name + " (" + p.role + ")") + "</option>"; }).join("");
    h(header(user, "Studio Admin") +
      '<div class="pt-stats" data-stats></div>' + tabs(["Bookings", "Users", "Account"], "Bookings") +
      '<div data-panel="Bookings"><form class="pt-filters" data-filters>' +
      '<div class="field"><label>From</label><input type="date" name="from" value="' + A.todayYmd() + '"></div>' +
      '<div class="field"><label>To</label><input type="date" name="to" value="' + A.todayYmd(30) + '"></div>' +
      '<div class="field"><label>Provider</label><select name="provider"><option value="">All</option>' + provOpts + "</select></div>" +
      '<div class="field"><label>Status</label><select name="status"><option value="">All</option><option>booked</option><option>completed</option><option>cancelled</option></select></div>' +
      '<div class="field"><label>Search</label><input type="search" name="q" placeholder="Name, email, phone, ref"></div>' +
      '<button class="btn btn--white" type="submit">Apply</button></form>' +
      '<p class="muted pt-small" data-count></p><div data-bookings class="pt-list"></div></div>' +
      '<div data-panel="Users" hidden><div class="pt-grid2 pt-grid2--wide"><div><div class="pt-filters pt-filters--compact">' +
      '<div class="field"><label>Show</label><select data-role-filter><option value="">Everyone</option><option value="client">Clients</option><option value="provider">Providers</option><option value="admin">Admins</option></select></div></div>' +
      '<div data-users class="pt-table-wrap"></div></div>' +
      '<form class="form pt-card" data-new-user><h3>Add a user</h3>' +
      field("Full name", "name", "text", "required") + field("Email", "email", "email", "required") + field("Phone", "phone", "tel") +
      '<div class="field"><label for="f-role">Role</label><select id="f-role" name="role"><option value="provider">Provider</option><option value="admin">Admin</option><option value="client">Client</option></select></div>' +
      '<div class="field" data-provider-field><label for="f-providerId">Provider schedule</label><select id="f-providerId" name="providerId">' + provOpts + "</select></div>" +
      field("Temporary password (8+ characters)", "password", "text", 'minlength="8" required autocomplete="off"') +
      '<button class="btn btn--white" type="submit">Create user</button><p class="form-note"></p></form></div></div>' +
      '<div data-panel="Account" hidden><div class="pt-grid2">' + passwordForm() + "</div></div>");
    wireLogout(); wirePasswordForm();
    wireTabs(function (t) { if (t === "Users") loadUsers(); });
    loadStats();

    var ff = $("[data-filters]");
    ff.addEventListener("submit", function (e) { e.preventDefault(); loadBookings(); });
    loadBookings();
    function loadStats() {
      A.api("/api/stats").then(function (s) {
        $("[data-stats]").innerHTML = [["Today", s.today], ["Next 7 days", s.next7], ["Client accounts", s.clients], ["Cancelled (30 days)", s.cancelled30]]
          .map(function (x) { return '<div class="pt-stat"><span>' + x[0] + "</span><strong>" + x[1] + "</strong></div>"; }).join("");
      });
    }
    function loadBookings() {
      var d = formData(ff), qs = Object.keys(d).filter(function (k) { return d[k]; })
        .map(function (k) { return k + "=" + encodeURIComponent(d[k]); }).join("&");
      var list = $("[data-bookings]");
      list.innerHTML = '<p class="muted">Loading…</p>';
      A.api("/api/bookings?" + qs).then(function (r) {
        $("[data-count]").textContent = r.bookings.length + " appointment" + (r.bookings.length === 1 ? "" : "s");
        list.innerHTML = r.bookings.length ? r.bookings.map(function (b) { return staffRow(b, true, true); }).join("") : '<p class="muted">No appointments match.</p>';
        wireStaffActions(list, function () { loadBookings(); loadStats(); });
      }, function (err) { list.innerHTML = '<p class="form-note">' + esc(err.message) + "</p>"; });
    }

    var roleFilter = $("[data-role-filter]");
    roleFilter.addEventListener("change", loadUsers);
    function loadUsers() {
      var wrap = $("[data-users]");
      wrap.innerHTML = '<p class="muted">Loading…</p>';
      A.api("/api/users" + (roleFilter.value ? "?role=" + roleFilter.value : "")).then(function (r) {
        wrap.innerHTML = '<table class="pt-table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>' +
          r.users.map(function (u) {
            return "<tr><td><strong>" + esc(u.name) + '</strong><br><span class="muted pt-small">' + esc(u.email) + "</span></td>" +
              "<td>" + esc(u.role) + (u.providerId ? '<br><span class="muted pt-small">' + esc(providerName(u.providerId)) + "</span>" : "") + "</td>" +
              "<td>" + (u.active ? "Active" : '<span class="muted">Deactivated</span>') + "</td>" +
              '<td class="pt-table__actions">' + (u.id === user.id ? '<span class="muted pt-small">You</span>' :
                '<button class="btn btn--outline pt-btn-sm" type="button" data-user="' + u.id + '" data-uact="' + (u.active ? "deactivate" : "activate") + '">' + (u.active ? "Deactivate" : "Activate") + "</button>" +
                '<button class="btn btn--outline pt-btn-sm" type="button" data-reset="' + u.id + '">Reset password</button>') +
              '<form class="pt-reset" data-reset-form="' + u.id + '" hidden><input type="text" minlength="8" placeholder="New temporary password" autocomplete="off" required><button class="btn btn--white pt-btn-sm" type="submit">Set</button></form>' +
              '<p class="form-note"></p></td></tr>';
          }).join("") + "</tbody></table>";
        $$("[data-uact]", wrap).forEach(function (btn) {
          var run = function () {
            busy(btn, true, "…");
            A.api("/api/users/" + btn.getAttribute("data-user") + "/" + btn.getAttribute("data-uact"), { body: {} }).then(loadUsers, function (err) {
              busy(btn, false); btn.closest("td").querySelector(".form-note").textContent = err.message;
            });
          };
          if (btn.getAttribute("data-uact") === "deactivate") confirmClick(btn, "Confirm", run); else btn.addEventListener("click", run);
        });
        $$("[data-reset]", wrap).forEach(function (btn) {
          btn.addEventListener("click", function () { var f = $('[data-reset-form="' + btn.getAttribute("data-reset") + '"]', wrap); f.hidden = !f.hidden; });
        });
        $$("[data-reset-form]", wrap).forEach(function (f) {
          f.addEventListener("submit", function (e) {
            e.preventDefault();
            var n = f.parentNode.querySelector(".form-note");
            A.api("/api/users/" + f.getAttribute("data-reset-form") + "/reset-password", { body: { password: f.querySelector("input").value } })
              .then(function () { f.reset(); f.hidden = true; note(n, "Password reset. Share it securely.", true); }, function (err) { note(n, err.message); });
          });
        });
      }, function (err) { wrap.innerHTML = '<p class="form-note">' + esc(err.message) + "</p>"; });
    }

    var nf = $("[data-new-user]"), roleSel = nf.querySelector('[name="role"]');
    roleSel.addEventListener("change", function () { $("[data-provider-field]").hidden = roleSel.value !== "provider"; });
    nf.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = nf.querySelector('button[type="submit"]'), n = nf.querySelector(".form-note");
      busy(btn, true);
      A.api("/api/users", { body: formData(nf) }).then(function (r) {
        nf.reset(); $("[data-provider-field]").hidden = false;
        note(n, "Created " + r.user.email + ". Share the temporary password securely.", true); loadUsers(); loadStats();
      }, function (err) { note(n, err.message); }).then(function () { busy(btn, false); });
    });
  }

  // ======================================================= start
  var kind = root.getAttribute("data-portal");
  if (location.protocol === "file:") {
    h(serverDown({ status: 0 }));
    return;
  }
  if (kind === "login-client") return loginPage("client");
  if (kind === "login-staff") return loginPage("staff");
  var guards = { client: [["client"], "login.html", clientPortal], provider: [["provider"], "provider-login.html", providerPortal],
                 admin: [["admin"], "provider-login.html", adminPortal] }[kind];
  if (!guards) return;
  A.requireRole(guards[0], guards[1]).then(function (user) { if (user) guards[2](user); });
})();
