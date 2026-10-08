import { moneyCents } from './ownedVehicleFinance.js';

// Position confirmed by the manager on 08/10/2026. Initial months are estimates.
export const VEHICLE_INSTALLMENTS = Object.freeze([
    { id: 'hyundai', name: 'Escavadeira Hyundai', paid: 17, total: 77, currentCents: null },
    { id: 'jcb', name: '2 Retroescavadeiras JCB', paid: 19, total: 79, currentCents: null },
    { id: 'l200', name: '3 Mitsubishi L200', paid: 10, total: 55, currentCents: null },
    { id: 'prancha', name: 'Prancha — Consórcio', paid: 27, total: 100, currentCents: 525928 },
]);

// Identifiers verified in Cadastro de Veículos; prices are read live, not copied into code.
const FINANCED_PLATES = {
    hyundai: ['HBRBE440TR0085665'],
    jcb: ['SOR3CXTTER3423582', 'SOR3CXTTER3423584'],
    l200: ['TEQ1D19', 'TEO9H16', 'TEQ4H56'],
};
const key = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const own = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase() === 'PROPRIO';

export function resolveInstallmentAmounts(registry = []) {
    return VEHICLE_INSTALLMENTS.map(contract => {
        if (contract.id === 'prancha') return { ...contract, members: [], amountNote: 'Valor atualizado informado pelo gestor; Cadastro ainda pode conter o valor anterior.' };
        const members = FINANCED_PLATES[contract.id].map(plate => {
            const matches = registry.filter(row => key(row.placa) === plate && own(row.tipoPosse));
            const values = [...new Set(matches.map(row => moneyCents(row.parcelaMensal)))];
            return { plate, cents: values.length === 1 ? values[0] : null };
        });
        const complete = members.every(row => row.cents !== null);
        return { ...contract, members, currentCents: complete ? members.reduce((sum, row) => sum + row.cents, 0) : null, amountNote: members.length > 1 ? 'Soma mensal das parcelas dos veículos do grupo, sem multiplicar novamente.' : 'Parcela mensal do Cadastro.' };
    });
}

export function installmentCalendar(contract, today) {
    const referenceMonth = 2026 * 12 + 9; // October, last paid month assumed for estimating only.
    const firstMonth = referenceMonth - contract.paid + 1;
    return Array.from({ length: contract.total }, (_, index) => {
        const month = firstMonth + index;
        const dueDate = `${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, '0')}-01`;
        const confirmedPaid = index < contract.paid;
        return {
            number: index + 1,
            dueDate,
            status: confirmedPaid ? 'Paga — posição confirmada' : dueDate < today ? 'Vencida e não paga' : 'A vencer',
            confirmedPaid,
            // Current price is only a projection for remaining installments, not historical proof.
            projectedCents: confirmedPaid ? null : contract.currentCents,
        };
    });
}

export function monthlyInstallmentExpense(registry, month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return { available: false, totalCents: null, rows: [], missing: [], vehiclesCents: null, truckCents: null, machinesCents: null };
    const rows = resolveInstallmentAmounts(registry).flatMap(contract => {
        const installment = installmentCalendar(contract, `${month}-01`).find(row => row.dueDate.slice(0, 7) === month);
        return installment ? [{ ...contract, installment, category: contract.id === 'l200' ? 'Veículos' : contract.id === 'prancha' ? 'Caminhão' : 'Máquinas', amountCents: contract.currentCents }] : [];
    });
    const sum = category => {
        const members = category ? rows.filter(row => row.category === category) : rows;
        return members.some(row => row.amountCents === null) ? null : members.reduce((total, row) => total + row.amountCents, 0);
    };
    const missing = rows.filter(row => row.amountCents === null).map(row => row.name);
    return { available: missing.length === 0, missing, rows, totalCents: sum(), vehiclesCents: sum('Veículos'), truckCents: sum('Caminhão'), machinesCents: sum('Máquinas') };
}

// Repricing past installments is an estimate, never the actual payment ledger.
export function estimateInstallmentTotals(contracts) {
    const available = contracts.every(contract => contract.currentCents !== null);
    const total = count => available ? contracts.reduce((sum, contract) => sum + contract.currentCents * count(contract), 0) : null;
    return { available, estimatedPaidCents: total(contract => contract.paid), estimatedRemainingCents: total(contract => contract.total - contract.paid), estimatedContractCents: total(contract => contract.total), actualPaidCents: null };
}
