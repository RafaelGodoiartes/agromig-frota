import test from 'node:test';
import assert from 'node:assert/strict';
import { abastecimentoCategory, abastecimentoUnit, changeAbastecimentoCategory, isFuelConsumption, mergeAbastecimentoRows, uniqueOptions } from './abastecimentoTypes.js';
import { commandForRoute } from './apiServerClient.js';

test('selecionar graxa muda categoria e produto; voltar a combustível restaura diesel', () => {
    const grease = changeAbastecimentoCategory({ categoria: 'Combustível', item: 'Diesel S-10', placa: 'EXEMPLO' }, 'Graxa');
    assert.equal(grease.item, 'Graxa');
    assert.equal(grease.placa, 'EXEMPLO');
    assert.equal(changeAbastecimentoCategory(grease, 'Combustível').item, 'Diesel S-10');
    assert.equal(changeAbastecimentoCategory(grease, 'lubrificantes').item, '');
});

test('graxa é kg e nunca entra em KM/L, mesmo classificada como combustível', () => {
    assert.equal(abastecimentoCategory('Combustível', 'GRAXA P/ CHASSI CA2 - KG'), 'Graxa');
    assert.equal(abastecimentoUnit('Graxa', 'Graxa'), 'kg');
    assert.equal(abastecimentoUnit('Combustível', 'Diesel S-10'), 'L');
    assert.equal(isFuelConsumption({ categoria: 'Combustível', item: 'Graxa' }), false);
    assert.equal(isFuelConsumption({ categoria: 'lubrificantes', item: 'ÓLEO 15W50' }), false);
    assert.equal(isFuelConsumption({ categoria: 'Combustível', item: 'Diesel S-10' }), true);
    assert.equal(isFuelConsumption({ item: 'Gasolina Comum' }), true);
});

test('mantém as opções da planilha sem repetir por caixa, espaços ou acento', () => {
    assert.deepEqual(uniqueOptions(['Combustível', 'Combustivel', ' Graxa ', 'GRAXA', '', null, '1', 'lubrificantes']), ['Combustível', 'Graxa', 'lubrificantes']);
});

test('mescla fontes sem duplicar e preserva dois lançamentos idênticos reais', () => {
    const row = { data: '2026-09-20', categoria: 'Graxa', item: 'Graxa', valor: 80, litros: 2 };
    assert.equal(mergeAbastecimentoRows([], [row, row]).length, 2);
    assert.equal(mergeAbastecimentoRows([row], [row, row]).length, 2);
    assert.equal(mergeAbastecimentoRows([row, row], [row, row]).length, 2);
});

test('grava tipo, produto, quantidade e preço nas colunas existentes da aba Gastos', () => {
    const command = commandForRoute('/fleet/abastecimento', {
        data: '2026-10-01', placa: 'EXEMPLO', categoria: 'Graxa', item: 'Graxa',
        litros: '2,5', valor: '100,00', projeto: 'PROJETO', motorista: 'RESPONSÁVEL', posto: 'FORNECEDOR',
    });
    assert.equal(command.action, 'append');
    assert.equal(command.sheetName, 'Gastos');
    assert.equal(command.values[4], 'Graxa');
    assert.equal(command.values[5], 'Graxa');
    assert.equal(command.values[6], 100);
    assert.equal(command.values[9], 2.5);
    assert.equal(command.values[10], 40);
});

test('preserva lançamento antigo e categoria de lubrificante', () => {
    const input = { data: '2026-10-01', placa: 'EXEMPLO', item: 'Diesel S-10', litros: 10, valor: 60 };
    assert.equal(commandForRoute('/fleet/abastecimento', input).values[4], 'Combustível');
    assert.equal(commandForRoute('/fleet/abastecimento', { ...input, categoria: 'lubrificantes', item: 'ÓLEO 2T LUBRAX' }).values[4], 'lubrificantes');
});
