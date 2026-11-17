# Ajuste automático dos bots dos oponentes

Rodadas completas: 3. Atualizado em 2026-11-17 10:50 UTC.

Vitória do Hide n' Sneak contra cada oponente. Quanto **menor**, mais forte está o bot do oponente.
O ajuste procura o bot do oponente que mais ganha; o alvo dos Regionais é só conferência.

| Oponente | v8 (rodada 0) | Campeão atual (última rodada) | Alvo Regionais | Trocas aceitas | Rodadas sem melhora | Parâmetros mudados desde o v8 |
|---|---|---|---|---|---|---|
| Dragapult | 58.4% ±2.5 | 58.7% ±2.4 (4763 partidas) | 52.0% | 1 | 1 | energiaTirada 30→54.441, risco 800→213.54 |
| Basic Box | 43.9% ±2.0 | 45.5% ±2.0 (4793 partidas) | 38.0% | 0 | 3 | — |
| Slowking | 89.9% ±1.2 | 75.8% ±1.6 (4427 partidas) | 62.0% | 2 | 1 | desliga energia, desliga slowpoke, adianta lillie |
| Alakazam Dudunsparce | 58.3% ±2.2 | 56.8% ±2.2 (5231 partidas) | 62.0% | 0 | 3 | — |
| Ogerpon Meganium Hydrapple | 46.6% ±2.0 | 45.7% ±2.0 (4792 partidas) | 31.0% | 0 | 3 | — |
| N's Zoroark | 42.5% ±1.6 | 43.6% ±1.6 (4423 partidas) | 19.0% | 0 | 3 | — |
| Mega Rayquaza | 53.0% ±2.2 | 48.9% ±2.2 (4788 partidas) | 42.0% | 1 | 1 | baixa 60→42.24, desliga golden |
| Mega Excadrill | 63.7% ±1.6 | 62.5% ±1.4 (4420 partidas) | 43.0% | 0 | 3 | — |
| Dragapult Blaziken | 51.8% ±1.8 | 51.8% ±1.8 (4425 partidas) | 34.0% | 1 | 2 | energiaTirada 30→97.155 |

## Trocas aceitas

- Rodada 1, Dragapult: energiaTirada 30→54.441, risco 800→213.54 (o HnS cai 1.0 ±0.6 pontos)
- Rodada 0, Slowking: desliga slowpoke (o HnS cai 1.5 ±1.0 pontos)
- Rodada 1, Slowking: desliga energia, adianta lillie (o HnS cai 13.8 ±1.6 pontos)
- Rodada 1, Mega Rayquaza: baixa 60→42.24, desliga golden (o HnS cai 2.3 ±1.6 pontos)
- Rodada 0, Dragapult Blaziken: energiaTirada 30→97.155 (o HnS cai 1.6 ±0.6 pontos)

O campeão de cada rodada joga de novo na rodada seguinte, com sementes novas: uma troca que foi sorte some sozinha na tabela.
Parâmetros: `K_PADRAO` em `motor/src/bot-arquetipo.js`. Estado completo: `ajuste/estado.json`. Detalhe por rodada: `ajuste/rodadas/`.
