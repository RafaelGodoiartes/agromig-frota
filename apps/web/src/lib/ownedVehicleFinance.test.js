import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFinanceBRL, insuranceSchedule, moneyCents, summarizeInsurance, summarizeOwnedVehicles, summarizeOwnedMonthlyRevenue, summarizeOwnedMaintenance, OWNED_FLEET_INSURANCE_PAID } from './ownedVehicleFinance.js';

const vehicle = (placa, tipoPosse, aluguelMensal) => ({ placa, tipoPosse, aluguelMensal });

test('Prancha usa KM e tarifa de cada viagem no mês, nunca aluguel fixo ou valor da mercadoria', () => {
    const registry = [vehicle('LTU-5A25', 'Próprio', 18000), vehicle('AAA1B23', 'Próprio', 1000), vehicle('BBB1B23', 'Locado', 900)];
    const trip = { id: 1, placa: 'LTU5A25', data: '2026-10-01', kmTotal: 100, valorKm: 10, valorCobrado: 9999 };
    const trips = [trip, trip, { ...trip, id: 2, kmTotal: '250,5', valorKm: 12 }, { ...trip, id: 3, data: '2026-09-01' }];
    const result = summarizeOwnedMonthlyRevenue(registry, trips, '2026-10');
    assert.equal(result.totalCents, 500600);
    assert.equal(result.tripCount, 2);
    assert.equal(result.rows.find(row => row.plateKey === 'LTU5A25').amountCents, 400600);
    assert.equal(summarizeOwnedMonthlyRevenue(registry, [], '2026-11').totalCents, 100000);
    assert.deepEqual(registry[0], vehicle('LTU-5A25', 'Próprio', 18000));
    for (const missing of [undefined, [{ ...trip, kmTotal: '' }], [{ ...trip, valorKm: '' }], [{ ...trip, data: '' }]]) {
        assert.equal(summarizeOwnedMonthlyRevenue(registry, missing, '2026-10').rows.find(row => row.plateKey === 'LTU5A25').amountCents, null);
    }
    assert.equal(summarizeOwnedMonthlyRevenue([vehicle('LTU5A25', 'Locado', 18000)], trips, '2026-10').totalCents, 0);
});

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

test('três primeiras parcelas confirmadas somam R$ 12.531,57 e deixam R$ 29.240,35', () => {
    assert.deepEqual(OWNED_FLEET_INSURANCE_PAID, [1, 2, 3]);
    for (const month of ['2026-08', '2026-10', '2027-05']) {
        const result = summarizeInsurance(month, OWNED_FLEET_INSURANCE_PAID);
        assert.equal(result.paidCents, 1253157);
        assert.equal(result.balanceCents, 2924035);
        assert.equal(result.paidCents + result.balanceCents, result.totalCents);
    }
    assert.equal(summarizeInsurance('2026-10', OWNED_FLEET_INSURANCE_PAID).expenseCents, 417719);
});

test('despesa variável mensal inclui somente manutenção dos próprios, na competência escolhida', () => {
    const owned = summarizeOwnedVehicles([vehicle('AAA1B23', 'Próprio', 5000), vehicle('BBB2C34', 'Locado', 9000)]);
    const source = [
        { id: 1, placa: 'aaa-1b23', dataChamado: '2026-10-01', custoTotal: 'R$ 1.234,56', valor: 9999 },
        { id: 2, placa: 'AAA1B23', dataChamado: '31/10/2026', valor: 10.01 },
        { id: 3, placa: 'AAA1B23', dataChamado: '2026-09-30', valor: 500 },
        { id: 4, placa: 'BBB2C34', dataChamado: '2026-10-01', valor: 800 },
    ];
    const result = summarizeOwnedMaintenance(source, owned.rows, '2026-10');
    assert.equal(result.totalCents, 124457);
    assert.equal(result.rows.length, 2);
    const fixed = summarizeInsurance('2026-10').expenseCents;
    assert.equal(owned.totalCents - result.totalCents - fixed, -42176);
    source[0].custoTotal = 100;
    assert.equal(summarizeOwnedMaintenance(source, owned.rows, '2026-10').totalCents, 11001);
});
test('não duplica a mesma manutenção e preserva lançamentos distintos com valores iguais', () => {
    const owned = summarizeOwnedVehicles([vehicle('AAA1B23', 'Próprio', 1000)]);
    const record = { id: 1, placa: 'AAA1B23', dataChamado: '2026-10-01', valor: 100 };
    const result = summarizeOwnedMaintenance([record, { ...record }, { ...record, id: 2 }], owned.rows, '2026-10');
    assert.equal(result.totalCents, 20000);
    assert.equal(result.rows.length, 2);
});
test('custos sem data/valor e fonte indisponível não se tornam zeros confirmados', () => {
    const owned = summarizeOwnedVehicles([vehicle('AAA1B23', 'Próprio', 1000)]);
    const result = summarizeOwnedMaintenance([{ placa: 'AAA1B23', dataChamado: '', valor: 100 }, { placa: 'AAA1B23', dataChamado: '2026-10-01', valor: '' }], owned.rows, '2026-10');
    assert.equal(result.missingDates, 1);
    assert.equal(result.missingValues, 1);
    assert.equal(result.totalCents, 0);
    assert.equal(summarizeOwnedMaintenance(undefined, owned.rows, '2026-10').available, false);
});
