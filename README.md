# 🎯 Visionboard

Eine moderne, futuristische Web-App zum Erstellen von Visionboards mit Text und Bildern.

![Visionboard Preview](preview.png)

## ✨ Features

- **📝 Text-Elemente** - Füge Texte mit einem Klick hinzu und formatiere sie direkt
  - Schriftgröße anpassbar
  - 6 verschiedene Neon-Farben
  - Fett, Kursiv und Leuchteffekt
  
- **🖼️ Bilder** - Füge Bilder auf verschiedene Arten hinzu:
  - Drag & Drop direkt auf das Board
  - Hochladen über den Button
  - Aus der Zwischenablage einfügen (ideal für Mobile!)
  - Bilder sind resizebar

- **✅ Goals & Todos** - Verfolge deine Ziele
  - Erstelle Ziele mit Prioritäten (Niedrig/Mittel/Hoch)
  - Hake erledigte Ziele ab
  - Separate Ansicht für aktive und erreichte Ziele

- **💾 Automatische Speicherung** - Deine Daten werden im LocalStorage gespeichert

- **📱 Responsive Design** - Funktioniert auf Desktop und Mobile

## 🚀 Quick Start

### Lokal ohne Docker

Einfach die `index.html` im Browser öffnen oder einen lokalen Server starten:

```bash
# Mit Python
python -m http.server 8080

# Mit Node.js
npx serve
```

### Mit Docker

```bash
# Mit Docker Compose (empfohlen)
docker-compose up -d

# Oder manuell
docker build -t visionboard .
docker run -d -p 3000:80 visionboard
```

Die App ist dann unter `http://localhost:3000` erreichbar.

## 🛠️ Technologien

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+)
- **Design**: Futuristisches Neon-Design mit CSS Grid & Flexbox
- **Fonts**: Google Fonts (Orbitron & Rajdhani)
- **Deployment**: Docker + Nginx

## 📂 Projektstruktur

```
Visionboard/
├── index.html          # Haupt-HTML
├── css/
│   └── style.css       # Futuristisches Styling
├── js/
│   └── app.js          # Haupt-Applikationslogik
├── Dockerfile          # Docker Build
├── docker-compose.yml  # Docker Compose Config
├── nginx.conf          # Nginx Konfiguration
└── README.md           # Diese Datei
```

## 🎨 Design-Features

- **Animierter Hintergrund** mit Gradient-Rotation und Grid-Animation
- **Neon-Farben**: Cyan, Magenta, Gelb, Grün, Orange
- **Glassmorphism-Effekte** mit Backdrop-Blur
- **Smooth Transitions** und Hover-Effekte
- **Glow-Shadows** für den futuristischen Look

## 📱 Mobile Optimierungen

- Touch-optimierte Drag & Drop Funktionalität
- Zwischenablage-Integration für Bilder
- Responsive Layout mit angepasster Navigation
- Touch-freundliche Button-Größen

## 🔧 Umgebungsvariablen

Keine erforderlich - die App funktioniert vollständig clientseitig.

## 📄 Lizenz

MIT License - Frei verwendbar für private und kommerzielle Projekte.

---

Erstellt mit 💜 und ☕
