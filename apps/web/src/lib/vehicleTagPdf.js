import { validateVehicleTag, vehicleTagDrawing } from './vehicleTag.js';

export function renderVehicleTagPdf(jsPDF, input, assets, layout = 'lado-a-lado') {
    const validation = validateVehicleTag(input);
    if (!validation.valid) throw new Error(Object.values(validation.errors)[0]);
    if (!assets.logo) throw new Error('A logo não carregou. Tente novamente antes de gerar a TAG.');
    if (validation.tag.documentUrl && !assets.qr) throw new Error('O QR Code não carregou. Tente novamente.');
    if (!['lado-a-lado', 'duplex'].includes(layout)) throw new Error('Formato de impressão inválido.');
    const drawing = vehicleTagDrawing(validation.tag, assets);
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    doc.setProperties({ title: `TAG ${validation.tag.plate}`, subject: 'Identificação e revisão informadas manualmente', creator: 'Painel de Frotas Agromig' });
    const draw = (commands, left, top) => {
        for (const c of commands) {
            if (c.type === 'rect') {
                doc.setFillColor(c.fill); doc.setDrawColor(c.stroke || c.fill); doc.setLineWidth(0.3);
                doc.rect(left + c.x, top + c.y, c.width, c.height, c.stroke ? 'FD' : 'F');
            } else if (c.type === 'text') {
                doc.setTextColor('#000000'); doc.setFont('courier', c.bold ? 'bold' : 'normal'); doc.setFontSize(c.size);
                doc.text(c.text, left + c.x, top + c.y, { align: c.centered ? 'center' : 'left' });
            } else {
                const image = doc.getImageProperties(c.src);
                const scale = Math.min(c.width / image.width, c.height / image.height);
                const width = image.width * scale, height = image.height * scale;
                doc.addImage(c.src, 'PNG', left + c.x + (c.width - width) / 2, top + c.y + (c.height - height) / 2, width, height);
            }
        }
    };
    const caption = (text, x, y) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor('#4b5563'); doc.text(text, x, y, { align: 'center' }); };
    if (layout === 'duplex') {
        draw(drawing.front, 98.5, 30); caption('FRENTE - 100 x 150 mm', 148.5, 25);
        doc.addPage(); draw(drawing.back, 98.5, 30); caption('VERSO - 100 x 150 mm', 148.5, 25);
    } else {
        draw(drawing.front, 42, 30); draw(drawing.back, 155, 30);
        caption('FRENTE - 100 x 150 mm', 92, 25); caption('VERSO - 100 x 150 mm', 205, 25);
        caption('Imprima em tamanho real (100%). Recorte e una as duas faces.', 148.5, 190);
    }
    return doc;
}

export async function loadVehicleTagAssets(tag) {
    const logoUrl = `${import.meta.env.BASE_URL}agromig-logo.png`;
    const response = await fetch(logoUrl);
    if (!response.ok) throw new Error('Não foi possível carregar a logo da Agromig.');
    const logo = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Não foi possível ler a logo.'));
        response.blob().then((blob) => reader.readAsDataURL(blob)).catch(reject);
    });
    let qr;
    if (tag.documentUrl) {
        const { default: QRCode } = await import('qrcode');
        qr = await QRCode.toDataURL(tag.documentUrl, { errorCorrectionLevel: 'M', margin: 2, width: 512 });
    }
    return { logo, qr };
}
