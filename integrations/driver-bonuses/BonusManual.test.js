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
function attachmentContext() {
  const ctx = context(), uploads = [];
  ctx.Utilities = { base64Decode: text => Buffer.from(text, 'base64') };
  ctx.bonusDriver_ = name => ({ name, id: 'TESTE' });
  ctx.bonusDestination_ = (driver, month, category, destination) => ({ driver, month, category, destination });
  ctx.bonusUpload_ = (folder, file, excel) => {
    uploads.push({ folder, file, excel });
    return { id: 'synthetic-photo-' + uploads.length, name: file.name, url: 'https://example.invalid/private-photo', mimeType: file.mimeType };
  };
  return { ctx, uploads };
}
const photo = () => ({ name: 'foto-teste.png', mimeType: 'image/png', base64: Buffer.from('synthetic-photo-bytes').toString('base64') });
function manualChecklist(input, rows = [{ date: '2026-10-01', plate: 'ABC1D23' }]) {
  input.checklist = { source: 'Manual', reviewed: true, justification: 'Conferência manual do período', rows };
}
test('checklist manual funciona em qualquer competência e não consulta Epicollect5', () => {
  const ctx = context(), { input, data } = sample(); manualChecklist(input);
  ctx.bonusChecklists_ = () => { throw Error('Não deve consultar o aplicativo no modo Manual'); };
  const { evidence, result } = evaluate(ctx, input, data);
  assert.equal(evidence.checklistSelection.source, 'Manual'); assert.equal(evidence.checklistSelection.actor, 'frota@agromig.com.br');
  assert.equal(result.results[0].cents, 16000); assert.equal(result.provisionalCents, 70000); assert.equal(result.requiresHumanReview, true);
  assert.match(result.results[0].reason, /Fonte: Manual/);
  input.month = '2027-02'; input.workedDates = '2027-02-03'; input.checklist.rows[0].date = '2027-02-03';
  assert.equal(ctx.bonusChecklistEvidence_(input, 'TESTE', input.month).records[0].date, '2027-02-03');
});
test('selecionar Manual não concede checklist integral: dias distintos contam proporcionalmente', () => {
  const ctx = context(), { input, data } = sample(); manualChecklist(input);
  input.workedDates = '2026-10-01,2026-10-02'; data.assignments[0].to = '2026-10-02';
  assert.equal(evaluate(ctx, input, data).result.results[0].cents, 8000);
  input.checklist.rows.push({ date: '2026-10-02', plate: 'ABC1D23' });
  assert.equal(evaluate(ctx, input, data).result.results[0].cents, 16000);
  input.checklist.rows = []; assert.equal(evaluate(ctx, input, data).result.results[0].cents, 0);
  data.assignments = []; input.checklist.rows = [{ date: '2026-10-01', plate: 'ABC1D23' }];
  const result = evaluate(ctx, input, data).result;
  assert.equal(result.results[0].cents, 0); assert.ok(result.pending.some(p => /responsabilidade/.test(p)));
});
test('modo automático ignora dados manuais postados; consulta incompleta continua pendente', () => {
  const ctx = context(), { input, data } = sample(); manualChecklist(input); input.checklist.source = 'Epicollect5';
  ctx.bonusChecklists_ = () => ({ records: [], complete: false });
  const { evidence, result } = evaluate(ctx, input, data);
  assert.equal(evidence.checklistSelection.source, 'Epicollect5'); assert.equal(evidence.checklists.length, 0);
  assert.equal(result.results[0].cents, 0); assert.ok(result.pending.includes('Consulta de checklist incompleta.'));
});
test('checklist manual valida conferência, justificativa, data, placa e duplicidade', () => {
  for (const mutate of [
    input => { input.checklist.source = 'Outro'; },
    input => { input.checklist.reviewed = false; },
    input => { input.checklist.justification = ' '; },
    input => { input.checklist.rows[0].date = '2026-10-02'; },
    input => { input.checklist.rows[0].plate = 'XYZ9A99'; },
    input => { input.checklist.rows.push({ date: '2026-10-01', plate: 'ABC-1D23' }); }
  ]) {
    const ctx = context(), { input, data } = sample(); manualChecklist(input); mutate(input);
    assert.throws(() => evaluate(ctx, input, data));
  }
});
test('foto do checklist manual preserva origem e aparece no índice de evidências', () => {
  const { ctx, uploads } = attachmentContext(), { input, data } = sample(); manualChecklist(input);
  input.checklist.rows[0].file = photo();
  const evidence = evaluate(ctx, input, data).evidence;
  assert.equal(uploads[0].folder.category, 'KPIs - Checklist');
  assert.equal(evidence.checklistSelection.categories.Checklist.rows[0].evidence.id, 'synthetic-photo-1');
  assert.deepEqual(clone(evidence.evidenceIds), ['synthetic-photo-1']);
  assert.doesNotMatch(JSON.stringify(evidence.checklistSelection), /base64/);
});
test('reavaliação grava a fonte escolhida sem alterar registros aprovados', () => {
  const ctx = context(), { input, data } = sample(); manualChecklist(input);
  data.records = [{ id: 'synthetic-kpi', category: 'KPIs', driver: 'TESTE', month: '2026-10', status: 'Em análise', rules: clone(vm.runInContext('BONUS_DEFAULT_RULES', ctx)), details: {} }];
  ctx.bonusMutate_ = (_, fn) => fn(data, 'frota@agromig.com.br');
  ctx.reevaluateBonus('synthetic-kpi', input); assert.equal(data.records[0].details.checklistSelection.source, 'Manual');
  assert.equal(data.records[0].details.checklistSnapshot[0].source, 'Manual');
  input.checklist.source = 'Epicollect5'; ctx.reevaluateBonus('synthetic-kpi', input);
  assert.equal(data.records[0].details.checklistSelection.source, 'Epicollect5');
  data.records[0].status = 'Aprovado'; assert.throws(() => ctx.reevaluateBonus('synthetic-kpi', input), /Reabra/);
});
test('anexa foto à ocorrência e ao índice de evidências sem guardar base64 na base', () => {
  const { ctx, uploads } = attachmentContext(), { input, data } = sample();
  input.manualAssessment.categories.Lavagem.rows[0].file = photo();
  const { evidence, result } = evaluate(ctx, input, data), row = evidence.washes[0];
  assert.equal(uploads.length, 1); assert.equal(uploads[0].excel, false);
  assert.deepEqual(uploads[0].folder, { driver: { name: 'TESTE', id: 'TESTE' }, month: '2026-10', category: 'KPIs - Lavagem', destination: '2026-10-01 - ABC1D23' });
  assert.equal(row.evidence.id, 'synthetic-photo-1'); assert.equal(row.evidenceId, row.evidence.id);
  assert.deepEqual(clone(evidence.evidenceIds), ['synthetic-photo-1']);
  assert.doesNotMatch(JSON.stringify(evidence.manualAssessment), /base64/); assert.equal(result.provisionalCents, 70000);
});
test('recalcular sem foto nova preserva somente anexo do registro anterior confiável', () => {
  const { ctx, uploads } = attachmentContext(), { input } = sample();
  input.manualAssessment.categories.Lavagem.rows[0].file = photo();
  const original = ctx.bonusManualAssessment_(input, 'TESTE', '2026-10', {}, 'frota@agromig.com.br');
  delete input.manualAssessment.categories.Lavagem.rows[0].file;
  input.manualAssessment.categories.Lavagem.rows[0].keepEvidence = true;
  input.manualAssessment.categories.Lavagem.rows[0].evidence = { id: 'forged-file', url: 'https://example.invalid/forged' };
  let next = ctx.bonusManualAssessment_(input, 'TESTE', '2026-10', {}, 'frota@agromig.com.br', original);
  assert.equal(next.categories.Lavagem.rows[0].evidence.id, 'synthetic-photo-1'); assert.equal(uploads.length, 1);
  assert.throws(() => ctx.bonusManualAssessment_(input, 'TESTE', '2026-10', {}, 'frota@agromig.com.br'), /Evidência anterior não encontrada/);
  input.manualAssessment.categories.Lavagem.rows[0].file = photo();
  next = ctx.bonusManualAssessment_(input, 'TESTE', '2026-10', {}, 'frota@agromig.com.br', original);
  assert.equal(next.categories.Lavagem.rows[0].evidence.id, 'synthetic-photo-2');
  assert.equal(original.categories.Lavagem.rows[0].evidence.id, 'synthetic-photo-1');
});
test('anexo não pode ser reaproveitado em outra data/placa nem enviado antes de validar dados', () => {
  const { ctx, uploads } = attachmentContext(), { input } = sample();
  const previous = { categories: { Lavagem: { rows: [{ date: '2026-10-02', plate: 'ABC1D23', evidence: { id: 'old-other-date' } }] } } };
  input.manualAssessment.categories.Lavagem.rows[0].keepEvidence = true;
  assert.throws(() => ctx.bonusManualAssessment_(input, 'TESTE', '2026-10', {}, 'frota@agromig.com.br', previous), /Evidência anterior/);
  input.manualAssessment.categories.Lavagem.rows[0].file = photo(); delete input.manualAssessment.categories.Multas;
  assert.throws(() => ctx.bonusManualAssessment_(input, 'TESTE', '2026-10', {}, 'frota@agromig.com.br'));
  assert.equal(uploads.length, 0);
});
test('tipos inválidos e limite total bloqueiam uploads; campos de fotos estão no formulário', () => {
  const { ctx, uploads } = attachmentContext(), { input } = sample();
  input.manualAssessment.categories.Lavagem.rows[0].file = { ...photo(), mimeType: 'text/html' };
  assert.throws(() => ctx.bonusManualAssessment_(input, 'TESTE', '2026-10', {}, 'frota@agromig.com.br'), /Envie foto/);
  input.manualAssessment.categories.Lavagem.rows[0].file = photo(); yes(input, 'Multas', { file: photo() });
  ctx.Utilities.base64Decode = () => ({ length: 5 * 1024 * 1024 });
  assert.throws(() => ctx.bonusManualAssessment_(input, 'TESTE', '2026-10', {}, 'frota@agromig.com.br'), /total de novos anexos/);
  assert.equal(uploads.length, 0);
  const html = fs.readFileSync(new URL('DriverBonusForm.html', root), 'utf8');
  assert.match(html, /Foto \/ documento de evidência/); assert.match(html, /manualEvidenceLinks\(r\)/);
  assert.match(html, /file:await fileData/);
  assert.doesNotMatch(fs.readFileSync(new URL('BonusImports.gs', root), 'utf8'), /\|\|=|&&=|\?\?=/, 'Apps Script não suporta atribuição lógica neste projeto');
});
