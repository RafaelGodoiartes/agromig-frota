import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_PAYMENTS_SHEET_URL, parseDocumentPayments, summarizeDocumentPayments, loadDocumentPayments } from './documentPayments.js';

const headers = ['DATA DO PAGAMENTO', 'PRESTADOR DE SERVIÇO', 'VEÍCULO / PLACA', 'TIPO DE DOCUMENTAÇÃO', 'VALOR DO SERVIÇO (R$)'];
const body = (rows, cols = headers) => `google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: cols.map((label) => ({ label })), rows: rows.map((values) => ({ c: values.map((v) => ({ v })) })) } })});`;
const vehicles = [{ placa: 'AAA1B23', tipoPosse: 'Próprio', projeto: 'CEC III', veiculo: 'Modelo A' }, { placa: 'BBB2C34', tipoPosse: 'Locado', projeto: 'VIVEIRO' }];
test('aceita Data do serviço e preserva compatibilidade com o cabeçalho anterior', () => {
    const records = [['08/10/2026', 'Prestador', 'AAA1B23', 'CRLV', 100]];
    assert.deepEqual(parseDocumentPayments(body(records, ['DATA DO SERVIÇO', ...headers.slice(1)])), parseDocumentPayments(body(records)));
});
test('lê as colunas reais, datas Google/BR e valores em centavos; planilha vazia é válida', () => {
    const rows = parseDocumentPayments(body([['Date(2026,9,8)', 'Prestador', 'AAA1B23', 'CRLV', 1234.56], ['08/10/2026', 'Outro', 'BBB2C34', 'Laudo', 'R$ 200,01']]));
    assert.equal(rows[0].date, '2026-10-08');
    assert.equal(rows[0].amountCents, 123456);
    assert.equal(rows[1].amountCents, 20001);
    assert.deepEqual(parseDocumentPayments(body([])), []);
});
test('separa próprios, locados e não classificados sem duplicar veículos nem apagar pagamentos iguais', () => {
    const rows = parseDocumentPayments(body([['08/10/2026', 'P', 'aaa-1b23', 'CRLV', 100], ['08/10/2026', 'P', 'BBB2C34', 'Laudo', 200], ['08/10/2026', 'P', 'Não cadastrado', 'CRLV', 50], ['08/10/2026', 'P', 'aaa-1b23', 'CRLV', 100]]));
    const result = summarizeDocumentPayments(rows, [...vehicles, vehicles[0]]);
    assert.equal(result.totalCents, 45000);
    assert.equal(result.ownedCents, 20000);
    assert.equal(result.rentedCents, 20000);
    assert.equal(result.unknownCents, 5000);
    assert.equal(result.rows.length, 4);
});
test('respeita período, placa normalizada, projeto e busca', () => {
    const rows = parseDocumentPayments(body([['30/09/2026', 'P', 'AAA1B23', 'CRLV', 10], ['08/10/2026', 'P', 'AAA1B23', 'Laudo', 20], ['08/10/2026', 'P', 'BBB2C34', 'Laudo', 30]]));
    assert.equal(summarizeDocumentPayments(rows, vehicles, { periodStart: '2026-10-01', periodEnd: '2026-10-31', placa: 'aaa-1b23', projeto: 'CEC III' }, 'laudo').totalCents, 2000);
});

test('subcategoria financeira filtra por posse, documento e limites inclusivos de período sem alterar a base', () => {
    const rows = parseDocumentPayments(body([
        ['01/10/2026', 'P', 'AAA1B23', 'CRLV', 100],
        ['31/10/2026', 'P', 'AAA1B23', 'Laudo de opacidade', 200],
        ['15/10/2026', 'P', 'BBB2C34', 'CRLV', 300],
        ['01/11/2026', 'P', 'AAA1B23', 'CRLV', 400],
        ['15/10/2026', 'P', 'Sem cadastro', 'CRLV', 50],
    ]));
    const before = JSON.stringify(rows);
    const period = { periodStart: '2026-10-01', periodEnd: '2026-10-31' };
    assert.equal(summarizeDocumentPayments(rows, vehicles, period).totalCents, 65000);
    assert.equal(summarizeDocumentPayments(rows, vehicles, { ...period, posse: 'Próprio' }).totalCents, 30000);
    assert.equal(summarizeDocumentPayments(rows, vehicles, { ...period, posse: 'Locado' }).totalCents, 30000);
    assert.equal(summarizeDocumentPayments(rows, vehicles, { ...period, posse: 'Sem classificação' }).totalCents, 5000);
    assert.equal(summarizeDocumentPayments(rows, vehicles, { ...period, posse: 'Próprio', documento: 'crlv' }).totalCents, 10000);
    assert.equal(summarizeDocumentPayments(rows, vehicles, { ...period, documento: 'LAUDO DE OPACIDADE' }).totalCents, 20000);
    assert.equal(summarizeDocumentPayments(rows, vehicles, { periodStart: '2026-11-01', periodEnd: '2026-10-01' }).rows.length, 0);
    assert.equal(JSON.stringify(rows), before);
});

test('atualização relê a fonte exclusiva e reflete novos custos sem duplicar consultas anteriores', async () => {
    const urls = [];
    let amount = 100;
    const fetcher = async (url) => {
        urls.push(url);
        return { ok: true, text: async () => body([['21/10/2026', 'P', 'AAA1B23', 'CRLV', amount]]) };
    };
    const first = await loadDocumentPayments(fetcher);
    amount = 250.50;
    const second = await loadDocumentPayments(fetcher);
    assert.equal(summarizeDocumentPayments(first, vehicles).totalCents, 10000);
    assert.equal(summarizeDocumentPayments(second, vehicles).totalCents, 25050);
    assert.equal(second.length, 1);
    assert.equal(urls.length, 2);
    assert.ok(urls.every((url) => url.includes('gid=202610081') && /&t=\d+/.test(url)));
    assert.ok(DOCUMENT_PAYMENTS_SHEET_URL.endsWith('#gid=202610081'));
});
test('cadastro ausente, posse conflitante e valores inválidos não são classificados arbitrariamente', () => {
    const rows = parseDocumentPayments(body([['', 'P', 'AAA1B23', 'CRLV', 'erro'], ['08/10/2026', 'P', 'AAA1B23', 'CRLV', 0], ['08/10/2026', 'P', 'AAA1B23', 'CRLV', 100]]));
    const result = summarizeDocumentPayments(rows, [...vehicles, { ...vehicles[0], tipoPosse: 'Locado' }]);
    assert.equal(result.ownedCents, 0);
    assert.equal(result.unknownCents, 10000);
    assert.equal(result.invalidAmounts, 1);
    assert.equal(result.missingDates, 1);
    assert.equal(summarizeDocumentPayments(rows, []).unknownCents, 10000);
});
test('falhas da fonte não são convertidas em zero ou lista vazia', async () => {
    assert.throws(() => parseDocumentPayments('erro'));
    assert.throws(() => parseDocumentPayments(body([], ['coluna errada'])));
    await assert.rejects(loadDocumentPayments(async () => ({ ok: false, status: 403 })));
});
