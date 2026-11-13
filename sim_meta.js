// Bot do Hide n' Sneak (lista do Rahul) contra o top N do meta, K listas por arquétipo.
// Uso: node sim_meta.js plano            -> escolhe arquétipos e listas, grava plano.json
//      node sim_meta.js rodar [n] [cpus]  -> joga n partidas por lista em paralelo, grava resultados.jsonl
//      node sim_meta.js resumo            -> tabela por matchup
globalThis.self = globalThis; require('./solver.min.js');
const S = globalThis.Solver, M = S.motor, fs = require('fs'), cp = require('child_process'), os = require('os');
const TOP = +process.env.TOP || 10, K = +process.env.K || 12, MIRROR = 'dhelmise-pbl';

// ---------- Variações (sub-planos) por arquétipo ----------
// Cada lista cai na PRIMEIRA variação cuja regra ela cumpre (pelas cartas que tem). Só entram aqui as variações
// que mudam o PLANO do deck (outro atacante, outra engine, outra condição de vitória), conforme as fichas em claude/bots/.
const tem = (L, n, q = 1) => (L.qtd.get(n) || 0) >= q;
const VARIANTES = {
  'dragapult-ex': [['moltres', L => tem(L, 'Moltres')], ['dudunsparce-ex', L => tem(L, 'Dudunsparce ex')], ['rare-candy', L => tem(L, 'Rare Candy')], ['sem-hammer', L => !tem(L, 'Crushing Hammer')], ['hammers', () => true]],
  'basic-box-m': [['prism', L => tem(L, 'Prism Energy')], ['koraidon', L => tem(L, 'Koraidon ex')], ['padrao', () => true]],
  'dhelmise-pbl': [['spiritomb', L => tem(L, 'Spiritomb')], ['dudunsparce-ex', L => tem(L, 'Dudunsparce ex')], ['ursaluna', L => tem(L, 'Bloodmoon Ursaluna ex')], ['padrao', () => true]],
  'slowking-scr': [['annihilape', L => tem(L, 'Annihilape')], ['sem-annihilape', () => true]],
  'alakazam-dudunsparce': [['toucannon', L => tem(L, 'Toucannon')], ['controle', L => tem(L, 'Crushing Hammer', 2) || tem(L, 'Jamming Tower')], ['clefairy', L => tem(L, "Lillie's Clefairy ex")], ['padrao', () => true]],
  'ogerpon-meganium-hydrapple': [['noctowl', L => tem(L, 'Noctowl')], ['hydrapple', () => true]],
  'n-zoroark': [['darmanitan', L => tem(L, "N's Darmanitan")], ['punk-helmet', L => tem(L, 'Punk Helmet')], ['mochi', L => tem(L, 'Binding Mochi')], ['padrao', () => true]],
  'mega-rayquaza-ex': [['tera', L => tem(L, 'Terapagos ex')], ['um-premio', L => tem(L, 'Reshiram ex') || tem(L, 'Zekrom')], ['ho-oh', L => tem(L, "Ethan's Ho-Oh ex")], ['outra', () => true]],
  'mega-excadrill-ex': [['empoleon', L => tem(L, 'Empoleon ex')], ['skarmory', L => tem(L, 'Mega Skarmory ex')], ['padrao', () => true]],
  'dragapult-blaziken': [['chi-yu', L => tem(L, 'Chi-Yu')], ['padrao', () => true]],
};
function variacaoDe(a, L) { for (const [nome, f] of (VARIANTES[a] || [['padrao', () => true]])) if (f(L)) return nome; return 'padrao'; }
const MIN_PARTE = +process.env.MIN_PARTE || 0.02;   // variação com 2%+ das listas do arquétipo entra mesmo fora do top K
const POR_VAR = +process.env.POR_VAR || 2;          // listas garantidas de cada variação relevante

// RES: arquivo .jsonl ou pasta com vários .jsonl (as partes do GitHub Actions gravam um arquivo cada)
const RES = process.env.RES || 'resultados.jsonl';
function lerResultados(caminho) {
  if (!fs.existsSync(caminho)) return [];
  const arqs = fs.statSync(caminho).isDirectory() ? fs.readdirSync(caminho).filter(f => f.endsWith('.jsonl')).map(f => caminho + '/' + f) : [caminho];
  return arqs.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
}
function plano() {
  const raw = JSON.parse(fs.readFileSync('listas_solver.json', 'utf8')); const B = S.O.deCompacto(raw);
  const arqs = Object.entries(B.arquetipos).sort((a, b) => b[1].n - a[1].n).map(([id]) => id);
  const escolhidos = arqs.slice(0, TOP); if (!escolhidos.includes(MIRROR)) escolhidos[TOP - 1] = MIRROR;
  const out = [];
  for (const a of escolhidos) {
    const todas = raw.l.map((x, i) => ({ i, a: x[0], n: x[1] })).filter(x => x.a === a).sort((x, y) => y.n - x.n);
    const total = todas.reduce((s, x) => s + x.n, 0), faltam = {};
    todas.forEach(x => { x.v = variacaoDe(a, B.listas[x.i]); x.f = cartasFaltando(B.listas[x.i]); x.f.forEach(c => faltam[c] = (faltam[c] || 0) + x.n); });
    const ok = todas.filter(x => !x.f.length);
    // parte real de cada variação (todas as listas do arquétipo, inclusive as que o motor não simula)
    const parte = {}; todas.forEach(x => parte[x.v] = (parte[x.v] || 0) + x.n / total);
    const sel = ok.slice(0, K);
    for (const [v, p] of Object.entries(parte)) {
      if (p < MIN_PARTE) continue;
      const tem_ = sel.filter(x => x.v === v).length;
      ok.filter(x => x.v === v && !sel.includes(x)).slice(0, Math.max(0, POR_VAR - tem_)).forEach(x => sel.push(x));
    }
    const vars = {};
    for (const x of sel) { const v = vars[x.v] || (vars[x.v] = { parte: +(parte[x.v] || 0).toFixed(4), listas: [] }); v.listas.push({ i: x.i, n: x.n }); }
    out.push({ a, nome: B.arquetipos[a].name, total: B.arquetipos[a].n, listas: sel.map(x => ({ i: x.i, n: x.n, v: x.v })), variacoes: vars,
      semSimular: Object.fromEntries(Object.entries(parte).filter(([v]) => !vars[v]).map(([v, p]) => [v, +p.toFixed(4)])), puladasPorCarta: faltam });
  }
  fs.writeFileSync('plano.json', JSON.stringify({ gerado: B.gerado, desde: B.desde, arquetipos: out }, null, 1));
  out.forEach(x => console.log(`${x.nome}: ${x.listas.length} listas | ` + Object.entries(x.variacoes).map(([v, o]) => `${v} ${(100 * o.parte).toFixed(0)}% (${o.listas.length})`).join(', ') + (Object.keys(x.semSimular).length ? ` | sem lista simulável: ${Object.entries(x.semSimular).map(([v, p]) => v + ' ' + (100 * p).toFixed(1) + '%').join(', ')}` : '')));
}

function cartasFaltando(L) { const f = []; for (const [nome] of L.qtd) { let fn = L.fullName.get(nome); if (fn && M.cm.getCardByName(fn)) continue; try { M.pick(nome); } catch (e) { f.push(nome); } } return f; }
function deckDe(L) { const d = [];
  for (const [nome, q] of L.qtd) { let fn = L.fullName.get(nome); if (!fn || !M.cm.getCardByName(fn)) fn = M.pick(nome); for (let k = 0; k < q; k++) d.push(fn); }
  return d; }
function deckRahul() { const d = []; for (const [n, q] of S.S.RAHUL) for (let k = 0; k < q; k++) d.push(M.pick(n)); return d; }

// BOTS=generico força o BotPlano genérico no oponente (para o A/B); senão, o bot do arquétipo, se houver perfil.
function jogar(dEu, dEle, mirror, arquetipo, lista) {
  const { G, Store, BotArbiter, BotShuffleMode, BotFlipMode, BotHnS, BotPlano } = M;
  const store = new Store({ onStateChange() {} });
  const arb = new BotArbiter({ flipMode: BotFlipMode.RANDOM, shuffleMode: BotShuffleMode.RANDOM });
  const bots = { 1: new BotHnS({ id: 1, name: 'eu' }), 2: mirror ? new BotHnS({ id: 2, name: 'ele' })
    : (process.env.BOTS !== 'generico' && M.criarBot ? M.criarBot({ id: 2 }, arquetipo, lista && lista.qtd) : new BotPlano({ id: 2 })) };
  store.dispatch(new G.AddPlayerAction(1, 'eu', dEu)); store.dispatch(new G.AddPlayerAction(2, 'ele', dEle));
  let passos = 0, erros = 0, primeiro = null;
  while (store.state.phase !== G.GamePhase.FINISHED && passos++ < 8000) {
    const s = store.state; let a;
    if (primeiro === null && s.turn >= 1) primeiro = s.players[s.activePlayer].id;
    for (const p of s.prompts.filter(p => p.result === undefined)) { a = arb.resolvePrompt(s, p); if (a) break; }
    if (!a) for (const id of [1, 2]) { a = bots[id].decodeNextAction(s); if (a) break; }
    if (!a) a = new G.PassTurnAction(s.players[s.activePlayer].id);
    try { store.dispatch(a); } catch (e) { erros++; try { store.dispatch(new G.PassTurnAction(store.state.players[store.state.activePlayer].id)); } catch (e2) {} }
  }
  const s = store.state; const pr = p => p.prizes.reduce((n, l) => n + l.cards.length, 0);
  return { fim: s.phase === G.GamePhase.FINISHED ? 1 : 0, w: s.winner === 0 ? 1 : 0, emp: s.winner === 3 ? 1 : 0, t: s.turn, p1: primeiro === 1 ? 1 : 0, pe: pr(s.players[0]), pl: pr(s.players[1]), err: erros };
}

function trabalhador({ parte: jobs, prazo }) {
  const raw = JSON.parse(fs.readFileSync('listas_solver.json', 'utf8')); const B = S.O.deCompacto(raw); const eu = deckRahul();
  for (const j of jobs) {
    if (Date.now() > prazo) break;
    const L = B.listas[j.i]; const ele = deckDe(L); const t0 = Date.now();
    let r; try { r = jogar(eu, ele, j.a === MIRROR, j.a, L); } catch (e) { r = { erro: String(e && e.message || e).slice(0, 120) }; }
    process.send({ a: j.a, i: j.i, ms: Date.now() - t0, ...r });
  }
}

function rodar(n, cpus) {
  // retoma de onde parou: conta o que já está em resultados.jsonl e só joga o que falta; para no prazo (PRAZO segundos)
  const P = JSON.parse(fs.readFileSync('plano.json', 'utf8')); const feito = {};
  lerResultados(RES).forEach(r => { const k = r.a + '|' + r.i; feito[k] = (feito[k] || 0) + 1; });
  // SHARD=k/N: esta parte só joga as listas de posição k módulo N (as partes não repetem partidas entre si)
  const [sk, sn] = (process.env.SHARD || '0/1').split('/').map(Number); let pos = 0; const minhas = new Set();
  for (const x of P.arquetipos) for (const l of x.listas) { if (pos++ % sn === sk) minhas.add(x.a + '|' + l.i); }
  // n = 0 (modo "auto"): meta = o máximo já jogado nas minhas listas + LOTE (padrão 20), para rodar sem fim
  if (!n) { const ja = [...minhas].map(k => feito[k] || 0); n = Math.max(0, ...ja) + (+process.env.LOTE || 20); console.log(`meta automática: ${n} partidas por lista`); }
  const jobs = [];
  for (let r = 0; r < n; r++) for (const x of P.arquetipos) for (const l of x.listas) { const k = x.a + '|' + l.i; if (!minhas.has(k) || (feito[k] || 0) > r) continue; jobs.push({ a: x.a, i: l.i }); }
  const total = minhas.size * n;
  if (!jobs.length) { console.log(`FIM: ${total} partidas já jogadas`); return; }
  const W = cpus || Math.max(1, os.cpus().length); const prazo = Date.now() + 1000 * (+process.env.PRAZO || 150);
  const out = fs.openSync(process.env.SAIDA || 'resultados.jsonl', 'a'); let novos = 0, vivos = W; const t0 = Date.now();
  for (let w = 0; w < W; w++) {
    const parte = jobs.filter((_, k) => k % W === w);
    const ch = cp.fork(__filename, ['trabalho'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    ch.on('message', m => { if (m.fimDoTrabalho) return; fs.writeSync(out, JSON.stringify(m) + '\n'); novos++; });
    ch.on('exit', () => { if (--vivos === 0) { const jaFeitas = total - jobs.length + novos; console.log(`${novos} partidas novas em ${Math.round((Date.now() - t0) / 1000)} s; ${jaFeitas}/${total} no total`); } });
    ch.send({ parte, prazo });
  }
}

// média ponderada: dentro da variação, cada lista pesa pela frequência (n); o arquétipo pesa cada variação pela parte real dela.
function agrega(listas, R) {
  let W = 0, wr = 0, v2 = 0, jogos = 0;
  for (const l of listas) { const q = R.filter(r => r.i === l.i && r.fim && !r.erro); if (!q.length) continue;
    const p = q.filter(r => r.w).length / q.length; W += l.peso; wr += l.peso * p; v2 += l.peso * l.peso * Math.max(p * (1 - p), 0.25 / q.length) / q.length; jogos += q.length; }
  if (!W) return null; return { wr: wr / W, se: Math.sqrt(v2) / W, jogos };
}
function tabela(P, R) {
  const linhas = [];
  for (const x of P.arquetipos) {
    const Rx = R.filter(r => r.a === x.a); const vars = x.variacoes || { padrao: { parte: 1, listas: x.listas } };
    const partes = Object.values(vars).reduce((s, o) => s + o.parte, 0) || 1;
    const porVar = {}; let wr = 0, v2 = 0, jogos = 0;
    for (const [v, o] of Object.entries(vars)) {
      const tot = o.listas.reduce((s, l) => s + l.n, 0);
      const g = agrega(o.listas.map(l => ({ i: l.i, peso: l.n / tot })), Rx); if (!g) continue;
      porVar[v] = { parte: o.parte, ...g }; const w = o.parte / partes; wr += w * g.wr; v2 += w * w * g.se * g.se; jogos += g.jogos;
    }
    linhas.push({ a: x.a, nome: x.nome, wr, se: Math.sqrt(v2), jogos, porVar, semSimular: x.semSimular || {} });
  }
  return linhas;
}
const pct = (p, se) => `${(100 * p).toFixed(1)}% ±${(196 * se).toFixed(1)}`;
const pouco = g => g.jogos < 80 || 1.96 * g.se > 0.12;
function resumo(arq) {
  const P = JSON.parse(fs.readFileSync('plano.json', 'utf8'));
  const R = lerResultados(arq || RES);
  const T = tabela(P, R); fs.writeFileSync('resumo.json', JSON.stringify(T, null, 1));
  for (const l of T) {
    console.log(`${l.nome.padEnd(28)} ${pct(l.wr, l.se).padStart(13)}  (${l.jogos} partidas)`);
    for (const [v, g] of Object.entries(l.porVar)) console.log(`   - ${v.padEnd(16)} ${(100 * g.parte).toFixed(0).padStart(3)}% das listas  ${pct(g.wr, g.se).padStart(13)}  (${g.jogos} partidas)${pouco(g) ? '  ← poucas partidas, não dá para concluir' : ''}`);
    for (const [v, p] of Object.entries(l.semSimular)) console.log(`   - ${v.padEnd(16)} ${(100 * p).toFixed(1).padStart(4)}% das listas  sem lista que o motor simule`);
  }
}
// teste A/B: o bot novo (B) só entra se nenhuma variação piorar de forma significativa (95%), mesmo que a média melhore.
function ab(arqA, arqB) {
  const P = JSON.parse(fs.readFileSync('plano.json', 'utf8')); const ler = lerResultados;
  const A = tabela(P, ler(arqA)), Bt = tabela(P, ler(arqB)); let aprovado = true;
  for (let k = 0; k < A.length; k++) {
    const a = A[k], b = Bt[k]; const d = b.wr - a.wr, se = Math.hypot(a.se, b.se);
    console.log(`${a.nome.padEnd(28)} ${(100 * a.wr).toFixed(1)}% → ${(100 * b.wr).toFixed(1)}%  (${d >= 0 ? '+' : ''}${(100 * d).toFixed(1)} ±${(196 * se).toFixed(1)})`);
    for (const v of Object.keys(a.porVar)) { const ga = a.porVar[v], gb = b.porVar[v]; if (!gb) continue; const dv = gb.wr - ga.wr, sv = Math.hypot(ga.se, gb.se);
      const pior = dv < -1.96 * sv; if (pior) aprovado = false;
      console.log(`   - ${v.padEnd(16)} ${(100 * ga.wr).toFixed(1)}% → ${(100 * gb.wr).toFixed(1)}%  (${dv >= 0 ? '+' : ''}${(100 * dv).toFixed(1)} ±${(196 * sv).toFixed(1)})${pior ? '  ← PIOROU' : ''}${pouco(ga) || pouco(gb) ? '  (poucas partidas)' : ''}`); }
  }
  console.log(aprovado ? '\nRESULTADO: aprovado (nenhuma variação piorou de forma significativa)' : '\nRESULTADO: reprovado (alguma variação piorou de forma significativa)');
}

const cmd = process.argv[2];
module.exports = { jogar, deckDe, deckRahul, S, M };
if (cmd === 'plano') plano();
else if (cmd === 'rodar') rodar(process.argv[3] === 'auto' ? 0 : (+process.argv[3] || 10), +process.argv[4] || 0);
else if (cmd === 'resumo') resumo(process.argv[3]);
else if (cmd === 'ab') ab(process.argv[3], process.argv[4]);
else if (cmd === 'trabalho') process.once('message', jobs => { trabalhador(jobs); process.send({ fimDoTrabalho: 1 }, () => process.exit(0)); });
