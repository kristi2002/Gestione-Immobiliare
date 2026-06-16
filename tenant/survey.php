<?php
/**
 * Public tenant satisfaction survey — accessed via token link.
 * No session required.
 *
 * GET  /tenant/survey.php?token=XXXX  — show form
 * POST /tenant/survey.php?token=XXXX  — submit survey
 */

require_once __DIR__ . '/../config/db.php';

$db     = getDB();
$token  = trim($_GET['token'] ?? '');
$error  = '';
$done   = false;

// ── Resolve survey by token ─────────────────────────────────────────────────────
$survey = null;
if ($token !== '') {
    $stmt = $db->prepare(
        'SELECT id, tenant_id, property_id, submitted_at
           FROM tenant_surveys
          WHERE token = :token
          LIMIT 1'
    );
    $stmt->execute([':token' => $token]);
    $survey = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
}

$alreadySubmitted = $survey && !empty($survey['submitted_at']);

// ── Handle POST ─────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $survey && !$alreadySubmitted) {
    $overall       = isset($_POST['overall_rating'])       ? (int) $_POST['overall_rating']       : null;
    $maintenance   = isset($_POST['maintenance_rating'])   ? (int) $_POST['maintenance_rating']   : null;
    $communication = isset($_POST['communication_rating']) ? (int) $_POST['communication_rating'] : null;
    $comment       = trim($_POST['comment'] ?? '');

    // Validate ratings 1–5
    $valid = function (?int $v): ?int {
        return ($v !== null && $v >= 1 && $v <= 5) ? $v : null;
    };
    $overall       = $valid($overall);
    $maintenance   = $valid($maintenance);
    $communication = $valid($communication);

    if ($overall === null) {
        $error = 'Seleziona almeno la valutazione generale.';
    } else {
        $upd = $db->prepare(
            'UPDATE tenant_surveys
                SET overall_rating       = :overall,
                    maintenance_rating   = :maint,
                    communication_rating = :comm,
                    comment              = :comment,
                    submitted_at         = NOW()
              WHERE id = :id'
        );
        $upd->execute([
            ':overall' => $overall,
            ':maint'   => $maintenance,
            ':comm'    => $communication,
            ':comment' => $comment ?: null,
            ':id'      => (int) $survey['id'],
        ]);
        $done = true;
    }
}

function esc(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

function starInputs(string $name, string $label): void
{
    echo '<div class="field">';
    echo '<label>' . esc($label) . '</label>';
    echo '<div class="stars">';
    for ($i = 1; $i <= 5; $i++) {
        $checked = (isset($_POST[$name]) && (int)$_POST[$name] === $i) ? ' checked' : '';
        echo '<label class="star-label">'
            . '<input type="radio" name="' . esc($name) . '" value="' . $i . '"' . $checked . '>'
            . '<span class="star">&#9733;</span>'
            . '</label>';
    }
    echo '</div></div>';
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sondaggio soddisfazione inquilino</title>
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #f1f5f9;
            color: #1e293b;
            min-height: 100vh;
            padding: 24px 16px;
        }
        .card {
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 2px 16px rgba(0,0,0,.08);
            max-width: 540px;
            margin: 0 auto;
            padding: 36px 32px;
        }
        h1 {
            font-size: 1.4rem;
            margin-bottom: 8px;
            color: #1e293b;
        }
        .subtitle {
            font-size: .9rem;
            color: #64748b;
            margin-bottom: 28px;
        }
        .field { margin-bottom: 24px; }
        label { display: block; font-weight: 600; font-size: .9rem; margin-bottom: 8px; }
        textarea {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            font-size: .95rem;
            color: #1e293b;
            resize: vertical;
        }
        textarea:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px #2563eb22; }
        .stars { display: flex; gap: 6px; }
        .star-label {
            cursor: pointer;
            font-size: 0;
        }
        .star-label input { display: none; }
        .star {
            font-size: 2rem;
            color: #cbd5e1;
            transition: color .1s;
            display: inline-block;
        }
        .star-label input:checked ~ .star,
        .stars:hover .star-label:hover ~ .star-label .star { color: #cbd5e1; }
        .star-label:hover .star,
        .star-label input:checked ~ .star { color: #f59e0b; }
        /* Forward fill with CSS trick via :has (modern) */
        .stars:has(.star-label:nth-child(1) input:checked) .star-label:nth-child(1) .star { color: #f59e0b; }
        .stars:has(.star-label:nth-child(2) input:checked) .star-label:nth-child(1) .star,
        .stars:has(.star-label:nth-child(2) input:checked) .star-label:nth-child(2) .star { color: #f59e0b; }
        .stars:has(.star-label:nth-child(3) input:checked) .star-label:nth-child(1) .star,
        .stars:has(.star-label:nth-child(3) input:checked) .star-label:nth-child(2) .star,
        .stars:has(.star-label:nth-child(3) input:checked) .star-label:nth-child(3) .star { color: #f59e0b; }
        .stars:has(.star-label:nth-child(4) input:checked) .star-label:nth-child(-n+4) .star { color: #f59e0b; }
        .stars:has(.star-label:nth-child(5) input:checked) .star-label .star { color: #f59e0b; }
        .btn {
            background: #2563eb;
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 12px 24px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
        }
        .btn:hover { background: #1d4ed8; }
        .alert {
            border-radius: 6px;
            padding: 14px 16px;
            margin-bottom: 20px;
            font-size: .95rem;
        }
        .alert--success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
        .alert--error   { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
        .thank-you { text-align: center; padding: 24px 0; }
        .thank-you .emoji { font-size: 3.5rem; margin-bottom: 16px; }
        .thank-you h2 { font-size: 1.5rem; margin-bottom: 8px; }
        .thank-you p { color: #64748b; }
        .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    </style>
</head>
<body>
    <div class="card">
        <?php if (!$survey): ?>
            <div class="alert alert--error">
                Link non valido o sondaggio non trovato.
            </div>

        <?php elseif ($alreadySubmitted || $done): ?>
            <div class="thank-you">
                <div class="emoji">&#127775;</div>
                <h2>Grazie per il tuo feedback!</h2>
                <p>La tua opinione è molto importante per noi e ci aiuta a migliorare il servizio.</p>
            </div>

        <?php else: ?>
            <h1>Sondaggio di soddisfazione</h1>
            <p class="subtitle">Valuta la tua esperienza come inquilino. Ci vuole meno di un minuto!</p>

            <?php if ($error): ?>
                <div class="alert alert--error"><?= esc($error) ?></div>
            <?php endif; ?>

            <form method="POST" action="survey.php?token=<?= esc($token) ?>">

                <?php starInputs('overall_rating', 'Valutazione generale *') ?>

                <hr class="divider">

                <?php starInputs('maintenance_rating', 'Manutenzione e interventi') ?>
                <?php starInputs('communication_rating', 'Comunicazione e assistenza') ?>

                <hr class="divider">

                <div class="field">
                    <label for="comment">Commenti o suggerimenti</label>
                    <textarea id="comment" name="comment" rows="4"
                              placeholder="Scrivi qui le tue osservazioni..."><?= esc($_POST['comment'] ?? '') ?></textarea>
                </div>

                <button type="submit" class="btn">Invia sondaggio</button>
            </form>
        <?php endif; ?>
    </div>
</body>
</html>
