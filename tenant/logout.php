<?php
require_once __DIR__ . '/../config/bootstrap.php';
initTenantSession();
if (!isTenantLoggedIn()) {
    header('Location: login.php');
    exit;
}
logoutTenant();
header('Location: login.php');
exit;
