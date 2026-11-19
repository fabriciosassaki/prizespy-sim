# Ajuste automático dos bots dos oponentes

Rodadas completas: 10. Atualizado em 2026-11-19 03:00 UTC.

Vitória do Hide n' Sneak contra cada oponente. Quanto **menor**, mais forte está o bot do oponente.
O ajuste procura o bot do oponente que mais ganha; o alvo dos Regionais é só conferência.

| Oponente | v8 (rodada 0) | Campeão atual (última rodada) | Alvo Regionais | Trocas aceitas | Rodadas sem melhora | Parâmetros mudados desde o v8 |
|---|---|---|---|---|---|---|
| Dragapult | 58.4% ±2.5 | 56.3% ±2.5 (3975 partidas) | 52.0% | 2 | 3 | vivo 5→2.79, energiaTirada 30→200, risco 800→213.54 |
| Basic Box | 43.9% ±2.0 | 43.3% ±2.0 (3987 partidas) | 38.0% | 0 | 10 | — |
| Slowking | 89.9% ±1.2 | 79.6% ±1.6 (3680 partidas) | 62.0% | 2 | 8 | desliga energia, desliga slowpoke, adianta lillie |
| Alakazam Dudunsparce | 58.3% ±2.2 | 52.1% ±2.4 (4297 partidas) | 62.0% | 1 | 4 | risco 800→406.131, banco 4→5 |
| Ogerpon Meganium Hydrapple | 46.6% ±2.0 | 40.8% ±2.0 (3995 partidas) | 31.0% | 0 | 10 | — |
| N's Zoroark | 42.5% ±1.6 | 43.8% ±1.8 (3679 partidas) | 19.0% | 0 | 10 | — |
| Mega Rayquaza | 53.0% ±2.2 | 47.6% ±2.4 (3993 partidas) | 42.0% | 2 | 6 | baixa 60→42.24, desliga golden, desliga sobe-kanga |
| Mega Excadrill | 63.7% ±1.6 | 64.8% ±1.6 (3672 partidas) | 43.0% | 0 | 10 | — |
| Dragapult Blaziken | 51.8% ±1.8 | 51.0% ±2.0 (3674 partidas) | 34.0% | 1 | 9 | energiaTirada 30→97.155 |

## Trocas aceitas

- Rodada 1, Dragapult: energiaTirada 30→54.441, risco 800→213.54 (o HnS cai 1.0 ±0.6 pontos)
- Rodada 6, Dragapult: vivo 5→2.79, energiaTirada 54.441→200 (o HnS cai 1.3 ±0.8 pontos)
- Rodada 0, Slowking: desliga slowpoke (o HnS cai 1.5 ±1.0 pontos)
- Rodada 1, Slowking: desliga energia, adianta lillie (o HnS cai 13.8 ±1.6 pontos)
- Rodada 5, Alakazam Dudunsparce: risco 800→406.131, banco 4→5 (o HnS cai 3.4 ±1.8 pontos)
- Rodada 1, Mega Rayquaza: baixa 60→42.24, desliga golden (o HnS cai 2.3 ±1.6 pontos)
- Rodada 3, Mega Rayquaza: desliga sobe-kanga (o HnS cai 2.6 ±1.0 pontos)
- Rodada 0, Dragapult Blaziken: energiaTirada 30→97.155 (o HnS cai 1.6 ±0.6 pontos)

O campeão de cada rodada joga de novo na rodada seguinte, com sementes novas: uma troca que foi sorte some sozinha na tabela.
Parâmetros: `K_PADRAO` em `motor/src/bot-arquetipo.js`. Estado completo: `ajuste/estado.json`. Detalhe por rodada: `ajuste/rodadas/`.
