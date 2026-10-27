# Faturamento por projetos e medições

Extensão da integração existente, sem substituir `Código.gs`, documentação,
lançamentos operacionais ou bonificações. O frontend reutiliza React, componentes
do painel, Recharts, ExcelJS e jsPDF. A interface autenticada é incorporada em
Faturamento → Projetos e medições; Visão geral e Custos de documentação continuam.

## Dados e permissões

- Equipamentos: `Cadastro de Veículos`, mesma planilha da integração; ID é a
  placa/chassi normalizado, com modelo e identificador existentes. Não cria veículos.
- Consulta: `fleetDocumentReader_`, identidade Google corporativa verificada.
- Gestão: `fleetDocumentUser_`, mesma lista de operadores já configurada para
  documentos. Identidade enviada pelo formulário nunca autoriza uma operação.
- Persistência: planilha financeira privada criada por `initializeFleetBilling`.
  Seu ID e a chave de integridade ficam nas propriedades do Apps Script, nunca
  no bundle público. Não é adicionada à API pública nem ao controle público.
  Acesso à base também depende das permissões de Drive/Sheets da conta visitante.
- Projetos e medições possuem UUIDs; cada alteração acrescenta uma revisão
  assinada no histórico. Exclusão é lógica, não apaga versões anteriores.
- Escrita usa bloqueio, revisão esperada e ID idempotente da operação. Preço,
  cálculo, ajuste, justificativa e autor da exceção ficam preservados por medição.

## Cálculo

Dias corridos inclusivos divididos pela quantidade real de dias de cada mês.
Mês completo equivale à mensalidade; períodos que cruzam meses são calculados
por segmento e arredondados em centavos. O resultado inteiro é lançado uma única
vez na competência explicitamente escolhida dentro do período medido. Acumulado
anual ignora somente o filtro de mês, preservando projeto e equipamento.
Sobreposição da mesma máquina/projeto exige autorização e justificativa explícitas.

## Compilação e instalação

1. Execute os testes abaixo. No diretório `apps/web`, compile com
   `BASE_PATH=/agromig-frota/ pnpm exec vite build --outDir ../../dist/apps/web --emptyOutDir false`.
2. Ainda em `apps/web`, execute `node tools/build-fleet-billing.mjs`. Isso gera
   `BillingRules.gs` e `FleetBillingPortal.html`, sem dados ou credenciais.
3. No projeto Apps Script ativo, adicione esses dois arquivos e `FleetBilling.gs`.
   Preserve os arquivos existentes. No `doGet(e)`, adicione somente:
   `if (action === 'billingPortal') return fleetBillingPortal_(e);`
4. Execute `initializeFleetBilling` com um operador autorizado. É idempotente:
   nunca reinicializa uma base existente nem insere exemplos.
5. Atualize **somente a versão da implantação autenticada** do portal corporativo,
   mantendo usuário visitante e audiência existentes. Não altere a implantação
   pública de dados/lançamentos. Publique os assets correspondentes no Pages.
6. O portal permite incorporação; toda leitura/escrita continua validada no
   servidor. Mensagens de redimensionamento não contêm dados financeiros e
   são filtradas por origem e identificador do quadro no frontend.

## Testes

`node --test apps/web/src/lib/billingMeasurements.test.js integrations/fleet-billing/FleetBilling.test.js`

Não use lançamentos reais para testes de CRUD. Exercite cálculos, moeda,
vencimento de períodos, sobreposição, autorização, concorrência, idempotência,
edição, exclusão e integridade com Sheets simulados. Valide a interface vazia
autenticada em produção sem criar serviços fictícios.
