import json,sys,collections
p=sys.argv[1]
d=json.load(open(p))
pkgs=d.get('packages',{})
lic=collections.Counter(); missing=0; total=0; hits=[]
for name,info in pkgs.items():
    if not name: continue
    total+=1
    L=info.get('license')
    if isinstance(L,dict): L=L.get('type')
    if isinstance(L,list): L=' OR '.join(str(x) for x in L)
    if not L: missing+=1; L='UNKNOWN'
    L=str(L); lic[L]+=1
    up=L.upper()
    if any(k in up for k in ('GPL','SSPL','CC-BY-SA','EUPL','MPL','BUSL','ELASTIC','COMMONS CLAUSE')):
        # skip LGPL mention inside permissive strings? keep all, flag later
        hits.append((name,L,info.get('dev',False)))
print(f"=== {p} ===")
print(f"total packages: {total}, missing license field: {missing}")
print("--- license distribution (top 20) ---")
for k,v in lic.most_common(20): print(f"  {v:5d}  {k}")
print("--- copyleft / restricted hits ---")
if not hits: print("  NONE")
for n,l,dev in sorted(hits): print(f"  {l:28s} {n}{'  [dev]' if dev else '  <<< RUNTIME'}")
