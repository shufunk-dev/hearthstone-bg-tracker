const fs = require('fs');
const path = require('path');

class LogWatcher {
  constructor(customHearthstonePath = null) {
    this.hearthstonePath = customHearthstonePath || this.detectHearthstonePath();
    this.logsDir = path.join(this.hearthstonePath, 'Logs');
    this.playerLogPath = this.detectPlayerLogPath();
    
    this.watcherInterval = null;
    this.lastReadPosition = 0;
  }

  // Detect Hearthstone Path on Windows
  detectHearthstonePath() {
    const paths = [
      'C:\\Program Files (x86)\\Hearthstone',
      'C:\\Program Files\\Hearthstone',
      path.join(process.env.LOCALAPPDATA || 'C:\\Users\\shufu\\AppData\\Local', 'Blizzard', 'Hearthstone')
    ];

    for (const p of paths) {
      if (fs.existsSync(p) && fs.existsSync(path.join(p, 'Logs'))) {
        return p;
      }
    }
    
    // Default to x86 path if not found
    return 'C:\\Program Files (x86)\\Hearthstone';
  }

  // Detect Player.log path on Windows
  detectPlayerLogPath() {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\shufu';
    return path.join(userProfile, 'AppData', 'LocalLow', 'Blizzard Entertainment', 'Hearthstone', 'Player.log');
  }

  // Start watching Player.log in real-time
  start(onLine, onSessionStart, onCatchUpComplete) {
    this.stop();
    
    const logPath = this.playerLogPath;
    console.log(`[LogWatcher] Starting watch on: ${logPath}`);
    
    if (!fs.existsSync(logPath)) {
      console.log(`[LogWatcher] Player.log does not exist yet.`);
      this.lastReadPosition = 0;
    } else {
      const stats = fs.statSync(logPath);
      this.lastReadPosition = 0; // Always start from 0 to catch up
      console.log(`[LogWatcher] Catching up from position 0 (file size: ${stats.size} bytes)`);
    }

    let buffer = '';
    let isFirstRead = true;
    
    const checkFile = () => {
      if (!fs.existsSync(logPath)) {
        this.lastReadPosition = 0;
        return;
      }
      
      try {
        const stats = fs.statSync(logPath);
        const size = stats.size;
        
        if (size < this.lastReadPosition) {
          console.log(`[LogWatcher] File truncation detected. Resetting position to 0.`);
          this.lastReadPosition = 0;
          buffer = '';
          if (onSessionStart) onSessionStart();
        }
        
        if (size > this.lastReadPosition) {
          const fd = fs.openSync(logPath, 'r');
          const readLength = size - this.lastReadPosition;
          const buf = Buffer.alloc(readLength);
          fs.readSync(fd, buf, 0, readLength, this.lastReadPosition);
          fs.closeSync(fd);
          
          this.lastReadPosition = size;
          
          const chunk = buf.toString('utf8');
          buffer += chunk;
          
          let lineEnd = buffer.indexOf('\n');
          while (lineEnd !== -1) {
            const line = buffer.substring(0, lineEnd).replace(/\r$/, '');
            buffer = buffer.substring(lineEnd + 1);
            
            // Filter out lines that don't belong to the [Power] subsystem to prevent bloat
            if (line.includes('[Power]') || line.includes('GameState') || line.includes('PowerTaskList') || line.includes('GameType=GT_BATTLEGROUNDS') || line.includes('PlayerID=')) {
              onLine(line);
            }
            
            lineEnd = buffer.indexOf('\n');
          }
        }

        if (isFirstRead) {
          isFirstRead = false;
          if (onCatchUpComplete) {
            console.log(`[LogWatcher] Initial catch-up complete.`);
            onCatchUpComplete();
          }
        }
      } catch (err) {
        console.error(`[LogWatcher] Error reading file updates:`, err);
      }
    };
    
    // Poll every 500ms
    this.watcherInterval = setInterval(checkFile, 500);
    checkFile();
  }

  // Stop watching
  stop() {
    if (this.watcherInterval) {
      clearInterval(this.watcherInterval);
      this.watcherInterval = null;
    }
    this.lastReadPosition = 0;
  }

  // Find the latest Hearthstone log directory
  getLatestLogDirectory() {
    if (!fs.existsSync(this.logsDir)) {
      return null;
    }
    try {
      const files = fs.readdirSync(this.logsDir);
      const logDirs = files
        .filter(f => f.startsWith('Hearthstone_') && fs.statSync(path.join(this.logsDir, f)).isDirectory())
        .sort();
      return logDirs.length > 0 ? path.join(this.logsDir, logDirs[logDirs.length - 1]) : null;
    } catch (e) {
      return null;
    }
  }

  // Get list of Hearthstone session subdirectories lock-free
  getSessionDirectories() {
    if (!fs.existsSync(this.logsDir)) {
      return [];
    }
    try {
      const files = fs.readdirSync(this.logsDir);
      return files
        .filter(f => f.startsWith('Hearthstone_') && fs.statSync(path.join(this.logsDir, f)).isDirectory())
        .sort();
    } catch (e) {
      return [];
    }
  }

  // Read a completed Power.log file in full
  readFullLog(filePath) {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return content.split(/\r?\n/);
    } catch (err) {
      console.error(`[LogWatcher] Error reading log file in full:`, err);
      return [];
    }
  }
}

module.exports = LogWatcher;
