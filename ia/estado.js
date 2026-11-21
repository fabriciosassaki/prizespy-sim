// Fase 0 da IA (claude/32_ia_fase0.md): o que um jogador vê, num JSON compacto.
// Do oponente, só o visível: campo, descarte, tamanho da mão e do baralho, prêmios. Nada de mão ou baralho escondidos.
// Nomes de carta em inglês, como no motor; o vocabulário é montado no treino.
function criar(G) {
  const slot = (l, turno) => {
    if (!l || !l.cards.length) return null;
    const p = l.getPokemonCard(); if (!p) return null;
    return {
      c: p.name,                                                                  // a carta de cima
      ev: l.cards.filter(x => x instanceof G.PokemonCard && x !== p).map(x => x.name),   // o que está embaixo (evolução)
      e: l.cards.filter(x => x instanceof G.EnergyCard).map(x => x.name),
      f: (l.tools || []).map(x => x.name),
      hp: p.hp, d: l.damage,
      st: (l.specialConditions || []).slice(),
      n: l.pokemonPlayedTurn === turno ? 1 : 0,                                   // entrou neste turno (não evolui nem é tirado da mão)
    };
  };
  const nomes = cl => cl.cards.map(c => c.name);
  function estado(state, i, info) {
    const t = state.turn, eu = state.players[i], ele = state.players[1 - i];
    const est = G.StateUtils.getStadiumCard(state);
    const lado = (p, meu) => ({
      a: slot(p.active, t), b: p.bench.map(l => slot(l, t)),
      mao: meu ? nomes(p.hand) : p.hand.cards.length,
      desc: nomes(p.discard), deck: p.deck.cards.length, pr: p.getPrizeLeft(),
      sup: p.supporterTurn === t ? 1 : 0, ene: p.energyPlayedTurn === t ? 1 : 0, rec: p.retreatedTurn === t ? 1 : 0,
    });
    return {
      t, vez: state.activePlayer === i ? 1 : 0,
      primeiro: (t % 2 === 1) === (state.activePlayer === i) ? 1 : 0,             // quem joga nos turnos ímpares começou
      est: est ? est.name : null, estMeu: est ? (G.StateUtils.findOwner(state, G.StateUtils.findCardList(state, est)) === eu ? 1 : 0) : 0,
      arq: info && info.arq || null, arqEle: info && info.arqEle || null,
      eu: lado(eu, true), ele: lado(ele, false),
    };
  }
  return { estado, slot };
}
module.exports = { criar };
