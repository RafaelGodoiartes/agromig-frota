import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetBilling as B } from './billingMeasurements.js';
const projects = [{ id: 'p1', name: 'Projeto de teste', code: 'P1', client: 'Cliente de teste', start: '2024-01-01', end: '', status: 'Ativo' }, { id: 'p2', name: 'Outro projeto', client: 'Outro cliente', start: '2024-01-01', end: '', status: 'Ativo' }];
const equipment = [{ id: 'AAA1B23', name: 'Equipamento de teste', model: 'Modelo de teste', plate: 'AAA1B23', prefix: 'AGR-TESTE' }];
const input = { projectId: 'p1', equipmentId: 'AAA1B23', start: '2026-10-01', end: '2026-10-31', month: '2026-10', monthlyCents: 3500000 };

test('valores brasileiros são convertidos em centavos sem aceitar textos ou valores não finitos', () => {
    assert.equal(B.cents('R$ 35.000,00'), 3500000);
    assert.equal(B.cents('35000.00'), 3500000);
    assert.equal(B.cents(12.34), 1234);
    for (const value of ['', 'erro', '1.2.3', Infinity, NaN]) assert.equal(B.cents(value), null);
});
test('mês completo vale a mensalidade; parcial usa dias inclusivos do calendário real, inclusive ano bissexto', () => {
    assert.equal(B.calculate(3500000, '2026-10-01', '2026-10-31').amountCents, 3500000);
    assert.equal(B.calculate(310000, '2026-10-01', '2026-10-15').amountCents, 150000);
    assert.equal(B.calculate(290000, '2024-02-01', '2024-02-29').amountCents, 290000);
    assert.equal(B.calculate(310000, '2026-10-12', '2026-10-12').amountCents, 10000);
    const crossed = B.calculate(310000, '2026-10-16', '2026-11-15');
    assert.equal(crossed.amountCents, 315000);
    assert.equal(crossed.segments.length, 2);
});
test('não aceita data inexistente, período invertido, mensalidade inválida nem período acima de 366 dias', () => {
    for (const [start, end] of [['2026-02-30', '2026-03-10'], ['2026-10-10', '2026-10-01'], ['2024-01-01', '2026-12-31']]) assert.throws(() => B.calculate(10000, start, end));
    for (const amount of [0, -1, 1.5, NaN, null]) assert.throws(() => B.calculate(amount, input.start, input.end));
});
test('projeto valida campos, status, datas, duplicidade por nome/código e edição do próprio registro', () => {
    const valid = { ...projects[0], equipmentIds: ['AAA1B23', 'AAA1B23'] };
    assert.equal(B.project(valid, projects, projects[0]).equipmentIds.length, 1);
    assert.throws(() => B.project(valid, projects), /existe/);
    assert.throws(() => B.project({ ...valid, name: 'Novo' }, projects), /existe/);
    for (const change of [{ client: '' }, { name: '' }, { status: 'Inválido' }, { end: '2023-01-01' }]) assert.throws(() => B.project({ ...valid, ...change }, [], null));
});
test('não duplica cadastro de máquinas e preserva o preço da medição, sem depender do preço futuro', () => {
    const before = JSON.stringify({ projects, equipment });
    const saved = { id: 'm1', ...B.measurement(input, projects, equipment) };
    const newer = B.measurement({ ...input, start: '2026-11-01', end: '2026-11-30', month: '2026-11', monthlyCents: 4000000 }, projects, equipment, [saved]);
    assert.equal(saved.monthlyCents, 3500000); assert.equal(newer.amountCents, 4000000);
    assert.equal(JSON.stringify({ projects, equipment }), before);
    assert.throws(() => B.measurement({ ...input, equipmentId: 'NOVA' }, projects, equipment), /existentes/);
    assert.throws(() => B.measurement({ ...input, projectId: 'NOVA' }, projects, equipment), /existentes/);
});
test('bloqueia sobreposição inclusiva e permite somente exceção explícita com justificativa', () => {
    const saved = { id: 'm1', ...B.measurement(input, projects, equipment) };
    assert.throws(() => B.measurement(input, projects, equipment, [saved]), /sobreposta/);
    assert.throws(() => B.measurement({ ...input, allowOverlap: true, overlapReason: 'curta' }, projects, equipment, [saved]), /sobreposta/);
    const allowed = B.measurement({ ...input, allowOverlap: true, overlapReason: 'Exceção autorizada pela gestão.' }, projects, equipment, [saved]);
    assert.deepEqual(allowed.overlapIds, ['m1']);
    assert.equal(B.measurement(input, projects, equipment, [saved], saved).amountCents, 3500000);
    assert.equal(B.measurement({ ...input, projectId: 'p2' }, projects, equipment, [saved]).amountCents, 3500000);
    assert.equal(B.measurement(input, projects, equipment, [{ ...saved, deleted: true }]).amountCents, 3500000);
});
test('competência pertence ao período e a medição respeita a vigência do projeto', () => {
    assert.throws(() => B.measurement({ ...input, month: '2026-11' }, projects, equipment), /competência/);
    assert.throws(() => B.measurement(input, [{ ...projects[0], start: '2026-10-02' }], equipment), /dentro/);
    assert.throws(() => B.measurement(input, [{ ...projects[0], status: 'Pausado' }], equipment), /ativo/);
});
test('ajuste manual preserva valor calculado e exige motivo, inclusive faturamento zero', () => {
    assert.throws(() => B.measurement({ ...input, manualAdjustment: true, amountCents: 10 }, projects, equipment), /justificativa/);
    const row = B.measurement({ ...input, manualAdjustment: true, amountCents: 0, adjustmentReason: 'Serviço sem cobrança autorizado.' }, projects, equipment);
    assert.equal(row.amountCents, 0); assert.equal(row.calculatedCents, 3500000);
});
test('painel apura uma vez por competência, filtra ano/mês/projeto/máquina e exclui registros cancelados', () => {
    const a = { id: 'm1', ...B.measurement(input, projects, equipment) };
    const b = { ...a, id: 'm2', projectId: 'p2', month: '2026-11', amountCents: 10000 };
    const c = { ...a, id: 'm3', month: '2025-10', amountCents: 20000 };
    const d = { ...a, id: 'm4', deleted: true };
    const summary = B.summarize([a, b, c, d], projects, { year: '2026', month: '10' });
    assert.equal(summary.totalCents, 3500000); assert.equal(summary.annualCents, 3510000); assert.equal(summary.machines, 1); assert.equal(summary.monthly.length, 12);
    assert.equal(summary.byProject[0].amountCents, 3500000);
    assert.equal(B.summarize([a, b, c, d], projects, { year: '2026', month: 'all', projectId: 'p2' }).totalCents, 10000);
    assert.equal(B.summarize([a], projects, { year: '2026', equipmentId: 'outro' }).totalCents, 0);
    assert.equal(B.summarize([], projects).annualCents, 0);
});
