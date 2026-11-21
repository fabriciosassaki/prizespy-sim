// Fase 1 da IA: transforma (estado, candidatas) em números de tamanho fixo. É a ÚNICA definição da entrada da rede:
// o ia/preparar.js usa para os dados de treino e o ia/rede.js usa na hora de jogar.
// Vocabulário (ia/vocab.json): cartas, nomes de habilidade/ataque, arquétipos, tipos de jogada. Índice 0 = vazio, 1 = desconhecido.
const fs = require('fs');
const LIM = { MAO: 30, DESC: 60, EV: 3, EN: 8, FE: 2, C: 48, SLOTS: 12 };
const TIPOS = ['', 'banco', 'evo', 'ene', 'ferr', 'item', 'apoio', 'est', 'hab', 'usaest', 'recuo', 'ataque', 'passar'];
const CONDS = ['ASLEEP', 'BURNED', 'CONFUSED', 'PARALYZED', 'POISONED'];
const NSLOT = 10;   // números por slot: presente, hp, dano, hp restante, entrou no turno, 5 condições
const NGLOB = 24;   // números globais

function novoVocab() { return { cartas: ['', '?'], nomes: ['', '?'], arqs: ['', '?'] }; }
function indexar(V) { const m = {}; for (const k of ['cartas', 'nomes', 'arqs']) m[k] = new Map(V[k].map((x, i) => [x, i])); return m; }
function carregarVocab(arq) { const V = JSON.parse(fs.readFileSync(arq, 'utf8')); return { V, I: indexar(V) }; }

// separa "ene:Telepathic Psychic Energy:B2" em tipo, nome e alvo
function partir(d) {
  const i = d.indexOf(':'), tipo = i < 0 ? d : d.slice(0, i); let resto = i < 0 ? '' : d.slice(i + 1), alvo = '';
  const m = resto.match(/:(A|B[0-4])$/); if (m) { alvo = m[1]; resto = resto.slice(0, -m[0].length); }
  if (tipo === 'recuo') { alvo = resto; resto = ''; }
  return { tipo, nome: resto, alvo };
}
const ehCarta = t => ['banco', 'evo', 'ene', 'ferr', 'item', 'apoio', 'est'].includes(t);

// acumula o vocabulário a partir de uma decisão gravada
function aprender(V, I, dec) {
  const addC = n => { if (n && !I.cartas.has(n)) { I.cartas.set(n, V.cartas.length); V.cartas.push(n); } };
  const addN = n => { if (n && !I.nomes.has(n)) { I.nomes.set(n, V.nomes.length); V.nomes.push(n); } };
  const addA = n => { if (n && !I.arqs.has(n)) { I.arqs.set(n, V.arqs.length); V.arqs.push(n); } };
  const e = dec.e;
  for (const lado of [e.eu, e.ele]) { for (const s of [lado.a, ...lado.b]) if (s) { addC(s.c); s.ev.forEach(addC); s.e.forEach(addC); s.f.forEach(addC); }
    lado.desc.forEach(addC); if (Array.isArray(lado.mao)) lado.mao.forEach(addC); }
  addC(e.est); addA(e.arq); addA(e.arqEle);
  for (const d of dec.c) { const p = partir(d); if (ehCarta(p.tipo)) addC(p.nome); else addN(p.nome); }
}

// Saída: inteiros (Int32Array) e números (Float32Array), nas posições abaixo. "idx" diz onde começa cada bloco.
const layout = (() => {
  const L = {}; let o = 0; const b = (k, n) => { L[k] = [o, n]; o += n; };
  b('slotCarta', LIM.SLOTS); b('slotEv', LIM.SLOTS * LIM.EV); b('slotEn', LIM.SLOTS * LIM.EN); b('slotFe', LIM.SLOTS * LIM.FE);
  b('mao', LIM.MAO); b('descEu', LIM.DESC); b('descEle', LIM.DESC); b('est', 1); b('arq', 2);
  b('cTipo', LIM.C); b('cCarta', LIM.C); b('cNome', LIM.C); b('cAlvo', LIM.C);
  L.TOTAL_I = o; o = 0;
  const f = (k, n) => { L[k] = [o, n]; o += n; };
  f('slotNum', LIM.SLOTS * NSLOT); f('glob', NGLOB); f('cMask', LIM.C);
  L.TOTAL_F = o; return L;
})();

function codificar(I, e, cands) {
  const ints = new Int32Array(layout.TOTAL_I), nums = new Float32Array(layout.TOTAL_F);
  const ci = n => (n ? (I.cartas.get(n) || 1) : 0), ni = n => (n ? (I.nomes.get(n) || 1) : 0), ai = n => (n ? (I.arqs.get(n) || 1) : 0);
  const put = (k, arr, f) => { const [o, n] = layout[k]; for (let j = 0; j < Math.min(n, arr.length); j++) ints[o + j] = f(arr[j]); };
  const slots = [e.eu.a, ...e.eu.b, e.ele.a, ...e.ele.b];
  slots.forEach((s, k) => {
    if (!s) return;
    ints[layout.slotCarta[0] + k] = ci(s.c);
    s.ev.slice(0, LIM.EV).forEach((x, j) => { ints[layout.slotEv[0] + k * LIM.EV + j] = ci(x); });
    s.e.slice(0, LIM.EN).forEach((x, j) => { ints[layout.slotEn[0] + k * LIM.EN + j] = ci(x); });
    s.f.slice(0, LIM.FE).forEach((x, j) => { ints[layout.slotFe[0] + k * LIM.FE + j] = ci(x); });
    const o = layout.slotNum[0] + k * NSLOT, hp = s.hp || 0;
    nums[o] = 1; nums[o + 1] = hp / 300; nums[o + 2] = s.d / 300; nums[o + 3] = Math.max(0, hp - s.d) / 300; nums[o + 4] = s.n;
    CONDS.forEach((c, j) => { nums[o + 5 + j] = s.st.includes(c) || s.st.includes(j + 1) ? 1 : 0; });
  });
  put('mao', Array.isArray(e.eu.mao) ? e.eu.mao : [], ci);
  put('descEu', e.eu.desc.slice(-LIM.DESC), ci); put('descEle', e.ele.desc.slice(-LIM.DESC), ci);
  ints[layout.est[0]] = ci(e.est); ints[layout.arq[0]] = ai(e.arq); ints[layout.arq[0] + 1] = ai(e.arqEle);
  const g = layout.glob[0], eu = e.eu, ele = e.ele, nmao = Array.isArray(eu.mao) ? eu.mao.length : eu.mao;
  const vals = [e.t / 30, e.vez, e.primeiro, e.est ? 1 : 0, e.estMeu, eu.deck / 60, ele.deck / 60, eu.pr / 6, ele.pr / 6, nmao / 15, ele.mao / 15,
    eu.desc.length / 60, ele.desc.length / 60, eu.sup, eu.ene, eu.rec, ele.sup, ele.ene, ele.rec,
    eu.b.filter(x => x).length / 5, ele.b.filter(x => x).length / 5, (eu.pr - ele.pr) / 6, eu.deck <= 5 ? 1 : 0, ele.deck <= 5 ? 1 : 0];
  vals.forEach((v, j) => { nums[g + j] = v; });
  cands.slice(0, LIM.C).forEach((d, j) => {
    const p = partir(d);
    ints[layout.cTipo[0] + j] = Math.max(0, TIPOS.indexOf(p.tipo));
    ints[layout.cCarta[0] + j] = ehCarta(p.tipo) ? ci(p.nome) : 0;
    ints[layout.cNome[0] + j] = ehCarta(p.tipo) ? 0 : ni(p.nome);
    // alvo: 0..5 = meus slots (A, B0..B4); 12 = sem alvo
    ints[layout.cAlvo[0] + j] = p.alvo === 'A' ? 0 : p.alvo ? 1 + Number(p.alvo.slice(1)) : 12;
    nums[layout.cMask[0] + j] = 1;
  });
  return { ints, nums };
}
module.exports = { LIM, TIPOS, NSLOT, NGLOB, layout, novoVocab, indexar, carregarVocab, aprender, codificar, partir };
