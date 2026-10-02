import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFinanceBRL, insuranceSchedule, moneyCents, summarizeInsurance, summarizeOwnedVehicles } from './ownedVehicleFinance.js';

const vehicle = (placa, tipoPosse, aluguelMensal) => ({ placa, tipoPosse, aluguelMensal });

test('soma somente Próprio, respeita acentos/caixa e não usa propriedade para substituir Posse', () => {
    const summary = summarizeOwnedVehicles([
        vehicle('AAA1B23', 'Próprio', 1500), vehicle('BBB2C34', ' próprio ', 2400.25),
        vehicle('CCC3D45', 'Locado', 9000), vehicle('DDD4E56', 'Terceirizado', 6000),
        { ...vehicle('EEE5F67', '', 1000), propriedade: 'Próprio' },
    ]);
    assert.equal(summary.rows.length, 2);
    assert.equal(summary.totalCents, 390025);
});

test('alteração de aluguel, inclusão, exclusão e mudança de posse recalculam o total', () => {
    const initial = [vehicle('AAA1B23', 'Próprio', 1000)];
    assert.equal(summarizeOwnedVehicles(initial).totalCents, 100000);
    const changed = [{ ...initial[0], aluguelMensal: 1200 }];
    assert.equal(summarizeOwnedVehicles(changed).totalCents, 120000);
    const added = [...changed, vehicle('BBB2C34', 'Próprio', 800)];
    assert.equal(summarizeOwnedVehicles(added).totalCents, 200000);
    assert.equal(summarizeOwnedVehicles(added.slice(1)).totalCents, 80000);
    assert.equal(summarizeOwnedVehicles(added.map((row) => ({ ...row, tipoPosse: 'Locado' }))).totalCents, 0);
});

test('normaliza a placa e conta duplicata idêntica uma única vez', () => {
    const summary = summarizeOwnedVehicles([vehicle('aaa-1b23', 'Próprio', 200), vehicle('AAA1B23', 'PROPRIO', 200)]);
    assert.equal(summary.rows.length, 1);
    assert.equal(summary.totalCents, 20000);
});

test('expõe duplicatas divergentes em vez de escolher arbitrariamente', () => {
    const summary = summarizeOwnedVehicles([
        vehicle('AAA1B23', 'Próprio', 200), vehicle('AAA1B23', 'Próprio', 300),
        vehicle('BBB2C34', 'Locado', 200), vehicle('BBB2C34', 'Próprio', 200),
    ]);
    assert.deepEqual(summary.conflicts, ['AAA1B23', 'BBB2C34']);
    assert.equal(summary.totalCents, 0);
});

test('valor ausente ou inválido fica pendente, preservando zero legítimo', () => {
    const summary = summarizeOwnedVehicles([vehicle('AAA1B23', 'Próprio', null), vehicle('BBB2C34', 'Próprio', 'erro'), vehicle('CCC3D45', 'Próprio', 0)]);
    assert.deepEqual(summary.missingValues, ['AAA1B23', 'BBB2C34']);
    assert.equal(summary.rows.find((row) => row.placa === 'CCC3D45').amountCents, 0);
    for (const value of ['', null, undefined, -1, Infinity, NaN, 'valor 10']) assert.equal(moneyCents(value), null);
});

test('normaliza moeda brasileira como número e soma em centavos', () => {
    assert.equal(moneyCents('R$ 1.234,56'), 123456);
    assert.equal(moneyCents('1.000'), 100000);
    assert.equal(moneyCents(4006.86), 400686);
    assert.equal(summarizeOwnedVehicles([vehicle('AAA', 'Próprio', 0.1), vehicle('BBB', 'Próprio', 0.2)]).totalCents, 30);
});

test('apólice confirmada: parcelas 1–9 são 4.177,19 e parcela 10 é 4.177,21', () => {
    const schedule = insuranceSchedule();
    assert.equal(schedule.length, 10);
    assert.ok(schedule.slice(0, 9).every((row) => row.amountCents === 417719));
    assert.equal(schedule[9].amountCents, 417721);
    assert.equal(schedule.reduce((sum, row) => sum + row.amountCents, 0), 4177192);
    assert.equal(schedule[0].dueDate, '2026-08-13');
    assert.equal(schedule[9].dueDate, '2027-05-13');
});

test('associa cada parcela ao mês correto, inclusive virada do ano e fora do contrato', () => {
    assert.equal(summarizeInsurance('2026-10').installment.number, 3);
    assert.equal(summarizeInsurance('2026-10').expenseCents, 417719);
    assert.equal(summarizeInsurance('2027-01').installment.number, 6);
    assert.equal(summarizeInsurance('2027-05').expenseCents, 417721);
    assert.equal(summarizeInsurance('2026-07').expenseCents, 0);
    assert.equal(summarizeInsurance('2027-06').expenseCents, 0);
});

test('não presume pagamentos; calcula total pago e saldo apenas com controle explícito', () => {
    assert.equal(summarizeInsurance('2026-10').paidCents, null);
    assert.equal(summarizeInsurance('2026-10').balanceCents, null);
    const known = summarizeInsurance('2026-10', [1, 2, 2]);
    assert.equal(known.paidCents, 835438);
    assert.equal(known.balanceCents, 3341754);
    assert.equal(summarizeInsurance('2026-10', []).balanceCents, 4177192);
});

test('formata todos os valores em reais com duas casas decimais', () => {
    const normalized = (value) => formatFinanceBRL(value).replace(/\u00a0/g, ' ');
    assert.equal(normalized(417719), 'R$ 4.177,19');
    assert.equal(normalized(417721), 'R$ 4.177,21');
    assert.equal(normalized(4177192), 'R$ 41.771,92');
    assert.equal(normalized(0), 'R$ 0,00');
    assert.equal(normalized(null), 'Não informado');
});
