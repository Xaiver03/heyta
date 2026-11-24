# -*- coding: utf-8 -*-
"""heyta 04-imagery：本地 ComfyUI(MOSS-Image) 生成 背景/插画/merch（含笔记本），
完成后生成 contact-sheet.png 与 _manifest_main.json。耐心排队（并发多时自动等待）。"""
import os, sys, json, time, shutil, urllib.request
WD=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # brand-kit
IM=os.path.join(WD,"04-imagery")
COMFY="http://127.0.0.1:8188"
WF="/Volumes/RocaSSD/comfyui/workflows/moss_api_test.json"
OUTDIR="/Volumes/RocaSSD/comfyui/ComfyUI/output"
LOG=os.path.join(WD,"_pipeline","moss_imagery.log")
NEG="nsfw, worst quality, low quality, watermark, signature, text, letters, logo, typography, blurry, deformed, clutter, people"
JOBS=[
 dict(name="bg-abstract", sub="background", w=1536,h=864,seed=20261201,
   prompt="Minimal abstract gradient background, calm cobalt blue and cool slate white, soft light, gentle mist, clean modern tech brand aesthetic, generous negative space, no objects, no text, high quality"),
 dict(name="bg-grid", sub="background", w=1536,h=864,seed=20261202,
   prompt="Clean minimal background for a productivity app, soft blue radial light on a cool off-white surface, faint geometry, flat and calm, lots of empty space, no text, high quality"),
 dict(name="illus-focus", sub="illustration", w=1024,h=1024,seed=20261203,
   prompt="Flat vector illustration of a calm tidy desk with a single notebook, a pen and a small checklist, cobalt blue and slate palette, minimal geometric shapes, soft shadows, white background, no text, high quality"),
 dict(name="illus-plan", sub="illustration", w=1024,h=1024,seed=20261204,
   prompt="Flat vector illustration of an ordered week planner and sticky notes, calm blue tones, minimal clean geometric style, soft light, white background, no text, high quality"),
 dict(name="merch-notebook-stack", sub="merch", w=1024,h=1024,seed=20261205,
   prompt="Top-down product photo of a stack of plain notebooks with a solid cobalt blue cover and a slate grey cover, on a light neutral desk, soft daylight, minimal, clean, no text, no logos, high quality"),
 dict(name="merch-notebook-open", sub="merch", w=1536,h=864,seed=20261206,
   prompt="Product photo of an open blank notebook with a blue ribbon bookmark on a light wooden desk, a pen beside it, soft morning light, minimal calm workspace, no text, no logos, high quality"),
 dict(name="merch-mug", sub="merch", w=1024,h=1024,seed=20261207,
   prompt="Product photo of a plain white ceramic mug on a light desk, subtle cobalt blue accent, soft daylight, minimal clean product photography, ample negative space, no text, no logos, high quality"),
]
def log(m):
    l=time.strftime("%H:%M:%S ")+m; print(l,flush=True); open(LOG,"a",encoding="utf-8").write(l+"\n")
def submit(j):
    wf=json.load(open(WF)); wf["4"]["inputs"]["text"]=j["prompt"]; wf["5"]["inputs"]["text"]=NEG
    wf["6"]["inputs"]["width"]=j["w"]; wf["6"]["inputs"]["height"]=j["h"]; wf["7"]["inputs"]["seed"]=j["seed"]
    wf["9"]["inputs"]["filename_prefix"]="heyta_"+j["name"]
    data=json.dumps({"prompt":wf,"client_id":"heyta-brand"}).encode()
    req=urllib.request.Request(COMFY+"/prompt",data=data,headers={"Content-Type":"application/json"})
    pid=json.load(urllib.request.urlopen(req,timeout=60)).get("prompt_id"); log(f"submit {j['name']} {pid}")
    t0=time.time()
    while time.time()-t0<4*3600:
        time.sleep(20)
        try: h=json.load(urllib.request.urlopen(f"{COMFY}/history/{pid}",timeout=15))
        except Exception: continue
        if pid in h:
            imgs=[im for o in h[pid].get("outputs",{}).values() for im in o.get("images",[])]
            if imgs:
                src=os.path.join(OUTDIR,imgs[0]["filename"]); sub=os.path.join(IM,j["sub"]); os.makedirs(sub,exist_ok=True)
                dst=os.path.join(sub,j["name"]+".png")
                for _ in range(40):
                    if os.path.exists(src) and os.path.getsize(src)>1000: break
                    time.sleep(1)
                shutil.copy2(src,dst); log(f"DONE {j['name']} {time.time()-t0:.0f}s"); return True
    log("TIMEOUT "+j["name"]); return False
def assemble():
    from PIL import Image, ImageDraw, ImageFont
    rows=[]
    for sub in ("background","illustration","merch"):
        d=os.path.join(IM,sub)
        if not os.path.isdir(d): continue
        for fn in sorted(os.listdir(d)):
            if fn.lower().endswith((".png",".jpg")): rows.append((sub,fn,os.path.join(d,fn)))
    if not rows: return
    cw,ch,pad=420,300,18; cols=3; rr=(len(rows)+cols-1)//cols
    W=cols*cw+pad*(cols+1); H=rr*ch+pad*(rr+1)+70
    sheet=Image.new("RGB",(W,H),"#F8FAFC")
    def ft(sz):
        for pp in ["/System/Library/Fonts/STHeiti Medium.ttc","/System/Library/Fonts/Hiragino Sans GB.ttc"]:
            if os.path.exists(pp):
                try: return ImageFont.truetype(pp,sz)
                except: pass
        return ImageFont.load_default()
    for i,(sub,fn,p) in enumerate(rows):
        r,c=divmod(i,cols); im=Image.open(p).convert("RGB"); im.thumbnail((cw,ch))
        sheet.paste(im,(pad+c*(cw+pad)+(cw-im.width)//2,70+pad+r*(ch+pad)+(ch-im.height)//2))
    d=ImageDraw.Draw(sheet); d.text((pad,24),"heyta · 04-imagery（本地 MOSS-Image 生成）",font=ft(28),fill="#0f172a")
    sheet.save(os.path.join(IM,"contact-sheet.png"))
    json.dump({"source":"local ComfyUI / MOSS-Image","items":[{"sub":s,"file":fn,"path":f"04-imagery/{s}/{fn}"} for s,fn,_ in rows]},
              open(os.path.join(IM,"_manifest_main.json"),"w",encoding="utf-8"), ensure_ascii=False, indent=2)
    print("contact sheet:", len(rows), "images")
if __name__=="__main__":
    for _ in range(120):
        try: urllib.request.urlopen(COMFY+"/system_stats",timeout=3); break
        except Exception: time.sleep(2)
    for j in JOBS:
        try: submit(j)
        except Exception as e: log("ERR "+j["name"]+" "+repr(e))
    assemble(); log("ALL DONE")
