import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import {
    Fuel, Wrench, FileCheck, Gauge, RefreshCw, AlertTriangle,
    Search, X, Info, Loader2, CalendarDays, ExternalLink, Truck, UsersRound, Plus, ClipboardCheck,
    Bell, CheckCircle2, Clock3, ListFilter, PackageOpen, CircleDollarSign,
} from 'lucide-react';
import {
    BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useFleetData } from '@/hooks/useFleetData';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Calendar as DateCalendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ptBR } from 'date-fns/locale';
import apiServerClient from '@/lib/apiServerClient';
import { driverNameKey, summarizeChecklistDrivers } from '@/lib/checklistDrivers';
import { DEFAULT_FUEL_ITEMS, abastecimentoCategory, abastecimentoUnit, changeAbastecimentoCategory, isFuelConsumption, mergeAbastecimentoRows, uniqueOptions } from '@/lib/abastecimentoTypes';
import {
    FATURAMENTO_EQUIPMENT,
    aggregateByMonth,
    buildMaintenanceCostRows,
    buildRevenueRows,
    summarizeByEquipment,
} from '@/lib/faturamento';
import { formatFinanceBRL, insuranceSchedule, summarizeInsurance, summarizeOwnedVehicles } from '@/lib/ownedVehicleFinance';
import { resolvePartsVehicle, summarizeMaintenanceParts } from '@/lib/maintenanceParts';

const BRL = (v) => (v === null || v === undefined || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const NUM = (v, dec = 0) => (v === null || v === undefined || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: dec, minimumFractionDigits: 0 }));
const COMPACT_BRL = (v) => {
    if (v === null || v === undefined || isNaN(v)) return '—';
    const value = Number(v);
    if (Math.abs(value) >= 1000000) return (value / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'MM';
    if (Math.abs(value) >= 1000) return (value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'K';
    return BRL(value);
};
const vehicleKey = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const searchKey = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const inputNumber = (value) => {
    const raw = String(value ?? '').trim().replace(/\s/g, '');
    if (!raw) return null;
    const normalized = raw.includes(',') && raw.includes('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(',', '.');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
};
const normalizedStatus = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const SCHEDULED_STATUSES = new Set(['AGENDADO', 'AGENDADA', 'PROGRAMADO', 'PROGRAMADA']);
const isScheduledPending = (row) => SCHEDULED_STATUSES.has(normalizedStatus(row.status)) && !row.dataConclusao;
const formatDate = (d, locale = 'pt-BR', opts = {}) => {
    if (!d) return '';
    const p = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d);
    if (Number.isNaN(p.getTime())) return '';
    return p.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', ...opts });
};
const formatDateTime = (d, locale = 'pt-BR', opts = {}) => {
    if (!d) return '';
    const p = new Date(d);
    if (Number.isNaN(p.getTime())) return '';
    return p.toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...opts });
};
const LOCAL_STATIONS_KEY = 'agromig.postos.cadastrados.v1';
const readLocalStations = () => {
    try {
        const value = JSON.parse(window.localStorage.getItem(LOCAL_STATIONS_KEY) || '[]');
        return Array.isArray(value) ? value.filter(Boolean) : [];
    } catch { return []; }
};

const STATUS_COLORS = {
    OK: '#16a34a',
    'A vencer': '#d97706',
    Atrasada: '#dc2626',
    Pendente: '#64748b',
};
const TIPO_COLORS = {
    Preventiva: '#2563eb',
    Corretiva: '#dc2626',
    Outros: '#64748b',
};

const TABS = [
    { id: 'pendencias', label: 'Pendências', icon: Bell },
    { id: 'abastecimento', label: 'Abastecimento', icon: Fuel },
    { id: 'manutencao', label: 'Manutenção', icon: Wrench },
    { id: 'documentacao', label: 'Documentação', icon: FileCheck },
    { id: 'km', label: 'KM Rodado', icon: Gauge },
    { id: 'checklist', label: 'Checklist', icon: ClipboardCheck },
    { id: 'compras-pecas', label: 'Compras de Peças', icon: PackageOpen },
    { id: 'faturamento', label: 'Faturamento', icon: CircleDollarSign },
];

// --- small presentational helpers -----------------------------------------

function KpiCard({ label, value, sub, accent, onClick, active = false }) {
    return (
        <Card
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onClick={onClick}
            onKeyDown={(event) => { if (onClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(); } }}
            className={cn('p-4 flex flex-col gap-1', onClick && 'cursor-pointer transition hover:border-primary/60 hover:shadow-sm', active && 'border-primary ring-2 ring-primary/20')}
        >
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
            <span className={cn('text-2xl font-bold font-display', accent)}>{value}</span>
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        </Card>
    );
}

function ChartCard({ title, children, height = 280 }) {
    return (
        <Card className="p-4 flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <div style={{ width: '100%', height }}>
                {children}
            </div>
        </Card>
    );
}

function StatusBadge({ status }) {
    const color = STATUS_COLORS[status] || '#64748b';
    return (
        <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: `${color}1a`, color }}
        >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
            {status}
        </span>
    );
}

function EmptyHint({ children }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground gap-2">
            <Info className="h-5 w-5 opacity-60" />
            {children}
        </div>
    );
}

function ActiveFilter({ label, onClear }) {
    if (!label) return null;
    return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary">Filtro: {label}</Badge><Button variant="ghost" size="sm" className="h-7 px-2" onClick={onClear}><X className="mr-1 h-3.5 w-3.5" />Remover filtro</Button></div>;
}

function ScrollTable({ head, children }) {
    return (
        <div className="rounded-lg border border-border overflow-hidden">
            <div className="max-h-[460px] overflow-auto">
                <Table>
                    <TableHeader className="sticky top-0 bg-muted/60 backdrop-blur">
                        <TableRow>{head}</TableRow>
                    </TableHeader>
                    <TableBody>{children}</TableBody>
                </Table>
            </div>
        </div>
    );
}

const today = () => new Date().toISOString().slice(0, 10);
const normalizeFuelDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value;
    const currentYear = new Date().getFullYear();
    const year = Number(value.slice(0, 4));
    return year > currentYear ? `${currentYear}${value.slice(4)}` : value;
};
const localIsoDate = (date) => date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
const dateFromIso = (value) => value ? new Date(`${value}T00:00:00`) : undefined;
const fileAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mimeType: file.type, base64: String(reader.result).split(',')[1] || '' });
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
    reader.readAsDataURL(file);
});

function Field({ label, children }) {
    return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>;
}

function LancamentoDialog({ type, data, onSaved }) {
    const isFuel = type === 'abastecimento';
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [files, setFiles] = useState([]);
    const [vehicleSearch, setVehicleSearch] = useState('');
    const [form, setForm] = useState({ data: today(), placa: '', projeto: '', motorista: '', categoria: 'Combustível', item: 'Diesel S-10', posto: '', litros: '', precoLitro: '', km: '', observacoes: '', tipo: 'Preventiva', status: 'AGENDADO', dataPrevista: today(), dataConclusao: '', descricao: '', peca: '', valor: '', responsavel: '', fornecedor: '', folderUrl: '', pin: '' });
    const [extraStations, setExtraStations] = useState(() => (typeof window === 'undefined' ? [] : readLocalStations()));
    const [postoDialogOpen, setPostoDialogOpen] = useState(false);
    const [postoSaving, setPostoSaving] = useState(false);
    const [postoMessage, setPostoMessage] = useState('');
    const [newPosto, setNewPosto] = useState({ nome: '', cnpj: '', cidade: '', observacoes: '' });
    const masterVehicles = data?.veiculos || [];
    const vehicles = isFuel ? (data?.veiculosAbastecimento || []) : masterVehicles;
    const filteredVehicles = useMemo(() => {
        const query = searchKey(vehicleSearch);
        if (!query) return vehicles;
        return vehicles.filter((vehicle) => {
            const master = masterVehicles.find((candidate) => candidate.placa === vehicle.placa);
            return searchKey(`${vehicle.placa} ${vehicle.veiculo} ${vehicle.projeto || master?.projeto || ''}`).includes(query);
        });
    }, [vehicles, masterVehicles, vehicleSearch]);
    const projects = useMemo(() => {
        const source = isFuel
            ? [
                ...(data?.projetosAbastecimento || []),
                ...(data?.abastecimento || []).map((row) => row?.projeto),
            ]
            : masterVehicles.map((vehicle) => vehicle.projeto);
        const unique = new Map();
        source
            .map((value) => String(value ?? '').trim())
            .filter(Boolean)
            .forEach((value) => {
                const key = searchKey(value);
                if (!unique.has(key)) unique.set(key, value);
            });
        return [...unique.values()].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    }, [data, isFuel, masterVehicles]);
    const stations = useMemo(() => [...new Set([
        ...(data?.postos || []),
        ...(data?.abastecimento || []).map((r) => r.posto),
        ...extraStations,
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [data, extraStations]);
    const scheduledPending = useMemo(() => (data?.manutencao || [])
        .filter(isScheduledPending)
        .sort((a, b) => String(a.dataPrevista || '').localeCompare(String(b.dataPrevista || ''))), [data]);
    const abastecimentoTypes = useMemo(() => uniqueOptions([
        'Combustível', 'Graxa', ...(data?.tiposAbastecimento || []),
        ...(data?.outrosAbastecimentos || []).map((row) => row.categoria),
    ]), [data?.tiposAbastecimento, data?.outrosAbastecimentos]);
    const productOptions = useMemo(() => {
        if (isFuelConsumption({ categoria: form.categoria })) return DEFAULT_FUEL_ITEMS;
        const items = uniqueOptions(['Graxa', ...(data?.itensAbastecimento || []), ...(data?.outrosAbastecimentos || []).map((row) => row.item)]);
        return searchKey(form.categoria).includes('graxa') ? items.filter((item) => searchKey(item).includes('graxa')) : items;
    }, [form.categoria, data?.itensAbastecimento, data?.outrosAbastecimentos]);
    const quantityUnit = abastecimentoUnit(form.categoria, form.item);
    const fuelUnitPrice = useMemo(() => {
        const liters = inputNumber(form.litros);
        const total = inputNumber(form.valor);
        return liters > 0 && total !== null && total >= 0 ? total / liters : null;
    }, [form.litros, form.valor]);
    const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
    const selectVehicle = (placa) => {
        const vehicle = masterVehicles.find((v) => v.placa === placa)
            || (data?.veiculosAbastecimento || []).find((v) => v.placa === placa);
        const controlVehicle = (data?.veiculos || []).find((v) => v.placa === placa);
        const utilization = (data?.utilizacao || []).find((v) => v.placa === placa);
        const weekly = (data?.kmRodado || []).find((v) => v.placa === placa);
        const project = vehicle?.projeto || controlVehicle?.projeto || utilization?.projeto || weekly?.projeto || '';
        const driver = utilization?.motorista || weekly?.motorista || '';
        setForm((f) => ({
            ...f,
            placa,
            projeto: isFuel ? (project || f.projeto) : (vehicle?.projeto || f.projeto),
            motorista: isFuel ? (driver || f.motorista) : f.motorista,
            folderUrl: vehicle?.pastaEvidencias || f.folderUrl,
        }));
    };
    const registerPosto = async (event) => {
        event.preventDefault();
        const nome = newPosto.nome.trim();
        if (!nome) { setPostoMessage('Informe o nome do posto.'); return; }
        setPostoSaving(true); setPostoMessage('');
        try {
            let backendMessage = '';
            try {
                const response = await apiServerClient.fetch('/fleet/posto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newPosto) });
                const body = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(body.message || 'Integração do cadastro indisponível.');
                backendMessage = body.message || '';
            } catch (integrationError) {
                // A versão publicada do conector pode ainda não ter a rota de
                // cadastro. Nesse caso, o posto continua disponível neste
                // navegador e pode ser usado imediatamente no lançamento.
                backendMessage = 'Posto salvo neste navegador e disponível para o lançamento.';
            }
            const nextStations = [...new Set([...extraStations, nome])];
            setExtraStations(nextStations);
            window.localStorage.setItem(LOCAL_STATIONS_KEY, JSON.stringify(nextStations));
            set('posto', nome);
            setNewPosto({ nome: '', cnpj: '', cidade: '', observacoes: '' });
            setPostoDialogOpen(false);
            if (backendMessage) setMessage(backendMessage);
            await onSaved?.();
        } catch (error) { setPostoMessage(error.message); } finally { setPostoSaving(false); }
    };
    const submit = async (event) => {
        event.preventDefault();
        setSaving(true); setMessage('');
        try {
            if (isFuel) {
                if (!form.categoria || !form.item) throw new Error('Informe o tipo de abastecimento e o combustível / produto.');
                if (!(inputNumber(form.litros) > 0)) throw new Error(`Informe uma quantidade válida em ${quantityUnit}.`);
                if (!(inputNumber(form.valor) > 0)) throw new Error('Informe um valor total válido.');
            }
            if (files.length > 5) throw new Error('Selecione no máximo 5 anexos.');
            if (files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) throw new Error('Os anexos devem somar no máximo 8 MB.');
            const attachments = isFuel ? [] : await Promise.all(files.map(fileAsBase64));
            const payload = isFuel
                ? { data: form.data, placa: form.placa, projeto: form.projeto, motorista: form.motorista, categoria: form.categoria, item: form.item, posto: form.posto, litros: form.litros, valor: form.valor, precoLitro: fuelUnitPrice, km: form.km, observacoes: form.observacoes, pin: form.pin }
                : { dataChamado: form.data, placa: form.placa, projeto: form.projeto, tipo: form.tipo, status: form.status, dataPrevista: form.dataPrevista, dataConclusao: form.dataConclusao, descricao: form.descricao, peca: form.peca, valor: form.valor, km: form.km, responsavel: form.responsavel, fornecedor: form.fornecedor, folderUrl: form.folderUrl, files: attachments, pin: form.pin };
            const response = await apiServerClient.fetch(`/fleet/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || 'Não foi possível salvar o lançamento.');
            const successMessage = body.message || 'Lançamento salvo na planilha.';
            setMessage(successMessage);
            setTimeout(() => setOpen(false), 900);
            try {
                await onSaved?.();
            } catch (refreshError) {
                console.warn('Lançamento salvo, mas o painel não atualizou imediatamente.', refreshError);
            }
        } catch (error) { setMessage(error.message); } finally { setSaving(false); }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="gap-2" variant={isFuel ? 'default' : 'outline'}>{isFuel ? <Fuel className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}Novo {isFuel ? 'abastecimento' : 'lançamento de manutenção'}</Button></DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader><DialogTitle>{isFuel ? 'Lançar abastecimento' : 'Lançar manutenção'}</DialogTitle><DialogDescription>{isFuel ? 'Placas e projetos são carregados da aba “Veículos” da planilha de abastecimento.' : 'Os dados serão conferidos com o cadastro de frota antes de alimentar a planilha.'}</DialogDescription></DialogHeader>
                {!isFuel && scheduledPending.length > 0 && (
                    <Alert className="border-amber-300 bg-amber-50 text-amber-950">
                        <CalendarDays className="h-4 w-4" />
                        <AlertTitle>{scheduledPending.length} manutenção(ões) agendada(s) ainda não realizada(s)</AlertTitle>
                        <AlertDescription className="mt-2 flex flex-wrap gap-1.5">
                            {scheduledPending.slice(0, 8).map((r) => (
                                <Badge key={`${r.id}-${r.placa}`} variant="outline" className="border-amber-300 bg-white/80 text-amber-950">
                                    {r.dataPrevista ? formatDate(r.dataPrevista) : 'Sem data'} · {r.placa} · {r.descricao}
                                </Badge>
                            ))}
                        </AlertDescription>
                    </Alert>
                )}
                <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                        <Field label={isFuel ? 'Buscar placa ou veículo' : 'Buscar placa, veículo ou projeto'}>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input className="pl-9" value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} placeholder={isFuel ? 'Digite para localizar no cadastro de abastecimento' : 'Digite para localizar o veículo'} />
                            </div>
                        </Field>
                        {vehicleSearch && <p className="mt-1 text-xs text-muted-foreground">{filteredVehicles.length} veículo(s) encontrado(s)</p>}
                    </div>
                    <Field label={isFuel ? 'Data' : 'Data do chamado'}><Input type="date" value={form.data} onChange={(e) => set('data', isFuel ? normalizeFuelDate(e.target.value) : e.target.value)} required /></Field>
                    <Field label="Placa / veículo"><Select value={form.placa} onValueChange={selectVehicle} required><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{filteredVehicles.map((v) => <SelectItem key={v.placa} value={v.placa}>{v.placa} · {v.veiculo}</SelectItem>)}</SelectContent></Select></Field>
                    <Field label="Projeto"><Select value={form.projeto} onValueChange={(v) => set('projeto', v)} required><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{projects.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
                    <Field label="KM / horímetro"><Input inputMode="decimal" value={form.km} onChange={(e) => set('km', e.target.value)} /></Field>
                    {isFuel ? <>
                        <Field label="Tipo de abastecimento"><Select value={form.categoria} onValueChange={(v) => setForm((current) => changeAbastecimentoCategory(current, v))} required><SelectTrigger aria-label="Tipo de abastecimento"><SelectValue /></SelectTrigger><SelectContent>{abastecimentoTypes.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
                        <Field label="Combustível / produto"><Select value={form.item} onValueChange={(v) => setForm((current) => ({ ...current, item: v, categoria: abastecimentoCategory(current.categoria, v) }))} required><SelectTrigger aria-label="Combustível / produto"><SelectValue placeholder="Selecione o produto" /></SelectTrigger><SelectContent>{productOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
                    <Field label="Posto"><div className="flex gap-2"><Select value={form.posto} onValueChange={(v) => set('posto', v)} required><SelectTrigger className="flex-1"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{stations.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="icon" title="Cadastrar novo posto" onClick={() => { setPostoMessage(''); setPostoDialogOpen(true); }}><Plus className="h-4 w-4" /></Button></div></Field>
                        <Field label={quantityUnit === 'kg' ? 'Quantidade (kg)' : 'Litros'}><Input aria-label={quantityUnit === 'kg' ? 'Quantidade (kg)' : 'Litros'} inputMode="decimal" value={form.litros} onChange={(e) => set('litros', e.target.value)} required /></Field>
                        <Field label="Valor total do abastecimento (R$)"><Input inputMode="decimal" value={form.valor} onChange={(e) => set('valor', e.target.value)} placeholder="Ex.: 450,00" required /></Field>
                        <Field label={quantityUnit === 'kg' ? 'Preço por kg (calculado)' : 'Preço por litro (calculado)'}><Input aria-label="Preço unitário calculado" value={fuelUnitPrice === null ? '' : fuelUnitPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} readOnly className="bg-muted/50" /></Field>
                        {quantityUnit === 'kg' && <p className="text-xs text-muted-foreground sm:col-span-2">Graxa é registrada em kg e não entra no cálculo de KM/L.</p>}
                        <Field label="Motorista / responsável"><Input value={form.motorista} onChange={(e) => set('motorista', e.target.value)} placeholder="Preenchido pela placa, mas pode ser alterado" /></Field>
                        <Field label="Observações"><Input value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} /></Field>
                    </> : <>
                        <Field label="Tipo"><Select value={form.tipo} onValueChange={(v) => set('tipo', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Preventiva', 'Corretiva', 'Outros'].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
                        <Field label="Situação"><Select value={form.status} onValueChange={(v) => set('status', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="AGENDADO">Agendada</SelectItem><SelectItem value="FINALIZADO">Finalizada</SelectItem></SelectContent></Select></Field>
                        {form.status === 'AGENDADO'
                            ? <Field label="Data prevista"><Input type="date" value={form.dataPrevista} onChange={(e) => set('dataPrevista', e.target.value)} required /></Field>
                            : <Field label="Data de conclusão"><Input type="date" value={form.dataConclusao} onChange={(e) => set('dataConclusao', e.target.value)} required /></Field>}
                        <Field label={form.status === 'AGENDADO' ? 'Valor previsto (opcional)' : 'Valor'}><Input inputMode="decimal" value={form.valor} onChange={(e) => set('valor', e.target.value)} required={form.status === 'FINALIZADO'} /></Field>
                        <Field label="Serviço previsto / realizado"><Input value={form.descricao} onChange={(e) => set('descricao', e.target.value)} required /></Field>
                        <Field label="Peça / item"><Input value={form.peca} onChange={(e) => set('peca', e.target.value)} /></Field>
                        <Field label="Responsável / aprovador"><Input value={form.responsavel} onChange={(e) => set('responsavel', e.target.value)} /></Field>
                        <Field label="Fornecedor"><Input value={form.fornecedor} onChange={(e) => set('fornecedor', e.target.value)} /></Field>
                    </>}
                    {isFuel && <Dialog open={postoDialogOpen} onOpenChange={setPostoDialogOpen}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader><DialogTitle>Cadastrar novo posto</DialogTitle><DialogDescription>O posto ficará disponível nos próximos lançamentos de abastecimento.</DialogDescription></DialogHeader>
                            <form onSubmit={registerPosto} className="grid gap-3">
                                <Field label="Nome do posto"><Input value={newPosto.nome} onChange={(e) => setNewPosto((v) => ({ ...v, nome: e.target.value }))} required autoFocus /></Field>
                                <Field label="CNPJ (opcional)"><Input value={newPosto.cnpj} onChange={(e) => setNewPosto((v) => ({ ...v, cnpj: e.target.value }))} /></Field>
                                <Field label="Cidade (opcional)"><Input value={newPosto.cidade} onChange={(e) => setNewPosto((v) => ({ ...v, cidade: e.target.value }))} /></Field>
                                <Field label="Observações"><Input value={newPosto.observacoes} onChange={(e) => setNewPosto((v) => ({ ...v, observacoes: e.target.value }))} /></Field>
                                {postoMessage && <p className="text-sm text-red-600">{postoMessage}</p>}
                                <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setPostoDialogOpen(false)}>Cancelar</Button><Button type="submit" disabled={postoSaving}>{postoSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cadastrar posto</Button></div>
                            </form>
                        </DialogContent>
                    </Dialog>}
                    {!isFuel && <>
                        <Field label="Link da pasta do veículo no Drive"><Input type="url" value={form.folderUrl} onChange={(e) => set('folderUrl', e.target.value)} placeholder="https://drive.google.com/drive/folders/..." required={files.length > 0} /></Field>
                        <Field label="Nota fiscal / fotos de avarias">
                            <Input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" multiple onChange={(e) => setFiles([...e.target.files])} />
                            <span className="text-xs text-muted-foreground">Somente manutenção. Até 5 imagens ou PDFs, total de 8 MB.</span>
                        </Field>
                    </>}
                    
                    <div className="sm:col-span-2 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{message}</p><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar na planilha</Button></div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function VeiculoDialog({ data, onSaved }) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [search, setSearch] = useState('');
    const [form, setForm] = useState({ placa: '', veiculo: '', combustivel: 'Diesel S-10', propriedade: 'PRÓPRIO', tipoPosse: 'PRÓPRIO', franquia: '', projeto: '', unidade: 'KM', identificador: '', dataEntrada: today(), folderUrl: '', pin: '' });
    const existingMatches = useMemo(() => {
        const query = searchKey(search);
        if (!query) return [];
        return (data?.veiculos || []).filter((vehicle) => searchKey(`${vehicle.placa} ${vehicle.veiculo} ${vehicle.projeto}`).includes(query)).slice(0, 6);
    }, [data, search]);
    const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
    const submit = async (event) => {
        event.preventDefault(); setSaving(true); setMessage('');
        try {
            const response = await apiServerClient.fetch('/fleet/veiculo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || 'Não foi possível cadastrar o veículo.');
            const successMessage = body.message || 'Veículo cadastrado na planilha.';
            setMessage(successMessage);
            setTimeout(() => setOpen(false), 900);
            try {
                await onSaved?.();
            } catch (refreshError) {
                console.warn('Veículo cadastrado, mas o painel não atualizou imediatamente.', refreshError);
            }
        } catch (error) { setMessage(error.message); } finally { setSaving(false); }
    };
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button variant="outline" className="gap-2"><Truck className="h-4 w-4" />Cadastrar veículo</Button></DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader><DialogTitle>Cadastrar veículo</DialogTitle><DialogDescription>O cadastro será criado automaticamente na planilha de veículos.</DialogDescription></DialogHeader>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <Field label="Buscar no cadastro atual">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Placa, veículo ou projeto" />
                        </div>
                    </Field>
                    {search && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {existingMatches.length > 0
                                ? existingMatches.map((vehicle) => <Badge key={vehicle.placa} variant="secondary">{vehicle.placa} · {vehicle.veiculo}</Badge>)
                                : <span className="text-xs text-muted-foreground">Nenhum veículo já cadastrado com essa busca.</span>}
                        </div>
                    )}
                </div>
                <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
                    <Field label="Placa / identificação"><Input value={form.placa} onChange={(e) => set('placa', e.target.value.toUpperCase())} required /></Field>
                    <Field label="Veículo / modelo"><Input value={form.veiculo} onChange={(e) => set('veiculo', e.target.value)} required /></Field>
                    <Field label="Combustível"><Select value={form.combustivel} onValueChange={(v) => set('combustivel', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Diesel S-10', 'Diesel S-500', 'Gasolina Comum', 'Etanol', 'ARLA', 'Elétrico'].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
                    <Field label="Projeto"><Input value={form.projeto} onChange={(e) => set('projeto', e.target.value)} required /></Field>
                    <Field label="Propriedade"><Select value={form.propriedade} onValueChange={(v) => { set('propriedade', v); set('tipoPosse', v); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['PRÓPRIO', 'LOCADO', 'TERCEIRO'].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
                    <Field label="Franquia mensal"><Input inputMode="decimal" value={form.franquia} onChange={(e) => set('franquia', e.target.value)} /></Field>
                    <Field label="Unidade"><Select value={form.unidade} onValueChange={(v) => set('unidade', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['KM', 'HORAS'].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
                    <Field label="Data de entrada"><Input type="date" value={form.dataEntrada} onChange={(e) => set('dataEntrada', e.target.value)} /></Field>
                    <Field label="Identificador interno"><Input value={form.identificador} onChange={(e) => set('identificador', e.target.value)} /></Field>
                    <Field label="Link da pasta no Google Drive"><Input type="url" value={form.folderUrl} onChange={(e) => set('folderUrl', e.target.value)} placeholder="https://drive.google.com/drive/folders/..." /></Field>
                    
                    <div className="sm:col-span-2 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{message}</p><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cadastrar veículo</Button></div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function CompraPecaDialog({ data, onSaved }) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [form, setForm] = useState({ peca: '', tipo: '', fornecedor: '', valor: '', placa: '__estoque__', dataEntrada: today(), dataSaida: '' });
    const vehicles = useMemo(() => {
        const map = new Map();
        [...(data?.veiculos || []), ...(data?.veiculosAbastecimento || [])].forEach((vehicle) => {
            const plate = String(vehicle?.placa || '').trim().toUpperCase();
            if (plate && !map.has(plate)) map.set(plate, { ...vehicle, placa: plate });
        });
        return [...map.values()].sort((a, b) => a.placa.localeCompare(b.placa, 'pt-BR'));
    }, [data]);
    const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
    const submit = async (event) => {
        event.preventDefault(); setSaving(true); setMessage('');
        if (form.dataSaida && form.dataSaida < form.dataEntrada) {
            setMessage('A data de saída não pode ser anterior à data de entrada.');
            setSaving(false);
            return;
        }
        try {
            const response = await apiServerClient.fetch('/fleet/compra-peca', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, placa: form.placa === '__estoque__' ? '' : form.placa }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || 'Não foi possível salvar a compra de peça.');
            setMessage(body.message || 'Compra de peça gravada na planilha.');
            setForm({ peca: '', tipo: '', fornecedor: '', valor: '', placa: '__estoque__', dataEntrada: today(), dataSaida: '' });
            setTimeout(() => setOpen(false), 900);
            try { await onSaved?.(); } catch (refreshError) { console.warn('Compra salva, mas o painel não atualizou imediatamente.', refreshError); }
        } catch (error) { setMessage(error.message); } finally { setSaving(false); }
    };
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button variant="outline" className="gap-2"><PackageOpen className="h-4 w-4" />Nova compra de peça</Button></DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader><DialogTitle>Registrar compra de peça</DialogTitle><DialogDescription>O lançamento será gravado automaticamente na aba “Compras de Peças”.</DialogDescription></DialogHeader>
                <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
                    <Field label="Peça / descrição"><Input value={form.peca} onChange={(e) => set('peca', e.target.value)} required autoFocus /></Field>
                    <Field label="Tipo / categoria"><Input value={form.tipo} onChange={(e) => set('tipo', e.target.value)} placeholder="Filtro, óleo, graxa…" required /></Field>
                    <Field label="Fornecedor"><Input value={form.fornecedor} onChange={(e) => set('fornecedor', e.target.value)} required /></Field>
                    <Field label="Valor (R$)"><Input inputMode="decimal" value={form.valor} onChange={(e) => set('valor', e.target.value)} placeholder="Ex.: 250,00" required /></Field>
                    <Field label="Veículo / placa"><Select value={form.placa} onValueChange={(value) => set('placa', value)}><SelectTrigger><SelectValue placeholder="Em estoque" /></SelectTrigger><SelectContent><SelectItem value="__estoque__">Em estoque / não vinculado</SelectItem>{vehicles.map((vehicle) => <SelectItem key={vehicle.placa} value={vehicle.placa}>{vehicle.placa} · {vehicle.veiculo}</SelectItem>)}</SelectContent></Select></Field>
                    <Field label="Data de entrada"><Input type="date" value={form.dataEntrada} onChange={(e) => set('dataEntrada', e.target.value)} required /></Field>
                    <Field label="Data de saída / utilização"><Input type="date" value={form.dataSaida} min={form.dataEntrada || undefined} onChange={(e) => set('dataSaida', e.target.value)} /><span className="text-xs text-muted-foreground">Deixe em branco enquanto a peça estiver em estoque.</span></Field>
                    <div className="sm:col-span-2 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{message}</p><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar compra</Button></div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function KmSemanalDialog({ data, onSaved }) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [vehicleSearch, setVehicleSearch] = useState('');
    const [form, setForm] = useState({ data: today(), placa: '', leitura: '', pin: '' });
    const filteredVehicles = useMemo(() => {
        const query = searchKey(vehicleSearch);
        const vehicles = data?.veiculos || [];
        if (!query) return vehicles;
        return vehicles.filter((vehicle) => searchKey(`${vehicle.placa} ${vehicle.veiculo} ${vehicle.projeto}`).includes(query));
    }, [data, vehicleSearch]);
    const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
    const submit = async (event) => {
        event.preventDefault(); setSaving(true); setMessage('');
        try {
            const response = await apiServerClient.fetch('/fleet/km-semanal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || 'Não foi possível salvar o KM semanal.');
            const successMessage = body.message || 'KM semanal atualizado na planilha.';
            setMessage(successMessage);
            setTimeout(() => setOpen(false), 900);
            try {
                await onSaved?.();
            } catch (refreshError) {
                console.warn('KM salvo, mas o painel não atualizou imediatamente.', refreshError);
            }
        } catch (error) { setMessage(error.message); } finally { setSaving(false); }
    };
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button variant="outline" className="gap-2"><Gauge className="h-4 w-4" />Novo KM semanal</Button></DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader><DialogTitle>Lançar KM semanal</DialogTitle><DialogDescription>A leitura será validada e gravada na semana correspondente da planilha.</DialogDescription></DialogHeader>
                <form onSubmit={submit} className="grid gap-4">
                    <Field label="Buscar placa, veículo ou projeto">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input className="pl-9" value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} placeholder="Digite para localizar o veículo" />
                        </div>
                    </Field>
                    <Field label="Data da leitura"><Input type="date" value={form.data} onChange={(e) => set('data', e.target.value)} required /></Field>
                    <Field label="Placa / veículo"><Select value={form.placa} onValueChange={(v) => set('placa', v)} required><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{filteredVehicles.map((v) => <SelectItem key={v.placa} value={v.placa}>{v.placa} · {v.veiculo}</SelectItem>)}</SelectContent></Select></Field>
                    <Field label="Leitura atual (KM / horas)"><Input inputMode="decimal" value={form.leitura} onChange={(e) => set('leitura', e.target.value)} required /></Field>
                    
                    <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{message}</p><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar KM</Button></div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// --- main page -------------------------------------------------------------

export default function HomePage() {
    const { data, loading, error, refresh } = useFleetData();
    const [tab, setTab] = useState('abastecimento');
    const [filters, setFilters] = useState({ periodStart: '', periodEnd: '', projeto: 'all', posto: 'all', placa: 'all', tipoManutencao: 'all', servico: 'all', statusVeiculo: 'all' });
    const [periodOpen, setPeriodOpen] = useState(false);
    const [draftPeriod, setDraftPeriod] = useState({ from: undefined, to: undefined });
    const [search, setSearch] = useState('');
    const [notificationHistory, setNotificationHistory] = useState(readNotificationHistory);
    const [notificationPopoverOpen, setNotificationPopoverOpen] = useState(false);

    const activeNotifications = useMemo(() => buildFleetNotifications(data), [data]);
    const notificationRecords = useMemo(() => mergeNotificationHistory(activeNotifications, notificationHistory), [activeNotifications, notificationHistory]);

    useEffect(() => {
        if (!data || data.checklistLoading) return;
        setNotificationHistory((current) => {
            const now = new Date().toISOString();
            const activeKeys = new Set(activeNotifications.map((item) => item.key));
            const map = new Map(current.map((item) => [item.key, item]));
            activeNotifications.forEach((item) => map.set(item.key, { ...item, status: 'Pendente', resolvedAt: '' }));
            current.forEach((item) => {
                if (!activeKeys.has(item.key) && item.status === 'Pendente') map.set(item.key, { ...item, status: 'Resolvida', resolvedAt: item.resolvedAt || now });
            });
            const next = [...map.values()].slice(-500);
            try { window.localStorage.setItem(NOTIFICATION_HISTORY_KEY, JSON.stringify(next)); } catch { /* armazenamento local opcional */ }
            return next;
        });
    }, [activeNotifications, data, data?.checklistLoading]);

    const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
    const clearFilters = () => {
        setFilters({ periodStart: '', periodEnd: '', projeto: 'all', posto: 'all', placa: 'all', tipoManutencao: 'all', servico: 'all', statusVeiculo: 'all' });
        setSearch('');
    };

    const openNotification = (item) => {
        const nextTab = item.category === 'abastecimento'
            ? 'abastecimento'
            : item.category === 'documentacao'
                ? 'documentacao'
                : item.category === 'manutencao'
                    ? 'manutencao'
                    : 'checklist';
        setTab(nextTab);
        setSearch(item.driver || (item.plate !== '—' ? item.plate : ''));
        if (item.plate && item.plate !== '—') setF('placa', item.plate);
        setNotificationPopoverOpen(false);
    };

    // option lists derived from data
    const options = useMemo(() => {
        if (!data) return { projetos: [], postos: [], placas: [], tiposManutencao: [], servicos: [] };
        const projetos = new Set();
        const postos = new Set();
        const placas = new Set();
        const tiposManutencao = new Set();
        const servicos = new Set();
        data.abastecimento.forEach((r) => {
            if (r.projeto) projetos.add(r.projeto);
            if (r.posto) postos.add(r.posto);
            if (r.placa) placas.add(r.placa);
        });
        data.manutencao.forEach((r) => {
            if (r.projeto) projetos.add(r.projeto);
            if (r.placa) placas.add(r.placa);
            if (r.tipo) tiposManutencao.add(r.tipo);
            const service = maintenanceService(r);
            if (service) servicos.add(service);
        });
        data.veiculos.forEach((r) => {
            if (r.projeto) projetos.add(r.projeto);
            if (r.placa) placas.add(r.placa);
        });
        data.pneus.forEach((r) => { if (r.placa) placas.add(r.placa); });
        data.kmRodado.forEach((r) => { if (r.placa) placas.add(r.placa); });
        return {
            projetos: [...projetos].filter(Boolean).sort(),
            postos: [...postos].filter(Boolean).sort(),
            placas: [...placas].filter(Boolean).sort(),
            tiposManutencao: [...tiposManutencao].filter(Boolean).sort(),
            servicos: [...servicos].filter(Boolean).sort(),
        };
    }, [data]);

    const hasActiveFilters = filters.periodStart || filters.periodEnd || ['projeto', 'posto', 'placa', 'tipoManutencao', 'servico', 'statusVeiculo'].some((key) => filters[key] !== 'all') || search.trim() !== '';
    const periodLabel = filters.periodStart
        ? `${formatDate(filters.periodStart)}${filters.periodEnd ? ` até ${formatDate(filters.periodEnd)}` : ''}`
        : 'Todos os períodos';
    const applyPeriod = () => {
        setFilters((current) => ({ ...current, periodStart: localIsoDate(draftPeriod?.from), periodEnd: localIsoDate(draftPeriod?.to) }));
        setPeriodOpen(false);
    };
    const kmSemanalStatus = useMemo(() => {
        const empty = { monthLabel: '', pending: [] };
        if (!data) return empty;

        const now = new Date();
        now.setHours(23, 59, 59, 999);
        const dueWeeks = (data.kmSemanalDatas || [])
            .map((date, index) => ({ date, index, parsed: date ? new Date(`${date}T00:00:00`) : null }))
            .filter(({ parsed }) => parsed && !Number.isNaN(parsed.getTime()) && parsed <= now);
        if (dueWeeks.length === 0) return empty;

        const kmByPlate = new Map(
            data.kmRodado
                .filter((row) => row.placa)
                .map((row) => [vehicleKey(row.placa), row]),
        );
        const registeredByPlate = new Map();
        data.veiculos.forEach((vehicle) => {
            const plate = String(vehicle.placa || '').trim().toUpperCase();
            const key = vehicleKey(plate);
            if (key && !registeredByPlate.has(key)) registeredByPlate.set(key, { ...vehicle, placa: plate, key });
        });

        const pending = [...registeredByPlate.values()]
            .map((vehicle) => {
                const entryDate = vehicle.dataEntrada ? new Date(`${vehicle.dataEntrada}T00:00:00`) : null;
                const weeklyRow = kmByPlate.get(vehicle.key);
                const missingDates = dueWeeks
                    .filter(({ parsed }) => !entryDate || Number.isNaN(entryDate.getTime()) || entryDate <= parsed)
                    .filter(({ index }) => weeklyRow?.leituras?.[index] === null || weeklyRow?.leituras?.[index] === undefined)
                    .map(({ date }) => date);
                return { ...vehicle, missingDates };
            })
            .filter((vehicle) => vehicle.missingDates.length > 0)
            .sort((a, b) => a.placa.localeCompare(b.placa, 'pt-BR'));

        return {
            monthLabel: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(dueWeeks[0].parsed),
            pending,
        };
    }, [data]);

    const clearPeriod = () => {
        setDraftPeriod({ from: undefined, to: undefined });
        setFilters((current) => ({ ...current, periodStart: '', periodEnd: '' }));
        setPeriodOpen(false);
    };

    return (
        <div className="min-h-screen bg-white text-foreground">
            <Helmet>
                <title>Painel Gerencial de Frotas — Agromig</title>
                <meta name="description" content="Painel gerencial conectado às planilhas de controle de frota: abastecimento, manutenção, documentação, pneus e KM rodado." />
            </Helmet>

            {/* Header */}
            <header className="sticky top-0 z-30 border-b border-[#d7e7dc] bg-white/95 backdrop-blur">
                <div className="mx-auto max-w-[1200px] px-4 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-[175px] sm:w-[215px] shrink-0 overflow-hidden flex items-center">
                            <img
                                src="/agromig-frota/agromig-logo.png"
                                alt="Agromig — Solução e Recuperação Ambiental"
                                className="h-auto w-full object-contain object-left"
                            />
                        </div>
                        <div className="min-w-0 hidden sm:block border-l border-[#d7e7dc] pl-3">
                            <h1 className="text-base sm:text-lg font-bold font-display leading-tight truncate">Painel Gerencial de Frotas</h1>
                            <p className="text-xs text-muted-foreground truncate">Agromig · dados das planilhas de controle</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        {data?.meta?.fetchedAt && (
                            <span className="hidden sm:inline text-xs text-muted-foreground">
                                Atualizado em {formatDateTime(data.meta.fetchedAt, 'pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                        <Popover open={notificationPopoverOpen} onOpenChange={setNotificationPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" aria-label={`Pendências da frota: ${activeNotifications.length}`} className="relative gap-2 border-[#b7d5c0] text-[#1f6b3d] hover:bg-[#edf7ef] hover:text-[#15532e]">
                                    <Bell className="h-4 w-4" />
                                    <span className="hidden sm:inline">Pendências</span>
                                    <span className={cn('min-w-5 rounded-full px-1.5 text-[11px] font-bold leading-5', activeNotifications.length ? 'bg-red-600 text-white' : 'bg-[#d7e7dc] text-[#1f6b3d]')}>{activeNotifications.length}</span>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
                                <div className="border-b border-border px-4 py-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div><p className="font-semibold">Pendências da frota</p><p className="text-xs text-muted-foreground">Somente itens ativos</p></div>
                                        <Badge className={activeNotifications.length ? 'bg-red-600 hover:bg-red-600' : 'bg-[#1f7a46] hover:bg-[#1f7a46]'}>{activeNotifications.length}</Badge>
                                    </div>
                                </div>
                                <div className="max-h-72 overflow-auto p-3">
                                    {activeNotifications.length === 0 ? <p className="flex items-center gap-2 p-2 text-sm text-[#1f7a46]"><CheckCircle2 className="h-4 w-4" />Nenhuma pendência ativa.</p> : activeNotifications.slice(0, 6).map((item) => (
                                        <button key={item.key} type="button" onClick={() => openNotification(item)} className="flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-[#edf7ef]">
                                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[item.priority] || '#64748b' }} />
                                            <span className="min-w-0"><span className="block text-xs font-semibold">{item.title}</span><span className="block truncate text-xs text-muted-foreground">{item.plate !== '—' ? item.plate : item.driver} · {item.reason}</span></span>
                                        </button>
                                    ))}
                                </div>
                                <div className="border-t border-border p-3"><Button type="button" className="w-full gap-2 bg-[#1f7a46] hover:bg-[#15532e]" onClick={() => { setTab('pendencias'); setNotificationPopoverOpen(false); }}><ListFilter className="h-4 w-4" />Ver todas as pendências</Button></div>
                            </PopoverContent>
                        </Popover>
                        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-2 border-[#b7d5c0] text-[#1f6b3d] hover:bg-[#edf7ef] hover:text-[#15532e]">
                            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                            Atualizar
                        </Button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-[1200px] px-4 py-6 flex flex-col gap-6">
                <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                    <div>
                        <h2 className="font-semibold">Lançamentos operacionais</h2>
                        <p className="text-sm text-muted-foreground">Cadastre e valide os dados antes de alimentar as planilhas.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <LancamentoDialog type="abastecimento" data={data} onSaved={refresh} />
                        <LancamentoDialog type="manutencao" data={data} onSaved={refresh} />
                        <CompraPecaDialog data={data} onSaved={refresh} />
                        <KmSemanalDialog data={data} onSaved={refresh} />
                        <VeiculoDialog data={data} onSaved={refresh} />
                    </div>
                </section>
                {/* Source notice */}
                {data?.meta?.fields?.abastecimentoMotorista === false && (
                    <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-sm font-semibold">Campo “motorista” não disponível em abastecimento</AlertTitle>
                        <AlertDescription className="text-xs">
                            A planilha de Gastos registra placa, veículo, projeto, posto e litragem, mas não possui coluna de motorista. O cadastro de motoristas (aba CNH) é exibido na visão de Documentação.
                        </AlertDescription>
                    </Alert>
                )}

                {kmSemanalStatus.pending.length > 0 && (
                    <Alert className="border-orange-300 bg-orange-50 text-orange-950 dark:bg-orange-950/40 dark:text-orange-100">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-sm font-semibold">
                            KM semanal pendente — {kmSemanalStatus.pending.length} veículo(s)
                        </AlertTitle>
                        <AlertDescription className="text-xs">
                            <p>
                                Faltam leituras vencidas de {kmSemanalStatus.monthLabel} para:
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {kmSemanalStatus.pending.map((vehicle) => (
                                    <Badge key={vehicle.placa} variant="outline" className="border-orange-300 bg-white/70 text-orange-950 dark:bg-orange-950/60 dark:text-orange-100">
                                        {vehicle.placa}{vehicle.veiculo ? ` · ${vehicle.veiculo}` : ''} · {vehicle.missingDates.map((date) => formatDate(date)).join(', ')}
                                    </Badge>
                                ))}
                            </div>
                        </AlertDescription>
                    </Alert>
                )}

                {error && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-sm font-semibold">Não foi possível carregar os dados</AlertTitle>
                        <AlertDescription className="text-xs flex items-center justify-between gap-3 flex-wrap">
                            <span>{error}</span>
                            <Button size="sm" variant="outline" onClick={refresh} className="gap-2">
                                <RefreshCw className="h-4 w-4" /> Tentar novamente
                            </Button>
                        </AlertDescription>
                    </Alert>
                )}

                {loading && !data && <LoadingSkeleton />}

                {data && (
                    <>
                        {/* Filters */}
                        {tab !== 'faturamento' && <Card className="p-4">
                            <div className="flex flex-wrap items-end gap-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-medium text-muted-foreground">Período</label>
                                    <Popover open={periodOpen} onOpenChange={(open) => { setPeriodOpen(open); if (open) setDraftPeriod({ from: dateFromIso(filters.periodStart), to: dateFromIso(filters.periodEnd) }); }}>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="w-[265px] justify-start gap-2 font-normal">
                                                <CalendarDays className="h-4 w-4" />{periodLabel}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <DateCalendar mode="range" selected={draftPeriod} onSelect={setDraftPeriod} numberOfMonths={2} locale={ptBR} />
                                            <div className="flex items-center justify-end gap-2 border-t p-3">
                                                <Button type="button" variant="ghost" size="sm" onClick={clearPeriod}>Limpar</Button>
                                                <Button type="button" size="sm" onClick={applyPeriod} disabled={!draftPeriod?.from}>Aplicar período</Button>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                <FilterSelect label="Projeto" value={filters.projeto} onChange={(v) => setF('projeto', v)} options={options.projetos} />
                                <FilterSelect label="Posto" value={filters.posto} onChange={(v) => setF('posto', v)} options={options.postos} />
                                <FilterSelect label="Placa / Veículo" value={filters.placa} onChange={(v) => setF('placa', v)} options={options.placas} />
                                <FilterSelect label="Tipo de manutenção" value={filters.tipoManutencao} onChange={(v) => setF('tipoManutencao', v)} options={options.tiposManutencao} />
                                <FilterSelect label="Tipo de serviço" value={filters.servico} onChange={(v) => setF('servico', v)} options={options.servicos} />
                                <FilterSelect label="Status do veículo" value={filters.statusVeiculo} onChange={(v) => setF('statusVeiculo', v)} options={['ativos', 'inativos']} format={(value) => value === 'ativos' ? 'Veículos ativos' : 'Veículos inativos'} />
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-medium text-muted-foreground">Buscar</label>
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="placa, veículo, item…" className="pl-8 w-52" />
                                    </div>
                                </div>
                                {hasActiveFilters && (
                                    <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-muted-foreground">
                                        <X className="h-4 w-4" /> Limpar
                                    </Button>
                                )}
                            </div>
                        </Card>}

                        {/* Tabs */}
                        <div className="flex flex-wrap gap-1 border-b border-[#d7e7dc] bg-white">
                            {TABS.map((t) => {
                                const Icon = t.icon;
                                const active = tab === t.id;
                                return (
                                    <button
                                        key={t.id}
                                        onClick={() => setTab(t.id)}
                                        className={cn(
                                            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                                            active
                                                ? 'border-[#1f7a46] bg-[#1f7a46] text-white rounded-t-md shadow-sm'
                                                : 'border-transparent text-[#486653] hover:bg-[#edf7ef] hover:text-[#1f7a46] rounded-t-md',
                                        )}
                                    >
                                        <Icon className="h-4 w-4" />
                                        {t.label}
                                        {t.id === 'pendencias' && <span className={cn('rounded-full px-1.5 text-[10px] leading-5', activeNotifications.length ? 'bg-red-600 text-white' : 'bg-[#d7e7dc] text-[#1f6b3d]')}>{activeNotifications.length}</span>}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Tab content */}
                        {tab === 'pendencias' && <PendenciasView records={notificationRecords} activeCount={activeNotifications.length} onOpen={openNotification} />}
                        {tab === 'abastecimento' && <AbastecimentoView data={data} filters={filters} search={search} />}
                        {tab === 'manutencao' && <ManutencaoView data={data} filters={filters} search={search} filterOptions={options} onFilterChange={setF} />}
                        {tab === 'documentacao' && <DocumentacaoView data={data} filters={filters} search={search} />}
                        {tab === 'km' && <KmView data={data} filters={filters} search={search} />}
                        {tab === 'checklist' && <ChecklistView data={data} filters={filters} search={search} />}
                        {tab === 'compras-pecas' && <ComprasPecasView data={data} filters={filters} search={search} />}
                        {tab === 'faturamento' && <FaturamentoView data={data} />}
                    </>
                )}
            </main>

            <footer className="border-t border-border mt-6">
                <div className="mx-auto max-w-[1200px] px-4 py-5 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
                    <span>Fonte: planilhas Google Sheets de Controle e Monitoramento de Frota.</span>
                    <span>© {new Date().getFullYear()} Agromig</span>
                </div>
            </footer>
        </div>
    );
}

function FilterSelect({ label, value, onChange, options, format }) {
    return (
        <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">{label}</label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {options.map((o) => (
                        <SelectItem key={o} value={o}>{format ? format(o) : o}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="flex flex-col gap-6">
            <Skeleton className="h-20 w-full rounded-lg" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
            </div>
            <Skeleton className="h-80 w-full rounded-lg" />
        </div>
    );
}

// --- views -----------------------------------------------------------------

function matchesFuelRow(row, filters, search) {
    const rowDate = (row.data || '').slice(0, 10);
    if (filters.periodStart && rowDate < filters.periodStart) return false;
    if (filters.periodEnd && rowDate > filters.periodEnd) return false;
    if (filters.projeto !== 'all' && row.projeto !== filters.projeto) return false;
    if (filters.posto !== 'all' && row.posto !== filters.posto) return false;
    if (filters.placa !== 'all' && row.placa !== filters.placa) return false;
    const query = searchKey(search);
    return !query || searchKey(`${row.placa} ${row.veiculo} ${row.categoria} ${row.item} ${row.posto} ${row.projeto}`).includes(query);
}

function maintenanceService(row) {
    return String(row?.descricao || row?.servico || row?.peca || '').trim();
}

function getActiveVehicleKeys(data) {
    const cadastro = new Set((data?.veiculos || []).map((vehicle) => vehicleKey(vehicle.placa)).filter(Boolean));
    const documentados = new Set((data?.documentacao || []).map((row) => vehicleKey(row.placa)).filter(Boolean));
    return new Set([...cadastro].filter((key) => documentados.size === 0 || documentados.has(key)));
}

function matchesVehicleStatus(placa, statusVeiculo, activeKeys) {
    if (!statusVeiculo || statusVeiculo === 'all') return true;
    const active = activeKeys.has(vehicleKey(placa));
    return statusVeiculo === 'ativos' ? active : !active;
}

const NOTIFICATION_HISTORY_KEY = 'agromig.frota.pendencias.v1';
const PRIORITY_RANK = { 'Atenção': 1, Prioridade: 2, Urgente: 3, Crítica: 4 };
const PRIORITY_COLORS = { 'Atenção': '#ca8a04', Prioridade: '#ea580c', Urgente: '#f97316', 'Crítica': '#dc2626' };

function notificationDate(value) {
    const date = String(value || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function documentPriority(row) {
    const status = normalizedStatus(row?.status);
    const days = Number.isFinite(Number(row?.diasRestantes)) ? Number(row.diasRestantes) : null;
    if (status === 'ATRASADA' || (days !== null && days < 0)) return 'Crítica';
    if (days !== null && days <= 7) return 'Urgente';
    if (days !== null && days <= 15) return 'Prioridade';
    return 'Atenção';
}

function documentReason(row) {
    const status = String(row?.status || '').trim();
    if (status === 'Atrasada') return row.mensagem || 'Documento vencido.';
    if (status === 'A vencer') return row.mensagem || `Documento próximo do vencimento (${NUM(row.diasRestantes)} dias restantes).`;
    return row.mensagem || 'Documento obrigatório não cadastrado ou sem validade informada.';
}

function isDocumentApplicable(vehicle, document) {
    const doc = searchKey(document);
    const vehicleText = searchKey(`${vehicle?.veiculo || ''} ${vehicle?.placa || ''}`);
    const isMachine = /retroescavadeira|escavadeira|trator|rocadeira|embarcacao/.test(vehicleText);
    if (isMachine && doc.includes('crlv')) return false;
    if (vehicle?.placa === '1PY3036ECRM015714' && (doc.includes('opacidade') || doc.includes('eletromecanico'))) return false;
    if (doc.includes('opacidade') && vehicle?.combustivel && !searchKey(vehicle.combustivel).includes('diesel')) return false;
    if (doc.includes('contrato') && ['GOR1I41', 'GMH3A70'].includes(vehicleKey(vehicle?.placa))) return false;
    return true;
}

const PREVENTIVE_MAINTENANCE_RE = /preventiv|preventiva|revis[aã]o programada|revis[aã]o preventiva/i;
const MACHINE_MAINTENANCE_RE = /retroescavadeira|escavadeira|trator|rocadeira|embarca[cç][aã]o/i;

function numericValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const raw = String(value ?? '').trim().replace(/\s/g, '');
    if (!raw) return null;
    const normalized = raw.includes(',') && raw.includes('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.includes(',')
            ? raw.replace(',', '.')
            : /^-?\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function maintenanceUnit(vehicle, row = {}) {
    const raw = searchKey(row.unidade || vehicle?.unidade || '');
    if (/hora|horas|\bh\b/.test(raw)) return 'H';
    return 'KM';
}

function maintenanceIsPreventive(row) {
    return PREVENTIVE_MAINTENANCE_RE.test(`${row?.tipo || ''} ${row?.categoria || ''} ${row?.descricao || ''}`);
}

function maintenanceMachine(text) {
    return MACHINE_MAINTENANCE_RE.test(String(text || ''));
}

function numericField(source, names) {
    for (const name of names) {
        const value = numericValue(source?.[name]);
        if (value !== null) return value;
    }
    return null;
}

function maintenanceLimitFromText(row, unit) {
    const text = String(`${row?.descricao || ''} ${row?.peca || ''}`).trim();
    if (!text) return null;
    const numberPattern = '(\\d[\\d.,]*)';
    const unitPattern = unit === 'H' ? '(?:h|hora|horas)' : '(?:km|quilometragem|quilometragem)';
    const direct = text.match(new RegExp(`${numberPattern}\\s*${unitPattern}\\b`, 'i'));
    if (direct) return numericValue(direct[1]);
    // Descrições como “revisão de 1000H” podem deixar a unidade fora do
    // padrão esperado. O veículo já define se a leitura é KM ou H.
    if (/revis[aã]o|manuten[cç][aã]o/i.test(text)) {
        const revision = text.match(new RegExp(`(?:revis[aã]o|manuten[cç][aã]o)[^\\d]{0,18}${numberPattern}`, 'i'));
        if (revision) return numericValue(revision[1]);
    }
    return null;
}

function maintenanceMatchesVehicle(row, vehicle) {
    const rowPlate = vehicleKey(row?.placa);
    const plate = vehicleKey(vehicle?.placa);
    if (rowPlate && plate && rowPlate === plate) return true;
    const rowText = searchKey(`${row?.placa || ''} ${row?.veiculo || ''}`);
    const vehicleText = searchKey(`${vehicle?.placa || ''} ${vehicle?.veiculo || ''}`);
    // Alguns registros antigos usam “RETROESCAVADEIRA JCB3CX AGR 102” no
    // lugar do identificador alfanumérico. O código AGR é uma chave estável.
    const rowAgr = rowText.match(/agr\s*\d{2,3}/)?.[0]?.replace(/\s/g, '');
    const vehicleAgr = vehicleText.match(/agr\s*\d{2,3}/)?.[0]?.replace(/\s/g, '');
    return Boolean(rowAgr && vehicleAgr && rowAgr === vehicleAgr);
}

function latestPreventiveByVehicle(data, vehicle) {
    const rows = (data?.manutencao || [])
        .filter((row) => maintenanceIsPreventive(row) && maintenanceMatchesVehicle(row, vehicle))
        .filter((row) => numericValue(row.leitura) !== null)
        .sort((a, b) => String(b.dataChamado || '').localeCompare(String(a.dataChamado || '')) || (Number(b.id) || 0) - (Number(a.id) || 0));
    return rows[0] || null;
}

function currentReadingForVehicle(data, vehicle) {
    const key = vehicleKey(vehicle?.placa);
    const weekly = (data?.kmRodado || []).find((row) => vehicleKey(row.placa) === key);
    const readings = Array.isArray(weekly?.leituras) ? weekly.leituras.map(numericValue).filter((value) => value !== null) : [];
    // `kmMes` representa a distância rodada no mês, não o hodômetro. A
    // manutenção preventiva precisa do último lançamento semanal absoluto.
    if (readings.length) return readings[readings.length - 1];
    return numericField(weekly, ['leituraAtual', 'kmAtual', 'horasAtual']);
}

function preventiveMaintenanceStatus(delta, unit) {
    if (delta <= 0) return { priority: 'Crítica', classification: 'VENCIDA / PRIORIDADE MÁXIMA', message: 'MANUTENÇÃO VENCIDA — MARCAR A MANUTENÇÃO O MAIS RÁPIDO POSSÍVEL.' };
    if ((unit === 'KM' && delta <= 250) || (unit === 'H' && delta <= 25)) {
        return { priority: 'Urgente', classification: 'URGENTE — AGENDAR MANUTENÇÃO', message: 'URGENTE: AGENDAR MANUTENÇÃO — Veículo/equipamento próximo do limite da manutenção preventiva.' };
    }
    if ((unit === 'KM' && delta <= 1000) || (unit === 'H' && delta <= 50)) {
        return { priority: 'Atenção', classification: 'AVISO — AGENDAR MANUTENÇÃO', message: 'AGENDAR MANUTENÇÃO — Manutenção preventiva se aproximando do limite.' };
    }
    return null;
}

function buildPreventiveMaintenanceNotifications(data) {
    const notifications = [];
    (data?.veiculos || []).forEach((vehicle) => {
        // O limite cadastrado no veículo é a fonte principal da próxima
        // manutenção. O histórico preventivo continua sendo usado quando
        // existir, mas não pode ser obrigatório: veículos recém-cadastrados
        // ou com histórico lançado como “Outros” também devem ser monitorados.
        const latest = latestPreventiveByVehicle(data, vehicle) || {};
        const unit = maintenanceUnit(vehicle, latest);
        const current = currentReadingForVehicle(data, vehicle);
        if (current === null) return;
        const reading = numericValue(latest.leitura);

        const absoluteLimit = numericField(latest, ['limiteManutencao', 'limitePreventiva', 'limite', 'kmLimite', 'kmLimiteManutencao', 'horasLimite', 'limiteHoras'])
            ?? numericField(vehicle, ['limiteManutencao', 'limitePreventiva', 'limite', 'kmLimite', 'kmLimiteManutencao', 'horasLimite', 'limiteHoras'])
            ?? maintenanceLimitFromText(latest, unit);
        const interval = numericField(latest, ['intervaloManutencao', 'intervaloPreventiva', 'intervalo', 'intervaloKm', 'intervaloHoras'])
            ?? numericField(vehicle, ['intervaloManutencao', 'intervaloPreventiva', 'intervalo', 'intervaloKm', 'intervaloHoras']);
        // A regra operacional já adotada para máquinas é uma revisão a cada
        // 250 H. Para veículos rodoviários, não se presume um intervalo que
        // não esteja cadastrado na base.
        const fallbackInterval = unit === 'H' && maintenanceMachine(`${vehicle.veiculo} ${vehicle.placa}`) ? 250 : null;
        const limit = absoluteLimit !== null
            ? absoluteLimit
            : interval !== null && reading !== null
                ? reading + interval
                : fallbackInterval !== null && reading !== null
                    ? reading + fallbackInterval
                    : null;
        if (limit === null) return;
        const delta = limit - current;
        const status = preventiveMaintenanceStatus(delta, unit);
        if (!status) return;
        const plate = vehicle.placa || latest.placa || '—';
        const difference = delta >= 0 ? `Faltam ${NUM(delta, 1)} ${unit}` : `Ultrapassou ${NUM(Math.abs(delta), 1)} ${unit}`;
        notifications.push({
            key: `manutencao:${vehicleKey(plate)}:${latest.id || latest.dataChamado || 'preventiva'}`,
            category: 'manutencao',
            title: `Manutenção preventiva — ${status.classification}`,
            plate,
            vehicle: vehicle.veiculo || latest.veiculo || '—',
            driver: '',
            date: notificationDate(latest.dataPrevista || latest.dataChamado),
            reason: status.message,
            detail: `Limite: ${NUM(limit, 1)} ${unit} · Atual: ${NUM(current, 1)} ${unit} · ${difference}`,
            priority: status.priority,
            status: 'Pendente',
            actionLabel: 'Ver manutenção',
        });
    });
    return notifications;
}

function buildFleetNotifications(data) {
    if (!data) return [];
    const notifications = [];
    const vehicleByPlate = new Map((data.veiculos || []).map((vehicle) => [vehicleKey(vehicle.placa), vehicle]));

    (data.abastecimento || []).forEach((row, index) => {
        const status = normalizedStatus(row.status);
        // Registros sem status são históricos normais na planilha. Somente o
        // marcador explícito de revisão/inconformidade gera uma pendência.
        if (!status || status === 'OK') return;
        const reason = !Number.isFinite(Number(row.km))
            ? 'KM não informado.'
            : !Number.isFinite(Number(row.litros))
                ? 'Litragem não informada.'
                : row.kmEstimado
                    ? 'KM estimado pela média de lançamentos.'
                    : 'Lançamento marcado como REVISAR na planilha.';
        notifications.push({
            key: `abastecimento:${notificationDate(row.data)}:${vehicleKey(row.placa)}:${index}`,
            category: 'abastecimento',
            title: 'Abastecimento — Lançamento incorreto',
            plate: row.placa || '—',
            vehicle: row.veiculo || vehicleByPlate.get(vehicleKey(row.placa))?.veiculo || '—',
            driver: row.fa || '',
            date: notificationDate(row.data),
            reason,
            detail: `${row.item || 'Combustível'} · ${row.litros != null ? NUM(row.litros, 2) + ' L' : 'sem litragem'}${row.projeto ? ` · ${row.projeto}` : ''}`,
            priority: 'Crítica',
            status: 'Pendente',
            actionLabel: 'Ver lançamento',
        });
    });

    // A aba de documentação também contém linhas técnicas vazias e erros de
    // fórmula. Elas não representam um documento obrigatório identificável e
    // não devem gerar alerta duplicado ou falso positivo.
    const documentMap = new Map();
    (data.documentacao || []).forEach((row) => {
        const document = String(row.documento || '').trim();
        const plate = String(row.placa || '').trim();
        const status = String(row.status || '').trim();
        if (!document || document === '#REF!' || !plate || plate === '#REF!' || status === 'OK') return;
        const vehicle = vehicleByPlate.get(vehicleKey(plate));
        if (!isDocumentApplicable(vehicle, document)) return;
        const key = `documentacao:${vehicleKey(plate)}:${searchKey(document)}`;
        const item = {
            key,
            category: 'documentacao',
            title: status === 'Atrasada' ? 'Documentação — Documento vencido' : status === 'A vencer' ? 'Documentação — Vencimento próximo' : 'Documentação — Documento obrigatório ausente',
            plate,
            vehicle: row.veiculo || vehicle?.veiculo || '—',
            driver: '',
            date: notificationDate(row.vencimento),
            dueDate: notificationDate(row.vencimento),
            document,
            reason: documentReason(row),
            detail: row.vencimento ? `Vencimento: ${formatDate(row.vencimento)}${row.diasRestantes != null ? ` · ${NUM(row.diasRestantes)} dias restantes` : ''}` : 'Sem data de validade informada.',
            priority: documentPriority(row),
            status: 'Pendente',
            actionLabel: 'Ver documentação',
        };
        const previous = documentMap.get(key);
        if (!previous || PRIORITY_RANK[item.priority] > PRIORITY_RANK[previous.priority]) documentMap.set(key, item);
    });
    notifications.push(...documentMap.values());
    notifications.push(...buildPreventiveMaintenanceNotifications(data));

    if (data.checklistLoaded && !data.checklistLoading && !data.checklistError) {
        const checklistRows = (data.checklist || []).map((row) => ({ row, date: notificationDate(row.created_at || row.uploaded_at) })).filter((entry) => entry.date);
        const period = checklistRows.map((entry) => entry.date).sort().at(-1) || '';
        if (period) {
            const periodRows = checklistRows.filter((entry) => entry.date === period).map((entry) => entry.row);
            const registeredNames = (data.motoristas || [])
                .map((row) => row.nome || row.motorista || row.name)
                .map((value) => String(value || '').trim())
                .filter(Boolean);
            const { missingDrivers } = summarizeChecklistDrivers(registeredNames, periodRows.map(checklistDriver));
            missingDrivers.forEach((driver) => {
                notifications.push({
                    key: `checklist:${period}:${driverNameKey(driver)}`,
                    category: 'checklist',
                    title: 'Checklist — Não realizado',
                    plate: '—',
                    vehicle: '—',
                    driver,
                    date: period,
                    period,
                    reason: 'Checklist obrigatório não realizado no período mais recente registrado.',
                    detail: `Período acompanhado: ${formatDate(period)}`,
                    priority: 'Urgente',
                    status: 'Pendente',
                    actionLabel: 'Ver checklist',
                });
            });
        }
    }
    return notifications.sort((a, b) => (PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]) || String(b.date || '').localeCompare(String(a.date || '')));
}

function readNotificationHistory() {
    if (typeof window === 'undefined') return [];
    try {
        const parsed = JSON.parse(window.localStorage.getItem(NOTIFICATION_HISTORY_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function mergeNotificationHistory(active, history) {
    const map = new Map((history || []).map((item) => [item.key, item]));
    active.forEach((item) => map.set(item.key, { ...item, status: 'Pendente', resolvedAt: '' }));
    return [...map.values()].sort((a, b) => (a.status === 'Pendente' ? -1 : 1) || String(b.date || '').localeCompare(String(a.date || '')));
}

function AbastecimentoView({ data, filters, search }) {
    const [fuelFilter, setFuelFilter] = useState('all');
    const [projectFilter, setProjectFilter] = useState('all');
    const [monthFilter, setMonthFilter] = useState('all');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const activeVehicleKeys = useMemo(() => getActiveVehicleKeys(data), [data.veiculos, data.documentacao]);
    const rows = useMemo(() => data.abastecimento
        .filter(isFuelConsumption)
        .filter((row) => matchesFuelRow(row, filters, search))
        .filter((row) => {
            return matchesVehicleStatus(row.placa, filters.statusVeiculo, activeVehicleKeys);
        }), [data.abastecimento, filters, search, activeVehicleKeys]);
    const projectRows = useMemo(() => projectFilter === 'all' ? rows : rows.filter((row) => row.projeto === projectFilter), [rows, projectFilter]);
    const monthRows = useMemo(() => monthFilter === 'all' ? projectRows : projectRows.filter((row) => row.anoMes === monthFilter), [projectRows, monthFilter]);
    const allEntries = useMemo(() => mergeAbastecimentoRows(data.abastecimento, data.outrosAbastecimentos), [data.abastecimento, data.outrosAbastecimentos]);
    const categoryOptions = useMemo(() => uniqueOptions(['Combustível', 'Graxa', ...(data.tiposAbastecimento || []), ...allEntries.map((row) => row.categoria)]), [data.tiposAbastecimento, allEntries]);
    const visibleRows = useMemo(() => allEntries
        .filter((row) => matchesFuelRow(row, filters, search) && matchesVehicleStatus(row.placa, filters.statusVeiculo, activeVehicleKeys))
        .filter((row) => projectFilter === 'all' || row.projeto === projectFilter)
        .filter((row) => monthFilter === 'all' || row.anoMes === monthFilter)
        .filter((row) => fuelFilter !== 'postos' || row.posto)
        .filter((row) => categoryFilter === 'all' || searchKey(abastecimentoCategory(row.categoria, row.item)) === searchKey(categoryFilter)),
    [allEntries, filters, search, activeVehicleKeys, projectFilter, monthFilter, fuelFilter, categoryFilter]);

    const kpis = useMemo(() => {
        const litros = monthRows.reduce((s, r) => s + (r.litros || 0), 0);
        const valor = monthRows.reduce((s, r) => s + (r.valor || 0), 0);
        const preco = monthRows.filter((r) => r.precoLitro > 0);
        const precoMedio = preco.length ? preco.reduce((s, r) => s + r.precoLitro, 0) / preco.length : 0;
        const postos = new Set(monthRows.map((r) => r.posto).filter(Boolean));
        return { litros, valor, precoMedio, count: monthRows.length, postos: postos.size };
    }, [monthRows]);

    const chartPeriod = useMemo(() => {
        const map = {};
        monthRows.forEach((r) => {
            if (!r.data) return;
            const start = dateFromIso(filters.periodStart);
            const end = dateFromIso(filters.periodEnd);
            const span = monthFilter !== 'all' ? 31 : (start && end ? Math.round((end - start) / 86400000) + 1 : 999);
            const date = dateFromIso(r.data);
            let k;
            let label;
            if (span <= 31) {
                k = r.data;
                label = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
            } else if (span <= 120) {
                const monday = new Date(date);
                monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
                const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
                k = localIsoDate(monday);
                label = `${monday.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')}–${sunday.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')}`;
            } else {
                k = r.anoMes;
                const month = date.toLocaleDateString('pt-BR', { month: 'long' });
                label = `${month.charAt(0).toUpperCase()}${month.slice(1)}${new Set(monthRows.map((item) => (item.anoMes || '').slice(0, 4))).size > 1 ? `/${r.anoMes.slice(0, 4)}` : ''}`;
            }
            if (!map[k]) map[k] = { periodo: k, label, valor: 0, litros: 0 };
            map[k].valor += r.valor || 0;
            map[k].litros += r.litros || 0;
        });
        const start = dateFromIso(filters.periodStart);
        const end = dateFromIso(filters.periodEnd);
        const span = monthFilter !== 'all' ? 31 : (start && end ? Math.round((end - start) / 86400000) + 1 : 999);
        return { data: Object.values(map).sort((a, b) => a.periodo.localeCompare(b.periodo)), title: span <= 31 ? 'Valor em combustível por dia (R$)' : span <= 120 ? 'Valor em combustível por semana (R$)' : 'Valor em combustível por mês (R$)' };
    }, [monthRows, monthFilter, filters.periodStart, filters.periodEnd]);

    const porProjeto = useMemo(() => {
        const map = {};
        monthRows.forEach((r) => {
            const k = r.projeto || 's/projeto';
            if (!map[k]) map[k] = { nome: k, litros: 0, valor: 0 };
            map[k].litros += r.litros || 0;
            map[k].valor += r.valor || 0;
        });
        return Object.values(map).sort((a, b) => b.valor - a.valor).slice(0, 10);
    }, [monthRows]);

    const projectOptions = useMemo(() => (
        [...new Set(rows.map((row) => row.projeto).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    ), [rows]);

    const monthOptions = useMemo(() => (
        [...new Set(rows.map((row) => row.anoMes).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b))
    ), [rows]);

    const kmL = useMemo(() => {
        const unidadePorPlaca = new Map((data.veiculos || []).map((vehicle) => [vehicleKey(vehicle.placa), normalizedStatus(vehicle.unidade)]));
        const grupos = new Map();
        data.abastecimento.forEach((row, sourceIndex) => {
            if (!isFuelConsumption(row)) return;
            const key = vehicleKey(row.placa);
            const nonVehicleFuel = searchKey(`${row.placa} ${row.veiculo} ${row.item}`);
            if (nonVehicleFuel.includes('galao') || nonVehicleFuel.includes('embarcac') || /^equ\d*/.test(searchKey(row.placa))) return;
            if (filters.statusVeiculo !== 'all' && (filters.statusVeiculo === 'ativos') !== activeVehicleKeys.has(key)) return;
            if (!key || unidadePorPlaca.get(key)?.includes('HORA') || !row.data || !Number.isFinite(row.km)) return;
            if (!grupos.has(key)) grupos.set(key, []);
            grupos.get(key).push({ ...row, sourceIndex });
        });

        const intervalos = [];
        let outliers = 0;
        // Limites operacionais específicos por veículo. O TXQ7H01 (Strada)
        // não deve ultrapassar 14 km/L; os demais seguem o limite geral de 20.
        const limiteKmLPorPlaca = new Map([
            [vehicleKey('TXQ7H01'), 14],
        ]);
        grupos.forEach((itens) => {
            itens.sort((a, b) => a.data.localeCompare(b.data) || a.sourceIndex - b.sourceIndex);
            let anterior = null;
            itens.forEach((atual) => {
                if (!anterior) {
                    anterior = atual;
                    return;
                }
                if (atual.km <= anterior.km) return;
                const kmRodados = atual.km - anterior.km;
                anterior = atual;
                if (!(Number.isFinite(atual.litros) && atual.litros > 0)) return;
                if (!matchesFuelRow(atual, filters, search)) return;
                if (projectFilter !== 'all' && atual.projeto !== projectFilter) return;
                if (monthFilter !== 'all' && atual.anoMes !== monthFilter) return;
                if (fuelFilter === 'postos' && !atual.posto) return;
                const limiteKmL = limiteKmLPorPlaca.get(vehicleKey(atual.placa)) || 20;
                // Leituras acima do limite operacional do veículo são incompatíveis
                // e normalmente indicam KM digitado incorretamente ou leitura faltante.
                // Mantemos o lançamento original na planilha, mas não deixamos que ele
                // distorça a média do dashboard.
                if (kmRodados / atual.litros > limiteKmL) {
                    outliers += 1;
                    return;
                }
                intervalos.push({ ...atual, kmRodados });
            });
        });

        const porPlaca = new Map();
        intervalos.forEach((row) => {
            const key = vehicleKey(row.placa);
            const current = porPlaca.get(key) || { placa: row.placa, veiculo: row.veiculo, kmRodados: 0, litros: 0, intervalos: 0 };
            current.kmRodados += row.kmRodados;
            current.litros += row.litros;
            current.intervalos += 1;
            porPlaca.set(key, current);
        });
        const porVeiculo = [...porPlaca.values()]
            .map((row) => ({ ...row, kmLitro: row.kmRodados / row.litros }))
            .sort((a, b) => b.kmLitro - a.kmLitro);
        const totalKm = intervalos.reduce((sum, row) => sum + row.kmRodados, 0);
        const totalLitros = intervalos.reduce((sum, row) => sum + row.litros, 0);
        return { porVeiculo, mediaFrota: totalLitros > 0 ? totalKm / totalLitros : null, outliers };
    }, [data.abastecimento, data.veiculos, filters, search, fuelFilter, projectFilter, monthFilter, activeVehicleKeys]);

    return (
        <section className="flex flex-col gap-5">
            {data.abastecimentoExtrasError && <Alert className="border-amber-300 bg-amber-50 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertTitle>Tipos de abastecimento não atualizados</AlertTitle><AlertDescription>{data.abastecimentoExtrasError}</AlertDescription></Alert>}
            <p className="text-xs text-muted-foreground">Indicadores e gráficos de consumo consideram apenas combustível. Graxa e outros tipos podem ser consultados na tabela de lançamentos abaixo.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiCard label="Abastecimentos" value={NUM(kpis.count)} active={fuelFilter === 'all'} onClick={() => setFuelFilter('all')} />
                <KpiCard label="Litros" value={NUM(kpis.litros, 1)} />
                <KpiCard label="Total R$" value={BRL(kpis.valor)} accent="text-foreground" />
                <KpiCard label="Preço médio/L" value={kpis.precoMedio ? BRL(kpis.precoMedio) : '—'} />
                <KpiCard label="Postos" value={NUM(kpis.postos)} active={fuelFilter === 'postos'} onClick={() => setFuelFilter((value) => value === 'postos' ? 'all' : 'postos')} />
                <KpiCard label="Média KM/L" value={kmL.mediaFrota === null ? '—' : NUM(kmL.mediaFrota, 2)} sub={`${kmL.porVeiculo.length} veículo(s) calculado(s)`} />
            </div>
            {kmL.outliers > 0 && (
                <Alert className="border-amber-300 bg-amber-50 text-amber-950">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>KM/L para revisão</AlertTitle>
                    <AlertDescription>
                        {NUM(kmL.outliers)} intervalo(s) acima do limite operacional do veículo foram retirados da média. No TXQ7H01, o limite considerado é 14 km/L; revise o KM ou os litros lançados na planilha de abastecimento.
                    </AlertDescription>
                </Alert>
            )}
            <ActiveFilter label={filters.statusVeiculo !== 'all' ? `Frota: ${filters.statusVeiculo}` : monthFilter !== 'all' ? `Mês: ${monthFilter}` : projectFilter !== 'all' ? `Projeto: ${projectFilter}` : fuelFilter === 'postos' ? 'Registros com posto informado' : ''} onClear={() => { setProjectFilter('all'); setMonthFilter('all'); setFuelFilter('all'); }} />
            <Card className="p-4 flex flex-wrap items-end gap-3 bg-[#f8fcf9] border-[#cfe8d5]">
                <FilterSelect label="Filtrar projeto no abastecimento" value={projectFilter} onChange={setProjectFilter} options={projectOptions} />
                <FilterSelect label="Selecionar mês do gráfico" value={monthFilter} onChange={setMonthFilter} options={monthOptions} format={(value) => {
                    const [year, month] = value.split('-');
                    return `${month}/${year}`;
                }} />
                {projectFilter !== 'all' && <Button variant="outline" size="sm" onClick={() => setProjectFilter('all')}>Todos os projetos</Button>}
                {monthFilter !== 'all' && <Button variant="outline" size="sm" onClick={() => setMonthFilter('all')}>Todos os meses</Button>}
                <p className="text-xs text-muted-foreground pb-1">Você também pode clicar em uma barra do gráfico “Litros por projeto”.</p>
            </Card>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title={chartPeriod.title}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartPeriod.data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} width={48} />
                            <Tooltip formatter={(v) => BRL(v)} />
                            <Bar dataKey="valor" fill="#2563eb" radius={[4, 4, 0, 0]} label={{ position: 'top', formatter: COMPACT_BRL, fontSize: 9, fill: '#475569' }} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
                <ChartCard title="Litros por projeto (top 10)">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={porProjeto} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="nome" tick={{ fontSize: 10 }} width={120} />
                            <Tooltip formatter={(v) => `${NUM(v, 1)} L`} />
                            <Bar dataKey="litros" fill="#0891b2" radius={[0, 4, 4, 0]} onClick={(entry) => {
                                const name = entry?.payload?.nome || entry?.nome || entry?.activeLabel;
                                if (name) setProjectFilter((value) => value === name ? 'all' : name);
                            }} cursor="pointer" />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="KM/L por veículo (top 10)">
                    {kmL.porVeiculo.length === 0 ? <EmptyHint>Sem leituras sucessivas válidas para os filtros.</EmptyHint> : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={kmL.porVeiculo.slice(0, 10)} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                <XAxis type="number" tick={{ fontSize: 11 }} />
                                <YAxis type="category" dataKey="placa" tick={{ fontSize: 10 }} width={82} />
                                <Tooltip formatter={(value) => `${NUM(value, 2)} km/L`} />
                                <Bar dataKey="kmLitro" fill="#15803d" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </ChartCard>
                <Card className="p-4 flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-foreground">Desempenho por veículo (KM/L)</h3>
                    <p className="text-xs text-muted-foreground">Galões, embarcações e equipamentos sem hodômetro não entram no cálculo.</p>
                    {kmL.porVeiculo.length === 0 ? <EmptyHint>Sem leituras sucessivas válidas para os filtros.</EmptyHint> : (
                        <ScrollTable head={<>{['Placa', 'Veículo', 'KM rodados', 'Litros', 'KM/L', 'Intervalos'].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</>}>
                            {kmL.porVeiculo.map((row) => (
                                <TableRow key={row.placa}>
                                    <TableCell className="font-mono text-xs">{row.placa}</TableCell>
                                    <TableCell>{row.veiculo}</TableCell>
                                    <TableCell className="text-right">{NUM(row.kmRodados, 1)}</TableCell>
                                    <TableCell className="text-right">{NUM(row.litros, 2)}</TableCell>
                                    <TableCell className="text-right font-semibold text-green-700">{NUM(row.kmLitro, 2)}</TableCell>
                                    <TableCell className="text-right">{NUM(row.intervalos)}</TableCell>
                                </TableRow>
                            ))}
                        </ScrollTable>
                    )}
                </Card>
            </div>
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">Lançamentos de abastecimento</h3>
                <FilterSelect label="Tipo de abastecimento (tabela)" value={categoryFilter} onChange={setCategoryFilter} options={categoryOptions} />
                {data.abastecimentoExtrasLoading && <p role="status" className="text-xs text-muted-foreground">Atualizando graxa e demais tipos de abastecimento…</p>}
                {visibleRows.length === 0 ? <EmptyHint>Nenhum abastecimento para os filtros selecionados.</EmptyHint> : (
                    <ScrollTable head={
                        <>{['Data', 'Placa', 'Veículo', 'KM', 'Projeto', 'Posto', 'Tipo', 'Item', 'Quantidade', 'R$/unidade', 'Valor', 'Status'].map((h) => <TableHead key={h}>{h}</TableHead>)}</>
                    }>
                        {visibleRows.slice(0, 200).map((r, i) => (
                            <TableRow key={i}>
                                <TableCell className="whitespace-nowrap">{r.data ? formatDate(r.data, 'pt-BR') : '—'}</TableCell>
                                <TableCell className="font-mono text-xs">{r.placa}</TableCell>
                                <TableCell>{r.veiculo}</TableCell>
                                <TableCell className="text-right">{Number.isFinite(r.km) ? NUM(r.km, 1) : '—'}{r.kmEstimado && <span className="ml-1 text-[10px] text-amber-700" title="KM estimado pela média entre os lançamentos anterior e posterior">(média)</span>}</TableCell>
                                <TableCell className="text-xs">{r.projeto}</TableCell>
                                <TableCell className="text-xs">{r.posto}</TableCell>
                                <TableCell className="text-xs">{abastecimentoCategory(r.categoria, r.item)}</TableCell>
                                <TableCell className="text-xs">{r.item}</TableCell>
                                <TableCell className="text-right whitespace-nowrap">{NUM(r.litros, 2)}{r.litros != null ? ` ${abastecimentoUnit(r.categoria, r.item)}` : ''}</TableCell>
                                <TableCell className="text-right">{r.precoLitro ? BRL(r.precoLitro) : '—'}</TableCell>
                                <TableCell className="text-right font-medium">{BRL(r.valor)}</TableCell>
                                <TableCell><Badge variant={r.status === 'OK' ? 'secondary' : 'outline'} className={r.status === 'REVISAR' ? 'border-amber-400 text-amber-700' : ''}>{r.status || '—'}</Badge></TableCell>
                            </TableRow>
                        ))}
                    </ScrollTable>
                )}
                {visibleRows.length > 200 && <p className="text-xs text-muted-foreground">Exibindo 200 de {visibleRows.length} registros.</p>}
            </div>
        </section>
    );
}

function OwnedVehiclesFinanceView({ data, period }) {
    const [month, setMonth] = useState(() => localIsoDate(new Date()).slice(0, 7));
    const ready = Array.isArray(data.cadastroFinanceiro);
    const summary = useMemo(() => summarizeOwnedVehicles(data.cadastroFinanceiro || []), [data.cadastroFinanceiro]);
    const schedule = useMemo(() => insuranceSchedule(), []);
    const insurance = useMemo(() => summarizeInsurance(month, null, schedule), [month, schedule]);
    const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
    const complete = ready && !summary.missingValues.length && !summary.conflicts.length;
    const resultCents = complete && validMonth ? summary.totalCents - insurance.expenseCents : null;

    // A single-month date filter also selects its insurance installment. For
    // broader periods this separate monthly view keeps an explicit competence.
    useEffect(() => {
        const from = (period.from || '').slice(0, 7);
        const to = (period.to || '').slice(0, 7);
        if (from && (!to || from === to)) setMonth(from);
        else if (!from && to) setMonth(to);
    }, [period.from, period.to]);

    return (
        <Card className="p-4 sm:p-5 flex flex-col gap-4 border-[#cfe8d5] bg-[#f8fcf9]">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-1">
                    <h3 className="text-base font-semibold text-[#1f6b3d]">Faturamento Mensal — Veículos Próprios</h3>
                    <p className="text-xs text-muted-foreground">Fonte: Cadastro de Veículos · TIPO DE POSSE = Próprio · ALUGUEL MENSAL (R$).</p>
                    <p className="text-xs text-muted-foreground">Valores atuais do Cadastro, sem reconstrução de receitas históricas. O mês abaixo define a parcela do seguro. Viagens, locações e manutenção continuam nos indicadores separados.</p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                    <Label htmlFor="owned-finance-month" className="text-xs">Mês do resumo e seguro</Label>
                    <Input id="owned-finance-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-full sm:w-48 bg-white" />
                </div>
            </div>
            {data.cadastroFinanceiroError && <Alert className="border-amber-300 bg-amber-50 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertTitle>Cadastro financeiro não atualizado</AlertTitle><AlertDescription>{data.cadastroFinanceiroError}</AlertDescription></Alert>}
            {!ready && !data.cadastroFinanceiroError && <p role="status" className="text-sm text-[#1f7a46]">Carregando valores mensais do Cadastro…</p>}
            {(summary.missingValues.length > 0 || summary.conflicts.length > 0) && <Alert className="border-amber-300 bg-amber-50 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertTitle>Conferir valores no Cadastro</AlertTitle><AlertDescription>{summary.missingValues.length > 0 && <p>Sem valor mensal válido: {summary.missingValues.join(', ')}.</p>}{summary.conflicts.length > 0 && <p>Placas duplicadas com posse ou valor divergente, excluídas do subtotal: {summary.conflicts.join(', ')}.</p>}O resultado após seguro só é exibido quando todos os valores estão conferidos.</AlertDescription></Alert>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <KpiCard label="Receita mensal com veículos próprios" value={ready ? formatFinanceBRL(summary.totalCents) : '—'} sub={ready ? `${summary.rows.length} veículo(s) único(s)${complete ? '' : ' · subtotal dos valores válidos'}` : 'aguardando Cadastro'} accent="text-[#1f7a46]" />
                <KpiCard label="Despesa mensal com seguro" value={validMonth ? formatFinanceBRL(insurance.expenseCents) : '—'} sub={validMonth ? insurance.installment ? `Parcela ${insurance.installment.number}/10 · vence em ${formatDate(insurance.installment.dueDate)}` : 'Sem parcela contratada neste mês' : 'Selecione um mês válido'} accent="text-amber-700" />
                <KpiCard label="Resultado após seguro" value={resultCents === null ? '—' : formatFinanceBRL(resultCents)} sub="Receita mensal − parcela prevista do seguro" accent={resultCents >= 0 ? 'text-green-700' : 'text-red-700'} />
            </div>
            {ready && <details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-sm font-medium text-[#1f6b3d]">Veículos próprios considerados ({summary.rows.length})</summary><div className="mt-3"><ScrollTable head={<>{['Placa', 'Veículo', 'Projeto', 'Aluguel mensal'].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</>}>{summary.rows.map((row) => <TableRow key={row.plateKey}><TableCell className="whitespace-nowrap">{row.placa}</TableCell><TableCell>{row.veiculo || '—'}</TableCell><TableCell>{row.projeto || '—'}</TableCell><TableCell className="text-right whitespace-nowrap">{row.amountCents === null ? 'Sem valor cadastrado' : formatFinanceBRL(row.amountCents)}</TableCell></TableRow>)}<TableRow className="font-semibold bg-muted/40"><TableCell colSpan={3}>{complete ? 'Total mensal' : 'Subtotal dos valores válidos'}</TableCell><TableCell className="text-right whitespace-nowrap">{formatFinanceBRL(summary.totalCents)}</TableCell></TableRow></ScrollTable></div></details>}
            <div className="border-t border-[#cfe8d5] pt-4 flex flex-col gap-3">
                <div><h4 className="text-sm font-semibold text-[#1f6b3d]">Seguro — Veículos Próprios</h4><p className="text-xs text-muted-foreground">Um único contrato para o conjunto, sem multiplicar a parcela pelo número de veículos. Vencimentos da apólice: 13/08/2026 a 13/05/2027.</p></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <KpiCard label="Total contratado" value={formatFinanceBRL(insurance.totalCents)} sub="10 parcelas · 9 de R$ 4.177,19 e a última de R$ 4.177,21" />
                    <KpiCard label="Parcela no mês selecionado" value={validMonth ? insurance.installment ? `${insurance.installment.number} de ${schedule.length}` : 'Nenhuma' : '—'} sub={validMonth ? formatFinanceBRL(insurance.expenseCents) : 'Selecione um mês'} />
                    <KpiCard label="Total já pago" value={formatFinanceBRL(insurance.paidCents)} sub="A apólice não comprova pagamentos" />
                    <KpiCard label="Saldo restante do seguro" value={formatFinanceBRL(insurance.balanceCents)} sub="Depende da confirmação das parcelas pagas" />
                </div>
                <details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-sm font-medium text-[#1f6b3d]">Consultar as 10 parcelas</summary><div className="mt-3"><ScrollTable head={<>{['Parcela', 'Vencimento', 'Valor', 'Pagamento'].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</>}>{schedule.map((row) => <TableRow key={row.number} className={row.number === insurance.installment?.number ? 'bg-green-50' : ''}><TableCell>{row.number}/10</TableCell><TableCell className="whitespace-nowrap">{formatDate(row.dueDate)}</TableCell><TableCell className="text-right whitespace-nowrap">{formatFinanceBRL(row.amountCents)}</TableCell><TableCell>Não informado</TableCell></TableRow>)}<TableRow className="font-semibold bg-muted/40"><TableCell colSpan={2}>Total contratado</TableCell><TableCell className="text-right whitespace-nowrap">{formatFinanceBRL(insurance.totalCents)}</TableCell><TableCell>—</TableCell></TableRow></ScrollTable></div></details>
            </div>
        </Card>
    );
}

function FaturamentoView({ data }) {
    const [period, setPeriod] = useState({ from: '', to: '' });
    const [equipment, setEquipment] = useState(FATURAMENTO_EQUIPMENT.ALL);
    const sourceReady = Array.isArray(data?.viagensLTU5A25) && Array.isArray(data?.locacoesRetroescavadeira);
    const invalidPeriod = period.from && period.to && period.from > period.to;
    const revenueRows = useMemo(() => invalidPeriod ? [] : buildRevenueRows(data, { ...period, equipment }), [data, period, equipment, invalidPeriod]);
    const maintenanceRows = useMemo(() => invalidPeriod ? [] : buildMaintenanceCostRows(data, { ...period, equipment }), [data, period, equipment, invalidPeriod]);
    const summary = useMemo(() => summarizeByEquipment(revenueRows, maintenanceRows), [revenueRows, maintenanceRows]);
    const revenueTotal = revenueRows.reduce((sum, row) => sum + row.amount, 0);
    const maintenanceTotal = maintenanceRows.reduce((sum, row) => sum + row.amount, 0);
    const result = revenueTotal - maintenanceTotal;
    const margin = revenueTotal ? (result / revenueTotal) * 100 : null;
    const revenueByMonth = useMemo(() => aggregateByMonth(revenueRows).map((row) => ({ ...row, label: `${row.month.slice(5)}/${row.month.slice(0, 4)}`, faturamento: row.value })), [revenueRows]);
    const costsByMonth = useMemo(() => aggregateByMonth(maintenanceRows).map((row) => ({ ...row, label: `${row.month.slice(5)}/${row.month.slice(0, 4)}`, custos: row.value })), [maintenanceRows]);
    const monthlyComparison = useMemo(() => {
        const months = new Set([...revenueByMonth, ...costsByMonth].map((row) => row.month));
        return [...months].sort().map((month) => ({
            month,
            label: `${month.slice(5)}/${month.slice(0, 4)}`,
            faturamento: revenueByMonth.find((row) => row.month === month)?.faturamento || 0,
            custos: costsByMonth.find((row) => row.month === month)?.custos || 0,
            resultado: (revenueByMonth.find((row) => row.month === month)?.faturamento || 0) - (costsByMonth.find((row) => row.month === month)?.custos || 0),
        }));
    }, [revenueByMonth, costsByMonth]);
    const equipmentChart = [
        { name: 'Caminhão Prancha LTU5A25', value: summary.truck.revenue, kind: FATURAMENTO_EQUIPMENT.TRUCK },
        { name: 'Retroescavadeira', value: summary.retro.revenue, kind: FATURAMENTO_EQUIPMENT.RETRO },
    ].filter((row) => row.value > 0);
    const clearPeriod = () => setPeriod({ from: '', to: '' });
    const setShortcut = (shortcut) => {
        const now = new Date();
        const iso = (date) => localIsoDate(date);
        if (shortcut === 'all') return clearPeriod();
        if (shortcut === 'month') {
            setPeriod({ from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) });
        } else if (shortcut === 'previous') {
            setPeriod({ from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) });
        } else if (shortcut === 'year') {
            setPeriod({ from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(new Date(now.getFullYear(), 11, 31)) });
        }
    };
    const equipmentLabel = equipment === FATURAMENTO_EQUIPMENT.TRUCK
        ? 'Caminhão Prancha LTU5A25'
        : equipment === FATURAMENTO_EQUIPMENT.RETRO ? 'Retroescavadeira' : 'Todos os equipamentos';

    return (
        <section className="flex flex-col gap-5">
            {data.faturamentoError && <Alert className="border-amber-300 bg-amber-50 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertTitle className="text-sm font-semibold">Faturamento não atualizado</AlertTitle><AlertDescription className="text-xs">{data.faturamentoError}{sourceReady && ' Os últimos dados carregados foram mantidos.'}</AlertDescription></Alert>}
            {!sourceReady && !data.faturamentoError && <p role="status" className="text-sm text-[#1f7a46]">Carregando viagens e locações das planilhas…</p>}
            <Card className="p-4 flex flex-col gap-3 bg-[#f8fcf9] border-[#cfe8d5]">
                <div className="flex flex-wrap items-end gap-3">
                    <div className="w-full text-sm font-semibold text-[#1f6b3d]">Filtros de faturamento</div>
                    <Field label="Data inicial"><Input aria-label="Data inicial" type="date" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} className="w-44" /></Field>
                    <Field label="Data final"><Input aria-label="Data final" type="date" value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} className="w-44" /></Field>
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">Atalhos</span>
                        <div className="flex flex-wrap gap-1.5">
                            <Button type="button" size="sm" variant="outline" onClick={() => setShortcut('month')}>Este mês</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setShortcut('previous')}>Mês anterior</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setShortcut('year')}>Este ano</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setShortcut('all')}>Todo período</Button>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">Equipamento</span>
                        <Select value={equipment} onValueChange={setEquipment}>
                            <SelectTrigger aria-label="Equipamento" className="w-64"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={FATURAMENTO_EQUIPMENT.ALL}>Todos</SelectItem>
                                <SelectItem value={FATURAMENTO_EQUIPMENT.TRUCK}>Caminhão Prancha LTU5A25</SelectItem>
                                <SelectItem value={FATURAMENTO_EQUIPMENT.RETRO}>Retroescavadeira</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {(period.from || period.to || equipment !== FATURAMENTO_EQUIPMENT.ALL) && <Button type="button" variant="ghost" size="sm" onClick={() => { clearPeriod(); setEquipment(FATURAMENTO_EQUIPMENT.ALL); }} className="gap-1.5 text-muted-foreground"><X className="h-4 w-4" />Limpar filtros</Button>}
                </div>
                <p className="text-xs text-muted-foreground">Exibindo: {equipmentLabel}{period.from || period.to ? ` · ${period.from ? formatDate(period.from) : 'início'} até ${period.to ? formatDate(period.to) : 'fim'}` : ' · todo o período disponível'}</p>
                <p className="text-xs text-muted-foreground">Receitas pela data da viagem ou início da locação, sem repetir serviços entre meses. Custos registrados no Histórico de Manutenção, pela data do chamado; o status de cada lançamento aparece na tabela.</p>
                {invalidPeriod && <p className="text-xs font-medium text-red-700">A data inicial não pode ser posterior à data final.</p>}
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <KpiCard label="Faturamento total" value={sourceReady ? BRL(revenueTotal) : '—'} accent="text-[#1f7a46]" />
                <KpiCard label="Caminhão prancha" value={sourceReady ? BRL(summary.truck.revenue) : '—'} />
                <KpiCard label="Retroescavadeira" value={sourceReady ? BRL(summary.retro.revenue) : '—'} />
                <KpiCard label="Custos de manutenção" value={sourceReady ? BRL(maintenanceTotal) : '—'} accent="text-amber-700" />
                <KpiCard label="Resultado líquido" value={sourceReady ? BRL(result) : '—'} accent={result >= 0 ? 'text-green-700' : 'text-red-700'} />
                <KpiCard label="Margem" value={!sourceReady || margin === null ? '—' : `${NUM(margin, 1)}%`} sub={revenueTotal ? 'resultado / faturamento' : 'sem faturamento no período'} />
            </div>

            <OwnedVehiclesFinanceView data={data} period={period} />

            {sourceReady && <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Faturamento por mês">
                    {revenueByMonth.length === 0 ? <EmptyHint>Sem faturamento no período selecionado.</EmptyHint> : <ResponsiveContainer width="100%" height="100%"><BarChart data={revenueByMonth} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}><CartesianGrid strokeDasharray="3 3" className="stroke-border" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={56} /><Tooltip formatter={(value) => BRL(value)} /><Bar dataKey="faturamento" name="Faturamento" fill="#1f7a46" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>}
                </ChartCard>
                <ChartCard title="Faturamento por equipamento">
                    {equipmentChart.length === 0 ? <EmptyHint>Sem faturamento no período selecionado.</EmptyHint> : <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={equipmentChart} dataKey="value" nameKey="name" innerRadius={48} outerRadius={88} paddingAngle={2}>{equipmentChart.map((row) => <Cell key={row.kind} fill={row.kind === FATURAMENTO_EQUIPMENT.TRUCK ? '#1f7a46' : '#2563eb'} />)}</Pie><Tooltip formatter={(value) => BRL(value)} /><Legend /></PieChart></ResponsiveContainer>}
                </ChartCard>
                <ChartCard title="Custos de manutenção por mês">
                    {costsByMonth.length === 0 ? <EmptyHint>Sem custos no período selecionado.</EmptyHint> : <ResponsiveContainer width="100%" height="100%"><BarChart data={costsByMonth} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}><CartesianGrid strokeDasharray="3 3" className="stroke-border" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={56} /><Tooltip formatter={(value) => BRL(value)} /><Bar dataKey="custos" name="Custos" fill="#d97706" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>}
                </ChartCard>
                <ChartCard title="Faturamento × custos por mês">
                    {monthlyComparison.length === 0 ? <EmptyHint>Sem dados no período selecionado.</EmptyHint> : <ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyComparison} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}><CartesianGrid strokeDasharray="3 3" className="stroke-border" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={56} /><Tooltip formatter={(value) => BRL(value)} /><Legend /><Bar dataKey="faturamento" name="Faturamento" fill="#1f7a46" radius={[4, 4, 0, 0]} /><Bar dataKey="custos" name="Custos" fill="#d97706" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>}
                </ChartCard>
            </div>
            <ChartCard title="Resultado líquido por mês">
                {monthlyComparison.length === 0 ? <EmptyHint>Sem dados no período selecionado.</EmptyHint> : <ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyComparison} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}><CartesianGrid strokeDasharray="3 3" className="stroke-border" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={56} /><Tooltip formatter={(value) => BRL(value)} /><Bar dataKey="resultado" name="Resultado líquido" radius={[4, 4, 0, 0]}>{monthlyComparison.map((row) => <Cell key={row.month} fill={row.resultado >= 0 ? '#15803d' : '#dc2626'} />)}</Bar></BarChart></ResponsiveContainer>}
            </ChartCard>

            <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">Resumo por equipamento</h3><p className="text-xs text-muted-foreground">Valores calculados no mesmo período e com o mesmo filtro de equipamento.</p></div><Badge variant="outline">{revenueRows.length} serviço(s)</Badge></div>
                <div className="mt-4"><ScrollTable head={<>{['Equipamento', 'Faturamento', 'Custo de manutenção', 'Resultado'].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</>}>
                    {[
                        ['Caminhão Prancha LTU5A25', summary.truck],
                        ['Retroescavadeira', summary.retro],
                        ['TOTAL', { revenue: revenueTotal, cost: maintenanceTotal, result }],
                    ].map(([label, row]) => <TableRow key={label} className={label === 'TOTAL' ? 'font-semibold bg-muted/40' : ''}><TableCell>{label}</TableCell><TableCell className="text-right">{BRL(row.revenue)}</TableCell><TableCell className="text-right">{BRL(row.cost)}</TableCell><TableCell className={cn('text-right', row.result >= 0 ? 'text-green-700' : 'text-red-700')}>{BRL(row.result)}</TableCell></TableRow>)}
                </ScrollTable></div>
            </Card>

            <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-foreground">Detalhamento de faturamento</h3>{revenueRows.length === 0 ? <EmptyHint>Nenhum serviço faturado para os filtros selecionados.</EmptyHint> : <ScrollTable head={<>{['Data', 'Equipamento', 'Tipo', 'Cliente', 'Descrição', 'Origem / local', 'Destino', 'Horas / período', 'Valor faturado', 'Observações'].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</>}>{revenueRows.map((row) => <TableRow key={row.id}><TableCell className="whitespace-nowrap text-xs">{formatDate(row.date)}</TableCell><TableCell className="text-xs">{row.equipment}</TableCell><TableCell className="text-xs">{row.type}</TableCell><TableCell className="text-xs">{row.client || '—'}</TableCell><TableCell className="text-xs max-w-[210px] truncate" title={row.description}>{row.description || '—'}</TableCell><TableCell className="text-xs">{row.origin || '—'}</TableCell><TableCell className="text-xs">{row.destination || '—'}</TableCell><TableCell className="text-right text-xs">{row.duration || '—'}</TableCell><TableCell className="text-right font-medium">{BRL(row.amount)}</TableCell><TableCell className="text-xs">{row.notes || '—'}</TableCell></TableRow>)}</ScrollTable>}</div>

            <div className="flex justify-end text-sm font-semibold">Total faturado: {BRL(revenueTotal)}</div>
            <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-foreground">Custos de manutenção</h3>{maintenanceRows.length === 0 ? <EmptyHint>Nenhum custo de manutenção dos equipamentos no período selecionado.</EmptyHint> : <ScrollTable head={<>{['Data', 'Equipamento', 'Tipo / categoria', 'Descrição', 'Fornecedor', 'Valor', 'Observação'].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</>}>{maintenanceRows.map((row) => <TableRow key={row.id}><TableCell className="whitespace-nowrap text-xs">{formatDate(row.date)}</TableCell><TableCell className="text-xs">{row.equipment}</TableCell><TableCell className="text-xs">{row.type}</TableCell><TableCell className="text-xs max-w-[260px] truncate" title={row.description}>{row.description || '—'}</TableCell><TableCell className="text-xs">{row.supplier || '—'}</TableCell><TableCell className="text-right font-medium">{BRL(row.amount)}</TableCell><TableCell className="text-xs">{row.notes || '—'}</TableCell></TableRow>)}</ScrollTable>}<div className="flex justify-end text-sm font-semibold">Total de custos: {BRL(maintenanceTotal)}</div></div>
            </>}
        </section>
    );
}

function ComprasPecasView({ data, filters, search }) {
    const rows = useMemo(() => (data.comprasPecas || []).filter((row) => {
        const date = String(row.dataEntrada || '').slice(0, 10);
        if (filters.periodStart && date && date < filters.periodStart) return false;
        if (filters.periodEnd && date && date > filters.periodEnd) return false;
        if (filters.placa !== 'all' && row.placa && row.placa !== filters.placa) return false;
        const query = searchKey(search);
        return !query || searchKey(`${row.peca} ${row.tipo} ${row.fornecedor} ${row.placa}`).includes(query);
    }), [data.comprasPecas, filters.periodStart, filters.periodEnd, filters.placa, search]);
    const total = useMemo(() => rows.reduce((sum, row) => sum + (Number(row.valor) || 0), 0), [rows]);
    const emEstoque = rows.filter((row) => row.status === 'Em estoque').length;
    const utilizadas = rows.filter((row) => row.status === 'Utilizada').length;

    return (
        <section className="flex flex-col gap-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="Peças lançadas" value={NUM(rows.length)} />
                <KpiCard label="Em estoque" value={NUM(emEstoque)} accent="text-amber-700" />
                <KpiCard label="Utilizadas" value={NUM(utilizadas)} accent="text-green-700" />
                <KpiCard label="Valor total" value={BRL(total)} />
            </div>
            <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><h3 className="text-sm font-semibold">Compras de peças</h3><p className="text-xs text-muted-foreground">A data de saída representa a retirada do estoque e utilização da peça.</p></div>
                    <Badge variant="outline">{rows.length} registro(s)</Badge>
                </div>
                <div className="mt-4">
                    {rows.length === 0 ? <EmptyHint>Nenhuma compra de peça para os filtros selecionados.</EmptyHint> : (
                        <ScrollTable head={<>{['Peça / descrição', 'Tipo', 'Fornecedor', 'Valor', 'Veículo / placa', 'Entrada', 'Saída / utilização', 'Status'].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</>}>
                            {rows.map((row) => (
                                <TableRow key={row.id || `${row.peca}-${row.dataEntrada}-${row.placa}`}>
                                    <TableCell className="font-medium">{row.peca || '—'}</TableCell>
                                    <TableCell>{row.tipo || '—'}</TableCell>
                                    <TableCell>{row.fornecedor || '—'}</TableCell>
                                    <TableCell className="text-right">{BRL(row.valor)}</TableCell>
                                    <TableCell className="font-mono text-xs">{row.placa || 'Em estoque'}</TableCell>
                                    <TableCell className="whitespace-nowrap">{row.dataEntrada ? formatDate(row.dataEntrada) : '—'}</TableCell>
                                    <TableCell className="whitespace-nowrap">{row.dataSaida ? formatDate(row.dataSaida) : '—'}</TableCell>
                                    <TableCell><Badge variant="outline" className={row.status === 'Utilizada' ? 'border-green-300 text-green-700' : 'border-amber-300 text-amber-700'}>{row.status}</Badge></TableCell>
                                </TableRow>
                            ))}
                        </ScrollTable>
                    )}
                </div>
            </Card>
        </section>
    );
}

function MaintenancePartsPanel({ data, filters, search }) {
    const [view, setView] = useState('compras');
    const [from, setFrom] = useState(filters.periodStart || '');
    const [to, setTo] = useState(filters.periodEnd || '');
    const [plate, setPlate] = useState(filters.placa || 'all');
    useEffect(() => { setFrom(filters.periodStart || ''); setTo(filters.periodEnd || ''); }, [filters.periodStart, filters.periodEnd]);
    useEffect(() => { setPlate(filters.placa || 'all'); }, [filters.placa]);
    const result = useMemo(() => summarizeMaintenanceParts(data.comprasPecas, {
        from, to, plate, search, currentDate: localIsoDate(new Date()), vehicles: data.veiculos,
    }), [data.comprasPecas, data.veiculos, from, to, plate, search]);
    const plates = useMemo(() => [...new Set((data.comprasPecas || []).map((row) => resolvePartsVehicle(row.placa, data.veiculos)).filter(Boolean))].sort(), [data.comprasPecas, data.veiculos]);
    const modelByPlate = useMemo(() => new Map((data.veiculos || []).map((row) => [vehicleKey(row.placa), row.veiculo])), [data.veiculos]);
    const applyMonth = () => {
        const now = new Date();
        setFrom(localIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
        setTo(localIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    };
    const selectedRows = view === 'estoque' ? result.stockRows : view === 'caras' ? result.expensiveRows : result.periodRows;
    const views = [{ id: 'compras', label: 'Compras do período' }, { id: 'estoque', label: 'Estoque atual' }, { id: 'caras', label: 'Peças mais caras' }, { id: 'veiculos', label: 'Veículos atendidos' }];
    const selectedTotal = view === 'estoque' ? result.stockCents : view === 'caras'
        ? result.expensiveRows.reduce((sum, row) => sum + row.amountCents, 0) : result.totalCents;
    return (
        <section aria-label="Compras de peças — gastos e estoque" className="flex flex-col gap-4 rounded-2xl border border-green-200 bg-green-50/30 p-3 sm:p-5">
            <div className="flex items-start gap-3">
                <PackageOpen className="mt-1 h-6 w-6 shrink-0 text-green-700" />
                <div><h2 className="text-lg font-semibold text-green-950">Compras de Peças — Gastos e Estoque</h2>
                    <p className="text-sm text-muted-foreground">Fonte: aba Compras de Peças. Gastos pela data de entrada; estoque atual inclui compras de meses anteriores.</p></div>
            </div>
            <Card className="p-4 flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><Label htmlFor="parts-period-from">Entrada a partir de</Label><Input id="parts-period-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
                    <div><Label htmlFor="parts-period-to">Entrada até</Label><Input id="parts-period-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
                    <FilterSelect label="Veículo das peças" value={plate} onChange={setPlate} options={plates.includes(plate) || plate === 'all' ? plates : [plate, ...plates]} />
                </div>
                <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={applyMonth}>Este mês</Button><Button variant="outline" size="sm" onClick={() => { setFrom(''); setTo(''); }}>Todo período</Button></div>
                <p className="text-xs text-muted-foreground">Esta seção usa período de entrada, veículo e busca. Projeto, tipo de manutenção e serviço não filtram peças: esses campos não constam na aba de compras. Os gastos de peças não são somados aos chamados acima, evitando contabilização dupla.</p>
            </Card>
            {!result.available ? <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Compras de peças indisponíveis</AlertTitle><AlertDescription>A integração não retornou esta aba. Atualize os dados antes de consultar os totais.</AlertDescription></Alert> : <>
                {result.invalidPeriod && <Alert variant="destructive"><AlertDescription>A data final deve ser igual ou posterior à inicial.</AlertDescription></Alert>}
                {(result.missingDates > 0 || result.invalidDates > 0 || result.missingValues > 0 || result.stockMissingValues > 0) && <Alert className="border-amber-300 bg-amber-50 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertTitle>Dados a conferir na planilha</AlertTitle><AlertDescription>{result.missingDates} lançamento(s) sem entrada válida, fora dos gastos por período; {result.invalidDates} com datas inconsistentes, fora do estoque. Valores não informados: {result.missingValues} no período e {result.stockMissingValues} no estoque. Os totais somam apenas valores válidos.</AlertDescription></Alert>}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <KpiCard label="Gasto em peças no período" value={formatFinanceBRL(result.totalCents)} sub={`${NUM(result.periodRows.length)} lançamento(s)`} accent="text-green-800" onClick={() => setView('compras')} active={view === 'compras'} />
                    <KpiCard label="Estoque atual" value={formatFinanceBRL(result.stockCents)} sub={`${NUM(result.stockRows.length)} lançamento(s) ainda não utilizados`} onClick={() => setView('estoque')} active={view === 'estoque'} />
                    <KpiCard label="Compra mais cara no período" value={result.expensiveRows.length ? formatFinanceBRL(result.expensiveRows[0].amountCents) : '—'} sub={result.expensiveRows[0]?.peca || 'Nenhuma compra com valor informado'} onClick={() => setView('caras')} active={view === 'caras'} />
                    <KpiCard label="Veículos atendidos no período" value={NUM(result.vehicles.length)} sub="Com placa vinculada à compra" onClick={() => setView('veiculos')} active={view === 'veiculos'} />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <ChartCard title="Gastos com peças por mês de entrada">
                        {result.monthly.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={result.monthly} margin={{ top: 10, right: 12, bottom: 8, left: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#d1e7d8" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tickFormatter={COMPACT_BRL} tick={{ fontSize: 11 }} width={65} /><Tooltip formatter={(value) => [BRL(value), 'Compras de peças']} /><Bar dataKey="valor" fill="#15803d" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <EmptyHint>Nenhuma compra com data de entrada no período.</EmptyHint>}
                    </ChartCard>
                    <ChartCard title="Veículos com maior gasto em peças — Top 10">
                        {result.vehicles.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={result.vehicles.slice(0, 10).map((row) => ({ ...row, valor: row.amountCents / 100 }))} layout="vertical" margin={{ top: 8, right: 12, bottom: 8, left: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#d1e7d8" /><XAxis type="number" tickFormatter={COMPACT_BRL} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="placa" width={100} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => [BRL(value), 'Peças compradas']} /><Bar dataKey="valor" fill="#166534" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer> : <EmptyHint>Nenhuma compra vinculada a veículo no período.</EmptyHint>}
                    </ChartCard>
                </div>
                <div className="flex flex-wrap gap-2" aria-label="Tabelas de compras de peças">
                    {views.map((item) => <Button key={item.id} size="sm" variant={view === item.id ? 'default' : 'outline'} aria-pressed={view === item.id} onClick={() => setView(item.id)} className={view === item.id ? 'bg-green-700 text-white hover:bg-green-800' : ''}>{item.label}</Button>)}
                </div>
                <div className="flex flex-col gap-2">
                    <h3 className="font-semibold text-green-950">{views.find((item) => item.id === view).label}</h3>
                    <p className="text-xs text-muted-foreground">{view === 'estoque' ? 'Entradas já registradas, sem saída realizada até hoje. A contagem é de lançamentos: a fonte não informa quantidade de unidades.' : view === 'caras' ? 'Top 10 ordenado pelo valor total do lançamento, não pelo preço unitário. A compra mais cara está destacada.' : 'Somente compras com data de entrada dentro do período selecionado.'}</p>
                    {view === 'veiculos' ? result.vehicles.length ? <ScrollTable head={<>{['Placa', 'Veículo', 'Lançamentos', 'Total em peças'].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</>}>
                        {result.vehicles.map((row) => <TableRow key={row.plateKey}><TableCell className="font-mono">{row.placa}</TableCell><TableCell>{modelByPlate.get(row.plateKey) || 'Não informado'}</TableCell><TableCell>{NUM(row.count)}</TableCell><TableCell className="text-right font-semibold text-green-800">{formatFinanceBRL(row.amountCents)}{row.missingValues > 0 && <span className="block text-xs text-amber-800">Subtotal: {row.missingValues} sem valor</span>}</TableCell></TableRow>)}
                    </ScrollTable> : <EmptyHint>Nenhum veículo com compra no período.</EmptyHint> : selectedRows.length ? <ScrollTable head={<>{['Peça / descrição', 'Fornecedor', 'Veículo / placa', 'Entrada', 'Saída / utilização', 'Status', 'Valor do lançamento'].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</>}>
                        {selectedRows.map((row, index) => <TableRow key={row.key} className={view === 'caras' && index === 0 ? 'bg-green-100 font-semibold' : ''}><TableCell className="min-w-[160px] max-w-[300px] whitespace-normal">{view === 'caras' && <span className="mr-2 text-green-700">{index + 1}º</span>}{row.peca || 'Não informada'}{row.tipo && <span className="block text-xs text-muted-foreground">{row.tipo}</span>}</TableCell><TableCell>{row.fornecedor || 'Não informado'}</TableCell><TableCell>{row.placa || 'Sem veículo definido'}</TableCell><TableCell className="whitespace-nowrap">{row.entryDate ? formatDate(row.entryDate) : 'Não informada'}</TableCell><TableCell className="whitespace-nowrap">{row.exitDate ? formatDate(row.exitDate) : '—'}</TableCell><TableCell><Badge variant="outline" className={row.status === 'Em estoque' ? 'border-green-300 text-green-800 bg-green-50' : ''}>{row.status}</Badge></TableCell><TableCell className="text-right whitespace-nowrap font-semibold">{formatFinanceBRL(row.amountCents)}</TableCell></TableRow>)}
                    </ScrollTable> : <EmptyHint>Nenhum lançamento nesta seleção.</EmptyHint>}
                    <div className="rounded-lg bg-white border border-green-200 p-3 text-right font-semibold text-green-950">{view === 'veiculos' ? 'Total vinculado aos veículos' : view === 'caras' ? 'Total das 10 maiores compras' : view === 'estoque' ? 'Valor conhecido em estoque' : 'Total conhecido no período'}: {formatFinanceBRL(view === 'veiculos' ? result.vehicles.reduce((sum, row) => sum + row.amountCents, 0) : selectedTotal)}</div>
                </div>
            </>}
        </section>
    );
}

function ManutencaoView({ data, filters, search, filterOptions, onFilterChange }) {
    const [typeFilter, setTypeFilter] = useState('all');
    const activeVehicleKeys = useMemo(() => getActiveVehicleKeys(data), [data.veiculos, data.documentacao]);
    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return data.manutencao.filter((r) => {
            const rowDate = (r.dataChamado || '').slice(0, 10);
            if (filters.periodStart && rowDate < filters.periodStart) return false;
            if (filters.periodEnd && rowDate > filters.periodEnd) return false;
            if (filters.projeto !== 'all' && r.projeto !== filters.projeto) return false;
            if (filters.placa !== 'all' && r.placa !== filters.placa) return false;
            if (!matchesVehicleStatus(r.placa, filters.statusVeiculo, activeVehicleKeys)) return false;
            if (filters.tipoManutencao !== 'all' && r.tipo !== filters.tipoManutencao) return false;
            if (filters.servico !== 'all' && maintenanceService(r) !== filters.servico) return false;
            if (typeFilter !== 'all' && r.tipo !== typeFilter) return false;
            if (q) {
                const blob = `${r.placa} ${r.veiculo} ${r.descricao} ${r.peca} ${r.categoria} ${r.fornecedor}`.toLowerCase();
                if (!blob.includes(q)) return false;
            }
            return true;
        });
    }, [data.manutencao, filters, search, typeFilter, activeVehicleKeys]);
    const visibleRows = rows;
    const scheduledPending = useMemo(() => {
        const q = search.trim().toLowerCase();
        return data.manutencao
            .filter(isScheduledPending)
            .filter((r) => filters.projeto === 'all' || r.projeto === filters.projeto)
            .filter((r) => filters.placa === 'all' || r.placa === filters.placa)
            .filter((r) => matchesVehicleStatus(r.placa, filters.statusVeiculo, activeVehicleKeys))
            .filter((r) => filters.tipoManutencao === 'all' || r.tipo === filters.tipoManutencao)
            .filter((r) => filters.servico === 'all' || maintenanceService(r) === filters.servico)
            .filter((r) => !q || `${r.placa} ${r.veiculo} ${r.projeto} ${r.descricao} ${r.fornecedor}`.toLowerCase().includes(q))
            .sort((a, b) => String(a.dataPrevista || '').localeCompare(String(b.dataPrevista || '')));
    }, [data.manutencao, filters.projeto, filters.placa, filters.statusVeiculo, filters.tipoManutencao, filters.servico, search, activeVehicleKeys]);

    const kpis = useMemo(() => {
        const valor = rows.reduce((s, r) => s + (r.custoTotal ?? r.valor ?? 0), 0);
        const dias = rows.reduce((s, r) => s + (r.diasParados || 0), 0);
        const porTipo = { Preventiva: 0, Corretiva: 0, Outros: 0 };
        rows.forEach((r) => { porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1; });
        return { valor, dias, count: rows.length, porTipo };
    }, [rows]);

    const porTipoValor = useMemo(() => {
        const map = { Preventiva: 0, Corretiva: 0, Outros: 0 };
        rows.forEach((r) => { map[r.tipo] += (r.custoTotal ?? r.valor ?? 0); });
        return Object.entries(map).map(([name, value]) => ({ name, value }));
    }, [rows]);

    const porVeiculo = useMemo(() => {
        const map = {};
        rows.forEach((r) => {
            const k = `${r.placa} ${r.veiculo}`.trim();
            if (!map[k]) map[k] = { veiculo: k, valor: 0, count: 0 };
            map[k].valor += (r.custoTotal ?? r.valor ?? 0);
            map[k].count += 1;
        });
        return Object.values(map).sort((a, b) => b.valor - a.valor).slice(0, 10);
    }, [rows]);

    return (
        <section className="flex flex-col gap-5">
            <Card className="p-4 flex flex-wrap items-end gap-3 bg-[#f8fcf9] border-[#cfe8d5]">
                <div className="w-full text-sm font-semibold text-[#1f6b3d]">Filtros de manutenção</div>
                <FilterSelect label="Projeto" value={filters.projeto} onChange={(v) => onFilterChange('projeto', v)} options={filterOptions.projetos} />
                <FilterSelect label="Tipo de manutenção" value={filters.tipoManutencao} onChange={(v) => onFilterChange('tipoManutencao', v)} options={filterOptions.tiposManutencao} />
                <FilterSelect label="Tipo de serviço" value={filters.servico} onChange={(v) => onFilterChange('servico', v)} options={filterOptions.servicos} />
                <FilterSelect label="Placa / Veículo" value={filters.placa} onChange={(v) => onFilterChange('placa', v)} options={filterOptions.placas} />
                <FilterSelect label="Status do veículo" value={filters.statusVeiculo} onChange={(v) => onFilterChange('statusVeiculo', v)} options={['ativos', 'inativos']} format={(value) => value === 'ativos' ? 'Veículos ativos' : 'Veículos inativos'} />
                {(filters.periodStart || filters.periodEnd) && <Badge variant="outline" className="h-9 items-center border-[#b7d5c0] text-[#1f6b3d]">Período: {filters.periodStart || 'início'} até {filters.periodEnd || 'fim'}</Badge>}
            </Card>
            {scheduledPending.length > 0 && (
                <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                    <div className="flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4" />Manutenções agendadas e não realizadas ({scheduledPending.length})</div>
                    <ScrollTable head={
                        <>{['Data prevista', 'Placa', 'Veículo', 'Projeto', 'Serviço', 'Responsável', 'Fornecedor', 'Prazo'].map((h) => <TableHead key={h}>{h}</TableHead>)}</>
                    }>
                        {scheduledPending.map((r) => {
                            const overdue = r.dataPrevista && r.dataPrevista < today();
                            return (
                                <TableRow key={`${r.id}-${r.placa}`}>
                                    <TableCell className="whitespace-nowrap text-xs">{r.dataPrevista ? formatDate(r.dataPrevista) : '—'}</TableCell>
                                    <TableCell className="font-mono text-xs">{r.placa}</TableCell>
                                    <TableCell className="text-xs">{r.veiculo}</TableCell>
                                    <TableCell className="text-xs">{r.projeto}</TableCell>
                                    <TableCell className="text-xs max-w-[260px] truncate" title={r.descricao}>{r.descricao}</TableCell>
                                    <TableCell className="text-xs">{r.responsavel || '—'}</TableCell>
                                    <TableCell className="text-xs">{r.fornecedor || '—'}</TableCell>
                                    <TableCell><Badge variant="outline" className={overdue ? 'border-red-400 bg-red-50 text-red-700' : 'border-amber-400 bg-white text-amber-800'}>{overdue ? 'ATRASADA' : 'AGENDADA'}</Badge></TableCell>
                                </TableRow>
                            );
                        })}
                    </ScrollTable>
                </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <KpiCard label="Chamados" value={NUM(kpis.count)} />
                <KpiCard label="Custo total" value={BRL(kpis.valor)} accent="text-foreground" />
                <KpiCard label="Preventiva" value={NUM(kpis.porTipo.Preventiva)} accent="text-blue-600" active={typeFilter === 'Preventiva'} onClick={() => setTypeFilter((value) => value === 'Preventiva' ? 'all' : 'Preventiva')} />
                <KpiCard label="Corretiva" value={NUM(kpis.porTipo.Corretiva)} accent="text-red-600" active={typeFilter === 'Corretiva'} onClick={() => setTypeFilter((value) => value === 'Corretiva' ? 'all' : 'Corretiva')} />
                <KpiCard label="Dias parados" value={NUM(kpis.dias)} />
            </div>
            <ActiveFilter label={typeFilter === 'all' ? '' : `Manutenção ${typeFilter}`} onClear={() => setTypeFilter('all')} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Custo por tipo de manutenção">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={porTipoValor} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                                {porTipoValor.map((e) => <Cell key={e.name} fill={TIPO_COLORS[e.name]} />)}
                            </Pie>
                            <Tooltip formatter={(v) => BRL(v)} />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </ChartCard>
                <ChartCard title="Custo por veículo (top 10)">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={porVeiculo} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="veiculo" tick={{ fontSize: 10 }} width={130} />
                            <Tooltip formatter={(v) => BRL(v)} />
                            <Bar dataKey="valor" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>
            <MaintenancePartsPanel data={data} filters={filters} search={search} />
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">Histórico de manutenção</h3>
                {visibleRows.length === 0 ? <EmptyHint>Nenhum registro de manutenção para os filtros selecionados.</EmptyHint> : (
                    <ScrollTable head={
                        <>{['Placa', 'Veículo', 'Projeto', 'Tipo', 'Descrição', 'Peça', 'Abertura', 'Conclusão', 'Dias parado', 'Valor', 'Status'].map((h) => <TableHead key={h}>{h}</TableHead>)}</>
                    }>
                        {visibleRows.slice(0, 200).map((r, i) => (
                            <TableRow key={i}>
                                <TableCell className="font-mono text-xs">{r.placa}</TableCell>
                                <TableCell className="text-xs">{r.veiculo}</TableCell>
                                <TableCell className="text-xs">{r.projeto}</TableCell>
                                <TableCell><span className="text-xs font-medium" style={{ color: TIPO_COLORS[r.tipo] }}>{r.tipo}</span></TableCell>
                                <TableCell className="text-xs max-w-[220px] truncate" title={r.descricao}>{r.descricao}</TableCell>
                                <TableCell className="text-xs">{r.peca}</TableCell>
                                <TableCell className="whitespace-nowrap text-xs">{r.dataChamado ? formatDate(r.dataChamado, 'pt-BR') : '—'}</TableCell>
                                <TableCell className="whitespace-nowrap text-xs">{r.dataConclusao ? formatDate(r.dataConclusao, 'pt-BR') : '—'}</TableCell>
                                <TableCell className="text-right">{r.diasParados != null ? NUM(r.diasParados) : '—'}</TableCell>
                                <TableCell className="text-right font-medium">{BRL(r.custoTotal ?? r.valor)}</TableCell>
                                <TableCell><Badge variant="outline" className="text-xs">{r.status || '—'}</Badge></TableCell>
                            </TableRow>
                        ))}
                    </ScrollTable>
                )}
            </div>
        </section>
    );
}

function DocumentacaoView({ data, filters, search }) {
    const [statusFilter, setStatusFilter] = useState('all');
    const activeVehicleKeys = useMemo(() => getActiveVehicleKeys(data), [data.veiculos, data.documentacao]);
    const identifierByPlate = useMemo(() => new Map(
        (data.veiculos || []).map((vehicle) => [vehicleKey(vehicle.placa), String(vehicle.identificador || '').trim()]),
    ), [data.veiculos]);
    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return data.documentacao.filter((r) => {
            if (filters.placa !== 'all' && r.placa !== filters.placa) return false;
            if (!matchesVehicleStatus(r.placa, filters.statusVeiculo, activeVehicleKeys)) return false;
            if (q) {
                const identificador = identifierByPlate.get(vehicleKey(r.placa)) || '';
                const blob = `${r.placa} ${identificador} ${r.veiculo} ${r.documento} ${r.status}`.toLowerCase();
                if (!blob.includes(q)) return false;
            }
            return true;
        });
    }, [data.documentacao, filters, search, identifierByPlate, activeVehicleKeys]);
    const visibleRows = useMemo(() => statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter), [rows, statusFilter]);

    const porStatus = useMemo(() => {
        const map = { OK: 0, 'A vencer': 0, Atrasada: 0, Pendente: 0 };
        rows.forEach((r) => { map[r.status] = (map[r.status] || 0) + 1; });
        return Object.entries(map).map(([name, value]) => ({ name, value }));
    }, [rows]);

    const counts = useMemo(() => {
        const c = { OK: 0, 'A vencer': 0, Atrasada: 0, Pendente: 0 };
        rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
        return c;
    }, [rows]);

    return (
        <section className="flex flex-col gap-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="OK" value={NUM(counts.OK)} accent="text-green-600" active={statusFilter === 'OK'} onClick={() => setStatusFilter((value) => value === 'OK' ? 'all' : 'OK')} />
                <KpiCard label="A vencer" value={NUM(counts['A vencer'])} accent="text-amber-600" active={statusFilter === 'A vencer'} onClick={() => setStatusFilter((value) => value === 'A vencer' ? 'all' : 'A vencer')} />
                <KpiCard label="Atrasada" value={NUM(counts.Atrasada)} accent="text-red-600" active={statusFilter === 'Atrasada'} onClick={() => setStatusFilter((value) => value === 'Atrasada' ? 'all' : 'Atrasada')} />
                <KpiCard label="Pendente / s/data" value={NUM(counts.Pendente)} accent="text-slate-600" active={statusFilter === 'Pendente'} onClick={() => setStatusFilter((value) => value === 'Pendente' ? 'all' : 'Pendente')} />
            </div>
            <ActiveFilter label={statusFilter === 'all' ? '' : `Documentação ${statusFilter}`} onClear={() => setStatusFilter('all')} />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <ChartCard title="Documentos por situação">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={porStatus} dataKey="value" nameKey="name" innerRadius={45} outerRadius={85} paddingAngle={2}>
                                {porStatus.map((e) => <Cell key={e.name} fill={STATUS_COLORS[e.name]} />)}
                            </Pie>
                            <Tooltip />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </ChartCard>
                <Card className="p-4 lg:col-span-2 flex flex-col gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Cadastros</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <InfoLine label="Veículos cadastrados" value={NUM(data.veiculos.length)} />
                        <InfoLine label="Motoristas (CNH)" value={NUM(data.motoristas.length)} />
                        <InfoLine label="Documentos monitorados" value={NUM(visibleRows.length)} />
                        <InfoLine label="Avisos de vencimento" value={NUM(data.documentacao.length)} />
                    </div>
                    <div className="mt-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Motoristas — situação da CNH</h4>
                        <div className="flex flex-col gap-1 max-h-40 overflow-auto">
                            {data.motoristas.length === 0 && <span className="text-xs text-muted-foreground">Sem motoristas cadastrados.</span>}
                            {data.motoristas.map((m, i) => (
                                <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border/60 last:border-0">
                                    <span>{m.nome}</span>
                                    <span className="flex items-center gap-2">
                                        <span className="text-muted-foreground">{m.vencimento ? formatDate(m.vencimento, 'pt-BR') : 's/data'}</span>
                                        <Badge variant="outline" className="text-xs">{m.situacao || '—'}</Badge>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>
            </div>
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">Avisos de vencimento por documento</h3>
                {visibleRows.length === 0 ? <EmptyHint>Nenhum documento para os filtros selecionados.</EmptyHint> : (
                    <ScrollTable head={
                        <>{['Placa', 'TAG / identificador', 'Veículo', 'Documento', 'Vencimento', 'Dias restantes', 'Situação'].map((h) => <TableHead key={h}>{h}</TableHead>)}</>
                    }>
                        {visibleRows.slice(0, 300).map((r, i) => (
                            <TableRow key={i}>
                                <TableCell className="font-mono text-xs">{r.placa}</TableCell>
                                <TableCell className="font-mono text-xs">{identifierByPlate.get(vehicleKey(r.placa)) || '—'}</TableCell>
                                <TableCell className="text-xs">{r.veiculo}</TableCell>
                                <TableCell className="text-xs">{r.documento}</TableCell>
                                <TableCell className="whitespace-nowrap text-xs">{r.vencimento ? formatDate(r.vencimento, 'pt-BR') : '—'}</TableCell>
                                <TableCell className="text-right text-xs">{r.diasRestantes != null ? NUM(r.diasRestantes) : '—'}</TableCell>
                                <TableCell><StatusBadge status={r.status} /></TableCell>
                            </TableRow>
                        ))}
                    </ScrollTable>
                )}
            </div>
        </section>
    );
}

function InfoLine({ label, value }) {
    return (
        <div className="flex items-center justify-between border-b border-border/60 pb-1">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-semibold">{value}</span>
        </div>
    );
}

function PneusView({ data, filters, search }) {
    const activeVehicleKeys = useMemo(() => getActiveVehicleKeys(data), [data.veiculos, data.documentacao]);
    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return data.pneus.filter((r) => {
            if (filters.placa !== 'all' && r.placa !== filters.placa) return false;
            if (!matchesVehicleStatus(r.placa, filters.statusVeiculo, activeVehicleKeys)) return false;
            if (q) {
                const blob = `${r.placa} ${r.veiculo} ${r.modelo} ${r.situacao}`.toLowerCase();
                if (!blob.includes(q)) return false;
            }
            return true;
        });
    }, [data.pneus, filters, search, activeVehicleKeys]);

    const kpis = useMemo(() => {
        const qtde = rows.reduce((s, r) => s + (r.qtde || 0), 0);
        const custo = rows.reduce((s, r) => s + (r.custoTotalAgromig ?? (r.valorUnit ?? 0) * (r.qtde || 0)), 0);
        const modelos = new Set(rows.map((r) => r.modelo).filter(Boolean));
        return { qtde, custo, modelos: modelos.size, count: rows.length };
    }, [rows]);

    return (
        <section className="flex flex-col gap-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="Pneus em uso" value={NUM(kpis.qtde)} />
                <KpiCard label="Custo total (Agromig)" value={BRL(kpis.custo)} accent="text-foreground" />
                <KpiCard label="Modelos distintos" value={NUM(kpis.modelos)} />
                <KpiCard label="Veículos com pneus" value={NUM(kpis.count)} />
            </div>
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">Controle de pneus por veículo</h3>
                {rows.length === 0 ? <EmptyHint>Nenhum pneu cadastrado para os filtros selecionados.</EmptyHint> : (
                    <ScrollTable head={
                        <>{['Placa', 'Veículo', 'Modelo/Medida', 'Qtde', 'Valor unit.', 'Custo total', 'KM atual', 'KM última troca', 'Rodado desde troca', 'Próx. troca (KM)', 'Situação'].map((h) => <TableHead key={h}>{h}</TableHead>)}</>
                    }>
                        {rows.map((r, i) => (
                            <TableRow key={i}>
                                <TableCell className="font-mono text-xs">{r.placa}</TableCell>
                                <TableCell className="text-xs">{r.veiculo}</TableCell>
                                <TableCell className="text-xs max-w-[200px] truncate" title={r.modelo}>{r.modelo || '—'}</TableCell>
                                <TableCell className="text-right">{r.qtde != null ? NUM(r.qtde) : '—'}</TableCell>
                                <TableCell className="text-right">{r.valorUnit != null ? BRL(r.valorUnit) : '—'}</TableCell>
                                <TableCell className="text-right font-medium">{r.custoTotalAgromig != null ? BRL(r.custoTotalAgromig) : (r.valorUnit != null && r.qtde ? BRL(r.valorUnit * r.qtde) : '—')}</TableCell>
                                <TableCell className="text-right">{r.leituraAtual != null ? NUM(r.leituraAtual) : '—'}</TableCell>
                                <TableCell className="text-right">{r.leituraUltTroca != null ? NUM(r.leituraUltTroca) : '—'}</TableCell>
                                <TableCell className="text-right">{r.rodadoDesdeTroca != null ? NUM(r.rodadoDesdeTroca) : '—'}</TableCell>
                                <TableCell className="text-right">{r.proximaTroca != null ? NUM(r.proximaTroca) : '—'}</TableCell>
                                <TableCell><Badge variant="outline" className="text-xs">{r.situacao || '—'}</Badge></TableCell>
                            </TableRow>
                        ))}
                    </ScrollTable>
                )}
            </div>
        </section>
    );
}

function KmView({ data, filters, search }) {
    const [franquiaFilter, setFranquiaFilter] = useState('all');
    const activeVehicleKeys = useMemo(() => getActiveVehicleKeys(data), [data.veiculos, data.documentacao]);
    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return data.kmRodado.filter((r) => {
            if (filters.placa !== 'all' && r.placa !== filters.placa) return false;
            if (!matchesVehicleStatus(r.placa, filters.statusVeiculo, activeVehicleKeys)) return false;
            if (q) {
                const blob = `${r.placa} ${r.veiculo} ${r.situacao}`.toLowerCase();
                if (!blob.includes(q)) return false;
            }
            return true;
        });
    }, [data.kmRodado, filters, search, activeVehicleKeys]);
    const visibleRows = useMemo(() => franquiaFilter === 'all' ? rows : rows.filter((r) => franquiaFilter === 'ultrapassou' ? r.ultrapassou : !r.ultrapassou), [rows, franquiaFilter]);

    const kpis = useMemo(() => {
        const totalKm = rows.reduce((s, r) => s + (r.kmMes || 0), 0);
        const totalFranquia = rows.reduce((s, r) => s + (r.franquia || 0), 0);
        const totalDentroFranquia = rows.reduce((s, r) => s + Math.max((r.franquia || 0) - (r.kmMes || 0), 0), 0);
        const ultrapassou = rows.filter((r) => r.ultrapassou).length;
        return { totalKm, totalFranquia, totalDentroFranquia, ultrapassou, count: rows.length };
    }, [rows]);

    const chartData = useMemo(() => rows.map((r) => ({
        veiculo: `${r.placa}`,
        km: r.kmMes || 0,
        franquia: r.franquia || 0,
    })).sort((a, b) => b.km - a.km), [rows]);

    return (
        <section className="flex flex-col gap-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <KpiCard label="Veículos" value={NUM(kpis.count)} />
                <KpiCard label="KM rodado (mês)" value={NUM(kpis.totalKm)} />
                <KpiCard label="Franquia total" value={NUM(kpis.totalFranquia)} />
                <KpiCard label="Dentro da franquia" value={NUM(kpis.totalDentroFranquia)} accent="text-green-600" active={franquiaFilter === 'dentro'} onClick={() => setFranquiaFilter((value) => value === 'dentro' ? 'all' : 'dentro')} />
                <KpiCard label="Ultrapassaram" value={NUM(kpis.ultrapassou)} accent="text-amber-600" active={franquiaFilter === 'ultrapassou'} onClick={() => setFranquiaFilter((value) => value === 'ultrapassou' ? 'all' : 'ultrapassou')} />
            </div>
            <ActiveFilter label={franquiaFilter === 'dentro' ? 'Dentro da franquia' : franquiaFilter === 'ultrapassou' ? 'Ultrapassaram a franquia' : ''} onClear={() => setFranquiaFilter('all')} />
            <ChartCard title="KM rodado vs franquia por veículo" height={320}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="veiculo" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11 }} width={48} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="franquia" name="Franquia" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="km" name="KM rodado" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </ChartCard>
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">Controle mensal de KM</h3>
                {visibleRows.length === 0 ? <EmptyHint>Nenhum registro de KM para os filtros selecionados.</EmptyHint> : (
                    <ScrollTable head={
                        <>{['Placa', 'Veículo', 'KM rodado', 'Franquia', 'Dentro da franquia', 'Situação', 'Unidade'].map((h) => <TableHead key={h}>{h}</TableHead>)}</>
                    }>
                        {visibleRows.map((r, i) => (
                            <TableRow key={i}>
                                <TableCell className="font-mono text-xs">{r.placa}</TableCell>
                                <TableCell className="text-xs">{r.veiculo}</TableCell>
                                <TableCell className="text-right font-medium">{NUM(r.kmMes)}</TableCell>
                                <TableCell className="text-right">{NUM(r.franquia)}</TableCell>
                                <TableCell className="text-right">
                                    {r.excesso != null ? (
                                        <span className={r.excesso > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>{r.excesso > 0 ? 'Ultrapassou ' : ''}{NUM(Math.max(-r.excesso, 0))}</span>
                                    ) : '—'}
                                </TableCell>
                                <TableCell><Badge variant="outline" className={cn('text-xs', r.ultrapassou && 'border-amber-400 text-amber-700')}>{r.situacao || '—'}</Badge></TableCell>
                                <TableCell className="text-xs">{r.unidade}</TableCell>
                            </TableRow>
                        ))}
                    </ScrollTable>
                )}
            </div>
        </section>
    );
}

function UtilizacaoView({ data, filters, search }) {
    const activeVehicleKeys = useMemo(() => getActiveVehicleKeys(data), [data.veiculos, data.documentacao]);
    const rows = useMemo(() => {
        const kmByPlate = new Map((data.kmRodado || []).map((row) => [vehicleKey(row.placa), row]));
        const source = Array.isArray(data.utilizacao) && data.utilizacao.length
            ? data.utilizacao
            : (data.veiculos || []).map((vehicle) => {
                const km = kmByPlate.get(vehicleKey(vehicle.placa)) || {};
                return {
                    placa: vehicle.placa, veiculo: vehicle.veiculo, projeto: vehicle.projeto,
                    unidade: vehicle.unidade, leituraAtual: km.kmMes, situacaoKm: km.situacao,
                    motorista: km.motorista || '',
                };
            });
        const q = search.trim().toLowerCase();
        return source.filter((row) => {
            if (filters.projeto !== 'all' && row.projeto !== filters.projeto) return false;
            if (filters.placa !== 'all' && row.placa !== filters.placa) return false;
            if (!matchesVehicleStatus(row.placa, filters.statusVeiculo, activeVehicleKeys)) return false;
            if (q && !`${row.placa} ${row.veiculo} ${row.projeto} ${row.motorista}`.toLowerCase().includes(q)) return false;
            return row.placa;
        }).sort((a, b) => String(a.placa).localeCompare(String(b.placa), 'pt-BR'));
    }, [data.utilizacao, data.kmRodado, data.veiculos, filters, search, activeVehicleKeys]);

    const kpis = useMemo(() => {
        const withDriver = rows.filter((row) => String(row.motorista || '').trim()).length;
        const drivers = new Set(rows.map((row) => String(row.motorista || '').trim()).filter(Boolean));
        const totalReading = rows.reduce((sum, row) => sum + (Number(row.leituraAtual) || 0), 0);
        return { vehicles: rows.length, withDriver, withoutDriver: rows.length - withDriver, drivers: drivers.size, totalReading };
    }, [rows]);

    const chartData = useMemo(() => rows
        .filter((row) => Number.isFinite(Number(row.leituraAtual)))
        .map((row) => ({ placa: row.placa, leitura: Number(row.leituraAtual) || 0 }))
        .sort((a, b) => b.leitura - a.leitura)
        .slice(0, 15), [rows]);

    return (
        <section className="flex flex-col gap-5">
            <div className="flex items-start gap-3 rounded-lg border border-[#b7d5c0] bg-[#f3fbf5] p-3 text-sm text-[#285b3b]">
                <UsersRound className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                    <p className="font-semibold">Motorista/usuário por placa</p>
                    <p className="text-xs text-[#486653]">A associação é lida primeiro da coluna “FA” e, se estiver vazia, da coluna “MOTORISTA (USUÁRIO)” da aba KM Semanal. Quando não houver lançamento, o veículo aparece como “Não informado”.</p>
                </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <KpiCard label="Veículos" value={NUM(kpis.vehicles)} />
                <KpiCard label="Com motorista" value={NUM(kpis.withDriver)} accent="text-green-600" />
                <KpiCard label="Sem motorista" value={NUM(kpis.withoutDriver)} accent={kpis.withoutDriver ? 'text-amber-600' : 'text-green-600'} />
                <KpiCard label="Motoristas distintos" value={NUM(kpis.drivers)} />
                <KpiCard label="Leitura total" value={NUM(kpis.totalReading)} />
            </div>
            {chartData.length > 0 && (
                <ChartCard title="Leitura atual por veículo (maiores leituras)" height={300}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 36, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="placa" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={58} />
                            <YAxis tick={{ fontSize: 11 }} width={52} />
                            <Tooltip formatter={(value) => NUM(value)} />
                            <Bar dataKey="leitura" name="Leitura atual" fill="#1f7a46" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            )}
            {rows.length === 0 ? <EmptyHint>Nenhum veículo encontrado para os filtros selecionados.</EmptyHint> : (
                <ScrollTable head={<>{['Placa', 'Veículo', 'Projeto', 'Motorista / usuário', 'Leitura atual', 'Unidade', 'Situação KM'].map((h) => <TableHead key={h}>{h}</TableHead>)}</>}>
                    {rows.map((row) => (
                        <TableRow key={row.placa}>
                            <TableCell className="font-mono text-xs">{row.placa}</TableCell>
                            <TableCell className="text-xs">{row.veiculo || '—'}</TableCell>
                            <TableCell className="text-xs">{row.projeto || '—'}</TableCell>
                            <TableCell>
                                {row.motorista ? <Badge className="bg-[#1f7a46] hover:bg-[#1f7a46]">{row.motorista}</Badge> : <Badge variant="outline" className="border-amber-300 text-amber-700">Não informado</Badge>}
                            </TableCell>
                            <TableCell className="text-right">{row.leituraAtual != null && row.leituraAtual !== '' ? NUM(row.leituraAtual) : '—'}</TableCell>
                            <TableCell className="text-xs">{row.unidade || '—'}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{row.situacaoKm || '—'}</Badge></TableCell>
                        </TableRow>
                    ))}
                </ScrollTable>
            )}
        </section>
    );
}

function EvidenciasView({ data, filters, search }) {
    const activeVehicleKeys = useMemo(() => getActiveVehicleKeys(data), [data.veiculos, data.documentacao]);
    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (data.evidencias || []).filter((r) => {
            if (filters.periodStart && r.data < filters.periodStart) return false;
            if (filters.periodEnd && r.data > filters.periodEnd) return false;
            if (filters.projeto !== 'all' && r.projeto !== filters.projeto) return false;
            if (filters.placa !== 'all' && r.placa !== filters.placa) return false;
            if (!matchesVehicleStatus(r.placa, filters.statusVeiculo, activeVehicleKeys)) return false;
            if (q && !`${r.tipo} ${r.placa} ${r.veiculo} ${r.projeto} ${r.descricao} ${r.arquivo}`.toLowerCase().includes(q)) return false;
            return true;
        }).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    }, [data.evidencias, filters, search, activeVehicleKeys]);
    return (
        <section className="flex flex-col gap-4">
            <div>
                <h3 className="text-sm font-semibold">Notas fiscais e evidências</h3>
                <p className="text-xs text-muted-foreground">Arquivos anexados aos lançamentos de abastecimento e manutenção.</p>
            </div>
            {rows.length === 0 ? <EmptyHint>Nenhuma evidência encontrada para os filtros selecionados.</EmptyHint> : (
                <ScrollTable head={<>{['Data', 'Tipo', 'Placa / veículo', 'Projeto', 'Descrição', 'Arquivo'].map((h) => <TableHead key={h}>{h}</TableHead>)}</>}>
                    {rows.map((r) => (
                        <TableRow key={r.id || `${r.url}-${r.arquivo}`}>
                            <TableCell className="text-xs">{formatDate(r.data)}</TableCell>
                            <TableCell><Badge variant="outline">{r.tipo}</Badge></TableCell>
                            <TableCell className="text-xs"><span className="font-mono">{r.placa}</span><br />{r.veiculo}</TableCell>
                            <TableCell className="text-xs">{r.projeto || '—'}</TableCell>
                            <TableCell className="text-xs max-w-64">{r.descricao || '—'}</TableCell>
                            <TableCell><Button asChild size="sm" variant="outline" className="gap-1.5"><a href={r.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />{r.arquivo || 'Abrir anexo'}</a></Button></TableCell>
                        </TableRow>
                    ))}
                </ScrollTable>
            )}
        </section>
    );
}

const checklistValue = (row, fragments) => {
    const key = Object.keys(row || {}).find((candidate) => fragments.some((fragment) => searchKey(candidate).includes(fragment)));
    return key ? String(row[key] ?? '').trim() : '';
};
const checklistDriver = (row) => checklistValue(row, ['nome do condutor', 'nome_do_condutor', 'condutor', 'motorista']) || '—';
const checklistPlate = (row) => checklistValue(row, ['placas', 'placa']) || '—';
const checklistProject = (row) => checklistValue(row, ['projeto']) || '—';
const checklistHasIssue = (row) => Object.entries(row || {}).some(([key, value]) => {
    if (!value || ['created_at', 'uploaded_at', 'ec5_uuid', 'title'].includes(key)) return false;
    const normalized = searchKey(value);
    return normalized === 'nao' || normalized === 'inconforme' || normalized.includes('nao conforme');
});

function ChecklistView({ data, filters, search }) {
    const rows = useMemo(() => (data.checklist || []).filter((row) => {
        const date = String(row.created_at || row.uploaded_at || '').slice(0, 10);
        if (filters.periodStart && date < filters.periodStart) return false;
        if (filters.periodEnd && date > filters.periodEnd) return false;
        if (filters.projeto !== 'all' && checklistProject(row) !== filters.projeto) return false;
        if (filters.placa !== 'all' && checklistPlate(row) !== filters.placa) return false;
        const q = searchKey(search);
        return !q || searchKey(`${checklistDriver(row)} ${checklistPlate(row)} ${checklistProject(row)} ${row.title || ''}`).includes(q)
            || driverNameKey(checklistDriver(row)).includes(driverNameKey(search));
    }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))), [data.checklist, filters, search]);
    const issues = rows.filter(checklistHasIssue);
    const driverSummary = useMemo(() => {
        const names = (data.motoristas || []).map((row) => row.nome || row.motorista || row.name || checklistDriver(row)).map((value) => String(value || '').trim()).filter((value) => value && value !== '—');
        return summarizeChecklistDrivers(names, rows.map(checklistDriver));
    }, [data.motoristas, rows]);
    const { missingDrivers } = driverSummary;
    const checklistReady = data.checklistLoaded && !data.checklistLoading && !data.checklistError;
    return (
        <section className="flex flex-col gap-4">
            <div>
                <h3 className="text-sm font-semibold">Checklist de veículos e máquinas</h3>
                <p className="text-xs text-muted-foreground">Fonte: Epicollect5 · projeto checklist-de-veiculos-e-maquinas. Filtre por período, projeto, motorista ou veículo.</p>
            </div>
            {data.checklistLoading && <p role="status" className="flex items-center gap-2 text-sm text-[#1f7a46]"><Loader2 className="h-4 w-4 animate-spin" />Conferindo os checklists realizados…</p>}
            {data.checklistError && <Alert className="border-amber-300 bg-amber-50 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertTitle className="text-sm font-semibold">Não foi possível atualizar os checklists</AlertTitle><AlertDescription className="text-xs">{data.checklistError} {data.checklistLoaded ? 'Os registros abaixo são da última consulta concluída.' : 'A lista de motoristas pendentes será calculada quando a consulta terminar.'}</AlertDescription></Alert>}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="Checklists realizados" value={data.checklistLoaded ? NUM(rows.length) : '—'} accent="text-[#1f7a46]" />
                <KpiCard label="Motoristas que fizeram" value={data.checklistLoaded ? NUM(driverSummary.completedCount) : '—'} />
                <KpiCard label="Inconformidades" value={data.checklistLoaded ? NUM(issues.length) : '—'} accent={issues.length ? 'text-red-600' : 'text-[#1f7a46]'} />
                <KpiCard label="Motoristas pendentes" value={checklistReady ? NUM(missingDrivers.length) : '—'} accent={checklistReady && missingDrivers.length ? 'text-amber-600' : 'text-[#1f7a46]'} />
            </div>
            {checklistReady && missingDrivers.length > 0 && <Alert className="border-amber-300 bg-amber-50 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertTitle className="text-sm font-semibold">Motoristas sem checklist</AlertTitle><AlertDescription className="text-xs">{missingDrivers.join(' · ')}</AlertDescription></Alert>}
            {rows.length === 0 ? (checklistReady ? <EmptyHint>Nenhum checklist encontrado para os filtros selecionados.</EmptyHint> : null) : (
                <ScrollTable head={<>{['Data', 'Motorista', 'Placa / veículo', 'Projeto', 'Situação', 'Detalhes'].map((h) => <TableHead key={h}>{h}</TableHead>)}</>}>
                    {rows.map((row) => {
                        const issue = checklistHasIssue(row);
                        const date = row.created_at || row.uploaded_at;
                        return <TableRow key={row.ec5_uuid || `${date}-${checklistPlate(row)}`}>
                            <TableCell className="text-xs">{formatDate(date)}</TableCell>
                            <TableCell className="text-xs">{driverSummary.displayName(checklistDriver(row))}</TableCell>
                            <TableCell className="text-xs font-mono">{checklistPlate(row)}</TableCell>
                            <TableCell className="text-xs">{checklistProject(row)}</TableCell>
                            <TableCell><Badge className={issue ? 'bg-red-100 text-red-700 hover:bg-red-100' : 'bg-green-100 text-green-700 hover:bg-green-100'}>{issue ? 'Inconforme' : 'OK'}</Badge></TableCell>
                            <TableCell className="text-xs max-w-80">{issue ? Object.entries(row).filter(([, value]) => searchKey(value).includes('nao') || searchKey(value).includes('inconforme')).map(([key, value]) => `${key}: ${value}`).join(' · ') : 'Nenhuma resposta de inconformidade identificada'}</TableCell>
                        </TableRow>;
                    })}
                </ScrollTable>
            )}
        </section>
    );
}

function PendenciasView({ records, activeCount, onOpen }) {
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('Pendente');
    const [priorityFilter, setPriorityFilter] = useState('all');
    const [vehicleFilter, setVehicleFilter] = useState('');
    const [driverFilter, setDriverFilter] = useState('');
    const [dateFilter, setDateFilter] = useState('');

    const activeRecords = useMemo(() => records.filter((item) => item.status === 'Pendente'), [records]);
    const counts = useMemo(() => Object.fromEntries(Object.keys(PRIORITY_RANK).map((priority) => [priority, activeRecords.filter((item) => item.priority === priority).length])), [activeRecords]);
    const filtered = useMemo(() => records.filter((item) => {
        if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (priorityFilter !== 'all' && item.priority !== priorityFilter) return false;
        if (dateFilter && item.date !== dateFilter && item.dueDate !== dateFilter) return false;
        const vehicle = searchKey(vehicleFilter);
        const driver = searchKey(driverFilter);
        if (vehicle && !searchKey(`${item.plate} ${item.vehicle}`).includes(vehicle)) return false;
        if (driver && !searchKey(item.driver).includes(driver)) return false;
        return true;
    }), [records, categoryFilter, statusFilter, priorityFilter, vehicleFilter, driverFilter, dateFilter]);

    const clear = () => {
        setCategoryFilter('all'); setStatusFilter('Pendente'); setPriorityFilter('all');
        setVehicleFilter(''); setDriverFilter(''); setDateFilter('');
    };

    return (
        <section className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-lg font-semibold">Pendências da Frota</h3>
                    <p className="text-sm text-muted-foreground">Abastecimento inconforme, manutenção preventiva próxima do limite, documentação obrigatória e checklist do período mais recente.</p>
                </div>
                <Badge className={activeCount ? 'bg-red-600 px-3 py-1 hover:bg-red-600' : 'bg-[#1f7a46] px-3 py-1 hover:bg-[#1f7a46]'}>{activeCount} ativa(s)</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {Object.keys(PRIORITY_RANK).map((priority) => (
                    <KpiCard key={priority} label={priority} value={NUM(counts[priority] || 0)} accent={priority === 'Crítica' ? 'text-red-600' : priority === 'Urgente' ? 'text-orange-600' : priority === 'Prioridade' ? 'text-orange-700' : 'text-amber-600'} active={priorityFilter === priority} onClick={() => setPriorityFilter((value) => value === priority ? 'all' : priority)} />
                ))}
            </div>
            <Card className="p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><ListFilter className="h-4 w-4 text-[#1f7a46]" />Filtros de pendências</div>
                <div className="flex flex-wrap items-end gap-3">
                    <FilterSelect label="Categoria" value={categoryFilter} onChange={setCategoryFilter} options={['abastecimento', 'documentacao', 'manutencao', 'checklist']} format={(value) => ({ abastecimento: 'Abastecimento', documentacao: 'Documentação', manutencao: 'Manutenção', checklist: 'Checklist' }[value])} />
                    <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={['Pendente', 'Resolvida']} />
                    <FilterSelect label="Prioridade" value={priorityFilter} onChange={setPriorityFilter} options={Object.keys(PRIORITY_RANK)} />
                    <div className="flex flex-col gap-1"><label className="text-xs font-medium text-muted-foreground">Veículo / placa</label><Input value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} placeholder="Placa ou modelo" className="w-44" /></div>
                    <div className="flex flex-col gap-1"><label className="text-xs font-medium text-muted-foreground">Motorista</label><Input value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)} placeholder="Nome do motorista" className="w-44" /></div>
                    <div className="flex flex-col gap-1"><label className="text-xs font-medium text-muted-foreground">Data</label><Input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="w-40" /></div>
                    {(categoryFilter !== 'all' || statusFilter !== 'Pendente' || priorityFilter !== 'all' || vehicleFilter || driverFilter || dateFilter) && <Button variant="ghost" size="sm" onClick={clear} className="gap-1.5"><X className="h-4 w-4" />Limpar</Button>}
                </div>
            </Card>
            <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">Lista de pendências</h4><span className="text-xs text-muted-foreground">{filtered.length} registro(s)</span></div>
            {filtered.length === 0 ? <EmptyHint>{statusFilter === 'Resolvida' ? 'Nenhuma pendência resolvida registrada neste navegador.' : 'Nenhuma pendência encontrada para os filtros selecionados.'}</EmptyHint> : (
                <ScrollTable head={<>{['Categoria', 'Prioridade', 'Pendência', 'Veículo / placa', 'Motorista', 'Data', 'Status', 'Ação'].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</>}>
                    {filtered.slice(0, 500).map((item) => (
                        <TableRow key={item.key}>
                            <TableCell><Badge variant="outline" className="text-xs">{item.category === 'abastecimento' ? 'Abastecimento' : item.category === 'documentacao' ? 'Documentação' : item.category === 'manutencao' ? 'Manutenção' : 'Checklist'}</Badge></TableCell>
                            <TableCell><span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: PRIORITY_COLORS[item.priority] || '#64748b' }}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[item.priority] || '#64748b' }} />{item.priority}</span></TableCell>
                            <TableCell className="max-w-[270px] text-xs"><span className="block font-semibold">{item.title}</span><span className="block truncate text-muted-foreground" title={item.reason}>{item.reason}</span><span className="block truncate text-muted-foreground">{item.detail}</span></TableCell>
                            <TableCell className="text-xs"><span className="font-mono">{item.plate}</span><br />{item.vehicle}</TableCell>
                            <TableCell className="text-xs">{item.driver || '—'}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{item.date ? formatDate(item.date) : '—'}{item.dueDate && item.dueDate !== item.date ? <><br /><span className="text-muted-foreground">vence {formatDate(item.dueDate)}</span></> : null}</TableCell>
                            <TableCell><Badge variant={item.status === 'Resolvida' ? 'secondary' : 'outline'} className={item.status === 'Resolvida' ? 'text-green-700' : 'border-orange-300 text-orange-700'}>{item.status}</Badge></TableCell>
                            <TableCell><Button variant="outline" size="sm" className="gap-1.5 whitespace-nowrap" onClick={() => onOpen(item)}><ExternalLink className="h-3.5 w-3.5" />{item.actionLabel}</Button></TableCell>
                        </TableRow>
                    ))}
                </ScrollTable>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Pendências corrigidas deixam de contar no sino automaticamente e permanecem no histórico local deste navegador.</div>
        </section>
    );
}
