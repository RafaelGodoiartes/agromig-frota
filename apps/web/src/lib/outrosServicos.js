import { isoDate } from './faturamento.js';

const SPREADSHEET_ID = '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM';
export const OUTROS_SERVICOS_SHEET_GID = 530846144;
const RANGE = 'A1:K1000';

function text(value) {
    return String(value ?? '').trim();
}

function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const raw = text(value).replace(/\s/g, '');
    if (!raw) return null;
    const normalized = raw.includes(',') && raw.includes('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseBody(body) {
    const match = String(body || '').match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);\s*$/);
    if (!match) throw new Error('Resposta de serviços não manutivos inválida.');
    const payload = JSON.parse(match[1]);
    if (payload.status !== 'ok' || !Array.isArray(payload.table?.rows)) throw new Error('Não foi possível ler a aba Lavagem e Outros Serviços.');
    return payload.table;
}

export function parseOtherServicesSheet(body) {
    const table = parseBody(body);
    return table.rows.flatMap((row, index) => {
        const cells = row?.c || [];
        const value = (column) => cells[column]?.v ?? cells[column]?.f ?? '';
        const data = isoDate(cells[1]?.f) || isoDate(value(1));
        const id = text(value(0)) || String(index + 1);
        const hasContent = [data, value(2), value(3), value(4), value(5), value(6), value(7), value(8), value(9), value(10)].some((item) => text(item));
        if (!hasContent) return [];
        return [{
            id,
            data,
            prestador: text(value(2)),
            placa: text(value(3)).toUpperCase(),
            tipo: text(value(4)) || 'Outro',
            descricao: text(value(5)),
            projeto: text(value(6)),
            unidade: text(value(7)),
            quantidade: parseNumber(value(8)),
            valor: parseNumber(value(9)),
            observacoes: text(value(10)),
        }];
    });
}

export async function loadOtherServices(fetcher = fetch) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${OUTROS_SERVICOS_SHEET_GID}&range=${encodeURIComponent(RANGE)}&headers=1&t=${Date.now()}`;
        const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'text/plain' } });
        if (!response.ok) throw new Error(`Aba de lavagem e outros serviços respondeu ${response.status}.`);
        return parseOtherServicesSheet(await response.text());
    } finally {
        clearTimeout(timeoutId);
    }
}

