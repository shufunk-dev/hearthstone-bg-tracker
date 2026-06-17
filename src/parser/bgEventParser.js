const fs = require('fs');

class BGEventParser {
  constructor() {
    this.reset();
  }

  reset() {
    this.entities = {}; // id -> entity object
    this.localPlayerId = null;
    this.localPlayerName = null;
    this.currentTurn = 0;
    this.phase = 'UNKNOWN'; // 'RECRUIT' | 'COMBAT' | 'HERO_SELECT'
    this.history = [];
    this.activeGame = false;
    
    // Temp tracking for the current turn
    this.currentTurnData = null;
    this.heroes = {}; // player_id -> { heroName, cardId, health, armor }
    this.players = {}; // player_id -> player name
    this.opponentId = null;
    this.opponentLobbyId = null;
    this.activeOpponentId = null;
    this.activeOpponentHeroId = null;
    this.localPlayerHeroEntityId = null;
    this.localPlayerHeroResolved = false;
    this.lastEntityId = null;
    
    // Opponent starting board tracking variables
    this.combatOpponentBoardCaptured = false;
    this.tempOpponentBoard = [];
    this.tempAttackerId = null;
    this.tempDefenderId = null;
    this.opponentStartingTotal = 0;
  }

  // Parse a bracketed entity string, e.g.:
  // [entityName=Dune Dweller id=407 zone=PLAY zonePos=1 cardId=BG31_815 player=2]
  parseEntityString(str) {
    if (!str.startsWith('[') || !str.endsWith(']')) return null;
    
    const res = {};
    const pairs = str.slice(1, -1).split(/\s+/);
    
    // Some values might have spaces, but the standard output tags are key=value
    // e.g. entityName=Dune Dweller
    // We can parse using regular expressions for keys: entityName, id, zone, zonePos, cardId, player
    const entityNameMatch = str.match(/entityName=(.*?)(?=\s+\w+=|$)/);
    const idMatch = str.match(/id=(\d+)/);
    const zoneMatch = str.match(/zone=(\w+)/);
    const zonePosMatch = str.match(/zonePos=(\d+)/);
    const cardIdMatch = str.match(/cardId=(\w*)/);
    const playerMatch = str.match(/player=(\d+)/);

    if (entityNameMatch) res.name = entityNameMatch[1];
    if (idMatch) res.id = parseInt(idMatch[1], 10);
    if (zoneMatch) res.zone = zoneMatch[1];
    if (zonePosMatch) res.zonePos = parseInt(zonePosMatch[1], 10);
    if (cardIdMatch) res.cardId = cardIdMatch[1];
    if (playerMatch) res.player = parseInt(playerMatch[1], 10);

    return res;
  }

  // Get or create entity in our cache
  getEntity(id, defaultName = '', defaultCardId = '') {
    if (!this.entities[id]) {
      this.entities[id] = {
        id: parseInt(id, 10),
        name: defaultName,
        cardId: defaultCardId,
        zone: 'UNKNOWN',
        zonePos: 0,
        player: null,
        tags: {}
      };
    }
    if (defaultName && (!this.entities[id].name || /^unknown/i.test(this.entities[id].name))) {
      this.entities[id].name = defaultName;
    }
    if (defaultCardId && !this.entities[id].cardId) {
      this.entities[id].cardId = defaultCardId;
    }
    return this.entities[id];
  }

  // Capture board state for local player
  getBoardState() {
    const board = [];
    for (const id in this.entities) {
      const entity = this.entities[id];
      const zonePos = entity.zonePos || entity.tags.ZONE_POSITION || 0;
      // Local player is this.localPlayerId (e.g. 2)
      if (entity.zone === 'PLAY' && entity.player === this.localPlayerId && entity.tags.CARDTYPE === 'MINION' && entity.cardId && !entity.cardId.includes('BaconShop') && zonePos > 0) {
        board.push({
          id: entity.id,
          name: entity.name,
          cardId: entity.cardId,
          zonePos: zonePos,
          atk: entity.tags.ATK || 0,
          health: entity.tags.HEALTH || 0,
          maxHealth: entity.tags.HEALTH || 0, // In recruit phase, HEALTH is current and max
          divineShield: entity.tags.DIVINE_SHIELD === 1,
          taunt: entity.tags.TAUNT === 1,
          reborn: entity.tags.REBORN === 1,
          poisonous: entity.tags.POISONOUS === 1,
          venomous: entity.tags.VENOMOUS === 1,
          stealth: entity.tags.STEALTH === 1,
          windfury: entity.tags.WINDFURY === 1,
          premium: entity.tags.PREMIUM === 1
        });
      }
    }
    
    // Sort by zone position
    board.sort((a, b) => a.zonePos - b.zonePos);
    return board;
  }

  // Helper to determine if an entity is a real, playable hero (not a draft choice placeholder or Bob)
  isRealHeroEntity(entity) {
    if (!entity || !entity.cardId) return false;
    const cardId = entity.cardId;
    
    // Must be a hero type
    const isHeroType = cardId.includes('HERO') || entity.tags.CARDTYPE === 'HERO' || entity.tags.CARDTYPE === 3;
    if (!isHeroType) return false;
    
    // Exclude hero powers, buddies, and enchantments
    if (cardId.includes('HERO_POWER') || cardId.includes('Buddy') || cardId.includes('Enchantment')) return false;
    if (cardId.endsWith('p') || cardId.endsWith('p2') || cardId.endsWith('p3') || cardId.endsWith('p4')) return false;
    
    if (entity.tags.CARDTYPE && entity.tags.CARDTYPE !== 'HERO' && entity.tags.CARDTYPE !== 3) {
      return false;
    }

    // Exclude placeholders and bartender/Bob cards
    if (cardId.includes('HERO_PH')) return false;
    if (cardId.includes('BaconShopBob') || cardId.includes('Bob') || cardId === 'BaconShop') return false;

    return true;
  }

  getControllerIdFromLobbyPlayerId(lobbyPlayerId) {
    if (!lobbyPlayerId) return null;
    for (const id in this.entities) {
      const entity = this.entities[id];
      if (entity.tags && entity.tags.PLAYER_ID === lobbyPlayerId && this.isRealHeroEntity(entity)) {
        return entity.player || entity.tags.CONTROLLER;
      }
    }
    return null;
  }

  getOpponentControllerId() {
    if (this.activeOpponentId) {
      return this.activeOpponentId;
    }
    
    // Try to resolve opponentId from opponentLobbyId dynamically
    if (this.opponentLobbyId) {
      const controllerId = this.getControllerIdFromLobbyPlayerId(this.opponentLobbyId);
      if (controllerId) {
        this.opponentId = controllerId;
        this.activeOpponentId = controllerId;
        return controllerId;
      }
    }
    
    if (this.opponentId) {
      // If it's a lobby player ID (1-8), try to resolve it to controller ID
      if (this.opponentId >= 1 && this.opponentId <= 8) {
        const controllerId = this.getControllerIdFromLobbyPlayerId(this.opponentId);
        if (controllerId) {
          this.opponentId = controllerId;
          this.activeOpponentId = controllerId;
          return controllerId;
        }
      }
      return this.opponentId;
    }
    // Find the opponent hero entity in PLAY whose controller is not localPlayerId
    for (const id in this.entities) {
      const entity = this.entities[id];
      if (entity.player && entity.player !== this.localPlayerId && entity.zone === 'PLAY' && this.isRealHeroEntity(entity)) {
        this.activeOpponentId = entity.player;
        return entity.player;
      }
    }
    // Fallback: search in SETASIDE
    for (const id in this.entities) {
      const entity = this.entities[id];
      if (entity.player && entity.player !== this.localPlayerId && entity.zone === 'SETASIDE' && this.isRealHeroEntity(entity)) {
        this.activeOpponentId = entity.player;
        return entity.player;
      }
    }
    // Fallback to players map other player ID
    for (const pIdStr in this.players) {
      const pId = parseInt(pIdStr, 10);
      if (pId !== this.localPlayerId) {
        return pId;
      }
    }
    return this.localPlayerId === 1 ? 9 : 10;
  }

  // Capture starting board state for opponent in combat
  getOpponentBoardState() {
    const board = [];
    const oppId = this.getOpponentControllerId();
    for (const id in this.entities) {
      const entity = this.entities[id];
      const zonePos = entity.zonePos || entity.tags.ZONE_POSITION || 0;
      
      // Ensure minion belongs to the current opponent player. Ensure zonePos > 0 to filter out dead/removed copies from previous combat
      if (entity.zone === 'PLAY' && entity.player === oppId && entity.tags.CARDTYPE === 'MINION' && entity.cardId && !entity.cardId.includes('BaconShop') && zonePos > 0) {
        board.push({
          id: entity.id,
          name: entity.name,
          cardId: entity.cardId,
          zonePos: zonePos,
          atk: entity.tags.ATK || 0,
          health: entity.tags.HEALTH || 0,
          maxHealth: entity.tags.HEALTH || 0,
          divineShield: entity.tags.DIVINE_SHIELD === 1,
          taunt: entity.tags.TAUNT === 1,
          reborn: entity.tags.REBORN === 1,
          poisonous: entity.tags.POISONOUS === 1,
          venomous: entity.tags.VENOMOUS === 1,
          stealth: entity.tags.STEALTH === 1,
          windfury: entity.tags.WINDFURY === 1,
          premium: entity.tags.PREMIUM === 1
        });
      }
    }
    board.sort((a, b) => a.zonePos - b.zonePos);
    return board;
  }

  // Helper to construct a normalized hero stats object
  buildHeroStatsObject(entity) {
    const damage = entity.tags.DAMAGE !== undefined ? entity.tags.DAMAGE : (entity.tags[3] !== undefined ? entity.tags[3] : 0);
    const startingHealth = entity.tags[3025] !== undefined ? entity.tags[3025] : (entity.tags.HEALTH !== undefined ? entity.tags.HEALTH : 30);
    const armor = entity.tags.ARMOR !== undefined ? entity.tags.ARMOR : (entity.tags[3026] !== undefined ? entity.tags[3026] : 0);
    
    return {
      heroName: entity.name || 'Unknown Hero',
      heroCardId: entity.cardId || '',
      health: startingHealth - damage,
      armor: armor
    };
  }

  // Helper to get local player's hero health and armor
  getHeroStats() {
    // If we have resolved the chosen hero, return it directly
    if (this.localPlayerHeroResolved && this.localPlayerHeroEntityId) {
      const entity = this.entities[this.localPlayerHeroEntityId];
      if (entity) {
        return this.buildHeroStatsObject(entity);
      }
    }

    // 1. Try to find the hero entity in PLAY (chosen hero)
    for (const id in this.entities) {
      const entity = this.entities[id];
      if (entity.player === this.localPlayerId && entity.zone === 'PLAY' && this.isRealHeroEntity(entity)) {
        this.localPlayerHeroEntityId = entity.id;
        this.localPlayerHeroResolved = true; // Lock cache
        return this.buildHeroStatsObject(entity);
      }
    }

    // 2. If not locked, check if the currently cached temporary hero is still valid
    if (this.localPlayerHeroEntityId) {
      const entity = this.entities[this.localPlayerHeroEntityId];
      if (entity && entity.zone !== 'REMOVEDFROMGAME' && entity.zone !== 'GRAVEYARD') {
        return this.buildHeroStatsObject(entity);
      }
      this.localPlayerHeroEntityId = null; // Clear invalid temp cache
    }

    // 3. Fallback: search SETASIDE for draft choices
    for (const id in this.entities) {
      const entity = this.entities[id];
      if (entity.player === this.localPlayerId && entity.zone === 'SETASIDE' && this.isRealHeroEntity(entity)) {
        this.localPlayerHeroEntityId = entity.id;
        return this.buildHeroStatsObject(entity);
      }
    }

    // 4. Fallback: search any other zone except REMOVEDFROMGAME/GRAVEYARD
    for (const id in this.entities) {
      const entity = this.entities[id];
      if (entity.player === this.localPlayerId && entity.zone !== 'REMOVEDFROMGAME' && entity.zone !== 'GRAVEYARD' && this.isRealHeroEntity(entity)) {
        this.localPlayerHeroEntityId = entity.id;
        return this.buildHeroStatsObject(entity);
      }
    }

    // 5. Fallback to this.heroes
    if (this.localPlayerId && this.heroes[this.localPlayerId]) {
      const cached = this.heroes[this.localPlayerId];
      return {
        heroName: cached.heroName || 'Unknown Hero',
        heroCardId: cached.cardId || '',
        health: 30,
        armor: 0
      };
    }
    return { heroName: 'Unknown Hero', heroCardId: '', health: 30, armor: 0 };
  }

  // Helper to get opponent player's hero health and armor
  getOpponentHeroStats() {
    // 0. Try to use activeOpponentHeroId directly
    if (this.activeOpponentHeroId) {
      const entity = this.entities[this.activeOpponentHeroId];
      if (entity) {
        return this.buildHeroStatsObject(entity);
      }
    }
    
    // 0.5. Try to find the exact opponent hero by lobby player ID (PLAYER_ID tag) to prevent matching other lobby heroes sharing controller ID
    if (this.opponentLobbyId) {
      for (const id in this.entities) {
        const entity = this.entities[id];
        if (entity.tags && entity.tags.PLAYER_ID === this.opponentLobbyId && this.isRealHeroEntity(entity)) {
          return this.buildHeroStatsObject(entity);
        }
      }
    }

    const oppId = this.getOpponentControllerId();
    // 1. Try to find the opponent hero entity in PLAY
    for (const id in this.entities) {
      const entity = this.entities[id];
      if (entity.player === oppId && entity.zone === 'PLAY' && this.isRealHeroEntity(entity)) {
        return this.buildHeroStatsObject(entity);
      }
    }
    // 2. Try to find the opponent hero entity in SETASIDE
    for (const id in this.entities) {
      const entity = this.entities[id];
      if (entity.player === oppId && entity.zone === 'SETASIDE' && this.isRealHeroEntity(entity)) {
        return this.buildHeroStatsObject(entity);
      }
    }
    // 3. Try to find the opponent hero entity in ANY zone EXCEPT REMOVEDFROMGAME
    for (const id in this.entities) {
      const entity = this.entities[id];
      if (entity.player === oppId && entity.zone !== 'REMOVEDFROMGAME' && this.isRealHeroEntity(entity)) {
        return this.buildHeroStatsObject(entity);
      }
    }
    // 4. Fallback to this.heroes
    if (oppId && this.heroes[oppId]) {
      const cached = this.heroes[oppId];
      return {
        heroName: cached.heroName || 'Unknown Opponent',
        heroCardId: cached.cardId || '',
        health: 30,
        armor: 0
      };
    }
    return { heroName: 'Unknown Opponent', heroCardId: '', health: 30, armor: 0 };
  }

  // End the current turn phase and commit to history
  endTurnPhase() {
    if (!this.currentTurnData) return;

    if (this.phase === 'RECRUIT') {
      // Capture board at the end of recruit
      this.currentTurnData.board = this.getBoardState();
      
      const heroStats = this.getHeroStats();
      this.currentTurnData.heroName = heroStats.heroName;
      this.currentTurnData.heroCardId = heroStats.heroCardId;
      this.currentTurnData.health = heroStats.health;
      this.currentTurnData.armor = heroStats.armor;
    } else if (this.phase === 'COMBAT') {
      const oppId = this.getOpponentControllerId();
      // Find opponent hero card under opponent player ID to resolve the opponent hero name
      let opponentHero = 'Unknown Opponent';
      // 0. Try to use activeOpponentHeroId directly
      if (this.activeOpponentHeroId) {
        const entity = this.entities[this.activeOpponentHeroId];
        if (entity && entity.name) {
          opponentHero = entity.name;
        }
      }
      // 1. Try to find hero entity in PLAY
      if (opponentHero === 'Unknown Opponent') {
        for (const id in this.entities) {
          const entity = this.entities[id];
          if (entity.player === oppId && entity.zone === 'PLAY' && this.isRealHeroEntity(entity)) {
            if (entity.name) {
              opponentHero = entity.name;
              break;
            }
          }
        }
      }
      // 2. Try to find hero entity in ANY zone
      if (opponentHero === 'Unknown Opponent') {
        for (const id in this.entities) {
          const entity = this.entities[id];
          if (entity.player === oppId && this.isRealHeroEntity(entity)) {
            if (entity.name) {
              opponentHero = entity.name;
              break;
            }
          }
        }
      }
      // 3. Fallback to this.heroes
      if (opponentHero === 'Unknown Opponent' && oppId && this.heroes[oppId]) {
        opponentHero = this.heroes[oppId].heroName || 'Unknown Opponent';
      }
      this.currentTurnData.opponent = opponentHero;

      const oppStatsEnding = this.getOpponentHeroStats();
      this.currentTurnData.opponentHeroCardId = oppStatsEnding.heroCardId || '';
      this.currentTurnData.opponentHealth = oppStatsEnding.health !== undefined ? oppStatsEnding.health : 30;
      this.currentTurnData.opponentArmor = oppStatsEnding.armor !== undefined ? oppStatsEnding.armor : 0;
      this.currentTurnData.playerHeroEntityId = this.localPlayerHeroEntityId || 0;
      
      // Resolve opponentHeroEntityId robustly
      let oppHeroId = this.activeOpponentHeroId;
      if (!oppHeroId) {
        for (const id in this.entities) {
          const entity = this.entities[id];
          if (entity.player === oppId && entity.zone === 'PLAY' && this.isRealHeroEntity(entity)) {
            oppHeroId = entity.id;
            break;
          }
        }
      }
      this.currentTurnData.opponentHeroEntityId = oppHeroId || 0;

      // Copy the player's board state and hero stats from the preceding Recruit phase
      const prevTurn = this.history[this.history.length - 1];
      let playerStartingTotal = 0;
      if (prevTurn) {
        if (prevTurn.board) {
          this.currentTurnData.board = JSON.parse(JSON.stringify(prevTurn.board));
        }
        this.currentTurnData.heroName = prevTurn.heroName;
        this.currentTurnData.heroCardId = prevTurn.heroCardId;
        this.currentTurnData.health = prevTurn.health;
        this.currentTurnData.armor = prevTurn.armor;
        playerStartingTotal = (prevTurn.health || 30) + (prevTurn.armor || 0);
      } else {
        this.currentTurnData.board = this.getBoardState();
        const heroStats = this.getHeroStats();
        this.currentTurnData.heroName = heroStats.heroName;
        this.currentTurnData.heroCardId = heroStats.heroCardId;
        this.currentTurnData.health = heroStats.health;
        this.currentTurnData.armor = heroStats.armor;
        playerStartingTotal = heroStats.health + heroStats.armor;
      }

      // Calculate combat damage outcome using actual hero health/armor changes
      const heroStatsEnding = this.getHeroStats();
      const playerEndingTotal = heroStatsEnding.health + heroStatsEnding.armor;
      const playerDiff = playerEndingTotal - playerStartingTotal;
      
      const oppEndingStats = this.getOpponentHeroStats();
      const oppEndingTotal = oppEndingStats.health + oppEndingStats.armor;
      const oppDiff = oppEndingTotal - (this.opponentStartingTotal || oppEndingTotal);

       if (playerDiff < 0) {
        // Local player took damage (LOSE)
        this.currentTurnData.damageDealt = playerDiff; // e.g. -5
      } else if (oppDiff < 0) {
        // Opponent took damage (WIN)
        this.currentTurnData.damageDealt = -oppDiff; // e.g. +5
      } else {
        // Fallback: check attacks for ghost/reconnection fights where lobby health doesn't change
        let resolvedFromAttacks = false;
        if (this.currentTurnData.attacks && this.currentTurnData.attacks.length > 0) {
          const lastAtt = this.currentTurnData.attacks[this.currentTurnData.attacks.length - 1];
          const oppHeroId = this.currentTurnData.opponentHeroEntityId;
          const playerHeroId = this.currentTurnData.playerHeroEntityId;
          
          if (lastAtt.defender.id === oppHeroId) {
            this.currentTurnData.damageDealt = 1; // Default +1 for WIN
            resolvedFromAttacks = true;
            console.log(`[Parser] Resolved WIN (+1) against ghost/opponent via last combat attack lunge.`);
          } else if (lastAtt.defender.id === playerHeroId) {
            this.currentTurnData.damageDealt = -1; // Default -1 for LOSE
            resolvedFromAttacks = true;
            console.log(`[Parser] Resolved LOSE (-1) against ghost/opponent via last combat attack lunge.`);
          }
        }
        
        if (!resolvedFromAttacks) {
          this.currentTurnData.damageDealt = 0;
        }
      }

      console.log(`[Parser] Combat damage outcome resolved: playerDiff=${playerDiff}, oppDiff=${oppDiff} -> damageDealt=${this.currentTurnData.damageDealt}`);

      // Retroactively resolve card names for the starting opponent board
      const finalOpponentBoard = this.tempOpponentBoard.map(m => {
        const entity = this.entities[m.id];
        return {
          ...m,
          name: (entity && entity.name) ? entity.name : ''
        };
      });
      this.currentTurnData.opponentBoard = finalOpponentBoard;

      // Retroactively resolve card names for attacks
      if (this.currentTurnData.attacks) {
        this.currentTurnData.attacks = this.currentTurnData.attacks.map(att => {
          const attackerEnt = this.entities[att.attacker.id];
          const defenderEnt = this.entities[att.defender.id];
          return {
            attacker: {
              ...att.attacker,
              name: (attackerEnt && attackerEnt.name) ? attackerEnt.name : att.attacker.name
            },
            defender: {
              ...att.defender,
              name: (defenderEnt && defenderEnt.name) ? defenderEnt.name : att.defender.name
            }
          };
        });
      }
    }

    this.history.push(this.currentTurnData);
    this.currentTurnData = null;
  }

  // Retroactively recalculate previous combat outcome if hero health/armor updates arrive with delay
  recalculatePreviousCombatOutcome() {
    const prevTurn = this.history[this.history.length - 1];
    if (!prevTurn || prevTurn.phase !== 'COMBAT') return;

    const heroStatsEnding = this.getHeroStats();
    const playerEndingTotal = heroStatsEnding.health + heroStatsEnding.armor;
    
    const prevPrevTurn = this.history[this.history.length - 2];
    const playerStartingTotal = prevPrevTurn ? (prevPrevTurn.health + prevPrevTurn.armor) : 30;

    const playerDiff = playerEndingTotal - playerStartingTotal;

    const oppEndingStats = this.getOpponentHeroStats();
    const oppEndingTotal = oppEndingStats.health + oppEndingStats.armor;
    const oppDiff = oppEndingTotal - (this.opponentStartingTotal || oppEndingTotal);

    if (playerDiff < 0) {
      prevTurn.damageDealt = playerDiff;
    } else if (oppDiff < 0) {
      prevTurn.damageDealt = -oppDiff;
    } else {
      // Fallback: check attacks for ghost/reconnection fights where lobby health doesn't change
      let resolvedFromAttacks = false;
      if (prevTurn.attacks && prevTurn.attacks.length > 0) {
        const lastAtt = prevTurn.attacks[prevTurn.attacks.length - 1];
        const oppHeroId = prevTurn.opponentHeroEntityId;
        const playerHeroId = prevTurn.playerHeroEntityId;
        
        if (lastAtt.defender.id === oppHeroId) {
          prevTurn.damageDealt = 1; // Default +1 for WIN
          resolvedFromAttacks = true;
        } else if (lastAtt.defender.id === playerHeroId) {
          prevTurn.damageDealt = -1; // Default -1 for LOSE
          resolvedFromAttacks = true;
        }
      }
      
      if (!resolvedFromAttacks) {
        prevTurn.damageDealt = 0;
      }
    }
    
    console.log(`[Parser] Retroactively recalculated previous combat outcome: playerDiff=${playerDiff}, oppDiff=${oppDiff} -> damageDealt=${prevTurn.damageDealt}`);
  }

  // Main entry point to parse a log line
  parseLine(line) {
    // Extract static entity info (name, cardId, player, zone) from any bracketed entities in the line first (regardless of PowerTaskList)
    const entityMatches = line.match(/\[entityName=[^\]]*id=\d+[^\]]*\]/g);
    if (entityMatches) {
      for (const m of entityMatches) {
        const parsed = this.parseEntityString(m);
        if (parsed && parsed.id) {
          const entity = this.getEntity(parsed.id, parsed.name, parsed.cardId);
          if (parsed.player !== undefined && parsed.player !== null) {
            entity.player = parsed.player;
          }
          if (parsed.zone && (!entity.zone || entity.zone === 'UNKNOWN')) {
            entity.zone = parsed.zone;
          }
          if (parsed.zonePos !== undefined && !entity.zonePos) {
            entity.zonePos = parsed.zonePos;
          }
        }
      }
    }

    // Ignore client-side logs and PowerTaskList completely to avoid duplicate parsing and stale state bugs
    if (line.includes('PowerProcessor')) return;
    if (line.includes('PowerTaskList')) {
      const isHeroStatsTag = line.includes('tag=DAMAGE') || 
                            line.includes('tag=ARMOR') || 
                            line.includes('tag=HEALTH') || 
                            line.includes('tag=HERO_ENTITY') || 
                            line.includes('tag=PLAYSTATE') ||
                            line.includes('tag=PLAY_STATE');
      if (!isHeroStatsTag) return;
    }

    // Detect Game Block Start (CREATE_GAME) on GameState
    if (line.includes('CREATE_GAME')) {
      this.reset();
      this.activeGame = true;
      this.phase = 'UNKNOWN';
      console.log(`[Parser] Game block start (CREATE_GAME) detected.`);
      return;
    }

    // Validate Game Type (if it's not Battlegrounds, abort tracking)
    if (line.includes('GameType=')) {
      if (line.includes('GameType=GT_BATTLEGROUNDS')) {
        console.log(`[Parser] Game type validated: Battlegrounds.`);
        if (!this.activeGame) {
          this.reset();
          this.activeGame = true;
        }
        if (this.phase === 'UNKNOWN') {
          this.phase = 'HERO_SELECT';
        }
      } else {
        console.log(`[Parser] Non-Battlegrounds game type detected (${line.trim()}). Aborting game tracking.`);
        this.activeGame = false;
        this.reset();
      }
      return;
    }

    if (!this.activeGame) return;

    // Parse proposed attacker/defender in combat
    if (line.includes('tag=PROPOSED_ATTACKER')) {
      const match = line.match(/value=(\d+)/);
      if (match) {
        this.tempAttackerId = parseInt(match[1], 10);
        this.checkAndCommitAttack();
      }
    } else if (line.includes('tag=PROPOSED_DEFENDER')) {
      const match = line.match(/value=(\d+)/);
      if (match) {
        this.tempDefenderId = parseInt(match[1], 10);
        this.checkAndCommitAttack();
      }
    }

    // Capture board state at first BlockType=ATTACK in combat phase
    if (this.phase === 'COMBAT' && !this.combatOpponentBoardCaptured && line.includes('BLOCK_START') && line.includes('BlockType=ATTACK')) {
      this.tempOpponentBoard = this.getOpponentBoardState();
      this.combatOpponentBoardCaptured = true;
    }

    // 2. Detect Player ID Mapping
    // Format: GameState.DebugPrintGame() - PlayerID=2, PlayerName=shufunk#1645
    if (line.includes('PlayerID=') && line.includes('PlayerName=')) {
      const match = line.match(/PlayerID=(\d+),\s*PlayerName=(.+)/);
      if (match) {
        const pId = parseInt(match[1], 10);
        const pName = match[2].trim();
        this.players[pId] = pName;
        
        // Local player usually has a battletag (contains #)
        if (pName.includes('#')) {
          this.localPlayerId = pId;
          this.localPlayerName = pName;
          console.log(`[Parser] Detected local player: ${pName} (ID=${pId})`);
        }
      }
      return;
    }

    // 3. Detect Turn Changes
    // GameState.DebugPrintPower() -     TAG_CHANGE Entity=GameEntity tag=TURN value=1
    if (line.includes('Entity=GameEntity tag=TURN') || line.includes('Entity=1 tag=TURN')) {
      const match = line.match(/value=(\d+)/);
      if (match) {
        const turnNum = parseInt(match[1], 10);
        if (turnNum !== this.currentTurn) {
          // End previous turn phase
          this.endTurnPhase();

          this.currentTurn = turnNum;
          // Odd turns = recruit, Even turns = combat
          this.phase = turnNum % 2 === 1 ? 'RECRUIT' : 'COMBAT';
          
          let oppStartingHealth = 30;
          let oppStartingArmor = 0;

          if (this.phase === 'COMBAT') {
            this.combatOpponentBoardCaptured = false;
            this.tempOpponentBoard = [];
            this.activeOpponentId = null; // Clear cached opponent ID for the new combat round
            this.activeOpponentHeroId = null; // Clear cached opponent hero ID for the new combat round
            // Capture starting total of opponent hero at start of combat
            const oppStats = this.getOpponentHeroStats();
            this.opponentStartingTotal = oppStats.health + oppStats.armor;
            oppStartingHealth = oppStats.health !== undefined ? oppStats.health : 30;
            oppStartingArmor = oppStats.armor !== undefined ? oppStats.armor : 0;
          }
          
          this.currentTurnData = {
            turn: turnNum,
            phase: this.phase,
            timestamp: new Date().toISOString(),
            buys: [],
            sells: [],
            plays: [],
            board: [],
            opponentBoard: [],
            attacks: [],
            opponent: 'Unknown',
            opponentId: null,
            damageDealt: 0,
            health: 30,
            armor: 0,
            opponentStartingHealth: oppStartingHealth,
            opponentStartingArmor: oppStartingArmor
          };

          console.log(`[Parser] --- Turn ${turnNum} (${this.phase}) ---`);
        }
      }
      return;
    }

    // 4. Trace Next Opponent ID
    // TAG_CHANGE Entity=shufunk#1645 tag=NEXT_OPPONENT_PLAYER_ID value=6
    if (line.includes('tag=NEXT_OPPONENT_PLAYER_ID')) {
      const match = line.match(/Entity=(.*?)\s+tag=NEXT_OPPONENT_PLAYER_ID\s+value=(\d+)/);
      if (match) {
        const value = parseInt(match[2], 10);
        this.opponentLobbyId = value;
        
        // Try to resolve to controller ID
        const controllerId = this.getControllerIdFromLobbyPlayerId(value);
        if (controllerId) {
          this.opponentId = controllerId;
        } else {
          this.opponentId = value; // Fallback
        }
        
        if (this.currentTurnData) {
          this.currentTurnData.opponentId = this.opponentId;
          // Map opponent player ID to hero name if possible
          const lookupId = controllerId || value;
          if (this.heroes[lookupId]) {
            this.currentTurnData.opponent = this.heroes[lookupId].heroName;
          }
        }
      }
      return;
    }

    // 5. Trace Damage Dealt to Hero Last Turn (to find combat outcomes)
    // tag=DAMAGE_DEALT_TO_HERO_LAST_TURN value=2
    if (line.includes('tag=DAMAGE_DEALT_TO_HERO_LAST_TURN') && this.localPlayerName) {
      if (line.includes(this.localPlayerName)) {
        const match = line.match(/value=(\d+)/);
        if (match && this.currentTurnData) {
          const dmg = parseInt(match[1], 10);
          this.currentTurnData.damageDealt = dmg;
          console.log(`[Parser] Local player dealt ${dmg} damage last combat.`);
        }
      }
      return;
    }

    // 6. Track Entity Creations & Updates
    // FULL_ENTITY - Creating ID=X CardID=card_id
    if (line.includes('FULL_ENTITY - Creating ID=')) {
      const match = line.match(/FULL_ENTITY - Creating ID=(\d+)\s+CardID=(\w*)/);
      if (match) {
        const id = parseInt(match[1], 10);
        const cardId = match[2];
        this.getEntity(id, '', cardId);
        this.lastEntityId = id;
      }
      return;
    }

    // SHOW_ENTITY / FULL_ENTITY - Updating Entity=[...] CardID=card_id
    if (line.includes('Updating Entity=') || line.includes('FULL_ENTITY - Updating')) {
      const match = line.match(/(?:SHOW_ENTITY - Updating Entity=|FULL_ENTITY - Updating\s+)(\[.*?\])\s+CardID=(\w*)/);
      if (match) {
        const entityStr = match[1];
        const cardId = match[2];
        const parsed = this.parseEntityString(entityStr);
        if (parsed) {
          const entity = this.getEntity(parsed.id, parsed.name, cardId || parsed.cardId);
          if (parsed.zone) entity.zone = parsed.zone;
          if (parsed.player) entity.player = parsed.player;
          this.lastEntityId = parsed.id;
        }
      }
      return;
    }

    // 6b. Parse Indented tag=KEY value=VALUE declarations (under FULL_ENTITY / SHOW_ENTITY / CREATE_GAME)
    if (line.includes('tag=') && line.includes('value=') && !line.includes('TAG_CHANGE') && !line.includes('BLOCK_START') && !line.includes('BLOCK_END')) {
      const match = line.match(/tag=(\w+)\s+value=(.*)/);
      if (match && this.lastEntityId) {
        const tag = match[1].trim();
        const value = match[2].trim();
        
        const entity = this.getEntity(this.lastEntityId);
        let parsedValue = value;
        if (/^-?\d+$/.test(value)) {
          parsedValue = parseInt(value, 10);
        }
        entity.tags[tag] = parsedValue;
        
        // Propagate key tags directly to entity properties
        if (tag === 'ZONE') {
          entity.zone = value;
        } else if (tag === 'ZONE_POSITION') {
          entity.zonePos = parsedValue;
        } else if (tag === 'CONTROLLER') {
          entity.player = parsedValue;
        }
      }
      return;
    }

    // 7. Track Tag Changes
    // TAG_CHANGE Entity=X tag=Y value=Z
    if (line.includes('TAG_CHANGE')) {
      const match = line.match(/TAG_CHANGE Entity=(.*?)\s+tag=(.*?)\s+value=(.*)/);
      if (match) {
        const entityStr = match[1].trim();
        const tag = match[2].trim();
        const value = match[3].trim();

        // Handle game terminal states immediately (supports player names and GameEntity directly since they do not resolve to simple entityIds)
        if (tag === 'PLAYSTATE' || tag === 'PLAY_STATE') {
          if (value === 'LOST' || value === 'WON' || value === 'TIED' || value === 'CONCEDED') {
            if (this.activeGame && (entityStr === 'GameEntity' || entityStr === '1' || entityStr === this.localPlayerName)) {
              console.log(`[Parser] Game terminal play state detected: ${entityStr} has ${value}. Finalizing game.`);
              this.finalizeGame();
              this.activeGame = false;
            }
          }
        }

        // Track active opponent hero ID via HERO_ENTITY tag changes on opponent player entities
        if (tag === 'HERO_ENTITY') {
          const val = parseInt(value, 10);
          if (entityStr !== this.localPlayerName && entityStr !== 'GameEntity' && entityStr !== '1') {
            if (val > 100) {
              this.activeOpponentHeroId = val;
              console.log(`[Parser] Detected active opponent hero entity ID: ${val}`);
              
              const oppStats = this.buildHeroStatsObject(this.getEntity(val));
              this.opponentStartingTotal = oppStats.health + oppStats.armor;
              if (this.currentTurnData) {
                this.currentTurnData.opponentStartingHealth = oppStats.health;
                this.currentTurnData.opponentStartingArmor = oppStats.armor;
              }
              console.log(`[Parser] Updated starting stats for actual opponent hero ${oppStats.heroName} (ID=${val}): HP=${oppStats.health} Armor=${oppStats.armor}`);
            }
          }
        }

        let entityId = null;
        let entityName = '';
        let cardId = '';
        let player = null;

        // Try parsing bracketed entity
        if (entityStr.startsWith('[')) {
          const parsed = this.parseEntityString(entityStr);
          if (parsed) {
            entityId = parsed.id;
            entityName = parsed.name;
            cardId = parsed.cardId;
            player = parsed.player;
          }
        } else if (/^\d+$/.test(entityStr)) {
          entityId = parseInt(entityStr, 10);
        }

        if (entityId) {
          const entity = this.getEntity(entityId, entityName, cardId);
          if (player !== null) entity.player = player;

          // Convert tag value to int if it's numeric
          let parsedValue = value;
          if (/^-?\d+$/.test(value)) {
            parsedValue = parseInt(value, 10);
          }

          const isHero = this.isRealHeroEntity(entity);
          const isStatsTag = tag === 'DAMAGE' || tag === 'ARMOR' || tag === 'HEALTH';

          if (isHero && isStatsTag && entity.zone === 'REMOVEDFROMGAME') {
            // Ignore stats tag changes on removed hero entities to prevent end-of-combat cleanup resets
          } else {
            // Update tags map
            entity.tags[tag] = parsedValue;

            // Retroactively recalculate previous combat outcome on hero damage/armor changes
            if (isStatsTag && isHero && this.phase === 'RECRUIT') {
              this.recalculatePreviousCombatOutcome();
            }
          }

          // Handle special tags
          if (tag === 'ZONE') {
            const oldZone = entity.zone;
            entity.zone = value;

            // Track PLAY transition (Hand -> Play)
            if (oldZone === 'HAND' && value === 'PLAY' && entity.player === this.localPlayerId) {
              if (entity.cardId && !entity.name.includes('Hero')) {
                if (this.currentTurnData) {
                  this.currentTurnData.plays.push({
                    name: entity.name,
                    cardId: entity.cardId,
                    id: entity.id
                  });
                  console.log(`[Parser] Played entity: ${entity.name}`);
                }
              }
            }
          } else if (tag === 'ZONE_POSITION') {
            entity.zonePos = parsedValue;
          } else if (tag === 'CONTROLLER') {
            entity.player = parsedValue;
          }

          // Track Heroes metadata (especially if they are a Hero card in PLAY)
          if (entity.player && this.isRealHeroEntity(entity)) {
            const isPlayZone = entity.zone === 'PLAY';
            if (!this.heroes[entity.player] || isPlayZone) {
              this.heroes[entity.player] = { heroName: entity.name || '', cardId: entity.cardId };
            } else if (entity.name && !this.heroes[entity.player].heroName) {
              this.heroes[entity.player].heroName = entity.name;
            }
            // Update opponent name mappings dynamically
            if (this.currentTurnData && this.currentTurnData.opponentId === entity.player && entity.name) {
              this.currentTurnData.opponent = entity.name;
            }
          }
        }
      }
      return;
    }

    // 8. Track Buy & Sell Actions via PLAY blocks
    // Format: BLOCK_START BlockType=PLAY Entity=[entityName=Drag To Buy ... cardId=TB_BaconShop_DragBuy] Target=[entityName=Dune Dweller id=407 ...]
    if (line.includes('BLOCK_START BlockType=PLAY')) {
      const match = line.match(/BLOCK_START BlockType=PLAY Entity=(\[.*?\]).*?Target=(\[.*?\])/);
      if (match) {
        const entityStr = match[1];
        const targetStr = match[2];

        const entityParsed = this.parseEntityString(entityStr);
        const targetParsed = this.parseEntityString(targetStr);

        if (entityParsed && targetParsed) {
          // BUY: entity cardId starts with TB_BaconShop_DragBuy
          if (entityParsed.cardId && entityParsed.cardId.startsWith('TB_BaconShop_DragBuy')) {
            if (this.currentTurnData) {
              this.currentTurnData.buys.push({
                name: targetParsed.name,
                cardId: targetParsed.cardId,
                id: targetParsed.id
              });
              console.log(`[Parser] Bought entity: ${targetParsed.name} (id=${targetParsed.id})`);
            }
          }
          // SELL: entity cardId starts with TB_BaconShop_DragSell
          else if (entityParsed.cardId && entityParsed.cardId.startsWith('TB_BaconShop_DragSell')) {
            if (this.currentTurnData) {
              this.currentTurnData.sells.push({
                name: targetParsed.name,
                cardId: targetParsed.cardId,
                id: targetParsed.id
              });
              console.log(`[Parser] Sold entity: ${targetParsed.name} (id=${targetParsed.id})`);
            }
          }
        }
      }
      return;
    }
  }

  checkAndCommitAttack() {
    // If either proposed ID is 0, it means the tag has been cleared/reset by the game.
    // Clean up both temporary states immediately to prevent stale states from blocking subsequent attacks.
    if (this.tempAttackerId === 0 || this.tempDefenderId === 0) {
      this.tempAttackerId = null;
      this.tempDefenderId = null;
      return;
    }

    if (this.tempAttackerId !== null && this.tempDefenderId !== null) {
      const attacker = this.getEntity(this.tempAttackerId);
      const defender = this.getEntity(this.tempDefenderId);
      
      if (this.currentTurnData && this.currentTurnData.phase === 'COMBAT') {
        if (!this.currentTurnData.attacks) {
          this.currentTurnData.attacks = [];
        }
        
        const getHealth = (ent) => {
          const dmg = ent.tags.DAMAGE !== undefined ? ent.tags.DAMAGE : (ent.tags[3] !== undefined ? ent.tags[3] : 0);
          if (ent.tags.HEALTH !== undefined) {
            return ent.tags.HEALTH - dmg;
          }
          const startingHealth = ent.tags[3025] !== undefined ? ent.tags[3025] : 0;
          if (startingHealth > 0) {
            return startingHealth - dmg;
          }
          return 0;
        };

        this.currentTurnData.attacks.push({
          attacker: { 
            id: attacker.id, 
            name: attacker.name || 'Unknown', 
            cardId: attacker.cardId,
            atk: attacker.tags.ATK !== undefined ? attacker.tags.ATK : 0,
            health: getHealth(attacker)
          },
          defender: { 
            id: defender.id, 
            name: defender.name || 'Unknown', 
            cardId: defender.cardId,
            atk: defender.tags.ATK !== undefined ? defender.tags.ATK : 0,
            health: getHealth(defender)
          }
        });
        console.log(`[Parser] Combat Attack: ${attacker.name} -> ${defender.name}`);
      }
      this.tempAttackerId = null;
      this.tempDefenderId = null;
    }
  }

  // Close out the final turn of the game
  finalizeGame() {
    this.endTurnPhase();
    console.log(`[Parser] Game finalized. Total turns recorded: ${this.history.length}`);
  }
}

module.exports = BGEventParser;
