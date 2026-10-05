import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMaintenanceParts } from './maintenanceParts.js';

const options = { from: '2026-10-01', to: '2026-10-31', currentDate: '2026-10-05' };
const part = (overrides = {}) => ({ peca: 'Filtro', fornecedor: 'Fornecedor', placa: 'ABC1D23', valor: 100, dataEntrada: '2026-10-01', dataSaida: '', ...overrides });

test('gastos usam entrada inclusiva, reais em centavos e não duplicam agregações', () => {
    const result = summarizeMaintenanceParts([part({ valor: 'R$ 1.234,56' }), part({ valor: 0.01, dataEntrada: '31/10/2026' }), part({ dataEntrada: '2026-09-30' }), part({ dataEntrada: '2026-11-01' })], options);
    assert.equal(result.totalCents, 123457);
    assert.equal(result.periodRows.length, 2);
    assert.equal(result.monthly[0].valor, 1234.57);
});
test('estoque atual inclui entradas anteriores e exclui utilizadas, futuras e sem entrada', () => {
    const result = summarizeMaintenanceParts([part({ dataEntrada: '2026-08-01' }), part({ dataSaida: '2026-10-03' }), part({ dataEntrada: '2026-10-31' }), part({ dataEntrada: '' }), part({ dataSaida: '2026-10-20' })], options);
    assert.equal(result.stockRows.length, 2);
    assert.equal(result.stockCents, 20000);
    assert.equal(result.missingDates, 1);
});
test('mesma placa com grafias diferentes agrupa, compras distintas não são descartadas', () => {
    const result = summarizeMaintenanceParts([part(), part({ placa: 'abc-1d23', valor: 250 }), part({ placa: '', valor: 50 })], options);
    assert.equal(result.vehicles.length, 1);
    assert.equal(result.vehicles[0].count, 2);
    assert.equal(result.vehicles[0].amountCents, 35000);
    assert.equal(result.expensiveRows[0].valor, 250);
    assert.equal(result.totalCents, 40000);
});
test('placa e busca filtram estoque e gastos sem exigir projeto inexistente', () => {
    const result = summarizeMaintenanceParts([part({ peca: 'Óleo', placa: 'abc-1d23' }), part({ placa: 'XYZ9A01' })], { ...options, plate: 'ABC1D23', search: 'oleo' });
    assert.equal(result.periodRows.length, 1);
    assert.equal(result.stockRows.length, 1);
});
test('valores e datas inválidos são evidenciados, não tratados como estoque saudável', () => {
    const result = summarizeMaintenanceParts([part({ valor: '' }), part({ dataSaida: '2026-09-30' }), part({ dataEntrada: '31/02/2026' }), part({ dataSaida: 'erro' })], options);
    assert.equal(result.missingValues, 1);
    assert.equal(result.invalidDates, 3);
    assert.equal(result.stockMissingValues, 1);
    assert.equal(result.stockRows.length, 1);
});
test('fonte indisponível e intervalo invertido não exibem dados normais', () => {
    assert.equal(summarizeMaintenanceParts(undefined, options).available, false);
    assert.equal(summarizeMaintenanceParts([], options).available, true);
    const result = summarizeMaintenanceParts([part()], { ...options, from: '2026-11-01' });
    assert.equal(result.invalidPeriod, true);
    assert.equal(result.totalCents, 0);
});
test('identificação com modelo e placa reconhece o cadastro sem juntar veículos ambíguos', () => {
    const result = summarizeMaintenanceParts([part({ placa: 'CAMINHÃO PRANCHA - LTU5A25' }), part({ placa: 'LTU5A25' })], { ...options, plate: 'LTU5A25', vehicles: [{ placa: 'LTU5A25' }] });
    assert.equal(result.periodRows.length, 2);
    assert.equal(result.vehicles.length, 1);
    assert.equal(result.vehicles[0].placa, 'LTU5A25');
});
