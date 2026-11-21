// Fase 1 da IA: a conta da rede do ia/treino.py em JavaScript puro (síncrona, para o laço do motor), e o bot que joga por ela.
// Carregar: const R = carregar(pasta) com pesos.bin, pesos.json e vocab.json. R.avaliar(ints, nums) -> { nota[C], valor }.
// BotRede(client, base, R, info, opções): nas decisões de turno escolhe pela rede (da maior nota para a menor, até o motor
// aceitar a jogada); as escolhas dentro de cartas (buscas, descartes, alvos) continuam com o bot "base".
const fs = require('fs'), path = require('path');
const K = require('./codificar.js');

function carregar(pasta, vocabArq) {
  const idx = JSON.parse(fs.readFileSync(path.join(pasta, 'pesos.json'), 'utf8'));
  const buf = fs.readFileSync(path.join(pasta, 'pesos.bin')); const all = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const P = {}; for (const [k, v] of Object.entries(idx)) { const n = v.shape.reduce((a, b) => a * b, 1); P[k] = { w: all.subarray(v.o, v.o + n), shape: v.shape }; }
  const { V, I } = K.carregarVocab(vocabArq || path.join(pasta, 'vocab.json'));
  const { LIM, layout, NSLOT, NGLOB } = K, S = LIM.SLOTS, C = LIM.C, d = P['carta.weight'].shape[1];
  const relu = a => { for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0; return a; };
  const lin = (nome, x) => { const W = P[nome + '.weight'], b = P[nome + '.bias'].w, [o, n] = W.shape, y = new Float32Array(o);
    for (let i = 0; i < o; i++) { let s = b[i]; const r = i * n; for (let j = 0; j < n; j++) s += W.w[r + j] * x[j]; y[i] = s; } return y; };
  const emb = (nome, id, out, off) => { const W = P[nome + '.weight']; const dim = W.shape[1]; for (let j = 0; j < dim; j++) out[off + j] += W.w[id * dim + j]; };
  function avaliar(ints, nums) {
    const at = k => layout[k][0];
    const sl = [];   // 12 vetores de 64
    for (let k = 0; k < S; k++) {
      const x = new Float32Array(4 * d + NSLOT);
      emb('carta', ints[at('slotCarta') + k], x, 0);
      for (let j = 0; j < LIM.EV; j++) emb('carta', ints[at('slotEv') + k * LIM.EV + j], x, d);
      for (let j = 0; j < LIM.EN; j++) emb('carta', ints[at('slotEn') + k * LIM.EN + j], x, 2 * d);
      for (let j = 0; j < LIM.FE; j++) emb('carta', ints[at('slotFe') + k * LIM.FE + j], x, 3 * d);
      for (let j = 0; j < NSLOT; j++) x[4 * d + j] = nums[at('slotNum') + k * NSLOT + j];
      const v = relu(lin('slot.2', relu(lin('slot.0', x)))); const pos = P.pos.w;
      for (let j = 0; j < 64; j++) v[j] += pos[k * 64 + j];
      sl.push(v);
    }
    const dim = S * 64 + 4 * d + 16 + NGLOB, x = new Float32Array(dim); let o = 0;
    for (const v of sl) { x.set(v, o); o += 64; }
    for (let j = 0; j < LIM.MAO; j++) emb('carta', ints[at('mao') + j], x, o); o += d;
    for (let j = 0; j < LIM.DESC; j++) emb('carta', ints[at('descEu') + j], x, o); o += d;
    for (let j = 0; j < LIM.DESC; j++) emb('carta', ints[at('descEle') + j], x, o); o += d;
    emb('carta', ints[at('est')], x, o); o += d;
    emb('arq', ints[at('arq')], x, o); emb('arq', ints[at('arq') + 1], x, o + 8); o += 16;
    for (let j = 0; j < NGLOB; j++) x[o + j] = nums[at('glob') + j];
    const h = relu(lin('corpo.2', relu(lin('corpo.0', x))));
    const q = lin('q', h), valor = lin('v.2', relu(lin('v.0', h)))[0];
    const nota = new Float32Array(C).fill(-1e4), sem = P.semAlvo.w;
    for (let c = 0; c < C; c++) {
      if (nums[at('cMask') + c] < 0.5) continue;
      const y = new Float32Array(16 + d + 16 + 64);
      emb('tipo', ints[at('cTipo') + c], y, 0); emb('carta', ints[at('cCarta') + c], y, 16); emb('nome', ints[at('cNome') + c], y, 16 + d);
      const a = ints[at('cAlvo') + c]; const av = a === 12 ? sem : sl[Math.min(a, S - 1)]; y.set(av, 32 + d);
      const cv = lin('cand.2', relu(lin('cand.0', y)));
      let s = P['bias.bias'].w[0]; for (let j = 0; j < 64; j++) s += cv[j] * (q[j] + P['bias.weight'].w[j]);
      nota[c] = s;
    }
    return { nota, valor };
  }
  return { V, I, avaliar };
}

// Bot que joga pela rede nas decisões de turno. base = o bot de regras do mesmo deck (resolve as escolhas dentro de cartas
// e confere se a jogada é aceita pelo motor, simulando). info = { arq, arqEle }.
function criarBotRede(G, E, J) {
  return class BotRede {
    constructor(client, base, R, info, op = {}) { this.client = client; this.base = base; this.R = R; this.info = info; this.op = op; this.stats = { decisoes: 0, tentativas: 0, ms: 0 }; }
    decodeNextAction(state) {
      const i = state.players.findIndex(p => p.id === this.client.id); if (i < 0) return;
      const me = state.players[i];
      if (state.prompts.some(p => p.playerId === me.id && p.result === undefined)) return this.base.decodeNextAction(state);
      if (state.prompts.some(p => p.result === undefined)) return;
      if (state.phase !== G.GamePhase.PLAYER_TURN || state.players[state.activePlayer].id !== me.id) return;
      const t0 = Date.now();
      const cands = J.candidatos(state, me), { ints, nums } = K.codificar(this.R.I, E.estado(state, i, this.info), cands.map(c => c.d));
      const { nota } = this.R.avaliar(ints, nums);
      const ordem = cands.map((c, j) => [j < K.LIM.C ? nota[j] : -1e5, c]).sort((a, b) => b[0] - a[0]);
      this.stats.decisoes++;
      for (const [, c] of ordem) {
        const a = c.a(); this.stats.tentativas++;
        if (c.d === 'passar' || this.base.simular(state, [() => a]) !== null) { this.stats.ms += Date.now() - t0; return a; }
      }
      this.stats.ms += Date.now() - t0; return new G.PassTurnAction(me.id);
    }
  };
}
module.exports = { carregar, criarBotRede };
