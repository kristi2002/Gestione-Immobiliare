<?php
/**
 * Minimal PDF generator (no external dependencies).
 *
 * Two ways to build a document:
 *   1. SimplePdf::fromText($title, $lines)          — plain text lines (legacy).
 *   2. SimplePdf::fromBlocks($title, $blocks, $opts) — styled, structured layout.
 *
 * Block types (for fromBlocks):
 *   ['type' => 'h2',        'text' => 'Section title']
 *   ['type' => 'kv',        'pairs' => [['Label', 'Value'], ...]]
 *   ['type' => 'price',     'label' => 'Prezzo', 'value' => '250.000 €', 'note' => 'Vendita']
 *   ['type' => 'paragraph', 'text' => '...']
 *   ['type' => 'bullets',   'items' => ['a', 'b']]
 *   ['type' => 'image',     'path' => '/abs/path.jpg', 'maxHeight' => 220]
 *   ['type' => 'divider']
 *   ['type' => 'spacer',    'height' => 10]
 *   ['type' => 'text',      'text' => 'plain line']
 */
class SimplePdf
{
    private const PW = 595;   // A4 width  (pt)
    private const PH = 842;   // A4 height (pt)
    private const MX = 50;    // left/right margin
    private const MB = 55;    // bottom margin

    private array $objects = [];
    private array $images  = [];   // name => ['path'=>, 'w'=>, 'h'=>, 'data'=>, 'cs'=>]
    private array $pageContents = [];
    private string $buf = '';
    private float $y = 0;
    private int $pageNo = 0;

    public function __construct(
        private string $title = 'Document',
        private array $blocks = [],
        private string $author = 'Gestionale Immobiliare',
        private array $opts = []
    ) {}

    public static function fromText(string $title, array $lines, string $author = 'Gestionale Immobiliare'): self
    {
        $blocks = array_map(fn($l) => ['type' => 'text', 'text' => (string) $l], $lines);
        return new self($title, $blocks, $author);
    }

    public static function fromBlocks(string $title, array $blocks, array $opts = []): self
    {
        return new self($title, $blocks, $opts['author'] ?? 'Gestionale Immobiliare', $opts);
    }

    // -- Colors -------------------------------------------------------------

    private array $brand   = [0.145, 0.388, 0.922]; // #2563eb
    private array $dark    = [0.118, 0.161, 0.231];
    private array $body    = [0.231, 0.275, 0.337];
    private array $muted   = [0.451, 0.498, 0.561];
    private array $hairline = [0.851, 0.878, 0.910];
    private array $white   = [1, 1, 1];

    private static function hexToRgb(string $hex, array $fallback): array
    {
        $hex = ltrim(trim($hex), '#');
        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        if (strlen($hex) !== 6 || !ctype_xdigit($hex)) {
            return $fallback;
        }
        return [
            hexdec(substr($hex, 0, 2)) / 255,
            hexdec(substr($hex, 2, 2)) / 255,
            hexdec(substr($hex, 4, 2)) / 255,
        ];
    }

    private static function tint(array $rgb, float $amount): array
    {
        // mix toward white; amount = how much of the original colour to keep
        return [
            1 - (1 - $rgb[0]) * $amount,
            1 - (1 - $rgb[1]) * $amount,
            1 - (1 - $rgb[2]) * $amount,
        ];
    }

    // -- Public render ------------------------------------------------------

    public function output(): string
    {
        if (!empty($this->opts['brand'])) {
            $this->brand = self::hexToRgb((string) $this->opts['brand'], $this->brand);
        }

        // Pre-load any images referenced by blocks.
        foreach ($this->blocks as &$block) {
            if (($block['type'] ?? '') === 'image' && !empty($block['path'])) {
                $name = $this->registerImage($block['path']);
                if ($name) {
                    $block['_img'] = $name;
                }
            }
        }
        unset($block);

        $this->pageContents = [];
        $this->pageNo = 0;
        $this->startPage(true);
        $this->renderBlocks();
        $this->finalizePage();

        return $this->assemble();
    }

    // -- Page lifecycle -----------------------------------------------------

    private function startPage(bool $first): void
    {
        $this->buf = '';
        $this->pageNo++;
        $this->y = self::PH - self::MX;

        if (!empty($this->opts['banner'])) {
            $first ? $this->drawBanner() : $this->drawContinuationHeader();
        }
    }

    private function finalizePage(): void
    {
        $footer = $this->opts['footer'] ?? null;
        $this->line(self::MX, self::MB - 4, self::PW - self::MX, self::MB - 4, $this->hairline, 0.6);
        if ($footer) {
            $this->textRaw(self::MX, self::MB - 16, (string) $footer, 8, 'F1', $this->muted);
        }
        $this->textRight(self::PW - self::MX, self::MB - 16, 'Pag. ' . $this->pageNo, 8, 'F1', $this->muted);

        $this->pageContents[] = $this->buf;
    }

    private function ensureSpace(float $needed): void
    {
        if ($this->y - $needed < self::MB + 6) {
            $this->finalizePage();
            $this->startPage(false);
        }
    }

    // -- Banner -------------------------------------------------------------

    private function drawBanner(): void
    {
        $bh = 100;
        $top = self::PH;
        $this->rect(0, $top - $bh, self::PW, $bh, $this->brand);

        $textX = self::MX;
        if (!empty($this->opts['logo'])) {
            $name = $this->registerImage($this->opts['logo']);
            if ($name) {
                $img = $this->images[$name];
                $h = 44;
                $w = $h * ($img['w'] / max(1, $img['h']));
                if ($w > 130) { $w = 130; $h = $w * ($img['h'] / max(1, $img['w'])); }
                $this->drawImage($name, self::MX, $top - 30 - $h, $w, $h);
                $textX = self::MX + $w + 16;
            }
        }

        $agency = (string) ($this->opts['agency'] ?? $this->author);
        $this->textRaw($textX, $top - 40, $agency, 20, 'F2', $this->white);

        if (!empty($this->opts['subtitle'])) {
            $this->textRaw($textX, $top - 58, (string) $this->opts['subtitle'], 9.5, 'F1', [0.88, 0.92, 1]);
        }

        $this->textRaw($textX, $top - 82, strtoupper((string) ($this->opts['title'] ?? $this->title)), 12.5, 'F2', [0.82, 0.88, 1]);

        if (!empty($this->opts['meta'])) {
            $this->textRight(self::PW - self::MX, $top - 40, (string) $this->opts['meta'], 9.5, 'F1', [0.88, 0.92, 1]);
        }
        if (!empty($this->opts['meta2'])) {
            $this->textRight(self::PW - self::MX, $top - 56, (string) $this->opts['meta2'], 9.5, 'F1', [0.88, 0.92, 1]);
        }

        $this->y = $top - $bh - 26;
    }

    private function drawContinuationHeader(): void
    {
        $hh = 38;
        $top = self::PH;
        $this->rect(0, $top - $hh, self::PW, $hh, $this->brand);
        $this->textRaw(self::MX, $top - 25, (string) ($this->opts['agency'] ?? $this->author), 12, 'F2', $this->white);
        $this->textRight(self::PW - self::MX, $top - 25, strtoupper((string) ($this->opts['title'] ?? $this->title)), 9, 'F1', [0.85, 0.9, 1]);
        $this->y = $top - $hh - 24;
    }

    // -- Block renderer -----------------------------------------------------

    private function renderBlocks(): void
    {
        foreach ($this->blocks as $block) {
            switch ($block['type'] ?? 'text') {
                case 'h2':        $this->renderHeading((string) ($block['text'] ?? '')); break;
                case 'kv':        $this->renderKv($block['pairs'] ?? []); break;
                case 'price':     $this->renderPrice($block); break;
                case 'paragraph': $this->renderParagraph((string) ($block['text'] ?? '')); break;
                case 'bullets':   $this->renderBullets($block['items'] ?? []); break;
                case 'image':     $this->renderImage($block); break;
                case 'table':     $this->renderTable($block); break;
                case 'signatures':$this->renderSignatures($block['items'] ?? []); break;
                case 'divider':   $this->renderDivider(); break;
                case 'spacer':    $this->moveDown((float) ($block['height'] ?? 10)); break;
                case 'text':
                default:          $this->renderTextLine((string) ($block['text'] ?? '')); break;
            }
        }
    }

    private function renderHeading(string $text): void
    {
        $this->ensureSpace(40);
        $this->moveDown(10);
        $this->rect(self::MX, $this->y - 11, 4, 13, $this->brand);
        $this->textRaw(self::MX + 12, $this->y - 11, $text, 12.5, 'F2', $this->dark);
        $this->moveDown(18);
        $this->line(self::MX, $this->y, self::PW - self::MX, $this->y, $this->hairline, 0.8);
        $this->moveDown(14);
    }

    private function renderKv(array $pairs): void
    {
        $pairs = array_values(array_filter($pairs, fn($p) => is_array($p) && isset($p[0])));
        $contentW = self::PW - 2 * self::MX;
        $colW = $contentW / 2;
        $rowH = 34;

        for ($i = 0; $i < count($pairs); $i += 2) {
            $this->ensureSpace($rowH);
            $top = $this->y;
            $this->renderKvCell($pairs[$i], self::MX, $top, $colW - 14);
            if (isset($pairs[$i + 1])) {
                $this->renderKvCell($pairs[$i + 1], self::MX + $colW, $top, $colW - 14);
            }
            $this->moveDown($rowH);
        }
        $this->moveDown(4);
    }

    private function renderKvCell(array $pair, float $x, float $topY, float $w): void
    {
        $label = strtoupper((string) ($pair[0] ?? ''));
        $value = (string) ($pair[1] ?? '—');
        if ($value === '') {
            $value = '—';
        }
        $value = $this->truncate($value, 11, $w);
        $this->textRaw($x, $topY - 9, $label, 8, 'F2', $this->muted);
        $this->textRaw($x, $topY - 24, $value, 11.5, 'F1', $this->body);
    }

    private function renderPrice(array $block): void
    {
        $boxH = 50;
        $this->ensureSpace($boxH + 12);
        $this->moveDown(2);
        $top = $this->y;
        $contentW = self::PW - 2 * self::MX;

        $this->rect(self::MX, $top - $boxH, $contentW, $boxH, self::tint($this->brand, 0.12));
        $this->rect(self::MX, $top - $boxH, 4, $boxH, $this->brand);

        $this->textRaw(self::MX + 18, $top - 18, strtoupper((string) ($block['label'] ?? 'Prezzo')), 8.5, 'F2', $this->muted);
        $this->textRaw(self::MX + 18, $top - 41, (string) ($block['value'] ?? '—'), 20, 'F2', $this->brand);

        if (!empty($block['note'])) {
            $this->textRight(self::PW - self::MX - 18, $top - 32, (string) $block['note'], 11, 'F1', $this->body);
        }

        $this->moveDown($boxH + 12);
    }

    private function renderParagraph(string $text): void
    {
        if (trim($text) === '') {
            $text = '—';
        }
        foreach ($this->wrap($text, 10.5, self::PW - 2 * self::MX) as $line) {
            $this->ensureSpace(15);
            $this->textRaw(self::MX, $this->y - 10.5, $line, 10.5, 'F1', $this->body);
            $this->moveDown(15);
        }
        $this->moveDown(4);
    }

    private function renderBullets(array $items): void
    {
        foreach ($items as $item) {
            $lines = $this->wrap((string) $item, 10.5, self::PW - 2 * self::MX - 16);
            foreach ($lines as $idx => $line) {
                $this->ensureSpace(15);
                if ($idx === 0) {
                    $this->rect(self::MX + 1, $this->y - 8, 3, 3, $this->brand);
                }
                $this->textRaw(self::MX + 14, $this->y - 10.5, $line, 10.5, 'F1', $this->body);
                $this->moveDown(15);
            }
        }
        $this->moveDown(4);
    }

    private function renderImage(array $block): void
    {
        $name = $block['_img'] ?? null;
        if (!$name || !isset($this->images[$name])) {
            return;
        }
        $img = $this->images[$name];
        $contentW = self::PW - 2 * self::MX;
        $maxH = (float) ($block['maxHeight'] ?? 230);

        $w = $contentW;
        $h = $w * ($img['h'] / max(1, $img['w']));
        if ($h > $maxH) {
            $h = $maxH;
            $w = $h * ($img['w'] / max(1, $img['h']));
        }

        $this->ensureSpace($h + 12);
        $this->moveDown(2);
        $x = self::MX + ($contentW - $w) / 2;
        $this->drawImage($name, $x, $this->y - $h, $w, $h);
        $this->moveDown($h + 12);
    }

    private function renderTable(array $block): void
    {
        $cols = $block['columns'] ?? [];
        $rows = $block['rows'] ?? [];
        if (!$cols) {
            return;
        }

        $contentW = self::PW - 2 * self::MX;
        $colCount = count($cols);
        $totalW = 0;
        foreach ($cols as $c) {
            $totalW += $c['width'] ?? (1 / $colCount);
        }
        $pad = 6;
        $hh  = 22;
        $rh  = (float) ($block['rowHeight'] ?? 20);

        $widthOf = fn(array $c) => (($c['width'] ?? (1 / $colCount)) / $totalW) * $contentW;

        $drawHeader = function () use ($cols, $contentW, $widthOf, $pad, $hh, $rh): void {
            $this->ensureSpace($hh + $rh);
            $top = $this->y;
            $this->rect(self::MX, $top - $hh, $contentW, $hh, self::tint($this->brand, 0.14));
            $x = self::MX;
            foreach ($cols as $c) {
                $w = $widthOf($c);
                $this->cellText((string) ($c['label'] ?? ''), $x, $top - 15, $w, $pad, 9, 'F2', $this->dark, $c['align'] ?? 'left');
                $x += $w;
            }
            $this->moveDown($hh);
        };

        $drawHeader();

        $i = 0;
        foreach ($rows as $row) {
            if ($this->y - $rh < self::MB + 6) {
                $this->finalizePage();
                $this->startPage(false);
                $drawHeader();
            }
            $top = $this->y;
            if ($i % 2 === 1) {
                $this->rect(self::MX, $top - $rh, $contentW, $rh, [0.965, 0.975, 0.99]);
            }
            $x = self::MX;
            foreach ($cols as $ci => $c) {
                $w = $widthOf($c);
                $this->cellText((string) ($row[$ci] ?? ''), $x, $top - 13.5, $w, $pad, 9.5, 'F1', $this->body, $c['align'] ?? 'left');
                $x += $w;
            }
            $this->line(self::MX, $top - $rh, self::PW - self::MX, $top - $rh, $this->hairline, 0.5);
            $this->moveDown($rh);
            $i++;
        }

        if (empty($rows)) {
            $this->ensureSpace($rh);
            $this->textRaw(self::MX + $pad, $this->y - 13.5, (string) ($block['empty'] ?? 'Nessun dato.'), 9.5, 'F1', $this->muted);
            $this->moveDown($rh);
        }

        // Optional total row (label spanning, value right-aligned)
        if (!empty($block['totalLabel'])) {
            $this->ensureSpace($rh + 2);
            $top = $this->y;
            $this->rect(self::MX, $top - $rh, $contentW, $rh, self::tint($this->brand, 0.18));
            $this->cellText((string) $block['totalLabel'], self::MX, $top - 13.5, $contentW * 0.6, $pad, 10, 'F2', $this->dark, 'left');
            $this->cellText((string) ($block['totalValue'] ?? ''), self::MX + $contentW * 0.6, $top - 13.5, $contentW * 0.4, $pad, 10.5, 'F2', $this->brand, 'right');
            $this->moveDown($rh);
        }

        $this->moveDown(8);
    }

    private function cellText(string $text, float $x, float $baseline, float $w, float $pad, float $size, string $font, array $rgb, string $align): void
    {
        $text = $this->truncate($text, $size, $w - 2 * $pad);
        if ($align === 'right') {
            $tx = $x + $w - $pad - $this->estWidth($text, $size, $font);
        } elseif ($align === 'center') {
            $tx = $x + ($w - $this->estWidth($text, $size, $font)) / 2;
        } else {
            $tx = $x + $pad;
        }
        $this->textRaw($tx, $baseline, $text, $size, $font, $rgb);
    }

    private function renderSignatures(array $items): void
    {
        $items = array_values(array_filter($items, fn($v) => $v !== null && $v !== ''));
        if (!$items) {
            return;
        }
        $this->moveDown(26);
        $contentW = self::PW - 2 * self::MX;
        $colW = $contentW / 2;

        for ($i = 0; $i < count($items); $i += 2) {
            $this->ensureSpace(46);
            $top = $this->y;
            for ($j = 0; $j < 2 && ($i + $j) < count($items); $j++) {
                $x = self::MX + $j * $colW;
                $lineW = $colW - 36;
                $this->line($x, $top - 2, $x + $lineW, $top - 2, $this->muted, 0.7);
                $this->textRaw($x, $top - 15, (string) $items[$i + $j], 9, 'F1', $this->muted);
            }
            $this->moveDown(48);
        }
        $this->moveDown(2);
    }

    private function renderDivider(): void
    {
        $this->ensureSpace(14);
        $this->moveDown(4);
        $this->line(self::MX, $this->y, self::PW - self::MX, $this->y, $this->hairline, 0.6);
        $this->moveDown(10);
    }

    private function renderTextLine(string $text): void
    {
        if ($text === '') {
            $this->moveDown(13);
            return;
        }
        foreach ($this->wrap($text, 11, self::PW - 2 * self::MX) as $line) {
            $this->ensureSpace(15);
            $this->textRaw(self::MX, $this->y - 11, $line, 11, 'F1', [0, 0, 0]);
            $this->moveDown(15);
        }
    }

    // -- Low-level drawing --------------------------------------------------

    private function moveDown(float $d): void
    {
        $this->y -= $d;
    }

    private function textRaw(float $x, float $y, string $str, float $size, string $font, array $rgb): void
    {
        $this->buf .= sprintf("%.3f %.3f %.3f rg\n", $rgb[0], $rgb[1], $rgb[2]);
        $this->buf .= sprintf("BT /%s %.2f Tf 1 0 0 1 %.2f %.2f Tm (%s) Tj ET\n", $font, $size, $x, $y, $this->prepare($str));
        $this->buf .= "0 0 0 rg\n";
    }

    private function textRight(float $xRight, float $y, string $str, float $size, string $font, array $rgb): void
    {
        $w = $this->estWidth($str, $size, $font);
        $this->textRaw($xRight - $w, $y, $str, $size, $font, $rgb);
    }

    private function rect(float $x, float $y, float $w, float $h, array $rgb): void
    {
        $this->buf .= sprintf("%.3f %.3f %.3f rg\n%.2f %.2f %.2f %.2f re f\n0 0 0 rg\n", $rgb[0], $rgb[1], $rgb[2], $x, $y, $w, $h);
    }

    private function line(float $x1, float $y1, float $x2, float $y2, array $rgb, float $lw): void
    {
        $this->buf .= sprintf("%.2f w %.3f %.3f %.3f RG\n%.2f %.2f m %.2f %.2f l S\n0 0 0 RG\n", $lw, $rgb[0], $rgb[1], $rgb[2], $x1, $y1, $x2, $y2);
    }

    private function drawImage(string $name, float $x, float $y, float $w, float $h): void
    {
        $this->buf .= sprintf("q %.2f 0 0 %.2f %.2f %.2f cm /%s Do Q\n", $w, $h, $x, $y, $name);
    }

    // -- Text helpers -------------------------------------------------------

    private function prepare(string $s): string
    {
        if (function_exists('iconv')) {
            $c = @iconv('UTF-8', 'Windows-1252//TRANSLIT//IGNORE', $s);
            if ($c !== false) {
                $s = $c;
            }
        } elseif (function_exists('mb_convert_encoding')) {
            $s = @mb_convert_encoding($s, 'Windows-1252', 'UTF-8');
        }
        return str_replace(['\\', '(', ')', "\r", "\n", "\t"], ['\\\\', '\\(', '\\)', '', ' ', ' '], $s);
    }

    private function estWidth(string $s, float $size, string $font = 'F1'): float
    {
        $len = function_exists('mb_strlen') ? mb_strlen($s) : strlen($s);
        $factor = ($font === 'F2') ? 0.54 : 0.5;
        return $len * $size * $factor;
    }

    private function wrap(string $text, float $size, float $maxWidth): array
    {
        $out = [];
        $maxChars = max(8, (int) floor($maxWidth / ($size * 0.5)));
        foreach (preg_split('/\r\n|\r|\n/', $text) as $paragraph) {
            if ($paragraph === '') {
                $out[] = '';
                continue;
            }
            foreach (explode("\n", wordwrap($paragraph, $maxChars, "\n", true)) as $line) {
                $out[] = $line;
            }
        }
        return $out;
    }

    private function truncate(string $s, float $size, float $maxWidth): string
    {
        if ($this->estWidth($s, $size) <= $maxWidth) {
            return $s;
        }
        $maxChars = max(4, (int) floor($maxWidth / ($size * 0.5)) - 1);
        $cut = function_exists('mb_substr') ? mb_substr($s, 0, $maxChars) : substr($s, 0, $maxChars);
        return rtrim($cut) . '…';
    }

    // -- Images -------------------------------------------------------------

    private function registerImage(string $path): ?string
    {
        if (!is_file($path) || !is_readable($path)) {
            return null;
        }
        $data = @file_get_contents($path);
        if ($data === false || $data === '') {
            return null;
        }
        $info = $this->parseJpeg($data);
        if (!$info) {
            return null; // only JPEG embedding is supported
        }
        $name = 'Img' . (count($this->images) + 1);
        $this->images[$name] = [
            'w'    => $info['w'],
            'h'    => $info['h'],
            'cs'   => $info['cs'],
            'data' => $data,
        ];
        return $name;
    }

    private function parseJpeg(string $data): ?array
    {
        $len = strlen($data);
        if ($len < 4 || ord($data[0]) !== 0xFF || ord($data[1]) !== 0xD8) {
            return null;
        }
        $i = 2;
        while ($i < $len - 1) {
            if (ord($data[$i]) !== 0xFF) {
                $i++;
                continue;
            }
            $marker = ord($data[$i + 1]);
            $i += 2;
            // Standalone markers without length
            if ($marker === 0xD8 || $marker === 0xD9 || ($marker >= 0xD0 && $marker <= 0xD7)) {
                continue;
            }
            if ($i + 1 >= $len) {
                break;
            }
            $segLen = (ord($data[$i]) << 8) + ord($data[$i + 1]);
            // SOF markers (frame headers) carry the dimensions
            $isSof = ($marker >= 0xC0 && $marker <= 0xCF)
                && !in_array($marker, [0xC4, 0xC8, 0xCC], true);
            if ($isSof && $i + 7 < $len) {
                $h = (ord($data[$i + 3]) << 8) + ord($data[$i + 4]);
                $w = (ord($data[$i + 5]) << 8) + ord($data[$i + 6]);
                $comp = ord($data[$i + 7]);
                $cs = $comp === 1 ? 'DeviceGray' : ($comp === 4 ? 'DeviceCMYK' : 'DeviceRGB');
                if ($w > 0 && $h > 0) {
                    return ['w' => $w, 'h' => $h, 'cs' => $cs];
                }
                return null;
            }
            $i += $segLen;
        }
        return null;
    }

    // -- PDF assembly -------------------------------------------------------

    private function assemble(): string
    {
        $this->objects = [];

        $f1 = $this->addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        $f2 = $this->addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

        $xobjRes = '';
        foreach ($this->images as $name => $img) {
            $dict = sprintf(
                "<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /%s /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n",
                $img['w'], $img['h'], $img['cs'], strlen($img['data'])
            );
            $id = $this->addObject($dict . $img['data'] . "\nendstream");
            $xobjRes .= "/{$name} {$id} 0 R ";
        }

        $resources = "<< /Font << /F1 {$f1} 0 R /F2 {$f2} 0 R >>"
            . ($xobjRes !== '' ? " /XObject << {$xobjRes}>>" : '')
            . " >>";

        $pageIds = [];
        foreach ($this->pageContents as $content) {
            $cid = $this->addObject("<< /Length " . strlen($content) . " >>\nstream\n{$content}\nendstream");
            $pageIds[] = $this->addObject(
                "<< /Type /Page /Parent {{PAGES}} 0 R /MediaBox [0 0 " . self::PW . " " . self::PH . "] /Contents {$cid} 0 R /Resources {$resources} >>"
            );
        }

        $kids = implode(' ', array_map(fn($id) => "{$id} 0 R", $pageIds));
        $pagesId = $this->addObject("<< /Type /Pages /Kids [{$kids}] /Count " . count($pageIds) . " >>");

        foreach ($this->objects as $idx => $obj) {
            $this->objects[$idx] = str_replace('{{PAGES}}', (string) $pagesId, $obj);
        }

        $catalogId = $this->addObject("<< /Type /Catalog /Pages {$pagesId} 0 R >>");

        $pdf = "%PDF-1.4\n";
        $offsets = [0];
        foreach ($this->objects as $i => $obj) {
            $offsets[] = strlen($pdf);
            $pdf .= ($i + 1) . " 0 obj\n" . $obj . "\nendobj\n";
        }

        $xrefPos = strlen($pdf);
        $count = count($this->objects);
        $pdf .= "xref\n0 " . ($count + 1) . "\n";
        $pdf .= "0000000000 65535 f \n";
        for ($i = 1; $i <= $count; $i++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
        }
        $pdf .= "trailer\n<< /Size " . ($count + 1) . " /Root {$catalogId} 0 R /Info << /Title (" . $this->prepare($this->title) . ") /Author (" . $this->prepare($this->author) . ") >> >>\n";
        $pdf .= "startxref\n{$xrefPos}\n%%EOF";

        return $pdf;
    }

    private function addObject(string $content): int
    {
        $this->objects[] = $content;
        return count($this->objects);
    }
}
