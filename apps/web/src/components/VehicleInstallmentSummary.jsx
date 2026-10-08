import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { VEHICLE_INSTALLMENTS, installmentCalendar } from '@/lib/vehicleInstallments';
import { formatFinanceBRL } from '@/lib/ownedVehicleFinance';

const brDate = (value) => value.split('-').reverse().join('/');

export default function VehicleInstallmentSummary() {
    const [selected, setSelected] = useState('all');
    const [status, setStatus] = useState('remaining');
    const dateParts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = type => dateParts.find(row => row.type === type).value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const contracts = VEHICLE_INSTALLMENTS.filter(row => selected === 'all' || row.id === selected);
    const rows = contracts.flatMap(contract => installmentCalendar(contract, today)
        .filter(row => status === 'all' || (status === 'paid' ? row.confirmedPaid : !row.confirmedPaid))
        .map(row => ({ ...row, contract }))).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.contract.id.localeCompare(b.contract.id));
    return <Card className="p-4 flex flex-col gap-4 border-[#cfe8d5] bg-[#f8fcf9]">
        <div><h3 className="text-base font-semibold text-[#1f6b3d]">Parcelas de veículos e máquinas</h3>
            <p className="text-sm text-muted-foreground">Vencimento todo dia 01. Posição de pagamentos confirmada em 08/10/2026.</p>
            <p className="text-xs text-amber-800 mt-2">Calendário estimado: parcelas mensais consecutivas, considerando outubro/2026 como o último mês pago. Não comprova a data do contrato, a data real do pagamento nem os valores históricos. Este controle não altera o seguro nem os resultados financeiros existentes.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{contracts.map(contract => {
            const schedule = installmentCalendar(contract, today);
            return <div key={contract.id} className="rounded-xl border bg-white p-4">
                <h4 className="font-semibold">{contract.name}</h4>
                <p className="text-sm mt-2">{contract.paid} pagas de {contract.total} · {contract.total - contract.paid} restantes</p>
                <div className="h-2 bg-green-100 rounded-full my-2" role="progressbar" aria-label={`Parcelas quitadas — ${contract.name}`} aria-valuemin={0} aria-valuemax={contract.total} aria-valuenow={contract.paid}><div className="h-2 bg-green-700 rounded-full" style={{ width: `${contract.paid / contract.total * 100}%` }} /></div>
                <p className="text-xs">{(contract.paid / contract.total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% das parcelas quitadas · início estimado: {brDate(schedule[0].dueDate)}</p>
                <p className="text-xs mt-2">Parcela atual: {contract.currentCents === null ? 'Não informado' : `${formatFinanceBRL(contract.currentCents)} (valor atual, não histórico)`}</p>
            </div>;
        })}</div>
        <div className="flex flex-wrap gap-3">
            <label className="text-sm">Equipamento<select className="block rounded-md border p-2 bg-white max-w-full" value={selected} onChange={event => setSelected(event.target.value)}><option value="all">Todos</option>{VEHICLE_INSTALLMENTS.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="text-sm">Parcelas<select className="block rounded-md border p-2 bg-white" value={status} onChange={event => setStatus(event.target.value)}><option value="remaining">Restantes</option><option value="paid">Pagas — posição confirmada</option><option value="all">Todas</option></select></label>
        </div>
        <details><summary className="cursor-pointer font-medium text-[#1f6b3d]">Calendário de parcelas ({rows.length})</summary>
            <div className="overflow-auto max-h-96 mt-3"><table className="w-full text-sm bg-white"><thead className="sticky top-0 bg-green-50"><tr>{['Equipamento', 'Parcela', 'Vencimento estimado', 'Valor previsto', 'Status'].map(label => <th key={label} className="text-left p-3 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={`${row.contract.id}-${row.number}`} className="border-t"><td className="p-3">{row.contract.name}</td><td className="p-3">{row.number}/{row.contract.total}</td><td className="p-3 whitespace-nowrap">{brDate(row.dueDate)}</td><td className="p-3 whitespace-nowrap">{row.projectedCents === null ? 'Não informado' : `${formatFinanceBRL(row.projectedCents)} (estimado)`}</td><td className={`p-3 ${row.confirmedPaid ? 'text-green-700' : row.dueDate < today ? 'text-red-700' : 'text-amber-700'}`}>{row.status}</td></tr>)}</tbody></table></div>
        </details>
        <p className="text-xs text-muted-foreground">Registro individual de novos pagamentos ainda não disponível. Para calcular os totais efetivamente pagos e o saldo financeiro, faltam os valores das demais parcelas e o histórico real de pagamentos.</p>
    </Card>;
}
