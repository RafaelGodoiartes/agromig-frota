# TAG veicular manual

Botão **Criar TAG veicular** nos lançamentos operacionais do Painel de Frotas.
Base visual: modelo `TAG TCP6B43.pptx`, com logo, fundo verde, identificação,
placa, responsável, observações e QR Code no verso. Cada face tem 100 x 150 mm.

Todos os dados do veículo e de revisão vêm do formulário. Não há consulta à
planilha, envio ao backend, gravação no Drive ou armazenamento persistente.
O preenchimento permanece apenas enquanto a página estiver aberta.

- Última revisão: KM, data e descrição opcional dos serviços realizados.
- Próxima revisão: KM informado manualmente, também usado na renovação da TAG.
- Próximos serviços: revisão preventiva e troca do óleo; caminhão inclui fluido
  de freio. O tipo de veículo também é escolhido manualmente.
- Datas: DD/MM/AAAA. KM aceita inteiros, separadores brasileiros, frações,
  espaços e sufixo `km` sem diferenciar maiúsculas (ex.: `162000 km`).
- Link opcional: pasta HTTPS do `drive.google.com`, digitada pelo usuário.
  QR Code gerado localmente com esse link; não reaproveita o QR do exemplo.
  O código não muda as permissões de acesso do Drive.

**Ver prévia** apresenta as duas faces. **Gerar PDF** prepara um arquivo local,
e **Baixar TAG em PDF** salva o arquivo. Alterar dados ou formato invalida o PDF
anterior. Logo/QR e bibliotecas de PDF carregam somente quando solicitados.

Formato de recorte: uma folha A4 paisagem com as duas faces lado a lado.
Formato duplex: duas folhas A4 paisagem com as faces na mesma posição.
Imprimir em tamanho real (100%) e testar alinhamento/virada na impressora.

Testes: `node --test apps/web/src/lib/vehicleTag.test.js`.
Regras/layout compartilhados entre prévia SVG e PDF em `vehicleTag.js`;
exportação em `vehicleTagPdf.js`; formulário em `VehicleTagDialog.jsx`.
Os testes usam dados fictícios locais, sem submissões às integrações.
