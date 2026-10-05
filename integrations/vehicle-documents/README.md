# Portal de documentos da frota

Portal publicado em 05/10/2026, versão 22, em uma implantação separada que exige
conta da organização Agromig e executa como o usuário visitante. A integração
pública do dashboard e dos lançamentos não foi modificada.

Lista de usuários confirmada pelo responsável e configurada em propriedade de
script: Rafael, Eduardo e Frota, nos respectivos e-mails `@agromig.com.br`.
Cada usuário precisa confirmar a autorização Google no primeiro acesso e já
possuir acesso às pastas no Drive; o portal não concede nem altera permissões.

URL publicada (configuração pública, não credencial):
https://script.google.com/a/macros/agromig.com.br/s/AKfycbwO3DXAEi3PNg4u7ExG68xTMQft2ccWEhnRRu2k5MgVG8O7elGLA4z-26IHbou2lTZU/exec?action=documentPortal

Validação: regras de autorização, placas, destinos e upload verificadas por testes
isolados. A validação com a conta real depende da autorização inicial do Google.

## Instalação sem substituir o conector existente

1. Compare primeiro o projeto ativo **Integração Site Frota Agromig** com a
   cópia local. Adicione `VehicleDocuments.gs` e `VehicleDocumentForm.html` como
   novos arquivos. Não substitua `Code.gs` por uma cópia antiga. As duas rotas
   abaixo foram adicionadas ao código ativo, preservando todo o restante.
2. No `doGet(e)` existente, após ler `action`, acrescente:

   ```js
   if (action === 'documentPortal') return fleetDocumentPortal_();
   if (action === 'documentPortalStatus') return fleetDocumentPortalStatus_();
   ```

3. Defina a propriedade de script `FROTA_DOCUMENT_UPLOAD_EMAILS` somente com
   os e-mails autorizados de Frotas, separados por vírgula. Não registre senhas
   nem tokens. Não use o usuário efetivo/proprietário como identidade do visitante.
4. Crie uma implantação separada para o portal, executando como o usuário que
   acessa e exigindo Conta Google. **Não altere a implantação pública atual** que
   atende os lançamentos e o dashboard. Configure sua URL em
   `VITE_DOCUMENT_PORTAL_URL` durante a compilação do frontend e valide
   `Session.getActiveUser().getEmail()`
   com uma conta autorizada e uma não autorizada. **Não retire a validação**.
   A conta terá de autorizar o Google e ter acesso às pastas.

## Fontes e limites

- Cadastro: `Cadastro de Veículos!A5:B`, planilha de integração já existente.
- Busca somente dentro de **03 - OPERAÇÃO**, até três níveis e 600 pastas.
- Identificação exata da placa, tolerando separadores, sem confundir placas
  prefixadas (ex.: LTU5A25 não corresponde a LTU5A250).
- Se houver mais de uma pasta, o operador confirma uma. Subpastas até três níveis.
- Destino validado novamente no servidor; nunca aceita uma pasta fora do veículo.
- Um PDF/JPG/PNG por envio, até 8 MB. Não sobrescreve arquivos nem muda permissões.
- Upload não muda datas, exigências ou fórmulas da documentação. Atualização
  documental na planilha exige fluxo próprio e mapeamento das colunas de entrada.

## Verificação

Execute `node --test integrations/vehicle-documents/VehicleDocuments.test.js`.
Os testes usam Drive/Sheets simulados; não enviam arquivos de teste à produção.
Após instalação, confira manualmente o destino com um arquivo autorizado,
os casos sem pasta/conta e desktop/celular antes de liberar a operação.
