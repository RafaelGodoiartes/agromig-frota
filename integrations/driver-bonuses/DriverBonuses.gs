const BONUS_USER = 'frota@agromig.com.br';
const BONUS_ROOT_ID = '1d_oa-vDHlkolPtQ4IL5oQvPxSjQ8i-8I';
const BONUS_REGISTRY_ID = '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM';
const BONUS_RECIPIENTS = ['mariana@agromig.com.br', 'eduardo@agromig.com.br', 'lourisvaldo@agromig.com.br', 'financeiro@agromig.com.br'];

function bonusUser_() {
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  if (email !== BONUS_USER) throw new Error('Acesso permitido somente a frota@agromig.com.br, com identidade Google verificada.');
  return email;
}
function bonusPrivate_(folder) {
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('A pasta de destino não está restrita. Confira o compartilhamento no Drive antes de gravar dados financeiros.');
  return folder;
}
function bonusRoot_() { return bonusPrivate_(DriveApp.getFolderById(BONUS_ROOT_ID)); }
function bonusFolder_(parent, name) {
  bonusPrivate_(parent);
  const items = parent.getFolders(), matches = [];
  while (items.hasNext()) { const folder = items.next(); if (bonusKey_(folder.getName()) === bonusKey_(name)) matches.push(folder); }
  if (matches.length > 1) throw new Error('Mais de uma pasta corresponde a ' + name + '. Organize o Drive antes de continuar.');
  return matches.length ? bonusPrivate_(matches[0]) : bonusPrivate_(parent.createFolder(name));
}
function bonusStore_() {
  const root = bonusRoot_(), iterator = root.getFilesByName('controle_bonificacoes_v1.json');
  if (!iterator.hasNext()) return { version: 1, revision: 0, records: [], operations: [], assignments: [], imports: [], reports: [], mailHistory: [], ruleVersions: [{ from: '2026-01', rules: { ...BONUS_DEFAULT_RULES } }], audit: [] };
  const file = iterator.next();
  if (iterator.hasNext()) throw new Error('Base de bonificações duplicada no Drive.');
  const data = JSON.parse(file.getBlob().getDataAsString());
  if (data.version !== 1) throw new Error('Versão da base incompatível.');
  const secret = PropertiesService.getScriptProperties().getProperty('BONUS_DATA_SIGNATURE_KEY');
  if (!secret || !data.signature || bonusSignature_(data, secret) !== data.signature) throw new Error('A base foi alterada fora do módulo ou perdeu sua assinatura. Nenhum pagamento ou envio será liberado até a conferência.');
  data.fileId = file.getId();
  return data;
}
function bonusSignature_(data, secret) {
  const payload = { ...data }; delete payload.signature; delete payload.fileId;
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(JSON.stringify(payload), secret));
}
function bonusPersist_(data, action, actor) {
  data.revision += 1;
  data.audit.push({ id: Utilities.getUuid(), action, actor, at: new Date().toISOString(), revision: data.revision });
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty('BONUS_DATA_SIGNATURE_KEY');
  if (!secret) { secret = Utilities.getUuid() + Utilities.getUuid(); properties.setProperty('BONUS_DATA_SIGNATURE_KEY', secret); }
  data.signature = bonusSignature_(data, secret);
  const root = bonusRoot_();
  // An immutable revision is written before changing the current state.
  const archive = bonusFolder_(root, 'Histórico de Bonificações');
  archive.createFile(Utilities.newBlob(JSON.stringify(data), 'application/json', 'revisao-' + data.revision + '-' + Utilities.getUuid() + '.json'));
  if (data.fileId) DriveApp.getFileById(data.fileId).setContent(JSON.stringify(data));
  else root.createFile(Utilities.newBlob(JSON.stringify(data), 'application/json', 'controle_bonificacoes_v1.json'));
}
function bonusMutate_(action, fn) {
  const actor = bonusUser_(), lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { const data = bonusStore_(); const result = fn(data, actor); bonusPersist_(data, action, actor); return result; }
  finally { lock.releaseLock(); }
}
function bonusDrivers_() {
  const sheet = SpreadsheetApp.openById(BONUS_REGISTRY_ID).getSheetByName('Motoristas');
  if (!sheet) throw new Error('Aba Motoristas não encontrada.');
  const seen = {};
  return sheet.getRange(5, 1, Math.max(sheet.getLastRow() - 4, 1), 1).getDisplayValues().flat().filter(name => name.trim()).flatMap(name => {
    const id = bonusNameKey_(name); if (seen[id]) return []; seen[id] = true;
    return [{ id, name, registration: null, job: null }];
  });
}
function bonusDriver_(name) {
  const matches = bonusDrivers_().filter(row => row.id === bonusNameKey_(name));
  if (matches.length !== 1) throw new Error('Selecione um motorista existente na aba Motoristas.');
  return matches[0];
}
function bonusVehicles_() {
  const sheet = SpreadsheetApp.openById(BONUS_REGISTRY_ID).getSheetByName('Cadastro de Veículos');
  const seen = {};
  return sheet.getRange(5, 1, Math.max(sheet.getLastRow() - 4, 1), 2).getDisplayValues().filter(row => row[0]).flatMap(row => {
    const plate = bonusKey_(row[0]); if (seen[plate]) return []; seen[plate] = true;
    return [{ plate, model: row[1] }];
  });
}
function bonusPlate_(plate) {
  const key = bonusKey_(plate);
  if (!bonusVehicles_().some(row => row.plate === key)) throw new Error('Placa não encontrada no Cadastro de Veículos.');
  return key;
}
function bonusDestination_(driver, month, category, request) {
  let parent = bonusFolder_(bonusRoot_(), driver.name);
  parent = bonusFolder_(parent, 'Bonificações');
  parent = bonusFolder_(parent, category);
  parent = bonusFolder_(parent, month.slice(0, 4));
  parent = bonusFolder_(parent, month.slice(5));
  return request ? bonusFolder_(parent, request) : parent;
}
function bonusUpload_(folder, file, excel) {
  if (!file?.base64 || !/^[A-Za-z0-9+/=]+$/.test(file.base64)) throw new Error('Arquivo inválido.');
  const types = excel ? ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'] : ['image/jpeg', 'image/png', 'application/pdf'];
  if (!types.includes(file.mimeType)) throw new Error(excel ? 'Envie Excel XLSX ou XLS.' : 'Envie JPG, PNG ou PDF.');
  const bytes = Utilities.base64Decode(file.base64);
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('O arquivo deve ter até 8 MB.');
  const blob = Utilities.newBlob(bytes, file.mimeType, String(file.name || 'documento').replace(/[\\/]/g, '-').slice(0, 140));
  const original = bonusPrivate_(folder).createFile(blob);
  return { id: original.getId(), name: original.getName(), url: original.getUrl(), mimeType: file.mimeType };
}
function bonusPortal_() {
  try { bonusUser_(); return HtmlService.createHtmlOutputFromFile('DriverBonusForm').setTitle('Bonificações dos Motoristas — AGROMIG'); }
  catch (error) { return HtmlService.createHtmlOutput('<h2>Bonificações dos Motoristas</h2><p>Acesso restrito à conta frota@agromig.com.br.</p>').setTitle('Acesso restrito'); }
}
function getDriverBonusesState() {
  bonusUser_(); const state = bonusStore_();
  return { ...state, fileId: undefined, signature: undefined, drivers: bonusDrivers_(), vehicles: bonusVehicles_(), account: BONUS_USER, recipients: BONUS_RECIPIENTS,
    schedulerEnabled: PropertiesService.getScriptProperties().getProperty('BONUS_SCHEDULER_OWNER') === BONUS_USER };
}
function saveDriverBonus(input) {
  return bonusMutate_('Registro de bonificação', data => {
    const driver = bonusDriver_(input.driver), month = bonusMonth_(input.month);
    const rules = bonusRulesFor_(data.ruleVersions, month);
    if (!['Viagem', 'Cargo de confiança', 'KPIs'].includes(input.category)) throw new Error('Categoria inválida.');
    const duplicateKey = driver.id + '|' + month + '|' + input.category + (input.category === 'Viagem' ? '|' + bonusKey_(input.request) : '');
    if (data.records.some(row => row.duplicateKey === duplicateKey)) throw new Error('Bonificação duplicada para este motorista/requisição/competência.');
    let calculation, evidence = null, details = {};
    if (input.category === 'Viagem') {
      const date = bonusDate_(input.date), plate = bonusPlate_(input.plate);
      if (!date || date.slice(0, 7) !== month || !String(input.request || '').trim() || !input.origin || !input.destination) throw new Error('Confira data, requisição, origem e destino.');
      calculation = bonusTripAmount_(input.initialKm, input.finalKm, rules.kmCents);
      details = { date, plate, request: String(input.request).trim(), origin: String(input.origin), destination: String(input.destination), initialKm: bonusNumber_(input.initialKm), finalKm: bonusNumber_(input.finalKm) };
      if (input.file) evidence = bonusUpload_(bonusDestination_(driver, month, 'Viagens', details.request), input.file, false);
    } else if (input.category === 'Cargo de confiança') {
      if (!String(input.justification || '').trim() || !String(input.authorization || '').trim()) throw new Error('Informe justificativa e autorização do cargo de confiança.');
      calculation = { cents: rules.trustCents }; details = { authorization: String(input.authorization) };
      if (input.file) evidence = bonusUpload_(bonusDestination_(driver, month, 'Cargo de confiança'), input.file, false);
    } else {
      const reviewed = bonusEvidence_(data, driver.name, month, input);
      calculation = bonusEvaluate_({ ...input, driver: driver.name }, reviewed, rules);
      calculation.cents = calculation.provisionalCents;
      details = { workedDates: input.workedDates, washDates: input.washDates, plates: input.plates, coverage: reviewed.coverage, evidenceIds: reviewed.evidenceIds, checklistSnapshot: reviewed.checklistSnapshot };
    }
    const record = { id: Utilities.getUuid(), duplicateKey, driver: driver.name, driverId: driver.id, month, category: input.category,
      calculation, details, rules: { ...rules }, evidence, justification: String(input.justification || ''), notes: String(input.notes || ''),
      status: input.category === 'Viagem' && !evidence ? 'Aguardando documentos' : 'Rascunho', createdAt: new Date().toISOString(), actions: [] };
    data.records.push(record); return record;
  });
}
function transitionDriverBonus(id, status, justification, reviewed) {
  return bonusMutate_('Alteração de status ' + status, (data, actor) => {
    const record = data.records.find(row => row.id === id);
    if (!record || !String(justification || '').trim()) throw new Error('Selecione um registro e informe justificativa.');
    const next = { 'Rascunho': ['Aguardando documentos', 'Em análise'], 'Aguardando documentos': ['Em análise'], 'Em análise': ['Aguardando documentos', 'Aguardando aprovação', 'Rejeitado'], 'Aguardando aprovação': ['Aprovado', 'Rejeitado', 'Em análise'], 'Aprovado': ['Pago', 'Em análise'], 'Rejeitado': ['Em análise'], 'Pago': ['Aprovado'] };
    if (!next[record.status]?.includes(status)) throw new Error('Transição não permitida.');
    if (status === 'Aprovado' && (!reviewed || record.calculation.pending?.length || (record.category === 'Viagem' && !record.evidence))) throw new Error('Confira as evidências e resolva todas as pendências antes de aprovar.');
    // Marking Paid is a bookkeeping action, not a financial transfer.
    record.actions.push({ from: record.status, to: status, justification: String(justification), actor, at: new Date().toISOString() });
    record.status = status;
    if (status === 'Aprovado') record.approved = { cents: record.calculation.cents, calculation: JSON.parse(JSON.stringify(record.calculation)), actor, at: new Date().toISOString() };
    if (status === 'Em análise') delete record.approved;
    return record;
  });
}
function addBonusEvidence(id, file) {
  return bonusMutate_('Anexo de evidência', data => {
    const record = data.records.find(row => row.id === id);
    if (!record || ['Aprovado', 'Pago'].includes(record.status)) throw new Error('Registro inexistente ou aprovado; reabra a análise antes de alterar.');
    record.evidence = bonusUpload_(bonusDestination_(bonusDriver_(record.driver), record.month, record.category === 'Viagem' ? 'Viagens' : record.category, record.details.request), file, false);
    return record;
  });
}
function saveBonusAssignment(input) {
  return bonusMutate_('Histórico de responsabilidade', data => {
    const driver = bonusDriver_(input.driver), plate = bonusPlate_(input.plate), from = bonusDate_(input.from), to = bonusDate_(input.to);
    if (!from || !to || to < from || !input.justification) throw new Error('Confira período e justificativa.');
    if (data.assignments.some(row => row.active !== false && row.plate === plate && row.from <= to && row.to >= from)) throw new Error('Período de responsabilidade sobreposto; confira o histórico.');
    const row = { id: Utilities.getUuid(), driver: driver.name, plate, from, to, justification: input.justification };
    data.assignments.push(row); return row;
  });
}
function saveBonusRules(input) {
  return bonusMutate_('Configuração por competência', data => {
    const from = bonusMonth_(input.from), rules = { ...BONUS_DEFAULT_RULES, ...input.rules };
    if (data.records.some(row => row.month >= from)) throw new Error('Há registros nessa competência ou posteriores. Escolha vigência futura para preservar as regras históricas.');
    ['kmCents', 'trustCents', 'checklistCents', 'circulationCents', 'speedCents', 'washCents', 'finesCents', 'carLimit', 'busLimit', 'otherLimit'].forEach(key => { if (!Number.isSafeInteger(rules[key]) || rules[key] < 0) throw new Error('Configuração numérica inválida: ' + key); });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rules.allowedStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rules.allowedEnd) || rules.allowedEnd <= rules.allowedStart) throw new Error('Horário autorizado inválido.');
    if (rules.sendDay !== 10 || rules.sendHour !== 8) throw new Error('O agendador desta versão usa dia 10 às 08h; não altere apenas a tela.');
    data.ruleVersions.push({ from, rules }); return rules;
  });
}
