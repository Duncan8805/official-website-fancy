"""
build-fonts.py — generate self-hosted, glyph-subset woff2 fonts.

Why: the Google Fonts <link> was 272 KB of render-blocking CSS that pulled a
chain of 34 woff2 files totalling 2.46 MB — 80% of the homepage weight, and
Lighthouse's single largest render-blocking offender (~4.5 s on /, ~6.8 s on /en/).

What it does: keeps each family as ONE variable woff2 (wght axis only, clamped
to the range the CSS actually uses) subset down to the characters that actually
appear in index.html / en/index.html, plus a fixed safety set.

IMPORTANT: the CJK subset is derived from the site copy. Re-run this whenever
you change text, or new characters will render as tofu:

    python tools/build-fonts.py

Requires: pip install fonttools brotli
Sources are downloaded from the google/fonts repo (SIL Open Font License 1.1);
assets/fonts/OFL.txt must ship alongside the woff2 files.
"""
import os
import re
import sys
import urllib.request
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "fonts")
CACHE = os.path.join(ROOT, "tools", ".fontcache")
BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl"

FAMILIES = [
    # (output name, source url, wght range kept)
    ("noto-sans-tc", f"{BASE}/notosanstc/NotoSansTC%5Bwght%5D.ttf", (300, 600)),
    ("noto-serif-tc", f"{BASE}/notoseriftc/NotoSerifTC%5Bwght%5D.ttf", (300, 600)),
    ("fraunces", f"{BASE}/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf", (300, 600)),
    ("fraunces-italic",
     f"{BASE}/fraunces/Fraunces-Italic%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf", (300, 600)),
]

# Always included regardless of current copy, so small edits don't cause tofu.
SAFETY = (
    "".join(chr(c) for c in range(0x20, 0x7F))          # basic latin
    + "".join(chr(c) for c in range(0x3000, 0x3040))    # CJK punctuation
    + "".join(chr(c) for c in range(0xFF00, 0xFF65))    # fullwidth forms
    + "・〜—–…‧′″×÷←↑→↓↗↘←※©®™°％　"
    + "0123456789"
)


def html_files() -> list:
    """Every page on the site, including generated /en/ pages and sub-pages."""
    found = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames
                       if d not in {"node_modules", ".git", ".fontcache"}
                       and not d.startswith(".")]
        found += [os.path.join(dirpath, f) for f in filenames if f.endswith(".html")]
    return found


def used_characters() -> set:
    chars = set(SAFETY)
    for path in html_files():
        html = open(path, encoding="utf-8").read()
        # strip <script>/<style> bodies; keep attribute text (data-en, alt, meta)
        html = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
        chars |= set(html)
    return {c for c in chars if ord(c) > 0x1F}


def fetch(url: str, dest: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    if not os.path.exists(dest):
        print(f"  downloading {os.path.basename(dest)} ...")
        urllib.request.urlretrieve(url, dest)
    return dest


def build(name: str, url: str, wght, text: str) -> None:
    src = fetch(url, os.path.join(CACHE, name + ".ttf"))
    # lazy=False: the lazy gvar proxy raises KeyError during subsetting once
    # instancer has rewritten the table (fontTools lazyTools), so load eagerly.
    font = TTFont(src, lazy=False)

    options = subset.Options()
    options.flavor = "woff2"
    options.desubroutinize = False
    options.layout_features = ["kern", "liga", "clig", "calt", "locl", "ccmp",
                               "vert", "vrt2", "palt"]
    options.name_IDs = ["*"]
    options.name_legacy = False
    options.notdef_outline = False
    options.drop_tables += ["DSIG"]
    options.recalc_bounds = True

    # Subset BEFORE instancing: instancer drops gvar entries for glyphs with no
    # variation data, and the subsetter then KeyErrors on them.
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=text)
    subsetter.subset(font)

    # Pin every axis except wght; clamp wght to the range the CSS uses.
    if "fvar" in font:
        limits = {}
        for axis in font["fvar"].axes:
            if axis.axisTag == "wght":
                lo = max(axis.minValue, wght[0])
                hi = min(axis.maxValue, wght[1])
                limits["wght"] = (lo, lo, hi) if lo != hi else lo
            else:
                limits[axis.axisTag] = axis.defaultValue
        font = instancer.instantiateVariableFont(font, limits, updateFontNames=False)

    os.makedirs(OUT, exist_ok=True)
    dest = os.path.join(OUT, f"{name}.woff2")
    font.flavorData = None
    font.save(dest)
    font.close()
    print(f"  {name}.woff2  {os.path.getsize(dest):>8,} bytes")


def main() -> int:
    text = "".join(sorted(used_characters()))
    cjk = sum(1 for c in text if ord(c) > 0x2E7F)
    print(f"glyph set: {len(text)} characters ({cjk} CJK)")
    for name, url, wght in FAMILIES:
        build(name, url, wght, text)
    print("\nDone. Remember to bump the ?v= cache-buster in css/style.css.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
