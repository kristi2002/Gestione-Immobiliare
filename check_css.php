<?php
$css   = file_get_contents('/var/www/html/assets/css/style.css');
$open  = substr_count($css, '{');
$close = substr_count($css, '}');
echo 'Lines: ' . substr_count($css, "\n") . PHP_EOL;
echo "Braces {: $open   }: $close" . PHP_EOL;
echo ($open === $close) ? "BALANCED OK\n" : "MISMATCH!\n";
echo 'File size: ' . number_format(strlen($css)) . " bytes\n";
