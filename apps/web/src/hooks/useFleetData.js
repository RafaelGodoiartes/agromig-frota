import { useCallback, useEffect, useRef, useState } from 'react';
import apiServerClient from '@/lib/apiServerClient';

const EPICOLLECT_CHECKLIST_URL = 'https://five.epicollect.net/api/export/entries/checklist-de-veiculos-e-maquinas?per_page=500&sort_by=created_at&sort_order=DESC&format=json&headers=true';

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
            // O checklist é sincronizado em segundo plano. A planilha e o
            // painel principal nunca ficam bloqueados se o Epicollect5 demorar.
            const checklistRequestId = ++checklistRequestRef.current;
            setData((current) => ({
                ...json,
                checklist: current?.checklist ?? [],
                checklistLoaded: current?.checklistLoaded === true,
                checklistLoading: true,
                checklistError: null,
            }));
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
