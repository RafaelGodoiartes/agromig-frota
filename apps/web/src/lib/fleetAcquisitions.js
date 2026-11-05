import { resolveInstallmentAmounts, installmentCalendar } from './vehicleInstallments.js';
import { moneyCents, OWNED_FLEET_INSURANCE_PAID } from './ownedVehicleFinance.js';
import { distributeInsurance, overviewKey } from './fleetOverview.js';
import { dateInRange } from './faturamento.js';

const sum = rows => rows.reduce((total, row) => total + (row.amountCents ?? 0), 0);

// Read-only projection of the existing manager-confirmed position. Due dates
// never create payments; acquisition amounts at today's price are estimates.
export function summarizeAcquisitions(summary, insuranceItems = [], filters = {}, today) {
    const contracts = resolveInstallmentAmounts(summary.registry);
    const assets = summary.table.filter(vehicle => vehicle.own).map(vehicle => {
        const contract = contracts.find(row => row.id === 'prancha' ? vehicle.id === 'LTU5A25' : row.members.some(member => member.plate === vehicle.id));
        const currentCents = vehicle.conflict ? null : contract
            ? contract.id === 'prancha' ? contract.currentCents : contract.members.find(member => member.plate === vehicle.id)?.cents ?? null
            : moneyCents(vehicle.parcelaMensal);
        const hasAcquisition = !!contract || overviewKey(vehicle.temParcela) === 'SIM' || currentCents > 0;
        const fixed = summary.fixed.filter(row => row.vehicleId === vehicle.id);
        const acquisition = fixed.filter(row => row.source === 'Parcela');
        const insurance = fixed.filter(row => row.source === 'Seguro');
        const calendar = contract ? installmentCalendar(contract, today) : [];
        return { ...vehicle, hasAcquisition, currentCents, calendar,
            paid: contract?.paid ?? null, total: contract?.total ?? null,
            remaining: contract ? contract.total - contract.paid : null,
            fixedReferenceCents: sum(fixed), fixedIncomplete: fixed.some(row => row.amountCents == null),
            acquisitionReferenceCents: sum(acquisition), insuranceReferenceCents: sum(insurance),
            acquisitionMissing: acquisition.some(row => row.amountCents == null), insuranceMissing: insurance.some(row => row.amountCents == null),
        };
    });
    const selected = new Set(assets.map(row => row.id));
    const history = assets.flatMap(asset => asset.calendar.filter(row => row.confirmedPaid).map(row => ({
        id: `acquisition:${asset.id}:${row.number}`, vehicleId: asset.id, label: asset.identificador || asset.placa,
        date: row.dueDate, month: row.dueDate.slice(0, 7), number: row.number, total: asset.total,
        amountCents: asset.currentCents, source: 'Aquisição', estimated: true,
    })));
    summary.insurance.schedule.filter(row => OWNED_FLEET_INSURANCE_PAID.includes(row.number)).forEach(row => {
        distributeInsurance(row.amountCents, insuranceItems).filter(share => selected.has(share.plate)).forEach(share => history.push({
            id: `insurance:${share.plate}:${row.number}`, vehicleId: share.plate,
            label: assets.find(asset => asset.id === share.plate)?.identificador || share.plate,
            date: row.dueDate, month: row.dueDate.slice(0, 7), number: row.number, total: summary.insurance.schedule.length,
            amountCents: share.amountCents, source: 'Seguro', estimated: false,
        }));
    });
    history.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const periodHistory = history.filter(row => dateInRange(row.date, filters.from, filters.to));
    const acquisitionPaid = history.filter(row => row.estimated), insurancePaid = history.filter(row => !row.estimated);
    const fixedAcquisition = summary.fixed.filter(row => row.source === 'Parcela');
    return { assets, history, periodHistory,
        monthlyAcquisitionCents: sum(fixedAcquisition), monthlyMissing: fixedAcquisition.some(row => row.amountCents == null),
        estimatedPaidCents: sum(acquisitionPaid), paidMissing: acquisitionPaid.some(row => row.amountCents == null),
        insurancePaidCents: sum(insurancePaid),
        missingHistory: assets.filter(row => row.hasAcquisition && row.paid === null).length,
    };
}

export function acquisitionMonths(history) {
    const months = new Map();
    for (const row of history) {
        if (!months.has(row.month)) months.set(row.month, { month: row.month, acquisitionCents: 0, insuranceCents: 0, missing: false, records: [] });
        const month = months.get(row.month);
        month.records.push(row);
        if (row.amountCents == null) month.missing = true;
        else month[row.estimated ? 'acquisitionCents' : 'insuranceCents'] += row.amountCents;
    }
    return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
