/* ============================================================
   CG INTERIORS — shared behaviour (zero dependencies)
   nav state · overlay menu · staggered reveals · parallax ·
   page transitions · contact form validation
   ============================================================ */
(function () {
  'use strict';

  var docEl = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Preloader / load state ---------- */
  // Show intro curtain once per session; skip entirely for reduced motion.
  var pre = document.querySelector('.preloader');
  var seen = false;
  try { seen = sessionStorage.getItem('cg-seen') === '1'; } catch (e) {}

  if (pre && (seen || reduceMotion)) {
    pre.parentNode.removeChild(pre);
    pre = null;
  }

  function markLoaded() {
    docEl.classList.add('is-loaded');
    try { sessionStorage.setItem('cg-seen', '1'); } catch (e) {}
  }
  if (pre) {
    window.addEventListener('load', function () { setTimeout(markLoaded, 900); });
    setTimeout(markLoaded, 2600); // safety: never trap the visitor
  } else {
    requestAnimationFrame(markLoaded);
  }

  /* ---------- Header: scrolled + hide-on-scroll-down ---------- */
  var header = document.querySelector('.site-header');
  var lastY = 0;
  var ticking = false;

  function onScroll() {
    var y = window.scrollY;
    if (header) {
      header.classList.toggle('is-scrolled', y > 32);
      // Hide when scrolling down past the hero, reveal on any scroll up
      if (y > window.innerHeight * 0.9 && y > lastY + 4 && !docEl.classList.contains('menu-open')) {
        header.classList.add('is-hidden');
      } else if (y < lastY - 4 || y <= 32) {
        header.classList.remove('is-hidden');
      }
    }
    updateParallax();
    lastY = y;
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { requestAnimationFrame(onScroll); ticking = true; }
  }, { passive: true });

  /* ---------- Mobile overlay menu ---------- */
  var toggle = document.querySelector('.menu-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = docEl.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (header) header.classList.remove('is-hidden');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && docEl.classList.contains('menu-open')) {
        docEl.classList.remove('menu-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  /* ---------- Scroll reveals (IntersectionObserver) ---------- */
  var revealEls = [].slice.call(document.querySelectorAll('[data-reveal]'));
  if (revealEls.length && 'IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- Subtle image parallax ---------- */
  var pxItems = [];
  if (!reduceMotion) {
    [].slice.call(document.querySelectorAll('[data-parallax]')).forEach(function (wrap) {
      var img = wrap.querySelector('img');
      if (img) pxItems.push({ wrap: wrap, img: img });
    });
  }
  function updateParallax() {
    if (!pxItems.length) return;
    var vh = window.innerHeight;
    pxItems.forEach(function (it) {
      var r = it.wrap.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      // progress: -1 (below viewport) … 1 (above); image is 116% tall → ±8% travel
      var p = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      it.img.style.transform = 'translate3d(0,' + (p * -8).toFixed(3) + '%,0)';
    });
  }
  updateParallax();
  window.addEventListener('resize', updateParallax, { passive: true });

  /* ---------- Page-fade transitions (internal links) ---------- */
  var fade = document.querySelector('.page-fade');
  if (fade && !reduceMotion) {
    document.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      var a = e.target.closest('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(https?:|mailto:|tel:)/.test(href)) return;
      e.preventDefault();
      docEl.classList.add('is-leaving');
      setTimeout(function () { window.location.href = href; }, 380);
    });
    // restore if page was resurrected from bfcache
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) docEl.classList.remove('is-leaving');
    });
  }

  /* ---------- Contact form (validation + submission) ---------- */
  var form = document.querySelector('[data-inquiry-form]');
  if (form) {
    var status = form.querySelector('.form-status');
    var endpoint = form.getAttribute('action') || '/api/inquiry';
    // only real inputs inside a .field wrapper (excludes honeypot + Turnstile token)
    var realFields = [].slice.call(form.querySelectorAll('.field input, .field select, .field textarea'));

    function setError(field, show) {
      var wrap = field.closest('.field');
      if (!wrap) return;
      wrap.classList.toggle('has-error', show);
      field.setAttribute('aria-invalid', show ? 'true' : 'false');
    }
    function validateField(field) {
      var ok = field.checkValidity();
      setError(field, !ok);
      return ok;
    }
    function setStatus(kind, msg) {
      status.className = 'form-status ' + (kind ? 'is-' + kind : '');
      status.textContent = msg;
    }
    // validate on blur, re-validate on input only after first error
    realFields.forEach(function (f) {
      f.addEventListener('blur', function () { if (f.value !== '') validateField(f); });
      f.addEventListener('input', function () {
        var wrap = f.closest('.field');
        if (wrap && wrap.classList.contains('has-error')) validateField(f);
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var firstBad = null;
      realFields.forEach(function (f) { if (!validateField(f) && !firstBad) firstBad = f; });
      if (firstBad) { firstBad.focus(); return; }

      var btn = form.querySelector('[type="submit"]');
      btn.setAttribute('disabled', '');
      setStatus('ok', 'Sending your inquiry…');

      // Build payload from every named control (includes honeypot + Turnstile token)
      var payload = {};
      [].slice.call(form.querySelectorAll('input, select, textarea')).forEach(function (f) {
        if (f.name) payload[f.name] = f.value;
      });

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; });
      }).then(function (res) {
        if (!res.ok) throw new Error((res.data && res.data.error) || 'failed');
        form.reset();
        setStatus('ok', 'Thank you — your inquiry has been received. You’ll have a note from us within minutes, and the studio will respond personally within two business days.');
        if (window.turnstile) { try { window.turnstile.reset(); } catch (_) {} }
      }).catch(function () {
        btn.removeAttribute('disabled');
        setStatus('err', 'Something went wrong sending your inquiry. Please email studio@camposgoldberg.com or try again in a moment.');
        if (window.turnstile) { try { window.turnstile.reset(); } catch (_) {} }
      });
    });
  }

  /* ---------- Footer year ---------- */
  var yr = document.querySelector('[data-year]');
  if (yr) yr.textContent = new Date().getFullYear();
})();
