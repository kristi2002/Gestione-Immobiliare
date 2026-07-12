<?php
/**
 * Upload path containment guard.
 *
 * Every file-serving endpoint (download_document, download_pdf, media) turns a
 * DB-stored relative path into an absolute disk path and readfile()s it. Those
 * paths are written at upload time, not by the downloader — but a single bad or
 * tampered row (e.g. a stored "../../config/db.php") would otherwise let
 * readfile() escape the uploads tree. This guard makes that impossible,
 * independent of the web server or .htaccess configuration.
 *
 * Returns the canonical absolute path ONLY when it exists, is a regular file,
 * and resolves to somewhere INSIDE uploads/. Otherwise null.
 */

/**
 * @param string $storedRelPath  path as stored in the DB, relative to project root
 *                               (e.g. "uploads/documents/2026/abc.pdf")
 * @return string|null           safe absolute path, or null if outside uploads/ / missing
 */
function safeUploadRealPath(string $storedRelPath): ?string
{
    $storedRelPath = trim($storedRelPath);
    if ($storedRelPath === '') {
        return null;
    }

    // Reject NUL bytes and absolute paths outright — a legitimate stored path is
    // always relative to the project root.
    if (strpos($storedRelPath, "\0") !== false) {
        return null;
    }

    $root       = dirname(__DIR__);
    $uploadsDir = realpath($root . '/uploads');
    if ($uploadsDir === false) {
        // uploads/ missing on disk — nothing is servable.
        return null;
    }

    $candidate = realpath($root . '/' . $storedRelPath);
    if ($candidate === false || !is_file($candidate)) {
        return null;
    }

    // Containment: the resolved file must live under the canonical uploads dir.
    // realpath() has already collapsed any ".." segments and resolved symlinks,
    // so a simple prefix check is sufficient and correct on both / and \ systems.
    $prefix = $uploadsDir . DIRECTORY_SEPARATOR;
    if (strncmp($candidate, $prefix, strlen($prefix)) !== 0) {
        return null;
    }

    return $candidate;
}
