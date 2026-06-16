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
