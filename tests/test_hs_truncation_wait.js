const fs = require('fs');
const path = require('path');
const LogWatcher = require('../src/parser/logWatcher');

const testDir = path.join(__dirname, 'test_hs_trunc_logs');
const logFile = path.join(testDir, 'Power.log');

// Create test dir
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}
fs.writeFileSync(logFile, '');

console.log(`[Test] Created dummy log file at: ${logFile}`);

const watcher = new LogWatcher();
watcher.logsDir = testDir;
watcher.getLatestLogDirectory = () => testDir;

let receivedLines = [];
watcher.start(
  (line) => {
    receivedLines.push(line);
    console.log(`[Watcher Callback] Received line: ${line}`);
  },
  (dir) => {
    console.log(`[Test] Session started: ${dir}`);
  },
  true
);

// 1. Write initial lines
fs.appendFileSync(logFile, "Line 1 before truncation\nLine 2 before truncation\n");

// Wait for watcher to read it
setTimeout(() => {
  console.log(`\n[Test] Received lines so far: ${receivedLines.length}`);
  
  // 2. Write the truncation message
  console.log('[Test] Writing truncation message...');
  fs.appendFileSync(logFile, "Truncating log, which has reached the size limit of 10000KB\n");
  
  // 3. Immediately write some new lines that happen *after* truncation message but *before* actual file truncation
  fs.appendFileSync(logFile, "Line 3 write that shouldn't be lost\n");
  
  // Wait to let watcher read them
  setTimeout(() => {
    console.log(`\n[Test] Received lines after truncation message: ${receivedLines.length}`);
    console.log('Is waiting for truncation:', !!watcher.waitingForHearthstoneTruncation);
    
    // 4. Simulate a write while we are in the wait state (should be paused/not read)
    console.log('\n[Test] Writing Line 4 while in paused wait state...');
    fs.appendFileSync(logFile, "Line 4 write during pause\n");
    
    setTimeout(() => {
      console.log(`Received lines count (should not change): ${receivedLines.length}`);
      
      // 5. Simulate Hearthstone executing the truncation
      console.log('\n[Test] Simulating Hearthstone truncating the file to 0 bytes...');
      fs.writeFileSync(logFile, ''); // truncate to 0
      
      // 6. Hearthstone writes post-truncation logs starting at 0
      console.log('[Test] Writing post-truncation Line 5...');
      fs.appendFileSync(logFile, "Line 5 after truncation\n");
      
      // Wait for watcher to detect size drop, reset, and read Line 5
      setTimeout(() => {
        console.log(`\n[Test] Final Received lines count: ${receivedLines.length}`);
        console.log('All received lines:', JSON.stringify(receivedLines));
        
        watcher.stop();
        
        // Clean up
        try {
          fs.unlinkSync(logFile);
          fs.rmdirSync(testDir);
        } catch (e) {}
        
        const expected = [
          "Line 1 before truncation",
          "Line 2 before truncation",
          "Truncating log, which has reached the size limit of 10000KB",
          "Line 3 write that shouldn't be lost",
          "Line 5 after truncation"
        ];
        
        const ok = JSON.stringify(receivedLines) === JSON.stringify(expected);
        if (ok) {
          console.log('\nSUCCESS: Hearthstone native truncation tracking simulation passed perfectly!');
          process.exit(0);
        } else {
          console.error('\nFAILURE: Test did not pass. Received lines do not match expected sequence.');
          process.exit(1);
        }
      }, 2500);
    }, 2000);
  }, 2000);
}, 2000);
