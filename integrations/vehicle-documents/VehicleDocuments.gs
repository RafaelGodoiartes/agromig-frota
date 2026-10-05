// Install alongside (not in place of) the existing fleet integration.
const FLEET_DOCUMENT_ROOT = '1zm7M3-8ucbSx2HwNz4Ri6Ps-cbzWTT41'; // 03 - OPERAÇÃO
const FLEET_DOCUMENT_REGISTRY = '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM';

function fleetDocumentReader_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  // Verified Google identity only; do not accept lookalike domains or posted emails.
  if (!/^[^@\s]+@agromig\.com\.br$/.test(email)) throw new Error('Acesso restrito a contas Google @agromig.com.br. Entre com seu e-mail corporativo.');
  return email;
}

function fleetDocumentCanUpload_(email) {
  const configured = PropertiesService.getScriptProperties().getProperty('FROTA_DOCUMENT_UPLOAD_EMAILS') || '';
  const allowed = configured.split(/[,;\n]/).map(function (item) { return item.trim().toLowerCase(); }).filter(Boolean);
  return allowed.indexOf(email) !== -1;
}

function fleetDocumentUser_() {
  const email = fleetDocumentReader_();
  // Never trust getEffectiveUser(), a posted email, a PIN or a caller-supplied folder URL.
  if (!fleetDocumentCanUpload_(email)) throw new Error('Acesso restrito ao setor de Frotas para enviar documentos ou criar pastas. Sua conta pode consultar os arquivos permitidos no Drive.');
  return email;
}

function getFleetDocumentAccess() {
  return { canUpload: fleetDocumentCanUpload_(fleetDocumentReader_()) };
}

function fleetDocumentPortal_() {
  try {
    fleetDocumentReader_();
    return HtmlService.createHtmlOutputFromFile('VehicleDocumentForm').setTitle('Documentos da Frota — Agromig');
  } catch (error) {
    return HtmlService.createHtmlOutput('<h2>Documentos da Frota — Agromig</h2><p>Acesso restrito a contas Google @agromig.com.br. Entre com seu e-mail corporativo. A integração não identificou uma conta com permissão.</p><p>Não envie senha ou token pelo site. O portal deve executar como o usuário que acessa.</p>').setTitle('Acesso restrito');
  }
}

function fleetDocumentPortalStatus_() {
  // Public readiness reveals neither emails nor Drive folders.
  return ContentService.createTextOutput(JSON.stringify({ documentPortalReady: Boolean(PropertiesService.getScriptProperties().getProperty('FROTA_DOCUMENT_UPLOAD_EMAILS')) })).setMimeType(ContentService.MimeType.JSON);
}

function fleetDocumentKey_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function fleetDocumentNameMatches_(name, plate) {
  const key = fleetDocumentKey_(plate);
  if (!key) return false;
  const normalized = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return new RegExp('(?:^|[^A-Z0-9])' + key.split('').join('[\\s_.-]*') + '(?:$|[^A-Z0-9])').test(normalized);
}

function fleetDocumentVehicles_() {
  const sheet = SpreadsheetApp.openById(FLEET_DOCUMENT_REGISTRY).getSheetByName('Cadastro de Veículos');
  if (!sheet) throw new Error('Cadastro de Veículos não encontrado.');
  const rows = sheet.getLastRow() >= 5 ? sheet.getRange(5, 1, sheet.getLastRow() - 4, 2).getDisplayValues() : [];
  const seen = {};
  return rows.filter(function (row) {
    const key = fleetDocumentKey_(row[0]);
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  }).map(function (row) { return { plate: row[0], model: row[1] }; });
}

function getFleetDocumentVehicles() {
  fleetDocumentReader_();
  return fleetDocumentVehicles_();
}

function fleetDocumentRegisteredPlate_(plate) {
  const key = fleetDocumentKey_(plate);
  if (!key || !fleetDocumentVehicles_().some(function (row) { return fleetDocumentKey_(row.plate) === key; })) throw new Error('Selecione uma placa do Cadastro de Veículos.');
  return key;
}

function fleetDocumentVehicleFolders_(plate) {
  const key = fleetDocumentRegisteredPlate_(plate);
  const root = DriveApp.getFolderById(FLEET_DOCUMENT_ROOT);
  // Bounded search only within Operação. Check shallow levels first to avoid
  // traversing every document category when vehicle folders are already found.
  let queue = [{ folder: root, path: root.getName() }];
  let inspected = 0;
  for (let depth = 0; depth < 3 && queue.length; depth++) {
    const next = [];
    const matches = [];
    queue.forEach(function (entry) {
      const children = entry.folder.getFolders();
      while (children.hasNext()) {
        const child = children.next();
        if (++inspected > 600) throw new Error('Muitas pastas em Operação. Ajuste a estrutura de veículos antes de enviar; a busca não foi concluída.');
        if (child.isTrashed()) continue;
        const path = entry.path + ' / ' + child.getName();
        if (fleetDocumentNameMatches_(child.getName(), key)) matches.push({ id: child.getId(), name: child.getName(), path: path });
        else next.push({ folder: child, path: path });
      }
    });
    if (matches.length) return matches.sort(function (a, b) { return a.path.localeCompare(b.path); });
    queue = next;
  }
  return [];
}

function getFleetDocumentFolders(plate) {
  fleetDocumentReader_();
  return fleetDocumentVehicleFolders_(plate);
}

function fleetDocumentVehicleFolder_(plate, id) {
  const candidate = fleetDocumentVehicleFolders_(plate).find(function (row) { return row.id === String(id); });
  if (!candidate) throw new Error('A pasta selecionada não corresponde à placa em Operação.');
  return DriveApp.getFolderById(candidate.id);
}

function fleetDocumentSubfolders_(parent) {
  const rows = [{ id: parent.getId(), name: 'Pasta principal do veículo', path: parent.getName() }];
  let queue = [{ folder: parent, path: parent.getName() }];
  for (let depth = 0; depth < 3 && queue.length; depth++) {
    const next = [];
    queue.forEach(function (entry) {
      const children = entry.folder.getFolders();
      while (children.hasNext()) {
        const child = children.next();
        if (child.isTrashed()) continue;
        if (rows.length >= 100) throw new Error('Mais de 100 subpastas no veículo. Organize as pastas antes de enviar.');
        const path = entry.path + ' / ' + child.getName();
        rows.push({ id: child.getId(), name: child.getName(), path: path });
        next.push({ folder: child, path: path });
      }
    });
    queue = next;
  }
  return rows;
}

function getFleetDocumentDestinations(plate, vehicleFolderId) {
  fleetDocumentReader_();
  return fleetDocumentSubfolders_(fleetDocumentVehicleFolder_(plate, vehicleFolderId));
}

function getFleetDocumentFiles(plate, vehicleFolderId, folderId) {
  fleetDocumentReader_();
  const vehicle = fleetDocumentVehicleFolder_(plate, vehicleFolderId);
  const destination = fleetDocumentSubfolders_(vehicle).find(function (row) { return row.id === String(folderId); });
  if (!destination) throw new Error('Pasta fora do veículo selecionado.');
  const iterator = DriveApp.getFolderById(destination.id).getFiles();
  const files = [];
  const seen = {};
  let inspected = 0;
  // Metadata only, bounded work. Google remains responsible for opening or
  // downloading each file with the visitor's existing Drive permissions.
  while (iterator.hasNext() && inspected < 200) {
    const file = iterator.next();
    inspected++;
    if (file.isTrashed() || seen[file.getId()]) continue;
    seen[file.getId()] = true;
    files.push({ id: file.getId(), name: file.getName(), url: file.getUrl(),
      mimeType: file.getMimeType(), size: file.getSize(), updatedAt: file.getLastUpdated().toISOString() });
  }
  return { files: files.sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR'); }),
    path: destination.path, folderUrl: 'https://drive.google.com/drive/folders/' + destination.id,
    truncated: iterator.hasNext() };
}

function fleetDocumentSafeName_(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 120 || /[\\/<>\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new Error('Nome inválido. Use até 120 caracteres, sem barras.');
  return name;
}

function createFleetDocumentFolder(plate, vehicleFolderId, name) {
  fleetDocumentUser_();
  const safeName = fleetDocumentSafeName_(name);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const vehicle = fleetDocumentVehicleFolder_(plate, vehicleFolderId);
    const existing = vehicle.getFoldersByName(safeName);
    const folder = existing.hasNext() ? existing.next() : vehicle.createFolder(safeName);
    return { id: folder.getId(), name: folder.getName() };
  } finally { lock.releaseLock(); }
}

function uploadFleetDocument(input) {
  const user = fleetDocumentUser_();
  if (!input || !input.file) throw new Error('Selecione um arquivo.');
  const name = fleetDocumentSafeName_(input.file.name);
  const type = String(input.file.mimeType || '');
  const extensions = { 'application/pdf': /\.pdf$/i, 'image/jpeg': /\.jpe?g$/i, 'image/png': /\.png$/i };
  if (!extensions[type] || !extensions[type].test(name)) throw new Error('Envie somente PDF, JPG ou PNG.');
  const encoded = String(input.file.base64 || '');
  if (!encoded || encoded.length > 11200000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Arquivo inválido ou maior que 8 MB.');
  const bytes = Utilities.base64Decode(encoded);
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Arquivo vazio ou maior que 8 MB.');
  const signature = bytes.slice(0, 8).map(function (value) { return value & 255; });
  const matches = type === 'application/pdf' ? signature.slice(0, 5).join(',') === '37,80,68,70,45'
    : type === 'image/jpeg' ? signature.slice(0, 3).join(',') === '255,216,255'
    : signature.join(',') === '137,80,78,71,13,10,26,10';
  if (!matches) throw new Error('O conteúdo do arquivo não corresponde ao tipo informado.');
  const vehicle = fleetDocumentVehicleFolder_(input.plate, input.vehicleFolderId);
  const destination = fleetDocumentSubfolders_(vehicle).find(function (row) { return row.id === String(input.folderId); });
  if (!destination) throw new Error('Destino fora da pasta do veículo.');
  // Keep inherited Drive permissions. Never overwrite files or share publicly.
  const folder = DriveApp.getFolderById(destination.id);
  const file = folder.createFile(Utilities.newBlob(bytes, type, name));
  file.setDescription('Documento da frota enviado por ' + user + '. Placa: ' + fleetDocumentKey_(input.plate));
  return { ok: true, name: file.getName(), url: file.getUrl(), path: destination.path };
}
