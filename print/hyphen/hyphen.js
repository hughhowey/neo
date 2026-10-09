/** Text hyphenation in Javascript.
 *  Copyright (C) 2026 Yevhen Tiurin (yevhentiurin@gmail.com)
 *  https://github.com/ytiurin/hyphen
 *
 *  Released under the ISC license
 *  https://github.com/ytiurin/hyphen/blob/master/LICENSE
 */
(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    // AMD. Register as an anonymous module.
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    // Browser globals (root is window)
    root.createHyphenator = factory();
  }
})(this, function () {
  function createTextReader(setup) {
    var char1 = "";
    var char2 = "";
    var i = 0;
    var verifier = setup();
    return function (text) {
      while (i < text.length) {
        char1 = text.charAt(i++);
        char2 = text.charAt(i);
        var verified = verifier(char1, char2);
        if (verified !== void 0) {
          return verified;
        }
      }
    };
  }

  var isNotLetter = RegExp.prototype.test.bind(
    /\s|(?![\'])[\!-\@\[-\`\{-\~\u2013-\u203C]/
  );
  function createHTMLVerifier() {
    var skip = false;
    return function (accumulate, chars) {
      if (skip) {
        if (chars[0] === ">") {
          accumulate();
          skip = false;
        }
      } else if (
        chars[0] === "<" &&
        (!isNotLetter(chars[1]) || chars[1] === "/")
      ) {
        skip = true;
      }
      return skip;
    };
  }
  function createHyphenCharVerifier(hyphenChar) {
    var skip = false;
    return function (accumulate, chars) {
      if (skip) {
        if (!isNotLetter(chars[0]) && isNotLetter(chars[1])) {
          accumulate();
          skip = false;
        }
      } else if (!isNotLetter(chars[0]) && chars[1] === hyphenChar) {
        skip = true;
      }
      return skip;
    };
  }
  function createHyphenationVerifier(verifiers, minWordLength) {
    return function () {
      var accum0 = "";
      var accum = "";
      function accumulate() {
        accum0 += accum;
        accum = "";
      }
      function resolveWith(value) {
        accum0 = "";
        accum = "";
        return value;
      }
      return function (char1, char2) {
        accum += char1;
        var skip = verifiers.reduce(function (skip2, verify) {
          return skip2 || verify(accumulate, [char1, char2]);
        }, false);
        if (!skip) {
          if (isNotLetter(char1) && !isNotLetter(char2)) {
            accumulate();
          }
          if (!isNotLetter(char1) && isNotLetter(char2)) {
            if (accum.length >= minWordLength) {
              return resolveWith([accum0, accum]);
            } else {
              accumulate();
            }
          }
        }
        if (char2 === "") {
          if (accum.length < minWordLength || skip) {
            accumulate();
          }
          return resolveWith([accum0, accum]);
        }
      };
    };
  }

  function levelsToMarkers(levels) {
    var markers = [];
    for (var i = 0; i < levels.length; i++)
      if ((levels[i] & 1) === 1) markers.push(i);
    return markers;
  }
  function insertChar(text, hyphenChar, markers) {
    if (markers.length === 0) {
      return text;
    }
    var resultText = [text.slice(0, markers[0])];
    if (markers.length > 1)
      for (var i = 0, j = 1; j < markers.length; i++, j++) {
        resultText.push(text.slice(markers[i], markers[j]));
      }
    resultText.push(text.slice(markers[markers.length - 1]));
    return resultText.join(hyphenChar);
  }
  function markersFromExceptionsDefinition(exceptionsList) {
    return exceptionsList.reduce(function (markersDict, definition) {
      var i = 0,
        markers = [];
      while ((i = definition.indexOf("-", i + 1)) > -1) {
        markers.push(i);
      }
      markersDict[definition.toLocaleLowerCase().replace(/\-/g, "")] = markers;
      return markersDict;
    }, {});
  }

  function createCharIterator(str) {
    var i = 0;
    function nextChar() {
      return str[i++];
    }
    return nextChar;
  }
  function createStringSlicer(str) {
    var i = 0,
      slice = str;
    function next() {
      slice = str.slice(i++);
      if (slice.length < 3) {
        return;
      }
      return slice;
    }
    function isFirstCharacter() {
      return i === 2;
    }
    return [next, isFirstCharacter];
  }
  function hyphenateWord(text, loweredText, levelsTable, patternTrie) {
    var levels = new Array(text.length + 1),
      loweredText = ("." + loweredText + ".").split(""),
      wordSlice,
      letter,
      triePtr,
      trieNode,
      patternLevelsIndex,
      patternLevels,
      patternEntityIndex = -1,
      slicer,
      nextSlice,
      isFirstCharacter,
      nextLetter;
    for (var i = levels.length; i--; ) levels[i] = 0;
    slicer = createStringSlicer(loweredText);
    nextSlice = slicer[0];
    isFirstCharacter = slicer[1];
    while ((wordSlice = nextSlice())) {
      patternEntityIndex++;
      if (isFirstCharacter()) {
        patternEntityIndex--;
      }
      triePtr = patternTrie;
      nextLetter = createCharIterator(wordSlice);
      while ((letter = nextLetter())) {
        if ((trieNode = triePtr[letter]) === void 0) {
          break;
        }
        triePtr = {};
        patternLevelsIndex = -1;
        switch (Object.prototype.toString.call(trieNode)) {
          case "[object Array]":
            triePtr = trieNode[0];
            patternLevelsIndex = trieNode[1];
            break;
          case "[object Object]":
            triePtr = trieNode;
            break;
          case "[object Number]":
            patternLevelsIndex = trieNode;
            break;
        }
        if (patternLevelsIndex < 0) {
          continue;
        }
        patternLevels = levelsTable[patternLevelsIndex];
        for (var k = 0; k < patternLevels.length; k++)
          levels[patternEntityIndex + k] = Math.max(
            patternLevels[k],
            levels[patternEntityIndex + k]
          );
      }
    }
    levels[0] = levels[1] = levels[levels.length - 1] = levels[
      levels.length - 2
    ] = 0;
    return levelsToMarkers(levels);
  }

  function start(
    text,
    levelsTable,
    patterns,
    cache,
    markersDict,
    hyphenChar,
    skipHTML,
    minWordLength,
    isAsync
  ) {
    function done() {
      resolveNewText(newText);
    }
    var newText = "",
      fragments,
      readText = createTextReader(
        createHyphenationVerifier(
          (skipHTML ? [createHTMLVerifier()] : []).concat(
            createHyphenCharVerifier(hyphenChar)
          ),
          minWordLength
        )
      ),
      resolveNewText = function () {};
    function nextTick() {
      var loopStart = /* @__PURE__ */ new Date();
      while (
        (!isAsync || /* @__PURE__ */ new Date() - loopStart < 10) &&
        (fragments = readText(text))
      ) {
        if (fragments[1]) {
          var cacheKey = fragments[1].length ? "~" + fragments[1] : "";
          if (!Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
            var loweredWord = fragments[1].toLocaleLowerCase();
            if (!Object.prototype.hasOwnProperty.call(markersDict, loweredWord))
              markersDict[loweredWord] = hyphenateWord(
                fragments[1],
                loweredWord,
                levelsTable,
                patterns
              );
            cache[cacheKey] = insertChar(
              fragments[1],
              hyphenChar,
              markersDict[loweredWord]
            );
          }
          fragments[1] = cache[cacheKey];
        }
        newText += fragments[0] + fragments[1];
      }
      if (!fragments) {
        done();
      } else {
        setTimeout(nextTick);
      }
    }
    if (isAsync) {
      setTimeout(nextTick);
      return new Promise(function (resolve) {
        resolveNewText = resolve;
      });
    } else {
      nextTick();
      return newText;
    }
  }

  var SETTING_DEFAULT_ASYNC = false;
  var SETTING_DEFAULT_EXCEPTIONS = [];
  var SETTING_DEFAULT_HTML = true;
  var SETTING_DEFAULT_HYPH_CHAR = "\xAD";
  var SETTING_DEFAULT_MIN_WORD_LENGTH = 5;
  var SETTING_NAME_ASYNC = "async";
  var SETTING_NAME_EXCEPTIONS = "exceptions";
  var SETTING_NAME_HTML = "html";
  var SETTING_NAME_HYPH_CHAR = "hyphenChar";
  var SETTING_NAME_MIN_WORD_LENGTH = "minWordLength";
  var _global =
    typeof global === "object"
      ? global
      : typeof window === "object"
      ? window
      : typeof self === "object"
      ? self
      : false
      ? void 0
      : {};
  function extend(target, source) {
    target = target || {};
    for (var key in source) {
      target[key] = source[key];
    }
    return target;
  }
  function validateArray(value) {
    return value instanceof Array;
  }
  function keyOrDefault(object, key, defaultValue, test) {
    if (key in object && (test ? test(object[key]) : true)) {
      return object[key];
    }
    return defaultValue;
  }
  function exceptionsFromMarkers(markers, hyphenChar) {
    var exceptions = {};
    for (var word in markers) {
      exceptions["~" + word] = insertChar(word, hyphenChar, markers[word]);
    }
    return exceptions;
  }
  function exceptionsFromDefinition(exceptionsList, hyphenChar) {
    return exceptionsList.reduce(function (exceptions, exception) {
      exceptions["~" + exception.replace(/\-/g, "")] = exception.replace(
        /\-/g,
        hyphenChar
      );
      return exceptions;
    }, {});
  }
  function createHyphenator(patternsDefinition, options) {
    options = options || {};
    var asyncMode = keyOrDefault(
        options,
        SETTING_NAME_ASYNC,
        SETTING_DEFAULT_ASYNC
      ),
      caches = {},
      markersDict = {},
      exceptions = {},
      hyphenChar = keyOrDefault(
        options,
        SETTING_NAME_HYPH_CHAR,
        SETTING_DEFAULT_HYPH_CHAR
      ),
      levelsTable = patternsDefinition[0],
      patterns = patternsDefinition[1],
      minWordLength =
        keyOrDefault(
          options,
          SETTING_NAME_MIN_WORD_LENGTH,
          SETTING_DEFAULT_MIN_WORD_LENGTH
        ) >> 0,
      skipHTML = keyOrDefault(options, SETTING_NAME_HTML, SETTING_DEFAULT_HTML),
      userExceptions = keyOrDefault(
        options,
        SETTING_NAME_EXCEPTIONS,
        SETTING_DEFAULT_EXCEPTIONS,
        validateArray
      );
    var cacheKey = hyphenChar + minWordLength;
    exceptions[cacheKey] = {};
    if (patternsDefinition[2]) {
      exceptions[cacheKey] = exceptionsFromMarkers(
        patternsDefinition[2],
        hyphenChar
      );
      markersDict = patternsDefinition[2];
    }
    if (userExceptions && userExceptions.length) {
      exceptions[cacheKey] = extend(
        exceptions[cacheKey],
        exceptionsFromDefinition(userExceptions, hyphenChar)
      );
      markersDict = extend(
        markersDict,
        markersFromExceptionsDefinition(userExceptions)
      );
    }
    caches[cacheKey] = extend({}, exceptions[cacheKey]);
    if (asyncMode && !("Promise" in _global)) {
      throw new Error(
        "Failed to create hyphenator: Could not find global Promise object, needed for hyphenator to work in async mode"
      );
    }
    return function (text, options2) {
      options2 = options2 || {};
      var localHyphenChar = keyOrDefault(
          options2,
          SETTING_NAME_HYPH_CHAR,
          hyphenChar
        ),
        localMinWordLength =
          keyOrDefault(options2, SETTING_NAME_MIN_WORD_LENGTH, minWordLength) >>
          0,
        localUserExceptions = keyOrDefault(
          options2,
          SETTING_NAME_EXCEPTIONS,
          SETTING_DEFAULT_EXCEPTIONS,
          validateArray
        ),
        cacheKey2 = localHyphenChar + localMinWordLength;
      if (!exceptions[cacheKey2] && patternsDefinition[2]) {
        exceptions[cacheKey2] = exceptionsFromMarkers(
          patternsDefinition[2],
          localHyphenChar
        );
        caches[cacheKey2] = extend(caches[cacheKey2], exceptions[cacheKey2]);
      }
      if (localUserExceptions && localUserExceptions.length) {
        exceptions[cacheKey2] = extend(
          exceptions[cacheKey2],
          exceptionsFromDefinition(localUserExceptions, localHyphenChar)
        );
        markersDict = extend(
          markersDict,
          markersFromExceptionsDefinition(localUserExceptions)
        );
        caches[cacheKey2] = extend(caches[cacheKey2], exceptions[cacheKey2]);
      }
      return start(
        text,
        levelsTable,
        patterns,
        caches[cacheKey2],
        markersDict,
        localHyphenChar,
        skipHTML,
        localMinWordLength,
        asyncMode
      );
    };
  }

  return createHyphenator;
});
