import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWeeklyKm, weeklyCompetence, weeklyDate, weeklyMondays, weeklyReading } from './weeklyKm.js';
import { loadWeeklyKmSources, parseWeeklyKmSources } from './weeklyKmSources.js';

const now = new Date('2026-10-13T19:00:00Z');
const dates = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', null];
const vehicle = (placa, dataEntrada = null) => ({ placa, veiculo: 'Veículo', dataEntrada });
const dataset = (rows, vehicles = rows.map((row) => vehicle(row.placa))) => ({ kmRodado: rows, veiculos: vehicles, kmSemanalDatas: dates });

test('UAD4J51 é dispensada somente do aviso de pendência semanal, preservando dados e demais veículos', () => {
    const data = dataset([
        { placa: ' uad-4j51 ', leituras: [null, null, 130, null] },
        { placa: 'AAA1B23', leituras: [] },
    ], [vehicle('UAD4J51'), vehicle('AAA1B23')]);
    const before = JSON.stringify(data);
    const status = summarizeWeeklyKm(data, now);
    assert.equal(status.total, 2);
    assert.deepEqual(status.pending.map((row) => row.placa), ['AAA1B23']);
    assert.deepEqual(status.pending[0].missingDates, ['2026-10-05', '2026-10-12']);
    assert.deepEqual(status.review.map((row) => row.placa), ['UAD4J51']);
    assert.equal(JSON.stringify(data), before);
    assert.equal(summarizeWeeklyKm(dataset([], [vehicle('UAD4J51')]), now).pending.length, 0);
});

test('verifica cada semana vencida, mesmo com situação mensal dentro da franquia', () => {
    const data = dataset([
        { placa: 'AAA1B23', leituras: [100, null, 130, 140], situacao: 'DENTRO DA FRANQUIA' },
        { placa: 'BBB2C34', leituras: [null, 200, 220, 240] },
        { placa: 'CCC3D45', leituras: [100, 110] },
    ]);
    const status = summarizeWeeklyKm(data, now);
    assert.deepEqual(status.pending.map((row) => row.missingDates), [['2026-10-12'], ['2026-10-05']]);
    assert.equal(status.review.length, 2);
    assert.match(status.warnings[0], /semanas futuras/);
});

test('não corta veículos ausentes na resposta semanal, duplicados nem linhas com erro', () => {
    const data = dataset([
        { placa: 'aaa-1b23', leituras: [0, null] },
        { placa: 'AAA1B23', leituras: [null, 20] },
        { placa: '#REF!', leituras: [] },
    ], [vehicle('AAA1B23'), vehicle('AAA-1B23'), vehicle('BBB2C34'), vehicle('#REF!')]);
    const before = JSON.stringify(data);
    const status = summarizeWeeklyKm(data, now);
    assert.equal(status.total, 2);
    assert.deepEqual(status.pending.map((row) => row.placa), ['BBB2C34']);
    assert.equal(JSON.stringify(data), before);
});

test('cadastro incompleto não esconde uma placa válida presente no KM Semanal', () => {
    assert.equal(summarizeWeeklyKm(dataset([{ placa: 'AAA1B23', leituras: [] }], []), now).pending.length, 1);
});

test('na virada, leituras da competência anterior não quitam semanas do novo mês', () => {
    const old = dataset([{ placa: 'AAA1B23', leituras: [100, 110, 120, 130, 140] }]);
    old.kmSemanalDatas = weeklyMondays('2026-09');
    const status = summarizeWeeklyKm(old, now);
    assert.deepEqual(status.pending[0].missingDates, ['2026-10-05', '2026-10-12']);
    assert.match(status.warnings[0], /outra competência/);
});

test('não some com pendências quando falta um cabeçalho de data', () => {
    const data = dataset([{ placa: 'AAA1B23', leituras: [100, 200] }]);
    data.kmSemanalDatas = ['2026-10-05', null, ...dates.slice(2)];
    assert.deepEqual(summarizeWeeklyKm(data, now).pending[0].missingDates, ['2026-10-12']);
});

test('competência muda no dia 4, em São Paulo, inclusive na virada do ano', () => {
    assert.equal(weeklyCompetence(new Date('2026-10-04T02:59:59Z')), '2026-09');
    assert.equal(weeklyCompetence(new Date('2026-10-04T03:00:00Z')), '2026-10');
    assert.equal(weeklyCompetence(new Date('2027-01-02T12:00:00Z')), '2026-12');
    assert.deepEqual(weeklyMondays('2026-11'), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
});

test('respeita entrada na frota e exceção dos últimos sete dias, sem cobrar semanas anteriores', () => {
    const data = dataset([
        { placa: 'AAA1B23', leituras: [] },
        { placa: 'BBB2C34', leituras: [] },
    ], [vehicle('AAA1B23', '2026-10-25'), vehicle('BBB2C34', '2026-10-10')]);
    const status = summarizeWeeklyKm(data, new Date('2026-10-31T12:00:00Z'));
    assert.deepEqual(status.pending.map((row) => row.placa), ['BBB2C34']);
    assert.deepEqual(status.pending[0].missingDates, ['2026-10-12', '2026-10-19', '2026-10-26']);
});

test('números, erros e datas são validados sem converter texto de situação em leitura', () => {
    assert.equal(weeklyReading('INFORMAR AO MENOS 2 LEITURAS'), null);
    assert.equal(weeklyReading('#REF!'), null);
    assert.equal(weeklyReading(''), null);
    assert.equal(weeklyReading(-1), null);
    assert.equal(weeklyReading('12.345,6 KM'), 12345.6);
    assert.equal(weeklyReading(0), 0);
    assert.equal(weeklyDate('31/02/2026'), null);
    assert.equal(weeklyDate('Date(2026,9,12)'), '2026-10-12');
});

test('ao preencher leitura faltante o alerta resolve, e volta na semana seguinte', () => {
    const data = dataset([{ placa: 'AAA1B23', leituras: [100, null] }]);
    assert.equal(summarizeWeeklyKm(data, now).pending.length, 1);
    data.kmRodado[0].leituras[1] = 120;
    assert.equal(summarizeWeeklyKm(data, now).pending.length, 0);
    assert.equal(summarizeWeeklyKm(data, new Date('2026-10-19T12:00:00Z')).pending.length, 1);
});

const gviz = (rows) => `google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { rows: rows.map((cells) => ({ c: cells.map((v) => v === null ? null : { v }) })) } })});`;
const weeklyBody = gviz([
    ['ITEM', 'PLACA', 'VEÍCULO / MODELO', '1ª SEGUNDA'],
    [1, 'AAA1B23', 'Veículo', 100, null, 130, null],
    [2, '#REF!', '#REF!'],
]);
const registryBody = gviz([['PLACA', 'VEÍCULO / MODELO'], ['AAA1B23', 'Veículo']]);
const calendarBody = gviz([['Date(2026,9,1)'], [null, null, 'Date(2026,9,5)', 'Date(2026,9,12)', 'Date(2026,9,19)', 'Date(2026,9,26)', null]]);

test('consulta calendário separado das leituras para evitar perda de datas por tipos mistos no GViz', () => {
    const source = parseWeeklyKmSources(weeklyBody, registryBody, calendarBody);
    assert.equal(source.month, '2026-10');
    assert.deepEqual(source.dates, dates);
    assert.equal(source.rows.length, 1);
    assert.deepEqual(summarizeWeeklyKm({ kmSemanalSource: source }, now).pending[0].missingDates, ['2026-10-12']);
});

test('cada refresh relê três fontes e não usa dados antigos do conector em vez da fonte atual', async () => {
    const seen = [];
    const source = await loadWeeklyKmSources(async (url, options) => {
        assert.ok(options.signal);
        seen.push(url);
        return { ok: true, text: async () => url.includes('B2:H3') ? calendarBody : url.includes('gid=1477905702') ? registryBody : weeklyBody };
    });
    assert.equal(seen.length, 3);
    assert.ok(seen.every((url) => /&t=\d+/.test(url)));
    const data = { ...dataset([{ placa: 'AAA1B23', leituras: [100, 200] }]), kmSemanalSource: source };
    assert.equal(summarizeWeeklyKm(data, now).pending.length, 1);
    await assert.rejects(loadWeeklyKmSources(async () => ({ ok: false, status: 403 })), /403/);
});

test('falha da consulta aparece no resumo, nunca é apresentada como tudo regular', () => {
    assert.match(summarizeWeeklyKm({ kmSemanalError: 'Não foi possível confirmar as leituras' }, now).warnings.join(' '), /Não foi possível/);
    assert.throws(() => parseWeeklyKmSources('<html>Login</html>', registryBody, calendarBody), /inválida/);
});

test('mistura de competências gera aviso separado, sem pendência falsa para veículo que enviou KM', () => {
    const source = parseWeeklyKmSources(weeklyBody, registryBody, calendarBody);
    source.mixed = true;
    source.rows[0].leituras = [100, 110, 120, 130, null];
    const before = JSON.stringify(source);
    const status = summarizeWeeklyKm({ kmSemanalSource: source }, now);
    assert.equal(status.pending.length, 0);
    assert.equal(status.review.length, 1);
    assert.match(status.warnings[0], /meses diferentes/);
    assert.equal(JSON.stringify(source), before);
    source.mixed = false;
    assert.equal(summarizeWeeklyKm({ kmSemanalSource: source }, now).pending.length, 0);
});

test('em outubro, só semanas realmente vazias contam: futuro preenchido não quita o passado nem condena o veículo regular', () => {
    const source = parseWeeklyKmSources(weeklyBody, registryBody, calendarBody);
    source.mixed = true;
    source.rows = [
        { placa: 'AAA1B23', leituras: [100, 120, 130, 140, null] },
        { placa: 'BBB2C34', leituras: [100, null, 130, 140, null] },
        { placa: 'CCC3D45', leituras: [100, 120, null, null, null] },
    ];
    source.vehicles = source.rows.map((row) => vehicle(row.placa));
    const status = summarizeWeeklyKm({ kmSemanalSource: source }, new Date('2026-10-14T12:00:00Z'));
    assert.deepEqual(status.pending.map((row) => row.placa), ['BBB2C34']);
    assert.deepEqual(status.pending[0].missingDates, ['2026-10-12']);
    assert.deepEqual(status.review.map((row) => row.placa), ['AAA1B23', 'BBB2C34']);
    source.rows[1].leituras[1] = 125;
    assert.equal(summarizeWeeklyKm({ kmSemanalSource: source }, new Date('2026-10-14T12:00:00Z')).pending.length, 0);
});
