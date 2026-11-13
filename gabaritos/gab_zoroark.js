// Gabarito do N's Zoroark: cada situação monta uma posição no motor, deixa o bot jogar o turno e confere a jogada.
// Fontes: logs reais (z1 Absolutezere, z2 Haagensen, z3 PlayerB, z4 Jamalcalde) e guias (CardForge, note.com, Deltia).
process.env.BUNDLE = process.env.BUNDLE || require('path').join(__dirname, '..', 'solver.min.js');
const { M, G, card, novoJogo, lista, grande } = require('./h.js');
// P/E tiram a carta dos baralhos reais da partida montada (primeiro o meu, depois o do oponente); só criam se nenhum tiver
let CTX = null;
const P = n => { if (CTX) for (const p of CTX) { const zonas = [p.deck, p.hand, p.discard, ...p.prizes, p.active, ...p.bench];
  for (const z of zonas) { const i = z.cards.findIndex(c => c.name === n); if (i >= 0) return z.cards.splice(i, 1)[0]; } } return card(M.pick(n)); };
const E = n => P(n + ' Energy');
const vazio = () => lista([]);
// Baralhos reais: o Zoroark mais jogado (plano.json) contra o Rahul. As cartas da situação saem desses baralhos
// (cartas criadas fora do baralho não passam nas checagens do motor, como a da Poffin).
const SM = require('../sim_meta.js'); const fs = require('fs');
const B = M && Solver.O.deCompacto(JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'listas_solver.json'))));
const PL = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'plano.json'))); const LZ = B.listas[PL.arquetipos.find(a => a.a === 'n-zoroark').listas[0].i];
const EXTRA = ["N's Reshiram", 'Riolu', 'Raging Bolt ex', 'Okidogi ex', 'Meowth ex', 'Fezandipiti ex', 'Special Red Card', 'Dhelmise', 'Shuppet'];
function novoJogoReal() {
  const store = new M.Store({ onStateChange() {} }); const arb = new M.BotArbiter({ flipMode: M.BotFlipMode.RANDOM, shuffleMode: M.BotShuffleMode.RANDOM });
  store.dispatch(new G.AddPlayerAction(1, 'zor', SM.deckDe(LZ))); store.dispatch(new G.AddPlayerAction(2, 'hns', SM.deckRahul()));
  const bots = { 1: new M.BotPlano({ id: 1 }), 2: new M.BotPlano({ id: 2 }) };
  for (let n = 0; n < 300; n++) { const st = store.state; if (st.phase === G.GamePhase.PLAYER_TURN && !st.prompts.some(p => p.result === undefined)) break;
    let a; for (const p of st.prompts.filter(p => p.result === undefined)) { a = arb.resolvePrompt(st, p); if (a) break; }
    if (!a) for (const id of [1, 2]) { a = bots[id].decodeNextAction(st); if (a) break; } if (!a) break; store.dispatch(a); }
  return { store, arb };
}
// tira do jogo (baralho, mão, prêmios, descarte, campo) uma carta com esse nome; se não houver, cria (só para cartas de fora da lista)
function tira(p, nome) {
  const zonas = [p.deck, p.hand, p.discard, ...p.prizes, p.active, ...p.bench];
  for (const z of zonas) { const i = z.cards.findIndex(c => c.name === nome); if (i >= 0) return z.cards.splice(i, 1)[0]; }
  return card(M.pick(nome));
}
function turno(montar, opts = {}) {
  const { store, arb } = novoJogoReal(); const s = store.state;
  const me = s.players.find(p => p.id === 1), op = s.players.find(p => p.id === 2);
  s.activePlayer = s.players.indexOf(me);
  // tudo o que estava em jogo volta para o baralho; a situação monta o resto
  for (const p of [me, op]) { for (const l of [p.active, ...p.bench]) { p.deck.cards.push(...l.cards); } p.deck.cards.push(...p.hand.cards); p.hand.cards = []; p.active = vazio(); p.bench = [0, 1, 2, 3, 4].map(vazio); }
  s.turn = opts.turno || 6; me.discard.cards = []; me.energyPlayedTurn = 0; me.supporterTurn = 0;
  const T = n => tira(me, n), O = n => tira(op, n); CTX = [me, op];
  montar(me, op, s, T, O);
  const bot = M.criarBot({ id: me.id }, 'n-zoroark'); const outro = new M.BotPlano({ id: op.id });
  const log = []; const nome = l => l && l.getPokemonCard && l.getPokemonCard() ? l.getPokemonCard().name : '-';
  for (let n = 0; n < 200; n++) {
    const st = store.state; if (st.phase === G.GamePhase.FINISHED) break;
    const un = st.prompts.filter(p => p.result === undefined);
    if (!un.length && st.players[st.activePlayer].id !== me.id) break;      // o turno acabou
    let a; for (const p of un) { a = arb.resolvePrompt(st, p); if (a) break; }
    if (!a) { const p = un[0]; a = p ? (p.playerId === me.id ? bot.resolver(st, p) : outro.resolver(st, p)) : bot.decodeNextAction(st); }
    if (!a) break;
    const eu = st.players.find(p => p.id === me.id);
    if (a.type === 'PLAY_CARD_ACTION') { const c = eu.hand.cards[a.handIndex]; const t = a.target || {}; log.push(`joga ${c && c.name}${t.slot === G.SlotType.BENCH ? '→banco' + t.index + '(' + nome(eu.bench[t.index]) + ')' : t.slot === G.SlotType.ACTIVE ? '→ativo(' + nome(eu.active) + ')' : ''}`); }
    else if (a.type === 'ATTACK_ACTION') log.push(`ATAQUE ${a.name}`);
    else if (a.type === 'USE_ABILITY_ACTION') log.push(`hab ${a.ability || a.name}`);
    else if (a.type === 'RETREAT_ACTION') log.push(`recua → ${nome(eu.bench[a.benchIndex])}`);
    else if (a.type === 'RESOLVE_PROMPT' && a.result && a.result.name && a.result.cost) log.push(`copia ${a.result.name}`);
    else if (a.type === 'RESOLVE_PROMPT' && Array.isArray(a.result) && a.result[0] && a.result[0].getPokemonCard && un[0] && un[0].playerType === G.PlayerType.TOP_PLAYER) log.push(`chefia → ${nome(a.result[0])}`);
    if (a.type === 'RESOLVE_PROMPT' && un[0] && un[0].cards && Array.isArray(a.result)) log.push('  escolhe [' + a.result.map(x => x && x.name).join(',') + '] ' + un[0].message);
    try { store.dispatch(a); } catch (e) { log.push('RECUSADA ' + e.message); try { store.dispatch(new G.PassTurnAction(me.id)); } catch (e2) {} }
  }
  const st = store.state; const eu = st.players.find(p => p.id === me.id), ele = st.players.find(p => p.id === op.id);
  return { log, eu, ele, premios: 6 - eu.prizes.reduce((n, l) => n + l.cards.length, 0) - (opts.premiosAntes || 0), st };
}
// prêmios: começa com 6 em cada lado (o novoJogo já distribuiu)
const casos = [];
const caso = (id, desc, fonte, montar, confere, opts) => casos.push({ id, desc, fonte, montar, confere, opts });
const temNoJogo = (p, n) => [p.active, ...p.bench].filter(l => l.cards.length && l.getPokemonCard().name === n).length;
const en = l => l.cards.filter(c => c instanceof G.EnergyCard).length;

caso('Z01', 'Abertura T1 (2º jogador): Poffin em 2 Zorua, Poké Pad no Zekrom, Zekrom no banco, energia num Zorua', 'z1 T1, z3 T1, CardForge "turn one"',
  (me, op, s) => { s.turn = 2; me.active = lista([P("N's Zorua")]); me.hand.cards = [P('Buddy-Buddy Poffin'), P('Poké Pad'), E('Darkness'), P("Lillie's Determination"), P('Ultra Ball')];
    me.deck.cards = [P("N's Zorua"), P("N's Zorua"), P("N's Zekrom"), P("N's Zoroark ex"), P("N's Zoroark ex"), P('Poltchageist'), P('Budew'), ...Array.from({ length: 30 }, () => E('Darkness'))]; op.active = lista([P('Dhelmise')]); },
  r => { const z = temNoJogo(r.eu, "N's Zorua"), k = temNoJogo(r.eu, "N's Zekrom"); const e = [r.eu.active, ...r.eu.bench].filter(l => l.cards.length && l.getPokemonCard().name === "N's Zorua" && en(l) > 0).length;
    return [z >= 3 && k >= 1 && e >= 1, `Zorua ${z} (quer 3), Zekrom ${k} (quer 1), Zorua com energia ${e} (quer 1)`]; }, { turno: 2 });

caso('Z02', 'T2: evoluir, ligar a 2ª energia, Chefia no Básico que vai evoluir e nocautear com Night Joker', 'z1 T2 (Boss no Riolu + Rampaging Thunder)',
  (me, op) => { me.active = lista([P("N's Zorua"), E('Darkness')]); me.bench[0] = lista([P("N's Zekrom")]); me.bench[1] = lista([P("N's Zorua")]);
    me.hand.cards = [P("N's Zoroark ex"), E('Darkness'), P("Boss's Orders")];
    op.active = lista([grande(P('Dunsparce'))]); op.bench[0] = lista([P('Riolu')]); op.bench[1] = lista([P('Riolu')]); },
  r => [r.premios >= 1 && r.log.some(l => /chefia → Riolu/.test(l)), `prêmios ${r.premios} (quer 1), Chefia: ${r.log.filter(l => /chefia|ATAQUE|copia/.test(l)).join(', ')}`], { turno: 4 });

caso('Z03', 'Dhelmise (140, fraco a {D}) no ativo: Shred (140 com fraqueza) nocauteia sem travar o Zoroark', 'Deltia (fraqueza {D}); z1 T5 usa Shred quando basta',
  (me, op) => { me.active = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]); me.bench[0] = lista([P("N's Zekrom")]); me.bench[1] = lista([P("N's Reshiram")]);
    op.active = lista([P('Dhelmise'), E('Psychic')]); op.bench[0] = lista([P('Shuppet')]); },
  r => [r.premios >= 1 && r.log.some(l => /copia (Shred|Virtuous Flame)/.test(l)), `prêmios ${r.premios}, ${r.log.filter(l => /copia|ATAQUE/.test(l)).join(', ')} (quer Shred ou Virtuous Flame, não Rampaging)`]);

caso('Z04', 'Alvo de 250 HP e outro Zoroark pronto no banco: Rampaging Thunder é a jogada', 'z1 T2/T4, z2 T3, z4 T8',
  (me, op) => { me.active = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]); me.bench[0] = lista([P("N's Zekrom")]); me.bench[1] = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]);
    op.active = lista([P('Raging Bolt ex')]); op.active.getPokemonCard().weakness = []; },
  r => [r.premios >= 2, `prêmios ${r.premios} (quer 2), ${r.log.filter(l => /copia|ATAQUE/.test(l)).join(', ')}`]);

caso('Z05', 'Rodízio: Zoroark ativo travado pelo Rampaging Thunder, Zoroark do banco pronto e N\'s Castle em jogo → troca e ataca', 'z1 T3-T4 (recua e ataca com outro), guias (Castle = recuo grátis)',
  (me, op, s) => { const a = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]); me.active = a; me.bench[0] = lista([P("N's Zekrom")]); me.bench[1] = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]);
    me.hand.cards = [P("N's Castle")]; op.active = lista([P('Dhelmise'), E('Psychic')]);
    a.marker && a.marker.addMarker && a.marker.addMarker('RAMPAGING_THUNDER_MARKER', a.getPokemonCard()); },
  r => [r.premios >= 1, `prêmios ${r.premios} (quer 1), ${r.log.join(', ')}`]);

caso('Z06', 'Alvo de 170 HP: Reshiram na mão, Zekrom no banco → baixar o Reshiram e copiar o Virtuous Flame (sem travar)', 'note.com (Reshiram só no turno de uso), z2 T4-T5, z4 T5-T6',
  (me, op) => { me.active = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]); me.bench[0] = lista([P("N's Zekrom")]); me.bench[1] = lista([P("N's Zorua")]);
    me.hand.cards = [P("N's Reshiram")]; op.active = lista([P('Okidogi ex')]); op.active.damage = 80; op.active.getPokemonCard().weakness = []; op.active.getPokemonCard().resistance = []; },
  r => [r.premios >= 2 && r.log.some(l => /copia Virtuous Flame/.test(l)), `prêmios ${r.premios}, ${r.log.filter(l => /Reshiram|copia|ATAQUE/.test(l)).join(', ')}`]);

caso('Z07', 'N\'s PP Up: Darkness no descarte e Zoroark do banco com 1 energia → PP Up nele', 'z1 T4/T6, z2 T2, CardForge (PP Up + ligação manual)',
  (me, op) => { me.active = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]); me.bench[0] = lista([P("N's Zekrom")]); me.bench[1] = lista([P("N's Zoroark ex"), E('Darkness')]);
    me.hand.cards = [P("N's PP Up")]; me.discard.cards = [E('Darkness')]; op.active = lista([grande(P('Dunsparce'))]); },
  r => { const b = r.eu.bench.find(l => l.cards.length && l.getPokemonCard().name === "N's Zoroark ex"); return [b && en(b) >= 2, `energias no Zoroark do banco: ${b ? en(b) : '?'} (quer 2)`]; });

caso('Z08', 'Special Red Card guardada com o oponente a 6 prêmios', 'CardForge ("hold Special Red Card until 3 or fewer Prizes")',
  (me, op) => { me.active = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]); me.bench[0] = lista([P("N's Zekrom")]);
    me.hand.cards = [P('Special Red Card'), P('Poké Pad'), P('Ultra Ball')]; op.active = lista([P('Dhelmise'), E('Psychic')]); op.hand.cards = [P('Shuppet'), P('Shuppet'), P('Shuppet'), P('Shuppet'), P('Shuppet')]; },
  r => [!r.log.some(l => /Special Red Card/.test(l)), r.log.filter(l => /Special Red/.test(l)).join(', ') || 'guardou']);

caso('Z09', 'Não baixar Pokémon ex de suporte sem uso (Meowth ex, Fezandipiti ex) com o banco já montado', 'CardForge ("don\'t bench Pokémon ex before you need them")',
  (me, op) => { me.active = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]); me.bench[0] = lista([P("N's Zekrom")]); me.bench[1] = lista([P("N's Zoroark ex")]);
    me.hand.cards = [P('Meowth ex'), P('Fezandipiti ex'), P("Lillie's Determination")]; op.active = lista([P('Dhelmise'), E('Psychic')]); },
  r => [!r.log.some(l => /joga (Meowth ex|Fezandipiti ex)/.test(l)), r.log.filter(l => /Meowth|Fezandipiti/.test(l)).join(', ') || 'não baixou']);

caso('Z10', 'Contra HnS: nocautear o Dhelmise ativo (não um Shuppet do banco com Chefia)', 'dedução das cartas + guias (Dhelmise é o atacante; 1 prêmio cada)',
  (me, op) => { me.active = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]); me.bench[0] = lista([P("N's Zekrom")]);
    me.hand.cards = [P("Boss's Orders")]; op.active = lista([P('Dhelmise'), E('Psychic')]); op.bench[0] = lista([P('Shuppet')]); op.bench[1] = lista([P('Dhelmise')]); },
  r => [r.premios >= 1 && !r.log.some(l => /chefia → Shuppet/.test(l)), `prêmios ${r.premios}, ${r.log.filter(l => /chefia|copia/.test(l)).join(', ')}`]);

caso('Z11', 'Fim de jogo com baralho curto: não usar Trade (2 cartas por uso) e arriscar perder por baralho vazio', 'lição do deck-out (12 de 12 derrotas da v2); z3 T9 só usa Trade com baralho sobrando',
  (me, op) => { me.active = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]); me.bench[0] = lista([P("N's Zekrom")]); me.bench[1] = lista([P("N's Zoroark ex"), E('Darkness')]);
    me.hand.cards = [P('Poké Pad')]; const resto = me.deck.cards.splice(0); me.deck.cards = resto.slice(0, 7); op.active = lista([grande(P('Dunsparce'))]); },
  r => [!r.log.some(l => /hab Trade/.test(l)), r.log.filter(l => /Trade/.test(l)).join(', ') || 'não usou Trade']);

caso('Z12', 'Rodízio com Pecharunt: Zorua ativo sem energia, Zoroark pronto no banco → Subjugating Chains e ataca', 'z2 T3, z4 T4 (Chains para subir o Zoroark montado no banco)',
  (me, op) => { me.active = lista([P("N's Zorua")]); me.bench[0] = lista([P("N's Zekrom")]); me.bench[1] = lista([P("N's Zoroark ex"), E('Darkness'), E('Darkness')]); me.bench[2] = lista([P('Pecharunt ex')]);
    me.hand.cards = []; op.active = lista([P('Dhelmise'), E('Psychic')]); },
  r => [r.premios >= 1 && r.log.some(l => /hab Subjugating Chains/.test(l)), `prêmios ${r.premios}, ${r.log.filter(l => /Chains|ATAQUE|copia/.test(l)).join(', ')}`]);

let ok = 0;
for (const c of casos.filter(c => !process.env.SO || process.env.SO.split(",").includes(c.id))) {
  let r, res;
  try { r = turno(c.montar, c.opts || {}); res = c.confere(r); } catch (e) { res = [false, 'ERRO ' + e.message]; }
  if (res[0]) ok++;
  console.log(`${res[0] ? '✔' : '✘'} ${c.id} ${c.desc}\n     ${res[1]}`);
  if (!res[0] && process.env.V) console.log('     jogadas: ' + r.log.join(' | '));
}
console.log(`\nacertou ${ok} de ${casos.length}`);
