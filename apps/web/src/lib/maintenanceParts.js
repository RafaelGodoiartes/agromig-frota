import { isoDate } from './faturamento.js';
import { moneyCents } from './ownedVehicleFinance.js';

const text = (value) => String(value ?? '').trim();
const searchKey = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const plateKey = (value) => searchKey(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const sum = (rows) => rows.reduce((total, row) => total + (row.amountCents ?? 0), 0);

export function resolvePartsVehicle(value, vehicles = []) {
    const raw = text(value);
    const key = plateKey(raw);
    const exact = vehicles.find((row) => plateKey(row.placa) === key);
    if (exact) return text(exact.placa);
    const tokens = raw.toUpperCase().match(/\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/g) || [];
    const matches = vehicles.filter((row) => tokens.some((token) => plateKey(token) === plateKey(row.placa)));
    return matches.length === 1 ? text(matches[0].placa) : raw;
}

export function summarizeMaintenanceParts(source, { from = '', to = '', plate = 'all', search = '', currentDate, vehicles = [] } = {}) {
    const today = isoDate(currentDate) || new Date().toISOString().slice(0, 10);
    const invalidPeriod = Boolean(from && to && from > to);
    const query = searchKey(search);
    const rows = (Array.isArray(source) ? source : []).map((row, index) => {
        const entryDate = isoDate(row.dataEntrada);
        const exitDate = isoDate(row.dataSaida);
        const invalidDates = (text(row.dataEntrada) && !entryDate) || (text(row.dataSaida) && !exitDate)
            || (entryDate && exitDate && exitDate < entryDate);
        const status = invalidDates ? 'Conferir datas' : !entryDate ? 'Entrada não informada'
            : entryDate > today ? 'Entrada futura' : exitDate && exitDate <= today ? 'Utilizada' : 'Em estoque';
        const placa = resolvePartsVehicle(row.placa, vehicles);
        return { ...row, placa, sourceVehicle: row.placa, key: `${row.id ?? 'row'}-${index}`, entryDate, exitDate, status,
            amountCents: moneyCents(row.valor), plateKey: plateKey(placa) };
    }).filter((row) => (plate === 'all' || row.plateKey === plateKey(plate))
        && (!query || searchKey(`${row.peca || ''} ${row.tipo || ''} ${row.fornecedor || ''} ${row.placa || ''} ${row.sourceVehicle || ''}`).includes(query)));
    // Purchase spend uses entry date. Current inventory deliberately includes older entries.
    const periodRows = invalidPeriod ? [] : rows.filter((row) => row.entryDate
        && (!from || row.entryDate >= from) && (!to || row.entryDate <= to));
    const stockRows = rows.filter((row) => row.status === 'Em estoque');
    const monthly = new Map();
    const vehicleTotals = new Map();
    periodRows.forEach((row) => {
        const month = row.entryDate.slice(0, 7);
        monthly.set(month, (monthly.get(month) ?? 0) + (row.amountCents ?? 0));
        if (!row.plateKey || ['EMESTOQUE', 'ESTOQUE'].includes(row.plateKey)) return;
        if (!vehicleTotals.has(row.plateKey)) vehicleTotals.set(row.plateKey, { placa: row.placa, plateKey: row.plateKey, count: 0, amountCents: 0, missingValues: 0 });
        const group = vehicleTotals.get(row.plateKey);
        group.count += 1;
        group.amountCents += row.amountCents ?? 0;
        group.missingValues += row.amountCents === null ? 1 : 0;
    });
    return {
        available: Array.isArray(source), invalidPeriod, periodRows, stockRows,
        totalCents: sum(periodRows), stockCents: sum(stockRows),
        missingDates: rows.filter((row) => !row.entryDate).length,
        invalidDates: rows.filter((row) => row.status === 'Conferir datas').length,
        missingValues: periodRows.filter((row) => row.amountCents === null).length,
        stockMissingValues: stockRows.filter((row) => row.amountCents === null).length,
        expensiveRows: [...periodRows].filter((row) => row.amountCents !== null).sort((a, b) => b.amountCents - a.amountCents).slice(0, 10),
        monthly: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([month, cents]) => ({ month, label: `${month.slice(5)}/${month.slice(0, 4)}`, valor: cents / 100 })),
        vehicles: [...vehicleTotals.values()].sort((a, b) => b.amountCents - a.amountCents),
    };
}
