// Global Console Logger Override with Timestamps
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function formatTimestamp() {
  const d = new Date();
  const time = d.toTimeString().split(' ')[0];
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${time}.${ms}]`;
}

console.log = (...args) => originalLog(formatTimestamp(), ...args);
console.error = (...args) => originalError(formatTimestamp(), ...args);
console.warn = (...args) => originalWarn(formatTimestamp(), ...args);

const { app, BrowserWindow, ipcMain } = require('electron');

// Request Single Instance Lock to prevent duplicate processes from locking logs
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Main] Another instance of the tracker is already running. Exiting...');
  app.quit();
  // On Windows, app.quit() is asynchronous, so call process.exit() to terminate immediately
  setTimeout(() => process.exit(0), 100);
}

app.on('second-instance', (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { exec } = require('child_process');
const LogWatcher = require('./src/parser/logWatcher');
const BGEventParser = require('./src/parser/bgEventParser');
function ensureLogConfig() {
  const appData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\shufu', 'AppData', 'Local');
  const configDir = path.join(appData, 'Blizzard', 'Hearthstone');
  const configPath = path.join(configDir, 'log.config');

  const sectionsToManage = {
    'Power': {
      LogLevel: '1',
      FilePrinting: 'false',
      ConsolePrinting: 'true',
      ScreenPrinting: 'false',
      Verbose: 'false'
    },
    'PowerTaskList': {
      LogLevel: '0',
      FilePrinting: 'false',
      ConsolePrinting: 'false',
      ScreenPrinting: 'false',
      Verbose: 'false'
    },
    'PowerProcessor': {
      LogLevel: '0',
      FilePrinting: 'false',
      ConsolePrinting: 'false',
      ScreenPrinting: 'false',
      Verbose: 'false'
    }
  };

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    let configContent = '';
    let lines = [];
    if (fs.existsSync(configPath)) {
      configContent = fs.readFileSync(configPath, 'utf8');
      lines = configContent.split(/\r?\n/);
    }

    // Parse sections
    let sections = {};
    let currentSection = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.slice(1, -1);
        sections[currentSection] = [];
      } else if (currentSection) {
        sections[currentSection].push(trimmed);
      }
    }

    let updated = false;

    for (const [secName, secConfig] of Object.entries(sectionsToManage)) {
      if (!sections[secName]) {
        sections[secName] = Object.entries(secConfig).map(([k, v]) => `${k}=${v}`);
        updated = true;
        console.log(`[Main] Log config: Adding missing [${secName}] section.`);
      } else {
        const secKeys = {};
        for (const line of sections[secName]) {
          const parts = line.split('=');
          if (parts.length === 2) {
            secKeys[parts[0].trim()] = parts[1].trim();
          }
        }

        let sectionUpdated = false;
        for (const [key, value] of Object.entries(secConfig)) {
          if (!secKeys[key] || secKeys[key].toLowerCase() !== value.toLowerCase()) {
            secKeys[key] = value;
            sectionUpdated = true;
            updated = true;
            console.log(`[Main] Log config: Updating [${secName}] ${key} to ${value}.`);
          }
        }

        if (sectionUpdated) {
          sections[secName] = Object.entries(secKeys).map(([k, v]) => `${k}=${v}`);
        }
      }
    }

    // Reconstruct config file content
    if (updated) {
      let newContent = '';
      for (const [section, linesArray] of Object.entries(sections)) {
        newContent += `[${section}]\n`;
        for (const line of linesArray) {
          newContent += `${line}\n`;
        }
        newContent += '\n'; // empty line between sections
      }

      fs.writeFileSync(configPath, newContent, 'utf8');
      console.log('[Main] Log config successfully updated at: ' + configPath);
    } else {
      console.log('[Main] Log config already matches required settings.');
    }

  } catch (err) {
    console.error('[Main] Failed to configure Hearthstone log.config:', err);
  }
}

let mainWindow = null;
let logWatcher = null;
let eventParser = null;
let currentGameId = null;
let mockTimeout = null;
let currentSessionId = 0;
let linesQueue = [];
let isCatchingUp = true;
let lineIdx = 0;
let isPaused = false;
let activeLogDirectoryPath = null;
let lastSavedHistoryLength = 0;
let lastHearthstoneState = false;
let knownSessionDirs = [];
let monitorInterval = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 850,
    minHeight: 600,
    frame: true, // Native window borders for standard look, but styled header inside
    title: "Hearthstone Battlegrounds Tracker",
    backgroundColor: '#121214',
    webPreferences: {
      preload: path.join(__dirname, 'src', 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [Level ${level}] ${message} (line ${line} in ${path.basename(sourceId)})`);
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  
  // Open devtools in mock mode if needed
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopWatchers();
  });
}

// Throttle IPC state updates to avoid saturating Electron channels
let pendingUpdate = false;
function sendGameState() {
  if (pendingUpdate || !mainWindow) return;
  pendingUpdate = true;
  
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && eventParser) {
      const gameState = {
        localPlayerName: eventParser.localPlayerName,
        localPlayerId: eventParser.localPlayerId,
        currentTurn: eventParser.currentTurn,
        phase: eventParser.phase,
        buys: eventParser.currentTurnData ? eventParser.currentTurnData.buys : [],
        sells: eventParser.currentTurnData ? eventParser.currentTurnData.sells : [],
        plays: eventParser.currentTurnData ? eventParser.currentTurnData.plays : [],
        board: eventParser.getBoardState(),
        heroStats: {
          ...eventParser.getHeroStats(),
          id: eventParser.localPlayerHeroEntityId || 0
        },
        opponentHeroStats: {
          ...eventParser.getOpponentHeroStats(),
          id: eventParser.activeOpponentHeroId || 0
        },
        opponent: eventParser.currentTurnData ? eventParser.currentTurnData.opponent : 'Unknown',
        opponentId: eventParser.currentTurnData ? eventParser.currentTurnData.opponentId : null,
        history: eventParser.history,
        activeGame: eventParser.activeGame
      };
      
      mainWindow.webContents.send('game-update', gameState);
      saveGameToHistory(gameState);
    }
    pendingUpdate = false;
  }, 50);
}

function sendGameStateLive(gameId) {
  if (pendingUpdate || !mainWindow) return;
  pendingUpdate = true;
  
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && eventParser) {
      const heroStats = eventParser.getHeroStats() || {};
      const gameState = {
        localPlayerName: eventParser.localPlayerName,
        localPlayerId: eventParser.localPlayerId,
        currentTurn: eventParser.currentTurn,
        phase: eventParser.phase,
        buys: eventParser.currentTurnData ? eventParser.currentTurnData.buys : [],
        sells: eventParser.currentTurnData ? eventParser.currentTurnData.sells : [],
        plays: eventParser.currentTurnData ? eventParser.currentTurnData.plays : [],
        board: eventParser.getBoardState(),
        heroStats: {
          ...heroStats,
          id: eventParser.localPlayerHeroEntityId || 0
        },
        opponentHeroStats: {
          ...eventParser.getOpponentHeroStats(),
          id: eventParser.activeOpponentHeroId || 0
        },
        opponent: eventParser.currentTurnData ? eventParser.currentTurnData.opponent : 'Unknown',
        opponentId: eventParser.currentTurnData ? eventParser.currentTurnData.opponentId : null,
        history: eventParser.history,
        activeGame: eventParser.activeGame
      };
      
      mainWindow.webContents.send('game-update', gameState);
      
      // Save progress to history (only when history grows, meaning a new turn was added)
      if (eventParser.history.length > 0 && eventParser.history.length !== lastSavedHistoryLength) {
        const gameData = {
          id: gameId,
          localPlayerName: eventParser.localPlayerName || 'Unknown',
          heroName: heroStats.heroName || 'Unknown Hero',
          heroCardId: heroStats.heroCardId || '',
          totalTurns: eventParser.history.length,
          timestamp: eventParser.history[0] ? eventParser.history[0].timestamp : new Date().toISOString(),
          isFinished: false,
          history: eventParser.history
        };
        saveGameDataToHistory(gameData);
        lastSavedHistoryLength = eventParser.history.length;
      }
    }
    pendingUpdate = false;
  }, 50);
}

function saveGameDataToHistory(gameData) {
  const historyPath = getHistoryPath();
  let games = [];
  if (fs.existsSync(historyPath)) {
    try {
      games = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch (err) {
      console.error('[History] Error reading history.json:', err);
    }
  }
  
  let gameIndex = games.findIndex(g => g.id === gameData.id);
  if (gameIndex !== -1) {
    if (games[gameIndex].isFinished) {
      gameData.isFinished = true;
    }
    games[gameIndex] = gameData;
  } else {
    games.unshift(gameData);
  }
  
  games.sort((a, b) => b.id.localeCompare(a.id));
  
  try {
    fs.writeFileSync(historyPath, JSON.stringify(games, null, 2), 'utf8');
    console.log(`[History] Saved match progress: ${gameData.id} (turns: ${gameData.totalTurns}, finished: ${gameData.isFinished})`);
  } catch (err) {
    console.error('[History] Error writing history.json:', err);
  }
}

function stopWatchers() {
  console.log(`[Main] stopWatchers called.`);
  
  if (mockTimeout) {
    clearTimeout(mockTimeout);
    mockTimeout = null;
  }
  if (logWatcher) {
    console.log(`[Main] Stopping active logWatcher.`);
    logWatcher.stop();
    logWatcher = null;
  }
}

function isHearthstoneRunning() {
  return new Promise((resolve) => {
    exec('tasklist /NH /FI "IMAGENAME eq Hearthstone.exe"', (err, stdout) => {
      if (err || !stdout) {
        resolve(false);
        return;
      }
      resolve(stdout.includes('Hearthstone.exe'));
    });
  });
}

async function scanAndImportMatches() {
  console.log('[Main] Scanning Hearthstone Logs directory for matches...');
  const watcher = new LogWatcher();
  const sessionDirs = watcher.getSessionDirectories(); // Sorted lexicographically
  if (sessionDirs.length === 0) {
    console.log('[Main] No session directories found.');
    return;
  }

  const historyPath = getHistoryPath();
  let games = [];
  if (fs.existsSync(historyPath)) {
    try {
      games = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch (e) {
      console.error('[Main] Error reading history.json:', e);
    }
  }

  const isHsRunning = await isHearthstoneRunning();
  const latestDirName = sessionDirs[sessionDirs.length - 1];
  
  let newlyImportedCount = 0;
 
  for (let i = 0; i < sessionDirs.length; i++) {
    const dirName = sessionDirs[i];
    
    // Check if this session is already in history (under any ID format)
    const alreadyImported = games.some(g => g.id === dirName || g.id.startsWith(`${dirName}_`));
    if (alreadyImported) {
      continue;
    }
 
    // If it's the active directory and Hearthstone is currently running, skip it for now (it's in progress)
    if (dirName === latestDirName && isHsRunning) {
      console.log(`[Main] Skipping active session in progress: ${dirName}`);
      continue;
    }
 
    // This session is completed! Let's parse it in full.
    const dirPath = path.join(watcher.logsDir, dirName);
    const logFilePath = path.join(dirPath, 'Power.log');
    
    if (!fs.existsSync(logFilePath)) {
      continue;
    }
 
    console.log(`[Main] Importing completed match session: ${dirName}`);
    const lines = watcher.readFullLog(logFilePath);
    if (lines.length === 0) {
      continue;
    }
 
    const parser = new BGEventParser();
    let scanGameCount = 0;
    let scanGameActive = false;
    let scanGameId = null;
    let scanGamesFound = [];

    for (const line of lines) {
      parser.parseLine(line);
      if (parser.activeGame) {
        if (!scanGameActive) {
          scanGameActive = true;
          scanGameCount++;
          scanGameId = `${dirName}_game_${scanGameCount}`;
        }
      } else {
        if (scanGameActive) {
          parser.finalizeGame();
          const heroStats = parser.getHeroStats() || {};
          scanGamesFound.push({
            id: scanGameId,
            localPlayerName: parser.localPlayerName || 'Unknown',
            heroName: heroStats.heroName || 'Unknown Hero',
            heroCardId: heroStats.heroCardId || '',
            totalTurns: parser.history.length,
            timestamp: parser.history[0] ? parser.history[0].timestamp : new Date().toISOString(),
            isFinished: true,
            history: [...parser.history]
          });
          scanGameActive = false;
          scanGameId = null;
        }
      }
    }

    if (scanGameActive) {
      parser.finalizeGame();
      const heroStats = parser.getHeroStats() || {};
      scanGamesFound.push({
        id: scanGameId,
        localPlayerName: parser.localPlayerName || 'Unknown',
        heroName: heroStats.heroName || 'Unknown Hero',
        heroCardId: heroStats.heroCardId || '',
        totalTurns: parser.history.length,
        timestamp: parser.history[0] ? parser.history[0].timestamp : new Date().toISOString(),
        isFinished: true,
        history: [...parser.history]
      });
    }

    for (const gameData of scanGamesFound) {
      if (gameData.totalTurns > 0) {
        games.unshift(gameData);
        newlyImportedCount++;
        console.log(`[Main] Successfully imported match ${gameData.id} with ${gameData.totalTurns} turns.`);
      }
    }
  }

  if (newlyImportedCount > 0) {
    // Sort games by id descending so newest matches stay at the top
    games.sort((a, b) => b.id.localeCompare(a.id));
    
    try {
      fs.writeFileSync(historyPath, JSON.stringify(games, null, 2), 'utf8');
      console.log(`[Main] Persisted ${newlyImportedCount} new matches to database.`);
      
      // Notify the frontend that matches have been imported
      if (mainWindow) {
        mainWindow.webContents.send('matches-imported');
      }
    } catch (err) {
      console.error('[Main] Error saving updated history database:', err);
    }
  } else {
    console.log('[Main] No new completed matches to import.');
  }
}

function startMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
  }

  const watcher = new LogWatcher();
  knownSessionDirs = watcher.getSessionDirectories();
  
  monitorInterval = setInterval(async () => {
    const isHsRunning = await isHearthstoneRunning();
    
    // Check if Hearthstone state changed
    if (isHsRunning !== lastHearthstoneState) {
      console.log(`[Main] Hearthstone process state changed: ${lastHearthstoneState ? 'Running' : 'Closed'} -> ${isHsRunning ? 'Running' : 'Closed'}`);
      lastHearthstoneState = isHsRunning;
      
      // Notify UI of status change
      if (mainWindow) {
        mainWindow.webContents.send('hearthstone-status', isHsRunning);
      }
      
      // If Hearthstone closed, run a scan and also finalize any active live game
      if (!isHsRunning) {
        if (eventParser && eventParser.activeGame) {
          console.log('[Main] Hearthstone closed. Finalizing active game...');
          eventParser.finalizeGame();
          const heroStats = eventParser.getHeroStats() || {};
          const finalState = {
            id: currentGameId || `match_hs_closed_${Date.now()}`,
            localPlayerName: eventParser.localPlayerName || 'Unknown',
            heroName: heroStats.heroName || 'Unknown Hero',
            heroCardId: heroStats.heroCardId || '',
            totalTurns: eventParser.history.length,
            timestamp: eventParser.history[0] ? eventParser.history[0].timestamp : new Date().toISOString(),
            isFinished: true,
            history: eventParser.history
          };
          saveGameDataToHistory(finalState);
          currentGameId = null;
          if (mainWindow) {
            mainWindow.webContents.send('matches-imported');
          }
        }
        await scanAndImportMatches();
      }
    }
    
    // Check if a new session directory is created (even if Hearthstone is still running)
    const currentDirs = watcher.getSessionDirectories();
    let directoryAdded = false;
    for (const dirName of currentDirs) {
      if (!knownSessionDirs.includes(dirName)) {
        console.log(`[Main] New session directory detected: ${dirName}`);
        directoryAdded = true;
      }
    }
    
    if (directoryAdded) {
      knownSessionDirs = currentDirs;
      // A new directory started, which means the previous one is completed!
      await scanAndImportMatches();
    }

    // Check Player.log size to report stats safely and keep warning hidden
    if (isHsRunning && mainWindow) {
      const logPath = watcher.playerLogPath;
      if (fs.existsSync(logPath)) {
        try {
          const stats = fs.statSync(logPath);
          mainWindow.webContents.send('log-size-status', { status: 'ok', sizeBytes: stats.size });
        } catch (e) {
          console.error('[Main] Error reading Player.log size:', e);
        }
      }
    } else if (!isHsRunning && mainWindow) {
      mainWindow.webContents.send('log-size-status', { status: 'ok', sizeBytes: 0 });
    }
  }, 5000);
}

function startLiveTracking() {
  console.log('[Main] Initializing live logWatcher to tail Player.log...');
  logWatcher = new LogWatcher();
  eventParser = new BGEventParser();
  currentGameId = null;
  lastSavedHistoryLength = 0;
  
  const latestDir = logWatcher.getLatestLogDirectory();
  const sessionName = latestDir ? path.basename(latestDir) : 'session';
  let gameCount = 0;
  let isLiveCatchingUp = true;
  
  logWatcher.start(
    (line) => {
      eventParser.parseLine(line);
      
      if (eventParser.activeGame) {
        if (!currentGameId) {
          gameCount++;
          currentGameId = `${sessionName}_game_${gameCount}`;
          console.log(`[Main] Live game detected. Created currentGameId: ${currentGameId}`);
          
          if (!isLiveCatchingUp && mainWindow) {
            mainWindow.webContents.send('new-session', currentGameId);
          }
        }
        
        if (!isLiveCatchingUp) {
          sendGameStateLive(currentGameId);
        }
      } else {
        if (currentGameId) {
          console.log(`[Main] Game activeGame set to false. Finalizing game ${currentGameId}.`);
          eventParser.finalizeGame();
          
          if (!isLiveCatchingUp) {
            const heroStats = eventParser.getHeroStats() || {};
            const finalState = {
              id: currentGameId,
              localPlayerName: eventParser.localPlayerName || 'Unknown',
              heroName: heroStats.heroName || 'Unknown Hero',
              heroCardId: heroStats.heroCardId || '',
              totalTurns: eventParser.history.length,
              timestamp: eventParser.history[0] ? eventParser.history[0].timestamp : new Date().toISOString(),
              isFinished: true,
              history: eventParser.history
            };
            saveGameDataToHistory(finalState);
            
            if (mainWindow) {
              mainWindow.webContents.send('matches-imported');
            }
          }
          currentGameId = null;
        }
      }
    },
    () => {
      console.log(`[Main] Live tracking session reset/truncated.`);
      eventParser.reset();
      currentGameId = null;
      lastSavedHistoryLength = 0;
      gameCount = 0;
      if (!isLiveCatchingUp && mainWindow) {
        mainWindow.webContents.send('new-session', 'reset');
      }
    },
    () => {
      console.log(`[Main] Live tracking catch-up phase complete.`);
      isLiveCatchingUp = false;
      
      // If we are currently mid-game when catch-up finishes, notify the UI and save progress
      if (currentGameId && eventParser.activeGame) {
        console.log(`[Main] Mid-game catch-up detected for: ${currentGameId}. Notifying UI.`);
        if (mainWindow) {
          mainWindow.webContents.send('new-session', currentGameId);
        }
        sendGameStateLive(currentGameId);
      }
    }
  );
}

// Start watching logs (either live or mock)
function startTracking(isRewind = false) {
  console.log(`[Main] startTracking called. isRewind: ${isRewind}, currentSessionId: ${currentSessionId}`);
  currentSessionId++;
  const sessionId = currentSessionId;
  console.log(`[Main] Incremented currentSessionId to: ${sessionId}`);
  
  stopWatchers();
  
  // Reset streaming state variables
  linesQueue = [];
  isCatchingUp = true;
  lineIdx = 0;
  isPaused = false;
  activeLogDirectoryPath = null;
  lastSavedHistoryLength = 0;
  
  // Mark previous matches as finished
  markPreviousGamesFinished();
  
  const isMock = process.argv.includes('--mock');
  
  if (isMock) {
    eventParser = new BGEventParser();
    runMockStream(sessionId);
  } else {
    startLiveTracking();
  }
}

// Mock streaming for development
async function runMockStream(sessionId) {
  console.log(`[Main] Starting Mock Log Stream for session ${sessionId}...`);
  const mockPath = path.join(__dirname, 'tests', 'mock-logs', 'Power_BG_match.log');
  
  if (!fs.existsSync(mockPath)) {
    console.error(`[Main] Mock log file not found at: ${mockPath}`);
    return;
  }

  const fileStream = fs.createReadStream(mockPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (sessionId !== currentSessionId) {
      console.log(`[Main] Session ${sessionId} cancelled during load. Aborting.`);
      fileStream.destroy();
      return;
    }
    linesQueue.push(line);
  }

  console.log(`[Main] Loaded ${linesQueue.length} mock lines for session ${sessionId}. Streaming to UI...`);
  processStreamBatch(sessionId);
}

function processStreamBatch(sessionId, instantCatchUp = false) {
  if (sessionId !== currentSessionId || !mainWindow) {
    console.log(`[Main] Session ${sessionId} cancelled or window closed. Stopping stream.`);
    return;
  }
  
  if (isPaused) return;

  if (lineIdx >= linesQueue.length) {
    isCatchingUp = false;
    const isMock = process.argv.includes('--mock');
    if (isMock) {
      if (eventParser) {
        eventParser.finalizeGame();
      }
      sendGameState();
      markActiveGameFinished();
      console.log(`[Main] Mock log streaming finished for session ${sessionId}.`);
    } else {
      sendGameState();
      console.log(`[Main] Live log stream caught up for session ${sessionId}. Now listening in real-time.`);
    }
    return;
  }

  if (instantCatchUp) {
    // Process all remaining lines instantly
    while (lineIdx < linesQueue.length) {
      if (sessionId !== currentSessionId) return;
      eventParser.parseLine(linesQueue[lineIdx]);
      lineIdx++;
    }
    isCatchingUp = false;
    sendGameState();
    console.log(`[Main] Live log stream caught up instantly for session ${sessionId}.`);
    return;
  }

  const maxLinesThisTick = 150;
  let linesProcessed = 0;

  while (lineIdx < linesQueue.length && linesProcessed < maxLinesThisTick && !isPaused) {
    if (sessionId !== currentSessionId) return;

    const line = linesQueue[lineIdx];
    
    // Pause at turn changes to let the user review board and actions
    if (line.includes('Entity=GameEntity tag=TURN') || line.includes('Entity=1 tag=TURN')) {
      eventParser.parseLine(line);
      lineIdx++;
      
      isPaused = true;
      sendGameState();
      
      mockTimeout = setTimeout(() => {
        isPaused = false;
        processStreamBatch(sessionId, instantCatchUp);
      }, 2500); // 2.5 second pause between turns
      return;
    }

    eventParser.parseLine(line);
    lineIdx++;
    linesProcessed++;
  }

  sendGameState();
  mockTimeout = setTimeout(() => processStreamBatch(sessionId, instantCatchUp), 25);
}

// ==========================================
// HISTORY DATABASE HELPERS
// ==========================================

function getHistoryPath() {
  const isMock = process.argv.includes('--mock');
  if (isMock) {
    return path.join(__dirname, 'history.json');
  }
  return path.join(app.getPath('userData'), 'history.json');
}

function deduplicateHistoryDatabase() {
  const historyPath = getHistoryPath();
  if (!fs.existsSync(historyPath)) return;

  try {
    const rawData = fs.readFileSync(historyPath, 'utf8');
    let games = JSON.parse(rawData);
    if (!Array.isArray(games)) return;

    const initialLength = games.length;
    console.log(`[Deduplicate] Starting deduplication. Current matches: ${initialLength}`);

    const uniqueGames = [];

    for (const game of games) {
      if (!game.history || game.history.length === 0) {
        console.log(`[Deduplicate] Removing empty game ${game.id}`);
        continue;
      }

      let isDuplicate = false;
      let replaceIndex = -1;
      let matchedGame = null;

      for (let i = 0; i < uniqueGames.length; i++) {
        const existing = uniqueGames[i];
        
        if (existing.localPlayerName === game.localPlayerName &&
            (existing.heroCardId === game.heroCardId || existing.heroName === game.heroName || !existing.heroCardId || !game.heroCardId)) {
          
          const minLen = Math.min(existing.history.length, game.history.length);
          let match = true;
          for (let j = 0; j < minLen; j++) {
            const tE = existing.history[j];
            const tG = game.history[j];
            if (tE.turn !== tG.turn || tE.opponent !== tG.opponent || tE.damageDealt !== tG.damageDealt || tE.phase !== tG.phase) {
              match = false;
              break;
            }
          }

          if (match) {
            isDuplicate = true;
            matchedGame = existing;
            if (game.history.length > existing.history.length) {
              replaceIndex = i;
            }
            break;
          }
        }
      }

      if (!isDuplicate) {
        uniqueGames.push(game);
      } else if (replaceIndex !== -1) {
        console.log(`[Deduplicate] Replacing game ${uniqueGames[replaceIndex].id} (${uniqueGames[replaceIndex].totalTurns} turns) with longer/newer game ${game.id} (${game.totalTurns} turns)`);
        uniqueGames[replaceIndex] = game;
      } else {
        console.log(`[Deduplicate] Discarding duplicate game ${game.id} (${game.totalTurns} turns) in favor of existing ${matchedGame.id} (${matchedGame.totalTurns} turns)`);
      }
    }

    if (uniqueGames.length < initialLength) {
      fs.writeFileSync(historyPath, JSON.stringify(uniqueGames, null, 2), 'utf8');
      console.log(`[Deduplicate] Deduplication complete. Saved database with ${uniqueGames.length} matches (removed ${initialLength - uniqueGames.length} duplicates).`);
    } else {
      console.log(`[Deduplicate] No duplicates found.`);
    }

  } catch (err) {
    console.error('[Deduplicate] Error running deduplication:', err);
  }
}


function markPreviousGamesFinished() {
  const historyPath = getHistoryPath();
  if (!fs.existsSync(historyPath)) return;
  
  try {
    let games = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    let changed = false;
    games.forEach(g => {
      if (g.isFinished === false) {
        g.isFinished = true;
        changed = true;
      }
    });
    if (changed) {
      fs.writeFileSync(historyPath, JSON.stringify(games, null, 2), 'utf8');
      console.log('[History] Marked previous unfinished games as finished.');
    }
  } catch (err) {
    console.error('[History] Error marking previous games as finished:', err);
  }
}

function saveGameToHistory(gameState) {
  if (!gameState.activeGame || gameState.history.length === 0) return;
  
  // Only write to disk if history length has increased (new turn recorded)
  if (gameState.history.length === lastSavedHistoryLength) return;
  
  const historyPath = getHistoryPath();
  let games = [];
  if (fs.existsSync(historyPath)) {
    try {
      games = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch (err) {
      console.error('[History] Error reading history.json:', err);
    }
  }
  
  const isMock = process.argv.includes('--mock');
  const gameId = isMock ? 'mock_game' : (activeLogDirectoryPath ? path.basename(activeLogDirectoryPath) : 'unknown_game');
  
  let gameIndex = games.findIndex(g => g.id === gameId);
  const heroStats = gameState.heroStats || {};
  
  const gameData = {
    id: gameId,
    localPlayerName: gameState.localPlayerName || 'Unknown',
    heroName: heroStats.heroName || 'Unknown Hero',
    heroCardId: heroStats.heroCardId || '',
    totalTurns: gameState.history.length,
    timestamp: gameState.history[0] ? gameState.history[0].timestamp : new Date().toISOString(),
    isFinished: !gameState.activeGame,
    history: gameState.history
  };
  
  if (gameIndex !== -1) {
    // Preserve isFinished state if it was already marked true
    gameData.isFinished = games[gameIndex].isFinished;
    games[gameIndex] = gameData;
  } else {
    // Insert at the beginning of the list (newest first)
    games.unshift(gameData);
  }
  
  try {
    fs.writeFileSync(historyPath, JSON.stringify(games, null, 2), 'utf8');
    lastSavedHistoryLength = gameState.history.length;
    console.log(`[History] Saved match progress to database. Turns: ${gameState.history.length}`);
  } catch (err) {
    console.error('[History] Error writing history.json:', err);
  }
}

function markActiveGameFinished() {
  const historyPath = getHistoryPath();
  if (!fs.existsSync(historyPath)) return;
  
  const isMock = process.argv.includes('--mock');
  const gameId = isMock ? 'mock_game' : (activeLogDirectoryPath ? path.basename(activeLogDirectoryPath) : 'unknown_game');
  
  try {
    let games = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    let gameIndex = games.findIndex(g => g.id === gameId);
    if (gameIndex !== -1) {
      games[gameIndex].isFinished = true;
      fs.writeFileSync(historyPath, JSON.stringify(games, null, 2), 'utf8');
      console.log(`[History] Marked active game ${gameId} as finished.`);
    }
  } catch (err) {
    console.error('[History] Error marking active game finished:', err);
  }
}

app.whenReady().then(() => {
  ensureLogConfig();
  createWindow();
  
  // Wait for window to load before starting log watcher or scanner
  mainWindow.webContents.on('did-finish-load', async () => {
    // 1. Clean up duplicate matches in the database on startup
    deduplicateHistoryDatabase();

    const isMock = process.argv.includes('--mock');
    if (isMock) {
      startTracking();
    } else {
      // 1. Initial scan and import on startup
      await scanAndImportMatches();
      
      // 2. Notify UI of initial status
      const isHsRunning = await isHearthstoneRunning();
      lastHearthstoneState = isHsRunning;
      mainWindow.webContents.send('hearthstone-status', isHsRunning);
      
      // 3. Start live tracking
      startTracking();
      
      // 4. Start background monitor
      startMonitoring();
    }
  });

  ipcMain.on('restart-tracking', (event, isRewind) => {
    console.log(`[Main] Restarting log tracking/simulation (isRewind: ${isRewind})...`);
    if (mainWindow) {
      mainWindow.webContents.send('new-session', 'restart');
    }
    startTracking(isRewind);
  });

  // History IPC Handlers
  ipcMain.handle('get-match-library', () => {
    const historyPath = getHistoryPath();
    if (!fs.existsSync(historyPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch (err) {
      console.error('[History] Error reading history.json for IPC:', err);
      return [];
    }
  });

  ipcMain.handle('delete-match', (event, gameId) => {
    const historyPath = getHistoryPath();
    if (!fs.existsSync(historyPath)) return false;
    try {
      let games = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      const initialLength = games.length;
      games = games.filter(g => g.id !== gameId);
      if (games.length < initialLength) {
        fs.writeFileSync(historyPath, JSON.stringify(games, null, 2), 'utf8');
        console.log(`[History] Deleted game ${gameId} from history.`);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[History] Error deleting match for IPC:', err);
      return false;
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
  // Force exit to ensure no zombie processes are left on Windows/macOS
  process.exit(0);
});
