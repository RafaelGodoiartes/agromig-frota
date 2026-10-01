import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FATURAMENTO_EQUIPMENT,
    buildMaintenanceCostRows,
    buildRevenueRows,
    summarizeByEquipment,
    isoDate,
    finiteNumber,
} from './faturamento.js';

test('consolida faturamento de viagens e locações com filtro de equipamento e período', () => {
    const rows = buildRevenueRows({
        viagensLTU5A25: [{ id: 1, data: '2026-09-20', equipamento: 'VW 30.280', valorCobrado: 22080 }],
        locacoesRetroescavadeira: [{ id: 2, modelo: 'RETROESCAVADEIRA JCB 3CX', dataInicio: '2026-09-10', dataFinalizacao: '2026-09-12', valorTotal: 6006, horas: 27.3 }],
    }, { from: '2026-09-01', to: '2026-09-30', equipment: FATURAMENTO_EQUIPMENT.TRUCK });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 22080);
    assert.equal(rows[0].kind, FATURAMENTO_EQUIPMENT.TRUCK);
});

test('não duplica faturamento de locação que cruza dois meses', () => {
    const rows = buildRevenueRows({
        locacoesRetroescavadeira: [{ id: 1, modelo: 'RETROESCAVADEIRA', dataInicio: '2026-08-30', dataFinalizacao: '2026-09-02', valorTotal: 1000 }],
    }, { from: '2026-09-01', to: '2026-09-30', equipment: FATURAMENTO_EQUIPMENT.RETRO });
    assert.equal(rows.length, 0);
});

test('limita custos às duas fontes de equipamento e usa custo total antes do valor', () => {
    const rows = buildMaintenanceCostRows({ locacoesRetroescavadeira: [{ modelo: 'RETROESCAVADEIRA JCB AGR 102' }], manutencao: [
        { id: 1, placa: 'LTU5A25', dataChamado: '2026-09-03', custoTotal: 800, valor: 100 },
        { id: 2, placa: 'MÁQUINAS', veiculo: 'RETROESCAVADEIRA JCB AGR 102', dataChamado: '2026-09-04', custoTotal: null, valor: 300 },
        { id: 3, placa: 'ABC1234', veiculo: 'CAMINHÃO', dataChamado: '2026-09-04', custoTotal: 900 },
        { id: 4, placa: 'MÁQUINAS', veiculo: 'RETROESCAVADEIRA JCB AGR 103', dataChamado: '2026-09-04', custoTotal: 5000 },
    ] }, { from: '2026-09-01', to: '2026-09-30' });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.amount).sort((a, b) => a - b), [300, 800]);
});

test('normaliza moeda brasileira e valida datas sem aceitar dias inexistentes', () => {
    assert.equal(finiteNumber('R$ 1.234,56'), 1234.56);
    assert.equal(finiteNumber('1.000'), 1000);
    assert.equal(isoDate('20/09/2026'), '2026-09-20');
    assert.equal(isoDate('2026-02-30'), '');
    assert.equal(isoDate(''), '');
});

test('relaciona custo pelo chassi do cadastro e não duplica o mesmo registro', () => {
    const maintenance = { id: 1, placa: 'CHASSI100', dataChamado: '2026-09-01', valor: 80 };
    const data = {
        veiculos: [{ placa: 'CHASSI100', veiculo: 'AGR 100 - RETROESCAVADEIRA JCB 3CX' }],
        locacoesRetroescavadeira: [{ modelo: 'RETROESCAVADEIRA JCB 3CX AGR 100' }],
        manutencao: [maintenance, maintenance],
    };
    assert.equal(buildMaintenanceCostRows(data).length, 1);
    assert.equal(buildMaintenanceCostRows(data, { equipment: 'truck' }).length, 0);
});

test('gera resumo e resultado líquido sem divisão por zero', () => {
    const summary = summarizeByEquipment([{ kind: 'truck', amount: 1000 }], [{ kind: 'truck', amount: 250 }, { kind: 'retro', amount: 50 }]);
    assert.equal(summary.truck.result, 750);
    assert.equal(summary.retro.revenue, 0);
    assert.equal(summary.retro.result, -50);
});
