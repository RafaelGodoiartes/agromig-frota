const text = (value) => String(value ?? '').trim();
const key = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const plateKey = (value) => key(value).replace(/[^A-Z0-9]/g, '');

export const OWNED_FLEET_INSURANCE = Object.freeze({
    firstDueDate: '2026-08-13',
    installments: 10,
    regularCents: 417719,
    lastCents: 417721,
});

// Keep amounts in cents; blank/invalid values are not a healthy zero.
export function moneyCents(value) {
    if (value === null || value === undefined || text(value) === '') return null;
    let number = value;
    if (typeof number !== 'number') {
        const raw = text(value).replace(/R\$/gi, '').replace(/\s/g, '');
        const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.')
            : /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw;
        if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
        number = Number(normalized);
    }
    const cents = Math.round((number + Number.EPSILON) * 100);
    return Number.isFinite(number) && number >= 0 && Number.isSafeInteger(cents) ? cents : null;
}

export function summarizeOwnedVehicles(vehicles = []) {
    const groups = new Map();
    vehicles.forEach((row) => {
        const plate = plateKey(row.placa);
        if (!plate) return;
        if (!groups.has(plate)) groups.set(plate, []);
        groups.get(plate).push(row);
    });
    const rows = [];
    const conflicts = [];
    groups.forEach((group, plate) => {
        const signatures = new Set(group.map((row) => `${key(row.tipoPosse)}|${moneyCents(row.aluguelMensal)}`));
        if (signatures.size > 1 && group.some((row) => key(row.tipoPosse) === 'PROPRIO')) {
            conflicts.push(plate);
            return;
        }
        const row = group[0];
        if (key(row.tipoPosse) !== 'PROPRIO') return;
        rows.push({ ...row, plateKey: plate, amountCents: moneyCents(row.aluguelMensal) });
    });
    rows.sort((a, b) => a.plateKey.localeCompare(b.plateKey));
    return {
        rows,
        conflicts,
        missingValues: rows.filter((row) => row.amountCents === null).map((row) => row.placa),
        totalCents: rows.reduce((sum, row) => sum + (row.amountCents ?? 0), 0),
    };
}

export function insuranceSchedule(plan = OWNED_FLEET_INSURANCE) {
    const [year, month, day] = plan.firstDueDate.split('-').map(Number);
    return Array.from({ length: plan.installments }, (_, index) => ({
        number: index + 1,
        dueDate: new Date(Date.UTC(year, month - 1 + index, day)).toISOString().slice(0, 10),
        amountCents: index === plan.installments - 1 ? plan.lastCents : plan.regularCents,
    }));
}

export function summarizeInsurance(month, paidInstallments = null, schedule = insuranceSchedule()) {
    const installment = schedule.find((row) => row.dueDate.slice(0, 7) === month) || null;
    const totalCents = schedule.reduce((sum, row) => sum + row.amountCents, 0);
    // A past due date does not establish whether payment was made.
    const paymentKnown = Array.isArray(paidInstallments);
    const paid = new Set(paymentKnown ? paidInstallments : []);
    const paidCents = paymentKnown ? schedule.reduce((sum, row) => sum + (paid.has(row.number) ? row.amountCents : 0), 0) : null;
    return {
        installment,
        expenseCents: installment?.amountCents ?? 0,
        totalCents,
        paidCents,
        balanceCents: paidCents === null ? null : totalCents - paidCents,
    };
}

export const formatFinanceBRL = (cents) => cents === null || cents === undefined ? 'Não informado'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
