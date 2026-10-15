# Web tier for the X Frontline / ViciDial UI.
# The application code is PHP 5-era (mysql_* and ereg* functions), so it runs
# on the last PHP 5 release with Apache and mod_php.
FROM php:5.6-apache

RUN docker-php-ext-install mysql mysqli \
 && a2enmod rewrite headers \
 && mkdir -p /var/log/astguiclient /var/spool/asterisk/monitor \
 && chown -R www-data:www-data /var/log/astguiclient

COPY php.ini /usr/local/etc/php/conf.d/zz-vicidial.ini
COPY astguiclient.conf /etc/astguiclient.conf
COPY entrypoint.sh /usr/local/bin/xf-entrypoint.sh
RUN chmod +x /usr/local/bin/xf-entrypoint.sh

WORKDIR /var/www/html
ENTRYPOINT ["/usr/local/bin/xf-entrypoint.sh"]
CMD ["apache2-foreground"]
