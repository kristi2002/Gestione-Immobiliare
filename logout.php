<?php
require_once __DIR__ . '/config/bootstrap.php';
logoutUser();
header('Location: login.php');
exit;
