const fs = require('fs');
const readline = require('readline');
const path = require('path');
const BGEventParser = require('../src/parser/bgEventParser');

async function run() {
  const logFilePath = path.join(__dirname, 'mock-logs', 'Power_BG_match.log');
  
  if (!fs.existsSync(logFilePath)) {
    console.error(`Mock log file not found at: ${logFilePath}`);
    process.exit(1);
  }

  console.log(`[Test] Loading mock log file: ${logFilePath}`);
  const parser = new BGEventParser();

  const fileStream = fs.createReadStream(logFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  const startTime = Date.now();

  for await (const line of rl) {
    lineCount++;
    parser.parseLine(line);
  }

  parser.finalizeGame();
  
  const endTime = Date.now();
  console.log(`[Test] Parsed ${lineCount} lines in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);

  // Print Summary
  console.log('\n================ GAME PLAY REPLAY SUMMARY ================');
  console.log(`Local Player: ${parser.localPlayerName} (ID: ${parser.localPlayerId})`);
  console.log(`Total Turns: ${parser.history.length}`);
  
  parser.history.forEach(t => {
    console.log(`\nTurn ${t.turn} (${t.phase})`);
    if (t.opponent && t.opponent !== 'Unknown') {
      console.log(`  Opponent: ${t.opponent} (ID: ${t.opponentId})`);
    }
    
    if (t.buys.length > 0) {
      console.log(`  Bought: ${t.buys.map(b => `${b.name} (id=${b.id})`).join(', ')}`);
    }
    if (t.sells.length > 0) {
      console.log(`  Sold: ${t.sells.map(s => `${s.name} (id=${s.id})`).join(', ')}`);
    }
    if (t.plays.length > 0) {
      console.log(`  Played: ${t.plays.map(p => `${p.name} (id=${p.id})`).join(', ')}`);
    }
    
    if (t.phase === 'RECRUIT' && t.board.length > 0) {
      console.log(`  Board Minions at End of Turn:`);
      t.board.forEach(m => {
        let tagsStr = [];
        if (m.taunt) tagsStr.push('Taunt');
        if (m.divineShield) tagsStr.push('Divine Shield');
        if (m.reborn) tagsStr.push('Reborn');
        if (m.poisonous) tagsStr.push('Poisonous');
        if (m.venomous) tagsStr.push('Venomous');
        if (m.stealth) tagsStr.push('Stealth');
        if (m.windfury) tagsStr.push('Windfury');
        
        console.log(`    - [Pos ${m.zonePos}] ${m.name} (${m.atk}/${m.health}) ${tagsStr.length > 0 ? `[${tagsStr.join(', ')}]` : ''}`);
      });
    }

    if (t.damageDealt !== 0) {
      console.log(`  Combat Outcome: Dealt/Took ${t.damageDealt} damage`);
    }
  });

  // Save output to JSON
  const outputPath = path.join(__dirname, 'test_output.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    localPlayerName: parser.localPlayerName,
    localPlayerId: parser.localPlayerId,
    totalTurns: parser.history.length,
    history: parser.history
  }, null, 2));
  
  console.log(`\n[Test] Saved game history output to: ${outputPath}`);
}

run().catch(err => console.error(err));
