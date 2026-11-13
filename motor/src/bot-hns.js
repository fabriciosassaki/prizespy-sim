// Bot do Hide n' Sneak (lista do Rahul) para as simulações do solver.
// Não tenta ser ótimo: segue as prioridades do playbook e, no ataque e na Chefia,
// testa as opções no próprio motor e fica com a que pega mais prêmios.
// Interface igual à do SimpleTacticsAi: decodeNextAction(state) -> Action | undefined.
const OUT = '/home/claude/motor/twinleafgg/ptcg-server/output';
const G = require(OUT + '/game');
const { Simulator } = require(OUT + '/game/bots/simulator');
const { ChoosePokemonPrompt } = require(OUT + '/game/store/prompts/choose-pokemon-prompt');
const { ChooseCardsPrompt } = require(OUT + '/game/store/prompts/choose-cards-prompt');
const { SimpleTacticsAi } = require(OUT + '/simple-bot/simple-tactics-ai');
const D = require(OUT + '/simple-bot/simple-bot-definitions');
const { BotShuffleMode, BotFlipMode } = require(OUT + '/game/bots/bot-arbiter');

const ARB = { flipMode: BotFlipMode.RANDOM, shuffleMode: BotShuffleMode.RANDOM };
const OPTS = { tactics: D.allSimpleTactics, promptResolvers: D.allPromptResolvers, scores: D.defaultStateScores, arbiter: ARB };
const HNS = new Set(['Shuppet', 'Banette', 'Poltchageist', 'Sinistcha']);
const DOIS_PREMIOS = new Set(['Latias ex', "Lillie's Clefairy ex", 'Dudunsparce ex']);
const BOARD = { player: G.PlayerType.ANY, slot: G.SlotType.BOARD, index: 0 };
const premiosRest = p => p.prizes.reduce((n, l) => n + l.cards.length, 0);
const nomeAtivo = l => { const c = l.getPokemonCard(); return c ? c.name : ''; };
const energias = l => l.cards.filter(c => c instanceof G.EnergyCard).length;
const contaHnS = p => p.discard.cards.filter(c => c instanceof G.PokemonCard && (c.powers || []).some(w => w.name === "Hide 'n' Sneak")).length;
const emJogo = p => [p.active, ...p.bench].filter(l => l.cards.length > 0);

// Quanto vale manter a carta na mão (baixo = descarta primeiro).
const VALOR = { Shuppet: 1, Poltchageist: 1, Sinistcha: 2, Banette: 2, "Lillie's Clefairy ex": 3, 'Latias ex': 3,
  'Pokégear 3.0': 3, 'Pokegear 3.0': 3, 'Prism Tower': 3, "Explorer's Guidance": 4, 'Poké Pad': 5, 'Poke Pad': 5, 'Ultra Ball': 5,
  'Night Stretcher': 5, Gwynn: 6, Dhelmise: 6, Dunsparce: 6, Dudunsparce: 6, 'Psychic Energy': 6,
  'Telepathic Psychic Energy': 7, 'Dudunsparce ex': 7, 'Legacy Energy': 8, "Boss's Orders": 8, "Lillie's Determination": 8 };
const valor = c => VALOR[c.name] !== undefined ? VALOR[c.name] : 4;

class BotHnS {
  constructor(client) {
    this.client = client;
    this.reserva = new SimpleTacticsAi(client, OPTS, []);   // prompts que este bot não trata
    this.turno = -1; this.tentados = new Set(); this.alvoChefia = null;
  }

  eu(state) { return state.players.find(p => p.id === this.client.id); }
  op(state) { return state.players.find(p => p.id !== this.client.id); }
  alvo(state, lista) { // CardTarget de uma das suas listas
    const p = this.eu(state);
    if (lista === p.active) return { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.ACTIVE, index: 0 };
    return { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: p.bench.indexOf(lista) };
  }

  // ---------- simulação ----------
  // Aplica as ações numa cópia e resolve todos os prompts (os seus com este bot,
  // os dele com o bot simples). Devolve o estado final ou null se algo for ilegal.
  simular(state, acoes) {
    try {
      const sim = new Simulator(state, ARB);
      const outro = new SimpleTacticsAi({ id: this.op(state).id }, OPTS, []);
      const sombra = new BotHnS(this.client); sombra.alvoChefia = this.alvoChefia; sombra.turno = this.turno; sombra.fechamentoVisto = true;
      const pai = this; Object.defineProperty(sombra, 'buscaEnergia', { get() { return pai.buscaEnergia; }, set(v) { pai.buscaEnergia = v; } });
      for (const a of acoes) {
        const antes = sim.store.state;
        sim.dispatch(a(sim.store.state));
        for (let i = 0; i < 40; i++) {
          const s = sim.store.state;
          const p = s.prompts.find(x => x.result === undefined);
          if (!p) break;
          const r = p.playerId === this.client.id ? sombra.resolver(s, p) : outro.decodeNextAction(s);
          if (!r) break;
          sim.dispatch(r);
        }
        if (sim.store.state === antes && false) return null;
      }
      return sim.store.state;
    } catch (e) { return null; }
  }
  valido(state, acao) { return this.simular(state, [() => acao]) !== null; }

  // ---------- prompts ----------
  resolver(state, prompt) {
    const me = this.eu(state);
    if (prompt instanceof ChoosePokemonPrompt) {
      const deles = prompt.playerType === G.PlayerType.TOP_PLAYER;
      if (deles && this.alvoChefia) {
        const op = this.op(state);
        const l = emJogo(op).find(x => x.getPokemonCard() && x.getPokemonCard().id === this.alvoChefia);
        if (l) { this.alvoChefia = null; return new G.ResolvePromptAction(prompt.id, [l]); }
      }
      if (!deles && prompt.options.min <= 1 && prompt.options.max >= 1 &&
          [G.GameMessage.CHOOSE_NEW_ACTIVE_POKEMON, G.GameMessage.CHOOSE_POKEMON_TO_SWITCH].includes(prompt.message)) {
        const ops = me.bench.filter(l => l.cards.length > 0 && !(prompt.options.blocked || []).includes(l));
        if (ops.length) {
          const nota = l => { const n = nomeAtivo(l), e = energias(l);
            if (n === 'Dhelmise') return e > 0 ? 100 + e : 60;
            if (n === 'Banette') return e > 0 ? 55 : 35;
            if (n === 'Poltchageist') return 45; if (n === 'Sinistcha') return 40; if (n === 'Shuppet') return 25;
            if (n === 'Dunsparce') return 15; if (n === 'Dudunsparce') return 10; if (n === 'Dudunsparce ex') return 30;
            return 0; };
          ops.sort((a, b) => nota(b) - nota(a));
          return new G.ResolvePromptAction(prompt.id, [ops[0]]);
        }
      }
    }
    if (prompt instanceof ChooseCardsPrompt && prompt.playerId === me.id && prompt.message === G.GameMessage.CHOOSE_STARTING_POKEMONS) {
      // a 1ª escolhida vai para o ativo. Ordem do Rahul (gabarito R01): Dhelmise ou Poltchageist >
      // Dunsparce > Shuppet > Clefairy/Latias. No banco inicial, só Pokémon de 1 prêmio.
      const ORDEM = { Dhelmise: 1, Poltchageist: 1.5, Dunsparce: 2, Shuppet: 3, 'Latias ex': 8, "Lillie's Clefairy ex": 9 };
      const livres = prompt.cards.cards.filter((c, i) => !(prompt.options.blocked || []).includes(i));
      livres.sort((a, b) => (ORDEM[a.name] || 5) - (ORDEM[b.name] || 5));
      const res = [];
      const max = prompt.options.max === undefined ? 6 : prompt.options.max;
      for (const c of livres) { if (res.length >= max) break; if (res.length && DOIS_PREMIOS.has(c.name)) continue; res.push(c); }
      if (prompt.validate && !prompt.validate(res)) return this.reserva.decodeNextAction(state);
      return new G.ResolvePromptAction(prompt.id, res);
    }
    if (prompt instanceof ChooseCardsPrompt && prompt.playerId === me.id && this.buscaEnergia) {
      this.buscaEnergia = false;
      const e = prompt.cards.cards.find((c, i) => c instanceof G.EnergyCard && !(prompt.options.blocked || []).includes(i));
      if (e && prompt.validate([e])) return new G.ResolvePromptAction(prompt.id, [e]);
    }
    if (prompt instanceof ChooseCardsPrompt && prompt.playerId === me.id) {
      const livres = prompt.cards.cards.filter((c, i) => !(prompt.options.blocked || []).includes(i));
      const descartar = prompt.message === G.GameMessage.CHOOSE_CARD_TO_DISCARD;
      const ordem = livres.slice().sort((a, b) => descartar ? valor(a) - valor(b) : this.necessidade(state, b) - this.necessidade(state, a));
      const min = prompt.options.min || 0, max = prompt.options.max === undefined ? ordem.length : prompt.options.max;
      const res = [];
      prompt.options.min = 0;                       // mesmo truque do bot simples: monta carta a carta
      try {
        for (const c of ordem) {
          if (res.length >= max) break;
          if (res.length >= min && (descartar ? valor(c) > 2 : this.necessidade(state, c) < 1)) break;
          if (prompt.validate([...res, c])) res.push(c);
        }
      } finally { prompt.options.min = min; }
      if (res.length < min || !prompt.validate(res)) return this.reserva.decodeNextAction(state);
      return new G.ResolvePromptAction(prompt.id, res);
    }
    return this.reserva.decodeNextAction(state);
  }

  necessidade(state, c) { // valor de pegar a carta numa busca
    const me = this.eu(state), jog = emJogo(me).map(nomeAtivo), mao = me.hand.cards.map(x => x.name);
    const n = c.name;
    if (n === 'Dunsparce') return jog.includes('Dunsparce') || jog.includes('Dudunsparce') ? 4 : 9;
    if (n === 'Dudunsparce') return jog.includes('Dunsparce') && !mao.includes('Dudunsparce') ? 8 : 3;
    if (n === 'Dhelmise') return jog.filter(x => x === 'Dhelmise').length < 3 ? 8.5 : 4;
    if (n === "Boss's Orders") return 7.5;
    if (n === "Lillie's Determination") return 7;
    if (/Energy/.test(n)) return mao.some(x => /Energy/.test(x)) ? 4 : 7.6;
    if (n === 'Banette') return jog.includes('Shuppet') ? 6 : 2;
    if (HNS.has(n)) return contaHnS(me) < 4 ? 3 : 1;
    if (DOIS_PREMIOS.has(n)) return 0.5;
    return valor(c);
  }

  // ---------- turno ----------
  decodeNextAction(state) {
    const me = this.eu(state); if (!me) return;
    const meu = state.prompts.find(p => p.playerId === me.id && p.result === undefined);
    if (meu) return this.resolver(state, meu);
    if (state.prompts.some(p => p.result === undefined)) return;
    if (state.phase !== G.GamePhase.PLAYER_TURN || state.players[state.activePlayer].id !== me.id) return;
    if (state.turn !== this.turno) { this.turno = state.turn; this.tentados = new Set(); this.alvoChefia = null; this.fila = null; this.fechamentoVisto = false; }
    // fim de jogo: procura a sequência do turno que pega mais prêmios (trocar o atacante, energia, Chefia, ataque)
    if (!this.fechamentoVisto) { this.fechamentoVisto = true; const plano = this.planoFechamento(state); if (plano) this.fila = plano.passos.slice(); }
    if (this.fila && this.fila.length) {
      const passo = this.fila.shift(); const a = passo.acao(state);
      if (passo.chefia) this.alvoChefia = passo.chefia; if (passo.energia) this.buscaEnergia = true;
      if (a) return a;
    }
    for (const [chave, gera] of this.regras(state)) {
      if (this.tentados.has(chave)) continue;
      const a = gera();
      if (!a) continue;
      this.tentados.add(chave);
      if (a.type === 'ATTACK_ACTION' || a.type === 'PASS_TURN' || this.valido(state, a)) return a;
    }
    return new G.PassTurnAction(me.id);
  }

  regras(state) {
    const me = this.eu(state), op = this.op(state);
    const mao = me.hand.cards;
    const idx = nome => mao.findIndex(c => c.name === nome);
    const jog = emJogo(me);
    const banco = me.bench.filter(l => l.cards.length > 0);
    const vagaBanco = me.bench.findIndex(l => l.cards.length === 0);
    const temLinha = n => jog.some(l => nomeAtivo(l) === n);
    const baixos = mao.filter(c => valor(c) <= 3).length;
    const deck = me.deck.cards.length;            // não comprar até perder por baralho vazio
    const R = [];
    const add = (chave, gera) => R.push([chave + '#' + mao.length + '#' + jog.length, gera]);

    // 1. compra com o Dudunsparce antes de tudo
    if (deck > 12) banco.concat([me.active]).forEach((l, i) => { if (nomeAtivo(l) === 'Dudunsparce')
      add('runaway' + i, () => new G.UseAbilityAction(me.id, 'Run Away Draw', this.alvo(state, l))); });
    // 2. Dunsparce no banco se não houver nenhum da linha
    if (vagaBanco >= 0 && idx('Dunsparce') >= 0 && !temLinha('Dunsparce') && !temLinha('Dudunsparce'))
      add('dunsparce', () => new G.PlayCardAction(me.id, idx('Dunsparce'), { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: vagaBanco }));
    // 3. evoluir Dunsparce do banco em Dudunsparce (o de compra)
    banco.forEach((l, i) => { if (nomeAtivo(l) === 'Dunsparce' && idx('Dudunsparce') >= 0)
      add('evo-dud' + i, () => new G.PlayCardAction(me.id, idx('Dudunsparce'), this.alvo(state, l))); });
    // 4. Torre Prisma: baixar se não estiver em jogo; usar se houver o que descartar
    const estadio = G.StateUtils.getStadiumCard(state);
    if (idx('Prism Tower') >= 0 && (!estadio || estadio.name !== 'Prism Tower'))
      add('torre-baixa', () => new G.PlayCardAction(me.id, idx('Prism Tower'), BOARD));
    if (estadio && estadio.name === 'Prism Tower' && baixos >= 2 && deck > 6) add('torre-usa', () => new G.UseStadiumAction(me.id));
    // 5. itens de busca
    if (idx('Poké Pad') >= 0 || idx('Poke Pad') >= 0) add('pad', () => new G.PlayCardAction(me.id, idx('Poké Pad') >= 0 ? idx('Poké Pad') : idx('Poke Pad'), BOARD));
    if (idx('Ultra Ball') >= 0 && baixos >= 2) add('ultra', () => new G.PlayCardAction(me.id, idx('Ultra Ball'), BOARD));
    if (idx('Pokégear 3.0') >= 0 || idx('Pokegear 3.0') >= 0) add('gear', () => new G.PlayCardAction(me.id, idx('Pokégear 3.0') >= 0 ? idx('Pokégear 3.0') : idx('Pokegear 3.0'), BOARD));
    const dhelmiseEmJogo = jog.filter(l => nomeAtivo(l) === 'Dhelmise').length;
    if (idx('Night Stretcher') >= 0 && ((dhelmiseEmJogo < 2 && me.discard.cards.some(c => c.name === 'Dhelmise')) ||
        (!mao.some(c => c instanceof G.EnergyCard) && me.discard.cards.some(c => c instanceof G.EnergyCard))))
      add('maca', () => new G.PlayCardAction(me.id, idx('Night Stretcher'), BOARD));
    // 6. energia (1 por turno; o motor recusa a segunda)
    const energiaMao = mao.map((c, i) => [c, i]).filter(([c]) => c instanceof G.EnergyCard);
    if (energiaMao.length && me.energyPlayedTurn !== state.turn) {
      const tele = energiaMao.find(([c]) => c.name === 'Telepathic Psychic Energy');
      const outra = energiaMao.find(([c]) => c.name !== 'Telepathic Psychic Energy' && c.name !== 'Legacy Energy') || energiaMao.find(([c]) => c.name === 'Legacy Energy');
      const ativoDh = nomeAtivo(me.active) === 'Dhelmise';
      const psiquicoBanco = banco.find(l => ['Dhelmise', 'Shuppet', 'Banette'].includes(nomeAtivo(l)));
      if (ativoDh && energias(me.active) === 0) {
        const e = tele && vagaBanco >= 0 ? tele : (outra || tele);
        add('energia-ativo', () => new G.PlayCardAction(me.id, e[1], this.alvo(state, me.active)));
      } else if (tele && vagaBanco >= 0 && psiquicoBanco) {
        add('energia-tele', () => new G.PlayCardAction(me.id, tele[1], this.alvo(state, psiquicoBanco)));
      } else {
        const dhBanco = banco.find(l => nomeAtivo(l) === 'Dhelmise' && energias(l) === 0);
        const e = outra || tele;
        if (dhBanco && e) add('energia-banco', () => new G.PlayCardAction(me.id, e[1], this.alvo(state, dhBanco)));
      }
    }
    // 7. Dhelmise no banco (até 3 em jogo, deixando uma vaga)
    const vagas = me.bench.filter(l => l.cards.length === 0).length;
    if (idx('Dhelmise') >= 0 && dhelmiseEmJogo < 3 && vagas >= 2)
      add('dhelmise-banco', () => new G.PlayCardAction(me.id, idx('Dhelmise'), { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: vagaBanco }));
    // 7b. nunca ficar com menos de 2 no banco (perder o ativo sem banco = derrota)
    if (banco.length < 2 && vagaBanco >= 0) {
      const basico = ['Dhelmise', 'Poltchageist', 'Shuppet', 'Dunsparce'].map(idx).find(i => i >= 0);
      if (basico !== undefined) add('banco-minimo', () => new G.PlayCardAction(me.id, basico, { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: vagaBanco }));
    }
    // 8. recuar para um Dhelmise com energia se o ativo não ataca bem
    const atacante = banco.find(l => nomeAtivo(l) === 'Dhelmise' && energias(l) > 0);
    const ativoBom = nomeAtivo(me.active) === 'Dhelmise' && energias(me.active) > 0;
    if (!ativoBom && atacante) add('recuo', () => new G.RetreatAction(me.id, me.bench.indexOf(atacante)));
    // 9. Apoiador: Chefia se ela fecha um nocaute melhor que o do ativo; senão compra
    if (!me.supporterTurn) {  // conta Apoiadores jogados neste turno
      const plano = this.planoChefia(state);
      if (plano) add('chefia', () => { this.alvoChefia = plano; return new G.PlayCardAction(me.id, idx("Boss's Orders"), BOARD); });
      const pokesBaixos = mao.filter(c => HNS.has(c.name)).length;
      if (idx('Gwynn') >= 0 && pokesBaixos >= 1 && deck > 14) add('gwynn', () => new G.PlayCardAction(me.id, idx('Gwynn'), BOARD));
      if (idx("Lillie's Determination") >= 0 && mao.length <= 6 && deck + mao.length > 12) add('lillie', () => new G.PlayCardAction(me.id, idx("Lillie's Determination"), BOARD));
      if (idx("Explorer's Guidance") >= 0 && deck > 18) add('explorer', () => new G.PlayCardAction(me.id, idx("Explorer's Guidance"), BOARD));
      if (idx('Gwynn') >= 0 && deck > 14 && mao.length <= 4) add('gwynn2', () => new G.PlayCardAction(me.id, idx('Gwynn'), BOARD));
    }
    // 10. Dudunsparce ex no ativo quando o Cauda Tenaz nocauteia
    if (nomeAtivo(me.active) === 'Dunsparce' && idx('Dudunsparce ex') >= 0) {
      const exDeles = emJogo(op).filter(l => { const c = l.getPokemonCard(); return c && c.tags && c.tags.some(t => t === 'ex' || t === 'Mega ex'); }).length;
      const hpAlvo = op.active.hp - op.active.damage;
      if (exDeles * 60 >= hpAlvo) add('dud-ex', () => new G.PlayCardAction(me.id, idx('Dudunsparce ex'), this.alvo(state, me.active)));
    }
    // 11. atacar com o ataque que pega mais prêmios
    add('ataque', () => this.melhorAtaque(state));
    return R;
  }

  ataques(state) {
    const me = this.eu(state);
    const c = me.active.getPokemonCard(); if (!c) return [];
    return c.attacks.map(a => a.name);
  }
  premiosCom(state, acoes) {
    const s = this.simular(state, acoes); if (!s) return -1;
    const antes = premiosRest(this.eu(state)), depois = premiosRest(s.players.find(p => p.id === this.client.id));
    return antes - depois;
  }
  melhorAtaque(state) {
    let melhor = null, nota = -2;
    for (const nome of this.ataques(state)) {
      const pr = this.premiosCom(state, [() => new G.AttackAction(this.client.id, nome)]);
      if (pr > nota) { nota = pr; melhor = nome; }
    }
    return melhor && nota >= 0 ? new G.AttackAction(this.client.id, melhor) : null;
  }
  // Fim de jogo (3 prêmios ou menos): testa no motor cada atacante possível (o ativo ou um do banco, trocando por
  // recuo), com energia da mão ou da Maca Noturna, com ou sem Chefia em cada alvo, e cada ataque. Fica com a
  // sequência que pega mais prêmios, se ela pegar mais do que atacar com o ativo como está.
  planoFechamento(state) {
    const me = this.eu(state), op = this.op(state);
    const faltam = premiosRest(me); if (faltam > 3) return null;
    const idMao = (s, n) => s.players.find(p => p.id === me.id).hand.cards.findIndex(c => c.name === n);
    const temMao = n => me.hand.cards.some(c => c.name === n);
    const energiaMao = me.hand.cards.find(c => c instanceof G.EnergyCard);
    const podeEnergia = me.energyPlayedTurn !== state.turn;
    const macaEnergia = !energiaMao && temMao('Night Stretcher') && me.discard.cards.some(c => c instanceof G.EnergyCard);
    const chefia = temMao("Boss's Orders") && !me.supporterTurn;
    const podeRecuar = me.retreatedTurn !== state.turn;
    const alvoDe = (s, id) => { const p = s.players.find(x => x.id === me.id);
      if (p.active.getPokemonCard() && p.active.getPokemonCard().id === id) return { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.ACTIVE, index: 0 };
      return { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: p.bench.findIndex(l => l.getPokemonCard() && l.getPokemonCard().id === id) }; };
    const bancoDe = (s, id) => s.players.find(x => x.id === me.id).bench.findIndex(l => l.getPokemonCard() && l.getPokemonCard().id === id);
    const atacantes = [me.active, ...(podeRecuar ? me.bench.filter(l => l.cards.length) : [])].filter(l => l.getPokemonCard() && l.getPokemonCard().attacks.length);
    const alvos = [null, ...(chefia ? op.bench.filter(l => l.cards.length).map(l => l.getPokemonCard().id) : [])];
    let melhor = null, nota = -1;
    const base = Math.max(0, ...this.ataques(state).map(n => this.premiosCom(state, [() => new G.AttackAction(me.id, n)])));
    const ativoDele = op.active, idAtivoDele = ativoDele.getPokemonCard() && ativoDele.getPokemonCard().id, vidaAtivo = ativoDele.hp - ativoDele.damage;
    const avaliar = (todos, alvo) => {
      const ant = this.alvoChefia; this.alvoChefia = alvo;
      const sim = this.simularPassos(state, todos); this.alvoChefia = ant;
      if (!sim) return null;
      const eu2 = sim.players.find(p => p.id === me.id), ele2 = sim.players.find(p => p.id !== me.id);
      if (sim.activePlayer === state.activePlayer && sim.phase === G.GamePhase.PLAYER_TURN && premiosRest(eu2) === premiosRest(me)) return null;   // o ataque não saiu
      const pr = premiosRest(me) - premiosRest(eu2);
      const a2 = ele2.active.getPokemonCard();
      const dano = !alvo && a2 && a2.id === idAtivoDele ? ele2.active.damage - ativoDele.damage : vidaAtivo;
      return { pr, dano };
    };
    // 1ª etapa: cada atacante e ataque sem Chefia; mede o dano que faz no ativo dele
    const viaveis = [];
    for (const l of atacantes) {
      const id = l.getPokemonCard().id, ativo = l === me.active;
      for (const comEnergia of (podeEnergia && (energiaMao || macaEnergia) ? [false, true] : [false])) {
        const prep = [];
        if (comEnergia && macaEnergia) prep.push({ acao: s => new G.PlayCardAction(me.id, idMao(s, 'Night Stretcher'), BOARD), energia: true });
        if (comEnergia) prep.push({ acao: s => { const p = s.players.find(x => x.id === me.id); const i = p.hand.cards.findIndex(c => c instanceof G.EnergyCard); return i < 0 ? null : new G.PlayCardAction(me.id, i, alvoDe(s, id)); } });
        if (!ativo) prep.push({ acao: s => new G.RetreatAction(me.id, bancoDe(s, id)) });
        for (const atk of l.getPokemonCard().attacks.map(a => a.name)) {
          const todos = [...prep, { acao: () => new G.AttackAction(me.id, atk) }];
          const r = avaliar(todos, null); if (!r) continue;
          viaveis.push({ prep, atk, dano: r.dano });
          if (r.pr > nota) { nota = r.pr; melhor = { passos: todos, premios: r.pr }; }
        }
      }
    }
    // 2ª etapa: Chefia só nos alvos que o dano daquele ataque derruba (o dano pode mudar com o alvo; é uma aproximação)
    for (const v of viaveis) for (const alvo of alvos) { if (!alvo) continue;
      const l = op.bench.find(x => x.getPokemonCard() && x.getPokemonCard().id === alvo);
      if (!l || l.hp - l.damage > Math.max(v.dano, 60 * emJogo(op).filter(x => { const c = x.getPokemonCard(); return c && c.tags && c.tags.some(t => t === 'ex' || t === 'Mega ex'); }).length)) continue;
      const todos = [...v.prep, { acao: s => new G.PlayCardAction(me.id, idMao(s, "Boss's Orders"), BOARD), chefia: alvo }, { acao: () => new G.AttackAction(me.id, v.atk) }];
      const r = avaliar(todos, alvo); if (!r) continue;
      if (r.pr > nota) { nota = r.pr; melhor = { passos: todos, premios: r.pr }; }
    }
    return melhor && nota > base ? melhor : null;
  }
  simularPassos(state, passos) {   // como simular, ligando a busca de energia e a Chefia de cada passo
    const self = this; let ok = true;
    const acoes = passos.map(p => s => { if (p.energia) self.buscaEnergia = true; const a = p.acao(s); if (!a) { ok = false; return new G.PassTurnAction(self.client.id); } return a; });
    const r = this.simular(state, acoes); this.buscaEnergia = false;
    return ok ? r : null;
  }
  // Devolve o id da carta-alvo da Chefia se ela render mais prêmios do que atacar o ativo.
  planoChefia(state) {
    const me = this.eu(state), op = this.op(state);
    const iBoss = me.hand.cards.findIndex(c => c.name === "Boss's Orders");
    if (iBoss < 0 || this.ataques(state).length === 0) return null;
    const semChefia = Math.max(0, ...this.ataques(state).map(n => this.premiosCom(state, [() => new G.AttackAction(me.id, n)])));
    let melhor = null, nota = semChefia;
    for (const l of op.bench.filter(x => x.cards.length > 0)) {
      const id = l.getPokemonCard().id;
      for (const n of this.ataques(state)) {
        const ant = this.alvoChefia; this.alvoChefia = id;
        const pr = this.premiosCom(state, [s => new G.PlayCardAction(me.id, s.players.find(p => p.id === me.id).hand.cards.findIndex(c => c.name === "Boss's Orders"), BOARD),
          () => new G.AttackAction(me.id, n)]);
        this.alvoChefia = ant;
        if (pr > nota) { nota = pr; melhor = id; }
      }
    }
    return melhor;
  }
}
module.exports = { BotHnS };
