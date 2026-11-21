// Fase 1 da IA: A/B pareado da rede contra os bots. Mesmas sementes: A = bot x bot; B = a rede no lugar do bot de um lado.
// Uso: node ia/avaliar.js <pasta do modelo> <lado: hns|op> [partidas por arquétipo]
//   hns: a rede joga o HnS contra os bots do campo (mede a vitória do HnS)
//   op:  a rede joga cada oponente contra o bot do HnS (mede a vitória do oponente)
// Também mede o acerto (a rede escolheria a mesma jogada que o bot?) e os milissegundos por decisão.
globalThis.self = globalThis; require('../solver.min.js');
const S = globalThis.Solver, M = S.motor, G = M.G, fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const RAIZ = path.join(__dirname, '..');
const MIRROR = 'dhelmise-pbl';
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function deckDe(L) { const d = []; for (const [nome, q] of L.qtd) { let fn = L.fullName.get(nome); if (!fn || !M.cm.getCardByName(fn)) fn = M.pick(nome); for (let k = 0; k < q; k++) d.push(fn); } return d; }
function deckRahul() { const d = []; for (const [n, q] of S.S.RAHUL) for (let k = 0; k < q; k++) d.push(M.pick(n)); return d; }

function jogar(ctx, a, L, sem, comRede) {
  const { BOTS, E, J, R, BotRede, ESTADO, lado } = ctx, { Store, BotArbiter, BotShuffleMode, BotFlipMode } = M;
  Math.random = rng(sem);
  const todos = {}; for (const [x, X] of Object.entries((ESTADO && ESTADO.arquetipos) || {})) todos[x] = X.campeao; globalThis.AJUSTE_BOTS = todos;
  const Kh = (ESTADO && ESTADO.hns && ESTADO.hns.campeao) || undefined;
  const store = new Store({ onStateChange() {} });
  const arb = new BotArbiter({ flipMode: BotFlipMode.RANDOM, shuffleMode: BotShuffleMode.RANDOM });
  const b1 = new BOTS.BotHnS({ id: 1, name: 'eu' }, Kh), b2 = a === MIRROR ? new BOTS.BotHnS({ id: 2, name: 'ele' }, Kh) : BOTS.criarBot({ id: 2 }, a, L.qtd);
  const bots = { 1: b1, 2: b2 }; let rede = null;
  if (comRede) {
    if (lado === 'hns') bots[1] = rede = new BotRede({ id: 1 }, b1, R, { arq: MIRROR, arqEle: a });
    else bots[2] = rede = new BotRede({ id: 2 }, b2, R, { arq: a, arqEle: MIRROR });
  }
  store.dispatch(new G.AddPlayerAction(1, 'eu', deckRahul())); store.dispatch(new G.AddPlayerAction(2, 'ele', deckDe(L)));
  let passos = 0;
  while (store.state.phase !== G.GamePhase.FINISHED && passos++ < 8000) { const s = store.state; let x;
    for (const p of s.prompts.filter(p => p.result === undefined)) { x = arb.resolvePrompt(s, p); if (x) break; }
    if (!x) for (const id of [1, 2]) { x = bots[id].decodeNextAction(s); if (x) break; }
    if (!x) x = new G.PassTurnAction(s.players[s.activePlayer].id);
    try { store.dispatch(x); } catch (e) { try { store.dispatch(new G.PassTurnAction(store.state.players[store.state.activePlayer].id)); } catch (e2) {} } }
  const s = store.state; if (s.phase !== G.GamePhase.FINISHED) return null;
  const meu = lado === 'hns' ? 0 : 1;   // pontos do lado medido: vitória 1, empate 1/3
  return { p: s.winner === meu ? 1 : s.winner === 3 ? 1 / 3 : 0, stats: rede ? rede.stats : null };
}

if (process.argv[2] === 'trabalho') {
  process.once('message', ({ modelo, lado, jobs }) => {
    const BOTS = require('../motor/bots_src.js').carregar(M), E = require('./estado.js').criar(G), J = require('./jogadas.js').criar(G);
    const Rm = require('./rede.js'), R = Rm.carregar(modelo), BotRede = Rm.criarBotRede(G, E, J);
    const ESTADO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'ajuste/estado.json'), 'utf8'));
    const BL = S.O.deCompacto(JSON.parse(fs.readFileSync(path.join(RAIZ, 'listas_solver.json'), 'utf8')));
    const ctx = { BOTS, E, J, R, BotRede, ESTADO, lado };
    for (const j of jobs) { const L = BL.listas[j.i]; let A = null, B = null;
      try { A = jogar(ctx, j.a, L, j.sem, false); B = jogar(ctx, j.a, L, j.sem, true); } catch (e) {}
      process.send({ a: j.a, total: j.total, A: A && A.p, B: B && B.p, st: B && B.stats }); }
    process.send({ fim: 1 }, () => process.exit(0));
  });
} else {
  const modelo = path.resolve(process.argv[2]), lado = process.argv[3] || 'hns', N = +process.argv[4] || 20, sem0 = +process.env.SEMENTE || 4321;
  const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'plano.json'), 'utf8')), jobs = [];
  const SO = process.env.ARQ ? process.env.ARQ.split(',') : null;
  for (const x of P.arquetipos.filter(x => !SO || SO.includes(x.a))) for (let g = 0; g < N; g++) { const l = x.listas[g % x.listas.length]; jobs.push({ a: x.a, i: l.i, total: x.total, sem: (sem0 * 7919 + jobs.length * 104729) >>> 0 }); }
  const W = +process.env.CPUS || os.cpus().length, R = []; let vivos = W; const t0 = Date.now();
  for (let w = 0; w < W; w++) { const ch = cp.fork(__filename, ['trabalho'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    ch.on('message', m => { if (!m.fim) R.push(m); });
    ch.on('exit', () => { if (--vivos) return;
      const por = {}; let dec = 0, tent = 0, ms = 0;
      for (const r of R) { if (r.A == null || r.B == null) continue; const o = por[r.a] = por[r.a] || { tot: r.total, d: [], a: 0, b: 0 }; o.d.push(r.B - r.A); o.a += r.A; o.b += r.B;
        if (r.st) { dec += r.st.decisoes; tent += r.st.tentativas; ms += r.st.ms; } }
      const T = Object.values(por).reduce((s, o) => s + o.tot, 0); let Gm = 0, V = 0, GA = 0, GB = 0;
      const quem = lado === 'hns' ? 'HnS' : 'oponente';
      console.log(`${R.length} pares em ${Math.round((Date.now() - t0) / 1000)} s · rede no lado ${quem} · ${(ms / Math.max(1, dec)).toFixed(1)} ms e ${(tent / Math.max(1, dec)).toFixed(2)} tentativas por decisão`);
      console.log(`Arquétipo                    bot      rede     rede−bot (±95%)   vitória do ${quem}`);
      for (const [a, o] of Object.entries(por)) { const n = o.d.length, m = o.d.reduce((s, x) => s + x, 0) / n, v = o.d.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, n - 1) / n, w = o.tot / T;
        Gm += w * m; V += w * w * v; GA += w * o.a / n; GB += w * o.b / n;
        console.log(`${a.padEnd(28)} ${(100 * o.a / n).toFixed(1).padStart(5)}%  ${(100 * o.b / n).toFixed(1).padStart(5)}%  ${(100 * m >= 0 ? '+' : '') + (100 * m).toFixed(1).padStart(4)} ±${(196 * Math.sqrt(v)).toFixed(1)}`); }
      console.log(`${'MÉDIA NO META'.padEnd(28)} ${(100 * GA).toFixed(1).padStart(5)}%  ${(100 * GB).toFixed(1).padStart(5)}%  ${(100 * Gm >= 0 ? '+' : '') + (100 * Gm).toFixed(1)} ±${(196 * Math.sqrt(V)).toFixed(1)}`);
    });
    ch.send({ modelo, lado, jobs: jobs.filter((_, k) => k % W === w) }); }
}
