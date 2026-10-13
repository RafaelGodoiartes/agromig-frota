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
- A tela não exige mais importação de Excel. As funções antigas e seus originais
  são preservados somente para compatibilidade e conferência do histórico.
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
Circulação fora do horário, excesso de velocidade, lavagens e multas são declarados
com Sim/Não, datas e placas no formulário de KPIs. A conta Frota confirma a
conferência; autoria, respostas e datas ficam na base assinada e no demonstrativo.
Uma declaração não é apresentada como arquivo comprobatório. Ausência de resposta
não equivale a Não. Exceções autorizadas e multas contestadas continuam distintas.
Cada data/ocorrência permite foto JPG/PNG ou PDF, opcional, guardado na pasta privada
do motorista/competência/categoria/data-placa. O total de novos anexos por envio é
8 MB. Os links aparecem na consulta e no índice de evidências dos relatórios.
Recalcular mantém o anexo anterior da mesma data/placa quando não há arquivo novo;
IDs enviados pelo navegador nunca autorizam acesso a arquivos arbitrários.
Uma substituição cria outro arquivo, preservando o original e as revisões.
O checklist permite escolher Epicollect5 (padrão) ou Manual em qualquer competência,
inclusive períodos após adoção do aplicativo. No modo automático, falhas de leitura
continuam pendentes. No modo manual, o gestor informa dias/placas realmente
realizados, justificativa e conferência explícita, com foto/PDF opcional. Não há
consulta ao aplicativo nem concessão integral automática nesse modo: dias válidos
continuam proporcionais aos dias trabalhados, com responsabilidade histórica em
Utilização. Fonte, autoria e justificativa ficam nas revisões e relatórios.
No checklist manual, “Lançar vários dias de uma vez” permite selecionar datas ou
um intervalo para o mesmo veículo. Os atalhos incluem somente os dias trabalhados
explicitamente selecionados; não presumem jornadas. Datas/placas já existentes
são ignoradas sem sobrescrever anexos. O lote só prepara as linhas do formulário:
o gestor confere os dias e salva depois, mantendo a aprovação humana.
Em Utilização, data inicial/final registram um único intervalo inclusivo de
responsabilidade, com resumo da quantidade de dias e atalho para preencher a
competência. O preenchimento não salva automaticamente e não presume trabalho
ou checklist. Em KPIs, os dias trabalhados também podem ser selecionados por
intervalo dentro da competência, preservando a seleção anterior e permitindo
desmarcar folgas. A conferência humana deve ser renovada após usar o intervalo.
Em Registros, a explicação dos KPIs mostra máximo, valor considerado, diferença,
motivos, datas sem comprovação válida e orientações para conferir cada item.
São utilizados somente os resultados e pendências salvos na avaliação, sem
recalcular pela regra atual nem alterar o registro. Falta de atribuição histórica
não é tratada como prova de checklist não realizado. Ocorrência eliminatória
explica o zero integral, e pendências gerais continuam bloqueando a aprovação.
Os atalhos abrem KPIs/Utilização; nunca salvam, aprovam ou garantem R$ 700.
Declarações contraditórias com ocorrências anteriores bloqueiam a aprovação até
conferência; registros aprovados/pagos não são recalculados sem reabertura.
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
`node --test integrations/driver-bonuses/BonusManual.test.js` verifica declarações,
datas, exceções, contestação, fontes históricas e consulta direta do checklist.
Foram conferidos a leitura dos 20 motoristas, os veículos, formulários, acesso
do proprietário e criação do acionador. Não foram gravados registros fictícios,
aprovados pagamentos ou enviados e-mails de teste em produção.

A implementação não deve ser declarada integralmente concluída antes de:

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
