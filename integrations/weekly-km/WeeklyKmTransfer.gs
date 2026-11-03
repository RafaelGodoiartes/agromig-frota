// Monthly transition stays on the existing KM Semanal sheetId used by the site.
const KM_TRANSFER_BOOK = '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM';
const KM_TRANSFER_STATE = 'FROTA_KM_MONTHLY_TRANSITION';
const KM_LOG_HEADERS = ['ID', 'DATA/HORA', 'EVENTO', 'PLACA', 'DATA DA LEITURA', 'SEMANA', 'LEITURA', 'VALOR ANTERIOR', 'ABA', 'CÉLULA'];

function kmToday_() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd'); }
function kmDate_(value) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('Data da leitura inválida.');
  const date = new Date(raw + 'T12:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) throw new Error('Data da leitura inválida.');
  return date;
}
function kmCompetence_(today) {
  const date = kmDate_(today); date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 7);
}
function kmMondays_(month) {
  const date = kmDate_(month + '-01'), result = [];
  date.setUTCDate(1 + (8 - date.getUTCDay()) % 7);
  while (date.toISOString().slice(0, 7) === month) { result.push(date.toISOString().slice(0, 10)); date.setUTCDate(date.getUTCDate() + 7); }
  return result;
}
function kmWeek_(day) {
  const month = day.slice(0, 7), date = kmDate_(day), mondays = kmMondays_(month);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() || 7) + 1);
  // First days before the first Monday belong to that month's first column.
  return date.toISOString().slice(0, 10) < mondays[0] ? mondays[0] : date.toISOString().slice(0, 10);
}
function kmPlate_(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function kmMonth_(sheet) {
  const value = sheet.getRange('B2').getValue();
  if (!(value instanceof Date) || isNaN(value.getTime())) throw new Error('Competência da aba KM Semanal inválida. Nenhuma leitura foi removida.');
  return Utilities.formatDate(value, 'America/Sao_Paulo', 'yyyy-MM');
}
function kmTempName_(month) { return 'KM Provisório ' + month.slice(5) + '-' + month.slice(0, 4); }
function kmDigest_(values) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(values))); }
function kmLogSheet_(book) {
  let sheet = book.getSheetByName('Registro de Leituras KM');
  if (!sheet) {
    sheet = book.insertSheet('Registro de Leituras KM');
    sheet.getRange(1, 1, 1, 10).setValues([KM_LOG_HEADERS]).setBackground('#1f7a46').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1); sheet.setColumnWidths(1, 10, 150);
    sheet.getRange('G:H').setNumberFormat('#,##0.0');
  }
  if (JSON.stringify(sheet.getRange(1, 1, 1, 10).getValues()[0]) !== JSON.stringify(KM_LOG_HEADERS)) throw new Error('Cabeçalhos do registro de KM incompatíveis.');
  return sheet;
}
function kmLogMatches_(expected, actual) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return expected.every(function (value, index) {
    let stored = actual[index];
    // Sheets can return date-formatted ISO inputs as Date, not as strings.
    // Normalize only the two date columns; all other fields remain strict.
    if ((index === 4 || index === 5) && stored instanceof Date && !isNaN(stored.getTime())) stored = Utilities.formatDate(stored, 'America/Sao_Paulo', 'yyyy-MM-dd');
    return stored === value;
  });
}
function kmLog_(book, event, plate, day, week, reading, previous, sheet, cell) {
  const log = kmLogSheet_(book), row = [Utilities.getUuid(), new Date().toISOString(), event, plate, day, week, reading, previous, sheet, cell];
  const number = log.getLastRow() + 1;
  if (number > log.getMaxRows()) log.insertRowsAfter(log.getMaxRows(), 500);
  const target = log.getRange(number, 1, 1, 10);
  if (target.getValues()[0].some(function (value) { return value !== ''; })) throw new Error('O destino do registro de segurança já está preenchido. Nenhum valor foi substituído.');
  // Set types before writing. Historical attempt rows are left untouched.
  target.setNumberFormat('@'); log.getRange(number, 7, 1, 2).setNumberFormat('#,##0.0');
  target.setValues([row]); SpreadsheetApp.flush();
  if (!kmLogMatches_(row, target.getValues()[0])) throw new Error('Não foi possível conferir o registro de segurança do KM.');
}
function kmRows_(sheet) {
  const rows = sheet.getRange(5, 2, Math.max(1, sheet.getLastRow() - 4), 7).getValues();
  return rows.map(function (row, index) { return { row: index + 5, plate: String(row[0] || '').trim(), key: kmPlate_(row[0]), readings: row.slice(2, 7) }; })
    .filter(function (row) { return row.plate && !row.plate.startsWith('#'); });
}
function kmRow_(sheet, plate) {
  const rows = kmRows_(sheet).filter(function (row) { return row.key === kmPlate_(plate); });
  if (rows.length !== 1) throw new Error(rows.length ? 'Placa duplicada no controle semanal. Confira o cadastro antes de lançar.' : 'Veículo não encontrado no controle semanal.');
  return rows[0];
}
function kmPrepare_(sheet, month, note) {
  // This is invoked only on a new clone, or after a verified persistent archive.
  sheet.getRange(5, 4, sheet.getMaxRows() - 4, 5).clearContent();
  sheet.getRange('B2').setValue(kmDate_(month + '-01')).setNumberFormat('MM/yyyy').setNote(note);
  sheet.getRange('C2').setValue('COMPETÊNCIA ' + month.slice(5) + '/' + month.slice(0, 4) + ' — leituras por data; histórico anterior preservado.').setNote(note);
  sheet.setFrozenRows(4);
  SpreadsheetApp.flush();
  const expected = kmMondays_(month), dates = sheet.getRange(3, 4, 1, 5).getValues()[0];
  expected.forEach(function (day, index) {
    if (!(dates[index] instanceof Date) || Utilities.formatDate(dates[index], 'America/Sao_Paulo', 'yyyy-MM-dd') !== day) throw new Error('Calendário semanal inconsistente. O histórico foi preservado.');
  });
}
function kmProvisional_(book, month) {
  const name = kmTempName_(month);
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.getSheetByName('KM Semanal').copyTo(book).setName(name);
    kmPrepare_(sheet, month, 'Provisório: será transferido após a virada no dia 4. A aba definitiva anterior não foi alterada.');
  }
  if (kmMonth_(sheet) !== month) throw new Error('O provisório existente possui competência diferente. Nenhum dado foi alterado.');
  return sheet;
}
function kmIndex_(book, month, archive) {
  const sheet = book.getSheetByName('Histórico KM - Índice');
  if (!sheet) throw new Error('Índice histórico não encontrado.');
  const formula = '=HYPERLINK("#gid=' + archive.getSheetId() + '";"' + archive.getName().replace(/"/g, '""') + '")';
  const rows = sheet.getLastRow() > 2 ? sheet.getRange(3, 2, sheet.getLastRow() - 2, 1).getDisplayValues() : [];
  if (!rows.some(function (row) { return row[0] === archive.getName(); })) sheet.appendRow([kmDate_(month + '-01'), formula]);
  sheet.getRange(3, 1, Math.max(1, sheet.getLastRow() - 2), 1).setNumberFormat('MM/yyyy');
}
function kmArchive_(book, active, month) {
  const snapshot = active.getDataRange().getValues(), digest = kmDigest_(snapshot);
  const base = 'KM Semanal ' + month.slice(5) + '-' + month.slice(0, 4);
  const name = book.getSheetByName(base) ? base + ' - preservado ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMdd-HHmmss') : base;
  const archive = active.copyTo(book).setName(name);
  // Freeze effective values so future Cadastro edits cannot rewrite the history.
  archive.getDataRange().setValues(snapshot); SpreadsheetApp.flush();
  if (kmDigest_(archive.getDataRange().getValues()) !== digest || kmDigest_(active.getDataRange().getValues()) !== digest) throw new Error('A cópia histórica não conferiu com a origem. Nenhuma leitura foi limpa.');
  kmIndex_(book, month, archive);
  return { archiveId: archive.getSheetId(), digest, rows: snapshot.length, columns: snapshot[0].length };
}
function kmMerge_(book, month) {
  const temp = book.getSheetByName(kmTempName_(month));
  if (!temp) return { transferred: 0, conflicts: 0 };
  if (kmMonth_(temp) !== month) throw new Error('Competência do provisório não confere.');
  const active = book.getSheetByName('KM Semanal'), weeks = kmMondays_(month), entries = [];
  if (kmMonth_(active) !== month) throw new Error('Destino definitivo ainda não pertence à competência da transferência.');
  const sourceRows = kmRows_(temp), sourceDigest = kmDigest_(sourceRows);
  sourceRows.forEach(function (source) {
    source.readings.forEach(function (reading, index) {
      if (reading === '') return;
      if (!weeks[index] || typeof reading !== 'number' || !Number.isFinite(reading) || reading < 0) throw new Error('Leitura inválida no provisório. Corrija antes da transferência; nenhum dado será excluído.');
      const target = kmRow_(active, source.plate), cell = active.getRange(target.row, index + 4), previous = cell.getValue();
      entries.push({ source, index, reading, cell, previous, conflict: previous !== '' && previous !== reading });
    });
  });
  // Preserve both sides of any conflict; never choose a value silently.
  if (entries.some(function (entry) { return entry.conflict; })) return { transferred: 0, conflicts: entries.filter(function (entry) { return entry.conflict; }).length };
  entries.forEach(function (entry) {
    kmLog_(book, 'TRANSFERÊNCIA CONFERIDA', entry.source.plate, '', weeks[entry.index], entry.reading, entry.previous, active.getName(), entry.cell.getA1Notation());
    if (entry.previous === '') entry.cell.setValue(entry.reading);
  });
  SpreadsheetApp.flush();
  if (!entries.every(function (entry) { return entry.cell.getValue() === entry.reading; })) throw new Error('Transferência incompleta. Provisório preservado para nova conferência.');
  // Read the complete source again: a manual edit during transfer must not vanish.
  if (sourceDigest !== kmDigest_(kmRows_(temp))) throw new Error('O provisório mudou durante a conferência. Ele foi mantido.');
  // Log is durable and read back before this deletion. Google version history also remains.
  book.deleteSheet(temp);
  return { transferred: entries.length, conflicts: 0 };
}
function kmRotateLocked_(book, today) {
  const properties = PropertiesService.getScriptProperties(), target = kmCompetence_(today), active = book.getSheetByName('KM Semanal');
  if (!active) throw new Error('Aba definitiva KM Semanal não encontrada.');
  let state = JSON.parse(properties.getProperty(KM_TRANSFER_STATE) || 'null');
  if (!state && kmMonth_(active) < target) {
    const old = kmMonth_(active), archive = kmArchive_(book, active, old);
    state = { ...archive, from: old, to: target, phase: 'archived' };
    properties.setProperty(KM_TRANSFER_STATE, JSON.stringify(state));
  }
  if (state) {
    const archive = book.getSheetById(state.archiveId);
    if (!archive || kmDigest_(archive.getDataRange().getValues()) !== state.digest) throw new Error('Histórico de segurança indisponível ou modificado. A virada foi interrompida.');
    if (state.phase === 'archived') {
      if (kmDigest_(active.getDataRange().getValues()) !== state.digest) throw new Error('A origem mudou após o arquivamento. Confira antes da virada; dados mantidos.');
      state.phase = 'preparing'; properties.setProperty(KM_TRANSFER_STATE, JSON.stringify(state));
    }
    if (state.phase === 'preparing') {
      // A retry may follow a partial clear. Any new manual reading stops it.
      const height = Math.max(1, state.rows - 4, active.getLastRow() - 4);
      const original = archive.getRange(5, 4, height, 5).getValues();
      const current = active.getRange(5, 4, height, 5).getValues();
      if (current.some(function (row, r) { return row.some(function (value, c) { return value !== '' && value !== original[r][c]; }); })) throw new Error('Há novas leituras durante a preparação. Virada interrompida para preservar esses dados.');
      kmPrepare_(active, state.to, 'Virada automática autorizada. Origem preservada integralmente em ' + archive.getName() + '.');
      state.phase = 'ready'; properties.setProperty(KM_TRANSFER_STATE, JSON.stringify(state));
    }
    const result = kmMerge_(book, state.to);
    if (result.conflicts) return result;
    properties.deleteProperty(KM_TRANSFER_STATE);
    return result;
  }
  if (kmMonth_(active) === target) return kmMerge_(book, target);
  return { transferred: 0, conflicts: 0 };
}
function updateWeeklyKmSafe_(payload) {
  if (String(payload.spreadsheetId) !== KM_TRANSFER_BOOK || (payload.sheetName && payload.sheetName !== 'KM Semanal')) throw new Error('Destino de KM semanal não autorizado.');
  const today = kmToday_(), day = String(payload.date || ''), plate = String(payload.plate || '').trim().toUpperCase();
  kmDate_(day);
  if (!plate || plate.startsWith('#')) throw new Error('Placa não informada.');
  if (payload.reading === null || String(payload.reading ?? '').trim() === '' || typeof payload.reading === 'boolean') throw new Error('Leitura de KM/horas inválida.');
  const reading = Number(payload.reading);
  if (!Number.isFinite(reading) || reading < 0) throw new Error('Leitura de KM/horas inválida.');
  if (day > today) throw new Error('A leitura não pode ter data futura.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const book = SpreadsheetApp.openById(KM_TRANSFER_BOOK), active = book.getSheetByName('KM Semanal'), month = day.slice(0, 7);
    // Reject an unrelated old/future date before any transition or write.
    if (month !== kmMonth_(active) && month !== today.slice(0, 7)) throw new Error('A data deve pertencer ao mês ativo ou ao mês calendário atual.');
    kmRotateLocked_(book, today);
    const provisional = month !== kmMonth_(active);
    // Do not turn an old month's submission into a provisional for that old month.
    if (provisional && month <= kmCompetence_(today)) throw new Error('Esta competência já foi arquivada. As leituras históricas foram preservadas.');
    const sheet = provisional ? kmProvisional_(book, month) : active;
    const vehicle = kmRow_(sheet, plate), week = kmWeek_(day), column = kmMondays_(month).indexOf(week) + 4;
    const cell = sheet.getRange(vehicle.row, column), previous = cell.getValue();
    if (previous !== '' && (typeof previous !== 'number' || reading < previous)) throw new Error('A leitura é menor ou incompatível com o valor já registrado nesta semana. Nenhum valor foi substituído.');
    if (previous !== reading) {
      kmLog_(book, provisional ? 'RECEBIDO NO PROVISÓRIO' : 'RECEBIDO NO DEFINITIVO', plate, day, week, reading, previous, sheet.getName(), cell.getA1Notation());
      cell.setValue(reading); SpreadsheetApp.flush();
      if (cell.getValue() !== reading) throw new Error('A gravação não conferiu. Atualize a tela antes de repetir.');
    }
    return json_({ ok: true, provisional, reading, previous: previous === '' ? null : previous, targetCell: cell.getA1Notation(), sheetName: sheet.getName(),
      message: provisional ? 'KM salvo no provisório de ' + month.slice(5) + '/' + month.slice(0, 4) + '. Após a virada no dia 4, será transferido e conferido na aba KM Semanal.' : 'KM semanal confirmado na aba definitiva. Histórico preservado.' });
  } finally { lock.releaseLock(); }
}
function runWeeklyKmMonthly_() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { console.log(JSON.stringify(kmRotateLocked_(SpreadsheetApp.openById(KM_TRANSFER_BOOK), kmToday_()))); }
  finally { lock.releaseLock(); }
}
function initializeWeeklyKmTransfer() {
  fleetDocumentUser_(); // Reuse the verified corporate/operator authorization.
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const book = SpreadsheetApp.openById(KM_TRANSFER_BOOK), today = kmToday_();
    kmLogSheet_(book);
    if (today.slice(0, 7) > kmCompetence_(today)) kmProvisional_(book, today.slice(0, 7));
    console.log(JSON.stringify(kmRotateLocked_(book, today)));
    if (!ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === 'runWeeklyKmMonthly_'; })) ScriptApp.newTrigger('runWeeklyKmMonthly_').timeBased().everyHours(1).create();
    console.log('KM semanal: transferência e conferência automáticas ativadas; leituras anteriores preservadas.');
  } finally { lock.releaseLock(); }
}
