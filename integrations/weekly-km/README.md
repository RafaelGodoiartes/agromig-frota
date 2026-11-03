# KM semanal provisório e virada mensal

Complemento do Apps Script existente. Reutiliza a ação `weeklyKm`, o controle
autorizado e a aba definitiva `KM Semanal` (mantém seu sheetId e integrações).
Não altera permissões nem aceita IDs de planilhas/abas arbitrários.

## Regras

- Competência muda no dia 4 em America/Sao_Paulo. Antes disso, leituras do novo
  mês vão para `KM Provisório MM-AAAA`. O mês anterior não é alterado.
- A semana é a segunda-feira correspondente dentro do mês. Dias anteriores à
  primeira segunda pertencem à primeira coluna do próprio mês.
- Cada lançamento mantém data, placa, valor anterior e destino no registro de
  leituras. Reenvio de mesmo valor não duplica. Valores menores são recusados.
  Novas linhas têm tipos explícitos (texto e números). A conferência usa a
  célula capturada na gravação e aceita datas nativas equivalentes em E/F,
  mantendo comparação estrita dos demais campos. Tentativas antigas não são
  apagadas nem reescritas para corrigir o formato.
- Na virada, uma cópia integral de valores/formatos vira histórico imutável;
  futuras mudanças do Cadastro não mudam o histórico. Não substitui históricos
  já existentes. O índice recebe o link da nova cópia.
- Só após comparar a cópia com a origem as leituras D5:H são preparadas para a
  nova competência. Demais fórmulas, placas, franquias e unidades permanecem.
- Transferência confere placa/semana/valor, mantém conflitos dos dois lados e
  só remove o provisório após readback dos destinos e registro de segurança.
- Bloqueio e diário de fases permitem retomar uma falha. Histórico adulterado
  ou novas leituras durante a preparação interrompem a transição.

## Instalação

1. Adicionar `WeeklyKmTransfer.gs` sem substituir outros arquivos.
2. No `doPost`, trocar apenas `return updateWeeklyKm_(payload)` por
   `return updateWeeklyKmSafe_(payload)` na ação `weeklyKm`.
3. Salvar e executar `initializeWeeklyKmTransfer` com operador já autorizado
   por `fleetDocumentUser_`. Instala um único gatilho horário, não envia e-mails.
4. Atualizar somente a versão da implantação pública de dados/lançamentos,
   mantendo seus parâmetros de execução e acesso. Portal privado permanece.

No dia 03/11 a instalação cria o provisório vazio de novembro e o registro,
sem limpar outubro. A primeira execução elegível em 04/11 faz a virada.

## Verificação

`node --test integrations/weekly-km/WeeklyKmTransfer.test.js`

Testes simulados cobrem virada de ano, primeira semana, preservação integral,
reenvio, conflitos, falhas intermediárias e alterações manuais concorrentes.
Nunca use a planilha de produção para lançar dados fictícios.
