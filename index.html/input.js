/* =========================================================
 * input.js — 键盘 + 触屏输入，统一暴露 Input.dir / Input.fire / Input.skill
 *   Input.dir : {x, y} 取值范围约 [-1,1]，由引擎判定主方向(四向)
 *   Input.fire: 布尔，是否开火（按住连续开火）
 *   Input.skill: 一次性触发，由引擎消费后清零
 * ========================================================= */
const Input = {
  dir: { x: 0, y: 0 },
  fire: false,
  skill: false,       // 主动技能(追踪导弹)：一次性触发，由引擎消费后清零
  _order: [],        // 当前按下的方向键顺序(最后按下者优先)
  _joyActive: false, // 桌面端固定摇杆是否激活
  _touch: false,     // 是否触屏模式

  init() {
    const map = {
      ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right'
    };
    window.addEventListener('keydown', (e) => {
      if (map[e.code]) { e.preventDefault(); this._press(map[e.code]); }
      if (e.code === 'Space' || e.code === 'KeyJ') { e.preventDefault(); this.fire = true; }
      if (e.code === 'KeyE') { e.preventDefault(); this.skill = true; }
    });
    window.addEventListener('keyup', (e) => {
      if (map[e.code]) this._release(map[e.code]);
      if (e.code === 'Space' || e.code === 'KeyJ') this.fire = false;
    });

    this._touch = document.body.classList.contains('touch');
    if (this._touch) {
      this._initTouch();
    } else {
      this._initJoystick();
      this._initFireBtn();
      this._initSkillBtn();
    }
  },

  /* ---------------- 键盘 ---------------- */
  _press(d) {
    if (!this._order.includes(d)) this._order.push(d);
    this._calc();
  },
  _release(d) {
    this._order = this._order.filter(x => x !== d);
    this._calc();
  },
  _calc() {
    if (this._joyActive || this._touch) return; // 摇杆/触屏优先
    const d = this._order[this._order.length - 1];
    this.dir = {
      up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
      left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
    }[d] || { x: 0, y: 0 };
  },

  /* ---------------- 桌面端固定摇杆 ---------------- */
  _initJoystick() {
    const base = document.getElementById('joystick');
    const knob = document.getElementById('joy-knob');
    if (!base) return;
    const R = 50;
    let cx = 0, cy = 0, pid = null;

    const setFrom = (clientX, clientY) => {
      let dx = clientX - cx, dy = clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.dir = { x: dx / R, y: dy / R };
    };
    const start = (e) => {
      const rect = base.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
      pid = e.pointerId; this._joyActive = true;
      if (base.setPointerCapture) { try { base.setPointerCapture(e.pointerId); } catch (_) {} }
      setFrom(e.clientX, e.clientY);
      e.preventDefault();
    };
    const move = (e) => {
      if (!this._joyActive || e.pointerId !== pid) return;
      setFrom(e.clientX, e.clientY);
      e.preventDefault();
    };
    const end = (e) => {
      if (pid !== null && e.pointerId !== pid) return;
      this._joyActive = false; pid = null;
      knob.style.transform = 'translate(0,0)';
      this.dir = { x: 0, y: 0 };
    };
    base.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  },

  _initFireBtn() {
    const b = document.getElementById('fire-btn');
    if (!b) return;
    const on = (e) => { this.fire = true; e.preventDefault(); };
    const off = () => { this.fire = false; };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  },

  _initSkillBtn() {
    const b = document.getElementById('skill-btn');
    if (!b) return;
    const on = (e) => { this.skill = true; e.preventDefault(); };
    b.addEventListener('pointerdown', on);
  },

  /* ---------------- 触屏：左侧拖动移动 + 右侧按住开火 ---------------- */
  _initTouch() {
    const joy = document.getElementById('joystick');
    const knob = document.getElementById('joy-knob');
    const fireZone = document.getElementById('fire-zone');
    const skillBtn = document.getElementById('skill-btn');
    const R = 56;                 // 摇杆最大偏移半径
    let movePid = null, mx = 0, my = 0;

    const startMove = (e) => {
      movePid = e.pointerId; mx = e.clientX; my = e.clientY;
      const jw = joy.offsetWidth || 150;
      let jx = e.clientX - jw / 2, jy = e.clientY - jw / 2;
      // 限制在屏幕内，避免摇杆被裁切
      jx = Math.max(4, Math.min(window.innerWidth - jw - 4, jx));
      jy = Math.max(4, Math.min(window.innerHeight - jw - 4, jy));
      joy.style.left = jx + 'px'; joy.style.top = jy + 'px';
      joy.style.display = 'block';
      knob.style.transform = 'translate(0,0)';
      this.dir = { x: 0, y: 0 };
      e.preventDefault();
    };
    const moveMove = (e) => {
      if (e.pointerId !== movePid) return;
      let dx = e.clientX - mx, dy = e.clientY - my;
      const len = Math.hypot(dx, dy) || 1;
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.dir = { x: dx / R, y: dy / R };
      e.preventDefault();
    };
    const endMove = (e) => {
      if (e.pointerId !== movePid) return;
      movePid = null;
      joy.style.display = 'none';
      knob.style.transform = 'translate(0,0)';
      this.dir = { x: 0, y: 0 };
    };

    // 全局监听：左半屏启动浮动摇杆（多点触控可同时开火）
    window.addEventListener('pointerdown', (e) => {
      // 排除 UI 元素（按钮 / HUD / 覆盖层 / 开火区 / 技能键）
      if (e.target.closest('#fire-zone, #skill-btn, #hud, #overlay, button, a')) return;
      if (movePid !== null) return;                 // 已有移动指针
      if (e.clientX < window.innerWidth * 0.58) startMove(e);
    }, { passive: false });
    window.addEventListener('pointermove', moveMove, { passive: false });
    window.addEventListener('pointerup', endMove);
    window.addEventListener('pointercancel', endMove);

    // 右侧开火区：按住连续开火（指针捕获，避免手指移出后误关火）
    const fireOn = (e) => {
      this.fire = true; e.preventDefault(); e.stopPropagation();
      if (fireZone.setPointerCapture) { try { fireZone.setPointerCapture(e.pointerId); } catch (_) {} }
    };
    const fireOff = () => { this.fire = false; };
    if (fireZone) {
      fireZone.addEventListener('pointerdown', fireOn);
      fireZone.addEventListener('pointerup', fireOff);
      fireZone.addEventListener('pointercancel', fireOff);
    }

    // 导弹技能键（右上角，阻止冒泡以免误触开火）
    if (skillBtn) {
      skillBtn.addEventListener('pointerdown', (e) => {
        this.skill = true; e.preventDefault(); e.stopPropagation();
      });
    }
  }
};
