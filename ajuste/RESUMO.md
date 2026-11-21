# Ajuste automático dos bots dos oponentes

Rodadas completas: 20. Atualizado em 2026-11-21 12:23 UTC.

Vitória do Hide n' Sneak contra cada oponente. Quanto **menor**, mais forte está o bot do oponente.
O ajuste procura o bot do oponente que mais ganha; o alvo dos Regionais é só conferência.

| Oponente | v8 (rodada 0) | Campeão atual (última rodada) | Alvo Regionais | Trocas aceitas | Rodadas sem melhora | Parâmetros mudados desde o v8 |
|---|---|---|---|---|---|---|
| Dragapult | 58.4% ±2.5 | 59.2% ±2.4 (5088 partidas) | 52.0% | 2 | 10 | vivo 5→2.79, energiaTirada 30→200, risco 800→213.54 |
| Basic Box | 43.9% ±2.0 | 42.7% ±1.8 (5112 partidas) | 38.0% | 0 | 17 | — |
| Slowking | 89.9% ±1.2 | 77.6% ±1.4 (4721 partidas) | 62.0% | 2 | 15 | desliga energia, desliga slowpoke, adianta lillie |
| Alakazam Dudunsparce | 58.3% ±2.2 | 48.2% ±2.0 (5496 partidas) | 62.0% | 2 | 6 | energiaPerdida 40→16.192, risco 800→406.131, banco 4→5 |
| Ogerpon Meganium Hydrapple | 46.6% ±2.0 | 44.2% ±1.8 (5140 partidas) | 31.0% | 0 | 17 | — |
| N's Zoroark | 42.5% ±1.6 | 45.5% ±1.6 (4716 partidas) | 19.0% | 0 | 17 | — |
| Mega Rayquaza | 53.0% ±2.2 | 47.3% ±2.2 (5139 partidas) | 42.0% | 2 | 13 | baixa 60→42.24, desliga golden, desliga sobe-kanga |
| Mega Excadrill | 63.7% ±1.6 | 66.1% ±1.4 (4715 partidas) | 43.0% | 0 | 17 | — |
| Dragapult Blaziken | 51.8% ±1.8 | 51.6% ±1.8 (4715 partidas) | 34.0% | 1 | 16 | energiaTirada 30→97.155 |

## Bot do Hide n' Sneak (fase atual)

Vitória média do HnS contra o campo (cada oponente pesa pela frequência no meta), com os oponentes nos campeões deles. Quanto **maior**, melhor o bot do HnS.

- Início: 55.4% ±0.8 · agora: 57.6% ±0.8 (40159 partidas) · trocas aceitas: 1 · rodadas sem melhora: 2
- Mudanças desde o início: adianta ultra, valor de Dhelmise 6→7

| Oponente | HnS no início | HnS agora |
|---|---|---|
| Dragapult | 54.7% | 60.3% |
| Basic Box | 43.8% | 45.5% |
| Dhelmise | 74.8% | 79.2% |
| Slowking | 78.3% | 79.1% |
| Alakazam Dudunsparce | 49.7% | 49.4% |
| Ogerpon Meganium Hydrapple | 43.2% | 44.2% |
| N's Zoroark | 44.0% | 44.0% |
| Mega Rayquaza | 45.4% | 47.3% |
| Mega Excadrill | 65.5% | 66.0% |
| Dragapult Blaziken | 52.1% | 51.3% |

As mudanças que o ajuste acha no bot do HnS são **hipóteses**: antes de irem para o playbook, conferir com as ideias do Rahul.
- Rodada 17: adianta ultra, valor de Dhelmise 6→7 (o HnS sobe 1.4 ±0.6 pontos no meta)

## Trocas aceitas nos oponentes

- Rodada 1, Dragapult: energiaTirada 30→54.441, risco 800→213.54 (o HnS cai 1.0 ±0.6 pontos)
- Rodada 6, Dragapult: vivo 5→2.79, energiaTirada 54.441→200 (o HnS cai 1.3 ±0.8 pontos)
- Rodada 0, Slowking: desliga slowpoke (o HnS cai 1.5 ±1.0 pontos)
- Rodada 1, Slowking: desliga energia, adianta lillie (o HnS cai 13.8 ±1.6 pontos)
- Rodada 5, Alakazam Dudunsparce: risco 800→406.131, banco 4→5 (o HnS cai 3.4 ±1.8 pontos)
- Rodada 10, Alakazam Dudunsparce: energiaPerdida 40→16.192 (o HnS cai 0.5 ±0.2 pontos)
- Rodada 1, Mega Rayquaza: baixa 60→42.24, desliga golden (o HnS cai 2.3 ±1.6 pontos)
- Rodada 3, Mega Rayquaza: desliga sobe-kanga (o HnS cai 2.6 ±1.0 pontos)
- Rodada 0, Dragapult Blaziken: energiaTirada 30→97.155 (o HnS cai 1.6 ±0.6 pontos)

O campeão de cada rodada joga de novo na rodada seguinte, com sementes novas: uma troca que foi sorte some sozinha na tabela.
Parâmetros: `K_PADRAO` em `motor/src/bot-arquetipo.js`. Estado completo: `ajuste/estado.json`. Detalhe por rodada: `ajuste/rodadas/`.
