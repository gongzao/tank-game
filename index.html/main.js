/* =========================================================
 * main.js — 画布适配(DPR)、UI 绑定、主循环
 * ========================================================= */

let game;
const canvas = document.getElementById('game');

/* 根据设备像素比设置画布内部分辨率，保证高清且坐标仍是逻辑像素 */
function ctxSetup() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CONFIG.COLS * CONFIG.TILE * dpr;
  canvas.height = CONFIG.ROWS * CONFIG.TILE * dpr;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

/* 自适应画布尺寸：
 *  - 桌面端：画布填满 game-wrap（由 CSS 维持 27:19 比例）
 *  - 触屏端：game-wrap 铺满全屏，画布取“能放下的最大 27:19 矩形”居中，不拉伸变形 */
function fitGame() {
  if (!document.body.classList.contains('touch')) { ctxSetup(); return; }
  const wrap = document.getElementById('game-wrap');
  const hud = document.getElementById('hud');
  const tip = document.getElementById('tipbar');
  const top = (hud ? hud.offsetHeight : 0) + (tip ? tip.offsetHeight : 0);
  wrap.style.paddingTop = top + 'px';
  const availW = wrap.clientWidth;
  const availH = Math.max(1, wrap.clientHeight - top);
  const ar = CONFIG.COLS / CONFIG.ROWS;
  let w = availW, h = w / ar;
  if (h > availH) { h = availH; w = h * ar; }
  ctxSetup();
  const c = document.getElementById('game');
  if (w > 0 && h > 0) {
    c.style.width = Math.floor(w) + 'px';
    c.style.height = Math.floor(h) + 'px';
  }
}

function hideOverlay() {
  document.getElementById('overlay').className = '';
}
function showOverlay(kind, score, reason) {
  const o = document.getElementById('overlay');
  const lvBtns = () => CONFIG.LEVELS.map((cfg, i) =>
    `<button class="ghost lv-btn${cfg.boss ? ' boss' : ''}" data-level="${i}">${cfg.boss ? '👑 ' : ''}${cfg.name}</button>`
  ).join('');
  if (kind === 'pause') {
    o.className = 'show';
    o.innerHTML = `<div class="panel">
      <h1>已暂停</h1>
      <div class="btn-row">
        <button class="primary" id="resume-btn">继续</button>
        <button class="ghost" id="restart-btn2">重玩本关</button>
      </div>
      <div class="btn-row"><button class="ghost" id="help-btn2">玩法说明</button></div>
      <p class="sub" style="margin:12px 0 6px">— 选关跳转（保留当前得分）—</p>
      <div class="level-select" id="pause-levels">${lvBtns()}</div>
    </div>`;
    document.getElementById('resume-btn').onclick = () => game.togglePause();
    document.getElementById('restart-btn2').onclick = () => game.retryLevel();
    document.getElementById('help-btn2').onclick = () => game.openHelp();
    o.querySelectorAll('#pause-levels .lv-btn').forEach(btn => {
      btn.onclick = () => { game.togglePause(); game.jumpToLevel(parseInt(btn.dataset.level, 10)); };
    });
  } else if (kind === 'bossunlock') {
    o.className = 'show';
    o.innerHTML = `<div class="panel">
      <h1 class="win">👑 钢铁巨兽击败！</h1>
      <p class="sub">你已首次通关 BOSS 战，进阶版已解锁</p>
      <p class="score">当前得分 ${score}</p>
      <div class="how" style="text-align:left">
        <div class="how-row"><b>进阶版</b> 玩家生命强制 <b>3</b>，BOSS 血量更高（${CONFIG.LEVELS[CONFIG.LEVELS.length - 1].boss.advancedHp}），敢挑战吗？</div>
      </div>
      <div class="btn-row">
        <button class="primary" id="advtry-btn">🔥 挑战进阶版</button>
        <button class="ghost" id="advno-btn">⬅ 普通版再战</button>
      </div>
      <div class="btn-row"><button class="ghost" id="advhome-btn">🏠 返回开始</button></div>
    </div>`;
    document.getElementById('advtry-btn').onclick = () => { game.setBossAdvanced(true); game.retryLevel(); };
    document.getElementById('advno-btn').onclick = () => { game.setBossAdvanced(false); game.retryLevel(); };
    document.getElementById('advhome-btn').onclick = () => game.start();
  } else if (kind === 'levelclear') {
    const cur = CONFIG.LEVELS[game.level];
    const nxt = CONFIG.LEVELS[game.level + 1];
    o.className = 'show';
    o.innerHTML = `<div class="panel">
      <h1 class="win">${cur.name} 完成！</h1>
      <p>当前得分 <b>${game.score}</b> · 剩余生命 ${'♥'.repeat(Math.max(0, game.lives))}</p>
      <p class="sub">${nxt.boss ? '⚠ 下一关：最终 BOSS 战 —— 钢铁巨兽登场，做好苦战准备！' : `下一关：${nxt.name}（敌人更多更快）`}</p>
      <button class="primary" id="next-btn">${nxt.boss ? '挑战 BOSS ▶' : `进入 ${nxt.name} ▶`}</button>
    </div>`;
    document.getElementById('next-btn').onclick = () => game.nextLevel();
  } else if (kind === 'win') {
    const isBossLast = CONFIG.LEVELS[game.level] && CONFIG.LEVELS[game.level].boss;
    o.className = 'show';
    const advNote = isBossLast && game.bossClearedOnce
      ? `<p class="sub">${game.bossAdvanced ? '🔥 当前为进阶模式（3 命 / BOSS 更强）' : '普通模式：8 命厚血，可继续刷分'}</p>` : '';
    const advBtn = isBossLast && game.bossClearedOnce
      ? (game.bossAdvanced
        ? '<button class="ghost" id="bossnormal-btn" style="margin-bottom:10px">⬅ 切回普通 BOSS（8 命）</button><br>'
        : '<button class="ghost" id="bossadv-btn" style="margin-bottom:10px">🔥 进阶 BOSS（3 命 / 更难）</button><br>')
      : '';
    o.innerHTML = `<div class="panel">
      <h1 class="win">🎉 全部通关！</h1>
      <p>你消灭了所有关卡的敌方坦克</p>
      <p class="score">最终得分 ${score}</p>
      ${advNote}
      ${advBtn}
      ${isBossLast ? '<button class="ghost" id="replayboss-btn" style="margin-bottom:10px">🔁 再战 BOSS</button><br>' : ''}
      <button class="primary" id="again-btn">再玩一次</button></div>`;
    if (isBossLast) {
      if (document.getElementById('bossadv-btn')) document.getElementById('bossadv-btn').onclick = () => { game.setBossAdvanced(true); game.retryLevel(); };
      if (document.getElementById('bossnormal-btn')) document.getElementById('bossnormal-btn').onclick = () => { game.setBossAdvanced(false); game.retryLevel(); };
      document.getElementById('replayboss-btn').onclick = () => game.retryLevel();
    }
    document.getElementById('again-btn').onclick = () => game.start();
  } else if (kind === 'lose') {
    o.className = 'show';
    const reasonTxt = reason === 'base'
      ? '你的基地（鹰旗）被敌人摧毁了'
      : `你在 <b>${game.levelCfg.name}</b> 的坦克被击毁了`;
    o.innerHTML = `<div class="panel">
      <h1 class="lose">💥 失败</h1>
      <p>${reasonTxt}</p>
      <p class="score">得分 ${score}</p>
      <div class="btn-row">
        <button class="primary" id="retry-btn">重试本关</button>
        <button class="ghost" id="home-btn">回到第一关</button>
      </div>
    </div>`;
    document.getElementById('retry-btn').onclick = () => game.retryLevel();
    document.getElementById('home-btn').onclick = () => game.start();
  }
}

/* 关卡开场过场卡 */
function showLevelIntro(level) {
  const cfg = CONFIG.LEVELS[level];
  const o = document.getElementById('overlay');
  const goal = cfg.boss
    ? '击败顶部的 <b>钢铁巨兽 BOSS</b>！血量降至 65% / 35% 触发暴怒与狂暴，会扇形射击、环形弹幕并召唤援军，小心被碾压'
    : `消灭 ${cfg.enemies} 辆敌方坦克，并守住底部基地（鹰旗）`;
  const unlockHint = cfg.boss && !game.bossClearedOnce
    ? '<div class="how-row"><b>解锁</b> 首次击败钢铁巨兽后，开启 <b>进阶版 BOSS</b>（3 命 / BOSS 更强）</div>'
    : '';
  const modeHint = cfg.boss && game.bossClearedOnce
    ? `<div class="how-row"><b>模式</b> ${game.bossAdvanced ? '🔥 进阶模式：3 命，BOSS 血量 45' : '普通模式：8 命厚血，BOSS 血量 28'}</div>`
    : '';
  o.className = 'show';
  o.innerHTML = `<div class="panel">
    <h1>${cfg.name}</h1>
    <p class="sub">第 ${level + 1} / ${CONFIG.LEVELS.length} 关</p>
    <div class="how">
      <div class="how-row"><b>目标</b> ${goal}</div>
      <div class="how-row"><b>提示</b> ${LEVEL_TIPS[level] || ''}</div>
      ${unlockHint}
      ${modeHint}
    </div>
    <button class="primary" id="go-btn">${cfg.boss ? '⚔ 迎战 BOSS' : '出发 ▶'}</button>
  </div>`;
  document.getElementById('go-btn').onclick = () => game.beginPlay();
}

/* 道具图例 HTML（强化引导：让玩家知道每个道具的作用） */
function legendHTML() {
  const items = Object.values(POWERUPS).map(p => {
    const col = CONFIG.COLORS[p.color];
    return `<div class="legend-item">
      <span class="legend-icon" style="background:${col}">${p.icon}</span>
      <span class="legend-text"><b>${p.name}</b><i>${p.effect}</i></span>
    </div>`;
  }).join('');
  return `<div class="legend">${items}</div>`;
}

/* 玩法说明（帮助）面板 */
function showHelp() {
  const o = document.getElementById('overlay');
  o.className = 'show';
  o.innerHTML = `<div class="panel">
    <h1>玩法说明</h1>
    ${legendHTML()}
      <div class="how">
        <div class="how-row"><b>电脑</b> 方向键 / WASD 移动 · 空格 / J 开火 · E 发射追踪导弹</div>
        <div class="how-row"><b>手机</b> 左侧拖动移动 · 右侧按住开火 · 右下角「导弹」键放技能</div>
        <div class="how-row"><b>技能</b> 击杀/命中敌人、拆砖都会充能，坦克外圈金环满格即发射 5 枚追踪导弹，自动锁定敌人</div>
        <div class="how-row"><b>目标</b> 逐关消灭全部敌方坦克，打碎中央 GZH 砖墙，守住底部基地（鹰旗）</div>
      </div>
    <button class="primary" id="help-close">${game._helpReturn === 'playing' ? '继续 ▶' : '知道了'}</button>
  </div>`;
  document.getElementById('help-close').onclick = () => game.closeHelp();
}

function showStart() {
  const o = document.getElementById('overlay');
  o.className = 'show';
  const lvBtns = CONFIG.LEVELS.map((cfg, i) => {
    const isBoss = !!cfg.boss;
    const adv = isBoss && game.bossAdvanced;
    const advLabel = isBoss && game.bossClearedOnce ? (adv ? '·进阶' : '·普通') : '';
    return `<button class="ghost lv-btn${isBoss ? ' boss' : ''}${adv ? ' adv' : ''}" data-level="${i}">${isBoss ? '👑 ' : ''}${cfg.name}${advLabel}</button>`;
  }).join('');
  o.innerHTML = `
    <div class="panel">
      <h1>坦克大战</h1>
      <p class="sub">Tank Battle · 共 ${CONFIG.LEVELS.length} 关，逐关变难</p>
      <div class="how">
        <div class="how-row"><b>电脑</b> 方向键 / WASD 移动 · 空格 / J 开火 · E 发射追踪导弹</div>
        <div class="how-row"><b>手机</b> 左侧拖动移动 · 右侧按住开火 · 右下角「导弹」键放技能</div>
        <div class="how-row"><b>技能</b> 击杀/命中敌人、拆砖都会充能，坦克外圈金环满格即发射 5 枚追踪导弹，自动锁定敌人</div>
        <div class="how-row"><b>目标</b> 消灭全部 ${CONFIG.LEVELS[0].enemies} 辆敌方坦克，守住底部基地（鹰旗）</div>
      </div>
      ${legendHTML()}
      <div class="btn-row">
        <button class="primary" id="start-btn">开始游戏</button>
      </div>
      ${game.bossClearedOnce ? '<div class="unlock-banner">🔥 BOSS 进阶版已解锁！选关界面可切换普通/进阶</div>' : ''}
      <p class="sub" style="margin:10px 0 6px">— 或直接选关挑战（得分从 0 开始）—</p>
      <div class="level-select">${lvBtns}</div>
    </div>`;
  document.getElementById('start-btn').onclick = () => game.start();
  o.querySelectorAll('.lv-btn').forEach(btn => {
    btn.onclick = () => game.startAtLevel(parseInt(btn.dataset.level, 10));
  });
  // 开始界面隐藏 HUD 与提示条（进入关卡后由 _syncHud 显示）
  const hud = document.getElementById('hud');
  const tip = document.getElementById('tipbar');
  if (hud) hud.style.visibility = 'hidden';
  if (tip) tip.style.visibility = 'hidden';
}

let last = 0;
function loop(ts) {
  const dt = last ? ts - last : 16;
  last = ts;
  game.update(dt);
  game.render();
  requestAnimationFrame(loop);
}

/* 全局错误捕获：若运行时抛出异常，立刻把报错显示到覆盖层，方便定位 */
window.onerror = function (msg, url, line, col, err) {
  console.error('[FATAL]', msg, 'at', url, line, col, err);
  try {
    const o = document.getElementById('overlay');
    if (o) {
      o.className = 'show';
      o.innerHTML = `<div class="panel" style="border-left:4px solid #e0573e">
        <h1 class="lose">⚠ 加载异常</h1>
        <p style="font-family:monospace;white-space:pre-wrap;word-break:break-all;font-size:12px;color:#ffe0d6;background:rgba(0,0,0,.35);padding:10px;border-radius:6px;">${msg}\nLine ${line}:${col}\n${err ? err.stack : ''}</p>
        <p class="sub">请把上面文字复制给我，或按 F12 → Console 查看完整报错。</p>
        <button class="primary" onclick="location.reload(true)">刷新重试</button>
      </div>`;
    }
  } catch (_) {}
  return false;
};

window.addEventListener('load', () => {
  // 1. 先检测触屏设备并打上 body.touch，后续 fitGame / Input 都依赖这个类
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
  if (isTouch) document.body.classList.add('touch');

  // 阻止 iOS 双击缩放：在 300ms 内连续两次 touchend 且发生在交互控件上时取消默认行为
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = performance.now();
    if (now - lastTouchEnd < 300) {
      // 只在游戏相关交互元素上阻止，避免影响输入框等正常控件
      if (e.target.closest('#game-wrap, #touch-controls, #hud, button, .panel, .btn-row')) {
        e.preventDefault();
      }
    }
    lastTouchEnd = now;
  }, { passive: false });

  fitGame();
  game = new Game(canvas);
  window.game = game; // 方便调试时通过浏览器控制台访问
  Input.init();
  showStart();
  document.getElementById('pause-btn').onclick = () => game.togglePause();
  document.getElementById('help-btn').onclick = () => game.openHelp();
  document.getElementById('mute-btn').onclick = () => {
    const on = Sound.toggleMute();
    document.getElementById('mute-btn').textContent = on ? '🔊' : '🔇';
  };
  // 根据设备设置常驻操作提示文案
  const tip = document.getElementById('tipbar');
  if (tip) {
    tip.textContent = document.body.classList.contains('touch')
      ? '🕹 左侧拖动移动 · 右侧按住开火 · 右下角导弹键放技能 · 拾道具变强'
      : '⌨ 方向键 / WASD 移动 · 空格 / J 开火 · E 导弹 · 拾道具变强';
  }
  window.addEventListener('resize', fitGame);
  window.addEventListener('orientationchange', () => setTimeout(fitGame, 200));
  requestAnimationFrame(loop);
});
