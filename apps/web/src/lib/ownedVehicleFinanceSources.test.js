import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOwnedVehicleRegistry, parseOwnedVehicleRegistry } from './ownedVehicleFinanceSources.js';
import { summarizeOwnedVehicles } from './ownedVehicleFinance.js';

const response = (headers, rows) => `google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: {
    cols: headers.map((label) => ({ label })),
    rows: rows.map((cells) => ({ c: cells.map((v) => v === null ? null : { v }) })),
} })});`;
const headers = ['PLACA', 'VEÍCULO / MODELO', 'TIPO DE POSSE', 'ALUGUEL MENSAL (R$)', 'PROJETO ATENDIDO'];

test('mapeia cabeçalhos reais e converte aluguel para número, sem cadastrar veículos à mão', () => {
    const rows = parseOwnedVehicleRegistry(response(headers, [['AAA1B23', 'Veículo', 'Próprio', 1234.56, 'Projeto'], ['', '', '', null, '']]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].aluguelMensal, 1234.56);
    assert.equal(typeof rows[0].aluguelMensal, 'number');
    assert.equal(rows[0].tipoPosse, 'Próprio');
});

test('usa nomes equivalentes e acompanha mudança de ordem das colunas', () => {
    const rows = parseOwnedVehicleRegistry(response(['ALUGUEL MENSAL', 'POSSE', 'PLACA'], [[1000, 'Próprio', 'AAA1B23']]));
    assert.equal(summarizeOwnedVehicles(rows).totalCents, 100000);
});

test('campo numérico vazio não é substituído por zero e fontes inválidas não indicam receita zero', async () => {
    const rows = parseOwnedVehicleRegistry(response(headers, [['AAA1B23', '', 'Próprio', null, '']]));
    assert.equal(rows[0].aluguelMensal, null);
    assert.throws(() => parseOwnedVehicleRegistry(response(['PLACA', 'PROPRIEDADE'], [])), /colunas/);
    assert.throws(() => parseOwnedVehicleRegistry('<html>Login</html>'), /inválida/);
    await assert.rejects(loadOwnedVehicleRegistry(async () => ({ ok: false, status: 403 })), /403/);
});

test('cada atualização relê a fonte e reflete alterações, inclusão e exclusão', async () => {
    const snapshots = [
        [['AAA1B23', '', 'Próprio', 1000, '']],
        [['AAA1B23', '', 'Próprio', 1200, ''], ['BBB2C34', '', 'Próprio', 800, '']],
        [['BBB2C34', '', 'Próprio', 800, '']],
    ];
    let calls = 0;
    const fetcher = async (url, options) => {
        assert.match(url, /headers=1&t=/);
        assert.ok(options.signal);
        return { ok: true, text: async () => response(headers, snapshots[calls++]) };
    };
    assert.equal(summarizeOwnedVehicles(await loadOwnedVehicleRegistry(fetcher)).totalCents, 100000);
    assert.equal(summarizeOwnedVehicles(await loadOwnedVehicleRegistry(fetcher)).totalCents, 200000);
    assert.equal(summarizeOwnedVehicles(await loadOwnedVehicleRegistry(fetcher)).totalCents, 80000);
    assert.equal(calls, 3);
});
