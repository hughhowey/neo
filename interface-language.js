function resolveInterfaceLanguage(preferences = {}, appLocale = '') {
  if (preferences.interfaceLanguage === 'en' || preferences.interfaceLanguage === 'pt-BR') {
    return preferences.interfaceLanguage;
  }

  return /^pt-br$/i.test(appLocale) ? 'pt-BR' : 'pt-BR';
}

function normalizeLegacyShelfName(name) {
  if (name === 'Works in Progress') return 'Em andamento';
  if (name === 'New Shelf') return 'Nova biblioteca';
  return name;
}

module.exports = { resolveInterfaceLanguage, normalizeLegacyShelfName };
