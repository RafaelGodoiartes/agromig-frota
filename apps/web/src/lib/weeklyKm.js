const plateKey = (value) => {
    const text = String(value ?? '').trim().toUpperCase();
    return text.startsWith('#') ? '' : text.replace(/[^A-Z0-9]/g, '');
};

export function weeklyReading(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    const raw = String(value ?? '').trim();
    if (!/^(?:\d[\d.,]*)(?:\s*(?:KM|H|HORAS))?$/i.test(raw)) return null;
    let number = raw.replace(/\s*(?:KM|H|HORAS)$/i, '');
    if (number.includes(',')) number = number.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(?:\.\d{3})+$/.test(number)) number = number.replace(/\./g, '');
    const parsed = Number(number);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function weeklyDate(value) {
    const text = String(value ?? '').trim();
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (!match) {
        const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (br) match = [br[0], br[3], br[2], br[1]];
    }
    if (!match) {
        const gviz = text.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,[\d,]+)?\)$/);
        if (gviz) match = [gviz[0], gviz[1], Number(gviz[2]) + 1, gviz[3]];
    }
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function fleetToday(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// Same day-4 competence rule as B2 in the existing workbook. UTC arithmetic
// avoids browser timezone/DST changing the due date or the month.
export function weeklyCompetence(now = new Date()) {
    const date = new Date(`${fleetToday(now)}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 3);
    return date.toISOString().slice(0, 7);
}

export function weeklyMondays(month) {
    const first = new Date(`${month}-01T12:00:00Z`);
    if (Number.isNaN(first.getTime())) return [];
    first.setUTCDate(1 + (8 - first.getUTCDay()) % 7);
    const dates = [];
    while (first.toISOString().slice(0, 7) === month) {
        dates.push(first.toISOString().slice(0, 10));
        first.setUTCDate(first.getUTCDate() + 7);
    }
    return dates;
}

export function summarizeWeeklyKm(data = {}, now = new Date()) {
    const month = weeklyCompetence(now);
    const today = fleetToday(now);
    const expectedDates = weeklyMondays(month);
    const dueDates = expectedDates.filter((date) => date <= today);
    const source = data.kmSemanalSource;
    const dates = (source?.dates ?? data.kmSemanalDatas ?? []).map(weeklyDate);
    const rows = source?.rows ?? data.kmRodado ?? [];
    const registry = source?.vehicles ?? data.veiculos ?? [];
    const warnings = [];
    if (source?.mixed) warnings.push('Leituras de meses diferentes estão em conferência. Os valores foram preservados; confirme a competência de cada leitura na planilha antes de considerar o veículo regular.');
    const sourceMonth = source?.month || dates.find(Boolean)?.slice(0, 7);
    const stale = sourceMonth !== month;
    const calendarInvalid = expectedDates.some((date, index) => dates[index] !== date);
    if (stale) warnings.push(`A aba KM Semanal não está confirmada para ${month.split('-').reverse().join('/')}. Leituras de outra competência não quitam as semanas atuais.`);
    else if (calendarInvalid) warnings.push('O calendário da aba KM Semanal está incompleto ou inconsistente. As semanas sem data válida continuam pendentes.');
    if (data.kmSemanalError) warnings.push(data.kmSemanalError);

    const byPlate = new Map();
    rows.forEach((row) => {
        const key = plateKey(row.placa);
        if (!key) return;
        if (!byPlate.has(key)) byPlate.set(key, []);
        byPlate.get(key).push(row);
    });
    const vehicles = new Map();
    registry.forEach((row) => {
        const key = plateKey(row.placa);
        if (!key) return;
        const previous = vehicles.get(key) || {};
        vehicles.set(key, { ...previous, ...row, placa: String(row.placa).trim().toUpperCase(),
            dataEntrada: row.dataEntrada || previous.dataEntrada, key });
    });
    // A valid vehicle row in KM Semanal is not silently lost if the registry
    // response is temporarily incomplete. Spreadsheet error rows are excluded.
    rows.forEach((row) => {
        const key = plateKey(row.placa);
        if (key && !vehicles.has(key)) vehicles.set(key, { ...row, key });
    });
    const pending = [];
    const review = [];
    const last = new Date(`${month}-01T12:00:00Z`);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    const lastDate = last.toISOString().slice(0, 10);
    last.setUTCDate(last.getUTCDate() - 6);
    const lastWeekStart = last.toISOString().slice(0, 10);
    for (const vehicle of vehicles.values()) {
        const matches = byPlate.get(vehicle.key) || [];
        const entry = weeklyDate(vehicle.dataEntrada);
        const readingAt = (date) => {
            if (stale) return null;
            const index = dates.indexOf(date);
            if (index < 0) return null;
            return matches.map((row) => weeklyReading(row.leituras?.[index])).find((value) => value !== null) ?? null;
        };
        const count = expectedDates.filter((date) => readingAt(date) !== null).length;
        const exempt = entry && entry >= lastWeekStart && entry <= lastDate && count < 2;
        const missingDates = exempt ? [] : dueDates.filter((date) => (!entry || entry <= date) && readingAt(date) === null);
        // An uncertain competence is a separate data-quality warning, not
        // evidence that the driver failed to submit an otherwise filled week.
        if (missingDates.length) pending.push({ ...vehicle, missingDates });
        const futureDates = stale ? [] : expectedDates.filter((date) => date > today && readingAt(date) !== null);
        if (futureDates.length) review.push({ ...vehicle, futureDates });
    }
    if (review.length) warnings.push('Há leituras preenchidas em semanas futuras. Confira a competência antes de considerar o controle regular; a fórmula do mês não comprova a data dessas leituras.');
    const sort = (a, b) => String(a.placa).localeCompare(String(b.placa), 'pt-BR');
    return {
        month, monthLabel: new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00Z`)),
        pending: pending.sort(sort), review: review.sort(sort), warnings,
        total: vehicles.size, dueDates,
    };
}
