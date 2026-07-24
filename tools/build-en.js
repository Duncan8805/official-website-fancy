/* ═══════════════════════════════════════════
   build-en.js — generate the static English page (en/index.html)
   from the Chinese master (index.html).

   Source of truth: index.html + its data-en / data-en-html attributes.
   Whenever site copy changes, re-run:  node tools/build-en.js
   ═══════════════════════════════════════════ */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://jetron-information.com";

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const dom = new JSDOM(html);
const doc = dom.window.document;
const TEXT_NODE = 3;

/* 1 ── document language */
doc.documentElement.setAttribute("lang", "en");

/* 2 ── title & meta description */
const title = doc.querySelector("title");
title.textContent = title.getAttribute("data-en");
const desc = doc.querySelector('meta[name="description"]');
desc.setAttribute("content", desc.getAttribute("data-en"));

/* 3 ── canonical → /en/ (hreflang alternates stay identical on both pages) */
doc.querySelector('link[rel="canonical"]').setAttribute("href", SITE + "/en/");

/* 4 ── Open Graph / Twitter */
const setMeta = (sel, val) => {
  const el = doc.querySelector(sel);
  if (el) el.setAttribute("content", val);
};
setMeta('meta[property="og:title"]', title.textContent);
setMeta('meta[property="og:description"]', desc.getAttribute("content"));
setMeta('meta[property="og:url"]', SITE + "/en/");
setMeta('meta[property="og:locale"]', "en_US");
setMeta('meta[property="og:locale:alternate"]', "zh_TW");
setMeta('meta[name="twitter:title"]', title.textContent);
setMeta('meta[name="twitter:description"]', desc.getAttribute("content"));

/* 5 ── JSON-LD: English-first naming and description */
const ld = doc.querySelector('script[type="application/ld+json"]');
const data = JSON.parse(ld.textContent);
data.name = "Jetron Information";
data.alternateName = "杰辰資訊";
data.description = desc.getAttribute("content");
ld.textContent = JSON.stringify(data, null, 2);

/* 6 ── bake translations into the markup */
doc.querySelectorAll("[data-en-html]").forEach((el) => {
  el.innerHTML = el.getAttribute("data-en-html");
});
doc.querySelectorAll("[data-en]").forEach((el) => {
  if (el.tagName === "TITLE" || el.tagName === "META") return;
  const en = el.getAttribute("data-en");
  let placed = false;
  for (const node of el.childNodes) {
    if (node.nodeType !== TEXT_NODE) continue;
    if (!placed && node.textContent.trim()) {
      node.textContent = en;
      placed = true;
    } else if (placed && node.textContent.trim()) {
      node.textContent = "";
    }
  }
  if (!placed) el.insertBefore(doc.createTextNode(en), el.firstChild);
});

/* 7 ── rewrite root-relative asset paths for the /en/ subdirectory */
doc.querySelectorAll("link[href], script[src], img[src], a[href]").forEach((el) => {
  const attr = el.hasAttribute("href") ? "href" : "src";
  const v = el.getAttribute(attr);
  if (!v || /^(https?:|\/\/|#|mailto:)/.test(v)) return;
  el.setAttribute(attr, "../" + v);
});

/* 8 ── language toggle points back to the Chinese page */
const toggle = doc.getElementById("langToggle");
toggle.setAttribute("href", "../index.html");
toggle.setAttribute("aria-label", "切換至中文");

/* 9 ── write out */
const outDir = path.join(ROOT, "en");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), dom.serialize(), "utf8");
console.log("✓ en/index.html generated");
