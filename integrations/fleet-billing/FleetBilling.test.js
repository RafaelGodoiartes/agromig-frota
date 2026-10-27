import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const server = fs.readFileSync(new URL('./FleetBilling.gs', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../../apps/web/src/lib/billingMeasurements.js', import.meta.url), 'utf8').replace('export const FleetBilling', 'var FleetBilling');
function fixture() {
    let actor = 'frota@agromig.com.br', allowed = true, writes = 0, created = 0, sharing = 'PRIVATE';
    const properties = new Map();
    const sheet = {
        rows: [], getLastRow() { return this.rows.length; }, getMaxRows: () => 1000,
        setName: () => {}, setFrozenRows: () => {}, setColumnWidths: () => {}, setColumnWidth: () => {},
        getRange(row, column, count = 1, width = 1) {
            const range = {
                getValues: () => Array.from({ length: count }, (_, index) => Array.from({ length: width }, (_, c) => sheet.rows[row - 1 + index]?.[column - 1 + c] ?? '')),
                setValues(values) { values.forEach((values, index) => { const r = row - 1 + index; sheet.rows[r] ||= []; values.forEach((value, c) => { sheet.rows[r][column - 1 + c] = value; }); }); writes++; return range; },
                setBackground: () => range, setFontColor: () => range, setFontWeight: () => range, setNumberFormat: () => range,
            };
            return range;
        },
    };
    const registry = { getLastRow: () => 5, getRange: (row) => ({ getDisplayValues: () => row === 4 ? [['PLACA', 'VEÍCULO / MODELO']] : [['AAA1B23', 'Máquina de teste', '', '', '', '', '', '', 'HORAS', 'AGR-TESTE']] }) };
    const propertyStore = { getProperty: (key) => properties.get(key), setProperties: (items) => Object.entries(items).forEach(([key, value]) => properties.set(key, value)) };
    const context = {
        console: { log: () => {} },
        fleetDocumentReader_: () => { if (!/^[^@\s]+@agromig\.com\.br$/.test(actor)) throw Error('Acesso restrito'); return actor; },
        fleetDocumentUser_: () => { context.fleetDocumentReader_(); if (!allowed) throw Error('Gestão não autorizada'); return actor; },
        fleetDocumentCanUpload_: () => allowed,
        PropertiesService: { getScriptProperties: () => propertyStore },
        DriveApp: { Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' }, getFileById: () => ({ getSharingAccess: () => sharing }) },
        LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
        Utilities: { getUuid: crypto.randomUUID, computeHmacSha256Signature: (value, secret) => crypto.createHmac('sha256', secret).update(value).digest(), base64EncodeWebSafe: (value) => Buffer.from(value).toString('base64url') },
        SpreadsheetApp: { flush: () => {}, create: () => { created++; return { getId: () => 'private-db', getUrl: () => 'https://docs.google.com/spreadsheets/d/private-db/edit', getSheets: () => [sheet] }; }, openById: (id) => ({ getSheetByName: () => id === 'private-db' ? sheet : registry }) },
    };
    vm.createContext(context); vm.runInContext(rules + '\n' + server, context);
    const initialize = () => context.initializeFleetBilling();
    const project = (input = {}) => context.saveFleetBillingProject({ operationId: crypto.randomUUID(), revision: sheet.rows.length - 1, name: 'Projeto de teste', client: 'Cliente de teste', code: '', start: '2026-01-01', end: '', status: 'Ativo', equipmentIds: ['AAA1B23'], ...input });
    const measurement = (projectId, input = {}) => context.saveFleetBillingMeasurement({ operationId: crypto.randomUUID(), revision: sheet.rows.length - 1, projectId, equipmentId: 'AAA1B23', start: '2026-10-01', end: '2026-10-31', month: '2026-10', monthlyCents: 3500000, ...input });
    return { context, initialize, project, measurement, sheet, properties, setActor: (value) => { actor = value; }, setAllowed: (value) => { allowed = value; }, setSharing: (value) => { sharing = value; }, writes: () => writes, created: () => created };
}
test('base privada inicializa uma vez, sem exemplos e sem substituir os dados existentes', () => {
    const f = fixture(); f.initialize(); f.initialize();
    assert.equal(f.created(), 1); assert.equal(f.sheet.rows.length, 1);
    const state = f.context.getFleetBillingState();
    assert.equal(state.revision, 0); assert.equal(state.projects.length, 0); assert.equal(state.measurements.length, 0); assert.equal(state.equipment[0].id, 'AAA1B23');
});
test('todas as operações validam identidade Google e permissão de gestão no servidor', () => {
    const f = fixture(); f.initialize(); f.setActor('externo@example.com');
    assert.throws(() => f.context.getFleetBillingState(), /Acesso/);
    assert.throws(() => f.context.getFleetBillingHistory('project', 'x'), /Acesso/);
    assert.throws(() => f.project({ email: 'frota@agromig.com.br' }), /Acesso/);
    f.setActor('leitor@agromig.com.br'); f.setAllowed(false);
    assert.equal(f.context.getFleetBillingState().canWrite, false);
    assert.throws(() => f.project(), /não autorizada/);
    assert.throws(() => f.initialize(), /não autorizada/);
});
test('recusa base pública e histórico adulterado, sem transformar a falha em base vazia', () => {
    const f = fixture(); f.initialize(); f.setSharing('ANYONE');
    assert.throws(() => f.context.getFleetBillingState(), /pública/);
    f.setSharing('PRIVATE'); f.project(); f.sheet.rows[1][6] = '{}';
    assert.throws(() => f.context.getFleetBillingState(), /alterado/);
});
test('salva, edita e exclui com revisões imutáveis, guardando o preço original', () => {
    const f = fixture(); f.initialize(); const p = f.project().record;
    const first = f.measurement(p.id).record;
    f.measurement(p.id, { id: first.id, monthlyCents: 3600000 });
    const before = f.writes();
    assert.throws(() => f.context.deleteFleetBillingMeasurement({ id: first.id, operationId: crypto.randomUUID(), revision: 3 }), /Confirme/);
    assert.equal(f.writes(), before);
    f.context.deleteFleetBillingMeasurement({ id: first.id, operationId: crypto.randomUUID(), revision: 3, confirmDelete: true });
    const state = f.context.getFleetBillingState();
    assert.equal(state.measurements[0].deleted, true); assert.equal(state.revision, 4);
    const history = f.context.getFleetBillingHistory('measurement', first.id);
    assert.equal(history.length, 3); assert.equal(history[0].record.monthlyCents, 3500000); assert.equal(history[1].record.monthlyCents, 3600000);
});
test('idempotência e bloqueio de concorrência não duplicam nem sobrescrevem outra edição', () => {
    const f = fixture(); f.initialize(); const operationId = crypto.randomUUID();
    const first = f.project({ operationId }); const writes = f.writes();
    const retry = f.project({ operationId, revision: 0 });
    assert.equal(first.record.id, retry.record.id); assert.equal(f.writes(), writes);
    assert.throws(() => f.project({ revision: 0, name: 'Outro' }), /outra operação/);
});
test('duplicidade, referências, vigência, exclusão de projeto e sobreposição são verificadas no servidor', () => {
    const f = fixture(); f.initialize(); const p = f.project().record;
    assert.throws(() => f.project(), /existe/);
    assert.throws(() => f.measurement(p.id, { equipmentId: 'nao-cadastrado' }), /existentes/);
    f.measurement(p.id);
    assert.throws(() => f.measurement(p.id), /sobreposta/);
    assert.throws(() => f.project({ id: p.id, start: '2026-11-01' }), /fora do contrato/);
    assert.throws(() => f.context.deleteFleetBillingProject({ id: p.id, operationId: crypto.randomUUID(), revision: 2, confirmDelete: true }), /possui medições/);
    f.measurement(p.id, { allowOverlap: true, overlapReason: 'Exceção aprovada explicitamente pelo gestor.' });
    assert.equal(f.context.getFleetBillingState().measurements.length, 2);
});
