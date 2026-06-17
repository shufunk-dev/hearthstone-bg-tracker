const LogWatcher = require('../src/parser/logWatcher');
const BGEventParser = require('../src/parser/bgEventParser');

console.log('=== HEARTHSTONE BATTLEGROUNDS TRACKER - LIVE EVENT TEST ===');
console.log('Launch Hearthstone and play a Battlegrounds match to see events live.');
console.log('Press Ctrl+C to stop.\n');

const parser = new BGEventParser();
const watcher = new LogWatcher();

// Track session changes
watcher.start(
  (line) => {
    // Parse the log line
    parser.parseLine(line);
  },
  (newDir) => {
    console.log(`\n[System] New game session detected at: ${newDir}`);
    parser.reset();
  }
);

// Keep script running and handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping live log watcher...');
  watcher.stop();
  process.exit(0);
});
