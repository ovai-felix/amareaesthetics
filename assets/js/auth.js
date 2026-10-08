// Amare Aesthetics: shared login/session helpers (talks to server.py)
window.Amare = (function () {
  var meCache = null;

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "same-origin", headers: { "Accept": "application/json" } };
    if (opts.body !== undefined) {
      init.method = opts.method || "POST";
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.error || "Something went wrong. Please try again.");
          err.status = r.status;
          throw err;
        }
        return data;
      });
    }, function () {
      var err = new Error("Can't reach the Amare server. Start it with: python3 server.py");
      err.status = 0;
      throw err;
    });
  }

  function me(force) {
    if (meCache && !force) return meCache;
    meCache = api("/api/me").then(function (d) { return d.user; }, function () { return null; });
    return meCache;
  }

  function portalFor(user) {
    if (!user) return "login.html";
    return { client: "account.html", provider: "provider-portal.html", admin: "admin.html" }[user.role];
  }

  // Redirect away unless the signed-in user has one of `roles`.
  function requireRole(roles, loginPage) {
    return me().then(function (user) {
      if (!user) { location.replace(loginPage + "?next=" + encodeURIComponent(location.pathname.split("/").pop())); return null; }
      if (roles.indexOf(user.role) === -1) { location.replace(portalFor(user)); return null; }
      return user;
    });
  }

  function logout() {
    return api("/api/logout", { body: {} }).catch(function () {}).then(function () { location.href = "index.html"; });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtDate(ymd, opts) {
    var p = ymd.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, opts || { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  function fmtTime(hhmm) {
    var p = hhmm.split(":"), h = +p[0];
    return ((h + 11) % 12 + 1) + ":" + p[1] + (h < 12 ? " AM" : " PM");
  }
  function todayYmd(offsetDays) {
    var d = new Date(); d.setDate(d.getDate() + (offsetDays || 0));
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  // Swap "Login" links for "My Account" once signed in.
  document.addEventListener("DOMContentLoaded", function () {
    if (location.protocol === "file:") return;
    me().then(function (user) {
      if (!user) return;
      document.querySelectorAll('a[href="login.html"], a[href="provider-login.html"]').forEach(function (a) {
        if (a.closest(".footer-nav")) return;
        a.setAttribute("href", portalFor(user));
        var label = a.querySelector("span") || a;
        if (/login/i.test(label.textContent)) label.textContent = "My Account";
      });
    });
  });

  return { api: api, me: me, portalFor: portalFor, requireRole: requireRole, logout: logout, esc: esc,
           fmtDate: fmtDate, fmtTime: fmtTime, todayYmd: todayYmd };
})();
