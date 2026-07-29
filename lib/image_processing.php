<?php
/**
 * Ridimensionamento delle immagini della galleria immobili (estensione GD).
 *
 * Perche' esiste: api/property_media.php accetta file fino a 20 MB e finora li
 * salvava cosi' com'erano. Una foto di un telefono recente e' 4000x3000 px e
 * pesa 5-8 MB; la griglia immobili ne carica fino a 24 per pagina in card larghe
 * ~360px. Erano oltre 100 MB di traffico per una schermata di anteprime. Qui
 * l'originale viene riportato a un lato massimo ragionevole (sempre sopra i
 * requisiti dei portali) e da esso si deriva una miniatura per le liste.
 *
 * Quattro scelte deliberate:
 *
 * 1. La GIF non viene ricampionata. GD legge solo il primo fotogramma e
 *    restituirebbe un'animazione mutilata: resta caricabile e resta l'originale.
 * 2. Nessuna dipendenza obbligatoria. Se GD manca (o e' compilata senza WebP)
 *    tutto degrada al comportamento precedente: file salvato intatto, miniatura
 *    assente, upload comunque riuscito. Un'immagine non ridimensionata e' un
 *    problema di banda, non un errore da sbattere in faccia all'agente a meta'
 *    inserimento.
 * 3. L'originale viene riscritto SOLO se eccede il lato massimo. Sotto soglia i
 *    byte non si toccano: un secondo giro di JPEG su un file gia' piccolo e'
 *    solo perdita di qualita' a parita' di peso.
 * 4. L'orientamento EXIF viene applicato prima di ricampionare. GD scrive un
 *    file senza EXIF: senza questo passaggio ogni foto scattata in verticale
 *    con il telefono uscirebbe coricata, ed e' il modo piu' rapido per far
 *    sembrare rotta una funzione che funziona.
 */

/** Lato lungo massimo dell'originale conservato. Sopra i minimi dei portali. */
const IMG_ORIGINAL_MAX_EDGE = 2560;

/** Lato lungo della miniatura: copre card e popup mappa anche su schermi 2x. */
const IMG_THUMB_MAX_EDGE = 640;

const IMG_ORIGINAL_QUALITY = 82;
const IMG_THUMB_QUALITY    = 78;

/**
 * Tetto di memoria che accettiamo di chiedere per una singola immagine.
 * Oltre questa soglia si rinuncia al ridimensionamento invece di far morire la
 * richiesta per esaurimento memoria a upload gia' avvenuto.
 */
const IMG_MEMORY_CEILING = 512 * 1024 * 1024;

/** Formati che sappiamo ricampionare senza degradare il contenuto. */
const IMG_PROCESSABLE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * GD c'e' e sa fare quello che ci serve.
 *
 * Volutamente non controlla il supporto WebP: quello si verifica per formato in
 * imgLoad()/imgSave(), cosi' una GD senza WebP continua a servire JPEG e PNG
 * invece di disattivare tutta la pipeline.
 */
function imageProcessingAvailable(): bool
{
    return extension_loaded('gd') && function_exists('imagecreatetruecolor');
}

function imageIsProcessable(string $mime): bool
{
    return imageProcessingAvailable() && in_array(strtolower($mime), IMG_PROCESSABLE_MIMES, true);
}

/**
 * Riporta l'immagine entro $maxEdge sul lato lungo, sovrascrivendo il file.
 *
 * @return bool true se il file e' stato riscritto, false se e' rimasto intatto
 *              (gia' entro soglia, formato non gestito, memoria insufficiente).
 */
function imageDownscaleInPlace(string $path, string $mime, int $maxEdge = IMG_ORIGINAL_MAX_EDGE): bool
{
    if (!imageIsProcessable($mime) || !is_file($path)) {
        return false;
    }

    $size = @getimagesize($path);
    if (!is_array($size) || empty($size[0]) || empty($size[1])) {
        return false;
    }

    [$srcW, $srcH] = [(int) $size[0], (int) $size[1]];
    [$dstW, $dstH] = imgFitBox($srcW, $srcH, $maxEdge);

    $needsRotation = imgExifOrientation($path, $mime) > 1;

    // Gia' piccola e dritta: non la si tocca. Riscriverla costerebbe qualita'.
    if ($dstW === $srcW && $dstH === $srcH && !$needsRotation) {
        return false;
    }

    if (!imgReserveMemory($srcW, $srcH, $dstW, $dstH)) {
        return false;
    }

    $src = imgLoad($path, $mime);
    if ($src === null) {
        return false;
    }

    $src = imgApplyExifOrientation($src, $path, $mime);

    // La rotazione EXIF scambia i lati: il riquadro va ricalcolato sull'immagine
    // effettiva, non su quella dichiarata dall'header.
    [$dstW, $dstH] = imgFitBox(imagesx($src), imagesy($src), $maxEdge);

    $dst = imgResample($src, $dstW, $dstH);
    if ($dst === null) {
        return false;
    }

    return imgSave($dst, $path, $mime, IMG_ORIGINAL_QUALITY);
}

/**
 * Scrive la miniatura di $srcPath in $destPath, stesso formato dell'originale.
 *
 * @return bool true se la miniatura esiste su disco a fine chiamata.
 */
function imageWriteThumbnail(
    string $srcPath,
    string $destPath,
    string $mime,
    int $maxEdge = IMG_THUMB_MAX_EDGE
): bool {
    if (!imageIsProcessable($mime) || !is_file($srcPath)) {
        return false;
    }

    $size = @getimagesize($srcPath);
    if (!is_array($size) || empty($size[0]) || empty($size[1])) {
        return false;
    }

    [$srcW, $srcH] = [(int) $size[0], (int) $size[1]];
    [$dstW, $dstH] = imgFitBox($srcW, $srcH, $maxEdge);

    if (!imgReserveMemory($srcW, $srcH, $dstW, $dstH)) {
        return false;
    }

    $src = imgLoad($srcPath, $mime);
    if ($src === null) {
        return false;
    }

    // L'orientamento e' gia' stato applicato all'originale da
    // imageDownscaleInPlace(); riapplicarlo qui ruoterebbe due volte. Si rilegge
    // dal file perche' una foto sotto soglia non passa da quella funzione e
    // conserva ancora il suo tag EXIF.
    $src = imgApplyExifOrientation($src, $srcPath, $mime);

    [$dstW, $dstH] = imgFitBox(imagesx($src), imagesy($src), $maxEdge);

    $dst = imgResample($src, $dstW, $dstH);
    if ($dst === null) {
        return false;
    }

    return imgSave($dst, $destPath, $mime, IMG_THUMB_QUALITY);
}

// ---------------------------------------------------------------------------
// Interne
// ---------------------------------------------------------------------------

/** Riquadro proporzionale entro $maxEdge; non ingrandisce mai. */
function imgFitBox(int $w, int $h, int $maxEdge): array
{
    $longest = max($w, $h);
    if ($longest <= $maxEdge || $longest === 0) {
        return [$w, $h];
    }

    $ratio = $maxEdge / $longest;

    return [max(1, (int) round($w * $ratio)), max(1, (int) round($h * $ratio))];
}

/**
 * @return GdImage|null
 */
function imgLoad(string $path, string $mime)
{
    $im = match (strtolower($mime)) {
        'image/jpeg' => function_exists('imagecreatefromjpeg') ? @imagecreatefromjpeg($path) : false,
        'image/png'  => function_exists('imagecreatefrompng')  ? @imagecreatefrompng($path)  : false,
        'image/webp' => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : false,
        default      => false,
    };

    return $im ?: null;
}

/**
 * @param GdImage $im
 */
function imgSave($im, string $path, string $mime, int $quality): bool
{
    return match (strtolower($mime)) {
        // PNG: 0-9 dove 9 e' la compressione massima (lossless, nessuna perdita).
        'image/png'  => function_exists('imagepng')  && @imagepng($im, $path, 8),
        'image/jpeg' => function_exists('imagejpeg') && @imagejpeg($im, $path, $quality),
        'image/webp' => function_exists('imagewebp') && @imagewebp($im, $path, $quality),
        default      => false,
    };
}

/**
 * Nessuna imagedestroy() in tutto il file: dal PHP 8.0 GdImage e' un oggetto
 * liberato dal refcount, la funzione non fa piu' nulla ed e' deprecata dal 8.5
 * (il dev locale gira su 8.5, il container su 8.4).
 *
 * @param  GdImage $src
 * @return GdImage|null
 */
function imgResample($src, int $dstW, int $dstH)
{
    $dst = @imagecreatetruecolor($dstW, $dstH);
    if (!$dst) {
        return null;
    }

    // Trasparenza: senza questi tre passaggi un PNG con alpha esce su fondo nero.
    imagealphablending($dst, false);
    imagesavealpha($dst, true);
    $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
    imagefilledrectangle($dst, 0, 0, $dstW, $dstH, $transparent);

    if (!imagecopyresampled($dst, $src, 0, 0, 0, 0, $dstW, $dstH, imagesx($src), imagesy($src))) {
        return null;
    }

    return $dst;
}

/** Orientamento EXIF dichiarato dal file (1 = dritto / assente). */
function imgExifOrientation(string $path, string $mime): int
{
    if (strtolower($mime) !== 'image/jpeg' || !function_exists('exif_read_data')) {
        return 1;
    }

    $exif = @exif_read_data($path);
    $o    = (int) ($exif['Orientation'] ?? 1);

    return ($o >= 1 && $o <= 8) ? $o : 1;
}

/**
 * Raddrizza l'immagine secondo il tag EXIF.
 *
 * imagerotate() ruota in senso ANTIORARIO: l'orientamento 6 ("ruotata di 90° in
 * senso orario dalla fotocamera") si corregge quindi con -90, non con +90.
 *
 * @param  GdImage $im
 * @return GdImage
 */
function imgApplyExifOrientation($im, string $path, string $mime)
{
    $orientation = imgExifOrientation($path, $mime);
    if ($orientation <= 1 || !function_exists('imagerotate')) {
        return $im;
    }

    $rotate = static function ($image, float $angle) {
        $rotated = @imagerotate($image, $angle, 0);

        return $rotated ?: $image;
    };

    switch ($orientation) {
        case 2:
            imageflip($im, IMG_FLIP_HORIZONTAL);
            break;
        case 3:
            $im = $rotate($im, 180);
            break;
        case 4:
            imageflip($im, IMG_FLIP_VERTICAL);
            break;
        case 5:
            $im = $rotate($im, -90);
            imageflip($im, IMG_FLIP_HORIZONTAL);
            break;
        case 6:
            $im = $rotate($im, -90);
            break;
        case 7:
            $im = $rotate($im, 90);
            imageflip($im, IMG_FLIP_HORIZONTAL);
            break;
        case 8:
            $im = $rotate($im, 90);
            break;
    }

    return $im;
}

/**
 * Verifica (e se serve alza) il memory_limit per reggere sorgente + destinazione.
 *
 * Una GD truecolor occupa ~4 byte per pixel: un JPEG da 3 MB a 6000x4000 sono
 * ~96 MB di RAM una volta decompresso, contro i 128 MB di default dell'immagine
 * PHP. Senza questo controllo l'upload andrebbe a buon fine e la richiesta
 * morirebbe subito dopo con un fatal error di memoria esaurita, lasciando la
 * riga a meta'. Meglio rinunciare al ridimensionamento e tenere l'originale.
 */
function imgReserveMemory(int $srcW, int $srcH, int $dstW, int $dstH): bool
{
    // +25% di margine per le copie temporanee di imagerotate/imagecopyresampled.
    $needed = (int) ((($srcW * $srcH) + ($dstW * $dstH)) * 4 * 1.25);

    $limit = imgMemoryLimitBytes();
    if ($limit < 0) {
        return true; // memory_limit = -1, nessun tetto
    }

    $available = $limit - memory_get_usage(true);
    if ($needed <= $available) {
        return true;
    }

    $target = memory_get_usage(true) + $needed + (32 * 1024 * 1024);
    if ($target > IMG_MEMORY_CEILING) {
        return false;
    }

    // Puo' fallire (ini_set disabilitato in hardening): in quel caso si rinuncia.
    if (@ini_set('memory_limit', (int) ceil($target / 1048576) . 'M') === false) {
        return false;
    }

    return imgMemoryLimitBytes() >= $target;
}

/** memory_limit in byte; -1 se illimitato. */
function imgMemoryLimitBytes(): int
{
    $raw = trim((string) ini_get('memory_limit'));
    if ($raw === '' || $raw === '-1') {
        return -1;
    }

    $unit  = strtolower(substr($raw, -1));
    $value = (int) $raw;

    return match ($unit) {
        'g'     => $value * 1024 * 1024 * 1024,
        'm'     => $value * 1024 * 1024,
        'k'     => $value * 1024,
        default => $value,
    };
}
