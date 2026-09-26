function resolveInterfaceLanguage(preferences = {}, appLocale = '') {
  if (preferences.interfaceLanguage === 'en' || preferences.interfaceLanguage === 'pt-BR') {
    return preferences.interfaceLanguage;
  }

  return /^pt-br$/i.test(appLocale) ? 'pt-BR' : 'pt-BR';
}

module.exports = { resolveInterfaceLanguage };
