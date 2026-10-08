import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { VEHICLE_INSTALLMENTS, installmentCalendar, resolveInstallmentAmounts, estimateInstallmentTotals } from '@/lib/vehicleInstallments';
import { formatFinanceBRL } from '@/lib/ownedVehicleFinance';

const brDate = (value) => value.split('-').reverse().join('/');

export default function VehicleInstallmentSummary({ data }) {
    const [selected, setSelected] = useState('all');
    const [status, setStatus] = useState('remaining');
    const dateParts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = type => dateParts.find(row => row.type === type).value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const contracts = resolveInstallmentAmounts(data?.cadastroFinanceiro || []).filter(row => selected === 'all' || row.id === selected);
    const totals = estimateInstallmentTotals(contracts);
    const rows = contracts.flatMap(contract => installmentCalendar(contract, today)
        .filter(row => status === 'all' || (status === 'paid' ? row.confirmedPaid : !row.confirmedPaid))
        .map(row => ({ ...row, contract }))).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.contract.id.localeCompare(b.contract.id));
    return <Card className="p-4 flex flex-col gap-4 border-[#cfe8d5] bg-[#f8fcf9]">
        <div><h3 className="text-base font-semibold text-[#1f6b3d]">Parcelas de veículos e máquinas</h3>
            <p className="text-sm text-muted-foreground">Vencimento todo dia 01. Posição de pagamentos confirmada em 08/10/2026.</p>
            <p className="text-xs text-amber-800 mt-2">Calendário estimado: parcelas mensais consecutivas, considerando outubro/2026 como o último mês pago. Não comprova a data do contrato, a data real do pagamento nem os valores históricos. As parcelas atuais também compõem as despesas fixas previstas no resumo mensal abaixo, sem alterar o seguro.</p>
            <p className="text-xs text-muted-foreground mt-2">Fonte dos valores atuais: Cadastro de Veículos → PARCELA MENSAL (R$), somente os veículos próprios financiados identificados. Atualizar relê o Cadastro. Prancha: valor atualizado confirmado pelo gestor.</p>
            {data?.cadastroFinanceiroError && <p role="alert" className="text-sm text-amber-800 mt-2">{data.cadastroFinanceiroError}</p>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{contracts.map(contract => {
            const schedule = installmentCalendar(contract, today);
            return <div key={contract.id} className="rounded-xl border bg-white p-4">
                <h4 className="font-semibold">{contract.name}</h4>
                <p className="text-sm mt-2">{contract.paid} pagas de {contract.total} · {contract.total - contract.paid} restantes</p>
                <div className="h-2 bg-green-100 rounded-full my-2" role="progressbar" aria-label={`Parcelas quitadas — ${contract.name}`} aria-valuemin={0} aria-valuemax={contract.total} aria-valuenow={contract.paid}><div className="h-2 bg-green-700 rounded-full" style={{ width: `${contract.paid / contract.total * 100}%` }} /></div>
                <p className="text-xs">{(contract.paid / contract.total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% das parcelas quitadas · início estimado: {brDate(schedule[0].dueDate)}</p>
                <p className="text-xs mt-2">Parcela atual: {contract.currentCents === null ? 'Não informado' : `${formatFinanceBRL(contract.currentCents)} (valor atual, não histórico)`}</p>
                <p className="text-xs text-muted-foreground mt-1">{contract.amountNote}</p>
                {contract.members.map(member => <p key={member.plate} className="text-xs mt-1">{member.plate}: {member.cents === null ? 'Não informado' : formatFinanceBRL(member.cents)}</p>)}
                <div className="border-t mt-3 pt-3 space-y-1">
                    <p className="text-sm font-semibold text-green-800">Total pago estimado: {contract.currentCents === null ? 'Não disponível' : formatFinanceBRL(contract.currentCents * contract.paid)}</p>
                    <p className="text-xs text-muted-foreground">Desde o início · {contract.paid} parcelas pagas × valor mensal atual do grupo.</p>
                    <p className="text-xs">Saldo estimado: {contract.currentCents === null ? 'Não disponível' : formatFinanceBRL(contract.currentCents * (contract.total - contract.paid))}</p>
                    <p className="text-xs">Total efetivamente pago: não disponível sem histórico de valores.</p>
                </div>
            </div>;
        })}</div>
        <div className="rounded-xl border bg-white p-4">
            <h4 className="font-semibold text-[#1f6b3d]">Acumulado estimado desde o início — {selected === 'all' ? 'Todos os equipamentos' : contracts[0]?.name}</h4>
            <p className="text-xs text-muted-foreground mt-1">Referência: posição confirmada em 08/10/2026. Recalcula todas as parcelas ao valor atual, sem considerar reajustes históricos. Não representa total pago comprovado e não entra novamente nas despesas mensais.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">{[['Total pago estimado', totals.estimatedPaidCents], ['Saldo restante estimado', totals.estimatedRemainingCents], ['Total dos contratos estimado', totals.estimatedContractCents]].map(([label, amount]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold text-[#1f6b3d]">{amount === null ? 'Não disponível' : formatFinanceBRL(amount)}</p></div>)}</div>
        </div>
        <div className="flex flex-wrap gap-3">
            <label className="text-sm">Equipamento<select className="block rounded-md border p-2 bg-white max-w-full" value={selected} onChange={event => setSelected(event.target.value)}><option value="all">Todos</option>{VEHICLE_INSTALLMENTS.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="text-sm">Parcelas<select className="block rounded-md border p-2 bg-white" value={status} onChange={event => setStatus(event.target.value)}><option value="remaining">Restantes</option><option value="paid">Pagas — posição confirmada</option><option value="all">Todas</option></select></label>
        </div>
        <details><summary className="cursor-pointer font-medium text-[#1f6b3d]">Calendário de parcelas ({rows.length})</summary>
            <div className="overflow-auto max-h-96 mt-3"><table className="w-full text-sm bg-white"><thead className="sticky top-0 bg-green-50"><tr>{['Equipamento', 'Parcela', 'Vencimento estimado', 'Valor previsto', 'Status'].map(label => <th key={label} className="text-left p-3 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={`${row.contract.id}-${row.number}`} className="border-t"><td className="p-3">{row.contract.name}</td><td className="p-3">{row.number}/{row.contract.total}</td><td className="p-3 whitespace-nowrap">{brDate(row.dueDate)}</td><td className="p-3 whitespace-nowrap">{row.projectedCents === null ? 'Não informado' : `${formatFinanceBRL(row.projectedCents)} (estimado)`}</td><td className={`p-3 ${row.confirmedPaid ? 'text-green-700' : row.dueDate < today ? 'text-red-700' : 'text-amber-700'}`}>{row.status}</td></tr>)}</tbody></table></div>
        </details>
        <p className="text-xs text-muted-foreground">Registro individual de novos pagamentos ainda não disponível. Os valores atuais projetam as parcelas restantes, mas não comprovam valores efetivamente pagos. Totais históricos e saldo financeiro efetivo dependem do histórico real de pagamentos e reajustes.</p>
    </Card>;
}
