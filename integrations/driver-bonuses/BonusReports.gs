function bonusEscape_(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function bonusBRL_(cents) { return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function bonusReportFingerprint_(data, month) {
  const text = JSON.stringify({ records: data.records.filter(row => row.month === month), operations: data.operations.filter(row => row.date.slice(0, 7) === month), assignments: data.assignments, rules: bonusRulesFor_(data.ruleVersions, month) });
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text));
}
function bonusReportModel_(data, month) {
  const records = data.records.filter(row => row.month === month);
  const approved = records.filter(row => ['Aprovado', 'Pago'].includes(row.status));
  if (approved.some(row => !Number.isSafeInteger(row.approved?.cents) || row.approved.cents < 0)) throw new Error('Há registro aprovado sem valor confirmado válido. Confira o registro antes de gerar o relatório.');
  const groups = {};
  records.forEach(row => {
    const driverId = row.driverId || bonusNameKey_(row.driver);
    if (!groups[driverId]) groups[driverId] = { driver: row.driver, tripCents: 0, trustCents: 0, kpiCents: 0, totalCents: 0, approvedCount: 0 };
    if (!approved.includes(row)) return;
    const key = row.category === 'Viagem' ? 'tripCents' : row.category === 'Cargo de confiança' ? 'trustCents' : 'kpiCents';
    if (!['Viagem', 'Cargo de confiança', 'KPIs'].includes(row.category)) throw new Error('Categoria de bonificação aprovada não reconhecida.');
    groups[driverId][key] += row.approved.cents; groups[driverId].totalCents += row.approved.cents; groups[driverId].approvedCount++;
  });
  const rows = Object.values(groups), totalCents = rows.reduce((sum, row) => sum + row.totalCents, 0);
  if (totalCents !== approved.reduce((sum, row) => sum + row.approved.cents, 0)) throw new Error('Totais divergentes. O relatório não será enviado.');
  return { rows, approvedRows: rows.filter(row => row.approvedCount > 0), records, approved, totalCents, pending: records.filter(row => !['Aprovado', 'Pago', 'Rejeitado'].includes(row.status)), status: records.length === 0 ? 'PENDENTE — sem registros' : approved.length === records.length ? 'APROVADO' : approved.length ? 'PARCIALMENTE APROVADO' : 'PENDENTE' };
}
function bonusReportPreview_(data, month) {
  const model = bonusReportModel_(data, month);
  return { month, totalCents: model.totalCents, approvedCount: model.approved.length, approvedRows: model.approvedRows, pending: model.pending.map(row => ({ driver: row.driver, category: row.category, status: row.status, cents: row.calculation?.cents })), status: model.status };
}
function bonusReportEmail_(model, month) {
  const competence = month.slice(5) + '/' + month.slice(0, 4), sums = category => model.approved.filter(row => row.category === category).reduce((sum, row) => sum + row.approved.cents, 0);
  const summary = [['Viagens', bonusBRL_(sums('Viagem'))], ['Cargo de confiança', bonusBRL_(sums('Cargo de confiança'))], ['KPIs', bonusBRL_(sums('KPIs'))], ['Total aprovado', bonusBRL_(model.totalCents)]];
  const note = model.pending.length ? model.pending.length + ' registro(s) aguardam regularização ou aprovação e não integram o total.' : 'Não há registros pendentes nesta competência.';
  const body = 'Prezados,\n\nSeguem os relatórios de bonificações dos motoristas referentes a ' + competence + ', com os valores aprovados para conferência e acompanhamento financeiro.\n\n' + summary.map(row => row[0] + ': ' + row[1]).join('\n') + '\n\n' + note + ' O detalhamento por motorista e as referências dos comprovantes constam nos anexos.\n\nAtenciosamente,\nGestão de Frotas\nAGROMIG';
  const htmlBody = '<div style="background:#f3f7f4;padding:24px;font:15px Arial,sans-serif;color:#183f2d"><div style="max-width:640px;margin:auto;background:white;border:1px solid #d4e5d9;border-radius:8px;overflow:hidden"><div style="background:#1f7a46;color:white;padding:22px"><strong style="font-size:24px">AGROMIG</strong><div style="margin-top:8px">Bonificações dos motoristas · ' + bonusEscape_(competence) + '</div></div><div style="padding:24px"><p>Prezados,</p><p>Seguem os relatórios de bonificações dos motoristas referentes a ' + bonusEscape_(competence) + ', com os valores aprovados para conferência e acompanhamento financeiro.</p><table style="width:100%;border-collapse:collapse">' + summary.map((row, i) => '<tr style="background:' + (i === 3 ? '#eef7f0' : 'white') + '"><td style="padding:12px;border-bottom:1px solid #d4e5d9">' + bonusEscape_(row[0]) + '</td><td style="padding:12px;text-align:right;border-bottom:1px solid #d4e5d9;font-weight:bold">' + bonusEscape_(row[1]) + '</td></tr>').join('') + '</table><p style="color:#5b7467;font-size:13px">' + bonusEscape_(note) + ' O detalhamento por motorista e as referências dos comprovantes constam nos anexos.</p><p style="margin-top:28px">Atenciosamente,<br><strong>Gestão de Frotas</strong><br>AGROMIG</p></div></div></div>';
  return { body, htmlBody };
}
function bonusReportHtml_(title, headers, rows, notes, extra = '', layout = '') {
  const detailed = layout === 'details';
  const columns = detailed ? '<colgroup>' + [18, 15, 12, 15, 15, 25].map(width => '<col style="width:' + width + '%">').join('') + '</colgroup>' : '';
  return '<html><meta charset="utf-8"><body style="font:11px Arial;color:#163b28"><h1 style="color:#1f7a46">AGROMIG</h1><h2>' + bonusEscape_(title) + '</h2><p>' + bonusEscape_(notes || '') + '</p><table style="border-collapse:collapse;width:100%' + (detailed ? ';table-layout:fixed;font-size:10px' : '') + '">' + columns + '<thead><tr>' + headers.map(value => '<th style="background:#1f7a46;color:white;padding:6px;text-align:left">' + bonusEscape_(value) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map((value, index) => {
    const money = detailed && [3, 4].includes(index) && /^R\$/.test(String(value));
    const style = money ? 'white-space:nowrap;word-break:normal;text-align:right' : detailed ? 'word-break:normal;overflow-wrap:break-word' : 'word-break:break-word';
    return '<td style="border:1px solid #cfe8d5;padding:' + (detailed ? '5px' : '6px') + ';vertical-align:top;' + style + '">' + bonusEscape_(value) + '</td>';
  }).join('') + '</tr>').join('') + '</tbody></table>' + extra.replace(/<\/?(?:html|body)[^>]*>|<meta[^>]*>/g, '') + '</body></html>';
}
function bonusEvidenceReportHtml_(records, month) {
  const rows = [], photos = new Map();
  records.forEach(row => {
    const ids = [...new Set([row.evidence?.id, ...(row.details?.evidenceIds || [])].filter(Boolean))];
    ids.forEach(id => {
      const file = DriveApp.getFileById(id), name = file.getName(), url = file.getUrl();
      rows.push([row.driver, row.category, row.month, name, url]);
      if (['image/jpeg', 'image/png', 'image/gif'].includes(file.getMimeType())) {
        if (!photos.has(id)) photos.set(id, { file, name, url, references: [] });
        photos.get(id).references.push(row.driver + ' - ' + row.category + ' - ' + row.month);
      }
    });
    const manual = row.details?.manualAssessment;
    if (manual) rows.push([row.driver, row.category, row.month, 'Declaração manual conferida - sem arquivo importado', manual.actor + ' · ' + manual.at + ' · Respostas e datas no demonstrativo detalhado.']);
    const checklist = row.details?.checklistSelection;
    if (checklist?.source === 'Manual') rows.push([row.driver, 'Checklist manual', row.month, checklist.justification, checklist.actor + ' · ' + checklist.at + ' · Datas e veículos no demonstrativo.']);
  });
  let bytesTotal = 0;
  const gallery = [...photos.values()].map((photo, index) => {
    let blob = photo.file.getBlob(), preview = false;
    if (blob.getBytes().length > 4 * 1024 * 1024) {
      const thumbnail = photo.file.getThumbnail();
      if (thumbnail) { blob = thumbnail; preview = true; }
    }
    const bytes = blob.getBytes(); bytesTotal += bytes.length;
    if (bytesTotal > 12 * 1024 * 1024) throw new Error('As fotos excedem o limite seguro do PDF. Nenhuma foto foi omitida: reduza o tamanho dos anexos antes de gerar novamente.');
    const mime = blob.getContentType();
    if (!['image/jpeg', 'image/png', 'image/gif'].includes(mime)) throw new Error('Não foi possível incorporar a foto ' + photo.name + '. O original foi preservado no Drive.');
    const link = /^https:\/\/drive\.google\.com\//.test(photo.url) ? '<a href="' + bonusEscape_(photo.url) + '" style="color:#1f7a46;word-break:break-all">' + bonusEscape_(photo.url) + '</a>' : bonusEscape_(photo.url);
    return '<section style="page-break-before:always;page-break-inside:avoid"><h2 style="color:#1f7a46">Foto ' + (index + 1) + ' - Evidência</h2><p>' + bonusEscape_([...new Set(photo.references)].join(' / ')) + '</p><p><strong>' + bonusEscape_(photo.name) + '</strong></p><p>Original no Drive: ' + link + '</p>' + (preview ? '<p>Prévia reduzida. Consulte a foto original no link acima.</p>' : '') + '<div style="text-align:center"><img alt="' + bonusEscape_(photo.name) + '" src="data:' + mime + ';base64,' + Utilities.base64Encode(bytes) + '" style="max-width:450px;max-height:420px;width:auto;height:auto"></div></section>';
  }).join('');
  return bonusReportHtml_('Índice de evidências ' + month, ['Motorista', 'Categoria', 'Competência', 'Original', 'Referência segura'], rows,
    'Fotos anexadas estão reproduzidas nas páginas seguintes, com link para cada original. Comprovantes em PDF e declarações permanecem identificados no índice. Nenhum acesso no Drive foi alterado.', gallery);
}
function bonusSavePdf_(folder, name, html) {
  const file = folder.createFile(Utilities.newBlob(html, 'text/html', name + '.html').getAs('application/pdf').setName(name + '.pdf'));
  return { id: file.getId(), name: file.getName(), url: file.getUrl() };
}
function bonusReportDateText_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value).split('-').reverse().join('/') : String(value || '');
}
function bonusReportJustification_(row, calculation) {
  const lines = [], text = value => typeof value === 'string' ? value.trim() : '';
  if (text(row.justification)) lines.push(text(row.justification));
  if (text(row.notes)) lines.push('Observações: ' + text(row.notes));
  if (row.category === 'KPIs') {
    const selection = row.details?.checklistSelection;
    if (selection?.source === 'Manual' && text(selection.justification)) lines.push('Checklist manual: ' + text(selection.justification));
    if (calculation.eliminationSuggested) lines.push('Eliminação dos KPIs indicada por circulação fora do horário, sujeita à decisão humana.');
    if (calculation.pending?.length) lines.push('Pendências: ' + calculation.pending.filter(value => typeof value === 'string').join(' '));
    (calculation.occurrences || []).forEach(item => {
      const description = [text(item.criterion), bonusReportDateText_(item.date), text(item.plate), text(item.reason)].filter(Boolean).join(' - ');
      if (description) lines.push('Ocorrência: ' + description);
    });
    if (!lines.length) lines.push('Valor apurado conforme os critérios apresentados acima.');
  }
  return lines.join('\n') || 'Justificativa não informada.';
}
function bonusReportCriterionText_(kpi, approved) {
  const reason = typeof kpi.reason === 'string' ? kpi.reason : 'Motivo não informado.';
  const dates = (kpi.missingDates || []).map(bonusReportDateText_).filter(Boolean);
  return (approved ? 'Aprovado. ' : 'Provisório - não aprovado. ') + reason + (dates.length ? '\nDatas sem comprovação válida: ' + dates.join(', ') + '.' : '');
}
function prepareBonusReport(month) {
  return bonusMutate_('Preparação de relatório para conferência', data => {
    bonusMonth_(month); const model = bonusReportModel_(data, month);
    if (!model.records.length) throw new Error('Não há bonificações cadastradas nessa competência.');
    const folder = bonusFolder_(bonusFolder_(bonusRoot_(), 'Relatórios de Bonificações'), month);
    const reportId = Utilities.getUuid(), at = new Date().toISOString(), stamp = Utilities.formatDate(new Date(at), 'America/Sao_Paulo', 'yyyyMMdd-HHmmss') + '-' + reportId.slice(0, 8);
    const files = [], summaryHeaders = ['Motorista', 'Viagens aprovadas', 'Cargo aprovado', 'KPIs aprovados', 'Total aprovado'];
    const summaryRows = model.approvedRows.map(row => [row.driver, bonusBRL_(row.tripCents), bonusBRL_(row.trustCents), bonusBRL_(row.kpiCents), bonusBRL_(row.totalCents)]);
    summaryRows.push(['TOTAL', '', '', '', bonusBRL_(model.totalCents)]);
    const notes = 'Competência ' + month + '. Gerado em ' + Utilities.formatDate(new Date(at), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss') + '. Situação: ' + model.status + '. ' + model.approved.length + ' registro(s) aprovado(s) ou pago(s). ' + model.pending.length + ' registro(s) pendente(s), excluídos dos valores aprovados. Não é ordem de pagamento.';
    const pendingRows = model.pending.map(row => [row.driver, row.category, row.status, bonusBRL_(row.calculation?.cents), 'Não aprovado']);
    const pendingHtml = model.pending.length ? bonusReportHtml_('Pendentes — não incluídos no total aprovado', ['Motorista', 'Categoria', 'Status', 'Valor provisório', 'Situação'], pendingRows, 'Escrever Aprovado na justificativa não altera o status do registro.') : '';
    files.push(bonusSavePdf_(folder, 'Relatório Consolidado de Bonificações ' + month + ' ' + stamp, bonusReportHtml_('Bonificações aprovadas ' + month, summaryHeaders, summaryRows, notes, pendingHtml)));
    const details = model.records.flatMap(row => {
      const approved = model.approved.includes(row), calculation = approved ? row.approved.calculation || row.calculation : row.calculation;
      const lines = row.category === 'KPIs' ? (calculation.results || []).map(kpi => [row.driver, row.category + ' / ' + kpi.criterion, row.status, bonusBRL_(kpi.maximumCents), bonusBRL_(calculation.eliminationSuggested ? 0 : kpi.cents), bonusReportCriterionText_(kpi, approved)]) : [[row.driver, row.category, row.status, bonusBRL_(row.calculation.cents), approved ? bonusBRL_(row.approved.cents) : 'Não aprovado', bonusReportJustification_(row, calculation)]];
      if (row.category === 'KPIs') lines.push([row.driver, 'Total KPIs', row.status, bonusBRL_(calculation.maximumCents), approved ? bonusBRL_(row.approved.cents) : 'Não aprovado', bonusReportJustification_(row, calculation)]);
      return lines;
    });
    files.push(bonusSavePdf_(folder, 'Demonstrativo Detalhado por Motorista ' + month + ' ' + stamp, bonusReportHtml_('Demonstrativo individual ' + month, ['Motorista', 'Critério', 'Status', 'Referência', 'Valor apurado', 'Justificativa'], details, notes + ' Valores de critérios não aprovados são provisórios. Os comprovantes constam no Índice de Evidências.', '', 'details')));
    files.push(bonusSavePdf_(folder, 'Índice de Evidências ' + month + ' ' + stamp, bonusEvidenceReportHtml_(model.records, month)));
    const workbook = SpreadsheetApp.create('Conferência Bonificações ' + month + ' ' + stamp);
    DriveApp.getFileById(workbook.getId()).moveTo(folder);
    const sheet = workbook.getSheets()[0]; sheet.setName('Bonificações');
    const values = [summaryHeaders, ...model.approvedRows.map(row => [row.driver, row.tripCents / 100, row.trustCents / 100, row.kpiCents / 100, row.totalCents / 100]), ['TOTAL APROVADO', '', '', '', model.totalCents / 100]];
    sheet.getRange(1, 1, values.length, 5).setValues(values.map(row => row.map(value => typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value)));
    sheet.getRange(1, 1, 1, 5).setBackground('#1f7a46').setFontColor('#ffffff').setFontWeight('bold'); sheet.setFrozenRows(1);
    if (values.length > 1) sheet.getRange(2, 2, values.length - 1, 4).setNumberFormat('"R$" #,##0.00');
    sheet.autoResizeColumns(1, 5);
    const pendingSheet = workbook.insertSheet('Pendentes');
    const pendingValues = [['Motorista', 'Categoria', 'Status', 'Valor provisório', 'Situação'], ...model.pending.map(row => [row.driver, row.category, row.status, Number.isSafeInteger(row.calculation?.cents) ? row.calculation.cents / 100 : '', 'Não incluído no total aprovado'])];
    pendingSheet.getRange(1, 1, pendingValues.length, 5).setValues(pendingValues.map(row => row.map(value => typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value)));
    pendingSheet.getRange(1, 1, 1, 5).setBackground('#1f7a46').setFontColor('#ffffff').setFontWeight('bold'); pendingSheet.setFrozenRows(1);
    if (pendingValues.length > 1) pendingSheet.getRange(2, 4, pendingValues.length - 1, 1).setNumberFormat('"R$" #,##0.00');
    pendingSheet.autoResizeColumns(1, 5); SpreadsheetApp.flush();
    const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + workbook.getId() + '/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error('Não foi possível gerar o Excel. Os PDFs foram preservados para conferência; o envio permanece bloqueado.');
    const excel = folder.createFile(response.getBlob().setName('Planilha de Bonificações ' + month + ' ' + stamp + '.xlsx'));
    files.push({ id: excel.getId(), name: excel.getName(), url: excel.getUrl() });
    const email = bonusReportEmail_(model, month);
    const report = { id: reportId, month, fingerprint: bonusReportFingerprint_(data, month), files,
      subject: 'AGROMIG | Relatório Mensal de Bonificações dos Motoristas | Competência ' + month.slice(5) + '/' + month.slice(0, 4),
      body: email.body, htmlBody: email.htmlBody, approvedTotalCents: model.totalCents, approvedCount: model.approved.length, recipients: [...BONUS_RECIPIENTS], status: 'Aguardando conferência', at };
    data.reports.push(report); return report;
  });
}
function approveBonusReport(id, justification, checked) {
  return bonusMutate_('Conferência e liberação do relatório', (data, actor) => {
    const report = data.reports.find(row => row.id === id);
    if (!report || !checked || !justification || report.status !== 'Aguardando conferência') throw new Error('Abra os quatro anexos e confirme a conferência, com justificativa.');
    if (report.fingerprint !== bonusReportFingerprint_(data, report.month)) throw new Error('Dados alterados após a geração. Gere e confira um novo relatório.');
    report.status = 'Conferido — liberado para envio'; report.review = { actor, justification, at: new Date().toISOString() }; return report;
  });
}
function configureBonusMonthlyEmail(enabled) {
  bonusUser_();
  ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'sendScheduledBonusReport').forEach(trigger => ScriptApp.deleteTrigger(trigger));
  PropertiesService.getScriptProperties().setProperty('BONUS_SCHEDULER_OWNER', enabled ? BONUS_USER : '');
  if (enabled) ScriptApp.newTrigger('sendScheduledBonusReport').timeBased().atHour(8).nearMinute(0).everyDays(1).inTimezone('America/Sao_Paulo').create();
  return { enabled: Boolean(enabled), note: 'Dia 10, aproximadamente às 08h, America/Sao_Paulo. Sem relatório conferido não envia.' };
}
function sendScheduledBonusReport() {
  if (PropertiesService.getScriptProperties().getProperty('BONUS_SCHEDULER_OWNER') !== BONUS_USER || Session.getEffectiveUser().getEmail().toLowerCase() !== BONUS_USER) return;
  const now = new Date(), local = Utilities.formatDate(now, 'America/Sao_Paulo', 'yyyy-MM-dd');
  if (local.slice(8) !== '10') return;
  const prior = new Date(Number(local.slice(0, 4)), Number(local.slice(5, 7)) - 2, 15);
  const month = Utilities.formatDate(prior, 'America/Sao_Paulo', 'yyyy-MM');
  bonusDispatch_(month, false);
}
function sendReviewedBonusReport(month) { bonusUser_(); return bonusDispatch_(bonusMonth_(month), true); }
function bonusDispatch_(month, manual) {
  if (Session.getEffectiveUser().getEmail().toLowerCase() !== BONUS_USER) throw new Error('O remetente precisa ser a conta Frota.');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const data = bonusStore_();
    if (data.mailHistory.some(row => row.month === month && ['Enviado', 'Envio iniciado — conferir Gmail'].includes(row.status))) throw new Error('Já há envio confirmado ou incerto nesta competência. Não será enviado novamente automaticamente.');
    const report = data.reports.filter(row => row.month === month && row.status === 'Conferido — liberado para envio').at(-1);
    if (!report) return { sent: false, reason: 'Aguardando conferência do relatório.' };
    if (report.fingerprint !== bonusReportFingerprint_(data, month)) throw new Error('A conferência perdeu validade porque os dados foram alterados.');
    const attachments = report.files.map(row => DriveApp.getFileById(row.id).getBlob());
    if (attachments.reduce((sum, blob) => sum + blob.getBytes().length, 0) > 20 * 1024 * 1024) throw new Error('Anexos acima do limite seguro. O envio permanece bloqueado; os arquivos não foram descartados.');
    const history = { id: Utilities.getUuid(), month, reportId: report.id, subject: report.subject, recipients: report.recipients, files: report.files, body: report.body, status: 'Envio iniciado — conferir Gmail', programmedAt: month + ' / dia 10 da competência seguinte às 08h', effectiveAt: new Date().toISOString(), manual };
    data.mailHistory.push(history); bonusPersist_(data, 'Início de envio conferido', BONUS_USER);
    // Persist before sending: an interrupted/ambiguous send is never retried blindly.
    // MailApp requires send permission only, never mailbox read/delete access.
    MailApp.sendEmail({ to: report.recipients.join(','), subject: report.subject, body: report.body, htmlBody: report.htmlBody || undefined, attachments, name: 'Gestão de Frotas — AGROMIG' });
    history.status = 'Enviado'; history.providerNote = 'Envio aceito pelo Google; entrega ao destinatário não confirmada. Identificador interno: ' + history.id; report.status = 'Enviado';
    bonusPersist_(data, 'Envio aceito pelo Google', BONUS_USER); return history;
  } finally { lock.releaseLock(); }
}
