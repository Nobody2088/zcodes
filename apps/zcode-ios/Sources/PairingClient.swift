import CryptoKit
import Foundation

struct PairResult {
  var deviceId: String
  var displayName: String
  var fingerprint: String
  var token: String
}

enum PairingError: LocalizedError {
  case badResponse
  case unauthorized
  case locked
  case fingerprintMismatch

  var errorDescription: String? {
    switch self {
    case .badResponse: "无法连接这台电脑"
    case .unauthorized: "密码不正确"
    case .locked: "尝试次数过多，请稍后再试"
    case .fingerprintMismatch: "证书指纹和电脑上显示的不一致"
    }
  }
}

final class PairingClient: NSObject, URLSessionDelegate {
  private var expectedFingerprint = ""
  private var seenFingerprint = ""

  func pair(
    host: String,
    port: Int,
    password: String,
    expectedFingerprint: String,
    clientId: String,
    clientName: String
  ) async throws -> PairResult {
    self.expectedFingerprint = expectedFingerprint.lowercased()
    seenFingerprint = ""
    let session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
    defer { session.finishTasksAndInvalidate() }
    let origin = "https://\(host):\(port)"
    let infoURL = URL(string: "\(origin)/lan/v1/info")!
    let (infoData, infoResponse) = try await session.data(from: infoURL)
    guard let http = infoResponse as? HTTPURLResponse, http.statusCode == 200 else {
      throw PairingError.badResponse
    }
    let info = try JSONDecoder().decode(LanInfo.self, from: infoData)
    if !self.expectedFingerprint.isEmpty, info.fingerprint != self.expectedFingerprint {
      throw PairingError.fingerprintMismatch
    }
    if !seenFingerprint.isEmpty, seenFingerprint != info.fingerprint {
      throw PairingError.fingerprintMismatch
    }
    var request = URLRequest(url: URL(string: "\(origin)/lan/v1/pair")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "password": password,
      "clientId": clientId,
      "clientName": clientName,
    ])
    let (pairData, pairResponse) = try await session.data(for: request)
    guard let pairHTTP = pairResponse as? HTTPURLResponse else { throw PairingError.badResponse }
    if pairHTTP.statusCode == 401 { throw PairingError.unauthorized }
    if pairHTTP.statusCode == 429 { throw PairingError.locked }
    guard pairHTTP.statusCode == 200,
          let body = try JSONSerialization.jsonObject(with: pairData) as? [String: Any],
          let token = body["token"] as? String
    else { throw PairingError.badResponse }
    return PairResult(
      deviceId: info.deviceId,
      displayName: info.displayName,
      fingerprint: info.fingerprint,
      token: token
    )
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard let trust = challenge.protectionSpace.serverTrust,
          let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
          let leaf = chain.first
    else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    let der = SecCertificateCopyData(leaf) as Data
    let fingerprint = SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
    seenFingerprint = fingerprint
    if expectedFingerprint.isEmpty || fingerprint == expectedFingerprint {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }
}

private struct LanInfo: Decodable {
  var deviceId: String
  var displayName: String
  var fingerprint: String
}
