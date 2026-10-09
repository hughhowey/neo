// File → Export → PDF on iPhone and iPad. The page hands over the same HTML
// the desktop prints; it is laid out off screen in a WKWebView, drawn page
// by page into a PDF through iOS's own print renderer, and saved in the
// app's temporary folder. pocket-bridge.js then hands the file to the
// share sheet (Files, Mail, AirDrop, Print).

import Foundation
import UIKit
import WebKit
import Capacitor

@objc(NeoPdfPlugin)
public class NeoPdfPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "NeoPdfPlugin"
    public let jsName = "NeoPdf"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise)
    ]

    private var web: WKWebView?
    private var call: CAPPluginCall?
    private var paper = CGSize(width: 612, height: 792)
    private var margin: CGFloat = 72
    private var name = "NEO"

    @objc func print(_ call: CAPPluginCall) {
        let html = call.getString("html") ?? ""
        name = (call.getString("name") ?? "NEO").replacingOccurrences(of: "/", with: "-")
        // US letter (and every script) or A4; a book gets an inch all round,
        // a script lays out its own pages
        paper = (call.getBool("letter") ?? false) ? CGSize(width: 612, height: 792) : CGSize(width: 595.28, height: 841.89)
        margin = (call.getBool("screenplay") ?? false) ? 0 : 72
        DispatchQueue.main.async {
            if let old = self.call { old.reject("Another PDF was started") }
            self.call = call
            let w = WKWebView(frame: CGRect(origin: .zero, size: self.paper))
            w.navigationDelegate = self
            self.web = w
            w.loadHTMLString(html, baseURL: nil)
        }
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // a moment for the embedded fonts to be drawn (and only for the
        // page of the PDF still asked for)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            if webView === self.web { self.render(webView) }
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView === web { finish(nil, error.localizedDescription) }
    }

    private func render(_ webView: WKWebView) {
        let renderer = UIPrintPageRenderer()
        renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
        let page = CGRect(origin: .zero, size: paper)
        renderer.setValue(NSValue(cgRect: page), forKey: "paperRect")
        renderer.setValue(NSValue(cgRect: page.insetBy(dx: margin, dy: margin)), forKey: "printableRect")
        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, page, nil)
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
        for i in 0..<renderer.numberOfPages {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name + ".pdf")
        do {
            try data.write(to: url, options: .atomic)
            finish(url, nil)
        } catch {
            finish(nil, error.localizedDescription)
        }
    }

    private func finish(_ url: URL?, _ error: String?) {
        guard let call = call else { return }
        self.call = nil
        web = nil
        if let url = url { call.resolve(["uri": url.absoluteString]) } else { call.reject("Couldn't make the PDF: " + (error ?? "")) }
    }
}
