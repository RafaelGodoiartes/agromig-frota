# Bonificações dos Motoristas

Primeira versão operacional, integrada pela aba Bonificações do Painel Frotas.
Não adiciona dados financeiros à API anônima e não cria um dashboard de desempenho.

## Integração Google

- Projeto: `1A7LMmX9OjqQBrBjGqEEEGG2YIQMZqrEHirinK9qvYtjPF2UpDLkHMknm`.
- A implantação Web executa como o visitante e permite somente o proprietário
  Frota. Todas as funções públicas também verificam a identidade Google exata
  `frota@agromig.com.br` no servidor.
- Pasta fornecida pelo gestor: `1d_oa-vDHlkolPtQ4IL5oQvPxSjQ8i-8I`, 04 - MOTORISTAS.
  A permissão pública foi removida mediante confirmação em 09/10/2026.
  Os acessos individuais existentes foram preservados. O módulo não concede
  permissões a destinatários nem torna documentos públicos.
- As pastas dos motoristas são reutilizadas por nome normalizado completo.
  Mais de uma correspondência bloqueia a gravação. Um destino público bloqueia
  o upload, inclusive se uma subpasta tiver compartilhamento independente.
- Cadastro: `Motoristas!A5:A` e `Cadastro de Veículos!A5:B` da planilha de integração.
  Matrícula e cargo estão indisponíveis na fonte atual; não são inventados.
- Importação XLS/XLSX usa o serviço avançado Drive v3. Os originais são preservados.
- Base JSON e revisões no Drive, com lock e assinatura HMAC. A chave fica nas
  propriedades privadas do projeto, nunca no repositório. Edição direta da base
  sem assinatura válida bloqueia cálculos definitivos e envios.

## Regras e conferência

Viagem R$ 0,90/KM, confiança R$ 1.000/competência e KPIs até R$ 700.
Trabalho, cobertura de relatórios, responsabilidade e ocorrências precisam ser
conferidos. A circulação irregular só sugere eliminação dos KPIs após confirmação
da ocorrência e atribuição. Ela não elimina as outras categorias. O cálculo é
provisório e não executa pagamento ou aprovação automática.

Regras vigentes são congeladas em cada registro. Documento de viagem ausente ou
qualquer pendência de KPI impede aprovação. Reabertura preserva as ações anteriores.
Em Registros, “Alterar status” abre um formulário com as próximas etapas permitidas
pelo servidor, justificativa e confirmação explícita para aprovar. O fluxo passa
por Em análise → Aguardando aprovação → Aprovado. Pendências são apresentadas
antes da decisão e uma tela desatualizada não sobrescreve mudanças concorrentes.
Cada relatório tem quatro anexos e uma assinatura do conteúdo. Dados alterados
depois da conferência invalidam sua liberação. O agendador do servidor, ativado
em 09/10/2026, verifica o dia 10 em America/Sao_Paulo, por volta das 08h, e usa a
competência anterior. Sem relatório conferido não envia nada.

MailApp solicita envio apenas, sem ler ou excluir a caixa postal. O log distingue
aceitação pelo Google de confirmação de entrega. Uma tentativa interrompida fica
bloqueada para impedir reenvio duplicado; não há retry cego.

## Validação e trabalho ainda pendente

`node --test integrations/driver-bonuses/BonusRules.test.js` verifica regras,
assinatura, acesso, atribuição e separação entre provisórios e aprovados.
`node --test integrations/driver-bonuses/BonusStatus.test.js` verifica o fluxo,
bloqueios de aprovação, histórico, concorrência e o formulário com dados sintéticos.
Foram conferidos a leitura dos 20 motoristas, os veículos, formulários, acesso
do proprietário e criação do acionador. Não foram gravados registros fictícios,
aprovados pagamentos ou enviados e-mails de teste em produção.

A implementação não deve ser declarada integralmente concluída antes de:

- validar os formatos reais de Excel, inclusive várias abas e mapeamentos;
- testar anexos e geração dos quatro relatórios com registros autorizados;
- validar o fluxo de revisão, aprovação e primeiro envio com o responsável;
- concluir reenvio manual após nova conferência e recuperação de envio incerto;
- implementar tentativas controladas para falhas anteriores ao envio;
- ampliar configuração de horários/dia de envio e frequência de lavagem
  (nesta versão são dia 10/08h e datas exigidas informadas na avaliação);
- melhorar a apresentação de detalhes e histórico hoje exibidos como JSON.

Não reutilize `Code.gs` do conector público. Na implantação privada, concatenar
os quatro arquivos `.gs` e acrescentar `function doGet() { return bonusPortal_(); }`.
Adicionar `DriverBonusForm.html` com esse nome exato. Preservar propriedades e
acionadores ao atualizar versões. Não ativar concessões retroativas sem fonte.
