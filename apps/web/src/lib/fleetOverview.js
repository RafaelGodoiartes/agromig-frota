import { isoDate, dateInRange } from './faturamento.js';
import { moneyCents, insuranceSchedule, OWNED_FLEET_INSURANCE_PAID } from './ownedVehicleFinance.js';
import { monthlyInstallmentExpense, resolveInstallmentAmounts } from './vehicleInstallments.js';

export const overviewKey = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const text = value => String(value ?? '').trim();
const sum = rows => rows.reduce((total, row) => total + (row.amountCents ?? 0), 0);
const yes = value => overviewKey(value) === 'SIM';
const tag = value => text(value).match(/\bAGR\s*[- ]*\s*(\d+)\b/i)?.[1] || '';
export function overviewToday() {
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    return ['year', 'month', 'day'].map(type => parts.find(row => row.type === type).value).join('-');
}
export function overviewRegistry(data) {
    const groups = new Map();
    for (const row of data.cadastroFinanceiro || []) {
        const id = overviewKey(row.placa);
        if (!id || text(row.placa).startsWith('#')) continue;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(row);
    }
    return [...groups].map(([id, group]) => {
        const first = group[0], extra = (data.veiculos || []).find(row => overviewKey(row.placa) === id);
        const conflict = ['tipoPosse', 'aluguelMensal', 'parcelaMensal', 'projeto'].some(field => new Set(group.map(row => row[field] ?? '')).size > 1);
        return { ...extra, ...first, id, conflict, own: group.every(row => overviewKey(row.tipoPosse) === 'PROPRIO') };
    });
}
function identify(value, registry) {
    const id = overviewKey(value);
    const exact = registry.filter(row => row.id === id || overviewKey(row.identificador) === id);
    if (exact.length === 1) return exact[0];
    const agr = tag(value);
    const byTag = agr ? registry.filter(row => tag(row.identificador) === agr || tag(row.veiculo) === agr) : [];
    return byTag.length === 1 ? byTag[0] : null;
}
function unique(rows) {
    const seen = new Set();
    return rows.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; });
}
// Largest-remainder distribution: every installment closes exactly in cents.
export function distributeInsurance(amountCents, items = []) {
    if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !items.length || items.some(row => !overviewKey(row.plate) || !Number.isSafeInteger(row.premiumCents) || row.premiumCents <= 0) || new Set(items.map(row => overviewKey(row.plate))).size !== items.length) return [];
    const denominator = items.reduce((total, row) => total + row.premiumCents, 0);
    const rows = items.map(row => { const product = BigInt(amountCents) * BigInt(row.premiumCents), divisor = BigInt(denominator); return { plate: overviewKey(row.plate), amountCents: Number(product / divisor), remainder: product % divisor }; });
    let remaining = amountCents - sum(rows);
    const ranked = [...rows].sort((a, b) => a.remainder === b.remainder ? a.plate.localeCompare(b.plate) : a.remainder > b.remainder ? -1 : 1);
    for (const row of ranked) { if (remaining-- <= 0) break; row.amountCents++; }
    return rows.map(({ remainder, ...row }) => row);
}
export function overviewInsurance(items = [], month) {
    const schedule = insuranceSchedule();
    const installment = schedule.find(row => row.dueDate.slice(0, 7) === month);
    const allocations = distributeInsurance(installment?.amountCents ?? 0, items);
    const paid = schedule.filter(row => OWNED_FLEET_INSURANCE_PAID.includes(row.number));
    const paidByPlate = new Map();
    paid.forEach(row => distributeInsurance(row.amountCents, items).forEach(item => paidByPlate.set(item.plate, (paidByPlate.get(item.plate) || 0) + item.amountCents)));
    return { installment, allocations, paidByPlate, paidCents: sum(paid), contractedCents: sum(schedule), schedule };
}
export function overviewRevenue(data, billing, registry) {
    const measurements = unique((billing.measurements || []).filter(row => !row.deleted).map(row => ({
        id: `measurement:${row.id}`, vehicleId: overviewKey(row.equipmentId), date: `${row.month}-25`, start: row.start, end: row.end,
        project: row.projectName || (billing.projects || []).find(project => project.id === row.projectId)?.name || '',
        description: 'Medição de locação', source: 'Medições', amountCents: Number.isSafeInteger(row.amountCents) ? row.amountCents : null,
    })));
    const trips = (data.viagensLTU5A25 || []).map((row, i) => {
        const km = Number(String(row.kmTotal ?? '').replace(',', '.')), rate = moneyCents(row.valorKm);
        const amount = rate === null ? null : Math.round(km * rate);
        return { id: `trip:${row.id ?? i}`, vehicleId: 'LTU5A25', date: isoDate(row.data), project: text(row.projeto), source: 'Viagens',
            description: [row.origem, row.destino].filter(Boolean).join(' → '), amountCents: Number.isFinite(km) && km > 0 && rate !== null && rate > 0 && Number.isSafeInteger(amount) ? amount : null };
    });
    const rentals = (data.locacoesRetroescavadeira || []).map((row, i) => {
        const vehicle = identify(row.modelo, registry), date = isoDate(row.dataInicio), end = isoDate(row.dataFinalizacao) || date;
        const overlap = vehicle && measurements.some(item => item.vehicleId === vehicle.id && item.start <= end && item.end >= date);
        return { id: `rental:${row.id ?? i}`, vehicleId: vehicle?.id || '', date, project: text(row.cliente), source: 'Locações por hora',
            description: `${row.modelo || 'Máquina'} · ${row.horas ?? '—'} h · ${row.local || ''}`, amountCents: moneyCents(row.valorTotal), overlap };
    });
    return unique([...measurements, ...trips, ...rentals]);
}
export function overviewVariableCosts(data, registry) {
    const maintenance = (data.manutencao || []).filter(row => !overviewKey(row.status).includes('CANCEL')).map((row, i) => ({
        id: `maintenance:${row.id ?? i}`, vehicleId: identify(row.placa, registry)?.id || '', date: isoDate(row.dataChamado), project: text(row.projeto),
        description: [row.tipo, row.descricao || row.peca, row.fornecedor].filter(Boolean).join(' · '), amountCents: moneyCents(row.custoTotal ?? row.valor),
        source: 'Manutenção', note: text(row.status),
    }));
    const documents = (data.pagamentosDocumentacao || []).map((row, i) => ({
        id: `document:${row.id ?? i}`, vehicleId: identify(row.vehicle, registry)?.id || '', date: isoDate(row.date), project: '',
        description: [row.document, row.provider, row.vehicle].filter(Boolean).join(' · '), amountCents: row.amountCents, source: 'Documentação',
    }));
    // Expenses belong exclusively to assets confirmed as owned in Cadastro.
    // Unmatched records cannot establish ownership; fuel remains in its own module.
    const ownedIds = new Set(registry.filter(row => row.own).map(row => row.id));
    return unique([...maintenance, ...documents]).filter(row => ownedIds.has(row.vehicleId));
}
export function summarizeFleetOverview(data, billing, filters = {}, today = overviewToday()) {
    const registry = overviewRegistry(data), from = isoDate(filters.from), to = isoDate(filters.to);
    const singleMonth = !!from && !!to && from.slice(0, 7) === to.slice(0, 7);
    const month = singleMonth ? from.slice(0, 7) : today.slice(0, 7);
    const invalidPeriod = !!from && !!to && from > to;
    const allRevenue = overviewRevenue(data, billing, registry), allVariable = overviewVariableCosts(data, registry);
    const project = text(filters.project), vehicleId = filters.vehicle || '';
    const unknownProject = project === 'Sem projeto informado';
    const ownedRegistry = registry.filter(row => row.own);
    const selectedVehicles = ownedRegistry.filter(row => (!vehicleId || row.id === vehicleId) && (!project || (unknownProject ? !row.projeto : row.projeto === project) || [...allRevenue, ...allVariable].some(item => item.vehicleId === row.id && (unknownProject ? !item.project : item.project === project))));
    const ids = new Set(selectedVehicles.map(row => row.id));
    const allowed = row => (!vehicleId || row.vehicleId === vehicleId) && (!project || (unknownProject ? !row.project : row.project === project || (!row.project && registry.find(v => v.id === row.vehicleId)?.projeto === project)));
    const inPeriod = row => !invalidPeriod && dateInRange(row.date, from, to);
    const revenue = allRevenue.filter(row => inPeriod(row) && allowed(row));
    const variable = allVariable.filter(row => inPeriod(row) && allowed(row));
    const insurance = overviewInsurance(billing.insuranceItems || [], month);
    const monthly = monthlyInstallmentExpense(ownedRegistry, month);
    const acquisitionContracts = resolveInstallmentAmounts(ownedRegistry);
    const fixed = [];
    const addFixed = (vehicle, amountCents, source, date, note = '') => {
        if (!ids.has(vehicle.id) || (project && (unknownProject ? !!vehicle.projeto : vehicle.projeto !== project)) || (singleMonth && !dateInRange(date, from, to))) return;
        fixed.push({ id: `${source}:${vehicle.id}`, vehicleId: vehicle.id, project: vehicle.projeto, source, date, amountCents, description: note, note: 'Previsto; não comprova pagamento' });
    };
    for (const vehicle of ownedRegistry) {
        if (yes(vehicle.temSeguro)) {
            const share = insurance.allocations.find(row => row.plate === vehicle.id);
            addFixed(vehicle, share?.amountCents ?? null, 'Seguro', insurance.installment?.dueDate || `${month}-13`, share ? `Rateio proporcional à apólice · ${insurance.installment ? `${insurance.installment.number}/10` : 'fora das 10 parcelas'}` : 'Sem apólice individual vinculada');
        }
        const contract = monthly.rows.find(row => row.id === 'prancha' ? vehicle.id === 'LTU5A25' : row.members.some(member => member.plate === vehicle.id));
        if (contract) addFixed(vehicle, contract.id === 'prancha' ? contract.amountCents : contract.members.find(member => member.plate === vehicle.id)?.cents ?? null, 'Parcela', contract.installment.dueDate, `${contract.installment.number}/${contract.total} · calendário estimado, valor atual`);
        else if (yes(vehicle.temParcela) && !acquisitionContracts.some(row => row.id === 'prancha' ? vehicle.id === 'LTU5A25' : row.members.some(member => member.plate === vehicle.id))) addFixed(vehicle, moneyCents(vehicle.parcelaMensal), 'Parcela', `${month}-01`, 'Cadastro; sem calendário individual confirmado');
    }
    const rentals = selectedVehicles.filter(row => row.own && row.id !== 'LTU5A25').map(vehicle => ({
        id: `monthly:${vehicle.id}`, vehicleId: vehicle.id, project: vehicle.projeto, date: `${month}-25`, source: 'Aluguel mensal', description: 'Cadastro atual · recebimento previsto dia 25',
        amountCents: vehicle.conflict ? null : moneyCents(vehicle.aluguelMensal),
    })).filter(allowed);
    // A registered service takes precedence over the current monthly estimate
    // for that equipment/month. Never add the same asset's rent a second time.
    const monthlyRevenue = singleMonth ? rentals.filter(row => inPeriod(row) && !revenue.some(service => service.vehicleId === row.vehicleId)) : [];
    const comparableRevenue = [...revenue.filter(row => !row.overlap), ...monthlyRevenue];
    const issues = [
        ...rentals.filter(row => row.amountCents === null).map(row => `Aluguel mensal: valor ausente ou divergente (${row.vehicleId}).`),
        ...revenue.filter(row => row.overlap).map(row => `Locação e medição sobrepostas: ${row.description}. Excluída do subtotal até conferência.`),
        ...[...comparableRevenue, ...variable, ...fixed].filter(row => row.amountCents === null || row.amountCents === undefined).map(row => `${row.source}: valor não informado (${row.vehicleId || row.description}).`),
        ...registry.filter(row => ids.has(row.id) && row.conflict).map(row => `Cadastro duplicado com dados divergentes: ${row.placa}.`),
        ...[...allRevenue, ...allVariable].filter(row => allowed(row) && !isoDate(row.date)).map(row => `${row.source}: registro sem data válida; não incluído no período.`),
    ];
    const table = selectedVehicles.map(vehicle => {
        const ownRevenue = comparableRevenue.filter(row => row.vehicleId === vehicle.id), costs = variable.filter(row => row.vehicleId === vehicle.id), fixedRows = fixed.filter(row => row.vehicleId === vehicle.id);
        const incomplete = [...ownRevenue, ...costs, ...fixedRows].some(row => row.amountCents == null) || vehicle.conflict || revenue.some(row => row.vehicleId === vehicle.id && row.overlap);
        return { ...vehicle, monthlyCents: rentals.find(row => row.vehicleId === vehicle.id)?.amountCents ?? null,
            revenueCents: sum(ownRevenue), fixedCents: sum(fixedRows), variableCents: sum(costs), incomplete,
            resultCents: singleMonth && !incomplete ? sum(ownRevenue) - sum(fixedRows) - sum(costs) : null };
    });
    const totalRevenueCents = sum(comparableRevenue), fixedCents = sum(fixed), variableCents = sum(variable);
    const groups = new Map();
    comparableRevenue.forEach(row => { const name = row.project || 'Sem projeto informado'; groups.set(name, (groups.get(name) || 0) + (row.amountCents ?? 0)); });
    const costGroups = new Map();
    [...variable, ...(singleMonth ? fixed : [])].forEach(row => costGroups.set(row.source, (costGroups.get(row.source) || 0) + (row.amountCents ?? 0)));
    return { registry: ownedRegistry, table, revenue, comparableRevenue, variable, fixed, insurance, month, singleMonth, invalidPeriod, issues: [...new Set(issues)],
        totalRevenueCents, fixedCents, variableCents, monthlyContractCents: sum(rentals),
        resultCents: singleMonth && !issues.length ? totalRevenueCents - fixedCents - variableCents : null,
        byProject: [...groups].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
        costGroups: [...costGroups].map(([name, value]) => ({ name, value })).filter(row => row.value > 0),
        unassigned: [...comparableRevenue, ...variable].filter(row => !row.vehicleId),
        projects: [...new Set([...ownedRegistry.map(row => row.projeto), ...allRevenue.map(row => row.project), ...allVariable.map(row => row.project), 'Sem projeto informado'].filter(Boolean))].sort(),
    };
}
