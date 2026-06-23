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

# PHP config
RUN { \
        echo 'upload_max_filesize = 25M'; \
        echo 'post_max_size = 26M'; \
        echo 'max_execution_time = 120'; \
    } > /usr/local/etc/php/conf.d/uploads.ini

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

chown -R www-data:www-data /var/www/html/uploads /var/www/html/backups 2>/dev/null || true

exec "$@"
EOF
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh

COPY . /var/www/html/

# Install PHP dependencies (production only — no dev tools in image)
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-progress \
    && rm -rf /root/.composer

RUN mkdir -p uploads/properties uploads/documents uploads/social uploads/branding uploads/documents/generated backups \
    && chown -R www-data:www-data uploads backups vendor

EXPOSE 80

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["apache2-foreground"]
