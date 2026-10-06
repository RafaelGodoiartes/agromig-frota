# Cadastro de placa dentro dos lançamentos

Abastecimento e manutenção oferecem **Cadastrar nova placa**, que abre o
`VeiculoDialog` existente sem fechar ou submeter o lançamento principal.
O cadastro reutiliza `/fleet/veiculo` e a aba `Cadastro de Veículos`.
Não cria uma planilha, endpoint ou armazenamento local permanente paralelo.

Somente após resposta de sucesso, a placa entra na lista e fica selecionada.
Litros, valor, data, descrição e demais dados digitados permanecem no formulário.
Projeto e pasta vêm do veículo cadastrado; uma pasta de outro veículo não é
reaproveitada. Cancelamento/erro não criam opções fictícias.

A lista de abastecimento combina o catálogo original com o Cadastro de Veículos,
deduplicando placas com diferenças de caixa, espaços e hífens. Assim, placas
novas persistem nas duas operações após atualizar o painel ou trocar navegador.
O cadastro não escreve uma segunda linha na aba de veículos do abastecimento.

O cliente conserva metadados confirmados enquanto aguarda a atualização.
Modelo, posse, unidade e pasta também seguem no lançamento para evitar que
um cache vazio substitua o modelo pela placa. Verificação de duplicidade no
formulário usa o cadastro carregado; não garante exclusão mútua de cadastros
simultâneos feitos por usuários diferentes no conector genérico de planilhas.

Regras em `apps/web/src/lib/launchVehicles.js`; formulário em `HomePage.jsx`;
adaptação do conector em `apiServerClient.js`.
Testes: `node --test apps/web/src/lib/launchVehicles.test.js`.
API simulada para validar cadastro confirmado, falha, cache, manutenção e
abastecimento; nenhuma submissão fictícia ao ambiente de produção.
