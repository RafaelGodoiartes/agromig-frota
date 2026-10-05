import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./VehicleDocuments.gs', import.meta.url), 'utf8');
function fixture(email = 'allowed@example.com', allow = 'allowed@example.com') {
    const iterator = (values) => { let index = 0; return { hasNext: () => index < values.length, next: () => values[index++] }; };
    const folders = new Map();
    let filesCreated = 0;
    const folder = (id, name, children = []) => {
        const item = { getId: () => id, getName: () => name, isTrashed: () => false,
            files: [], getFiles: () => iterator(item.files),
            getFolders: () => iterator(children),
            getFoldersByName: (value) => iterator(children.filter((child) => child.getName() === value)),
            createFolder: (name) => { const result = folder(`new-${children.length}`, name); children.push(result); return result; },
            createFile: (blob) => { filesCreated++; return { getName: () => blob.name, getUrl: () => 'https://drive.google.com/file/d/test/view', setDescription: () => {} }; },
        };
        folders.set(id, item); return item;
    };
    const crlv = folder('crlv', '3.1.1 - CRLV');
    const truck = folder('truck', '17_LTU5A25_VW30.280_CAMINHÃO_PRANCHA', [crlv]);
    const vehicles = folder('vehicles', '3.1 - VEÍCULOS', [truck, folder('lookalike', 'LTU5A250')]);
    folder('1zm7M3-8ucbSx2HwNz4Ri6Ps-cbzWTT41', '03 - OPERAÇÃO', [vehicles]);
    folder('outside', 'Arquivo privado fora de Operação');
    const sandbox = {
        Session: { getActiveUser: () => ({ getEmail: () => email }) },
        PropertiesService: { getScriptProperties: () => ({ getProperty: () => allow }) },
        SpreadsheetApp: { openById: () => ({ getSheetByName: () => ({ getLastRow: () => 6, getRange: () => ({ getDisplayValues: () => [['LTU5A25', 'VW'], ['ltu-5a25', 'VW']] }) }) }) },
        DriveApp: { getFolderById: (id) => { if (!folders.has(id)) throw Error('Folder not found'); return folders.get(id); } },
        LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
        Utilities: { base64Decode: (value) => [...Buffer.from(value, 'base64')], newBlob: (bytes, type, name) => ({ bytes, type, name }) },
    };
    vm.createContext(sandbox); vm.runInContext(source, sandbox);
    return { context: sandbox, filesCreated: () => filesCreated, folders };
}

test('portal exige identidade Google autorizada; e-mail postado não autoriza', () => {
    for (const [email, allow] of [['', 'allowed@example.com'], ['other@example.com', 'allowed@example.com'], ['allowed@example.com', '']]) {
        const { context } = fixture(email, allow);
        assert.throws(() => context.getFleetDocumentVehicles(), /Acesso restrito/);
        assert.throws(() => context.uploadFleetDocument({ email: 'allowed@example.com' }), /Acesso restrito/);
        assert.throws(() => context.getFleetDocumentFiles('LTU5A25', 'truck', 'crlv'), /Acesso restrito/);
    }
});

test('placa exata reconhece separadores, mas não placas maiores ou outra placa', () => {
    const { context } = fixture();
    assert.equal(context.fleetDocumentNameMatches_('17_LTU5A25_VW30.280', 'ltu-5a25'), true);
    assert.equal(context.fleetDocumentNameMatches_('TEQ_4H56_L200', 'TEQ4H56'), true);
    assert.equal(context.fleetDocumentNameMatches_('LTU5A250', 'LTU5A25'), false);
    assert.equal(context.fleetDocumentNameMatches_('XL TU5A25', 'LTU5A25'), false);
});

test('lista cadastro sem duplicar placas e busca somente em Operação', () => {
    const { context } = fixture();
    assert.equal(context.getFleetDocumentVehicles().length, 1);
    const rows = context.getFleetDocumentFolders('LTU-5A25');
    assert.equal(rows.length, 1); assert.equal(rows[0].id, 'truck');
    assert.throws(() => context.getFleetDocumentFolders('AAA1B23'), /Cadastro/);
});

test('pastas arbitrárias e destinos fora do veículo não são aceitos', () => {
    const { context, filesCreated } = fixture();
    assert.throws(() => context.getFleetDocumentDestinations('LTU5A25', 'outside'), /não corresponde/);
    assert.throws(() => context.uploadFleetDocument({ plate: 'LTU5A25', vehicleFolderId: 'truck', folderId: 'outside', file: { name: 'certificado.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-test').toString('base64') } }), /fora da pasta/);
    assert.equal(filesCreated(), 0);
});

test('cria subpasta somente no veículo e reaproveita nome existente', () => {
    const { context } = fixture();
    const a = context.createFleetDocumentFolder('LTU5A25', 'truck', 'Tacógrafo');
    const b = context.createFleetDocumentFolder('LTU5A25', 'truck', 'Tacógrafo');
    assert.equal(a.id, b.id);
    assert.throws(() => context.createFleetDocumentFolder('LTU5A25', 'truck', '../outro'), /Nome inválido/);
});

test('envio grava no destino confirmado, não sobrescreve nem compartilha', () => {
    const { context, filesCreated } = fixture();
    const result = context.uploadFleetDocument({ plate: 'LTU5A25', vehicleFolderId: 'truck', folderId: 'crlv', file: { name: 'certificado.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-test').toString('base64') } });
    assert.equal(result.ok, true); assert.equal(result.path.endsWith('3.1.1 - CRLV'), true);
    assert.equal(filesCreated(), 1);
});

test('rejeita arquivo vazio, tipo não permitido e conteúdo base64 inválido', () => {
    const { context, filesCreated } = fixture();
    const input = { plate: 'LTU5A25', vehicleFolderId: 'truck', folderId: 'crlv' };
    for (const file of [{ name: 'evil.html', mimeType: 'text/html', base64: 'AA==' }, { name: 'empty.pdf', mimeType: 'application/pdf', base64: '' }, { name: 'a.pdf', mimeType: 'application/pdf', base64: 'not base64' }]) assert.throws(() => context.uploadFleetDocument({ ...input, file }));
    assert.equal(filesCreated(), 0);
});

const documentFile = (id, name, trashed = false) => ({
    getId: () => id, getName: () => name, isTrashed: () => trashed,
    getUrl: () => `https://drive.google.com/file/d/${id}/view`,
    getMimeType: () => 'application/pdf', getSize: () => 2048,
    getLastUpdated: () => new Date('2026-10-05T12:00:00Z'),
});

test('consulta retorna apenas metadados do destino e exclui lixo/duplicados', () => {
    const { context, folders, filesCreated } = fixture();
    folders.get('crlv').files.push(documentFile('b', 'Tacógrafo.pdf'), documentFile('a', 'CRLV.pdf'), documentFile('a', 'CRLV.pdf'), documentFile('trash', 'Excluído.pdf', true));
    folders.get('outside').files.push(documentFile('secret', 'Outro veículo.pdf'));
    const result = context.getFleetDocumentFiles('LTU5A25', 'truck', 'crlv');
    assert.equal(result.files.length, 2);
    assert.equal(result.files[0].name, 'CRLV.pdf');
    assert.equal(result.files[0].size, 2048);
    assert.equal(result.files[0].updatedAt, '2026-10-05T12:00:00.000Z');
    assert.equal(result.folderUrl, 'https://drive.google.com/drive/folders/crlv');
    assert.equal(result.truncated, false);
    assert.equal(filesCreated(), 0);
    assert.throws(() => context.getFleetDocumentFiles('LTU5A25', 'truck', 'outside'), /fora do veículo/);
    assert.throws(() => context.getFleetDocumentFiles('LTU5A25', 'outside', 'outside'), /não corresponde/);
    assert.throws(() => context.getFleetDocumentFiles('AAA1B23', 'truck', 'crlv'), /Cadastro/);
});

test('consulta vazia e limite de arquivos são explícitos, sem varrer todo o Drive', () => {
    const { context, folders } = fixture();
    assert.equal(context.getFleetDocumentFiles('LTU5A25', 'truck', 'crlv').files.length, 0);
    folders.get('crlv').files.push(...Array.from({ length: 201 }, (_, i) => documentFile(`f${i}`, `${i}.pdf`)));
    const result = context.getFleetDocumentFiles('LTU5A25', 'truck', 'crlv');
    assert.equal(result.files.length, 200);
    assert.equal(result.truncated, true);
});

test('portal descarta consulta antiga quando placa ou pasta muda', async () => {
    const html = fs.readFileSync(new URL('./VehicleDocumentForm.html', import.meta.url), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    class Element {
        constructor() { this.value = ''; this.children = []; this.events = {}; }
        addEventListener(name, callback) { this.events[name] = callback; }
        replaceChildren(...nodes) { this.children = nodes; }
        appendChild(node) { this.children.push(node); }
        removeAttribute(name) { delete this[name]; }
    }
    const elements = new Map(); const pending = [];
    const runner = () => {
        let success;
        return { withSuccessHandler(callback) { success = callback; return this; }, withFailureHandler() {
            return new Proxy({}, { get: (_, method) => () => {
                if (method === 'getFleetDocumentVehicles') success([]);
                else pending.push(success);
            } });
        } };
    };
    const context = { document: { getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement: () => new Element() }, Option: class {}, google: { script: { get run() { return runner(); } } } };
    vm.createContext(context); vm.runInContext(script, context);
    await Promise.resolve();
    elements.get('plate').value = 'LTU5A25'; elements.get('vehicle-folder').value = 'truck'; elements.get('destination').value = 'crlv';
    const oldRequest = context.loadFiles();
    context.resetDestination();
    pending.shift()({ files: [documentFile('old', 'old.pdf')], folderUrl: 'https://drive.google.com/drive/folders/crlv' });
    await oldRequest;
    assert.equal(elements.get('file-list').children.length, 0);
    assert.equal(elements.get('folder-link').hidden, true);
});
