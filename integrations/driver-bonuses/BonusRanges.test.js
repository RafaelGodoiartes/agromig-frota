import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('DriverBonusForm.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1].split("$('driver').onchange=")[0];
const ctx = vm.createContext({ document: {} }); vm.runInContext(script, ctx);
const copy = value => JSON.parse(JSON.stringify(value));

test('utilização conta ambas as datas, um dia e intervalos entre meses', () => {
  assert.deepEqual(copy(ctx.bonusRangeInfo('2026-10-01', '2026-10-05')), { from: '2026-10-01', to: '2026-10-05', count: 5 });
  assert.equal(ctx.bonusRangeInfo('2026-10-03', '2026-10-03').count, 1);
  assert.equal(ctx.bonusRangeInfo('2026-09-30', '2026-10-02').count, 3);
  assert.equal(ctx.bonusRangeInfo('2024-02-01', '2024-02-29').count, 29);
});
test('datas inexistentes, vazias ou invertidas são recusadas', () => {
  for (const [from, to] of [['', ''], ['2026-02-29', '2026-03-01'], ['2026-10-32', '2026-10-32'], ['2026-10-05', '2026-10-01'], ['01/10/2026', '02/10/2026']]) {
    assert.throws(() => ctx.bonusRangeInfo(from, to), /intervalo válido/);
  }
});
test('dias trabalhados incluem todo o intervalo sem presumir folgas, somente na competência', () => {
  assert.deepEqual(copy(ctx.workedRangeDates('2026-10', '2026-10-02', '2026-10-05')), ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
  assert.throws(() => ctx.workedRangeDates('2026-10', '2026-09-30', '2026-10-02'), /competência/);
  assert.throws(() => ctx.workedRangeDates('2026-10', '2026-10-30', '2026-11-01'), /competência/);
});
test('seleção por intervalo preserva dias anteriores e exige nova conferência sem salvar', () => {
  const fields = [1, 2, 3, 4, 5, 6].map(day => ({ value: `2026-10-0${day}`, checked: day === 1 }));
  const nodes = { month: { value: '2026-10' }, workedFrom: { value: '2026-10-03' }, workedTo: { value: '2026-10-05' }, workedRange: {}, workedRangeFeedback: {} };
  const elements = { checklistReviewed: { checked: true }, manualReviewed: { checked: true } };
  const context = vm.createContext({ document: { getElementById: id => nodes[id] } });
  vm.runInContext(script, context);
  context.bindWorkedRange({ elements, querySelectorAll: () => fields });
  nodes.workedRange.onclick();
  assert.deepEqual(fields.filter(field => field.checked).map(field => field.value), ['2026-10-01', '2026-10-03', '2026-10-04', '2026-10-05']);
  assert.equal(elements.manualReviewed.checked, false); assert.equal(elements.checklistReviewed.checked, false);
  assert.match(nodes.workedRangeFeedback.textContent, /Nada foi salvo/);
  const before = copy(fields); nodes.workedTo.value = '2026-09-30'; nodes.workedRange.onclick();
  assert.deepEqual(fields, before); assert.match(nodes.workedRangeFeedback.textContent, /intervalo válido/);
});
test('utilização mantém a integração existente e preenchimento do mês não registra automaticamente', () => {
  assert.match(html, /Registrar intervalo de utilização/);
  assert.match(html, /Preencher mês da competência/);
  assert.match(html, /call\('saveBonusAssignment',\{\.\.\.values,driver:driver\(\)\}\)/);
  assert.match(html, /Responsabilidade pelo veículo não equivale a dias trabalhados nem a checklist realizado/);
});
