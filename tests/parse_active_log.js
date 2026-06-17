const fs = require('fs');
const readline = require('readline');
const path = require('path');
const LogWatcher = require('../src/parser/logWatcher');
const BGEventParser = require('../src/parser/bgEventParser');

async function run() {
  const watcher = new LogWatcher();
  const logPath = watcher.playerLogPath;
  
  if (!fs.existsSync(logPath)) {
    console.log(`Player.log not found at: ${logPath}`);
    return;
  }
  
  console.log(`Parsing active log: ${logPath}`);
  
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  const parser = new BGEventParser();
  let lineCount = 0;
  
  for await (const line of rl) {
    lineCount++;
    parser.parseLine(line);
  }
  
  parser.finalizeGame();
  
  console.log('\n================ PARSED GAME SUMMARY ================');
  console.log(`Local Player: ${parser.localPlayerName} (ID: ${parser.localPlayerId})`);
  console.log(`Active Hero Entity ID: ${parser.localPlayerHeroEntityId}`);
  const finalHeroStats = parser.getHeroStats();
  console.log(`Final Hero Stats: Name=${finalHeroStats.heroName}, CardID=${finalHeroStats.heroCardId}, HP=${finalHeroStats.health}, Armor=${finalHeroStats.armor}`);
  console.log(`Total Turns Parsed: ${parser.history.length}`);
  
  parser.history.forEach(t => {
    console.log(`Turn ${t.turn} (${t.phase}): heroName=${t.heroName}, heroCardId=${t.heroCardId}, playerHeroEntityId=${t.playerHeroEntityId}`);
  });
}

run().catch(err => console.error(err));
