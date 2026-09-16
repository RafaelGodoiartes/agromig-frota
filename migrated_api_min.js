export const API_SERVER_URL = import.meta.env.VITE_API_BASE_URL || 'https://script.google.com/macros/s/AKfycbwKBs32W3KZqQO2pqRqXErs0AfmofIdRUAuoUmvVQNg_9ulpC4S_bibFde9L3pUxPjf/exec';
const S1 = '1_mGLa1rqNfuFdHyi3GwN1O0pFHvf9TTZKVwz5VCvjlc';
const S2 = '1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM';
let cache = null;
const s = v => String(v ?? '').trim();
const n = v => { if (v === '' || v == null) return ''; const x = Number(String(v).replace(/\s/g,'').replace(',', '.')); return Number.isFinite(x) ? x : ''; };
const reply = (p, status = 200) => new Response(JSON.stringify(p), { status, headers: { 'Content-Type': 'application/json' } });
async function read(r) { const t = await r.text(); let p = {}; try { p = t ? JSON.parse(t) : {}; } catch { p = { ok: false, message: 'Resposta inválida do Google Apps Script.' }; } if (p.meta) cache = p; return reply(p, p.ok === false ? 400 : r.status); }
function command(route, i) {
  const d = cache || {};
  if (route === '/fleet/km-semanal') return { action: 'weeklyKm', spreadsheetId: S2, sheetName: 'KM Semanal', plate: s(i.placa).toUpperCase(), date: i.data, reading: n(i.leitura), pin: i.pin };
  if (route === '/fleet/veiculo') return { action: 'append', spreadsheetId: S2, sheetName: 'Cadastro de Veículos', pin: i.pin, values: [s(i.placa).toUpperCase(), s(i.veiculo), s(i.combustivel), s(i.propriedade), '', s(i.tipoPosse), n(i.franquia), s(i.projeto), s(i.unidade) || 'KM', s(i.identificador), i.dataEntrada || '', s(i.folderUrl)] };
  if (route === '/fleet/abastecimento') { const p = s(i.placa).toUpperCase(); const v = (d.veiculosAbastecimento || []).find(x => x.placa === p) || {}; const l = n(i.litros), total = n(i.valor), unit = l > 0 && total !== '' ? total / l : n(i.precoLitro); return { action: 'append', spreadsheetId: S1, sheetName: 'Gastos', pin: i.pin, values: [s(i.data), p, v.veiculo || p, s(i.projeto), 'Combustível', s(i.item), total, n(i.km), s(i.fa), l, unit, s(i.posto), '', s(i.observacoes), 'PENDENTE', '', String(Date.now()) + '-' + p] }; }
  if (route === '/fleet/manutencao') { const p = s(i.placa).toUpperCase(); const v = (d.veiculos || []).find(x => x.placa === p) || {}; const id = Math.max(0, ...(d.manutencao || []).map(x => Number(x.id) || 0)) + 1; const st = s(i.status).toUpperCase(); return { action: 'append', spreadsheetId: S2, sheetName: 'Histórico de Manutenção', pin: i.pin, values: [id, p, v.veiculo || p, s(i.projeto), v.tipoPosse || v.propriedade || '', st, 'Manutenção ' + (s(i.tipo) || 'Outros'), s(i.descricao), s(i.peca), s(i.dataChamado), s(i.dataPrevista), st === 'FINALIZADO' ? s(i.dataConclusao) : '', '', n(i.km), v.unidade || 'KM', n(i.valor), '', '', '', n(i.valor), s(i.responsavel), s(i.fornecedor), ''] }; }
  return null;
}
const apiServerClient = { fetch: async (url, options = {}) => { if (String(options.method || 'GET').toUpperCase() === 'GET') { const e = API_SERVER_URL + '?action=readFleetData' + (url.includes('refresh') ? '&t=' + Date.now() : ''); return read(await window.fetch(e)); } const i = typeof options.body === 'string' ? JSON.parse(options.body || '{}') : (options.body || {}); const c = command(url, i); if (!c) return reply({ ok: false, message: 'Rota não suportada: ' + url }, 400); const r = await window.fetch(API_SERVER_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(c) }); const out = await read(r); cache = null; return out; } };
export default apiServerClient;
export { apiServerClient };
