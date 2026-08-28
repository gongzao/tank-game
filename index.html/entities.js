/* =========================================================
 * entities.js — 坦克 / 炮弹 / 粒子 与碰撞辅助函数
 * ========================================================= */

/* 地图版本号：任何瓦片被破坏时 +1，渲染层据此重建离屏地形缓存 */
var MAP_VERSION = 0;

/* 轴对齐包围盒碰撞 */
function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/* 瓦片是否为实体(砖/钢/GZH金砖/基地) */
function isSolidTile(map, c, r) {
  if (r < 0 || c < 0 || r >= CONFIG.ROWS || c >= CONFIG.COLS) return true; // 界外视为墙
  const t = map[r][c];
  return t === 1 || t === 2 || t === 3 || t === 4;
}

/* 取某点所在瓦片类型(界外视为钢) */
function tileAt(map, x, y) {
  const c = Math.floor(x / CONFIG.TILE), r = Math.floor(y / CONFIG.TILE);
  if (r < 0 || c < 0 || r >= CONFIG.ROWS || c >= CONFIG.COLS) return 2;
  return map[r][c];
}

/* 坦克是否撞到地图实体 */
function tankHitsMap(tank, map) {
  const s = tank.size, T = CONFIG.TILE;
  const c1 = Math.floor(tank.x / T), c2 = Math.floor((tank.x + s - 1) / T);
  const r1 = Math.floor(tank.y / T), r2 = Math.floor((tank.y + s - 1) / T);
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++)
      if (isSolidTile(map, c, r)) return true;
  return false;
}

/* 坦克是否撞到其他坦克 */
function tankHitsTank(tank, others) {
  for (const o of others) {
    if (o === tank || !o.alive) continue;
    if (aabb(tank.x, tank.y, tank.size, tank.size, o.x, o.y, o.size, o.size)) return true;
  }
  return false;
}

class Tank {
  constructor(col, row, type) {
    this.size = CONFIG.TILE - 6;
    this.x = col * CONFIG.TILE + (CONFIG.TILE - this.size) / 2;
    this.y = row * CONFIG.TILE + (CONFIG.TILE - this.size) / 2;
    this.type = type;                 // 'player' | 'enemy'
    this.variant = type === 'enemy' ? 'normal' : 'player'; // 敌方可为 'fast' / 'armor'
    this.dir = { x: 0, y: -1 };       // 朝向(单位向量)
    this.speed = type === 'player' ? CONFIG.PLAYER_SPEED : 1.6; // 敌方速度由关卡配置在生成时覆盖
    this.vx = 0; this.vy = 0;         // 速度(带加速度，更丝滑)
    this.cooldown = 0;
    this.rapid = 0;                   // 极速道具剩余时间(ms)
    this.spread = 0;                  // 散射道具剩余时间(ms)
    this.alive = true;
    this.aiTimer = 0;
    this.aiDir = { x: 0, y: -1 };
    this.spawnProtect = type === 'player' ? 1500 : 0; // 出生/护盾无敌(ms)
    this.tread = 0;                   // 履带滚动相位
    this.recoil = 0;                  // 开火后坐力(视觉)
    this.hitFlash = 0;                // 受击白闪
    this.maxHp = 1; this.hp = 1;      // 装甲敌方为 2
  }

  /* dx,dy 已是含速度与时长因子的“期望位移”；用加速度逼近，手感更顺滑 */
  tryMove(dx, dy, map, others) {
    const accel = this.type === 'player' ? CONFIG.PLAYER_ACCEL : CONFIG.ENEMY_ACCEL;
    this.vx += (dx - this.vx) * accel;
    this.vy += (dy - this.vy) * accel;
    const movedX = this._axisMove(this.vx, 0, map, others);
    if (!movedX) this.vx = 0;
    const movedY = this._axisMove(0, this.vy, map, others);
    if (!movedY) this.vy = 0;
    if (Math.abs(this.vx) > 0.05 || Math.abs(this.vy) > 0.05) {
      if (Math.abs(this.vx) >= Math.abs(this.vy)) this.dir = { x: Math.sign(this.vx), y: 0 };
      else this.dir = { x: 0, y: Math.sign(this.vy) };
    }
    this.tread += Math.abs(this.vx) + Math.abs(this.vy);
  }
  _axisMove(dx, dy, map, others) {
    const ox = this.x, oy = this.y;
    if (dx > 0) { this.x += dx; if (tankHitsMap(this, map) || tankHitsTank(this, others)) { this.x = ox; return false; } return true; }
    if (dx < 0) { this.x += dx; if (tankHitsMap(this, map) || tankHitsTank(this, others)) { this.x = ox; return false; } return true; }
    if (dy > 0) { this.y += dy; if (tankHitsMap(this, map) || tankHitsTank(this, others)) { this.y = oy; return false; } return true; }
    if (dy < 0) { this.y += dy; if (tankHitsMap(this, map) || tankHitsTank(this, others)) { this.y = oy; return false; } return true; }
    return true;
  }

  /* 炮口位置 */
  barrelTip() {
    const cx = this.x + this.size / 2, cy = this.y + this.size / 2;
    const len = this.size / 2 + 4;
    return { x: cx + this.dir.x * len, y: cy + this.dir.y * len, cx, cy };
  }

  /* 受到伤害，返回是否死亡 */
  hit(dmg) {
    this.hp -= dmg;
    this.hitFlash = 160;
    if (this.hp <= 0) { this.alive = false; return true; }
    return false;
  }

  update(dt) {
    if (this.spawnProtect > 0) this.spawnProtect -= dt;
    if (this.rapid > 0) this.rapid -= dt;
    if (this.spread > 0) this.spread -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.recoil *= 0.82;
    if (this.recoil < 0.05) this.recoil = 0;
  }
}

class Bullet {
  constructor(x, y, dir, owner) {
    this.x = x; this.y = y;
    this.dir = dir;          // {x,y} 单位向量
    this.owner = owner;      // 'player' | 'enemy'
    this.speed = CONFIG.BULLET_SPEED;
    this.size = 6;
    this.alive = true;
  }

  /* 返回碰撞事件: {type:'brick'|'steel'|'tank'|'out', tank?} 或 null（不改 tank.alive，交给上层处理护甲） */
  update(step, map, tanks) {
    this.x += this.dir.x * this.speed * step;
    this.y += this.dir.y * this.speed * step;
    const W = CONFIG.COLS * CONFIG.TILE, H = CONFIG.ROWS * CONFIG.TILE;
    if (this.x < 0 || this.y < 0 || this.x > W || this.y > H) { this.alive = false; return { type: 'out' }; }

    const t = tileAt(map, this.x, this.y);
    if (t === 1 || t === 3) { // 普通砖 / GZH金砖 均可破坏
      const c = Math.floor(this.x / CONFIG.TILE), r = Math.floor(this.y / CONFIG.TILE);
      if (r >= 0 && c >= 0 && r < CONFIG.ROWS && c < CONFIG.COLS) map[r][c] = 0;
      MAP_VERSION++; // 地图变化，通知渲染层重建缓存
      this.alive = false; return { type: 'brick' };
    }
    if (t === 2) { this.alive = false; return { type: 'steel' }; }
    if (t === 4) { // 基地(鹰旗)
      this.alive = false;
      // 敌方子弹摧毁基地；玩家子弹被堡垒挡下，不会误毁己方基地
      return this.owner === 'enemy' ? { type: 'eagle' } : { type: 'steel' };
    }

    for (const tk of tanks) {
      if (!tk.alive || tk.type === this.owner) continue; // 不误伤同类
      if (aabb(this.x - 3, this.y - 3, 6, 6, tk.x, tk.y, tk.size, tk.size)) {
        this.alive = false; return { type: 'tank', tank: tk };
      }
    }
    return null;
  }
}

/* 追踪导弹：朝最近敌人转向飞行；碰撞与特效由 game 层处理 */
class Missile {
  constructor(x, y, dir) {
    this.x = x; this.y = y;
    this.dir = { x: dir.x, y: dir.y };  // 单位向量
    this.speed = CONFIG.SKILL.missileSpeed;
    this.life = CONFIG.SKILL.missileLife; // ms
    this.size = 7;
    this.alive = true;
    this.smoke = 0; // 尾烟节流计时
  }
}

class Particle {  constructor(x, y, color, vx, vy, life, size) {
    this.x = x; this.y = y; this.color = color;
    this.vx = vx; this.vy = vy;
    this.life = life; this.max = life; this.size = size; this.alive = true;
  }
  update(step) {
    this.x += this.vx * step; this.y += this.vy * step;
    this.vy += 0.05 * step;
    this.life -= step;
    if (this.life <= 0) this.alive = false;
  }
}
