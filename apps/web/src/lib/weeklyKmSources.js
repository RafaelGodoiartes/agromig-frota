import { weeklyDate, weeklyReading } from './weeklyKm.js';

const SHEET_ID = '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM';
const SOURCES = [
    { key: 'weekly', gid: 1792383375, range: 'A4:M1000' },
    { key: 'registry', gid: 1477905702, range: 'A4:L998' },
    // Separate dates from numeric readings: GViz drops minority cell types
    // when dates and odometer values share a single queried column.
    { key: 'calendar', gid: 1792383375, range: 'B2:H3' },
];

function sheetGrid(body) {
    const match = body.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);\s*$/);
    if (!match) throw new Error('Resposta de KM Semanal inválida.');
    const payload = JSON.parse(match[1]);
    if (payload.status !== 'ok' || !Array.isArray(payload.table?.rows)) throw new Error('Não foi possível consultar KM Semanal.');
    return payload.table.rows.map((row) => (row.c || []).map((cell) => cell?.v ?? cell?.f ?? ''));
}

export function parseWeeklyKmSources(weeklyBody, registryBody, calendarBody) {
    const grid = sheetGrid(weeklyBody);
    const registry = sheetGrid(registryBody);
    const calendar = sheetGrid(calendarBody);
    const header = grid.findIndex((row) => row[1] === 'PLACA' && String(row[2]).includes('VEÍCULO'));
    if (header < 0 || registry[0]?.[0] !== 'PLACA') throw new Error('Cabeçalhos de KM Semanal/Cadastro não reconhecidos.');
    const reference = calendar[0]?.[0];
    const month = weeklyDate(reference)?.slice(0, 7) || (() => {
        const match = String(reference).match(/^(\d{2})\/(\d{4})$/);
        return match ? `${match[2]}-${match[1]}` : null;
    })();
    if (!month) throw new Error('Competência da aba KM Semanal não reconhecida.');
    return {
        month,
        mixed: String(calendar[0]?.[1] || '').includes('COMPETÊNCIA EM CONFERÊNCIA'),
        dates: Array.from({ length: 5 }, (_, index) => weeklyDate(calendar[1]?.[index + 2])),
        rows: grid.slice(header + 1).filter((row) => row[1] && !String(row[1]).startsWith('#')).map((row) => ({
            placa: String(row[1]).trim(), veiculo: row[2],
            leituras: Array.from({ length: 5 }, (_, index) => weeklyReading(row[index + 3])),
            situacao: row[10], unidade: row[11],
        })),
        vehicles: registry.slice(1).filter((row) => row[0] && !String(row[0]).startsWith('#')).map((row) => ({
            placa: String(row[0]).trim(), veiculo: row[1], projeto: row[7], unidade: row[8], dataEntrada: weeklyDate(row[10]),
        })),
    };
}

export async function loadWeeklyKmSources(fetcher = fetch) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const responses = await Promise.all(SOURCES.map(async (source) => {
            const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${source.gid}&range=${source.range}&headers=0&t=${Date.now()}`;
            const response = await fetcher(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`KM Semanal respondeu ${response.status}.`);
            return response.text();
        }));
        return parseWeeklyKmSources(...responses);
    } finally {
        clearTimeout(timeout);
    }
}
