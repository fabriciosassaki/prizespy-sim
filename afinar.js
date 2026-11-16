// Ajuste automático dos bots dos oponentes.
// Cada arquétipo tem um "campeão" (os parâmetros atuais do fechamento do turno, K_PADRAO em motor/src/bot-arquetipo.js)
// e, a cada rodada, alguns "desafiantes" (o campeão com 1 ou 2 parâmetros mudados). Todos jogam contra o bot do
// Hide n' Sneak com as MESMAS sementes (mesmo embaralhamento e moedas), então a diferença entre eles vem só das decisões.
// O desafiante que fizer o oponente ganhar mais vira o campeão, se a melhora passar do ruído (2,5 erros-padrão).
// O alvo é "o oponente ganhar o máximo possível". Os números dos Regionais servem só de conferência no resumo.
//
// Uso: node afinar.js catalogo            -> ajuste/regras.json: as regras de cada perfil que disparam nas partidas
//      node afinar.js iniciar             -> cria ajuste/estado.json (rodada 0: campeão = v8 + desafiantes)
//      node afinar.js rodar [cpus]        -> joga a rodada atual até o PRAZO (s). SHARD=k/N, SAIDA=arquivo.jsonl
//      node afinar.js juntar arq...       -> lê as partidas, escolhe os campeões, prepara a próxima rodada, grava o resumo
//      node afinar.js resumo              -> reescreve ajuste/RESUMO.md
globalThis.self = globalThis; require('./solver.min.js');
const S = globalThis.Solver, M = S.motor, fs = require('fs'), cp = require('child_process'), os = require('os'), path = require('path');
const BOTS = require('./motor/bots_src.js').carregar(M);
const MIRROR = 'dhelmise-pbl', DIR = 'ajuste', ESTADO = path.join(DIR, 'estado.json');
const DESAFIANTES = +process.env.DESAFIANTES || 6;

// Vitória do HnS nos Regionais 2027 (claude/25_bots_contra_alvos_profissionais.md). Só conferência.
const ALVOS = { 'dragapult-ex': 0.52, 'basic-box-m': 0.38, 'slowking-scr': 0.62, 'alakazam-dudunsparce': 0.62,
  'ogerpon-meganium-hydrapple': 0.31, 'n-zoroark': 0.19, 'mega-rayquaza-ex': 0.42, 'mega-excadrill-ex': 0.43, 'dragapult-blaziken': 0.34 };

// Faixa de cada parâmetro. tipo 'mult': muda multiplicando (escala log); 'int': ±1.
const FAIXAS = {
  danoBanco: { min: 0, max: 1.5, tipo: 'mult' }, vivo: { min: 1, max: 50, tipo: 'mult' },
  energiaPerdida: { min: 0, max: 200, tipo: 'mult' }, energiaTirada: { min: 0, max: 200, tipo: 'mult' },
  apoiador: { min: 0, max: 600, tipo: 'mult' }, baixa: { min: 0, max: 300, tipo: 'mult' },
  risco: { min: 0, max: 2000, tipo: 'mult' }, chefiaBanco: { min: 0, max: 1, tipo: 'mult' },
  fecha: { min: 0, max: 6, tipo: 'mult' }, banco: { min: 3, max: 5, tipo: 'int' },
};

// ---------- sorteio com semente (as partidas e as mutações são reproduzíveis) ----------
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(str) { let h = 2166136261; for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619); } return h >>> 0; }
const arred = x => Math.round(x * 1000) / 1000;

function padrao(a) { const p = BOTS.PERFIS[a] || {}; return { ...BOTS.K_PADRAO, banco: p.banco || 4 }; }
// Uma mudança: desligar/religar uma regra do perfil (45%), adiantar/voltar uma regra (15%) ou mexer num número (40%).
function mutar(K, sorteio, regras) {
  const k = { ...K, desligar: [...(K.desligar || [])], antes: [...(K.antes || [])] }, nomes = Object.keys(FAIXAS), quantos = sorteio() < 0.6 ? 1 : 2, mudou = [];
  let tentativas = 0;
  while (mudou.length < quantos && tentativas++ < 200) {
    const q = sorteio();
    if (regras.length && q < 0.6) {
      const campo = q < 0.45 ? 'desligar' : 'antes', r = regras[Math.floor(sorteio() * regras.length)], tag = campo + ':' + r;
      if (mudou.includes(tag)) continue;
      const arr = k[campo], j = arr.indexOf(r); if (j >= 0) arr.splice(j, 1); else arr.push(r);
      arr.sort(); mudou.push(tag); continue;
    }
    const n = nomes[Math.floor(sorteio() * nomes.length)]; if (mudou.includes(n)) continue;
    const f = FAIXAS[n]; let v = k[n];
    if (f.tipo === 'int') v = v + (sorteio() < 0.5 ? -1 : 1);
    else if (v === 0 || sorteio() < 0.1) v = f.min + sorteio() * (f.max - f.min) * 0.3;    // sair do zero ou zerar de vez em quando
    else { const g = (() => { let u = 0; for (let j = 0; j < 6; j++) u += sorteio(); return (u - 3) / Math.sqrt(0.5); })(); v = v * Math.exp(0.7 * g);
      if (Math.abs(Math.log(Math.max(v, 1e-9) / k[n])) < 0.15) continue; }   // mudança pequena demais não separa do ruído
    if (f.tipo !== 'int' && sorteio() < 0.05) v = 0;
    v = Math.min(f.max, Math.max(f.min, f.tipo === 'int' ? Math.round(v) : arred(v)));
    if (v === k[n]) continue;
    k[n] = v; mudou.push(n);
  }
  return k;
}
function candidatos(campeao, rodada, a) {
  const regras = lerRegras()[a] || [];
  const s = rng(hash(`mut|${rodada}|${a}`)), lista = [campeao], vistos = new Set([JSON.stringify(campeao)]);
  for (let t = 0; lista.length < DESAFIANTES + 1 && t < 500; t++) { const c = mutar(campeao, s, regras); const j = JSON.stringify(c); if (!vistos.has(j)) { vistos.add(j); lista.push(c); } }
  return lista;
}
const igual = (x, y) => JSON.stringify(x) === JSON.stringify(y);
function diferencas(de, para) {
  const out = [];
  for (const n of Object.keys(para)) {
    if (igual(de[n], para[n])) continue;
    if (Array.isArray(para[n])) { const a = de[n] || [], b = para[n];
      b.filter(x => !a.includes(x)).forEach(x => out.push(n === 'desligar' ? `desliga ${x}` : `adianta ${x}`));
      a.filter(x => !b.includes(x)).forEach(x => out.push(n === 'desligar' ? `religa ${x}` : `volta ${x}`)); }
    else out.push(`${n} ${de[n]}→${para[n]}`);
  }
  return out;
}
function lerRegras() { const f = path.join(DIR, 'regras.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; }

// ---------- listas e pesos (os mesmos do RESUMO.md: a variação pesa pela parte real; dentro dela, a lista pela frequência) ----------
function pesos() {
  const P = JSON.parse(fs.readFileSync('plano.json', 'utf8')), out = {};
  for (const x of P.arquetipos) {
    if (x.a === MIRROR) continue;
    const vars = x.variacoes || { padrao: { parte: 1, listas: x.listas } }; const partes = Object.values(vars).reduce((s, o) => s + o.parte, 0) || 1;
    const w = {};
    for (const o of Object.values(vars)) { const tot = o.listas.reduce((s, l) => s + l.n, 0); for (const l of o.listas) w[l.i] = (w[l.i] || 0) + (o.parte / partes) * (l.n / tot); }
    out[x.a] = { nome: x.nome, w };
  }
  return out;
}

// Catálogo: as regras de cada perfil que de fato disparam em partidas (as que vale a pena desligar ou adiantar).
function catalogo() {
  const W = pesos(), raw = JSON.parse(fs.readFileSync('listas_solver.json', 'utf8')), B = S.O.deCompacto(raw), eu = deckRahul(), out = {};
  const N = +process.env.CAT_PARTIDAS || 2;
  for (const a of Object.keys(W)) {
    const cont = {};
    for (const i of Object.keys(W[a].w)) { const L = B.listas[i], ele = deckDe(L);
      for (let g = 0; g < N; g++) { globalThis.CATALOGO_REGRAS = new Set(); try { jogar(eu, ele, a, L, padrao(a), hash(`cat|${a}|${i}|${g}`)); } catch (e) {}
        for (const r of globalThis.CATALOGO_REGRAS) cont[r] = (cont[r] || 0) + 1; } }
    globalThis.CATALOGO_REGRAS = null;
    out[a] = Object.entries(cont).sort((x, y) => y[1] - x[1]).map(([r]) => r);
    console.log(`${a}: ${out[a].length} regras (${out[a].slice(0, 12).join(', ')}${out[a].length > 12 ? '…' : ''})`);
  }
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, 'regras.json'), JSON.stringify(out, null, 1));
}

function lerEstado() { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); }
function gravarEstado(E) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(ESTADO, JSON.stringify(E, null, 1)); }

function iniciar() {
  if (fs.existsSync(ESTADO)) { console.log('ajuste/estado.json já existe'); return; }
  if (!fs.existsSync(path.join(DIR, 'regras.json'))) catalogo();
  const W = pesos(), E = { rodada: 0, arquetipos: {} };
  for (const a of Object.keys(W)) { const c = padrao(a); E.arquetipos[a] = { nome: W[a].nome, campeao: c, v8: c, candidatos: candidatos(c, 0, a), semMelhora: 0, historico: [] }; }
  gravarEstado(E); console.log(`rodada 0: ${Object.keys(W).length} arquétipos, ${DESAFIANTES} desafiantes cada`);
}

// ---------- jogar ----------
function deckDe(L) { const d = []; for (const [nome, q] of L.qtd) { let fn = L.fullName.get(nome); if (!fn || !M.cm.getCardByName(fn)) fn = M.pick(nome); for (let k = 0; k < q; k++) d.push(fn); } return d; }
function deckRahul() { const d = []; for (const [n, q] of S.S.RAHUL) for (let k = 0; k < q; k++) d.push(M.pick(n)); return d; }
function jogar(dEu, dEle, a, L, K, semente) {
  const { G, Store, BotArbiter, BotShuffleMode, BotFlipMode } = M;
  Math.random = rng(semente);
  globalThis.AJUSTE_BOTS = { [a]: K };
  const store = new Store({ onStateChange() {} });
  const arb = new BotArbiter({ flipMode: BotFlipMode.RANDOM, shuffleMode: BotShuffleMode.RANDOM });
  const bots = { 1: new BOTS.BotHnS({ id: 1, name: 'eu' }), 2: BOTS.criarBot({ id: 2 }, a, L.qtd) };
  store.dispatch(new G.AddPlayerAction(1, 'eu', dEu)); store.dispatch(new G.AddPlayerAction(2, 'ele', dEle));
  let passos = 0, erros = 0;
  while (store.state.phase !== G.GamePhase.FINISHED && passos++ < 8000) {
    const s = store.state; let x;
    for (const p of s.prompts.filter(p => p.result === undefined)) { x = arb.resolvePrompt(s, p); if (x) break; }
    if (!x) for (const id of [1, 2]) { x = bots[id].decodeNextAction(s); if (x) break; }
    if (!x) x = new G.PassTurnAction(s.players[s.activePlayer].id);
    try { store.dispatch(x); } catch (e) { erros++; try { store.dispatch(new G.PassTurnAction(store.state.players[store.state.activePlayer].id)); } catch (e2) {} }
  }
  const s = store.state;
  return { fim: s.phase === G.GamePhase.FINISHED ? 1 : 0, w: s.winner === 0 ? 1 : 0, emp: s.winner === 3 ? 1 : 0, t: s.turn, err: erros };
}

// Blocos: (g, arquétipo, lista). Cada bloco joga todos os candidatos do arquétipo com a mesma semente.
// O trabalhador "gid" de "total" pega os blocos t com t % total == gid, em ordem de g: se o prazo acabar no meio,
// todos os arquétipos e listas ficam com quase o mesmo número de partidas.
function trabalhador({ gid, total, prazo }) {
  const E = lerEstado(), W = pesos(), raw = JSON.parse(fs.readFileSync('listas_solver.json', 'utf8')), B = S.O.deCompacto(raw), eu = deckRahul();
  const blocos = []; for (const a of Object.keys(E.arquetipos)) for (const i of Object.keys(W[a].w)) blocos.push([a, +i]);
  const decks = {};
  for (let t = gid, g = 0; ; t += total) {
    g = Math.floor(t / blocos.length); const [a, i] = blocos[t % blocos.length];
    if (Date.now() > prazo) break;
    const L = B.listas[i]; const ele = decks[i] || (decks[i] = deckDe(L)); const sem = hash(`${E.rodada}|${a}|${i}|${g}`);
    E.arquetipos[a].candidatos.forEach((K, c) => {
      const t0 = Date.now(); let r;
      try { r = jogar(eu, ele, a, L, K, sem); } catch (e) { r = { erro: String(e && e.message || e).slice(0, 120) }; }
      process.send({ r: E.rodada, a, i, g, c, ms: Date.now() - t0, ...r });
    });
  }
  process.send({ fimDoTrabalho: true }); process.exit(0);
}
function rodar(cpus) {
  const E = lerEstado(); const [sk, sn] = (process.env.SHARD || '0/1').split('/').map(Number);
  const Wn = cpus || os.cpus().length, prazo = Date.now() + 1000 * (+process.env.PRAZO || 120) - 45000;   // o último bloco leva até ~45 s
  const out = fs.openSync(process.env.SAIDA || 'ajuste.jsonl', 'a'); let n = 0, vivos = Wn; const t0 = Date.now();
  console.log(`rodada ${E.rodada}, parte ${sk}/${sn}, ${Wn} trabalhadores`);
  for (let w = 0; w < Wn; w++) {
    const ch = cp.fork(__filename, ['trabalho'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    ch.on('message', m => { if (m.fimDoTrabalho) return; fs.writeSync(out, JSON.stringify(m) + '\n'); n++; });
    ch.on('exit', () => { if (--vivos === 0) console.log(`${n} partidas em ${Math.round((Date.now() - t0) / 1000)} s`); });
    ch.send({ gid: sk * Wn + w, total: sn * Wn, prazo });
  }
}

// ---------- juntar ----------
// Pontos do HnS por partida: vitória 1, empate 1/3. O oponente melhora quando isso CAI.
const pts = r => r.w + r.emp / 3;
function avaliar(R, a, nCand, w) {
  // por lista: blocos (g) completos; para cada candidato, média de pontos e diferença pareada contra o campeão (c = 0)
  const porLista = {};
  for (const r of R) { if (r.a !== a || r.erro || !r.fim) continue; ((porLista[r.i] = porLista[r.i] || {})[r.g] = porLista[r.i][r.g] || [])[r.c] = r; }
  const res = [];
  for (let c = 0; c < nCand; c++) {
    let W = 0, wr = 0, v = 0, dif = 0, vd = 0, jogos = 0, erros = 0;
    for (const [i, gs] of Object.entries(porLista)) {
      const peso = w[i] || 0; if (!peso) continue;
      const pares = Object.values(gs).filter(b => b[0] && b[c]); if (pares.length < 5) continue;
      const x = pares.map(b => pts(b[c])), d = pares.map(b => pts(b[0]) - pts(b[c]));
      const m = x.reduce((s, y) => s + y, 0) / x.length, md = d.reduce((s, y) => s + y, 0) / d.length;
      const vx = x.reduce((s, y) => s + (y - m) ** 2, 0) / Math.max(1, x.length - 1), vdd = d.reduce((s, y) => s + (y - md) ** 2, 0) / Math.max(1, d.length - 1);
      W += peso; wr += peso * m; v += peso * peso * vx / x.length; dif += peso * md; vd += peso * peso * vdd / d.length; jogos += pares.length;
      erros += pares.filter(b => b[c].err).length;
    }
    if (!W) { res.push(null); continue; }
    res.push({ hns: wr / W, se: Math.sqrt(v) / W, melhora: dif / W, seMelhora: Math.sqrt(vd) / W, jogos, erros });
  }
  return res;
}
function juntar(arqs) {
  const E = lerEstado(), W = pesos();
  const R = []; for (const f of arqs) { if (!fs.existsSync(f)) continue; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l.trim()) continue; const r = JSON.parse(l); if (r.r === E.rodada) R.push(r); } }
  console.log(`rodada ${E.rodada}: ${R.length} partidas`);
  if (!R.length) return;
  const rel = { rodada: E.rodada, data: new Date().toISOString(), partidas: R.length, arquetipos: {} };
  for (const [a, X] of Object.entries(E.arquetipos)) {
    const av = avaliar(R, a, X.candidatos.length, W[a].w); const camp = av[0];
    rel.arquetipos[a] = X.candidatos.map((K, c) => ({ K, ...(av[c] || {}) }));
    if (!camp) { console.log(`${a}: sem partidas suficientes`); continue; }
    // melhor desafiante: a maior queda do HnS, acima de 2,5 erros-padrão (são 6 comparações) e de meio ponto
    let melhor = 0, alvo = null;
    for (let c = 1; c < av.length; c++) { const x = av[c]; if (!x || x.erros > 0.02 * x.jogos) continue;
      if (x.melhora > 2.5 * x.seMelhora && x.melhora > 0.005 && x.melhora > melhor) { melhor = x.melhora; alvo = c; } }
    const reg = { rodada: E.rodada, hns: arred(camp.hns), se: arred(camp.se), jogos: camp.jogos };
    if (alvo) {
      const novo = X.candidatos[alvo]; const mud = diferencas(X.campeao, novo);
      Object.assign(reg, { trocou: mud.join(', '), ganho: arred(melhor), seGanho: arred(av[alvo].seMelhora) });
      X.campeao = novo; X.semMelhora = 0;
      console.log(`${a}: HnS ${(100 * camp.hns).toFixed(1)}% · novo campeão (${mud.join(', ')}) tira ${(100 * melhor).toFixed(1)} pontos do HnS`);
    } else { X.semMelhora++; console.log(`${a}: HnS ${(100 * camp.hns).toFixed(1)}% · nenhum desafiante passou do ruído (${X.semMelhora} rodada(s) seguida(s))`); }
    if (E.rodada === 0) X.v8Resultado = reg;
    X.historico.push(reg);
    X.candidatos = candidatos(X.campeao, E.rodada + 1, a);
  }
  fs.mkdirSync(path.join(DIR, 'rodadas'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'rodadas', `r${String(E.rodada).padStart(3, '0')}.json`), JSON.stringify(rel));
  E.rodada++; gravarEstado(E); resumo();
}

// ---------- resumo ----------
function resumo() {
  const E = lerEstado(); const pc = x => (100 * x).toFixed(1) + '%';
  const L = [`# Ajuste automático dos bots dos oponentes`, '',
    `Rodadas completas: ${E.rodada}. Atualizado em ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`, '',
    'Vitória do Hide n\' Sneak contra cada oponente. Quanto **menor**, mais forte está o bot do oponente.',
    'O ajuste procura o bot do oponente que mais ganha; o alvo dos Regionais é só conferência.', '',
    '| Oponente | v8 (rodada 0) | Campeão atual (última rodada) | Alvo Regionais | Trocas aceitas | Rodadas sem melhora | Parâmetros mudados desde o v8 |',
    '|---|---|---|---|---|---|---|'];
  for (const [a, X] of Object.entries(E.arquetipos)) {
    const h = X.historico, ult = h[h.length - 1], v8 = X.v8Resultado;
    const mud = diferencas(X.v8, X.campeao).join(', ') || '—';
    L.push(`| ${X.nome} | ${v8 ? `${pc(v8.hns)} ±${(196 * v8.se).toFixed(1)}` : '—'} | ${ult ? `${pc(ult.hns)} ±${(196 * ult.se).toFixed(1)} (${ult.jogos} partidas)` : '—'} | ${ALVOS[a] ? pc(ALVOS[a]) : '—'} | ${h.filter(x => x.trocou).length} | ${X.semMelhora} | ${mud} |`);
  }
  L.push('', '## Trocas aceitas', '');
  for (const [a, X] of Object.entries(E.arquetipos)) for (const x of X.historico.filter(x => x.trocou))
    L.push(`- Rodada ${x.rodada}, ${X.nome}: ${x.trocou} (o HnS cai ${(100 * x.ganho).toFixed(1)} ±${(196 * x.seGanho).toFixed(1)} pontos)`);
  L.push('', 'O campeão de cada rodada joga de novo na rodada seguinte, com sementes novas: uma troca que foi sorte some sozinha na tabela.',
    'Parâmetros: `K_PADRAO` em `motor/src/bot-arquetipo.js`. Estado completo: `ajuste/estado.json`. Detalhe por rodada: `ajuste/rodadas/`.');
  fs.writeFileSync(path.join(DIR, 'RESUMO.md'), L.join('\n') + '\n');
}

const cmd = process.argv[2];
if (cmd === 'trabalho') process.once('message', trabalhador);
else if (cmd === 'iniciar') iniciar();
else if (cmd === 'catalogo') catalogo();
else if (cmd === 'rodar') rodar(+process.argv[3] || 0);
else if (cmd === 'juntar') juntar(process.argv.slice(3));
else if (cmd === 'resumo') resumo();
else console.log('uso: node afinar.js iniciar | rodar [cpus] | juntar arquivos... | resumo');
