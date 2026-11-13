globalThis.self=globalThis; require(process.env.BUNDLE||'./solver.min.js'); const M=Solver.motor, G=M.G;
const EN={1:'Grass Energy',2:'Fire Energy',3:'Water Energy',4:'Lightning Energy',5:'Psychic Energy',6:'Fighting Energy',7:'Darkness Energy',8:'Metal Energy'};
const card=n=>M.cm.getCardByName(n.includes(' ')&&M.cm.getCardByName(n)?n:M.pick(n));
const FILL=M.pick('Dunsparce');
function novoJogo(){
  const store=new M.Store({onStateChange(){}}); const arb=new M.BotArbiter({flipMode:M.BotFlipMode.RANDOM,shuffleMode:M.BotShuffleMode.RANDOM});
  const deck=[]; for(const n of ['Dunsparce','Shuppet','Budew','Poltchageist']) for(let i=0;i<4;i++) deck.push(M.pick(n)); for(let i=0;i<44;i++) deck.push(M.pick('Psychic Energy'));
  store.dispatch(new G.AddPlayerAction(1,'a',deck.slice())); store.dispatch(new G.AddPlayerAction(2,'b',deck.slice()));
  const bots={1:new M.BotPlano({id:1}),2:new M.BotPlano({id:2})}; let n=0;
  while(n++<300){ const s=store.state; if(s.phase===G.GamePhase.PLAYER_TURN && !s.prompts.some(p=>p.result===undefined)) break;
    let a; for(const p of s.prompts.filter(p=>p.result===undefined)){a=arb.resolvePrompt(s,p); if(a)break;}
    if(!a) for(const id of [1,2]){ a=bots[id].decodeNextAction(s); if(a)break; }
    if(!a) break; store.dispatch(a); }
  return {store,arb,bots};
}
function lista(cs){ const l=new M.PokemonCardList(); l.cards=cs; l.damage=0; return l; }
function grande(c,fraq){ c.hp=9999; c.weakness=fraq?[{type:fraq}]:[]; c.resistance=[]; return c; }

module.exports={M,G,EN,card,FILL,novoJogo,lista,grande};
