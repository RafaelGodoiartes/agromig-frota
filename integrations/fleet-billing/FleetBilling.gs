// Added beside the current integration; never replace its existing Código.gs.
const FLEET_BILLING_REGISTRY = '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM';
const FLEET_BILLING_HEADERS = ['REVISÃO', 'ID DA OPERAÇÃO', 'DATA/HORA', 'USUÁRIO', 'TIPO', 'ID DO REGISTRO', 'REGISTRO JSON', 'ASSINATURA'];

function fleetBillingReader_() { return fleetDocumentReader_(); }
function fleetBillingWriter_() { return fleetDocumentUser_(); }
function fleetBillingDb_() {
  const id = PropertiesService.getScriptProperties().getProperty('FROTA_BILLING_DATABASE_ID');
  if (!id) throw new Error('Base de medições ainda não inicializada.');
  const file = DriveApp.getFileById(id);
  // New commercial records must not be stored in the publicly readable control.
  if (file.getSharingAccess() === DriveApp.Access.ANYONE || file.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK) throw new Error('A base de medições não pode estar pública. Confira as permissões no Drive.');
  const sheet = SpreadsheetApp.openById(id).getSheetByName('Histórico de Medições');
  if (!sheet || JSON.stringify(sheet.getRange(1, 1, 1, 8).getValues()[0]) !== JSON.stringify(FLEET_BILLING_HEADERS)) throw new Error('Estrutura da base de medições incompatível. Nenhum registro foi alterado.');
  return sheet;
}
function fleetBillingSignature_(values, previous) {
  const secret = PropertiesService.getScriptProperties().getProperty('FROTA_BILLING_SIGNATURE_KEY');
  if (!secret) throw new Error('Chave de integridade da base indisponível.');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(JSON.stringify(values) + '|' + previous, secret));
}
function fleetBillingStore_() {
  const sheet = fleetBillingDb_(), count = sheet.getLastRow() - 1;
  if (count > 20000) throw new Error('A base atingiu o limite de leitura segura. Solicite arquivamento antes de continuar.');
  const values = count ? sheet.getRange(2, 1, count, 8).getValues() : [];
  const projects = {}, measurements = {}, events = [], requests = {};
  let signature = '';
  values.forEach(function (row, index) {
    if (row[0] !== index + 1 || fleetBillingSignature_(row.slice(0, 7), signature) !== row[7]) throw new Error('O histórico financeiro foi alterado fora do módulo. Confira a integridade antes de continuar.');
    signature = row[7];
    const record = JSON.parse(row[6]);
    if (!['project', 'measurement'].includes(row[4]) || record.id !== row[5]) throw new Error('Registro financeiro incompatível.');
    (row[4] === 'project' ? projects : measurements)[record.id] = record;
    events.push({ revision: row[0], operationId: row[1], at: row[2], actor: row[3], type: row[4], record });
    requests[row[1]] = { revision: row[0], record };
  });
  return { sheet, projects: Object.values(projects), measurements: Object.values(measurements), events, requests, revision: values.length, signature };
}
function fleetBillingEquipment_() {
  const sheet = SpreadsheetApp.openById(FLEET_BILLING_REGISTRY).getSheetByName('Cadastro de Veículos');
  if (!sheet) throw new Error('Cadastro de Veículos não encontrado.');
  const headers = sheet.getRange(4, 1, 1, 10).getDisplayValues()[0];
  if (FleetBilling.key(headers[0]) !== 'PLACA' || !FleetBilling.key(headers[1]).includes('VEICULO')) throw new Error('Cabeçalhos do Cadastro não reconhecidos.');
  const rows = sheet.getLastRow() >= 5 ? sheet.getRange(5, 1, sheet.getLastRow() - 4, 10).getDisplayValues() : [];
  const items = {};
  rows.forEach(function (row) {
    if (!row[0] || String(row[0]).startsWith('#')) return;
    const id = FleetBilling.key(row[0]);
    if (items[id] && items[id].name !== row[1]) throw new Error('Placa/chassi duplicado com modelos diferentes no Cadastro: ' + row[0]);
    items[id] = { id, plate: row[0], name: row[1], model: row[1], prefix: row[9], unit: row[8] };
  });
  return Object.values(items);
}
function initializeFleetBilling() {
  fleetBillingWriter_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('FROTA_BILLING_DATABASE_ID')) return { initialized: true, message: 'Base existente preservada.' };
    const book = SpreadsheetApp.create('AGROMIG — Faturamento de Máquinas e Medições');
    const sheet = book.getSheets()[0]; sheet.setName('Histórico de Medições');
    sheet.getRange(1, 1, 1, 8).setValues([FLEET_BILLING_HEADERS]).setBackground('#1f7a46').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1); sheet.setColumnWidths(1, 6, 150); sheet.setColumnWidth(7, 500); sheet.setColumnWidth(8, 220);
    sheet.getRange(2, 2, sheet.getMaxRows() - 1, 7).setNumberFormat('@');
    const access = DriveApp.getFileById(book.getId()).getSharingAccess();
    if (access === DriveApp.Access.ANYONE || access === DriveApp.Access.ANYONE_WITH_LINK) throw new Error('A política do Drive criou uma base pública. Restrinja o acesso antes de ativar o módulo.');
    properties.setProperties({ FROTA_BILLING_DATABASE_ID: book.getId(), FROTA_BILLING_SIGNATURE_KEY: Utilities.getUuid() + Utilities.getUuid() });
    console.log('Base financeira criada: ' + book.getUrl());
    return { initialized: true, message: 'Base financeira privada criada, sem dados fictícios.' };
  } finally { lock.releaseLock(); }
}
function getFleetBillingState() {
  const actor = fleetBillingReader_(), store = fleetBillingStore_();
  return { revision: store.revision, projects: store.projects, measurements: store.measurements, equipment: fleetBillingEquipment_(), account: actor, canWrite: fleetDocumentCanUpload_(actor) };
}
function fleetBillingMutate_(input, type, deleting) {
  const actor = fleetBillingWriter_();
  if (!input || !/^[a-f0-9-]{36}$/i.test(String(input.operationId || ''))) throw new Error('Identificador da operação inválido.');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const store = fleetBillingStore_();
    if (store.requests[input.operationId]) return store.requests[input.operationId];
    if (input.revision !== store.revision) throw new Error('Os dados foram atualizados por outra operação. Atualize a tela e confira antes de salvar novamente.');
    const collection = type === 'project' ? store.projects : store.measurements;
    const previous = input.id ? collection.find(function (row) { return row.id === input.id; }) : null;
    if (input.id && (!previous || previous.deleted)) throw new Error('Registro não encontrado ou já excluído.');
    let record;
    if (deleting) {
      if (!previous || input.confirmDelete !== true) throw new Error('Confirme a exclusão do registro.');
      if (type === 'project' && store.measurements.some(function (row) { return !row.deleted && row.projectId === previous.id; })) throw new Error('O projeto possui medições. Exclua as medições antes de excluir o projeto.');
      record = { ...previous, deleted: true };
    } else {
      const equipment = fleetBillingEquipment_();
      record = type === 'project' ? FleetBilling.project(input, store.projects, previous) : FleetBilling.measurement(input, store.projects, equipment, store.measurements, previous);
      if (type === 'project' && record.equipmentIds.some(function (id) { return !equipment.some(function (item) { return item.id === id; }); })) throw new Error('Equipamento não encontrado no Cadastro.');
      if (type === 'project' && previous && store.measurements.some(function (row) { return !row.deleted && row.projectId === previous.id && (row.start < record.start || (record.end && row.end > record.end)); })) throw new Error('As novas datas do projeto deixariam medições existentes fora do contrato.');
    }
    record = { ...record, id: previous ? previous.id : Utilities.getUuid(), version: previous ? previous.version + 1 : 1, createdAt: previous ? previous.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: actor };
    const values = [store.revision + 1, input.operationId, record.updatedAt, actor, type, record.id, JSON.stringify(record)];
    const signature = fleetBillingSignature_(values, store.signature);
    // One append is the commit. Edits and deletes add immutable revisions.
    if (store.revision + 2 > store.sheet.getMaxRows()) store.sheet.insertRowsAfter(store.sheet.getMaxRows(), 500);
    store.sheet.getRange(store.revision + 2, 2, 1, 7).setNumberFormat('@');
    store.sheet.getRange(store.revision + 2, 1, 1, 8).setValues([[...values, signature]]);
    SpreadsheetApp.flush();
    return { revision: store.revision + 1, record };
  } finally { lock.releaseLock(); }
}
function saveFleetBillingProject(input) { return fleetBillingMutate_(input, 'project', false); }
function saveFleetBillingMeasurement(input) { return fleetBillingMutate_(input, 'measurement', false); }
function deleteFleetBillingProject(input) { return fleetBillingMutate_(input, 'project', true); }
function deleteFleetBillingMeasurement(input) { return fleetBillingMutate_(input, 'measurement', true); }
function getFleetBillingHistory(type, id) {
  fleetBillingReader_();
  if (!['project', 'measurement'].includes(type)) throw new Error('Tipo de registro inválido.');
  return fleetBillingStore_().events.filter(function (event) { return event.type === type && event.record.id === id; });
}
function fleetBillingPortal_(e) {
  try {
    fleetBillingReader_();
    const template = HtmlService.createTemplateFromFile('FleetBillingPortal');
    const nonce = String(e && e.parameter && e.parameter.frameId || '');
    template.frameId = /^[a-f0-9-]{36}$/i.test(nonce) ? nonce : '';
    return template.evaluate().setTitle('Faturamento — Projetos e Medições · AGROMIG').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) { return HtmlService.createHtmlOutput('<h2>Faturamento — Projetos e Medições</h2><p>Entre com sua conta corporativa @agromig.com.br. Acesso e gravações dependem das permissões existentes.</p>'); }
}
