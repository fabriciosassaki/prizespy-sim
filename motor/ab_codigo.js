// A/B de código: joga as MESMAS sementes com os bots de duas pastas (A = base, B = nova) e mede a diferença pareada.
// Uso: node motor/ab_codigo.js <pastaA> <pastaB> [partidas por arquétipo] [lado]
//   pastaA/pastaB: pastas com bots_src.js e src/ (ex.: /tmp/base e motor)
//   lado: 'hns' (padrão) mede a vitória do HnS; os oponentes usam os campeões do ajuste nos dois lados.
// Os parâmetros (campeões do ajuste/estado.json) são os mesmos em A e B: só o código muda.
globalThis.self = globalThis; require('../solver.min.js');
const S = globalThis.Solver, M = S.motor, fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const RAIZ = path.join(__dirname, '..');
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function deckDe(L) { const d = []; for (const [nome, q] of L.qtd) { let fn = L.fullName.get(nome); if (!fn || !M.cm.getCardByName(fn)) fn = M.pick(nome); for (let k = 0; k < q; k++) d.push(fn); } return d; }
function deckRahul() { const d = []; for (const [n, q] of S.S.RAHUL) for (let k = 0; k < q; k++) d.push(M.pick(n)); return d; }
const MIRROR = 'dhelmise-pbl';
function jogar(B, E, a, L, eu, ele, sem) {
  const { G, Store, BotArbiter, BotShuffleMode, BotFlipMode } = M; Math.random = rng(sem);
  const todos = {}; for (const [x, X] of Object.entries(E.arquetipos || {})) todos[x] = X.campeao; globalThis.AJUSTE_BOTS = todos;
  const Kh = E.hns ? E.hns.campeao : undefined;
  const store = new Store({ onStateChange() {} }); const arb = new BotArbiter({ flipMode: BotFlipMode.RANDOM, shuffleMode: BotShuffleMode.RANDOM });
  const bots = { 1: new B.BotHnS({ id: 1, name: 'eu' }, Kh), 2: a === MIRROR ? new B.BotHnS({ id: 2, name: 'ele' }, Kh) : B.criarBot({ id: 2 }, a, L.qtd) };
  store.dispatch(new G.AddPlayerAction(1, 'eu', eu)); store.dispatch(new G.AddPlayerAction(2, 'ele', ele));
  let passos = 0;
  while (store.state.phase !== G.GamePhase.FINISHED && passos++ < 8000) { const s = store.state; let x;
    for (const p of s.prompts.filter(p => p.result === undefined)) { x = arb.resolvePrompt(s, p); if (x) break; }
    if (!x) for (const id of [1, 2]) { x = bots[id].decodeNextAction(s); if (x) break; }
    if (!x) x = new G.PassTurnAction(s.players[s.activePlayer].id);
    try { store.dispatch(x); } catch (e) { try { store.dispatch(new G.PassTurnAction(store.state.players[store.state.activePlayer].id)); } catch (e2) {} } }
  const s = store.state; return s.phase === G.GamePhase.FINISHED ? (s.winner === 0 ? 1 : s.winner === 3 ? 1 / 3 : 0) : null;
}
if (process.argv[2] === 'trabalho') {
  process.once('message', ({ A, B, jobs }) => {
    const BA = require(path.resolve(A, 'bots_src.js')).carregar(M), BB = require(path.resolve(B, 'bots_src.js')).carregar(M);
    const E = JSON.parse(fs.readFileSync(path.join(RAIZ, 'ajuste/estado.json'), 'utf8'));
    const BL = S.O.deCompacto(JSON.parse(fs.readFileSync(path.join(RAIZ, 'listas_solver.json'), 'utf8'))), eu = deckRahul(), decks = {};
    for (const j of jobs) { const L = BL.listas[j.i], ele = decks[j.i] || (decks[j.i] = deckDe(L));
      let ra, rb; try { ra = jogar(BA, E, j.a, L, eu, ele, j.sem); rb = jogar(BB, E, j.a, L, eu, ele, j.sem); } catch (e) { ra = rb = null; }
      process.send({ ...j, ra, rb }); }
    process.send({ fim: 1 }, () => process.exit(0));
  });
} else {
  const [A, B] = [process.argv[2], process.argv[3]], N = +process.argv[4] || 100, sem0 = +process.env.SEMENTE || 777;
  const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'plano.json'), 'utf8')); const jobs = [];
  const SO = process.env.ARQ ? process.env.ARQ.split(',') : null;
  for (const x of P.arquetipos.filter(x => !SO || SO.includes(x.a))) for (let g = 0; g < N; g++) { const l = x.listas[g % x.listas.length]; jobs.push({ a: x.a, i: l.i, total: x.total, sem: (sem0 * 7919 + jobs.length * 104729) >>> 0 }); }
  const W = +process.env.CPUS || os.cpus().length, R = []; let vivos = W; const t0 = Date.now();
  for (let w = 0; w < W; w++) { const ch = cp.fork(__filename, ['trabalho'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    ch.on('message', m => { if (!m.fim) R.push(m); });
    ch.on('exit', () => { if (--vivos) return;
      const por = {}; for (const r of R) { if (r.ra == null || r.rb == null) continue; (por[r.a] = por[r.a] || { tot: r.total, d: [], a: 0, b: 0 }); por[r.a].d.push(r.rb - r.ra); por[r.a].a += r.ra; por[r.a].b += r.rb; }
      const T = Object.values(por).reduce((s, o) => s + o.tot, 0); let G = 0, V = 0, GA = 0, GB = 0;
      console.log(`${R.length} pares em ${Math.round((Date.now() - t0) / 1000)} s\nArquétipo                    A        B       B−A (±95%)   jogos que mudaram`);
      for (const [a, o] of Object.entries(por)) { const n = o.d.length, m = o.d.reduce((s, x) => s + x, 0) / n, v = o.d.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, n - 1) / n, w = o.tot / T;
        G += w * m; V += w * w * v; GA += w * o.a / n; GB += w * o.b / n;
        console.log(`${a.padEnd(28)} ${(100 * o.a / n).toFixed(1).padStart(5)}%  ${(100 * o.b / n).toFixed(1).padStart(5)}%  ${(100 * m >= 0 ? '+' : '') + (100 * m).toFixed(1).padStart(4)} ±${(196 * Math.sqrt(v)).toFixed(1)}   ${o.d.filter(x => x).length}/${n}`); }
      console.log(`${'MÉDIA NO META'.padEnd(28)} ${(100 * GA).toFixed(1).padStart(5)}%  ${(100 * GB).toFixed(1).padStart(5)}%  ${(100 * G >= 0 ? '+' : '') + (100 * G).toFixed(1)} ±${(196 * Math.sqrt(V)).toFixed(1)}`);
    });
    ch.send({ A, B, jobs: jobs.filter((_, k) => k % W === w) }); }
}
