import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const root = new URL('./', import.meta.url), copy = value => JSON.parse(JSON.stringify(value));
function context() {
  const ctx = vm.createContext({ Utilities: {
    getUuid: () => 'synthetic-report-id', formatDate: date => date.toISOString().slice(0, 19).replace(/[T:]/g, '-'),
    DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, text) => crypto.createHash('sha256').update(text).digest(), base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url')
  } });
  for (const file of ['BonusRules.gs', 'DriverBonuses.gs', 'BonusReports.gs']) vm.runInContext(fs.readFileSync(new URL(file, root), 'utf8'), ctx);
  return ctx;
}
const sample = () => ({ records: [
  { id: 'trip', driverId: 'DRIVER1', driver: 'MOTORISTA TESTE 1', month: '2026-09', category: 'Viagem', status: 'Aprovado', approved: { cents: 45351 }, calculation: { cents: 45351 }, details: {}, actions: [] },
  { id: 'kpi', driverId: 'DRIVER2', driver: 'MOTORISTA TESTE 2', month: '2026-09', category: 'KPIs', status: 'Pago', approved: { cents: 53826, calculation: { maximumCents: 70000, results: [], cents: 53826 } }, calculation: { cents: 70000, maximumCents: 70000, results: [] }, details: {}, actions: [] },
  { id: 'pending', driverId: 'DRIVER3', driver: 'MOTORISTA TESTE 3', month: '2026-09', category: 'KPIs', status: 'Aguardando documentos', justification: 'Aprovado', calculation: { cents: 48000, maximumCents: 80000, results: [] }, details: {}, actions: [] },
  { id: 'other-month', driverId: 'DRIVER1', driver: 'MOTORISTA TESTE 1', month: '2026-10', category: 'Cargo de confiança', status: 'Aprovado', approved: { cents: 100000 }, calculation: { cents: 100000 }, details: {}, actions: [] }
], reports: [], operations: [], assignments: [], ruleVersions: [] });

test('prévia e consolidado incluem todos os aprovados da competência e separam os pendentes', () => {
  const ctx = context(), data = sample(), before = copy(data), model = ctx.bonusReportModel_(data, '2026-09'), preview = ctx.bonusReportPreview_(data, '2026-09');
  assert.equal(model.totalCents, 99177); assert.equal(model.approvedRows.length, 2);
  assert.equal(preview.approvedCount, 2); assert.equal(preview.pending.length, 1);
  assert.equal(preview.pending[0].status, 'Aguardando documentos'); assert.equal(preview.approvedRows[1].kpiCents, 53826);
  assert.deepEqual(data, before);
});
test('aprovação sem valor confirmado falha explicitamente, não some do relatório', () => {
  const ctx = context(), data = sample(); delete data.records[0].approved;
  assert.throws(() => ctx.bonusReportModel_(data, '2026-09'), /aprovado sem valor confirmado/);
});
test('e-mail é curto, profissional, verde/branco e não usa valores provisórios como aprovados', () => {
  const ctx = context(), email = ctx.bonusReportEmail_(ctx.bonusReportModel_(sample(), '2026-09'), '2026-09');
  assert.match(email.body, /09\/2026/); assert.match(email.body, /991,77/);
  assert.doesNotMatch(email.body, /480,00|700,00|1\. RESUMO|2\. DETALHAMENTO|conferido antes do envio/);
  assert.match(email.htmlBody, /#1f7a46/); assert.match(email.htmlBody, /background:white/);
  assert.match(email.htmlBody, /Total aprovado/); assert.match(email.htmlBody, /aguardam regularização ou aprovação/);
});
test('geração produz quatro anexos, total numérico no Excel e pendentes em outra aba sem enviar', () => {
  const ctx = context(), data = sample(), pdfs = [], sheets = {}, files = [];
  ctx.bonusMutate_ = (_, fn) => fn(data); ctx.bonusRoot_ = () => ({}); ctx.bonusFolder_ = () => ({ createFile: blob => { const file = { getId: () => 'synthetic-excel', getName: () => blob.name, getUrl: () => 'https://example.test/excel' }; files.push(file); return file; } });
  ctx.bonusSavePdf_ = (_, name, html) => { pdfs.push({ name, html }); return { id: 'synthetic-pdf-' + pdfs.length, name: name + '.pdf', url: 'https://example.test/pdf-' + pdfs.length }; };
  const makeSheet = name => { const sheet = { setName: value => { name = value; return sheet; }, getRange: (row, column) => { const range = { setValues: values => { sheets[name] = copy(values); return range; }, setBackground: () => range, setFontColor: () => range, setFontWeight: () => range, setNumberFormat: () => range }; return range; }, setFrozenRows: () => {}, autoResizeColumns: () => {} }; return sheet; };
  ctx.SpreadsheetApp = { create: () => ({ getId: () => 'synthetic-workbook', getSheets: () => [makeSheet('Sheet1')], insertSheet: name => makeSheet(name) }), flush: () => {} };
  ctx.DriveApp = { getFileById: () => ({ moveTo: () => {} }) }; ctx.ScriptApp = { getOAuthToken: () => 'synthetic-token' };
  ctx.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getBlob: () => ({ setName(name) { this.name = name; return this; } }) }) };
  ctx.MailApp = { sendEmail: () => assert.fail('Não pode enviar durante a geração') };
  const report = ctx.prepareBonusReport('2026-09');
  assert.equal(report.files.length, 4); assert.equal(report.approvedTotalCents, 99177); assert.equal(report.status, 'Aguardando conferência');
  assert.deepEqual(sheets.Bonificações.at(-1), ['TOTAL APROVADO', '', '', '', 991.77]);
  assert.equal(sheets.Bonificações.some(row => row[0] === 'MOTORISTA TESTE 3'), false);
  assert.equal(sheets.Pendentes[1][0], 'MOTORISTA TESTE 3'); assert.equal(sheets.Pendentes[1][2], 'Aguardando documentos'); assert.equal(sheets.Pendentes[1][3], 480);
  assert.match(pdfs[0].html, /538,26/); assert.match(pdfs[0].html, /Pendentes — não incluídos/);
  assert.equal((pdfs[0].html.match(/<html>/g) || []).length, 1); assert.equal(data.reports.length, 1);
  assert.match(report.files[3].name, /2026-09.*syntheti.*xlsx/); assert.equal(report.approvedCount, 2);
});
test('alterar status invalida a conferência anterior, sem liberar envio automaticamente', () => {
  const ctx = context(), data = sample(), fingerprint = ctx.bonusReportFingerprint_(data, '2026-09');
  data.reports.push({ id: 'synthetic-old', month: '2026-09', fingerprint, status: 'Aguardando conferência' });
  data.records[2].status = 'Aprovado'; data.records[2].approved = { cents: 48000 };
  assert.notEqual(ctx.bonusReportFingerprint_(data, '2026-09'), fingerprint);
  ctx.bonusMutate_ = (_, fn) => fn(data);
  assert.throws(() => ctx.approveBonusReport('synthetic-old', 'Teste', true), /Dados alterados/);
  assert.equal(data.reports[0].status, 'Aguardando conferência');
});
test('interface ordena mais recente primeiro, identifica desatualizados e abre o recém-gerado', () => {
  const html = fs.readFileSync(new URL('DriverBonusForm.html', root), 'utf8'), script = html.match(/<script>([\s\S]*)<\/script>/)[1].split("$('driver').onchange=")[0], ctx = vm.createContext({ document: {} }); vm.runInContext(script, ctx);
  assert.deepEqual(copy(ctx.orderedBonusReports([{ id: 'old', month: '2026-09', at: '2026-10-09' }, { id: 'other', month: '2026-10', at: '2026-10-13' }, { id: 'latest', month: '2026-09', at: '2026-10-13' }], '2026-09')).map(row => row.id), ['latest', 'old']);
  assert.match(html, /generatedReportId=report.id/); assert.match(html, /DESATUALIZADO/); assert.match(html, /sandbox="" srcdoc=/);
  assert.match(html, /r.status==='Aguardando conferência'&&r.isCurrent!==false/);
  assert.match(html, /Aprovados na base atual/);
});
