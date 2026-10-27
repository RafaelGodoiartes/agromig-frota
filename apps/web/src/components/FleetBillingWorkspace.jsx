import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, ShieldCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const FLEET_BILLING_PORTAL_URL = 'https://script.google.com/a/macros/agromig.com.br/s/AKfycbwO3DXAEi3PNg4u7ExG68xTMQft2ccWEhnRRu2k5MgVG8O7elGLA4z-26IHbou2lTZU/exec?action=billingPortal';

export default function FleetBillingWorkspace() {
    const [frameId] = useState(() => crypto.randomUUID());
    const [height, setHeight] = useState(1400);
    const [reload, setReload] = useState(0);
    const frame = useRef(null);
    useEffect(() => {
        const receive = (event) => {
            let host;
            try { host = new URL(event.origin).hostname; } catch { return; }
            if (host !== 'script.google.com' && !host.endsWith('.script.googleusercontent.com') && !host.endsWith('-script.googleusercontent.com')) return;
            if (event.data?.frameId !== frameId) return;
            if (event.data.type === 'fleetBillingResize' && Number.isFinite(event.data.height)) setHeight(Math.max(850, Math.min(5000, event.data.height + 30)));
            if (event.data.type === 'fleetBillingFocus') frame.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, [frameId]);
    return <section className="space-y-3">
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3 border-green-200 bg-green-50/40">
            <div className="text-sm max-w-3xl"><p className="flex items-center gap-2 font-semibold text-[#1f6b3d]"><ShieldCheck className="h-4 w-4" />Projetos e medições — área autenticada</p><p className="mt-1 text-muted-foreground">Entre com sua conta corporativa. São mantidas as permissões de consulta e gestão da integração Google; os novos registros ficam em uma base financeira privada. Se o Google solicitar login, abra a área abaixo e depois recarregue o quadro.</p></div>
            <div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><a href={FLEET_BILLING_PORTAL_URL} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-2" />Entrar na área de medições</a></Button><Button variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}><RefreshCw className="h-4 w-4 mr-2" />Recarregar quadro</Button></div>
        </Card>
        <iframe ref={frame} key={reload} title="Projetos e medições da frota" src={`${FLEET_BILLING_PORTAL_URL}&frameId=${frameId}`} className="w-full rounded-xl border bg-white scroll-mt-24" style={{ height }} />
    </section>;
}
