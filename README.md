# prizespy-sim

Simulador do PrizeSpy. O bot do Hide n' Sneak (lista do Rahul Reddy) joga contra os 10 arquétipos mais jogados do meta, com várias listas reais de cada um (Limitless), pesadas pela frequência e com todas as variações relevantes representadas.

## O que roda sozinho

O fluxo `.github/workflows/simular.yml` roda sem parar, desde que o repositório seja público (minutos ilimitados). Cada rodada:

1. joga cerca de 5h40 em 6 partes paralelas; as partes não repetem partidas entre si;
2. aumenta a meta sozinha (modo `auto`: o máximo já jogado + 20 partidas por lista);
3. grava as partidas novas em `resultados/<versão do bot>/` e atualiza o `RESUMO.md` (por arquétipo e variação, com partidas e margem de erro);
4. dispara a próxima rodada. Se a corrente cair, o agendamento a cada 6 h religa.

**Para parar:** crie um arquivo `PARAR` na raiz, ou desative o fluxo na aba Actions. Com o repositório privado, o fluxo não se reinicia sozinho e cada parte joga no máximo 25 minutos, para não gastar os minutos grátis.

## Arquivos

- `sim_meta.js`: o simulador (`plano`, `rodar`, `resumo`, `ab`).
- `solver.min.js`: o motor (twinleaf) com os bots.
- `listas_solver.json`: as listas do meta. `plano.json`: os arquétipos, as listas e as variações escolhidas.
- `VERSAO_SIM`: a versão do motor e dos bots (hoje `v1`, o motor corrigido da auditoria; `v0` foi o motor original). Cada versão nova grava os resultados numa pasta própria, para comparar com `node sim_meta.js ab resultados/v0 resultados/v1`.

## Rodar no computador

```
RES=resultados/v0 node sim_meta.js resumo
RES=resultados/v0 PRAZO=600 node sim_meta.js rodar 60
```

## Ajuste automático dos bots (afinar)

Com o arquivo `AFINANDO` na raiz, quem roda é o `.github/workflows/afinar.yml` (o `simular.yml` fica parado).

- `afinar.js` carrega os bots direto de `motor/src` (via `motor/bots_src.js`, usando o motor do `solver.min.js`), sem recompilar. Com os parâmetros padrão, as partidas saem idênticas às do pacote.
- Cada arquétipo tem um **campeão** (parâmetros do fim de turno em `K_PADRAO`, regras do perfil desligadas ou adiantadas) e **6 desafiantes** por rodada, cada um com 1 ou 2 mudanças.
- Todos jogam contra o bot do HnS com as **mesmas sementes**, então a diferença vem só das decisões. O desafiante que fizer o HnS cair mais vira campeão, se a queda passar de 2,5 erros-padrão e de meio ponto.
- O objetivo é o oponente ganhar o máximo. O alvo dos Regionais aparece no `ajuste/RESUMO.md` só como conferência.
- `ajuste/regras.json`: as regras de cada perfil que disparam nas partidas (`node afinar.js catalogo`). Dragapult, Alakazam e Excadrill não têm perfil com regras: só os números do fim de turno mudam neles.
- Para voltar à simulação comum: apagar o `AFINANDO`.

## Logs do TCG Live (gerar_logs)

`gerar_logs.js` joga o bot do HnS contra os arquétipos do `plano.json` e escreve cada partida como um log do TCG Live
em inglês, pronto para colar no PrizeSpy (o HnS aparece como `HnSBot`, com a mão revelada; o oponente como `DragapultBot`, `ZoroarkBot`...).
Os oponentes usam o campeão atual do ajuste (`ajuste/estado.json`). O escritor (`logs_tcglive.js`) segue cada carta do motor
(os movimentos entre listas, na ordem em que acontecem) e usa os registros internos do motor para ataque, dano e moedas.

- No GitHub: aba Actions → **Gerar logs do TCG Live** → Run workflow (quantos, semente). Sai um zip `logs-tcglive`
  (uma pasta por arquétipo + `indice.jsonl` com o resultado de cada partida). Não mexe no afinar nem no simular.
- No computador: `node gerar_logs.js 1000 logs_tcglive 20261117` ou `node gerar_logs.js um <arquétipo> <i da lista> <semente>`.
- Partidas com Morte Súbita (o motor reinicia a partida) são trocadas por outra semente.
