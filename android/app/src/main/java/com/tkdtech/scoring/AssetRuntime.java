package com.tkdtech.scoring;

import android.content.Context;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Extracts the versioned, read-only application payload without touching tournament data. */
final class AssetRuntime {
    private AssetRuntime() {}

    static synchronized File ensureExtracted(Context context) throws IOException {
        File parent = new File(context.getFilesDir(), "runtime");
        File destination = new File(parent, String.valueOf(BuildConfig.VERSION_CODE));
        File complete = new File(destination, ".complete");
        if (complete.isFile() && valid(destination)) return destination;

        parent.mkdirs();
        File temporary = new File(parent, BuildConfig.VERSION_CODE + ".extracting");
        deleteRecursive(temporary);
        temporary.mkdirs();
        extractZip(context.getAssets().open("app-runtime.zip"), temporary);
        String missing = missingRequirement(temporary);
        if (missing != null) throw new IOException("The bundled Android runtime is incomplete: missing " + missing);
        new FileOutputStream(new File(temporary, ".complete")).close();
        deleteRecursive(destination);
        if (!temporary.renameTo(destination)) throw new IOException("Could not finalize the Android runtime.");
        File[] versions = parent.listFiles();
        if (versions != null) {
            for (File version : versions) {
                if (!version.getName().equals(String.valueOf(BuildConfig.VERSION_CODE))) deleteRecursive(version);
            }
        }
        return destination;
    }

    private static boolean valid(File directory) {
        return missingRequirement(directory) == null;
    }

    private static String missingRequirement(File directory) {
        String[] required = {
            "server.mjs",
            "apps/web/.next/BUILD_ID",
            "migrations/001_initial.sql",
            "migrations/002_license_deliveries.sql",
        };
        for (String path : required) if (!new File(directory, path).isFile()) return path;
        return null;
    }

    private static void extractZip(InputStream source, File destination) throws IOException {
        String root = destination.getCanonicalPath() + File.separator;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(source))) {
            byte[] buffer = new byte[64 * 1024];
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                File target = new File(destination, entry.getName());
                if (!target.getCanonicalPath().startsWith(root)) throw new IOException("Unsafe path in the bundled runtime.");
                if (entry.isDirectory()) {
                    target.mkdirs();
                    continue;
                }
                File parent = target.getParentFile();
                if (parent != null) parent.mkdirs();
                try (OutputStream output = new FileOutputStream(target)) {
                    int count;
                    while ((count = zip.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                zip.closeEntry();
            }
        }
    }

    static void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursive(child);
        if (!file.delete()) file.deleteOnExit();
    }
}
