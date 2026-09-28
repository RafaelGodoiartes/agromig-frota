import { useCallback, useEffect, useState } from 'react';
import apiServerClient from '@/lib/apiServerClient';

const EPICOLLECT_CHECKLIST_URL = 'https://five.epicollect.net/api/export/entries/checklist-de-veiculos-e-maquinas?per_page=500&sort_by=created_at&sort_order=DESC&format=json&headers=true';

async function loadEpicollectChecklist() {
    const response = await fetch(EPICOLLECT_CHECKLIST_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Epicollect5 respondeu ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload?.data?.entries) ? payload.data.entries : [];
}

// Fetches the normalized fleet dataset from the Express proxy that reads the
// two Google Sheets. Returns { data, loading, error, refresh }.
export function useFleetData() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async (force = false) => {
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
            // O checklist é público no Epicollect5. Uma falha temporária nele
            // não deve impedir o painel principal de carregar.
            let checklist = [];
            try { checklist = await loadEpicollectChecklist(); } catch { /* painel continua disponível */ }
            setData({ ...json, checklist });
        } catch (err) {
            setError(err.message || 'Falha ao carregar o painel.');
        } finally {
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
