function bonusEscape_(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function bonusBRL_(cents) { return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function bonusReportFingerprint_(data, month) {
  const text = JSON.stringify({ records: data.records.filter(row => row.month === month), operations: data.operations.filter(row => row.date.slice(0, 7) === month), assignments: data.assignments, rules: bonusRulesFor_(data.ruleVersions, month) });
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text));
}
function bonusReportModel_(data, month) {
  const records = data.records.filter(row => row.month === month);
  const approved = records.filter(row => ['Aprovado', 'Pago'].includes(row.status) && row.approved);
  const groups = {};
  records.forEach(row => {
    if (!groups[row.driverId]) groups[row.driverId] = { driver: row.driver, tripCents: 0, trustCents: 0, kpiCents: 0, totalCents: 0 };
    if (!approved.includes(row)) return;
    const key = row.category === 'Viagem' ? 'tripCents' : row.category === 'Cargo de confiança' ? 'trustCents' : 'kpiCents';
    groups[row.driverId][key] += row.approved.cents; groups[row.driverId].totalCents += row.approved.cents;
  });
  const rows = Object.values(groups), totalCents = rows.reduce((sum, row) => sum + row.totalCents, 0);
  if (totalCents !== approved.reduce((sum, row) => sum + row.approved.cents, 0)) throw new Error('Totais divergentes. O relatório não será enviado.');
  return { rows, records, approved, totalCents, pending: records.filter(row => !['Aprovado', 'Pago', 'Rejeitado'].includes(row.status)), status: records.length === 0 ? 'PENDENTE — sem registros' : approved.length === records.length ? 'APROVADO' : approved.length ? 'PARCIALMENTE APROVADO' : 'PENDENTE' };
}
function bonusReportHtml_(title, headers, rows, notes) {
  return '<html><meta charset="utf-8"><body style="font:11px Arial;color:#163b28"><h1 style="color:#1f7a46">AGROMIG</h1><h2>' + bonusEscape_(title) + '</h2><p>' + bonusEscape_(notes || '') + '</p><table style="border-collapse:collapse;width:100%"><thead><tr>' + headers.map(value => '<th style="background:#1f7a46;color:white;padding:6px;text-align:left">' + bonusEscape_(value) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(value => '<td style="border:1px solid #cfe8d5;padding:6px;word-break:break-word">' + bonusEscape_(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table></body></html>';
}
function bonusSavePdf_(folder, name, html) {
  const file = folder.createFile(Utilities.newBlob(html, 'text/html', name + '.html').getAs('application/pdf').setName(name + '.pdf'));
  return { id: file.getId(), name: file.getName(), url: file.getUrl() };
}
function prepareBonusReport(month) {
  return bonusMutate_('Preparação de relatório para conferência', data => {
    bonusMonth_(month); const model = bonusReportModel_(data, month);
    if (!model.records.length) throw new Error('Não há bonificações cadastradas nessa competência.');
    const folder = bonusFolder_(bonusFolder_(bonusRoot_(), 'Relatórios de Bonificações'), month);
    const files = [], summaryHeaders = ['Motorista', 'Viagens aprovadas', 'Cargo aprovado', 'KPIs aprovados', 'Total aprovado'];
    const summaryRows = model.rows.map(row => [row.driver, bonusBRL_(row.tripCents), bonusBRL_(row.trustCents), bonusBRL_(row.kpiCents), bonusBRL_(row.totalCents)]);
    summaryRows.push(['TOTAL', '', '', '', bonusBRL_(model.totalCents)]);
    const notes = 'Competência ' + month + '. Situação: ' + model.status + '. ' + model.pending.length + ' registro(s) pendente(s), excluídos dos valores aprovados. Não é ordem de pagamento.';
    files.push(bonusSavePdf_(folder, 'Relatório Consolidado de Bonificações', bonusReportHtml_('Bonificações ' + month, summaryHeaders, summaryRows, notes)));
    const details = model.records.flatMap(row => {
      const lines = row.category === 'KPIs' ? row.calculation.results.map(kpi => [row.driver, row.category + ' / ' + kpi.criterion, row.status, bonusBRL_(kpi.maximumCents), bonusBRL_(row.calculation.eliminationSuggested ? 0 : kpi.cents), kpi.reason + ' ' + (kpi.missingDates || []).join(', ')]) : [[row.driver, row.category, row.status, bonusBRL_(row.calculation.cents), bonusBRL_(row.approved?.cents || 0), row.justification + ' ' + JSON.stringify(row.details)]];
      if (row.category === 'KPIs') lines.push([row.driver, 'Total KPIs', row.status, bonusBRL_(row.calculation.maximumCents), bonusBRL_(row.approved?.cents || 0), JSON.stringify({ pending: row.calculation.pending, occurrences: row.calculation.occurrences, elimination: row.calculation.eliminationSuggested, actions: row.actions })]);
      return lines;
    });
    files.push(bonusSavePdf_(folder, 'Demonstrativo Detalhado por Motorista', bonusReportHtml_('Demonstrativo individual ' + month, ['Motorista', 'Critério', 'Status', 'Previsto/provisório', 'Concedido/provisório', 'Justificativa e evidências'], details, notes + ' Valores de critérios não aprovados são provisórios.')));
    const evidenceRows = model.records.flatMap(row => {
      const ids = [...new Set([row.evidence?.id, ...(row.details.evidenceIds || [])].filter(Boolean))];
      return ids.map(id => { const file = DriveApp.getFileById(id); return [row.driver, row.category, row.month, file.getName(), file.getUrl()]; });
    });
    files.push(bonusSavePdf_(folder, 'Índice de Evidências', bonusReportHtml_('Índice de evidências ' + month, ['Motorista', 'Categoria', 'Competência', 'Original', 'Referência segura'], evidenceRows, 'Os arquivos originais permanecem no Drive. Os links exigem a conta autorizada; não são tornados públicos.')));
    const workbook = SpreadsheetApp.create('Conferência Bonificações ' + month);
    DriveApp.getFileById(workbook.getId()).moveTo(folder);
    const sheet = workbook.getSheets()[0]; sheet.setName('Bonificações');
    const values = [['Motorista', 'Viagens aprovadas', 'Cargo aprovado', 'KPIs aprovados', 'Total aprovado'], ...model.rows.map(row => [row.driver, row.tripCents / 100, row.trustCents / 100, row.kpiCents / 100, row.totalCents / 100])];
    sheet.getRange(1, 1, values.length, 5).setValues(values.map(row => row.map(value => typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value)));
    sheet.getRange(1, 1, 1, 5).setBackground('#1f7a46').setFontColor('#ffffff').setFontWeight('bold'); sheet.setFrozenRows(1);
    if (values.length > 1) sheet.getRange(2, 2, values.length - 1, 4).setNumberFormat('"R$" #,##0.00');
    sheet.autoResizeColumns(1, 5); SpreadsheetApp.flush();
    const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + workbook.getId() + '/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error('Não foi possível gerar o Excel. Os PDFs foram preservados para conferência; o envio permanece bloqueado.');
    const excel = folder.createFile(response.getBlob().setName('Planilha de Bonificações.xlsx'));
    files.push({ id: excel.getId(), name: excel.getName(), url: excel.getUrl() });
    const categorySum = category => model.approved.filter(row => row.category === category).reduce((sum, row) => sum + row.approved.cents, 0);
    const body = 'Prezados(as),\n\nEncaminhamos, para conhecimento, conferência e acompanhamento financeiro, o relatório mensal de bonificações dos motoristas, referente à competência ' + month + '.\n\nA apuração utiliza os registros e evidências do Sistema de Gestão de Frotas.\n\n1. RESUMO FINANCEIRO\nMotoristas avaliados: ' + model.rows.length + '\nViagens aprovadas: ' + bonusBRL_(categorySum('Viagem')) + '\nCargo de confiança aprovado: ' + bonusBRL_(categorySum('Cargo de confiança')) + '\nKPIs aprovados: ' + bonusBRL_(categorySum('KPIs')) + '\nTotal de bonificações aprovadas: ' + bonusBRL_(model.totalCents) + '\n\n2. DETALHAMENTO POR MOTORISTA\nA composição individual, requisições, indicadores, valores concedidos e justificativas está nos anexos.\n\n3. NÃO CONFORMIDADES E JUSTIFICATIVAS\nOcorrências e eventual bloqueio integral dos KPIs estão detalhados no demonstrativo, sujeitos à aprovação registrada.\n\n4. DOCUMENTAÇÃO E EVIDÊNCIAS\nOs originais permanecem no Drive com acesso restrito. Os anexos incluem um índice de evidências.\n\n5. SITUAÇÃO DA APURAÇÃO\nStatus: ' + model.status + '\nPendências: ' + (model.pending.map(row => row.driver + ' — ' + row.category + ' — ' + row.status).join('; ') || 'NENHUMA') + '\n\nSolicitamos a conferência das informações para os procedimentos administrativos e financeiros pertinentes.\n\nAtenciosamente,\nGestão de Frotas — AGROMIG\nRelatório gerado pelo Sistema de Gestão de Frotas e conferido antes do envio.';
    const report = { id: Utilities.getUuid(), month, fingerprint: bonusReportFingerprint_(data, month), files,
      subject: 'AGROMIG | Relatório Mensal de Bonificações dos Motoristas | Competência ' + month.slice(5) + '/' + month.slice(0, 4),
      body, recipients: [...BONUS_RECIPIENTS], status: 'Aguardando conferência', at: new Date().toISOString() };
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
    MailApp.sendEmail({ to: report.recipients.join(','), subject: report.subject, body: report.body, attachments, name: 'Gestão de Frotas — AGROMIG' });
    history.status = 'Enviado'; history.providerNote = 'Envio aceito pelo Google; entrega ao destinatário não confirmada. Identificador interno: ' + history.id; report.status = 'Enviado';
    bonusPersist_(data, 'Envio aceito pelo Google', BONUS_USER); return history;
  } finally { lock.releaseLock(); }
}
