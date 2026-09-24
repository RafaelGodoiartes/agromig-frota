// The public dashboard is hosted on GitHub Pages. Its data/write backend is
// the Google Apps Script Web App so the site no longer depends on Cloudflare.
export const API_SERVER_URL = import.meta.env.VITE_API_BASE_URL
    || 'https://script.google.com/macros/s/AKfycbwKBs32W3KZqQO2pqRqXErs0AfmofIdRUAuoUmvVQNg_9ulpC4S_bibFde9L3pUxPjf/exec';

const SHEET1_ID = '1_mGLa1rqNfuFdHyi3GwN1O0pFHvf9TTZKVwz5VCvjlc';
const SHEET2_ID = '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM';
let cachedData = null;

const text = (value) => String(value ?? '').trim();
const num = (value) => {
    if (value === '' || value === null || value === undefined) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? value : '';
    const raw = text(value).replace(/\s/g, '');
    if (!raw) return '';
    const normalized = raw.includes(',') && raw.includes('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : '';
};

const normalizeFuelDate = (value) => {
    const date = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const currentYear = new Date().getFullYear();
    const year = Number(date.slice(0, 4));
    return year > currentYear ? `${currentYear}${date.slice(4)}` : date;
};

function responseFromPayload(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function normalizeFutureFuelDates(payload) {
    if (!payload || !Array.isArray(payload.abastecimento)) return payload;
    const currentYear = new Date().getFullYear();
    const minimumYear = 2024;
    return {
        ...payload,
        abastecimento: payload.abastecimento.map((row) => {
            const date = text(row?.data);
            const match = date.match(/^(\d{4})(-\d{2}-\d{2})$/);
            if (!match) return row;
            const year = Number(match[1]);
            const correctedYear = year < minimumYear ? minimumYear : (year > currentYear ? currentYear : year);
            if (correctedYear === year) return row;
            const correctedDate = `${correctedYear}${match[2]}`;
            return { ...row, data: correctedDate, anoMes: correctedDate.slice(0, 7) };
        }),
    };
}

async function readResponse(response) {
    const textBody = await response.text();
    let payload = {};
    try { payload = textBody ? JSON.parse(textBody) : {}; } catch { payload = { ok: false, message: 'Resposta inválida do Google Apps Script.' }; }
    payload = normalizeFutureFuelDates(payload);
    if (payload && payload.meta) cachedData = payload;
    if (payload && payload.ok === false) return responseFromPayload(payload, 400);
    return responseFromPayload(payload, response.status);
}

function commandForRoute(route, input) {
    const data = cachedData || {};
    if (route === '/fleet/km-semanal') {
        return { action: 'weeklyKm', spreadsheetId: SHEET2_ID, sheetName: 'KM Semanal', plate: text(input.placa).toUpperCase(), date: input.data, reading: num(input.leitura), pin: input.pin };
    }
    if (route === '/fleet/veiculo') {
        return {
            action: 'append', spreadsheetId: SHEET2_ID, sheetName: 'Cadastro de Veículos', pin: input.pin,
            values: [text(input.placa).toUpperCase(), text(input.veiculo), text(input.combustivel), text(input.propriedade), '', text(input.tipoPosse), num(input.franquia), text(input.projeto), text(input.unidade) || 'KM', text(input.identificador), input.dataEntrada || '', text(input.folderUrl)],
        };
    }
    if (route === '/fleet/abastecimento') {
        const plate = text(input.placa).toUpperCase();
        const vehicle = (data.veiculosAbastecimento || []).find((item) => item.placa === plate) || { placa: plate, veiculo: plate };
        const liters = num(input.litros);
        const suppliedTotal = num(input.valor);
        const legacyUnitPrice = num(input.precoLitro);
        const total = suppliedTotal !== '' && suppliedTotal > 0
            ? suppliedTotal
            : (liters !== '' && legacyUnitPrice !== '' ? liters * legacyUnitPrice : '');
        const unitPrice = liters > 0 && total !== '' ? total / liters : '';
        const date = normalizeFuelDate(input.data);
        const key = `${date.replace(/-/g, '')}-${plate}-${Date.now()}`;
        return {
            action: 'append', spreadsheetId: SHEET1_ID, sheetName: 'Gastos', pin: input.pin,
            values: [date, plate, vehicle.veiculo, text(input.projeto), 'Combustível', text(input.item), total, num(input.km), text(input.motorista || input.fa), liters, unitPrice, text(input.posto), '', text(input.observacoes), 'PENDENTE', '', key],
        };
    }
    if (route === '/fleet/posto') {
        return {
            action: 'registerPosto', spreadsheetId: SHEET1_ID,
            nome: text(input.nome), cnpj: text(input.cnpj), cidade: text(input.cidade), observacoes: text(input.observacoes),
        };
    }
    if (route === '/fleet/manutencao') {
        const plate = text(input.placa).toUpperCase();
        const vehicle = (data.veiculos || []).find((item) => item.placa === plate) || { placa: plate, veiculo: plate };
        const nextId = Math.max(0, ...(data.manutencao || []).map((row) => Number(row.id) || 0)) + 1;
        const status = text(input.status).toUpperCase();
        const value = num(input.valor);
        return {
            action: 'append', spreadsheetId: SHEET2_ID, sheetName: 'Histórico de Manutenção', pin: input.pin,
            values: [nextId, plate, vehicle.veiculo, text(input.projeto), vehicle.tipoPosse || vehicle.propriedade || '', status, `Manutenção ${text(input.tipo) || 'Outros'}`, text(input.descricao), text(input.peca), text(input.dataChamado), text(input.dataPrevista), status === 'FINALIZADO' ? text(input.dataConclusao) : '', '', num(input.km), vehicle.unidade || 'KM', value, '', '', '', value, text(input.responsavel), text(input.fornecedor), ''],
            files: Array.isArray(input.files) ? input.files : [],
            evidence: { type: 'Manutenção', date: text(input.dataChamado), plate, vehicle: vehicle.veiculo, project: text(input.projeto), description: text(input.descricao), targetColumn: 23, folderUrl: text(input.folderUrl) || vehicle.pastaEvidencias },
        };
    }
    return null;
}

const apiServerClient = {
    fetch: async (url, options = {}) => {
        const method = String(options.method || 'GET').toUpperCase();
        if (method === 'GET') {
            // Sempre usa um carimbo novo para impedir que o navegador ou um
            // proxy entregue uma resposta antiga da aba Documentação.
            const endpoint = `${API_SERVER_URL}?action=readFleetData&t=${Date.now()}`;
            const response = await window.fetch(endpoint, { method: 'GET' });
            return readResponse(response);
        }
        const input = typeof options.body === 'string' ? JSON.parse(options.body || '{}') : (options.body || {});
        const command = commandForRoute(url, input);
        if (!command) return responseFromPayload({ ok: false, message: `Rota não suportada: ${url}` }, 400);
        const response = await window.fetch(API_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(command),
        });
        const result = await readResponse(response);
        cachedData = null;
        return result;
    },
};

export default apiServerClient;
export { apiServerClient };
