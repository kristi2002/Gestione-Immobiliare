<?php
require_once __DIR__ . '/auth.php';
initOwnerSession();
if (isOwnerLoggedIn()) {
    logoutOwner();
}
header('Location: login.php');
exit;
