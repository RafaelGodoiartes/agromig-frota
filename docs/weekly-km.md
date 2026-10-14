# KM semanal: competência e pendências

A fonte ativa é `KM Semanal` (gid `1792383375`) e o cadastro é `Cadastro de Veículos` (gid `1477905702`), na planilha de integração do site. `weeklyKmSources.js` consulta os dados atuais em segundo plano, sem cache, separando o calendário das colunas numéricas para não perder datas no GViz.

`weeklyKm.js` verifica cada segunda-feira já vencida, em `America/Sao_Paulo`, usando a competência que começa no dia 4. Não usa “DENTRO DA FRANQUIA” como prova de que todas as leituras foram feitas. Inclui placas ausentes na resposta semanal, normaliza placas/chassis, ignora erros de referência e reúne duplicados sem apagar registros. A exceção de entrada nos últimos sete dias com menos de duas leituras permanece aplicada.

## Preparação de outro mês

- B2 é uma data fixa, não uma fórmula baseada em `TODAY`. Alterar apenas o cabeçalho não comprova o mês das leituras.
- Antes de mudar a competência, preservar uma cópia integral e verificar placas, leituras, fórmulas e valores. Um histórico validado pode ser nomeado `KM Semanal MM-AAAA`; uma base com meses misturados não deve receber uma competência inventada.
- Nunca sobrescrever históricos existentes. Nunca limpar leituras sem confirmação imediatamente anterior à operação.
- C2 contendo `COMPETÊNCIA EM CONFERÊNCIA` sinaliza a mistura confirmada em um aviso separado. Essa sinalização não adiciona veículos ao contador de KM pendente: somente semanas vencidas realmente sem leitura entram nele. Remover o aviso de conferência somente depois de conferir os registros e regularizar a competência; não apenas para esconder alertas.
- Datas de semanas futuras preenchidas e calendários antigos/incompletos geram avisos. Falha de consulta não significa “tudo regular”. Leituras de uma competência antiga nunca quitam as semanas de uma nova.

Teste: `node --test apps/web/src/lib/weeklyKm.test.js`. Os testes usam dados sintéticos, cobrem virada de mês/ano, datas faltantes, atualização, duplicados, exceção de entrada e preservação dos valores.
