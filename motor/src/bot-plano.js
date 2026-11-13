// Bot genérico melhorado, para qualquer deck (usado no oponente das simulações).
// Os bots do motor (simples e advanced) atacam logo no começo do turno e não montam o campo.
// Este bot faz o turno em duas partes:
//   1. montagem com prioridades fixas, cada ação testada no motor antes: evoluir, Básicos no
//      banco (ex por último), habilidades (Teal Dance, Solar Transfer...), energia no Pokémon
//      mais perto de atacar, itens, Apoiador de compra, estádio;
//   2. plano do fim do turno, decidido por simulação: recuar para alguém do banco se o ataque
//      dele for melhor; Chefia só se pegar pelo menos 1 prêmio a mais; o ataque que pega mais
//      prêmios (empate: mais dano no ativo dele).
// Novo ativo: o Pokémon com o ataque mais forte pago agora ou com mais uma energia.
// Prompts que ele não trata (descartes, buscas, mover energia) ficam com o bot do motor.
// Interface igual à do SimpleTacticsAi: decodeNextAction(state) -> Action | undefined.
const OUT = '/home/claude/motor/twinleafgg/ptcg-server/output';
const G = require(OUT + '/game');
const { Simulator } = require(OUT + '/game/bots/simulator');
const { ChoosePokemonPrompt } = require(OUT + '/game/store/prompts/choose-pokemon-prompt');
const { SimpleTacticsAi } = require(OUT + '/simple-bot/simple-tactics-ai');
const { ActionSearchAi } = require(OUT + '/advanced-bot/action-search-ai');
const D = require(OUT + '/simple-bot/simple-bot-definitions');
const { BotShuffleMode, BotFlipMode } = require(OUT + '/game/bots/bot-arbiter');

const ARB = { flipMode: BotFlipMode.RANDOM, shuffleMode: BotShuffleMode.RANDOM };
const OPTS = { tactics: D.allSimpleTactics, promptResolvers: D.allPromptResolvers, scores: D.defaultStateScores, arbiter: ARB };
const BOARD = { player: G.PlayerType.ANY, slot: G.SlotType.BOARD, index: 0 };
const BOSS = "Boss's Orders";
const premiosRest = p => p.prizes.reduce((n, l) => n + l.cards.length, 0);
const emJogo = p => [p.active, ...p.bench].filter(l => l.cards.length > 0);
const nomeDe = l => { const c = l.getPokemonCard(); return c ? c.name : ''; };
const MAX_ACOES_TURNO = 60;

// Ataque mais forte que as energias ligadas já pagam (conta só a quantidade e o tipo básico).
function paga(lista, custo) {
  const tipos = []; lista.cards.filter(c => c instanceof G.EnergyCard).forEach(e => tipos.push(...(e.provides || [G.CardType.COLORLESS])));
  const sobra = tipos.slice();
  for (const t of custo.filter(t => t !== G.CardType.COLORLESS)) {
    const i = sobra.findIndex(x => x === t || x === G.CardType.ANY);
    if (i < 0) return false; sobra.splice(i, 1);
  }
  return sobra.length >= custo.filter(t => t === G.CardType.COLORLESS).length;
}
// Quantas energias faltam para pagar o custo (com tipo): tipos específicos primeiro, Incolor com o que sobra.
function falta(tiposTem, custo) {
  const sobra = tiposTem.slice(); let f = 0;
  for (const t of custo.filter(t => t !== G.CardType.COLORLESS)) {
    let i = sobra.findIndex(x => x === t); if (i < 0) i = sobra.findIndex(x => x === G.CardType.ANY);
    if (i < 0) f++; else sobra.splice(i, 1);
  }
  return f + Math.max(0, custo.filter(t => t === G.CardType.COLORLESS).length - sobra.length);
}
const tiposDe = lista => { const t = []; lista.cards.filter(c => c instanceof G.EnergyCard).forEach(e => t.push(...(e.provides || [G.CardType.COLORLESS]))); return t; };
// Menor falta entre os ataques do Pokémon, com energias extras (99 se não tem ataque)
function faltaMin(lista, extra = []) {
  const c = lista.getPokemonCard(); if (!c || !c.attacks.length) return 99;
  const t = tiposDe(lista).concat(extra); return Math.min(...c.attacks.map(a => falta(t, a.cost)));
}
// Falta para o ataque principal (os de dano >= 60% do maior); assim o Jet Headbutt (C) não esconde o Phantom Dive (R P)
function faltaPrincipal(lista, extra = []) {
  const c = lista.getPokemonCard(); if (!c || !c.attacks.length) return 99;
  const max = Math.max(...c.attacks.map(a => a.damage || 0));
  const ats = c.attacks.filter(a => (a.damage || 0) >= 0.6 * max);
  const t = tiposDe(lista).concat(extra); return Math.min(...ats.map(a => falta(t, a.cost)));
}
function forcaPronta(lista) {
  const c = lista.getPokemonCard(); if (!c) return 0;
  const danos = c.attacks.filter(a => paga(lista, a.cost)).map(a => a.damage || 10);
  return danos.length ? Math.max(...danos) : 0;
}
// Força no próximo turno: ataque pago agora, ou pago com mais 1 energia (a ligação do turno).
// Ataques que somam dano por energia contam o dano base mais 30 por energia ligada.
function forcaProxima(lista) {
  const c = lista.getPokemonCard(); if (!c) return 0;
  const tem = lista.cards.filter(x => x instanceof G.EnergyCard).length;
  let melhor = 0;
  for (const a of c.attacks) {
    if (a.cost.length > tem + 1) continue;
    const extra = /for each Energy|more damage for each/i.test(a.text || '') ? 30 * (tem + 1) : 0;
    melhor = Math.max(melhor, (a.damage || 10) + extra - (paga(lista, a.cost) ? 0 : 5));
  }
  return melhor;
}

class BotPlano {
  // base: 'busca' (advanced-bot: testa ações e olha até 3 jogadas à frente no turno) ou 'simples'
  constructor(client, base = process.env.BASE || 'busca') {
    this.client = client; this.base = base;
    this.simples = base === 'busca' ? new ActionSearchAi(client, OPTS, []) : new SimpleTacticsAi(client, OPTS, []);
    this.turno = -1; this.acoes = 0; this.alvoChefia = null; this.planejou = false; this.tentados = new Set();
  }
  eu(s) { return s.players.find(p => p.id === this.client.id); }
  // ganchos para os bots por arquétipo (bot-arquetipo.js)
  criarSombra() { return new BotPlano(this.client, 'simples'); }
  permitido(chave, acao, state) { return true; }
  limiteBanco() { return 4; }
  op(s) { return s.players.find(p => p.id !== this.client.id); }

  simular(state, acoes) {
    try {
      const sim = new Simulator(state, ARB);
      const outro = new SimpleTacticsAi({ id: this.op(state).id }, OPTS, []);
      const sombra = this.criarSombra(); sombra.alvoChefia = this.alvoChefia; sombra.turno = state.turn; sombra.planejou = true;
      for (const a of acoes) {
        sim.dispatch(a(sim.store.state));
        for (let i = 0; i < 40; i++) {
          const s = sim.store.state;
          const p = s.prompts.find(x => x.result === undefined);
          if (!p) break;
          const r = p.playerId === this.client.id ? sombra.resolver(s, p) : outro.decodeNextAction(s);
          if (!r) break;
          sim.dispatch(r);
        }
      }
      return sim.store.state;
    } catch (e) { if (process.env.DEBUG_BOT > 2) console.error("   simular:", e && e.message); return null; }
  }
  // nota de um resultado: prêmios pegos valem muito; depois o dano no ativo dele
  nota(antes, depois) {
    if (!depois) return -1e9;
    const meAntes = this.eu(antes), meDepois = depois.players.find(p => p.id === this.client.id);
    const opDepois = depois.players.find(p => p.id !== this.client.id);
    const premios = premiosRest(meAntes) - premiosRest(meDepois);
    return premios * 1000 + (opDepois.active.damage || 0);
  }
  ataques(state) { const c = this.eu(state).active.getPokemonCard(); return c ? c.attacks.map(a => a.name) : []; }

  melhorAtaque(state) {
    let melhor = null, nota = -1e8;
    for (const n of this.ataques(state)) {
      const v = this.nota(state, this.simular(state, [() => new G.AttackAction(this.client.id, n)]));
      if (v > nota) { nota = v; melhor = n; }
    }
    return melhor ? { nome: melhor, nota } : null;
  }
  planoChefia(state, notaSem) {
    const me = this.eu(state), op = this.op(state);
    if (me.supporterTurn || me.hand.cards.findIndex(c => c.name === BOSS) < 0) return null;
    let melhor = null, nota = notaSem;
    for (const l of op.bench.filter(x => x.cards.length > 0)) {
      const id = l.getPokemonCard().id;
      for (const n of this.ataques(state)) {
        const ant = this.alvoChefia; this.alvoChefia = id;
        const v = this.nota(state, this.simular(state, [s => new G.PlayCardAction(me.id, s.players.find(p => p.id === me.id).hand.cards.findIndex(c => c.name === BOSS), BOARD),
          () => new G.AttackAction(me.id, n)]));
        this.alvoChefia = ant;
        if (v >= nota + 1000) { nota = v; melhor = id; }   // só vale se pegar pelo menos 1 prêmio a mais
      }
    }
    return melhor;
  }

  resolver(state, prompt) {
    const me = this.eu(state);
    // O bot do motor responde "não" a todo ConfirmPrompt: recusava o Last-Ditch Catch do Meowth ex, o Rapid Vernier,
    // as habilidades "pode" de quase todo deck. Aqui é "sim", menos na escolha de ir primeiro.
    if (prompt instanceof G.ConfirmPrompt && prompt.message !== G.GameMessage.GO_FIRST) return new G.ResolvePromptAction(prompt.id, true);
    if (prompt instanceof ChoosePokemonPrompt) {
      const deles = prompt.playerType === G.PlayerType.TOP_PLAYER;
      if (deles && this.alvoChefia) {
        const l = emJogo(this.op(state)).find(x => x.getPokemonCard() && x.getPokemonCard().id === this.alvoChefia);
        if (l) { this.alvoChefia = null; return new G.ResolvePromptAction(prompt.id, [l]); }
      }
      if (!deles && prompt.message === G.GameMessage.CHOOSE_NEW_ACTIVE_POKEMON) {
        const ops = me.bench.filter(l => l.cards.length > 0);
        if (ops.length) {
          const v = l => forcaProxima(l) * 10 + (l.hp - l.damage) / 10 - (l.getPokemonCard().tags.some(t => t === 'ex' || t === 'Mega ex') && forcaProxima(l) === 0 ? 300 : 0);
          ops.sort((a, b) => v(b) - v(a));
          return new G.ResolvePromptAction(prompt.id, [ops[0]]);
        }
      }
    }
    return this.simples.decodeNextAction(state);
  }

  // Próxima ação de montagem, na ordem: evoluir, Básicos no banco, habilidades, energia,
  // itens, Apoiador de compra, estádio. Cada uma é testada no motor antes; a que falha
  // ou já foi tentada neste turno não volta.
  montagem(state) {
    const me = this.eu(state), op = this.op(state), mao = me.hand.cards;
    const T = (l) => l === me.active ? { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.ACTIVE, index: 0 }
                                     : { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: me.bench.indexOf(l) };
    const jog = emJogo(me), vaga = me.bench.findIndex(l => l.cards.length === 0);
    const cands = [];
    const add = (chave, a) => { if (this.permitido(chave, a, state)) cands.push([chave, a]); };
    const ehEx = c => (c.tags || []).some(t => t === 'ex' || t === 'Mega ex');
    // 1. evoluir tudo que der (mais evoluído primeiro)
    mao.forEach((c, i) => { if (c instanceof G.PokemonCard && c.evolvesFrom)
      jog.forEach(l => { if (nomeDe(l) === c.evolvesFrom) add('evo:' + c.name + ':' + jog.indexOf(l), new G.PlayCardAction(me.id, i, T(l))); }); });
    // 2. Básicos no banco: até 4 no banco; Básicos que evoluem e atacantes antes, ex por último
    if (vaga >= 0 && me.bench.filter(l => l.cards.length).length < this.limiteBanco(state)) {
      const bas = mao.map((c, i) => [c, i]).filter(([c]) => c instanceof G.PokemonCard && c.stage === G.Stage.BASIC);
      bas.sort(([a], [b]) => (ehEx(a) ? 1 : 0) - (ehEx(b) ? 1 : 0));
      bas.forEach(([c, i]) => add('bas:' + c.name, new G.PlayCardAction(me.id, i, { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: vaga })));
    }
    // 3. habilidades de quem está em jogo (Teal Dance, compra etc.)
    jog.forEach((l, j) => { const c = l.getPokemonCard(); (c.powers || []).filter(p => p.useWhenInPlay).forEach(p =>
      add('hab:' + p.name + ':' + j, new G.UseAbilityAction(me.id, p.name, T(l)))); });
    // 4. energia da mão, com tipo: só onde ela diminui o que falta para algum ataque.
    //    Prioridade: completar um ataque (ativo antes), depois o Pokémon mais perto de atacar.
    if (me.energyPlayedTurn !== state.turn) {
      const ens = mao.map((c, i) => [c, i]).filter(([c]) => c instanceof G.EnergyCard);
      const pares = [];
      const vistos = new Set();
      ens.forEach(([e, i]) => { if (vistos.has(e.name)) return; vistos.add(e.name);
        jog.forEach(l => { const antes = faltaPrincipal(l), depois = faltaPrincipal(l, e.provides || [G.CardType.COLORLESS]);
          if (depois < antes) pares.push({ l, e, i, nota: (depois === 0 ? 100 : 0) + (l === me.active ? 10 : 0) - depois * 5 + (forcaProxima(l) / 50) }); }); });
      pares.sort((a, b) => b.nota - a.nota);
      pares.forEach(({ l, e, i }) => add('en:' + e.name + ':' + jog.indexOf(l), new G.PlayCardAction(me.id, i, T(l))));
    }
    // 5. itens (exceto os que só servem de resposta)
    mao.forEach((c, i) => { if (c instanceof G.TrainerCard && c.trainerType === G.TrainerType.ITEM && mao.length >= 2)
      add('item:' + c.name, new G.PlayCardAction(me.id, i, BOARD)); });
    // 6. Apoiador de compra (a Chefia fica para o plano)
    // com a mão cheia, só os que embaralham a mão e compram (Lillie's Determination, Judge): a mão travada é o pior caso
    const embaralha = n => /Lillie's Determination|^Judge$|^Iono$|Professor's Research/.test(n);
    if (!me.supporterTurn) mao.forEach((c, i) => { if (c instanceof G.TrainerCard && c.trainerType === G.TrainerType.SUPPORTER && c.name !== BOSS && (mao.length <= 6 || embaralha(c.name)))
      add('apoio:' + c.name, new G.PlayCardAction(me.id, i, BOARD)); });
    // 7. estádio
    const est = G.StateUtils.getStadiumCard(state);
    mao.forEach((c, i) => { if (c instanceof G.TrainerCard && c.trainerType === G.TrainerType.STADIUM && (!est || est.name !== c.name))
      add('est:' + c.name, new G.PlayCardAction(me.id, i, BOARD)); });
    const assin = mao.map(c => c.name).sort().join(',') + '#' + jog.map(l => l.cards.length).join(',');
    for (const [chave, a] of cands) {
      const k = chave + '#' + assin;
      if (this.tentados.has(k)) continue;
      this.tentados.add(k);
      if (this.simular(state, [() => a])) return a;
    }
    return null;
  }

  decodeNextAction(state) {
    const me = this.eu(state); if (!me) return;
    const meu = state.prompts.find(p => p.playerId === me.id && p.result === undefined);
    if (meu) return this.resolver(state, meu);
    if (state.prompts.some(p => p.result === undefined)) return;
    if (state.phase !== G.GamePhase.PLAYER_TURN || state.players[state.activePlayer].id !== me.id) return;
    if (state.turn !== this.turno) { this.turno = state.turn; this.acoes = 0; this.alvoChefia = null; this.planejou = false; this.planejouRecuo = false; this.tentados = new Set(); }
    this.acoes++;
    // montagem com prioridades fixas (vale para qualquer deck); ataque, passar e Chefia ficam com o plano
    if (this.acoes <= MAX_ACOES_TURNO) { const a = this.montagem(state); if (a) return a; }
    // plano do fim do turno: recuar para alguém do banco compensa?
    if (!this.planejouRecuo && me.retreatedTurn !== state.turn) {
      this.planejouRecuo = true;
      const fica = this.melhorAtaque(state);
      let melhor = null, nota = fica ? fica.nota : -1e8;
      me.bench.forEach((l, i) => {
        const c = l.getPokemonCard(); if (!c) return;
        for (const a of c.attacks) {
          const v = this.nota(state, this.simular(state, [() => new G.RetreatAction(me.id, i), () => new G.AttackAction(me.id, a.name)]));
          if (v > nota + 20) { nota = v; melhor = i; }
        }
      });
      if (melhor !== null) return new G.RetreatAction(me.id, melhor);
    }
    const atq = this.melhorAtaque(state);
    if (!this.planejou) {
      this.planejou = true;
      const alvo = this.planoChefia(state, atq ? atq.nota : -1e8);
      if (alvo) { this.alvoChefia = alvo; return new G.PlayCardAction(me.id, me.hand.cards.findIndex(c => c.name === BOSS), BOARD); }
    }
    if (atq) return new G.AttackAction(me.id, atq.nome);
    return new G.PassTurnAction(me.id);
  }
}
module.exports = { BotPlano, falta, faltaMin, faltaPrincipal, tiposDe };
