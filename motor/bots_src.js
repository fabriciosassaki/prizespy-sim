// Carrega os bots direto de motor/src (sem recompilar o solver.min.js), usando o MESMO motor do pacote.
// Os require(OUT + '/...') dos bots viram os objetos que o pacote já expõe em Solver.motor.
// Assim dá para mudar os parâmetros dos bots (AJUSTE) a cada partida sem gerar outro pacote.
const fs = require('fs'), path = require('path'), Module = require('module');
function carregar(M) {
  const ActionSearchAi = new M.BotPlano({ id: 99 }, 'busca').simples.constructor;
  const mapa = {
    '/game': M.G,
    '/game/bots/simulator': { Simulator: M.Simulator },
    '/game/store/prompts/choose-pokemon-prompt': { ChoosePokemonPrompt: M.G.ChoosePokemonPrompt },
    '/game/store/prompts/choose-cards-prompt': { ChooseCardsPrompt: M.G.ChooseCardsPrompt },
    '/simple-bot/simple-tactics-ai': { SimpleTacticsAi: M.SimpleTacticsAi },
    '/simple-bot/simple-bot-definitions': M.D,
    '/advanced-bot/action-search-ai': { ActionSearchAi },
    '/game/bots/bot-arbiter': { BotArbiter: M.BotArbiter, BotShuffleMode: M.BotShuffleMode, BotFlipMode: M.BotFlipMode },
  };
  const OUT = '/home/claude/motor/twinleafgg/ptcg-server/output';
  const cache = {};
  function req(dir) {
    return nome => {
      if (nome.startsWith(OUT)) { const r = mapa[nome.slice(OUT.length)]; if (!r) throw new Error('bots_src: sem mapa para ' + nome); return r; }
      if (nome.startsWith('./')) return load(path.join(dir, nome));
      return require(nome);
    };
  }
  function load(arq) {
    if (cache[arq]) return cache[arq].exports;
    const m = { exports: {} }; cache[arq] = m;
    const src = fs.readFileSync(arq, 'utf8');
    const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', src);
    fn(req(path.dirname(arq)), m, m.exports, arq, path.dirname(arq));
    return m.exports;
  }
  const dir = path.join(__dirname, 'src');
  return { ...load(path.join(dir, 'bot-arquetipo.js')), BotHnS: load(path.join(dir, 'bot-hns.js')).BotHnS };
}
module.exports = { carregar };
