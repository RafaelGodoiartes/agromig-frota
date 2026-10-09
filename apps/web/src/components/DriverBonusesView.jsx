import React from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Private Google deployment: never request financial/personnel data through
// the anonymous fleet API or store it in this page's localStorage.
export const DRIVER_BONUS_PORTAL_URL = 'https://script.google.com/a/macros/agromig.com.br/s/AKfycbzGkKqGds1LRNz_Vnt_jAXyVYI0W9HeutXfKSsp6v306v9PVqQ4qT1n14vb6KCLnYtz/exec';

export default function DriverBonusesView() {
    return <Card className="p-5 flex flex-col gap-4 border-[#cfe8d5] bg-[#f8fcf9]">
        <div><h2 className="text-lg font-semibold text-[#1f6b3d]">Bonificações dos Motoristas</h2>
            <p className="text-sm text-muted-foreground mt-2">Área operacional do Painel Frotas para viagens, cargo de confiança, avaliações de KPIs, evidências, aprovações e relatórios. Sem dashboard adicional.</p></div>
        <p className="text-sm flex items-start gap-2"><ShieldCheck className="h-5 w-5 shrink-0 text-[#1f7a46]" />Acesso exclusivo à conta frota@agromig.com.br. A área abre na autenticação do Google para proteger valores, documentos e decisões de pagamento.</p>
        <Button asChild className="gap-2 self-start"><a href={DRIVER_BONUS_PORTAL_URL} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />Abrir bonificações com a conta Frota</a></Button>
        <div className="text-sm space-y-2"><p>Selecione o motorista da aba Motoristas e a competência. Cadastre as viagens ou concessões, confira os períodos de utilização e importe os relatórios operacionais.</p>
            <p>Os KPIs são provisórios até revisão humana. Documentos ausentes, responsabilidade não comprovada e importações incompletas impedem a aprovação.</p>
            <p className="font-medium text-[#1f6b3d]">Antes de cada envio, confira os quatro anexos e registre a liberação. Sem conferência válida, o relatório não é enviado.</p>
            <p className="text-xs text-muted-foreground">O agendamento é ativado dentro da área restrita. Abrir esta aba não ativa e-mails nem cadastra bonificações.</p></div>
    </Card>;
}
