# W2-2：把 widget extension target 与本地 SwiftPM 包接进 HeytaMobile.xcodeproj
#
# 为什么用 xcodeproj gem 而不是手改 pbxproj：
# pbxproj 里每个对象都有 24 位十六进制 UUID，且存在 6 种互相引用的关系
# （target ↔ configuration list ↔ build configuration ↔ product reference ↔ build file ↔ phase）。
# 手改遗漏一处引用的后果是 **Xcode 打不开工程**，而错误信息只说"工程损坏"。
# gem 负责生成引用一致的 UUID —— 它正是 CocoaPods 自己用的那个库。
require 'xcodeproj'

PROJECT = 'HeytaMobile.xcodeproj'
APP_TARGET = 'HeytaMobile'
EXT_TARGET = 'HeytaWidgetExtension'
PKG_REL_PATH = 'HeytaWidgetCore'
APP_GROUP = 'HeytaMobile'
EXT_GROUP = 'HeytaWidgetExtension'

project = Xcodeproj::Project.open(PROJECT)
# pbxproj 所在目录 —— 所有 `path` 都是相对它的。
PROJECT_DIR = File.expand_path(File.dirname(PROJECT))

# ─────────────────────────────────────────────────────────────────────
# 文件引用的 `path` 该写什么？—— **由 group 决定，不能拍脑袋**
#
# pbxproj 里 `path` 是**相对所属 group 的真实路径**的。而 group 的真实路径
# 取决于它自己有没有 `path`：
#
# | group | 它有 path 吗 | 组内文件引用的 path 该写 |
# |---|---|---|
# | `HeytaMobile` | ❌ 只有 `name` | `HeytaMobile/AppDelegate.swift`（带目录） |
# | `HeytaWidgetExtension` | ✅ `path = HeytaWidgetExtension` | `HeytaWidgetBundle.swift`（裸名） |
#
# 🔴 我在这里**连续错了两次**，方向相反：
#   ① 先写裸名 → `HeytaMobile` 组解析成 `<ios>/HeytaWidgetModule.swift`（不存在）；
#   ② 改成带目录 → `HeytaWidgetExtension` 组解析成 `<ios>/HeytaWidgetExtension/HeytaWidgetExtension/…`（不存在）。
#
# 两次都**不影响 `xcodebuild -list`** —— 它只解析工程结构、不碰文件系统。
# 只有真的编译才会报 "Build input file cannot be found"。
# **这就是"`-list` 通过"不能当成接线完成的证据。**
#
# 所以规则不写死：从 `group.real_path` 反推出相对 SRCROOT 的路径。
def find_on_disk(name)
  # 排除 Pods / 构建产物 / 备份 —— 它们里面有大量同名文件（尤其 Info.plist）。
  hits = Dir.glob(File.join(PROJECT_DIR, '**', name)).reject do |f|
    f.include?('/Pods/') || f.include?('/.build/') || f.include?('/build/') ||
      f.include?('/DerivedData/') || f.include?('.bak')
  end
  # 相对 PROJECT_DIR 的路径
  hits.map { |f| f.sub(PROJECT_DIR + '/', '') }.sort.first
end

def ref_path_for(group, name)
  # ① 文件**真实在哪**（磁盘说了算，不是假设）
  real = find_on_disk(name)
  return name unless real

  # ② 减去 group 自己的基准路径 —— pbxproj 的 `path` 是相对 group 的
  base = group.real_path.to_s
  base_rel = base.start_with?(PROJECT_DIR) ? base[(PROJECT_DIR.length + 1)..].to_s : ''
  if !base_rel.empty? && real.start_with?(base_rel + '/')
    real[(base_rel.length + 1)..]
  else
    real
  end
end
app = project.targets.find { |t| t.name == APP_TARGET }
raise "找不到 target #{APP_TARGET}" unless app

# ─────────────────────────────────────────────────────────────────────
# 1. 本地 SwiftPM 包引用
# ─────────────────────────────────────────────────────────────────────
pkg_ref = project.root_object.package_references.find do |r|
  r.respond_to?(:relative_path) && r.relative_path == PKG_REL_PATH
end

unless pkg_ref
  pkg_ref = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
  pkg_ref.relative_path = PKG_REL_PATH
  pkg_ref.path = PKG_REL_PATH
  project.root_object.package_references << pkg_ref
  puts "＋ 本地 SwiftPM 包引用 #{PKG_REL_PATH}"
else
  puts "＝ 本地 SwiftPM 包引用已存在"
end

# ─────────────────────────────────────────────────────────────────────
# 2. 产品依赖 + Frameworks 阶段的 build file
#
# ⚠️ 两件事都要做：`package_product_dependencies` 只是"这个 target 想用哪个产品"，
#    真正参与链接的是 Frameworks 阶段里的那条 PBXBuildFile（它的 `product_ref`
#    指向那个依赖）。只做前者会**编译通过但链接期找不到符号**。
# ─────────────────────────────────────────────────────────────────────
def link_product(project, target, pkg_ref, product_name)
  dep = target.package_product_dependencies.find { |d| d.product_name == product_name }
  unless dep
    dep = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
    dep.product_name = product_name
    dep.package = pkg_ref
    target.package_product_dependencies << dep
  end

  already = target.frameworks_build_phase.files.any? do |f|
    f.respond_to?(:product_ref) && f.product_ref && f.product_ref.product_name == product_name
  end
  unless already
    bf = project.new(Xcodeproj::Project::Object::PBXBuildFile)
    bf.product_ref = dep
    target.frameworks_build_phase.files << bf
  end
  dep
end

link_product(project, app, pkg_ref, 'HeytaWidgetBridge')
puts '＋ app target 链接 HeytaWidgetBridge（它传递依赖 Core）'

# ─────────────────────────────────────────────────────────────────────
# 3. app target：加两个桥接文件 + entitlements + bundle id
# ─────────────────────────────────────────────────────────────────────
app_group = project.main_group.find_subpath(APP_GROUP, false)
raise "找不到 group #{APP_GROUP}" unless app_group
puts "   app group path = #{app_group.path.inspect}"

# 🔴 `path` 必须是**相对 SRCROOT 的完整路径**，不是裸文件名。
#
# `HeytaMobile` 这个 group **没有 `path`**（它只有 `name`），所以组内文件引用
# 必须自己带上目录前缀 —— 对照 `AppDelegate.swift` 的 `path = HeytaMobile/AppDelegate.swift`。
#
# 第一版我写的是 `new_file('HeytaWidgetModule.swift')` → `path = HeytaWidgetModule.swift`
# → 解析成 `<ios>/HeytaWidgetModule.swift`，**那个文件不存在**。
# 症状是整个 app target 编译失败（"no such file or directory"），
# 而如果只跑 `xcodebuild -list` 是**发现不了**的 —— 它只解析工程结构，不解析文件系统。
%w[HeytaWidgetModule.swift HeytaWidgetModuleBridge.m].each do |name|
  next if app_group.files.any? { |f| f.path == "#{APP_GROUP}/#{name}" }

  rel = ref_path_for(app_group, name)
  file = app_group.new_file(rel)
  file.name = name
  file.path = rel
  app.add_file_references([file])
  puts "＋ app 源文件 #{APP_GROUP}/#{name}"
end

app.build_configurations.each do |config|
  # W2-1：bundle id 从 RN 模板默认值改成真值。
  # ⚠️ 标准做法是 `$(PRODUCT_BUNDLE_IDENTIFIER)` 在 project 级定义、target 级继承，
  #    但这里**直接在 target 级写死** —— 因为这个工程只有一个 app target，
  #    而 extension 的 id 必须**以 app 的 id 为前缀**（前缀不一致时系统
  #    根本不会把扩展认成这个 app 的扩展，症状是"组件库里看不到"）。
  #    两处写死 + 一条能在本机跑的校验（见 verify 脚本）比"继承"更难配错。
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.heyta.mobile'
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = "#{APP_GROUP}/#{APP_GROUP}.entitlements"
end
puts '＋ app：bundle id = com.heyta.mobile，entitlements 已接'

# ─────────────────────────────────────────────────────────────────────
# 4. 扩展 target
# ─────────────────────────────────────────────────────────────────────
ext = project.targets.find { |t| t.name == EXT_TARGET }
unless ext
  # 部署目标 17 —— 交互式组件（`Button(intent:)`）需要 iOS 17。
  # ⚠️ app 的部署目标保持旧值不动：改 app 的最小版本会影响所有老用户，
  #    而组件只在 17+ 上出现是**可接受**的（`supportedFamilies` 之外系统不显示）。
  ext = project.new_target(:app_extension, EXT_TARGET, :ios, '17.0')
  puts "＋ target #{EXT_TARGET}（app-extension，iOS 17.0）"
else
  puts "＝ target #{EXT_TARGET} 已存在"
end

# 扩展的 Swift 源文件
ext_group = project.main_group.find_subpath(EXT_GROUP, false)
ext_group ||= project.main_group.new_group(EXT_GROUP, EXT_GROUP)

ext_swift_rel = ref_path_for(ext_group, 'HeytaWidgetBundle.swift')
swift_file = ext_group.files.find { |f| f.path == ext_swift_rel }
unless swift_file
  swift_file = ext_group.new_file(ext_swift_rel)
  swift_file.name = 'HeytaWidgetBundle.swift'
  swift_file.path = ext_swift_rel
end
ext.add_file_references([swift_file]) unless ext.source_build_phase.files.any? do |f|
  f.file_ref && f.file_ref.path == ext_swift_rel
end
puts '＋ 扩展源文件 HeytaWidgetBundle.swift'

# Info.plist / entitlements **只进 group，不进任何 build phase** ——
# 进了 Resources 阶段的话 Info.plist 会被拷进 bundle 根目录并与系统生成的那份冲突。
%w[Info.plist HeytaWidgetExtension.entitlements].each do |name|
  rel = ref_path_for(ext_group, name)
  next if ext_group.files.any? { |f| f.path == rel }

  f = ext_group.new_file(rel)
  f.name = name
  f.path = rel
end

link_product(project, ext, pkg_ref, 'HeytaWidgetKit')
puts '＋ 扩展链接 HeytaWidgetKit'

ext.build_configurations.each do |config|
  bs = config.build_settings
  bs['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.heyta.mobile.WidgetExtension'
  bs['PRODUCT_NAME'] = '$(TARGET_NAME)'
  bs['INFOPLIST_FILE'] = "#{EXT_GROUP}/Info.plist"
  bs['GENERATE_INFOPLIST_FILE'] = 'NO'
  bs['CODE_SIGN_ENTITLEMENTS'] = "#{EXT_GROUP}/#{EXT_GROUP}.entitlements"
  bs['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  bs['SWIFT_VERSION'] = '6.0'
  bs['TARGETED_DEVICE_FAMILY'] = '1,2'
  bs['SKIP_INSTALL'] = 'YES'
  # 扩展**不能**用只有 app 能用的 API。开着它会在编译期就拦下来，
  # 而不是等到 App Review 或崩溃。
  bs['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  bs['CLANG_ENABLE_MODULES'] = 'YES'
  bs['SWIFT_EMIT_LOC_STRINGS'] = 'YES'
  # ⚠️ 版本号必须与 app **完全一致** —— 用同一对构建变量，改一处就一起改。
  #    写死的话会出现"改了 app 版本、忘了扩展"，而 App Store 校验会直接拒。
  bs['MARKETING_VERSION'] = '1.0'
  bs['CURRENT_PROJECT_VERSION'] = '1'
end
puts '＋ 扩展 build settings 已设（bundle id / Info.plist / entitlements / iOS 17 / Swift 6）'

# ─────────────────────────────────────────────────────────────────────
# 5. 嵌入 + 依赖
#
# ⚠️ 两件事都要：`add_dependency` 决定**构建顺序**，
#    嵌入阶段决定 **.appex 会不会被拷进 app 的 PlugIns/**。
#    只做前者的话，编译能过，但装到设备上组件库里什么都没有 ——
#    因为扩展根本没被打包进去。
# ─────────────────────────────────────────────────────────────────────
EMBED_NAME = 'Embed Foundation Extensions'
embed = app.build_phases.find do |p|
  p.isa == 'PBXCopyFilesBuildPhase' && p.respond_to?(:name) && p.name == EMBED_NAME
end

unless embed
  embed = project.new(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase)
  embed.name = EMBED_NAME
  # 13 = PlugIns。这个数字写错的后果是"扩展被拷到 app 根目录"，
  # 而系统只会在 PlugIns/ 下找它。
  embed.dst_subfolder_spec = '13'
  app.build_phases << embed
  puts "＋ app：新建「#{EMBED_NAME}」阶段"
end

already_embedded = embed.files.any? do |f|
  f.file_ref && f.file_ref.display_name == "#{EXT_TARGET}.appex"
end
unless already_embedded
  bf = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  bf.file_ref = ext.product_reference
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  embed.files << bf
  puts "＋ app：嵌入 #{EXT_TARGET}.appex"
end

unless app.dependencies.any? { |d| d.target == ext }
  app.add_dependency(ext)
  puts '＋ app 依赖扩展（决定构建顺序）'
end

project.save
puts "\n✅ 已保存 #{PROJECT}"

# ─────────────────────────────────────────────────────────────────────
# 5.5 共享 scheme
#
# 🔴 没有自己的 scheme 时，`xcodebuild -list` **会**把这个 target 列出来 ——
#    因为 xcodebuild 会为没有 scheme 的 target **临时合成**一个。
#    但那个合成 scheme **不做 SwiftPM 包解析**，于是：
#
#      $ xcodebuild -scheme HeytaWidgetExtension …
#      error: Unable to resolve module dependency: 'HeytaWidgetKit'
#
#    而同一件事用 `-scheme` 走**共享** scheme 就正常。
#    ⚠️ 这是"`-list` 里有 = 接线完成"的又一个反例：
#    列表里的东西可能是临时合成的，而合成品与真实文件行为不同。
# ─────────────────────────────────────────────────────────────────────
schemes_dir = File.join(PROJECT, 'xcshareddata', 'xcschemes')
FileUtils.mkdir_p(schemes_dir)
scheme_path = File.join(schemes_dir, "#{EXT_TARGET}.xcscheme")

if File.exist?(scheme_path)
  puts "＝ 共享 scheme 已存在"
else
  scheme = Xcodeproj::XCScheme.new
  scheme.add_build_target(ext)
  scheme.set_launch_target(ext)
  scheme.save_as(PROJECT, EXT_TARGET, true)
  puts "＋ 共享 scheme #{EXT_TARGET}.xcscheme（只构建扩展，不含 app）"
end

# ─────────────────────────────────────────────────────────────────────
# 6. 自检：每一个文件引用都必须**真的指向一个存在的文件**
#
# 🔴 上面那两次路径错误，`xcodebuild -list` **一次都没报**。
# 这条自检把"要等到编译 5 分钟后才发现"变成"脚本结束时就发现"。
# 而且它是**会失败的** —— 我特地把 `path` 改错验证过（见账本）。
# ─────────────────────────────────────────────────────────────────────
check = Xcodeproj::Project.open(PROJECT)
missing = []
names = [APP_TARGET, EXT_TARGET]
check.targets.each do |t|
  # 🔴 按**名字**筛，不要拿另一个 project 实例里的对象来 `include?` ——
  #    两个 `Xcodeproj::Project` 实例里的 target 是**不同的对象**，
  #    `include?` 永远 false，于是这条自检**什么都不检查**（它一开始就是这么写的）。
  #    这是本轮第三次踩"不可能失败的检查"，形状是**对象身份比较跨了实例**。
  #    ⚠️ 现在它至少会被一个断言证明非空（见下面的 `checked.zero?`）。
  next unless names.include?(t.name)

  t.source_build_phase.files.each do |bf|
    next unless bf.file_ref
    fp = bf.file_ref.real_path.to_s
    missing << "#{t.name}: #{fp}" unless File.exist?(fp)
  end
end

# 自检自己也必须能被证明"真的检查了东西" —— 一个 0 项的检查等于没有检查。
checked = names.sum do |n|
  t = check.targets.find { |x| x.name == n }
  t ? t.source_build_phase.files.count { |bf| bf.file_ref } : 0
end
if checked < 3
  warn "❌ 自检本身失效：只检查了 #{checked} 个源文件引用（预期 ≥ 3）"
  exit 1
end
puts "   自检覆盖了 #{checked} 个源文件引用"

if missing.empty?
  puts '✅ 自检：所有源文件引用都指向真实文件'
else
  warn "❌ 自检失败 —— 以下引用指向不存在的文件："
  missing.each { |m| warn "   #{m}" }
  exit 1
end
