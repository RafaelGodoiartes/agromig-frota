import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFleetOverview } from './fleetOverview.js';
import { summarizeAcquisitions, acquisitionMonths } from './fleetAcquisitions.js';

const registry = () => [
    ['HBRBE440TR0085665', 150], ['SOR3CXTTER3423582', 50], ['SOR3CXTTER3423584', 70],
    ['TEQ1D19', 100], ['TEO9H16', 200], ['TEQ4H56', 300], ['LTU5A25', 999], ['TRATOR', 40],
].map(([placa, parcelaMensal]) => ({ placa, veiculo: placa, tipoPosse: 'Próprio', aluguelMensal: 1000, parcelaMensal, projeto: 'A', temParcela: 'Sim', temSeguro: ['TEQ1D19', 'TEO9H16'].includes(placa) ? 'Sim' : 'Não' }));
const billing = { measurements: [], projects: [], insuranceItems: [{ plate: 'TEQ1D19', premiumCents: 100 }, { plate: 'TEO9H16', premiumCents: 200 }] };
function model(filters = {}, rows = registry(), today = '2026-11-05') {
    const summary = summarizeFleetOverview({ cadastroFinanceiro: rows }, billing, filters, today);
    return { summary, ...summarizeAcquisitions(summary, billing.insuranceItems, filters, today) };
}

test('aquisição individual concilia com fixas sem repetir o preço do grupo ou usar o preço antigo da Prancha', () => {
    const m = model();
    assert.equal(m.monthlyAcquisitionCents, 616928);
    assert.equal(m.assets.find(row => row.id === 'TEQ1D19').currentCents, 10000);
    assert.equal(m.assets.find(row => row.id === 'SOR3CXTTER3423582').currentCents, 5000);
    assert.equal(m.assets.find(row => row.id === 'LTU5A25').currentCents, 525928);
    assert.equal(m.assets.reduce((sum, row) => sum + row.fixedReferenceCents, 0), m.summary.fixedCents);
    assert.equal(m.assets.reduce((sum, row) => sum + row.acquisitionReferenceCents, 0), m.monthlyAcquisitionCents);
});

test('histórico mostra cada competência paga desde os inícios estimados, sem marcar novembro ou qualquer vencida como paga', () => {
    const m = model({}, registry(), '2029-12-31');
    const acquired = m.history.filter(row => row.source === 'Aquisição');
    assert.equal(acquired.length, 112);
    assert.equal(acquired[0].month, '2024-08');
    assert.ok(acquired.every(row => row.date <= '2026-10-01' && row.estimated));
    assert.equal(m.assets.find(row => row.id === 'HBRBE440TR0085665').paid, 17);
    assert.equal(m.assets.find(row => row.id === 'SOR3CXTTER3423582').paid, 19);
    assert.equal(m.assets.find(row => row.id === 'TEQ1D19').paid, 10);
    assert.equal(m.assets.find(row => row.id === 'LTU5A25').paid, 27);
    assert.equal(m.estimatedPaidCents, 15283056);
    assert.equal(m.insurancePaidCents, 1253157);
    assert.ok(m.history.filter(row => row.source === 'Seguro').every(row => !row.estimated && row.number <= 3));
});

test('o gráfico respeita período e ativo; o detalhe preserva todos os meses pagos e o seguro não é redistribuído ao filtrar', () => {
    const m = model({ from: '2026-09-01', to: '2026-09-30', vehicle: 'TEQ1D19' });
    assert.equal(m.assets.length, 1);
    assert.equal(m.history.filter(row => row.source === 'Aquisição').length, 10);
    assert.equal(m.history.filter(row => row.source === 'Aquisição')[0].month, '2026-01');
    assert.equal(m.estimatedPaidCents, 100000);
    assert.equal(m.insurancePaidCents, 417720);
    const chart = acquisitionMonths(m.periodHistory);
    assert.equal(chart.length, 1); assert.equal(chart[0].month, '2026-09');
    assert.equal(chart[0].acquisitionCents, 10000); assert.equal(chart[0].insuranceCents, 139240);
});

test('cadastro sem histórico não recebe pagamentos inventados e valor ausente permanece desconhecido', () => {
    const m = model({}, [...registry(), { placa: 'SEMVALOR', tipoPosse: 'Próprio', temParcela: 'Sim', parcelaMensal: '', temSeguro: 'Não', aluguelMensal: 1000 }]);
    assert.equal(m.assets.find(row => row.id === 'TRATOR').paid, null);
    assert.equal(m.assets.find(row => row.id === 'SEMVALOR').currentCents, null);
    assert.equal(m.missingHistory, 2); assert.equal(m.monthlyMissing, true);
    assert.equal(m.history.some(row => ['TRATOR', 'SEMVALOR'].includes(row.vehicleId)), false);
});

test('não duplica placas, não inclui locados e não altera fontes, quantidades pagas nem despesas variáveis', () => {
    const rows = [...registry(), registry()[3], { placa: 'LOCADO', tipoPosse: 'Locado', parcelaMensal: 9999, temParcela: 'Sim' }];
    const before = structuredClone(rows), m = model({}, rows);
    assert.deepEqual(rows, before);
    assert.equal(m.assets.length, 8); assert.equal(m.history.some(row => row.vehicleId === 'LOCADO'), false);
    assert.equal(new Set(m.history.map(row => row.id)).size, m.history.length);
    assert.equal(m.summary.variableCents, 0);
});

test('parcela de contrato conhecido não volta como despesa indefinida antes do início ou após o término', () => {
    for (const month of ['2024-07', '2033-01']) {
        const m = model({ from: `${month}-01`, to: `${month}-28` }, registry().filter(row => row.placa !== 'TRATOR'));
        assert.equal(m.monthlyAcquisitionCents, 0);
        assert.equal(m.summary.fixedCents, 0);
    }
});

test('preço ausente em aquisição com pagamentos conhecidos preserva a quantidade, mas sinaliza estimativa incompleta', () => {
    const rows = registry(); rows.find(row => row.placa === 'TEQ1D19').parcelaMensal = '';
    const m = model({}, rows);
    assert.equal(m.assets.find(row => row.id === 'TEQ1D19').paid, 10);
    assert.equal(m.history.filter(row => row.vehicleId === 'TEQ1D19' && row.estimated).length, 10);
    assert.ok(m.history.filter(row => row.vehicleId === 'TEQ1D19' && row.estimated).every(row => row.amountCents === null));
    assert.equal(m.paidMissing, true); assert.equal(m.monthlyMissing, true);
    assert.ok(acquisitionMonths(m.history).some(row => row.missing));
});
