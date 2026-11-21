// Fase 0 da IA: jogadas candidatas com descrição estável ("ene:Telepathic Psychic Energy:B2", "ataque:Vengeful Anchor").
// As candidatas NÃO são conferidas no motor (seria caro): a rede dá nota para todas e, na hora de jogar,
// tenta da maior para a menor até o motor aceitar, como os bots fazem.
function criar(G) {
  const T = (p, l) => l === p.active ? { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.ACTIVE, index: 0 }
                                     : { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: p.bench.indexOf(l) };
  const BOARD = { player: G.PlayerType.ANY, slot: G.SlotType.BOARD, index: 0 };
  const rot = (p, l) => l === p.active ? 'A' : 'B' + p.bench.indexOf(l);
  const emJogo = p => [p.active, ...p.bench].filter(l => l.cards.length);
  const tipoTreinador = c => c.trainerType === G.TrainerType.SUPPORTER ? 'apoio' : c.trainerType === G.TrainerType.STADIUM ? 'est'
    : c.trainerType === G.TrainerType.TOOL ? 'ferr' : 'item';

  function candidatos(state, p) {
    const R = [], vistos = new Set(), jog = emJogo(p), vaga = p.bench.findIndex(l => !l.cards.length), t = state.turn;
    const add = (d, a) => { if (!vistos.has(d)) { vistos.add(d); R.push({ d, a }); } };
    p.hand.cards.forEach((c, i) => {
      if (c instanceof G.PokemonCard) {
        if (c.stage === G.Stage.BASIC && vaga >= 0) add('banco:' + c.name, () => new G.PlayCardAction(p.id, i, { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: vaga }));
        if (c.evolvesFrom) jog.forEach(l => { const q = l.getPokemonCard(); if (q && q.name === c.evolvesFrom) add(`evo:${c.name}:${rot(p, l)}`, () => new G.PlayCardAction(p.id, i, T(p, l))); });
      } else if (c instanceof G.EnergyCard) {
        if (p.energyPlayedTurn !== t) jog.forEach(l => add(`ene:${c.name}:${rot(p, l)}`, () => new G.PlayCardAction(p.id, i, T(p, l))));
      } else if (c instanceof G.TrainerCard) {
        const k = tipoTreinador(c);
        if (k === 'ferr') jog.forEach(l => { if (!(l.tools || []).length) add(`ferr:${c.name}:${rot(p, l)}`, () => new G.PlayCardAction(p.id, i, T(p, l))); });
        else if (k === 'apoio') { if (p.supporterTurn !== t) add('apoio:' + c.name, () => new G.PlayCardAction(p.id, i, BOARD)); }
        else add(`${k}:${c.name}`, () => new G.PlayCardAction(p.id, i, BOARD));
      }
    });
    jog.forEach(l => { const q = l.getPokemonCard(); if (!q) return;
      for (const pw of q.powers || []) if (pw.useWhenInPlay) add(`hab:${pw.name}:${rot(p, l)}`, () => new G.UseAbilityAction(p.id, pw.name, T(p, l))); });
    if (G.StateUtils.getStadiumCard(state) && p.stadiumUsedTurn !== t) add('usaest', () => new G.UseStadiumAction(p.id));
    if (p.retreatedTurn !== t) p.bench.forEach((l, k) => { if (l.cards.length) add('recuo:B' + k, () => new G.RetreatAction(p.id, k)); });
    const at = p.active.getPokemonCard();
    if (at) for (const a of at.attacks || []) add('ataque:' + a.name, () => new G.AttackAction(p.id, a.name));
    add('passar', () => new G.PassTurnAction(p.id));
    return R;
  }

  // A jogada que um bot devolveu, na mesma descrição. null = algo fora do vocabulário (vai para a contagem de cobertura).
  function descrever(state, p, x) {
    if (!x) return null;
    const alvo = tg => !tg ? '?' : tg.slot === G.SlotType.ACTIVE ? 'A' : tg.slot === G.SlotType.BENCH ? 'B' + tg.index : '?';
    if (x instanceof G.PassTurnAction) return 'passar';
    if (x instanceof G.AttackAction) return 'ataque:' + x.name;
    if (x instanceof G.RetreatAction) return 'recuo:B' + x.benchIndex;
    if (x instanceof G.UseStadiumAction) return 'usaest';
    if (x instanceof G.UseAbilityAction) return `hab:${x.name}:${alvo(x.target)}`;
    if (x instanceof G.PlayCardAction) {
      const c = p.hand.cards[x.handIndex]; if (!c) return null;
      if (c instanceof G.PokemonCard) return x.target && x.target.slot === G.SlotType.BENCH && c.stage === G.Stage.BASIC && !(p.bench[x.target.index] || {}).cards?.length
        ? 'banco:' + c.name : `evo:${c.name}:${alvo(x.target)}`;
      if (c instanceof G.EnergyCard) return `ene:${c.name}:${alvo(x.target)}`;
      if (c instanceof G.TrainerCard) { const k = tipoTreinador(c); return k === 'ferr' ? `ferr:${c.name}:${alvo(x.target)}` : `${k}:${c.name}`; }
    }
    return null;
  }
  return { candidatos, descrever };
}
module.exports = { criar };
