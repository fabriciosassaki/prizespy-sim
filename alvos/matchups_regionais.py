import re,html,subprocess,json,sys
alvos=['Dragapult','Basic Box','Dhelmise','Slowking','Alakazam Dudunsparce','Ogerpon Meganium Hydrapple',"N's Zoroark",'Mega Rayquaza','Mega Excadrill','Dragapult Blaziken']
def tabela(tid,q):
    t=subprocess.run(['curl','-sS',f'https://labs.limitlesstcg.com/{tid:04d}/decks/dhelmise-pbl/matchups{q}'],capture_output=True,text=True).stdout
    t=re.sub(r'<script.*?</script>','',t,flags=re.S);t=re.sub(r'<[^>]+>','|',t);t=html.unescape(re.sub(r'\s+',' ',t));t=re.sub(r'(\|\s*)+','|',t)
    R={}
    for m in re.finditer(r"\|([^|]+?)\|(\d+)\|(\d+) - (\d+) - (\d+)\|",t): R[m.group(1).strip()]=tuple(map(int,m.groups()[2:]))
    return R
for q in ['','?d2']:
    tot={a:[0,0,0] for a in alvos}
    for tid in range(72,80):
        R=tabela(tid,q)
        for a in alvos:
            if a in R:
                for i in range(3): tot[a][i]+=R[a][i]
    print('Day 2' if q else 'todos')
    for a,(w,l,t) in tot.items():
        n=w+l+t; print(f'  {a:28s} {w}-{l}-{t}  n={n}  HnS {100*(w+t/3)/max(1,n):.1f}%')
