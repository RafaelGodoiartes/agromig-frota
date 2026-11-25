const text = (value) => String(value ?? '').trim();
const key = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const DOCUMENT_PLATE_CATALOG_URL = 'https://docs.google.com/spreadsheets/d/1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM/gviz/tq?tqx=out:json&gid=1043781722&range=A1:D500&headers=1';

export function parseDocumentPlateCatalog(body) {
    const match = body.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);\s*$/);
    if (!match) throw new Error('Resposta da lista de placas exclusivas inválida.');
    const payload = JSON.parse(match[1]);
    if (payload.status !== 'ok' || !Array.isArray(payload.table?.cols) || !Array.isArray(payload.table?.rows)) throw new Error('Não foi possível ler as placas exclusivas.');
    const headers = payload.table.cols.map((column) => key(column.label));
    const indexes = ['PLACA', 'TIPO DE POSSE', 'ORIGEM', 'OBSERVAÇÕES'].map((name) => headers.indexOf(key(name)));
    if (indexes[0] < 0) throw new Error('A aba de placas exclusivas não possui a coluna PLACA.');
    return payload.table.rows.flatMap((row) => {
        const values = indexes.map((index) => index >= 0 ? row.c?.[index]?.v : '');
        const plate = text(values[0]).toUpperCase();
        if (!plate) return [];
        const origin = text(values[2]);
        return [{ plate, possession: text(values[1]), origin, note: text(values[3]) }];
    });
}

export async function loadDocumentPlateCatalog(fetcher = fetch) {
    const response = await fetcher(`${DOCUMENT_PLATE_CATALOG_URL}&t=${Date.now()}`);
    if (!response.ok) throw new Error(`Placas exclusivas responderam ${response.status}.`);
    return parseDocumentPlateCatalog(await response.text());
}
