import SwiftUI

// MARK: - JichoBotdoro card

/// The focused JichoBotdoro pill: the clock, the last event, and start / pause / stop.
struct JichoBotdoroCardView: View {
    @ObservedObject private var jichobotdoro = JichoBotdoroController.shared

    private var accent: Color {
        Color(hex: PillCatalog.definition(for: JichoBotdoroController.pillId)?.color ?? "#0EA5E9")
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { timeline in
            card(at: timeline.date)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.top, 4)
    }

    private func card(at date: Date) -> some View {
        let left = jichobotdoro.remaining(at: date) ?? JichoBotdoroSettings.config.work
        let subtitle: String = {
            if jichobotdoro.paused { return String(localized: "jichobotdoro.paused", defaultValue: "Paused") }
            switch jichobotdoro.phase {
            case .work: return String(localized: "jichobotdoro.work", defaultValue: "Work")
            case .rest: return String(localized: "jichobotdoro.rest", defaultValue: "Rest")
            case .idle: return String(localized: "jichobotdoro.ready", defaultValue: "Ready")
            }
        }()
        let banner = jichobotdoro.paused ? nil : jichobotdoro.banner(at: date)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Circle()
                    .fill(accent)
                    .frame(width: 7, height: 7)
                Text(verbatim: "JichoBotdoro")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color(hex: "#F5F6F8"))
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundColor(Color(hex: "#8E939C"))
                Spacer(minLength: 2)
            }
            .padding(.top, 6)
            .padding(.leading, 108)
            .padding(.trailing, 36)

            HStack(alignment: .center, spacing: 8) {
                Text(verbatim: JichoBotdoroEngine.clock(left))
                    .font(.system(size: 18, weight: .semibold))
                    .monospacedDigit()
                    .foregroundColor(Color(hex: "#F5F6F8"))
                Spacer(minLength: 4)
                controls
            }
            .padding(.top, 6)
            .padding(.leading, 116)
            .padding(.trailing, 12)

            if let banner {
                Text(banner)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(accent)
                    .lineLimit(1)
                    .padding(.top, 3)
                    .padding(.leading, 116)
                    .padding(.trailing, 12)
            }
        }
    }

    @ViewBuilder private var controls: some View {
        HStack(spacing: 6) {
            if jichobotdoro.phase == .idle {
                button(String(localized: "jichobotdoro.start", defaultValue: "Start"), filled: true) { jichobotdoro.begin() }
            } else if jichobotdoro.paused {
                button(String(localized: "jichobotdoro.resume", defaultValue: "Resume"), filled: true) { jichobotdoro.resume() }
                button(String(localized: "jichobotdoro.stop", defaultValue: "Stop"), filled: false) { jichobotdoro.end() }
            } else {
                button(String(localized: "jichobotdoro.pause", defaultValue: "Pause"), filled: false) { jichobotdoro.pause() }
                button(String(localized: "jichobotdoro.stop", defaultValue: "Stop"), filled: false) { jichobotdoro.end() }
            }
        }
    }

    private func button(_ title: String, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(filled ? Color(hex: "#041018") : Color(hex: "#E8E9EC"))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Capsule().fill(filled ? accent : Color.white.opacity(0.08)))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - JichoBotdoro pill

/// The capsule in the pill grid. A fresh event replaces the clock for a few seconds.
struct JichoBotdoroPill: View {
    let task: AgentTask
    @ObservedObject var state: AppState
    @Binding var swapping: Bool
    let onTap: () -> Void
    @ObservedObject private var jichobotdoro = JichoBotdoroController.shared
    @State private var isHovered = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { timeline in
            let label = jichobotdoro.pillLabel(at: timeline.date)
            Button(action: { onTap() }) {
                ZStack(alignment: .topTrailing) {
                    ZStack {
                        Capsule()
                            .fill(isHovered ? Color(hex: task.color).opacity(0.18) : Color(hex: "#0E0F11"))
                        Capsule()
                            .stroke(Color(hex: task.color).opacity(isHovered ? 0.55 : 0.14), lineWidth: 1)
                        HStack(spacing: 0) {
                            MiniBotCanvasView(task: task)
                                .frame(width: 22 / 0.6, height: 22 / 0.6)
                                .frame(width: 22, height: 22, alignment: .center)
                                .padding(.leading, 8)
                            Spacer()
                        }
                        Text(verbatim: label)
                            .font(.system(size: 10, weight: .semibold))
                            .monospacedDigit()
                            .foregroundColor(isHovered
                                             ? Color(hex: task.color).lighter(by: 0.3)
                                             : Color(hex: "#6B7079"))
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .padding(.leading, 30)
                            .padding(.trailing, 8)
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
                    .shadow(color: Color(hex: task.color).opacity(isHovered ? 0.35 : 0), radius: 10, x: 0, y: 2)

                    if let badge = task.pillBadge {
                        PillBadgeView(badge: badge, taskColor: task.color)
                            .offset(x: 3, y: -3)
                    }
                }
            }
            .buttonStyle(.plain)
            .help(label)
            .scaleEffect(isHovered ? 1.04 : 1.0)
            .brightness(isHovered ? 0.06 : 0)
            .onHover { hovering in
                guard !swapping else { return }
                withAnimation(.spring(response: 0.2, dampingFraction: 0.7)) { isHovered = hovering }
            }
        }
    }
}
