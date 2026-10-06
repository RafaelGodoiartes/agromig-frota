import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emptyVehicleTag, tagKm, tagDate, validateVehicleTag, tagServices, vehicleTagDrawing, tagFaceSvg, wrapTagText } from './vehicleTag.js';
import { renderVehicleTagPdf } from './vehicleTagPdf.js';
import { jsPDF } from 'jspdf';

export const sampleTag = () => ({ ...emptyVehicleTag(), plate: 'TCP6B43', model: 'STRADA', identifier: 'AGR-038', releasedBy: 'Responsável de teste', issueDate: '2026-10-06', lastReviewKm: '29.160,5', lastReviewDate: '2026-09-01', nextReviewKm: '39.160,5', lastReview: 'Revisão e troca do óleo', observations: 'Dados somente para teste local.' });

test('gerador começa sem veículo/revisão do modelo e aceita somente entradas manuais válidas', () => {
    const blank = emptyVehicleTag();
    for (const field of ['plate', 'model', 'identifier', 'releasedBy', 'issueDate', 'lastReviewKm', 'lastReviewDate', 'nextReviewKm', 'documentUrl']) assert.equal(blank[field], '');
    assert.equal(validateVehicleTag(blank).valid, false);
    const result = validateVehicleTag(sampleTag());
    assert.equal(result.valid, true); assert.equal(result.tag.lastReviewKm, 29160.5); assert.equal(result.tag.nextReviewKm, 39160.5);
    assert.equal(validateVehicleTag({ ...sampleTag(), plate: 'tcp-6b43' }).tag.plate, 'TCP6B43');
    assert.equal(validateVehicleTag({ ...sampleTag(), plate: 'ABC1234' }).valid, true);
});

test('datas, KM fracionado e sequência não permitem revisão inválida', () => {
    assert.equal(tagKm('0'), 0); assert.equal(tagKm('8,5'), 8.5); assert.equal(tagKm('12000.5'), 12000.5);
    assert.equal(tagKm('39.160'), 39160); assert.equal(tagKm('1.234.567,89'), 1234567.89);
    for (const value of ['', '-1', 'abc', 'NaN', '1e6', '1,2,3', '100000000']) assert.equal(tagKm(value), null);
    assert.equal(tagDate('2024-02-29'), '29/02/2024'); assert.equal(tagDate('2026-02-29'), null);
    assert.equal(tagDate('06/10/2026'), '06/10/2026'); assert.equal(tagDate('31/02/2026'), null);
    assert.equal(validateVehicleTag({ ...sampleTag(), issueDate: '06/10/2026', lastReviewDate: '01/09/2026' }).valid, true);
    for (const changes of [{ issueDate: '2026-13-01' }, { lastReviewDate: '2026-10-07' }, { lastReviewKm: '-1' }, { nextReviewKm: '1' }, { nextReviewKm: '29160.5' }, { plate: 'INVALIDA' }]) assert.equal(validateVehicleTag({ ...sampleTag(), ...changes }).valid, false);
});

test('fluido de freio aparece apenas no caminhão e não usa dados da planilha', () => {
    assert.equal(tagServices('veiculo').some(x => x.includes('freio')), false);
    assert.equal(tagServices('caminhao').some(x => x.includes('freio')), true);
    const drawing = vehicleTagDrawing({ ...sampleTag(), vehicleType: 'caminhao' });
    assert.match(drawing.back.filter(c => c.type === 'text').map(c => c.text).join(' '), /fluido de freio/);
    assert.doesNotMatch(vehicleTagDrawing(sampleTag()).back.map(c => c.text).join(' '), /fluido de freio/);
    assert.equal(drawing.back.some(c => c.text === '39.160,5 KM'), true);
    const component = fs.readFileSync(new URL('../components/VehicleTagDialog.jsx', import.meta.url), 'utf8');
    assert.doesNotMatch(component, /useFleetData|apiServerClient|localStorage|sessionStorage/);
});

test('QR é opcional e usa somente o link de pasta informado, com domínios seguros', () => {
    for (const documentUrl of ['https://drive.google.com/drive/folders/VEICULO_123?usp=sharing', 'https://drive.google.com/drive/u/0/folders/VEICULO_456']) assert.equal(validateVehicleTag({ ...sampleTag(), documentUrl }).valid, true);
    for (const documentUrl of ['javascript:alert(1)', 'http://drive.google.com/drive/folders/1', 'https://evil.com/drive/folders/1', 'https://drive.google.com.evil/drive/folders/1', 'https://user:password@drive.google.com/drive/folders/1', 'https://drive.google.com/file/d/1/view']) assert.equal(validateVehicleTag({ ...sampleTag(), documentUrl }).valid, false);
    const noQr = vehicleTagDrawing(sampleTag()); assert.equal(noQr.back.some(c => c.type === 'image'), false);
    const withQr = vehicleTagDrawing(sampleTag(), { qr: 'data:image/png;base64,test' }); assert.equal(withQr.back.find(c => c.type === 'image').src, 'data:image/png;base64,test');
});

test('prévia preserva dimensões e escapa conteúdo, textos extensos cabem na TAG', () => {
    const long = { ...sampleTag(), model: 'X'.repeat(60), releasedBy: 'X'.repeat(60), identifier: 'X'.repeat(18), company: 'X'.repeat(80), lastReview: 'X'.repeat(100), observations: 'X'.repeat(220) };
    const drawing = vehicleTagDrawing(long);
    for (const face of [drawing.front, drawing.back]) for (const c of face) assert.equal(c.x >= 0 && c.y >= 0 && c.y <= 150, true);
    const svg = tagFaceSvg([{ type: 'text', text: '<script>&"', x: 1, y: 2, size: 12 }]);
    assert.match(svg, /viewBox="0 0 100 150"/); assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;&amp;&quot;/);
    assert.equal(wrapTagText('X'.repeat(100), 30, 12).every(line => line.length <= 11), true);
});

test('PDF cria 1 página de recorte ou 2 páginas duplex e exige logo/QR válidos', () => {
    const logo = 'data:image/png;base64,' + fs.readFileSync(new URL('../../public/agromig-logo.png', import.meta.url)).toString('base64');
    const assets = { logo };
    const pdf = renderVehicleTagPdf(jsPDF, sampleTag(), assets);
    assert.equal(pdf.getNumberOfPages(), 1); assert.equal(Math.round(pdf.internal.pageSize.getWidth()), 297);
    assert.equal(renderVehicleTagPdf(jsPDF, sampleTag(), assets, 'duplex').getNumberOfPages(), 2);
    assert.throws(() => renderVehicleTagPdf(jsPDF, sampleTag(), {}), /logo/);
    assert.throws(() => renderVehicleTagPdf(jsPDF, { ...sampleTag(), documentUrl: 'https://drive.google.com/drive/folders/1' }, assets), /QR Code/);
    assert.throws(() => renderVehicleTagPdf(jsPDF, emptyVehicleTag(), assets));
});
