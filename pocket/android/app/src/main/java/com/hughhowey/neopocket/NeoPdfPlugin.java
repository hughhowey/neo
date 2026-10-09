package com.hughhowey.neopocket;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// File → Export → PDF on Android. The page hands over the same HTML the
// desktop prints; it is laid out in a WebView of its own, off screen, and
// Android's print screen opens on it. "Save as PDF" is one of the printers
// there (a real printer works too), and the writer picks where it goes.
// See exportSave in pocket-bridge.js.
@CapacitorPlugin(name = "NeoPdf")
public class NeoPdfPlugin extends Plugin {
    // the WebView must outlive the call: printing reads from it until the
    // print screen is closed, so it's kept until the next PDF replaces it
    private WebView printView;

    @PluginMethod
    public void print(PluginCall call) {
        final String html = call.getString("html", "");
        final String name = call.getString("name", "NEO");
        final boolean letter = Boolean.TRUE.equals(call.getBoolean("letter", false));
        getActivity().runOnUiThread(() -> {
            final WebView web = new WebView(getContext());
            web.getSettings().setJavaScriptEnabled(false);
            final boolean[] sent = { false };
            web.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    if (sent[0]) return;
                    sent[0] = true;
                    // a moment for the embedded fonts to be drawn
                    view.postDelayed(() -> {
                        try {
                            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(name);
                            PrintAttributes.Builder attrs = new PrintAttributes.Builder()
                                .setMediaSize(letter ? PrintAttributes.MediaSize.NA_LETTER : PrintAttributes.MediaSize.ISO_A4)
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS);
                            pm.print(name, adapter, attrs.build());
                            JSObject out = new JSObject();
                            out.put("printing", true);
                            call.resolve(out);
                        } catch (Exception e) {
                            call.reject("Couldn't open printing: " + e.getMessage());
                        }
                    }, 700);
                }
            });
            printView = web;
            web.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
        });
    }
}
