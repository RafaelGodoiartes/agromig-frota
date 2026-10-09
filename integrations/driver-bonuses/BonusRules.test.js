import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const root = new URL('./', import.meta.url);
const files = ['BonusRules.gs', 'DriverBonuses.gs', 'BonusImports.gs', 'BonusReports.gs'];
function context(extra = {}) {
  const ctx = vm.createContext({ console, ...extra });
  files.forEach(file => vm.runInContext(fs.readFileSync(new URL(file, root), 'utf8'), ctx, { filename: file }));
  return ctx;
}
const copy = value => JSON.parse(JSON.stringify(value));
test('assinatura impede alteração externa dos valores, sem usar IDs de arquivo como autorização', () => {
  const ctx = context({ Utilities: { computeHmacSha256Signature: (text, secret) => crypto.createHmac('sha256', secret).update(text).digest(), base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url') } });
  const data = { version: 1, records: [{ cents: 9000, status: 'Aprovado' }], revision: 1 };
  const signature = ctx.bonusSignature_(data, 'synthetic-test-key');
  assert.equal(ctx.bonusSignature_({ ...data, fileId: 'any-id', signature }, 'synthetic-test-key'), signature);
  assert.notEqual(ctx.bonusSignature_({ ...data, records: [{ cents: 19000, status: 'Aprovado' }] }, 'synthetic-test-key'), signature);
  assert.notEqual(ctx.bonusSignature_(data, 'different-key'), signature);
});
test('arquivos da integração e script da interface têm sintaxe válida', () => {
  context();
  const html = fs.readFileSync(new URL('DriverBonusForm.html', root), 'utf8');
  new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
});
test('acesso exige identidade Google exata da Frota, nunca e-mail do formulário', () => {
  for (const user of ['', 'rafael@agromig.com.br', 'frota@agromig.com.br.evil', 'frota@evil.com']) {
    const ctx = context({ Session: { getActiveUser: () => ({ getEmail: () => user }) } });
    assert.throws(() => ctx.bonusUser_(), /Acesso permitido/);
  }
  const ctx = context({ Session: { getActiveUser: () => ({ getEmail: () => 'frota@agromig.com.br' }) } });
  assert.equal(ctx.bonusUser_(), 'frota@agromig.com.br');
});
test('destino público ou domínio amplo é bloqueado; não altera compartilhamento', () => {
  const ctx = context({ DriveApp: { Access: { PRIVATE: 'PRIVATE' } } });
  for (const sharing of ['ANYONE', 'ANYONE_WITH_LINK', 'DOMAIN', 'DOMAIN_WITH_LINK']) assert.throws(() => ctx.bonusPrivate_({ getSharingAccess: () => sharing }), /não está restrita/);
  assert.doesNotThrow(() => ctx.bonusPrivate_({ getSharingAccess: () => 'PRIVATE' }));
});
test('KM calcula em centavos, fracionado e sem aceitar finais menores ou vazios', () => {
  const ctx = context();
  assert.deepEqual(copy(ctx.bonusTripAmount_(100, '250,5', 90)), { km: 150.5, cents: 13545 });
  for (const [start, end] of [['', 200], [200, 100], [100, 100], ['km100', 200]]) assert.throws(() => ctx.bonusTripAmount_(start, end, 90));
});
test('não presume motorista histórico, não junta abreviações desconhecidas', () => {
  const ctx = context();
  const assignments = [{ driver: 'MOTORISTA TESTE', plate: 'ABC1D23', from: '2026-09-01', to: '2026-09-30' }];
  assert.equal(ctx.bonusResponsible_('motoristateste', 'ABC-1D23', '2026-09-15', assignments), true);
  assert.equal(ctx.bonusResponsible_('MOTORISTA', 'ABC1D23', '2026-09-15', assignments), false);
  assert.equal(ctx.bonusResponsible_('MOTORISTA TESTE', 'ABC1D23', '2026-10-01', assignments), false);
  assert.equal(ctx.bonusResponsible_('MOTORISTA TESTE', 'ABC1D23', '2026-09-15', [...assignments, { ...assignments[0], driver: 'OUTRO' }]), false);
});
function sample() {
  const days = Array.from({ length: 24 }, (_, i) => '2026-09-' + String(i + 1).padStart(2, '0'));
  return { input: { driver: 'TESTE', month: '2026-09', workedDates: days.join(','), plates: 'ABC1D23', washDates: days[0] },
    evidence: { assignments: [{ driver: 'TESTE', plate: 'ABC1D23', from: days[0], to: days.at(-1) }],
      checklists: days.slice(0, 23).map(date => ({ driver: 'TESTE', plate: 'ABC1D23', date, valid: true })), checklistComplete: true,
      circulation: [], circulationComplete: true, speed: [], speedComplete: true, fines: [], finesComplete: true,
      washes: [{ date: days[0], plate: 'ABC1D23', evidenceId: 'synthetic-proof' }], washComplete: true } };
}
test('23 de 24 checklists = 153,33; somente dias trabalhados são avaliados', () => {
  const ctx = context(), { input, evidence } = sample();
  const output = ctx.bonusEvaluate_(input, evidence, vm.runInContext('BONUS_DEFAULT_RULES', ctx));
  assert.equal(output.results[0].cents, 15333); assert.equal(output.provisionalCents, 69333);
  assert.equal(output.pending.length, 0); assert.equal(output.requiresHumanReview, true);
  assert.deepEqual(copy(output.results[0].missingDates), ['2026-09-24']);
});
test('circulação irregular atribuída sugere zero só nos KPIs; exceção não elimina', () => {
  const ctx = context(), { input, evidence } = sample();
  evidence.circulation = [{ date: '2026-09-10', time: '21:35', plate: 'ABC1D23', evidenceId: 'synthetic-proof', confirmed: true }];
  const rules = vm.runInContext('BONUS_DEFAULT_RULES', ctx);
  let output = ctx.bonusEvaluate_(input, evidence, rules);
  assert.equal(output.provisionalCents, 0); assert.equal(output.eliminationSuggested, true); assert.equal(output.requiresHumanReview, true);
  evidence.circulation[0].authorized = true;
  output = ctx.bonusEvaluate_(input, evidence, rules); assert.equal(output.eliminationSuggested, false);
});
test('excesso retira apenas velocidade; multa contestada permanece pendente', () => {
  const ctx = context(), { input, evidence } = sample();
  evidence.speed = [{ date: '2026-09-10', plate: 'ABC1D23', speed: 100, limit: 110, roadLimit: 90, confirmed: true }];
  evidence.fines = [{ date: '2026-09-10', plate: 'ABC1D23', confirmed: true, contested: true }];
  const output = ctx.bonusEvaluate_(input, evidence, vm.runInContext('BONUS_DEFAULT_RULES', ctx));
  assert.equal(output.results[2].cents, 0); assert.equal(output.results[4].cents, 10000);
  assert.ok(output.pending.some(reason => /Multas/.test(reason))); assert.equal(output.eliminationSuggested, false);
});
test('dados incompletos não viram avaliação aprovada nem perda integral', () => {
  const ctx = context(), { input, evidence } = sample();
  evidence.checklistComplete = false; evidence.assignments = [];
  evidence.circulation = [{ date: '2026-09-10', plate: 'ABC1D23', time: '21:35' }];
  const output = ctx.bonusEvaluate_(input, evidence, vm.runInContext('BONUS_DEFAULT_RULES', ctx));
  assert.ok(output.pending.length >= 3); assert.equal(output.eliminationSuggested, false);
});
test('relatório definitivo soma exclusivamente aprovados/pagos; pendentes separados', () => {
  const ctx = context();
  const model = ctx.bonusReportModel_({ records: [{ driverId: 'TESTE', driver: 'TESTE', month: '2026-09', category: 'Viagem', status: 'Aprovado', approved: { cents: 9000 } }, { driverId: 'TESTE', driver: 'TESTE', month: '2026-09', category: 'KPIs', status: 'Rascunho', calculation: { cents: 70000 } }, { driverId: 'TESTE', driver: 'TESTE', month: '2026-10', category: 'Viagem', status: 'Aprovado', approved: { cents: 5000 } }] }, '2026-09');
  assert.equal(model.totalCents, 9000); assert.equal(model.pending.length, 1); assert.equal(model.status, 'PARCIALMENTE APROVADO');
});
test('agendador não executa por outra conta, sem ativação ou fora do dia 10', () => {
  const ctx = context({ PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) } });
  assert.doesNotThrow(() => ctx.sendScheduledBonusReport());
});
test('nenhum dado de bonificação é adicionado à API pública nem há aprovação automática', () => {
  const server = files.map(file => fs.readFileSync(new URL(file, root), 'utf8')).join('\n');
  assert.doesNotMatch(server, /function doPost|function doGet|setSharing\(|addViewer\(/);
  assert.match(server, /Aguardando conferência/); assert.match(server, /report.fingerprint !== bonusReportFingerprint_/);
  assert.match(server, /Envio iniciado — conferir Gmail/);
});
