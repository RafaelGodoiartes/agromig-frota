import { moneyCents } from './ownedVehicleFinance.js';

export const OWNED_VEHICLES_SOURCE_URL = 'https://docs.google.com/spreadsheets/d/1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM/gviz/tq?tqx=out:json&gid=1477905702&range=A4:R998&headers=1';
const headerKey = (value) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');

export function parseOwnedVehicleRegistry(body) {
    const match = body.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);\s*$/);
    if (!match) throw new Error('Resposta do Cadastro financeiro inválida.');
    const payload = JSON.parse(match[1]);
    if (payload.status !== 'ok' || !Array.isArray(payload.table?.rows) || !Array.isArray(payload.table?.cols)) {
        throw new Error('Não foi possível ler o Cadastro financeiro.');
    }
    const headers = payload.table.cols.map((column) => headerKey(column.label));
    const column = (...names) => names.map(headerKey).map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
    const plate = column('PLACA');
    const possession = column('TIPO DE POSSE', 'POSSE');
    const rent = column('ALUGUEL MENSAL (R$)', 'ALUGUEL MENSAL', 'VALOR MENSAL DO ALUGUEL');
    const model = column('VEÍCULO / MODELO');
    const project = column('PROJETO ATENDIDO');
    if (plate < 0 || possession < 0 || rent < 0) throw new Error('Cadastro sem as colunas PLACA, TIPO DE POSSE/POSSE ou ALUGUEL MENSAL.');
    return payload.table.rows.flatMap((row) => {
        const value = (index) => row.c?.[index]?.v ?? row.c?.[index]?.f ?? '';
        const placa = String(value(plate)).trim();
        if (!placa) return [];
        const cents = moneyCents(value(rent));
        return [{
            placa,
            veiculo: String(value(model)).trim(),
            tipoPosse: String(value(possession)).trim(),
            projeto: String(value(project)).trim(),
            aluguelMensal: cents === null ? null : cents / 100,
        }];
    });
}

export async function loadOwnedVehicleRegistry(fetcher = fetch) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetcher(`${OWNED_VEHICLES_SOURCE_URL}&t=${Date.now()}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Cadastro financeiro respondeu ${response.status}.`);
        return parseOwnedVehicleRegistry(await response.text());
    } finally {
        clearTimeout(timeout);
    }
}
