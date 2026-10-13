import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('BonusReports.gs', import.meta.url), 'utf8');
const ctx = vm.createContext({}); vm.runInContext(source, ctx);
test('justificativa de viagem e cargo mostra somente texto informado, sem metadados', () => {
  const row = { category: 'Viagem', justification: 'Serviço autorizado.', notes: 'Conferido pelo gestor.', details: { request: 'synthetic', initialKm: 100, authorization: 'secret-id' } };
  const before = JSON.stringify(row), text = ctx.bonusReportJustification_(row, {});
  assert.equal(text, 'Serviço autorizado.\nObservações: Conferido pelo gestor.');
  assert.doesNotMatch(text, /request|initialKm|secret-id|[{}]/); assert.equal(JSON.stringify(row), before);
});
test('total de KPIs preserva motivos humanos e deixa evidências técnicas fora da coluna', () => {
  const row = { category: 'KPIs', justification: 'Avaliação conferida.', details: { checklistSelection: { source: 'Manual', justification: 'Aplicativo implantado após início do mês.', actor: 'synthetic', categories: { Checklist: { rows: [{ evidence: { id: 'file-secret' } }] } } }, manualAssessment: { reviewed: true, actor: 'synthetic' } } };
  const text = ctx.bonusReportJustification_(row, { pending: ['Confira responsabilidade.'], occurrences: [{ criterion: 'Multas', date: '2026-09-21', plate: 'ABC1D23', reason: 'Ocorrência em análise.', internalId: 'hidden' }], eliminationSuggested: true });
  assert.match(text, /Avaliação conferida/); assert.match(text, /Checklist manual: Aplicativo implantado/);
  assert.match(text, /Pendências: Confira responsabilidade/); assert.match(text, /21\/09\/2026/);
  assert.match(text, /Eliminação dos KPIs indicada/); assert.doesNotMatch(text, /manualAssessment|categories|reviewed|file-secret|internalId|[{}]/);
});
test('motivos por critério formatam datas e distinguem provisório de aprovado', () => {
  const item = { reason: '1 de 2 dias com checklist válido.', missingDates: ['2026-09-21'] };
  assert.equal(ctx.bonusReportCriterionText_(item, true), 'Aprovado. 1 de 2 dias com checklist válido.\nDatas sem comprovação válida: 21/09/2026.');
  assert.match(ctx.bonusReportCriterionText_(item, false), /^Provisório - não aprovado/);
  assert.equal(ctx.bonusReportJustification_({ category: 'Cargo de confiança', details: {} }, {}), 'Justificativa não informada.');
});
test('demonstrativo não serializa objetos na justificativa e conserva assinatura interna', () => {
  const preparation = source.slice(source.indexOf('function prepareBonusReport'), source.indexOf('function approveBonusReport'));
  assert.doesNotMatch(preparation, /JSON\.stringify/); assert.match(preparation, /bonusReportJustification_/);
  assert.match(source, /function bonusReportFingerprint_/); assert.match(source, /JSON\.stringify\(\{ records:/);
});
