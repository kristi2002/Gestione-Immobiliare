# ─────────────────────────────────────────────────────────────────────────────
# PHP/Apache runtime. The app is the legacy PHP admin (index.php shell + vanilla
# JS in assets/js/*). The React SPA migration was abandoned and its source has
# been removed from the repo, so index.php is what Apache serves at "/".
# ─────────────────────────────────────────────────────────────────────────────

# ── Asset build stage ────────────────────────────────────────────────────────
# Bundle + minify the style.css partial chain into assets/dist/app.min.css,
# collapsing its 9-request @import waterfall into one file. Pure static output;
# index.php falls back to the unbundled CSS if this is ever absent.
FROM node:22-slim AS assets
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts/build-assets.mjs ./scripts/build-assets.mjs
COPY assets/css ./assets/css
RUN npm run build:assets

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM php:8.4-apache-bookworm

# System dependencies + PHP extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
        default-mysql-client \
        libzip-dev \
        libicu-dev \
        libonig-dev \
        unzip \
        curl \
        git \
    && docker-php-ext-install pdo pdo_mysql zip intl mbstring \
    && a2enmod rewrite headers deflate \
    && rm -rf /var/lib/apt/lists/*

# APCu — in-process cache used for the global dashboard stats (config/cache.php).
# Built via PECL (needs the phpize toolchain), which is purged afterwards. The
# app degrades gracefully if this is ever absent, so it's a pure perf add-on.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends $PHPIZE_DEPS; \
    pecl install apcu; \
    docker-php-ext-enable apcu; \
    apt-get purge -y --auto-remove $PHPIZE_DEPS; \
    rm -rf /var/lib/apt/lists/*

# PHP config — upload limits
RUN { \
        echo 'upload_max_filesize = 25M'; \
        echo 'post_max_size = 26M'; \
        echo 'max_execution_time = 120'; \
    } > /usr/local/etc/php/conf.d/uploads.ini

# PHP config — opcache (compiled bytecode cache). Off by default on the base
# image; enabling it is the single biggest server-side throughput win. Each
# deploy starts a fresh container (opcache resets), and revalidate_freq=2 picks
# up any in-place file change within 2s, so this is safe.
RUN { \
        echo 'opcache.enable=1'; \
        echo 'opcache.enable_cli=0'; \
        echo 'opcache.memory_consumption=128'; \
        echo 'opcache.interned_strings_buffer=16'; \
        echo 'opcache.max_accelerated_files=20000'; \
        echo 'opcache.validate_timestamps=1'; \
        echo 'opcache.revalidate_freq=2'; \
    } > /usr/local/etc/php/conf.d/opcache.ini

# PHP config — production hardening (errors to stderr, never to the response).
# The app still re-enables display_errors at runtime when APP_DEBUG=true.
RUN { \
        echo 'display_errors = Off'; \
        echo 'display_startup_errors = Off'; \
        echo 'log_errors = On'; \
        echo 'error_log = /dev/stderr'; \
        echo 'expose_php = Off'; \
    } > /usr/local/etc/php/conf.d/zz-production.ini

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Baked into image (avoids OneDrive reparse-point issues on docker/* files during COPY)
RUN cat > /etc/apache2/sites-available/000-default.conf.template <<'EOF'
<VirtualHost *:__PORT__>
    ServerAdmin webmaster@localhost
    DocumentRoot /var/www/html

    <Directory /var/www/html>
        Options FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog ${APACHE_LOG_DIR}/error.log
    CustomLog ${APACHE_LOG_DIR}/access.log combined
</VirtualHost>
EOF

RUN cat > /usr/local/bin/docker-entrypoint.sh <<'EOF'
#!/bin/sh
set -e

PORT="${PORT:-80}"

sed "s/__PORT__/${PORT}/g" /etc/apache2/sites-available/000-default.conf.template \
    > /etc/apache2/sites-available/000-default.conf

sed -i "s/^Listen .*/Listen ${PORT}/" /etc/apache2/ports.conf

mkdir -p /var/www/html/uploads/properties \
         /var/www/html/uploads/documents/generated \
         /var/www/html/uploads/social \
         /var/www/html/uploads/branding \
         /var/www/html/backups

# Ensure the upload-tree protection exists even when uploads/ is a fresh named
# volume (a volume mount shadows the image's .htaccess files, and the build
# context excludes uploads/). Without this, uploaded documents become public and
# PHP could execute from the uploads tree.
cat > /var/www/html/uploads/.htaccess <<'HT'
<FilesMatch "\.(php|phtml|php3|php4|php5|phps|cgi|pl|exe)$">
    Require all denied
</FilesMatch>
Options -Indexes
HT
cat > /var/www/html/uploads/documents/.htaccess <<'HT'
Require all denied
HT
cat > /var/www/html/uploads/properties/.htaccess <<'HT'
<FilesMatch "\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z|odt|ods|odp|rtf)$">
    Require all denied
</FilesMatch>
HT

chown -R www-data:www-data /var/www/html/uploads /var/www/html/backups 2>/dev/null || true

# Apply pending database migrations (baseline-aware, idempotent). Retry while the
# database becomes reachable; never block container start if it stays unavailable.
if [ -f /var/www/html/database/migrate.php ]; then
    echo "[entrypoint] applying database migrations..."
    i=0
    until php /var/www/html/database/migrate.php; do
        i=$((i+1))
        if [ "$i" -ge 20 ]; then
            echo "[entrypoint] WARNING: migrations did not complete after 20 tries; starting anyway."
            break
        fi
        echo "[entrypoint] database not ready, retry ${i}/20..."
        sleep 3
    done
fi

exec "$@"
EOF
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh

COPY . /var/www/html/

# Overlay the built, minified CSS bundle from the asset stage. Done after the
# full COPY so it always wins over any stale assets/dist/ in the build context.
COPY --from=assets /build/assets/dist /var/www/html/assets/dist

# Install PHP dependencies (production only — no dev tools in image)
# Using `composer update` so Docker regenerates composer.lock from composer.json
# (avoids stale lock file errors when new packages are added without local PHP)
RUN composer update --no-dev --optimize-autoloader --no-interaction --no-progress \
    && rm -rf /root/.composer

RUN mkdir -p uploads/properties uploads/documents uploads/social uploads/branding uploads/documents/generated backups \
    && chown -R www-data:www-data uploads backups vendor

EXPOSE 80

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["apache2-foreground"]
