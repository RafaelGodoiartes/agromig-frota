import test from 'node:test';
import assert from 'node:assert/strict';
import { distributeInsurance, overviewInsurance, overviewRegistry, overviewRevenue, summarizeFleetOverview } from './fleetOverview.js';

// Synthetic records only. Policy-specific premiums stay in private server configuration.
const vehicle = (placa, extra = {}) => ({ placa, veiculo: placa, tipoPosse: 'PRÓPRIO', projeto: 'Projeto A', aluguelMensal: 1000, temSeguro: 'Não', temParcela: 'Não', ...extra });
const data = (extra = {}) => ({ cadastroFinanceiro: [vehicle('AAA1B23')], veiculos: [], manutencao: [], abastecimento: [], outrosAbastecimentos: [], pagamentosDocumentacao: [], viagensLTU5A25: [], locacoesRetroescavadeira: [], ...extra });
const billing = (extra = {}) => ({ measurements: [], projects: [], insuranceItems: [{ plate: 'AAA1B23', premiumCents: 10000 }, { plate: 'BBB2C34', premiumCents: 20000 }], ...extra });
const month = { from: '2026-10-01', to: '2026-10-31' };
const summary = (d = data(), b = billing(), filters = {}) => summarizeFleetOverview(d, b, filters, '2026-11-05');

test('rateio proporcional fecha cada parcela em centavos, inclusive a última e as 3 pagas', () => {
    const b = billing();
    for (const amount of [417719, 417721, 1, 0]) {
        const rows = distributeInsurance(amount, b.insuranceItems);
        assert.equal(rows.reduce((sum, row) => sum + row.amountCents, 0), amount);
        assert.equal(rows.length, 2);
    }
    const insurance = overviewInsurance(b.insuranceItems, '2027-05');
    assert.equal(insurance.installment.number, 10);
    assert.equal(insurance.paidCents, 1253157);
    assert.equal(insurance.contractedCents, 4177192);
    assert.equal([...insurance.paidByPlate.values()].reduce((sum, value) => sum + value, 0), insurance.paidCents);
    assert.deepEqual(distributeInsurance(1, [{ plate: 'A', premiumCents: -1 }]), []);
    assert.deepEqual(distributeInsurance(1, [{ plate: 'A', premiumCents: 1 }, { plate: 'A', premiumCents: 1 }]), []);
});
test('todo período separa mensalidade atual do histórico e não inventa recebimentos antigos', () => {
    const s = summary();
    assert.equal(s.monthlyContractCents, 100000); assert.equal(s.totalRevenueCents, 0);
    assert.equal(s.singleMonth, false); assert.equal(s.resultCents, null);
});
test('mês inclui somente próprios, sem duplicar cadastro nem aluguel da Prancha', () => {
    const s = summary(data({ cadastroFinanceiro: [vehicle('AAA1B23'), vehicle('AAA1B23'), vehicle('BBB2C34', { tipoPosse: 'LOCADO' }), vehicle('LTU5A25', { aluguelMensal: 18000 })], viagensLTU5A25: [{ id: 1, data: '2026-10-05', placa: 'LTU5A25', projeto: 'Projeto B', kmTotal: 100, valorKm: 7 }] }), billing(), month);
    assert.equal(s.table.length, 3); assert.equal(s.monthlyContractCents, 100000);
    assert.equal(s.totalRevenueCents, 170000); assert.equal(s.fixedCents, 625928);
    assert.equal(s.comparableRevenue.filter(row => row.vehicleId === 'LTU5A25').length, 1);
});
test('mensalidade entra pelo dia 25, sem marcar recebimento como confirmado', () => {
    assert.equal(summary(data(), billing(), { from: '2026-10-01', to: '2026-10-24' }).totalRevenueCents, 0);
    assert.equal(summary(data(), billing(), { from: '2026-10-25', to: '2026-10-25' }).totalRevenueCents, 100000);
});
test('medição registrada substitui a estimativa mensal do mesmo ativo/mês', () => {
    const s = summary(data(), billing({ measurements: [{ id: 'm1', equipmentId: 'AAA1B23', projectName: 'Projeto A', month: '2026-10', start: '2026-10-01', end: '2026-10-31', amountCents: 200000 }] }), month);
    assert.equal(s.totalRevenueCents, 200000); assert.equal(s.comparableRevenue.length, 1);
});
test('exclusão lógica e IDs repetidos não duplicam receitas, mas registros reais distintos continuam', () => {
    const measurement = { id: 'm1', equipmentId: 'AAA1B23', month: '2026-10', amountCents: 10000 };
    const rows = overviewRevenue(data(), billing({ measurements: [measurement, measurement, { ...measurement, id: 'm2' }, { ...measurement, id: 'm3', deleted: true }] }), []);
    assert.equal(rows.length, 2);
});
test('custos incluem manutenção, combustível e documentação sem despesas de outros filtros', () => {
    const d = data({ manutencao: [{ id: 1, placa: 'AAA1B23', projeto: 'Projeto A', dataChamado: '2026-10-02', custoTotal: 100, descricao: 'Troca de óleo' }, { id: 2, placa: 'AAA1B23', dataChamado: '2026-09-30', custoTotal: 999 }], abastecimento: [{ id: 1, placa: 'AAA1B23', data: '2026-10-03', valor: 200, projeto: 'Projeto A' }], pagamentosDocumentacao: [{ id: 1, vehicle: 'AAA1B23', date: '2026-10-04', amountCents: 5000 }] });
    const s = summary(d, billing(), month);
    assert.equal(s.variableCents, 35000); assert.equal(s.resultCents, 65000);
    assert.equal(s.variable.length, 3);
    assert.equal(summary(d, billing(), { ...month, vehicle: 'OUTRO' }).variableCents, 0);
});
test('a parcela inteira da apólice nunca é repetida por veículo e máquina sem cobertura fica não informada', () => {
    const s = summary(data({ cadastroFinanceiro: [vehicle('AAA1B23', { temSeguro: 'Sim', seguroMensal: 4117.19 }), vehicle('BBB2C34', { temSeguro: 'Sim', seguroMensal: 4117.19 }), vehicle('MACHINE', { temSeguro: 'Sim' })] }), billing(), month);
    assert.equal(s.fixedCents, 417719); assert.equal(s.fixed.find(row => row.vehicleId === 'MACHINE').amountCents, null);
    assert.equal(s.resultCents, null); assert.ok(s.issues.length);
});
test('receitas e despesas sem valor/data não se tornam um resultado regular', () => {
    const s = summary(data({ manutencao: [{ placa: 'AAA1B23', custoTotal: '', dataChamado: '2026-10-02' }, { placa: 'AAA1B23', custoTotal: 100, dataChamado: '' }] }), billing(), month);
    assert.equal(s.resultCents, null); assert.ok(s.issues.length >= 2);
});
test('conflito de cadastro não escolhe preço silenciosamente', () => {
    const d = data({ cadastroFinanceiro: [vehicle('AAA1B23'), vehicle('AAA1B23', { aluguelMensal: 2000 })] });
    assert.equal(overviewRegistry(d).length, 1); assert.equal(summary(d, billing(), month).resultCents, null);
});
test('locação e medição sobrepostas não dobram faturamento nem produzem resultado confirmado', () => {
    const d = data({ cadastroFinanceiro: [vehicle('MACHINE', { identificador: 'AGR-100' })], locacoesRetroescavadeira: [{ id: 1, modelo: 'AGR 100 - RETRO', dataInicio: '2026-10-02', dataFinalizacao: '2026-10-03', valorTotal: 100 }] });
    const b = billing({ measurements: [{ id: 'm1', equipmentId: 'MACHINE', start: '2026-10-01', end: '2026-10-31', month: '2026-10', amountCents: 20000 }] });
    const s = summary(d, b, month); assert.equal(s.totalRevenueCents, 20000); assert.equal(s.resultCents, null);
});
test('filtro de projeto não usa mensalidade de outro projeto e somas gerais conciliam', () => {
    const d = data({ cadastroFinanceiro: [vehicle('AAA1B23'), vehicle('BBB2C34', { projeto: 'Projeto B' })] });
    const s = summary(d, billing(), { ...month, project: 'Projeto B' });
    assert.equal(s.table.length, 1); assert.equal(s.totalRevenueCents, 100000); assert.equal(s.byProject[0].name, 'Projeto B');
    assert.equal(s.table.reduce((sum, row) => sum + row.revenueCents, 0), s.totalRevenueCents);
});
