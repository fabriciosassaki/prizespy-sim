# Fase 1 da IA: rede que imita a escolha dos bots (política) e estima a chance de vitória (valor).
# Entrada: a pasta do ia/preparar.js. Saída: modelo.pt, pesos.bin + pesos.json (para o ia/rede.js), treino.json e exemplos.json.
# Uso: python3 ia/treino.py <pasta preparada> <pasta de saída> [épocas] [máximo de decisões]
import json, sys, os, time, math
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F

pasta, saida = sys.argv[1], sys.argv[2]
EPOCAS = int(sys.argv[3]) if len(sys.argv) > 3 else 4
MAXN = int(sys.argv[4]) if len(sys.argv) > 4 else 0
os.makedirs(saida, exist_ok=True)
meta = json.load(open(f'{pasta}/meta.json'))
L, LIM = meta['layout'], meta['LIM']
n = meta['n'] if not MAXN else min(meta['n'], MAXN)
TI, TF = meta['TOTAL_I'], meta['TOTAL_F']
ints = np.memmap(f'{pasta}/ints.bin', dtype=np.int16, mode='r', shape=(meta['n'], TI))[:n]
nums = np.memmap(f'{pasta}/nums.bin', dtype=np.float32, mode='r', shape=(meta['n'], TF))[:n]
alvo = np.fromfile(f'{pasta}/alvo.bin', dtype=np.int32)[:n]
valor = np.fromfile(f'{pasta}/valor.bin', dtype=np.float32)[:n]
jogo = np.fromfile(f'{pasta}/jogo.bin', dtype=np.int32)[:n]
# validação = 5% das partidas (partidas inteiras, para não vazar a mesma partida entre treino e teste)
val = (jogo % 20) == 7
itr, iva = np.where(~val)[0], np.where(val)[0]
print(f'{n} decisões: {len(itr)} treino, {len(iva)} validação; {meta["cartas"]} cartas, {meta["nomes"]} nomes')

S, EV, EN, FE, C, NS = LIM['SLOTS'], LIM['EV'], LIM['EN'], LIM['FE'], LIM['C'], meta['NSLOT']
def fatia(a, k): o, m = L[k]; return a[:, o:o + m]

class Rede(nn.Module):
    def __init__(s, nc, nn_, na, nt, d=32, h=256):
        super().__init__()
        s.carta = nn.Embedding(nc, d, padding_idx=0); s.nome = nn.Embedding(nn_, 16, padding_idx=0)
        s.arq = nn.Embedding(na, 8); s.tipo = nn.Embedding(nt, 16)
        s.slot = nn.Sequential(nn.Linear(4 * d + NS, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU())
        s.pos = nn.Parameter(torch.zeros(S, 64)); s.semAlvo = nn.Parameter(torch.zeros(1, 64))
        dim = S * 64 + 3 * d + d + 16 + meta['NGLOB']
        s.corpo = nn.Sequential(nn.Linear(dim, h), nn.ReLU(), nn.Linear(h, h), nn.ReLU())
        s.cand = nn.Sequential(nn.Linear(16 + d + 16 + 64, 96), nn.ReLU(), nn.Linear(96, 64))
        s.q = nn.Linear(h, 64); s.bias = nn.Linear(64, 1); s.v = nn.Sequential(nn.Linear(h, 64), nn.ReLU(), nn.Linear(64, 1))
    def forward(s, I, X):
        B = I.shape[0]; E = s.carta
        sc = E(fatia(I, 'slotCarta'))                                                   # B,S,d
        sev = E(fatia(I, 'slotEv').reshape(B, S, EV)).sum(2)
        sen = E(fatia(I, 'slotEn').reshape(B, S, EN)).sum(2)
        sfe = E(fatia(I, 'slotFe').reshape(B, S, FE)).sum(2)
        sn = fatia(X, 'slotNum').reshape(B, S, NS)
        sl = s.slot(torch.cat([sc, sev, sen, sfe, sn], 2)) + s.pos                    # B,S,64
        mao = E(fatia(I, 'mao')).sum(1); de = E(fatia(I, 'descEu')).sum(1); dl = E(fatia(I, 'descEle')).sum(1)
        est = E(fatia(I, 'est')).squeeze(1); arq = s.arq(fatia(I, 'arq')).reshape(B, 16)
        h = s.corpo(torch.cat([sl.reshape(B, -1), mao, de, dl, est, arq, fatia(X, 'glob')], 1))
        alvos = torch.cat([sl, s.semAlvo.expand(B, 1, 64).expand(B, 1, 64)], 1)          # B,S+1,64 (12 = sem alvo)
        ia = fatia(I, 'cAlvo').long().clamp(max=S); ia = torch.where(ia == 12, torch.full_like(ia, S), ia)
        av = torch.gather(alvos, 1, ia.unsqueeze(2).expand(B, C, 64))
        cv = s.cand(torch.cat([s.tipo(fatia(I, 'cTipo')), E(fatia(I, 'cCarta')), s.nome(fatia(I, 'cNome')), av], 2))   # B,C,64
        nota = (cv * s.q(h).unsqueeze(1)).sum(2) + s.bias(cv).squeeze(2)
        nota = nota.masked_fill(fatia(X, 'cMask') < 0.5, -1e4)
        return nota, s.v(h).squeeze(1)

torch.manual_seed(0); torch.set_num_threads(max(1, os.cpu_count()))
rede = Rede(meta['cartas'], meta['nomes'], meta['arqs'], meta['TIPOS'])
print('parâmetros:', sum(p.numel() for p in rede.parameters()))
opt = torch.optim.AdamW(rede.parameters(), lr=2e-3, weight_decay=1e-4)
BS = 512
def lote(ix):
    ix = np.sort(ix)
    return (torch.from_numpy(np.asarray(ints[ix], dtype=np.int64)), torch.from_numpy(np.asarray(nums[ix])),
            torch.from_numpy(alvo[ix].astype(np.int64)), torch.from_numpy(valor[ix]))
def avaliar():
    rede.eval(); ok = tot = 0; bce = 0.0
    with torch.no_grad():
        for j in range(0, len(iva), 4096):
            I, X, y, v = lote(iva[j:j + 4096]); nota, pv = rede(I, X)
            ok += (nota.argmax(1) == y).sum().item(); tot += len(y)
            bce += F.binary_cross_entropy_with_logits(pv, v, reduction='sum').item()
    rede.train(); return ok / max(1, tot), bce / max(1, tot)
hist = []; passos = math.ceil(len(itr) / BS) * EPOCAS
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=passos)
t0 = time.time()
for ep in range(EPOCAS):
    np.random.shuffle(itr); perda = 0.0; k = 0
    for j in range(0, len(itr), BS):
        I, X, y, v = lote(itr[j:j + BS]); nota, pv = rede(I, X)
        loss = F.cross_entropy(nota, y) + 0.5 * F.binary_cross_entropy_with_logits(pv, v)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step(); perda += loss.item(); k += 1
    acc, vb = avaliar()
    hist.append({'epoca': ep + 1, 'perda': perda / k, 'acerto_val': acc, 'bce_valor_val': vb, 'segundos': round(time.time() - t0)})
    print(json.dumps(hist[-1]))
torch.save(rede.state_dict(), f'{saida}/modelo.pt')
json.dump({'n': n, 'treino': len(itr), 'val': len(iva), 'hist': hist}, open(f'{saida}/treino.json', 'w'), indent=1)
# Pesos para o ia/rede.js (a conta da rede em JavaScript, síncrona, sem dependência): pesos.bin (float32) + pesos.json
rede.eval(); idx = {}; partes = []; o = 0
for k, t in rede.state_dict().items():
    a = t.detach().numpy().astype(np.float32).ravel(); idx[k] = {'o': o, 'shape': list(t.shape)}; partes.append(a); o += a.size
np.concatenate(partes).tofile(f'{saida}/pesos.bin'); json.dump(idx, open(f'{saida}/pesos.json', 'w'))
# alguns exemplos de validação com a saída do PyTorch, para conferir a conta em JavaScript
I, X, _, _ = lote(iva[:8])
with torch.no_grad(): nota, pv = rede(I, X)
json.dump({'ints': I.tolist(), 'nums': X.tolist(), 'nota': nota.tolist(), 'valor': pv.tolist()}, open(f'{saida}/exemplos.json', 'w'))
print('ok:', f'{saida}/pesos.bin', o, 'números')
