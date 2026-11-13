# prizespy-sim

Simulador do PrizeSpy. O bot do Hide n' Sneak (lista do Rahul Reddy) joga contra os 10 arquétipos mais jogados do meta, com várias listas reais de cada um (Limitless), pesadas pela frequência e com todas as variações relevantes representadas.

## O que roda sozinho

O fluxo `.github/workflows/simular.yml` roda todo dia às 04:17 (Brasília), em 2 partes paralelas de 25 minutos. Ele:

1. joga as partidas que faltam para chegar à meta por lista (padrão: 60), retomando de onde parou;
2. grava as partidas novas em `resultados/<versão do bot>/`;
3. atualiza o `RESUMO.md` com a tabela por arquétipo e por variação (partidas e margem de erro).

Para rodar na hora: aba **Actions** → *Simular contra o meta* → **Run workflow**.

## Arquivos

- `sim_meta.js`: o simulador (`plano`, `rodar`, `resumo`, `ab`).
- `solver.min.js`: o motor (twinleaf) com os bots.
- `listas_solver.json`: as listas do meta. `plano.json`: os arquétipos, as listas e as variações escolhidas.
- `VERSAO`: a versão do bot. Cada versão nova grava os resultados numa pasta própria, para comparar com `node sim_meta.js ab resultados/v0 resultados/v1`.

## Rodar no computador

```
RES=resultados/v0 node sim_meta.js resumo
RES=resultados/v0 PRAZO=600 node sim_meta.js rodar 60
```
