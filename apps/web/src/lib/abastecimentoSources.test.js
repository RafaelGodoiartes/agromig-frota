import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAbastecimentoSources, normalizeOtherAbastecimentos, parseAbastecimentoSheet } from './abastecimentoSources.js';

const payload = (rows) => `google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { rows: rows.map((row) => ({ c: row.map((v) => ({ v })) })) } })});`;

test('carrega catálogo da planilha e lê categorias que o conector antigo omitiria', async () => {
    const calls = [];
    const sources = await loadAbastecimentoSources(async (url) => {
        calls.push(url);
        const body = url.includes('gid=84241627')
            ? payload([['Combustível', 'Gasolina Comum'], ['Graxa', 'GRAXA P/ CHASSI CA2 - KG'], ['lubrificantes', 'ÓLEO 2T LUBRAX']])
            : payload([['01/10/2026', 'EXEMPLO', 'VEÍCULO', 'PROJETO', 'Graxa', 'Graxa', 80, '', 'RESPONSÁVEL', 2, 40, 'FORNECEDOR', '', '', 'OK']]);
        return { ok: true, text: async () => body };
    });
    assert.equal(calls.length, 2);
    assert.ok(sources.tiposAbastecimento.includes('lubrificantes'));
    assert.ok(sources.itensAbastecimento.includes('Graxa'));
    assert.equal(sources.outrosAbastecimentos[0].data, '2026-10-01');
    assert.equal(sources.outrosAbastecimentos[0].litros, 2);
    assert.equal(sources.outrosAbastecimentos[0].km, null);
    assert.equal(sources.outrosAbastecimentos[0].status, 'OK');
});

test('preserva quantidade, valor e status sem inventar dados de uma linha vazia', () => {
    const rows = parseAbastecimentoSheet(payload([
        ['01/10/2026', 'EXEMPLO', '', '', 'Graxa', 'Graxa', 'R$ 80,00', '', '', '2,5', '32', '', '', '', 'REVISAR'],
        ['', '', '', '', 'Graxa'],
    ]));
    const normalized = normalizeOtherAbastecimentos(rows);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].valor, 80);
    assert.equal(normalized[0].litros, 2.5);
    assert.equal(normalized[0].status, 'REVISAR');
});

test('falha de leitura não é apresentada como uma lista vazia válida', async () => {
    assert.throws(() => parseAbastecimentoSheet('<html>Login</html>'), /inválida/);
    await assert.rejects(loadAbastecimentoSources(async () => ({ ok: false, status: 403 })), /403/);
});
