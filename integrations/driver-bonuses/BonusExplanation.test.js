import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('DriverBonusForm.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1].split("$('driver').onchange=")[0];
const ctx = vm.createContext({ document: {} }); vm.runInContext(script, ctx);
const sample = (extra = {}) => ({ category: 'KPIs', status: 'Rascunho', month: '2026-09', details: { checklistSelection: { source: 'Epicollect5' } }, calculation: {
  cents: 42000, maximumCents: 70000, pending: ['Histórico de responsabilidade não cobre todos os dias trabalhados.'],
  results: [
    { criterion: 'Checklist', maximumCents: 16000, cents: 0, reason: '0 de 2 dias trabalhados com checklist válido.', missingDates: ['2026-09-01', '2026-09-02'] },
    { criterion: 'Circulação', maximumCents: 12000, cents: 12000, reason: 'Sem irregularidade atribuída.' },
    { criterion: 'Velocidade', maximumCents: 20000, cents: 20000, reason: 'Sem excesso atribuído.' },
    { criterion: 'Lavagem', maximumCents: 12000, cents: 0, reason: 'Lavagens exigidas sem comprovação.', missingDates: ['2026-09-02'] },
    { criterion: 'Multas', maximumCents: 10000, cents: 10000, reason: 'Sem multa atribuída.' }
  ], ...extra
} });

test('explica 420 de 700 com diferenças por KPI sem alterar a avaliação', () => {
  const record = sample(), before = JSON.stringify(record), model = ctx.kpiExplanationModel(record);
  assert.equal(model.total, 42000); assert.equal(model.maximum, 70000); assert.equal(model.difference, 28000);
  assert.equal(model.rows[0].difference, 16000); assert.equal(model.rows[3].difference, 12000);
  assert.equal(model.rows.reduce((sum, row) => sum + row.considered, 0), model.total);
  assert.match(model.rows[0].actions.join(' '), /não prova que ele não realizou/);
  assert.match(model.rows[0].actions.join(' '), /Utilização/);
  assert.match(model.rows[3].actions.join(' '), /Datas diferentes/);
  assert.match(model.pending[0].action, /períodos comprovados/);
  assert.equal(JSON.stringify(record), before);
});
test('checklist parcial conserva proporcionalidade e datas salvas, não força 700', () => {
  const record = sample(); record.calculation.cents = 50000; record.calculation.results[0].cents = 8000;
  const model = ctx.kpiExplanationModel(record);
  assert.equal(model.rows[0].difference, 8000); assert.equal(model.difference, 20000);
  const markup = ctx.kpiExplanationMarkup(record);
  assert.match(markup, /01\/09\/2026, 02\/09\/2026/);
  assert.match(markup, /Recalcular avaliação não aprovada/);
});
test('eliminação integral zera o considerado de todos os itens e mostra ocorrência', () => {
  const record = sample({ cents: 0, eliminationSuggested: true, occurrences: [{ criterion: 'Circulação', date: '2026-09-01', plate: 'ABC1D23', reason: 'Fora do horário.' }] });
  const model = ctx.kpiExplanationModel(record), markup = ctx.kpiExplanationMarkup(record);
  assert.equal(model.difference, 70000); assert.equal(model.rows.reduce((sum, row) => sum + row.considered, 0), 0);
  assert.match(markup, /Eliminação integral indicada/); assert.match(markup, /ABC1D23/);
  assert.match(markup, /sujeita à conferência e decisão humana/);
});
test('máximo vem da avaliação histórica e ausência de valores não vira zero', () => {
  const record = sample({ maximumCents: 80000 }); assert.equal(ctx.kpiExplanationModel(record).maximum, 80000);
  const old = { category: 'KPIs', status: 'Rascunho', calculation: { cents: 42000 } };
  assert.equal(ctx.kpiExplanationModel(old).maximum, null); assert.equal(ctx.kpiExplanationModel(old).difference, null);
  assert.match(ctx.kpiExplanationMarkup(old), /Não há dados suficientes/);
  assert.equal(ctx.kpiExplanationModel({ category: 'Viagem' }), null);
});
test('informações pendentes e integrais não são apresentadas como aprovação automática', () => {
  const record = sample({ pending: ['Consulta de checklist incompleta.', 'Circulação: cobertura não comprovada.', 'Velocidade: cobertura pendente.', 'Defina as datas de lavagem exigidas entre os dias trabalhados.', 'Lavagem: comprovação do período não conferida.', 'Multas: cobertura pendente.'] });
  const model = ctx.kpiExplanationModel(record), markup = ctx.kpiExplanationMarkup(record);
  assert.equal(model.pending.length, 6); assert.match(markup, /bloquear a aprovação mesmo quando um item aparece com valor integral/);
  assert.match(model.pending[0].action, /Epicollect5/); assert.match(model.pending[5].action, /contestação/);
  assert.doesNotMatch(markup, /data-transition=/);
});
test('manual, registro aprovado e conteúdo externo preservam conferência e segurança', () => {
  const record = sample(); record.details.checklistSelection.source = 'Manual'; record.status = 'Pago';
  record.calculation.results[0].reason = '<img src=x onerror=alert(1)>';
  const markup = ctx.kpiExplanationMarkup(record);
  assert.match(markup, /KPIs → Manual/); assert.match(markup, /reabertura da análise/);
  assert.doesNotMatch(markup, /<img src=x/); assert.match(markup, /&lt;img/);
  assert.match(markup, /data-kpi-help-page="Utilização"/);
});
