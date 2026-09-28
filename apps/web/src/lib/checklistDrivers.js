// A mesma pessoa pode escrever o nome com espaços diferentes no formulário.
// Preserve todas as letras: só associe abreviações confirmadas pelo responsável.
const normalizeDriverName = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, '');

// Correspondências confirmadas pelo responsável pela frota em 28/09/2026.
const confirmedAliases = new Map([
    ['SidenioBispo', 'SIDENIO BISPO MARTINS'],
    ['CarlosAlexandre', 'CARLOS ALEXANDRE DE SOUZA SANTOS'],
].map(([alias, name]) => [normalizeDriverName(alias), normalizeDriverName(name)]));

export const driverNameKey = (value) => {
    const key = normalizeDriverName(value);
    return confirmedAliases.get(key) || key;
};

const validNameKey = (value) => {
    const key = driverNameKey(value);
    return /\p{L}/u.test(key) ? key : '';
};

export function summarizeChecklistDrivers(registeredNames, completedNames) {
    const registeredByKey = new Map();
    for (const name of registeredNames) {
        const key = validNameKey(name);
        if (key && !registeredByKey.has(key)) registeredByKey.set(key, String(name).trim());
    }
    const completedKeys = new Set(completedNames.map(validNameKey).filter(Boolean));
    return {
        completedCount: completedKeys.size,
        missingDrivers: [...registeredByKey]
            .filter(([key]) => !completedKeys.has(key))
            .map(([, name]) => name),
        displayName: (name) => registeredByKey.get(validNameKey(name)) || String(name || '—').trim(),
    };
}
