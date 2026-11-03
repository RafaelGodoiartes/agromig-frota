import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';

const source = fs.readFileSync(new URL('./WeeklyKmTransfer.gs', import.meta.url), 'utf8');
const clone = value => structuredClone(value);
function fixture(month = '2026-10', today = '2026-11-03') {
  let nextId = 1, clearCount = 0;
  const sheets = [], props = new Map(), triggers = [], logs = [];
  let date = today, hook = null, failPrepare = false, coerceLogDates = false;
  class Range {
    constructor(sheet, r, c, h = 1, w = 1) { Object.assign(this, { sheet, r, c, h, w }); }
    getValues() { return Array.from({ length: this.h }, (_, y) => Array.from({ length: this.w }, (_, x) => this.sheet.cell(this.r + y, this.c + x))); }
    getDisplayValues() { return this.getValues().map(row => row.map(value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value))); }
    getValue() { return this.getValues()[0][0]; }
    setValues(rows) { rows.forEach((row, y) => row.forEach((value, x) => {
      this.sheet.data[this.r + y - 1] ||= [];
      const converts = coerceLogDates && this.sheet.name === 'Registro de Leituras KM' && /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && this.sheet.formats.get(`${this.r + y}:${this.c + x}`) !== '@';
      this.sheet.data[this.r + y - 1][this.c + x - 1] = converts ? new Date(value + 'T03:00:00Z') : clone(value);
    }));
      if (hook && this.sheet.name === 'Registro de Leituras KM' && this.r > 1 && this.c === 1 && this.w === 10) rows.forEach(row => hook(this.sheet, row));
      return this;
    }
    setValue(value) { if (failPrepare && this.r === 2 && this.c === 2) { failPrepare = false; throw Error('simulated outage'); } return this.setValues([[value]]); }
    clearContent() { clearCount++; return this.setValues(Array.from({ length: this.h }, () => Array(this.w).fill(''))); }
    getA1Notation() { return String.fromCharCode(64 + this.c) + this.r; }
    setBackground() { return this; } setFontColor() { return this; } setFontWeight() { return this; } setNote() { return this; }
    setNumberFormat(format) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.sheet.formats.set(`${this.r + y}:${this.c + x}`, format); return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.id = nextId++; this.data = []; this.formats = new Map(); sheets.push(this); }
    cell(r, c) {
      const value = this.data[r - 1]?.[c - 1] ?? '';
      if (String(value).startsWith('@CAL')) return context.kmMondays_(context.kmMonth_(this))[Number(value.slice(4))] ? new Date(context.kmMondays_(context.kmMonth_(this))[Number(value.slice(4))] + 'T12:00:00Z') : '';
      return value;
    }
    getName() { return this.name; } getSheetId() { return this.id; } setName(name) { if (sheets.some(s => s !== this && s.name === name)) throw Error('duplicate sheet'); this.name = name; return this; }
    getMaxRows() { return 20; }
    getLastRow() { return Math.max(1, ...this.data.map((row, i) => row?.some(v => v !== '' && v !== null && v !== undefined) ? i + 1 : 0)); }
    getDataRange() { return new Range(this, 1, 1, this.getLastRow(), 13); }
    getRange(r, c, h, w) {
      if (typeof r === 'string') { if (r === 'G:H') return new Range(this, 1, 7, 20, 2); const m = r.match(/^([A-Z]+)(\d+)$/); return new Range(this, Number(m[2]), m[1].charCodeAt(0) - 64); }
      return new Range(this, r, c, h, w);
    }
    copyTo() { const s = new Sheet('copy' + nextId); s.data = clone(this.data); return s; }
    appendRow(row) { this.getRange(this.getLastRow() + 1, 1, 1, row.length).setValues([row]); }
    setFrozenRows() {} setColumnWidths() {}
  }
  const book = { getSheetByName: name => sheets.find(s => s.name === name), getSheetById: id => sheets.find(s => s.id === id), insertSheet: name => new Sheet(name), deleteSheet: sheet => { sheets.splice(sheets.indexOf(sheet), 1); } };
  const context = vm.createContext({ Date, Number, JSON, console: { log: value => logs.push(value) },
    SpreadsheetApp: { openById: id => { assert.equal(id, '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM'); return book; }, flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props.get(key), setProperty: (key, value) => props.set(key, value), deleteProperty: key => props.delete(key) }) },
    Utilities: { getUuid: randomUUID, DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, data) => createHash('sha256').update(data).digest(), base64EncodeWebSafe: data => Buffer.from(data).toString('base64url'), formatDate: (value, zone, pattern) => {
      if (pattern === 'yyyy-MM-dd' && !(value instanceof Date)) throw Error('date');
      const iso = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
      if (pattern === 'yyyy-MM-dd') return iso;
      if (pattern === 'yyyy-MM') return iso.slice(0, 7);
      return '20261104-010000';
    } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => triggers, newTrigger: handler => ({ timeBased() { return this; }, everyHours() { return this; }, create() { triggers.push({ getHandlerFunction: () => handler }); } }) },
    fleetDocumentUser_: () => true, json_: value => value,
  });
  vm.runInContext(source, context); context.kmToday_ = () => date;
  const active = new Sheet('KM Semanal');
  active.getRange(1, 1, 6, 13).setValues(Array.from({ length: 6 }, () => Array(13).fill('')));
  active.data[0][3] = 'CONTROLE MENSAL'; active.data[1][1] = new Date(month + '-01T12:00:00Z'); active.data[1][2] = 'COMPETÊNCIA EM CONFERÊNCIA';
  active.data[2].splice(3, 5, ...Array.from({ length: 5 }, (_, i) => '@CAL' + i));
  active.data[3][1] = 'PLACA'; active.data[4][1] = 'RKQ3C81'; active.data[4][2] = 'CAMINHÃO'; active.data[4][3] = 43000; active.data[4][8] = 'FORMULA PRESERVADA'; active.data[4][9] = 3000; active.data[4][11] = 'KM';
  active.data[5][1] = 'AGR100'; active.data[5][2] = 'RETRO'; active.data[5][11] = 'HORAS';
  const index = new Sheet('Histórico KM - Índice'); index.data = [['ÍNDICE'], ['COMPETÊNCIA', 'ABA ARQUIVADA']];
  const payload = { spreadsheetId: '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM', sheetName: 'KM Semanal', plate: 'RKQ3C81', date: today, reading: 43539.6 };
  return { c: context, book, active, props, sheets, payload, triggers, today: value => { date = value; }, clearCount: () => clearCount, failPrepare: () => { failPrepare = true; }, hook: value => { hook = value; }, coerceLogDates: () => { coerceLogDates = true; } };
}

test('virada usa dia 4 de São Paulo, inclusive dezembro/janeiro e fevereiro; primeiras datas usam primeira semana do próprio mês', () => {
  const { c } = fixture();
  assert.equal(c.kmCompetence_('2026-11-03'), '2026-10'); assert.equal(c.kmCompetence_('2026-11-04'), '2026-11');
  assert.equal(c.kmCompetence_('2027-01-03'), '2026-12'); assert.equal(c.kmCompetence_('2027-01-04'), '2027-01');
  assert.equal(c.kmWeek_('2026-11-01'), '2026-11-02'); assert.equal(c.kmWeek_('2027-01-01'), '2027-01-04');
  assert.equal(c.kmMondays_('2028-02').length, 4);
});
test('leitura antes do dia 4 vai para provisório sem limpar nem modificar outubro; instalação não duplica gatilho', () => {
  const f = fixture(), before = JSON.stringify(f.active.getDataRange().getValues());
  f.c.initializeWeeklyKmTransfer(); f.c.initializeWeeklyKmTransfer();
  const result = f.c.updateWeeklyKmSafe_(f.payload);
  assert.equal(result.provisional, true); assert.equal(result.sheetName, 'KM Provisório 11-2026');
  assert.equal(JSON.stringify(f.active.getDataRange().getValues()), before); assert.equal(f.triggers.length, 1);
  assert.equal(f.book.getSheetByName(result.sheetName).getRange('D5').getValue(), 43539.6);
});
test('no dia 4 arquiva tudo, mantém sheetId/fórmulas/franquia, confere a transferência e só então retira provisório', () => {
  const f = fixture(), before = JSON.stringify(f.active.getDataRange().getValues()), id = f.active.getSheetId();
  f.c.updateWeeklyKmSafe_(f.payload); f.today('2026-11-04'); f.c.runWeeklyKmMonthly_();
  assert.equal(JSON.stringify(f.book.getSheetByName('KM Semanal 10-2026').getDataRange().getValues()), before);
  assert.equal(f.active.getSheetId(), id); assert.equal(f.c.kmMonth_(f.active), '2026-11'); assert.equal(f.active.getRange('D5').getValue(), 43539.6);
  assert.equal(f.active.getRange('I5').getValue(), 'FORMULA PRESERVADA'); assert.equal(f.active.getRange('J5').getValue(), 3000);
  assert.equal(f.book.getSheetByName('KM Provisório 11-2026'), undefined);
  const count = f.sheets.length; f.c.runWeeklyKmMonthly_(); assert.equal(f.sheets.length, count);
  assert.ok(f.book.getSheetByName('Registro de Leituras KM').getLastRow() >= 3);
});
test('conflitos mantêm os dois valores e o provisório, sem sobrescrever o definitivo', () => {
  const f = fixture('2026-11', '2026-11-04');
  const temp = f.c.kmProvisional_(f.book, '2026-11'); temp.getRange('D5').setValue(43539.6);
  const result = f.c.kmMerge_(f.book, '2026-11');
  assert.equal(result.conflicts, 1); assert.equal(f.active.getRange('D5').getValue(), 43000); assert.ok(f.book.getSheetByName(temp.getName()));
});
test('falha depois da cópia permite retomar a transição sem criar histórico vazio nem perder leituras', () => {
  const f = fixture(), original = JSON.stringify(f.active.getDataRange().getValues());
  f.c.updateWeeklyKmSafe_(f.payload); f.today('2026-11-04'); f.failPrepare();
  assert.throws(() => f.c.runWeeklyKmMonthly_(), /simulated outage/);
  assert.equal(JSON.stringify(f.book.getSheetByName('KM Semanal 10-2026').getDataRange().getValues()), original);
  f.c.runWeeklyKmMonthly_(); assert.equal(f.active.getRange('D5').getValue(), 43539.6); assert.equal(f.props.size, 0);
});
test('histórico preexistente nunca é substituído; cópia de segurança recebe nome distinto', () => {
  const f = fixture(); const older = f.active.copyTo(f.book).setName('KM Semanal 10-2026'); older.getRange('D5').setValue(100);
  f.today('2026-11-04'); f.c.runWeeklyKmMonthly_();
  assert.equal(older.getRange('D5').getValue(), 100); assert.ok(f.sheets.some(s => s.name.includes('preservado')));
});
test('origem/histórico adulterados durante uma transição interrompem a virada sem limpeza extra', () => {
  const f = fixture(); f.today('2026-11-04'); f.failPrepare(); assert.throws(() => f.c.runWeeklyKmMonthly_());
  f.book.getSheetByName('KM Semanal 10-2026').getRange('D5').setValue(1); const before = f.clearCount();
  assert.throws(() => f.c.runWeeklyKmMonthly_(), /modificado/); assert.equal(f.clearCount(), before);
});
test('reenvio igual é idempotente, valor maior fica auditado e menor nunca substitui', () => {
  const f = fixture(); f.c.updateWeeklyKmSafe_(f.payload); const log = f.book.getSheetByName('Registro de Leituras KM'), count = log.getLastRow();
  f.c.updateWeeklyKmSafe_(f.payload); assert.equal(log.getLastRow(), count);
  assert.throws(() => f.c.updateWeeklyKmSafe_({ ...f.payload, reading: 1 }), /menor/);
  f.c.updateWeeklyKmSafe_({ ...f.payload, reading: 44000 }); assert.equal(log.getRange(log.getLastRow(), 8).getValue(), 43539.6);
});
test('não aceita planilha/aba arbitrária, data inexistente/futura, vazio, negativo nem placa duplicada', () => {
  const f = fixture();
  for (const override of [{ spreadsheetId: 'other' }, { sheetName: 'Cadastro de Veículos' }, { date: '2026-02-30' }, { date: '2026-11-04' }, { reading: '' }, { reading: ' ' }, { reading: -1 }]) assert.throws(() => f.c.updateWeeklyKmSafe_({ ...f.payload, ...override }));
  f.active.getRange('B6').setValue('RKQ3C81'); assert.throws(() => f.c.updateWeeklyKmSafe_({ ...f.payload, date: '2026-10-30' }), /duplicada/);
});
test('edição manual do provisório durante a transferência impede a exclusão', () => {
  const f = fixture(); f.c.updateWeeklyKmSafe_(f.payload); f.today('2026-11-04');
  f.hook((sheet, row) => { if (row[2] === 'TRANSFERÊNCIA CONFERIDA') f.book.getSheetByName('KM Provisório 11-2026').getRange('E5').setValue(45000); });
  assert.throws(() => f.c.runWeeklyKmMonthly_(), /mudou durante/); assert.ok(f.book.getSheetByName('KM Provisório 11-2026'));
});
test('Sheets convertendo datas ISO em Date não pode bloquear o lançamento real de novembro', () => {
  const f = fixture(); f.coerceLogDates();
  const result = f.c.updateWeeklyKmSafe_(f.payload);
  assert.equal(result.ok, true); assert.equal(f.book.getSheetByName('KM Provisório 11-2026').getRange('D5').getValue(), 43539.6);
});
test('conferência aceita datas nativas equivalentes, mas recusa data, placa ou leitura diferentes', () => {
  const { c } = fixture();
  const expected = ['id', '2026-11-03T14:02:28.313Z', 'RECEBIDO', 'RKQ3C81', '2026-11-03', '2026-11-02', 43539.6, '', 'KM Provisório 11-2026', 'D11'];
  const stored = [...expected]; stored[4] = new Date('2026-11-03T03:00:00Z'); stored[5] = new Date('2026-11-02T03:00:00Z');
  assert.equal(c.kmLogMatches_(expected, stored), true);
  for (const [index, value] of [[4, new Date('2026-11-04T03:00:00Z')], [3, 'OUTRA'], [6, 1], [6, '43539.6']]) {
    const changed = [...stored]; changed[index] = value; assert.equal(c.kmLogMatches_(expected, changed), false);
  }
});
test('corrupção real do registro continua impedindo gravar a leitura', () => {
  const f = fixture();
  f.hook(sheet => { sheet.data[sheet.getLastRow() - 1][6] = 1; });
  assert.throws(() => f.c.updateWeeklyKmSafe_(f.payload), /conferir o registro/);
  assert.equal(f.book.getSheetByName('KM Provisório 11-2026').getRange('D5').getValue(), '');
});
test('outra linha surgindo no registro não muda a célula conferida após a gravação', () => {
  const f = fixture();
  f.hook(sheet => { f.hook(null); sheet.appendRow(['evento concorrente']); });
  assert.equal(f.c.updateWeeklyKmSafe_(f.payload).ok, true);
});
