# 🚀 Visionboard Deployment auf OMV mit Cloudflare Tunnel

## Voraussetzungen auf OMV
- Docker & Docker Compose installiert
- SSH-Zugang zu deinem OMV

---

## 1. Repository auf OMV übertragen

### Option A: Git Clone (empfohlen)
```bash
# Auf OMV via SSH
cd /srv/dev-disk-by-uuid-xxx/docker  # oder dein Docker-Ordner
git clone https://github.com/DEIN_USERNAME/Visionboard.git
cd Visionboard
```

### Option B: Manuell kopieren
```bash
# Auf deinem Windows PC
scp -r C:\Users\konst\Documents\Repositorys\Visionboard user@omv-ip:/pfad/zum/docker/ordner/
```

---

## 2. Passwort konfigurieren

```bash
# .env Datei erstellen
cp .env.example .env
nano .env
```

Setze dein sicheres Passwort:
```
VISIONBOARD_PASSWORD=DeinSicheresPasswort123!
```

---

## 3. Container starten

```bash
# Images bauen und starten
docker compose up -d --build

# Logs prüfen
docker compose logs -f
```

Das Visionboard läuft jetzt auf `http://omv-ip:8080`

---

## 4. Cloudflare Tunnel einrichten

### 4.1 Cloudflare Zero Trust Dashboard
1. Gehe zu https://one.dash.cloudflare.com/
2. Wähle dein Konto → **Networks** → **Tunnels**
3. Klicke **Create a tunnel**
4. Name: `visionboard` (oder ähnlich)
5. Wähle **Cloudflared** als Connector

### 4.2 Cloudflared auf OMV installieren

```bash
# Cloudflared installieren (Debian/Ubuntu)
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Oder als Docker Container (empfohlen für OMV)
docker run -d --name cloudflared --restart unless-stopped \
  cloudflare/cloudflared:latest tunnel --no-autoupdate run \
  --token DEIN_TUNNEL_TOKEN
```

### 4.3 Tunnel konfigurieren
Im Cloudflare Dashboard unter **Public Hostname**:
- **Subdomain**: `visionboard` (oder was du möchtest)
- **Domain**: Deine Domain
- **Type**: HTTP
- **URL**: `localhost:8080` oder `visionboard-frontend:80`

### 4.4 Als Docker Service (optional)
Füge zu `docker-compose.yml` hinzu:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
    networks:
      - visionboard-net
```

Und in `.env`:
```
CLOUDFLARE_TUNNEL_TOKEN=dein-tunnel-token-hier
```

---

## 5. Zugriff testen

Nach dem Setup solltest du über `https://visionboard.deinedomain.de` zugreifen können.

1. Öffne die URL im Browser
2. Gib dein Passwort ein
3. Fertig! 🎉

---

## Nützliche Befehle

```bash
# Status prüfen
docker compose ps

# Logs anzeigen
docker compose logs -f

# Neustart
docker compose restart

# Updates einspielen
git pull
docker compose up -d --build

# Backup der Daten
docker cp visionboard-backend:/data ./backup-$(date +%Y%m%d)

# Container stoppen
docker compose down
```

---

## Troubleshooting

### Container startet nicht
```bash
docker compose logs backend
```

### Passwort vergessen
Ändere `VISIONBOARD_PASSWORD` in `.env` und starte neu:
```bash
docker compose restart backend
```

### Datenbank zurücksetzen
```bash
docker compose down
docker volume rm visionboard_visionboard-data
docker compose up -d
```

---

## Sicherheitshinweise

1. **Starkes Passwort verwenden** - mindestens 12 Zeichen mit Sonderzeichen
2. **HTTPS via Cloudflare** - Cloudflare Tunnel verschlüsselt automatisch
3. **Regelmäßige Backups** - Die SQLite-Datenbank liegt im Docker Volume
4. **Updates** - Regelmäßig `git pull && docker compose up -d --build`
