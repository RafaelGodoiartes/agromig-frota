import { isoDate } from './faturamento.js';
import { moneyCents } from './ownedVehicleFinance.js';

const text = (value) => String(value ?? '').trim();
const key = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const DOCUMENT_PAYMENTS_URL = 'https://docs.google.com/spreadsheets/d/1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM/gviz/tq?tqx=out:json&gid=202610081&range=A1:E&headers=1';

export function parseDocumentPayments(body) {
    const match = body.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);\s*$/);
    if (!match) throw new Error('Resposta dos pagamentos de documentação inválida.');
    const payload = JSON.parse(match[1]);
    if (payload.status !== 'ok' || !Array.isArray(payload.table?.cols) || !Array.isArray(payload.table?.rows)) throw new Error('Não foi possível ler os pagamentos de documentação.');
    const headers = payload.table.cols.map((column) => key(column.label));
    const dateColumn = headers.indexOf(key('DATA DO SERVIÇO'));
    const indexes = [dateColumn >= 0 ? dateColumn : headers.indexOf(key('DATA DO PAGAMENTO')), ...['PRESTADOR DE SERVIÇO', 'VEÍCULO / PLACA', 'TIPO DE DOCUMENTAÇÃO', 'VALOR DO SERVIÇO (R$)'].map((name) => headers.indexOf(key(name)))];
    if (indexes.some((index) => index < 0)) throw new Error('Cabeçalhos dos pagamentos de documentação não reconhecidos.');
    return payload.table.rows.flatMap((row, index) => {
        const cells = indexes.map((i) => row.c?.[i]);
        if (cells.every((cell) => cell?.v == null || cell.v === '')) return [];
        const rawDate = cells[0]?.f || cells[0]?.v || '';
        const googleDate = String(rawDate).match(/^Date\((\d+),(\d+),(\d+)\)$/);
        const date = googleDate ? `${googleDate[1]}-${String(Number(googleDate[2]) + 1).padStart(2, '0')}-${googleDate[3].padStart(2, '0')}` : rawDate;
        return [{ id: `document-payment-${index + 2}`, date: isoDate(date), provider: text(cells[1]?.v), vehicle: text(cells[2]?.v), document: text(cells[3]?.v), amountCents: moneyCents(cells[4]?.v), rawDate: text(rawDate) }];
    });
}

export async function loadDocumentPayments(fetcher = fetch) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetcher(`${DOCUMENT_PAYMENTS_URL}&t=${Date.now()}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Pagamentos de documentação responderam ${response.status}.`);
        return parseDocumentPayments(await response.text());
    } finally { clearTimeout(timeout); }
}

export function summarizeDocumentPayments(payments = [], vehicles = [], filters = {}, search = '') {
    const grouped = new Map();
    for (const vehicle of vehicles) {
        const plate = key(vehicle.placa);
        if (!plate) continue;
        if (!grouped.has(plate)) grouped.set(plate, []);
        grouped.get(plate).push(vehicle);
    }
    const registry = [...grouped].map(([plate, rows]) => ({ ...rows[0], plate, possession: new Set(rows.map((row) => key(row.tipoPosse))).size === 1 ? key(rows[0].tipoPosse) : '' }));
    const q = key(search);
    const rows = payments.map((payment) => {
        const matches = registry.filter((vehicle) => key(payment.vehicle) === vehicle.plate || (key(vehicle.veiculo) && key(payment.vehicle) === key(vehicle.veiculo)));
        const vehicle = matches.length === 1 ? matches[0] : null;
        const possession = vehicle?.possession === 'PROPRIO' ? 'Próprio' : vehicle?.possession === 'LOCADO' ? 'Locado' : 'Sem classificação';
        return { ...payment, plate: vehicle?.placa || '', project: vehicle?.projeto || '', possession };
    }).filter((row) => {
        if ((filters.periodStart || filters.periodEnd) && (!row.date || (filters.periodStart && row.date < filters.periodStart) || (filters.periodEnd && row.date > filters.periodEnd))) return false;
        if (filters.placa && filters.placa !== 'all' && key(row.plate || row.vehicle) !== key(filters.placa)) return false;
        if (filters.projeto && filters.projeto !== 'all' && row.project !== filters.projeto) return false;
        return !q || key(`${row.vehicle} ${row.provider} ${row.document} ${row.project}`).includes(q);
    });
    const sum = (possession) => rows.filter((row) => !possession || row.possession === possession).reduce((total, row) => total + (row.amountCents ?? 0), 0);
    return { rows, totalCents: sum(), ownedCents: sum('Próprio'), rentedCents: sum('Locado'), unknownCents: sum('Sem classificação'), invalidAmounts: rows.filter((row) => row.amountCents === null).length, missingDates: payments.filter((row) => !row.date).length };
}
