FROM php:8.3-apache-bookworm

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
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

# PHP config — upload limits
RUN { \
        echo 'upload_max_filesize = 25M'; \
        echo 'post_max_size = 26M'; \
        echo 'max_execution_time = 120'; \
    } > /usr/local/etc/php/conf.d/uploads.ini

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
