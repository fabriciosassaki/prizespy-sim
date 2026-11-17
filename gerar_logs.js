// Gera logs no formato do TCG Live (inglês) de partidas simuladas: bot do Hide n' Sneak (lista do Rahul) contra os
// arquétipos do plano.json. Os oponentes usam os parâmetros do campeão atual do ajuste (ajuste/estado.json), se houver.
//
// Uso: node gerar_logs.js N [pasta] [semente]   -> N logs repartidos entre arquétipos, variações e listas
//      node gerar_logs.js um <arquétipo> <i da lista> <semente>   -> imprime um log
// Cada log vai para <pasta>/<arquétipo>/<nnnn>_<variação>_l<lista>_s<semente>.txt e o índice para <pasta>/indice.jsonl
globalThis.self = globalThis; require('./solver.min.js');
const S = globalThis.Solver, M = S.motor, fs = require('fs'), path = require('path');
const BOTS = require('./motor/bots_src.js').carregar(M);
const { criarEscritor } = require('./logs_tcglive.js');
const MIRROR = 'dhelmise-pbl';
const NOME_BOT = { 'dragapult-ex': 'DragapultBot', 'basic-box-m': 'BasicBoxBot', 'dhelmise-pbl': 'MirrorHnSBot', 'slowking-scr': 'SlowkingBot',
  'alakazam-dudunsparce': 'AlakazamBot', 'ogerpon-meganium-hydrapple': 'OgerponBot', 'n-zoroark': 'ZoroarkBot', 'mega-rayquaza-ex': 'RayquazaBot',
  'mega-excadrill-ex': 'ExcadrillBot', 'dragapult-blaziken': 'BlazikenBot' };
const EU = 'HnSBot';

function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function deckDe(L) { const d = []; for (const [nome, q] of L.qtd) { let fn = L.fullName.get(nome); if (!fn || !M.cm.getCardByName(fn)) fn = M.pick(nome); for (let k = 0; k < q; k++) d.push(fn); } return d; }
function deckRahul() { const d = []; for (const [n, q] of S.S.RAHUL) for (let k = 0; k < q; k++) d.push(M.pick(n)); return d; }
let ESTADO = null; try { ESTADO = JSON.parse(fs.readFileSync('ajuste/estado.json', 'utf8')); } catch (e) {}

function jogarComLog(a, L, semente) {
  const { G, Store, BotArbiter, BotShuffleMode, BotFlipMode } = M;
  const mathRandom = Math.random; Math.random = rng(semente);
  const K = ESTADO && ESTADO.arquetipos && ESTADO.arquetipos[a] && ESTADO.arquetipos[a].campeao;
  globalThis.AJUSTE_BOTS = K ? { [a]: K } : {};
  const store = new Store({ onStateChange() {} });
  const arb = new BotArbiter({ flipMode: BotFlipMode.RANDOM, shuffleMode: BotShuffleMode.RANDOM });
  const ele = NOME_BOT[a] || 'OponenteBot';
  const bots = { 1: new BOTS.BotHnS({ id: 1, name: EU }), 2: a === MIRROR ? new BOTS.BotHnS({ id: 2, name: ele }) : BOTS.criarBot({ id: 2 }, a, L.qtd) };
  const maos = []; const W = criarEscritor(M, { nomes: [EU, ele], eu: 0, debug: !!process.env.DEBUG, maos });
  store.dispatch(new G.AddPlayerAction(1, EU, deckRahul())); store.dispatch(new G.AddPlayerAction(2, ele, deckDe(L)));
  let passos = 0, erros = 0;
  while (store.state.phase !== G.GamePhase.FINISHED && passos++ < 8000) {
    const s = store.state; let x;
    for (const p of s.prompts.filter(p => p.result === undefined)) { x = arb.resolvePrompt(s, p); if (x) break; }
    if (!x) for (const id of [1, 2]) { x = bots[id].decodeNextAction(s); if (x) break; }
    if (!x) x = new G.PassTurnAction(s.players[s.activePlayer].id);
    W.antes(store.state, x);
    try { store.dispatch(x); } catch (e) { erros++; const y = new G.PassTurnAction(store.state.players[store.state.activePlayer].id); W.antes(store.state, y); try { store.dispatch(y); } catch (e2) {} }
  }
  const texto = W.fim(store.state);
  const morte = W.morteSubita();
  const s = store.state;
  const lado = p => [p.active, ...p.bench].filter(sl => sl.cards.length).map((sl, k) => { const t = sl.getPokemonCard(); return { pos: sl === p.active ? 'active' : 'bench', nome: t && t.name, dmg: sl.damage, e: sl.cards.filter(c => c.superType === 3).length }; });
  const fim = { morteSubita: morte ? 1 : 0, fim: s.phase === G.GamePhase.FINISHED ? 1 : 0, venceu: s.winner === 0 ? EU : s.winner === 1 ? ele : null, turnos: s.turn, erros,
    premios: s.players.map(p => p.prizes.reduce((n, l) => n + l.cards.length, 0)), mao: s.players[0].hand.cards.length, eu: lado(s.players[0]), ele: lado(s.players[1]) };
  Math.random = mathRandom;
  return { texto, fim, ele, maos };
}

function plano(N, semente0) {
  const P = JSON.parse(fs.readFileSync('plano.json', 'utf8'));
  const arqs = P.arquetipos; const porArq = Math.floor(N / arqs.length); let sobra = N - porArq * arqs.length;
  const jobs = []; let g = 0;
  for (const x of arqs) {
    const n = porArq + (sobra-- > 0 ? 1 : 0);
    // repartir entre variações pela parte real, com pelo menos 1 partida por variação; dentro da variação, rodízio das listas
    const vars = Object.entries(x.variacoes || { padrao: { parte: 1, listas: x.listas } });
    const tot = vars.reduce((s, [, o]) => s + o.parte, 0) || 1;
    let cotas = vars.map(([v, o]) => ({ v, o, q: Math.max(1, Math.round(n * o.parte / tot)) }));
    let soma = cotas.reduce((s, c) => s + c.q, 0);
    while (soma > n) { const c = cotas.filter(c => c.q > 1).sort((a, b) => b.q - a.q)[0]; if (!c) break; c.q--; soma--; }
    while (soma < n) { cotas.sort((a, b) => b.o.parte - a.o.parte)[0].q++; soma++; }
    for (const c of cotas) for (let k = 0; k < c.q; k++) { const l = c.o.listas[k % c.o.listas.length]; jobs.push({ a: x.a, nome: x.nome, v: c.v, i: l.i, semente: (semente0 + 7919 * g++) >>> 0 }); }
  }
  return jobs;
}

const cmd = process.argv[2];
if (cmd === 'um') {
  const raw = JSON.parse(fs.readFileSync('listas_solver.json', 'utf8')); const B = S.O.deCompacto(raw);
  const r = jogarComLog(process.argv[3], B.listas[+process.argv[4]], +process.argv[5] || 1);
  process.stdout.write(r.texto); console.error(JSON.stringify(r.fim)); if (process.env.MAOS) fs.writeFileSync(process.env.MAOS, JSON.stringify(r.maos));
} else if (cmd === 'trabalho') {
  process.once('message', ({ jobs, pasta }) => {
    const raw = JSON.parse(fs.readFileSync('listas_solver.json', 'utf8')); const B = S.O.deCompacto(raw);
    for (const j of jobs) {
      // Morte Súbita (os dois pegam o último prêmio juntos) reinicia a partida no motor: o leitor do app não lê isso,
      // então troca a semente. Partida que não terminou (limite de passos) também é trocada.
      let r; try { for (let t = 0; t < 6; t++) { r = jogarComLog(j.a, B.listas[j.i], j.semente); if (!r.fim.morteSubita && r.fim.fim) break; j.semente = (j.semente + 104729) >>> 0; } }
      catch (e) { process.send({ ...j, erro: String(e && e.stack || e).slice(0, 300) }); continue; }
      const dir = path.join(pasta, j.a); fs.mkdirSync(dir, { recursive: true });
      const arq = path.join(dir, `${String(j.n).padStart(4, '0')}_${j.v}_l${j.i}_s${j.semente}.txt`);
      fs.writeFileSync(arq, r.texto);
      process.send({ ...j, arq: path.relative(pasta, arq), oponente: r.ele, ...r.fim });
    }
    process.send({ fimDoTrabalho: 1 }, () => process.exit(0));
  });
} else if (cmd && /^\d+$/.test(cmd)) {
  const N = +cmd, pasta = process.argv[3] || 'logs_sim', semente0 = +process.argv[4] || 20261117;
  const cp = require('child_process'), os = require('os');
  const jobs = plano(N, semente0).map((j, n) => ({ ...j, n: n + 1 }));
  fs.mkdirSync(pasta, { recursive: true });
  const W = +process.env.CPUS || os.cpus().length; const idx = fs.openSync(path.join(pasta, 'indice.jsonl'), 'w'); let feitos = 0, vivos = W; const t0 = Date.now();
  for (let w = 0; w < W; w++) {
    const ch = cp.fork(__filename, ['trabalho'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    ch.on('message', m => { if (m.fimDoTrabalho) return; fs.writeSync(idx, JSON.stringify(m) + '\n'); if (++feitos % 50 === 0) console.log(`${feitos}/${N} (${Math.round((Date.now() - t0) / 1000)} s)`); });
    ch.on('exit', () => { if (--vivos === 0) console.log(`pronto: ${feitos} logs em ${Math.round((Date.now() - t0) / 1000)} s`); });
    ch.send({ jobs: jobs.filter((_, k) => k % W === w), pasta });
  }
}
module.exports = { jogarComLog };
