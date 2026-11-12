# Brazilian Portuguese dictionary evaluation

Evaluated on 2026-09-30 with Hunspell 1.7.3 (`@farscrl/hunspell-wasm`
1.0.1), Node 22, Linux x64, and confirmed inside a packaged `app.asar`
under Electron 43. `dictionary-pt` 4.0.0 is VERO, the Brazilian Portuguese
dictionary LibreOffice ships (`pt_BR`).

## Why it needed Hunspell

nspell expands every affix rule into memory before the first lookup, and
VERO's affix file is close to a megabyte of rules: loading took minutes.
Hunspell applies the rules at lookup time instead.

## Performance

`node scripts/benchmark-spellcheck.js` (fresh process per trial, third trial):

| Dictionary | Load | 10,000 checks | One suggestion |
| --- | --- | --- | --- |
| en-US | 84 ms | 70 ms | 30 ms |
| fr | 115 ms | 152 ms | 2 ms |
| pt-BR | 361 ms | 103 ms | 2 ms |
| ro | 143 ms | 43 ms | 143 ms |
| ru | 167 ms | 63 ms | 41 ms |

Inside Electron 43, from app.asar, Portuguese loaded in about 0.5 s
including the WebAssembly module. Lookups cross the WebAssembly boundary,
so raw checks are slower than nspell's, but the editor caches every
distinct word and checks run in the spellcheck process, never on the page.

## Correctness

`scripts/spellcheck.test.js` checks clitics (`fazê-lo`, `disse-lhe`,
`dir-se-ia`, `amá-lo-ei`), hyphenated compounds (`guarda-chuva`, `e-mail`),
1990 reform spellings (`ideia`, `voo`, `linguiça`) and common misspellings
(`coracao`, `excessão`, `previlégio`), plus suggestions.

The editor now sends hyphenated words to the dictionary whole. Hunspell
accepts a hyphenated word when it is a dictionary entry or when each piece
is a word. Only when it says no are the individual wrong pieces underlined,
so `well-knwon` marks `knwon` alone. This applies to every language.

## Licensing

`dictionary-pt` is LGPL-3.0 or MPL. NEO uses the MPL 2.0 option. The
files ship unpacked and unmodified in `app.asar.unpacked/node_modules/
dictionary-pt/` with `NOTICE.txt`, `MPL-2.0.txt` and the upstream license
(`notices/dictionary-pt`). Hunspell itself is MPL 1.1 / GPL 2 / LGPL 2.1;
NEO uses MPL 1.1 and ships its notice, with a link to the exact source
commit, in `Resources/licenses/hunspell`.
