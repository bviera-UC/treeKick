import { useState, useRef, useEffect, useCallback } from "react";

const W = 700, H = 500;
const GOAL_W = 330, GOAL_H = 132;
const GOAL_X = (W - GOAL_W) / 2, GOAL_Y = 140;
const POST_W = 10, NET_DEPTH = 24;
const GK_W = 72, GK_H = 95;
const BALL_R = 13;
const FIELD_Y = GOAL_Y + GOAL_H;
const MAX_SHOTS = 3;
const MOUSE_IDLE_MS = 120;

// ── Storage helpers (persistent DB) ──
const DB_KEY = "penalty-kick-db";

async function loadDB() {
  try {
    const r = await window.storage.get(DB_KEY);
    return r ? JSON.parse(r.value) : { matches: [], stats: { totalGoals: 0, totalSaves: 0, totalMisses: 0, totalMatches: 0 } };
  } catch { return { matches: [], stats: { totalGoals: 0, totalSaves: 0, totalMisses: 0, totalMatches: 0 } }; }
}

async function saveDB(db) {
  try { await window.storage.set(DB_KEY, JSON.stringify(db)); } catch (e) { console.error("DB save error", e); }
}

// ── Component ──
export default function PenaltyKick() {
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState("aiming");
  const [score, setScore] = useState({ goals: 0, saves: 0, misses: 0 });
  const [history, setHistory] = useState([]);
  const [resultText, setResultText] = useState("");
  const [difficulty, setDifficulty] = useState("normal");
  const [db, setDb] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [dbLoading, setDbLoading] = useState(true);
  const [formData, setFormData] = useState({ name: "", phone: "", email: "" });
  const [formError, setFormError] = useState("");

  const gkRef = useRef({ x: GOAL_X + GOAL_W / 2 - GK_W / 2, vx: 0, randomTarget: GOAL_X + GOAL_W / 2, fallUntil: 0 });
  const mouseRef = useRef({ x: W / 2, y: GOAL_Y + GOAL_H / 2, lastMoveTime: Date.now() });
  const ballRef = useRef({ x: W / 2, y: H - 60, targetX: 0, targetY: 0, t: 0 });
  const phaseRef = useRef("aiming");
  const diffRef = useRef("normal");
  const animRef = useRef(null);

  const DIFF = {
    easy:   { reaction: 0.027, maxSpeed: 2.25, jitter: 40, randSpeed: 2.8, fallChance: 0.006, fallDuration: 500 },
    normal: { reaction: 0.063, maxSpeed: 4.05, jitter: 20, randSpeed: 3.8, fallChance: 0.004, fallDuration: 400 },
    hard:   { reaction: 0.126, maxSpeed: 6.3,  jitter: 8,  randSpeed: 5.0, fallChance: 0.002, fallDuration: 350 },
  };

  // Load DB on mount
  useEffect(() => { loadDB().then(d => { setDb(d); setDbLoading(false); }); }, []);

  // ── Drawing functions ──
  const drawField = useCallback((ctx) => {
    const sky = ctx.createLinearGradient(0, 0, 0, FIELD_Y);
    sky.addColorStop(0, "#0f1528"); sky.addColorStop(0.6, "#1a2444"); sky.addColorStop(1, "#1e3a2a");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, FIELD_Y);

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    [23,67,120,198,310,405,510,590,650,45,280,470,155,380,530].forEach((sx, i) => {
      ctx.beginPath(); ctx.arc(sx, 15 + (i * 17) % 80, 0.8 + (i % 3) * 0.4, 0, Math.PI * 2); ctx.fill();
    });

    ctx.fillStyle = "rgba(255,240,200,0.03)";
    ctx.beginPath(); ctx.arc(80, 0, 160, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W - 80, 0, 160, 0, Math.PI * 2); ctx.fill();

    const grass = ctx.createLinearGradient(0, FIELD_Y, 0, H);
    grass.addColorStop(0, "#2d8a4e"); grass.addColorStop(0.3, "#28784a"); grass.addColorStop(1, "#1a5030");
    ctx.fillStyle = grass; ctx.fillRect(0, FIELD_Y, W, H - FIELD_Y);

    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let i = 0; i < 10; i += 2) ctx.fillRect(0, FIELD_Y + i * 24, W, 24);

    const aw = GOAL_W + 100, ax = (W - aw) / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ax, FIELD_Y); ctx.lineTo(ax, FIELD_Y + 80); ctx.lineTo(ax + aw, FIELD_Y + 80); ctx.lineTo(ax + aw, FIELD_Y); ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath(); ctx.arc(W / 2, H - 60, 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "rgba(200,200,220,0.06)";
    ctx.fillRect(GOAL_X + POST_W, GOAL_Y - NET_DEPTH, GOAL_W - POST_W * 2, NET_DEPTH + GOAL_H);
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 0.5;
    for (let x = GOAL_X + POST_W; x < GOAL_X + GOAL_W - POST_W; x += 16) { ctx.beginPath(); ctx.moveTo(x, GOAL_Y - NET_DEPTH); ctx.lineTo(x, GOAL_Y + GOAL_H); ctx.stroke(); }
    for (let y = GOAL_Y - NET_DEPTH; y < GOAL_Y + GOAL_H; y += 16) { ctx.beginPath(); ctx.moveTo(GOAL_X + POST_W, y); ctx.lineTo(GOAL_X + GOAL_W - POST_W, y); ctx.stroke(); }

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(GOAL_X + 3, GOAL_Y + GOAL_H + 1, POST_W, 5);
    ctx.fillRect(GOAL_X + GOAL_W - POST_W + 3, GOAL_Y + GOAL_H + 1, POST_W, 5);

    let pg = ctx.createLinearGradient(GOAL_X, 0, GOAL_X + POST_W, 0);
    pg.addColorStop(0, "#d0d0d0"); pg.addColorStop(0.3, "#fff"); pg.addColorStop(1, "#b0b0b0");
    ctx.fillStyle = pg; ctx.fillRect(GOAL_X, GOAL_Y, POST_W, GOAL_H);
    pg = ctx.createLinearGradient(GOAL_X + GOAL_W - POST_W, 0, GOAL_X + GOAL_W, 0);
    pg.addColorStop(0, "#b0b0b0"); pg.addColorStop(0.7, "#fff"); pg.addColorStop(1, "#d0d0d0");
    ctx.fillStyle = pg; ctx.fillRect(GOAL_X + GOAL_W - POST_W, GOAL_Y, POST_W, GOAL_H);

    const bg = ctx.createLinearGradient(0, GOAL_Y, 0, GOAL_Y + POST_W);
    bg.addColorStop(0, "#fff"); bg.addColorStop(1, "#c0c0c0");
    ctx.fillStyle = bg; ctx.fillRect(GOAL_X, GOAL_Y, GOAL_W, POST_W);

    ctx.fillStyle = "#e0e0e0";
    ctx.beginPath(); ctx.arc(GOAL_X + POST_W / 2, GOAL_Y, POST_W / 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(GOAL_X + GOAL_W - POST_W / 2, GOAL_Y, POST_W / 2, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(GOAL_X - 40, FIELD_Y); ctx.lineTo(GOAL_X + GOAL_W + 40, FIELD_Y); ctx.stroke();
  }, []);

  const drawGK = useCallback((ctx, isIdle, falling) => {
    const gk = gkRef.current;
    const cx = gk.x + GK_W / 2, cy = GOAL_Y + GOAL_H - GK_H + 8;

    ctx.save();
    if (falling) {
      // Rotate GK sideways to simulate a fall
      ctx.translate(cx, FIELD_Y - 5);
      ctx.rotate(Math.PI / 2.5);
      ctx.translate(-cx, -(FIELD_Y - 5));
      ctx.globalAlpha = 0.7;
    }

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(cx, FIELD_Y - 1, 30, 7, 0, 0, Math.PI * 2); ctx.fill();

    const jg = ctx.createLinearGradient(cx - 20, cy + 25, cx + 20, cy + 65);
    jg.addColorStop(0, "#ff7b00"); jg.addColorStop(1, "#e05500");
    ctx.fillStyle = jg; ctx.beginPath(); ctx.roundRect(cx - 18, cy + 25, 36, 42, 5); ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = "bold 16px 'Inter',system-ui,sans-serif"; ctx.textAlign = "center";
    ctx.fillText("1", cx, cy + 52);

    const arm = Math.sin(Date.now() * 0.009) * 10;
    const armY = phaseRef.current === "shooting" ? cy + 15 : cy + 22;
    ctx.strokeStyle = "#ff7b00"; ctx.lineWidth = 9; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx - 18, cy + 35); ctx.lineTo(cx - 42 - arm, armY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 18, cy + 35); ctx.lineTo(cx + 42 + arm, armY); ctx.stroke();

    ctx.fillStyle = "#22dd55";
    ctx.beginPath(); ctx.arc(cx - 42 - arm, armY - 2, 10, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 42 + arm, armY - 2, 10, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#f0ba8c";
    ctx.beginPath(); ctx.arc(cx, cy + 14, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff7b00";
    ctx.beginPath(); ctx.ellipse(cx, cy + 8, 18, 12, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#e05500"; ctx.fillRect(cx - 18, cy + 6, 36, 4);

    if (falling) {
      // Dizzy eyes X X
      ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 2;
      [-5, 5].forEach(ox => {
        ctx.beginPath(); ctx.moveTo(cx + ox - 3, cy + 10); ctx.lineTo(cx + ox + 3, cy + 16); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + ox + 3, cy + 10); ctx.lineTo(cx + ox - 3, cy + 16); ctx.stroke();
      });
    } else {
      const look = Math.min(3, Math.max(-3, (mouseRef.current.x - cx) * 0.015));
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(cx - 5, cy + 13, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 5, cy + 13, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath(); ctx.arc(cx - 5 + look, cy + 13, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 5 + look, cy + 13, 2.2, 0, Math.PI * 2); ctx.fill();
    }

    if (isIdle && !falling) {
      ctx.strokeStyle = "#c08060"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy + 22, 4, 0.2, Math.PI - 0.2); ctx.stroke();
    } else {
      ctx.strokeStyle = "#c08060"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx - 4, cy + 21); ctx.lineTo(cx + 4, cy + 21); ctx.stroke();
    }

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(cx - 16, cy + 65, 14, 16); ctx.fillRect(cx + 2, cy + 65, 14, 16);
    ctx.fillStyle = "#ff7b00";
    ctx.fillRect(cx - 12, cy + 79, 8, 12); ctx.fillRect(cx + 4, cy + 79, 8, 12);
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.roundRect(cx - 14, cy + 89, 12, 6, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx + 2, cy + 89, 12, 6, 2); ctx.fill();

    ctx.restore();
  }, []);

  const drawBall = useCallback((ctx, x, y, r) => {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(x + 2, y + r + 3, r * 0.85, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    g.addColorStop(0, "#fff"); g.addColorStop(0.6, "#f0f0f0"); g.addColorStop(1, "#c8c8c8");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(30,30,30,0.7)";
    ctx.beginPath(); ctx.arc(x, y, r * 0.28, 0, Math.PI * 2); ctx.fill();
    [0.8, 2.3, 3.8, 5.3].forEach(a => { ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.18, 0, Math.PI * 2); ctx.fill(); });
    ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  }, []);

  const drawCrosshair = useCallback((ctx, mx, my) => {
    const p = 0.8 + Math.sin(Date.now() * 0.006) * 0.2;
    ctx.strokeStyle = `rgba(255,60,60,${0.6 * p})`; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx - 20, my); ctx.lineTo(mx - 6, my); ctx.moveTo(mx + 6, my); ctx.lineTo(mx + 20, my);
    ctx.moveTo(mx, my - 20); ctx.lineTo(mx, my - 6); ctx.moveTo(mx, my + 6); ctx.lineTo(mx, my + 20);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,60,60,${0.4 * p})`;
    ctx.beginPath(); ctx.arc(mx, my, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(255,60,60,${0.9 * p})`;
    ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, Math.PI * 2); ctx.fill();
  }, []);

  // ── Main game loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const loop = () => {
      ctx.clearRect(0, 0, W, H);
      drawField(ctx);

      const gk = gkRef.current;
      const s = DIFF[diffRef.current];
      const now = Date.now();
      const mouseIdle = (now - mouseRef.current.lastMoveTime) > MOUSE_IDLE_MS;
      const gkFalling = now < gk.fallUntil;

      if (phaseRef.current === "aiming" || phaseRef.current === "shooting") {
        const minX = GOAL_X + POST_W + 2, maxX = GOAL_X + GOAL_W - POST_W - GK_W - 2;

        // Random fall trigger (only during aiming, not already falling)
        if (phaseRef.current === "aiming" && !gkFalling && Math.random() < s.fallChance) {
          gk.fallUntil = now + s.fallDuration;
        }

        if (!gkFalling) {
          if (phaseRef.current === "aiming" && mouseIdle) {
            if (Math.abs(gk.x - gk.randomTarget) < 8 || gk.randomTarget < minX || gk.randomTarget > maxX) {
              gk.randomTarget = minX + Math.random() * (maxX - minX);
            }
            const rdx = gk.randomTarget - gk.x;
            gk.vx += rdx * 0.04;
            gk.vx *= 0.88;
            gk.vx = Math.max(-s.randSpeed, Math.min(s.randSpeed, gk.vx));
          } else {
            const targetX = mouseRef.current.x - GK_W / 2;
            const clamped = Math.max(minX, Math.min(maxX, targetX));
            const jitter = (Math.sin(now * 0.005) + Math.cos(now * 0.0037)) * s.jitter;
            const dx = (clamped + jitter) - gk.x;
            gk.vx += dx * s.reaction;
            gk.vx *= 0.85;
            gk.vx = Math.max(-s.maxSpeed, Math.min(s.maxSpeed, gk.vx));
          }

          gk.x += gk.vx;
          gk.x = Math.max(minX, Math.min(maxX, gk.x));

          if (phaseRef.current === "shooting") {
            const bt = Math.min(ballRef.current.t, 1);
            const dt = Math.max(minX, Math.min(maxX, ballRef.current.targetX - GK_W / 2));
            gk.vx += (dt - gk.x) * (s.reaction * 2.5) * bt;
            gk.vx *= 0.88;
            gk.vx = Math.max(-s.maxSpeed * 1.8, Math.min(s.maxSpeed * 1.8, gk.vx));
            gk.x += gk.vx;
            gk.x = Math.max(minX, Math.min(maxX, gk.x));
          }
        } else {
          // Falling — GK frozen, velocity killed
          gk.vx = 0;
        }
      }

      // Idle indicator
      if (phaseRef.current === "aiming" && mouseIdle && !gkFalling) {
        const gkCx = gk.x + GK_W / 2;
        ctx.fillStyle = "rgba(255,180,50,0.12)";
        ctx.beginPath(); ctx.arc(gkCx, GOAL_Y + GOAL_H - GK_H + 5, 10, 0, Math.PI * 2); ctx.fill();
      }

      // Fall visual flash
      if (gkFalling) {
        const gkCx = gk.x + GK_W / 2;
        ctx.fillStyle = "rgba(255,50,50,0.15)";
        ctx.beginPath(); ctx.arc(gkCx, GOAL_Y + GOAL_H - 20, 40, 0, Math.PI * 2); ctx.fill();
      }

      drawGK(ctx, phaseRef.current === "aiming" && mouseIdle, gkFalling);

      const ball = ballRef.current;
      if (phaseRef.current === "aiming") {
        drawBall(ctx, ball.x, ball.y, BALL_R);
        // Trajectory line
        const mx = mouseRef.current.x, my = mouseRef.current.y;
        const tg = ctx.createLinearGradient(W / 2, H - 60, mx, my);
        tg.addColorStop(0, "rgba(255,255,100,0.0)"); tg.addColorStop(1, "rgba(255,255,100,0.3)");
        ctx.strokeStyle = tg; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(W / 2, H - 60); ctx.lineTo(mx, my); ctx.stroke();
        ctx.setLineDash([]);
        drawCrosshair(ctx, mx, my);
      } else if (phaseRef.current === "shooting") {
        ball.t += 0.04;
        const t = Math.min(ball.t, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        drawBall(ctx, W / 2 + (ball.targetX - W / 2) * ease, (H - 60) + (ball.targetY - (H - 60)) * ease, BALL_R * (1 - ease * 0.35));

        if (t >= 1) {
          const fx = ball.targetX, fy = ball.targetY;
          const inX = fx > GOAL_X + POST_W + BALL_R && fx < GOAL_X + GOAL_W - POST_W - BALL_R;
          const inY = fy > GOAL_Y + POST_W + BALL_R && fy < GOAL_Y + GOAL_H;
          let result;
          if (!inX || !inY) {
            result = "Fuera"; setResultText("\u00a1FUERA! \ud83d\udca8");
            setScore(sc => ({ ...sc, misses: sc.misses + 1 }));
          } else if (ball.gkWasFalling) {
            // GK was down — automatic goal
            result = "Gol"; setResultText("\u00a1\u00a1GOOOL!! \u26bd\ud83d\udd25");
            setScore(sc => ({ ...sc, goals: sc.goals + 1 }));
          } else {
            const gkCx = gk.x + GK_W / 2, gkCy = GOAL_Y + GOAL_H - GK_H / 2;
            const d = Math.sqrt((fx - gkCx) ** 2 + (fy - gkCy) ** 2);
            if (d < GK_W / 2 + BALL_R + 8) {
              result = "Atajada"; setResultText("\u00a1ATAJADA! \ud83e\udde4");
              setScore(sc => ({ ...sc, saves: sc.saves + 1 }));
            } else {
              result = "Gol"; setResultText("\u00a1\u00a1GOOOL!! \u26bd\ud83d\udd25");
              setScore(sc => ({ ...sc, goals: sc.goals + 1 }));
            }
          }
          const side = fx < GOAL_X + GOAL_W / 2 ? "Izquierda" : "Derecha";
          const height = fy < GOAL_Y + GOAL_H / 2 ? "Alto" : "Bajo";
          setHistory(h => [...h, { shot: h.length + 1, result, side, height, difficulty: diffRef.current, time: new Date().toLocaleTimeString(), date: new Date().toLocaleDateString() }]);
          phaseRef.current = "result"; setPhase("result");
        }
      } else {
        drawBall(ctx, ball.targetX || W / 2, ball.targetY || (H - 60), BALL_R * 0.6);
      }

      // HUD
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.beginPath(); ctx.roundRect(W / 2 - 130, 6, 260, 34, 8); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(W / 2 - 130, 6, 260, 34, 8); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 13px 'Inter',system-ui,sans-serif"; ctx.textAlign = "center";
      const shotDisplay = Math.min(history.length + (phaseRef.current === "aiming" ? 1 : 0), MAX_SHOTS);
      ctx.fillText("\u26bd " + score.goals + "   \ud83e\udde4 " + score.saves + "   \ud83d\udca8 " + score.misses + "   [" + shotDisplay + "/" + MAX_SHOTS + "]", W / 2, 28);

      const dc = { easy: "#4ade80", normal: "#facc15", hard: "#f87171" };
      const dn = { easy: "F\u00c1CIL", normal: "NORMAL", hard: "DIF\u00cdCIL" };
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.roundRect(8, 8, 66, 20, 5); ctx.fill();
      ctx.fillStyle = dc[diffRef.current]; ctx.font = "bold 9px 'Inter',system-ui,sans-serif";
      ctx.textAlign = "center"; ctx.fillText(dn[diffRef.current], 41, 22);

      // Idle hint
      if (phaseRef.current === "aiming" && mouseIdle && !gkFalling) {
        ctx.fillStyle = "rgba(255,200,80,0.45)"; ctx.font = "bold 10px 'Inter',system-ui,sans-serif";
        ctx.textAlign = "center"; ctx.fillText("\u2b50 Mira quieta \u2014 portero confundido", W / 2, FIELD_Y + 18);
      }

      // Fall hint
      if (phaseRef.current === "aiming" && gkFalling) {
        ctx.fillStyle = "rgba(255,80,80,0.8)"; ctx.font = "bold 13px 'Inter',system-ui,sans-serif";
        ctx.textAlign = "center"; ctx.fillText("\u26a0 \u00a1PORTERO CA\u00cdDO! \u00a1DISPARA AHORA!", W / 2, FIELD_Y + 20);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [score, history, drawField, drawGK, drawBall, drawCrosshair]);

  const handleMouseMove = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    mouseRef.current = { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height), lastMoveTime: Date.now() };
  };

  const handleClick = () => {
    if (phaseRef.current === "aiming") {
      const b = ballRef.current;
      b.targetX = mouseRef.current.x; b.targetY = mouseRef.current.y; b.t = 0;
      b.gkWasFalling = Date.now() < gkRef.current.fallUntil;
      phaseRef.current = "shooting"; setPhase("shooting");
    } else if (phaseRef.current === "result") {
      if (history.length >= MAX_SHOTS) {
        phaseRef.current = "form"; setPhase("form");
        return;
      }
      ballRef.current = { x: W / 2, y: H - 60, targetX: 0, targetY: 0, t: 0 };
      phaseRef.current = "aiming"; setPhase("aiming"); setResultText("");
    }
  };

  const restartGame = () => {
    setScore({ goals: 0, saves: 0, misses: 0 }); setHistory([]); setResultText("");
    setFormData({ name: "", phone: "", email: "" }); setFormError("");
    ballRef.current = { x: W / 2, y: H - 60, targetX: 0, targetY: 0, t: 0 };
    gkRef.current = { x: GOAL_X + GOAL_W / 2 - GK_W / 2, vx: 0, randomTarget: GOAL_X + GOAL_W / 2, fallUntil: 0 };
    phaseRef.current = "aiming"; setPhase("aiming");
  };

  const submitForm = () => {
    if (!formData.name.trim() || !formData.email.trim()) {
      setFormError("Nombre y correo son obligatorios"); return;
    }
    setFormError("");
    const match = {
      id: Date.now(), date: new Date().toLocaleString(), difficulty: diffRef.current,
      goals: score.goals, saves: score.saves, misses: score.misses, shots: history,
      player: { name: formData.name.trim(), phone: formData.phone.trim(), email: formData.email.trim() }
    };
    setDb(prev => {
      const updated = {
        matches: [...(prev?.matches || []), match],
        stats: {
          totalGoals: (prev?.stats?.totalGoals || 0) + score.goals,
          totalSaves: (prev?.stats?.totalSaves || 0) + score.saves,
          totalMisses: (prev?.stats?.totalMisses || 0) + score.misses,
          totalMatches: (prev?.stats?.totalMatches || 0) + 1
        }
      };
      saveDB(updated);
      return updated;
    });
    phaseRef.current = "gameover"; setPhase("gameover");
  };

  const clearDB = async () => {
    const empty = { matches: [], stats: { totalGoals: 0, totalSaves: 0, totalMisses: 0, totalMatches: 0 } };
    await saveDB(empty); setDb(empty);
  };

  const exportJSON = () => {
    if (!db || !db.matches.length) return;
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "datos_penales.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const changeDifficulty = (d) => { setDifficulty(d); diffRef.current = d; };

  const btnS = (active) => ({
    padding: "6px 14px", borderRadius: 6, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer",
    background: active ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)",
    color: active ? "#fff" : "rgba(255,255,255,0.4)",
    outline: active ? "1px solid rgba(255,255,255,0.2)" : "none",
  });

  const totalMatches = db?.stats?.totalMatches || 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, background: "#0a0e1a", minHeight: "100vh", padding: "16px 10px", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <h1 style={{ color: "#fff", margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: -1, background: "linear-gradient(135deg,#ff6b00,#ffcc00)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
        {"\u26bd"} Tiro Penal
      </h1>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 600, marginRight: 4 }}>DIFICULTAD:</span>
        {["easy", "normal", "hard"].map(d => (
          <button key={d} onClick={() => changeDifficulty(d)} style={btnS(difficulty === d)}>
            {{ easy: "\ud83d\udfe2 F\u00e1cil", normal: "\ud83d\udfe1 Normal", hard: "\ud83d\udd34 Dif\u00edcil" }[d]}
          </button>
        ))}
      </div>

      <div style={{ position: "relative" }}>
        <canvas ref={canvasRef} width={W} height={H} onMouseMove={handleMouseMove} onClick={handleClick}
          style={{ borderRadius: 12, cursor: phase === "aiming" ? "none" : (phase === "gameover" || phase === "form") ? "default" : "pointer", maxWidth: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.08)" }} />

        {resultText && phase !== "gameover" && phase !== "form" && (
          <div style={{ position: "absolute", top: "45%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 44, fontWeight: 900, color: "#fff", textShadow: "0 4px 24px rgba(0,0,0,0.9),0 0 60px rgba(255,107,0,0.4)", pointerEvents: "none", animation: "pop 0.3s ease-out", letterSpacing: -1 }}>{resultText}</div>
        )}
        {phase === "result" && history.length < MAX_SHOTS && (
          <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", color: "rgba(255,255,255,0.5)", fontSize: 12, pointerEvents: "none", background: "rgba(0,0,0,0.4)", padding: "4px 14px", borderRadius: 20 }}>Clic para tiro {history.length + 1} de {MAX_SHOTS}</div>
        )}
        {phase === "result" && history.length >= MAX_SHOTS && (
          <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", color: "rgba(255,200,100,0.7)", fontSize: 12, pointerEvents: "none", background: "rgba(0,0,0,0.5)", padding: "4px 14px", borderRadius: 20, fontWeight: 600 }}>Clic para registrar tu marcador</div>
        )}

        {phase === "form" && (
          <div style={{ position: "absolute", inset: 0, borderRadius: 12, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 20 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", textShadow: "0 2px 16px rgba(255,107,0,0.4)" }}>
              {score.goals >= 2 ? "\u26bd \u00a1Victoria!" : "\ud83e\udde4 \u00a1Gana el portero!"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              Goles: <span style={{ color: "#00ff88" }}>{score.goals}</span> &nbsp; Fallas: <span style={{ color: "#f87171" }}>{score.saves + score.misses}</span>
            </div>
            <div style={{ color: "rgba(255,200,100,0.7)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Registra tu marcador</div>

            <input type="text" placeholder="Nombre *" value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
              style={{ width: 260, padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 14, fontFamily: "inherit", outline: "none" }}
              onFocus={e => e.target.style.borderColor = "rgba(255,165,0,0.5)"}
              onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"} />
            <input type="tel" placeholder="Tel\u00e9fono" value={formData.phone} onChange={e => setFormData(f => ({ ...f, phone: e.target.value }))}
              style={{ width: 260, padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 14, fontFamily: "inherit", outline: "none" }}
              onFocus={e => e.target.style.borderColor = "rgba(255,165,0,0.5)"}
              onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"} />
            <input type="email" placeholder="Correo electr\u00f3nico *" value={formData.email} onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
              style={{ width: 260, padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 14, fontFamily: "inherit", outline: "none" }}
              onFocus={e => e.target.style.borderColor = "rgba(255,165,0,0.5)"}
              onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"} />

            {formError && <div style={{ color: "#f87171", fontSize: 12, fontWeight: 600 }}>{formError}</div>}

            <button onClick={submitForm} style={{ marginTop: 4, padding: "11px 36px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#00884a,#00cc6a)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,204,106,0.3)", transition: "transform 0.15s" }}
              onMouseEnter={e => e.target.style.transform = "scale(1.05)"}
              onMouseLeave={e => e.target.style.transform = "scale(1)"}>
              {"\ud83d\udcbe"} Guardar marcador
            </button>
          </div>
        )}

        {phase === "gameover" && (
          <div style={{ position: "absolute", inset: 0, borderRadius: 12, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <div style={{ fontSize: 36, fontWeight: 900, color: "#fff", textShadow: "0 2px 20px rgba(255,107,0,0.5)" }}>
              {score.goals >= 2 ? "\u26bd \u00a1Victoria!" : "\ud83e\udde4 \u00a1Gana el portero!"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 17, fontWeight: 600 }}>
              Goles: <span style={{ color: "#00ff88" }}>{score.goals}</span> &nbsp; Fallas: <span style={{ color: "#f87171" }}>{score.saves + score.misses}</span>
            </div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 13 }}>{"\ud83d\udc64"} {formData.name} &nbsp; {"\ud83d\udcbe"} Guardado</div>
            <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={restartGame} style={{ padding: "12px 28px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#ff6b00,#ffaa00)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 20px rgba(255,107,0,0.3)" }}>
                {"\ud83d\udd04"} Jugar de nuevo
              </button>
              <button onClick={exportJSON} style={{ padding: "12px 28px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#0078d4,#00a4ef)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,120,212,0.3)" }}>
                {"\ud83d\udcbe"} Exportar JSON
              </button>
              <button onClick={() => setShowHistory(true)} style={{ padding: "12px 28px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                {"\ud83d\udcca"} Ver historial
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <Stat label="Goles" value={score.goals} color="#00ff88" />
        <Stat label="Atajadas" value={score.saves} color="#ff6b00" />
        <Stat label="Fuera" value={score.misses} color="#666" />
        <Stat label={phase === "gameover" ? "Efectividad" : "Tiros"} value={phase === "gameover" ? (history.length > 0 ? ((score.goals / history.length) * 100).toFixed(0) + "%" : "\u2014") : history.length + "/" + MAX_SHOTS} color={phase === "gameover" ? "#ffcc00" : "#88aaff"} />
      </div>

      {/* DB indicator */}
      {!dbLoading && (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>
            {"\ud83d\uddc4"} Base de datos: {totalMatches} partida{totalMatches !== 1 ? "s" : ""} guardada{totalMatches !== 1 ? "s" : ""}
            {totalMatches > 0 && (" \u2014 " + (db?.stats?.totalGoals || 0) + " goles totales")}
          </span>
          {totalMatches > 0 && (
            <button onClick={() => setShowHistory(h => !h)} style={{ background: "none", border: "none", color: "rgba(130,180,255,0.6)", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>
              {showHistory ? "Ocultar" : "Ver historial"}
            </button>
          )}
        </div>
      )}

      {/* History panel */}
      {showHistory && db && db.matches.length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 16, maxWidth: 560, width: "100%", maxHeight: 260, overflowY: "auto", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>{"\ud83d\uddc4"} Historial de partidas</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={exportJSON} style={{ background: "rgba(0,120,212,0.2)", border: "1px solid rgba(0,120,212,0.3)", color: "rgba(100,180,255,0.8)", fontSize: 10, padding: "3px 10px", borderRadius: 5, cursor: "pointer", fontWeight: 600 }}>{"\ud83d\udcbe"} Exportar JSON</button>
              <button onClick={clearDB} style={{ background: "rgba(255,60,60,0.15)", border: "1px solid rgba(255,60,60,0.2)", color: "rgba(255,100,100,0.7)", fontSize: 10, padding: "3px 10px", borderRadius: 5, cursor: "pointer", fontWeight: 600 }}>Borrar todo</button>
            </div>
          </div>
          {[...db.matches].reverse().map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12, color: "rgba(255,255,255,0.6)", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: "rgba(255,255,255,0.5)", minWidth: 90, fontWeight: 600 }}>{m.player?.name || "---"}</span>
              <span style={{ color: "rgba(255,255,255,0.25)", minWidth: 110, fontSize: 10 }}>{m.date}</span>
              <span style={{ color: { easy: "#4ade80", normal: "#facc15", hard: "#f87171" }[m.difficulty], fontWeight: 600, minWidth: 50, fontSize: 11 }}>{{ easy: "F\u00e1cil", normal: "Normal", hard: "Dif\u00edcil" }[m.difficulty]}</span>
              <span style={{ minWidth: 80 }}>
                <span style={{ color: "#00ff88", fontWeight: 700 }}>{m.goals} goles</span>
                {" "}<span style={{ color: "#f87171" }}>{m.saves + m.misses} fallas</span>
              </span>
              <span style={{ color: m.goals >= 2 ? "#00ff88" : "#f87171", fontWeight: 600, minWidth: 60 }}>
                {m.goals >= 2 ? "Victoria" : "Derrota"}
              </span>
            </div>
          ))}
          {db.matches.length > 1 && (
            <div style={{ marginTop: 10, padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 16, justifyContent: "center" }}>
              <MiniStat label="Partidas" value={db.stats.totalMatches} />
              <MiniStat label="Goles" value={db.stats.totalGoals} color="#00ff88" />
              <MiniStat label="Atajadas" value={db.stats.totalSaves} color="#ff6b00" />
              <MiniStat label="Efect." value={((db.stats.totalGoals / (db.stats.totalGoals + db.stats.totalSaves + db.stats.totalMisses)) * 100).toFixed(0) + "%"} color="#ffcc00" />
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes pop{0%{transform:translate(-50%,-50%) scale(.5);opacity:0}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}`}</style>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "8px 18px", textAlign: "center", minWidth: 75, border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ color, fontSize: 24, fontWeight: 800 }}>{value}</div>
      <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

function MiniStat({ label, value, color = "rgba(255,255,255,0.5)" }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color, fontSize: 16, fontWeight: 800 }}>{value}</div>
      <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 9, fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}
