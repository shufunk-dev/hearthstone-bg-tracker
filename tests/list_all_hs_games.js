const fs = require('fs');
const path = require('path');
const LogWatcher = require('../src/parser/logWatcher');
const BGEventParser = require('../src/parser/bgEventParser');

const watcher = new LogWatcher();
const sessionDirs = watcher.getSessionDirectories();

console.log(`Found ${sessionDirs.length} session directories.`);

sessionDirs.forEach(dirName => {
  const dirPath = path.join(watcher.logsDir, dirName);
  const logFilePath = path.join(dirPath, 'Power.log');
  
  if (!fs.existsSync(logFilePath)) {
    console.log(`[Session ${dirName}] No Power.log file.`);
    return;
  }
  
  const stats = fs.statSync(logFilePath);
  console.log(`\n[Session ${dirName}] Power.log size: ${(stats.size / 1024).toFixed(1)} KB`);
  
  const lines = watcher.readFullLog(logFilePath);
  const parser = new BGEventParser();
  let gameCount = 0;
  let gameActive = false;
  
  for (const line of lines) {
    parser.parseLine(line);
    if (parser.activeGame) {
      if (!gameActive) {
        gameActive = true;
        gameCount++;
      }
    } else {
      if (gameActive) {
        parser.finalizeGame();
        const heroStats = parser.getHeroStats();
        console.log(`  - Game ${gameCount}: Hero: ${heroStats.heroName} (${heroStats.heroCardId}), turns: ${parser.history.length}`);
        gameActive = false;
      }
    }
  }
  
  if (gameActive) {
    parser.finalizeGame();
    const heroStats = parser.getHeroStats();
    console.log(`  - Game ${gameCount} (Unfinished): Hero: ${heroStats.heroName} (${heroStats.heroCardId}), turns: ${parser.history.length}`);
  }
});
