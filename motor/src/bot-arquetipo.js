// Bots por arquétipo (oponente nas simulações do PrizeSpy).
// Base: o BotPlano (montagem genérica testada no motor). Cada arquétipo tem um "perfil" com:
//   - regras(bot, state, U): jogadas de montagem do deck, em ordem de prioridade ([chave, () => Action]);
//   - bloqueia(chave, bot, state): jogadas da montagem genérica que o deck não quer (ex.: 'bas:Budew', 'en:', 'apoio:...');
//   - busca(c, bot, state) / descarte(c, bot, state): valor de uma carta numa busca / ordem de descarte (baixo = sai primeiro);
//   - novoAtivo(l, bot, state): nota de cada Pokémon do banco quando é preciso escolher o novo ativo;
//   - alvoEnergia(l, bot, state): nota de cada Pokémon para receber energia de efeitos (PP Up etc.);
//   - copias(atk, bot, state): ataques que o ataque "atk" pode copiar (Night Joker);
//   - penalidade(plano, bot, state): custo de um fechamento (ex.: Rampaging Thunder trava o atacante);
//   - banco: limite de Pokémon no banco na montagem genérica.
// Toda regra começa olhando a lista do próprio bot ("se a lista tem X"): o mesmo perfil joga todas as variações.
//
// Fechamento do turno (no lugar do plano do BotPlano): testa no motor cada combinação de
//   atacante (o ativo, ou um do banco por recuo) x ataque (e, no Night Joker, qual ataque copiar) x Apoiador
//   (nenhum, Chefia em cada alvo, Black Belt's Training) e fica com a de maior nota:
//   prêmios x 1000 + dano no ativo dele - penalidade.
const OUT = '/home/claude/motor/twinleafgg/ptcg-server/output';
const G = require(OUT + '/game');
const { BotPlano, faltaMin, faltaPrincipal, falta, tiposDe } = require('./bot-plano.js');

const BOARD = { player: G.PlayerType.ANY, slot: G.SlotType.BOARD, index: 0 };
const BOSS = "Boss's Orders";
const premiosRest = p => p.prizes.reduce((n, l) => n + l.cards.length, 0);
const emJogo = p => [p.active, ...p.bench].filter(l => l.cards.length > 0);
const nomeDe = l => { const c = l && l.getPokemonCard && l.getPokemonCard(); return c ? c.name : ''; };
const energias = l => l.cards.filter(c => c instanceof G.EnergyCard).length;
const ehEx = c => !!c && (c.tags || []).some(t => t === 'ex' || t === 'Mega ex');

// utilidades que os perfis usam
const U = {
  G, BOARD, BOSS, premiosRest, emJogo, nomeDe, energias, ehEx,
  mao: (me, n) => me.hand.cards.findIndex(c => c.name === n),
  temNaMao: (me, n) => me.hand.cards.some(c => c.name === n),
  conta: (me, n) => emJogo(me).filter(l => nomeDe(l) === n).length,
  vaga: me => me.bench.findIndex(l => l.cards.length === 0),
  vagas: me => me.bench.filter(l => l.cards.length === 0).length,
  alvo: (me, l) => l === me.active ? { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.ACTIVE, index: 0 }
    : { player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: me.bench.indexOf(l) },
  banco: (me, i) => ({ player: G.PlayerType.BOTTOM_PLAYER, slot: G.SlotType.BENCH, index: i }),
  noDescarte: (me, f) => me.discard.cards.some(f),
  naLista: (bot, n) => !!(bot.lista && bot.lista.has(n)),
};

class BotArquetipo extends BotPlano {
  constructor(client, perfil, base, lista) {
    super(client, base);
    this.perfil = perfil; this.lista = lista || null;   // lista: Map nome -> quantidade (a lista que o bot joga)
    this.copia = null; this.fila = null;
  }
  criarSombra() { const s = new BotArquetipo(this.client, this.perfil, 'simples', this.lista); s.copia = this.copia; s.trocaPara = this.trocaPara; s.mover = this.mover; s.topoCarta = this.topoCarta; return s; }
  permitido(chave, acao, state) { return !(this.perfil.bloqueia && this.perfil.bloqueia(chave, this, state)); }
  limiteBanco(state) { return this.perfil.banco || 4; }

  // ---------- escolhas ----------
  resolver(state, prompt) {
    const me = this.eu(state);
    if (prompt.playerId === me.id) {
      const p = this.perfil.resolver && this.perfil.resolver(this, state, prompt, U); if (p) return p;
      if (this.trocaPara && prompt instanceof G.ChoosePokemonPrompt && prompt.playerType !== G.PlayerType.TOP_PLAYER) {
        const l = me.bench.find(x => x.getPokemonCard() && x.getPokemonCard().id === this.trocaPara);
        this.trocaPara = null; if (l) return new G.ResolvePromptAction(prompt.id, [l]);
      }
      if (this.topoCarta && prompt instanceof G.ChooseCardsPrompt && prompt.message === G.GameMessage.CHOOSE_CARD_TO_DECK) {
        const c = prompt.cards.cards.find(x => x.name === this.topoCarta); this.topoCarta = null;
        if (c) return new G.ResolvePromptAction(prompt.id, [c]);
      }
      if (prompt instanceof G.MoveEnergyPrompt && this.mover) {      // Energy Switch planejado pela regra troca-energia
        const m = this.mover; this.mover = null;
        const acha = id => [me.active, ...me.bench].find(l => l.cards.length && l.getPokemonCard().id === id);
        const de = acha(m.de), para = acha(m.para), card = de && de.cards.find(c => c.name === m.carta);
        if (de && para && card) return new G.ResolvePromptAction(prompt.id, [{ from: U.alvo(me, de), to: U.alvo(me, para), card }]);
      }
      if (prompt instanceof G.ChooseCardsPrompt && prompt.message === G.GameMessage.CHOOSE_STARTING_POKEMONS && this.perfil.inicio) {
        // a 1ª escolhida vai para o ativo; no banco inicial só entram as cartas que o perfil aceita
        const { ativo, banco } = this.perfil.inicio;
        const livres = prompt.cards.cards.filter((c, i) => !(prompt.options.blocked || []).includes(i));
        const ordem = livres.slice().sort((a, b) => (ativo.indexOf(a.name) < 0 ? 99 : ativo.indexOf(a.name)) - (ativo.indexOf(b.name) < 0 ? 99 : ativo.indexOf(b.name)));
        const res = [ordem[0]]; const usados = { [ordem[0].name]: 1 };
        const max = prompt.options.max === undefined ? 6 : prompt.options.max;
        for (const c of livres) { if (res.length >= max || res.includes(c)) continue;
          const lim = banco[c.name] || 0; if ((usados[c.name] || 0) >= lim + (c === ordem[0] ? 0 : 0)) continue;
          usados[c.name] = (usados[c.name] || 0) + 1; res.push(c); }
        if (!prompt.validate || prompt.validate(res)) return new G.ResolvePromptAction(prompt.id, res);
      }
      if (prompt instanceof G.ChooseAttackPrompt) {
        const ops = [];
        prompt.cards.forEach(c => (c.attacks || []).forEach(a => { if (!(prompt.options.blocked || []).some(b => b.attack === a.name)) ops.push(a); }));
        const a = ops.find(x => x.name === this.copia) || ops.sort((x, y) => (y.damage || 0) - (x.damage || 0))[0];
        if (a) return new G.ResolvePromptAction(prompt.id, a);
      }
      if (prompt instanceof G.ChooseCardsPrompt && (this.perfil.busca || this.perfil.descarte)) {
        const r = this.escolherCartas(state, prompt); if (r) return r;
      }
      if (prompt instanceof G.AttachEnergyPrompt && this.perfil.alvoEnergia) {
        const r = this.ligarEnergia(state, prompt); if (r) return r;
      }
      if (prompt instanceof G.ChoosePokemonPrompt && this.perfil.novoAtivo && prompt.playerType !== G.PlayerType.TOP_PLAYER &&
          [G.GameMessage.CHOOSE_NEW_ACTIVE_POKEMON, G.GameMessage.CHOOSE_POKEMON_TO_SWITCH].includes(prompt.message) && (prompt.options.min || 0) <= 1) {
        const ops = me.bench.filter(l => l.cards.length > 0 && !(prompt.options.blocked || []).some(b => b.slot === G.SlotType.BENCH && me.bench[b.index] === l));
        if (ops.length) { ops.sort((a, b) => this.perfil.novoAtivo(b, this, state) - this.perfil.novoAtivo(a, this, state));
          return new G.ResolvePromptAction(prompt.id, [ops[0]]); }
      }
    }
    return super.resolver(state, prompt);
  }
  escolherCartas(state, prompt) {
    const descartar = /DISCARD/.test(String(prompt.message));
    const f = descartar ? this.perfil.descarte : this.perfil.busca; if (!f) return null;
    const livres = prompt.cards.cards.filter((c, i) => !(prompt.options.blocked || []).includes(i));
    const v = c => f(c, this, state, U);
    let ordem = livres.slice().sort((a, b) => descartar ? v(a) - v(b) : v(b) - v(a));
    // buscas de energia (Crispin: "2 tipos diferentes"): uma de cada tipo primeiro, repetidas por último
    if (!descartar) { const vis = new Set(), uma = [], rep = [];
      ordem.forEach(c => { if (c instanceof G.EnergyCard && vis.has(c.name)) rep.push(c); else { vis.add(c.name); uma.push(c); } }); ordem = uma.concat(rep); }
    const min = prompt.options.min || 0, max = prompt.options.max === undefined ? ordem.length : prompt.options.max;
    const res = []; const minOrig = prompt.options.min; prompt.options.min = 0;
    try {
      for (const c of ordem) {
        if (res.length >= max) break;
        if (res.length >= min && (descartar ? v(c) > 50 : v(c) <= 0)) break;   // nota > 50: não descartar se não for obrigado; <= 0: não buscar
        if (!prompt.validate || prompt.validate([...res, c])) res.push(c);
      }
    } finally { prompt.options.min = minOrig; }
    if (res.length < min || (prompt.validate && !prompt.validate(res))) return null;
    return new G.ResolvePromptAction(prompt.id, res);
  }
  ligarEnergia(state, prompt) {
    const me = this.eu(state);
    const cand = [me.active, ...me.bench].filter(l => l.cards.length > 0).filter(l => {
      const t = U.alvo(me, l); if (!prompt.slots.includes(t.slot)) return false;
      return !(prompt.options.blockedTo || []).some(b => b.slot === t.slot && b.index === t.index);
    });
    if (!cand.length) return null;
    cand.sort((a, b) => this.perfil.alvoEnergia(b, this, state) - this.perfil.alvoEnergia(a, this, state));
    const cartas = prompt.cardList.cards.map((c, i) => [c, i]).filter(([c, i]) => !(prompt.options.blocked || []).includes(i) && c instanceof G.EnergyCard);
    const max = Math.max(prompt.options.min || 0, Math.min(prompt.options.max === undefined ? 1 : prompt.options.max, cartas.length));
    const res = []; let k = 0;
    for (const [c, i] of cartas) { if (res.length >= max) break;
      const to = U.alvo(me, cand[prompt.options.sameTarget ? 0 : Math.min(k, cand.length - 1)]);
      res.push({ to, card: c }); if (prompt.options.differentTargets) k++; }   // formato local do motor: { to, card } (o { to, index } é só o da rede)
    try { return new G.ResolvePromptAction(prompt.id, res); } catch (e) { return null; }
  }

  // ---------- montagem ----------
  montagem(state) {
    if (this.perfil.regras) {
      const me = this.eu(state), mao = me.hand.cards.map(c => c.name).sort().join(','), jog = emJogo(me).map(l => l.cards.length).join(',');
      for (const [chave, gera] of this.perfil.regras(this, state, U)) {
        const k = 'R:' + chave + '#' + mao + '#' + jog;
        if (this.tentados.has(k)) continue;
        this.tentados.add(k);
        let a = null; try { a = gera(); } catch (e) { a = null; }
        const ok = a && this.simular(state, [() => a]);
        if (process.env.DEBUG_BOT && this.base !== 'simples') console.error(`  [regra T${state.turn}] ${chave}: ${a ? (ok ? 'ok' : 'falhou no motor') : 'sem ação'}`);
        if (ok) return a;
      }
    }
    return super.montagem(state);
  }

  // ---------- fechamento do turno ----------
  planos(state) {
    const me = this.eu(state), op = this.op(state), P = [];
    const podeRecuar = me.retreatedTurn !== state.turn;
    const apoio = !me.supporterTurn;
    const iBoss = U.mao(me, BOSS) >= 0 && apoio, iBB = U.mao(me, "Black Belt's Training") >= 0 && apoio;
    const pech = [me.active, ...me.bench].find(l => l.cards.length && nomeDe(l) === 'Pecharunt ex');
    const chainsOk = !!pech;   // 1 vez por turno: o motor recusa a segunda e o plano cai
    const switchOk = U.mao(me, 'Switch') >= 0;
    const atacantes = [me.active, ...me.bench.filter(l => l.cards.length)];
    for (const l of atacantes) {
      const c = l.getPokemonCard(); if (!c) continue;
      const id = c.id, ativo = l === me.active;
      const modos = ativo ? [null] : [podeRecuar ? 'recuo' : null, chainsOk && (c.cardType || []).includes(G.CardType.DARK) && c.name !== 'Pecharunt ex' ? 'chains' : null, switchOk ? 'switch' : null].filter(Boolean);
      if (!modos.length) continue;
      for (const modo of modos) {
      for (const a of c.attacks) {
        if (a.cost.length > energias(l)) continue;                        // aproximação: precisa ter energia suficiente em número
        const copias = this.perfil.copias ? this.perfil.copias(a, this, state, U) : null;
        for (const copia of (copias && copias.length ? copias : [null])) {
          const base = { atacante: id, ativo, modo, ataque: a.name, copia };
          P.push({ ...base });
          if (iBB && op.active.getPokemonCard() && ehEx(op.active.getPokemonCard())) P.push({ ...base, bb: true });
          if (iBoss) op.bench.filter(x => x.cards.length).forEach(x => P.push({ ...base, chefia: x.getPokemonCard().id }));
        }
        // Slowking: põe um Pokémon da mão no topo com a Academy at Night e copia o ataque dele
        const topos = this.perfil.topo && a.name === this.perfil.topo.ataque ? this.perfil.topo.cartas(this, state, U) : [];
        for (const t of topos) for (const ta of (t.attacks || [])) {
          const base = { atacante: id, ativo, modo, ataque: a.name, copia: ta.name, topo: t.name };
          P.push({ ...base });
          if (iBoss) op.bench.filter(x => x.cards.length).forEach(x => P.push({ ...base, chefia: x.getPokemonCard().id }));
        }
        // cópias que pedem baixar um Pokémon da mão antes (Reshiram no turno do Virtuous Flame)
        const daMao = this.perfil.copiasDaMao && U.vaga(me) >= 0 ? this.perfil.copiasDaMao(a, this, state, U) : [];
        for (const { baixa, copia } of daMao) {
          const base = { atacante: id, ativo, modo, ataque: a.name, copia, baixa };
          P.push({ ...base });
          if (iBoss) op.bench.filter(x => x.cards.length).forEach(x => P.push({ ...base, chefia: x.getPokemonCard().id }));
        }
      }
      }
    }
    return P;
  }
  passos(plano) {
    const me = this.client.id, self = this;
    const idx = (s, n) => s.players.find(p => p.id === me).hand.cards.findIndex(c => c.name === n);
    const L = [];
    const noBanco = s => s.players.find(p => p.id === me).bench.findIndex(l => l.getPokemonCard() && l.getPokemonCard().id === plano.atacante);
    if (!plano.ativo && plano.modo === 'recuo') L.push(s => new G.RetreatAction(me, noBanco(s)));
    if (!plano.ativo && plano.modo === 'switch') L.push(s => { self.trocaPara = plano.atacante; return new G.PlayCardAction(me, idx(s, 'Switch'), BOARD); });
    if (!plano.ativo && plano.modo === 'chains') L.push(s => { self.trocaPara = plano.atacante; const p = s.players.find(x => x.id === me);
      const l = [p.active, ...p.bench].find(x => x.cards.length && nomeDe(x) === 'Pecharunt ex'); return new G.UseAbilityAction(me, 'Subjugating Chains', U.alvo(p, l)); });
    if (plano.topo) L.push(s => { self.topoCarta = plano.topo; return new G.UseStadiumAction(me); });
    if (plano.baixa) L.push(s => { const p = s.players.find(x => x.id === me); return new G.PlayCardAction(me, idx(s, plano.baixa), U.banco(p, U.vaga(p))); });
    if (plano.bb) L.push(s => new G.PlayCardAction(me, idx(s, "Black Belt's Training"), BOARD));
    if (plano.chefia) L.push(s => new G.PlayCardAction(me, idx(s, BOSS), BOARD));
    L.push(() => { self.copia = plano.copia; return new G.AttackAction(me, plano.ataque); });
    return L;
  }
  avaliar(state, plano) {
    const antA = this.alvoChefia, antC = this.copia;
    this.alvoChefia = plano.chefia || null; this.copia = plano.copia;
    const fim = this.simular(state, this.passos(plano));
    this.alvoChefia = antA; this.copia = antC;
    if (!fim) return -1e9;
    const me = this.eu(state), eu2 = fim.players.find(p => p.id === me.id), ele2 = fim.players.find(p => p.id !== me.id);
    if (fim.activePlayer === state.activePlayer && fim.phase === G.GamePhase.PLAYER_TURN) return -1e9;   // o ataque não saiu
    const pr = premiosRest(me) - premiosRest(eu2);
    // dano: no ativo dele vale inteiro; no banco (spread, Thunder Blitz) vale 60%
    const danoB = p => p.bench.reduce((t, l) => t + (l.cards.length ? l.damage : 0), 0);
    let nota = pr * 1000 + (ele2.active.damage || 0) + 0.6 * Math.max(0, danoB(ele2) - danoB(this.op(state)));
    // termina o turno com o ativo mais inteiro (rodízio de atacantes) e sem jogar energia fora
    const vivo = l => l && l.getPokemonCard() ? Math.max(0, l.hp - l.damage) : 0;
    const ens = p => emJogo(p).reduce((t, l) => t + energias(l), 0);
    nota += vivo(eu2.active) / 5 - 40 * Math.max(0, ens(me) - ens(eu2)) + 30 * Math.max(0, ens(this.op(state)) - ens(ele2));
    if (plano.chefia || plano.bb) nota -= 150;          // gastar o Apoiador só se render prêmio
    if (plano.baixa) nota -= 60;                         // um Pokémon a mais no banco é um alvo a mais para a Chefia dele
    if (this.perfil.penalidade) nota -= this.perfil.penalidade(plano, this, state, U);
    return nota;
  }
  fechamento(state) {
    let melhor = null, nota = -1e8;
    for (const p of this.planos(state)) { const v = this.avaliar(state, p); if (process.env.DEBUG_BOT > 1) console.error(`     plano ${v} ${JSON.stringify(p)}`); if (v > nota) { nota = v; melhor = p; } }
    return melhor;
  }

  decodeNextAction(state) {
    const me = this.eu(state); if (!me) return;
    const meu = state.prompts.find(p => p.playerId === me.id && p.result === undefined);
    if (meu) return this.resolver(state, meu);
    if (state.prompts.some(p => p.result === undefined)) return;
    if (state.phase !== G.GamePhase.PLAYER_TURN || state.players[state.activePlayer].id !== me.id) return;
    if (state.turn !== this.turno) { this.turno = state.turn; this.acoes = 0; this.alvoChefia = null; this.tentados = new Set(); this.fila = null; this.plano = null; }
    this.acoes++;
    if (this.fila) {                                   // executando o fechamento escolhido
      const p = this.fila.shift(); if (!this.fila.length) this.fila = null;
      if (this.plano.chefia) this.alvoChefia = this.plano.chefia;
      try { const a = p(state); if (a) return a; } catch (e) {}
      return new G.PassTurnAction(me.id);
    }
    if (this.acoes <= 60) { const a = this.montagem(state); if (a) return a; }
    const plano = this.fechamento(state);
    if (process.env.DEBUG_BOT) console.error(`  [fechamento T${state.turn}] ${plano ? JSON.stringify(plano) : 'passar'} de ${this.planos(state).length} planos`);
    if (!plano) return new G.PassTurnAction(me.id);
    this.plano = plano; this.fila = this.passos(plano);
    return this.decodeNextAction(state);
  }
}

// ======================= perfis =======================
const PERFIS = {};

// Energy Switch: passa 1 energia básica de um Pokémon que não ataca (fonte) para o atacante, se isso diminui o que falta.
// fonte(l) diz quem pode doar. Devolve a regra ou null.
function regraTrocaEnergia(bot, st, alvo, fonte) {
  const me = bot.eu(st); const i = U.mao(me, 'Energy Switch'); if (i < 0 || !alvo || faltaMin(alvo) === 0) return null;
  for (const l of [me.active, ...me.bench]) {
    if (!l.cards.length || l === alvo || !fonte(l)) continue;
    for (const e of l.cards.filter(c => c instanceof G.EnergyCard && c.energyType === G.EnergyType.BASIC)) {
      const tipos = tiposDe(alvo).concat(e.provides || []);
      const c = alvo.getPokemonCard(); const depois = Math.min(...c.attacks.map(a => falta(tipos, a.cost)));
      if (depois < faltaMin(alvo)) {
        const plano = { de: l.getPokemonCard().id, para: alvo.getPokemonCard().id, carta: e.name };
        return ['troca-energia', () => { bot.mover = plano; return new G.PlayCardAction(me.id, U.mao(me, 'Energy Switch'), BOARD); }];
      }
    }
  }
  return null;
}
// Ativo que não ataca, preso por recuo: liga a energia do turno nele quando falta só 1 para recuar e há atacante pronto no banco
function regraDesencalhar(bot, st, ehAtacante) {
  const me = bot.eu(st); if (me.energyPlayedTurn === st.turn || me.retreatedTurn === st.turn) return null;
  const a = me.active, c = a.getPokemonCard(); if (!c || ehAtacante(a)) return null;
  const custo = (c.retreat || []).length, tem = energias(a);
  const pronto = me.bench.some(l => l.cards.length && ehAtacante(l) && faltaPrincipal(l) === 0);
  if (custo - tem !== 1 || !pronto || U.temNaMao(me, 'Switch')) return null;
  const i = me.hand.cards.findIndex(x => x instanceof G.EnergyCard); if (i < 0) return null;
  return ['desencalhar', () => new G.PlayCardAction(me.id, i, U.alvo(me, a))];
}
// cartas da mão (fora a que vai ser jogada) que o perfil aceita descartar sem perder nada (valor de descarte <= 50)
function baratas(bot, st, fora, limite = 50) {
  const me = bot.eu(st); let pulou = false;
  return me.hand.cards.filter(c => { if (!pulou && c.name === fora) { pulou = true; return false; } return bot.perfil.descarte(c, bot, st, U) <= limite; }).length;
}
// ---------- N's Zoroark ex (ficha claude/bots/ns-zoroark.md) ----------
PERFIS['n-zoroark'] = {
  banco: 5,
  // abertura: Budew no ativo (Itchy Pollen) ou Zorua; no banco só Zorua, 1 Zekrom e 1 Reshiram (nada de ex de suporte)
  inicio: { ativo: ['Budew', 'Tatsugiri', "N's Zorua", 'Munkidori', 'Yveltal', "N's Purrloin", "N's Darumaka", 'Pecharunt ex', 'Meowth ex', 'Fezandipiti ex', "N's Reshiram", "N's Zekrom"],
            banco: { "N's Zorua": 2, "N's Zekrom": 1 } },
  bloqueia(chave, bot, st) {
    if (/^bas:/.test(chave)) return true;               // o banco é montado pelas regras
    if (/^en:/.test(chave)) return true;                // a energia também
    if (/^apoio:Black Belt's Training$/.test(chave)) return true;   // só no fechamento, para nocaute
    if (/^item:N's PP Up$/.test(chave)) return true;   // nas regras (alvo certo)
    if (/^hab:Trade:/.test(chave)) return true;
    if (/^item:Special Red Card$/.test(chave)) return U.premiosRest(bot.op(st)) > 3;   // guardar até ele ter 3 prêmios ou menos
    // Ultra Ball só com 2 cartas baratas para descartar (não jogar fora Zekrom, Lillie, Chefia, Reshiram)
    if (/^item:Ultra Ball$/.test(chave)) return baratas(bot, st, 'Ultra Ball') < 2;
    return false;
  },
  regras(bot, st, U) {
    const me = bot.eu(st), op = bot.op(st), R = [];
    const zoro = l => U.nomeDe(l) === "N's Zoroark ex", zorua = l => U.nomeDe(l) === "N's Zorua";
    const linhas = U.conta(me, "N's Zorua") + U.conta(me, "N's Zoroark ex");
    const v = U.vaga(me), nv = U.vagas(me);
    const baixar = n => () => { const i = U.mao(me, n); return i >= 0 && v >= 0 ? new G.PlayCardAction(me.id, i, U.banco(me, v)) : null; };
    // 1. Zorua no banco (até 3 linhas), depois Zekrom, Reshiram, Pecharunt (sempre guardando 1 vaga)
    if (linhas < 3) R.push(['zorua', baixar("N's Zorua")]);
    if (!U.conta(me, "N's Zekrom")) R.push(['zekrom', baixar("N's Zekrom")]);

    const prontoBanco = me.bench.some(l => l.cards.length && zoro(l) && U.energias(l) >= 2);
    if (!U.conta(me, 'Pecharunt ex') && nv >= 2 && (prontoBanco || U.temNaMao(me, 'Binding Mochi'))) R.push(['pecharunt', baixar('Pecharunt ex')]);
    if (!U.conta(me, 'Munkidori') && nv >= 3 && linhas >= 2) R.push(['munkidori', baixar('Munkidori')]);
    // 1b. banco mínimo de 2 (perder o ativo sem banco é derrota)
    if (me.bench.filter(l => l.cards.length).length < 2 && v >= 0) {
      const b = me.hand.cards.findIndex(c => c instanceof G.PokemonCard && c.stage === G.Stage.BASIC);
      if (b >= 0) R.push(['banco-minimo', () => new G.PlayCardAction(me.id, b, U.banco(me, v))]);
    }
    // 1c. evoluir antes de ligar energia (z1 T2: Zoroark ex no Zorua ativo, depois a energia que faltava para atacar)
    if (st.turn > 2 && U.temNaMao(me, "N's Zoroark ex")) {
      const evo = [me.active, ...me.bench].filter(l => l.cards.length && zorua(l) && l.pokemonPlayedTurn < st.turn)
        .sort((a, b) => U.energias(b) - U.energias(a) || (b === me.active) - (a === me.active))[0];
      if (evo) R.push(['evoluir', () => new G.PlayCardAction(me.id, U.mao(me, "N's Zoroark ex"), U.alvo(me, evo))]);
    }
    // 2. energia do turno: no Zoroark ativo se ele ainda não tem 2; senão no Zoroark do banco com mais energia (< 2)
    const d = me.hand.cards.findIndex(c => c instanceof G.EnergyCard);
    // 2a. ativo encalhado (não é atacante, falta 1 energia para recuar, sem Castle/Switch/Chains) com atacante pronto no banco
    const custo = (me.active.getPokemonCard() ? me.active.getPokemonCard().retreat.length : 0);
    const castle = (G.StateUtils.getStadiumCard(st) || {}).name === "N's Castle";
    const prontoNoBanco = me.bench.some(l => l.cards.length && (zoro(l) || zorua(l)) && U.energias(l) >= 2);
    const temPech = U.conta(me, 'Pecharunt ex') > 0;
    if (d >= 0 && me.energyPlayedTurn !== st.turn && !zoro(me.active) && !castle && !temPech && prontoNoBanco &&
        custo - U.energias(me.active) === 1 && !U.temNaMao(me, 'Switch') && !U.temNaMao(me, "N's Castle"))
      R.push(['desencalhar', () => new G.PlayCardAction(me.id, d, U.alvo(me, me.active))]);
    // 2b. energia do turno (padrão dos profissionais): montar o atacante NO BANCO e subir com Chains/Castle/recuo.
    //     Ordem: Zoroark do banco mais perto de 2 > Zorua do banco com mais energia > Munkidori sem energia
    //     > Zoroark ativo com menos de 2 > Zorua ativo (por último: não ligar no Zorua ativo "por hábito").
    if (d >= 0 && me.energyPlayedTurn !== st.turn) {
      // montar no banco só compensa se houver como subir (Pecharunt em jogo, Castle, Switch na mão);
      // senão, completar o Zoroark ativo que já ataca neste turno com a energia vem primeiro.
      const sobe = temPech || castle || U.temNaMao(me, 'Switch') || U.temNaMao(me, "N's Castle") || U.temNaMao(me, 'Pecharunt ex');
      const nota = l => { const e = U.energias(l), ativo = l === me.active;
        if (zoro(l) && ativo && e === 1 && !sobe) return 200;           // ataca já neste turno
        if (zoro(l) && ativo && !sobe) return 150 + e * 10;             // sem como subir outro: o ativo é quem ataca
        if (zoro(l) && e < 2) return (ativo ? 40 : 100) + e * 10;
        if (zorua(l) && e < 2) return (ativo ? 10 : 70) + e * 10;
        if (U.nomeDe(l) === 'Munkidori' && e < 1) return 50;
        return -1; };
      const alvo = [me.active, ...me.bench].filter(l => l.cards.length && nota(l) > 0).sort((a, b) => nota(b) - nota(a))[0];
      if (alvo) R.push(['energia', () => new G.PlayCardAction(me.id, d, U.alvo(me, alvo))]);
    }
    // 3. N's PP Up num Zoroark do banco que ainda não tem 2 energias
    const ppu = U.mao(me, "N's PP Up");
    if (ppu >= 0 && me.bench.some(l => l.cards.length && zoro(l) && U.energias(l) < 2) && U.noDescarte(me, c => c instanceof G.EnergyCard))
      R.push(['ppup', () => new G.PlayCardAction(me.id, U.mao(me, "N's PP Up"), BOARD)]);
    // 3b. Ferramentas: Binding Mochi no Zoroark que ataca (com a Pecharunt para envenenar); Punk Helmet no Zoroark ativo
    const semFerr = l => l.cards.length && !(l.tools && l.tools.length);
    const atacante = [me.active, ...me.bench].filter(l => semFerr(l) && zoro(l)).sort((a, b) => U.energias(b) - U.energias(a) || (b === me.active) - (a === me.active))[0];
    if (atacante && U.temNaMao(me, 'Binding Mochi')) R.push(['mochi', () => new G.PlayCardAction(me.id, U.mao(me, 'Binding Mochi'), U.alvo(me, atacante))]);
    if (semFerr(me.active) && zoro(me.active) && U.temNaMao(me, 'Punk Helmet')) R.push(['helmet', () => new G.PlayCardAction(me.id, U.mao(me, 'Punk Helmet'), U.alvo(me, me.active))]);
    // 4. Trade só quando falta algo na mão, e guardando baralho para os turnos que faltam
    //    (sem isso o deck perdia por baralho vazio: 4 Zoroark x 2 cartas por turno + Lillie).
    const deck = me.deck.cards.length, faltaPremios = U.premiosRest(me);
    const reserva = 2 * faltaPremios + 6;                      // ~1 nocaute por turno e uma folga
    const temEnergia = me.hand.cards.some(c => c instanceof G.EnergyCard);
    const precisaEnergia = me.energyPlayedTurn !== st.turn && !temEnergia &&
      [me.active, ...me.bench].some(l => l.cards.length && (zoro(l) || zorua(l)) && U.energias(l) < 2);
    const temApoio = me.supporterTurn || me.hand.cards.some(c => c instanceof G.TrainerCard && c.trainerType === G.TrainerType.SUPPORTER);
    const zoroSemEvo = [me.active, ...me.bench].some(l => l.cards.length && zorua(l)) && !U.temNaMao(me, "N's Zoroark ex");
    const semZekrom = !U.conta(me, "N's Zekrom") && !U.temNaMao(me, "N's Zekrom");
    // profissionais (z1-z4): 2 a 4 Trade por turno, todo turno; o limite é só o baralho de reserva
    const falta = precisaEnergia || !temApoio || zoroSemEvo || semZekrom || me.hand.cards.length <= 2;
    // sem energia para atacar, até uma Chefia repetida ou um Zoroark a mais vão embora pelo Trade (o turno sem ataque custa mais)
    if (falta && deck - 2 >= reserva && baratas(bot, st, null, precisaEnergia ? 75 : 50) >= 1)
      [me.active, ...me.bench].forEach((l, j) => { if (l.cards.length && zoro(l))
        R.push(['trade' + j, () => new G.UseAbilityAction(me.id, 'Trade', U.alvo(me, l))]); });
    // 5. estádio: Watchtower contra Pokémon {C} com habilidade, senão Castle; trocar o estádio dele
    const est = G.StateUtils.getStadiumCard(st);
    const cComHab = U.emJogo(op).some(l => { const c = l.getPokemonCard(); return c && (c.cardType || []).includes(G.CardType.COLORLESS) && (c.powers || []).length; });
    const quer = cComHab && U.temNaMao(me, "Team Rocket's Watchtower") ? "Team Rocket's Watchtower" : "N's Castle";
    if (U.temNaMao(me, quer) && (!est || est.name !== quer)) R.push(['estadio', () => new G.PlayCardAction(me.id, U.mao(me, quer), BOARD)]);
    // 6. Apoiador de setup: Cyrano se falta Zoroark ex para evoluir; Lillie com mão pequena; Judge com a mão dele grande
    if (!me.supporterTurn) {
      if (U.temNaMao(me, 'Cyrano') && !U.temNaMao(me, "N's Zoroark ex") && me.bench.concat([me.active]).some(l => l.cards.length && zorua(l)))
        R.push(['cyrano', () => new G.PlayCardAction(me.id, U.mao(me, 'Cyrano'), BOARD)]);
      if (U.temNaMao(me, 'Judge') && op.hand.cards.length >= 6 && me.hand.cards.length <= 4) R.push(['judge', () => new G.PlayCardAction(me.id, U.mao(me, 'Judge'), BOARD)]);
    }
    return R;
  },
  busca(c, bot, st, U) {     // valor de pegar a carta numa busca do baralho (Poffin, Ultra Ball, Poké Pad, Cyrano, Lillie...)
    const me = bot.eu(st), n = c.name;
    const linhas = U.conta(me, "N's Zorua") + U.conta(me, "N's Zoroark ex");
    const zuaSemEvo = U.conta(me, "N's Zorua") > me.hand.cards.filter(x => x.name === "N's Zoroark ex").length;
    if (n === "N's Zorua") return linhas < 3 ? 10 - linhas : 1;
    if (n === "N's Zoroark ex") return zuaSemEvo ? 9.5 : 3;
    if (n === "N's Zekrom") return U.conta(me, n) || U.temNaMao(me, n) ? 1 : (linhas >= 2 ? 9.7 : 8.5);   // T1 dos profissionais: 2 Zorua e o Zekrom
    if (n === "N's Reshiram") return U.conta(me, n) || U.temNaMao(me, n) ? 0.5 : 6;
    if (n === 'Pecharunt ex') return U.conta(me, n) ? 0 : 4;
    if (n === 'Munkidori') return U.conta(me, n) ? 0 : 2;
    if (n === 'Budew' || n === 'Meowth ex' || n === 'Fezandipiti ex' || n === 'Tatsugiri' || n === 'Yveltal') return 0.4;
    if (c instanceof G.EnergyCard) return me.hand.cards.some(x => x instanceof G.EnergyCard) ? 3 : 9.8;   // sem energia na mão: prioridade máxima (Night Stretcher)
    if (n === BOSS) return 7;
    if (n === "Lillie's Determination") return 6;
    return 2;
  },
  descarte(c, bot, st, U) {  // ordem de descarte (Trade, Ultra Ball): baixo sai primeiro; > 50 só se obrigado
    const me = bot.eu(st), n = c.name;
    // Darkness descartada volta pela N's PP Up para o Zoroark do banco (é o motor de energia do deck).
    const ppup = me.hand.cards.some(x => x.name === "N's PP Up");
    const precisa = me.bench.some(l => l.cards.length && U.nomeDe(l) === "N's Zoroark ex" && U.energias(l) < 2);
    const ens = me.hand.cards.filter(x => x instanceof G.EnergyCard).length;
    const jaLigou = me.energyPlayedTurn === st.turn;
    if (c instanceof G.EnergyCard) {
      if (ppup && precisa && (ens > 1 || jaLigou) && !U.noDescarte(me, x => x instanceof G.EnergyCard)) return 1;   // descarta para a PP Up buscar
      return ens > 2 ? 8 : 60;
    }
    if (n === 'Special Red Card') return U.premiosRest(bot.op(st)) > 3 ? 55 : 20;   // guardada até ele ter 3 prêmios (CardForge); só sai se não houver outra
    if (n === 'Unfair Stamp') return 4;
    if (n === 'Budew' || n === 'Meowth ex' || n === 'Fezandipiti ex' || n === 'Yveltal' || n === 'Tatsugiri') return 3;
    if (n === 'Munkidori' && U.conta(me, n)) return 6;
    if (n === "N's Zorua" && U.conta(me, "N's Zorua") + U.conta(me, "N's Zoroark ex") >= 3) return 7;
    if (n === "Team Rocket's Watchtower" || n === "N's Castle") return me.hand.cards.filter(x => x.name === n).length > 1 ? 6 : 20;
    if (n === "N's Zekrom" && U.conta(me, n)) return 12;
    if (n === "N's Zekrom") return 75;                                     // o Rampaging/Shred vêm dele
    if (n === "N's Reshiram") return U.conta(me, n) ? 10 : 80;             // baixado no turno de usar o Virtuous Flame
    if (n === "Lillie's Determination" || n === BOSS) return 70;
    if (n === "N's Zoroark ex") return 65;
    return 30;
  },
  novoAtivo(l, bot, st) {    // quem sobe: Zoroark com energia > Zoroark > Pecharunt > o resto; nunca Zekrom/Reshiram
    const n = U.nomeDe(l), e = U.energias(l);
    if (n === "N's Zoroark ex") return 100 + e * 10 - l.damage / 100;
    if (n === 'Pecharunt ex') return 40;
    if (n === "N's Zorua") return 30;
    if (n === 'Budew' || n === 'Munkidori' || n === 'Yveltal') return 25;
    if (n === "N's Zekrom" || n === "N's Reshiram" || n === "N's Purrloin" || n === "N's Darmanitan") return 1;
    return 10;
  },
  alvoEnergia(l, bot, st) {  // PP Up / Janine: o Zoroark do banco mais perto de 2 energias
    const n = U.nomeDe(l), e = U.energias(l);
    if (n === "N's Zoroark ex") return e < 2 ? 50 + e * 10 : 5;
    if (n === "N's Zorua") return e < 2 ? 20 : 2;
    if (n === 'Munkidori') return e < 1 ? 8 : 0;
    return 0;
  },
  copias(atk, bot, st, U) {  // o Night Joker copia um ataque de um N's Pokémon do banco
    if (atk.name !== 'Night Joker') return null;
    const me = bot.eu(st), ns = new Set();
    me.bench.forEach(l => { const c = l.getPokemonCard(); if (c && /^N's /.test(c.name) && c.name !== "N's Zoroark ex") (c.attacks || []).forEach(a => ns.add(a.name)); });
    return [...ns];
  },
  copiasDaMao(atk, bot, st, U) {   // N's Pokémon na mão que, baixado agora, dá um ataque novo para o Night Joker
    if (atk.name !== 'Night Joker') return [];
    const me = bot.eu(st), ja = new Set(PERFIS['n-zoroark'].copias(atk, bot, st, U)), R = [], vistos = new Set();
    for (const c of me.hand.cards) {
      if (!(c instanceof G.PokemonCard) || c.stage !== G.Stage.BASIC || !/^N's /.test(c.name) || vistos.has(c.name)) continue;
      vistos.add(c.name);
      (c.attacks || []).forEach(a => { if (!ja.has(a.name)) R.push({ baixa: c.name, copia: a.name }); });
    }
    return R;
  },
  penalidade(plano, bot, st, U) {
    // Itchy Pollen (Budew) no começo: trava os Itens do oponente no próximo turno (Ultra Ball, Poké Pad, Night Stretcher)
    if (plano.ataque === 'Itchy Pollen' && st.turn <= 8) return -150;
    // Rampaging Thunder trava o atacante no próximo turno: só vale se pegar mais prêmios que as outras opções
    if (plano.copia === 'Rampaging Thunder') return 300;
    if (plano.copia === 'Flamebody Cannon') return 250;   // descarta as energias do Zoroark
    return 0;
  },
};


// ---------- Basic Box (ficha claude/bots/basic-box.md; lista do Gantner, campeão de Nice) ----------
// Plano dos profissionais: Kangaskhan no ativo usa Run Errand, Teal Dance compra, Latias zera o recuo
// e o fim do turno escolhe o golpe que nocauteia (o fechamento por planos simula todos os atacantes).
const KANGA = 'Mega Kangaskhan ex', TEAL = 'Teal Mask Ogerpon ex', LATIAS = 'Latias ex', MEOWTH = 'Meowth ex';
PERFIS['basic-box-m'] = {
  banco: 4,
  inicio: { ativo: [KANGA, LATIAS, TEAL, MEOWTH, 'Wellspring Mask Ogerpon ex', "Lillie's Clefairy ex", 'Fezandipiti ex', 'Iron Crown ex', 'Raging Bolt ex', 'Passimian', 'Enamorus'],
            banco: { [LATIAS]: 1, [TEAL]: 1, [KANGA]: 1 } },
  bloqueia(chave, bot, st) {
    if (/^bas:/.test(chave)) return true;                 // banco pelas regras (cada ex no banco é alvo de 2-3 prêmios)
    if (/^en:/.test(chave)) return true;                  // energia pelas regras
    if (/^item:Energy Switch$/.test(chave)) return true;  // nas regras (só para completar o ataque do ativo)
    if (/^est:Area Zero Underdepths$/.test(chave)) return U.vagas(bot.eu(st)) > 0;   // só quando o banco lota
    if (/^item:Special Red Card$/.test(chave)) return U.premiosRest(bot.op(st)) > 3;
    if (/^item:Prime Catcher$/.test(chave)) return true;  // ACE SPEC: fica para o plano (não implementado) — guardar
    if (/^item:Ultra Ball$/.test(chave)) return baratas(bot, st, 'Ultra Ball') < 2;
    if (/^apoio:Crispin$/.test(chave)) return !precisaEnergia(bot, st);
    return false;
  },
  regras(bot, st, U) {
    const me = bot.eu(st), R = [], v = U.vaga(me), nb = me.bench.filter(l => l.cards.length).length;
    const baixar = n => () => { const i = U.mao(me, n); return i >= 0 && v >= 0 ? new G.PlayCardAction(me.id, i, U.banco(me, v)) : null; };
    // 0. com Latias em jogo o recuo é grátis: Kangaskhan no ativo antes de tudo (Run Errand compra 2 e ele é o atacante)
    const kb = me.bench.findIndex(l => l.cards.length && U.nomeDe(l) === KANGA);
    if (U.nomeDe(me.active) !== KANGA && kb >= 0 && U.conta(me, LATIAS) && me.retreatedTurn !== st.turn && !(U.nomeDe(me.active) === LATIAS && faltaPrincipal(me.active) === 0))
      R.push(['sobe-kanga', () => new G.RetreatAction(me.id, kb)]);
    // 1. compra por Habilidade primeiro (Run Errand só no ativo; Teal Dance com Grama na mão)
    if (U.nomeDe(me.active) === KANGA && me.deck.cards.length > 4) R.push(['run-errand', () => new G.UseAbilityAction(me.id, 'Run Errand', U.alvo(me, me.active))]);
    if (me.hand.cards.some(c => c.name === 'Grass Energy'))
      [me.active, ...me.bench].forEach((l, j) => { if (l.cards.length && U.nomeDe(l) === TEAL) R.push(['teal' + j, () => new G.UseAbilityAction(me.id, 'Teal Dance', U.alvo(me, l))]); });
    // 2. peças: Latias (recuo 0), um Teal Mask (energia e compra), um 2º Kangaskhan (próximo atacante)
    if (!U.conta(me, LATIAS)) R.push(['latias', baixar(LATIAS)]);
    if (!U.conta(me, TEAL)) R.push(['teal', baixar(TEAL)]);
    if (U.conta(me, KANGA) < 2 && nb < 4) R.push(['kanga', baixar(KANGA)]);
    // 2b. Ultra Ball antes da energia quando falta peça (Kangaskhan, Latias, Teal Mask): a energia vai no Kangaskhan certo
    const falta2 = U.conta(me, KANGA) + me.hand.cards.filter(c => c.name === KANGA).length < 2 || !U.conta(me, LATIAS) && !U.temNaMao(me, LATIAS);
    if (falta2 && U.temNaMao(me, 'Ultra Ball') && baratas(bot, st, 'Ultra Ball') >= 2 && v >= 0) R.push(['ultra', () => new G.PlayCardAction(me.id, U.mao(me, 'Ultra Ball'), BOARD)]);
    // 3. Meowth ex só para buscar o Apoiador que falta (Last-Ditch Catch)
    const temApoio = me.hand.cards.some(c => c instanceof G.TrainerCard && c.trainerType === G.TrainerType.SUPPORTER);
    if (!temApoio && !me.supporterTurn && nb < 4) R.push(['meowth', baixar(MEOWTH)]);
    // 4. banco mínimo de 2 (Pokémon de 1 prêmio primeiro)
    if (nb < 2 && v >= 0) {
      const ord = me.hand.cards.map((c, i) => [c, i]).filter(([c]) => c instanceof G.PokemonCard && c.stage === G.Stage.BASIC)
        .sort(([a], [b]) => { const p = c => [KANGA, LATIAS, TEAL].includes(c.name) ? 0 : U.ehEx(c) ? 2 : 1; return p(a) - p(b); });
      if (ord.length) R.push(['banco-minimo', () => new G.PlayCardAction(me.id, ord[0][1], U.banco(me, v))]);
    }
    // 5. energia: no atacante (Kangaskhan ativo > Kangaskhan do banco > quem completa um ataque)
    if (me.energyPlayedTurn !== st.turn) {
      const ens = me.hand.cards.map((c, i) => [c, i]).filter(([c]) => c instanceof G.EnergyCard);
      const pares = [];
      for (const [e, i] of ens) for (const l of [me.active, ...me.bench]) {
        if (!l.cards.length) continue;
        const antes = faltaMin(l), depois = faltaMin(l, e.provides || [G.CardType.COLORLESS]); if (depois >= antes) continue;
        const n = U.nomeDe(l);
        let nota = (n === KANGA ? 60 : n === LATIAS || n === 'Fezandipiti ex' ? 30 : n === MEOWTH ? -50 : 10) + (l === me.active ? 15 : 0) + (depois === 0 ? 20 : 0);
        if (e.name === 'Grass Energy' && U.conta(me, TEAL) && n !== TEAL) nota -= 8;   // Grama é do Teal Dance
        pares.push([nota, e, i, l]);
      }
      pares.sort((a, b) => b[0] - a[0]);
      if (pares.length && pares[0][0] > 0) { const [, , i, l] = pares[0]; R.push(['energia', () => new G.PlayCardAction(me.id, i, U.alvo(me, l))]); }
    }
    { const r = regraDesencalhar(bot, st, l => [KANGA, 'Fezandipiti ex', 'Raging Bolt ex', 'Iron Leaves ex', "Lillie's Clefairy ex"].includes(U.nomeDe(l)) || (U.nomeDe(l) === LATIAS && faltaPrincipal(l) === 0)); if (r) R.push(r); }
    // 5b. Energy Switch: do Teal Mask / quem não ataca para o Kangaskhan mais carregado
    { const k = [me.active, ...me.bench].filter(l => l.cards.length && U.nomeDe(l) === KANGA).sort((a, b) => U.energias(b) - U.energias(a))[0];
      const r = regraTrocaEnergia(bot, st, k, l => U.nomeDe(l) !== KANGA); if (r) R.push(r); }
    // 6. Crispin (busca 2 energias, liga 1) quando um atacante ainda precisa de 2+; qualquer tamanho de mão
    if (!me.supporterTurn && U.temNaMao(me, 'Crispin') && precisaEnergia(bot, st)) R.push(['crispin', () => new G.PlayCardAction(me.id, U.mao(me, 'Crispin'), BOARD)]);
    return R;
  },
  busca(c, bot, st, U) {
    const me = bot.eu(st), n = c.name, tem = x => U.conta(me, x) + me.hand.cards.filter(y => y.name === x).length;
    if (n === LATIAS) return tem(LATIAS) ? 1 : 9.5;
    if (n === KANGA) return tem(KANGA) >= 2 ? 1.5 : 9;
    if (n === TEAL) return tem(TEAL) ? 2 : 8.5;
    if (n === 'Crispin') return precisaEnergia(bot, st) ? 9 : 4;
    if (n === BOSS) return 7;
    if (n === 'Cyrano') return 6;
    if (n === "Ciphermaniac's Codebreaking") return 3;
    if (n === MEOWTH || n === 'Chien-Pao' || n === 'Passimian') return 0.5;
    if (c instanceof G.EnergyCard) return me.hand.cards.some(x => x instanceof G.EnergyCard) ? 2 : 7;
    return 2;
  },
  descarte(c, bot, st, U) {
    const me = bot.eu(st), n = c.name;
    if (c instanceof G.EnergyCard) return me.hand.cards.filter(x => x instanceof G.EnergyCard).length > 1 ? 5 : 40;
    if (n === 'Chien-Pao' || n === 'Passimian' || n === 'Enamorus' || n === 'Iron Crown ex') return 3;
    if (n === MEOWTH) return 6;
    if (n === 'Energy Switch' || n === 'Area Zero Underdepths') return 8;
    if (n === 'Special Red Card') return U.premiosRest(bot.op(st)) > 3 ? 55 : 20;
    if (n === KANGA || n === LATIAS) return U.conta(me, n) ? 25 : 70;
    if (n === BOSS || n === 'Crispin') return 60;
    return 30;
  },
  alvoEnergia(l, bot, st) {     // Crispin, Glass Trumpet: no Kangaskhan que vai atacar
    const n = U.nomeDe(l), f = faltaMin(l);
    if (f === 99 || f === 0) return 0;
    return (n === KANGA ? 50 : n === LATIAS || n === 'Fezandipiti ex' ? 25 : n === MEOWTH ? 1 : 10) + (l === bot.eu(st).active ? 5 : 0);
  },
  novoAtivo(l, bot, st) {       // quem sobe: o que ataca já, de preferência o Kangaskhan
    const n = U.nomeDe(l), pronto = faltaMin(l) === 0;
    return (pronto ? 100 : 0) + (n === KANGA ? 30 : n === LATIAS ? 15 : n === MEOWTH ? -10 : 5) - l.damage / 100;
  },
  penalidade(plano, bot, st, U) {
    if (plano.ataque === 'Tuck Tail') return 200;           // devolver o Meowth só se nada melhor
    if (plano.ataque === 'Bellowing Thunder') return 60;    // joga energia fora
    return 0;
  },
};
function precisaEnergia(bot, st) {   // algum atacante falta 2+ energias (Crispin compensa)
  const me = bot.eu(st);
  return [me.active, ...me.bench].some(l => l.cards.length && [KANGA, LATIAS, 'Fezandipiti ex'].includes(U.nomeDe(l)) && faltaMin(l) >= 2);
}


// ---------- Mega Rayquaza (ficha claude/bots/mega-rayquaza.md) ----------
// Storm Emerald = 50 x (Fogo + Raio em TODOS os seus Pokémon): o plano é encher o campo de energia
// (Ho-Oh do banco com Golden Flame, Ruler's Roar ao baixar o Rayquaza, Crispin) e pagar R L C no Rayquaza.
const RAY = 'Mega Rayquaza ex', HOOH = "Ethan's Ho-Oh ex", TALON = 'Talonflame ex';
PERFIS['mega-rayquaza-ex'] = {
  banco: 4,
  inicio: { ativo: [KANGA, LATIAS, MEOWTH, 'Fezandipiti ex', 'Iron Thorns ex', TALON, HOOH, RAY],
            banco: { [HOOH]: 1, [LATIAS]: 1 } },
  bloqueia(chave, bot, st) {
    if (/^bas:/.test(chave)) return true;
    if (/^en:/.test(chave)) return true;
    if (/^item:Energy Switch$/.test(chave)) return true;
    if (/^item:Special Red Card$/.test(chave)) return U.premiosRest(bot.op(st)) > 3;
    if (/^item:Ultra Ball$/.test(chave)) return baratas(bot, st, 'Ultra Ball') < 2;
    if (/^apoio:Crispin$/.test(chave)) return true;     // nas regras
    if (/^hab:Initialization/.test(chave)) return true;
    if (/^item:Switch$/.test(chave)) return true;       // só no fechamento (modo switch)
    return false;
  },
  regras(bot, st, U) {
    const me = bot.eu(st), R = [], v = U.vaga(me), nb = me.bench.filter(l => l.cards.length).length;
    const baixar = n => () => { const i = U.mao(me, n); return i >= 0 && v >= 0 ? new G.PlayCardAction(me.id, i, U.banco(me, v)) : null; };
    const kb = me.bench.findIndex(l => l.cards.length && U.nomeDe(l) === KANGA);
    if (![KANGA, LATIAS, RAY].includes(U.nomeDe(me.active)) && kb >= 0 && U.conta(me, LATIAS) && me.retreatedTurn !== st.turn)
      R.push(['sobe-kanga', () => new G.RetreatAction(me.id, kb)]);
    if (U.nomeDe(me.active) === KANGA && me.deck.cards.length > 6) R.push(['run-errand', () => new G.UseAbilityAction(me.id, 'Run Errand', U.alvo(me, me.active))]);
    // peças: Ho-Oh (acelera do banco), Latias (recuo 0), Rayquaza baixado da mão (Ruler's Roar liga 1 energia)
    if (!U.conta(me, HOOH)) R.push(['hooh', baixar(HOOH)]);
    if (!U.conta(me, LATIAS)) R.push(['latias', baixar(LATIAS)]);
    if (!U.conta(me, RAY)) R.push(['ray', baixar(RAY)]);
    if (U.conta(me, RAY) && U.conta(me, KANGA) + U.conta(me, TALON) < 1 && nb < 4) R.push(['talon', baixar(TALON)]);
    // Golden Flame em cada Ho-Oh com Fogo na mão
    if (me.hand.cards.some(c => c.name === 'Fire Energy'))
      [me.active, ...me.bench].forEach((l, j) => { if (l.cards.length && U.nomeDe(l) === HOOH) R.push(['golden' + j, () => new G.UseAbilityAction(me.id, 'Golden Flame', U.alvo(me, l))]); });
    const temApoio = me.hand.cards.some(c => c instanceof G.TrainerCard && c.trainerType === G.TrainerType.SUPPORTER);
    if (!temApoio && !me.supporterTurn && nb < 4) R.push(['meowth', baixar(MEOWTH)]);
    if (nb < 2 && v >= 0) {
      const ord = me.hand.cards.map((c, i) => [c, i]).filter(([c]) => c instanceof G.PokemonCard && c.stage === G.Stage.BASIC)
        .sort(([a], [b]) => { const p = c => [HOOH, LATIAS, RAY, KANGA].includes(c.name) ? 0 : 1; return p(a) - p(b); });
      if (ord.length) R.push(['banco-minimo', () => new G.PlayCardAction(me.id, ord[0][1], U.banco(me, v))]);
    }
    // energia manual: Raio no Rayquaza se ele não tem; Fogo no Rayquaza até R; senão no Ho-Oh do banco (conta igual)
    if (me.energyPlayedTurn !== st.turn) {
      const ray = [me.active, ...me.bench].find(l => l.cards.length && U.nomeDe(l) === RAY);
      const tem = (l, n) => l.cards.some(c => c.name === n);
      const iL = U.mao(me, 'Lightning Energy'), iF = U.mao(me, 'Fire Energy');
      let alvo = null, i = -1;
      if (ray && !tem(ray, 'Lightning Energy') && iL >= 0) { alvo = ray; i = iL; }
      else if (ray && faltaMin(ray) > 0 && (iF >= 0 || iL >= 0)) { alvo = ray; i = iF >= 0 ? iF : iL; }
      else { const ho = me.bench.find(l => l.cards.length && U.nomeDe(l) === HOOH) || me.bench.find(l => l.cards.length && U.nomeDe(l) !== MEOWTH);
        i = iF >= 0 ? iF : iL; alvo = ho || me.active; }
      if (alvo && i >= 0) R.push(['energia', () => new G.PlayCardAction(me.id, i, U.alvo(me, alvo))]);
    }
    { const r = regraDesencalhar(bot, st, l => [RAY, KANGA, TALON].includes(U.nomeDe(l))); if (r) R.push(r); }
    {   // Energy Switch: do Ho-Oh (ou outro que não ataca) para o Rayquaza que vai atacar
      const ray = [me.active, ...me.bench].filter(l => l.cards.length && U.nomeDe(l) === RAY).sort((a, b) => U.energias(b) - U.energias(a))[0];
      const r = regraTrocaEnergia(bot, st, ray, l => U.nomeDe(l) !== RAY); if (r) R.push(r);
    }
    if (!me.supporterTurn) {
      const ray = [me.active, ...me.bench].find(l => l.cards.length && U.nomeDe(l) === RAY);
      if (U.temNaMao(me, 'Cyrano') && (!U.conta(me, RAY) || !U.conta(me, HOOH))) R.push(['cyrano', () => new G.PlayCardAction(me.id, U.mao(me, 'Cyrano'), BOARD)]);
      if (U.temNaMao(me, 'Crispin') && ray && faltaMin(ray) >= 1) R.push(['crispin', () => new G.PlayCardAction(me.id, U.mao(me, 'Crispin'), BOARD)]);
    }
    return R;
  },
  busca(c, bot, st, U) {
    const me = bot.eu(st), n = c.name, tem = x => U.conta(me, x) + me.hand.cards.filter(y => y.name === x).length;
    if (n === RAY) return tem(RAY) ? (tem(RAY) >= 2 ? 1 : 5) : 9.6;
    if (n === HOOH) return tem(HOOH) ? 3 : 9.4;
    if (n === LATIAS) return tem(LATIAS) ? 1 : 8.5;
    if (n === KANGA) return tem(KANGA) ? 2 : 7;
    if (n === TALON) return tem(TALON) ? 1 : 6;
    if (n === 'Cyrano') return !U.conta(me, RAY) || !U.conta(me, HOOH) ? 9 : 5;
    if (n === 'Crispin') return 7;
    if (n === BOSS) return 6.5;
    if (n === 'Lightning Energy') return me.hand.cards.some(x => x.name === n) ? 3 : 8;
    if (n === 'Fire Energy') return 4;
    if (n === MEOWTH || n === 'Iron Thorns ex' || n === 'Fezandipiti ex') return 0.5;
    return 2;
  },
  descarte(c, bot, st, U) {
    const me = bot.eu(st), n = c.name;
    if (n === 'Fire Energy') return me.hand.cards.filter(x => x.name === n).length > 2 ? 6 : 35;
    if (n === 'Lightning Energy') return 45;
    if (n === 'Iron Thorns ex' || n === 'Fezandipiti ex' || n === MEOWTH) return 3;
    if (n === 'Legendary Pyroduct' || n === 'Energy Switch' || n === 'Blowtorch') return 8;
    if (n === 'Special Red Card') return U.premiosRest(bot.op(st)) > 3 ? 55 : 20;
    if (n === RAY || n === HOOH) return U.conta(me, n) ? 25 : 75;
    if (n === BOSS || n === 'Crispin' || n === 'Cyrano') return 60;
    return 30;
  },
  alvoEnergia(l, bot, st) {     // Golden Flame / Crispin / Ruler's Roar: Rayquaza até pagar, senão o Ho-Oh do banco
    const n = U.nomeDe(l), me = bot.eu(st);
    if (n === RAY) return faltaMin(l) > 0 ? 60 : 20;
    if (n === HOOH) return l === me.active ? 5 : 40;
    if (n === MEOWTH) return 1;
    return 10;
  },
  novoAtivo(l, bot, st) {
    const n = U.nomeDe(l), pronto = faltaMin(l) === 0;
    return (pronto ? 100 : 0) + (n === KANGA ? 30 : n === TALON ? 25 : n === RAY ? 20 : n === LATIAS ? 15 : n === MEOWTH ? -10 : 5) - l.damage / 100;
  },
  penalidade(plano, bot, st, U) {
    if (plano.ataque === 'Tuck Tail') return 200;
    if (plano.ataque === 'Storm Emerald') return 90;      // expõe 3 prêmios: só se render mais que Kangaskhan/Talonflame
    return 0;
  },
};


// ---------- Slowking (ficha claude/bots/slowking.md; guia do Mythras, lista de Malaca) ----------
// Combo: Academy at Night põe um Pokémon sem Regra da mão no topo e o Seek Inspiration copia o ataque dele
// sem pagar o custo (Kyurem Trifrost 110x3, Zeraora 210 no banco, Metagross 150). O fechamento simula cada carta de topo.
const SLOWK = 'Slowking', SLOWP = 'Slowpoke', ALVOS_TOPO = ['Kyurem', 'Zeraora', 'Metagross', 'Annihilape', 'Smoochum', 'Slowpoke'];
PERFIS['slowking-scr'] = {
  banco: 4,
  inicio: { ativo: [KANGA, LATIAS, SLOWP, MEOWTH, 'Fezandipiti ex', "Lillie's Clefairy ex", 'Mew ex'],
            banco: { [SLOWP]: 2, [LATIAS]: 1 } },
  topo: { ataque: 'Seek Inspiration', cartas(bot, st, U) {
    const me = bot.eu(st), vis = new Set(), R = [];
    for (const c of me.hand.cards) if (c instanceof G.PokemonCard && !U.ehEx(c) && !vis.has(c.name) && c.name !== SLOWK) { vis.add(c.name); R.push(c); }
    return R; } },
  bloqueia(chave, bot, st) {
    if (/^bas:/.test(chave)) return true;
    if (/^est:/.test(chave)) return true;                  // Academy pelas regras
    if (/^item:Switch$/.test(chave)) return true;
    if (/^apoio:Ciphermaniac/.test(chave)) return true;    // nas regras
    if (/^apoio:Boss's Orders$/.test(chave)) return true;
    if (/^item:Ultra Ball$/.test(chave)) return baratas(bot, st, 'Ultra Ball') < 2;
    return false;
  },
  regras(bot, st, U) {
    const me = bot.eu(st), R = [], v = U.vaga(me), nb = me.bench.filter(l => l.cards.length).length;
    const baixar = n => () => { const i = U.mao(me, n); return i >= 0 && v >= 0 ? new G.PlayCardAction(me.id, i, U.banco(me, v)) : null; };
    // Kangaskhan ativo compra (Run Errand) e sai de graça pela Latias no fechamento
    const kb = me.bench.findIndex(l => l.cards.length && U.nomeDe(l) === KANGA);
    if (![KANGA, SLOWK].includes(U.nomeDe(me.active)) && kb >= 0 && U.conta(me, LATIAS) && me.retreatedTurn !== st.turn && me.active.getPokemonCard() && me.active.getPokemonCard().stage === G.Stage.BASIC)
      R.push(['sobe-kanga', () => new G.RetreatAction(me.id, kb)]);
    if (U.nomeDe(me.active) === KANGA && me.deck.cards.length > 6) R.push(['run-errand', () => new G.UseAbilityAction(me.id, 'Run Errand', U.alvo(me, me.active))]);
    // estádio: Academy at Night sempre em jogo
    const est = G.StateUtils.getStadiumCard(st);
    if (U.temNaMao(me, 'Academy at Night') && (!est || est.name !== 'Academy at Night')) R.push(['academy', () => new G.PlayCardAction(me.id, U.mao(me, 'Academy at Night'), BOARD)]);
    // linha: 2 Slowpoke/Slowking, Latias, 1 Kangaskhan no banco
    if (U.conta(me, SLOWP) + U.conta(me, SLOWK) < 3) R.push(['slowpoke', baixar(SLOWP)]);
    if (!U.conta(me, LATIAS)) R.push(['latias', baixar(LATIAS)]);
    if (!U.conta(me, KANGA) && nb < 4) R.push(['kanga', baixar(KANGA)]);
    if (nb < 2 && v >= 0) { const i = me.hand.cards.findIndex(c => c instanceof G.PokemonCard && c.stage === G.Stage.BASIC && !U.ehEx(c) && !ALVOS_TOPO.slice(0, 4).includes(c.name));
      if (i >= 0) R.push(['banco-minimo', () => new G.PlayCardAction(me.id, i, U.banco(me, v))]); }
    // energia: P + C no Slowking/Slowpoke (Telepathic busca Básicos Psychic ao ligar); nada nos alvos de topo
    if (me.energyPlayedTurn !== st.turn) {
      const ens = me.hand.cards.map((c, i) => [c, i]).filter(([c]) => c instanceof G.EnergyCard).sort(([a], [b]) => (b.name === 'Telepathic Psychic Energy') - (a.name === 'Telepathic Psychic Energy'));
      const prontos = [me.active, ...me.bench].filter(l => l.cards.length && U.nomeDe(l) === SLOWK && faltaMin(l) === 0).length;
      const linha = [me.active, ...me.bench].filter(l => l.cards.length && [SLOWK, SLOWP].includes(U.nomeDe(l)) && U.energias(l) < 2 && prontos < 2)
        .sort((a, b) => (U.nomeDe(b) === SLOWK) - (U.nomeDe(a) === SLOWK) || U.energias(b) - U.energias(a) || (b === me.active) - (a === me.active));
      const kg = [me.active, ...me.bench].find(l => l.cards.length && U.nomeDe(l) === KANGA && U.energias(l) < 3);
      // Kangaskhan no ativo é o tanque que ataca (300 HP, 200 de dano) enquanto os Slowking ficam prontos no banco
      if (ens.length && kg && kg === me.active && (prontos >= 1 || !linha.length)) R.push(['energia-kanga', () => new G.PlayCardAction(me.id, ens[ens.length - 1][1], U.alvo(me, kg))]);
      if (ens.length && linha.length) R.push(['energia', () => new G.PlayCardAction(me.id, ens[0][1], U.alvo(me, linha[0]))]);
      else if (ens.length && kg) R.push(['energia-kanga2', () => new G.PlayCardAction(me.id, ens[ens.length - 1][1], U.alvo(me, kg))]);
    }
    // sem alvo de topo na mão: Poké Pad / Ultra Ball buscam (a busca prefere Kyurem/Metagross/Zeraora)
    const temAlvo = me.hand.cards.some(c => ALVOS_TOPO.slice(0, 3).includes(c.name));
    if (!temAlvo && U.temNaMao(me, 'Poké Pad')) R.push(['pad', () => new G.PlayCardAction(me.id, U.mao(me, 'Poké Pad'), BOARD)]);
    if (!me.supporterTurn && U.temNaMao(me, "Lillie's Determination") && me.hand.cards.length <= 5) R.push(['lillie', () => new G.PlayCardAction(me.id, U.mao(me, "Lillie's Determination"), BOARD)]);
    return R;
  },
  busca(c, bot, st, U) {
    const me = bot.eu(st), n = c.name, tem = x => U.conta(me, x) + me.hand.cards.filter(y => y.name === x).length;
    const op = bot.op(st), dano = op.active.getPokemonCard() ? op.active.hp - op.active.damage : 999;
    if (n === SLOWK) return tem(SLOWK) < Math.min(2, U.conta(me, SLOWP)) ? 9.6 : 2;
    if (n === SLOWP) return tem(SLOWP) + tem(SLOWK) < 2 ? 9.5 : 1.5;
    if (n === 'Metagross') return tem(n) ? 1 : (dano <= 150 ? 9 : 7);
    if (n === 'Kyurem') return tem(n) ? 1 : 8;
    if (n === 'Zeraora') return tem(n) ? 1 : 6;
    if (n === LATIAS) return tem(LATIAS) ? 0.5 : 8.5;
    if (n === KANGA) return tem(KANGA) ? 1 : 6.5;
    if (n === 'Annihilape') return tem(n) ? 0.5 : 4;
    if (n === 'Academy at Night') return tem(n) || (G.StateUtils.getStadiumCard(st) || {}).name === n ? 1 : 8;
    if (c instanceof G.EnergyCard) return me.hand.cards.some(x => x instanceof G.EnergyCard) ? 2 : 7;
    if (U.ehEx(c)) return 0.3;
    return 2;
  },
  descarte(c, bot, st, U) {
    const me = bot.eu(st), n = c.name;
    if (n === 'Slowpoke' && U.conta(me, SLOWP) + U.conta(me, SLOWK) >= 2) return 20;   // volta com Dangle Tail/Stretcher
    if (U.ehEx(c) && U.conta(me, n)) return 4;
    if (n === MEOWTH || n === 'Fezandipiti ex' || n === "Lillie's Clefairy ex" || n === 'Mew ex') return 5;
    if (c instanceof G.EnergyCard) return me.hand.cards.filter(x => x instanceof G.EnergyCard).length > 1 ? 8 : 40;
    if (['Kyurem', 'Metagross', 'Zeraora'].includes(n)) return me.hand.cards.filter(x => x.name === n).length > 1 ? 15 : 45;
    if (n === SLOWK) return 70;
    return 30;
  },
  alvoEnergia(l, bot, st) { const n = U.nomeDe(l); return n === SLOWK ? 50 : n === SLOWP ? 40 : 0; },
  novoAtivo(l, bot, st) {
    const n = U.nomeDe(l);
    return (n === SLOWK && faltaMin(l) === 0 ? 100 : 0) + (n === KANGA ? 50 : n === SLOWK ? 30 : n === LATIAS ? 10 : U.ehEx(l.getPokemonCard()) ? -5 : 15) - l.damage / 100;
  },
  penalidade(plano, bot, st, U) {
    if (plano.copia === 'Destined Fight') return 150;
    if (plano.ataque === 'Tuck Tail') return 200;
    return 0;
  },
};


// ---------- Dragapult / Blaziken (ficha claude/bots/dragapult-blaziken.md) ----------
// Dragapult ex (Phantom Dive R+P: 200 + 6 contadores no banco) é o atacante; Blaziken ex (Seething Spirit)
// liga energia do descarte todo turno; Drakloak compra (Recon Directive). Budew trava itens no começo.
const DPULT = 'Dragapult ex', DRAK = 'Drakloak', DREEPY = 'Dreepy', BLAZ = 'Blaziken ex', TORCHIC = 'Torchic', COMB = 'Combusken';
function linhaDragapult(me) { return U.conta(me, DREEPY) + U.conta(me, DRAK) + U.conta(me, DPULT); }
PERFIS['dragapult-blaziken'] = {
  banco: 5,
  inicio: { ativo: ['Budew', 'Munkidori', 'Chi-Yu', TORCHIC, DREEPY, MEOWTH, 'Fezandipiti ex'],
            banco: { [DREEPY]: 2, [TORCHIC]: 1 } },
  bloqueia(chave, bot, st) {
    if (/^bas:/.test(chave)) return true;
    if (/^en:/.test(chave)) return true;
    if (/^item:Ultra Ball$/.test(chave)) return baratas(bot, st, 'Ultra Ball') < 2;
    return false;
  },
  regras(bot, st, U) {
    const me = bot.eu(st), R = [], v = U.vaga(me), nb = me.bench.filter(l => l.cards.length).length;
    const baixar = n => () => { const i = U.mao(me, n); return i >= 0 && v >= 0 ? new G.PlayCardAction(me.id, i, U.banco(me, v)) : null; };
    if (linhaDragapult(me) < 3) R.push(['dreepy', baixar(DREEPY)]);
    if (U.conta(me, TORCHIC) + U.conta(me, COMB) + U.conta(me, BLAZ) < 1) R.push(['torchic', baixar(TORCHIC)]);
    if (!U.conta(me, 'Munkidori') && nb < 4 && me.hand.cards.some(c => c.name === 'Darkness Energy')) R.push(['munki', baixar('Munkidori')]);
    if (nb < 2 && v >= 0) { const i = me.hand.cards.findIndex(c => c instanceof G.PokemonCard && c.stage === G.Stage.BASIC && !U.ehEx(c));
      if (i >= 0) R.push(['banco-minimo', () => new G.PlayCardAction(me.id, i, U.banco(me, v))]); }
    { const r = regraDesencalhar(bot, st, l => [DPULT, BLAZ].includes(U.nomeDe(l))); if (r) R.push(r); }
    // evoluir Dragapult/Drakloak primeiro (generic evo vem depois, mas a energia precisa ir no evoluído)
    ['Dragapult ex', 'Drakloak', 'Blaziken ex', 'Combusken'].forEach(n => {
      const c = me.hand.cards.find(x => x.name === n); if (!c) return;
      const base = [me.active, ...me.bench].find(l => l.cards.length && U.nomeDe(l) === c.evolvesFrom && l.pokemonPlayedTurn < st.turn);
      if (base && st.turn > 2) R.push(['evo:' + n, () => new G.PlayCardAction(me.id, U.mao(me, n), U.alvo(me, base))]);
    });
    // energia: Fogo/Psíquico na linha do Dragapult (ex > Drakloak > Dreepy), Escuridão no Munkidori
    if (me.energyPlayedTurn !== st.turn) {
      const pares = [];
      me.hand.cards.forEach((e, i) => { if (!(e instanceof G.EnergyCard)) return;
        [me.active, ...me.bench].forEach(l => { if (!l.cards.length) return; const n = U.nomeDe(l);
          const antes = faltaPrincipal(l), depois = faltaPrincipal(l, e.provides || []); if (depois >= antes) return;
          const nota = (n === DPULT ? 60 : n === DRAK ? 45 : n === DREEPY ? 30 : n === 'Munkidori' ? 25 : n === BLAZ ? 5 : -10) + (depois === 0 ? 10 : 0);
          pares.push([nota, i, l]); }); });
      pares.sort((a, b) => b[0] - a[0]);
      if (pares.length && pares[0][0] > 0) { const [, i, l] = pares[0]; R.push(['energia', () => new G.PlayCardAction(me.id, i, U.alvo(me, l))]); }
    }
    // Crispin: Fogo + Psíquico (um ligado, um na mão) quando o Dragapult/Drakloak ainda não paga o Phantom Dive
    const at = [me.active, ...me.bench].filter(l => l.cards.length && [DPULT, DRAK].includes(U.nomeDe(l)) && faltaPrincipal(l) > 0);
    if (!me.supporterTurn && at.length && U.temNaMao(me, 'Crispin')) R.push(['crispin', () => new G.PlayCardAction(me.id, U.mao(me, 'Crispin'), BOARD)]);
    return R;
  },
  busca(c, bot, st, U) {
    const me = bot.eu(st), n = c.name, tem = x => U.conta(me, x) + me.hand.cards.filter(y => y.name === x).length;
    if (n === DREEPY) return linhaDragapult(me) + me.hand.cards.filter(x => x.name === DREEPY).length < 3 ? 9.5 : 1;
    if (n === DPULT) return tem(DPULT) < Math.max(1, U.conta(me, DRAK)) ? 9.6 : 2;
    if (n === DRAK) return tem(DRAK) < U.conta(me, DREEPY) ? 8.5 : 2;
    if (n === 'Rare Candy') return U.conta(me, DREEPY) && !tem(DPULT) ? 7 : 3;
    if (n === TORCHIC) return tem(TORCHIC) + tem(COMB) + tem(BLAZ) ? 0.5 : 8;
    if (n === BLAZ) return tem(BLAZ) ? 1 : 7.5;
    if (n === 'Munkidori') return tem(n) ? 0.5 : 4;
    if (c instanceof G.EnergyCard) return me.hand.cards.some(x => x instanceof G.EnergyCard) ? 2 : 7;
    if (n === BOSS) return 6;
    if (U.ehEx(c)) return 0.4;
    return 2;
  },
  descarte(c, bot, st, U) {
    const me = bot.eu(st), n = c.name;
    if (c instanceof G.EnergyCard) return c.name === 'Darkness Energy' && !U.conta(me, 'Munkidori') ? 3 : (U.conta(me, BLAZ) || U.conta(me, COMB) ? 4 : 15);      // o Blaziken liga do descarte
    if (n === 'Chi-Yu' || n === 'Budew' || n === MEOWTH || n === 'Fezandipiti ex') return 5;
    if (n === DREEPY && linhaDragapult(me) >= 3) return 10;
    if (n === DPULT || n === BLAZ) return 70;
    return 30;
  },
  alvoEnergia(l, bot, st) { const n = U.nomeDe(l), f = faltaPrincipal(l); if (f === 0 || f === 99) return 1;
    return n === DPULT ? 60 : n === DRAK ? 45 : n === DREEPY ? 30 : n === 'Munkidori' ? 20 : 5; },
  novoAtivo(l, bot, st) { const n = U.nomeDe(l), rec = (l.getPokemonCard().retreat || []).length;
    // sem atacante pronto, sobe quem vai ficar pronto (linha do Dragapult, recuo 1), nunca o Blaziken (recuo 2, só motor)
    return (faltaPrincipal(l) === 0 ? 100 : 0) + (n === DPULT ? 40 : n === DRAK ? 30 : n === DREEPY ? 22 : n === 'Munkidori' ? 18 : n === 'Budew' ? 15 : n === BLAZ ? 0 : 5)
      - rec * 4 - l.damage / 100; },
  penalidade(plano, bot, st, U) {
    if (plano.ataque === 'Itchy Pollen' && st.turn <= 6) return -150;
    return 0;
  },
};


// ---------- Ogerpon / Meganium / Hydrapple (ficha claude/bots/ogerpon-meganium.md) ----------
// Forest of Vitality deixa evoluir Grama no turno em que entra; Meganium (Wild Growth) faz cada Grama valer GG;
// Teal Mask Ogerpon ex compra com Teal Dance e ataca com Myriad Leaf Shower (30 + 30 por energia nos dois ativos).
const OGER = 'Teal Mask Ogerpon ex', CHIK = 'Chikorita', BAY = 'Bayleef', MEGA = 'Meganium', APPLIN = 'Applin', DIPP = 'Dipplin', HYDRA = 'Hydrapple ex';
PERFIS['ogerpon-meganium-hydrapple'] = {
  banco: 5,
  inicio: { ativo: [OGER, CHIK, APPLIN, 'Celebi', 'Tapu Bulu', MEOWTH, 'Fezandipiti ex'],
            banco: { [CHIK]: 2, [OGER]: 1, [APPLIN]: 1 } },
  bloqueia(chave, bot, st) {
    if (/^bas:/.test(chave)) return true;
    if (/^en:/.test(chave)) return true;
    if (/^item:Ultra Ball$/.test(chave)) return baratas(bot, st, 'Ultra Ball') < 2;
    return false;
  },
  regras(bot, st, U) {
    const me = bot.eu(st), R = [], v = U.vaga(me), nb = me.bench.filter(l => l.cards.length).length;
    const baixar = n => () => { const i = U.mao(me, n); return i >= 0 && v >= 0 ? new G.PlayCardAction(me.id, i, U.banco(me, v)) : null; };
    const est = G.StateUtils.getStadiumCard(st);
    if (U.temNaMao(me, 'Forest of Vitality') && (!est || est.name !== 'Forest of Vitality')) R.push(['forest', () => new G.PlayCardAction(me.id, U.mao(me, 'Forest of Vitality'), BOARD)]);
    const megas = U.conta(me, CHIK) + U.conta(me, BAY) + U.conta(me, MEGA);
    if (megas < (U.conta(me, MEGA) ? 1 : 2)) R.push(['chik', baixar(CHIK)]);
    if (U.conta(me, OGER) < 2) R.push(['oger', baixar(OGER)]);
    if (U.conta(me, APPLIN) + U.conta(me, DIPP) + U.conta(me, HYDRA) < 1 && nb < 4) R.push(['applin', baixar(APPLIN)]);
    if (nb < 2 && v >= 0) { const i = me.hand.cards.findIndex(c => c instanceof G.PokemonCard && c.stage === G.Stage.BASIC);
      if (i >= 0) R.push(['banco-minimo', () => new G.PlayCardAction(me.id, i, U.banco(me, v))]); }
    // evoluir (com Forest, no mesmo turno): Meganium e Hydrapple antes de tudo
    [MEGA, BAY, HYDRA, DIPP].forEach(n => {
      const c = me.hand.cards.find(x => x.name === n); if (!c) return;
      const base = [me.active, ...me.bench].find(l => l.cards.length && U.nomeDe(l) === c.evolvesFrom);
      if (base) R.push(['evo:' + n, () => new G.PlayCardAction(me.id, U.mao(me, n), U.alvo(me, base))]);
    });
    // Teal Dance em cada Ogerpon (liga Grama da mão e compra)
    if (me.hand.cards.some(c => c.name === 'Grass Energy'))
      [me.active, ...me.bench].forEach((l, j) => { if (l.cards.length && U.nomeDe(l) === OGER) R.push(['teal' + j, () => new G.UseAbilityAction(me.id, 'Teal Dance', U.alvo(me, l))]); });
    // energia manual: no Ogerpon ativo; senão no Ogerpon do banco com mais energia; senão no Hydrapple
    if (me.energyPlayedTurn !== st.turn) {
      const i = me.hand.cards.findIndex(c => c instanceof G.EnergyCard);
      const ogs = [me.active, ...me.bench].filter(l => l.cards.length && [OGER, HYDRA].includes(U.nomeDe(l)))
        .sort((a, b) => (b === me.active) - (a === me.active) || (U.nomeDe(b) === OGER) - (U.nomeDe(a) === OGER) || U.energias(b) - U.energias(a));
      if (i >= 0 && ogs.length) R.push(['energia', () => new G.PlayCardAction(me.id, i, U.alvo(me, ogs[0]))]);
    }
    { const r = regraDesencalhar(bot, st, l => [OGER, HYDRA].includes(U.nomeDe(l))); if (r) R.push(r); }
    return R;
  },
  busca(c, bot, st, U) {
    const me = bot.eu(st), n = c.name, tem = x => U.conta(me, x) + me.hand.cards.filter(y => y.name === x).length;
    const megas = tem(CHIK) + tem(BAY) + tem(MEGA);
    if (n === MEGA) return tem(MEGA) ? 2 : 9.6;
    if (n === CHIK) return megas < 2 ? 9.4 : 1;
    if (n === BAY) return tem(BAY) || tem(MEGA) ? 1 : 6;
    if (n === OGER) return tem(OGER) < 2 ? 9 : 2;
    if (n === 'Forest of Vitality') return tem(n) || (G.StateUtils.getStadiumCard(st) || {}).name === n ? 1 : 8.5;
    if (n === HYDRA) return tem(HYDRA) ? 1 : 6.5;
    if (n === APPLIN) return tem(APPLIN) + tem(DIPP) + tem(HYDRA) ? 0.5 : 6;
    if (n === DIPP) return 3;
    if (c instanceof G.EnergyCard) return me.hand.cards.filter(x => x instanceof G.EnergyCard).length < 2 ? 7 : 3;
    if (n === BOSS) return 6;
    if (U.ehEx(c)) return 0.4;
    return 2;
  },
  descarte(c, bot, st, U) {
    const me = bot.eu(st), n = c.name;
    if (c instanceof G.EnergyCard) return me.hand.cards.filter(x => x instanceof G.EnergyCard).length > 2 ? 6 : 35;
    if (n === MEOWTH || n === 'Fezandipiti ex' || n === 'Celebi' || n === 'Tapu Bulu') return 4;
    if (n === CHIK && U.conta(me, MEGA)) return 8;
    if (n === MEGA || n === OGER) return 65;
    return 30;
  },
  alvoEnergia(l, bot, st) { const n = U.nomeDe(l); return n === OGER ? 50 + (l === bot.eu(st).active ? 10 : 0) : n === HYDRA ? 40 : 2; },
  novoAtivo(l, bot, st) { const n = U.nomeDe(l);
    return (faltaPrincipal(l) === 0 ? 100 : 0) + (n === OGER ? 40 + U.energias(l) * 5 : n === HYDRA ? 30 : n === 'Tapu Bulu' ? 15 : n === MEGA ? -20 : 5) - l.damage / 100; },
};


// ---------- Mega Excadrill (ficha claude/bots/mega-excadrill.md; Riguel Assis, 5º em Recife) ----------
// Motor: 2+ Metang (Metal Maker liga Metal do topo); Mega Excadrill ex ataca com Maximum Drilling (200 / 330).
const EXC = 'Mega Excadrill ex', DRIL = 'Drilbur', BELD = 'Beldum', METANG = 'Metang', MGROSS = 'Metagross';
PERFIS['mega-excadrill-ex-wip'] = {   // em construção: ainda pior que o genérico (75% x 67%), fica desligado
  banco: 5,
  inicio: { ativo: [DRIL, BELD, 'Genesect ex', 'Piplup', 'Psyduck', 'Shaymin', 'Fezandipiti ex'],
            banco: { [BELD]: 2, [DRIL]: 1 } },
  bloqueia(chave, bot, st) {
    if (/^bas:/.test(chave)) return true;
    if (/^en:/.test(chave)) return true;
    if (/^est:Gravity Mountain$/.test(chave)) return true;
    if (/^item:Special Red Card$/.test(chave)) return U.premiosRest(bot.op(st)) > 3;
    return false;
  },
  regras(bot, st, U) {
    const me = bot.eu(st), R = [], v = U.vaga(me), nb = me.bench.filter(l => l.cards.length).length;
    const baixar = n => () => { const i = U.mao(me, n); return i >= 0 && v >= 0 ? new G.PlayCardAction(me.id, i, U.banco(me, v)) : null; };
    const beld = U.conta(me, BELD) + U.conta(me, METANG) + U.conta(me, MGROSS), dril = U.conta(me, DRIL) + U.conta(me, EXC);
    if (beld < 3) R.push(['beldum', baixar(BELD)]);
    if (dril < 2) R.push(['drilbur', baixar(DRIL)]);
    if (!U.conta(me, 'Genesect ex') && nb < 4 && beld + dril < 4) R.push(['genesect', baixar('Genesect ex')]);
    if (nb < 2 && v >= 0) { const i = me.hand.cards.findIndex(c => c instanceof G.PokemonCard && c.stage === G.Stage.BASIC && !U.ehEx(c));
      if (i >= 0) R.push(['banco-minimo', () => new G.PlayCardAction(me.id, i, U.banco(me, v))]); }
    // evoluir: Metang em todos os Beldum, depois Excadrill (1 Mega exposto de cada vez), Metagross
    [METANG, EXC, MGROSS].forEach(n => {
      const c = me.hand.cards.find(x => x.name === n); if (!c) return;
      if (n === EXC && U.conta(me, EXC) >= 1 && me.active.getPokemonCard() && U.nomeDe(me.active) === EXC && me.active.damage < 170) return;
      const base = [me.active, ...me.bench].filter(l => l.cards.length && U.nomeDe(l) === c.evolvesFrom && l.pokemonPlayedTurn < st.turn)
        .sort((a, b) => (b === me.active) - (a === me.active))[0];
      if (base && st.turn > 2) R.push(['evo:' + n, () => new G.PlayCardAction(me.id, U.mao(me, n), U.alvo(me, base))]);
    });
    // Metal Maker em cada Metang antes da ligação manual
    [me.active, ...me.bench].forEach((l, j) => { if (l.cards.length && U.nomeDe(l) === METANG) R.push(['metal' + j, () => new G.UseAbilityAction(me.id, 'Metal Maker', U.alvo(me, l))]); });
    // energia manual no atacante (Excadrill ativo > Excadrill do banco > Drilbur > Metagross)
    if (me.energyPlayedTurn !== st.turn) {
      const i = me.hand.cards.findIndex(c => c instanceof G.EnergyCard);
      const nota = l => { const n = U.nomeDe(l), e = U.energias(l); if (n === EXC) return e < 5 ? 100 - e * 5 + (l === me.active ? 10 : 0) : -1;
        if (n === DRIL) return e < 3 ? 60 : -1; if (n === MGROSS) return e < 4 ? 40 : -1; if (n === 'Genesect ex') return e < 3 ? 20 : -1; return -1; };
      const alvo = [me.active, ...me.bench].filter(l => l.cards.length && nota(l) > 0).sort((a, b) => nota(b) - nota(a))[0];
      if (i >= 0 && alvo) R.push(['energia', () => new G.PlayCardAction(me.id, i, U.alvo(me, alvo))]);
    }
    { const r = regraDesencalhar(bot, st, l => [EXC, MGROSS, 'Genesect ex'].includes(U.nomeDe(l))); if (r) R.push(r); }
    return R;
  },
  busca(c, bot, st, U) {
    const me = bot.eu(st), n = c.name, tem = x => U.conta(me, x) + me.hand.cards.filter(y => y.name === x).length;
    if (n === BELD) return tem(BELD) + tem(METANG) < 3 ? 9.5 : 1;
    if (n === METANG) return tem(METANG) < Math.min(3, U.conta(me, BELD) + U.conta(me, METANG)) ? 9.4 : 1.5;
    if (n === DRIL) return tem(DRIL) + tem(EXC) < 2 ? 9 : 1;
    if (n === EXC) return tem(EXC) < 1 || (tem(EXC) < 2 && U.conta(me, DRIL) >= 1) ? 9.6 : 1;
    if (n === MGROSS) return tem(MGROSS) ? 1 : 4;
    const faltaBasico = tem(BELD) + tem(METANG) + tem(DRIL) + tem(EXC) < 4;
    if (n === 'Buddy-Buddy Poffin' || n === 'Precious Trolley') return faltaBasico ? 9.8 : 2;
    if (n === "Brock's Scouting") return faltaBasico ? 8 : 3;
    if (n === 'Rare Candy') return 3;
    if (n === 'Genesect ex') return tem(n) ? 0.5 : 5;
    if (c instanceof G.EnergyCard) return me.hand.cards.some(x => x instanceof G.EnergyCard) ? 2 : 6;
    if (n === BOSS) return 5;
    if (U.ehEx(c)) return 0.4;
    return 2;
  },
  descarte(c, bot, st, U) {
    const me = bot.eu(st), n = c.name;
    if (c instanceof G.EnergyCard) return me.hand.cards.filter(x => x instanceof G.EnergyCard).length > 1 ? 6 : 30;
    if (['Psyduck', 'Shaymin', 'Fezandipiti ex', 'Gravity Mountain'].includes(n)) return 4;
    if (n === EXC) return 70;
    return 30;
  },
  alvoEnergia(l, bot, st) { const n = U.nomeDe(l), e = U.energias(l), me = bot.eu(st);
    if (n === EXC) return e < 5 ? 80 - e * 5 + (l === me.active ? 10 : 0) : 5; if (n === DRIL) return e < 3 ? 50 : 3;
    if (n === MGROSS) return e < 4 ? 30 : 2; if (n === 'Genesect ex') return 15; return 1; },
  novoAtivo(l, bot, st) { const n = U.nomeDe(l);
    return (faltaPrincipal(l) === 0 ? 100 : 0) + (n === EXC ? 40 + U.energias(l) * 3 : n === MGROSS ? 25 : n === 'Genesect ex' ? 20 : n === DRIL ? 10 : n === METANG ? -10 : 5) - l.damage / 100; },
  penalidade(plano, bot, st, U) { return plano.ataque === 'Undermine' ? 40 : 0; },
};

// Perfil vazio: usa o fechamento por planos (simula atacante x modo x ataque x Chefia) com a montagem genérica
for (const a of ['dragapult-ex', 'alakazam-dudunsparce'])
  if (!PERFIS[a]) PERFIS[a] = {};

// Perfil do arquétipo da lista, ou null (cai no BotPlano genérico)
function perfilDe(arquetipo) { return PERFIS[arquetipo] || null; }
function criarBot(client, arquetipo, lista) { const p = perfilDe(arquetipo); return p ? new BotArquetipo(client, p, undefined, lista) : new BotPlano(client); }
module.exports = { BotArquetipo, PERFIS, perfilDe, criarBot, U };
