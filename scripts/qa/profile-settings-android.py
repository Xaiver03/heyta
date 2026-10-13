#!/usr/bin/env python3
"""Offline Android Profile/Settings journey; inspect fresh UI after every action."""
import argparse,os,subprocess,time,re,json,hashlib
from pathlib import Path
from xml.etree import ElementTree as ET
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--serial', default=os.environ.get('ANDROID_SERIAL','emulator-5554'))
parser.add_argument('--timeout', type=float, default=12.0, help='seconds to wait for each UI state')
parser.add_argument('--adb-timeout', type=float, default=45.0, help='seconds to wait for each adb call')
parser.add_argument('--evidence-dir', type=Path, default=Path(__file__).resolve().parents[2]/'apps/mobile/evidence/profile-center/android')
# 说明走注释而不是走 help= 字符串：`check-locator-labels.py` 把这五枚脚本里的中文
# 字面量当成"界面标签"去词条真源对账，CLI 帮助不是界面文案（同目录的
# profile-settings-ios.py 的 help= 也一律是英文）。
parser.add_argument('--in-app-language', choices=['en'], default=None, help='drive the whole journey in English through the app\'s own language switch (Settings > General > Language); does not touch the device locale')
parser.add_argument('--apk', type=Path, default=None, help='APK file the installed artifact must match byte-for-byte; defaults to this repo\'s release output, point it at another tree when the device was flashed from an isolated carrier')
args=parser.parse_args()
out=args.evidence_dir
out.mkdir(parents=True,exist_ok=True)
records=[]
serial=args.serial
timeout=args.timeout
adb_timeout=args.adb_timeout
english=False
def T(zh,en): return en if english else zh
# The labels live in `packages/i18n`; the emulator's system locale decides which
# column the app renders, so every locator has to carry both.
def countdown_label(): return T('倒数纪念日','Countdowns')
def tab_labels(): return (T('任务','Tasks'),T('日历','Calendar'),T('专注','Focus'),T('分类','Categories'),T('我的','Profile'))
def adb(*args):
 return subprocess.run(['adb','-s',serial,*args],capture_output=True,timeout=adb_timeout,check=True).stdout

def tree():
 for _ in range(4):
  result=subprocess.run(['adb','-s',serial,'shell','uiautomator','dump','/sdcard/heyta-profile.xml'],capture_output=True,timeout=adb_timeout)
  if result.returncode == 0:
   return ET.fromstring(adb('exec-out','cat','/sdcard/heyta-profile.xml'))
  # Android occasionally leaves a dead uiautomator helper after a cold RN
  # restart.  A short retry is safer than treating that transport blip as an
  # IA failure.
  time.sleep(1)
 raise RuntimeError(f'uiautomator dump failed: {result.returncode}: {result.stderr!r}')
def is_visible(node):return node.get('visible-to-user','true') == 'true'
def texts(root):return [n.get('text') or n.get('content-desc') for n in root.iter('node') if is_visible(n) and (n.get('text') or n.get('content-desc'))]

def app_tree():
 """Wait until a dump actually belongs to com.heyta.

 `am start -W` returns when the activity is *displayed*, not when its view tree
 is on screen, so the first dump can still be the launcher. Asserting ownership
 here is what stops a launch race from being recorded as an IA failure —
 observed 2026-10-09 on a saturated host: the journey died on
 ['At a glance', 'Gmail', 'Photos', ...] while the app was still starting.
 """
 deadline=time.monotonic()+timeout
 last=set()
 while time.monotonic() < deadline:
  r=tree()
  last={n.get('package') for n in r.iter('node') if n.get('package')}
  if 'com.heyta' in last:return r
  time.sleep(.4)
 raise AssertionError(('no com.heyta window in dump; foreground packages were',sorted(last)))

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
 pressable=find_pressable(root,countdown_label())
 if pressable is not None:return pressable
 if resource is not None:raise AssertionError(('countdown resource is not clickable',node_record(resource)))
 raise AssertionError(('countdown pressable',texts(root)))

def tab_label(node):
 value=node.get('content-desc') or node.get('text') or ''
 for label in tab_labels():
  if value==label or value.startswith(label+',') or value.startswith(label+'，'):return label
 return None

def tab_band_top(root):
 # The bottom tab bar is the region a content gesture must never be aimed into: a swipe or tap
 # starting inside it is consumed by the bar, so the surface does not move and the target stays
 # clipped.  None means "this screen has no tab bar" (a child page), where the check is skipped.
 tops=[node_bounds(n)[1] for n in root.iter('node') if n.get('clickable')=='true' and tab_label(n)]
 return min(tops) if tops else None

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
 missing=sorted(set(tab_labels())-labels)
 if missing:raise AssertionError(('bottom tab nodes missing',missing,[item['node'] for item in tabs]))
 tab_top=min(item['node']['bounds']['top'] for item in tabs)
 tab_bottom=max(item['node']['bounds']['bottom'] for item in tabs)
 entry_bounds=bounds_record(entry)
 return {'entry':{'label':countdown_label(),'node':node_record(entry)},'tabBar':{'nodes':tabs,'top':tab_top,'bottom':tab_bottom},'entryBottomAboveTabTop':entry_bounds['bottom'] <= tab_top,'entryBottomStrictlyAboveTabTop':entry_bounds['bottom'] < tab_top}

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

def wait_resource_only(resource_id):
 deadline=time.monotonic()+timeout
 while time.monotonic() < deadline:
  r=tree()
  if find_resource(r,resource_id) is not None:return r
  time.sleep(.4)
 raise AssertionError((resource_id,texts(r)))

def tap(label,after,absent=None,resource=None):
 r=wait(label);n=find(r,label)
 if find_pressable(r,label) is not None: n=find_pressable(r,label)
 if n is None: raise AssertionError(('pressable target',label,texts(r)))
 time.sleep(.5)
 x1,y1,x2,y2=node_bounds(n)
 band_top=tab_band_top(r)
 # A row clipped below the fold still carries its label in the accessibility tree, so "found it"
 # is not "can be pressed".  Tapping such a node hands the gesture to whatever is really at those
 # coordinates — usually the bottom tab bar — and the next wait then reads as "the app has no such
 # screen" instead of "the probe aimed outside the content surface".
 if y2<=y1 or (band_top is not None and (y1+y2)//2>=band_top):
  raise AssertionError(('tap target is not on the visible content surface',label,{'bounds':[x1,y1,x2,y2],'tabBandTop':band_top}))
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
 # The APK that actually produced what is on the device may live in another tree (an isolated
 # carrier is how this line builds "only committed content" readings).  Point --apk at it; the
 # guard itself is unchanged — it still refuses to record a journey over a mismatched artifact.
 apk=args.apk or Path(__file__).resolve().parents[2]/'apps/mobile/android/app/build/outputs/apk/release/app-release.apk'
 apk=apk.resolve()
 expected=hashlib.sha256(apk.read_bytes()).hexdigest()
 installed=adb('shell','pm','path','com.heyta').decode().strip().removeprefix('package:')
 actual=adb('shell','sha256sum',installed).decode().split()[0]
 if actual != expected:raise AssertionError(f'Installed APK differs from current build: {actual} != {expected}')
 repo=Path(__file__).resolve().parents[2]
 return {'sha256':actual,'apk':str(apk.relative_to(repo)) if apk.is_relative_to(repo) else str(apk)}

def scroll_to(label):
 # "The label is in the tree" is not "the row can be reached": a row clipped below the fold keeps
 # its content-desc, so the old loop returned on the first dump without ever scrolling and every
 # gesture after it was aimed at a rectangle that is not on screen.
 deadline=time.monotonic()+timeout
 seen=None
 while time.monotonic() < deadline:
  r=tree()
  band_top=tab_band_top(r)
  n=find(r,label)
  if n is not None:
   x1,y1,x2,y2=node_bounds(n)
   seen=[x1,y1,x2,y2]
   if y2>y1 and (band_top is None or y2<=band_top):return
  _,_,width,height=node_bounds(next(r.iter('node')))
  start=band_top-260 if band_top is not None else height*3//4
  adb('shell','input','swipe',str(width//2),str(max(start,height//2)),str(width//2),str(height//3),'350')
  time.sleep(.4)
 raise AssertionError(('scroll target',label,{'lastTargetBounds':seen,'tabBandTop':band_top,'texts':texts(r)}))
geometry=None
try:
 identity=artifact_identity()
 adb('shell','am','force-stop','com.heyta')
 adb('shell','am','start','-W','-n','com.heyta/com.heytamobile.MainActivity')
 time.sleep(2.0)
 r=app_tree()
 # First launch can show consent before the bottom tabs exist. Detect the
 # language from each supported initial surface, not only the Profile tab.
 english = any(find(r,label) is not None for label in (
  'Profile','Before any network feature runs','Use offline for now',
 ))
 if find(r,T('只用本机','This device only')) is not None:tap(T('只用本机','This device only'),T('先离线使用','Use offline for now'),T('在使用联网功能之前','Before any network feature runs'))
 else:records.append({'action':'skip:consent-sheet-not-on-first-screen','destination':None,'labels':texts(r),'uiLocale':'en' if english else 'zh-CN'})
 r=tree()
 if find(r,T('先离线使用','Use offline for now')) is not None:tap(T('先离线使用','Use offline for now'),T('我的','Profile'),T('在使用联网功能之前','Before any network feature runs'))
 else:records.append({'action':'skip:welcome-offline-not-on-first-screen','destination':None,'labels':texts(r),'uiLocale':'en' if english else 'zh-CN'})
 r=tree()
 # The current tab is already “我的”; this tap is an explicit assertion that
 # the profile surface is reachable before entering its settings row below.
 if find_resource(r,'profile-entry-settings') is None:
  # `elem or other` 在 ElementTree 上不是"取第一个存在的节点"：`bool(node)` 今天取决于
  # **它有没有子节点**，一枚没有子的 `我的` 会被判成假 ⇒ 静默退到不可点的那一枚，
  # 而 Python 3.12+ 又宣布它恒为真（实测本脚本每跑一趟就吐一条 DeprecationWarning）。
  # 同一枚脚本在两种解释器下有两种含义，所以这里只按 `is not None` 显式判。
  tab=find_pressable(r,T('我的','Profile'))
  if tab is None:tab=find(r,T('我的','Profile'))
  if tab is None:raise AssertionError(('profile tab',texts(r)))
  x1,y1,x2,y2=node_bounds(tab)
  adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
  r=wait_resource_only('profile-entry-settings')
  records.append({'action':T('我的','Profile'),'destination':T('设置','Settings'),'labels':texts(r)})
  print(f"{T('我的','Profile')} => {T('设置','Settings')}",flush=True)
 shot('my')
 tap(T('设置','Settings'),T('常规','General'),resource='settings-section-general');shot('settings-directory')
 tap(T('常规','General'),T('语言','Language'));shot('general')
 # 产品的语言开关**会持久**（原生存一份设备偏好，冷启动恢复；10-13 实测：force-stop 后
 # `am start -W` 起来仍是英文，而设备语言是 zh-Hans-CN）。所以这一支**必须在末尾改回中文**，
 # 否则会把共享模拟器留给下一趟英文界面。开关不开时这一整块跳过，原有行为逐字不变。
 if args.in_app_language=='en':
  # 🔴 这一支原来无条件 `tap('English','Language',absent=T('语言','Language'))`。当运行时的
  #   语言检测（上面第 202 行那格）已经判定 english=True 时，`after` 与 `absent` 变成**同一枚串**
  #   ⇒ 条件恒不满足 ⇒ 第二次跑必红。它以前从不现形，是因为这枚开关被当成"只在本会话内生效"
  #   —— 而 10-13 实测它是持久的（冷启动后仍是英文），所以"上一趟留下英文态"这条路真实存在。
  if english:
   records.append({'action':'language already english','destination':'Language','labels':texts(tree())})
   print('Language => already-English (the switch persists; restored at the end of this run)',flush=True)
  else:
   tap('English','Language',absent='语言')
   english=True
  shot('language-panel-en')
 back(T('偏好与账号','Preferences and account'),T('语言','Language'),resource='settings-directory')
 tap(T('同步与隐私','Sync and privacy'),T('隐私同意','Privacy consent'),resource='settings-sheet');shot('sync')
 back(T('偏好与账号','Preferences and account'),T('隐私同意','Privacy consent'),resource='settings-directory')
 tap(T('数据管理','Data management'),T('备份与迁移','Backup & migration'),resource='settings-sheet')
 tap(T('备份与迁移','Backup & migration'),T('返回','Back'),T('数据管理','Data management'));shot('export')
 tap(T('返回','Back'),T('数据管理','Data management'),T('偏好与账号','Preferences and account'));shot('returned-data-group')
 back(T('偏好与账号','Preferences and account'),T('备份与迁移','Backup & migration'));shot('settings-directory-after-data')
 back(T('近期状态','Recent activity'),T('偏好与账号','Preferences and account'));shot('returned-profile')
 tap(T('查看完整成长','View full growth'),T('我的成长','My growth'));shot('growth')
 back(T('设置','Settings'))
 scroll_to(T('近期状态','Recent activity'))
 shot('returned-profile')
 scroll_to(T('清单','Lists'))
 tap(T('清单','Lists'),T('返回','Back'),T('整理与记录','Organize and capture'));shot('lists')
 # Returning from the list child resets the retained Profile scroll position
 # to the top, so the tools section heading is intentionally offscreen. Assert
 # the Profile surface itself and make sure the child title is gone.
 back(T('我的','Profile'),T('清单','Lists'));shot('returned-profile-after-lists')
 scroll_to(countdown_label())
 r=tree()
 geometry_before_nudge=profile_geometry(r)
 records.append({'action':'countdownGeometryBeforeNudge','geometry':geometry_before_nudge})
 entry_before_nudge=countdown_entry(r)
 # The nudge has to start inside the scrollable column, not on the entry itself.  Once the
 # entry sits below the fold its reported centre is already inside the bottom tab band
 # (measured at font_scale 1.3: centre y=2210 inside the 2169-2337 band), so a swipe anchored
 # there is handed to the tab bar, the surface never scrolls, and the assertion further down
 # reports an item a single swipe can reach as an occlusion.
 tab_top=geometry_before_nudge['tabBar']['top']
 width=list(map(int,re.findall(r'\d+',next(tree().iter('node')).get('bounds'))))[2]
 previous=None
 nudge_rounds=0
 for _ in range(3):
  nudge_rounds+=1
  adb('shell','input','swipe',str(width//2),str(tab_top-260),str(width//2),str(520),'450')
  time.sleep(.7)
  r=tree()
  geometry=profile_geometry(r)
  position=geometry['entry']['node']['bounds']
  if previous==(position['top'],position['bottom']):
   raise AssertionError(('countdown nudge did not move the surface',{'rounds':nudge_rounds,'entry':position,'tabTop':tab_top,'entry_before_nudge':node_bounds(entry_before_nudge)}))
  previous=(position['top'],position['bottom'])
  if geometry['entryBottomStrictlyAboveTabTop']:break
 title_node=find_exact(r,countdown_label())
 subtitle_node=find_exact(r,T('记下要盯的日子，看它还有几天','Keep the dates you watch, and see how far off they are'))
 if title_node is None or subtitle_node is None:
  raise AssertionError(('countdown entry text not fully visible after nudge',texts(r)))
 geometry['visibleTitle']=bounds_record(title_node)
 geometry['visibleSubtitle']=bounds_record(subtitle_node)
 geometry['nudgeRounds']=nudge_rounds
 records.append({'action':'countdownGeometryCentered','geometry':geometry})
 shot('countdown-centered')
 if not geometry['entryBottomStrictlyAboveTabTop']:
  raise AssertionError(('countdown entry is not strictly above bottom tab bar',geometry))
 entry=countdown_entry(r)
 tap_node(entry,countdown_label(),countdown_label(),resource='countdown-view')
 destination=wait_resource_only('countdown-view')
 records.append({'action':'countdownDestination','title':countdown_label(),'countdownResourcePresent':True,'labels':texts(destination)})
 time.sleep(.5)
 adb('shell','input','keyevent','4')
 back_result=wait(T('我的','Profile'))
 if find_resource(back_result,'countdown-view') is not None:
  raise AssertionError(('countdown screen still present after back',texts(back_result)))
 records.append({'action':'hardwareBack','destination':T('我的','Profile'),'labels':texts(back_result)})
 print('BACK =>',T('我的','Profile'),flush=True)
 if args.in_app_language=='en':
  # 收尾必须把共享载体恢复成它本来的语言：这枚开关**会持久**（原生存设备偏好、冷启动恢复，
  # 10-13 实测 force-stop + `am start -W` 之后仍是英文），不改回来下一趟（含别的会话）
  # 拿到的就是英文界面。`uiLocale` 不跟着改 —— 它记的是这一趟旅程实际走的语态。
  tap(T('设置','Settings'),T('常规','General'),resource='settings-section-general')
  tap(T('常规','General'),T('语言','Language'))
  tap('中文','语言',absent='Language')
  restored=tree()
  records.append({'action':'restore-device-language','destination':'中文','labels':texts(restored)})
  print('Language => zh restored on the shared carrier',flush=True)
 artifact_identity()
 (out/'journey.json').write_text(json.dumps({'status':'passed','uiLocale':'en' if english else 'zh-CN','artifact':identity,'geometry':geometry,'steps':records},ensure_ascii=False,indent=2))
except Exception as e:
 (out/'journey.json').write_text(json.dumps({'status':'failed','uiLocale':'en' if english else 'zh-CN','error':str(e),'artifact':identity if 'identity' in locals() else None,'geometry':geometry,'steps':records},ensure_ascii=False,indent=2))
 raise
