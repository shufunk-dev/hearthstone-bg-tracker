const fs = require('fs');
const readline = require('readline');

const logFilePath = 'C:\\Program Files (x86)\\Hearthstone\\Logs\\Hearthstone_2026_05_27_05_15_59\\Power.log';

async function trace() {
  const fileStream = fs.createReadStream(logFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  let bgStarted = false;
  let currentTurn = 0;

  const tagChangeRegex = /TAG_CHANGE Entity=(.*?) tag=(.*?) value=(.*)/;
  const entityBracketRegex = /\[entityName=(.*?) id=(\d+).*?cardId=(.*?) player=(\d+)\]/;

  for await (const line of rl) {
    lineCount++;
    if (line.includes('GT_BATTLEGROUNDS')) {
      bgStarted = true;
    }

    if (!bgStarted) continue;

    // Detect Turn Changes
    if (line.includes('Entity=GameEntity tag=TURN')) {
      const turnMatch = line.match(/value=(\d+)/);
      if (turnMatch) {
        currentTurn = parseInt(turnMatch[1], 10);
        console.log(`\n=================== TURN ${currentTurn} (${currentTurn % 2 === 1 ? 'RECRUIT' : 'COMBAT'}) ===================\n`);
      }
    }

    // Look for zone changes of player 2 cards
    const match = line.match(tagChangeRegex);
    if (match) {
      const entityStr = match[1].trim();
      const tag = match[2].trim();
      const value = match[3].trim();

      if (tag === 'ZONE') {
        const entityMatch = entityStr.match(entityBracketRegex);
        if (entityMatch) {
          const name = entityMatch[1];
          const id = entityMatch[2];
          const cardId = entityMatch[3];
          const player = entityMatch[4];

          if (player === '2') {
            // Check if it's not a hero/game entity
            if (cardId.includes('HERO') || cardId.includes('BaconShop') || name.includes('Hero') || cardId === '') continue;
            
            console.log(`[Line ${lineCount}] Minion "${name}" (id=${id}) changed zone to ${value}`);
          }
        }
      }
    }
  }
}

trace().catch(err => console.error(err));
