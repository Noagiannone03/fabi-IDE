// Native pointer events exercise AppKit hit testing; CDP mouse events cannot
// prove that an Electron app-region actually moves its host window.
import CoreGraphics
import Foundation

guard CGPreflightPostEventAccess() else {
    fputs("Native pointer automation is not authorized on this Mac.\n", stderr)
    exit(2)
}
let values = CommandLine.arguments.dropFirst().compactMap(Double.init)
guard values.count == 4 else { exit(1) }
let origin = CGPoint(x: values[0], y: values[1])
func post(_ type: CGEventType, _ point: CGPoint) {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point,
            mouseButton: .left)?.post(tap: .cghidEventTap)
}
post(.mouseMoved, origin)
Thread.sleep(forTimeInterval: 0.1)
post(.leftMouseDown, origin)
Thread.sleep(forTimeInterval: 0.15)
for step in 1...20 {
    Thread.sleep(forTimeInterval: 0.02)
    post(.leftMouseDragged, CGPoint(x: origin.x + values[2] * Double(step) / 20,
                                   y: origin.y + values[3] * Double(step) / 20))
}
post(.leftMouseUp, CGPoint(x: origin.x + values[2], y: origin.y + values[3]))
