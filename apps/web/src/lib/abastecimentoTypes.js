const text = (value) => String(value ?? '').trim();
const key = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const DEFAULT_FUEL_ITEMS = ['Diesel S-10', 'Diesel S-500', 'Gasolina Comum', 'Etanol', 'ARLA', 'Graxa'];

export function uniqueOptions(values) {
    const options = new Map();
    values.forEach((value) => { if (/\p{L}/u.test(text(value)) && !options.has(key(value))) options.set(key(value), text(value)); });
    return [...options.values()];
}

export function abastecimentoCategory(category, item) {
    if (key(item).includes('graxa')) return 'Graxa';
    return text(category) || 'Combustível';
}

export function isFuelConsumption(row) {
    return key(row?.categoria || 'Combustível').includes('combust') && !key(row?.item).includes('graxa');
}

export function abastecimentoUnit(category, item) {
    if (key(category).includes('graxa') || key(item).includes('graxa') || /\bkg\b/.test(key(item))) return 'kg';
    return 'L';
}

export function changeAbastecimentoCategory(form, category) {
    const grease = key(category).includes('graxa');
    const fuel = key(category).includes('combust');
    return { ...form, categoria: category, item: grease ? 'Graxa' : fuel ? (key(form.item).includes('graxa') || !form.item ? 'Diesel S-10' : form.item) : '' };
}

// Match multiplicity, not just values: two genuine identical sheet records stay two.
export function mergeAbastecimentoRows(primary = [], extra = []) {
    const signature = (row) => JSON.stringify([row.data, key(row.placa), key(row.categoria), key(row.item), row.valor, row.litros]);
    const counts = new Map();
    primary.forEach((row) => counts.set(signature(row), (counts.get(signature(row)) || 0) + 1));
    return [...primary, ...extra.filter((row) => {
        const count = counts.get(signature(row)) || 0;
        if (!count) return true;
        counts.set(signature(row), count - 1);
        return false;
    })];
}
