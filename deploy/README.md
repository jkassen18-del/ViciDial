# Running X Frontline (ViciDial web tier) with Docker

This folder starts the complete **web application** (agent console,
administration, reports, branding) with its MySQL database in two containers.
It is the fastest way to see the UI and configure campaigns, users, lists and
branding.

The **dialer** (Asterisk plus the ViciDial perl back-end that moves leads into
the hopper, places calls and logs them) is not containerised here. Without it
the console loads and every screen works, but no calls are placed. See
"Connecting a dialer" below.

## Requirements

* Docker 24+ with the Compose plugin (`docker compose version`)
* About 1.5 GB of disk for the images
* Port 8080 free (change `WEB_PORT` to use another)

## Start

```bash
cd deploy
docker compose up -d --build
```

The first start takes a minute: MariaDB creates the ViciDial schema from
`db/01_schema.sql`, seeds the first-server data from `db/02_seed.sql` and the
demo campaign from `db/03_demo.sql`. Then open:

| URL | Login |
|-----|-------|
| http://localhost:8080/ | welcome page |
| http://localhost:8080/vicidial/admin.php | admin **6666** / **1234** (HTTP basic auth) |
| http://localhost:8080/vicidial/admin_branding.php | same admin login |
| http://localhost:8080/agc/vicidial.php | agent **1001** / **1234**, extension **1001**, campaign **PREM01** |

On the first admin visit ViciDial shows its licence page and an initial-setup
screen that asks you to change the admin password and set the server IP. Do
that before exposing the system to anyone.

This fork logs agents in with **user, password and extension only**: the
phone's registration password is taken to be the same as its extension (see
`www/agc/vicidial.php`, `$phone_pass=$phone_login`). Create phones
accordingly in Admin → Phones.

## Day-to-day

```bash
docker compose logs -f web      # Apache / PHP log
docker compose logs -f db       # MariaDB log
docker compose exec db mysql -h127.0.0.1 -ucron -p1234 asterisk   # SQL shell
docker compose down             # stop (data is kept in the dbdata volume)
docker compose down -v          # stop and wipe the database (re-seeds next start)
```

Code changes are live immediately: `../www` is mounted into the web
container, so editing CSS, PHP or branding files needs no rebuild. Rebuild
only when `web/Dockerfile`, `web/php.ini` or `web/astguiclient.conf` change:
`docker compose up -d --build`.

Branding saved from the admin page is written to `www/xf_brand_custom.json`
and `www/agc/images/brand/` on the host (the entrypoint makes them writable).

## Connecting a dialer

ViciDial needs Asterisk and its perl scripts on a server that can reach this
database. The supported ways to get that are the ViciBox ISO or the
`install.pl` script at the root of this repository on a conventional server.
Then:

1. In **Admin → Servers**, replace the seeded `10.10.10.15` entry with the
   Asterisk server's real IP, or edit `db/02_seed.sql` before first start.
2. Point that server's `/etc/astguiclient.conf` at this database
   (`VARDB_server` = the Docker host, port 3306 published if you add
   `ports: ["3306:3306"]` to the `db` service).
3. Register softphones (X-Lite, Bria, Zoiper…) against Asterisk as described
   in `docs/X-LITE_SOFTPHONE_SETUP.md`.

The perl keep-alive scripts (`AST_VDhopper.pl`, `AST_update.pl`, …) then
fill the hopper and drive calls, and the console shows live call state.

## Production notes

* Put the web container behind HTTPS (a reverse proxy such as nginx, Caddy or
  Traefik) and change every default password: `DB_ROOT_PASSWORD`, the `cron`
  database user in `web/astguiclient.conf` and `docker-compose.yml`, the admin
  user and the demo agent.
* The application is PHP 5-era code (mysql_* functions) and runs on the
  official `php:5.6-apache` image. Keep it on an internal network.
* Back up the `dbdata` volume (`docker run --rm -v deploy_dbdata:/v -v $PWD:/b
  alpine tar czf /b/dbdata.tgz /v`).
