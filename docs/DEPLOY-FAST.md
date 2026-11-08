# Fast, minimal deployment: one server, one domain

You need only three things: **a domain**, **one Linux server (VPS)**, and the **Supabase project you already use** for login and database. No CDN, no hosting platform, no extra services.

```
Browser ──HTTPS──> Caddy (auto certificate, compression, HTTP/2+3)
                     └──> Docker app on 127.0.0.1:3000 ──> Supabase (auth + database)
                              └──> /var/lib/lingolive/media (private lesson files)
```

## 0. Choose well (this decides most of the speed)

- **Server:** Ubuntu Server 24.04 LTS, at least 2 vCPU, 2 GB RAM (4 GB is more comfortable), SSD/NVMe disk. Size the disk for your lesson videos.
- **Region:** put the server in the **same region as your Supabase project** (Supabase dashboard → Project Settings → General shows the region). Every page makes database and auth calls; a server far from Supabase adds 100-300 ms to each one. This matters more than any other setting.
- **Second choice for region:** close to most of your learners. Check that the provider accepts your payment method before you commit.

## 1. Prepare the server

Log in over SSH (`ssh root@SERVER_IP`), then:

```bash
apt update && apt upgrade -y

# Firewall: SSH + web only
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable

# Docker, git, Caddy
apt install -y docker.io docker-compose-v2 git debian-keyring debian-archive-keyring apt-transport-https curl gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Optional but recommended on a 2 GB server, a swap file so a build can't run out of memory:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. Domain and DNS

1. Buy a domain from any registrar.
2. In the registrar's DNS settings add:
   - `A` record, name `@` (or your subdomain such as `learn`), value `SERVER_IP`
   - `A` record, name `www`, value `SERVER_IP` (only if you want `www`)
3. Wait a few minutes, then check from your computer: `nslookup yourdomain.com` should show `SERVER_IP`.

Keep DNS records simple and TTL at the default or lower while you set up.

## 3. Get the code and configure it

```bash
git clone https://github.com/pooryamirzaei101/lingolive-latest.git /opt/lingolive
cd /opt/lingolive
cp .env.example .env.production
nano .env.production
```

Set these values (everything else can stay as it is):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from Supabase → Project Settings → API |
| `DATABASE_URL` | Supabase → Connect → **session pooler** connection string |
| `DATABASE_SSL` | `require` |
| `ADMIN_EMAIL` | the one account allowed to manage lessons |
| `MEDIA_ROOT` | `/var/lib/lingolive/media` |
| `MEDIA_CONFIG_ENCRYPTION_KEY` | output of `openssl rand -base64 32` |
| `APP_ORIGIN` | `https://yourdomain.com` (exactly, with https) |

Then in **Supabase → Authentication → URL Configuration** set *Site URL* to `https://yourdomain.com` and add `https://yourdomain.com/auth/callback` to *Redirect URLs*. Without this, sign-in redirects fail.

Never commit `.env.production`. It is already ignored by git.

## 4. Build and start the app

```bash
sudo install -d -o 10001 -g 10001 -m 0750 /var/lib/lingolive/media
docker compose build
docker compose run --rm app npm run db:migrate
docker compose up -d
docker compose exec app npm run verify:vps    # checks database, auth, media folder, disk
```

All four checks in `verify:vps` should pass. If one fails, the message says which variable is wrong.

## 5. Turn on HTTPS with Caddy

```bash
cp /opt/lingolive/ops/caddy/Caddyfile /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile        # replace learn.example.com with your domain
systemctl reload caddy
```

Caddy gets and renews the certificate on its own. Your DNS must already point to the server and ports 80/443 must be open (step 1 did this).

Prefer Nginx? Use `ops/nginx/lingolive.conf` instead (it now includes compression, long caching for build files and streaming for video), then run `certbot --nginx -d yourdomain.com`. Do not run both Caddy and Nginx.

## 6. Check that it is fast and correct

```bash
curl -I https://yourdomain.com                          # expect HTTP/2 200
curl -sI -H 'Accept-Encoding: gzip' https://yourdomain.com | grep -i content-encoding   # expect gzip or zstd
curl -sI https://yourdomain.com/_next/static/$(ls /opt/lingolive/dist/client/_next/static/chunks 2>/dev/null | head -1) | grep -i cache-control
```

The last one only works if you built outside Docker; otherwise open the site in Chrome → DevTools → Network and confirm that files under `/_next/static/` show `immutable` and load from cache on the second visit.

Open the site, register, sign in as `ADMIN_EMAIL`, and test a video upload and playback (seeking should be instant).

## 7. Update later

```bash
cd /opt/lingolive && git pull
docker compose build && docker compose run --rm app npm run db:migrate && docker compose up -d
```

## 8. Do not skip: backups

Lesson media lives only on this server. The repo includes an encrypted `restic` backup to storage outside the server: follow the "Backups and monitoring" section of `README.md`, and test a restore once before launch. Also keep your `.env.production` somewhere safe; without `MEDIA_CONFIG_ENCRYPTION_KEY` the saved provider credentials cannot be decrypted.

## Speed notes

- The main speed factor is **server-to-Supabase distance** (step 0). Keep `DATABASE_URL` on the pooler.
- Each page used to ask Supabase "who is this user?" about four times; this branch now does it once per request.
- Build files are cached for a year, text is compressed, video streams without buffering.
- If you later get many users in far-away countries, a free CDN in front of the server is the next step. It is not needed to start.
