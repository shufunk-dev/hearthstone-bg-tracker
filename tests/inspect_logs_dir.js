const fs = require('fs');
const path = require('path');
const LogWatcher = require('../src/parser/logWatcher');

const watcher = new LogWatcher();
console.log('Hearthstone Path:', watcher.hearthstonePath);
console.log('Logs Dir:', watcher.logsDir);
console.log('Player.log Path:', watcher.playerLogPath);

if (fs.existsSync(watcher.logsDir)) {
  const dirs = fs.readdirSync(watcher.logsDir);
  console.log('Session directories:');
  dirs.forEach(d => {
    try {
      const stats = fs.statSync(path.join(watcher.logsDir, d));
      if (stats.isDirectory()) {
        console.log(`- ${d} (created: ${stats.birthtime})`);
      }
    } catch (e) {
      // Ignore
    }
  });
} else {
  console.log('Logs directory does not exist!');
}
