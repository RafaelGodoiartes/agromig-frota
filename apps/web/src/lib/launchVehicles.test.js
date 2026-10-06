import test from 'node:test';
import assert from 'node:assert/strict';
import { launchPlateKey, mergeLaunchVehicles, registeredVehicleMetadata, registrationVehicle, selectRegisteredVehicle } from './launchVehicles.js';
import apiServerClient, { commandForRoute } from './apiServerClient.js';

test('nova placa do cadastro aparece no abastecimento, preservando catálogo e deduplicando grafias', () => {
    const fuel = [{ placa: 'ABC-1D23', veiculo: 'Modelo da planilha' }, { placa: 'GALÃO GAS', veiculo: 'Galão' }];
    const registry = [{ placa: 'ABC1D23', veiculo: 'Modelo cadastro', projeto: 'Projeto A' }, { placa: 'XYZ9A87', veiculo: 'Novo modelo', projeto: 'Projeto B', unidade: 'HORAS' }];
    const list = mergeLaunchVehicles(fuel, registry);
    assert.equal(list.length, 3); assert.equal(list[0].veiculo, 'Modelo da planilha'); assert.equal(list[0].projeto, 'Projeto A');
    assert.equal(list.find(v => v.placa === 'XYZ9A87').unidade, 'HORAS');
    assert.equal(launchPlateKey('abc-1d23'), launchPlateKey(' ABC1D23 '));
    assert.equal(mergeLaunchVehicles(registry, [registry[1]]).length, 2);
});

test('cadastro seleciona a placa sem apagar o lançamento iniciado', () => {
    const current = { litros: '70', valor: '450', descricao: 'Revisão', data: '2026-10-06', placa: '', projeto: '', folderUrl: '', posto: 'Posto A' };
    const vehicle = registrationVehicle({ placa: ' xyz-9a87 ', veiculo: ' Novo modelo ', projeto: ' Projeto B ', unidade: 'HORAS', folderUrl: 'https://drive.google.com/drive/folders/test' });
    const next = selectRegisteredVehicle(current, vehicle);
    assert.equal(vehicle.placa, 'XYZ9A87'); assert.equal(next.projeto, 'Projeto B'); assert.equal(next.folderUrl, vehicle.pastaEvidencias);
    for (const key of ['litros', 'valor', 'descricao', 'data', 'posto']) assert.equal(next[key], current[key]);
    assert.equal(current.placa, '');
    assert.equal(selectRegisteredVehicle({ ...current, folderUrl: 'pasta de outro veículo' }, { ...vehicle, pastaEvidencias: '' }).folderUrl, '');
});

test('metadados informados pelo cadastro suprem atualização atrasada sem trocar modelo pela placa', () => {
    const supplied = { veiculo: 'Nova escavadeira', unidade: 'HORAS', tipoPosse: 'PRÓPRIO' };
    assert.equal(registeredVehicleMetadata({}, 'NOVO1', supplied).veiculo, 'Nova escavadeira');
    const maintenance = commandForRoute('/fleet/manutencao', { ...supplied, placa: 'NOVO1', status: 'AGENDADO' });
    assert.equal(maintenance.values[2], 'Nova escavadeira'); assert.equal(maintenance.values[14], 'HORAS');
    assert.equal(commandForRoute('/fleet/abastecimento', { ...supplied, placa: 'NOVO1', data: '2026-10-06' }).values[2], 'Nova escavadeira');
});

test('API confirma cadastro antes de usar nova placa e mantém sequência da manutenção; falha não é sucesso local', async () => {
    const oldWindow = globalThis.window;
    const requests = [];
    globalThis.window = { fetch: async (_, options) => {
        if (options.method === 'GET') return new Response(JSON.stringify({ meta: {}, veiculos: [], veiculosAbastecimento: [], manutencao: [{ id: 90 }] }));
        requests.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ ok: requests.length === 1, message: requests.length === 1 ? 'Cadastrado' : 'Falha no cadastro' }));
    } };
    try {
        await apiServerClient.fetch('/fleet');
        const form = { placa: 'XYZ9A87', veiculo: 'Novo modelo', projeto: 'Projeto B', unidade: 'HORAS', tipoPosse: 'PRÓPRIO' };
        const response = await apiServerClient.fetch('/fleet/veiculo', { method: 'POST', body: JSON.stringify(form) });
        assert.equal(response.ok, true); assert.equal(requests[0].sheetName, 'Cadastro de Veículos'); assert.equal(requests[0].values[0], 'XYZ9A87');
        const maintenance = commandForRoute('/fleet/manutencao', { placa: form.placa, status: 'AGENDADO' });
        assert.equal(maintenance.values[0], 91); assert.equal(maintenance.values[2], 'Novo modelo'); assert.equal(maintenance.values[14], 'HORAS');
        assert.equal(commandForRoute('/fleet/abastecimento', { placa: form.placa, data: '2026-10-06' }).values[2], 'Novo modelo');
        const failed = await apiServerClient.fetch('/fleet/veiculo', { method: 'POST', body: JSON.stringify({ ...form, placa: 'OUTRA1' }) });
        assert.equal(failed.ok, false); assert.equal(commandForRoute('/fleet/abastecimento', { placa: 'OUTRA1', data: '2026-10-06' }).values[2], 'OUTRA1');
    } finally { globalThis.window = oldWindow; }
});
