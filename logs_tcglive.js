// Escritor de logs no formato do TCG Live (inglês) a partir de uma partida do motor twinleaf.
//
// Como funciona:
// - Um "grupo" é uma ação de jogador (jogar carta, habilidade, estádio, ataque, recuo, passar) mais as respostas de
//   escolhas que vêm logo depois. A preparação inteira (antes do turno 1) é um grupo só.
// - Durante o grupo, cada movimento de carta entre listas do motor (CardList.moveTo / moveCardsTo) é anotado na ordem
//   em que acontece. As cartas do motor são objetos únicos, então dá para seguir cada uma. Listas temporárias (as 6
//   cartas de cima da Liderança do Explorador, por exemplo) são "atravessadas": vale de onde a carta saiu e onde parou.
// - O que mexe direto nos arrays (sem moveTo) aparece na comparação antes/depois e entra no fim.
// - Dano, cura e condições vêm da comparação antes/depois; o nome do ataque, o dano causado e as moedas vêm dos
//   registros internos do motor (state.logs).
//
// Uso: const W = criarEscritor(M, { nomes: ['HnSBot', 'DragapultBot'], eu: 0 });
//      W.antes(store.state, acao); store.dispatch(acao); ...; const texto = W.fim(store.state);

let ESCRITOR_ATIVO = null, GANCHOS = false, PROFUNDO = 0;
function instalarGanchos(M) {
  if (GANCHOS) return; GANCHOS = true;
  for (const proto of [M.CardList.prototype, M.PokemonCardList.prototype]) {
    const moveTo = proto.moveTo, moveCardsTo = proto.moveCardsTo;
    proto.moveTo = function (dest, n) {
      if (ESCRITOR_ATIVO && !PROFUNDO) { const k = n === undefined ? this.cards.length : Math.min(n, this.cards.length); ESCRITOR_ATIVO.evento(this, dest, this.cards.slice(0, k)); }
      PROFUNDO++; try { return moveTo.call(this, dest, n); } finally { PROFUNDO--; }
    };
    proto.moveCardsTo = function (cards, dest) {
      if (ESCRITOR_ATIVO && !PROFUNDO) ESCRITOR_ATIVO.evento(this, dest, cards.filter(c => this.cards.includes(c)));
      PROFUNDO++; try { return moveCardsTo.call(this, cards, dest); } finally { PROFUNDO--; }
    };
  }
}

function criarEscritor(M, opts) {
  const G = M.G; instalarGanchos(M);
  const NOMES = opts.nomes, EU = opts.eu || 0;
  const SUPER = { POKEMON: 1, TRAINER: 2, ENERGY: 3 }, TR = { ITEM: 0, SUPPORTER: 1, STADIUM: 2, TOOL: 3 };
  const COND = ['Paralyzed', 'Confused', 'Asleep', 'Poisoned', 'Burned'];
  const TIPOS = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy', N: 'Dragon', C: 'Colorless' };
  const out = [];
  let grupo = null, setupFeito = false, atacouNoTurno = false, estado = null, morteSubita = false;

  const nomeCarta = c => {
    let n = c.name;
    if (c.superType === SUPER.ENERGY && c.energyType === 0 && !/^Basic /.test(n)) n = 'Basic ' + n;
    return n.replace(/\[([A-Z])\]/g, (_, t) => TIPOS[t] || t);
  };
  const topo = sl => { try { const p = sl.getPokemonCard(); if (p) return p; } catch (e) {} return sl.cards.filter(c => c.superType === SUPER.POKEMON).slice(-1)[0] || null; };
  const nm = pi => NOMES[pi];
  const lugar = pos => pos === 'active' ? 'in the Active Spot' : 'on the Bench';

  function snap(s) {
    const loc = new Map(), slots = new Map();
    s.players.forEach((p, pi) => {
      const z = (list, zone) => list.cards.forEach(c => loc.set(c, { pi, zone }));
      z(p.deck, 'deck'); z(p.hand, 'hand'); z(p.discard, 'discard'); z(p.lostzone, 'lost'); z(p.stadium, 'stadium'); z(p.supporter, 'supporter');
      p.prizes.forEach(pr => z(pr, 'prize'));
      [p.active, ...p.bench].forEach((sl, k) => {
        if (!sl.cards.length) return;
        const top = topo(sl); const pos = k === 0 ? 'active' : 'bench';
        slots.set(sl, { pi, pos, top, nome: top ? nomeCarta(top) : '?', dmg: sl.damage, cond: [...(sl.specialConditions || [])], hp: (top && top.hp) || sl.hp || 0,
          cartas: [...sl.cards, ...(sl.tools || [])] });
        sl.cards.forEach(c => loc.set(c, { pi, zone: 'slot', sl, pos }));
        (sl.tools || []).forEach(c => loc.set(c, { pi, zone: 'slot', sl, pos, tool: 1 }));
      });
    });
    return { loc, slots, active: s.players.map(p => p.active), turn: s.turn, ap: s.activePlayer, nlogs: s.logs.length };
  }
  // zona de uma lista do motor, no momento do movimento
  function zonaDe(list) {
    const s = estado; if (!s) return { zone: 'temp' };
    for (let pi = 0; pi < s.players.length; pi++) {
      const p = s.players[pi];
      if (list === p.deck) return { pi, zone: 'deck' }; if (list === p.hand) return { pi, zone: 'hand' };
      if (list === p.discard) return { pi, zone: 'discard' }; if (list === p.lostzone) return { pi, zone: 'lost' };
      if (list === p.stadium) return { pi, zone: 'stadium' }; if (list === p.supporter) return { pi, zone: 'supporter' };
      if (p.prizes.includes(list)) return { pi, zone: 'prize' };
      if (list === p.active) return { pi, zone: 'slot', sl: list, pos: 'active' };
      if (p.bench.includes(list)) return { pi, zone: 'slot', sl: list, pos: 'bench' };
      for (const sl of [p.active, ...p.bench]) if (sl.energies === list) return { pi, zone: 'energias' };
    }
    return { zone: 'temp' };
  }
  function evento(de, para, cartas) {
    if (!grupo || !cartas.length) return;
    const a = zonaDe(de), b = zonaDe(para);
    if (a.zone === 'energias' || b.zone === 'energias') return;
    const topoDest = b.zone === 'slot' ? topo(b.sl) : null;
    const topoOrig = a.zone === 'slot' ? topo(a.sl) : null;
    for (const c of cartas) {
      let origem = a;
      if (a.zone === 'temp') { origem = grupo.temp.get(c); grupo.temp.delete(c); if (!origem) continue; }
      if (b.zone === 'temp') { grupo.temp.set(c, origem); continue; }
      if (origem.zone === b.zone && origem.zone !== 'slot' && origem.pi === b.pi) continue;
      if (origem.zone === 'slot' && b.zone === 'slot' && origem.sl === b.sl) continue;
      grupo.ev.push({ c, de: origem, para: b, turn: estado.turn, nomeDest: topoDest ? nomeCarta(topoDest) : null, posDest: b.pos,
        novoSlot: b.zone === 'slot' && !topoDest, nomeOrig: topoOrig ? nomeCarta(topoOrig) : (origem.nomeOrig || null) });
    }
  }

  // ---------------- API ----------------
  function antes(s, acao) {
    estado = s;
    const tipo = acao.type;
    const ehPrompt = /RESOLVE_PROMPT/.test(tipo);
    if (grupo && (ehPrompt || (grupo.setup && s.turn === 0))) { grupo.acoes.push(acao); return; }
    fechar(s);
    const B = snap(s);
    let carta = null; const pi = s.players.findIndex(p => p.id === (acao.id != null ? acao.id : acao.clientId));
    if (tipo === 'PLAY_CARD_ACTION' && pi >= 0) carta = s.players[pi].hand.cards[acao.handIndex];
    let atacante = null, defensor = null;
    if (tipo === 'ATTACK_ACTION' && pi >= 0) { atacante = s.players[pi].active; defensor = s.players[1 - pi].active; }
    let usuario = null;
    if (tipo === 'USE_ABILITY_ACTION' && pi >= 0) {
      const p = s.players[pi]; const t = acao.target || {};
      const cands = [p.active, ...p.bench].filter(sl => sl.cards.length && topo(sl) && (topo(sl).powers || []).some(x => x.name === acao.name));
      if (t.slot === 1) usuario = p.active; else if (t.slot === 2 && p.bench[t.index]) usuario = p.bench[t.index];
      if (!usuario || !cands.includes(usuario)) usuario = cands[0] || null;
      if (!usuario) { const c = [...p.hand.cards, ...p.discard.cards].find(c => (c.powers || []).some(x => x.name === acao.name)); if (c) usuario = { _carta: c }; }
    }
    grupo = { tipo, acao, acoes: [acao], B, pi, carta, atacante, defensor, usuario, setup: s.turn === 0, ev: [], temp: new Map() };
    ESCRITOR_ATIVO = api;
  }
  function fechar(s) { if (!grupo) return; estado = s; const A = snap(s); try { escreverGrupo(grupo, A, s); } finally { grupo = null; } }

  // ---------------- escrita de um grupo ----------------
  function escreverGrupo(g, A, s) {
    const B = g.B, logs = s.logs.slice(B.nlogs);
    if (logs.some(l => l.message === 'LOG_SUDDEN_DEATH')) morteSubita = true;
    const slotB = sl => B.slots.get(sl), slotA = sl => A.slots.get(sl);
    const L = [];
    const top = t => L.push(t), sub = t => L.push('- ' + t), bullets = arr => L.push('   • ' + arr.join(', '));

    // movimentos: os anotados + os que só aparecem na comparação antes/depois
    const ev = g.ev.slice();
    const ultimo = new Map(); ev.forEach(e => ultimo.set(e.c, e.para));
    const igual = (x, y) => x.zone === y.zone && x.pi === y.pi && (x.zone !== 'slot' || x.sl === y.sl);
    for (const [c, d] of A.loc) {
      const a = B.loc.get(c); if (!a) continue;
      const fim = ultimo.get(c) || a;
      if (!igual(fim, d)) {
        const slA = d.zone === 'slot' ? slotA(d.sl) : null;
        ev.push({ c, de: fim, para: d, turn: A.turn === B.turn ? B.turn : A.turn, diff: 1, nomeDest: slA ? (slotB(d.sl) || slA).nome : null, posDest: d.pos,
          novoSlot: d.zone === 'slot' && !slotB(d.sl) && slA && slA.top === c, nomeOrig: fim.zone === 'slot' ? (slotB(fim.sl) || {}).nome : null });
      }
    }
    // cartas que saíram do jogo para zonas que o motor não usa mais (ex.: removidas): ignoradas

    // ---------- PREPARAÇÃO ----------
    if (g.setup) {
      if (setupFeito || A.turn < 1) return;
      setupFeito = true;
      const primeiro = A.ap, segundo = 1 - primeiro;
      top('Setup');
      top(`${nm(segundo)} chose ${Math.random() < 0.5 ? 'heads' : 'tails'} for the opening coin flip.`);
      top(`${nm(primeiro)} won the coin toss.`);
      top(`${nm(primeiro)} decided to go first.`);
      let compraT1 = null;
      for (const pi of [0, 1]) {
        const pl = s.players[pi];
        const abertura = [...pl.hand.cards, ...[pl.active, ...pl.bench].flatMap(sl => sl.cards)];
        if (pi === A.ap) { const h = pl.hand.cards; compraT1 = h[h.length - 1]; const k = abertura.indexOf(compraT1); if (k >= 0) abertura.splice(k, 1); }
        const extra = abertura.length > 7 ? abertura.splice(7) : null;
        top(`${nm(pi)} drew 7 cards for the opening hand.`);
        sub('7 drawn cards.');
        if (pi === EU) bullets(abertura.map(nomeCarta));
        if (extra) { top(`${nm(pi)} drew ${extra.length} more card${extra.length > 1 ? 's' : ''} because ${nm(1 - pi)} took at least 1 mulligan.`); if (pi === EU) { sub(`${extra.length} drawn cards.`); bullets(extra.map(nomeCarta)); } }
      }
      for (const pi of [0, 1]) {
        const at = A.active[pi]; if (at && slotA(at)) top(`${nm(pi)} played ${slotA(at).nome} to the Active Spot.`);
        s.players[pi].bench.forEach(sl => { const x = slotA(sl); if (x) top(`${nm(pi)} played ${x.nome} to the Bench.`); });
      }
      top(''); top(`${nm(A.ap)}'s Turn`); atacouNoTurno = false;
      if (compraT1) top(A.ap === EU ? `${nm(A.ap)} drew ${nomeCarta(compraT1)}.` : `${nm(A.ap)} drew a card.`);
      out.push(...L); return;
    }

    const pi = g.pi, P = nm(pi);
    const mudouTurno = A.turn !== B.turn, novo = A.ap;
    const usado = new Set();

    // ---------- CABEÇALHO ----------
    let cab = null;
    if (g.tipo === 'PLAY_CARD_ACTION' && g.carta) {
      const c = g.carta, nomeC = nomeCarta(c);
      const e0 = ev.find(e => e.c === c && e.de.zone === 'hand'); if (e0) usado.add(e0);
      const d = e0 ? e0.para : (A.loc.get(c) || {});
      if (c.superType === SUPER.POKEMON && d.zone === 'slot') {
        if (e0 ? e0.novoSlot : !slotB(d.sl)) cab = `${P} played ${nomeC} to the Bench.`;
        else { const ant = e0 && e0.nomeDest ? e0.nomeDest : (slotB(d.sl) || {}).nome; cab = `${P} evolved ${ant} to ${nomeC} ${lugar(e0 ? e0.posDest : d.pos)}.`; }
      } else if (d.zone === 'slot') {
        const nomeAlvo = e0 && e0.nomeDest ? e0.nomeDest : (slotA(d.sl) || slotB(d.sl) || {}).nome;
        cab = `${P} attached ${nomeC} to ${nomeAlvo} ${lugar(e0 ? e0.posDest : d.pos)}.`;
        if (c.superType === SUPER.ENERGY && ev.some(e => e !== e0 && e.de.zone === 'deck')) cab += `\n${nomeC} was activated.`;
      } else if (c.superType === SUPER.TRAINER && c.trainerType === TR.STADIUM) cab = `${P} played ${nomeC} to the Stadium spot.`;
      else cab = `${P} played ${nomeC}.`;
    } else if (g.tipo === 'USE_ABILITY_ACTION') {
      const u = g.usuario; let nomeU = '?';
      if (u && u._carta) nomeU = nomeCarta(u._carta); else if (u) { const x = slotB(u) || slotA(u); if (x) nomeU = x.nome; }
      // Comprar e Dar no Pé: o TCG Live também escreve "jogou Dudunsparce."; com "usou", o leitor do app acha que o
      // embaralhamento é da Determinação da Lílian jogada antes no turno e zera a mão.
      cab = g.acao.name === 'Run Away Draw' ? `${P} played ${nomeU}.` : `${P}'s ${nomeU} used ${g.acao.name}.`;
    } else if (g.tipo === 'USE_STADIUM_ACTION') {
      const st = s.players.map(p => p.stadium.cards[0]).find(Boolean);
      cab = `${P} played ${st ? nomeCarta(st) : 'a card'}.`;
    } else if (/USE_(TRAINER|ENERGY)_ABILITY/.test(g.tipo)) cab = `${P} played a card.`;
    if (cab) cab.split('\n').forEach(top);

    // ---------- ATAQUE ----------
    const danoLog = logs.filter(l => l.message === 'LOG_PLAYER_DEALS_DAMAGE').map(l => ({ alvo: l.params.target, dano: +l.params.damage, usado: false }));
    const contado = new Map();
    if (g.tipo === 'ATTACK_ACTION') {
      atacouNoTurno = true;
      const at = slotB(g.atacante), df = slotB(g.defensor);
      const dl = df && danoLog.find(x => !x.usado && x.alvo === df.top.name);
      let dano = null;
      if (dl) { dl.usado = true; dano = dl.dano; }
      else if (df && slotA(g.defensor) && slotA(g.defensor).dmg > df.dmg) dano = slotA(g.defensor).dmg - df.dmg;
      if (df) contado.set(g.defensor, dano || 0);
      top(dano != null && df ? `${P}'s ${at ? at.nome : '?'} used ${g.acao.name} on ${nm(1 - pi)}’s ${df.nome} for ${dano} damage.` : `${P}'s ${at ? at.nome : '?'} used ${g.acao.name}.`);
    }

    // ---------- RECUO ----------
    if (g.tipo === 'RETREAT_ACTION') {
      const v = slotB(B.active[pi]);
      top(`${P} retreated ${v ? v.nome : '?'} to the Bench.`);
      const desc = ev.filter(e => !usado.has(e) && e.de.zone === 'slot' && e.de.sl === B.active[pi] && e.para.zone === 'discard');
      desc.forEach(e => usado.add(e));
      if (desc.length === 1) sub(`${nomeCarta(desc[0].c)} was discarded from ${P}'s ${v.nome}.`);
      else if (desc.length) { sub(`${desc.length} cards were discarded from ${P}'s ${v.nome}.`); bullets(desc.map(e => nomeCarta(e.c))); }
      const n = slotA(A.active[pi]); if (n) top(`${P}'s ${n.nome} is now in the Active Spot.`);
    }

    // ---------- MOEDAS ----------
    for (const l of logs) if (l.message === 'LOG_PLAYER_FLIPS_HEADS' || l.message === 'LOG_PLAYER_FLIPS_TAILS')
      sub(`${NOMES.includes(l.params.name) ? l.params.name : P} flipped a coin and it landed on ${l.message.endsWith('HEADS') ? 'heads' : 'tails'}.`);

    // ---------- DANO, CURA E CONDIÇÕES (Pokémon que continuam em jogo) ----------
    const kos = new Map(); const linhasCheckup = []; const linhasDano = [];
    const subD = t => (g.tipo === 'ATTACK_ACTION' ? linhasDano.push('- ' + t) : sub(t));
    const envenenado = b => b.cond.includes(3) || b.cond.includes(4);
    for (const [sl, b] of B.slots) {
      const a = slotA(sl), vivo = a && a.cartas.includes(b.top);
      if (!vivo) { const d = A.loc.get(b.top); if (d && (d.zone === 'discard' || d.zone === 'lost')) kos.set(sl, b); continue; }
      const delta = a.dmg - b.dmg - (contado.get(sl) || 0);
      if (delta > 0) {
        const dl = danoLog.find(x => !x.usado && x.alvo === b.top.name);
        if (mudouTurno && g.tipo !== 'ATTACK_ACTION' && envenenado(b))
          linhasCheckup.push(`${delta / 10} damage counters were placed on ${nm(b.pi)}'s ${b.nome} for the Special Condition ${b.cond.includes(3) ? 'Poisoned' : 'Burned'}.`);
        else if (dl) { dl.usado = true; subD(`${nm(b.pi)}'s ${b.nome} took ${delta} damage.`); }
        else subD(`${P} put ${delta / 10} damage counters on ${nm(b.pi)}'s ${b.nome}.`);
      } else if (delta < 0) sub(`${nm(b.pi)}'s ${b.nome} healed ${-delta} damage.`);
      if (a.pos === 'active' && b.pos === 'active') {
        for (const c of a.cond) if (!b.cond.includes(c)) sub(`${nm(b.pi)}'s ${a.nome} is now ${COND[c]}.`);
        for (const c of b.cond) if (!a.cond.includes(c)) top(`${nm(b.pi)}'s ${a.nome} is no longer ${COND[c]}.`);
      }
    }

    // ---------- MOVIMENTOS, NA ORDEM ----------
    const pre = ev.filter(e => !usado.has(e) && e.turn === B.turn), pos = ev.filter(e => !usado.has(e) && e.turn !== B.turn);
    const koFeito = new Set();
    const escreverKO = (sl, b) => {
      koFeito.add(sl);
      const ja = (contado.get(sl) || 0) + b.dmg;
      if (ja < b.hp) {
        const dl = danoLog.find(x => !x.usado && x.alvo === b.top.name);
        const falta = Math.ceil((b.hp - ja) / 10) * 10;
        if (dl) { dl.usado = true; sub(`${nm(b.pi)}'s ${b.nome} took ${Math.max(dl.dano, falta)} damage.`); }
        else if (mudouTurno && g.tipo !== 'ATTACK_ACTION' && envenenado(b)) top(`${falta / 10} damage counters were placed on ${nm(b.pi)}'s ${b.nome} for the Special Condition ${b.cond.includes(3) ? 'Poisoned' : 'Burned'}.`);
        else sub(`${P} put ${falta / 10} damage counters on ${nm(b.pi)}'s ${b.nome}.`);
      }
      top(`${nm(b.pi)}'s ${b.nome} was Knocked Out!`);
      const ms = ev.filter(e => !usado.has(e) && e.de.zone === 'slot' && e.de.sl === sl);
      ms.forEach(e => usado.add(e));
      const resto = ms.filter(e => e.c !== b.top).map(e => nomeCarta(e.c));
      if (resto.length === 1) top(`${resto[0]} was discarded from ${nm(b.pi)}'s ${b.nome}.`);
      else if (resto.length > 1) { sub(`${resto.length} cards were discarded from ${nm(b.pi)}'s ${b.nome}.`); bullets(resto); }
    };
    const vivoA = sl => { const b = slotB(sl), a = slotA(sl); return b && a && a.cartas.includes(b.top); };
    const chave = e => {
      const de = e.de.zone, para = e.para.zone;
      if (de === 'slot' && kos.has(e.de.sl)) return 'ko';
      if (de === 'supporter' || para === 'supporter') return null;
      if ((de === 'deck' && para === 'prize') || (de === 'prize' && para === 'deck')) return null;
      if (para === 'slot' && e.novoSlot && e.c.superType === SUPER.POKEMON) return 'novo|' + e.para.pi + '|' + de;
      if (para === 'slot' && e.c.superType === SUPER.POKEMON && de !== 'slot') return 'evolui';
      if (para === 'slot') return 'liga';
      if (de === 'slot' && (vivoA(e.de.sl) || !slotB(e.de.sl)) && e.c !== (slotB(e.de.sl) || {}).top) return 'solta|' + para + '|' + e.de.pi;
      if (de === 'slot') return 'pokemon|' + para + '|' + e.de.pi;
      return de + '|' + para + '|' + e.de.pi;
    };
    function escreverSegmento(k, es) {
      const q = es[0].de.pi, Q = nm(q), ns = es.map(e => nomeCarta(e.c));
      const partes = k.split('|'), tipo = partes[0], para = partes[1];
      if (tipo === 'novo') {
        const QQ = nm(+partes[1]), de = partes[2];
        if (de === 'deck') { if (ns.length === 1) sub(`${QQ} drew ${ns[0]} and played it to the Bench.`); else { sub(`${QQ} drew ${ns.length} cards and played them to the Bench.`); bullets(ns); } sub(`${QQ} shuffled their deck.`); }
        else if (de === 'hand') ns.forEach(n => (cab ? sub : top)(`${QQ} played ${n} to the Bench.`));
        else ns.forEach(n => sub(`${QQ} moved ${QQ}'s ${n} to the Bench.`));
        return;
      }
      if (tipo === 'evolui') { es.forEach(e => (e.de.zone === 'hand' && !cab ? top : sub)(`${nm(e.para.pi)} evolved ${e.nomeDest} to ${nomeCarta(e.c)} ${lugar(e.posDest)}.`)); return; }
      if (tipo === 'liga') { es.forEach(e => (e.de.zone === 'hand' && !cab ? top : sub)(`${nm(e.para.pi)} attached ${nomeCarta(e.c)} to ${e.nomeDest} ${lugar(e.posDest)}.`)); return; }
      if (tipo === 'solta') {
        const porSl = new Map(); es.forEach(e => { if (!porSl.has(e.de.sl)) porSl.set(e.de.sl, []); porSl.get(e.de.sl).push(e); });
        for (const [sl, arr] of porSl) {
          const nome = arr[0].nomeOrig || (slotB(sl) || {}).nome; const n2 = arr.map(e => nomeCarta(e.c));
          if (para === 'discard' || para === 'lost') { if (n2.length === 1) sub(`${n2[0]} was discarded from ${Q}'s ${nome}.`); else { sub(`${n2.length} cards were discarded from ${Q}'s ${nome}.`); bullets(n2); } }
          else if (para === 'hand') n2.forEach(n => sub(`${Q} moved ${Q}'s ${n} to their hand.`));
          else if (para === 'deck') { sub(`${Q} shuffled ${n2.length} card${n2.length > 1 ? 's' : ''} into their deck.`); bullets(n2); }
          else if (para === 'prize') n2.forEach(n => sub(`${Q} moved ${Q}'s ${n} to the Prize cards.`));
          else n2.forEach(n => sub(`${Q} moved ${Q}'s ${n}.`));
        }
        return;
      }
      if (tipo === 'pokemon') { // um Pokémon inteiro saiu do campo sem nocaute (Ciclone de Recolhimento, Dudunsparce)
        if (para === 'hand') { if (ns.length === 1) sub(`${Q} moved ${Q}'s ${ns[0]} to their hand.`); else { sub(`${Q} moved ${Q}'s ${ns.length} cards to their hand.`); bullets(ns); } }
        else if (para === 'deck') { sub(`${Q} shuffled ${ns.length} card${ns.length > 1 ? 's' : ''} into their deck.`); bullets(ns); }
        else if (para === 'discard' || para === 'lost') { sub(`${Q} discarded ${ns.length} card${ns.length > 1 ? 's' : ''}.`); bullets(ns); }
        return;
      }
      const de = tipo;
      if (de === 'hand' && para === 'discard') { if (ns.length === 1) sub(`${Q} discarded ${ns[0]}.`); else { sub(`${Q} discarded ${ns.length} cards.`); bullets(ns); } return; }
      if (de === 'hand' && para === 'deck') {
        // mão inteira mandada para o baralho por carta do oponente (Juiz, Cartão Vermelho Especial, Carimbo Injusto):
        // o TCG Live escreve "embaralhou a mão" + "colocou N cartas no fundo do baralho"
        const maoAntes = [...B.loc.values()].filter(x => x.pi === q && x.zone === 'hand').length;
        if (q !== pi && ns.length >= maoAntes) { sub(`${Q} shuffled their hand.`); sub(`${Q} put ${ns.length} card${ns.length > 1 ? 's' : ''} on the bottom of their deck.`); if (q === EU) bullets(ns); return; }
        sub(`${Q} shuffled ${ns.length} card${ns.length > 1 ? 's' : ''} into their deck.`); if (q === EU) bullets(ns); return; }
      if (de === 'deck' && para === 'hand') {
        const busca = g.acoes.some(a => /RESOLVE_PROMPT/.test(a.type) && Array.isArray(a.result) && a.result.some(x => es.some(e => e.c === x)));
        let ver = q === EU || busca;
        // o leitor do app acha que uma lista de compras logo depois de a mão do HnS ser embaralhada é do HnS
        if (q !== EU && ns.length > 1) { const k = L.map(x => x.includes(`${nm(EU)} shuffled their hand.`)).lastIndexOf(true); if (k >= 0 && L.length - k <= 8) ver = false; }
        if (ns.length === 1) sub(ver ? `${Q} drew ${ns[0]}.` : `${Q} drew a card.`); else { sub(`${Q} drew ${ns.length} cards.`); if (ver) bullets(ns); }
        if (busca) sub(`${Q} shuffled their deck.`);
        return;
      }
      if (de === 'deck' && para === 'discard') { if (ns.length === 1) sub(`${Q} discarded ${ns[0]}.`); else { sub(`${Q} discarded ${ns.length} cards.`); bullets(ns); } return; }
      if (de === 'discard' && para === 'hand') { if (ns.length === 1) sub(`${Q} moved ${Q}'s ${ns[0]} to their hand.`); else { sub(`${Q} moved ${ns.length} cards to their hand.`); bullets(ns); } return; }
      if (de === 'discard' && para === 'deck') { ns.forEach(n => sub(`${Q} moved ${Q}'s ${n} to their deck.`)); return; }
      if (de === 'prize' && para === 'hand') { top(ns.length === 1 ? `${Q} took a Prize card.` : `${Q} took ${ns.length} Prize cards.`); ns.forEach(n => top(q === EU ? `${n} was added to ${Q}'s hand.` : `A card was added to ${Q}'s hand.`)); return; }
      if (de === 'stadium' && para === 'discard') { ns.forEach(n => sub(`${Q} discarded ${n}.`)); return; }
      if (de === 'hand' && para === 'stadium') { ns.forEach(n => (cab ? sub : top)(`${Q} played ${n} to the Stadium spot.`)); return; }
      if (de === 'deck' && para === 'stadium') { ns.forEach(n => sub(`${Q} drew ${n} and played it to the Stadium spot.`)); return; }
      if (para === 'lost') { ns.forEach(n => sub(`${Q} moved ${Q}'s ${n} to the Lost Zone.`)); return; }
      if (de === 'hand' && para === 'prize') { ns.forEach(n => sub(`${Q} moved ${Q}'s ${n} to the Prize cards.`)); return; }
      if (de === 'discard' && para === 'discard') return;
      if (opts.debug) L.push(`?? ${k} ${ns.join(', ')}`);
    }
    function escreverLista(lista, emTurnoNovo) {
      let i = 0, primeiraCompra = emTurnoNovo;
      while (i < lista.length) {
        const e = lista[i];
        if (usado.has(e)) { i++; continue; }
        const k = chave(e);
        if (k === 'ko') { if (!koFeito.has(e.de.sl)) escreverKO(e.de.sl, kos.get(e.de.sl)); i++; continue; }
        if (k === null) { usado.add(e); i++; continue; }
        if (primeiraCompra && k === 'deck|hand|' + novo) { // a compra do início do turno
          usado.add(e); top(novo === EU ? `${nm(novo)} drew ${nomeCarta(e.c)}.` : `${nm(novo)} drew a card.`); primeiraCompra = false; i++; continue;
        }
        const seg = [e]; let j = i + 1;
        while (j < lista.length && !usado.has(lista[j]) && chave(lista[j]) === k) { seg.push(lista[j]); j++; }
        seg.forEach(x => usado.add(x));
        escreverSegmento(k, seg);
        i = j;
      }
    }
    // com nomes repetidos, o leitor do app põe o dano no primeiro que acha: o nocaute vem antes do dano espalhado
    if (g.tipo === 'ATTACK_ACTION') for (const [sl, b] of kos) if (!koFeito.has(sl)) escreverKO(sl, b);
    L.push(...linhasDano);
    escreverLista(pre, false);
    for (const [sl, b] of kos) if (!koFeito.has(sl)) escreverKO(sl, b);
    // Pokémon que entraram neste grupo já com dano (Ruínas Arriscadas)
    for (const [sl, a] of A.slots) if (!B.slots.has(sl) && a.dmg > 0) sub(`${nm(a.pi)} put ${a.dmg / 10} damage counters on ${nm(a.pi)}'s ${a.nome}.`);

    // ---------- TROCA DE ATIVO ----------
    for (const q of [0, 1]) {
      if (g.tipo === 'RETREAT_ACTION' && q === pi) continue;
      const va = B.active[q], na = A.active[q];
      if (va === na) continue;
      const v = slotB(va), n = slotA(na); if (!n) continue;
      if (v && vivoA(va)) sub(`${nm(q)}'s ${v.nome} was switched with ${nm(q)}'s ${n.nome} to become the Active Pokémon.`);
      top(`${nm(q)}'s ${n.nome} is now in the Active Spot.`);
    }

    // ---------- FIM DE TURNO / TURNO NOVO ----------
    linhasCheckup.forEach(top);
    if (mudouTurno && s.phase !== G.GamePhase.FINISHED) {
      if (opts.maos) { const fora = new Set(pos.filter(e => e.para.zone === 'hand' && e.para.pi === EU).map(e => e.c)); const lado = q => [...A.slots.values()].filter(x => x.pi === q).map(x => (x.pos === 'active' ? 'A:' : 'B:') + x.nome + ':' + x.dmg + ':' + x.cartas.filter(c => c.superType === SUPER.ENERGY).length).sort();
        opts.maos.push({ turno: B.turn, mao: s.players[EU].hand.cards.filter(c => !fora.has(c)).map(nomeCarta).sort(), eu: lado(EU), ele: lado(1 - EU) }); }
      if (!atacouNoTurno) top(`${nm(B.ap)} ended their turn.`);
      top(''); top(`${nm(novo)}'s Turn`); atacouNoTurno = false;
      escreverLista(pos, true);
    } else {
      if (/PASS_TURN/.test(g.tipo) && !atacouNoTurno) top(`${P} ended their turn.`);
      escreverLista(pos, false);
    }
    out.push(...L);
  }

  function fim(s) {
    fechar(s); ESCRITOR_ATIVO = null;
    if (s.phase === G.GamePhase.FINISHED) {
      const w = s.winner; // 0 = jogador 1, 1 = jogador 2, 3 = empate
      if (w === 0 || w === 1) {
        const outro = 1 - w; const pr = s.players[w].prizes.reduce((n, l) => n + l.cards.length, 0);
        const sem = ![s.players[outro].active, ...s.players[outro].bench].some(sl => sl.cards.length);
        const razao = pr === 0 ? 'All Prize cards taken' : sem ? `${nm(outro)} has no Pokémon in play` : `${nm(outro)} has no cards left in their deck`;
        out.push(`${razao}. ${nm(w)} wins.`);
      } else out.push('Draw!');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }
  const api = { antes, fim, evento, morteSubita: () => morteSubita };
  return api;
}
module.exports = { criarEscritor };
