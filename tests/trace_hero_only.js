const fs = require('fs');
const readline = require('readline');
const path = require('path');
const LogWatcher = require('../src/parser/logWatcher');

async function run() {
  const watcher = new LogWatcher();
  const logPath = watcher.playerLogPath;
  
  if (!fs.existsSync(logPath)) {
    console.log(`Player.log not found at: ${logPath}`);
    return;
  }
  
  console.log(`Scanning heroes in ${logPath}...`);
  
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let localPlayerName = null;
  let localPlayerId = null;
  const playerNames = {};
  
  for await (const line of rl) {
    if (line.includes('PlayerID=') && line.includes('PlayerName=')) {
      const match = line.match(/PlayerID=(\d+),\s*PlayerName=(.+)/);
      if (match) {
        const id = parseInt(match[1], 10);
        const name = match[2].trim();
        playerNames[id] = name;
        if (name.includes('#')) {
          localPlayerId = id;
          localPlayerName = name;
        }
      }
    }
  }
  
  console.log('Player Names:', playerNames);
  console.log(`Local player is ID=${localPlayerId} (${localPlayerName})`);
  
  const fileStream2 = fs.createReadStream(logPath);
  const rl2 = readline.createInterface({
    input: fileStream2,
    crlfDelay: Infinity
  });
  
  const heroEntities = {};
  
  for await (const line of rl2) {
    // FULL_ENTITY or SHOW_ENTITY
    const matchFull = line.match(/FULL_ENTITY - Creating ID=(\d+)\s+CardID=(\w+)/);
    if (matchFull) {
      const id = parseInt(matchFull[1], 10);
      const cardId = matchFull[2];
      if (cardId.includes('HERO') || cardId.startsWith('BG')) {
        heroEntities[id] = { id, cardId, name: '', player: null, zone: 'UNKNOWN', tags: {} };
      }
    }
    
    const matchShow = line.match(/(?:SHOW_ENTITY - Updating Entity=|FULL_ENTITY - Updating\s+)(\[.*?\])\s+CardID=(\w+)/);
    if (matchShow) {
      const entityStr = matchShow[1];
      const cardId = matchShow[2];
      const parsed = parseEntityString(entityStr);
      if (parsed && (cardId.includes('HERO') || cardId.startsWith('BG'))) {
        if (!heroEntities[parsed.id]) {
          heroEntities[parsed.id] = { id: parsed.id, cardId, name: '', player: null, zone: 'UNKNOWN', tags: {} };
        }
        heroEntities[parsed.id].name = parsed.name || heroEntities[parsed.id].name;
        heroEntities[parsed.id].cardId = cardId;
        if (parsed.player) heroEntities[parsed.id].player = parsed.player;
        if (parsed.zone) heroEntities[parsed.id].zone = parsed.zone;
      }
    }
    
    // Tag changes
    if (line.includes('TAG_CHANGE')) {
      const matchTag = line.match(/TAG_CHANGE Entity=(.*?)\s+tag=(.*?)\s+value=(.*)/);
      if (matchTag) {
        const entityStr = matchTag[1];
        const tag = matchTag[2];
        const val = matchTag[3];
        
        let entityId = null;
        if (entityStr.startsWith('[')) {
          const parsed = parseEntityString(entityStr);
          if (parsed) {
            entityId = parsed.id;
          }
        } else if (/^\d+$/.test(entityStr)) {
          entityId = parseInt(entityStr, 10);
        }
        
        if (entityId && heroEntities[entityId]) {
          heroEntities[entityId].tags[tag] = val;
          if (tag === 'ZONE') heroEntities[entityId].zone = val;
          if (tag === 'CONTROLLER') heroEntities[entityId].player = parseInt(val, 10);
          if (tag === 'CARDTYPE') heroEntities[entityId].tags.CARDTYPE = val;
        }
      }
    }
  }
  
  console.log('\nHERO entities found:');
  for (const id in heroEntities) {
    const ent = heroEntities[id];
    // Filter to CARDTYPE=HERO or CARDTYPE=3 or cardId containing HERO
    const isRealHero = ent.cardId.includes('HERO') && (ent.tags.CARDTYPE === 'HERO' || ent.tags.CARDTYPE === '3' || ent.tags.CARDTYPE === undefined);
    if (isRealHero && ent.zone !== 'UNKNOWN') {
      const ownerName = playerNames[ent.player] || `Player ${ent.player}`;
      console.log(`- Entity ID: ${ent.id}, Name: ${ent.name}, CardID: ${ent.cardId}, Owner: ${ownerName} (ID=${ent.player}), Zone: ${ent.zone}`);
    }
  }
}

function parseEntityString(str) {
  if (!str.startsWith('[') || !str.endsWith(']')) return null;
  const res = {};
  const entityNameMatch = str.match(/entityName=(.*?)(?=\s+\w+=|$)/);
  const idMatch = str.match(/id=(\d+)/);
  const zoneMatch = str.match(/zone=(\w+)/);
  const playerMatch = str.match(/player=(\d+)/);
  if (entityNameMatch) res.name = entityNameMatch[1];
  if (idMatch) res.id = parseInt(idMatch[1], 10);
  if (zoneMatch) res.zone = zoneMatch[1];
  if (playerMatch) res.player = parseInt(playerMatch[1], 10);
  return res;
}

run().catch(err => console.error(err));
