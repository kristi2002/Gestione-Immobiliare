<?php
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/settings.php';

header('Content-Type: text/css; charset=utf-8');
header('Cache-Control: public, max-age=300');

$primary = preg_replace('/[^#a-fA-F0-9]/', '', getSetting('primary_color', '#206bac')) ?: '#206bac';
$sidebar = preg_replace('/[^#a-fA-F0-9]/', '', getSetting('sidebar_color', '#0d2140')) ?: '#0d2140';

if (!str_starts_with($primary, '#')) $primary = '#' . $primary;
if (!str_starts_with($sidebar, '#')) $sidebar = '#' . $sidebar;

echo ":root {\n";
echo "  --color-primary: {$primary};\n";
echo "  --color-primary-dark: {$primary};\n";
echo "  --color-sidebar-bg: {$sidebar};\n";
echo "  --color-sidebar-active: {$primary};\n";
echo "}\n";
