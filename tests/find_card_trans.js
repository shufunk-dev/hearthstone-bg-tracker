const fs = require('fs');
const readline = require('readline');

const logFilePath = 'C:\\Program Files (x86)\\Hearthstone\\Logs\\Hearthstone_2026_05_27_05_15_59\\Power.log';

async function analyze() {
  const fileStream = fs.createReadStream(logFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  let bgStarted = false;
  let players = {}; // map of player ID to name
  let cards = {}; // map of card entity ID to current state

  // Regex to match TAG_CHANGE lines
  // Example: TAG_CHANGE Entity=[entityName=Kael'thas Sunstrider id=100 zone=HAND zonePos=4 cardId=TB_BaconShop_HERO_60 player=2] tag=ZONE value=SETASIDE
  // Or: TAG_CHANGE Entity=GameEntity tag=TURN value=1
  // Or: TAG_CHANGE Entity=shufunk#1645 tag=PLAYER_ID value=1
  const tagChangeRegex = /TAG_CHANGE Entity=(.*?) tag=(.*?) value=(.*)/;
  // Entity object in brackets: [entityName=Alleycat id=432 zone=PLAY zonePos=1 cardId=BG_Ysera_011 player=1]
  const entityBracketRegex = /\[entityName=(.*?) id=(\d+).*?cardId=(.*?) player=(\d+)\]/;

  for await (const line of rl) {
    lineCount++;
    if (line.includes('GT_BATTLEGROUNDS')) {
      bgStarted = true;
    }

    if (!bgStarted) continue;

    const match = line.match(tagChangeRegex);
    if (match) {
      const entityStr = match[1].trim();
      const tag = match[2].trim();
      const value = match[3].trim();

      // Check player ID association
      if (tag === 'PLAYER_ID') {
        players[value] = entityStr;
        // console.log(`Player ID ${value} associated with ${entityStr}`);
        continue;
      }

      if (tag === 'ZONE') {
        const entityMatch = entityStr.match(entityBracketRegex);
        if (entityMatch) {
          const name = entityMatch[1];
          const id = entityMatch[2];
          const cardId = entityMatch[3];
          const player = entityMatch[4];

          // Skip hero cards
          if (cardId.includes('HERO') || name.includes('Hero')) continue;

          // Track transition
          const oldZone = cards[id] ? cards[id].zone : 'UNKNOWN';
          cards[id] = { name, cardId, player, zone: value };

          // We only care about player's hand/play transitions
          // If the player is the local player (which we can determine from player name, let's say player is 1 or 2)
          console.log(`[Line ${lineCount}] Card "${name}" (id=${id}, cardId=${cardId}, player=${player}) changed ZONE from ${oldZone} -> ${value}`);
        } else {
          // Sometimes entity is just a number (id)
          const id = entityStr;
          if (cards[id]) {
            const card = cards[id];
            const oldZone = card.zone;
            card.zone = value;
            console.log(`[Line ${lineCount}] Card "${card.name}" (id=${id}, player=${card.player}) changed ZONE from ${oldZone} -> ${value} (by ID reference)`);
          }
        }
      }
    }
  }
}

analyze().catch(err => console.error(err));
