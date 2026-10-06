import React, { useEffect, useState } from 'react';
import { Tag, Download, Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { emptyVehicleTag, validateVehicleTag, vehicleTagDrawing, tagFaceSvg } from '@/lib/vehicleTag';

const fields = [
    ['plate', 'Placa', 'text', 10, 'Ex.: TCP6B43'], ['model', 'Modelo do veículo', 'text', 60, 'Ex.: STRADA'],
    ['identifier', 'Identificação AGR', 'text', 18, 'Ex.: AGR-038'], ['releasedBy', 'Liberado por', 'text', 60, 'Nome do responsável'],
    ['issueDate', 'Data de emissão da TAG', 'text', 10, 'DD/MM/AAAA'], ['lastReviewDate', 'Data da última revisão', 'text', 10, 'DD/MM/AAAA'],
    ['lastReviewKm', 'KM da última revisão', 'text', 15, 'Ex.: 30.000,5'], ['nextReviewKm', 'KM da próxima revisão / renovação da TAG', 'text', 15, 'Ex.: 40.000'],
];

export default function VehicleTagDialog() {
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(emptyVehicleTag);
    const [errors, setErrors] = useState({});
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [layout, setLayout] = useState('lado-a-lado');
    const [pdf, setPdf] = useState(null);
    useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url); }, [pdf]);
    const update = (key, value) => { setForm((old) => ({ ...old, [key]: value })); setPreview(null); setPdf(null); setMessage(''); setErrors((old) => ({ ...old, [key]: undefined })); };
    async function generate(download = false) {
        const result = validateVehicleTag(form); setErrors(result.errors); setMessage('');
        if (!result.valid) { setMessage('Confira os campos destacados antes de gerar a TAG.'); return; }
        setBusy(true);
        try {
            const { loadVehicleTagAssets, renderVehicleTagPdf } = await import('@/lib/vehicleTagPdf');
            const assets = await loadVehicleTagAssets(result.tag);
            const drawing = vehicleTagDrawing(result.tag, assets);
            const image = (commands) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tagFaceSvg(commands));
            setPreview({ front: image(drawing.front), back: image(drawing.back) });
            if (download) {
                const { jsPDF } = await import('jspdf');
                const blob = renderVehicleTagPdf(jsPDF, result.tag, assets, layout).output('blob');
                setPdf({ url: URL.createObjectURL(blob), name: `TAG_${result.tag.plate}_frente_verso.pdf` });
                setMessage('PDF pronto. Clique em “Baixar TAG em PDF” abaixo. Imprima em tamanho real (100%). Nenhum dado foi gravado na planilha.');
            }
        } catch (error) { setMessage(error.message || 'Não foi possível gerar a TAG. Tente novamente.'); }
        finally { setBusy(false); }
    }
    return <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button variant="outline" className="gap-2"><Tag className="h-4 w-4" />Criar TAG veicular</Button></DialogTrigger>
        <DialogContent className="max-w-[1100px] max-h-[92dvh] overflow-y-auto w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)]">
            <DialogHeader><DialogTitle>Criar TAG veicular - frente e verso</DialogTitle><DialogDescription>Preencha os dados manualmente. Este gerador não busca nem grava dados nas planilhas. O preenchimento fica somente nesta tela.</DialogDescription></DialogHeader>
            <div className="grid gap-6 lg:grid-cols-[1fr_1fr] min-w-0">
                <form className="space-y-4 min-w-0" onSubmit={(event) => { event.preventDefault(); generate(true); }} noValidate>
                    <fieldset disabled={busy} className="space-y-4 min-w-0">
                        <div><Label htmlFor="tag-company">Empresa na TAG</Label><Input id="tag-company" value={form.company} maxLength={80} onChange={(e) => update('company', e.target.value)} aria-invalid={!!errors.company} />{errors.company && <p className="text-sm text-red-700">{errors.company}</p>}</div>
                        <div><Label htmlFor="tag-type">Tipo de veículo</Label><select id="tag-type" value={form.vehicleType} onChange={(e) => update('vehicleType', e.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="veiculo">Veículo</option><option value="caminhao">Caminhão</option></select></div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            {fields.map(([key, label, type, maxLength, placeholder]) => <div key={key} className="min-w-0"><Label htmlFor={`tag-${key}`}>{label}</Label><Input id={`tag-${key}`} type={type} maxLength={maxLength} placeholder={placeholder} inputMode={key.endsWith('Km') ? 'decimal' : undefined} value={form[key]} onChange={(e) => update(key, e.target.value)} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `tag-error-${key}` : undefined} />{errors[key] && <p id={`tag-error-${key}`} className="text-sm text-red-700">{errors[key]}</p>}</div>)}
                        </div>
                        <div><Label htmlFor="tag-lastReview">Serviços realizados na última revisão (opcional)</Label><Input id="tag-lastReview" value={form.lastReview} maxLength={100} onChange={(e) => update('lastReview', e.target.value)} placeholder="Descreva somente o que foi realizado" /></div>
                        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-950"><strong>Na próxima revisão</strong><p>Revisão preventiva e troca do óleo.</p>{form.vehicleType === 'caminhao' && <p>Troca do fluido de freio (caminhão).</p>}</div>
                        <div><Label htmlFor="tag-observations">Observações (opcional)</Label><textarea id="tag-observations" value={form.observations} maxLength={220} onChange={(e) => update('observations', e.target.value)} className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
                        <div><Label htmlFor="tag-documentUrl">Link da pasta do veículo no Drive (opcional)</Label><Input id="tag-documentUrl" type="url" value={form.documentUrl} maxLength={500} onChange={(e) => update('documentUrl', e.target.value)} placeholder="https://drive.google.com/drive/folders/..." aria-invalid={!!errors.documentUrl} />{errors.documentUrl && <p className="text-sm text-red-700">{errors.documentUrl}</p>}<p className="mt-1 text-xs text-muted-foreground">O QR Code da nova TAG usará esta pasta e substituirá o QR do modelo. Sem link, não haverá QR Code. As permissões do Drive continuam iguais.</p></div>
                        <div><Label htmlFor="tag-layout">Formato do PDF</Label><select id="tag-layout" value={layout} onChange={(e) => { setLayout(e.target.value); setPdf(null); setMessage(''); }} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="lado-a-lado">A4: frente e verso lado a lado para recortar</option><option value="duplex">A4: páginas separadas para impressão frente e verso</option></select><p className="mt-1 text-xs text-muted-foreground">Cada face mede 10 x 15 cm. Imprima em 100%; no modo duplex, faça uma prova de alinhamento na sua impressora.</p></div>
                        <div className="flex flex-wrap gap-2"><Button variant="outline" type="button" onClick={() => generate(false)} className="gap-2"><Eye className="h-4 w-4" />Ver prévia</Button><Button type="submit" className="gap-2">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Gerar PDF</Button></div>
                    </fieldset>
                    {message && <p role="status" className="rounded-lg border bg-green-50 p-3 text-sm">{message}</p>}
                    {pdf && <Button asChild className="gap-2"><a href={pdf.url} download={pdf.name}><Download className="h-4 w-4" />Baixar TAG em PDF</a></Button>}
                </form>
                <section aria-label="Prévia da TAG" className="min-w-0 rounded-xl border bg-green-50/50 p-4">
                    <h3 className="font-semibold">Prévia da TAG</h3><p className="mb-4 text-sm text-muted-foreground">Mesmo modelo do arquivo enviado, com o controle de revisão no verso.</p>
                    {preview ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{[['front', 'Frente'], ['back', 'Verso']].map(([key, label]) => <figure key={key} className="min-w-0"><figcaption className="mb-2 text-center text-sm font-medium">{label}</figcaption><img src={preview[key]} alt={`TAG veicular - ${label.toLowerCase()}`} className="mx-auto h-auto w-full max-w-[330px] border border-green-700" /></figure>)}</div> : <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Preencha os campos e clique em “Ver prévia”. Não usamos os dados do veículo de exemplo nem informações da planilha.</p>}
                </section>
            </div>
        </DialogContent>
    </Dialog>;
}
