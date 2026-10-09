// Pure, server-side rules. Every outcome is provisional until human approval.
const BONUS_DEFAULT_RULES = Object.freeze({ kmCents: 90, trustCents: 100000, checklistCents: 16000,
  circulationCents: 12000, speedCents: 20000, washCents: 12000, finesCents: 10000,
  allowedStart: '06:00', allowedEnd: '19:00', carLimit: 110, busLimit: 90, otherLimit: 80,
  washEveryDays: null, sendDay: 10, sendHour: 8 });

function bonusKey_(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function bonusNameKey_(value) {
  const key = bonusKey_(value);
  return ({ SIDENIOBISPO: 'SIDENIOBISPOMARTINS', CARLOSALEXANDRE: 'CARLOSALEXANDREDESOUZASANTOS' })[key] || key;
}
function bonusNumber_(value) {
  if (value === '' || value == null) return null;
  const raw = String(value).replace(/R\$/g, '').replace(/\s/g, '');
  const parsed = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw);
  return /^\d+(?:[.,]\d+)*$/.test(raw) && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function bonusDate_(value) {
  let text = String(value || '').slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) text = text.split('/').reverse().join('-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(text + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
}
function bonusMonth_(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value))) throw new Error('Competência inválida.');
  return value;
}
function bonusDays_(value, month) {
  const days = [...new Set(String(value || '').split(/[,;\s]+/).filter(Boolean).map(bonusDate_))].sort();
  if (!days.length || days.some(day => !day || day.slice(0, 7) !== month)) throw new Error('Informe as datas efetivamente trabalhadas na competência.');
  return days;
}
function bonusTripAmount_(initial, final, rateCents) {
  const start = bonusNumber_(initial), end = bonusNumber_(final);
  if (start === null || end === null || end <= start) throw new Error('KM final deve ser maior que o inicial.');
  const km = end - start, cents = Math.round(km * rateCents);
  if (!Number.isSafeInteger(cents)) throw new Error('Valor fora do limite.');
  return { km, cents };
}
function bonusResponsible_(driver, plate, date, assignments) {
  const matches = assignments.filter(row => row.active !== false && bonusKey_(row.plate) === bonusKey_(plate) && row.from <= date && row.to >= date);
  const drivers = [...new Set(matches.map(row => bonusNameKey_(row.driver)))];
  return drivers.length === 1 && drivers[0] === bonusNameKey_(driver);
}
function bonusRulesFor_(versions, month) {
  return versions.filter(row => row.from <= month).sort((a, b) => b.from.localeCompare(a.from))[0]?.rules || BONUS_DEFAULT_RULES;
}
function bonusEvaluate_(input, evidence, rules) {
  const days = bonusDays_(input.workedDates, input.month);
  const plates = String(input.plates || '').split(/[,;\s]+/).filter(Boolean).map(bonusKey_);
  if (!plates.length) throw new Error('Informe os veículos utilizados.');
  const pending = [], occurrences = [];
  const belongs = row => days.includes(row.date) && plates.includes(bonusKey_(row.plate));
  const attributed = row => bonusResponsible_(input.driver, row.plate, row.date, evidence.assignments || []);
  const assignedDays = days.filter(day => plates.some(plate => bonusResponsible_(input.driver, plate, day, evidence.assignments || [])));
  if (assignedDays.length !== days.length) pending.push('Histórico de responsabilidade não cobre todos os dias trabalhados.');
  const checklistDays = days.filter(day => (evidence.checklists || []).some(row => row.date === day && row.valid === true && plates.includes(bonusKey_(row.plate)) && bonusNameKey_(row.driver) === bonusNameKey_(input.driver) && attributed(row)));
  if (!evidence.checklistComplete) pending.push('Consulta de checklist incompleta.');
  const results = [{ criterion: 'Checklist', maximumCents: rules.checklistCents,
    cents: Math.round(rules.checklistCents * checklistDays.length / days.length),
    reason: checklistDays.length + ' de ' + days.length + ' dias trabalhados com checklist válido.',
    missingDates: days.filter(day => !checklistDays.includes(day)) }];
  const movement = (evidence.circulation || []).filter(belongs);
  const irregular = movement.filter(row => row.time && (row.time < rules.allowedStart || row.time > rules.allowedEnd) && !row.authorized);
  const provenIrregular = irregular.filter(row => attributed(row) && row.confirmed);
  if (!evidence.circulationComplete || irregular.some(row => !attributed(row) || !row.confirmed)) pending.push('Circulação: cobertura, ocorrência ou responsabilidade não comprovada.');
  occurrences.push(...provenIrregular.map(row => ({ ...row, criterion: 'Circulação', reason: 'Fora do horário e sem exceção autorizada.' })));
  results.push({ criterion: 'Circulação', maximumCents: rules.circulationCents, cents: provenIrregular.length ? 0 : rules.circulationCents, reason: provenIrregular.length ? 'Ocorrência eliminatória; requer decisão humana.' : 'Sem irregularidade atribuída nos dados consultados.' });
  const speeding = (evidence.speed || []).filter(belongs).filter(row => bonusNumber_(row.speed) > (row.roadLimit ? Math.min(row.limit, row.roadLimit) : row.limit));
  const provenSpeed = speeding.filter(row => attributed(row) && row.confirmed);
  if (!evidence.speedComplete || speeding.some(row => !attributed(row) || !row.confirmed)) pending.push('Velocidade: cobertura, ocorrência ou responsabilidade não comprovada.');
  occurrences.push(...provenSpeed.map(row => ({ ...row, criterion: 'Velocidade', reason: 'Velocidade superior ao limite aplicável.' })));
  results.push({ criterion: 'Velocidade', maximumCents: rules.speedCents, cents: provenSpeed.length ? 0 : rules.speedCents, reason: provenSpeed.length ? 'Excesso atribuído nos registros; sujeito à revisão.' : 'Sem excesso atribuído nos dados consultados.' });
  const requiredWashes = String(input.washDates || '').split(/[,;\s]+/).filter(Boolean).map(bonusDate_);
  if (!requiredWashes.length || requiredWashes.some(date => !days.includes(date))) pending.push('Defina as datas de lavagem exigidas entre os dias trabalhados.');
  const missingWashes = requiredWashes.filter(date => !(evidence.washes || []).some(row => row.date === date && belongs(row) && attributed(row) && row.evidenceId));
  if (!evidence.washComplete) pending.push('Lavagem: comprovação do período não conferida.');
  results.push({ criterion: 'Lavagem', maximumCents: rules.washCents, cents: missingWashes.length ? 0 : rules.washCents, reason: missingWashes.length ? 'Lavagens exigidas sem comprovação.' : 'Lavagens previstas comprovadas.', missingDates: missingWashes });
  const fines = (evidence.fines || []).filter(belongs);
  const provenFines = fines.filter(row => row.confirmed && !row.contested && attributed(row));
  if (!evidence.finesComplete || fines.some(row => !row.confirmed || row.contested || !attributed(row))) pending.push('Multas: cobertura, contestação ou responsável pendente.');
  occurrences.push(...provenFines.map(row => ({ ...row, criterion: 'Multas', reason: 'Infração atribuída e não contestada.' })));
  results.push({ criterion: 'Multas', maximumCents: rules.finesCents, cents: provenFines.length ? 0 : rules.finesCents, reason: provenFines.length ? 'Multa atribuída; sujeito à revisão.' : 'Sem multa elegível atribuída nos registros.' });
  const beforeEliminationCents = results.reduce((sum, row) => sum + row.cents, 0);
  return { days, plates, checklistDays, results, pending, occurrences, beforeEliminationCents,
    eliminationSuggested: provenIrregular.length > 0, provisionalCents: provenIrregular.length ? 0 : beforeEliminationCents,
    maximumCents: results.reduce((sum, row) => sum + row.maximumCents, 0), requiresHumanReview: true };
}
