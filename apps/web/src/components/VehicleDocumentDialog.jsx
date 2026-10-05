import React, { useEffect, useState } from 'react';
import { FileCheck, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { API_SERVER_URL } from '@/lib/apiServerClient';

const DOCUMENT_PORTAL_URL = import.meta.env.VITE_DOCUMENT_PORTAL_URL || '';

// Folder discovery/uploads run inside Google's authenticated portal, never
// through the anonymous dashboard endpoint or a client-supplied Drive URL.
export default function VehicleDocumentDialog() {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState('loading');
    useEffect(() => {
        if (!open) return;
        if (DOCUMENT_PORTAL_URL) { setStatus('ready'); return; }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        setStatus('loading');
        fetch(`${API_SERVER_URL}?action=documentPortalStatus&t=${Date.now()}`, { signal: controller.signal })
            .then((response) => response.json())
            .then((payload) => setStatus(payload.documentPortalReady === true ? 'ready' : 'pending'))
            .catch(() => { if (!controller.signal.aborted) setStatus('error'); else setStatus('pending'); })
            .finally(() => clearTimeout(timeout));
        return () => { controller.abort(); clearTimeout(timeout); };
    }, [open]);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button variant="outline" className="gap-2"><FileCheck className="h-4 w-4" />Lançar documento</Button></DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader><DialogTitle>Documentos do veículo no Drive</DialogTitle><DialogDescription>Selecione a placa, confirme a pasta em Operações e envie o documento.</DialogDescription></DialogHeader>
                <ol className="list-decimal pl-5 space-y-2 text-sm">
                    <li>Entre com uma conta autorizada do setor de Frotas.</li>
                    <li>Escolha a placa. Se existir mais de uma pasta, confirme a correta.</li>
                    <li>Escolha uma subpasta existente ou crie uma nova.</li>
                    <li>Confira o destino e anexe um PDF, JPG ou PNG.</li>
                </ol>
                <p className="text-xs text-muted-foreground">O envio guarda o arquivo no Drive. Não altera datas ou status da planilha de documentação e não substitui arquivos existentes.</p>
                {status === 'loading' ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Verificando integração…</p>
                    : status !== 'ready' ? <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{status === 'error' ? 'Não foi possível verificar a integração. Tente abrir esta opção novamente.' : 'Ativação pendente: o envio de documentos ainda precisa ser publicado e autorizado na integração do Google. Nenhum arquivo será enviado enquanto isso.'}</p>
                        : <Button asChild className="gap-2"><a href={`${DOCUMENT_PORTAL_URL || API_SERVER_URL}?action=documentPortal`} target="_blank" rel="noopener noreferrer">Selecionar placa e pasta no Google<ExternalLink className="h-4 w-4" /></a></Button>}
            </DialogContent>
        </Dialog>
    );
}
