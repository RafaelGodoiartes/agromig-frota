import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFaturamentoSources, parseFinanceSheet } from './faturamentoSources.js';

const response = (rows) => `google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { rows: rows.map((cells) => ({ c: cells.map((v) => v === null ? null : { v }) })) } })});`;

test('lê as colunas de viagens, usa valor cobrado e ignora outras placas', () => {
    const values = [1, '20/09/2026', 'LTU5A25', 'VW 30.280', '', '', 'Origem', 'Destino', '', 316000, '', '', 100, 700, 7];
    const rows = parseFinanceSheet(response([values, [2, '20/09/2026', 'OUTRO']]), { key: 'viagensLTU5A25', firstRow: 5 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].valorCobrado, 700);
    assert.equal(rows[0].data, '2026-09-20');
});

test('lê locações e não inclui total geral ou linhas vazias', () => {
    const rows = parseFinanceSheet(response([
        ['AGR 100', 'Operador', 8.5, 'Local', 'Cliente', '20/09/2026', '21/09/2026', 1870],
        ['', '', '', '', 'TOTAL GERAL', '', '', 1870],
    ]), { key: 'locacoesRetroescavadeira', firstRow: 2 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].valorTotal, 1870);
});

test('reutiliza arrays do conector, sem duplicar nem solicitar fontes extras', async () => {
    const existing = { viagensLTU5A25: [], locacoesRetroescavadeira: [] };
    assert.deepEqual(await loadFaturamentoSources(existing, () => { throw new Error('Não deve chamar'); }), existing);
});

test('falha de fonte não é tratada como faturamento zero', async () => {
    await assert.rejects(loadFaturamentoSources({}, async () => ({ ok: false, status: 403 })), /403/);
    assert.throws(() => parseFinanceSheet('<html>Login</html>', {}), /inválida/);
});
