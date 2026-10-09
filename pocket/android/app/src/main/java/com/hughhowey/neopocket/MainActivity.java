package com.hughhowey.neopocket;

import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.View;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Pocket reads and writes Documents/NEO Library, the same plain files
    // Syncthing shares with the desktop. On Android 11+ that needs "All files
    // access", which lives on a buried Settings page most people never find.
    // So on first launch without it, take the writer straight to that page.
    private boolean askedForFilesAccess = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NeoBarsPlugin.class);
        registerPlugin(NeoPdfPlugin.class);
        super.onCreate(savedInstanceState);
        if (!hasFilesAccess()) {
            askedForFilesAccess = true;
            openFilesAccessSettings();
        }
        wireBackGesture();
        paintBehindThePage(Color.rgb(0x19, 0x19, 0x19));
        giveNeoTheWholeScreen();
        // the page then reports its own background (night, paper or light)
        // through NeoBarsPlugin, so whatever shows around it matches
    }

    // "rgb(25, 25, 25)" → a color; anything else → 0 (leave things be)
    static int parseCss(String css) {
        if (css == null) return 0;
        String[] n = css.replaceAll("[^0-9,.]", "").split(",");
        if (n.length < 3) return 0;
        try {
            return Color.rgb(Math.round(Float.parseFloat(n[0])), Math.round(Float.parseFloat(n[1])), Math.round(Float.parseFloat(n[2])));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    // Everything that can show around the page — the window, the camera
    // cutout band on Samsung phones, the bars when a swipe peeks them —
    // takes the page's color, with icons that read against it.
    @SuppressWarnings("deprecation")
    void paintBehindThePage(int color) {
        getWindow().setBackgroundDrawable(new ColorDrawable(color));
        getWindow().getDecorView().setBackgroundColor(color);
        View web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null) {
            web.setBackgroundColor(color);
            if (web.getParent() instanceof View) ((View) web.getParent()).setBackgroundColor(color);
        }
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        boolean lightPage = (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000 > 150;
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(lightPage);
        bars.setAppearanceLightNavigationBars(lightPage);
    }

    // NEO's philosophy: nothing on screen but the page. Android's status and
    // navigation bars stay hidden; a swipe from the top or bottom edge peeks
    // them for a moment, then they slide away again.
    private void giveNeoTheWholeScreen() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }

    // Android's back gesture (and Esc on a hardware keyboard, which Android
    // treats as Back) asks the page first: in a book it returns to the shelf;
    // on the shelf it lets Android send the app to the background as usual.
    private void wireBackGesture() {
        OnBackPressedCallback callback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript(
                    "(window.pocketBack ? window.pocketBack() : false)",
                    handled -> {
                        if (!"true".equals(handled)) {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                            setEnabled(true);
                        }
                    });
            }
        };
        getOnBackPressedDispatcher().addCallback(this, callback);
    }

    // Samsung brings the bars back after a dialog, the share sheet or the
    // keyboard; hide them again whenever NEO has the window back
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) giveNeoTheWholeScreen();
    }

    @Override
    public void onResume() {
        super.onResume();
        giveNeoTheWholeScreen();
        // Back from the Settings page with the toggle now on: reload so the
        // bookshelf appears instead of the "no permission" note.
        if (askedForFilesAccess && hasFilesAccess()) {
            askedForFilesAccess = false;
            getBridge().getWebView().reload();
        }
    }

    // Is a physical keyboard attached (Bluetooth, USB, a keyboard case)? The
    // page keeps Android's on-screen keyboard down while one is, and lets it
    // up when there isn't one, so a writer typing on the glass can type.
    static boolean hardwareKeyboard(Configuration c) {
        return c.keyboard != Configuration.KEYBOARD_NOKEYS
            && c.hardKeyboardHidden == Configuration.HARDKEYBOARDHIDDEN_NO;
    }

    // A keyboard connected or disconnected: tell the page
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (getBridge() == null) return;
        getBridge().getWebView().evaluateJavascript(
            "window.pocketHardwareKeyboard && window.pocketHardwareKeyboard(" + hardwareKeyboard(newConfig) + ")", null);
    }

    private boolean hasFilesAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return true;
        return Environment.isExternalStorageManager();
    }

    private void openFilesAccessSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (Exception e) {
            // Some phones don't have the per-app page; fall back to the list.
            startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
        }
    }
}
