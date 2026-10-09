import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('./', import.meta.url);
const clone = value => JSON.parse(JSON.stringify(value));
function context() {
  const ctx = vm.createContext({ Session: { getActiveUser: () => ({ getEmail: () => 'frota@agromig.com.br' }) } });
  for (const file of ['BonusRules.gs', 'DriverBonuses.gs', 'BonusImports.gs', 'BonusReports.gs']) vm.runInContext(fs.readFileSync(new URL(file, root), 'utf8'), ctx);
  ctx.bonusChecklists_ = () => ({ records: [{ driver: 'TESTE', plate: 'ABC1D23', date: '2026-10-01', valid: true }], complete: true });
  return ctx;
}
function sample() {
  const categories = Object.fromEntries(['Circulação', 'Velocidade', 'Lavagem', 'Multas'].map(category => [category, { answer: 'Não', rows: [] }]));
  categories.Lavagem = { answer: 'Sim', rows: [{ date: '2026-10-01', plate: 'ABC1D23' }] };
  return {
    input: { plates: 'ABC1D23', workedDates: '2026-10-01', washDates: '2026-10-01', month: '2026-10', driver: 'TESTE', manualAssessment: { reviewed: true, categories } },
    data: { operations: [], imports: [], assignments: [{ driver: 'TESTE', plate: 'ABC1D23', from: '2026-10-01', to: '2026-10-01' }], ruleVersions: [] }
  };
}
function evaluate(ctx, input, data) {
  const rules = vm.runInContext('BONUS_DEFAULT_RULES', ctx), evidence = ctx.bonusEvidence_(data, 'TESTE', '2026-10', input, rules);
  return { evidence, result: ctx.bonusEvaluate_(input, evidence, rules) };
}
function yes(input, category, extra = {}) {
  input.manualAssessment.categories[category] = { answer: 'Sim', rows: [{ date: '2026-10-01', plate: 'ABC1D23', ...extra }] };
}
test('declarações conferidas cobrem categorias sem Excel e checklist continua vindo da consulta', () => {
  const ctx = context(), { input, data } = sample(), before = clone(data);
  const { evidence, result } = evaluate(ctx, input, data);
  assert.deepEqual(clone(result.pending), []); assert.equal(result.provisionalCents, 70000);
  assert.equal(result.requiresHumanReview, true); assert.equal(evidence.manualAssessment.actor, 'frota@agromig.com.br');
  assert.equal(evidence.washes[0].evidenceId, undefined); assert.equal(evidence.washes[0].source, 'Declaração manual do gestor');
  assert.equal(evidence.checklists[0].driver, 'TESTE'); assert.deepEqual(data, before);
});
test('circulação manual fora de horário elimina apenas KPIs provisórios; exceção válida não', () => {
  const ctx = context(), { input, data } = sample(); yes(input, 'Circulação');
  let { result } = evaluate(ctx, input, data);
  assert.equal(result.eliminationSuggested, true); assert.equal(result.provisionalCents, 0);
  assert.equal(result.requiresHumanReview, true); assert.equal(result.occurrences[0].review.actor, 'frota@agromig.com.br');
  input.manualAssessment.categories.Circulação.rows[0].authorized = true;
  result = evaluate(ctx, input, data).result; assert.equal(result.eliminationSuggested, false); assert.equal(result.provisionalCents, 70000);
});
test('datas de excesso e multa reduzem seus critérios; contestação ou responsabilidade ausente impedem aprovação', () => {
  const ctx = context(), { input, data } = sample(); yes(input, 'Velocidade'); yes(input, 'Multas');
  let { result } = evaluate(ctx, input, data);
  assert.equal(result.provisionalCents, 40000); assert.equal(result.eliminationSuggested, false);
  input.manualAssessment.categories.Multas.rows[0].contested = true;
  result = evaluate(ctx, input, data).result; assert.ok(result.pending.some(reason => reason.startsWith('Multas:')));
  data.assignments = []; result = evaluate(ctx, input, data).result;
  assert.ok(result.pending.some(reason => /Histórico de responsabilidade/.test(reason))); assert.equal(result.eliminationSuggested, false);
});
test('lavagem Não é diferente de ausência de informação; datas exigidas não cumpridas reduzem lavagem', () => {
  const ctx = context(), { input, data } = sample(); input.manualAssessment.categories.Lavagem = { answer: 'Não', rows: [] };
  const { result } = evaluate(ctx, input, data);
  assert.equal(result.results[3].cents, 0); assert.equal(result.provisionalCents, 58000); assert.deepEqual(clone(result.pending), []);
});
test('recusa declaração sem conferência, respostas ausentes, datas inválidas e placas erradas', () => {
  for (const mutate of [
    input => { input.manualAssessment.reviewed = false; },
    input => { delete input.manualAssessment.categories.Multas; },
    input => { yes(input, 'Circulação'); input.manualAssessment.categories.Circulação.rows = []; },
    input => { yes(input, 'Circulação', { date: '2026-09-30' }); },
    input => { yes(input, 'Circulação', { date: '2026-10-02' }); },
    input => { yes(input, 'Velocidade', { plate: 'XYZ9A99' }); },
    input => { input.manualAssessment.categories.Lavagem.rows.push({ date: '2026-10-01', plate: 'ABC-1D23' }); },
    input => { input.manualAssessment.categories.Lavagem.answer = 'Não'; }
  ]) {
    const ctx = context(), { input, data } = sample(); mutate(input);
    assert.throws(() => evaluate(ctx, input, data));
  }
});
test('Não contraditório não apaga evidência antiga nem libera aprovação', () => {
  const ctx = context(), { input, data } = sample();
  data.operations.push({ category: 'Circulação', driver: 'TESTE', plate: 'ABC1D23', date: '2026-10-01', time: '23:00', confirmed: true, evidenceId: 'synthetic-original' });
  const before = clone(data), { evidence, result } = evaluate(ctx, input, data);
  assert.equal(evidence.circulation.length, 1); assert.equal(result.eliminationSuggested, true);
  assert.ok(result.pending.some(reason => /diverge de ocorrência/.test(reason))); assert.deepEqual(data, before);
});
test('reavaliação mantém regras congeladas, atualiza declaração e bloqueia registros aprovados', () => {
  const ctx = context(), { input, data } = sample();
  const rules = clone(vm.runInContext('BONUS_DEFAULT_RULES', ctx)); rules.speedCents = 15000;
  data.records = [{ id: 'synthetic-kpi', category: 'KPIs', driver: 'TESTE', month: '2026-10', status: 'Em análise', rules, details: {} }];
  ctx.bonusMutate_ = (_, fn) => fn(data, 'frota@agromig.com.br');
  yes(input, 'Velocidade'); ctx.reevaluateBonus('synthetic-kpi', input);
  assert.equal(data.records[0].calculation.results[2].maximumCents, 15000);
  assert.equal(data.records[0].details.manualAssessment.categories.Velocidade.answer, 'Sim');
  assert.equal(data.operations.length, 0);
  data.records[0].status = 'Aprovado'; assert.throws(() => ctx.reevaluateBonus('synthetic-kpi', input), /Reabra/);
});
test('checklist é consultado diretamente no Epicollect5 e não aceita resultado manual do formulário', () => {
  const ctx = vm.createContext({ Utilities: { formatDate: date => date.toISOString().slice(0, 10) } });
  for (const file of ['BonusRules.gs', 'BonusImports.gs']) vm.runInContext(fs.readFileSync(new URL(file, root), 'utf8'), ctx);
  const urls = []; ctx.UrlFetchApp = { fetch: url => { urls.push(url); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ data: { entries: [{ created_at: '2026-10-01T12:00:00Z', ec5_uuid: 'synthetic-checklist', t1_MOTORISTA: 'TESTE', t2_PLACA: 'ABC1D23' }] } }) }; } };
  const result = ctx.bonusChecklists_('2026-10');
  assert.equal(result.complete, true); assert.equal(result.records[0].driver, 'TESTE'); assert.equal(result.records[0].plate, 'ABC1D23');
  assert.match(urls[0], /^https:\/\/five\.epicollect\.net\/api\/export\/entries\/checklist-de-veiculos-e-maquinas\?/);
  const html = fs.readFileSync(new URL('DriverBonusForm.html', root), 'utf8');
  assert.doesNotMatch(html, /renderImports|showMapping|data-page="Importação"/);
  assert.match(html, /Epicollect5/);
});
