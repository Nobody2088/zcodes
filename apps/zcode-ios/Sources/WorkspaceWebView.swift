import CryptoKit
import SwiftUI
import WebKit

private func launchArgumentValue(_ flag: String, in arguments: [String]) -> String? {
  guard let index = arguments.firstIndex(of: flag) else { return nil }
  let next = arguments.index(after: index)
  guard next < arguments.endIndex else { return nil }
  let value = arguments[next]
  return value.hasPrefix("-") ? nil : value
}

struct WorkspaceWebView: UIViewRepresentable {
  var session: PairedSession
  var isSceneActive = true
  var onConnectionLost: () -> Void

  private static let themeColorKey = "zcode.lan.themeColor"

  /// 首帧底色:优先用上次页面报告的 theme-color(即 Web 里选定的主题),否则跟随系统深浅色。
  static func initialBackground() -> UIColor {
    if let parts = UserDefaults.standard.array(forKey: themeColorKey) as? [Double], parts.count == 4 {
      return UIColor(red: parts[0], green: parts[1], blue: parts[2], alpha: parts[3])
    }
    return RemoteTheme.backgroundUIColor
  }

  static func rememberBackground(_ color: UIColor) {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return }
    UserDefaults.standard.set([red, green, blue, alpha].map { Double($0) }, forKey: themeColorKey)
  }

  /// 系统外观取自 windowScene 的 trait。窗口 override 只作用于窗口及其子视图,所以这里读到的始终是 iOS 设置。
  static var systemInterfaceStyle: UIUserInterfaceStyle {
    UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first?.traitCollection.userInterfaceStyle ?? .unspecified
  }

  func makeCoordinator() -> Coordinator {
    Coordinator(session: session, onConnectionLost: onConnectionLost)
  }

  func makeUIView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    let payload: [String: String] = [
      "origin": session.origin,
      "token": session.token,
      "clientId": session.clientId,
    ]
    let encoded = (try? JSONSerialization.data(withJSONObject: payload)).flatMap {
      String(data: $0, encoding: .utf8)
    } ?? "{}"
    let quoted = (try? JSONEncoder().encode(encoded)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    // 必须在配对桌面同源注入：sessionStorage 按 origin 隔离；不能再用手机本机 127.0.0.1。
    let script = WKUserScript(
      source: "sessionStorage.setItem('zcode:lan-remote-session', \(quoted));",
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    )
    configuration.userContentController.addUserScript(script)
    // 原生外壳标记:会话头窄屏右侧让出 52pt(44pt 断开菜单加 8pt 边距);手机浏览器没有这段脚本,变量默认 0px。
    configuration.userContentController.addUserScript(
      WKUserScript(
        source: "document.documentElement?.style.setProperty('--zcode-native-trailing-inset', '52px');",
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
      )
    )
    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.isOpaque = false
    webView.backgroundColor = WorkspaceWebView.initialBackground()
    webView.scrollView.backgroundColor = webView.backgroundColor
    webView.scrollView.minimumZoomScale = 1
    webView.scrollView.maximumZoomScale = 1
    webView.scrollView.bouncesZoom = false
    webView.scrollView.pinchGestureRecognizer?.isEnabled = false
    webView.navigationDelegate = context.coordinator
    context.coordinator.observeThemeColor(of: webView)
    context.coordinator.followSystemStyle(of: webView)
    webView.accessibilityIdentifier = "workspaceWebView"
    context.coordinator.load(session, in: webView)
    return webView
  }

  /// 离开工作区(断开或断线)时把窗口外观交还系统,发现页等原生页面继续跟随 iOS 设置。
  static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
    coordinator.resetWindowStyle()
  }

  func updateUIView(_ uiView: WKWebView, context: Context) {
    context.coordinator.onConnectionLost = onConnectionLost
    context.coordinator.session = session
    context.coordinator.fingerprint = session.fingerprint
    if context.coordinator.loadedToken != session.token || context.coordinator.loadedOrigin != session.origin {
      context.coordinator.load(session, in: uiView)
    } else if isSceneActive, context.coordinator.pendingReload {
      context.coordinator.pendingReload = false
      context.coordinator.load(session, in: uiView)
    }
  }

  final class Coordinator: NSObject, WKNavigationDelegate {
    var session: PairedSession
    var fingerprint: String
    var onConnectionLost: () -> Void
    var loadedOrigin = ""
    var loadedToken = ""
    var pendingReload = false
    private var reloadAttempts = 0
    private var retryTask: Task<Void, Never>?
    private var themeObservation: NSKeyValueObservation?
    private weak var themedWindow: UIWindow?
    private weak var observedScene: UIWindowScene?
    private var sceneStyleRegistration: (any UITraitChangeRegistration)?

    init(session: PairedSession, onConnectionLost: @escaping () -> Void) {
      self.session = session
      self.fingerprint = session.fingerprint
      self.onConnectionLost = onConnectionLost
    }

    /// 页面 theme-color 就是实际背景色(useTheme 同步 --color-background):原生底色随之切换并缓存,
    /// 下次冷启动首帧直接用它,浅色主题不再先闪一下深色。
    func observeThemeColor(of webView: WKWebView) {
      themeObservation = webView.observe(\.themeColor, options: [.initial, .new]) { [weak self] webView, _ in
        guard let color = webView.themeColor else { return }
        webView.backgroundColor = color
        webView.scrollView.backgroundColor = color
        WorkspaceWebView.rememberBackground(color)
        self?.applyWindowStyle(for: color, in: webView)
      }
    }

    /// WebView 自身固定用系统外观,并随系统切换。Web「跟随系统」主题读到的 prefers-color-scheme 因此始终是 iOS 设置,
    /// 不会被按页面主题设置的窗口外观带偏,也就避免了「窗口跟页面、页面又跟窗口」的回路。
    func followSystemStyle(of webView: WKWebView) {
      webView.overrideUserInterfaceStyle = WorkspaceWebView.systemInterfaceStyle
      guard observedScene == nil, let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
      observedScene = scene
      sceneStyleRegistration = scene.registerForTraitChanges([UITraitUserInterfaceStyle.self]) {
        [weak webView] (scene: UIWindowScene, _: UITraitCollection) in
        webView?.overrideUserInterfaceStyle = scene.traitCollection.userInterfaceStyle
      }
    }

    /// 窗口外观跟随页面主题亮度,状态栏文字和原生断开菜单与 Web 保持一致(例如系统为浅色、Web 用 Zai Dark 时,状态栏显示浅色文字)。
    func applyWindowStyle(for color: UIColor, in webView: WKWebView) {
      guard let window = webView.window else {
        // 首次拿到颜色时,WebView 可能还没挂进窗口,在下一轮主线程再试一次。
        DispatchQueue.main.async { [weak self, weak webView] in
          guard let webView, webView.window != nil else { return }
          self?.applyWindowStyle(for: color, in: webView)
        }
        return
      }
      var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
      guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return }
      let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
      window.overrideUserInterfaceStyle = luminance < 0.5 ? .dark : .light
      themedWindow = window
    }

    func resetWindowStyle() {
      themedWindow?.overrideUserInterfaceStyle = .unspecified
      themedWindow = nil
      if let registration = sceneStyleRegistration { observedScene?.unregisterForTraitChanges(registration) }
      sceneStyleRegistration = nil
      observedScene = nil
    }

    func load(_ session: PairedSession, in webView: WKWebView) {
      retryTask?.cancel()
      loadedOrigin = session.origin
      loadedToken = session.token
      fingerprint = session.fingerprint
      guard var components = URLComponents(string: session.origin) else { return }
      var items = [URLQueryItem(name: "lan", value: "1")]
      let arguments = ProcessInfo.processInfo.arguments
      if arguments.contains("-open-sidebar") {
        items.append(URLQueryItem(name: "sidebar", value: "1"))
      }
      if arguments.contains("-open-settings") {
        let section = launchArgumentValue("-settings-section", in: arguments) ?? "general"
        items.append(URLQueryItem(name: "settings", value: section))
        if arguments.contains("-settings-nav") {
          items.append(URLQueryItem(name: "settingsNav", value: "1"))
        }
      }
      components.queryItems = items
      if let url = components.url {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        webView.load(request)
      }
    }

    func webView(
      _ webView: WKWebView,
      didReceive challenge: URLAuthenticationChallenge,
      completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
      guard let trust = challenge.protectionSpace.serverTrust,
            let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
            let leaf = chain.first
      else {
        completionHandler(.performDefaultHandling, nil)
        return
      }
      let der = SecCertificateCopyData(leaf) as Data
      let actual = SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
      if actual == fingerprint {
        completionHandler(.useCredential, URLCredential(trust: trust))
      } else {
        completionHandler(.cancelAuthenticationChallenge, nil)
      }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      reloadAttempts = 0
      pendingReload = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
      // 系统在后台回收网页进程。重新加载同一页，不拆配对、不退回发现列表。
      pendingReload = UIApplication.shared.applicationState != .active
      if !pendingReload {
        load(session, in: webView)
      }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
      show(error, in: webView)
    }

    func webView(
      _ webView: WKWebView,
      didFailProvisionalNavigation navigation: WKNavigation!,
      withError error: Error
    ) {
      show(error, in: webView)
    }

    private func show(_ error: Error, in webView: WKWebView) {
      let nsError = error as NSError
      if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled {
        return
      }
      // 进后台时系统会挂起网络。不能因此拆掉会话，否则回到前台就像退出了。
      if UIApplication.shared.applicationState != .active {
        pendingReload = true
        return
      }
      guard reloadAttempts < 3 else {
        retryTask?.cancel()
        retryTask = Task { @MainActor in
          try? await Task.sleep(nanoseconds: 1_500_000_000)
          self.onConnectionLost()
        }
        return
      }
      reloadAttempts += 1
      load(session, in: webView)
    }
  }
}
