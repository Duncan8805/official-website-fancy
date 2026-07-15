/* ═══════════════════════════════════════════
   智傑科技 HighTech — interactions
   GSAP + ScrollTrigger + Lenis
   ═══════════════════════════════════════════ */

gsap.registerPlugin(ScrollTrigger);

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ══════════════════════════════════════════════
   i18n — 中 / EN language toggle
   Each translatable node carries:
     data-en        → English text (child elements preserved)
     data-en-html   → English HTML  (may contain markup, e.g. <br/>)
   The original Chinese is captured on load, so toggling back is lossless.
   ══════════════════════════════════════════════ */
const I18N_KEY = "ht-lang";

/* Replace only the direct text nodes of an element, keeping child elements
   (e.g. <em>, <i>, <span>) exactly where they are. */
function setDirectText(el, text) {
  let placed = false;
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent = placed ? "" : text;
      placed = true;
    }
  }
  if (!placed) el.insertBefore(document.createTextNode(text), el.firstChild);
}

const i18nNodes = Array.from(
  document.querySelectorAll("[data-en], [data-en-html]")
);

/* Snapshot the original Chinese so we can restore it. */
i18nNodes.forEach((el) => {
  if (el.hasAttribute("data-en-html")) {
    el.dataset.zhHtml = el.innerHTML;
  } else if (el.dataset.zh === undefined) {
    // capture the element's own direct text (first text node)
    let t = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        t = node.textContent;
        break;
      }
    }
    el.dataset.zh = t;
  }
});

function applyLang(lang) {
  const en = lang === "en";
  i18nNodes.forEach((el) => {
    if (el.hasAttribute("data-en-html")) {
      el.innerHTML = en ? el.dataset.enHtml : el.dataset.zhHtml;
    } else if (el.tagName === "TITLE") {
      document.title = en ? el.dataset.en : el.dataset.zh;
    } else if (el.tagName === "META") {
      el.setAttribute("content", en ? el.dataset.en : el.dataset.zh);
    } else {
      setDirectText(el, en ? el.dataset.en : el.dataset.zh);
    }
  });

  document.documentElement.lang = en ? "en" : "zh-Hant";
  document.documentElement.dataset.lang = en ? "en" : "zh";
  localStorage.setItem(I18N_KEY, en ? "en" : "zh");

  // re-run the manifesto word-split for the newly set text
  if (typeof splitManifesto === "function") splitManifesto();
  if (window.ScrollTrigger) ScrollTrigger.refresh();
}

let currentLang =
  localStorage.getItem(I18N_KEY) ||
  (navigator.language && navigator.language.startsWith("en") ? "en" : "zh");

/* ── Lenis smooth scroll ── */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
  window.lenis = lenis;
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* anchor links work with lenis */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const target = document.querySelector(a.getAttribute("href"));
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { offset: -60 });
    else target.scrollIntoView({ behavior: "smooth" });
  });
});

/* ── nav scrolled state ── */
const nav = document.getElementById("nav");
window.addEventListener("scroll", () => {
  nav.classList.toggle("is-scrolled", window.scrollY > 40);
}, { passive: true });

/* ── split hero/contact rows into y-reveal targets ── */
document.querySelectorAll("[data-split]").forEach((el) => {
  gsap.set(el, { yPercent: 110 });
});
gsap.set(".anim-line > span", { yPercent: 120 });

/* ── preloader ── */
const preloader = document.getElementById("preloader");
const loadCount = document.getElementById("loadCount");
const loadBar = document.getElementById("loadBar");

function heroIntro() {
  const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
  tl.to(".hero [data-split]", { yPercent: 0, duration: 1.4, stagger: 0.12 })
    .to(".hero .anim-line > span", { yPercent: 0, duration: 1.1, stagger: 0.1 }, "-=1.0")
    .from(".nav", { y: -40, opacity: 0, duration: 0.9 }, "-=0.9");
}

if (reduceMotion) {
  preloader.style.display = "none";
  gsap.set("[data-split], .anim-line > span", { yPercent: 0 });
} else {
  const counter = { v: 0 };
  gsap.timeline()
    .to(counter, {
      v: 100,
      duration: 2.1,
      ease: "power2.inOut",
      onUpdate: () => {
        const n = Math.round(counter.v);
        loadCount.textContent = n;
        loadBar.style.width = n + "%";
      },
    })
    .to(".preloader__inner", { opacity: 0, y: -30, duration: 0.5, ease: "power2.in" })
    .to(preloader, {
      yPercent: -100,
      duration: 0.9,
      ease: "power4.inOut",
      onComplete: () => { preloader.style.display = "none"; heroIntro(); },
    }, "-=0.1");
}

/* ── hero orbs parallax drift ── */
gsap.to(".hero__orb--1", {
  xPercent: 18, yPercent: 22, duration: 9,
  yoyo: true, repeat: -1, ease: "sine.inOut",
});
gsap.to(".hero__orb--2", {
  xPercent: -15, yPercent: -18, duration: 11,
  yoyo: true, repeat: -1, ease: "sine.inOut",
});

/* ── manifesto: word-by-word scrub reveal ── */
const manifesto = document.getElementById("manifestoText");
let manifestoST = null;

function splitManifesto() {
  const lang = document.documentElement.dataset.lang === "en" ? "en" : "zh";
  const text = (lang === "en" ? manifesto.dataset.en : manifesto.dataset.zh).trim();
  manifesto.innerHTML = text
    .split(/\s+/)
    .map((w) => `<span class="w">${w}</span>`)
    .join(" ");
  if (manifestoST) manifestoST.kill();
  gsap.set("#manifestoText .w", { opacity: 0.14 });
  const tween = gsap.to("#manifestoText .w", {
    opacity: 1,
    stagger: 0.06,
    ease: "none",
    scrollTrigger: {
      trigger: ".manifesto",
      start: "top 75%",
      end: "bottom 55%",
      scrub: 0.6,
    },
  });
  manifestoST = tween.scrollTrigger;
}
splitManifesto();

/* ── generic section-head + service reveals ── */
document.querySelectorAll(".section-head, .identity__head").forEach((el) => {
  gsap.from(el, {
    y: 60, opacity: 0, duration: 1.1, ease: "power3.out",
    scrollTrigger: { trigger: el, start: "top 85%" },
  });
});
gsap.from(".studio__statement", {
  y: 60, opacity: 0, duration: 1.1, ease: "power3.out",
  scrollTrigger: { trigger: ".studio__grid", start: "top 82%" },
});
document.querySelectorAll(".service, .step, .disc").forEach((el, i) => {
  gsap.from(el, {
    y: 70, opacity: 0, duration: 1, ease: "power3.out",
    delay: (i % 4) * 0.06,
    scrollTrigger: { trigger: el, start: "top 90%" },
  });
});

/* ── identity horizontal scroll ── */
const idTrack = document.getElementById("identityTrack");
function idDistance() {
  return Math.max(0, idTrack.scrollWidth - window.innerWidth);
}
if (!reduceMotion && window.innerWidth > 720) {
  gsap.to(idTrack, {
    x: () => -idDistance(),
    ease: "none",
    scrollTrigger: {
      trigger: "#identityPin",
      start: "top top",
      end: () => "+=" + (idDistance() + window.innerHeight * 0.4),
      pin: true,
      scrub: 0.8,
      invalidateOnRefresh: true,
    },
  });
} else {
  // small screens: cards stack vertically via CSS — no horizontal scroll/pin
  idTrack.style.overflowX = "visible";
  idTrack.style.width = "100%";
}

/* ── stats counters ── */
document.querySelectorAll(".stat strong").forEach((el) => {
  const target = +el.dataset.count;
  const obj = { v: 0 };
  ScrollTrigger.create({
    trigger: el,
    start: "top 88%",
    once: true,
    onEnter: () =>
      gsap.to(obj, {
        v: target, duration: 1.8, ease: "power2.out",
        onUpdate: () => (el.textContent = Math.round(obj.v)),
      }),
  });
});

/* ── contact big-type reveal ── */
gsap.to(".contact [data-split]", {
  yPercent: 0, duration: 1.3, ease: "power4.out", stagger: 0.14,
  scrollTrigger: { trigger: ".contact", start: "top 70%" },
});
gsap.from(".contact__en, .contact__mail, .contact__label", {
  opacity: 0, y: 30, duration: 1, ease: "power3.out", stagger: 0.1,
  scrollTrigger: { trigger: ".contact", start: "top 65%" },
});

/* ── language toggle wiring ── */
const langToggle = document.getElementById("langToggle");
if (langToggle) {
  langToggle.addEventListener("click", () => {
    currentLang = document.documentElement.dataset.lang === "en" ? "zh" : "en";
    applyLang(currentLang);
  });
}

/* apply the initial language now that splitManifesto is defined
   (skip the manifesto re-split if the default is Chinese — it already
   rendered above; only re-run when switching to English) */
if (currentLang === "en") {
  applyLang("en");
} else {
  document.documentElement.dataset.lang = "zh";
}

window.addEventListener("load", () => ScrollTrigger.refresh());
