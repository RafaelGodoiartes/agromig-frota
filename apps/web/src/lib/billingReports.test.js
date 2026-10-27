import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetBilling as B } from './billingMeasurements.js';
import { exportBillingReport } from './billingReports.js';
const projects = [{ id: 'p', name: '=1+1', client: 'Teste', status: 'Ativo', start: '2026-01-01' }];
const equipment = [{ id: 'AAA1B23', name: 'Máquina para teste', plate: 'AAA1B23' }];
const measurement = B.measurement({ projectId: 'p', equipmentId: 'AAA1B23', start: '2026-10-01', end: '2026-10-31', month: '2026-10', monthlyCents: 3500000 }, projects, equipment);
const filters = { year: '2026', month: '10' };
const summary = B.summarize([measurement], projects, filters);
test('Excel e PDF usam os mesmos valores apurados; textos do usuário não viram fórmulas', async () => {
    const previousDocument = globalThis.document, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    const downloads = [];
    globalThis.document = { createElement: () => ({ click() {} }) };
    URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:teste'; }; URL.revokeObjectURL = () => {};
    try {
        await exportBillingReport('xlsx', summary, filters);
        const { default: ExcelJS } = await import('exceljs');
        const book = new ExcelJS.Workbook(); await book.xlsx.load(await downloads[0].arrayBuffer());
        assert.equal(book.getWorksheet('Medições').getCell('A2').value, '=1+1');
        assert.equal(book.getWorksheet('Medições').getCell('I2').value, 35000);
        assert.equal(book.getWorksheet('Medições').getCell('I3').value, 35000);
        assert.equal(book.getWorksheet('Por projeto').getCell('C2').value, 35000);
        assert.equal(book.getWorksheet('Mensal do ano').getCell('C11').value, 35000);
        await exportBillingReport('pdf', summary, filters);
        assert.match(await downloads[1].text(), /^%PDF/);
        assert.ok(downloads[1].size > 1000);
    } finally { globalThis.document = previousDocument; URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});
