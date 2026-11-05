import test from 'node:test';
import assert from 'node:assert/strict';
import apiServerClient from './apiServerClient.js';

test('leitura respeita o sinal de cancelamento sem alterar os dados retornados', async () => {
    const previous = globalThis.window;
    const controller = new AbortController();
    let received;
    globalThis.window = { fetch: async (_url, options) => {
        received = options;
        return new Response(JSON.stringify({ veiculos: [{ placa: 'TESTE01' }] }));
    } };
    try {
        const response = await apiServerClient.fetch('/fleet/refresh', { method: 'GET', signal: controller.signal });
        assert.equal(received.signal, controller.signal);
        assert.equal(received.method, 'GET');
        assert.deepEqual(await response.json(), { veiculos: [{ placa: 'TESTE01' }] });
    } finally {
        if (previous === undefined) delete globalThis.window;
        else globalThis.window = previous;
    }
});
