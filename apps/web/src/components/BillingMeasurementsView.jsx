import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Download, Pencil, Trash2, History, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FleetBilling as B } from '@/lib/billingMeasurements';

const money = (value) => Number.isFinite(value) ? (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
const brDate = (value) => B.date(value) ? value.split('-').reverse().join('/') : '—';
const colors = ['#1f7a46', '#2563eb', '#d97706', '#7c3aed', '#0891b2', '#be185d'];
const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const operationId = () => crypto.randomUUID();
function rpc(method, ...args) {
    return new Promise((resolve, reject) => {
        if (!window.google?.script?.run) return reject(new Error('Abra esta área pela integração autenticada do Google no Painel Frotas.'));
        const timeout = setTimeout(() => reject(new Error('A integração demorou a responder. Atualize a tela antes de repetir a operação.')), 45000);
        window.google.script.run.withSuccessHandler((value) => { clearTimeout(timeout); resolve(value); }).withFailureHandler((error) => { clearTimeout(timeout); reject(new Error(error.message || 'Falha na integração.')); })[method](...args);
    });
}
function Field({ label, id, children }) { return <div className="grid gap-1.5"><label className="text-sm font-medium" htmlFor={id}>{label}</label>{React.cloneElement(children, { id })}</div>; }
function SelectField({ label, id, value, onChange, children }) { return <Field label={label} id={id}><select className="h-10 rounded-md border border-input bg-white px-3 text-sm w-full" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></Field>; }
function Check({ label, checked, onChange }) { return <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 accent-green-700" />{label}</label>; }
function DataTable({ headings, children }) { return <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm"><thead className="bg-green-50"><tr>{headings.map((heading) => <th key={heading} className="p-3 text-left whitespace-nowrap">{heading}</th>)}</tr></thead><tbody className="divide-y">{children}</tbody></table></div>; }
const cell = 'p-3 align-top';
function communicate(type, extra = {}) {
    if (window.FLEET_BILLING_FRAME) window.top.postMessage({ type, frameId: window.FLEET_BILLING_FRAME, ...extra }, 'https://rafaelgodoiartes.github.io');
}

export default function BillingMeasurementsView() {
    const reference = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 7);
    const [state, setState] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [filters, setFilters] = useState({ year: reference.slice(0, 4), month: reference.slice(5), projectId: 'all', equipmentId: 'all' });
    const [panel, setPanel] = useState('measurements'), [dialog, setDialog] = useState(null), [form, setForm] = useState({}), [requestId, setRequestId] = useState(''), [page, setPage] = useState(0);
    const [history, setHistory] = useState(null), [deleting, setDeleting] = useState(null);
    const projects = state?.projects || [], equipment = state?.equipment || [], measurements = state?.measurements || [];
    const summary = useMemo(() => B.summarize(measurements, projects, filters), [measurements, projects, filters]);
    const currentProjects = projects.filter((row) => !row.deleted);
    const years = [...new Set([reference.slice(0, 4), ...measurements.map((row) => row.month.slice(0, 4))])].sort().reverse();
    const canWrite = state?.canWrite === true;
    const load = async () => {
        setLoading(true); setError('');
        try { setState(await rpc('getFleetBillingState')); } catch (failure) { setError(failure.message); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);
    useEffect(() => { setPage(0); }, [filters, measurements]);
    useEffect(() => {
        let scheduled;
        const observer = new ResizeObserver(() => { clearTimeout(scheduled); scheduled = setTimeout(() => communicate('fleetBillingResize', { height: document.documentElement.scrollHeight }), 100); });
        observer.observe(document.body);
        return () => { observer.disconnect(); clearTimeout(scheduled); };
    }, []);
    const openProject = (row = null) => {
        setForm(row ? { ...row } : { name: '', code: '', client: '', start: '', end: '', status: 'Ativo', notes: '', equipmentIds: [] });
        setRequestId(operationId()); setDialog({ type: 'project', row }); setError(''); communicate('fleetBillingFocus');
    };
    const openMeasurement = (row = null) => {
        setForm(row ? { ...row, monthly: (row.monthlyCents / 100).toFixed(2), amount: (row.amountCents / 100).toFixed(2) } : { projectId: '', equipmentId: '', monthly: '', start: '', end: '', month: reference, notes: '', manualAdjustment: false, amount: '', adjustmentReason: '', allowOverlap: false, overlapReason: '' });
        setRequestId(operationId()); setDialog({ type: 'measurement', row }); setError(''); communicate('fleetBillingFocus');
    };
    const change = (name, value) => setForm((current) => ({ ...current, [name]: value }));
    const selectPair = (name, value) => setForm((current) => {
        const next = { ...current, [name]: value };
        if (!dialog?.row) {
            const previous = measurements.filter((row) => !row.deleted && row.projectId === next.projectId && row.equipmentId === next.equipmentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
            next.monthly = previous ? (previous.monthlyCents / 100).toFixed(2) : '';
        }
        return next;
    });
    let calculation = null, calculationError = '';
    if (dialog?.type === 'measurement') {
        try { calculation = B.calculate(B.cents(form.monthly), form.start, form.end); }
        catch (failure) { calculationError = failure.message; }
    }
    const submit = async (event) => {
        event.preventDefault(); if (busy) return;
        setError(''); setNotice('');
        try {
            const input = { ...form, id: dialog.row?.id, revision: state.revision, operationId: requestId };
            if (dialog.type === 'project') B.project(input, projects, dialog.row);
            else {
                input.monthlyCents = B.cents(form.monthly); input.amountCents = B.cents(form.amount);
                B.measurement(input, projects, equipment, measurements, dialog.row);
            }
            setBusy(true);
            await rpc(dialog.type === 'project' ? 'saveFleetBillingProject' : 'saveFleetBillingMeasurement', input);
            setDialog(null); setNotice('Registro salvo na base financeira.'); await load();
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const confirmDelete = async () => {
        if (busy) return; setBusy(true); setError('');
        try {
            await rpc(deleting.type === 'project' ? 'deleteFleetBillingProject' : 'deleteFleetBillingMeasurement', { id: deleting.row.id, revision: state.revision, operationId: deleting.operationId, confirmDelete: true });
            setDeleting(null); setNotice('Registro excluído da apuração. O histórico foi preservado.'); await load();
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const showHistory = async (type, row) => {
        setError(''); setBusy(true); communicate('fleetBillingFocus');
        try { setHistory({ type, rows: await rpc('getFleetBillingHistory', type, row.id) }); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const report = async (format) => {
        setBusy(true); setError('');
        try { const { exportBillingReport } = await import('@/lib/billingReports'); await exportBillingReport(format, summary, filters); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const projectLabel = (id) => projects.find((row) => row.id === id)?.name || id;
    const actions = (type, row) => <div className="flex gap-1"><Button type="button" size="icon" variant="ghost" aria-label={`Histórico de ${type === 'project' ? row.name : row.equipmentName}`} disabled={busy} onClick={() => showHistory(type, row)}><History className="h-4 w-4" /></Button><Button type="button" size="icon" variant="ghost" aria-label={`Editar ${type === 'project' ? row.name : row.equipmentName}`} disabled={!canWrite || busy} onClick={() => type === 'project' ? openProject(row) : openMeasurement(row)}><Pencil className="h-4 w-4" /></Button><Button type="button" size="icon" variant="ghost" aria-label={`Excluir ${type === 'project' ? row.name : row.equipmentName}`} disabled={!canWrite || busy} onClick={() => { setDeleting({ type, row, operationId: operationId() }); communicate('fleetBillingFocus'); }}><Trash2 className="h-4 w-4 text-red-700" /></Button></div>;
    return <main className="bg-white p-3 sm:p-5 space-y-5 text-[#173b27]">
        <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-bold text-[#1f7a46]">Faturamento — Projetos e medições</h1><p className="text-sm text-muted-foreground">Máquinas do Cadastro de Veículos · apuração pela competência registrada em cada medição.</p>{state && <p className="text-xs mt-1">Conta: {state.account} · {canWrite ? 'Gestão autorizada' : 'Somente consulta'} · revisão {state.revision}</p>}</div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={load} disabled={loading || busy}><RefreshCw className="h-4 w-4 mr-2" />Atualizar</Button><Button variant="outline" onClick={() => openProject()} disabled={!canWrite || busy}><Plus className="h-4 w-4 mr-2" />Adicionar projeto</Button><Button onClick={() => openMeasurement()} disabled={!canWrite || busy}><Plus className="h-4 w-4 mr-2" />Nova medição</Button></div></header>
        {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm">{notice}</p>}
        {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Consultando a base financeira…</p>}
        {state && <>
            <Card className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-green-50/40"><SelectField id="year" label="Ano" value={filters.year} onChange={(year) => setFilters((current) => ({ ...current, year }))}>{years.map((year) => <option key={year}>{year}</option>)}</SelectField><SelectField id="month" label="Mês de referência" value={filters.month} onChange={(month) => setFilters((current) => ({ ...current, month }))}><option value="all">Todos os meses</option>{monthNames.map((name, index) => <option key={name} value={String(index + 1).padStart(2, '0')}>{name}</option>)}</SelectField><SelectField id="project-filter" label="Projeto" value={filters.projectId} onChange={(projectId) => setFilters((current) => ({ ...current, projectId }))}><option value="all">Todos os projetos</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.name}{row.deleted ? ' (excluído)' : ''}</option>)}</SelectField><SelectField id="machine-filter" label="Máquina / equipamento" value={filters.equipmentId} onChange={(equipmentId) => setFilters((current) => ({ ...current, equipmentId }))}><option value="all">Todos os equipamentos</option>{[...new Map([...equipment, ...measurements.map((row) => ({ id: row.equipmentId, name: row.equipmentName, plate: row.plate }))].map((row) => [row.id, row])).values()].map((row) => <option key={row.id} value={row.id}>{row.name} · {row.plate}</option>)}</SelectField></Card>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{[['Faturamento do período', money(summary.totalCents)], [`Acumulado do ano ${filters.year}`, money(summary.annualCents)], ['Máquinas faturando no período', summary.machines]].map(([label, value]) => <Card key={label} className="p-4"><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="text-2xl font-bold text-green-800 break-words mt-1">{value}</p></Card>)}</div>
            <div className="grid lg:grid-cols-2 gap-4"><Card className="p-4"><h2 className="font-semibold mb-3">Faturamento mensal — {filters.year}</h2><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={summary.monthly.map((row, index) => ({ ...row, label: monthNames[index] }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(value) => `${Math.round(value / 100000)}K`} width={50} tick={{ fontSize: 11 }} /><Tooltip formatter={money} /><Bar dataKey="amountCents" name="Faturamento" fill="#1f7a46" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card><Card className="p-4"><h2 className="font-semibold mb-3">Faturamento por projeto</h2>{!summary.byProject.length ? <p className="text-sm text-muted-foreground">Sem medições no período.</p> : <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={summary.byProject}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tickFormatter={(value) => `${Math.round(value / 100000)}K`} width={50} tick={{ fontSize: 11 }} /><Tooltip formatter={money} /><Bar dataKey="amountCents" name="Faturamento" fill="#2563eb" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}</Card></div>
            {!!summary.byProject.length && <Card className="p-4"><h2 className="font-semibold mb-3">Evolução mensal por projeto — {filters.year}</h2><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={summary.projectEvolution.map((row, index) => ({ ...row.projects, label: monthNames[index] }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis width={55} tickFormatter={(value) => `${Math.round(value / 100000)}K`} /><Tooltip formatter={money} /><Legend />{[...new Set(measurements.filter((row) => !row.deleted && row.month.slice(0, 4) === filters.year && (filters.projectId === 'all' || row.projectId === filters.projectId) && (filters.equipmentId === 'all' || row.equipmentId === filters.equipmentId)).map((row) => row.projectId))].map((id, index) => <Bar key={id} dataKey={id} name={projectLabel(id)} fill={colors[index % colors.length]} />)}</BarChart></ResponsiveContainer></div></Card>}
            <div className="grid lg:grid-cols-2 gap-4">{[['Por projeto', summary.byProject], ['Por máquina', summary.byEquipment]].map(([title, rows]) => <div key={title} className="space-y-2"><h2 className="font-semibold">{title}</h2><DataTable headings={['Identificação', 'Medições', 'Faturamento']}>{rows.map((row) => <tr key={row.id}><td className={cell}>{row.label}</td><td className={cell}>{row.count}</td><td className={`${cell} text-right whitespace-nowrap`}>{money(row.amountCents)}</td></tr>)}<tr className="font-bold bg-green-50"><td className={cell}>Total do período</td><td className={cell}>{summary.rows.length}</td><td className={`${cell} text-right whitespace-nowrap`}>{money(summary.totalCents)}</td></tr></DataTable></div>)}</div>
            <div className="flex flex-wrap gap-2 items-center justify-between"><div className="flex gap-2"><Button variant={panel === 'measurements' ? 'default' : 'outline'} onClick={() => setPanel('measurements')}>Medições</Button><Button variant={panel === 'projects' ? 'default' : 'outline'} onClick={() => setPanel('projects')}>Projetos</Button></div><div className="flex gap-2"><Button variant="outline" disabled={busy || loading || !!error} onClick={() => report('xlsx')}><Download className="h-4 w-4 mr-2" />Excel</Button><Button variant="outline" disabled={busy || loading || !!error} onClick={() => report('pdf')}><Download className="h-4 w-4 mr-2" />PDF</Button></div></div>
            {panel === 'measurements' ? <section className="space-y-3"><h2 className="font-semibold">Tabela de faturamento — medições</h2>{summary.rows.length === 0 ? <p className="rounded-lg border p-5 text-sm text-muted-foreground">Nenhuma medição cadastrada para os filtros selecionados. Não há dados fictícios.</p> : <DataTable headings={['Projeto', 'Máquina', 'Período da medição', 'Competência', 'Valor faturado', 'Ações']}>{summary.rows.slice(page * 20, page * 20 + 20).map((row) => <tr key={row.id}><td className={cell}>{row.projectLabel}</td><td className={cell}>{row.equipmentName}<span className="block text-xs text-muted-foreground">{row.prefix} · {row.plate}</span></td><td className={`${cell} whitespace-nowrap`}>{brDate(row.start)}<br />a {brDate(row.end)}</td><td className={cell}>{row.month.split('-').reverse().join('/')}</td><td className={`${cell} text-right whitespace-nowrap font-semibold`}>{money(row.amountCents)}{row.manualAdjustment && <span className="block text-xs font-normal">Ajuste manual</span>}</td><td className={cell}>{actions('measurement', row)}</td></tr>)}</DataTable>}<div className="flex flex-wrap justify-between gap-2 text-sm"><span>Total do período: <b>{money(summary.totalCents)}</b> · {summary.rows.length} medição(ões)</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button><span className="self-center">{page + 1}/{Math.max(1, Math.ceil(summary.rows.length / 20))}</span><Button variant="outline" size="sm" disabled={(page + 1) * 20 >= summary.rows.length} onClick={() => setPage(page + 1)}>Próxima</Button></div></div></section> : <section className="space-y-3"><h2 className="font-semibold">Projetos cadastrados</h2><DataTable headings={['Projeto / código', 'Cliente', 'Vigência', 'Status', 'Máquinas vinculadas', 'Ações']}>{currentProjects.map((row) => { const ids = new Set([...(row.equipmentIds || []), ...measurements.filter((item) => !item.deleted && item.projectId === row.id).map((item) => item.equipmentId)]); return <tr key={row.id}><td className={cell}>{row.name}<span className="block text-xs">{row.code}</span></td><td className={cell}>{row.client}</td><td className={cell}>{brDate(row.start)}<br />a {row.end ? brDate(row.end) : 'não definida'}</td><td className={cell}>{row.status}</td><td className={cell}>{[...ids].map((id) => equipment.find((item) => item.id === id)?.name || measurements.find((item) => item.equipmentId === id)?.equipmentName || id).join('; ') || 'Nenhuma'}</td><td className={cell}>{actions('project', row)}</td></tr>; })}</DataTable>{!currentProjects.length && <p className="text-sm">Nenhum projeto cadastrado. Use Adicionar projeto para começar.</p>}</section>}
        </>}
        <Dialog open={!!dialog} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}><DialogContent className="top-4 translate-y-0 sm:max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>{dialog?.row ? 'Editar' : 'Novo'} {dialog?.type === 'project' ? 'projeto' : 'lançamento de medição'}</DialogTitle></DialogHeader>{dialog && <form onSubmit={submit} className="space-y-4">{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{dialog.type === 'project' ? <>
            <div className="grid sm:grid-cols-2 gap-3"><Field label="Nome do projeto" id="project-name"><Input required maxLength={150} value={form.name} onChange={(event) => change('name', event.target.value)} /></Field><Field label="Código (opcional)" id="project-code"><Input maxLength={60} value={form.code} onChange={(event) => change('code', event.target.value)} /></Field><Field label="Cliente / contratante" id="project-client"><Input required maxLength={180} value={form.client} onChange={(event) => change('client', event.target.value)} /></Field><SelectField label="Status" id="project-status" value={form.status} onChange={(value) => change('status', value)}>{['Ativo', 'Concluído', 'Pausado'].map((value) => <option key={value}>{value}</option>)}</SelectField><Field label="Data de início" id="project-start"><Input type="date" required value={form.start} onChange={(event) => change('start', event.target.value)} /></Field><Field label="Data de término (opcional)" id="project-end"><Input type="date" value={form.end} min={form.start} onChange={(event) => change('end', event.target.value)} /></Field></div>
            <fieldset className="border rounded-lg p-3 space-y-2"><legend className="text-sm font-medium">Máquinas / veículos vinculados (Cadastro existente)</legend><div className="grid sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto">{equipment.map((row) => <Check key={row.id} label={`${row.prefix || ''} ${row.name} · ${row.plate}`} checked={form.equipmentIds.includes(row.id)} onChange={(checked) => change('equipmentIds', checked ? [...form.equipmentIds, row.id] : form.equipmentIds.filter((id) => id !== row.id))} />)}</div></fieldset>
        </> : <>
            <div className="grid sm:grid-cols-2 gap-3"><SelectField label="Projeto" id="measurement-project" value={form.projectId} onChange={(value) => selectPair('projectId', value)}><option value="">Selecione um projeto</option>{currentProjects.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.status}</option>)}</SelectField><SelectField label="Máquina / equipamento cadastrado" id="measurement-equipment" value={form.equipmentId} onChange={(value) => selectPair('equipmentId', value)}><option value="">Selecione um equipamento</option>{equipment.map((row) => <option key={row.id} value={row.id}>{row.prefix} · {row.name} · {row.plate}</option>)}</SelectField><Field label="Valor mensal contratado (R$)" id="measurement-monthly"><Input required inputMode="decimal" value={form.monthly} onChange={(event) => change('monthly', event.target.value)} /></Field><Field label="Mês e ano de referência" id="measurement-month"><Input type="month" required value={form.month} onChange={(event) => change('month', event.target.value)} /></Field><Field label="Data inicial da medição" id="measurement-start"><Input type="date" required value={form.start} onChange={(event) => change('start', event.target.value)} /></Field><Field label="Data final da medição" id="measurement-end"><Input type="date" required min={form.start} value={form.end} onChange={(event) => change('end', event.target.value)} /></Field></div>
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm"><b>Valor calculado: {calculation ? money(calculation.amountCents) : '—'}</b><p>{calculation ? `${calculation.days} dia(s). ${calculation.rule}.` : calculationError}</p><p>O total entra uma única vez na competência selecionada. O preço desta medição fica salvo no histórico.</p></div>
            <Check label="Ajustar manualmente o valor faturado" checked={form.manualAdjustment} onChange={(value) => change('manualAdjustment', value)} />{form.manualAdjustment && <div className="grid sm:grid-cols-2 gap-3"><Field label="Valor faturado ajustado (R$)" id="measurement-amount"><Input required inputMode="decimal" value={form.amount} onChange={(event) => change('amount', event.target.value)} /></Field><Field label="Justificativa do ajuste (mínimo 10 caracteres)" id="measurement-adjustment"><Input required minLength={10} maxLength={1000} value={form.adjustmentReason} onChange={(event) => change('adjustmentReason', event.target.value)} /></Field></div>}
            <Check label="Autorizar excepcionalmente período sobreposto da mesma máquina e projeto" checked={form.allowOverlap} onChange={(value) => change('allowOverlap', value)} />{form.allowOverlap && <Field label="Justificativa da autorização (mínimo 10 caracteres)" id="measurement-overlap"><Input required minLength={10} maxLength={1000} value={form.overlapReason} onChange={(event) => change('overlapReason', event.target.value)} /></Field>}
        </>}<Field label="Observações" id="record-notes"><textarea className="w-full min-h-20 rounded-md border p-3 text-sm" maxLength={3000} value={form.notes} onChange={(event) => change('notes', event.target.value)} /></Field><div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" disabled={busy || (dialog.type === 'measurement' && !calculation)}>{busy ? 'Salvando…' : 'Salvar'}</Button></div></form>}</DialogContent></Dialog>
        <Dialog open={!!deleting} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}><DialogContent className="top-4 translate-y-0"><DialogHeader><DialogTitle>Confirmar exclusão</DialogTitle></DialogHeader><p className="text-sm">Excluir {deleting?.row.name || deleting?.row.equipmentName} da apuração? As revisões anteriores continuarão preservadas no histórico.</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="destructive" disabled={busy} onClick={confirmDelete}>{busy ? 'Excluindo…' : 'Confirmar exclusão'}</Button></div></DialogContent></Dialog>
        <Dialog open={!!history} onOpenChange={(open) => { if (!open) setHistory(null); }}><DialogContent className="top-4 translate-y-0 sm:max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>Histórico de alterações</DialogTitle></DialogHeader>{history?.rows.map((event) => <div key={event.revision} className="rounded-lg border p-3 text-sm space-y-1"><p><b>Revisão {event.revision}</b> · {new Date(event.at).toLocaleString('pt-BR')} · {event.actor}</p><p>{event.record.deleted ? 'Exclusão da apuração' : 'Registro / edição'} · {event.record.name || event.record.equipmentName}</p>{history.type === 'measurement' && <p>{brDate(event.record.start)} a {brDate(event.record.end)} · Mensal: {money(event.record.monthlyCents)} · Faturado: {money(event.record.amountCents)} · {event.record.adjustmentReason || event.record.overlapReason || event.record.notes || 'Sem observações'}</p>}</div>)}</DialogContent></Dialog>
    </main>;
}
