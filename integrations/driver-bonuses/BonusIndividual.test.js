import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const copy = value => JSON.parse(JSON.stringify(value));
function setup() {
  const ctx = vm.createContext({ Utilities: { getUuid: () => 'synthetic-rule' } });
  for (const file of ['BonusRules.gs', 'DriverBonuses.gs', 'BonusImports.gs', 'BonusReports.gs']) vm.runInContext(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), ctx);
  const rules = copy(vm.runInContext('BONUS_DEFAULT_RULES', ctx));
  return { ctx, rules };
}
const individual = [{ id: 'synthetic-rule', driverId: 'DRIVERTEST', from: '2026-09', maximumCents: 80000 }];
function calculation(ctx, rules, complete = true) {
  return ctx.bonusEvaluate_({ month: '2026-09', driver: 'DRIVERTEST', plates: 'ABC1D23', workedDates: '2026-09-01', washDates: '2026-09-01' }, {
    assignments: [{ driver: 'DRIVERTEST', plate: 'ABC1D23', from: '2026-09-01', to: '2026-09-01' }],
    checklists: complete ? [{ driver: 'DRIVERTEST', plate: 'ABC1D23', date: '2026-09-01', valid: true }] : [],
    washes: complete ? [{ plate: 'ABC1D23', date: '2026-09-01', evidenceId: 'synthetic-evidence' }] : [],
    checklistComplete: true, circulationComplete: true, speedComplete: true, washComplete: true, finesComplete: true
  }, rules);
}
test('teto individual começa na vigência e não altera os demais motoristas ou categorias', () => {
  const { ctx, rules } = setup(), before = copy(rules);
  assert.deepEqual(copy(ctx.bonusDriverKpiRules_(rules, individual, 'OTHER', '2026-09')), before);
  assert.deepEqual(copy(ctx.bonusDriverKpiRules_(rules, individual, 'DRIVERTEST', '2026-08')), before);
  const adjusted = ctx.bonusDriverKpiRules_(rules, individual, 'DRIVERTEST', '2026-09');
  assert.equal(adjusted.kmCents, rules.kmCents); assert.equal(adjusted.trustCents, rules.trustCents);
  assert.equal(calculation(ctx, adjusted).maximumCents, 80000); assert.deepEqual(rules, before);
});
test('cinco máximos somam exatamente 800 e repetição não multiplica o teto novamente', () => {
  const { ctx, rules } = setup(), adjusted = ctx.bonusDriverKpiRules_(rules, individual, 'DRIVERTEST', '2026-10');
  assert.equal(adjusted.checklistCents, 18286); assert.equal(adjusted.circulationCents, 13714);
  assert.equal(adjusted.speedCents, 22857); assert.equal(adjusted.washCents, 13714); assert.equal(adjusted.finesCents, 11429);
  assert.deepEqual(copy(ctx.bonusDriverKpiRules_(adjusted, individual, 'DRIVERTEST', '2026-10')), copy(adjusted));
});
test('todos os critérios chegam a 800, critérios não cumpridos reduzem e eliminação permanece', () => {
  const { ctx, rules } = setup(), adjusted = ctx.bonusDriverKpiRules_(rules, individual, 'DRIVERTEST', '2026-09');
  assert.equal(calculation(ctx, adjusted).provisionalCents, 80000);
  assert.equal(calculation(ctx, adjusted, false).provisionalCents, 48000);
  const saved = calculation(ctx, rules, false); saved.cents = saved.provisionalCents;
  assert.equal(ctx.bonusRepriceKpi_(saved, adjusted).cents, 48000);
  saved.eliminationSuggested = true; saved.pending.push('Pendência sintética');
  const repriced = ctx.bonusRepriceKpi_(saved, adjusted);
  assert.equal(repriced.cents, 0); assert.ok(repriced.pending.includes('Pendência sintética'));
});
test('checklist parcial usa dias reconhecidos, preserva motivos, datas e responsabilidade', () => {
  const { ctx, rules } = setup(), adjusted = ctx.bonusDriverKpiRules_(rules, individual, 'DRIVERTEST', '2026-09');
  const saved = calculation(ctx, rules); saved.days = ['2026-09-01', '2026-09-02', '2026-09-03']; saved.checklistDays = ['2026-09-01'];
  saved.results[0].missingDates = ['2026-09-02', '2026-09-03']; saved.pending.push('Histórico de responsabilidade incompleto.');
  const repriced = ctx.bonusRepriceKpi_(saved, adjusted);
  assert.equal(repriced.results[0].cents, Math.round(18286 / 3));
  assert.deepEqual(copy(repriced.results[0].missingDates), saved.results[0].missingDates);
  assert.equal(repriced.results[0].reason, saved.results[0].reason); assert.equal(repriced.pending.length, 1);
});
test('nova vigência prevalece, sem modificar os meses anteriores', () => {
  const { ctx, rules } = setup(), versions = [...individual, { id: 'synthetic-rule-2', driverId: 'DRIVERTEST', from: '2026-11', maximumCents: 90000 }];
  assert.equal(calculation(ctx, ctx.bonusDriverKpiRules_(rules, versions, 'DRIVERTEST', '2026-10')).maximumCents, 80000);
  assert.equal(calculation(ctx, ctx.bonusDriverKpiRules_(rules, versions, 'DRIVERTEST', '2026-11')).maximumCents, 90000);
});
test('salvar regra atualiza somente KPIs abertos e guarda o histórico sem aprovar ou pagar', () => {
  const { ctx, rules } = setup(), original = calculation(ctx, rules, false); original.cents = original.provisionalCents;
  const record = extra => ({ id: 'synthetic-open', driverId: 'DRIVERTEST', driver: 'DRIVERTEST', category: 'KPIs', month: '2026-09', status: 'Rascunho', rules: copy(rules), calculation: copy(original), actions: [], ...extra });
  let data = { records: [record({}), record({ id: 'approved', status: 'Aprovado', approved: { cents: 42000 } }), record({ id: 'paid', status: 'Pago' }), record({ id: 'rejected', status: 'Rejeitado' }), record({ id: 'other', driverId: 'OTHER' }), record({ id: 'prior', month: '2026-08' }), record({ id: 'trip', category: 'Viagem' })] };
  const unchanged = copy(data.records.slice(1));
  ctx.bonusDriver_ = () => ({ id: 'DRIVERTEST', name: 'DRIVERTEST' });
  ctx.bonusMutate_ = (_, fn) => { const next = copy(data), result = fn(next, 'AUTHORIZED'); data = next; return result; };
  const result = ctx.saveDriverKpiRule({ driver: 'DRIVERTEST', from: '2026-09', maximum: '800,00', justification: 'Regra autorizada de teste' });
  assert.deepEqual(copy(result.updated), ['synthetic-open']); assert.equal(data.records[0].calculation.cents, 48000);
  assert.equal(data.records[0].status, 'Rascunho'); assert.equal(data.records[0].approved, undefined);
  assert.equal(data.records[0].actions[0].previous.calculation.cents, 42000);
  assert.deepEqual(data.records.slice(1), unchanged);
  assert.throws(() => ctx.saveDriverKpiRule({ driver: 'DRIVERTEST', from: '2026-09', maximum: '800', justification: 'Duplicado' }), /já está configurado/);
});
test('recusa valor inválido, centavos excedentes, datas inválidas e cálculo inconsistente', () => {
  const { ctx, rules } = setup(); ctx.bonusDriver_ = () => ({ id: 'DRIVERTEST', name: 'DRIVERTEST' }); ctx.bonusMutate_ = (_, fn) => fn({ records: [] }, 'AUTHORIZED');
  for (const maximum of ['abc', '0', '-800', '800,001']) assert.throws(() => ctx.saveDriverKpiRule({ driver: 'DRIVERTEST', from: '2026-09', maximum, justification: 'Teste' }));
  assert.throws(() => ctx.saveDriverKpiRule({ driver: 'DRIVERTEST', from: '2026-13', maximum: '800', justification: 'Teste' }));
  assert.throws(() => ctx.bonusRepriceKpi_({ results: [] }, rules), /incompleto/);
});
