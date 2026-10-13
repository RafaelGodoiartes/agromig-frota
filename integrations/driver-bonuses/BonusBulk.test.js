import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('DriverBonusForm.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1].split("$('driver').onchange=")[0];
const ctx = vm.createContext({ document: {} }); vm.runInContext(script, ctx);
const copy = value => JSON.parse(JSON.stringify(value));
test('lote adiciona múltiplos dias distintos de uma vez para o veículo escolhido', () => {
  const dates = ['2026-10-01', '2026-10-02', '2026-10-05'];
  assert.deepEqual(copy(ctx.planChecklistBatch([], dates, 'ABC1D23', dates, '2026-10')), {
    add: dates.map(date => ({ date, plate: 'ABC1D23' })), duplicates: 0
  });
});
test('lote ignora duplicidades sem substituir registros ou evidências existentes', () => {
  const existing = [{ date: '2026-10-01', plate: 'ABC-1D23', evidence: { id: 'synthetic-original' } }], before = copy(existing);
  const result = ctx.planChecklistBatch(existing, ['2026-10-01', '2026-10-02', '2026-10-02'], 'ABC1D23', ['2026-10-01', '2026-10-02'], '2026-10');
  assert.deepEqual(copy(result), { add: [{ date: '2026-10-02', plate: 'ABC1D23' }], duplicates: 1 });
  assert.deepEqual(existing, before);
});
test('checklist de outro veículo na mesma data pode ser registrado sem duplicar a placa', () => {
  const result = ctx.planChecklistBatch([{ date: '2026-10-01', plate: 'XYZ9A99' }], ['2026-10-01'], 'ABC1D23', ['2026-10-01'], '2026-10');
  assert.equal(result.add.length, 1);
});
test('lote recusa veículo vazio, dias vazios, fora da competência ou não trabalhados', () => {
  assert.throws(() => ctx.planChecklistBatch([], ['2026-10-01'], '', ['2026-10-01'], '2026-10'), /veículo/);
  assert.throws(() => ctx.planChecklistBatch([], [], 'ABC1D23', ['2026-10-01'], '2026-10'), /pelo menos um/);
  assert.throws(() => ctx.planChecklistBatch([], ['2026-09-30'], 'ABC1D23', ['2026-09-30'], '2026-10'), /competência/);
  assert.throws(() => ctx.planChecklistBatch([], ['2026-10-02'], 'ABC1D23', ['2026-10-01'], '2026-10'), /trabalhados/);
});
test('intervalo usa apenas dias trabalhados informados e não presume sábados ou domingos', () => {
  assert.deepEqual(copy(ctx.checklistBatchRange('2026-10', '2026-10-01', '2026-10-05', ['2026-10-01', '2026-10-02', '2026-10-05'])), ['2026-10-01', '2026-10-02', '2026-10-05']);
  assert.deepEqual(copy(ctx.checklistBatchRange('2026-10', '2026-10-03', '2026-10-03', ['2026-10-03'])), ['2026-10-03']);
  for (const [from, to] of [['2026-10-05', '2026-10-01'], ['2026-09-30', '2026-10-01'], ['2026-10-32', '2026-10-32'], ['', '']]) {
    assert.throws(() => ctx.checklistBatchRange('2026-10', from, to, ['2026-10-01']), /intervalo válido/);
  }
  assert.throws(() => ctx.checklistBatchRange('2026-10', '2026-10-01', '2026-10-02', []), /Não há dias/);
});
test('interface permite limpar só a seleção, mantém revisão humana e anexo individual', () => {
  assert.match(html, /Lançar vários dias de uma vez/); assert.match(html, /Adicionar dias selecionados/);
  assert.match(html, /registros já adicionados foram mantidos/);
  assert.match(html, /checklistReviewed.checked=false;form.elements.manualReviewed.checked=false/);
  assert.match(html, /Foto \/ documento de evidência/);
});
