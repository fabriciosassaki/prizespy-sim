# Motor do simulador

`solver.min.js` (na raiz) é gerado a partir do twinleaf (github.com/twinleafgg/twinleafgg, commit `837aebeb`) com as correções de `correcoes-twinleaf-837aebeb.patch`:

| Carta | Erro no twinleaf | Correção |
|---|---|---|
| Rare Candy (MEG) | usava a Rare Candy da era ex: aceitava Estágio 1 e não tinha as travas | usa a de Escarlate e Violeta (só Estágio 2, não no Básico que entrou neste turno) e não pode no 1º turno de cada jogador |
| Metagross (CRI 61) | 170 de HP; Bounce Back trocava direto e o atacante escolhia | 180 de HP; a troca passa pelo efeito padrão (o oponente escolhe, e o Hide 'n' Sneak bloqueia) |
| N's Zekrom (Shred) e Dudunsparce ex (Destructive Drill) | ignoravam a Resistência e os bônus de quem ataca (Black Belt's Training, Binding Mochi) | `SHRED_DAMAGE`: só os efeitos no Ativo do oponente são ignorados |
| Combusken (DRI) | Combustion custava {R} | {C} |
| Chikorita (MEG) | Razor Leaf custava {C} | {G} |
| Torterra ex | Frenzy Plant curava 30 | cura 50 |
| busca de Pokémon para o banco | travava com o banco quase cheio | limita a escolha às vagas |

Auditoria de 13/11/2026 (209 cartas das listas simuladas, contra o pokemon-tcg-data oficial): HP, tipo, fraqueza, resistência, recuo, estágio, custo e dano conferem em todas. Os 144 ataques foram executados no motor; os 46 sem texto dão o dano impresso (e o dobro com Fraqueza), e os com texto foram revistos um a um.

Para gerar de novo: compilar o twinleaf com o patch (`npx tsc -p tsconfig.json` em `ptcg-server`) e rodar `sh compilar.sh` nesta pasta.
