# Pendências de negócio — módulos novos

Documento **vivo**. Cada item aqui é algo que os módulos novos (Visão Geral, Fluxo de Caixa,
Receitas, Custos & Despesas, Resultado, Previsões) esbarram e que **depende de decisão de produto
ou de dado que o sistema ainda não coleta** — não é tarefa técnica pendente.

Mesma lógica do `Mintly/PROBLEMAS-FUTUROS.md`, mas para os módulos novos. Item resolvido é
riscado com `~~...~~` e marcado ✅, com o link de onde foi resolvido. Não apagar: o histórico da
decisão vale tanto quanto a decisão.

Design que originou a lista: `specs/modulos-novos/20260929/design.md`.

Fica fora deste documento tudo que é escolha técnica nossa — essas vão no design.

---

## N1. Domínio de vendas não existe (bloqueia Receitas e Previsões)

**Status:** aberto. Bloqueia as fatias 9 (Receitas e Previsões) por inteiro.

**O quê.** As telas de Receitas e Previsões pedem dados que o sistema não coleta em lugar nenhum:
número de pedidos, ticket médio, item de cardápio (nome, categoria, preço de venda, custo
unitário, quantidade vendida, margem), forma de pagamento por venda e hora da venda (o heatmap de
dia × faixa horária). Os endpoints `GET /reports/revenue`, `GET /menu-items`,
`POST /predictions/simulate` e a notificação `preco-parado` dependem disso.

**Por que não dá para contornar.** Movimentação financeira registra dinheiro que entrou, não o que
foi vendido. Dá para derivar receita por categoria, por canal, tendência e formas de pagamento a
partir do que já existe — mas pedido, cardápio e horário não são deriváveis de nada.

**A decidir com o time de negócio.**
- O Mintly vai ter cadastro de cardápio? Com preço de venda e ficha técnica (custo por item)?
- Vai existir registro de pedido, ou a venda continua entrando agregada como uma movimentação?
- Se houver pedido: entra na mão, por integração (iFood, PDV) ou por importação?

**Encaminhamento.** O alex levou para o time de negócio. Até voltar, Receitas e Previsões ficam
por último e o resto da trilha segue.

---

## N2. Telas de Receitas não vieram nas prints

**Status:** aberto. Depende de N1 para virar código de qualquer jeito.

**O quê.** Das 35 prints em `Mintly/prints modulos novos/`, nenhuma é da tela de Receitas — só um
fragmento solto ("Tendência de receita — por canal", sem menu lateral). O contrato do
`Backend Pendente.html` descreve o payload, mas sem a tela não dá para conferir o que cada bloco
significa nem validar número.

**Encaminhamento.** Pedir as prints quando Receitas entrar na fila.

---

## N3. Rateio de despesa compartilhada entre canais

**Status:** aberto. Não bloqueia; limita o filtro de canal em Custos & Despesas.

**O quê.** As telas filtram Geral / Salão / Delivery. Receita tem canal (o campo `channel`, ou o
tipo da conta quando ele está ausente — ver M3 no design). Despesa compartilhada — aluguel,
energia, pró-labore, contador — não é de canal nenhum, e por isso nasce como `shared`, aparecendo
só em "Geral".

**A decidir.** Um lucro por canal exige ratear essas despesas. Proporcional à receita de cada
canal? Por percentual fixo que o dono configura? Ou o produto assume que canal só vale para
receita e custo direto?

**Encaminhamento.** Enquanto não houver decisão, "Delivery" e "Salão" mostram só o que é
atribuível, e o design não promete lucro por canal.

---

## N4. Limiar de anomalia de despesa

**Status:** aberto, com palpite em produção.

**O quê.** A tela de Custos marca gasto "fora do padrão" (Embalagens +66%, Gás +56%). A regra
proposta no design é: valor do mês ≥ 50% acima da média dos três meses anteriores **e** excedente
≥ R$ 100. O piso em reais evita que um item de R$ 20 virando R$ 40 dispare alerta.

**A decidir.** Os dois números foram inferidos das prints, não validados. 50% é agressivo demais
para insumo sazonal? O piso deveria ser percentual da receita em vez de valor fixo?

**Encaminhamento.** Entra como constante nomeada e comentada no domínio, fácil de ajustar quando
houver número validado.

---

## N5. Pesos do score de saúde e alvos de benchmark

**Status:** aberto, com palpite em produção.

**O quê.** A Visão Geral mostra um score de 0 a 100 com pilares. A composição proposta no design:
margem líquida 30%, fôlego de caixa 30%, prime cost 25%, tendência de receita 15%. As telas também
exibem alvos de benchmark de restaurante — CMV entre 28% e 35%, prime cost ≤ 60–65%.

**A decidir.** Os pesos são proposta nossa. Os alvos vieram das prints e batem com o que o mercado
de food service usa, mas precisam de aval — são eles que decidem se o dono vê "saudável" ou
"risco".

**Encaminhamento.** Constantes do domínio, com a origem comentada no código.

---

## N6. Faixas do Simples Nacional por RBT12

**Status:** aberto. Não bloqueia.

**O quê.** O DRE calcula imposto como `receita bruta × alíquota configurada no restaurante`
(M5 do design). Mas a alíquota efetiva do Simples Nacional varia por faixa de receita bruta
acumulada dos últimos 12 meses.

**A decidir.** O sistema calcula a faixa (precisa da tabela do anexo correto e do RBT12) ou o dono
informa a alíquota efetiva na mão, como está hoje?

**Encaminhamento.** Começa na mão. Se o time quiser automático, vira tarefa própria.

---

## N7. Despesa de taxa de plataforma lançada em duplicidade

**Status:** aberto. Risco de número errado, não de quebra.

**O quê.** A taxa do iFood já existe como `feeValue` da movimentação de entrada, e o design
(M6) a trata como linha sintética derivada. Se o dono também lançar uma despesa "Taxa iFood" na
mão, o valor conta duas vezes: uma vez no `feeValue` e outra na categoria de despesa.

**A decidir.** O sistema deve impedir (validação no lançamento), alertar, ou confiar no dono?

**Encaminhamento.** Decidir junto com a fatia 6 (Custos & Despesas).

---

## N8. Despesa mista no ponto de equilíbrio

**Status:** aberto, com palpite em produção.

**O quê.** `behavior` ganha o valor `mixed` (M2 do design), porque as telas mostram "Misto" —
Utilidades, por exemplo, tem parte fixa e parte que varia com o movimento. Mas o ponto de
equilíbrio precisa de uma divisão binária entre fixo e variável.

**A decidir.** A proposta é **misto conta como fixo** — leitura conservadora, ponto de equilíbrio
mais alto, o dono não se ilude. A alternativa seria o dono informar a proporção fixa de cada
categoria mista.

---

## N9. Adaptação do MintlyWeb ao contrato com número cru

**Status:** aberto. Precisa estar combinado **antes** da fatia 2 entrar.

**O quê.** O `Backend Pendente.html` pede texto pronto do backend (`refLabel: 'Julho/2026'`,
`deltas: { receitaBruta: '+24,9%' }`). O design (1.2) decidiu devolver número cru e data ISO,
deixando a formatação pt-BR no front.

**Por que é pendência.** O front não é escopo deste trabalho. Alguém precisa ajustar os
componentes do MintlyWeb que hoje só imprimem a string que chega, senão a tela quebra quando o
endpoint real substituir o mock.

**Encaminhamento.** Combinar com quem cuidar do MintlyWeb antes do primeiro módulo entrar.

---

## N10. Onde mora o arquivo do avatar de perfil

**Status:** aberto. Bloqueia só o avulso de avatar.

**O quê.** `POST /people/:id/avatar` recebe imagem de até 1 MB. O filesystem da Vercel é efêmero,
então gravar em disco não serve para staging.

**A decidir.** S3 (ou compatível), GridFS no próprio Mongo, ou serviço de terceiro. Envolve
credencial nova no deploy e custo.

---

## N11. Fuso horário por restaurante

**Status:** aberto. Não bloqueia.

**O quê.** Os relatórios resolvem "hoje" e "este mês" em `America/Sao_Paulo`, fixo (1.3 do
design). Todo cliente é brasileiro hoje, mas o Brasil já teve mais de um fuso ativo e uma
expansão mudaria isso.

**A decidir.** Guardar o fuso no restaurante quando fizer diferença.

---

## N12. Histórico de saldo diário

**Status:** aberto. Não bloqueia.

**O quê.** O Fluxo de Caixa desenha os últimos 7 dias reconstruindo o saldo para trás a partir do
caixa de hoje (3.1 do design). Isso é correto enquanto ninguém edita movimentação antiga com data
retroativa — quando edita, o passado desenhado muda junto.

**A decidir.** Se virar problema, guardar snapshot diário de saldo por conta.
