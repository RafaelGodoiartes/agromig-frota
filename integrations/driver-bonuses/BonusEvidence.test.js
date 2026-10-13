import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('BonusReports.gs', import.meta.url), 'utf8');
function render(records, files) {
  const ctx = vm.createContext({ DriveApp: { getFileById: id => files[id] }, Utilities: { base64Encode: bytes => Buffer.from(bytes).toString('base64') } });
  vm.runInContext(source, ctx); return ctx.bonusEvidenceReportHtml_(records, '2026-09');
}
const blob = (bytes = [1, 2, 3], mime = 'image/png') => ({ getBytes: () => bytes, getContentType: () => mime });
const file = (id, mime = 'image/png') => ({ getName: () => '<Foto> ' + id, getUrl: () => 'https://drive.google.com/file/d/' + id + '/view', getMimeType: () => mime, getBlob: () => blob(), getThumbnail: () => null });
test('índice inclui fotos e links reais, deduplica imagem e preserva todas as referências', () => {
  const records = [{ driver: 'Pessoa A', category: 'KPIs', month: '2026-09', evidence: { id: 'photo' }, details: { evidenceIds: ['photo', 'pdf'] } }, { driver: 'Pessoa B', category: 'Viagem', month: '2026-09', evidence: { id: 'photo' } }];
  const before = JSON.stringify(records), html = render(records, { photo: file('photo'), pdf: file('pdf', 'application/pdf') });
  assert.equal((html.match(/<img /g) || []).length, 1); assert.match(html, /data:image\/png;base64,AQID/);
  assert.match(html, /href="https:\/\/drive.google.com\/file\/d\/photo\/view"/);
  assert.match(html, /Pessoa A - KPIs/); assert.match(html, /Pessoa B - Viagem/);
  assert.match(html, /&lt;Foto&gt;/); assert.match(html, /file\/d\/pdf\/view/);
  assert.equal(JSON.stringify(records), before);
});
test('declaração manual não é inventada como foto e PDF conserva referência', () => {
  const html = render([{ driver: 'Pessoa', category: 'KPIs', month: '2026-09', details: { manualAssessment: { actor: 'gestor', at: 'data' }, checklistSelection: { source: 'Manual', justification: 'Conferido.', actor: 'gestor', at: 'data' } } }], {});
  assert.doesNotMatch(html, /<img /); assert.match(html, /Declaração manual conferida/); assert.match(html, /Conferido\./);
});
test('foto grande usa prévia disponível, informa redução e mantém original', () => {
  const photo = file('large'); photo.getBlob = () => blob(new Uint8Array(4 * 1024 * 1024 + 1)); photo.getThumbnail = () => blob([4, 5]);
  const html = render([{ driver: 'Pessoa', category: 'KPIs', month: '2026-09', evidence: { id: 'large' } }], { large: photo });
  assert.match(html, /Prévia reduzida/); assert.match(html, /data:image\/png;base64,BAU=/);
});
test('erro de leitura ou excesso não omite fotos silenciosamente e não amplia acesso', () => {
  const huge = file('huge'); huge.getBlob = () => blob(new Uint8Array(12 * 1024 * 1024 + 1));
  assert.throws(() => render([{ evidence: { id: 'huge' } }], { huge }), /Nenhuma foto foi omitida/);
  assert.throws(() => render([{ evidence: { id: 'missing' } }], {}));
  const functionSource = source.slice(source.indexOf('function bonusEvidenceReportHtml_'), source.indexOf('function bonusSavePdf_'));
  assert.doesNotMatch(functionSource, /setSharing|addViewer|UrlFetchApp|setTrashed/);
});
