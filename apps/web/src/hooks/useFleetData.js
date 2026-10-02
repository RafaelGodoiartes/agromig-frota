import { useCallback, useEffect, useRef, useState } from 'react';
import apiServerClient from '@/lib/apiServerClient';
import { loadFaturamentoSources } from '@/lib/faturamentoSources';
import { loadAbastecimentoSources } from '@/lib/abastecimentoSources';
import { loadOwnedVehicleRegistry } from '@/lib/ownedVehicleFinanceSources';

const EPICOLLECT_CHECKLIST_URL = 'https://five.epicollect.net/api/export/entries/checklist-de-veiculos-e-maquinas?per_page=500&sort_by=created_at&sort_order=DESC&format=json&headers=true';
const VEHICLE_LIMITS_URL = 'https://docs.google.com/spreadsheets/d/1DieFJq4Bt3Q3UBBcLefdVioSkVAG5BMiuXjiwEcrRoM/gviz/tq?tqx=out:json&gid=1477905702&tq=select%20A%2CE%2CI';

function vehicleKey(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseSheetNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const raw = String(value ?? '').trim().replace(/\s/g, '');
    if (!raw) return null;
    const normalized = raw.includes(',') && raw.includes('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.includes(',')
            ? raw.replace(',', '.')
            : /^-?\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

async function loadVehicleMaintenanceLimits() {
    const response = await fetch(`${VEHICLE_LIMITS_URL}&t=${Date.now()}`, { headers: { Accept: 'text/plain' } });
    if (!response.ok) throw new Error(`Cadastro de veículos respondeu ${response.status}`);
    const body = await response.text();
    const match = body.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);\s*$/);
    if (!match) throw new Error('Resposta do cadastro de veículos inválida.');
    const payload = JSON.parse(match[1]);
    const limits = new Map();
    (payload?.table?.rows || []).forEach((row) => {
        const cells = row?.c || [];
        const plate = cells[0]?.v || '';
        const limit = parseSheetNumber(cells[1]?.v ?? cells[1]?.f);
        const unit = String(cells[2]?.v ?? cells[2]?.f ?? '').trim();
        if (vehicleKey(plate) && limit !== null) limits.set(vehicleKey(plate), { limiteManutencao: limit, unidade: unit || undefined });
    });
    return limits;
}

async function loadEpicollectChecklist() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(EPICOLLECT_CHECKLIST_URL, { headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) throw new Error(`Epicollect5 respondeu ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload?.data?.entries)) {
            throw new Error('Resposta de checklist inválida.');
        }
        return payload.data.entries;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

// Fetches the normalized fleet dataset from the Express proxy that reads the
// two Google Sheets. Returns { data, loading, error, refresh }.
export function useFleetData() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const loadingRef = useRef(false);
    const checklistRequestRef = useRef(0);
    const financeRequestRef = useRef(0);
    const abastecimentoRequestRef = useRef(0);
    const ownedFinanceRequestRef = useRef(0);

    const load = useCallback(async (force = false) => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        setError(null);
        try {
            const url = force ? '/fleet/refresh' : '/fleet';
            const res = await apiServerClient.fetch(url, { method: 'GET' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `Erro ${res.status} ao buscar dados`);
            }
            const json = await res.json();
            // O Apps Script antigo ainda pode estar servindo uma versão sem
            // o campo LIMITE DE MANUTENÇÃO do cadastro. Complementamos os
            // veículos diretamente pela aba publicada, sem alterar os demais
            // dados retornados pela integração.
            let maintenanceLimits = new Map();
            try { maintenanceLimits = await loadVehicleMaintenanceLimits(); } catch { /* integração complementar opcional */ }
            const enrichedJson = {
                ...json,
                veiculos: (json.veiculos || []).map((vehicle) => {
                    const extra = maintenanceLimits.get(vehicleKey(vehicle.placa));
                    return extra ? { ...vehicle, ...extra } : vehicle;
                }),
            };
            // O checklist é sincronizado em segundo plano. A planilha e o
            // painel principal nunca ficam bloqueados se o Epicollect5 demorar.
            const checklistRequestId = ++checklistRequestRef.current;
            const financeRequestId = ++financeRequestRef.current;
            const abastecimentoRequestId = ++abastecimentoRequestRef.current;
            const ownedFinanceRequestId = ++ownedFinanceRequestRef.current;
            setData((current) => ({
                ...enrichedJson,
                viagensLTU5A25: enrichedJson.viagensLTU5A25 ?? current?.viagensLTU5A25,
                locacoesRetroescavadeira: enrichedJson.locacoesRetroescavadeira ?? current?.locacoesRetroescavadeira,
                faturamentoLoading: true,
                faturamentoError: null,
                cadastroFinanceiro: current?.cadastroFinanceiro,
                cadastroFinanceiroLoading: true,
                cadastroFinanceiroError: null,
                tiposAbastecimento: current?.tiposAbastecimento || ['Combustível', 'Graxa'],
                itensAbastecimento: current?.itensAbastecimento || [],
                outrosAbastecimentos: current?.outrosAbastecimentos || [],
                abastecimentoExtrasLoading: true,
                abastecimentoExtrasError: null,
                checklist: current?.checklist ?? [],
                checklistLoaded: current?.checklistLoaded === true,
                checklistLoading: true,
                checklistError: null,
            }));
            loadAbastecimentoSources()
                .then((sources) => setData((current) => (
                    current && abastecimentoRequestRef.current === abastecimentoRequestId
                        ? { ...current, ...sources, abastecimentoExtrasLoading: false, abastecimentoExtrasError: null }
                        : current
                )))
                .catch(() => setData((current) => (
                    current && abastecimentoRequestRef.current === abastecimentoRequestId
                        ? { ...current, abastecimentoExtrasLoading: false, abastecimentoExtrasError: 'Não foi possível atualizar as categorias e os lançamentos de graxa/lubrificantes. Os últimos dados foram mantidos; tente Atualizar novamente.' }
                        : current
                )));
            loadFaturamentoSources(enrichedJson)
                .then((finance) => setData((current) => (
                    current && financeRequestRef.current === financeRequestId
                        ? { ...current, ...finance, faturamentoLoading: false, faturamentoError: null }
                        : current
                )))
                .catch(() => setData((current) => (
                    current && financeRequestRef.current === financeRequestId
                        ? { ...current, faturamentoLoading: false, faturamentoError: 'Não foi possível atualizar as viagens e locações. Clique em Atualizar para tentar novamente.' }
                        : current
                )));
            loadOwnedVehicleRegistry()
                .then((vehicles) => setData((current) => (
                    current && ownedFinanceRequestRef.current === ownedFinanceRequestId
                        ? { ...current, cadastroFinanceiro: vehicles, cadastroFinanceiroLoading: false, cadastroFinanceiroError: null }
                        : current
                )))
                .catch(() => setData((current) => (
                    current && ownedFinanceRequestRef.current === ownedFinanceRequestId
                        ? { ...current, cadastroFinanceiroLoading: false, cadastroFinanceiroError: 'Não foi possível atualizar os valores mensais do Cadastro. Os últimos dados carregados foram mantidos; clique em Atualizar para tentar novamente.' }
                        : current
                )));
            loadEpicollectChecklist()
                .then((checklist) => setData((current) => (
                    current && checklistRequestRef.current === checklistRequestId
                        ? { ...current, checklist, checklistLoaded: true, checklistLoading: false, checklistError: null }
                        : current
                )))
                .catch(() => setData((current) => (
                    current && checklistRequestRef.current === checklistRequestId
                        ? {
                            ...current,
                            checklistLoading: false,
                            checklistError: 'Não foi possível atualizar os checklists. Tente atualizar novamente.',
                        }
                        : current
                )));
        } catch (err) {
            setError(err.message || 'Falha ao carregar o painel.');
        } finally {
            loadingRef.current = false;
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load(false);
    }, [load]);

    useEffect(() => {
        const refreshWhenVisible = () => {
            if (document.visibilityState === 'visible') load(true);
        };
        const intervalId = window.setInterval(refreshWhenVisible, 60 * 1000);
        document.addEventListener('visibilitychange', refreshWhenVisible);
        window.addEventListener('focus', refreshWhenVisible);
        return () => {
            window.clearInterval(intervalId);
            document.removeEventListener('visibilitychange', refreshWhenVisible);
            window.removeEventListener('focus', refreshWhenVisible);
        };
    }, [load]);

    const refresh = useCallback(() => load(true), [load]);

    return { data, loading, error, refresh };
}
