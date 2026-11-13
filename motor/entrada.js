// Pacote do simulador (Node): motor twinleaf corrigido (coleções SV e ME) + bots + lista do Rahul + leitor de listas.
// Mesma interface do solver.min.js do app: globalThis.Solver = { motor, S: { RAHUL }, O: { deCompacto } }.
const OUT = '/home/claude/motor/twinleafgg/ptcg-server/output';
const G = require('/home/claude/motor/twinleafgg/ptcg-server/output/game');
const sets = require('./sets-padrao.js');
const { CardManager } = require('/home/claude/motor/twinleafgg/ptcg-server/output/game/cards/card-manager');
const { Store } = require('/home/claude/motor/twinleafgg/ptcg-server/output/game/store/store');
const { BotArbiter, BotShuffleMode, BotFlipMode } = require('/home/claude/motor/twinleafgg/ptcg-server/output/game/bots/bot-arbiter');
const { Simulator } = require('/home/claude/motor/twinleafgg/ptcg-server/output/game/bots/simulator');
const { SimpleTacticsAi } = require('/home/claude/motor/twinleafgg/ptcg-server/output/simple-bot/simple-tactics-ai');
const D = require('/home/claude/motor/twinleafgg/ptcg-server/output/simple-bot/simple-bot-definitions');
const U = require('/home/claude/motor/twinleafgg/ptcg-server/output/utils/utils');
const U2 = require('/home/claude/motor/twinleafgg/ptcg-server/output/utils');
const { BotHnS } = require('./bots/bot-hns.js');
const { BotPlano } = require('./bots/bot-plano.js');

function fastClone(source, ignores = [], refMap = new Map()) {
  if (source === null || typeof source !== 'object') return source;
  if (Array.isArray(source)) return source.map(x => fastClone(x, ignores, refMap));
  for (const ig of ignores) if (source instanceof ig) return source;
  const r = refMap.get(source); if (r !== undefined) return r;
  const dest = Object.create(Object.getPrototypeOf(source)); refMap.set(source, dest);
  for (const k in source) if (Object.prototype.hasOwnProperty.call(source, k)) dest[k] = fastClone(source[k], ignores, refMap);
  return dest;
}
U.deepClone = fastClone; U2.deepClone = fastClone;
Store.prototype.calculatePlayability = function (s) { return s; };

const cm = CardManager.getInstance();
for (const k of Object.keys(sets)) if (k.startsWith('set') && Array.isArray(sets[k])) { try { cm.defineSet(sets[k]); } catch (e) {} }
const all = cm.getAllCards(); const LEGAL = new Set(['H', 'I', 'J']); const memo = new Map();
function pick(name) {
  if (memo.has(name)) return memo.get(name);
  const c = all.filter(c => c.name === name);
  const leg = c.filter(x => LEGAL.has(x.regulationMark)).sort((a, b) => b.regulationMark.localeCompare(a.regulationMark));
  const r = leg[0] || c[c.length - 1]; if (!r) throw new Error('carta não achada: ' + name); memo.set(name, r.fullName); return r.fullName;
}
const RAHUL = [['Poltchageist',4],['Sinistcha',2],['Dhelmise',4],['Shuppet',3],['Banette',4],['Dunsparce',2],['Dudunsparce',2],['Dudunsparce ex',1],["Lillie's Clefairy ex",2],['Latias ex',1],
  ["Lillie's Determination",4],['Gwynn',4],["Boss's Orders",3],["Explorer's Guidance",2],['Ultra Ball',4],['Poké Pad',4],['Night Stretcher',3],['Pokégear 3.0',1],['Prism Tower',3],
  ['Telepathic Psychic Energy',4],['Psychic Energy',2],['Legacy Energy',1]];
function deCompacto(c) {
  const listas = c.l.map(([a, n, flat]) => {
    const qtd = new Map(), fullName = new Map();
    for (let i = 0; i < flat.length; i += 2) { const [nome, fnm] = c.t[flat[i]]; qtd.set(nome, (qtd.get(nome) || 0) + flat[i + 1]); if (fnm && !fullName.has(nome)) fullName.set(nome, fnm); }
    return { a, n, qtd, fullName };
  });
  return { listas, arquetipos: c.arquetipos, gerado: c.gerado, desde: c.desde, total: c.total };
}
const motor = { G, cm, pick, Store, BotArbiter, BotShuffleMode, BotFlipMode, BotHnS, BotPlano, Simulator, SimpleTacticsAi, D,
  State: require('/home/claude/motor/twinleafgg/ptcg-server/output/game/store/state/state').State,
  Player: require('/home/claude/motor/twinleafgg/ptcg-server/output/game/store/state/player').Player,
  PokemonCardList: require('/home/claude/motor/twinleafgg/ptcg-server/output/game/store/state/pokemon-card-list').PokemonCardList,
  CardList: require('/home/claude/motor/twinleafgg/ptcg-server/output/game/store/state/card-list').CardList };
globalThis.Solver = { motor, S: { RAHUL }, O: { deCompacto } };
