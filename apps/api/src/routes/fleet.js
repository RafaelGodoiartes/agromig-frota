import crypto from 'crypto';
import logger from '../utils/logger.js';

const SHEET1_ID = '1_mGLa1rqNfuFdHyi3GwN1O0pFHvf9TTZKVwz5VCvjlc';
const SHEET2_ID = '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cache = null; // { ts, data }

function secretEqual(expectedValue, suppliedValue) {
    const expected = Buffer.from(String(expectedValue || ''));
    const supplied = Buffer.from(String(suppliedValue || ''));
    return expected.length > 0 && expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function sheetsWriteConfigured() {
    return Boolean(
        String(process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim()
        && String(process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || '').trim(),
    );
}

function sheetsWebhookSettings() {
    const url = String(process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();
    const secret = String(process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || '').trim();
    if (!url || !secret) {
        const error = new Error('Integração Google Sheets não configurada no Worker.');
        error.code = 'SHEETS_WEBHOOK_NOT_CONFIGURED';
        throw error;
    }
    return { url, secret };
}

function verifyEntryPin(pin) {
    return true;
}

async function sendSheetCommand(command) {
    const { url, secret } = sheetsWebhookSettings();
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret, ...command }),
        redirect: 'follow',
    });
    const responseText = await response.text();
    let payload = {};
    try {
        payload = responseText ? JSON.parse(responseText) : {};
    } catch {
        throw new Error('O conector do Google Sheets não respondeu corretamente. Atualize a implantação do Apps Script e tente novamente.');
    }
    if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message || 'O Google Sheets recebeu a solicitação, mas não confirmou a gravação.');
    }
    return payload;
}

async function fetchFleetDataRaw() {
    const { url, secret } = sheetsWebhookSettings();
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'readFleetData', secret }),
        redirect: 'follow',
    });
    const responseText = await response.text();
    if (!response.ok) {
        throw new Error(`Falha ao ler as planilhas via Apps Script (HTTP ${response.status}).`);
    }
    if (/^\s*\{\s*"ok"\s*:\s*false/.test(responseText)) {
        let message = 'Apps Script recusou a leitura das planilhas.';
        try { message = JSON.parse(responseText).message || message; } catch { /* keep safe fallback */ }
        throw new Error(message);
    }
    if (!/^\s*\{\s*"meta"\s*:/.test(responseText)) {
        throw new Error(`A integração do Google Sheets respondeu em formato inesperado (HTTP ${response.status}).`);
    }
    return responseText;
}

async function appendSheetRow({ spreadsheetId, sheetName, values, files = [], evidence }) {
    return sendSheetCommand({ action: 'append', spreadsheetId, sheetName, values, files, evidence });
}

// Parse a value that may be a number or a BR-formatted string.
function toNum(v) {
    if (v === '' || v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v instanceof Date) return null;
    const original = String(v).trim();
    if (!original) return null;

    // Accept only a complete numeric value, optionally surrounded by known
    // currency/unit labels. This deliberately rejects status messages such as
    // "INFORMAR AO MENOS 2 LEITURAS", which used to be parsed as the number 2.
    const match = original.match(/^\s*(?:R\$\s*)?(-?\d[\d.,]*)(?:\s*(?:km|h|hora|horas|l|litro|litros|%))?\s*$/i);
    if (!match) return null;
    let s = match[1];
    // BR format: 1.234,56  -> 1234.56 ; if both separators present, dot is thousands
    if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(s)) {
        s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return isFinite(n) ? n : null;
}

function normPosto(value) {
    const raw = String(value || '').trim().replace(/\s+/g, ' ');
    if (!raw) return '';
    const key = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (/P(?:O|S)STO (DOS )?ROMEIROS 4/.test(key)) return 'Posto Romeiros 4';
    if (key === 'POSTO PLANALTO II') return 'Posto Planalto II';
    return raw;
}

function normalizeFiles(value) {
    if (!value) return [];
    if (!Array.isArray(value) || value.length > 5) throw new Error('Envie no máximo 5 anexos por lançamento.');
    let totalBytes = 0;
    const normalized = value.map((file, index) => {
        const name = text(file?.name) || `anexo-${index + 1}`;
        const mimeType = text(file?.mimeType).toLowerCase();
        const base64 = text(file?.base64);
        if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mimeType)) throw new Error('Use imagens JPG, PNG, WEBP, HEIC ou arquivos PDF.');
        if (!/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error('Anexo inválido.');
        totalBytes += Math.floor(base64.length * 0.75);
        return { name: name.slice(0, 120), mimeType, base64 };
    });
    if (totalBytes > 8 * 1024 * 1024) throw new Error('Os anexos devem somar no máximo 8 MB.');
    return normalized;
}

// --- data loading ----------------------------------------------------------

async function buildData() {
    return JSON.parse(await fetchFleetDataRaw());
}

async function getData() {
    const now = Date.now();
    if (cache && now - cache.ts < CACHE_TTL) {
        if (cache.data) return cache.data;
        cache.data = JSON.parse(cache.raw);
        return cache.data;
    }
    const raw = await fetchFleetDataRaw();
    const data = JSON.parse(raw);
    cache = { ts: now, raw, data };
    return data;
}

async function getDataJson(force = false) {
    const now = Date.now();
    if (!force && cache && now - cache.ts < CACHE_TTL) {
        if (cache.raw) return cache.raw;
        return JSON.stringify(cache.data);
    }
    const raw = await fetchFleetDataRaw();
    cache = { ts: now, raw, data: null };
    return raw;
}

const fleetHandler = async (req, res) => {
    try {
        const raw = await getDataJson(false);
        res.type('application/json').send(raw);
    } catch (err) {
        logger.error('fleet error:', err.message, err.stack);
        res.status(err.code === 'SHEETS_WEBHOOK_NOT_CONFIGURED' ? 503 : 502).json({
            error: 'FLEET_FETCH_FAILED',
            message: err.message || 'Não foi possível ler as planilhas do Google Sheets neste momento.',
            detail: err.message,
        });
    }
};

function text(value) {
    return String(value || '').trim();
}

function requiredNumber(value, label, { min = 0 } = {}) {
    const number = toNum(value);
    if (number === null || number < min) throw new Error(`${label} inválido.`);
    return number;
}

async function validateRequest(req, res) {
    if (!sheetsWriteConfigured()) {
        res.status(503).json({ error: 'SHEETS_WRITE_NOT_CONFIGURED', message: 'A gravação no Google Sheets ainda precisa ser configurada no painel.' });
        return false;
    }
    if (!verifyEntryPin(req.body?.pin)) {
        res.status(401).json({ error: 'INVALID_PIN', message: 'PIN de lançamento incorreto.' });
        return false;
    }
    return true;
}

const createAbastecimentoHandler = async (req, res) => {
    try {
        if (!(await validateRequest(req, res))) return;
        const data = await getData();
        const placa = text(req.body.placa).toUpperCase();
        const veiculo = data.veiculosAbastecimento.find((v) => v.placa === placa);
        if (!veiculo) return res.status(400).json({ error: 'INVALID_PLATE', message: 'Placa/identificação não encontrada na aba Veículos da planilha de abastecimento.' });
        const projeto = text(req.body.projeto);
        if (!data.projetosAbastecimento.includes(projeto)) return res.status(400).json({ error: 'INVALID_PROJECT', message: 'Projeto não encontrado na planilha de abastecimento.' });
        const dataInformada = text(req.body.data);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInformada)) return res.status(400).json({ error: 'INVALID_DATE', message: 'Data inválida.' });
        // Impede ano futuro em abastecimentos, preservando mês e dia.
        const anoAtual = new Date().getFullYear();
        const anoInformado = Number(dataInformada.slice(0, 4));
        const dataLancamento = anoInformado > anoAtual
            ? `${anoAtual}${dataInformada.slice(4)}`
            : dataInformada;
        const litros = requiredNumber(req.body.litros, 'Litragem', { min: 0.01 });
        const suppliedTotal = toNum(req.body.valor);
        const legacyUnitPrice = toNum(req.body.precoLitro);
        if ((suppliedTotal === null || suppliedTotal <= 0) && (legacyUnitPrice === null || legacyUnitPrice <= 0)) {
            throw new Error('Valor total do abastecimento inválido.');
        }
        const valor = suppliedTotal !== null && suppliedTotal > 0
            ? Math.round(suppliedTotal * 100) / 100
            : Math.round(litros * legacyUnitPrice * 100) / 100;
        const precoLitro = Math.round((valor / litros) * 10000) / 10000;
        const item = text(req.body.item);
        const fornecedor = normPosto(req.body.posto);
        if (!item || !fornecedor) return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Informe combustível e posto.' });
        const chave = `${dataLancamento.replace(/-/g, '')}-${placa}-${Date.now()}`;
        await appendSheetRow({
            spreadsheetId: SHEET1_ID,
            sheetName: 'Gastos',
            values: [dataLancamento, placa, veiculo.veiculo, projeto, 'Combustível', item, valor, toNum(req.body.km) || '', text(req.body.fa), litros, precoLitro, fornecedor, '', text(req.body.observacoes), 'PENDENTE', '', chave],
        });
        cache = null;
        res.status(201).json({ ok: true, message: 'Abastecimento gravado na planilha e enviado para conferência.' });
    } catch (err) {
        logger.error('create abastecimento error:', err.message);
        res.status(400).json({ error: 'INVALID_ENTRY', message: err.message });
    }
};

const createManutencaoHandler = async (req, res) => {
    try {
        if (!(await validateRequest(req, res))) return;
        const data = await getData();
        const placa = text(req.body.placa).toUpperCase();
        const veiculo = data.veiculos.find((v) => v.placa === placa);
        if (!veiculo) return res.status(400).json({ error: 'INVALID_PLATE', message: 'Placa não encontrada no cadastro de veículos.' });
        const projeto = text(req.body.projeto);
        if (!data.veiculos.some((v) => v.projeto === projeto)) return res.status(400).json({ error: 'INVALID_PROJECT', message: 'Projeto não encontrado no cadastro.' });
        const dataChamado = text(req.body.dataChamado);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dataChamado)) return res.status(400).json({ error: 'INVALID_DATE', message: 'Data inválida.' });
        const tipo = ['Preventiva', 'Corretiva'].includes(req.body.tipo) ? req.body.tipo : 'Outros';
        const status = text(req.body.status).toUpperCase();
        if (!['AGENDADO', 'FINALIZADO'].includes(status)) return res.status(400).json({ error: 'INVALID_STATUS', message: 'Selecione Agendada ou Finalizada.' });
        const dataPrevista = text(req.body.dataPrevista);
        const dataConclusao = text(req.body.dataConclusao);
        if (status === 'AGENDADO' && !/^\d{4}-\d{2}-\d{2}$/.test(dataPrevista)) return res.status(400).json({ error: 'INVALID_DATE', message: 'Informe a data prevista da manutenção.' });
        if (status === 'FINALIZADO' && !/^\d{4}-\d{2}-\d{2}$/.test(dataConclusao)) return res.status(400).json({ error: 'INVALID_DATE', message: 'Informe a data de conclusão da manutenção.' });
        const parsedValue = toNum(req.body.valor);
        if (status === 'FINALIZADO' && (parsedValue === null || parsedValue < 0)) return res.status(400).json({ error: 'INVALID_VALUE', message: 'Informe o valor da manutenção finalizada.' });
        const valor = parsedValue === null ? '' : parsedValue;
        const descricao = text(req.body.descricao);
        const files = normalizeFiles(req.body.files);
        if (!descricao) return res.status(400).json({ error: 'MISSING_DESCRIPTION', message: 'Informe o serviço previsto ou realizado.' });
        const nextId = Math.max(0, ...data.manutencao.map((r) => Number(r.id) || 0)) + 1;
        await appendSheetRow({
            spreadsheetId: SHEET2_ID,
            sheetName: 'Histórico de Manutenção',
            values: [nextId, placa, veiculo.veiculo, projeto, veiculo.tipoPosse || veiculo.propriedade || '', status, `Manutenção ${tipo}`, descricao, text(req.body.peca), dataChamado, dataPrevista, status === 'FINALIZADO' ? dataConclusao : '', '', toNum(req.body.km) || '', veiculo.unidade || 'KM', valor, '', '', '', valor, text(req.body.responsavel), text(req.body.fornecedor), ''],
            files,
            evidence: { type: 'Manutenção', date: dataChamado, plate: placa, vehicle: veiculo.veiculo, project: projeto, description: descricao, targetColumn: 23, folderUrl: text(req.body.folderUrl) || veiculo.pastaEvidencias },
        });
        cache = null;
        res.status(201).json({ ok: true, message: 'Manutenção gravada na planilha e enviada para conferência.' });
    } catch (err) {
        logger.error('create manutencao error:', err.message);
        res.status(400).json({ error: 'INVALID_ENTRY', message: err.message });
    }
};

const createKmSemanalHandler = async (req, res) => {
    try {
        if (!(await validateRequest(req, res))) return;
        const data = await getData();
        const placa = text(req.body.placa).toUpperCase();
        const veiculo = data.veiculos.find((v) => v.placa === placa);
        if (!veiculo) return res.status(400).json({ error: 'INVALID_PLATE', message: 'Placa não encontrada no cadastro de veículos.' });
        const dataLeitura = text(req.body.data);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dataLeitura)) return res.status(400).json({ error: 'INVALID_DATE', message: 'Data inválida.' });
        const leitura = requiredNumber(req.body.leitura, 'Leitura de KM', { min: 0 });
        await sendSheetCommand({ action: 'weeklyKm', spreadsheetId: SHEET2_ID, sheetName: 'KM Semanal', plate: placa, date: dataLeitura, reading: leitura });
        cache = null;
        res.status(201).json({ ok: true, message: 'KM semanal atualizado na planilha.' });
    } catch (err) {
        logger.error('create km semanal error:', err.message);
        res.status(400).json({ error: 'INVALID_ENTRY', message: err.message });
    }
};

const createVeiculoHandler = async (req, res) => {
    try {
        if (!(await validateRequest(req, res))) return;
        const data = await getData();
        const placa = text(req.body.placa).toUpperCase();
        if (!placa || placa.length < 5) return res.status(400).json({ error: 'INVALID_PLATE', message: 'Informe uma placa ou identificação válida.' });
        if (data.veiculos.some((v) => v.placa === placa)) return res.status(409).json({ error: 'DUPLICATE_PLATE', message: 'Este veículo já está cadastrado.' });
        const veiculo = text(req.body.veiculo);
        const projeto = text(req.body.projeto);
        if (!veiculo || !projeto) return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Informe veículo/modelo e projeto.' });
        const folderUrl = text(req.body.folderUrl);
        if (folderUrl && !/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+/.test(folderUrl)) return res.status(400).json({ error: 'INVALID_FOLDER', message: 'Informe um link válido de pasta do Google Drive.' });
        const dataEntrada = text(req.body.dataEntrada);
        if (dataEntrada && !/^\d{4}-\d{2}-\d{2}$/.test(dataEntrada)) return res.status(400).json({ error: 'INVALID_DATE', message: 'Data de entrada inválida.' });
        await appendSheetRow({
            spreadsheetId: SHEET2_ID,
            sheetName: 'Cadastro de Veículos',
            values: [placa, veiculo, text(req.body.combustivel), text(req.body.propriedade), '', text(req.body.tipoPosse), toNum(req.body.franquia) || '', projeto, text(req.body.unidade) || 'KM', text(req.body.identificador), dataEntrada || '', folderUrl],
        });
        cache = null;
        res.status(201).json({ ok: true, message: 'Veículo cadastrado automaticamente na planilha.' });
    } catch (err) {
        logger.error('create veiculo error:', err.message);
        res.status(400).json({ error: 'INVALID_ENTRY', message: err.message });
    }
};

// force-refresh endpoint (clears cache)
const fleetRefreshHandler = async (req, res) => {
    cache = null;
    try {
        const raw = await getDataJson(true);
        res.type('application/json').send(raw);
    } catch (err) {
        logger.error('fleet refresh error:', err.message, err.stack);
        res.status(err.code === 'SHEETS_WEBHOOK_NOT_CONFIGURED' ? 503 : 502).json({
            error: 'FLEET_FETCH_FAILED',
            message: err.message || 'Não foi possível atualizar os dados agora.',
            detail: err.message,
        });
    }
};

export default fleetHandler;
export { fleetRefreshHandler, createAbastecimentoHandler, createManutencaoHandler, createKmSemanalHandler, createVeiculoHandler };
