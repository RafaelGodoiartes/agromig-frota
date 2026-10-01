import { isoDate } from './faturamento.js';

const SPREADSHEET_ID = '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM';
const SOURCES = [
    { key: 'viagensLTU5A25', gid: 492186813, range: 'A5:O1000', firstRow: 5 },
    { key: 'locacoesRetroescavadeira', gid: 1053659329, range: 'A2:H1001', firstRow: 2 },
];

// Read-only complement for deployed connectors that do not expose these tabs yet.
// The first rows and columns come from the existing spreadsheet, not exports.
export function parseFinanceSheet(body, source) {
    const match = body.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);\s*$/);
    if (!match) throw new Error('Resposta de faturamento inválida.');
    const payload = JSON.parse(match[1]);
    if (payload.status !== 'ok' || !Array.isArray(payload.table?.rows)) throw new Error('Não foi possível ler a fonte de faturamento.');
    return payload.table.rows.flatMap((row, index) => {
        const cells = row.c || [];
        const value = (column) => cells[column]?.v ?? cells[column]?.f ?? '';
        const date = (column) => isoDate(cells[column]?.f) || isoDate(value(column));
        if (source.key === 'viagensLTU5A25') {
            if (!date(1) || String(value(2)).replace(/[^a-z0-9]/gi, '').toUpperCase() !== 'LTU5A25') return [];
            return [{
                id: source.firstRow + index, data: date(1), placa: value(2), equipamento: value(3),
                motorista: value(4), projeto: value(5), origem: value(6), destino: value(7),
                descricao: value(8), valorMercadoria: value(9), status: value(10), observacoes: value(11),
                kmTotal: value(12), valorCobrado: value(13), valorKm: value(14),
            }];
        }
        if (!String(value(0)).trim() || !date(5)) return [];
        return [{
            id: source.firstRow + index, modelo: value(0), operador: value(1), horas: value(2),
            local: value(3), cliente: value(4), dataInicio: date(5), dataFinalizacao: date(6), valorTotal: value(7),
        }];
    });
}

export async function loadFaturamentoSources(existing = {}, fetcher = fetch) {
    const entries = await Promise.all(SOURCES.map(async (source) => {
        if (Array.isArray(existing[source.key])) return [source.key, existing[source.key]];
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${source.gid}&range=${source.range}&headers=0&t=${Date.now()}`;
            const response = await fetcher(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`Fonte de faturamento respondeu ${response.status}.`);
            return [source.key, parseFinanceSheet(await response.text(), source)];
        } finally {
            clearTimeout(timeout);
        }
    }));
    return Object.fromEntries(entries);
}
