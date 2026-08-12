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
    # (output name, source url, wght range kept, is_cjk)
    ("noto-sans-tc", f"{BASE}/notosanstc/NotoSansTC%5Bwght%5D.ttf", (300, 600), True),
    ("noto-serif-tc", f"{BASE}/notoseriftc/NotoSerifTC%5Bwght%5D.ttf", (300, 600), True),
    ("fraunces", f"{BASE}/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf", (300, 600), False),
    ("fraunces-italic",
     f"{BASE}/fraunces/Fraunces-Italic%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf", (300, 600), False),
]

# unicode-range slices. The big CJK families are split so the browser fetches
# each disjoint range only when a glyph in it is rendered, and so the tiny
# Latin+punctuation slice (used in every heading) can be preloaded on its own
# instead of dragging the whole ~500 KB CJK payload onto the critical path.
# ranges: list of (lo, hi) inclusive, used both to subset and as the CSS
# unicode-range descriptor. Slices must be disjoint within a family.
LATIN_RANGES = [
    (0x00, 0xFF), (0x131, 0x131), (0x152, 0x153), (0x2000, 0x206F),
    (0x2074, 0x2074), (0x20AC, 0x20AC), (0x2113, 0x2113), (0x2190, 0x21FF),
    (0x2212, 0x2212), (0x2215, 0x2215), (0x2500, 0x257F), (0x25CA, 0x25CA),
    (0x3000, 0x303F), (0xFE30, 0xFE4F), (0xFF00, 0xFFEF),
]
CJK_A_RANGES = [(0x3400, 0x4DBF), (0x4E00, 0x6FFF)]
CJK_B_RANGES = [(0x7000, 0x9FFF), (0xF900, 0xFAFF)]

# (suffix, ranges) — CJK families emit all three, Latin families only "latin".
CJK_SLICES = [("latin", LATIN_RANGES), ("cjk-a", CJK_A_RANGES), ("cjk-b", CJK_B_RANGES)]
LATIN_SLICES = [("", LATIN_RANGES + CJK_A_RANGES + CJK_B_RANGES)]  # single file, keeps name


def in_ranges(cp: int, ranges) -> bool:
    return any(lo <= cp <= hi for lo, hi in ranges)


def css_unicode_range(ranges) -> str:
    parts = [f"U+{lo:X}" if lo == hi else f"U+{lo:X}-{hi:X}" for lo, hi in ranges]
    return ", ".join(parts)

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


def build_slice(name: str, suffix: str, url: str, wght, text: str) -> int:
    """Subset one family to `text`, saving <name>[-<suffix>].woff2.
    Returns bytes written, or 0 if the slice had no glyphs to keep."""
    if not text:
        return 0
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
    fname = f"{name}-{suffix}.woff2" if suffix else f"{name}.woff2"
    dest = os.path.join(OUT, fname)
    font.flavorData = None
    font.save(dest)
    font.close()
    size = os.path.getsize(dest)
    print(f"  {fname:26} {size:>8,} bytes")
    return size


def build(name: str, url: str, wght, is_cjk: bool, used: set) -> None:
    slices = CJK_SLICES if is_cjk else LATIN_SLICES
    for suffix, ranges in slices:
        text = "".join(sorted(c for c in used if in_ranges(ord(c), ranges)))
        build_slice(name, suffix, url, wght, text)


def main() -> int:
    used = used_characters()
    cjk = sum(1 for c in used if ord(c) > 0x2E7F)
    print(f"glyph set: {len(used)} characters ({cjk} CJK)\n")
    for name, url, wght, is_cjk in FAMILIES:
        build(name, url, wght, is_cjk, used)
    print("\nDone. @font-face unicode-range in css/style.css is static — no edit")
    print("needed unless you add a glyph outside the declared slice ranges.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
