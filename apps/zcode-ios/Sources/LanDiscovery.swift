import Foundation

final class LanDiscovery: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  var onChange: (([DiscoveredClient]) -> Void)?
  private let browser = NetServiceBrowser()
  private var services: [NetService] = []
  private var clients: [String: DiscoveredClient] = [:]

  func start() {
    browser.delegate = self
    browser.searchForServices(ofType: "_zcode._tcp.", inDomain: "local.")
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    service.delegate = self
    services.append(service)
    service.resolve(withTimeout: 5)
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
    services.removeAll { $0.name == service.name && $0.type == service.type }
    clients[service.name] = nil
    publish()
  }

  func netServiceDidResolveAddress(_ sender: NetService) {
    let txt = NetService.dictionary(fromTXTRecord: sender.txtRecordData() ?? Data())
    let host = sender.addresses?.compactMap(ipv4Address).first ?? sender.hostName ?? ""
    guard !host.isEmpty, sender.port > 0 else { return }
    let deviceId = text("id", from: txt) ?? sender.name
    clients[sender.name] = DiscoveredClient(
      id: deviceId,
      name: sender.name,
      host: host,
      port: sender.port,
      fingerprint: text("fp", from: txt) ?? ""
    )
    publish()
  }

  private func publish() {
    let next = clients.values.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    if Thread.isMainThread {
      onChange?(next)
    } else {
      DispatchQueue.main.async { [weak self] in
        self?.onChange?(next)
      }
    }
  }

  private func text(_ key: String, from record: [String: Data]) -> String? {
    guard let data = record[key] else { return nil }
    let value = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return value?.isEmpty == false ? value : nil
  }
}

private func ipv4Address(_ data: Data) -> String? {
  var storage = sockaddr_storage()
  guard data.count <= MemoryLayout<sockaddr_storage>.size else { return nil }
  _ = withUnsafeMutableBytes(of: &storage) { destination in
    data.copyBytes(to: destination)
  }
  guard Int32(storage.ss_family) == AF_INET else { return nil }
  var address = withUnsafePointer(to: &storage) {
    $0.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr }
  }
  var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
  guard inet_ntop(AF_INET, &address, &buffer, socklen_t(buffer.count)) != nil else { return nil }
  return String(cString: buffer)
}
