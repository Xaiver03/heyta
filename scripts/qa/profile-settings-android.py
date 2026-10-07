#!/usr/bin/env python3
"""Offline Android Profile/Settings journey; inspect fresh UI after every action."""
import argparse,os,subprocess,time,re,json,hashlib
from pathlib import Path
from xml.etree import ElementTree as ET
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--serial', default=os.environ.get('ANDROID_SERIAL','emulator-5554'))
parser.add_argument('--evidence-dir', type=Path, default=Path(__file__).resolve().parents[2]/'apps/mobile/evidence/profile-center/android')
args=parser.parse_args()
out=args.evidence_dir
out.mkdir(parents=True,exist_ok=True)
records=[]
serial=args.serial
def adb(*args):
 return subprocess.run(['adb','-s',serial,*args],capture_output=True,timeout=25,check=True).stdout

def tree():
 for _ in range(4):
  result=subprocess.run(['adb','-s',serial,'shell','uiautomator','dump','/sdcard/heyta-profile.xml'],capture_output=True,timeout=25)
  if result.returncode == 0:
   return ET.fromstring(adb('exec-out','cat','/sdcard/heyta-profile.xml'))
  # Android occasionally leaves a dead uiautomator helper after a cold RN
  # restart.  A short retry is safer than treating that transport blip as an
  # IA failure.
  time.sleep(1)
 raise RuntimeError(f'uiautomator dump failed: {result.returncode}: {result.stderr!r}')
def texts(root):return [n.get('text') or n.get('content-desc') for n in root.iter('node') if n.get('text') or n.get('content-desc')]
def find(root,label):
 for n in root.iter('node'):
  v=n.get('content-desc') or n.get('text') or ''
  if v==label or v.startswith(label+',') or v.startswith(label+'，'):return n
 return None

def find_pressable(root,label):
 for n in root.iter('node'):
  if n.get('clickable') != 'true': continue
  v=n.get('content-desc') or n.get('text') or ''
  if v==label or v.startswith(label+',') or v.startswith(label+'，'):return n
 return None

def wait(label,absent=None):
 for _ in range(5):
  r=tree()
  if find(r,label) is not None and (absent is None or find(r,absent) is None):return r
  time.sleep(.4)
 raise AssertionError((label,texts(r)))

def tap(label,after,absent=None):
 r=wait(label);n=find(r,label)
 if find_pressable(r,label) is not None: n=find_pressable(r,label)
 if n is None: raise AssertionError(('pressable target',label,texts(r)))
 time.sleep(.5)
 x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
 adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
 r=wait(after,absent);records.append({'action':label,'destination':after,'labels':texts(r)})
 print(label,'=>',after,flush=True)

def back(after,absent=None):
 time.sleep(.5)
 adb('shell','input','keyevent','4');r=wait(after,absent)
 records.append({'action':'hardwareBack','destination':after,'labels':texts(r)})
 print('BACK =>',after,flush=True)

def shot(name): (out/f'{name}.png').write_bytes(adb('exec-out','screencap','-p'))
def artifact_identity():
 apk=Path(__file__).resolve().parents[2]/'apps/mobile/android/app/build/outputs/apk/release/app-release.apk'
 expected=hashlib.sha256(apk.read_bytes()).hexdigest()
 installed=adb('shell','pm','path','com.heyta').decode().strip().removeprefix('package:')
 actual=adb('shell','sha256sum',installed).decode().split()[0]
 if actual != expected:raise AssertionError(f'Installed APK differs from current build: {actual} != {expected}')
 return {'sha256':actual,'apk':str(apk.relative_to(Path(__file__).resolve().parents[2]))}

def scroll_to(label):
 for _ in range(5):
  r=tree()
  if find(r,label) is not None:return
  bounds=list(map(int,re.findall(r'\d+',next(r.iter('node')).get('bounds'))))
  _,_,width,height=bounds
  adb('shell','input','swipe',str(width//2),str(height*3//4),str(width//2),str(height//3),'350')
  time.sleep(.4)
 raise AssertionError(('scroll target',label,texts(r)))
try:
 identity=artifact_identity()
 adb('shell','am','force-stop','com.heyta')
 adb('shell','am','start','-W','-n','com.heyta/com.heytamobile.MainActivity')
 time.sleep(2.0)
 r=tree()
 if find(r,'只用本机') is not None:tap('只用本机','先离线使用','在使用联网功能之前')
 r=tree()
 if find(r,'先离线使用') is not None:tap('先离线使用','我的','在使用联网功能之前')
 tap('我的','设置');shot('my')
 tap('设置','常规');shot('settings-directory')
 tap('常规','语言');shot('general')
 back('偏好与账号','语言')
 tap('同步与隐私','隐私同意');shot('sync')
 back('偏好与账号','隐私同意')
 tap('数据管理','导出数据')
 tap('导出数据','返回','数据管理');shot('export')
 tap('返回','数据管理','偏好与账号');shot('returned-data-group')
 back('偏好与账号','导出数据');shot('settings-directory-after-data')
 back('近期状态','偏好与账号');shot('returned-profile')
 tap('查看完整成长','我的成长');shot('growth')
 back('设置')
 scroll_to('近期状态')
 shot('returned-profile')
 scroll_to('清单')
 tap('清单','返回','整理与记录');shot('lists')
 back('整理与记录');shot('returned-profile-after-lists')
 artifact_identity()
 (out/'journey.json').write_text(json.dumps({'status':'passed','artifact':identity,'steps':records},ensure_ascii=False,indent=2))
except Exception as e:
 (out/'journey.json').write_text(json.dumps({'status':'failed','error':str(e),'steps':records},ensure_ascii=False,indent=2))
 raise
