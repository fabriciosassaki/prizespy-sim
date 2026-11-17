# Ajuste automático dos bots dos oponentes

Rodadas completas: 2. Atualizado em 2026-11-17 05:06 UTC.

Vitória do Hide n' Sneak contra cada oponente. Quanto **menor**, mais forte está o bot do oponente.
O ajuste procura o bot do oponente que mais ganha; o alvo dos Regionais é só conferência.

| Oponente | v8 (rodada 0) | Campeão atual (última rodada) | Alvo Regionais | Trocas aceitas | Rodadas sem melhora | Parâmetros mudados desde o v8 |
|---|---|---|---|---|---|---|
| Dragapult | 58.4% ±2.5 | 60.7% ±2.4 (4956 partidas) | 52.0% | 1 | 0 | energiaTirada 30→54.441, risco 800→213.54 |
| Basic Box | 43.9% ±2.0 | 43.7% ±1.8 (4977 partidas) | 38.0% | 0 | 2 | — |
| Slowking | 89.9% ±1.2 | 88.8% ±1.2 (4561 partidas) | 62.0% | 2 | 0 | desliga energia, desliga slowpoke, adianta lillie |
| Alakazam Dudunsparce | 58.3% ±2.2 | 57.7% ±2.2 (5303 partidas) | 62.0% | 0 | 2 | — |
| Ogerpon Meganium Hydrapple | 46.6% ±2.0 | 46.4% ±1.8 (4930 partidas) | 31.0% | 0 | 2 | — |
| N's Zoroark | 42.5% ±1.6 | 44.0% ±1.6 (4565 partidas) | 19.0% | 0 | 2 | — |
| Mega Rayquaza | 53.0% ±2.2 | 53.5% ±2.2 (4936 partidas) | 42.0% | 1 | 0 | baixa 60→42.24, desliga golden |
| Mega Excadrill | 63.7% ±1.6 | 63.4% ±1.4 (4560 partidas) | 43.0% | 0 | 2 | — |
| Dragapult Blaziken | 51.8% ±1.8 | 50.1% ±1.8 (4557 partidas) | 34.0% | 1 | 1 | energiaTirada 30→97.155 |

## Trocas aceitas

- Rodada 1, Dragapult: energiaTirada 30→54.441, risco 800→213.54 (o HnS cai 1.0 ±0.6 pontos)
- Rodada 0, Slowking: desliga slowpoke (o HnS cai 1.5 ±1.0 pontos)
- Rodada 1, Slowking: desliga energia, adianta lillie (o HnS cai 13.8 ±1.6 pontos)
- Rodada 1, Mega Rayquaza: baixa 60→42.24, desliga golden (o HnS cai 2.3 ±1.6 pontos)
- Rodada 0, Dragapult Blaziken: energiaTirada 30→97.155 (o HnS cai 1.6 ±0.6 pontos)

O campeão de cada rodada joga de novo na rodada seguinte, com sementes novas: uma troca que foi sorte some sozinha na tabela.
Parâmetros: `K_PADRAO` em `motor/src/bot-arquetipo.js`. Estado completo: `ajuste/estado.json`. Detalhe por rodada: `ajuste/rodadas/`.
