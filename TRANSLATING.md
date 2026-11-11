# Translating NEO

NEO currently speaks:

| Code | Language | Status |
|---|---|---|
| `en` | English | original |
| `fr` | Français | complete, reviewed by a native speaker |
| `fr-CA` | Français (Canada) | regional differences only |
| `es` | Español | complete, machine-assisted: native review welcome |
| `pt` | Português (Brasil) | complete, machine-assisted: native review welcome |
| `pt-PT` | Português (Portugal) | regional differences only, machine-assisted |
| `de` | Deutsch | complete, machine-assisted: native review welcome |
| `de-CH` | Deutsch (Schweiz) | regional differences only (ss for ß, «…» quotes) |
| `it` | Italiano | complete, machine-assisted: native review welcome |
| `nl` | Nederlands | complete, machine-assisted: native review welcome |
| `pl` | Polski | complete, machine-assisted: native review welcome |
| `ro` | Română | complete, machine-assisted: native review welcome |
| `ru` | Русский | complete, reviewed by a native speaker |
| `uk` | Українська | complete, machine-assisted: native review welcome |
| `hu` | Magyar | complete, reviewed by a native speaker |
| `ko` | 한국어 | complete, machine-assisted: native review welcome |
| `vi` | Tiếng Việt | complete |

Spellchecking (Edit → Spellcheck Language) covers English, French, Spanish, German, Dutch, Polish, Brazilian Portuguese, Romanian, Russian, Ukrainian, Hungarian, Swedish and Danish. The engine is Hunspell itself, compiled to WebAssembly, so every dictionary loads in well under a second. Italian is left out because the only Hunspell dictionary on npm is GPL-3.0-only, which does not sit well in an MIT app. The Brazilian Portuguese interface starts with the Brazilian dictionary; the European Portuguese interface leaves the choice to the writer, since spellings differ.

Spellcheck starts off on every launch. Choosing a dictionary does not turn it on. If the interface starts in Romanian and the library has no saved spellcheck language, NEO selects and saves Romanian. Explicit dictionary choices survive interface-language changes. Other interface languages keep their existing defaults.

Romanian lookup accepts standard diacritics, legacy `ş/ţ`, and decomposed Unicode accents without changing manuscript text. Suggestions use standard Romanian spelling. This checks spelling, not grammar: both `sa` and `să` are words. See [the Romanian evaluation](scripts/romanian-spellcheck.md) and [the Portuguese evaluation](scripts/portuguese-spellcheck.md) for performance and licensing details.

The Swedish dictionary (`sv`, **Svenska** in Edit → Spellcheck Language) is Göran Andersson's LibreOffice dictionary, pinned as `dictionary-sv` 4.0.0. Its data is LGPL 3.0, separately from NEO's MIT license. Desktop and Pocket distribute the unmodified `.aff`/`.dic` source files with attribution and the full LGPL/GPL license texts (`licenses/dictionary-sv`). This adds spellchecking only, not a Swedish interface translation.

The Ukrainian dictionary is LibreOffice's uk_UA (from the dict_uk project), kept in `dictionaries/uk` under its MPL 1.1 license; the npm `dictionary-uk` package is GPL-3.0 and stays out. A suggestion with an apostrophe (м'ясо) goes onto the page with ’.

The Hungarian dictionary is LibreOffice's Magyar Ispell 1.9, kept in `dictionaries/hu` (the npm `dictionary-hu` package rejected common accusatives like *könyvet*). They are underlined in blue; right-click shows the fix and why. Each rule is a plain pattern run on the writer's computer, and fires only where a mistake is very likely.

### Danish

The Danish dictionary (`da`, **Dansk** in Edit → Spellcheck Language) is Stavekontrolden 2.9.101 (7 June 2026), as LibreOffice ships it, kept in `dictionaries/da`. NEO has no Danish interface: a writer can keep NEO in English (or any language) and spellcheck and type in Danish. Like every spellcheck language, Dansk sits behind File → Show More Features, is saved as `spellLanguage` in library.json, survives a change of interface language, and does not turn spellcheck on by itself.

- **Source.** `index.aff` and `index.dic` are `da_DK/da_DK.aff` and `da_DK/da_DK.dic` from [LibreOffice/dictionaries](https://github.com/LibreOffice/dictionaries/tree/cdaeab266e35c0f1ce367629c7f2079c64fe9351/da_DK) at commit `cdaeab266e35c0f1ce367629c7f2079c64fe9351`, byte for byte, renamed only. Their SHA-256 sums are in `dictionaries/da/NOTICE.txt`, and the tests check them. The thesaurus and hyphenation files are left out. (The npm package `dictionary-da` carries the older 2.8.034.)
- **License.** © Foreningen for frit tilgængelige sprogværktøjer, offered under GPL 2.0, LGPL 2.1 or MPL 1.1. NEO distributes it under MPL 1.1, separately from NEO's MIT license, with the upstream notice (`README_da_DK.txt`), `NOTICE.txt` and the full `MPL-1.1.txt` beside the data, on desktop (`app.asar.unpacked/node_modules/dictionary-da/`) and in Pocket (`dict/da/`).
- **Writing.** `i` (in) stays lowercase and a typed `I` (you) stays as typed: turning `i` into `I`, as you type and in the spellcheck's capital check, is English only. Sentences still start with a capital, and the common abbreviations *f.eks., bl.a., dvs., osv., mv., evt., jf., kl., nr., pga., mht., inkl.* don't end one (`CAPS_ABBREV` in `app.js`; as with *etc.*, a sentence ending in *osv.* leaves the next capital to the writer). Quotation marks are »…«, one of the forms Danish uses (with „…“ and ”…”); a book already set in „…“ keeps it. `'` is the apostrophe ’.
- **Compounds.** Hunspell takes compounds it can build from known words, so some typos that make two real words (*skrivebrod*: skrive + brod) pass.

To update the dictionary:

```
C=<LibreOffice/dictionaries commit>
B=https://raw.githubusercontent.com/LibreOffice/dictionaries/$C/da_DK
curl -fsSL -o dictionaries/da/index.aff $B/da_DK.aff
curl -fsSL -o dictionaries/da/index.dic $B/da_DK.dic
curl -fsSL -o dictionaries/da/README_da_DK.txt $B/README_da_DK.txt
head -3 dictionaries/da/index.aff     # version line; the license block follows
sha256sum dictionaries/da/index.aff dictionaries/da/index.dic
```

Check that the license block in `index.aff` and `README_da_DK.txt` still offers MPL 1.1. Then put the commit, version and sums in `dictionaries/da/NOTICE.txt`, the version in `dictionaries/da/package.json` and in the Danish test in `scripts/spellcheck.test.js`, run `npm install --install-links=false` and `npm test`.

If you speak one of these and something reads oddly, a pull request that fixes a line is the most welcome contribution there is.

NEO's interface can be shown in any language. Each language is a single file in `locales/`, and adding one needs no programming.

## Add a language

1. Copy `locales/_template.json` to `locales/<code>.json`, where `<code>` is the language's code: `de` for German, `es` for Spanish, `pt-BR` for Brazilian Portuguese.
2. Set `_meta.name` to the language's own name (`Deutsch`, `Español`). That is what the **View → Language** menu shows.
3. Fill in each empty value with the translation of its English key. Anything left empty simply stays in English, so a partial translation is fine to start with.
4. Check your work: `node scripts/i18n.js check <code>`. It lists what is missing, and any `{placeholder}` that went astray.

The new language appears in **View → Language** the next time NEO starts.

## Regional variants

Language codes follow [BCP 47](https://www.rfc-editor.org/info/bcp47): a language (`fr`), optionally followed by a region (`fr-CA`, `fr-BE`, `fr-CH`). NEO also accepts the POSIX spelling (`fr_CA`) when reading a system or saved setting.

A language's base file (`fr.json`) serves every region. A regional file (`fr-CA.json`) holds **only the strings that differ** there, and everything else comes from the base file, then from English:

```
fr-CA.json  →  fr.json  →  English
```

So `fr-CA.json` is short: in Quebec, "courriel" instead of "e-mail", and no space before `; ! ?`. A system set to Belgian or Swiss French, with no `fr-BE.json` or `fr-CH.json`, simply uses `fr.json`. Add a regional file only when wording really differs; numbers and dates already follow the region through the system's own formats.

`node scripts/i18n.js check fr-CA` counts the base file's strings as covered.

## The rules of the file

- **Placeholders** in braces, like `{title}` or `{n}`, are filled in by NEO. Keep them, spelled exactly the same; you can move them anywhere in the sentence.
- **Plurals.** When a string counts something with `{n}`, you can give one form per plural category instead of a single string:

  ```json
  "{n} words": { "one": "{n} mot", "other": "{n} mots" }
  ```

  The categories are those of your language in [Unicode's plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) (`one`, `few`, `many`, `other`…). `other` is always required.
- **Numbers** are formatted for the language automatically (`1,234` in English, `1 234` in French).
- **`&amp;`** appears in a few help strings that are shown as HTML. Keep it as `&amp;` (or rephrase without an ampersand).
- **Keyboard keys** such as `⌘`, `⇧` or `Ctrl` are added by NEO; translate the words around them.

## Typing in each language

While writing, NEO sets the quotation marks of the language being written: the spellcheck language when one is chosen, otherwise NEO's own language. « » for French (with narrow no-break spaces), Spanish, Italian, European Portuguese, Russian and Ukrainian; „ “ for German; „ ” for Polish, Romanian and Hungarian; “ ” for English, Dutch, Brazilian Portuguese and Korean; ” ” for Swedish; » « for Danish. Swedish books set in »…» keep that style, and Danish books set in „…“ keep theirs. The apostrophe is always ’. French also gets a narrow no-break space before ; : ! ? (before : only in Canadian French). The table is `QUOTE_STYLES` in `app.js`.

A book that has settled on other guillemets keeps them: in a German novel set in »…«, or Swiss writing in «…», type the first mark by hand and NEO carries on in that style (`bookQuotes` in `app.js`).

Imports recognize chapter headings in all these interface languages (`CHAPTER_WORDS` in `main.js`), and cover titles treat each language's small words like "of" and "the" (`CONNECTORS` in `covers.js`).

## Fonts in other alphabets

Most fonts NEO bundles (the body fonts on Linux, the drop caps and the cover titles, in `fonts/`) have Latin letters only. For Russian, each has a companion under the same font name in `styles.css` that supplies the Cyrillic letters, so Latin text looks exactly as before. A language with letters of its own needs the same check: every bundled font, companions included, must carry them. Korean has them too: Noto Serif KR for the serif faces, Noto Sans KR for the sans ones, each cut down to Hangul (the syllables, the jamo and CJK punctuation) as one variable file, so every weight comes from it. Hanja still come from the system's fonts.

Korean also changes how the interface sets its labels (the end of `styles.css`): words are kept whole when a line wraps, the wide letter-spacing of the small labels is narrowed, and Hangul is never slanted into a fake italic.

## For developers

The English text is the key. In the window (`app.js`) and the main process (`main.js`), wrap every string a writer can see:

```js
toast(t('Chapter removed — its words are in Darlings, or {key} to undo', { key: KZ }));
```

- `t()` translates now. `tk()` only marks a string for translation where it is defined, for strings translated later with `t()` when shown.
- In `index.html`, mark text with `data-i18n`, and attributes with `data-i18n-title`, `data-i18n-placeholder` or `data-i18n-ph`.
- English plural forms live in `locales/en.json`.
- After adding or changing strings, run `node scripts/i18n.js template` to refresh `locales/_template.json`, and `node scripts/i18n.js check fr` (for each language) to see what needs translating.

The window receives its language once, before any of its code runs (see `preload.js`); changing the language saves the open book and reloads the window.
