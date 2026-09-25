package com.hughhowey.neopocket;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Pocket reads and writes Documents/NEO Library, the same plain files
    // Syncthing shares with the desktop. On Android 11+ that needs "All files
    // access", which lives on a buried Settings page most people never find.
    // So on first launch without it, take the writer straight to that page.
    private boolean askedForFilesAccess = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!hasFilesAccess()) {
            askedForFilesAccess = true;
            openFilesAccessSettings();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // Back from the Settings page with the toggle now on: reload so the
        // bookshelf appears instead of the "no permission" note.
        if (askedForFilesAccess && hasFilesAccess()) {
            askedForFilesAccess = false;
            getBridge().getWebView().reload();
        }
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
