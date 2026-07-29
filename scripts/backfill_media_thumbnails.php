<?php
/**
 * Genera le miniature mancanti per le immagini gia' in archivio.
 *
 * La migrazione phase82 aggiunge property_media.thumb_path ma non lo popola:
 * ricampionare un intero archivio e' lavoro lungo, che non puo' stare
 * nell'avvio del container (migrate.php gira all'entrypoint e un timeout li'
 * blocca il deploy). Da qui invece si vede cosa sta succedendo e lo si puo'
 * fermare.
 *
 * Idempotente: salta le righe che hanno gia' una miniatura ESISTENTE su disco.
 * Un thumb_path che punta a un file sparito viene rigenerato, non ignorato —
 * quel caso e' esattamente quello che rompe le anteprime.
 *
 * Ridimensiona anche l'originale sopra i 2560px sul lato lungo: sono le foto
 * caricate prima della pipeline, ed e' il grosso del peso dell'archivio.
 * Con --thumbs-only gli originali non vengono toccati.
 *
 * Uso (solo CLI):
 *   php scripts/backfill_media_thumbnails.php --dry-run      # cosa farebbe
 *   php scripts/backfill_media_thumbnails.php                # esegue
 *   php scripts/backfill_media_thumbnails.php --thumbs-only  # non tocca gli originali
 *   php scripts/backfill_media_thumbnails.php --limit=200    # a scaglioni
 */

if (PHP_SAPI !== 'cli') {
    exit("CLI only\n");
}

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/image_processing.php';

$dryRun     = in_array('--dry-run', $argv, true);
$thumbsOnly = in_array('--thumbs-only', $argv, true);
$limit      = 0;
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--limit=')) {
        $limit = max(0, (int) substr($arg, 8));
    }
}

if (!imageProcessingAvailable()) {
    exit("GD non disponibile in questo PHP: niente da fare.\n"
        . "Ricostruisci l'immagine Docker (il Dockerfile installa gd + exif).\n");
}

$root = dirname(__DIR__) . '/';
$db   = getDB();

// Solo media di presentazione: gli allegati stanno nell'albero riservato e
// non hanno miniatura per scelta (vedi api/property_media.php).
$sql = "SELECT id, property_id, file_path, thumb_path, mime_type
        FROM property_media
        WHERE media_type IN ('photo', 'floor_plan', 'house_map')
          AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
        ORDER BY id ASC";
if ($limit > 0) {
    $sql .= ' LIMIT ' . $limit;
}

$rows = $db->query($sql)->fetchAll(PDO::FETCH_ASSOC);
$upd  = $db->prepare('UPDATE property_media SET thumb_path = :thumb, file_size = :size WHERE id = :id');

$stats = ['totale' => count($rows), 'saltate' => 0, 'miniature' => 0, 'ridotte' => 0, 'mancanti' => 0, 'errori' => 0];
$saved = 0;

foreach ($rows as $row) {
    $id       = (int) $row['id'];
    $mime     = (string) $row['mime_type'];
    $srcRel   = (string) $row['file_path'];
    $srcAbs   = $root . $srcRel;

    if (!is_file($srcAbs)) {
        $stats['mancanti']++;
        echo "  #$id  FILE ASSENTE  $srcRel\n";
        continue;
    }

    $thumbRel = trim((string) ($row['thumb_path'] ?? ''));
    if ($thumbRel !== '' && is_file($root . $thumbRel)) {
        $stats['saltate']++;
        continue;
    }

    $before = (int) filesize($srcAbs);

    if ($dryRun) {
        [$w, $h] = @getimagesize($srcAbs) ?: [0, 0];
        $tooBig  = max((int) $w, (int) $h) > IMG_ORIGINAL_MAX_EDGE;
        echo "  #$id  {$w}x{$h}  " . round($before / 1024) . " KB"
            . ($tooBig && !$thumbsOnly ? '  → da ridurre' : '') . "  → miniatura\n";
        $stats['miniature']++;
        continue;
    }

    try {
        if (!$thumbsOnly && imageDownscaleInPlace($srcAbs, $mime)) {
            $stats['ridotte']++;
        }

        $thumbDir = dirname($srcAbs) . '/thumbs';
        if (!is_dir($thumbDir) && !mkdir($thumbDir, 0755, true)) {
            $stats['errori']++;
            echo "  #$id  cartella thumbs non creata\n";
            continue;
        }

        $name = basename($srcAbs);
        if (!imageWriteThumbnail($srcAbs, $thumbDir . '/' . $name, $mime)) {
            $stats['errori']++;
            echo "  #$id  miniatura non generata\n";
            continue;
        }

        clearstatcache(true, $srcAbs);
        $after = (int) filesize($srcAbs);
        $saved += max(0, $before - $after);

        $upd->execute([
            'thumb' => dirname($srcRel) . '/thumbs/' . $name,
            'size'  => $after,
            'id'    => $id,
        ]);
        $stats['miniature']++;
    } catch (Throwable $e) {
        $stats['errori']++;
        echo "  #$id  ERRORE  " . $e->getMessage() . "\n";
    }
}

echo "\n" . ($dryRun ? '[DRY RUN] ' : '') . "Immagini esaminate: {$stats['totale']}\n";
echo "  gia' a posto:        {$stats['saltate']}\n";
echo "  miniature generate:  {$stats['miniature']}\n";
echo "  originali ridotti:   {$stats['ridotte']}\n";
echo "  file assenti:        {$stats['mancanti']}\n";
echo "  errori:              {$stats['errori']}\n";
if ($saved > 0) {
    echo "  spazio recuperato:   " . round($saved / 1048576, 1) . " MB\n";
}
