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
