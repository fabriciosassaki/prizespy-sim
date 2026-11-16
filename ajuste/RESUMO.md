# Ajuste automático dos bots dos oponentes

Rodadas completas: 1. Atualizado em 2026-11-16 23:22 UTC.

Vitória do Hide n' Sneak contra cada oponente. Quanto **menor**, mais forte está o bot do oponente.
O ajuste procura o bot do oponente que mais ganha; o alvo dos Regionais é só conferência.

| Oponente | v8 (rodada 0) | Campeão atual (última rodada) | Alvo Regionais | Trocas aceitas | Rodadas sem melhora | Parâmetros mudados desde o v8 |
|---|---|---|---|---|---|---|
| Dragapult | 58.4% ±2.5 | 58.4% ±2.5 (4500 partidas) | 52.0% | 0 | 1 | — |
| Basic Box | 43.9% ±2.0 | 43.9% ±2.0 (4510 partidas) | 38.0% | 0 | 1 | — |
| Slowking | 89.9% ±1.2 | 89.9% ±1.2 (4145 partidas) | 62.0% | 1 | 0 | desliga slowpoke |
| Alakazam Dudunsparce | 58.3% ±2.2 | 58.3% ±2.2 (4793 partidas) | 62.0% | 0 | 1 | — |
| Ogerpon Meganium Hydrapple | 46.6% ±2.0 | 46.6% ±2.0 (4490 partidas) | 31.0% | 0 | 1 | — |
| N's Zoroark | 42.5% ±1.6 | 42.5% ±1.6 (4140 partidas) | 19.0% | 0 | 1 | — |
| Mega Rayquaza | 53.0% ±2.2 | 53.0% ±2.2 (4497 partidas) | 42.0% | 0 | 1 | — |
| Mega Excadrill | 63.7% ±1.6 | 63.7% ±1.6 (4137 partidas) | 43.0% | 0 | 1 | — |
| Dragapult Blaziken | 51.8% ±1.8 | 51.8% ±1.8 (4137 partidas) | 34.0% | 1 | 0 | energiaTirada 30→97.155 |

## Trocas aceitas

- Rodada 0, Slowking: desliga slowpoke (o HnS cai 1.5 ±1.0 pontos)
- Rodada 0, Dragapult Blaziken: energiaTirada 30→97.155 (o HnS cai 1.6 ±0.6 pontos)

O campeão de cada rodada joga de novo na rodada seguinte, com sementes novas: uma troca que foi sorte some sozinha na tabela.
Parâmetros: `K_PADRAO` em `motor/src/bot-arquetipo.js`. Estado completo: `ajuste/estado.json`. Detalhe por rodada: `ajuste/rodadas/`.
