<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/image_processing.php';

/**
 * Ridimensionamento delle foto immobile.
 *
 * I test che contano sono quelli negativi: questa libreria gira DENTRO l'upload,
 * dopo che il file e' gia' stato scritto su disco. Se lancia un'eccezione su un
 * formato che non conosce, l'agente si vede fallire un caricamento che era
 * andato a buon fine. Percio' ogni caso limite deve restituire false, non
 * esplodere — e l'originale deve restare dov'e'.
 */
class ImageProcessingTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        if (!imageProcessingAvailable()) {
            $this->markTestSkipped('GD non disponibile in questo runtime.');
        }

        $this->dir = sys_get_temp_dir() . '/imgproc_' . uniqid();
        mkdir($this->dir, 0777, true);
    }

    protected function tearDown(): void
    {
        if (!isset($this->dir) || !is_dir($this->dir)) {
            return;
        }
        foreach (glob($this->dir . '/*') ?: [] as $f) {
            @unlink($f);
        }
        @rmdir($this->dir);
    }

    private function makeJpeg(int $w, int $h, ?string $name = null): string
    {
        $im   = imagecreatetruecolor($w, $h);
        // Un gradiente, non una tinta piatta: un JPEG monocromo comprime a
        // pochi KB e nasconderebbe qualunque regressione sul peso.
        for ($y = 0; $y < $h; $y += 4) {
            $c = imagecolorallocate($im, ($y * 7) % 255, ($y * 3) % 255, 180);
            imagefilledrectangle($im, 0, $y, $w, $y + 4, $c);
        }
        $path = $this->dir . '/' . ($name ?? "img_{$w}x{$h}.jpg");
        imagejpeg($im, $path, 92);

        return $path;
    }

    // ── Riduzione dell'originale ─────────────────────────────────────────────

    public function testDownscalesAnOversizedPhotoKeepingTheAspectRatio(): void
    {
        $path = $this->makeJpeg(4000, 3000);
        $bytesBefore = filesize($path);

        $this->assertTrue(imageDownscaleInPlace($path, 'image/jpeg'));

        [$w, $h] = getimagesize($path);
        $this->assertSame(IMG_ORIGINAL_MAX_EDGE, $w);
        $this->assertSame(1920, $h, 'Il rapporto 4:3 deve restare 4:3.');
        $this->assertLessThan($bytesBefore, filesize($path));
    }

    public function testUsesTheLongEdgeOnPortraitPhotos(): void
    {
        $path = $this->makeJpeg(1800, 3200);

        $this->assertTrue(imageDownscaleInPlace($path, 'image/jpeg'));

        [$w, $h] = getimagesize($path);
        $this->assertSame(IMG_ORIGINAL_MAX_EDGE, $h, 'Su un verticale il vincolo e\' l\'altezza.');
        $this->assertSame(1440, $w);
    }

    /**
     * Il caso che protegge la qualita': una foto gia' piccola non va ricompressa.
     * Un secondo giro di JPEG non fa risparmiare nulla e degrada l'immagine, e
     * su un archivio ripassato piu' volte il danno si accumula.
     */
    public function testLeavesAnAlreadySmallImageByteIdentical(): void
    {
        $path   = $this->makeJpeg(800, 600);
        $before = md5_file($path);

        $this->assertFalse(imageDownscaleInPlace($path, 'image/jpeg'));
        $this->assertSame($before, md5_file($path));
    }

    // ── Miniature ────────────────────────────────────────────────────────────

    public function testWritesAThumbnailWithoutTouchingTheSource(): void
    {
        $src    = $this->makeJpeg(3000, 2000);
        $before = md5_file($src);
        $thumb  = $this->dir . '/thumb.jpg';

        $this->assertTrue(imageWriteThumbnail($src, $thumb, 'image/jpeg'));
        $this->assertFileExists($thumb);

        [$w, $h] = getimagesize($thumb);
        $this->assertSame(IMG_THUMB_MAX_EDGE, $w);
        $this->assertSame(427, $h);
        $this->assertSame($before, md5_file($src), 'La miniatura non deve riscrivere la sorgente.');
        $this->assertLessThan(filesize($src), filesize($thumb));
    }

    public function testThumbnailNeverUpscalesASmallImage(): void
    {
        $src   = $this->makeJpeg(320, 240);
        $thumb = $this->dir . '/thumb_small.jpg';

        $this->assertTrue(imageWriteThumbnail($src, $thumb, 'image/jpeg'));
        $this->assertSame([320, 240], array_slice(getimagesize($thumb), 0, 2));
    }

    public function testPreservesPngTransparency(): void
    {
        $im = imagecreatetruecolor(3000, 2000);
        imagealphablending($im, false);
        imagesavealpha($im, true);
        imagefilledrectangle($im, 0, 0, 3000, 2000, imagecolorallocatealpha($im, 0, 0, 0, 127));
        imagefilledellipse($im, 1500, 1000, 1200, 800, imagecolorallocatealpha($im, 255, 0, 0, 0));
        $src = $this->dir . '/alpha.png';
        imagepng($im, $src);

        $thumb = $this->dir . '/alpha_thumb.png';
        $this->assertTrue(imageWriteThumbnail($src, $thumb, 'image/png'));

        $t      = imagecreatefrompng($thumb);
        $corner = imagecolorsforindex($t, imagecolorat($t, 1, 1));
        $center = imagecolorsforindex($t, imagecolorat($t, (int) (imagesx($t) / 2), (int) (imagesy($t) / 2)));

        $this->assertSame(127, $corner['alpha'], 'Lo sfondo trasparente non deve diventare nero.');
        $this->assertSame(0, $center['alpha']);
        $this->assertSame(255, $center['red']);
    }

    // ── Guardie: tutto quello che NON deve essere toccato ────────────────────

    public function testRefusesFormatsItCannotResampleSafely(): void
    {
        // La GIF e' esclusa apposta: GD ne salverebbe solo il primo fotogramma.
        $this->assertFalse(imageIsProcessable('image/gif'));
        $this->assertFalse(imageIsProcessable('video/mp4'));
        $this->assertFalse(imageIsProcessable('application/pdf'));
        $this->assertFalse(imageIsProcessable(''));
    }

    public function testReturnsFalseInsteadOfThrowingOnAFileThatIsNotAnImage(): void
    {
        $fake = $this->dir . '/finta.jpg';
        file_put_contents($fake, "<?php echo 'non sono una foto';");

        $this->assertFalse(imageDownscaleInPlace($fake, 'image/jpeg'));
        $this->assertFalse(imageWriteThumbnail($fake, $this->dir . '/out.jpg', 'image/jpeg'));
        $this->assertFileDoesNotExist($this->dir . '/out.jpg');
        $this->assertStringContainsString('non sono una foto', file_get_contents($fake));
    }

    public function testReturnsFalseOnAMissingFile(): void
    {
        $this->assertFalse(imageDownscaleInPlace($this->dir . '/assente.jpg', 'image/jpeg'));
        $this->assertFalse(imageWriteThumbnail($this->dir . '/assente.jpg', $this->dir . '/t.jpg', 'image/jpeg'));
    }

    /**
     * Il guardrail sulla memoria: un'immagine talmente grande da non starci in
     * RAM deve far rinunciare al ridimensionamento, non uccidere la richiesta
     * per memoria esaurita quando il file e' gia' stato salvato.
     */
    public function testGivesUpWhenTheImageWouldNotFitInMemory(): void
    {
        // 40.000 x 40.000 px ≈ 6,4 GB di bitmap: sopra qualunque tetto sensato.
        $this->assertFalse(imgReserveMemory(40000, 40000, 2560, 2560));
    }

    public function testAllowsAnImageThatComfortablyFits(): void
    {
        $this->assertTrue(imgReserveMemory(800, 600, 640, 480));
    }

    // ── Calcolo del riquadro ─────────────────────────────────────────────────

    public function testFitBoxNeverEnlargesAndNeverCollapsesToZero(): void
    {
        $this->assertSame([800, 600], imgFitBox(800, 600, 2560));
        $this->assertSame([640, 640], imgFitBox(640, 640, 640));
        $this->assertSame([1, 1], imgFitBox(1, 1, 640));
        $this->assertSame([2560, 1920], imgFitBox(4000, 3000, 2560));
        $this->assertSame([1440, 2560], imgFitBox(1800, 3200, 2560));

        // Panoramica estrema: il lato corto arrotonda a 1, mai a 0.
        [$w, $h] = imgFitBox(20000, 3, 640);
        $this->assertSame(640, $w);
        $this->assertGreaterThanOrEqual(1, $h);
    }

    public function testMemoryLimitParsingHandlesEveryUnit(): void
    {
        $original = ini_get('memory_limit');

        ini_set('memory_limit', '256M');
        $this->assertSame(268435456, imgMemoryLimitBytes());

        ini_set('memory_limit', '1G');
        $this->assertSame(1073741824, imgMemoryLimitBytes());

        ini_set('memory_limit', '-1');
        $this->assertSame(-1, imgMemoryLimitBytes(), 'Nessun tetto = nessun limite da rispettare.');

        ini_set('memory_limit', $original);
    }
}
