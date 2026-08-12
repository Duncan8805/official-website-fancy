/* ═══════════════════════════════════════════
   build-en.js — generate the static English pages under /en/
   from the Chinese masters.

   Source of truth: every *.html outside en/ + its data-en / data-en-html /
   data-en-alt attributes. Each master maps to the same path under /en/:

       index.html                 ->  en/index.html
       services/erp/index.html    ->  en/services/erp/index.html

   Canonical + hreflang are derived from the file path, so new pages need no
   change here. Whenever site copy changes, re-run:  node tools/build-en.js
   ═══════════════════════════════════════════ */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://jetron-information.com";
const TEXT_NODE = 3;
const SKIP_DIRS = new Set(["en", "node_modules", "tools", "assets", "css", "js", ".git"]);

/* ── discover Chinese master pages ── */
function findMasters(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === ROOT && SKIP_DIRS.has(entry.name)) continue;
      findMasters(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

/* ── "/", "/services/erp/" … derived from the master's path ── */
function urlPathOf(master) {
  const rel = path.relative(ROOT, master).split(path.sep).join("/");
  const dir = rel.replace(/index\.html$/, "").replace(/\.html$/, "/");
  return "/" + dir;
}

function buildPage(master) {
  const urlPath = urlPathOf(master);              // "/"  |  "/services/erp/"
  const zhUrl = SITE + urlPath;
  const enUrl = SITE + "/en" + urlPath;

  const dom = new JSDOM(fs.readFileSync(master, "utf8"));
  const doc = dom.window.document;

  /* 1 ── document language */
  doc.documentElement.setAttribute("lang", "en");

  /* 2 ── title & meta description */
  const title = doc.querySelector("title");
  if (title && title.hasAttribute("data-en")) title.textContent = title.getAttribute("data-en");
  const desc = doc.querySelector('meta[name="description"]');
  if (desc && desc.hasAttribute("data-en")) desc.setAttribute("content", desc.getAttribute("data-en"));

  /* 3 ── canonical + hreflang, derived from this page's own path */
  const setLink = (sel, href) => {
    const el = doc.querySelector(sel);
    if (el) el.setAttribute("href", href);
  };
  setLink('link[rel="canonical"]', enUrl);
  setLink('link[rel="alternate"][hreflang="zh-Hant"]', zhUrl);
  setLink('link[rel="alternate"][hreflang="en"]', enUrl);
  setLink('link[rel="alternate"][hreflang="x-default"]', zhUrl);

  /* 4 ── Open Graph / Twitter */
  const setMeta = (sel, val) => {
    const el = doc.querySelector(sel);
    if (el && val != null) el.setAttribute("content", val);
  };
  if (title) setMeta('meta[property="og:title"]', title.textContent);
  if (desc) setMeta('meta[property="og:description"]', desc.getAttribute("content"));
  setMeta('meta[property="og:url"]', enUrl);
  setMeta('meta[property="og:locale"]', "en_US");
  setMeta('meta[property="og:locale:alternate"]', "zh_TW");
  if (title) setMeta('meta[name="twitter:title"]', title.textContent);
  if (desc) setMeta('meta[name="twitter:description"]', desc.getAttribute("content"));

  /* 5 ── JSON-LD: only the description is localised.
     name / alternateName / @id stay IDENTICAL on both pages — the two pages
     describe the same entity, and flipping the name per language makes them
     look like two different organisations to entity resolution. */
  const ld = doc.querySelector('script[type="application/ld+json"]');
  if (ld && desc) {
    const data = JSON.parse(ld.textContent);
    data.description = desc.getAttribute("content");
    if (data.inLanguage) data.inLanguage = "en";
    if (data["@type"] === "Service") {
      // A Service node is a descriptive label, not a shared entity, so its name
      // SHOULD be localised — unlike the Organization above.
      if (data.alternateName) {
        const zh = data.name;
        data.name = data.alternateName;
        data.alternateName = zh;
      }
      data.url = enUrl;
      delete data.serviceType;      // Chinese-only label; name already carries it
      // Offer names have no data-en source, so rather than publish Chinese
      // labels inside an English page we drop the catalogue here. The Service
      // name + description still describe the offering.
      delete data.hasOfferCatalog;
    }
    ld.textContent = JSON.stringify(data, null, 2);
  }

  /* 6 ── bake translations into the markup */
  doc.querySelectorAll("[data-en-html]").forEach((el) => {
    el.innerHTML = el.getAttribute("data-en-html");
  });
  doc.querySelectorAll("[data-en-alt]").forEach((el) => {
    el.setAttribute("alt", el.getAttribute("data-en-alt"));
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

  /* 7a ── rewrite document-relative links so they stay inside /en/.
     Absolute, protocol-relative, root-relative, anchor and mailto links are
     already correct; assets are referenced root-relative, so nothing to do. */
  const depth = urlPath.split("/").filter(Boolean).length;
  doc.querySelectorAll("link[href], script[src], img[src], a[href]").forEach((el) => {
    const attr = el.hasAttribute("href") ? "href" : "src";
    const v = el.getAttribute(attr);
    if (!v || /^(https?:|\/|#|mailto:)/.test(v)) return;
    el.setAttribute(attr, "../".repeat(depth + 1) + v);
  });

  /* 7b ── root-relative links to OTHER PAGES must point at their English twin,
     or the English site silently funnels readers back into the Chinese one.
     Asset directories are excluded — there is only one copy of those. */
  const ASSET_PREFIX = /^\/(assets|css|js)\//;
  doc.querySelectorAll("a[href]").forEach((a) => {
    const v = a.getAttribute("href");
    if (!v || !v.startsWith("/") || v.startsWith("/en/") || ASSET_PREFIX.test(v)) return;
    a.setAttribute("href", "/en" + v);
  });

  /* 8 ── language toggle points back to this page's Chinese twin */
  const toggle = doc.getElementById("langToggle");
  if (toggle) {
    toggle.setAttribute("href", urlPath);
    toggle.setAttribute("aria-label", "切換至中文");
  }

  /* 9 ── write out */
  const outFile = path.join(ROOT, "en", path.relative(ROOT, master));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, dom.serialize(), "utf8");
  return path.relative(ROOT, outFile).split(path.sep).join("/");
}

/* ── sitemap, derived from the same page list so it can't drift ── */
function writeSitemap(masters) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [];
  for (const master of masters) {
    const urlPath = urlPathOf(master);
    const zhUrl = SITE + urlPath;
    const enUrl = SITE + "/en" + urlPath;
    const alternates =
      `    <xhtml:link rel="alternate" hreflang="zh-Hant" href="${zhUrl}" />\n` +
      `    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}" />\n` +
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${zhUrl}" />`;
    for (const [loc, priority] of [[zhUrl, urlPath === "/" ? "1.0" : "0.8"],
                                   [enUrl, urlPath === "/" ? "0.8" : "0.6"]]) {
      entries.push(
        `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>monthly</changefreq>\n    <priority>${priority}</priority>\n` +
        `${alternates}\n  </url>`
      );
    }
  }
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
    `        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    entries.join("\n") + `\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), xml, "utf8");
  return entries.length;
}

const masters = findMasters();
if (!masters.length) {
  console.error("no Chinese master pages found");
  process.exit(1);
}
for (const master of masters) {
  console.log("✓ " + buildPage(master));
}
const urlCount = writeSitemap(masters);
console.log(`✓ sitemap.xml (${urlCount} URLs)`);
console.log(`\n${masters.length} page(s) generated. Re-run tools/build-fonts.py if the copy changed.`);
