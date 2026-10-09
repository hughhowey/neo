# Print (Paperback for KDP)

Files the paperback export uses in its print window. Copied from npm.

- `paged.polyfill.js`: Paged.js 0.4.3 (MIT, see `LICENSE-pagedjs.txt`), which lays the book out in pages
  (facing pages, running heads, chapters on a right-hand page, widows and orphans). One change, marked
  "NEO:" in `textBreak`: a word split across a page turn breaks at its soft hyphen, not a letter later.
- `hyphen/hyphen.js`: hyphen 1.14.1 (ISC, see `hyphen/LICENSE-hyphen`), Liang's hyphenation algorithm.
- `hyphen/patterns/*.js`: the TeX hyphenation patterns (hyph-utf8, ctan.org) as packaged by hyphen 1.14.1,
  for the languages NEO spellchecks. Each set keeps its own free licence (MIT, LPPL, or a TeX-style
  permission to copy); they are distributed unchanged.

Hyphenation is done here, with soft hyphens, rather than by the browser engine: Chromium on Windows and
Linux ships without hyphenation dictionaries, so `hyphens: auto` would hyphenate on a Mac only.
