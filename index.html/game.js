/* =========================================================
 * game.js — 音效模块 + 核心引擎(Game)
 * ========================================================= */

/* 轻量 WebAudio 音效(无需外部素材) —— 柔和合成音 + 低通噪声，避免刺耳 */
const Sound = {
  ctx: null, master: null, enabled: true,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;           // 主音量，整体放轻
      this.master.connect(this.ctx.destination);
    } catch (e) { this.enabled = false; }
  },
  _env(type, freq, dur, vol, slideTo) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  },
  _noise(dur, vol, cutoff) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff || 1100;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(this.master); src.start(t);
  },
  fire()   { this._env('triangle', 440, 0.09, 0.10, 190); },
  hit()    { this._env('sine', 260, 0.06, 0.09, 130); },
  steel()  { this._env('square', 900, 0.05, 0.04); this._env('square', 1350, 0.05, 0.03); },
  boom()   { this._noise(0.34, 0.32, 900); this._env('sine', 130, 0.3, 0.16, 55); },
  pickup() { this._env('sine', 680, 0.1, 0.10); setTimeout(() => this._env('sine', 1020, 0.13, 0.10), 90); },
  freeze() { this._env('sine', 720, 0.14, 0.09, 320); },
  missile(){ this._noise(0.30, 0.32, 900); this._env('square', 190, 0.16, 0.10, 500); },
  win()    { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._env('triangle', f, 0.18, 0.12), i * 120)); },
  lose()   { [392, 330, 262].forEach((f, i) => setTimeout(() => this._env('sine', f, 0.26, 0.13), i * 150)); },
  toggleMute() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.value = this.enabled ? 0.5 : 0;
    return this.enabled;
  },
};

/* 将方向向量旋转 deg 度(用于散射) */
function rotateDir(d, deg) {
  const a = Math.atan2(d.y, d.x) + deg * Math.PI / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
}

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = CONFIG.COLS * CONFIG.TILE;
    this.H = CONFIG.ROWS * CONFIG.TILE;
    this.state = 'start';   // start | levelintro | playing | paused | levelclear | win | lose
    this.score = 0;
    this.lives = CONFIG.PLAYER_LIVES;
    this.level = 0;
    this.levelCfg = CONFIG.LEVELS[0];
    this.bgImage = null; this.bgLoaded = false;
    this.hintTimer = 0;
    this.freezeTimer = 0;
    this.floaters = [];
    this.flashes = [];
    this.rings = [];          // 爆炸冲击波环
    this.killFlash = 0;       // 击杀时的全屏白闪(增强打击感)
    this.hitStop = 0;         // 卡帧(命中瞬间的短暂定格)
    this.shake = 0;
    this.skillEnergy = 0;
    this.missiles = [];       // 在飞的追踪导弹
    this._msQueue = 0;        // 待发射导弹数(连发)
    this._msTimer = 0;        // 连发间隔计时
    this.combo = 0;           // 连击数
    this.comboTimer = 0;      // 连击窗口计时
    this._skillHint = 0;      // 技能未就绪提示节流
    this._tileCanvas = document.createElement('canvas'); // 静态地形离屏缓存
    this._mapVersion = -1;    // 已缓存的地图版本(MAP_VERSION 变化才重绘)
    this._vignette = null;    // 暗角渐变(只创建一次)
    this.baseAlive = true;
    this.basePos = { x: 13 * CONFIG.TILE + CONFIG.TILE / 2, y: (CONFIG.ROWS - 2) * CONFIG.TILE + CONFIG.TILE / 2 };
    this.boss = null;          // BOSS 关的钢铁巨兽
    this._bossDying = 0;       // BOSS 死亡演出计时(连环爆炸→胜利)
    this._bossBoomT = 0;       // 死亡演出爆炸节流
    this._helpReturn = 'start';
    // BOSS 进阶模式解锁状态(持久化；安全读取，防止隐私模式抛异常)
    try {
      this.bossClearedOnce = localStorage.getItem('tankBossCleared') === '1';
      this.bossAdvanced = localStorage.getItem('tankBossAdvanced') === '1';
    } catch (e) {
      this.bossClearedOnce = false;
      this.bossAdvanced = false;
    }
    this._loadBg();
    this.reset();
  }

  _loadBg() {
    const img = new Image();
    img.onload = () => { this.bgImage = img; this.bgLoaded = true; };
    img.onerror = () => { this.bgLoaded = false; };
    img.src = CONFIG.BACKGROUND_IMAGE;
  }

  reset() {
    this.map = buildMap(0);
    this._mapVersion = -1; // 强制重建地形缓存(换图)
    this.player = new Tank(10, CONFIG.ROWS - 2, 'player');
    this.enemies = [];
    this.bullets = [];
    this.particles = [];
    this.powerups = [];
    this.floaters = [];
    this.flashes = [];
    this.rings = [];
    this.killFlash = 0;
    this.hitStop = 0;
    this.defeated = 0;
    this.spawnTimer = 600;
    this.powerupTimer = this.levelCfg.powerupInterval;
    this.freezeTimer = 0;
    this.shake = 0;
    this.skillEnergy = 0;
    this.missiles = [];
    this._msQueue = 0; this._msTimer = 0;
    this.combo = 0; this.comboTimer = 0;
    this.baseAlive = true;
    this.basePos = { x: 13 * CONFIG.TILE + CONFIG.TILE / 2, y: (CONFIG.ROWS - 2) * CONFIG.TILE + CONFIG.TILE / 2 };
  }

  /* 从开始/失败重新开局：回到第 1 关 */
  start() {
    this.score = 0;
    this.lives = CONFIG.PLAYER_LIVES;
    this.beginLevel(0);
  }

  /* 开始界面选关：得分清零，直接从指定关出发 */
  startAtLevel(level) {
    this.score = 0;
    this.lives = CONFIG.PLAYER_LIVES;
    this.beginLevel(Math.max(0, Math.min(CONFIG.LEVELS.length - 1, level)));
  }

  /* 暂停/开始界面选关跳转：保留当前得分，切换关卡 */
  jumpToLevel(level) {
    level = Math.max(0, Math.min(CONFIG.LEVELS.length - 1, level));
    this.beginLevel(level);
    this.beginPlay();
  }

  /* 设置 BOSS 进阶模式开关（持久化） */
  setBossAdvanced(on) {
    this.bossAdvanced = !!on;
    if (on) localStorage.setItem('tankBossAdvanced', '1');
    else localStorage.removeItem('tankBossAdvanced');
  }

  /* 失败后重试本关：补满生命，直接从本关重新出发（不再从头玩） */
  retryLevel() {
    this.lives = CONFIG.PLAYER_LIVES;
    this.beginLevel(this.level);
    this.beginPlay();
  }

  /* 进入指定关卡：重建地图与敌人，展示关卡过场 */
  beginLevel(level) {
    this.level = level;
    this.levelCfg = CONFIG.LEVELS[level];
    this.map = buildMap(level);
    this._mapVersion = -1; // 强制重建地形缓存(换图)
    this.player = new Tank(10, CONFIG.ROWS - 2, 'player');
    this.enemies = [];
    this.bullets = [];
    this.particles = [];
    this.powerups = [];
    this.floaters = [];
    this.flashes = [];
    this.rings = [];
    this.killFlash = 0;
    this.hitStop = 0;
    this.defeated = 0;
    this.spawnTimer = 600;
    this.powerupTimer = this.levelCfg.powerupInterval;
    this.freezeTimer = 0;
    this.shake = 0;
    this.skillEnergy = 0;
    this.missiles = [];
    this._msQueue = 0; this._msTimer = 0;
    this.combo = 0; this.comboTimer = 0;
    this.baseAlive = true;
    this.basePos = { x: 13 * CONFIG.TILE + CONFIG.TILE / 2, y: (CONFIG.ROWS - 2) * CONFIG.TILE + CONFIG.TILE / 2 };
    this.boss = null; this._bossDying = 0; this._bossBoomT = 0;
    if (this.levelCfg.boss) {
      // BOSS 战：普通模式补到 8 命；进阶模式强制 3 命，BOSS 血量更高
      const isAdv = this.bossAdvanced;
      const bossLives = isAdv ? CONFIG.PLAYER_LIVES : (this.levelCfg.boss.playerLives || (CONFIG.PLAYER_LIVES + 3));
      this.lives = Math.max(this.lives, bossLives);
      this._maxLives = bossLives;
      this._spawnBoss();
    } else {
      this._maxLives = Math.max(this.lives, CONFIG.PLAYER_LIVES);
    }
    this.state = 'levelintro';
    showLevelIntro(level);
    this._syncHud();
  }

  /* 关卡过场中点击“出发” */
  beginPlay() {
    Sound.init();
    this.state = 'playing';
    this.hintTimer = this.level === 0 ? 5200 : 3200;
    hideOverlay();
    this._syncHud();
  }

  nextLevel() {
    if (this.level < CONFIG.LEVELS.length - 1) this.beginLevel(this.level + 1);
    else this._win();
  }

  togglePause() {
    if (this.state === 'playing') { this.state = 'paused'; showOverlay('pause'); }
    else if (this.state === 'paused') { this.state = 'playing'; hideOverlay(); }
  }

  openHelp() {
    this._helpReturn = this.state;
    if (this.state === 'playing') this.state = 'paused';
    showHelp();
  }
  closeHelp() {
    const s = this._helpReturn;
    if (s === 'playing') { this.state = 'playing'; hideOverlay(); }
    else if (s === 'paused') showOverlay('pause');
    else if (s === 'levelintro') showLevelIntro(this.level);
    else if (s === 'levelclear') showOverlay('levelclear');
    else showStart();
  }

  spawnEnemy() {
    const spots = [[1, 1], [13, 1], [25, 1]];
    const free = spots.filter(([c, r]) => {
      const x = c * CONFIG.TILE, y = r * CONFIG.TILE;
      return !this.enemies.some(e => aabb(e.x, e.y, e.size, e.size, x, y, CONFIG.TILE, CONFIG.TILE));
    });
    const pool = free.length ? free : spots;
    const spot = pool[Math.floor(Math.random() * pool.length)];
    this.enemies.push(this._makeEnemy(spot[0], spot[1]));
  }

  /* 按本关配置生成一辆敌方坦克(含快速/装甲变体) */
  _makeEnemy(col, row) {
    const cfg = this.levelCfg;
    const e = new Tank(col, row, 'enemy');
    e.aiTimer = 300 + Math.random() * 600;
    if (Math.random() < cfg.fastChance) { // 快速敌方坦克(紫色)
      e.variant = 'fast';
      e.speed = cfg.enemySpeed * CONFIG.ENEMY_FAST_MULT;
    } else if (Math.random() < cfg.armorChance) { // 装甲敌方坦克(灰色, 两发击毁)
      e.variant = 'armor';
      e.maxHp = CONFIG.ENEMY_ARMOR_HP; e.hp = e.maxHp;
      e.speed = cfg.enemySpeed * CONFIG.ENEMY_ARMOR_SPEED_MULT;
    } else {
      e.speed = cfg.enemySpeed;
    }
    e.wantsBase = Math.random() < 0.35; // 约 1/3 敌人直扑你的基地
    return e;
  }

  /* 出生 BOSS：钢铁巨兽(2x2 巨型坦克，三阶段战斗) */
  _spawnBoss() {
    const b = new Tank(12, 1, 'enemy');
    const bcfg = this.levelCfg.boss;
    const isAdv = this.bossAdvanced;
    b.isBoss = true;
    b.variant = 'boss';
    b.size = CONFIG.TILE * 2 - 8;                 // 占两格宽
    b.x = 12 * CONFIG.TILE + (CONFIG.TILE * 2 - b.size) / 2;
    b.y = CONFIG.TILE + 4;
    b.maxHp = isAdv ? (bcfg.advancedHp || bcfg.hp + 15) : bcfg.hp; b.hp = b.maxHp;
    b.phase = 1;                                  // 1 瞄准射击 / 2 暴怒 / 3 狂暴
    b.cruise = Math.random() < 0.5 ? 1 : -1;      // 巡航方向
    b.floatT = 0;                                 // 上下浮动相位
    b.cooldown = 1800;                            // 主炮冷却
    b.cooldown2 = 3000;                           // 弹幕冷却(阶段3)
    b.summonT = 5000;                             // 召唤援军计时
    b.wantsBase = false;
    this.enemies.push(b);
    this.boss = b;
    this.rings.push({ x: b.x + b.size / 2, y: b.y + b.size / 2, r: 10, max: 90, life: 1 });
  }

  _allTanks() {
    const arr = [];
    if (this.player && this.player.alive) arr.push(this.player);
    for (const e of this.enemies) if (e.alive) arr.push(e);
    return arr;
  }

  update(dt) {
    if (this.state !== 'playing') return;
    // 卡帧：命中瞬间短暂定格，强化打击感（约 50ms）
    if (this.hitStop > 0) { this.hitStop -= dt; this._syncHud(); return; }
    const step = Math.min(dt, 40) / 16.667; // 以 60fps 为基准的时长因子
    if (this.hintTimer > 0) this.hintTimer -= dt;
    if (this.freezeTimer > 0) this.freezeTimer -= dt;
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    if (this.killFlash > 0) { this.killFlash -= dt / 260; if (this.killFlash < 0) this.killFlash = 0; }
    if (this._skillHint > 0) this._skillHint -= dt;

    /* 技能充能 + 触发 */
    this._gainEnergy(CONFIG.SKILL.perSecond * dt / 1000);
    if (Input.skill) { Input.skill = false; this._tryMissiles(); }

    /* —— 玩家 —— */
    const p = this.player;
    if (p.alive) {
      let ix = Input.dir.x, iy = Input.dir.y, dx = 0, dy = 0;
      if (Math.abs(ix) > 0.22 || Math.abs(iy) > 0.22) {
        if (Math.abs(ix) > Math.abs(iy)) dx = Math.sign(ix); else dy = Math.sign(iy);
      }
      p.tryMove(dx * step * p.speed, dy * step * p.speed, this.map, this._allTanks());
      p.update(dt);
      p.cooldown -= dt;
      const cd = p.rapid > 0 ? CONFIG.PLAYER_FIRE_CD_RAPID : CONFIG.PLAYER_FIRE_CD;
      if (Input.fire && p.cooldown <= 0) { this._fire(p); p.cooldown = cd; }
    }

    /* —— 敌方 AI —— */
    const frozen = this.freezeTimer > 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.update(dt);
      if (frozen) continue; // 冰冻：完全不动不开火
      if (e.isBoss) { this._updateBoss(e, dt, step); continue; } // BOSS 专属 AI
      e.aiTimer -= dt;
      if (e.aiTimer <= 0) {
        const aim = this._aimDir(e);
        if (aim) {
          e.aiDir = aim; // 与目标对齐且有清晰视线：保持对线压制
        } else if (Math.random() < 0.75) {
          // 多数敌人直扑基地或追玩家 —— 增加威胁与目标感
          const tgt = (this.baseAlive && e.wantsBase) ? this.basePos : (p.alive ? { x: p.x + p.size / 2, y: p.y + p.size / 2 } : e);
          const ddx = tgt.x - (e.x + e.size / 2), ddy = tgt.y - (e.y + e.size / 2);
          e.aiDir = Math.abs(ddx) > Math.abs(ddy)
            ? { x: Math.sign(ddx) || 1, y: 0 }
            : { x: 0, y: Math.sign(ddy) || 1 };
        } else {
          const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
          e.aiDir = dirs[Math.floor(Math.random() * 4)];
        }
        e.aiTimer = 400 + Math.random() * 800;
      }
      const before = { x: e.x, y: e.y };
      e.tryMove(e.aiDir.x * step * e.speed, e.aiDir.y * step * e.speed, this.map, this._allTanks());
      if (Math.abs(e.x - before.x) < 0.01 && Math.abs(e.y - before.y) < 0.01) e.aiTimer = 0; // 卡墙换向
      e.cooldown -= dt;
      if (e.cooldown <= 0) {
        // 有清晰视线时瞄准射击，且射速加快(×0.75)；否则按炮口方向盲射
        // fireMult：关卡难度系数，前几关敌人开火更慢
        const aim = this._aimDir(e);
        this._fire(e, aim || undefined);
        e.cooldown = (CONFIG.ENEMY_FIRE_CD + Math.random() * CONFIG.ENEMY_FIRE_CD_VAR)
          * (aim ? 0.75 : 1) * (this.levelCfg.fireMult || 1);
      }
    }

    /* —— 炮弹 —— */
    for (const b of this.bullets) {
      if (!b.alive) continue;
      const res = b.update(step, this.map, this._allTanks());
      if (res) {
        if (res.type === 'brick') {
          Sound.hit(); this._debris(b.x, b.y);
          // 打碎砖块也充能(仅玩家子弹)，让充能节奏更快更主动
          if (b.owner === 'player') this._gainEnergy(CONFIG.SKILL.perBrick);
        }
        else if (res.type === 'steel') { Sound.steel(); this._spark(b.x, b.y, '#ffe08a'); }
        else if (res.type === 'tank') {
          const tk = res.tank;
          if (tk.type === 'enemy') {
            const dead = tk.hit(1);
            if (dead) this._onEnemyKilled(tk);
            else { Sound.hit(); this._spark(tk.x + tk.size / 2, tk.y + tk.size / 2, '#fff'); this._gainEnergy(CONFIG.SKILL.perHit); }
          } else {
            // 玩家受击：护盾/出生无敌时免疫
            if (this.player.spawnProtect > 0) {
              Sound.steel();
              this._spark(tk.x + tk.size / 2, tk.y + tk.size / 2, '#9fd8ff');
            } else {
              Sound.boom();
              this._playerHit();
            }
          }
        } else if (res.type === 'eagle') {
          this._baseDestroyed();
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.alive);

    /* —— 追踪导弹 —— */
    this._updateMissiles(dt);

    /* —— 道具 —— */
    this._updatePowerups(dt);

    /* —— 漂浮文字 —— */
    for (const f of this.floaters) { f.life -= dt; f.y += f.vy * step; }
    this.floaters = this.floaters.filter(f => f.life > 0);

    /* —— 枪口闪光 —— */
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter(f => f.life > 0);

    /* —— 粒子 —— */
    for (const pt of this.particles) pt.update(step);
    this.particles = this.particles.filter(pt => pt.alive);

    /* —— 冲击波环 —— */
    for (const rg of this.rings) { rg.r += (rg.max - rg.r) * 0.2 + 0.8; rg.life -= dt / 320; }
    this.rings = this.rings.filter(rg => rg.life > 0);

    /* —— 屏幕震动衰减 —— */
    this.shake *= 0.85;
    if (this.shake < 0.3) this.shake = 0;

    /* —— 清理死亡敌人 —— */
    this.enemies = this.enemies.filter(e => e.alive);

    /* —— 生成敌方 —— */
    const cfg = this.levelCfg;
    if (this.defeated + this.enemies.length < cfg.enemies &&
        this.enemies.length < cfg.maxActive) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this.spawnEnemy(); this.spawnTimer = cfg.spawnInterval; }
    }

    /* —— 胜负 / 关卡判定 —— */
    if (this.state === 'playing') {
      if (this.levelCfg.boss) {
        // BOSS 关：BOSS 死后先播放 1.7s 连环爆炸，再宣告胜利
        if (this._bossDying > 0) {
          this._bossDying -= dt;
          this._bossBoomT -= dt;
          if (this._bossBoomT <= 0 && this.boss) {
            this._bossBoomT = 190;
            const b = this.boss;
            this._explode(b.x + Math.random() * b.size, b.y + Math.random() * b.size);
            this.rings.push({ x: b.x + b.size / 2, y: b.y + b.size / 2, r: 6, max: 46, life: 1 });
            Sound.boom();
            this.shake = Math.max(this.shake, 5);
          }
          if (this._bossDying <= 0) this._win();
        }
      } else if (this.defeated >= cfg.enemies && this.enemies.length === 0) {
        if (this.level < CONFIG.LEVELS.length - 1) this._levelClear();
        else this._win();
      }
      if (this.lives <= 0 && this._bossDying <= 0) this._lose();
    }

    this._syncHud();
  }

  /* ===================== 道具系统 ===================== */
  _updatePowerups(dt) {
    const p = this.player;
    this.powerupTimer -= dt;
    if (this.powerupTimer <= 0 && this.powerups.length < CONFIG.POWERUP_MAX) {
      this._spawnPowerup();
      this.powerupTimer = this.levelCfg.powerupInterval;
    }
    for (const pu of this.powerups) {
      pu.life -= dt;
      if (p.alive && aabb(p.x, p.y, p.size, p.size,
                          pu.x - pu.size / 2, pu.y - pu.size / 2, pu.size, pu.size)) {
        this._applyPowerup(pu.type);
        pu.dead = true;
      }
    }
    this.powerups = this.powerups.filter(pu => pu.life > 0 && !pu.dead);
  }

  _spawnPowerup() {
    const types = ['shield', 'rapid', 'life', 'bomb', 'star', 'freeze', 'spread'];
    const type = types[Math.floor(Math.random() * types.length)];
    for (let tries = 0; tries < 50; tries++) {
      const c = 1 + Math.floor(Math.random() * (CONFIG.COLS - 2));
      const r = 1 + Math.floor(Math.random() * (CONFIG.ROWS - 2));
      if (this.map[r][c] !== 0) continue; // 只在空地生成
      const x = c * CONFIG.TILE + CONFIG.TILE / 2;
      const y = r * CONFIG.TILE + CONFIG.TILE / 2;
      const tooClose = this._allTanks().some(t =>
        Math.abs(t.x + t.size / 2 - x) < CONFIG.TILE &&
        Math.abs(t.y + t.size / 2 - y) < CONFIG.TILE);
      if (tooClose) continue;
      this.powerups.push({ x, y, type, life: CONFIG.POWERUP_LIFE, size: 26 });
      return;
    }
  }

  _applyPowerup(type) {
    const p = this.player;
    const meta = POWERUPS[type];
    const label = `${meta.icon} ${meta.name}`;
    if (type === 'shield') { p.spawnProtect = CONFIG.POWERUP_DURATION; Sound.pickup(); }
    else if (type === 'rapid') { p.rapid = CONFIG.POWERUP_DURATION; Sound.pickup(); }
    else if (type === 'life') { this.lives++; Sound.win(); }
    else if (type === 'bomb') {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const dmg = e.isBoss ? 4 : 10; // BOSS 皮糙肉厚，清场炸弹只造成 4 点伤害
        if (e.hit(dmg)) {
          this._onEnemyKilled(e);      // 统一走击杀逻辑(含 BOSS 分支)
        } else {
          this._explode(e.x + e.size / 2, e.y + e.size / 2);
          this.defeated++; this.score += 100;
        }
      }
      Sound.boom();
    } else if (type === 'star') { this.score += 200; Sound.pickup(); }
    else if (type === 'freeze') { this.freezeTimer = CONFIG.FREEZE_DURATION; Sound.freeze(); }
    else if (type === 'spread') { p.spread = CONFIG.SPREAD_DURATION; Sound.pickup(); }
    this._floater(p.x + p.size / 2, p.y, label, CONFIG.COLORS[meta.color]);
  }

  /* 技能充能(统一入口，封顶不溢出；恰好充满时提示一次) */
  _gainEnergy(a) {
    const before = this.skillEnergy;
    this.skillEnergy = Math.min(CONFIG.SKILL.energyMax, this.skillEnergy + a);
    if (before < CONFIG.SKILL.energyMax && this.skillEnergy >= CONFIG.SKILL.energyMax &&
        this.state === 'playing' && this.player && this.player.alive) {
      this._floater(this.player.x + this.player.size / 2, this.player.y - 10, '🚀 导弹就绪', '#ffd24a', 1.1);
    }
  }

  /* 敌方瞄准：与玩家或基地处于同行/同列且视线无钢墙遮挡时，返回瞄准方向 */
  _aimDir(e) {
    const cx = e.x + e.size / 2, cy = e.y + e.size / 2;
    const targets = [];
    if (this.player && this.player.alive) targets.push(this.player);
    if (this.baseAlive) targets.push({ x: this.basePos.x, y: this.basePos.y });
    for (const t of targets) {
      const tx = t.x + (t.size ? t.size / 2 : 0), ty = t.y + (t.size ? t.size / 2 : 0);
      const dx = tx - cx, dy = ty - cy;
      if (Math.abs(dx) < CONFIG.TILE * 0.55 && Math.abs(dy) > CONFIG.TILE * 0.4) {
        const dir = { x: 0, y: Math.sign(dy) };
        if (this._clearLine(cx, cy, tx, ty, dir)) return dir;
      } else if (Math.abs(dy) < CONFIG.TILE * 0.55 && Math.abs(dx) > CONFIG.TILE * 0.4) {
        const dir = { x: Math.sign(dx), y: 0 };
        if (this._clearLine(cx, cy, tx, ty, dir)) return dir;
      }
    }
    return null;
  }

  /* 沿 dir 从 (x1,y1) 到 (x2,y2) 是否无钢墙/基地遮挡（砖块可被打碎，不算挡） */
  _clearLine(x1, y1, x2, y2, dir) {
    const dist = dir.x ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
    const stepLen = CONFIG.TILE / 2;
    const steps = Math.floor(dist / stepLen);
    for (let i = 1; i <= steps; i++) {
      const t = tileAt(this.map, x1 + dir.x * i * stepLen, y1 + dir.y * i * stepLen);
      if (t === 2 || t === 4) return false;
    }
    return true;
  }

  _fire(tank, dirOverride) {
    const base = dirOverride || tank.dir;
    let tip;
    if (dirOverride) { // 瞄准射击：炮口按瞄准方向计算
      const cx = tank.x + tank.size / 2, cy = tank.y + tank.size / 2;
      const len = tank.size / 2 + 4;
      tip = { x: cx + base.x * len, y: cy + base.y * len };
    } else {
      tip = tank.barrelTip();
    }
    const dirs = [base];
    if (tank.type === 'player' && tank.spread > 0) {
      dirs.push(rotateDir(base, -18), rotateDir(base, 18)); // 三向齐射
    }
    for (const d of dirs) {
      this.bullets.push(new Bullet(tip.x, tip.y, d, tank.type));
      this.particles.push(new Particle(tip.x, tip.y,
        tank.type === 'player' ? '#fff3c4' : '#ffd0c4',
        d.x * 1.5, d.y * 1.5, 8, 3));
    }
    // 射击反馈：后坐力 + 枪口闪光 + 轻微震动
    tank.recoil = tank.type === 'player' ? 3.2 : 2;
    this.flashes.push({ x: tip.x, y: tip.y, dir: tank.dir, life: 130, max: 130 });
    if (tank.type === 'player') this.shake = Math.max(this.shake, 2.4);
    Sound.fire();
  }

  /* ===================== BOSS：钢铁巨兽 ===================== */
  /* 三阶段战斗：
   *  阶段1(HP>65%) 慢速巡航 + 单发瞄准弹
   *  阶段2(35~65%) 暴怒：三向扇形弹 + 召唤援军 + 碾压伤害
   *  阶段3(<35%)   狂暴：8向环形弹幕 + 高频瞄准弹 + 更快移动 */
  _updateBoss(b, dt, step) {
    const p = this.player;
    const frac = b.hp / b.maxHp;
    const ph = frac > 0.65 ? 1 : frac > 0.35 ? 2 : 3;
    if (ph !== b.phase) { // 阶段切换：强提示
      b.phase = ph;
      this.shake = Math.max(this.shake, 9);
      this.killFlash = Math.max(this.killFlash, 0.2);
      Sound.boom();
      this._floater(b.x + b.size / 2, b.y + b.size / 2,
        ph === 2 ? '⚠ BOSS 暴怒!' : '⚠ BOSS 狂暴!!',
        ph === 2 ? '#ff8a3d' : '#ff3d3d', 1.5);
    }
    const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
    // 水平巡航(撞墙/坦克即掉头)，速度随阶段提升
    const spd = ph === 1 ? 0.55 : ph === 2 ? 0.85 : 1.15;
    const bx = b.x;
    b.tryMove(b.cruise * step * spd, 0, this.map, this._allTanks());
    if (Math.abs(b.x - bx) < 0.02) b.cruise *= -1;
    // 上下正弦浮动(顶部清空巡航带内直接赋值，越愤怒越躁动)
    b.floatT += dt;
    const amp = ph === 3 ? CONFIG.TILE * 0.9 : CONFIG.TILE * 0.55;
    b.y = CONFIG.TILE + 4 + (Math.sin(b.floatT / (ph === 3 ? 850 : 1400)) * 0.5 + 0.5) * amp;
    // 双炮管始终指向玩家(视觉 + 射击基准；须在 tryMove 之后设置，避免被移动逻辑覆盖)
    if (p.alive) {
      const dx = p.x + p.size / 2 - cx, dy = p.y + p.size / 2 - cy;
      const l = Math.hypot(dx, dy) || 1;
      b.dir = { x: dx / l, y: dy / l };
    }
    // 阶段2+：被巨兽碾到直接受创
    if (ph >= 2 && p.alive && p.spawnProtect <= 0 &&
        aabb(b.x, b.y, b.size, b.size, p.x, p.y, p.size, p.size)) {
      Sound.boom();
      this._playerHit();
    }
    // —— 开火 ——
    b.cooldown -= dt; b.cooldown2 -= dt; b.summonT -= dt;
    const aim = b.dir;
    if (b.cooldown <= 0 && p.alive) {
      if (ph === 1) { this._bossFire(b, [aim]); b.cooldown = 1600; }
      else if (ph === 2) {
        this._bossFire(b, [aim, rotateDir(aim, 22), rotateDir(aim, -22)]);
        b.cooldown = 1500;
      } else {
        this._bossFire(b, [aim]);
        b.cooldown = 950;
      }
    }
    if (ph === 3 && b.cooldown2 <= 0) { // 环形弹幕
      const dirs = [];
      const base = Math.atan2(aim.y, aim.x);
      for (let i = 0; i < 8; i++) {
        const a = base + i * Math.PI / 4;
        dirs.push({ x: Math.cos(a), y: Math.sin(a) });
      }
      this._bossFire(b, dirs);
      b.cooldown2 = 2400;
    }
    // —— 召唤援军 ——
    if (ph >= 2 && b.summonT <= 0) {
      const maxSum = ph === 3 ? 7 : 5;              // 场上小怪上限(狂暴期更多)
      const batch  = ph === 3 ? 3 : 2;              // 每次召唤数量
      const cur = this.enemies.filter(e => !e.isBoss).length;
      if (cur < maxSum) {
        const n = this._bossSummon(Math.min(batch, maxSum - cur));
        if (n > 0) this._floater(cx, cy + b.size / 2 + 10,
          `BOSS 召唤援军 x${n}!`, '#b06bff', 1.1);
      }
      b.summonT = ph === 3 ? 3800 : 5000;           // 召唤更频繁
    }
  }

  /* BOSS 开火：从双炮管中心沿 dirs 齐射 */
  _bossFire(b, dirs) {
    const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
    for (const d of dirs) {
      const x = cx + d.x * (b.size / 2 + 6), y = cy + d.y * (b.size / 2 + 6);
      this.bullets.push(new Bullet(x, y, d, 'enemy'));
      this.particles.push(new Particle(x, y, '#ffd0c4', d.x * 1.5, d.y * 1.5, 8, 3));
    }
    b.recoil = 3.5;
    this.shake = Math.max(this.shake, 2);
    Sound.fire();
  }

  /* BOSS 召唤：在顶部多点生成最多 count 辆小怪(避开占位)，返回实际召唤数 */
  _bossSummon(count) {
    const spots = [[1, 1], [25, 1], [6, 1], [20, 1], [1, 4], [25, 4]];
    let n = 0;
    for (const [c, r] of spots) {
      if (n >= count) break;
      const x = c * CONFIG.TILE, y = r * CONFIG.TILE;
      const occupied = this._allTanks().some(t =>
        aabb(t.x, t.y, t.size, t.size, x, y, CONFIG.TILE, CONFIG.TILE));
      if (occupied) continue;
      const e = this._makeEnemy(c, r);
      this.enemies.push(e);
      this.rings.push({ x: x + CONFIG.TILE / 2, y: y + CONFIG.TILE / 2, r: 4, max: 34, life: 1 });
      n++;
    }
    if (n > 0) Sound.pickup();
    return n;
  }

  /* 击败 BOSS：+1000 分，清场所有小怪，进入死亡演出 */
  _onBossKilled(b) {
    const ex = b.x + b.size / 2, ey = b.y + b.size / 2;
    this.score += 1000;
    this.defeated++;
    this._floater(ex, ey, '+1000', '#ffd23d', 1.4);
    this._floater(ex, ey - 28, '👑 BOSS 击败!', '#ff7a3d', 1.5);
    // 连环爆炸清场：剩余小怪一并炸掉
    for (const e of this.enemies) {
      if (!e.alive || e.isBoss) continue;
      e.alive = false;
      this.defeated++; this.score += 100;
      this._explode(e.x + e.size / 2, e.y + e.size / 2);
    }
    this._explode(ex, ey);
    this.rings.push({ x: ex, y: ey, r: 12, max: 110, life: 1 });
    this.killFlash = 0.4; this.shake = 14; this.hitStop = 110;
    Sound.boom();
    this._bossDying = 1700; this._bossBoomT = 0;
  }

  /* ===================== 主动技能 ===================== */
  _tryMissiles() {
    if (!this.player.alive) return;
    if (this.skillEnergy < CONFIG.SKILL.energyMax) {
      if (this._skillHint <= 0) {
        this._floater(this.player.x + this.player.size / 2, this.player.y - 8, '导弹蓄力中', '#7fd6ff');
        this._skillHint = 1200;
      }
      return;
    }
    this.skillEnergy = 0;
    this._msQueue = CONFIG.SKILL.missileCount;
    this._msTimer = 0; // 立即发射第一枚
    this.shake = Math.max(this.shake, 3);
    this._floater(this.player.x + this.player.size / 2, this.player.y, '🚀 导弹齐射!', '#7df');
  }

  /* 每帧调用：处理连发队列 + 所有在飞导弹的追踪/碰撞/特效 */
  _updateMissiles(dt) {
    const S = CONFIG.SKILL;
    // 连发：每隔 missileDelay 从玩家炮口射出一枚
    if (this._msQueue > 0) {
      this._msTimer -= dt;
      if (this._msTimer <= 0 && this.player.alive) {
        const tip = this.player.barrelTip();
        // 初始朝向：玩家炮口方向 ± 随机小偏角，随即自动追踪
        const base = Math.atan2(this.player.dir.y, this.player.dir.x);
        const a = base + (Math.random() - 0.5) * 1.2;
        this.missiles.push(new Missile(tip.x, tip.y, { x: Math.cos(a), y: Math.sin(a) }));
        this.flashes.push({ x: tip.x, y: tip.y, dir: this.player.dir, life: 130, max: 130 });
        Sound.missile();
        this.shake = Math.max(this.shake, 2);
        this._msQueue--;
        this._msTimer = S.missileDelay;
      }
    }
    if (!this.missiles.length) return;
    const step = Math.min(dt, 40) / 16.667;
    for (const m of this.missiles) {
      if (!m.alive) continue;
      m.life -= dt;
      if (m.life <= 0) { this._missileBoom(m, false); continue; }

      // 追踪：转向最近存活敌人
      let tgt = null, best = Infinity;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d = (e.x + e.size / 2 - m.x) ** 2 + (e.y + e.size / 2 - m.y) ** 2;
        if (d < best) { best = d; tgt = e; }
      }
      if (tgt) {
        const ang = Math.atan2(m.dir.y, m.dir.x);
        const want = Math.atan2(tgt.y + tgt.size / 2 - m.y, tgt.x + tgt.size / 2 - m.x);
        let diff = want - ang;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = S.missileTurn * step;
        diff = Math.max(-maxTurn, Math.min(maxTurn, diff));
        m.dir = { x: Math.cos(ang + diff), y: Math.sin(ang + diff) };
      }

      // 位移
      m.x += m.dir.x * m.speed * step;
      m.y += m.dir.y * m.speed * step;

      // 尾烟(节流)
      m.smoke -= dt;
      if (m.smoke <= 0) {
        m.smoke = 26;
        this.particles.push(new Particle(
          m.x - m.dir.x * 6, m.y - m.dir.y * 6,
          Math.random() < 0.5 ? 'rgba(200,200,200,0.55)' : 'rgba(255,170,80,0.6)',
          -m.dir.x * 0.4 + (Math.random() - 0.5) * 0.3,
          -m.dir.y * 0.4 + (Math.random() - 0.5) * 0.3 - 0.15,
          16 + Math.random() * 14, 2 + Math.random() * 2));
      }

      // 出界
      const W = CONFIG.COLS * CONFIG.TILE, H = CONFIG.ROWS * CONFIG.TILE;
      if (m.x < -10 || m.y < -10 || m.x > W + 10 || m.y > H + 10) { m.alive = false; continue; }

      // 撞地形：炸碎砖/GZH；钢墙/基地挡下(不伤基地)
      const t = tileAt(this.map, m.x, m.y);
      if (t === 1 || t === 3) {
        const c = Math.floor(m.x / CONFIG.TILE), r = Math.floor(m.y / CONFIG.TILE);
        if (r >= 0 && c >= 0 && r < CONFIG.ROWS && c < CONFIG.COLS) this.map[r][c] = 0;
        MAP_VERSION++;
        this._missileBoom(m, true);
        continue;
      }
      if (t === 2 || t === 4) { this._missileBoom(m, true); continue; }

      // 撞敌人：一发炸毁(含装甲)
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (aabb(m.x - 4, m.y - 4, 8, 8, e.x, e.y, e.size, e.size)) {
          const dead = e.hit(S.missileDamage);
          if (dead) this._onEnemyKilled(e);
          else { Sound.hit(); this._spark(e.x + e.size / 2, e.y + e.size / 2, '#fff'); }
          this._missileBoom(m, true);
          break;
        }
      }
    }
    this.missiles = this.missiles.filter(m => m.alive);
  }

  /* 导弹爆炸：小规模爆炸 + 冲击波环 */
  _missileBoom(m, loud) {
    m.alive = false;
    const x = m.x, y = m.y;
    if (loud) Sound.boom();
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3;
      const col = ['#ff8a3d', '#ffd23d', '#ffffff', '#ff5252'][Math.floor(Math.random() * 4)];
      this.particles.push(new Particle(x, y, col, Math.cos(a) * sp, Math.sin(a) * sp, 12 + Math.random() * 14, 2 + Math.random() * 2.5));
    }
    this.rings.push({ x, y, r: 5, max: 36, life: 1 });
    this.shake = Math.max(this.shake, loud ? 4 : 2);
  }

  /* 击败敌方坦克：连击倍率 + 爽快反馈 */
  _onEnemyKilled(tk) {
    if (tk.isBoss) { this._onBossKilled(tk); return; }
    const ex = tk.x + tk.size / 2, ey = tk.y + tk.size / 2;
    // 连击：2.2s 内连续击杀累计，倍率 1 / 1.5 / 2 / 2.5 ...
    this.comboTimer = 2200;
    this.combo = this.combo < 1 ? 1 : this.combo + 1;
    const mult = 1 + (this.combo - 1) * 0.5;
    const pts = Math.round(100 * mult);
    this.score += pts;
    this.defeated++;
    this.skillEnergy = Math.min(CONFIG.SKILL.energyMax, this.skillEnergy + CONFIG.SKILL.perKill); // 与 _gainEnergy 等价
    // 反馈：爆炸 + 冲击波 + 白闪 + 卡帧 + 震动
    Sound.boom();
    this._explode(ex, ey);
    this.rings.push({ x: ex, y: ey, r: 8, max: 52, life: 1 });
    this.killFlash = Math.max(this.killFlash, 0.16);
    this.hitStop = Math.max(this.hitStop, 55);
    this.shake = Math.max(this.shake, 7);
    this._floater(ex, ey - 6, '+' + pts, '#ffd23d', 1.15);
    if (this.combo >= 2) this._floater(ex, ey - 22, '连击 x' + this.combo, '#ff7a3d', 1.25);
  }

  /* 基地(鹰旗)被摧毁 → 立即失败 */
  _baseDestroyed() {
    if (!this.baseAlive) return;
    this.baseAlive = false;
    this.map[CONFIG.ROWS - 2][13] = 0;
    MAP_VERSION++;
    const bx = 13 * CONFIG.TILE + CONFIG.TILE / 2, by = (CONFIG.ROWS - 2) * CONFIG.TILE + CONFIG.TILE / 2;
    this._explode(bx, by);
    this.rings.push({ x: bx, y: by, r: 10, max: 70, life: 1 });
    this.killFlash = 0.35; this.shake = 12;
    this._lose('base');
  }

  _playerHit() {
    this.lives--;
    this._explode(this.player.x + this.player.size / 2, this.player.y + this.player.size / 2);
    this.shake = Math.max(this.shake, 7);
    if (this.lives > 0) this.player = new Tank(11, CONFIG.ROWS - 2, 'player');
  }

  _explode(x, y) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4.2;
      const col = ['#ff8a3d', '#ffd23d', '#ff5252', '#ffb74d', '#ffffff'][Math.floor(Math.random() * 5)];
      this.particles.push(new Particle(x, y, col, Math.cos(a) * sp, Math.sin(a) * sp, 16 + Math.random() * 20, 2 + Math.random() * 3.2));
    }
    // 几颗更亮更大的火花
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 3;
      this.particles.push(new Particle(x, y, '#fff', Math.cos(a) * sp, Math.sin(a) * sp, 10, 3 + Math.random() * 2));
    }
    // 升腾的硝烟：灰白、缓慢上飘、更持久
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.2 + Math.random() * 0.7;
      this.particles.push(new Particle(
        x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12,
        'rgba(110,110,110,0.5)',
        Math.cos(a) * sp, Math.sin(a) * sp - 0.5,
        26 + Math.random() * 24, 4 + Math.random() * 3.5));
    }
  }
  _debris(x, y) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.5 + Math.random() * 1.5;
      this.particles.push(new Particle(x, y, '#c2723f', Math.cos(a) * sp, Math.sin(a) * sp, 10 + Math.random() * 8, 2));
    }
  }
  _spark(x, y, color) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
      this.particles.push(new Particle(x, y, color, Math.cos(a) * sp, Math.sin(a) * sp, 8 + Math.random() * 6, 2));
    }
  }
  _floater(x, y, text, color, scale) {
    this.floaters.push({ x, y, text, color: color || '#fff', life: 1100, max: 1100, vy: -0.45, scale: scale || 1 });
  }

  _levelClear() {
    this.state = 'levelclear';
    showOverlay('levelclear');
  }
  _win() {
    if (this.state === 'win') return;
    this.state = 'win';
    Sound.win();
    // 第一次击败 BOSS 后弹出进阶版解锁提示
    if (this.levelCfg.boss && !this.bossClearedOnce) {
      this.bossClearedOnce = true;
      try { localStorage.setItem('tankBossCleared', '1'); } catch (e) {}
      showOverlay('bossunlock', this.score);
    } else {
      showOverlay('win', this.score);
    }
  }
  _lose(reason) { if (this.state === 'lose') return; this.state = 'lose'; Sound.lose(); showOverlay('lose', this.score, reason); }

  _syncHud() {
    const score = document.getElementById('score');
    const lives = document.getElementById('lives');
    const enemies = document.getElementById('enemies');
    const fx = document.getElementById('fx');
    const lvl = document.getElementById('level');
    const energy = document.getElementById('energy');
    if (score) score.textContent = this.score;
    if (lives) lives.textContent = '♥'.repeat(Math.max(0, this.lives)) +
      '♡'.repeat(Math.max(0, (this._maxLives || CONFIG.PLAYER_LIVES) - this.lives));
    if (enemies) enemies.textContent = this.levelCfg.boss
      ? (this.boss && this.boss.alive ? '👑BOSS' : '--')
      : (this.levelCfg.enemies - this.defeated);
    if (lvl) lvl.textContent = this.levelCfg.name;
    if (energy) {
      const pct = Math.round(this.skillEnergy / CONFIG.SKILL.energyMax * 100);
      energy.style.width = pct + '%';
      const full = this.skillEnergy >= CONFIG.SKILL.energyMax;
      energy.classList.toggle('full', full);
      const sb = document.getElementById('skill-btn');
      if (sb) sb.classList.toggle('full', full);
    }
    if (fx) {
      const p = this.player;
      let s = '';
      if (p && p.alive) {
        if (p.spawnProtect > 0) s += '🛡' + Math.ceil(p.spawnProtect / 1000) + 's ';
        if (p.rapid > 0) s += '⚡' + Math.ceil(p.rapid / 1000) + 's ';
        if (p.spread > 0) s += '⋔' + Math.ceil(p.spread / 1000) + 's ';
        if (this.freezeTimer > 0) s += '❄' + Math.ceil(this.freezeTimer / 1000) + 's ';
        if (this.combo >= 2) s += '🔥x' + this.combo + ' ';
      }
      fx.textContent = s;
    }
    // HUD 与提示条仅在开始界面隐藏，局内始终可见
    const show = this.state !== 'start';
    const hud = document.getElementById('hud');
    if (hud) hud.style.visibility = show ? 'visible' : 'hidden';
    const tip = document.getElementById('tipbar');
    if (tip) tip.style.visibility = show ? 'visible' : 'hidden';
  }

  /* ===================== 渲染 ===================== */
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

    if (this.bgLoaded && this.bgImage) {
      ctx.globalAlpha = CONFIG.BG_OPACITY;
      ctx.drawImage(this.bgImage, 0, 0, this.W, this.H);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = CONFIG.COLORS.grass; ctx.fillRect(0, 0, this.W, this.H);
      ctx.strokeStyle = CONFIG.COLORS.grid; ctx.lineWidth = 1;
      for (let c = 0; c <= CONFIG.COLS; c++) { ctx.beginPath(); ctx.moveTo(c * CONFIG.TILE, 0); ctx.lineTo(c * CONFIG.TILE, this.H); ctx.stroke(); }
      for (let r = 0; r <= CONFIG.ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * CONFIG.TILE); ctx.lineTo(this.W, r * CONFIG.TILE); ctx.stroke(); }
    }

    this._drawTiles(ctx);
    if (this.player && this.player.alive) this._drawTank(ctx, this.player);
    for (const e of this.enemies) if (e.alive) this._drawTank(ctx, e);
    for (const b of this.bullets) this._drawBullet(ctx, b);
    for (const pu of this.powerups) this._drawPowerup(ctx, pu);
    this._drawFlashes(ctx);
    this._drawMissiles(ctx);
    for (const pt of this.particles) this._drawParticle(ctx, pt);
    for (const rg of this.rings) this._drawRing(ctx, rg);
    this._drawFloaters(ctx);
    if (this.hintTimer > 0 && this.state === 'playing') this._drawHint(ctx);
    ctx.restore();

    // BOSS 血条(顶部居中，不随震动偏移)：颜色与阶段刻度实时反映战斗进度
    if (this.levelCfg.boss && this.boss && this.boss.alive &&
        (this.state === 'playing' || this.state === 'paused')) {
      this._drawBossBar(ctx);
    }

    // 暗角：四周轻微压暗，聚焦战场中心(不随震动偏移)
    if (!this._vignette) {
      const g = ctx.createRadialGradient(
        this.W / 2, this.H / 2, this.H * 0.42,
        this.W / 2, this.H / 2, this.H * 0.92);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.26)');
      this._vignette = g;
    }
    ctx.fillStyle = this._vignette;
    ctx.fillRect(0, 0, this.W, this.H);

    // 击杀全屏白闪(增强打击感)
    if (this.killFlash > 0) {
      ctx.fillStyle = `rgba(255,250,230,${Math.min(0.5, this.killFlash)})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  _drawTiles(ctx) {
    // 静态地形离屏缓存：砖/钢/GZH/基地只在地图变化时重绘一次，每帧仅一次 drawImage
    if (MAP_VERSION !== this._mapVersion) { this._redrawTileCache(); this._mapVersion = MAP_VERSION; }
    ctx.drawImage(this._tileCanvas, 0, 0, this.W, this.H);
  }
  /* 重建地形缓存(带 DPR 高清) */
  _redrawTileCache() {
    const dpr = window.devicePixelRatio || 1;
    if (this._tileCanvas.width !== Math.floor(this.W * dpr) || this._tileCanvas.height !== Math.floor(this.H * dpr)) {
      this._tileCanvas.width = Math.floor(this.W * dpr);
      this._tileCanvas.height = Math.floor(this.H * dpr);
    }
    const c = this._tileCanvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    const T = CONFIG.TILE;
    for (let r = 0; r < CONFIG.ROWS; r++)
      for (let cc = 0; cc < CONFIG.COLS; cc++) {
        const t = this.map[r][cc];
        if (t === 1) this._drawBrick(c, cc * T, r * T, T);
        else if (t === 2) this._drawSteel(c, cc * T, r * T, T);
        else if (t === 3) this._drawLogoBrick(c, cc * T, r * T, T);
        else if (t === 4) this._drawBase(c, cc * T, r * T, T);
      }
  }
  _drawBrick(ctx, x, y, s) {
    const C = CONFIG.COLORS;
    ctx.fillStyle = C.brickB; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = C.brickA;
    const bw = s / 2, bh = s / 4;
    ctx.fillRect(x, y, bw, bh); ctx.fillRect(x + bw, y + bh, bw, bh);
    ctx.fillRect(x, y + bh * 2, bw, bh); ctx.fillRect(x + bw, y + bh * 3, bw, bh);
    // 顶部高光 + 底部阴影：让砖墙有立体感
    ctx.fillStyle = 'rgba(255,235,200,0.14)';
    ctx.fillRect(x, y, s, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, y + s - 3, s, 3);
    ctx.strokeStyle = C.brickLine; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  }
  _drawLogoBrick(ctx, x, y, s) {
    const C = CONFIG.COLORS;
    ctx.save();
    ctx.shadowColor = C.logoGlow; ctx.shadowBlur = 10; // GZH 发光，强调“明显”
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, C.logoA); g.addColorStop(1, C.logoB);
    ctx.fillStyle = g; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.restore();
    ctx.strokeStyle = C.logoLine; ctx.lineWidth = 1; ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
  }
  _drawSteel(ctx, x, y, s) {
    const C = CONFIG.COLORS;
    ctx.fillStyle = C.steelB; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = C.steelA; ctx.fillRect(x + 3, y + 3, s - 6, s - 6);
    ctx.strokeStyle = C.steelLine; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y + 3); ctx.lineTo(x + s / 2, y + s - 3);
    ctx.moveTo(x + 3, y + s / 2); ctx.lineTo(x + s - 3, y + s / 2);
    ctx.stroke();
  }
  /* 基地(鹰旗)：需守住的目标 */
  _drawBase(ctx, x, y, s) {
    ctx.save();
    ctx.fillStyle = '#caa15a';
    this._roundRect(ctx, x + 3, y + 3, s - 6, s - 6, 5); ctx.fill();
    ctx.strokeStyle = '#8a6a2e'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffd24a';
    ctx.font = `bold ${Math.floor(s * 0.62)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', x + s / 2, y + s / 2 + 1);
    ctx.restore();
  }
  _drawRing(ctx, rg) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, rg.life) * 0.8;
    ctx.strokeStyle = 'rgba(255,220,120,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  /* BOSS 顶部大血条：底槽 + 阶段变色 + 阶段刻度线 + 标签 */
  _drawBossBar(ctx) {
    const b = this.boss;
    const w = this.W * 0.52, x = (this.W - w) / 2, y = 12, h = 13;
    const frac = Math.max(0, b.hp / b.maxHp);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    this._roundRect(ctx, x - 5, y - 5, w + 10, h + 10, 9); ctx.fill();
    ctx.fillStyle = '#3a2328'; ctx.fillRect(x, y, w, h);
    const col = frac > 0.65 ? '#e0573e' : frac > 0.35 ? '#ff8a3d' : '#ff2d2d';
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = col; ctx.fillRect(x, y, w * frac, h);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x, y, w * frac, 3);
    // 阶段刻度(35% / 65%)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
    for (const m of [0.35, 0.65]) {
      ctx.beginPath();
      ctx.moveTo(x + w * m, y - 2); ctx.lineTo(x + w * m, y + h + 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('👑 钢铁巨兽', x, y - 7);
    ctx.textAlign = 'right';
    ctx.fillText(b.phase === 3 ? '狂暴!' : `阶段 ${b.phase}`, x + w, y - 7);
    ctx.restore();
  }
  _drawTank(ctx, tank) {
    const s = tank.size, cx = tank.x + s / 2, cy = tank.y + s / 2;
    const ang = Math.atan2(tank.dir.y, tank.dir.x);
    let base, dark;
    if (tank.type === 'player') { base = CONFIG.COLORS.player; dark = CONFIG.COLORS.playerDark; }
    else if (tank.variant === 'boss') { base = CONFIG.COLORS.boss; dark = CONFIG.COLORS.bossDark; }
    else if (tank.variant === 'fast') { base = CONFIG.COLORS.enemyFast; dark = CONFIG.COLORS.enemyFastDark; }
    else if (tank.variant === 'armor') { base = CONFIG.COLORS.enemyArmor; dark = CONFIG.COLORS.enemyArmorDark; }
    else { base = CONFIG.COLORS.enemy; dark = CONFIG.COLORS.enemyDark; }

    // 地面阴影
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.32, s * 0.5, s * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 受击白闪
    const flash = tank.hitFlash > 0 ? Math.min(1, tank.hitFlash / 160) : 0;

    ctx.save();
    const rx = cx - tank.dir.x * tank.recoil; // 后坐力：整体沿反方向偏移
    const ry = cy - tank.dir.y * tank.recoil;
    ctx.translate(rx, ry); ctx.rotate(ang);

    // 护盾光环(玩家无敌时)
    if (tank.spawnProtect > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 120);
      ctx.save();
      ctx.rotate(-ang);
      ctx.strokeStyle = `rgba(58,160,255,${0.55 + 0.4 * pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (tank.spawnProtect > 0 && Math.floor(tank.spawnProtect / 120) % 2 === 0) ctx.globalAlpha = 0.45;

    // 履带（带滚动条纹）
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(-s / 2, -s / 2, s * 0.22, s);
    ctx.fillRect(s / 2 - s * 0.22, -s / 2, s * 0.22, s);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    const off = (tank.tread % 8);
    for (let yy = -s / 2 + off - 8; yy < s / 2; yy += 8) {
      ctx.fillRect(-s / 2, yy, s * 0.22, 3);
      ctx.fillRect(s / 2 - s * 0.22, yy, s * 0.22, 3);
    }

    // 车体
    const grad = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    grad.addColorStop(0, base); grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    this._roundRect(ctx, -s / 2 + s * 0.18, -s / 2 + s * 0.18, s * 0.64, s * 0.64, 5); ctx.fill();
    // 装甲板（仅装甲敌方）
    if (tank.variant === 'armor') {
      ctx.fillStyle = dark;
      ctx.fillRect(-s * 0.32, -s * 0.32, s * 0.12, s * 0.64);
      ctx.fillRect(s * 0.20, -s * 0.32, s * 0.12, s * 0.64);
      if (tank.hp < tank.maxHp) { // 受损裂纹
        ctx.strokeStyle = 'rgba(20,20,20,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(-s * 0.1, -s * 0.2); ctx.lineTo(s * 0.05, 0); ctx.lineTo(-s * 0.05, s * 0.2); ctx.stroke();
      }
    }
    // 炮塔 + 炮管
    if (tank.variant === 'boss') {
      // BOSS：巨型双炮管 + 大炮塔 + 闪烁警示灯
      ctx.fillStyle = '#222';
      ctx.fillRect(s * 0.16, -s * 0.17, s * 0.46, 6);
      ctx.fillRect(s * 0.16, s * 0.17 - 6, s * 0.46, 6);
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,80,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2); ctx.stroke();
      const blink = Math.floor(Date.now() / 200) % 2 === 0;
      if (blink) { ctx.shadowColor = '#ff2d2d'; ctx.shadowBlur = 12; }
      ctx.fillStyle = blink ? '#ff2d2d' : '#7a1010';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2); ctx.fill();
      // 炮管
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(s * 0.18, -3, s * 0.36, 6);
    }
    if (tank.variant === 'fast') { // 快速坦克高光标识
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-s * 0.1, -s * 0.1, s * 0.2, s * 0.04);
    }
    if (flash > 0) { // 受击泛白
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.8})`;
      this._roundRect(ctx, -s / 2 + s * 0.18, -s / 2 + s * 0.18, s * 0.64, s * 0.64, 5); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // 冰冻标记(敌方被冻结)
    if (tank.type === 'enemy' && this.freezeTimer > 0) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = CONFIG.COLORS.powerFreeze;
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // BOSS 狂暴光环(阶段3：红色脉冲圈，警告玩家)
    if (tank.variant === 'boss' && tank.phase === 3) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 110);
      ctx.save();
      ctx.strokeStyle = `rgba(255,45,45,${0.35 + 0.4 * pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.72 + pulse * 4, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // 玩家开火就绪环
    if (tank.type === 'player') {
      const ready = tank.cooldown <= 0;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = ready ? 'rgba(120,255,140,0.9)' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (ready) ctx.arc(0, 0, s * 0.72, 0, Math.PI * 2);
      else {
        const cdFull = tank.rapid > 0 ? CONFIG.PLAYER_FIRE_CD_RAPID : CONFIG.PLAYER_FIRE_CD;
        const frac = 1 - Math.max(0, tank.cooldown) / cdFull;
        ctx.arc(0, 0, s * 0.72, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();

      // 导弹能量环(金色，紧贴坦克外圈)：充能进度一目了然；满格时脉冲发光
      const efrac = this.skillEnergy / CONFIG.SKILL.energyMax;
      if (efrac > 0.01) {
        const full = efrac >= 1;
        const pulse = full ? 0.7 + 0.3 * Math.sin(Date.now() / 130) : 1;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.strokeStyle = full ? `rgba(255,214,74,${pulse})` : 'rgba(255,214,74,0.62)';
        ctx.lineWidth = full ? 4 : 3;
        if (full) { ctx.shadowColor = 'rgba(255,200,60,0.85)'; ctx.shadowBlur = 12; }
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.9, -Math.PI / 2, -Math.PI / 2 + efrac * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  _drawBullet(ctx, b) {
    ctx.save();
    // 拖尾：沿飞行方向一条渐隐光尾
    const tl = 18;
    const tx = b.x - b.dir.x * tl, ty = b.y - b.dir.y * tl;
    const tg = ctx.createLinearGradient(tx, ty, b.x, b.y);
    tg.addColorStop(0, 'rgba(255,213,74,0)');
    tg.addColorStop(1, 'rgba(255,213,74,0.55)');
    ctx.strokeStyle = tg; ctx.lineWidth = b.size * 0.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
    // 弹头
    ctx.shadowColor = CONFIG.COLORS.bullet; ctx.shadowBlur = 8;
    ctx.fillStyle = CONFIG.COLORS.bullet;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.size / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CONFIG.COLORS.bulletCore;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.size / 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  _drawPowerup(ctx, pu) {
    const meta = POWERUPS[pu.type];
    const col = CONFIG.COLORS[meta.color];
    ctx.save();
    ctx.globalAlpha = pu.life < 2500 ? (0.45 + 0.55 * Math.abs(Math.sin(pu.life / 180))) : 1;
    ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.fillStyle = col;
    this._roundRect(ctx, pu.x - pu.size / 2, pu.y - pu.size / 2, pu.size, pu.size, 8); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(meta.icon, pu.x, pu.y + 1);
    ctx.restore();
  }
  _drawFlashes(ctx) {
    for (const f of this.flashes) {
      const a = f.life / f.max;
      const r = 4 + (1 - a) * 11;
      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      grad.addColorStop(0, `rgba(255,255,210,${a})`);
      grad.addColorStop(0.5, `rgba(255,180,60,${a * 0.7})`);
      grad.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  _drawMissiles(ctx) {
    if (!this.missiles.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.missiles) {
      const a = Math.atan2(m.dir.y, m.dir.x);
      // 尾焰：随机长度橙黄光锥
      const fl = 8 + Math.random() * 7;
      const fx = m.x - m.dir.x * 5, fy = m.y - m.dir.y * 5;
      const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, fl + 4);
      grad.addColorStop(0, 'rgba(255,230,150,0.95)');
      grad.addColorStop(0.5, 'rgba(255,140,60,0.6)');
      grad.addColorStop(1, 'rgba(255,80,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(fx, fy, fl + 4, 0, Math.PI * 2); ctx.fill();
      // 弹体
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(a);
      ctx.fillStyle = '#d8e6f2';
      ctx.shadowColor = 'rgba(255,200,120,0.9)'; ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(7, 0); ctx.lineTo(-4, 3.2); ctx.lineTo(-6, 0); ctx.lineTo(-4, -3.2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff5252';
      ctx.beginPath(); ctx.arc(3.5, 0, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  _drawParticle(ctx, pt) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.max);
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  _drawFloaters(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 400));
      const fs = 15 * (f.scale || 1);
      ctx.font = `bold ${fs}px system-ui, sans-serif`;
      ctx.fillStyle = f.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  _drawHint(ctx) {
    const txt = this.level === 0
      ? '方向键 / WASD 移动 · 空格 / J 开火 · E 发射追踪导弹 · 先打碎前方的 GZH 砖墙练练手！'
      : '方向键 / WASD 移动 · 空格 / J 开火 · E 发射追踪导弹 · 拾取道具变强';
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.hintTimer / 1000);
    ctx.fillStyle = 'rgba(35,68,68,0.85)';
    ctx.font = '15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(txt, this.W / 2, this.H - 16);
    ctx.restore();
  }
}
