# Resume cada partida do diag: quem venceu, turnos do oponente sem ataque, e que Pokémon dele deram prêmio ao HnS.
import re,sys,glob,collections
arq=sorted(glob.glob(f'diag_{sys.argv[1]}_*.txt'))
semAtk=collections.Counter(); deu=collections.Counter(); ativoSem=collections.Counter(); fins=collections.Counter(); tot=0
for f in arq:
    L=open(f,encoding='utf-8',errors='ignore').read().split('\n')
    turnos=[]; cur=None
    for l in L:
        m=re.match(r'--- T(\d+) \(vez de (\S+)\) \| ZOR ativo (.+?)\[(\d+)e (\d+)d\] banco (.*?) mão .*?prêmios (\d) \| HnS ativo (.+?)\[.*?prêmios (\d)',l)
        if m:
            cur={'t':int(m[1]),'vez':m[2],'ativo':m[3],'banco':[x.split('/')[0] for x in m[6].split(',') if x],'pz':int(m[7]),'ph':int(m[9]),'atk':None}; turnos.append(cur); continue
        if cur and 'ATTACK_ACTION' in l: cur['atk']=l.split('ATTACK_ACTION')[1].strip()
        if l.startswith('FIM'): fim=l
    venc='HnS' if 'vencedor HnS' in fim else 'ZOR'; tot+=1
    fins[venc]+=1
    for a,b in zip(turnos,turnos[1:]):
        if a['vez']=='ZOR' and a['t']>2 and not a['atk']: semAtk[venc]+=1; ativoSem[a['ativo']]+=1
        if b['ph']<a['ph']:   # HnS pegou prêmio: quem sumiu do lado do ZOR
            antes=[a['ativo']]+a['banco']; depois=[b['ativo']]+b['banco']
            for p in set(antes):
                if antes.count(p)>depois.count(p): deu[p]+=a['ph']-b['ph']
    if venc=='HnS': fins['HnS_premios_restantes_ZOR_'+str(turnos[-1]['pz'])]+=1
print(dict(fins)); print('turnos sem ataque (T>2) por resultado:',dict(semAtk))
print('ativo nos turnos sem ataque:',ativoSem.most_common(8)); print('prêmios entregues por Pokémon:',deu.most_common(10))
