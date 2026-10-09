import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('./', import.meta.url);
const copy = value => JSON.parse(JSON.stringify(value));
function setup(record) {
  const data = { records: [record] }, writes = [];
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('DriverBonuses.gs', root), 'utf8'), ctx);
  ctx.bonusMutate_ = (action, fn) => {
    const next = copy(data), result = fn(next, 'frota@agromig.com.br');
    data.records = next.records; writes.push(action); return result;
  };
  return { ctx, data, writes };
}
function sample(extra = {}) {
  return { id: 'synthetic-id', driver: 'MOTORISTA TESTE', month: '2026-10',
    category: 'Viagem', status: 'Rascunho', calculation: { cents: 9000 },
    evidence: { id: 'synthetic-document' }, actions: [], ...extra };
}
test('etapas válidas conduzem rascunho até aprovação com histórico e valor congelado', () => {
  const { ctx, data, writes } = setup(sample());
  assert.deepEqual(copy(ctx.bonusNextStatuses_('Rascunho')), ['Aguardando documentos', 'Em análise']);
  for (const [from, to] of [['Rascunho', 'Em análise'], ['Em análise', 'Aguardando aprovação'], ['Aguardando aprovação', 'Aprovado']]) {
    ctx.transitionDriverBonus('synthetic-id', to, 'Conferência sintética', to === 'Aprovado', from);
  }
  assert.equal(data.records[0].status, 'Aprovado');
  assert.equal(data.records[0].approved.cents, 9000);
  assert.equal(data.records[0].actions.length, 3); assert.equal(writes.length, 3);
  assert.deepEqual(data.records[0].actions.map(row => row.to), ['Em análise', 'Aguardando aprovação', 'Aprovado']);
});
test('aprovação direta inválida informa etapa atual e opções, sem gravar', () => {
  const { ctx, data, writes } = setup(sample());
  assert.throws(() => ctx.transitionDriverBonus('synthetic-id', 'Aprovado', 'Teste', true, 'Rascunho'), /Rascunho.*próximas etapas.*Em análise/);
  assert.equal(data.records[0].status, 'Rascunho'); assert.equal(writes.length, 0);
});
test('documento ausente, KPIs pendentes e conferência ausente continuam bloqueando aprovação', () => {
  const cases = [
    { extra: { evidence: null }, reviewed: true, error: /documento original/ },
    { extra: { category: 'KPIs', calculation: { cents: 70000, pending: ['Velocidade sem cobertura'] } }, reviewed: true, error: /Velocidade sem cobertura/ },
    { extra: {}, reviewed: false, error: /confirmação de conferência/ },
    { extra: {}, reviewed: 'true', error: /confirmação de conferência/ }
  ];
  for (const { extra, reviewed, error } of cases) {
    const { ctx, writes, data } = setup(sample({ status: 'Aguardando aprovação', ...extra }));
    assert.throws(() => ctx.transitionDriverBonus('synthetic-id', 'Aprovado', 'Teste', reviewed, 'Aguardando aprovação'), error);
    assert.equal(data.records[0].status, 'Aguardando aprovação'); assert.equal(writes.length, 0);
  }
});
test('anexar comprovante e resolver pendências permite aprovação; justificativa vazia não', () => {
  const { ctx, writes } = setup(sample({ status: 'Aguardando aprovação', calculation: { cents: 9000, pending: [] } }));
  assert.throws(() => ctx.transitionDriverBonus('synthetic-id', 'Aprovado', '  ', true), /justificativa/);
  assert.equal(writes.length, 0);
  assert.equal(ctx.transitionDriverBonus('synthetic-id', 'Aprovado', 'Conferido', true).status, 'Aprovado');
});
test('tela desatualizada não sobrescreve decisão concorrente, reabertura preserva histórico', () => {
  const { ctx, data, writes } = setup(sample({ status: 'Aguardando aprovação' }));
  assert.throws(() => ctx.transitionDriverBonus('synthetic-id', 'Aprovado', 'Teste', true, 'Em análise'), /mudou em outra tela/);
  assert.equal(writes.length, 0);
  ctx.transitionDriverBonus('synthetic-id', 'Aprovado', 'Conferido', true, 'Aguardando aprovação');
  ctx.transitionDriverBonus('synthetic-id', 'Em análise', 'Reabrir', false, 'Aprovado');
  assert.equal(data.records[0].approved, undefined); assert.equal(data.records[0].actions.length, 2);
});
test('interface usa seleção de etapas do servidor e checkbox em vez de diálogos de texto', async () => {
  const elements = {};
  const field = value => ({ value, checked: false, focus() {} });
  elements.statusForm = { elements: { status: field(''), justification: field(''), reviewed: field('') } };
  const document = { getElementById: id => elements[id] ||= {}, querySelectorAll: () => [] };
  const html = fs.readFileSync(new URL('DriverBonusForm.html', root), 'utf8');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1].split("$('driver').onchange=")[0];
  const ctx = vm.createContext({ document, Intl, console }); vm.runInContext(script, ctx);
  const record = sample({ status: 'Aguardando aprovação', nextStatuses: ['Aprovado', 'Rejeitado', 'Em análise'], approvalBlockers: [] });
  ctx.openStatusEditor(record);
  assert.match(elements.statusEditor.innerHTML, /<select name="status"/);
  assert.match(elements.statusEditor.innerHTML, /Conferi os dados/);
  assert.doesNotMatch(script.slice(script.indexOf('function renderRecords'), script.indexOf('function renderTrip')), /prompt\(|confirm\(/);
  const form = elements.statusForm;
  form.elements.status.value = 'Aprovado'; form.elements.status.onchange();
  assert.equal(elements.approvalReview.hidden, false); assert.equal(form.elements.reviewed.required, true);
  form.elements.justification.value = 'Conferido'; form.onsubmit({ preventDefault() {} });
  assert.match(elements.statusFeedback.textContent, /Confirme a conferência/);
  let args;
  ctx.google = { script: { run: {
    withSuccessHandler(success) { this.success = success; return this; },
    withFailureHandler() { return this; },
    transitionDriverBonus(...values) { args = values; this.success({ status: 'Aprovado' }); }
  } } };
  ctx.load = async () => {};
  form.elements.reviewed.checked = true; form.onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(args, ['synthetic-id', 'Aprovado', 'Conferido', true, 'Aguardando aprovação']);
  assert.match(elements.message.textContent, /Status atualizado para Aprovado/);
  record.approvalBlockers = ['Documento pendente']; ctx.openStatusEditor(record);
  form.elements.status.onchange(); form.elements.reviewed.checked = true; args = null;
  form.onsubmit({ preventDefault() {} });
  assert.equal(args, null); assert.match(elements.statusFeedback.textContent, /Aprovação bloqueada/);
});
