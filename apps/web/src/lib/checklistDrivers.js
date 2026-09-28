// A mesma pessoa pode escrever o nome com espaços diferentes no formulário.
// Preserve todas as letras: nomes abreviados ou parecidos não são equivalentes.
export const driverNameKey = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, '');

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
