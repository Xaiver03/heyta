#!/usr/bin/env python3
"""Offline Android Profile/Settings journey; inspect fresh UI after every action."""
import argparse,os,subprocess,time,re,json,hashlib
from pathlib import Path
from xml.etree import ElementTree as ET
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--serial', default=os.environ.get('ANDROID_SERIAL','emulator-5554'))
parser.add_argument('--timeout', type=float, default=12.0, help='seconds to wait for each UI state')
parser.add_argument('--evidence-dir', type=Path, default=Path(__file__).resolve().parents[2]/'apps/mobile/evidence/profile-center/android')
args=parser.parse_args()
out=args.evidence_dir
out.mkdir(parents=True,exist_ok=True)
records=[]
serial=args.serial
timeout=args.timeout
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
def is_visible(node):return node.get('visible-to-user','true') == 'true'
def texts(root):return [n.get('text') or n.get('content-desc') for n in root.iter('node') if is_visible(n) and (n.get('text') or n.get('content-desc'))]
def find(root,label):
 for n in root.iter('node'):
  if not is_visible(n):continue
  v=n.get('content-desc') or n.get('text') or ''
 if v==label or v.startswith(label+',') or v.startswith(label+'，'):return n
 return None

def find_exact(root,label):
 for n in root.iter('node'):
  if is_visible(n) and (n.get('content-desc') or n.get('text') or '') == label:return n
 return None

def find_resource(root, resource_id):
 for n in root.iter('node'):
  if not is_visible(n):continue
  if n.get('resource-id') == resource_id:return n
 return None

def find_pressable(root,label):
 for n in root.iter('node'):
  if not is_visible(n):continue
  if n.get('clickable') != 'true': continue
  v=n.get('content-desc') or n.get('text') or ''
  if v==label or v.startswith(label+',') or v.startswith(label+'，'):return n
 return None

def node_bounds(node):
 values=list(map(int,re.findall(r'\d+',node.get('bounds',''))))
 if len(values) != 4:raise AssertionError(('node bounds',node.attrib))
 return tuple(values)

def bounds_record(node):
 b=node_bounds(node)
 return {'raw':node.get('bounds'),'left':b[0],'top':b[1],'right':b[2],'bottom':b[3]}

def node_record(node):
 return {'text':node.get('text'),'contentDescription':node.get('content-desc'),'resourceId':node.get('resource-id'),'class':node.get('class'),'clickable':node.get('clickable'),'visibleToUser':node.get('visible-to-user'),'bounds':bounds_record(node)}

def countdown_entry(root):
 resource=find_resource(root,'profile-entry-countdown')
 if resource is not None and resource.get('clickable') == 'true':return resource
 pressable=find_pressable(root,'倒数纪念日')
 if pressable is not None:return pressable
 if resource is not None:raise AssertionError(('countdown resource is not clickable',node_record(resource)))
 raise AssertionError(('countdown pressable',texts(root)))

def tab_label(node):
 value=node.get('content-desc') or node.get('text') or ''
 for label in ('任务','日历','专注','分类','我的'):
  if value==label or value.startswith(label+',') or value.startswith(label+'，'):return label
 return None

def profile_geometry(root):
 entry=countdown_entry(root)
 tabs=[]
 seen=set()
 for n in root.iter('node'):
  if not is_visible(n) or n.get('clickable') != 'true':continue
  label=tab_label(n)
  if label is None:continue
  b=node_bounds(n)
  key=(label,b,n.get('resource-id'))
  if key in seen:continue
  seen.add(key)
  tabs.append({'label':label,'node':node_record(n)})
 labels={item['label'] for item in tabs}
 missing=sorted({'任务','日历','专注','分类','我的'}-labels)
 if missing:raise AssertionError(('bottom tab nodes missing',missing,[item['node'] for item in tabs]))
 tab_top=min(item['node']['bounds']['top'] for item in tabs)
 tab_bottom=max(item['node']['bounds']['bottom'] for item in tabs)
 entry_bounds=bounds_record(entry)
 return {'entry':{'label':'倒数纪念日','node':node_record(entry)},'tabBar':{'nodes':tabs,'top':tab_top,'bottom':tab_bottom},'entryBottomAboveTabTop':entry_bounds['bottom'] <= tab_top,'entryBottomStrictlyAboveTabTop':entry_bounds['bottom'] < tab_top}

def tap_node(node,action,after,absent=None,resource=None):
 time.sleep(.5)
 x1,y1,x2,y2=node_bounds(node)
 adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
 r=wait(after,absent,resource);records.append({'action':action,'destination':after,'labels':texts(r)})
 print(action,'=>',after,flush=True)

def wait(label,absent=None,resource=None):
 deadline=time.monotonic()+timeout
 while time.monotonic() < deadline:
  r=tree()
  if find(r,label) is not None and (resource is None or find_resource(r,resource) is not None) and (absent is None or find(r,absent) is None):return r
  time.sleep(.4)
 raise AssertionError((label,texts(r)))

def tap(label,after,absent=None,resource=None):
 r=wait(label);n=find(r,label)
 if find_pressable(r,label) is not None: n=find_pressable(r,label)
 if n is None: raise AssertionError(('pressable target',label,texts(r)))
 time.sleep(.5)
 x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
 adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
 r=wait(after,absent,resource);records.append({'action':label,'destination':after,'labels':texts(r)})
 print(label,'=>',after,flush=True)

def back(after,absent=None,resource=None):
 time.sleep(.5)
 adb('shell','input','keyevent','4');r=wait(after,absent,resource)
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
 deadline=time.monotonic()+timeout
 while time.monotonic() < deadline:
  r=tree()
  if find(r,label) is not None:return
  bounds=list(map(int,re.findall(r'\d+',next(r.iter('node')).get('bounds'))))
  _,_,width,height=bounds
  adb('shell','input','swipe',str(width//2),str(height*3//4),str(width//2),str(height//3),'350')
  time.sleep(.4)
 raise AssertionError(('scroll target',label,texts(r)))
geometry=None
try:
 identity=artifact_identity()
 adb('shell','am','force-stop','com.heyta')
 adb('shell','am','start','-W','-n','com.heyta/com.heytamobile.MainActivity')
 time.sleep(2.0)
 r=tree()
 if find(r,'只用本机') is not None:tap('只用本机','先离线使用','在使用联网功能之前')
 r=tree()
 if find(r,'先离线使用') is not None:tap('先离线使用','我的','在使用联网功能之前')
 # The current tab is already “我的”; this tap is an explicit assertion that
 # the profile surface is reachable before entering its settings row below.
 if find_pressable(r,'设置') is None:
  tap('我的','设置')
 shot('my')
 tap('设置','常规',resource='settings-section-general');shot('settings-directory')
 tap('常规','语言');shot('general')
 back('偏好与账号','语言',resource='settings-directory')
 tap('同步与隐私','隐私同意',resource='settings-sheet');shot('sync')
 back('偏好与账号','隐私同意',resource='settings-directory')
 tap('数据管理','导出数据',resource='settings-sheet')
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
 # Returning from the list child resets the retained Profile scroll position
 # to the top, so the tools section heading is intentionally offscreen. Assert
 # the Profile surface itself and make sure the child title is gone.
 back('我的','清单');shot('returned-profile-after-lists')
 scroll_to('倒数纪念日')
 r=tree()
 geometry_before_nudge=profile_geometry(r)
 records.append({'action':'countdownGeometryBeforeNudge','geometry':geometry_before_nudge})
 entry_before_nudge=countdown_entry(r)
 x1,y1,x2,y2=node_bounds(entry_before_nudge)
 adb('shell','input','swipe',str((x1+x2)//2),str((y1+y2)//2),str((x1+x2)//2),str(max(y1+80,(y1+y2)//2-320)),'450')
 time.sleep(.7)
 r=tree()
 geometry=profile_geometry(r)
 title_node=find_exact(r,'倒数纪念日')
 subtitle_node=find_exact(r,'记下要盯的日子，看它还有几天')
 if title_node is None or subtitle_node is None:
  raise AssertionError(('countdown entry text not fully visible after nudge',texts(r)))
 geometry['visibleTitle']=bounds_record(title_node)
 geometry['visibleSubtitle']=bounds_record(subtitle_node)
 records.append({'action':'countdownGeometryCentered','geometry':geometry})
 shot('countdown-centered')
 if not geometry['entryBottomStrictlyAboveTabTop']:
  raise AssertionError(('countdown entry is not strictly above bottom tab bar',geometry))
 entry=countdown_entry(r)
 tap_node(entry,'倒数纪念日','倒数纪念日')
 destination=tree()
 countdown_resource_seen=find_resource(destination,'countdown-view') is not None
 records.append({'action':'countdownDestination','title':'倒数纪念日','countdownResourcePresent':countdown_resource_seen,'labels':texts(destination)})
 time.sleep(.5)
 adb('shell','input','keyevent','4')
 back_result=wait('我的')
 if countdown_resource_seen and find_resource(back_result,'countdown-view') is not None:
  raise AssertionError(('countdown screen still present after back',texts(back_result)))
 records.append({'action':'hardwareBack','destination':'我的','labels':texts(back_result)})
 print('BACK => 我的',flush=True)
 artifact_identity()
 (out/'journey.json').write_text(json.dumps({'status':'passed','artifact':identity,'geometry':geometry,'steps':records},ensure_ascii=False,indent=2))
except Exception as e:
 (out/'journey.json').write_text(json.dumps({'status':'failed','error':str(e),'artifact':identity if 'identity' in locals() else None,'geometry':geometry,'steps':records},ensure_ascii=False,indent=2))
 raise
