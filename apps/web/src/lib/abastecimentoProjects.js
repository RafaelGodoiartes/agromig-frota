const text = (value) => String(value ?? '').trim();
const key = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const ABASTECIMENTO_PROJECTS_URL = 'https://docs.google.com/spreadsheets/d/1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM/gviz/tq?tqx=out:json&gid=96684586&range=A1:C500&headers=1';

export function parseAbastecimentoProjects(body) {
    const match = body.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);\s*$/);
    if (!match) throw new Error('Resposta dos projetos de abastecimento inválida.');
    const payload = JSON.parse(match[1]);
    if (payload.status !== 'ok' || !Array.isArray(payload.table?.cols) || !Array.isArray(payload.table?.rows)) throw new Error('Não foi possível ler os projetos de abastecimento.');
    const headers = payload.table.cols.map((column) => key(column.label));
    const projectIndex = headers.indexOf('PROJETO');
    const originIndex = headers.indexOf('ORIGEM');
    const noteIndex = headers.indexOf('OBSERVACOES');
    if (projectIndex < 0) throw new Error('A aba de projetos não possui a coluna PROJETO.');
    const seen = new Set();
    return payload.table.rows.flatMap((row) => {
        const project = text(row.c?.[projectIndex]?.v);
        const normalized = key(project);
        if (!project || seen.has(normalized)) return [];
        seen.add(normalized);
        return [{ project, origin: text(row.c?.[originIndex]?.v), note: text(row.c?.[noteIndex]?.v) }];
    });
}

export async function loadAbastecimentoProjects(fetcher = fetch) {
    const response = await fetcher(`${ABASTECIMENTO_PROJECTS_URL}&t=${Date.now()}`);
    if (!response.ok) throw new Error(`Projetos de abastecimento responderam ${response.status}.`);
    return parseAbastecimentoProjects(await response.text());
}
