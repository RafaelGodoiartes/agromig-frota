const clean = (value) => String(value ?? '').trim();

export const FATURAMENTO_EQUIPMENT = {
    ALL: 'all',
    TRUCK: 'truck',
    RETRO: 'retro',
};

export function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = clean(value).replace(/R\$/gi, '').replace(/\s/g, '');
    if (!raw) return 0;
    const normalized = raw.includes(',') && raw.includes('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : /^-?\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function isoDate(value) {
    let text = clean(value).slice(0, 10);
    const brazilian = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brazilian) text = `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    const date = new Date(`${text}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
}

const identityKey = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const retroTag = (value) => identityKey(value).match(/AGR(\d+)/)?.[0] || '';

export function maintenanceEquipment(row, data = {}) {
    const plate = clean(row?.placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (plate === 'LTU5A25' || plate.includes('LTU5A25')) return FATURAMENTO_EQUIPMENT.TRUCK;
    const models = (data.locacoesRetroescavadeira || []).map((rental) => rental.modelo);
    const registry = (data.veiculos || []).find((vehicle) => identityKey(vehicle.placa) === plate);
    const identities = [row?.placa, row?.veiculo, registry?.veiculo, registry?.identificador];
    if (models.some((model) => identities.some((identity) => (
        identityKey(identity) && (identityKey(identity) === identityKey(model) || (retroTag(model) && retroTag(identity) === retroTag(model)))
    )))) return FATURAMENTO_EQUIPMENT.RETRO;
    return null;
}

export function dateInRange(value, from = '', to = '') {
    const date = isoDate(value);
    if (!date) return false;
    return (!from || date >= from) && (!to || date <= to);
}

export function dateRangeOverlaps(startValue, endValue, from = '', to = '') {
    const start = isoDate(startValue);
    const end = isoDate(endValue) || start;
    if (!start) return false;
    return (!to || start <= to) && (!from || end >= from);
}

function equipmentAllowed(kind, selected) {
    return selected === FATURAMENTO_EQUIPMENT.ALL || selected === kind;
}

function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
    });
}

export function buildRevenueRows(data = {}, filters = {}) {
    const selected = filters.equipment || FATURAMENTO_EQUIPMENT.ALL;
    const from = isoDate(filters.from);
    const to = isoDate(filters.to);
    const truck = (data.viagensLTU5A25 || []).filter((row) => equipmentAllowed(FATURAMENTO_EQUIPMENT.TRUCK, selected) && dateInRange(row.data, from, to)).map((row, index) => ({
        id: `truck-${row.id || index}`,
        kind: FATURAMENTO_EQUIPMENT.TRUCK,
        date: isoDate(row.data),
        equipment: clean(row.equipamento) || 'Caminhão Prancha LTU5A25',
        type: 'Viagem / serviço',
        client: '',
        description: clean(row.descricao),
        origin: clean(row.origem),
        destination: clean(row.destino),
        duration: '',
        amount: finiteNumber(row.valorCobrado),
        notes: clean(row.observacoes),
        plate: clean(row.placa) || 'LTU5A25',
    }));
    // Recognize each service once, by its start date, including multi-month rentals.
    const retro = (data.locacoesRetroescavadeira || []).filter((row) => equipmentAllowed(FATURAMENTO_EQUIPMENT.RETRO, selected) && dateInRange(row.dataInicio, from, to)).map((row, index) => ({
        id: `retro-${row.id || index}`,
        kind: FATURAMENTO_EQUIPMENT.RETRO,
        date: isoDate(row.dataInicio),
        equipment: clean(row.modelo) || 'Retroescavadeira',
        type: 'Locação / serviço',
        client: clean(row.cliente),
        description: '',
        origin: clean(row.local),
        destination: '',
        duration: row.horas === null || row.horas === undefined || clean(row.horas) === '' ? '' : `${finiteNumber(row.horas).toLocaleString('pt-BR')} h`,
        amount: finiteNumber(row.valorTotal),
        notes: isoDate(row.dataFinalizacao) ? `Finalização: ${isoDate(row.dataFinalizacao).split('-').reverse().join('/')}` : '',
        plate: '',
    }));
    return uniqueRows([...truck, ...retro]).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function buildMaintenanceCostRows(data = {}, filters = {}) {
    const selected = filters.equipment || FATURAMENTO_EQUIPMENT.ALL;
    const from = isoDate(filters.from);
    const to = isoDate(filters.to);
    return uniqueRows((data.manutencao || []).flatMap((row, index) => {
        const kind = maintenanceEquipment(row, data);
        const date = isoDate(row.dataChamado) || isoDate(row.dataConclusao) || isoDate(row.dataInicio);
        if (!kind || !equipmentAllowed(kind, selected) || !dateInRange(date, from, to)) return [];
        return [{
            id: `maintenance-${row.id || index}`,
            date,
            kind,
            equipment: kind === FATURAMENTO_EQUIPMENT.TRUCK ? 'Caminhão Prancha LTU5A25' : (clean(row.veiculo) || 'Retroescavadeira'),
            type: clean(row.tipo) || clean(row.categoria) || 'Manutenção',
            description: clean(row.descricao) || clean(row.peca),
            supplier: clean(row.fornecedor),
            amount: finiteNumber(row.custoTotal ?? row.valor),
            notes: clean(row.status),
        }];
    })).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function aggregateByMonth(rows = []) {
    const values = new Map();
    rows.forEach((row) => {
        const month = isoDate(row.date).slice(0, 7);
        if (!month) return;
        values.set(month, (values.get(month) || 0) + finiteNumber(row.amount));
    });
    return [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value }));
}

export function summarizeByEquipment(revenueRows = [], maintenanceRows = []) {
    const summary = {
        [FATURAMENTO_EQUIPMENT.TRUCK]: { revenue: 0, cost: 0 },
        [FATURAMENTO_EQUIPMENT.RETRO]: { revenue: 0, cost: 0 },
    };
    revenueRows.forEach((row) => { if (summary[row.kind]) summary[row.kind].revenue += finiteNumber(row.amount); });
    maintenanceRows.forEach((row) => { if (summary[row.kind]) summary[row.kind].cost += finiteNumber(row.amount); });
    Object.values(summary).forEach((item) => { item.result = item.revenue - item.cost; });
    return summary;
}
