// Manual-only TAG generator. No spreadsheet, API or persistent storage access.
export const TAG_SIZE = { width: 100, height: 150 };
export const TAG_COMPANY = 'AGROBRAS SOLUÇÃO E RECUPERAÇÃO AMBIENTAL LTDA.';
export const emptyVehicleTag = () => ({
    company: TAG_COMPANY, plate: '', model: '', identifier: '', vehicleType: 'veiculo',
    releasedBy: '', issueDate: '', lastReviewKm: '', lastReviewDate: '', lastReview: '',
    nextReviewKm: '', observations: '', documentUrl: '',
});

export function tagKm(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.')
        : /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw;
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const result = Number(normalized);
    return Number.isFinite(result) && result >= 0 && result <= 99999999 ? result : null;
}

export function tagDate(value) {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(value))) value = value.split('/').reverse().join('-');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export function normalizeVehicleTag(input) {
    const text = (field) => String(input[field] ?? '').trim().replace(/[\x00-\x1f]/g, ' ');
    return { ...input, company: text('company'), plate: text('plate').toUpperCase().replace(/[\s-]/g, ''),
        model: text('model').toUpperCase(), identifier: text('identifier').toUpperCase(),
        releasedBy: text('releasedBy'), observations: text('observations'), lastReview: text('lastReview'),
        documentUrl: text('documentUrl'), lastReviewKm: tagKm(input.lastReviewKm), nextReviewKm: tagKm(input.nextReviewKm),
        issueDate: tagDate(input.issueDate)?.split('/').reverse().join('-') || text('issueDate'),
        lastReviewDate: tagDate(input.lastReviewDate)?.split('/').reverse().join('-') || text('lastReviewDate') };
}

export function validateVehicleTag(input) {
    const tag = normalizeVehicleTag(input);
    const errors = {};
    for (const [key, label, max] of [['company', 'Nome da empresa', 80], ['model', 'Modelo', 60], ['identifier', 'Identificação AGR', 18], ['releasedBy', 'Liberado por', 60]]) {
        if (!tag[key] || tag[key].length > max) errors[key] = `Informe ${label.toLowerCase()} com até ${max} caracteres.`;
    }
    if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(tag.plate)) errors.plate = 'Informe uma placa brasileira válida, como TCP6B43 ou ABC1234.';
    if (!['veiculo', 'caminhao'].includes(tag.vehicleType)) errors.vehicleType = 'Selecione veículo ou caminhão.';
    if (!tagDate(tag.issueDate)) errors.issueDate = 'Informe uma data de emissão válida.';
    if (!tagDate(tag.lastReviewDate)) errors.lastReviewDate = 'Informe a data da última revisão.';
    if (tagDate(tag.issueDate) && tagDate(tag.lastReviewDate) && tag.lastReviewDate > tag.issueDate) errors.lastReviewDate = 'A última revisão não pode ser posterior à emissão da TAG.';
    if (tag.lastReviewKm === null) errors.lastReviewKm = 'Informe o KM da última revisão (zero é permitido).';
    if (tag.nextReviewKm === null) errors.nextReviewKm = 'Informe o KM da próxima revisão.';
    else if (tag.lastReviewKm !== null && tag.nextReviewKm <= tag.lastReviewKm) errors.nextReviewKm = 'O KM da próxima revisão deve ser maior que o da última revisão.';
    for (const [key, max] of [['observations', 220], ['lastReview', 100]]) if (tag[key].length > max) errors[key] = `Use até ${max} caracteres.`;
    if (tag.documentUrl) {
        try {
            const url = new URL(tag.documentUrl);
            if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password || tag.documentUrl.length > 500 || !/^\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw Error();
        } catch { errors.documentUrl = 'Cole o link da pasta do veículo: https://drive.google.com/drive/folders/...'; }
    }
    return { tag, errors, valid: !Object.keys(errors).length };
}

export const tagServices = (type) => type === 'caminhao'
    ? ['Revisão preventiva e troca do óleo', 'Troca do fluido de freio']
    : ['Revisão preventiva e troca do óleo'];

const kmLabel = (value) => value === null ? '________ KM' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} KM`;
// Courier has fixed-width glyphs; the same wrapped lines feed preview and PDF.
export function wrapTagText(value, width, fontSize) {
    const max = Math.max(1, Math.floor(width / (fontSize * 25.4 / 72 * 0.6)));
    const lines = []; let line = '';
    for (const word of String(value || '').split(/\s+/).filter(Boolean)) {
        let part = word;
        if (line && line.length + part.length + 1 > max) { lines.push(line); line = ''; }
        while (part.length > max) { if (line) { lines.push(line); line = ''; } lines.push(part.slice(0, max)); part = part.slice(max); }
        line = line ? `${line} ${part}` : part;
    }
    if (line) lines.push(line);
    return lines;
}

export function vehicleTagDrawing(input, assets = {}) {
    const tag = normalizeVehicleTag(input);
    const front = [], back = [];
    const rect = (list, x, y, width, height, fill, stroke) => list.push({ type: 'rect', x, y, width, height, fill, stroke });
    const text = (list, value, x, y, width, size, maxLines, centered = false, bold = false) => {
        let lines, fontSize = size;
        do { lines = String(value || '').split('\n').flatMap((paragraph) => wrapTagText(paragraph, width, fontSize)); if (lines.length <= maxLines) break; fontSize -= 0.5; } while (fontSize >= 6);
        if (lines.length > maxLines) throw new Error('Texto excede o espaço da TAG. Reduza o tamanho dos campos.');
        lines.forEach((line, i) => list.push({ type: 'text', text: line, x: centered ? x + width / 2 : x, y: y + i * fontSize * 25.4 / 72 * 1.18, size: fontSize, centered, bold }));
    };
    for (const list of [front, back]) rect(list, 0, 0, 100, 150, '#00b050', '#1f7a46');
    rect(front, 0, 0, 100, 18, '#ffffff', '#1f7a46');
    if (assets.logo) front.push({ type: 'image', src: assets.logo, x: 26, y: 4, width: 48, height: 10 });
    text(front, tag.company, 5, 23, 90, 9, 3, true, true);
    text(front, 'VEÍCULOS RODOVIÁRIOS', 4, 41, 92, 16, 1, true, true);
    text(front, tag.model || 'MODELO DO VEÍCULO', 5, 62, 90, 19, 3, true, true);
    text(front, tag.identifier || 'IDENTIFICAÇÃO AGR', 5, 83, 90, 22, 1, true, true);
    text(front, `PLACA ${tag.plate || '_______'}`, 5, 108, 90, 22, 1, true, true);
    text(front, 'RENOVAÇÃO DA PRÓXIMA TAG', 5, 117, 90, 12, 1, true, true);
    text(front, kmLabel(tag.nextReviewKm), 5, 128, 90, 18, 1, true, true);
    text(back, `Liberado por: ${tag.releasedBy || '________________'}`, 4, 7, 92, 9, 2, false, true);
    text(back, `Data: ${tagDate(tag.issueDate) || '__/__/____'}`, 4, 19, 92, 10, 1, false, true);
    rect(back, 3, 24, 94, 0.3, '#1f7a46');
    text(back, 'CONTROLE DE REVISÃO', 4, 31, 92, 12, 1, false, true);
    text(back, `Última revisão: ${kmLabel(tag.lastReviewKm)}`, 4, 40, 92, 11, 1, false, true);
    text(back, `Data da revisão: ${tagDate(tag.lastReviewDate) || '__/__/____'}`, 4, 47, 92, 10, 1);
    text(back, tag.lastReview, 4, 54, 92, 9, 3);
    rect(back, 3, 67, 94, 20, '#ffffff');
    text(back, 'PRÓXIMA REVISÃO', 5, 74, 90, 11, 1, true, true);
    text(back, kmLabel(tag.nextReviewKm), 5, 83, 90, 18, 1, true, true);
    text(back, tagServices(tag.vehicleType).join('\n'), 4, 94, 92, 10, 2, false, true);
    text(back, `Observação: ${tag.observations || '________________________'}`, 4, 108, 92, 8, 6);
    text(back, 'Apresente os documentos obrigatórios quando solicitado. Em caso de extravio, comunique à gestão de SST.', 4, 131, assets.qr ? 63 : 92, 6.5, 5);
    if (assets.qr) {
        back.push({ type: 'image', src: assets.qr, x: 75, y: 126, width: 22, height: 22 });
        text(back, 'DOCUMENTOS', 75, 124, 22, 6, 1, true, true);
    }
    return { front, back };
}

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
export function tagFaceSvg(commands) {
    const elements = commands.map((c) => c.type === 'rect'
        ? `<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" fill="${c.fill}" stroke="${c.stroke || 'none'}" stroke-width="0.3"/>`
        : c.type === 'image' ? `<image href="${escapeXml(c.src)}" x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" preserveAspectRatio="xMidYMid meet"/>`
            : `<text x="${c.x}" y="${c.y}" font-family="Courier New,monospace" font-size="${c.size * 25.4 / 72}" font-weight="${c.bold ? 'bold' : 'normal'}" text-anchor="${c.centered ? 'middle' : 'start'}" fill="#000">${escapeXml(c.text)}</text>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 100 150">${elements}</svg>`;
}
