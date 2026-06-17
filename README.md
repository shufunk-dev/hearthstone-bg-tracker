# Hearthstone Battlegrounds Tracker & Replay System

An elegant, glassmorphic companion application and turn-by-turn replay system for Hearthstone Battlegrounds mode. Built on Electron with a high-fidelity visual interface, this tracker records your matches, manages a persistent library, and lets you replay games turn-by-turn with full combat simulation.

---

## ⚡ Key Features

*   **Live Dashboard**: Track current board minions, actions (buys, sells, plays), turn numbers, phase indicators (Recruit vs. Combat), and hero HP/Armor in real-time.
*   **Match Library**: Browse a persistent history of previous matches, complete with final hero placements, player names, and durations.
*   **Sequential Combat Replay**: Automatically simulates and animates minion combat sequence (attacks, shields popping, poison/venomous hits, deaths) for each Combat round.
*   **Play/Pause Timeline Controls**: Pause and resume match replays or combat animations at any point, with step-by-step resumption.
*   **Zero-Setup Hearthstone Logging**: The app automatically manages and updates Hearthstone's internal logging configuration on startup.
*   **Stateful Engine**: Resilient against mid-game disconnections, reconnects, power-log truncations, and log rotation.

---

## 📂 Distributables & Installation

The tracker is compiled into two formats under the `dist/` folder:

1.  **Portable Version (`Hearthstone BG Tracker 1.0.0.exe`)**
    *   No installation required. Place it in any directory (or USB drive) and run it.
    *   **Data Storage**: To prevent Windows file-write permission blocks and avoid database loss when deleting/updating the executable, match history is stored locally on each machine in the system AppData folder:
        `%APPDATA%/hearthstone-bg-tracker/history.json`
    *   *Note: Because data is stored locally in AppData, match histories are separate on each PC by default. You can manually copy the `history.json` file between machines if you wish to sync them.*
2.  **Setup Version (`Hearthstone BG Tracker Setup 1.0.0.exe`)**
    *   Runs a standard Windows NSIS setup wizard.
    *   Installs the app to your local programs, sets up Desktop/Start Menu shortcuts, and adds a standard Windows Uninstaller entry.

---

## ⚙️ Automatic Log Configuration

To track games in real-time, Hearthstone must output game states to its log stream. **The application handles this configuration automatically on startup.** 

It checks and configures the following settings in your `%LOCALAPPDATA%/Blizzard/Hearthstone/log.config` file:

```ini
[Power]
LogLevel=1
FilePrinting=false
ConsolePrinting=true
ScreenPrinting=false
Verbose=false

[PowerTaskList]
LogLevel=0
FilePrinting=false
ConsolePrinting=false
ScreenPrinting=false
Verbose=false

[PowerProcessor]
LogLevel=0
FilePrinting=false
ConsolePrinting=false
ScreenPrinting=false
Verbose=false
```

*Note: If you have set your `log.config` to "Read-Only", please disable it so the app can automatically enable logging.*

---

## 🛠️ Development & Building

For developers looking to run, inspect, or build the codebase:

### Prerequisites
*   [Node.js](https://nodejs.org/) (v18+ recommended)
*   [npm](https://www.npmjs.com/)

### Installation
Clone the repository and install dependencies:
```bash
npm install
```

### Running Locally
To launch the application in live mode (listening to active game logs):
```bash
npm start
```

### Mock Playback Mode
To run the application with mock logs for testing and visual validation without launching Hearthstone:
```bash
npm run start:mock
```

### Packaging/Compiling the Executable
To package the app into portable and installer `.exe` packages for Windows:
```bash
npm run build
```
The outputs will be generated in the `dist/` directory.

---

## 🔒 Session & Database Location
*   **Match Database**: Game histories are saved in your local user data directory at `%APPDATA%/hearthstone-bg-tracker/history.json`.
*   **Hearthstone Logs**: The app watches logs in real-time at `%USERPROFILE%/AppData/LocalLow/Blizzard Entertainment/Hearthstone/Player.log`.

---

## 📄 License
This project is licensed under the MIT License.
