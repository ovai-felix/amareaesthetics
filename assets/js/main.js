// Amare Aesthetics — site interactions
(function () {
  var body = document.body;

  // Page-load transition screen
  var screen = document.querySelector(".transition-screen");
  if (screen) {
    window.addEventListener("load", function () {
      setTimeout(function () { screen.classList.add("is-done"); }, 250);
    });
    // Safety net in case load is slow
    setTimeout(function () { screen.classList.add("is-done"); }, 2500);
  }

  // Mobile menu toggle
  var menuBtn = document.querySelector(".menu-toggle");
  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      var open = body.classList.toggle("nav-open");
      menuBtn.setAttribute("aria-expanded", open);
    });
  }

  // Sidebar dropdown groups
  document.querySelectorAll(".nav-caret").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var group = btn.closest(".nav-group");
      var open = group.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open);
    });
  });

  // FAQ accordion
  document.querySelectorAll(".faq-q").forEach(function (q) {
    q.addEventListener("click", function () {
      var panel = document.getElementById(q.getAttribute("aria-controls"));
      var expanded = q.getAttribute("aria-expanded") === "true";
      q.setAttribute("aria-expanded", !expanded);
      panel.style.height = expanded ? "0px" : panel.scrollHeight + "px";
    });
  });

  // FAQ search filter
  document.querySelectorAll("[data-faq-search]").forEach(function (input) {
    var list = document.getElementById(input.getAttribute("data-faq-search"));
    input.addEventListener("input", function () {
      var term = input.value.trim().toLowerCase();
      list.querySelectorAll(".faq-item").forEach(function (item) {
        item.hidden = term && item.textContent.toLowerCase().indexOf(term) === -1;
      });
    });
  });

  // Testimonial carousel arrows
  document.querySelectorAll("[data-carousel]").forEach(function (wrap) {
    var track = wrap.querySelector(".carousel__track");
    wrap.querySelectorAll("[data-dir]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var card = track.querySelector(".quote-card");
        var step = card ? card.getBoundingClientRect().width + 16 : track.clientWidth;
        track.scrollBy({ left: step * Number(btn.getAttribute("data-dir")), behavior: "smooth" });
      });
    });
  });

  // Scroll reveal
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  // Forms: there is no backend yet, so just confirm locally.
  // TODO: hook up to a form service (e.g. Formspree, Mailchimp) when going live.
  document.querySelectorAll("form[data-demo]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var note = form.querySelector(".form-note");
      if (note) note.textContent = form.getAttribute("data-demo");
      form.reset();
    });
  });

  // Footer year
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
