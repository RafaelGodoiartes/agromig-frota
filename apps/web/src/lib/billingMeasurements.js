// Shared with Apps Script by tools/build-fleet-billing.mjs. Money stays in cents.
export const FleetBilling = (() => {
    const text = (value) => String(value ?? '').trim();
    const key = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const fail = (message) => { throw new Error(message); };
    const date = (value) => {
        const raw = text(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
        const parsed = new Date(`${raw}T12:00:00Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : '';
    };
    const cents = (value) => {
        if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 1e10 ? Math.round(value * 100) : null;
        let raw = text(value).replace(/^R\$\s*/, '').replace(/\s/g, '');
        if (!/^-?\d+(?:[.,]\d+)*$/.test(raw)) return null;
        if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
        else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, '');
        const number = Number(raw);
        return Number.isFinite(number) && Math.abs(number) <= 1e10 ? Math.round(number * 100) : null;
    };
    const validCents = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1e12;
    const iso = (value) => value.toISOString().slice(0, 10);
    const days = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000) + 1;
    function calculate(monthlyCents, start, end) {
        if (!validCents(monthlyCents) || monthlyCents <= 0) fail('Informe um valor mensal válido e maior que zero.');
        if (!date(start) || !date(end) || end < start) fail('Confira as datas inicial e final da medição.');
        if (days(start, end) > 366) fail('Cada medição pode abranger no máximo 366 dias.');
        let cursor = start;
        const segments = [];
        while (cursor <= end) {
            const current = new Date(`${cursor}T12:00:00Z`);
            const last = iso(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0, 12)));
            const stop = end < last ? end : last;
            const count = days(cursor, stop), monthDays = Number(last.slice(8));
            segments.push({ month: cursor.slice(0, 7), start: cursor, end: stop, days: count, monthDays, amountCents: Math.round(monthlyCents * count / monthDays) });
            const next = new Date(`${stop}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); cursor = iso(next);
        }
        return { amountCents: segments.reduce((sum, row) => sum + row.amountCents, 0), days: days(start, end), segments, rule: 'Dias corridos inclusivos / dias reais de cada mês' };
    }
    function project(input, projects = [], previous = null) {
        const name = text(input.name), code = text(input.code), client = text(input.client), start = date(input.start), end = text(input.end);
        if (!name || name.length > 150 || !client || client.length > 180 || !start || (end && (!date(end) || end < start))) fail('Preencha nome, cliente e datas válidas do projeto.');
        if (!['Ativo', 'Concluído', 'Pausado'].includes(input.status)) fail('Status do projeto inválido.');
        if (code.length > 60 || text(input.notes).length > 3000) fail('Código ou observações excedem o tamanho permitido.');
        if (projects.some((row) => !row.deleted && row.id !== previous?.id && (key(row.name) === key(name) || (code && key(row.code) === key(code))))) fail('Já existe um projeto com este nome ou código.');
        return { name, code, client, start, end, status: input.status, notes: text(input.notes), equipmentIds: [...new Set(input.equipmentIds || [])].map(text) };
    }
    function measurement(input, projects, equipment, measurements = [], previous = null) {
        const selected = projects.find((row) => row.id === input.projectId && !row.deleted);
        const machine = equipment.find((row) => row.id === input.equipmentId);
        if (!selected || !machine) fail('Selecione um projeto e um equipamento existentes.');
        if (selected.status !== 'Ativo' && selected.id !== previous?.projectId) fail('Selecione um projeto ativo para uma nova medição.');
        const start = date(input.start), end = date(input.end), month = text(input.month);
        const calculation = calculate(input.monthlyCents, start, end);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < start.slice(0, 7) || month > end.slice(0, 7)) fail('A competência deve pertencer ao período medido.');
        if (start < selected.start || (selected.end && end > selected.end)) fail('O período de medição deve estar dentro das datas do projeto.');
        const overlaps = measurements.filter((row) => !row.deleted && row.id !== previous?.id && row.projectId === selected.id && row.equipmentId === machine.id && row.start <= end && row.end >= start);
        const overlapReason = text(input.overlapReason), adjustmentReason = text(input.adjustmentReason);
        if (overlaps.length && (input.allowOverlap !== true || overlapReason.length < 10)) fail('Já existe medição sobreposta. Para autorizar a exceção, marque a opção e justifique com pelo menos 10 caracteres.');
        if (overlapReason.length > 1000 || adjustmentReason.length > 1000 || text(input.notes).length > 3000) fail('Justificativa ou observações excedem o tamanho permitido.');
        let amountCents = calculation.amountCents;
        if (input.manualAdjustment === true) {
            if (!validCents(input.amountCents) || adjustmentReason.length < 10) fail('Informe um valor ajustado válido e uma justificativa com pelo menos 10 caracteres.');
            amountCents = input.amountCents;
        }
        return { projectId: selected.id, equipmentId: machine.id, projectName: selected.name, client: selected.client,
            equipmentName: machine.name, plate: machine.plate, prefix: machine.prefix || '', start, end, month,
            monthlyCents: input.monthlyCents, calculatedCents: calculation.amountCents, amountCents,
            calculation, manualAdjustment: input.manualAdjustment === true, adjustmentReason: input.manualAdjustment === true ? adjustmentReason : '',
            allowOverlap: overlaps.length > 0, overlapIds: overlaps.map((row) => row.id), overlapReason: overlaps.length ? overlapReason : '', notes: text(input.notes) };
    }
    function summarize(measurements = [], projects = [], filters = {}) {
        const projectMap = new Map(projects.map((row) => [row.id, row]));
        const annualRows = measurements.filter((row) => !row.deleted && (!filters.year || row.month.slice(0, 4) === String(filters.year)) && (!filters.projectId || filters.projectId === 'all' || row.projectId === filters.projectId) && (!filters.equipmentId || filters.equipmentId === 'all' || row.equipmentId === filters.equipmentId));
        const rows = annualRows.filter((row) => !filters.month || filters.month === 'all' || row.month.slice(5) === String(filters.month).padStart(2, '0')).map((row) => ({ ...row, projectLabel: projectMap.get(row.projectId)?.name || row.projectName }));
        const sum = (values) => values.reduce((total, row) => total + row.amountCents, 0);
        const group = (field, label) => {
            const result = new Map();
            rows.forEach((row) => { const id = row[field]; const item = result.get(id) || { id, label: row[label], amountCents: 0, count: 0 }; item.amountCents += row.amountCents; item.count++; result.set(id, item); });
            return [...result.values()].sort((a, b) => b.amountCents - a.amountCents);
        };
        const monthly = Array.from({ length: 12 }, (_, index) => ({ month: String(index + 1).padStart(2, '0'), amountCents: sum(annualRows.filter((row) => row.month.slice(5) === String(index + 1).padStart(2, '0'))) }));
        const byProject = group('projectId', 'projectLabel');
        const projectEvolution = monthly.map((row) => ({ ...row, projects: Object.fromEntries([...new Set(annualRows.map((item) => item.projectId))].map((id) => [id, sum(annualRows.filter((item) => item.projectId === id && item.month.slice(5) === row.month))])) }));
        return { rows, totalCents: sum(rows), annualCents: sum(annualRows), machines: new Set(rows.map((row) => row.equipmentId)).size, monthly, byProject, byEquipment: group('equipmentId', 'equipmentName'), projectEvolution };
    }
    return { text, key, date, cents, calculate, project, measurement, summarize };
})();
