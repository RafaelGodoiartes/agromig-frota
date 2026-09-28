import test from 'node:test';
import assert from 'node:assert/strict';
import { driverNameKey, summarizeChecklistDrivers } from './checklistDrivers.js';

test('recognizes case, accents, repeated spaces and joined names', () => {
    const expected = driverNameKey('JOÃO DA SILVA');
    for (const name of ['joão da silva', 'JoaoDaSilva', '  João  da\tSilva ', 'João\u00a0da\u200bSilva']) {
        assert.equal(driverNameKey(name), expected);
    }
});

test('completed name variants remove false pending entries and use the registered spelling', () => {
    const result = summarizeChecklistDrivers(
        ['JOÃO DA SILVA', 'José de Souza', 'João  da Silva'],
        ['joaodasilva', 'João da Silva', 'JOAO  DA SILVA'],
    );
    assert.equal(result.completedCount, 1);
    assert.deepEqual(result.missingDrivers, ['José de Souza']);
    assert.equal(result.displayName('joaodasilva'), 'JOÃO DA SILVA');
});

test('does not merge abbreviations, partial names or different surnames', () => {
    const result = summarizeChecklistDrivers(['JOÃO DA SILVA', 'JOÃO DE SOUZA'], ['João', 'J. da Silva']);
    assert.deepEqual(result.missingDrivers, ['JOÃO DA SILVA', 'JOÃO DE SOUZA']);
});

test('blank and placeholder names do not count as completed drivers', () => {
    const result = summarizeChecklistDrivers(['', null, '—', 'ANA LIMA'], ['', undefined, '—', '-']);
    assert.equal(result.completedCount, 0);
    assert.deepEqual(result.missingDrivers, ['ANA LIMA']);
});

test('preserves input records and matches only completions supplied for the selected period', () => {
    const registered = Object.freeze(['ANA LIMA', 'José de Souza']);
    const completed = Object.freeze(['analima']);
    const result = summarizeChecklistDrivers(registered, completed);
    assert.deepEqual(result.missingDrivers, ['José de Souza']);
    assert.equal(result.displayName('Unregistered Driver'), 'Unregistered Driver');
    assert.deepEqual(registered, ['ANA LIMA', 'José de Souza']);
});
