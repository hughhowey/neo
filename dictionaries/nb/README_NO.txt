Norwegian (Bokmål and Nynorsk) spelling dictionaries for LibreOffice
====================================================================

Version 3.0
Maintainer: Lars Bungum

This package updates the bundled Norwegian dictionaries (dict-no).
It replaces the Hunspell word lists for Norwegian Bokmål (nb-NO) and
Norwegian Nynorsk (nn-NO). Affix files are the existing spell-norwegian
affixes, recoded to UTF-8. Hyphenation patterns and thesauri are
unchanged from the previous dict-no package.


Spell-check word lists
----------------------

nb_NO.dic  708615 words  (Norwegian Bokmål)
nn_NO.dic  540664 words  (Norwegian Nynorsk)

Encoding: UTF-8 (SET UTF-8 in the corresponding .aff files).


Sources and licences
--------------------

1. Ordbanken (Nasjonalbiblioteket)

   The morphological database Ordbanken was downloaded from
   Nasjonalbiblioteket / Språkbanken. Full-form lists were taken out
   of that download and used as the bulk of the spelling word lists.

   Licence: CC BY 4.0 — free use with attribution to
   Nasjonalbiblioteket.

   https://creativecommons.org/licenses/by/4.0/


2. New headwords from the 2018–2024 revision of Bokmålsordboka and
   Nynorskordboka (CLARIN PUB +BY)

   Additional lemmas for Bokmål and Nynorsk were taken from the
   nyordslister published after the revision of the two official
   dictionaries (2018–2024):

   Bokmål:
   https://www.nb.no/sprakbanken/ressurskatalog/oai-repo-clarino-uib-no-11509-152/
   Persistent identifier: http://hdl.handle.net/11509/152
   oai:repo.clarino.uib.no:11509/152
   “Nyordsliste etter revisjonen av Bokmålsordboka (2018–2024)”

   Nynorsk:
   https://www.nb.no/sprakbanken/ressurskatalog/oai-repo-clarino-uib-no-11509-151/
   Persistent identifier: http://hdl.handle.net/11509/151
   oai:repo.clarino.uib.no:11509/151
   “Nyordsliste etter revisjon av Nynorskordboka (2018–2024)”

   Distributed by CLARINO Bergen.

   Licence: CLARIN PUB +BY (attribution required)
   https://www.kielipankki.fi/wp-content/uploads/CLARIN_PUB_BY_en.html
   Persistent identifier: http://urn.fi/urn:nbn:fi:lb-2019071721

   Acknowledgement: Kultur- og likestillingsdepartementet (KUD)


3. «Årets ord» from Språkrådet

   Words of the year and related new-word material were collected
   manually from Språkrådet’s public web pages and added to the
   merged lists.


4. Full-form generation

   Full-form lists for the new lemmas were created according to
   Ordbanken’s own code / inflection machinery, so that inflected
   forms follow the same patterns as the rest of the dictionary.


Affix files, hyphenation, and thesaurus
---------------------------------------

nb_NO.aff, nn_NO.aff, hyphenation patterns, and thesauri originate
from the spell-norwegian project and the previous LibreOffice dict-no
package.

  Copyright: The spell-norwegian project
  https://alioth.debian.org/projects/spell-norwegian/
  Licence: GNU GPL version 2 (see COPYING)

The affix files in this update differ from upstream only by encoding:
SET ISO8859-1 was changed to SET UTF-8, and the files were recoded
from ISO-8859-1 to UTF-8 so they match the UTF-8 .dic files.


File layout (matches dictionaries/no in dictionaries.git)
---------------------------------------------------------

  nb_NO.aff / nb_NO.dic     Hunspell, locale nb-NO
  nn_NO.aff / nn_NO.dic     Hunspell, locale nn-NO
  hyph_nb_NO.dic            hyphenation, locale nb-NO
  hyph_nn_NO.dic            hyphenation, locale nn-NO
  th_nb_NO_v2.dat           thesaurus, locale nb-NO
  th_nn_NO_v2.dat           thesaurus, locale nn-NO
  dictionaries.xcu          Linguistic configuration
  description.xml           extension identifier
                            org.no.openoffice.dictionary.no-NO


Attribution summary
-------------------

  Nasjonalbiblioteket — Ordbanken (CC BY 4.0)
  CLARINO Bergen / Språkbanken — nyordslister 11509/152 and 11509/151
      (CLARIN PUB +BY)
  Kultur- og likestillingsdepartementet (KUD) — acknowledgement for
      the dictionary revision resources
  Språkrådet — «årets ord» (manually collected from public pages)
  The spell-norwegian project — affix files, hyphenation, thesaurus
      (GNU GPL v2)
  Lars Bungum — merging, full-form generation, UTF-8 packaging
