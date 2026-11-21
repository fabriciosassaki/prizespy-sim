# Confere os arquivos do ia/gravar.js: para o lado que decide, mão + baralho + descarte + prêmios + cartas em jogo = 60
# (a zona perdida e o apoiador em resolução não são gravados: diferença pequena e rara é aceitável),
# a jogada escolhida está entre as candidatas, e o vencedor está registrado.
import gzip, json, glob, sys, collections
pasta = sys.argv[1] if len(sys.argv) > 1 else 'decisoes'
n = ok60 = dentro = 0; partidas = venc = 0; dif = collections.Counter(); arqs = collections.Counter()
for f in glob.glob(f'{pasta}/decisoes-*.jsonl.gz'):
    for linha in gzip.open(f, 'rt'):
        g = json.loads(linha); partidas += 1; venc += g['venceu'] in (0, 1, 'empate'); arqs[g['a']] += 1
        for d in g['dec']:
            eu = d['e']['eu']; n += 1; dentro += d['k'] >= 0
            emjogo = sum(1 + len(s['ev']) + len(s['e']) + len(s['f']) for s in [eu['a'], *eu['b']] if s)
            tot = len(eu['mao']) + eu['deck'] + len(eu['desc']) + eu['pr'] + emjogo + (1 if d['e']['est'] and d['e']['estMeu'] else 0)
            ok60 += tot == 60; dif[60 - tot] += 1
print(f'{partidas} partidas ({dict(arqs)}), vencedor registrado em {venc}')
print(f'{n} decisões: {100*dentro/n:.2f}% com a escolha entre as candidatas; {100*ok60/n:.1f}% somam 60 cartas; faltando: {dict(dif.most_common(6))}')
