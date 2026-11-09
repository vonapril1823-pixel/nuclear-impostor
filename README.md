# ☢️ Nuclear Impostor

A 3D blocky, Roblox-style social-deduction game. An Impostor is hiding among the crew of Reactor Station. Instead of fixing wires, you repair the station by answering physics problems on **binding energy, nuclear stability, decay, half-life, dose and radiation**. Finish the crew tasks or vote out the Impostor to win.

Play solo against bots, or with up to **10 players over a phone hotspot / Wi-Fi, with no internet needed**.

## Features

- **Character customization**: pick your color (12 choices) and your face (Classic, or any of the photo faces in `faces/`). Everyone sees it, in the lobby, in the game, on bodies and in the ejection scene
- Third-person 3D view (drag to look, scroll or pinch to zoom, jump button), blocky avatars with a walk cycle
- 8 task consoles, each with 3 physics questions and an animated diagram; wrong answers damage the machine
- **Emergency repair**: a destroyed console starts a 30-second countdown, and each wrong answer costs 5 seconds
- Roblox-style HUD: priority-sorted task list (minimizable), minimap, and a feed announcing who finished what
- Meetings, voting and a **space ejection cutscene** that every player sees
- 3D **kill cutscene** with a camera push-in
- **Spectator mode** when you are out: follow any living player (◀ ▶, or Q/E), and the game carries on without you
- Installable as an app (PWA) and playable offline; optional Android APK build

## Quick start

| I want to… | Do this |
|---|---|
| Play solo | Open `index.html` through any web server (or the Pages link), tap **Solo with bots** |
| Play with friends on one hotspot | Run the server (below), everyone opens the address it prints |
| Play with no laptop at all | Use **copy-paste codes** (see below) |

### Hotspot / LAN multiplayer (recommended)

You need one device that can run Node.js 16+ (a laptop, or an Android phone with [Termux](https://termux.dev)). The server has **no dependencies**.

```bash
git clone <your-repo-url> nuclear-impostor
cd nuclear-impostor
node server.js          # or: npm start   (optional port: node server.js 8080)
```

1. Put every device on the same network: your phone's **hotspot**, a router, or the laptop's mobile hotspot.
2. The server prints addresses like `http://192.168.43.2:3000`. Open that on **every** phone or laptop.
3. One player taps **Host a lobby**. A 4-letter room code appears.
4. Everyone else taps **Join a lobby**, then picks the room from the list (or types the code).
5. The host taps **Start game**.

Up to **10 people** can join one room. The Impostor is always a bot, so a full 10-person game has 11 characters. If two people pick the same color the host gives the second one a free color.

The host's browser runs the game (bots, kills, votes). The server only relays messages between players, so nothing is stored and no internet is used.

**Using the Android app or the GitHub Pages site instead?** Pages is served over `https`, and browsers block plain `ws://` connections from `https` pages. In that case open the server's `http://…` address instead, use the Android app (it allows this), or use copy-paste codes. In the app you will be asked for the server address (for example `192.168.43.2:3000`).

### Copy-paste codes (no server)

Choose **Option B** under Host/Join. The host creates a code per player, the friend pastes it and sends a reply code back. It works over any shared Wi-Fi or hotspot, but it is fiddlier, and some hotspots block the direct connection. The server mode is more reliable.

## Customize your character

On the main menu tap **🎨 Customize character**: choose a color and a face, with a live preview. Your choice is saved on that device, and the host shares it with everyone when the game starts. Bots get the remaining colors and random faces.

### Adding more faces

1. Put square-ish photos (about 128 × 128 px, JPG, PNG or WebP) in the `faces/` folder.
2. Run `npm run build:faces`. This rewrites `faces.js`, which is what the game loads. The file name becomes the label (`face-03.jpg` shows as "Face 3").
3. Commit both `faces/` and `faces.js`.

> **Before you publish:** the pictures in `faces/` are photos of real people. Only push them to a public GitHub repository if you have permission from everyone shown (especially students or anyone under 18). Otherwise keep the repository private, or replace them with cartoon faces.

## Controls

| | Desktop | Phone |
|---|---|---|
| Move | WASD / arrows | Joystick (bottom-left) |
| Look | Drag mouse | Drag the screen |
| Zoom | Scroll | Pinch |
| Jump | Space | JUMP |
| Use a console / emergency button | E | USE |
| Report a body | R | REPORT |
| Minimize task list | T | `–` button |
| Spectate (when out) | Q / E or ← / → | ◀ ▶ |
| Skip ejection cutscene | Space / Enter / tap | Tap |

## Install as an app (PWA)

Open the game in Chrome or Safari and choose **Install app / Add to Home Screen**. It then runs full screen and works offline. (Installing needs `https`, such as the GitHub Pages link, or `localhost`.)

## Put it on GitHub

1. Create a repository and push this folder to the `main` branch.
2. **GitHub Pages:** Settings → Pages → Source → **GitHub Actions**. The `Deploy to GitHub Pages` workflow publishes the game on every push.
3. **Android APK:** Actions tab → **Android APK** → *Run workflow* (or push a tag such as `v1.0.0` to also attach it to a Release). Download `NuclearImpostor.apk` from the run's artifacts, then allow "install unknown apps" on the phone.
4. The `CI` workflow runs `npm run check` and `npm test` on every push.

To build the APK locally you need Node 20+, JDK 17 and the Android SDK, then `npm install && npm run android:prepare` and open `android/` in Android Studio. The APK is debug-signed. For the Play Store you would add your own signing key.

## Project layout

```
index.html              the whole game (HTML + CSS + JS, single file)
server.js               zero-dependency LAN server: static files + WebSocket relay
vendor/three.min.js     Three.js r128 (bundled so it works offline)
manifest.webmanifest    PWA manifest        sw.js   offline cache
faces/                  the face photos (edit these)
faces.js                generated from faces/ by `npm run build:faces`
icons/                  app icons
scripts/                build-faces.js, build-www.js (static bundle), check.js (sanity checks)
test/relay-smoke.js     relay server test (Node 22+)
capacitor.config.json   Android wrapper settings
.github/workflows/      CI, Pages deploy, Android APK
```

Useful commands: `npm start`, `npm run check`, `npm test`, `npm run build:faces`, `npm run build:www`.

## Troubleshooting

- **"Can't reach the server"**: check every device is on the same network, the server is running, and the address and port are right. A laptop firewall may block port 3000. Allow Node.js or pick another port.
- **Friends can't see each other (nothing connects)**: some Wi-Fi networks isolate clients from each other ("AP isolation" or "guest network"). Use a phone hotspot instead.
- **Lobby doesn't list a room**: the host must tap *Host a lobby* first. You can also type the 4-letter code.
- **Game stuck waiting after a vote**: the result screen continues on its own after a few seconds.
- **Faces missing or a plain smiley shows**: make sure `faces.js` sits next to `index.html` (run `npm run build:faces`). If you changed `faces/`, rebuild it.
- **Game freezes for everyone**: the host's phone runs the game, so keep the host's screen on (turn off auto-lock) and keep the tab in the foreground.
- **Someone dropped mid-game**: reconnecting mid-round isn't supported; their character becomes a bot and they can rejoin the next lobby. Meetings continue without them.
- **"Too late" after joining**: the host pressed Start before your phone finished connecting. Join again next round.
- **Termux shows no address**: run `ip -4 addr` and use the `inet` address of `wlan0` (or the hotspot interface) with `:3000`.
- **Blank screen**: the game needs WebGL. Turn on hardware acceleration in the browser.

## License

Add the license of your choice before publishing (for example MIT). Three.js is MIT-licensed.
