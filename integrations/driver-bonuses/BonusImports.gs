function previewBonusImport(input) {
  return bonusMutate_('Prévia de importação', data => {
    const driver = bonusDriver_(input.driver), month = bonusMonth_(input.month);
    if (!['Circulação', 'Velocidade', 'Lavagem', 'Multas', 'Utilização'].includes(input.category)) throw new Error('Categoria de importação inválida.');
    if (typeof Drive === 'undefined' || !Drive.Files?.create) throw new Error('Ative o serviço avançado Google Drive v3 na integração antes de importar Excel.');
    const folder = bonusDestination_(driver, month, 'Relatórios importados');
    const original = bonusUpload_(folder, input.file, true);
    const converted = Drive.Files.create({ name: 'Leitura - ' + original.name, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [folder.getId()] }, DriveApp.getFileById(original.id).getBlob(), { fields: 'id' });
    const workbook = SpreadsheetApp.openById(converted.id);
    const tabs = workbook.getSheets().map(sheet => ({ name: sheet.getName(), rows: sheet.getLastRow(), cols: sheet.getLastColumn() }));
    const entry = { id: Utilities.getUuid(), driver: driver.name, month, category: input.category, original, convertedId: converted.id, status: 'Prévia', tabs };
    data.imports.push(entry);
    const sheet = workbook.getSheets()[0];
    return { ...entry, preview: sheet.getRange(1, 1, Math.min(11, sheet.getLastRow()), Math.min(40, sheet.getLastColumn())).getDisplayValues() };
  });
}
function confirmBonusImport(input) {
  return bonusMutate_('Confirmação de importação', data => {
    const imported = data.imports.find(row => row.id === input.id);
    if (!imported || imported.status !== 'Prévia') throw new Error('Importação inexistente ou já confirmada.');
    const sheet = SpreadsheetApp.openById(imported.convertedId).getSheetByName(input.sheet);
    if (!sheet || sheet.getLastRow() > 20000 || sheet.getLastColumn() > 100) throw new Error('Aba inexistente ou relatório acima de 20.000 linhas/100 colunas.');
    const values = sheet.getDataRange().getDisplayValues(), map = input.mapping || {};
    const field = (row, key) => Number.isInteger(map[key]) && map[key] >= 0 && map[key] < sheet.getLastColumn() ? row[map[key]] : '';
    const rules = bonusRulesFor_(data.ruleVersions, imported.month), rows = [], errors = [];
    const registeredPlates = new Set(bonusVehicles_().map(vehicle => vehicle.plate));
    const seen = new Set(data.operations.map(row => row.identity));
    let duplicates = 0;
    values.slice(1).forEach((row, index) => {
      if (row.every(value => !value.trim())) return;
      const date = bonusDate_(field(row, 'date')), plate = bonusKey_(field(row, 'plate'));
      const time = field(row, 'time').slice(0, 5);
      const reason = [];
      if (!date || date.slice(0, 7) !== imported.month) reason.push('Data inválida ou fora da competência');
      if (!registeredPlates.has(plate)) reason.push('Placa fora do Cadastro');
      if (['Circulação', 'Velocidade', 'Multas'].includes(imported.category) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) reason.push('Horário inválido');
      const result = { id: Utilities.getUuid(), category: imported.category, date, plate, time, driver: imported.driver,
        description: field(row, 'description'), evidenceId: imported.original.id, importedId: imported.id,
        authorized: false, confirmed: false, contested: false };
      if (imported.category === 'Velocidade') {
        result.speed = bonusNumber_(field(row, 'speed'));
        const type = bonusKey_(field(row, 'vehicleType'));
        result.limit = ['CARRO', 'CAMINHONETE'].includes(type) ? rules.carLimit : ['ONIBUS', 'MICROONIBUS'].includes(type) ? rules.busLimit : type ? rules.otherLimit : null;
        result.roadLimit = bonusNumber_(field(row, 'roadLimit'));
        if (result.speed === null || result.limit === null) reason.push('Informe velocidade e classe do veículo');
      }
      if (imported.category === 'Multas') { result.infraction = field(row, 'infraction'); result.value = bonusNumber_(field(row, 'value')); if (!result.infraction || result.value === null) reason.push('Infração/valor ausentes'); }
      if (imported.category === 'Utilização') { result.from = date; result.to = bonusDate_(field(row, 'to')); if (!result.to || result.to < date) reason.push('Fim da responsabilidade inválido'); }
      result.identity = [imported.category, plate, date, time, result.infraction || '', result.speed ?? '', result.description, result.driver].join('|');
      if (reason.length) errors.push({ line: index + 2, reasons: reason });
      else if (seen.has(result.identity)) duplicates += 1;
      else { seen.add(result.identity); rows.push(result); }
    });
    if (errors.length) return { confirmed: false, errors, duplicates, validRows: rows.length };
    // Preserve original files even when all rows were already imported.
    data.operations.push(...rows);
    imported.status = 'Confirmada'; imported.mapping = map; imported.sheet = input.sheet; imported.rows = rows.length;
    return { confirmed: true, rows: rows.length, duplicates };
  });
}
function saveBonusOperation(input) {
  return bonusMutate_('Registro operacional', data => {
    const driver = bonusDriver_(input.driver), month = bonusMonth_(input.month), date = bonusDate_(input.date), plate = bonusPlate_(input.plate);
    if (!date || date.slice(0, 7) !== month || !['Lavagem', 'Multas'].includes(input.category)) throw new Error('Data/categoria inválida.');
    if (input.category === 'Multas' && (!input.infraction || bonusNumber_(input.value) === null)) throw new Error('Informe número e valor da infração.');
    const identity = [input.category, plate, date, input.infraction || '', input.description || ''].join('|');
    if (data.operations.some(row => row.identity === identity)) throw new Error('Registro operacional duplicado.');
    const evidence = input.file ? bonusUpload_(bonusDestination_(driver, month, input.category), input.file, false) : null;
    const row = { id: Utilities.getUuid(), identity, driver: driver.name, category: input.category, date, plate,
      time: String(input.time || ''), description: String(input.description || ''), infraction: String(input.infraction || ''),
      value: bonusNumber_(input.value), location: String(input.location || ''), notes: String(input.notes || ''), evidence,
      evidenceId: evidence?.id || null, confirmed: false, contested: false };
    data.operations.push(row); return row;
  });
}
function reviewBonusOperation(id, decision, justification) {
  return bonusMutate_('Revisão de ocorrência', (data, actor) => {
    const row = data.operations.find(row => row.id === id);
    if (!row || !justification || !['Confirmada', 'Contestada', 'Exceção autorizada', 'Pendente'].includes(decision)) throw new Error('Informe uma ocorrência, decisão e justificativa.');
    if (decision === 'Confirmada' && !row.evidenceId) throw new Error('Ocorrência sem documento comprobatório.');
    if (row.category === 'Utilização') {
      const existing = data.assignments.find(assignment => assignment.operationId === row.id);
      if (decision === 'Confirmada') {
        if (data.assignments.some(assignment => assignment.active !== false && assignment.operationId !== row.id && assignment.plate === row.plate && assignment.from <= row.to && assignment.to >= row.from)) throw new Error('Responsabilidade sobreposta. Confira antes de confirmar.');
        if (existing) existing.active = true;
        else data.assignments.push({ id: Utilities.getUuid(), operationId: row.id, driver: row.driver, plate: row.plate, from: row.from, to: row.to, active: true, evidenceId: row.evidenceId, justification });
      } else if (existing) existing.active = false;
    }
    row.confirmed = decision === 'Confirmada'; row.contested = decision === 'Contestada'; row.authorized = decision === 'Exceção autorizada';
    row.review = { actor, decision, justification, at: new Date().toISOString() }; return row;
  });
}
function bonusChecklists_(month) {
  const records = []; let complete = false;
  for (let page = 1; page <= 30; page++) {
    const response = UrlFetchApp.fetch('https://five.epicollect.net/api/export/entries/checklist-de-veiculos-e-maquinas?per_page=500&sort_by=created_at&sort_order=DESC&format=json&headers=true&page=' + page, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) break;
    const entries = JSON.parse(response.getContentText())?.data?.entries;
    if (!Array.isArray(entries)) break;
    entries.forEach(row => {
      const timestamp = row.created_at || row.uploaded_at;
      const date = timestamp && Number.isFinite(new Date(timestamp).getTime()) ? Utilities.formatDate(new Date(timestamp), 'America/Sao_Paulo', 'yyyy-MM-dd') : '';
      if (date.slice(0, 7) !== month) return;
      const get = parts => String(row[Object.keys(row).find(key => parts.some(part => bonusKey_(key).includes(part)))] || '');
      records.push({ id: row.ec5_uuid, date, driver: get(['NOMEDOCONDUTOR', 'CONDUTOR', 'MOTORISTA']), plate: get(['PLACAS', 'PLACA']), valid: true, original: row });
    });
    const lastDate = entries.length ? bonusDate_(entries[entries.length - 1].created_at) : '';
    if (entries.length < 500 || (lastDate && lastDate.slice(0, 7) < month)) { complete = true; break; }
  }
  return { records, complete };
}
function bonusEvidence_(data, driver, month, input) {
  const checklist = bonusChecklists_(month);
  const operations = data.operations.filter(row => row.date.slice(0, 7) === month);
  const confirmedImports = data.imports.filter(row => row.month === month && bonusNameKey_(row.driver) === bonusNameKey_(driver) && row.status === 'Confirmada');
  const covered = category => input.coverage?.[category] === true && (confirmedImports.some(row => row.category === category) || (category === 'Lavagem' && operations.some(row => row.category === category)) || (category === 'Multas' && input.noFinesConfirmed === true));
  return { assignments: data.assignments, checklists: checklist.records, checklistComplete: checklist.complete,
    circulation: operations.filter(row => row.category === 'Circulação'), circulationComplete: covered('Circulação'),
    speed: operations.filter(row => row.category === 'Velocidade'), speedComplete: covered('Velocidade'),
    washes: operations.filter(row => row.category === 'Lavagem'), washComplete: covered('Lavagem'),
    fines: operations.filter(row => row.category === 'Multas'), finesComplete: covered('Multas'),
    coverage: input.coverage, evidenceIds: [...new Set(operations.map(row => row.evidenceId).filter(Boolean))],
    checklistSnapshot: checklist.records };
}
function reevaluateBonus(id, input) {
  return bonusMutate_('Reavaliação de KPIs', data => {
    const row = data.records.find(row => row.id === id);
    if (!row || row.category !== 'KPIs' || ['Aprovado', 'Pago'].includes(row.status)) throw new Error('Reabra o registro em análise antes de recalcular.');
    const evidence = bonusEvidence_(data, row.driver, row.month, input);
    row.calculation = bonusEvaluate_({ ...input, driver: row.driver, month: row.month }, evidence, row.rules);
    row.calculation.cents = row.calculation.provisionalCents;
    row.details = { ...row.details, workedDates: input.workedDates, washDates: input.washDates, plates: input.plates, evidenceIds: evidence.evidenceIds, checklistSnapshot: evidence.checklistSnapshot };
    return row;
  });
}
