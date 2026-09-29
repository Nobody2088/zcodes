import XCTest

final class PairingUITests: XCTestCase {
  private var host = ""
  private var port = ""
  private var password = ""

  override func setUpWithError() throws {
    continueAfterFailure = false
    let fixture = URL(fileURLWithPath: "/tmp/zcode-lan-fixture.json")
    let data = try Data(contentsOf: fixture)
    let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    host = json?["host"] as? String ?? ""
    port = String(json?["port"] as? Int ?? 0)
    password = json?["password"] as? String ?? ""
    XCTAssertFalse(host.isEmpty)
    XCTAssertNotEqual(port, "0")
    XCTAssertFalse(password.isEmpty)
  }

  func testWrongPasswordDoesNotConnect() {
    let app = launch()
    openManual(app)
    fill(app, password: "not-the-password")
    app.buttons["connectButton"].tap()
    let error = app.staticTexts["pairErrorText"]
    XCTAssertTrue(error.waitForExistence(timeout: 15))
    XCTAssertTrue(error.label.contains("密码"))
    XCTAssertFalse(app.staticTexts["connectedTitle"].exists)
  }

  func testCorrectPasswordConnects() {
    // 先带 -open-sidebar 验收窄屏叠层不透明；再截收起态与模型名。
    let app = launch(openSidebar: true)
    openManual(app)
    fill(app, password: password)
    app.buttons["connectButton"].tap()
    // 配对成功后直接进入工作区 WebView，不再经过「打开工作区」中间页。
    XCTAssertTrue(app.buttons["sessionMenuButton"].waitForExistence(timeout: 20))
    XCTAssertFalse(app.buttons["openWorkspaceButton"].exists)
    let later = app.buttons["以后"]
    if later.waitForExistence(timeout: 4) {
      later.tap()
    }
    let notNow = app.buttons["Not Now"]
    if notNow.waitForExistence(timeout: 1) {
      notNow.tap()
    }
    let loaded = expectation(description: "workspace painted")
    DispatchQueue.main.asyncAfter(deadline: .now() + 12) { loaded.fulfill() }
    wait(for: [loaded], timeout: 16)
    let openShot = XCUIScreen.main.screenshot()
    try? openShot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/zcode-sim-sidebar.png"))
    let attachment = XCTAttachment(screenshot: openShot)
    attachment.lifetime = .keepAlways
    attachment.name = "sidebar-open"
    add(attachment)

    // 点遮罩偏右收回叠层
    let webView = app.webViews["workspaceWebView"]
    if webView.waitForExistence(timeout: 3) {
      webView.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        .withOffset(CGVector(dx: 360, dy: 420))
        .tap()
    }
    let closedWait = expectation(description: "sidebar closed paint")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { closedWait.fulfill() }
    wait(for: [closedWait], timeout: 4)
    let closedShot = XCUIScreen.main.screenshot()
    try? closedShot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/zcode-sim-sidebar-closed.png"))
    try? closedShot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/zcode-sim-login.png"))
    try? closedShot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/zcode-sim-model.png"))
  }

  func testSettingsScreens() {
    let sections = [
      "general", "appearance", "modelProvider", "memory", "subagents", "plugin",
      "mcp", "skill", "commands", "hooks", "browser", "shortcuts", "usage",
    ]
    for (index, section) in sections.enumerated() {
      let app = XCUIApplication()
      var args = ["-ui-testing", "-open-settings", "-settings-section", section]
      if index == 0 {
        args.append(contentsOf: ["-reset-session", "-settings-nav"])
      }
      app.launchArguments = args
      app.launch()
      if index == 0 {
        let allow = app.buttons["允许"]
        if allow.waitForExistence(timeout: 2) { allow.tap() }
        openManual(app)
        fill(app, password: password)
        app.buttons["connectButton"].tap()
      }
      let menu = app.buttons["sessionMenuButton"]
      XCTAssertTrue(menu.waitForExistence(timeout: index == 0 ? 30 : 20), "settings \(section) did not connect")
      let painted = expectation(description: "paint \(section)")
      let delay: TimeInterval = index == 0 ? 12 : 5
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { painted.fulfill() }
      wait(for: [painted], timeout: delay + 4)
      saveShot("settings-\(section)")
      app.terminate()
    }
  }

  private func saveShot(_ name: String) {
    let shot = XCUIScreen.main.screenshot()
    try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/zcode-\(name).png"))
  }

  private func launch(openSidebar: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-session"]
    if openSidebar {
      app.launchArguments.append("-open-sidebar")
    }
    app.launch()
    let allow = app.buttons["允许"]
    if allow.waitForExistence(timeout: 2) { allow.tap() }
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let prompt = springboard.buttons["Allow"]
    if prompt.waitForExistence(timeout: 2) { prompt.tap() }
    return app
  }

  private func openManual(_ app: XCUIApplication) {
    let button = app.buttons["manualConnectButton"]
    XCTAssertTrue(button.waitForExistence(timeout: 5))
    button.tap()
  }

  private func fill(_ app: XCUIApplication, password: String) {
    let hostField = app.textFields["hostField"]
    XCTAssertTrue(hostField.waitForExistence(timeout: 5))
    hostField.tap()
    hostField.typeText(host)
    let portField = app.textFields["portField"]
    portField.tap()
    portField.typeText(port)
    let passwordField = app.secureTextFields["passwordField"]
    passwordField.tap()
    passwordField.typeText(password)
  }
}
