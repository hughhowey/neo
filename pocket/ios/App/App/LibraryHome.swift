// Where NEO Pocket keeps its books on iOS.
//
// Same principle as everywhere else NEO runs: plain files in a folder on the
// device. When the writer has iCloud Drive switched on, that folder is the
// app's iCloud folder — still local, still offline-capable, but Apple carries
// changes to the Mac in the background, where desktop NEO can point at it via
// File → Library Folder… (it shows up as iCloud Drive → NEO Pocket → NEO
// Library). With iCloud Drive off, the folder is On My iPad → NEO Pocket.
// No account is required, no dialog is shown; the shelf simply appears.

import Foundation
import UIKit
import ObjectiveC
import Capacitor

@objc(LibraryHomePlugin)
public class LibraryHomePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LibraryHomePlugin"
    public let jsName = "LibraryHome"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "locate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeyboard", returnType: CAPPluginReturnPromise)
    ]

    // the on-screen keyboard follows the page: dark for Night, light for Paper
    static var keyboardDark = true

    @objc func setKeyboard(_ call: CAPPluginCall) {
        LibraryHomePlugin.keyboardDark = call.getBool("dark") ?? true
        call.resolve()
    }

    private static let folderName = "NEO Library"
    private static var cached: (url: URL, cloud: Bool)?

    private func home() -> (url: URL, cloud: Bool) {
        if let c = LibraryHomePlugin.cached { return c }
        let fm = FileManager.default
        var base: URL
        var cloud = false
        // url(forUbiquityContainerIdentifier:) can take a moment the first
        // time; plugin methods run off the main thread, so that's fine.
        if let container = fm.url(forUbiquityContainerIdentifier: nil) {
            base = container.appendingPathComponent("Documents", isDirectory: true)
            cloud = true
        } else {
            base = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        }
        let lib = base.appendingPathComponent(LibraryHomePlugin.folderName, isDirectory: true)
        try? fm.createDirectory(at: lib, withIntermediateDirectories: true)
        let result = (url: lib, cloud: cloud)
        LibraryHomePlugin.cached = result
        return result
    }

    // {path: "file:///…/NEO%20Library", cloud: true|false}
    @objc func locate(_ call: CAPPluginCall) {
        let h = home()
        call.resolve(["path": h.url.absoluteString, "cloud": h.cloud])
    }

    // Files another device wrote arrive first as placeholders. Ask iCloud to
    // bring everything under `path` (default: the whole library) down, and
    // wait up to `wait` ms for it. Harmless when not on iCloud.
    @objc func fetch(_ call: CAPPluginCall) {
        let h = home()
        guard h.cloud else { call.resolve(["ready": true]); return }
        var target = h.url
        if let p = call.getString("path"), let u = URL(string: p) { target = u }
        let wait = call.getDouble("wait") ?? 6000
        let fm = FileManager.default
        let deadline = Date().addingTimeInterval(wait / 1000)
        var pending = true
        while pending {
            pending = false
            let keys: [URLResourceKey] = [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey, .ubiquitousItemIsDownloadingKey]
            // Walk everything, hidden files included: a not-yet-downloaded file
            // is a hidden ".name.icloud" placeholder, and they hide inside
            // every book folder, not just at the top.
            if let en = fm.enumerator(at: target, includingPropertiesForKeys: keys, options: []) {
                for case let item as URL in en {
                    if item.lastPathComponent.hasSuffix(".icloud") {
                        pending = true
                        try? fm.startDownloadingUbiquitousItem(at: item)
                        continue
                    }
                    let v = try? item.resourceValues(forKeys: Set(keys))
                    guard v?.isUbiquitousItem == true else { continue }
                    if let status = v?.ubiquitousItemDownloadingStatus, status != .current {
                        pending = true
                        if v?.ubiquitousItemIsDownloading != true {
                            try? fm.startDownloadingUbiquitousItem(at: item)
                        }
                    }
                }
            } else if target.lastPathComponent.hasSuffix(".icloud") || !fm.fileExists(atPath: target.path) {
                // a single file that is still a placeholder
                let dir = target.deletingLastPathComponent()
                let ph = dir.appendingPathComponent("." + target.lastPathComponent + ".icloud")
                if fm.fileExists(atPath: ph.path) {
                    pending = true
                    try? fm.startDownloadingUbiquitousItem(at: ph)
                }
            }
            if !pending || Date() > deadline { break }
            Thread.sleep(forTimeInterval: 0.25)
        }
        call.resolve(["ready": !pending])
    }
}

// Registers the plugin above with Capacitor. SceneDelegate creates this
// instead of the stock CAPBridgeViewController.
class NeoBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LibraryHomePlugin())
        bridge?.registerPluginInstance(NeoPdfPlugin())
    }

    // With a hardware keyboard attached, iPadOS floats a little bar above the
    // page whenever text has focus: a keyboard button, bold/italic, the
    // microphone, ⌘ hints. NEO has its own formatting and its bar is the
    // page's. WebKit's content view is given, at runtime, a subclass that
    // answers "no accessory view, no assistant items, dark keyboard" — the
    // one place iOS asks before drawing any of that.
    override open func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        quietKeyboard()
    }

    private func quietKeyboard() {
        guard let scroll = webView?.scrollView else { return }
        for sub in scroll.subviews where String(describing: type(of: sub)).hasPrefix("WKContent") {
            NeoBridgeViewController.quieten(sub)
        }
    }

    private static func quieten(_ view: UIView) {
        let name = "NEOQuiet_" + String(cString: class_getName(object_getClass(view)))
        var cls: AnyClass? = NSClassFromString(name)
        if cls == nil {
            guard let made = objc_allocateClassPair(object_getClass(view), name, 0) else { return }
            let noView: @convention(block) (AnyObject) -> UIView? = { _ in nil }
            class_addMethod(made, #selector(getter: UIResponder.inputAccessoryView),
                            imp_implementationWithBlock(noView), "@@:")
            let noItems: @convention(block) (AnyObject) -> UITextInputAssistantItem = { _ in
                let item = UITextInputAssistantItem()
                item.leadingBarButtonGroups = []
                item.trailingBarButtonGroups = []
                return item
            }
            class_addMethod(made, #selector(getter: UIResponder.inputAssistantItem),
                            imp_implementationWithBlock(noItems), "@@:")
            let appearance: @convention(block) (AnyObject) -> Int = { _ in
                (LibraryHomePlugin.keyboardDark ? UIKeyboardAppearance.dark : UIKeyboardAppearance.light).rawValue
            }
            class_addMethod(made, NSSelectorFromString("keyboardAppearance"),
                            imp_implementationWithBlock(appearance), "q@:")
            // no Paste / AutoFill / Format bubble on a long press in the text:
            // NEO's page has its own ways, and the bubble only ever got in the way
            let noMenu: @convention(block) (AnyObject, Selector, AnyObject?) -> Bool = { _, _, _ in false }
            class_addMethod(made, #selector(UIResponder.canPerformAction(_:withSender:)),
                            imp_implementationWithBlock(noMenu), "B@::@")
            objc_registerClassPair(made)
            cls = made
        }
        if let cls = cls { object_setClass(view, cls) }
    }
}
