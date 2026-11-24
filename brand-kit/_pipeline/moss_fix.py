# -*- coding: utf-8 -*-
"""重生成 illus-plan（原图含 AI 乱码文字），单独跑，完成后覆盖并重建联系表"""
import os, json, time, shutil, urllib.request
WD=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMFY="http://127.0.0.1:8188"; WF="/Volumes/RocaSSD/comfyui/workflows/moss_api_test.json"
OUTD="/Volumes/RocaSSD/comfyui/ComfyUI/output"; DST=os.path.join(WD,"04-imagery","illustration")
LOG=os.path.join(WD,"_pipeline","moss_fix.log")
def log(m):
    l=time.strftime("%H:%M:%S ")+m; print(l,flush=True); open(LOG,"a",encoding="utf-8").write(l+"\n")
NEG=("text, letters, numbers, words, typography, label, caption, watermark, signature, logo, calendar grid, "
     "nsfw, worst quality, low quality, blurry, deformed, clutter")
JOB=dict(name="illus-plan", w=1024,h=1024,seed=20261244,
  prompt=("Flat vector illustration of a calm weekly planning scene: a folded paper planner, three small blank sticky notes, "
          "a pen and a cup, cobalt blue and slate grey palette, minimal geometric shapes, soft shadows, plain white background, "
          "absolutely no writing or letters on any surface, clean and quiet, high quality"))
for _ in range(120):
    try: urllib.request.urlopen(COMFY+"/system_stats",timeout=3); break
    except Exception: time.sleep(2)
wf=json.load(open(WF)); wf["4"]["inputs"]["text"]=JOB["prompt"]; wf["5"]["inputs"]["text"]=NEG
wf["6"]["inputs"]["width"]=JOB["w"]; wf["6"]["inputs"]["height"]=JOB["h"]; wf["7"]["inputs"]["seed"]=JOB["seed"]
wf["9"]["inputs"]["filename_prefix"]="heyta_fix_illusplan"
data=json.dumps({"prompt":wf,"client_id":"heyta-fix"}).encode()
req=urllib.request.Request(COMFY+"/prompt",data=data,headers={"Content-Type":"application/json"})
pid=json.load(urllib.request.urlopen(req,timeout=60)).get("prompt_id"); log("submit "+pid)
t0=time.time()
while time.time()-t0<4*3600:
    time.sleep(20)
    try: h=json.load(urllib.request.urlopen(f"{COMFY}/history/{pid}",timeout=15))
    except Exception: continue
    if pid in h:
        imgs=[im for o in h[pid].get("outputs",{}).values() for im in o.get("images",[])]
        if imgs:
            src=os.path.join(OUTD,imgs[0]["filename"]); dst=os.path.join(DST,"illus-plan.png")
            for _ in range(40):
                if os.path.exists(src) and os.path.getsize(src)>1000: break
                time.sleep(1)
            shutil.copy2(src,dst); log("DONE %.0fs"%(time.time()-t0)); break
# 重建联系表
import importlib.util
spec=importlib.util.spec_from_file_location("mb",os.path.join(WD,"_pipeline","moss_batch.py"))
mb=importlib.util.module_from_spec(spec); spec.loader.exec_module(mb)
mb.assemble(); log("sheet rebuilt")
