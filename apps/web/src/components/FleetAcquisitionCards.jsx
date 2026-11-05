import React, { useMemo, useState } from 'react';
import { ChevronRight, WalletCards, CheckCheck, CalendarDays } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { formatFinanceBRL as money } from '@/lib/ownedVehicleFinance';
import { acquisitionMonths, summarizeAcquisitions } from '@/lib/fleetAcquisitions';
import { overviewToday } from '@/lib/fleetOverview';

const monthLabel = month => `${month.slice(5)}/${month.slice(0, 4)}`;
const compact = value => (value / 100).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export default function FleetAcquisitionCards({ summary, insuranceItems, filters }) {
    const [history, setHistory] = useState(null);
    const model = useMemo(() => summarizeAcquisitions(summary, insuranceItems, filters, overviewToday()), [summary, insuranceItems, filters]);
    const chart = useMemo(() => acquisitionMonths(model.periodHistory), [model]);
    const historyRows = model.history.filter(row => (!history?.vehicleId || row.vehicleId === history.vehicleId) && (!history?.source || row.source === history.source));
    const historyMonths = acquisitionMonths(historyRows);
    const openHistory = (vehicleId = '', source = '') => {
        setHistory({ vehicleId, source });
        if (window.FLEET_BILLING_FRAME) window.top.postMessage({ type: 'fleetBillingFocus', frameId: window.FLEET_BILLING_FRAME }, 'https://rafaelgodoiartes.github.io');
    };
    return <section className="space-y-4" aria-label="Aquisição e pagamentos da frota própria">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold tracking-tight">Aquisição e seguro</h2><p className="text-xs text-muted-foreground mt-1">Parcelas de cada ativo já incluídas nas despesas fixas.</p></div><Button variant="outline" size="sm" onClick={() => openHistory()}><CalendarDays className="w-4 h-4 mr-2" />Ver meses pagos</Button></div>
        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-4">
            <Card className="p-5 shadow-none border-[#d7e7dc] grid gap-5 content-center">
                <div className="flex items-start gap-3"><span className="rounded-xl bg-green-50 p-2.5 text-[#1f7a46]"><WalletCards className="w-5 h-5" /></span><div><p className="text-xs text-muted-foreground">Parcelas de aquisição · {monthLabel(summary.month)}</p><p className="text-2xl font-semibold tracking-tight mt-1">{money(model.monthlyAcquisitionCents)}{model.monthlyMissing ? '*' : ''}</p><p className="text-[11px] text-muted-foreground mt-1">Previsão mensal · incluída nas fixas{model.monthlyMissing ? ' · subtotal disponível' : ''}</p></div></div>
                <button type="button" className="flex items-center justify-between gap-3 text-left border-t pt-4" onClick={() => openHistory('', 'Aquisição')}><div><p className="text-xs text-muted-foreground">Aquisição paga desde o início · estimativa</p><p className="text-xl font-semibold mt-1">{money(model.estimatedPaidCents)}{model.paidMissing ? '*' : ''}</p></div><ChevronRight className="w-4 h-4 shrink-0" /></button>
                <button type="button" className="flex items-center justify-between gap-3 text-left border-t pt-4" onClick={() => openHistory('', 'Seguro')}><div><p className="text-xs text-muted-foreground flex items-center gap-1.5"><CheckCheck className="w-3.5 h-3.5" />Seguro pago confirmado</p><p className="text-xl font-semibold mt-1">{money(model.insurancePaidCents)}</p></div><ChevronRight className="w-4 h-4 shrink-0" /></button>
            </Card>
            <Card className="p-4 shadow-none border-[#d7e7dc]"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">Histórico mensal de pagamentos</h3><span className="text-[10px] text-muted-foreground">Respeita o período selecionado</span></div>
                {!chart.length ? <p className="py-16 text-center text-xs text-muted-foreground">Nenhuma parcela paga confirmada neste período.</p> : <div className="h-52 mt-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{ left: 0, right: 8 }}><CartesianGrid vertical={false} stroke="#e7eee9" /><XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 9 }} minTickGap={22} /><YAxis tickFormatter={compact} width={46} tick={{ fontSize: 10 }} /><Tooltip labelFormatter={monthLabel} formatter={money} /><Bar dataKey="acquisitionCents" name="Aquisição estimada" stackId="paid" fill="#1f7a46" /><Bar dataKey="insuranceCents" name="Seguro confirmado" stackId="paid" fill="#9bbf44" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground mt-2"><span><i className="inline-block h-2 w-2 bg-[#1f7a46] rounded-sm mr-1" />Aquisição estimada</span><span><i className="inline-block h-2 w-2 bg-[#9bbf44] rounded-sm mr-1" />Seguro confirmado</span></div>
                <p className="text-[10px] text-muted-foreground leading-relaxed mt-3">Aquisição: quantidades pagas confirmadas até outubro/2026 × parcela atual. Meses iniciais estimados; não são comprovantes de valores históricos. Seguro: somente as 3 parcelas confirmadas.</p>
            </Card>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{model.assets.map(asset => <button type="button" key={asset.id} onClick={() => openHistory(asset.id)} className="bg-white rounded-xl border border-[#d7e7dc] p-4 text-left min-w-0 hover:border-[#7eae8b] hover:shadow-sm transition-shadow">
            <div className="flex justify-between gap-2"><span className="font-semibold text-sm truncate" title={asset.placa}>{asset.identificador || asset.placa}</span><ChevronRight className="w-4 h-4 shrink-0 text-[#7d9282]" /></div><p className="text-[10px] text-muted-foreground truncate mt-1" title={asset.veiculo}>{asset.veiculo}</p>
            <p className="text-[10px] text-muted-foreground mt-4">Parcela de aquisição atual</p><p className="text-xl font-semibold tracking-tight mt-0.5">{asset.hasAcquisition ? money(asset.currentCents) : '—'}</p>
            {asset.paid !== null ? <><div className="h-1.5 bg-[#edf3ee] rounded-full mt-3 overflow-hidden" role="progressbar" aria-label={`Quitação de ${asset.placa}`} aria-valuemin={0} aria-valuemax={asset.total} aria-valuenow={asset.paid}><div className="h-full bg-[#1f7a46] rounded-full" style={{ width: `${asset.paid / asset.total * 100}%` }} /></div><p className="text-[10px] text-muted-foreground mt-1.5"><b className="text-[#1f7a46]">{asset.paid}/{asset.total} pagas</b> · {asset.remaining} restantes</p></> : <p className="text-[10px] text-muted-foreground mt-3">{asset.hasAcquisition ? 'Histórico de parcelas não informado' : 'Sem parcela cadastrada'}</p>}
            <div className="border-t mt-3 pt-2.5 text-[10px] flex justify-between gap-2"><span className="text-muted-foreground">Seguro da referência</span><span>{asset.insuranceMissing ? 'Não informado' : money(asset.insuranceReferenceCents)}</span></div><div className="text-xs flex justify-between gap-2 mt-1.5"><span>Fixas previstas</span><b>{money(asset.fixedReferenceCents)}{asset.fixedIncomplete ? '*' : ''}</b></div>
        </button>)}</div>
        <p className="text-[10px] text-muted-foreground">Clique no ativo para ver todos os meses pagos desde o início. * Subtotal com valores ausentes.{model.missingHistory ? ` ${model.missingHistory} ativo(s) com aquisição sem histórico confirmado; nenhum pagamento foi presumido.` : ''}</p>
        <Dialog open={!!history} onOpenChange={open => { if (!open) setHistory(null); }}><DialogContent className="top-4 translate-y-0 sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>Meses pagos · {history?.vehicleId || history?.source || 'Frota própria'}</DialogTitle><DialogDescription>Desde o início, independentemente do filtro de período. Aquisição: valores e competências estimados pela posição confirmada; seguro: parcelas confirmadas. Novembro não foi marcado como pago.</DialogDescription></DialogHeader>
            {!historyMonths.length ? <p className="text-sm text-muted-foreground">Nenhum histórico de pagamento confirmado para este ativo. O valor mensal do Cadastro continua nas despesas fixas quando informado.</p> : <div className="space-y-2">{historyMonths.map(month => <details key={month.month} className="border rounded-lg p-3 text-xs"><summary className="cursor-pointer font-medium"><span>{monthLabel(month.month)}</span><span className="float-right">{money(month.acquisitionCents + month.insuranceCents)}{month.missing ? '*' : ''}</span></summary><div className="space-y-2 mt-3">{month.records.map(row => <div key={row.id} className="flex justify-between gap-3 border-t pt-2"><span>{row.label} · {row.source} {row.number}/{row.total}<small className="block text-muted-foreground mt-0.5">{row.estimated ? 'Paga · valor estimado pela parcela atual' : 'Paga · valor confirmado da apólice'}</small></span><b className="whitespace-nowrap">{money(row.amountCents)}</b></div>)}</div></details>)}</div>}
        </DialogContent></Dialog>
    </section>;
}
