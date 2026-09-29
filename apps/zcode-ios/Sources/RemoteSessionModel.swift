import Foundation
import Observation
import UIKit

struct DiscoveredClient: Identifiable, Hashable {
  var id: String
  var name: String
  var host: String
  var port: Int
  var fingerprint: String
}

struct PairedSession: Codable, Equatable {
  var deviceId: String
  var name: String
  var origin: String
  var token: String
  var clientId: String
  var fingerprint: String
}

@MainActor
@Observable
final class RemoteSessionModel {
  var clients: [DiscoveredClient] = []
  var session: PairedSession?
  var status = "正在寻找局域网里的 ZCode"
  var lastError = ""
  var isPairing = false

  private let discovery = LanDiscovery()
  private let pairing = PairingClient()
  private let keychain = KeychainStore()
  private let clientId: String
  private var reconnectTask: Task<Void, Never>?
  private var autoPairTask: Task<Void, Never>?
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private let uiTesting: Bool

  init() {
    uiTesting = ProcessInfo.processInfo.arguments.contains("-ui-testing")
    let defaults = UserDefaults.standard
    if let stored = defaults.string(forKey: "zcode.lan.clientId") {
      clientId = stored
    } else {
      let created = UUID().uuidString
      defaults.set(created, forKey: "zcode.lan.clientId")
      clientId = created
    }
    if ProcessInfo.processInfo.arguments.contains("-reset-session") {
      keychain.deleteAll()
    }
    session = keychain.read()
    discovery.onChange = { [weak self] clients in
      guard let self else { return }
      self.clients = clients
      if clients.isEmpty, self.session == nil {
        self.status = "还没有发现客户端"
      } else if self.session == nil {
        self.status = "正在连接局域网里的 ZCode"
        self.scheduleAutoPair()
      }
    }
    discovery.start()
    // 启动参数自动配对：便于真机验证「配对后直接进入完整 UI」，不经过手动点选。
    if let auto = Self.parseAutoPairArguments(ProcessInfo.processInfo.arguments) {
      Task { @MainActor in
        await self.pair(
          host: auto.host,
          port: auto.port,
          password: auto.password,
          fingerprint: auto.fingerprint,
          name: auto.name
        )
      }
    }
  }

  private static func parseAutoPairArguments(_ args: [String]) -> (
    host: String, port: Int, password: String, fingerprint: String, name: String
  )? {
    func value(after flag: String) -> String? {
      guard let index = args.firstIndex(of: flag), args.index(after: index) < args.endIndex else {
        return nil
      }
      return args[args.index(after: index)]
    }
    guard let host = value(after: "-autoPairHost")?.trimmingCharacters(in: .whitespacesAndNewlines),
          !host.isEmpty,
          let portText = value(after: "-autoPairPort"),
          let port = Int(portText),
          port > 0,
          let password = value(after: "-autoPairPassword"),
          !password.isEmpty
    else {
      return nil
    }
    return (
      host: host,
      port: port,
      password: password,
      fingerprint: value(after: "-autoPairFingerprint") ?? "",
      name: value(after: "-autoPairName") ?? host
    )
  }

  func pair(host: String, port: Int, password: String, fingerprint: String, name: String) async {
    let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedHost.isEmpty, port > 0 else {
      lastError = "请填写地址和端口"
      return
    }
    isPairing = true
    lastError = ""
    defer { isPairing = false }
    do {
      let paired = try await pairing.pair(
        host: trimmedHost,
        port: port,
        password: password,
        expectedFingerprint: fingerprint,
        clientId: clientId,
        clientName: UIDevice.current.name
      )
      let next = PairedSession(
        deviceId: paired.deviceId,
        name: name.isEmpty ? paired.displayName : name,
        origin: "https://\(trimmedHost):\(port)",
        token: paired.token,
        clientId: clientId,
        fingerprint: paired.fingerprint
      )
      keychain.save(next)
      session = next
      status = "已连接"
    } catch {
      lastError = error.localizedDescription
    }
  }

  func disconnect() {
    reconnectTask?.cancel()
    autoPairTask?.cancel()
    if let session {
      keychain.delete(deviceId: session.deviceId)
    }
    session = nil
    status = "已断开，正在重新寻找电脑"
    scheduleAutoPair()
  }

  func setSceneIsBackground(_ isBackground: Bool) {
    if isBackground {
      guard backgroundTask == .invalid else { return }
      backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "zcode.lan.suspend") {
        [weak self] in
        self?.endBackgroundHold()
      }
      return
    }
    endBackgroundHold()
  }

  private func endBackgroundHold() {
    guard backgroundTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTask)
    backgroundTask = .invalid
  }

  func noteConnectionLost() {
    guard session != nil else { return }
    session = nil
    status = "电脑已断开，正在重新连接"
    lastError = ""
    scheduleReconnect()
  }

  private func scheduleAutoPair() {
    guard !uiTesting, session == nil, !isPairing else { return }
    autoPairTask?.cancel()
    autoPairTask = Task { @MainActor in
      try? await Task.sleep(nanoseconds: 400_000_000)
      guard !Task.isCancelled, self.session == nil, !self.isPairing, let client = self.clients.first else {
        return
      }
      await self.pair(
        host: client.host,
        port: client.port,
        password: "",
        fingerprint: client.fingerprint,
        name: client.name
      )
    }
  }

  private func scheduleReconnect() {
    reconnectTask?.cancel()
    reconnectTask = Task { @MainActor in
      while !Task.isCancelled, self.session == nil {
        if let client = self.clients.first {
          await self.pair(
            host: client.host,
            port: client.port,
            password: "",
            fingerprint: client.fingerprint,
            name: client.name
          )
        }
        if self.session != nil { return }
        try? await Task.sleep(nanoseconds: 2_000_000_000)
      }
    }
  }
}
