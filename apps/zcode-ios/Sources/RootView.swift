import SwiftUI

// ZCode Remote 原生外壳:只负责局域网发现、配对,以及承载工作区 WebView;工作区界面由 packages/ui 的窄屏模式渲染。
// 视觉令牌见 RemoteTheme.swift。本文件分 6 段:会话容器(本段);发现页 A、B(extension RootView);错误横幅与手动连接页主体;输入分组、底部主按钮与连接动作(extension ManualConnectSheet)。
// UI 测试依赖的标识符与控件类型保持不变:manualConnectButton、manualConnectEmptyButton、errorText、client-<id>、
// hostField / portField(TextField)、passwordField(SecureField)、pairErrorText(纯 Text)、connectButton、
// sessionMenuButton、workspaceWebView。配对、重连、后台保活、证书校验在 RemoteSessionModel / WorkspaceWebView 里,本文件不改。
struct RootView: View {
  @Environment(\.scenePhase) private var scenePhase
  var model: RemoteSessionModel
  @State private var manualHost = ""
  @State private var manualPort = ""
  @State private var manualPassword = ""
  @State private var showManual = false

  var body: some View {
    Group {
      if let session = model.session {
        sessionView(session)
          .onChange(of: scenePhase) { _, phase in
            // 切到后台时留一点时间保住当前页面,方便系统截取任务切换器快照。
            // 回到前台再结束。iOS 之后仍会挂起进程,但不会拆掉已打开的项目。
            model.setSceneIsBackground(phase != .active)
          }
      } else {
        NavigationStack {
          discovery
            .navigationTitle("ZCode")
            .toolbar {
              ToolbarItem(placement: .topBarTrailing) {
                Button("手动连接") { showManual = true }
                  .accessibilityIdentifier("manualConnectButton")
              }
            }
            .sheet(isPresented: $showManual) {
              ManualConnectSheet(
                model: model,
                host: $manualHost,
                port: $manualPort,
                password: $manualPassword
              )
            }
        }
      }
    }
  }

  /// 配对成功后直接进入完整 Web UI,不再停留在「打开工作区」中间页。
  private func sessionView(_ session: PairedSession) -> some View {
    ZStack(alignment: .topTrailing) {
      RemoteTheme.background.ignoresSafeArea()
      WorkspaceWebView(
        session: session,
        isSceneActive: scenePhase == .active,
        onConnectionLost: { model.noteConnectionLost() }
      )
      // 只铺满容器安全区(刘海、Home 指示条),不忽略键盘:键盘弹出时 WebView 随之变矮,
      // 底部面板和输入栏自动上移,键盘上方也不再多出 Home 指示条那段空白。
      .ignoresSafeArea(.container)
      sessionMenu(session)
    }
  }

  private func sessionMenu(_ session: PairedSession) -> some View {
    Menu {
      Section(session.name) {
        Button("断开连接", systemImage: "xmark.circle", role: .destructive) { model.disconnect() }
      }
    } label: {
      Image(systemName: "ellipsis.circle")
        .font(.system(size: 20))
        .foregroundStyle(.secondary)
        .frame(width: RemoteTheme.touchTarget, height: RemoteTheme.touchTarget)
        .contentShape(Rectangle())
    }
    .accessibilityLabel("连接菜单")
    .accessibilityIdentifier("sessionMenuButton")
    // 位于 Web 会话头(顶部安全区下方 56pt)右端预留的 44pt 槽位:上下各留 6pt 居中,右侧与会话头的 8pt 边距对齐。
    // 槽位由 WorkspaceWebView 注入的 --zcode-native-trailing-inset(52px)预留;手机浏览器不注入,会话头保持原样。
    .padding(.top, 6)
    .padding(.trailing, 8)
  }
}
// MARK: - 发现页 A(第 2 段):页面骨架、状态卡片、附近的电脑列表。
// 列表行 clientRow、空状态引导 emptyGuide、错误横幅 RemoteErrorBanner 在第 3 段,手动连接页在第 4 段。
extension RootView {
  var discovery: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        statusCard
        if !model.lastError.isEmpty {
          RemoteErrorBanner(message: model.lastError, identifier: "errorText")
        }
        VStack(alignment: .leading, spacing: 8) {
          Text("附近的电脑")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 4)
          if model.clients.isEmpty {
            emptyGuide
          } else {
            clientList
          }
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
    }
    .background(RemoteTheme.background.ignoresSafeArea())
    .animation(.easeOut(duration: 0.2), value: model.clients)
    .animation(.easeOut(duration: 0.2), value: model.lastError)
  }

  /// 状态卡片:连接中转圈;没发现电脑时波纹图标循环变色,表示正在搜索;发现电脑后换成电脑图标。
  private var statusCard: some View {
    HStack(spacing: 12) {
      Group {
        if model.isPairing {
          ProgressView()
        } else {
          Image(systemName: model.clients.isEmpty ? "dot.radiowaves.left.and.right" : "desktopcomputer")
            .font(.system(size: 18, weight: .medium))
            .foregroundStyle(.secondary)
            .symbolEffect(.variableColor.iterative, options: .repeating, isActive: model.clients.isEmpty)
        }
      }
      .frame(width: 40, height: 40)
      .background(RemoteTheme.input, in: RoundedRectangle(cornerRadius: RemoteTheme.controlRadius, style: .continuous))
      VStack(alignment: .leading, spacing: 2) {
        Text(model.status)
          .font(.body.weight(.medium))
        Text(statusDetail)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    }
    .remoteCard()
  }

  private var statusDetail: String {
    if model.isPairing { return "正在与电脑建立加密连接" }
    if model.clients.isEmpty { return "正在监听局域网里的 ZCode(_zcode._tcp)" }
    return "发现 \(model.clients.count) 台电脑,点选即可连接"
  }

  /// 附近的电脑:同一张卡片内分行排列,分隔线从图标右侧开始(16 + 40 + 12 = 68pt)。
  private var clientList: some View {
    VStack(spacing: 0) {
      ForEach(Array(model.clients.enumerated()), id: \.element.id) { index, client in
        if index > 0 {
          Divider().padding(.leading, 68)
        }
        clientRow(client)
      }
    }
    .remoteCard(padding: 0)
  }
}
// MARK: - 发现页 B(第 3 段):列表行 clientRow、三步空状态引导 emptyGuide。
// 与第 2 段同为 extension RootView;同一文件内的 extension 可以互相访问 private 成员。错误横幅在第 4 段。
extension RootView {
  /// 附近的电脑一行:40pt 图标方块、名称、等宽「地址:端口」、右侧箭头,行高不低于 60pt。
  /// 点选后预填地址和端口、清空密码并打开连接页,与原行为一致。
  private func clientRow(_ client: DiscoveredClient) -> some View {
    Button {
      manualHost = client.host
      manualPort = String(client.port)
      manualPassword = ""
      showManual = true
    } label: {
      HStack(spacing: 12) {
        Image(systemName: "desktopcomputer")
          .font(.system(size: 18, weight: .medium))
          .foregroundStyle(.secondary)
          .frame(width: 40, height: 40)
          .background(RemoteTheme.input, in: RoundedRectangle(cornerRadius: RemoteTheme.controlRadius, style: .continuous))
        VStack(alignment: .leading, spacing: 2) {
          Text(client.name)
            .font(.body.weight(.medium))
            .lineLimit(1)
          // verbatim:端口不走本地化插值,避免按地区格式显示成「51,234」。
          Text(verbatim: "\(client.host):\(client.port)")
            .font(.footnote.monospaced())
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        Spacer(minLength: 8)
        Image(systemName: "chevron.right")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.tertiary)
      }
      .padding(.horizontal, 16)
      .frame(minHeight: RemoteTheme.rowMinHeight)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("client-\(client.id)")
  }

  /// 没发现电脑时的引导:三步说明加 44pt 主按钮「手动连接」。原空状态里的全部说明都保留在三步里。
  private var emptyGuide: some View {
    VStack(alignment: .leading, spacing: 14) {
      guideStep(1, "在电脑上打开 ZCode,进入 设置 → 常规 → 局域网控制 并开启")
      guideStep(2, "手机和电脑连在同一个局域网(模拟器依赖本机 Bonjour)")
      guideStep(3, "仍然没有出现?用电脑的局域网 IP 和端口手动连接")
      Button("手动连接") { showManual = true }
        .buttonStyle(RemotePrimaryButtonStyle())
        .accessibilityIdentifier("manualConnectEmptyButton")
        .padding(.top, 2)
    }
    .remoteCard()
  }

  /// 引导步骤:24pt 圆形序号(DESIGN.md 允许真圆形用全圆角)加说明文字,多行时序号与首行基线对齐。
  private func guideStep(_ index: Int, _ text: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Text(verbatim: String(index))
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.secondary)
        .frame(width: 24, height: 24)
        .background(RemoteTheme.input, in: Circle())
        .overlay { Circle().strokeBorder(RemoteTheme.border, lineWidth: 1) }
      Text(text)
        .font(.subheadline)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
// MARK: - 错误横幅与手动连接页主体(第 4 段)。连接动作、输入分组、底部主按钮在第 5 段(extension ManualConnectSheet)。

/// 错误横幅:警示图标加错误原文,红色 10% 底、30% 边框,对应 Web 配对页的 destructive 提示。
/// 标识符挂在 Text 本身:UI 测试按 staticTexts 查找,读到的 label 就是错误原文(测试断言其中包含「密码」)。
struct RemoteErrorBanner: View {
  var message: String
  var identifier: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Image(systemName: "exclamationmark.triangle.fill")
        .accessibilityHidden(true)
      // String 变量走原文初始化,不做本地化查找。
      Text(message)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier(identifier)
    }
    .font(.subheadline)
    .foregroundStyle(.red)
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: RemoteTheme.controlRadius, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: RemoteTheme.controlRadius, style: .continuous)
        .strokeBorder(Color.red.opacity(0.3), lineWidth: 1)
    }
  }
}

/// 手动连接页:「电脑」「安全」两组带可见标签的输入框、证书指纹、错误横幅,底部 44pt 主按钮随键盘上移。
/// 地址、端口、密码仍由 RootView 的 @State 持有(点选附近的电脑时预填),本页只持有焦点。
struct ManualConnectSheet: View {
  enum Field: Hashable { case host, port, password }

  var model: RemoteSessionModel
  @Binding var host: String
  @Binding var port: String
  @Binding var password: String
  @Environment(\.dismiss) var dismiss
  @FocusState var focusedField: Field?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          computerGroup
          securityGroup
          if !model.lastError.isEmpty {
            RemoteErrorBanner(message: model.lastError, identifier: "pairErrorText")
          }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
      }
      .scrollDismissesKeyboard(.interactively)
      .background(RemoteTheme.background.ignoresSafeArea())
      // 底部主按钮放在安全区内侧:键盘弹出时随键盘上移,不被遮挡。
      .safeAreaInset(edge: .bottom) { bottomBar }
      .navigationTitle("连接电脑")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("取消") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(model.isPairing ? "连接中" : "连接") { connect() }
            .disabled(model.isPairing)
            .accessibilityIdentifier("connectButton")
        }
      }
      .animation(.easeOut(duration: 0.2), value: model.lastError)
    }
    // 两组输入框、指纹和底部按钮在半高下放不下,键盘还会顶到按钮,所以固定为全高。
    .presentationDetents([.large])
    .presentationDragIndicator(.visible)
  }
}
// MARK: - 手动连接页输入分组(第 5 段)。底部主按钮、连接动作、分组与带标签输入框的辅助视图在第 6 段。
// 与第 4 段的 ManualConnectSheet 同文件:同一文件内 extension 与主体可以互相访问 private 成员。
extension ManualConnectSheet {
  /// 地址和端口都与某台已发现的电脑一致时,带出它的证书指纹(与原逻辑相同)。
  private var matchedClient: DiscoveredClient? {
    model.clients.first { $0.host == host && String($0.port) == port }
  }

  /// 「电脑」组:地址(URL 键盘,关闭自动大写与纠错,回车跳到端口)、端口(数字键盘)。
  private var computerGroup: some View {
    formGroup("电脑") {
      labeledField("地址") {
        TextField("例如 192.168.1.8", text: $host)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
          .submitLabel(.next)
          .focused($focusedField, equals: .host)
          .onSubmit { focusedField = .port }
          .accessibilityIdentifier("hostField")
      }
      labeledField("端口") {
        TextField("例如 51234", text: $port)
          .keyboardType(.numberPad)
          .focused($focusedField, equals: .port)
          .accessibilityIdentifier("portField")
      }
    }
  }

  /// 「安全」组:密码(保留 oneTimeCode,回车直接连接);匹配到已发现的电脑时显示等宽证书指纹,可长按复制。
  private var securityGroup: some View {
    formGroup("安全") {
      labeledField("密码") {
        SecureField("内网可留空，外网填写密码", text: $password)
          .textContentType(.oneTimeCode)
          .submitLabel(.go)
          .focused($focusedField, equals: .password)
          .onSubmit { connect() }
          .accessibilityIdentifier("passwordField")
      }
      if let fingerprint = matchedClient?.fingerprint, !fingerprint.isEmpty {
        VStack(alignment: .leading, spacing: 4) {
          Label("证书指纹", systemImage: "lock.shield")
            .font(.footnote.weight(.medium))
            .foregroundStyle(.secondary)
          // verbatim:指纹原样显示,不做本地化查找。
          Text(verbatim: fingerprint)
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
  }
}
// MARK: - 手动连接页底部主按钮、连接动作与辅助视图(第 6 段,RootView.swift 到此完整)。
extension ManualConnectSheet {
  /// 底部 44pt 品牌主按钮:连接中显示转圈与「连接中」并禁用。
  /// 标识符用 connectPrimaryButton,与工具栏的 connectButton 区分,UI 测试按 connectButton 查找时只命中一个元素。
  private var bottomBar: some View {
    Button {
      connect()
    } label: {
      HStack(spacing: 8) {
        if model.isPairing {
          ProgressView()
            .tint(RemoteTheme.onBrand)
        }
        Text(verbatim: model.isPairing ? "连接中" : "连接")
      }
    }
    .buttonStyle(RemotePrimaryButtonStyle())
    .disabled(model.isPairing)
    .accessibilityIdentifier("connectPrimaryButton")
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
    .background(RemoteTheme.background.ignoresSafeArea(.container, edges: .bottom))
  }

  /// 连接:指纹按地址加端口匹配(matchedClient),名称只按地址匹配,端口解析失败记为 0,与原逻辑一致;
  /// 配对成功后关闭本页(session 非空时根视图会切到工作区并卸载本页,这里兜底)。配对中重复提交直接忽略。
  func connect() {
    guard !model.isPairing else { return }
    focusedField = nil
    let targetHost = host
    let targetPort = Int(port) ?? 0
    let targetPassword = password
    let fingerprint = matchedClient?.fingerprint ?? ""
    let name = model.clients.first { $0.host == targetHost }?.name ?? targetHost
    Task {
      await model.pair(host: targetHost, port: targetPort, password: targetPassword, fingerprint: fingerprint, name: name)
      if model.session != nil { dismiss() }
    }
  }

  /// 分组:小节标题加 remoteCard 卡片,对应 Web 配对页的 rounded-xl 卡片。
  private func formGroup<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title)
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 4)
      VStack(alignment: .leading, spacing: 14) {
        content()
      }
      .remoteCard()
    }
  }

  /// 带可见标签的输入框:标签在上;输入框 44pt 高、input 底色、8pt 圆角、1pt 边框,与 Web 配对页一致。
  /// 泛型参数叫 Input,避免遮蔽 ManualConnectSheet.Field 焦点枚举。
  private func labeledField<Input: View>(_ label: String, @ViewBuilder input: () -> Input) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label)
        .font(.footnote.weight(.medium))
        .foregroundStyle(.secondary)
      input()
        .font(.body)
        .padding(.horizontal, 12)
        .frame(minHeight: RemoteTheme.touchTarget)
        .background(RemoteTheme.input, in: RoundedRectangle(cornerRadius: RemoteTheme.controlRadius, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: RemoteTheme.controlRadius, style: .continuous)
            .strokeBorder(RemoteTheme.border, lineWidth: 1)
        }
    }
  }
}