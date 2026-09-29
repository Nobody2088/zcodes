import SwiftUI
import UIKit

// 原生外壳的设计令牌。颜色逐值取自 packages/ui/src/styles.css 的 .theme-zai-light / .theme-zai-dark,
// 用法与 Web 局域网配对页(packages/web/src/lanPairing.tsx)一致:卡片用 surface,输入框用 input。
// 圆角与触控尺寸对齐 DESIGN.md:第一层容器 12pt(rounded-xl),嵌套控件 8pt(rounded-lg),可点区域不小于 44pt。
// 正文前景色用系统 label / secondaryLabel,随深浅色和动态字体自动适配,不逐值复刻。
enum RemoteTheme {
  /// --color-background:#f8f8f8 / #161616。WebView 首帧底色也用它,浅色主题不再先闪一下深色。
  static let backgroundUIColor = dynamicUIColor(light: 0xF8F8F8, dark: 0x161616)
  static let background = Color(uiColor: backgroundUIColor)
  /// --color-input:#ffffff / #2b2b2b。
  static let input = dynamic(light: 0xFFFFFF, dark: 0x2B2B2B)
  /// --color-surface:rgba(13,13,13,.03) / rgba(255,255,255,.05)。
  static let surface = dynamic(light: 0x0D0D0D, dark: 0xFFFFFF, lightAlpha: 0.03, darkAlpha: 0.05)
  /// --color-border:rgba(13,13,13,.1) / rgba(255,255,255,.1)。
  static let border = dynamic(light: 0x0D0D0D, dark: 0xFFFFFF, lightAlpha: 0.1, darkAlpha: 0.1)
  /// --color-brand / --color-primary-foreground:主按钮浅色为黑底白字,深色为白底黑字。
  static let brand = dynamic(light: 0x000000, dark: 0xFFFFFF)
  static let onBrand = dynamic(light: 0xFFFFFF, dark: 0x000000)

  static let cardRadius: CGFloat = 12
  static let controlRadius: CGFloat = 8
  static let touchTarget: CGFloat = 44
  static let rowMinHeight: CGFloat = 60

  static func dynamic(light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) -> Color {
    Color(uiColor: dynamicUIColor(light: light, dark: dark, lightAlpha: lightAlpha, darkAlpha: darkAlpha))
  }

  static func dynamicUIColor(
    light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1
  ) -> UIColor {
    UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(rgb: dark, alpha: darkAlpha)
        : UIColor(rgb: light, alpha: lightAlpha)
    }
  }
}

extension UIColor {
  convenience init(rgb: UInt32, alpha: CGFloat = 1) {
    self.init(
      red: CGFloat((rgb >> 16) & 0xFF) / 255,
      green: CGFloat((rgb >> 8) & 0xFF) / 255,
      blue: CGFloat(rgb & 0xFF) / 255,
      alpha: alpha
    )
  }
}

/// 44pt 品牌主按钮。按下变淡到 0.72(与 styles.css 窄屏段的按压反馈一致),禁用时 0.5。
struct RemotePrimaryButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.body.weight(.semibold))
      .foregroundStyle(RemoteTheme.onBrand)
      .frame(maxWidth: .infinity, minHeight: RemoteTheme.touchTarget)
      .background(RemoteTheme.brand, in: RoundedRectangle(cornerRadius: RemoteTheme.controlRadius, style: .continuous))
      .opacity(isEnabled ? (configuration.isPressed ? 0.72 : 1) : 0.5)
      .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
  }
}

extension View {
  /// 第一层卡片:surface 底色、1pt 边框、12pt 连续圆角,对应 lanPairing 的 rounded-xl 卡片。
  func remoteCard(padding: CGFloat = 16) -> some View {
    self
      .padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(RemoteTheme.surface, in: RoundedRectangle(cornerRadius: RemoteTheme.cardRadius, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: RemoteTheme.cardRadius, style: .continuous)
          .strokeBorder(RemoteTheme.border, lineWidth: 1)
      }
  }
}