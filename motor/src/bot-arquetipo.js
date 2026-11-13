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
const { BotPlano } = require('./bot-plano.js');

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
  criarSombra() { const s = new BotArquetipo(this.client, this.perfil, 'simples', this.lista); s.copia = this.copia; s.trocaPara = this.trocaPara; return s; }
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
    const ordem = livres.slice().sort((a, b) => descartar ? v(a) - v(b) : v(b) - v(a));
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
    let nota = pr * 1000 + (ele2.active.damage || 0);
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

// cartas da mão (fora a que vai ser jogada) que o perfil aceita descartar sem perder nada (valor de descarte <= 50)
function baratas(bot, st, fora) {
  const me = bot.eu(st); let pulou = false;
  return me.hand.cards.filter(c => { if (!pulou && c.name === fora) { pulou = true; return false; } return bot.perfil.descarte(c, bot, st, U) <= 50; }).length;
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
        if (zoro(l) && e < 2) return (ativo ? (sobe ? 40 : 90) : 100) + e * 10;
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
    const falta = precisaEnergia || !temApoio || zoroSemEvo || semZekrom || me.hand.cards.length <= 2;
    if (falta && deck - 2 >= reserva && baratas(bot, st, null) >= 1)
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
    if (n === "N's Reshiram") return U.conta(me, n) ? 10 : 55;             // baixado no turno de usar o Virtuous Flame
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

// Perfil do arquétipo da lista, ou null (cai no BotPlano genérico)
function perfilDe(arquetipo) { return PERFIS[arquetipo] || null; }
function criarBot(client, arquetipo, lista) { const p = perfilDe(arquetipo); return p ? new BotArquetipo(client, p, undefined, lista) : new BotPlano(client); }
module.exports = { BotArquetipo, PERFIS, perfilDe, criarBot, U };
