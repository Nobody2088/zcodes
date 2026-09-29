import SwiftUI

@main
struct ZCodeRemoteApp: App {
  @State private var model = RemoteSessionModel()

  var body: some Scene {
    WindowGroup {
      RootView(model: model)
    }
  }
}
