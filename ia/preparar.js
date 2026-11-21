// Fase 1 da IA: lê os decisoes-*.jsonl.gz do ia/gravar.js e escreve os dados de treino já codificados (ia/codificar.js).
// Uso: node ia/preparar.js <pasta com os .jsonl.gz> <pasta de saída> [máximo de decisões]
// Saída: vocab.json, ints.bin (int16), nums.bin (float32), alvo.bin (int32: índice da escolhida),
//        valor.bin (float32: 1 vitória, 0 derrota, 0,5 empate), jogo.bin (int32: nº da partida), meta.json
const fs = require('fs'), path = require('path'), zlib = require('zlib'), readline = require('readline');
const K = require('./codificar.js');
const [entrada, saida, maxArg] = process.argv.slice(2); const MAX = +maxArg || Infinity;
const arquivos = [];
(function achar(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) achar(p); else if (/decisoes-.*\.jsonl\.gz$/.test(f)) arquivos.push(p); } })(entrada);
arquivos.sort();
async function* partidas() { for (const f of arquivos) { const rl = readline.createInterface({ input: fs.createReadStream(f).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) yield JSON.parse(l); } }
(async () => {
  fs.mkdirSync(saida, { recursive: true });
  // 1ª passada: vocabulário
  const V = K.novoVocab(), I = K.indexar(V); let n = 0, jogos = 0;
  for await (const g of partidas()) { jogos++; for (const d of g.dec) { if (d.k < 0 || d.k >= K.LIM.C) continue; K.aprender(V, I, d); if (++n >= MAX) break; } if (n >= MAX) break; }
  fs.writeFileSync(path.join(saida, 'vocab.json'), JSON.stringify(V));
  console.log(`vocabulário: ${V.cartas.length} cartas, ${V.nomes.length} habilidades/ataques, ${V.arqs.length} arquétipos; ${n} decisões em ${jogos} partidas`);
  // 2ª passada: codificar
  const fI = fs.openSync(path.join(saida, 'ints.bin'), 'w'), fN = fs.openSync(path.join(saida, 'nums.bin'), 'w');
  const alvo = [], valor = [], jogo = []; let m = 0, gi = 0;
  for await (const g of partidas()) {
    for (const d of g.dec) {
      if (d.k < 0 || d.k >= K.LIM.C) continue;
      const { ints, nums } = K.codificar(I, d.e, d.c);
      fs.writeSync(fI, Buffer.from(Int16Array.from(ints).buffer)); fs.writeSync(fN, Buffer.from(nums.buffer));
      alvo.push(d.k); valor.push(g.venceu === d.l ? 1 : (g.venceu === 0 || g.venceu === 1) ? 0 : 0.5); jogo.push(gi);
      if (++m >= n) break;
    }
    gi++; if (m >= n) break;
  }
  fs.closeSync(fI); fs.closeSync(fN);
  fs.writeFileSync(path.join(saida, 'alvo.bin'), Buffer.from(Int32Array.from(alvo).buffer));
  fs.writeFileSync(path.join(saida, 'valor.bin'), Buffer.from(Float32Array.from(valor).buffer));
  fs.writeFileSync(path.join(saida, 'jogo.bin'), Buffer.from(Int32Array.from(jogo).buffer));
  fs.writeFileSync(path.join(saida, 'meta.json'), JSON.stringify({ n: m, jogos: gi, TOTAL_I: K.layout.TOTAL_I, TOTAL_F: K.layout.TOTAL_F, layout: K.layout, LIM: K.LIM, NSLOT: K.NSLOT, NGLOB: K.NGLOB, TIPOS: K.TIPOS.length,
    cartas: V.cartas.length, nomes: V.nomes.length, arqs: V.arqs.length }, null, 1));
  console.log(`${m} decisões codificadas (${K.layout.TOTAL_I} inteiros + ${K.layout.TOTAL_F} números cada)`);
})();
