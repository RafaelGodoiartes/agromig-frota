import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import {
    Fuel, Wrench, FileCheck, Gauge, RefreshCw, AlertTriangle,
    Search, X, Info, Loader2, CalendarDays, ExternalLink, Truck, UsersRound, Plus,
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

const BRL = (v) => (v === null || v === undefined || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const NUM = (v, dec = 0) => (v === null || v === undefined || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: dec, minimumFractionDigits: 0 }));
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
    { id: 'abastecimento', label: 'Abastecimento', icon: Fuel },
    { id: 'manutencao', label: 'Manutenção', icon: Wrench },
    { id: 'documentacao', label: 'Documentação', icon: FileCheck },
    { id: 'km', label: 'KM Rodado', icon: Gauge },
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
    const [form, setForm] = useState({ data: today(), placa: '', projeto: '', motorista: '', item: 'Diesel S-10', posto: '', litros: '', precoLitro: '', km: '', observacoes: '', tipo: 'Preventiva', status: 'AGENDADO', dataPrevista: today(), dataConclusao: '', descricao: '', peca: '', valor: '', responsavel: '', fornecedor: '', folderUrl: '', pin: '' });
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
        const source = isFuel ? (data?.projetosAbastecimento || []) : masterVehicles.map((vehicle) => vehicle.projeto);
        return [...new Set(source.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }, [data, isFuel, masterVehicles]);
    const stations = useMemo(() => [...new Set([
        ...(data?.postos || []),
        ...(data?.abastecimento || []).map((r) => r.posto),
        ...extraStations,
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [data, extraStations]);
    const scheduledPending = useMemo(() => (data?.manutencao || [])
        .filter(isScheduledPending)
        .sort((a, b) => String(a.dataPrevista || '').localeCompare(String(b.dataPrevista || ''))), [data]);
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
            if (files.length > 5) throw new Error('Selecione no máximo 5 anexos.');
            if (files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) throw new Error('Os anexos devem somar no máximo 8 MB.');
            const attachments = isFuel ? [] : await Promise.all(files.map(fileAsBase64));
            const payload = isFuel
                ? { data: form.data, placa: form.placa, projeto: form.projeto, motorista: form.motorista, item: form.item, posto: form.posto, litros: form.litros, valor: form.valor, precoLitro: fuelUnitPrice, km: form.km, observacoes: form.observacoes, pin: form.pin }
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
                        <Field label="Combustível"><Select value={form.item} onValueChange={(v) => set('item', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Diesel S-10', 'Diesel S-500', 'Gasolina Comum', 'Etanol', 'ARLA'].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
                    <Field label="Posto"><div className="flex gap-2"><Select value={form.posto} onValueChange={(v) => set('posto', v)} required><SelectTrigger className="flex-1"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{stations.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="icon" title="Cadastrar novo posto" onClick={() => { setPostoMessage(''); setPostoDialogOpen(true); }}><Plus className="h-4 w-4" /></Button></div></Field>
                        <Field label="Litros"><Input inputMode="decimal" value={form.litros} onChange={(e) => set('litros', e.target.value)} required /></Field>
                        <Field label="Valor total do abastecimento (R$)"><Input inputMode="decimal" value={form.valor} onChange={(e) => set('valor', e.target.value)} placeholder="Ex.: 450,00" required /></Field>
                        <Field label="Preço por litro (calculado)"><Input value={fuelUnitPrice === null ? '' : fuelUnitPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} readOnly className="bg-muted/50" /></Field>
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

    const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
    const clearFilters = () => {
        setFilters({ periodStart: '', periodEnd: '', projeto: 'all', posto: 'all', placa: 'all', tipoManutencao: 'all', servico: 'all', statusVeiculo: 'all' });
        setSearch('');
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
                                src={`${import.meta.env.BASE_URL}agromig-logo.png`}
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
                        <Card className="p-4">
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
                        </Card>

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
                                    </button>
                                );
                            })}
                        </div>

                        {/* Tab content */}
                        {tab === 'abastecimento' && <AbastecimentoView data={data} filters={filters} search={search} />}
                        {tab === 'manutencao' && <ManutencaoView data={data} filters={filters} search={search} filterOptions={options} onFilterChange={setF} />}
                        {tab === 'documentacao' && <DocumentacaoView data={data} filters={filters} search={search} />}
                        {tab === 'km' && <KmView data={data} filters={filters} search={search} />}
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
    return !query || searchKey(`${row.placa} ${row.veiculo} ${row.item} ${row.posto} ${row.projeto}`).includes(query);
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

function AbastecimentoView({ data, filters, search }) {
    const [fuelFilter, setFuelFilter] = useState('all');
    const [projectFilter, setProjectFilter] = useState('all');
    const [monthFilter, setMonthFilter] = useState('all');
    const activeVehicleKeys = useMemo(() => getActiveVehicleKeys(data), [data.veiculos, data.documentacao]);
    const rows = useMemo(() => data.abastecimento
        .filter((row) => matchesFuelRow(row, filters, search))
        .filter((row) => {
            return matchesVehicleStatus(row.placa, filters.statusVeiculo, activeVehicleKeys);
        }), [data.abastecimento, filters, search, activeVehicleKeys]);
    const projectRows = useMemo(() => projectFilter === 'all' ? rows : rows.filter((row) => row.projeto === projectFilter), [rows, projectFilter]);
    const monthRows = useMemo(() => monthFilter === 'all' ? projectRows : projectRows.filter((row) => row.anoMes === monthFilter), [projectRows, monthFilter]);
    const visibleRows = useMemo(() => fuelFilter === 'postos' ? monthRows.filter((r) => r.posto) : monthRows, [monthRows, fuelFilter]);

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
                const limiteKmL = limiteKmLPorPlaca.get(key) || 20;
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
                            <Bar dataKey="valor" fill="#2563eb" radius={[4, 4, 0, 0]} />
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
                {visibleRows.length === 0 ? <EmptyHint>Nenhum abastecimento para os filtros selecionados.</EmptyHint> : (
                    <ScrollTable head={
                        <>{['Data', 'Placa', 'Veículo', 'KM', 'Projeto', 'Posto', 'Item', 'Litros', 'R$/L', 'Valor', 'Status'].map((h) => <TableHead key={h}>{h}</TableHead>)}</>
                    }>
                        {visibleRows.slice(0, 200).map((r, i) => (
                            <TableRow key={i}>
                                <TableCell className="whitespace-nowrap">{r.data ? formatDate(r.data, 'pt-BR') : '—'}</TableCell>
                                <TableCell className="font-mono text-xs">{r.placa}</TableCell>
                                <TableCell>{r.veiculo}</TableCell>
                                <TableCell className="text-right">{Number.isFinite(r.km) ? NUM(r.km, 1) : '—'}{r.kmEstimado && <span className="ml-1 text-[10px] text-amber-700" title="KM estimado pela média entre os lançamentos anterior e posterior">(média)</span>}</TableCell>
                                <TableCell className="text-xs">{r.projeto}</TableCell>
                                <TableCell className="text-xs">{r.posto}</TableCell>
                                <TableCell className="text-xs">{r.item}</TableCell>
                                <TableCell className="text-right">{NUM(r.litros, 2)}</TableCell>
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
