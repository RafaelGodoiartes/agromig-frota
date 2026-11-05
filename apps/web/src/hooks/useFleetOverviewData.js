import { useEffect, useRef, useState, useCallback } from 'react';
import apiServerClient from '@/lib/apiServerClient';
import { loadOwnedVehicleRegistry } from '@/lib/ownedVehicleFinanceSources';
import { loadFaturamentoSources } from '@/lib/faturamentoSources';
import { loadDocumentPayments } from '@/lib/documentPayments';
import { loadAbastecimentoSources } from '@/lib/abastecimentoSources';

export function overviewRpc(method) {
    return new Promise((resolve, reject) => {
        if (!window.google?.script?.run) return reject(new Error('Abra a Visão Geral pela área autenticada do Painel Frotas.'));
        const timeout = setTimeout(() => reject(new Error('A integração demorou a responder. Tente atualizar novamente.')), 45000);
        window.google.script.run.withSuccessHandler(value => { clearTimeout(timeout); resolve(value); }).withFailureHandler(error => { clearTimeout(timeout); reject(new Error(error.message || 'Falha na integração.')); })[method]();
    });
}
export function useFleetOverviewData() {
    const [snapshot, setSnapshot] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
    const request = useRef(0), mounted = useRef(true);
    const load = useCallback(async () => {
        const id = ++request.current; setLoading(true); setError('');
        try {
            // Authenticate before loading/composing the financial view. Private
            // measurement records never cross the iframe or enter public JSON.
            const billing = await overviewRpc('getFleetOverviewState');
            const response = await apiServerClient.fetch('/fleet/refresh', { method: 'GET' });
            if (!response.ok) throw new Error('Não foi possível atualizar os dados da frota.');
            const base = await response.json();
            const [registry, revenues, documents, supplies] = await Promise.all([loadOwnedVehicleRegistry(), loadFaturamentoSources(), loadDocumentPayments(), loadAbastecimentoSources()]);
            if (mounted.current && id === request.current) setSnapshot({ billing, data: { ...base, ...revenues, ...supplies, cadastroFinanceiro: registry, pagamentosDocumentacao: documents }, at: new Date() });
        } catch (failure) { if (mounted.current && id === request.current) setError(failure.message); }
        finally { if (mounted.current && id === request.current) setLoading(false); }
    }, []);
    useEffect(() => {
        mounted.current = true; load();
        const interval = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
        return () => { mounted.current = false; request.current++; clearInterval(interval); };
    }, [load]);
    return { snapshot, loading, error, refresh: load };
}
