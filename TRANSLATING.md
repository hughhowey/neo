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
| `it` | Italiano | complete, machine-assisted: native review welcome |
| `nl` | Nederlands | complete, machine-assisted: native review welcome |
| `pl` | Polski | complete, machine-assisted: native review welcome |
| `ro` | Română | complete, machine-assisted: native review welcome |
| `ru` | Русский | complete, reviewed by a native speaker |
| `hu` | Magyar | complete, reviewed by a native speaker |

Spellchecking (Edit → Spellcheck Language) covers English, French, Spanish, German, Dutch, Polish, Brazilian Portuguese, Romanian, Russian and Hungarian. The engine is Hunspell itself, compiled to WebAssembly, so every dictionary loads in well under a second. Italian is left out because the only Hunspell dictionary on npm is GPL-3.0-only, which does not sit well in an MIT app. The Brazilian Portuguese interface starts with the Brazilian dictionary; the European Portuguese interface leaves the choice to the writer, since spellings differ.

Spellcheck starts off on every launch. Choosing a dictionary does not turn it on. If the interface starts in Romanian and the library has no saved spellcheck language, NEO selects and saves Romanian. Explicit dictionary choices survive interface-language changes. Other interface languages keep their existing defaults.

Romanian lookup accepts standard diacritics, legacy `ş/ţ`, and decomposed Unicode accents without changing manuscript text. Suggestions use standard Romanian spelling. This checks spelling, not grammar: both `sa` and `să` are words. See [the Romanian evaluation](scripts/romanian-spellcheck.md) and [the Portuguese evaluation](scripts/portuguese-spellcheck.md) for performance and licensing details.

The Hungarian dictionary is LibreOffice's Magyar Ispell 1.9, kept in `dictionaries/hu` (the npm `dictionary-hu` package rejected common accusatives like *könyvet*). They are underlined in blue; right-click shows the fix and why. Each rule is a plain pattern run on the writer's computer, and fires only where a mistake is very likely.

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

While writing, NEO sets the quotation marks of the language being written: the spellcheck language when one is chosen, otherwise NEO's own language. « » for French (with narrow no-break spaces), Spanish, Italian, European Portuguese and Russian; „ “ for German; „ ” for Polish, Romanian and Hungarian; “ ” for English, Dutch and Brazilian Portuguese. The apostrophe is always ’. French also gets a narrow no-break space before ; : ! ? (before : only in Canadian French). The table is `QUOTE_STYLES` in `app.js`.

A book that has settled on other guillemets keeps them: in a German novel set in »…«, or Swiss writing in «…», type the first mark by hand and NEO carries on in that style (`bookQuotes` in `app.js`).

In English, "i" on its own becomes "I" as it's typed. A book that writes "i" in lowercase more often than "I", as Norwegian, Swedish, Danish and Catalan do, keeps it as typed, even with NEO in English and no dictionary for its language: in a new book, ⌘Z on the first capital is enough (`writesLowercaseI` in `app.js`).

Imports recognize chapter headings in all these languages (`CHAPTER_WORDS` in `main.js`), and cover titles treat each language's small words like "of" and "the" (`CONNECTORS` in `covers.js`).

## Fonts in other alphabets

Most fonts NEO bundles (the body fonts on Linux, the drop caps and the cover titles, in `fonts/`) have Latin letters only. For Russian, each has a companion under the same font name in `styles.css` that supplies the Cyrillic letters, so Latin text looks exactly as before. A language with letters of its own needs the same check: every bundled font, companions included, must carry them.

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
