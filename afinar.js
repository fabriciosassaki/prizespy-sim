// Ajuste automático dos bots dos oponentes.
// Cada arquétipo tem um "campeão" (os parâmetros atuais do fechamento do turno, K_PADRAO em motor/src/bot-arquetipo.js)
// e, a cada rodada, alguns "desafiantes" (o campeão com 1 ou 2 parâmetros mudados). Todos jogam contra o bot do
// Hide n' Sneak com as MESMAS sementes (mesmo embaralhamento e moedas), então a diferença entre eles vem só das decisões.
// O desafiante que fizer o oponente ganhar mais vira o campeão, se a melhora passar do ruído (2,5 erros-padrão).
// O alvo é "o oponente ganhar o máximo possível". Os números dos Regionais servem só de conferência no resumo.
//
// Duas fases que se alternam sozinhas (estado.fase):
//  - 'oponentes': cada arquétipo tem campeão e desafiantes; o HnS joga com o campeão dele.
//  - 'hns': os oponentes ficam congelados nos campeões; o HnS tem campeão e desafiantes, e o alvo é a vitória média
//    do HnS contra o campo (cada arquétipo pesa pela frequência no meta, o mirror incluído).
// Troca de fase: oponentes -> hns quando 7 dos 9 oponentes têm 3+ rodadas sem melhora; hns -> oponentes com 4 rodadas sem melhora.
// Uso: node afinar.js catalogo            -> ajuste/regras.json: as regras de cada perfil que disparam nas partidas
//      node afinar.js iniciar             -> cria ajuste/estado.json (rodada 0: campeão = v8 + desafiantes)
//      node afinar.js rodar [cpus]        -> joga a rodada atual até o PRAZO (s). SHARD=k/N, SAIDA=arquivo.jsonl
//      node afinar.js juntar arq...       -> lê as partidas, escolhe os campeões, prepara a próxima rodada, grava o resumo
//      node afinar.js ligar-hns           -> passa para a fase do HnS agora (cataloga as regras do HnS se faltar)
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
function pesos(comMirror) {
  const P = JSON.parse(fs.readFileSync('plano.json', 'utf8')), out = {};
  for (const x of P.arquetipos) {
    if (x.a === MIRROR && !comMirror) continue;
    const vars = x.variacoes || { padrao: { parte: 1, listas: x.listas } }; const partes = Object.values(vars).reduce((s, o) => s + o.parte, 0) || 1;
    const w = {};
    for (const o of Object.values(vars)) { const tot = o.listas.reduce((s, l) => s + l.n, 0); for (const l of o.listas) w[l.i] = (w[l.i] || 0) + (o.parte / partes) * (l.n / tot); }
    out[x.a] = { nome: x.nome, w, total: x.total || 1 };
  }
  return out;
}

// ---------- HnS ----------
const FAIXAS_HNS = { deckDud: [0, 30, 4], deckTorre: [0, 20, 3], baixosTorre: [1, 4, 1], baixosUltra: [1, 4, 1], maxDhelmise: [1, 4, 1],
  vagasDhelmise: [1, 3, 1], bancoMinimo: [1, 4, 1], deckGwynn: [0, 30, 4], maoLillie: [2, 10, 2], sobraLillie: [0, 25, 4],
  deckExplorer: [0, 30, 4], maoGwynn: [0, 8, 2] };          // [mín, máx, passo máximo]
function padraoHnS() { return JSON.parse(JSON.stringify(BOTS.K_HNS_PADRAO)); }
function mutarHnS(K, sorteio, regras) {
  const k = JSON.parse(JSON.stringify(K)), quantos = sorteio() < 0.6 ? 1 : 2, mudou = []; let t = 0;
  while (mudou.length < quantos && t++ < 200) {
    const q = sorteio();
    if (q < 0.35 && regras.length) {                       // regra: desligar (25%) ou adiantar (10%)
      const campo = q < 0.25 ? 'desligar' : 'antes', r = regras[Math.floor(sorteio() * regras.length)], tag = campo + ':' + r;
      if (mudou.includes(tag) || r === 'ataque') continue;
      const arr = k[campo], j = arr.indexOf(r); if (j >= 0) arr.splice(j, 1); else arr.push(r); arr.sort(); mudou.push(tag);
    } else if (q < 0.7) {                                  // limite de uma regra
      const nomes = Object.keys(FAIXAS_HNS), n = nomes[Math.floor(sorteio() * nomes.length)]; if (mudou.includes(n)) continue;
      const [mn, mx, passo] = FAIXAS_HNS[n], d = 1 + Math.floor(sorteio() * passo), v = Math.min(mx, Math.max(mn, k[n] + (sorteio() < 0.5 ? -d : d)));
      if (v === k[n]) continue; k[n] = v; mudou.push(n);
    } else {                                               // valor de uma carta na mão (ordem do descarte)
      const cartas = Object.keys(BOTS.VALOR), c = cartas[Math.floor(sorteio() * cartas.length)], tag = 'valor:' + c; if (mudou.includes(tag)) continue;
      const atual = k.valor[c] !== undefined ? k.valor[c] : BOTS.VALOR[c], d = 1 + Math.floor(sorteio() * 3);
      const v = Math.min(10, Math.max(0, atual + (sorteio() < 0.5 ? -d : d))); if (v === atual) continue;
      if (v === BOTS.VALOR[c]) delete k.valor[c]; else k.valor[c] = v; mudou.push(tag);
    }
  }
  return k;
}
function candidatosHnS(campeao, rodada) {
  const regras = lerRegras().__hns || [], s = rng(hash(`hns|${rodada}`)), lista = [campeao], vistos = new Set([JSON.stringify(campeao)]);
  for (let t = 0; lista.length < DESAFIANTES + 1 && t < 500; t++) { const c = mutarHnS(campeao, s, regras); const j = JSON.stringify(c); if (!vistos.has(j)) { vistos.add(j); lista.push(c); } }
  return lista;
}
function diferencasHnS(de, para) {
  const out = diferencas(de, para).filter(x => !x.startsWith('valor '));
  const a = de.valor || {}, b = para.valor || {};
  for (const c of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[c] !== undefined ? a[c] : BOTS.VALOR[c], vb = b[c] !== undefined ? b[c] : BOTS.VALOR[c];
    if (va !== vb) out.push(`valor de ${c} ${va}→${vb}`);
  }
  return out;
}
function campeoesOponentes(E) { const m = {}; for (const [a, X] of Object.entries(E.arquetipos)) m[a] = X.campeao; return m; }

// Catálogo: as regras de cada perfil que de fato disparam em partidas (as que vale a pena desligar ou adiantar).
function catalogo() {
  const W = pesos(), raw = JSON.parse(fs.readFileSync('listas_solver.json', 'utf8')), B = S.O.deCompacto(raw), eu = deckRahul(), out = {};
  const N = +process.env.CAT_PARTIDAS || 2;
  for (const a of Object.keys(W)) {
    const cont = {};
    for (const i of Object.keys(W[a].w)) { const L = B.listas[i], ele = deckDe(L);
      for (let g = 0; g < N; g++) { globalThis.CATALOGO_REGRAS = new Set(); try { jogar(eu, ele, a, L, padrao(a), null, hash(`cat|${a}|${i}|${g}`)); } catch (e) {}
        for (const r of globalThis.CATALOGO_REGRAS) cont[r] = (cont[r] || 0) + 1; } }
    globalThis.CATALOGO_REGRAS = null;
    out[a] = Object.entries(cont).sort((x, y) => y[1] - x[1]).map(([r]) => r);
    console.log(`${a}: ${out[a].length} regras (${out[a].slice(0, 12).join(', ')}${out[a].length > 12 ? '…' : ''})`);
  }
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, 'regras.json'), JSON.stringify(out, null, 1));
}
function catalogoHnS() {
  const W = pesos(true), raw = JSON.parse(fs.readFileSync('listas_solver.json', 'utf8')), B = S.O.deCompacto(raw), eu = deckRahul(), cont = {};
  for (const a of Object.keys(W)) for (const i of Object.keys(W[a].w)) { const L = B.listas[i], ele = deckDe(L);
    globalThis.CATALOGO_HNS = new Set(); try { jogar(eu, ele, a, L, null, padraoHnS(), hash(`cath|${a}|${i}`)); } catch (e) { if (process.env.DEBUG) console.log(e.stack.split("\n").slice(0, 3).join(" | ")); }
    for (const r of globalThis.CATALOGO_HNS) cont[r] = (cont[r] || 0) + 1; }
  globalThis.CATALOGO_HNS = null;
  const R = lerRegras(); R.__hns = Object.entries(cont).sort((x, y) => y[1] - x[1]).map(([r]) => r);
  fs.writeFileSync(path.join(DIR, 'regras.json'), JSON.stringify(R, null, 1)); console.log(`HnS: ${R.__hns.length} regras (${R.__hns.join(', ')})`);
}
// Liga a fase do HnS num estado que só tinha a dos oponentes.
function ligarHnS() {
  const E = lerEstado(); if (!(lerRegras().__hns)) catalogoHnS();
  if (!E.hns) { const c = padraoHnS(); E.hns = { campeao: c, inicial: c, candidatos: [], semMelhora: 0, historico: [] }; }
  E.fase = 'hns'; E.hns.semMelhora = 0; E.hns.candidatos = candidatosHnS(E.hns.campeao, E.rodada); E.trocasDeFase = E.trocasDeFase || [];
  E.trocasDeFase.push({ rodada: E.rodada, para: 'hns' }); gravarEstado(E); console.log(`rodada ${E.rodada}: fase do HnS ligada`);
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
// Kop: parâmetros do oponente (null = o que já está em AJUSTE_BOTS); Khns: parâmetros do HnS (null = padrão).
function jogar(dEu, dEle, a, L, Kop, Khns, semente, todos) {
  const { G, Store, BotArbiter, BotShuffleMode, BotFlipMode } = M;
  Math.random = rng(semente);
  globalThis.AJUSTE_BOTS = Object.assign({}, todos || {}, Kop ? { [a]: Kop } : {});
  const store = new Store({ onStateChange() {} });
  const arb = new BotArbiter({ flipMode: BotFlipMode.RANDOM, shuffleMode: BotShuffleMode.RANDOM });
  // mirror: o oponente é o bot do HnS com o campeão do HnS (até 21/11 era o bot genérico, e o HnS ganhava ~77% no mirror)
  const ele = a === MIRROR ? new BOTS.BotHnS({ id: 2, name: 'ele' }, globalThis.HNS_CAMPEAO || undefined) : BOTS.criarBot({ id: 2 }, a, L.qtd);
  const bots = { 1: new BOTS.BotHnS({ id: 1, name: 'eu' }, Khns || undefined), 2: ele };
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
  const E = lerEstado(), fase = E.fase || 'oponentes', W = pesos(fase === 'hns'), raw = JSON.parse(fs.readFileSync('listas_solver.json', 'utf8')), B = S.O.deCompacto(raw), eu = deckRahul();
  const todos = campeoesOponentes(E), Khns = E.hns ? E.hns.campeao : null; globalThis.HNS_CAMPEAO = Khns;
  const blocos = []; for (const a of Object.keys(fase === 'hns' ? W : E.arquetipos)) for (const i of Object.keys(W[a].w)) blocos.push([a, +i]);
  const decks = {};
  for (let t = gid, g = 0; ; t += total) {
    g = Math.floor(t / blocos.length); const [a, i] = blocos[t % blocos.length];
    if (Date.now() > prazo) break;
    const L = B.listas[i]; const ele = decks[i] || (decks[i] = deckDe(L)); const sem = hash(`${E.rodada}|${a}|${i}|${g}`);
    const cands = fase === 'hns' ? E.hns.candidatos : E.arquetipos[a].candidatos;
    cands.forEach((K, c) => {
      const t0 = Date.now(); let r;
      try { r = fase === 'hns' ? jogar(eu, ele, a, L, null, K, sem, todos) : jogar(eu, ele, a, L, K, Khns, sem, todos); } catch (e) { r = { erro: String(e && e.message || e).slice(0, 120) }; }
      process.send({ r: E.rodada, f: fase === 'hns' ? 'h' : 'o', a, i, g, c, ms: Date.now() - t0, ...r });
    });
  }
  process.send({ fimDoTrabalho: true }); process.exit(0);
}
function rodar(cpus) {
  const E = lerEstado(); const [sk, sn] = (process.env.SHARD || '0/1').split('/').map(Number);
  const Wn = cpus || os.cpus().length, prazo = Date.now() + 1000 * (+process.env.PRAZO || 120) - 45000;   // o último bloco leva até ~45 s
  const out = fs.openSync(process.env.SAIDA || 'ajuste.jsonl', 'a'); let n = 0, vivos = Wn; const t0 = Date.now();
  console.log(`rodada ${E.rodada} (fase ${E.fase || 'oponentes'}), parte ${sk}/${sn}, ${Wn} trabalhadores`);
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
  console.log(`rodada ${E.rodada} (fase ${E.fase || 'oponentes'}): ${R.length} partidas`);
  if (!R.length) return;
  if (E.fase === 'hns') return juntarHnS(E, R);
  const rel = { rodada: E.rodada, fase: 'oponentes', data: new Date().toISOString(), partidas: R.length, arquetipos: {} };
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
  E.rodada++; gravarEstado(E);
  // troca de fase: 7 dos 9 oponentes com 3+ rodadas sem melhora -> ajustar o HnS
  const estaveis = Object.values(E.arquetipos).filter(X => X.semMelhora >= 3).length;
  if (estaveis >= 7) { console.log(`${estaveis} oponentes estáveis: próxima rodada é do HnS`); ligarHnS(); }
  resumo();
}

// Fase do HnS: um único conjunto de candidatos; o ganho é a média, pelo meta, da vitória do HnS contra cada arquétipo.
function juntarHnS(E, R) {
  const W = pesos(true), H = E.hns, n = H.candidatos.length;
  const totMeta = Object.values(W).reduce((s, x) => s + x.total, 0);
  const porArq = {}, agg = Array.from({ length: n }, () => ({ hns: 0, v: 0, ganho: 0, vg: 0, jogos: 0, erros: 0, ok: true }));
  for (const [a, X] of Object.entries(W)) {
    const p = X.total / totMeta, av = avaliar(R, a, n, X.w); porArq[a] = av;
    av.forEach((x, c) => { const g = agg[c]; if (!x) { g.ok = false; return; }
      g.hns += p * x.hns; g.v += p * p * x.se * x.se; g.ganho += -p * x.melhora; g.vg += p * p * x.seMelhora * x.seMelhora; g.jogos += x.jogos; g.erros += x.erros; });
  }
  const rel = { rodada: E.rodada, fase: 'hns', data: new Date().toISOString(), partidas: R.length,
    candidatos: H.candidatos.map((K, c) => ({ K, ...agg[c], se: Math.sqrt(agg[c].v), seGanho: Math.sqrt(agg[c].vg),
      porArquetipo: Object.fromEntries(Object.entries(porArq).map(([a, av]) => [a, av[c] ? { hns: arred(av[c].hns), ganho: arred(-av[c].melhora), jogos: av[c].jogos } : null])) })) };
  const camp = agg[0];
  if (!camp.ok) {   // rodada curta demais (algum arquétipo sem 5 pares por lista): não decide e não conta como "sem melhora"
    console.log('HnS: algum arquétipo sem partidas suficientes; a rodada não decide nada');
    fs.mkdirSync(path.join(DIR, 'rodadas'), { recursive: true });
    fs.writeFileSync(path.join(DIR, 'rodadas', `r${String(E.rodada).padStart(3, '0')}.json`), JSON.stringify(rel));
    E.rodada++; H.candidatos = candidatosHnS(H.campeao, E.rodada); gravarEstado(E); resumo(); return;
  }
  let melhor = 0, alvo = null;
  if (camp.ok) for (let c = 1; c < n; c++) { const x = agg[c], se = Math.sqrt(x.vg); if (!x.ok || x.erros > 0.02 * x.jogos) continue;
    if (x.ganho > 2.5 * se && x.ganho > 0.005 && x.ganho > melhor) { melhor = x.ganho; alvo = c; } }
  const reg = { rodada: E.rodada, hns: arred(camp.hns), se: arred(Math.sqrt(camp.v)), jogos: camp.jogos,
    porArquetipo: Object.fromEntries(Object.entries(porArq).map(([a, av]) => [a, av[0] ? arred(av[0].hns) : null])) };
  if (alvo) {
    const novo = H.candidatos[alvo], mud = diferencasHnS(H.campeao, novo);
    Object.assign(reg, { trocou: mud.join(', '), ganho: arred(melhor), seGanho: arred(Math.sqrt(agg[alvo].vg)),
      porArquetipoGanho: Object.fromEntries(Object.entries(porArq).map(([a, av]) => [a, av[alvo] ? arred(-av[alvo].melhora) : null])) });
    H.campeao = novo; H.semMelhora = 0;
    console.log(`HnS: ${(100 * camp.hns).toFixed(1)}% no meta · novo campeão (${mud.join(', ')}) ganha ${(100 * melhor).toFixed(1)} pontos`);
  } else { H.semMelhora++; console.log(`HnS: ${(100 * camp.hns).toFixed(1)}% no meta · nenhum desafiante passou do ruído (${H.semMelhora} seguida(s))`); }
  if (!H.inicialResultado && camp.ok) H.inicialResultado = reg;
  H.historico.push(reg);
  fs.mkdirSync(path.join(DIR, 'rodadas'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'rodadas', `r${String(E.rodada).padStart(3, '0')}.json`), JSON.stringify(rel));
  E.rodada++;
  if (H.semMelhora >= 4) {   // HnS estável: mais uma passada nos oponentes, agora contra o HnS novo
    E.fase = 'oponentes'; E.trocasDeFase.push({ rodada: E.rodada, para: 'oponentes' });
    for (const [a, X] of Object.entries(E.arquetipos)) { X.semMelhora = 0; X.candidatos = candidatos(X.campeao, E.rodada, a); }
    console.log('HnS estável: próxima rodada volta para os oponentes');
  } else H.candidatos = candidatosHnS(H.campeao, E.rodada);
  gravarEstado(E); resumo();
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
  if (E.hns) {
    const H = E.hns, h = H.historico, ult = h[h.length - 1], ini = H.inicialResultado, W = pesos(true);
    L.push('', `## Bot do Hide n' Sneak${E.fase === 'hns' ? ' (fase atual)' : ''}`, '',
      'Vitória média do HnS contra o campo (cada oponente pesa pela frequência no meta), com os oponentes nos campeões deles. Quanto **maior**, melhor o bot do HnS.', '',
      `- Início: ${ini ? `${pc(ini.hns)} ±${(196 * ini.se).toFixed(1)}` : '—'} · agora: ${ult ? `${pc(ult.hns)} ±${(196 * ult.se).toFixed(1)} (${ult.jogos} partidas)` : '—'} · trocas aceitas: ${h.filter(x => x.trocou).length} · rodadas sem melhora: ${H.semMelhora}`,
      `- Mudanças desde o início: ${diferencasHnS(H.inicial, H.campeao).join(', ') || '—'}`, '');
    if (ult && ult.porArquetipo) { L.push('| Oponente | HnS no início | HnS agora |', '|---|---|---|');
      for (const a of Object.keys(ult.porArquetipo)) L.push(`| ${W[a] ? W[a].nome : a} | ${ini && ini.porArquetipo[a] != null ? pc(ini.porArquetipo[a]) : '—'} | ${ult.porArquetipo[a] != null ? pc(ult.porArquetipo[a]) : '—'} |`); }
    L.push('', 'Atenção: até 21/11 o mirror era jogado contra o bot genérico (o HnS ganhava ~77%). Desde a primeira rodada depois disso o oponente do mirror é o bot do HnS, então a coluna "início" do mirror não é comparável.');
    L.push('', 'As mudanças que o ajuste acha no bot do HnS são **hipóteses**: antes de irem para o playbook, conferir com as ideias do Rahul.');
    for (const x of h.filter(x => x.trocou)) L.push(`- Rodada ${x.rodada}: ${x.trocou} (o HnS sobe ${(100 * x.ganho).toFixed(1)} ±${(196 * x.seGanho).toFixed(1)} pontos no meta)`);
  }
  L.push('', '## Trocas aceitas nos oponentes', '');
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
else if (cmd === 'catalogo-hns') catalogoHnS();
else if (cmd === 'ligar-hns') ligarHnS();
else if (cmd === 'rodar') rodar(+process.argv[3] || 0);
else if (cmd === 'juntar') juntar(process.argv.slice(3));
else if (cmd === 'resumo') resumo();
else console.log('uso: node afinar.js iniciar | rodar [cpus] | juntar arquivos... | resumo');
