#!/bin/bash
# Make the per-deployment branding file and logo folder writable by Apache,
# then wait for the database before starting.
set -e
touch /var/www/html/xf_brand_custom.json 2>/dev/null || true
chown www-data:www-data /var/www/html/xf_brand_custom.json 2>/dev/null || true
mkdir -p /var/www/html/agc/images/brand && chown -R www-data:www-data /var/www/html/agc/images/brand 2>/dev/null || true
# the branding loader treats an empty file as "no overrides"
if [ ! -s /var/www/html/xf_brand_custom.json ]; then echo '{}' > /var/www/html/xf_brand_custom.json; fi

DB_HOST="${DB_HOST:-db}"
for i in $(seq 1 60); do
  if php -r "exit(@mysqli_connect('$DB_HOST','cron','1234','asterisk') ? 0 : 1);" 2>/dev/null; then
    echo "database is reachable"; break
  fi
  echo "waiting for database ($i)..."; sleep 2
done
exec "$@"
