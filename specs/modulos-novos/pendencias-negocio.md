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

## N5. Pesos do score de saúde

**Status:** aberto, com palpite em produção. A parte dos alvos de benchmark ✅ **fechou** —
ver abaixo.

**~~Alvos de benchmark~~ ✅ RESOLVIDO pela MIN-84** ("KPIs Críticos"): CMV entre 28% e 35%,
prime cost até 65%. Entram como constantes do domínio, com a origem comentada no código. O design
foi corrigido (seção 3.4) — o alvo de prime cost estava escrito como "≤ 60–65%", lido das prints;
vale o número da história.

**O que continua aberto.** A Visão Geral mostra um score de 0 a 100 composto por pilares, mas a
**MIN-83 ("Score de Saúde Financeira") não define nem os pilares nem os pesos**. A composição do
design é proposta nossa: margem líquida 30%, fôlego de caixa 30%, prime cost 25%, tendência de
receita 15%, com faixas < 40 risco, < 70 atenção, ≥ 70 saudável.

**A decidir.** Os pesos e as faixas — são eles que decidem se o dono abre o app e lê "saudável" ou
"risco". Registrado como comentário na MIN-81.

**Encaminhamento.** Precisa de aval antes da fatia 8 (Visão Geral), que é a última da trilha —
tempo de sobra para a resposta chegar.

---

## ~~N6. Faixas do Simples Nacional por RBT12~~ ✅ JÁ ESPECIFICADO (MIN-23)

**Status:** resolvido enquanto pendência de negócio — vira dependência técnica entre histórias.

**O quê.** O DRE precisa da alíquota para calcular o imposto sobre a receita. A pendência era
quem decide a faixa. **A história MIN-23 ("Módulo de cálculo tributário — Simples Nacional") já
especifica tudo**: a tabela do Anexo I com as seis faixas, a fórmula da alíquota efetiva
`(RBT12 × alíquota nominal − dedução) / RBT12`, o caminho do MEI com DAS fixo e os alertas de
mudança de faixa e de proximidade do teto. O DRE **consome** essa função; não reimplementa regra
tributária. O design (M5) foi corrigido — ele previa o dono digitar a alíquota na mão.

**O que sobrou, e é técnico.** A MIN-23 calcula o RBT12 a partir da collection `daily_sales`, que
não existe e depende do domínio de vendas (N1, bloqueado). Proposta registrada como comentário na
própria história: **tirar o RBT12 de `financial_movements`**, somando a receita bruta das entradas
dos últimos 12 meses — mesmo número, fonte que já está populada, trocável depois sem mexer em quem
consome.

**A alinhar antes da fatia do DRE.** Onde o regime tributário fica gravado. O design prevê
`taxRegime` no restaurante; se a MIN-23 tiver outro lugar em mente, acertar antes de duas
implementações divergirem.


**Implementado na fatia 3** (`specs/modulos-novos/20261012/classificacao-contabil.md`): tabela do Anexo I,
alíquota efetiva, RBT12 a partir de `financial_movements` (proporcional pela LC 123) e MEI com DAS em
`app.tax_settings`.
---

## N7. Despesa de taxa de plataforma lançada em duplicidade

**Status:** aberto. Risco de número errado, não de quebra.

**O quê.** A taxa do iFood já existe como `feeValue` da movimentação de entrada, e o design
(M6) a trata como linha sintética derivada. Se o dono também lançar uma despesa "Taxa iFood" na
mão, o valor conta duas vezes: uma vez no `feeValue` e outra na categoria de despesa.

**A decidir.** O sistema deve impedir (validação no lançamento), alertar, ou confiar no dono?

**Encaminhamento.** Decidir junto com a fatia 6 (Custos & Despesas).

---

## ~~N8. Despesa mista no ponto de equilíbrio~~ ✅ DECIDIDO (fatia 4)

**Status:** decidido em 12/10/2026 — misto conta como fixo.

**O quê.** `behavior` ganha o valor `mixed` (M2 do design), porque as telas mostram "Misto" —
Utilidades, por exemplo, tem parte fixa e parte que varia com o movimento. Mas o ponto de
equilíbrio precisa de uma divisão binária entre fixo e variável.

**A decidir.** A proposta é **misto conta como fixo** — leitura conservadora, ponto de equilíbrio
mais alto, o dono não se ilude. A alternativa seria o dono informar a proporção fixa de cada
categoria mista.

**Decisão (12/10/2026, fatia 4):** misto conta como **fixo** no ponto de equilíbrio (leitura
conservadora). Constante `MIXED_BEHAVIOR_AS` em `result-metrics.ts`; spec
`specs/modulos-novos/20261012/resultado-dre.md` (R3).

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

**Melhoria parcial (fatia 2).** Com o `settledAt`, um pagamento lançado com atraso já cai no dia em
que o dinheiro mexeu, e não no vencimento. A limitação que sobra é a da edição retroativa.

---

## N13. Margem de segurança do dia crítico

**Status:** aberto, com palpite em produção.

**O quê.** O Fluxo de Caixa marca como **dia crítico** o primeiro dia em que o saldo projetado
fica abaixo de **7 dias de despesa média** (média diária das saídas liquidadas nos últimos 90
dias × 7). Limiar zero não serve: a print mostra o alerta com menor saldo de +R$ 900.

**A decidir.** 7 dias é a margem certa para restaurante? O dono deveria poder ajustar?

**Encaminhamento.** Entra como constante nomeada (`SAFETY_DAYS`) e comentada no domínio. Spec:
`specs/modulos-novos/20261012/fluxo-de-caixa.md` (F3).
