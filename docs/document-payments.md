# Custos de documentação

Na aba Documentação, os pagamentos são lidos da aba `Pagamento de Documentação` (gid `202610081`) da planilha de integração existente. A consulta é somente leitura e acontece em segundo plano; o botão Atualizar renova a consulta sem bloquear o painel.

Colunas utilizadas: Data do serviço, Prestador de serviço, Veículo / placa, Tipo de documentação e Valor do serviço (R$). O cabeçalho anterior Data do pagamento continua aceito como compatibilidade. Datas Google/BR são normalizadas e valores são somados em centavos. A planilha vazia apresenta zero; falhas de consulta apresentam indisponibilidade ou dados da última consulta, nunca um zero confirmado. O filtro de período usa a data do serviço, sem alterar datas históricas.

A posse vem do Cadastro de Veículos: Próprio e Locado são separados. Informe preferencialmente a placa no pagamento. Modelos só são associados quando correspondem exatamente a um único veículo. Registros sem correspondência, com posse conflitante ou de outros tipos ficam em Sem classificação, ainda incluídos no custo total. Cadastros repetidos não multiplicam pagamentos; pagamentos distintos iguais continuam sendo contados.

Período, projeto, veículo e busca filtram estes custos. Situação documental (OK/vencida) não filtra pagamentos, pois a fonte financeira não fornece esse status. Valores inválidos e datas ausentes são destacados. Não são criados lançamentos, alterados cadastros nem compartilhados arquivos.

Teste: `node --test apps/web/src/lib/documentPayments.test.js`.
