// Fase 0 da IA: joga partidas como o gerar_logs (HnS x campo, campeões do ajuste) e grava, para os DOIS lados,
// cada decisão de turno: o estado visível, as jogadas candidatas, a escolhida e, no fim, quem venceu.
// As escolhas dentro de cartas (buscas, descartes, alvos) ainda ficam com o bot e só são contadas.
// Uso: node ia/gravar.js N pasta [semente]        -> pasta/decisoes-<parte>.jsonl.gz + pasta/resumo.json
//      node ia/gravar.js um <arq> <lista> <semente> -> uma partida, resumo na tela
globalThis.self = globalThis; require('../solver.min.js');
const S = globalThis.Solver, M = S.motor, G = M.G, fs = require('fs'), path = require('path'), zlib = require('zlib');
const RAIZ = path.join(__dirname, '..');
const BOTS = require('../motor/bots_src.js').carregar(M);
const E = require('./estado.js').criar(G), J = require('./jogadas.js').criar(G);
const MIRROR = 'dhelmise-pbl';
const ESTADO = (() => { try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'ajuste/estado.json'), 'utf8')); } catch (e) { return null; } })();
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function deckDe(L) { const d = []; for (const [nome, q] of L.qtd) { let fn = L.fullName.get(nome); if (!fn || !M.cm.getCardByName(fn)) fn = M.pick(nome); for (let k = 0; k < q; k++) d.push(fn); } return d; }
function deckRahul() { const d = []; for (const [n, q] of S.S.RAHUL) for (let k = 0; k < q; k++) d.push(M.pick(n)); return d; }

function jogar(a, L, semente) {
  const { Store, BotArbiter, BotShuffleMode, BotFlipMode } = M;
  Math.random = rng(semente);
  const todos = {}; for (const [x, X] of Object.entries((ESTADO && ESTADO.arquetipos) || {})) todos[x] = X.campeao; globalThis.AJUSTE_BOTS = todos;
  const Kh = (ESTADO && ESTADO.hns && ESTADO.hns.campeao) || undefined;
  const store = new Store({ onStateChange() {} });
  const arb = new BotArbiter({ flipMode: BotFlipMode.RANDOM, shuffleMode: BotShuffleMode.RANDOM });
  const bots = { 1: new BOTS.BotHnS({ id: 1, name: 'eu' }, Kh), 2: a === MIRROR ? new BOTS.BotHnS({ id: 2, name: 'ele' }, Kh) : BOTS.criarBot({ id: 2 }, a, L.qtd) };
  const info = [{ arq: MIRROR, arqEle: a }, { arq: a, arqEle: MIRROR }];
  store.dispatch(new G.AddPlayerAction(1, 'eu', deckRahul())); store.dispatch(new G.AddPlayerAction(2, 'ele', deckDe(L)));
  const dec = [], cont = { decisoes: 0, fora: 0, prompts: 0, erros: 0 };
  let passos = 0;
  while (store.state.phase !== G.GamePhase.FINISHED && passos++ < 8000) {
    const s = store.state; let x, quem = null;
    for (const p of s.prompts.filter(p => p.result === undefined)) { x = arb.resolvePrompt(s, p); if (x) break; }
    if (!x) for (const id of [1, 2]) { x = bots[id].decodeNextAction(s); if (x) { quem = id; break; } }
    if (!x) x = new G.PassTurnAction(s.players[s.activePlayer].id);
    // decisão de turno: o bot da vez, sem prompt aberto, devolveu uma jogada (não a resposta a uma carta)
    let reg = null;
    if (quem && !(x instanceof G.ResolvePromptAction) && s.phase === G.GamePhase.PLAYER_TURN && s.players[s.activePlayer].id === quem) {
      const i = s.players.findIndex(p => p.id === quem), p = s.players[i];
      const cands = J.candidatos(s, p).map(c => c.d), d = J.descrever(s, p, x);
      reg = { l: i, e: E.estado(s, i, info[i]), c: cands, k: cands.indexOf(d), d };
    } else if (quem && x instanceof G.ResolvePromptAction) cont.prompts++;
    try { store.dispatch(x); if (reg) { dec.push(reg); cont.decisoes++; if (reg.k < 0) cont.fora++; } }
    catch (e) { cont.erros++; try { store.dispatch(new G.PassTurnAction(store.state.players[store.state.activePlayer].id)); } catch (e2) {} }
  }
  const st = store.state;
  return { a, i: L.i, sem: semente, fim: st.phase === G.GamePhase.FINISHED ? 1 : 0, venceu: st.winner === 0 ? 0 : st.winner === 1 ? 1 : st.winner === 3 ? 'empate' : null, turnos: st.turn, ...cont, dec };
}

// mesma divisão de partidas por arquétipo e lista do plano.json que o gerar_logs
function plano(N, sem0) {
  const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'plano.json'), 'utf8')), jobs = [];
  for (let n = 0; n < N; n++) { const x = P.arquetipos[n % P.arquetipos.length], k = Math.floor(n / P.arquetipos.length), l = x.listas[k % x.listas.length];
    jobs.push({ a: x.a, i: l.i, sem: (sem0 * 7919 + n * 104729) >>> 0 }); }
  return jobs;
}

const cmd = process.argv[2];
const listas = () => S.O.deCompacto(JSON.parse(fs.readFileSync(path.join(RAIZ, 'listas_solver.json'), 'utf8')));
if (cmd === 'um') {
  const B = listas(), r = jogar(process.argv[3], B.listas[+process.argv[4]], +process.argv[5] || 1);
  console.log(JSON.stringify({ ...r, dec: r.dec.length }), '\nexemplo:', JSON.stringify(r.dec[Math.min(5, r.dec.length - 1)]).slice(0, 1500));
} else if (cmd === 'trabalho') {
  process.once('message', ({ jobs, saida }) => {
    const B = listas(), gz = zlib.createGzip(), out = fs.createWriteStream(saida); gz.pipe(out);
    const tot = { partidas: 0, decisoes: 0, fora: 0, prompts: 0, erros: 0, foraEx: {} };
    for (const j of jobs) { const L = B.listas[j.i]; let r; try { r = jogar(j.a, L, j.sem); } catch (e) { continue; }
      tot.partidas++; for (const k of ['decisoes', 'fora', 'prompts', 'erros']) tot[k] += r[k];
      for (const d of r.dec) if (d.k < 0) tot.foraEx[d.d] = (tot.foraEx[d.d] || 0) + 1;
      gz.write(JSON.stringify(r) + '\n'); }
    gz.end(); out.on('close', () => process.send(tot, () => process.exit(0)));
  });
} else {
  const N = +cmd, pasta = process.argv[3] || 'decisoes', sem0 = +process.argv[4] || 20261121, cp = require('child_process'), os = require('os');
  fs.mkdirSync(pasta, { recursive: true });
  const jobs = plano(N, sem0), W = +process.env.CPUS || os.cpus().length, t0 = Date.now(), tot = { partidas: 0, decisoes: 0, fora: 0, prompts: 0, erros: 0, foraEx: {} }; let vivos = W;
  for (let w = 0; w < W; w++) { const ch = cp.fork(__filename, ['trabalho'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    ch.on('message', m => { for (const k of ['partidas', 'decisoes', 'fora', 'prompts', 'erros']) tot[k] += m[k]; for (const [d, n] of Object.entries(m.foraEx)) tot.foraEx[d] = (tot.foraEx[d] || 0) + n; });
    ch.on('exit', () => { if (--vivos) return; tot.segundos = Math.round((Date.now() - t0) / 1000);
      tot.foraEx = Object.fromEntries(Object.entries(tot.foraEx).sort((a, b) => b[1] - a[1]).slice(0, 30));
      fs.writeFileSync(path.join(pasta, 'resumo.json'), JSON.stringify(tot, null, 1));
      console.log(`${tot.partidas} partidas, ${tot.decisoes} decisões (${(100 * tot.fora / Math.max(1, tot.decisoes)).toFixed(2)}% fora das candidatas), ${tot.prompts} escolhas dentro de cartas, ${tot.segundos} s`); });
    ch.send({ jobs: jobs.filter((_, k) => k % W === w), saida: path.join(pasta, `decisoes-${w}.jsonl.gz`) }); }
}
module.exports = { jogar };
