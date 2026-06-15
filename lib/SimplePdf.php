<?php
/**
 * Minimal PDF generator (no external dependencies).
 */
class SimplePdf
{
    private array $objects = [];
    private array $pages = [];
    private int $objectCount = 0;

    public function __construct(
        private string $title = 'Document',
        private array $lines = [],
        private string $author = 'Gestionale Immobiliare'
    ) {}

    public static function fromText(string $title, array $lines, string $author = 'Gestionale Immobiliare'): self
    {
        return new self($title, $lines, $author);
    }

    public function output(): string
    {
        $this->objectCount = 0;
        $this->objects = [];
        $this->pages = [];

        $fontId   = $this->addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
        $content  = $this->buildContentStream();
        $contentId = $this->addObject("<< /Length " . strlen($content) . " >>\nstream\n{$content}\nendstream");
        $pageId   = $this->addObject("<< /Type /Page /Parent {{PAGES}} 0 R /MediaBox [0 0 595 842] /Contents {$contentId} 0 R /Resources << /Font << /F1 {$fontId} 0 R >> >> >>");
        $this->pages[] = $pageId;
        $kids = implode(' ', array_map(fn($id) => "{$id} 0 R", $this->pages));
        $pagesId = $this->addObject("<< /Type /Pages /Kids [{$kids}] /Count " . count($this->pages) . " >>");

        foreach ($this->pages as &$pageObj) {
            $pageObj = str_replace('{{PAGES}}', (string) $pagesId, $pageObj);
        }
        unset($pageObj);
        $this->objects[$pageId - 1] = str_replace('{{PAGES}}', (string) $pagesId, $this->objects[$pageId - 1]);

        $catalogId = $this->addObject("<< /Type /Catalog /Pages {$pagesId} 0 R >>");

        $pdf = "%PDF-1.4\n";
        $offsets = [0];
        for ($i = 0; $i < count($this->objects); $i++) {
            $offsets[] = strlen($pdf);
            $pdf .= ($i + 1) . " 0 obj\n" . $this->objects[$i] . "\nendobj\n";
        }

        $xrefPos = strlen($pdf);
        $pdf .= "xref\n0 " . (count($this->objects) + 1) . "\n";
        $pdf .= "0000000000 65535 f \n";
        for ($i = 1; $i <= count($this->objects); $i++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
        }
        $pdf .= "trailer\n<< /Size " . (count($this->objects) + 1) . " /Root {$catalogId} 0 R /Info << /Title ({$this->escape($this->title)}) /Author ({$this->escape($this->author)}) >> >>\n";
        $pdf .= "startxref\n{$xrefPos}\n%%EOF";

        return $pdf;
    }

    private function buildContentStream(): string
    {
        $stream = "BT\n/F1 12 Tf\n50 800 Td\n14 TL\n";
        foreach ($this->lines as $line) {
            $stream .= '(' . $this->escape($line) . ") Tj T*\n";
        }
        $stream .= "ET";
        return $stream;
    }

    private function addObject(string $content): int
    {
        $this->objects[] = $content;
        return count($this->objects);
    }

    private function escape(string $text): string
    {
        return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $text);
    }
}
