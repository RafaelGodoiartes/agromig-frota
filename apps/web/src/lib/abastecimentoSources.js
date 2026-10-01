import { finiteNumber, isoDate } from './faturamento.js';
import { uniqueOptions } from './abastecimentoTypes.js';

const SHEET_ID = '1_mGLa1rqNfuFdHyi3GwN1O0pFHvf9TTZKVwz5VCvjlc';
const BASE_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

export function parseAbastecimentoSheet(body) {
    const match = body.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);\s*$/);
    if (!match) throw new Error('Resposta da planilha de abastecimento inválida.');
    const payload = JSON.parse(match[1]);
    if (payload.status !== 'ok' || !Array.isArray(payload.table?.rows)) throw new Error('Não foi possível ler os tipos de abastecimento.');
    return payload.table.rows.map((row) => row.c || []);
}

export function normalizeOtherAbastecimentos(rows) {
    const value = (row, col) => row[col]?.v ?? row[col]?.f ?? '';
    const nullableNumber = (raw) => raw === '' ? null : finiteNumber(raw);
    return rows.flatMap((row) => {
        let date = isoDate(row[0]?.f) || isoDate(value(row, 0));
        if (!date) return [];
        const year = Math.min(new Date().getFullYear(), Math.max(2024, Number(date.slice(0, 4))));
        date = `${year}${date.slice(4)}`;
        return [{
            data: date, anoMes: date.slice(0, 7), placa: String(value(row, 1)).trim().toUpperCase(),
            veiculo: value(row, 2), projeto: value(row, 3), categoria: value(row, 4), item: value(row, 5),
            valor: nullableNumber(value(row, 6)), km: nullableNumber(value(row, 7)),
            motorista: value(row, 8), fa: value(row, 8), litros: nullableNumber(value(row, 9)),
            precoLitro: nullableNumber(value(row, 10)), posto: value(row, 11), fornecedor: value(row, 11),
            observacoes: value(row, 13), status: value(row, 14), motivo: value(row, 15), chave: value(row, 16),
        }];
    });
}

// Older deployed Apps Script versions return only Categoria=Combustível.
// Read the existing dropdown catalogue and other categories without changing the sheet.
export async function loadAbastecimentoSources(fetcher = fetch) {
    const query = encodeURIComponent("select * where E is not null and not lower(E) contains 'combust'");
    const urls = [
        `${BASE_URL}&gid=84241627&range=C2:D280&headers=0`,
        `${BASE_URL}&gid=1222426445&headers=1&tq=${query}`,
    ];
    const values = await Promise.all(urls.map(async (url) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetcher(`${url}&t=${Date.now()}`, { signal: controller.signal });
            if (!response.ok) throw new Error(`Planilha de abastecimento respondeu ${response.status}.`);
            return parseAbastecimentoSheet(await response.text());
        } finally { clearTimeout(timeout); }
    }));
    return {
        tiposAbastecimento: uniqueOptions(['Combustível', 'Graxa', ...values[0].map((row) => row[0]?.v)]),
        itensAbastecimento: uniqueOptions([...values[0].map((row) => row[1]?.v), 'Graxa']),
        outrosAbastecimentos: normalizeOtherAbastecimentos(values[1]),
    };
}
