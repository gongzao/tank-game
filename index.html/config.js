/* =========================================================
 * config.js — 坦克大战全局配置与地图生成
 * 后续 Trae 可在此调整数值、替换地图底图、修改 GZH 布局与关卡
 * ========================================================= */

const CONFIG = {
  TILE: 40,            // 单格像素
  COLS: 27,            // 地图更宽，解决“地图太小”
  ROWS: 19,

  PLAYER_SPEED: 2.4,
  ENEMY_FAST_MULT: 1.55,   // 快速敌方坦克 = 本关敌速 * 该系数
  BULLET_SPEED: 5.5,

  PLAYER_FIRE_CD: 320,
  PLAYER_FIRE_CD_RAPID: 140,  // 吃到“极速”道具后的开火间隔
  ENEMY_FIRE_CD: 950,         // 敌人开火间隔（缩短，火力更密）
  ENEMY_FIRE_CD_VAR: 450,
  PLAYER_ACCEL: 0.25,         // 玩家移动加速度(越小越“丝滑”)
  ENEMY_ACCEL: 0.5,

  PLAYER_LIVES: 3,

  // 道具系统(增加趣味性)
  POWERUP_LIFE: 12000,      // 道具在场存活时间
  POWERUP_MAX: 3,           // 同时最多在场道具数
  POWERUP_DURATION: 6000,   // 护盾/极速持续时间
  FREEZE_DURATION: 4000,    // 冰冻(冻结敌人)持续时间
  SPREAD_DURATION: 6000,    // 散射(三向齐射)持续时间

  // 主动技能(追踪导弹)：充能满后触发，连发数枚自动追踪敌人的导弹
  SKILL: {
    energyMax: 100,
    perKill: 26,        // 每击杀一个敌人充能
    perSecond: 8.0,     // 每秒自然充能（加快，技能更常用）
    perHit: 3,          // 命中敌人(未击杀)充能
    perBrick: 1.5,      // 打碎砖块充能
    missileCount: 5,    // 每次释放连发数量
    missileDelay: 110,  // 连发间隔(ms)
    missileSpeed: 5.4,  // 导弹飞行速度
    missileTurn: 0.16,  // 转向强度(每帧弧度，越大拐弯越猛)
    missileDamage: 2,   // 伤害(一发炸毁装甲坦克)
    missileLife: 3800,  // 导弹寿命(ms)，超时自爆
  },

  // 装甲敌方坦克(需两发击毁，更慢)
  ENEMY_ARMOR_HP: 2,
  ENEMY_ARMOR_SPEED_MULT: 0.82,

  // 关卡配置：逐关变难（前两关偏简单练手，后两关火力全开）
  // fireMult = 本关敌人开火间隔倍率（越大越慢 = 越简单）
  LEVELS: [
    { name: '第一关', enemies: 5,  maxActive: 2, fastChance: 0.10, armorChance: 0.00, enemySpeed: 1.5, spawnInterval: 2200, powerupInterval: 9000, fireMult: 1.35 },
    { name: '第二关', enemies: 7,  maxActive: 3, fastChance: 0.22, armorChance: 0.10, enemySpeed: 1.7, spawnInterval: 1800, powerupInterval: 8000, fireMult: 1.15 },
    { name: '第三关', enemies: 10, maxActive: 4, fastChance: 0.45, armorChance: 0.30, enemySpeed: 2.0, spawnInterval: 1450, powerupInterval: 7000, fireMult: 0.95 },
    { name: '第四关', enemies: 12, maxActive: 6, fastChance: 0.62, armorChance: 0.50, enemySpeed: 2.35, spawnInterval: 1150, powerupInterval: 6000, fireMult: 0.80 },
    // 第五关：BOSS 战(钢铁巨兽)。不再刷常规敌人，击败 BOSS 即通关
    { name: 'BOSS 战', enemies: 0, maxActive: 0, fastChance: 0.30, armorChance: 0.25, enemySpeed: 1.9, spawnInterval: 9999, powerupInterval: 6500, fireMult: 1.0,
      boss: { hp: 28, playerLives: 8, advancedHp: 45 } },  // 普通 8 命；进阶 BOSS 45 血 + 玩家 3 命
  ],

  // 地图底图：把你的原创图片放到 assets/map-bg.png 即可自动启用
  BACKGROUND_IMAGE: 'assets/map-bg.png',
  BG_OPACITY: 0.42,         // 调低背景透明度，让 GZH 更突出

  COLORS: {
    grass:    '#dcefdc',
    grid:     'rgba(120,150,120,0.10)',
    brickA:   '#d98a5b',
    brickB:   '#c2723f',
    brickLine:'#9c5630',
    // GZH 专属金棕色，与普通砖块区分，保证“明显”
    logoA:    '#ffd24a',
    logoB:    '#f0a500',
    logoLine: '#b9790a',
    logoGlow: 'rgba(255,200,60,0.55)',
    steelA:   '#b8c2cc',
    steelB:   '#94a3b0',
    steelLine:'#6b7785',
    player:   '#2e9e5b',
    playerDark:'#1f7a43',
    enemy:    '#e0573e',
    enemyDark:'#b23a26',
    enemyFast:   '#9b59b6',
    enemyFastDark:'#713688',
    enemyArmor:  '#6b7785',
    enemyArmorDark:'#49545f',
    boss:      '#8a2b2b',   // BOSS 钢铁巨兽(深红)
    bossDark:  '#431414',
    bullet:   '#ffd54a',
    bulletCore:'#fff3c4',
    text:     '#234',
    powerShield:'#3aa0ff',
    powerRapid: '#ffb300',
    powerLife:  '#ff5a7a',
    powerBomb:  '#ff7043',
    powerStar:  '#ffd24a',
    powerFreeze:'#5ad1ff',
    powerSpread:'#b06bff',
  }
};

/* 道具元数据：图标 / 名称 / 效果 / 配色(指向 COLORS 键) */
const POWERUPS = {
  shield: { icon: '🛡', name: '护盾', effect: '短暂无敌',     color: 'powerShield' },
  rapid:  { icon: '⚡', name: '极速', effect: '射速翻倍',     color: 'powerRapid'  },
  life:   { icon: '❤', name: '加命', effect: '生命 +1',      color: 'powerLife'   },
  bomb:   { icon: '💣', name: '清场', effect: '炸毁全部敌人', color: 'powerBomb'   },
  star:   { icon: '★', name: '得分', effect: '+200 分',       color: 'powerStar'   },
  freeze: { icon: '❄', name: '冰冻', effect: '冻结敌人 4 秒', color: 'powerFreeze' },
  spread: { icon: '⋔', name: '散射', effect: '三向齐射 6 秒', color: 'powerSpread' },
};

/* 每关开场提示文案 */
const LEVEL_TIPS = [
  '用 方向键 / WASD 移动，空格 / J 开火，先打碎前方的 GZH 砖墙练练手！底部是你要守护的基地。',
  '敌人变多了，而且会瞄准你直射！部分敌人还会直扑基地，善用掩体与道具，护盾和冰冻能救你一命。',
  '出现更快的紫色坦克，优先集火解决它们；别让敌人突破到基地。',
  '最终决战：全力作战，守住底部基地（鹰旗），别让它被摧毁！',
  '👑 钢铁巨兽登场！它会瞄准射击、召唤援军，残血时进入狂暴弹幕。集火输出，善用追踪导弹与掩体！',
];

/* 字母点阵 (7x9，加粗更清晰)，'1' 表示 GZH 专属砖(可破坏、金色) */
const LETTERS = {
  G: [
    '0111110',
    '1000001',
    '1000000',
    '1000000',
    '1001110',
    '1001001',
    '1000001',
    '1000001',
    '0111110',
  ],
  Z: [
    '1111111',
    '0000010',
    '0000100',
    '0001000',
    '0010000',
    '0100000',
    '1000000',
    '1000000',
    '1111111',
  ],
  H: [
    '1000001',
    '1000001',
    '1000001',
    '1000001',
    '1111111',
    '1000001',
    '1000001',
    '1000001',
    '1000001',
  ],
};

/* 瓦片类型: 0=空 1=普通砖 2=钢 3=GZH金砖 */
function buildMap(level = 0) {
  const { COLS, ROWS } = CONFIG;
  const m = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const border = (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1);
      row.push(border ? 2 : 0);
    }
    m.push(row);
  }
  stampLetters(m);
  addScatter(m, level);
  // BOSS 关：顶部三行完全清空，给钢铁巨兽(2x2)留出巡航带
  if (CONFIG.LEVELS[level] && CONFIG.LEVELS[level].boss) {
    for (let r = 1; r <= 3; r++)
      for (let c = 1; c < CONFIG.COLS - 1; c++) m[r][c] = 0;
  }
  clearSpawns(m);
  addBase(m);            // 底部中央加入可被破坏的基地(鹰旗) + 砖墙堡垒
  return m;
}

/* 在底部中央放置基地(鹰旗, 瓦片 4)与一圈砖墙堡垒；玩家出生在其左侧 */
function addBase(map) {
  const c = 13, r = CONFIG.ROWS - 2;
  map[r][c] = 4;
  const ring = [[c - 1, r], [c + 1, r], [c - 1, r - 1], [c, r - 1], [c + 1, r - 1]];
  for (const [cc, rr] of ring) if (map[rr] && map[rr][cc] === 0) map[rr][cc] = 1;
}

/* 在地图中央铺出 GZH 金砖造型(更粗大、金棕色，明显易读) */
function stampLetters(map) {
  const order = ['G', 'Z', 'H'];
  const letterW = 7, gap = 2, startRow = 5, startCol = 1;
  let col = startCol;
  for (const L of order) {
    const pat = LETTERS[L];
    for (let r = 0; r < pat.length; r++) {
      for (let c = 0; c < pat[r].length; c++) {
        if (pat[r][c] === '1') map[startRow + r][col + c] = 3; // 3=GZH金砖
      }
    }
    col += letterW + gap;
  }
}

/* 在上下两条“安全带”铺设砖块群与钢柱，并随关卡在右侧增加掩体 */
function addScatter(map, level) {
  const bricks = [[3, 2], [12, 2], [23, 2], [3, 15], [12, 15], [23, 15]];
  for (const [c, r] of bricks) {
    for (let dr = 0; dr < 2; dr++)
      for (let dc = 0; dc < 2; dc++)
        if (map[r + dr] && map[r + dr][c + dc] === 0) map[r + dr][c + dc] = 1;
  }
  const steel = [[9, 2], [17, 2], [9, 16], [17, 16]];
  for (const [c, r] of steel) if (map[r][c] === 0) map[r][c] = 2;

  // GZH 占据 cols 1-23，右侧 col24-25 为安全空白带，随关卡增加掩体
  if (level >= 1) {
    if (map[7][25] === 0) map[7][25] = 2;
    if (map[11][25] === 0) map[11][25] = 2;
    if (map[9][24] === 0) map[9][24] = 1;
  }
  if (level >= 2) {
    if (map[4][24] === 0) map[4][24] = 1;
    if (map[14][24] === 0) map[14][24] = 1;
    if (map[9][24] === 0) map[9][24] = 2; // 升级为钢柱
  }
  if (level >= 3) {
    for (const c of [5, 6, 7, 19, 20, 21]) if (map[14][c] === 0) map[14][c] = 1; // GZH 下方砖墙段
    if (map[3][13] === 0) map[3][13] = 2; // 顶部中央钢
  }
}

/* 清空出生点周边，避免坦克被卡在墙里 */
function clearSpawns(map) {
  const clear = (c, r) => {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr > 0 && cc > 0 && rr < CONFIG.ROWS - 1 && cc < CONFIG.COLS - 1) map[rr][cc] = 0;
      }
  };
  clear(10, CONFIG.ROWS - 2); // 玩家出生在基地左侧(避开堡垒砖)
  clear(1, 1); clear(13, 1); clear(25, 1); // 敌方(顶部三处)
}
