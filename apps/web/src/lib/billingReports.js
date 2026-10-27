const money = (value) => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value) => value.split('-').reverse().join('/');
const download = (blob, name) => { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
export async function exportBillingReport(format, summary, filters) {
    const filename = `Faturamento-medicoes-${filters.year}-${filters.month}`;
    const label = `Competência: ${filters.month === 'all' ? 'todos os meses' : filters.month}/${filters.year} · Total: ${money(summary.totalCents)}`;
    if (format === 'xlsx') {
        const { default: ExcelJS } = await import('exceljs');
        const book = new ExcelJS.Workbook(); book.creator = 'AGROMIG';
        const add = (name, headings, rows, moneyColumns) => {
            const sheet = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
            sheet.addRow(headings); rows.forEach((row) => sheet.addRow(row));
            sheet.getRow(1).eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F7A46' } }; });
            sheet.columns.forEach((column, index) => { column.width = Math.min(55, Math.max(18, headings[index].length + 2)); });
            moneyColumns.forEach((index) => { sheet.getColumn(index).numFmt = '"R$" #,##0.00'; });
            sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: headings.length } };
            return sheet;
        };
        const table = add('Medições', ['Projeto', 'Máquina', 'Placa/chassi', 'Início', 'Fim', 'Competência', 'Mensal contratado', 'Valor calculado', 'Valor faturado', 'Justificativa ajuste', 'Autorização sobreposição', 'Observações'], summary.rows.map((row) => [row.projectLabel, row.equipmentName, row.plate, date(row.start), date(row.end), row.month, row.monthlyCents / 100, row.calculatedCents / 100, row.amountCents / 100, row.adjustmentReason, row.overlapReason, row.notes]), [7, 8, 9]);
        table.addRow(['TOTAL', '', '', '', '', '', '', '', summary.totalCents / 100]);
        add('Por projeto', ['Projeto', 'Medições', 'Faturamento'], summary.byProject.map((row) => [row.label, row.count, row.amountCents / 100]), [3]);
        add('Por máquina', ['Máquina', 'Medições', 'Faturamento'], summary.byEquipment.map((row) => [row.label, row.count, row.amountCents / 100]), [3]);
        add('Mensal do ano', ['Mês', 'Ano', 'Faturamento'], summary.monthly.map((row) => [row.month, filters.year, row.amountCents / 100]), [3]);
        download(new Blob([await book.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
        return;
    }
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const widths = [62, 82, 55, 70], headings = ['Projeto', 'Máquina / placa', 'Período / competência', 'Valor faturado'];
    let y = 0;
    const header = () => {
        pdf.setFillColor('#1f7a46'); pdf.rect(0, 0, 297, 22, 'F'); pdf.setTextColor('#ffffff'); pdf.setFontSize(16); pdf.text('AGROMIG | Faturamento de máquinas', 12, 14);
        pdf.setTextColor('#173b27'); pdf.setFontSize(10); pdf.text(label, 12, 30); pdf.setFontSize(9); pdf.text('Valores por competência. Histórico de preços preservado em cada medição.', 12, 36);
        y = 43; pdf.setFillColor('#eaf5ed'); pdf.rect(12, y - 5, 269, 8, 'F'); let x = 12; headings.forEach((heading, index) => { pdf.text(heading, x + 2, y); x += widths[index]; }); y += 9;
    };
    header();
    for (const row of summary.rows) {
        const values = [row.projectLabel, `${row.equipmentName}\n${row.plate}`, `${date(row.start)} a ${date(row.end)}\n${row.month.split('-').reverse().join('/')}`, money(row.amountCents)];
        const lines = values.map((value, index) => pdf.splitTextToSize(String(value), widths[index] - 5));
        const height = Math.max(...lines.map((value) => value.length)) * 4 + 5;
        if (y + height > 190) { pdf.addPage(); header(); }
        let x = 12; lines.forEach((value, index) => { pdf.text(value, x + 2, y); x += widths[index]; }); y += height; pdf.setDrawColor('#d5e6da'); pdf.line(12, y - 4, 281, y - 4);
    }
    const totals = [['TOTAL DO PERÍODO', summary.totalCents], ...summary.byProject.map((row) => [`Subtotal: ${row.label}`, row.amountCents]), [`ACUMULADO DO ANO ${filters.year}`, summary.annualCents]];
    for (const [name, value] of totals) {
        const lines = pdf.splitTextToSize(`${name}: ${money(value)}`, 265);
        if (y + lines.length * 4 + 5 > 190) { pdf.addPage(); header(); }
        pdf.text(lines, 14, y); y += lines.length * 4 + 5;
    }
    for (let page = 1; page <= pdf.getNumberOfPages(); page++) { pdf.setPage(page); pdf.setFontSize(8); pdf.text(`AGROMIG · ${page}/${pdf.getNumberOfPages()}`, 281, 203, { align: 'right' }); }
    download(pdf.output('blob'), `${filename}.pdf`);
}
