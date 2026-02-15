import { db } from './db.js'; 
import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs } 
  from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

window.myNickname = localStorage.getItem('pixelNick') || null;
let game = { gold: 0, inventory: Array(16).fill(null), buyCount: 0, stage: 1, monsterHp: 20, maxHp: 20, bestStage: 1 };
let audioCtx = null;
let isGameStarted = false;
let bgmInterval = null;
let isMuted = false;

const loginModal = document.getElementById('login-modal');
const guideModal = document.getElementById('guide-modal');
const loginMsg = document.getElementById('login-msg');

if (window.myNickname) {
    loginModal.style.display = 'none';
    startGame();
}

window.checkAndStart = async () => {
    const input = document.getElementById('nickname-input').value.trim().toUpperCase();
    if (input.length < 2) { loginMsg.innerText = "2글자 이상 입력하세요."; return; }
    const docRef = doc(db, "ranks", input);
    try {
        loginMsg.innerText = "CHECKING...";
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && input !== window.myNickname) {
            loginMsg.innerText = "이미 존재하는 닉네임입니다.";
        } else {
            localStorage.setItem('pixelNick', input); window.myNickname = input;
            if (!docSnap.exists()) await setDoc(docRef, { score: 1, lastUpdate: new Date().toISOString() });
            loginModal.style.display = 'none';
            openGuide();
        }
    } catch (e) { console.error(e); loginMsg.innerText = "서버 연결 오류"; }
};

window.openGuide = function() { guideModal.style.display = 'flex'; }
window.closeGuide = function() { guideModal.style.display = 'none'; if (!isGameStarted) startGame(); }

async function autoSaveScore() {
    if (!window.myNickname) return;
    if (game.stage > game.bestStage) {
        game.bestStage = game.stage;
        try { await setDoc(doc(db, "ranks", window.myNickname), { score: game.stage, lastUpdate: new Date().toISOString() }, { merge: true }); } catch(e) {}
    }
}

window.openRanking = async () => {
    document.getElementById('rank-overlay').style.display = 'flex';
    const listEl = document.getElementById('rank-list'); listEl.innerHTML = "Loading...";
    try {
        const q = query(collection(db, "ranks"), orderBy("score", "desc"), limit(10));
        const querySnapshot = await getDocs(q);
        let html = ""; let rank = 1;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            let color = rank === 1 ? '#ffd700' : (rank === 2 ? '#c0c0c0' : (rank === 3 ? '#cd7f32' : 'white'));
            html += `<div style="display:flex; justify-content:space-between; color:${color}; margin-bottom: 5px; border-bottom:1px solid #333;"><span>${rank}. ${doc.id}</span><span>${data.score} F</span></div>`;
            rank++;
        });
        listEl.innerHTML = html;
    } catch(e) { listEl.innerHTML = "Error"; }
}

function initAudio() { if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } else if (audioCtx.state === 'suspended') { audioCtx.resume(); } playBgm(); }

function playBgm() {
    if (!audioCtx || isMuted || bgmInterval) return;
    const tempo = 150; const secondsPerBeat = 60.0 / tempo; const noteTime = secondsPerBeat / 2;
    const N = { c3:130.81, d3:146.83, e3:164.81, f3:174.61, g3:196.00, a3:220.00, b3:246.94, c4:261.63, d4:293.66, e4:329.63, f4:349.23, g4:392.00, a4:440.00, b4:493.88, _:null };
    const melody = [N.e4,N._,N.e4,N.f4,N.g4,N._,N.g4,N.a4,N.g4,N.f4,N.e4,N.d4,N.c4,N._,N.c4,N.e4,N.d4,N.d4,N.e4,N._,N.c4,N._,N.g3,N._,N.a3,N.b3,N.c4,N.d4,N.e4,N.c4,N.d4,N.g4];
    const bass = [N.c3,N.c3,N.e3,N.e3,N.g3,N.g3,N.c4,N.c4,N.f3,N.f3,N.a3,N.a3,N.c4,N.c4,N.a3,N.a3,N.d3,N.d3,N.f3,N.f3,N.a3,N.a3,N.d4,N.d4,N.g3,N.g3,N.b3,N.b3,N.d4,N.d4,N.g3,N.g3];
    let step = 0;
    bgmInterval = setInterval(() => {
        if (!audioCtx || isMuted) return;
        const now = audioCtx.currentTime;
        const m = melody[step % melody.length]; const b = bass[step % bass.length];
        if (m) { const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type='square'; o.frequency.setValueAtTime(m,now); g.gain.setValueAtTime(0.05,now); g.gain.exponentialRampToValueAtTime(0.01,now+0.1); o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.2); }
        if (b) { const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type='triangle'; o.frequency.setValueAtTime(b,now); g.gain.setValueAtTime(0.08,now); g.gain.linearRampToValueAtTime(0,now+0.2); o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.2); }
        if (step%4===0) { const o=audioCtx.createOscillator(),g=audioCtx.createGain(); if(step%8===0){ o.frequency.setValueAtTime(150,now); o.frequency.exponentialRampToValueAtTime(0.01,now+0.5); g.gain.setValueAtTime(0.2,now); g.gain.exponentialRampToValueAtTime(0.01,now+0.5); } else { o.type='square'; o.frequency.setValueAtTime(1000,now); g.gain.setValueAtTime(0.03,now); g.gain.exponentialRampToValueAtTime(0.01,now+0.1); } o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.2); }
        step++;
    }, noteTime * 1000);
}

function playSfx(type) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime; const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination);
    if(type==='hit'){ o.type='sawtooth'; o.frequency.setValueAtTime(220,now); o.frequency.exponentialRampToValueAtTime(0.01,now+0.1); g.gain.setValueAtTime(0.1,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.1); o.start(now); o.stop(now+0.1); }
    else if(type==='crit'){ o.type='square'; o.frequency.setValueAtTime(440,now); o.frequency.linearRampToValueAtTime(880,now+0.1); g.gain.setValueAtTime(0.1,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.1); o.start(now); o.stop(now+0.1); }
    else if(type==='click'){ o.type='triangle'; o.frequency.setValueAtTime(600,now); o.frequency.linearRampToValueAtTime(100,now+0.05); g.gain.setValueAtTime(0.1,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.05); o.start(now); o.stop(now+0.05); }
    else if(type==='merge'){ o.type='sine'; o.frequency.setValueAtTime(440,now); o.frequency.linearRampToValueAtTime(880,now+0.2); g.gain.setValueAtTime(0.1,now); g.gain.linearRampToValueAtTime(0,now+0.2); o.start(now); o.stop(now+0.2); }
    else if(type==='buy'){ o.type='square'; o.frequency.setValueAtTime(1200,now); g.gain.setValueAtTime(0.05,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.1); o.start(now); o.stop(now+0.1); }
}

function generateWeaponSVG(level) {
    const hue = (level * 37) % 360; 
    const main = `hsl(${hue}, 70%, 50%)`; const light = `hsl(${hue}, 90%, 70%)`; const dark = `hsl(${hue}, 60%, 30%)`;
    const type = Math.floor(level / 5) % 5; // 5종류 무기
    const evo = level % 5;
    let path = "";

    if (type === 0) { // [검]
        const len = 3 + evo; 
        path = `<rect x="5" y="${8 - len}" width="2" height="${len}" fill="${main}"/> <rect x="5" y="${8 - len}" width="1" height="${len}" fill="${light}"/> <rect x="3" y="8" width="6" height="1" fill="${dark}"/> <rect x="5" y="9" width="2" height="2" fill="#8d6e63"/>`;
    } else if (type === 1) { // [활]
        path = `<path d="M2 2 Q 8 6 2 10" stroke="#8d6e63" stroke-width="1" fill="none"/> <line x1="2" y1="2" x2="2" y2="10" stroke="#eee" stroke-width="0.5"/> <rect x="2" y="5" width="8" height="1" fill="${main}"/> <rect x="8" y="5" width="2" height="1" fill="${light}"/>`;
    } else if (type === 2) { // [지팡이]
        path = `<rect x="5" y="2" width="2" height="9" fill="#8d6e63"/> <rect x="4" y="1" width="4" height="3" fill="${main}"/> <rect x="5" y="2" width="2" height="1" fill="${light}"/> <rect x="${3 - (evo%2)}" y="2" width="1" height="1" fill="#fff" opacity="0.8"/>`;
    } else if (type === 3) { // [도끼]
        path = `<rect x="5" y="2" width="2" height="9" fill="#5d4037"/> <rect x="2" y="2" width="3" height="${2 + evo}" fill="${main}"/> <rect x="7" y="2" width="3" height="${2 + evo}" fill="${main}"/> <rect x="2" y="2" width="1" height="${2 + evo}" fill="${light}"/>`;
    } else { // [단검]
        path = `<rect x="5" y="6" width="2" height="3" fill="#8d6e63"/> <rect x="4" y="5" width="4" height="1" fill="${dark}"/> <rect x="5" y="2" width="2" height="3" fill="${main}"/> <rect x="6" y="2" width="1" height="3" fill="${light}"/>`;
    }

    let aura = (level > 0 && level % 10 === 0) ? `<rect x="0" y="0" width="12" height="12" fill="${main}" opacity="0.2"><animate attributeName="opacity" values="0.2;0.5;0.2" duration="0.5s" repeatCount="indefinite"/></rect>` : "";
    return `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" style="width:100%; height:100%; pointer-events:none;">${aura} ${path}</svg>`;
}

function startGame() {
    document.getElementById('my-nick-display').innerText = window.myNickname || 'PLAYER';

    // ★ [업데이트 기념 선물 지급] ★
    // 'patch_reward_v2'라는 키가 없으면 선물을 주고 기록함
    // ★ 보상 지급 로직 ★
    if (!localStorage.getItem('patch_reward_v2')) {
        const bonusGold = 10000;
        
        // 1. 데이터 변경 (내부적으로만 골드 증가)
        game.gold += bonusGold; 
        
        // 2. 보상 받았다는 표시 남기기
        localStorage.setItem('patch_reward_v2', 'received');
        
        // 3. ★중요★ 화면 갱신 및 저장!
        // 이걸 해야 화면 상단 골드 숫자가 촤르륵 바뀝니다.
        render(); 

        alert(`🎉 밸런스 패치 기념 보상! 🎉\n\n${bonusGold.toLocaleString()} 골드가 지급되었습니다.\n\n즐거운 모험 되세요!`);
    }

    isGameStarted = true;
    initGrid(); loadData(); render();
    requestAnimationFrame(combatLoop);
}

function getBuyCost() { return Math.floor(10 * Math.pow(1.15, game.buyCount)); }
function getWeaponDamage(level) { return Math.floor(10 * Math.pow(2.1, level)); }
function getTotalDPS() { return game.inventory.reduce((sum, lvl) => (lvl !== null ? sum + getWeaponDamage(lvl) : sum), 0); }
function getMonsterMaxHp(stage) { return Math.floor(30 * Math.pow(1.14, stage - 1)); }

let lastTime = 0;
function combatLoop(timestamp) {
    if (!isGameStarted) return;
    if (!lastTime) lastTime = timestamp;
    if (timestamp - lastTime >= 1000) { 
        const dps = getTotalDPS();
        if (dps > 0) attackMonster(dps, null, null, false);
        lastTime = timestamp;
    }
    requestAnimationFrame(combatLoop);
}

const stageZone = document.getElementById('stage-area');
stageZone.addEventListener('pointerdown', (e) => {
    if (!isGameStarted || game.monsterHp <= 0) return;
    initAudio(); 
    const dps = getTotalDPS();
    const baseDmg = Math.max(1, dps); 
    attackMonster(baseDmg, e.clientX, e.clientY, true);
});

function attackMonster(damage, x, y, isClick) {
    const hero = document.getElementById('hero-wrapper');
    const monster = document.getElementById('monster-wrapper');
    const isCrit = Math.random() < 0.1;
    const finalDmg = isCrit ? damage * 2 : damage;

    hero.classList.remove('hero-attack'); void hero.offsetWidth; hero.classList.add('hero-attack');

    game.monsterHp -= finalDmg;
    updateHpBar();
    showDamageText(finalDmg, x, y, isClick, isCrit);
    
    if (isCrit) playSfx('crit');
    else if (isClick) playSfx('click'); 
    else playSfx('hit');

    // 몬스터 피격 모션 (넉백 + 표정)
    monster.classList.remove('monster-hit'); void monster.offsetWidth; monster.classList.add('monster-hit');
    document.getElementById('eyes-normal').style.display = 'none';
    document.getElementById('eyes-hit').style.display = 'block';
    setTimeout(() => {
        document.getElementById('eyes-normal').style.display = 'block';
        document.getElementById('eyes-hit').style.display = 'none';
    }, 200);

    if (game.monsterHp <= 0) killMonster();
}

function killMonster() {
    game.gold += Math.floor(game.maxHp * 0.4);
    game.stage++;
    game.maxHp = getMonsterMaxHp(game.stage);
    game.monsterHp = game.maxHp;
    autoSaveScore(); updateMonsterAppearance(); updateHpBar(); render();
}

function showDamageText(dmg, x, y, isClick, isCrit) {
    const el = document.createElement('div'); 
    el.className = isCrit ? 'dmg-text dmg-crit' : 'dmg-text';
    el.innerHTML = isCrit ? `CRITICAL! ${dmg}` : (isClick ? `💥${dmg}` : `-${dmg}`);
    
    if (!isCrit) { el.style.color = isClick ? '#fff176' : '#fff'; el.style.fontSize = isClick ? '1.2rem' : '0.8rem'; }
    el.style.zIndex = 600;

    if (x !== null && y !== null) { el.style.left = `${x}px`; el.style.top = `${y}px`; } 
    else { const mRect = document.getElementById('monster-wrapper').getBoundingClientRect(); const rX = (Math.random() - 0.5) * 60; el.style.left = `${mRect.left + 30 + rX}px`; el.style.top = `${mRect.top}px`; }
    document.body.appendChild(el); setTimeout(() => el.remove(), 600);
}

function updateHpBar() {
    const pct = Math.max(0, (game.monsterHp / game.maxHp) * 100);
    document.getElementById('monster-hp-bar').style.width = pct + '%';
    document.getElementById('hp-text').innerText = `${Math.ceil(Math.max(0, game.monsterHp))}/${Math.ceil(game.maxHp)}`;
}

function updateMonsterAppearance() {
    const hue = (game.stage * 35) % 360; 
    const monster = document.getElementById('monster-wrapper');
    monster.style.color = `hsl(${hue}, 70%, 60%)`;
    document.getElementById('monster-svg').style.fill = `hsl(${hue}, 70%, 60%)`;
}

function initGrid() {
    const gridEl = document.getElementById('grid'); gridEl.innerHTML = '';
    for (let i = 0; i < 16; i++) {
        let slot = document.createElement('div'); slot.className = 'slot'; slot.dataset.index = i;
        gridEl.appendChild(slot);
    }
}

function render() {
    document.getElementById('gold-display').innerText = Math.floor(game.gold).toLocaleString();
    document.getElementById('dps-display').innerText = getTotalDPS().toLocaleString();
    document.getElementById('stage-num').innerText = game.stage;
    const cost = getBuyCost();
    const buyBtn = document.getElementById('buy-btn');
    buyBtn.innerText = `WEAPON (${cost.toLocaleString()} G)`;
    buyBtn.disabled = game.gold < cost;
    const slots = document.querySelectorAll('.slot');
    slots.forEach((slot, idx) => {
        if (slot.querySelector('.dragging')) return;
        slot.innerHTML = '';
        const level = game.inventory[idx];
        if (level !== null) {
            const el = document.createElement('div'); el.className = 'item';
            el.innerHTML = generateWeaponSVG(level);
            const badge = document.createElement('div'); badge.innerText = `Lv.${level}`;
            badge.style.cssText = "position:absolute; bottom:0; right:0; font-size:0.4rem; color:#fff; background:rgba(0,0,0,0.5); padding:1px; border-radius:2px;";
            el.appendChild(badge);
            addDragEvents(el); slot.appendChild(el);
        }
    });
    saveData();
}

let dragged = null, startIdx = null, offsets = { x:0, y:0 };
function addDragEvents(el) { el.addEventListener('mousedown', startDrag); el.addEventListener('touchstart', startDrag, {passive: false}); }
function startDrag(e) {
    if(e.type === 'touchstart') e.preventDefault();
    dragged = e.target.closest('.item'); if(!dragged) return;
    startIdx = parseInt(dragged.parentElement.dataset.index);
    const cX = e.touches ? e.touches[0].clientX : e.clientX; const cY = e.touches ? e.touches[0].clientY : e.clientY;
    const r = dragged.getBoundingClientRect(); offsets.x = cX - r.left; offsets.y = cY - r.top;
    dragged.classList.add('dragging'); dragged.style.position = 'fixed';
    dragged.style.left = (cX - offsets.x) + 'px'; dragged.style.top = (cY - offsets.y) + 'px';
    dragged.style.width = r.width + 'px'; dragged.style.height = r.height + 'px';
    document.addEventListener('mousemove', moveDrag); document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', moveDrag, {passive:false}); document.addEventListener('touchend', endDrag);
}
function moveDrag(e) { 
    if(!dragged) return; if(e.type === 'touchmove') e.preventDefault();
    const cX = e.touches ? e.touches[0].clientX : e.clientX; const cY = e.touches ? e.touches[0].clientY : e.clientY; 
    dragged.style.left = (cX - offsets.x) + 'px'; dragged.style.top = (cY - offsets.y) + 'px'; 
}
function endDrag(e) {
    if(!dragged) return; 
    const cX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX; const cY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    dragged.hidden = true; const elem = document.elementFromPoint(cX, cY); dragged.hidden = false;
    const slot = elem ? elem.closest('.slot') : null; 
    if(slot) handleMerge(startIdx, parseInt(slot.dataset.index));
    dragged.remove(); dragged = null;
    document.removeEventListener('mousemove', moveDrag); document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchmove', moveDrag); document.removeEventListener('touchend', endDrag); 
    render();
}

function handleMerge(from, to) {
    if(from === to) return; 
    const i1 = game.inventory[from], i2 = game.inventory[to];
    if(i2 === null) { game.inventory[to] = i1; game.inventory[from] = null; } 
    else if(i1 === i2) { game.inventory[to] = i1 + 1; game.inventory[from] = null; playSfx('merge'); } 
    else { game.inventory[to] = i1; game.inventory[from] = i2; }
}

document.getElementById('buy-btn').addEventListener('click', () => {
    const cost = getBuyCost(); const empty = game.inventory.findIndex(x => x === null);
    if(game.gold >= cost && empty !== -1) { game.gold -= cost; game.inventory[empty] = 0; game.buyCount++; playSfx('buy'); render(); }
});

function saveData() { localStorage.setItem('knightMergeSave', JSON.stringify(game)); }
// script.js 내부

function loadData() { 
    const s = localStorage.getItem('knightMergeSave'); 
    if(s) { 
        game = JSON.parse(s); 
        if(!game.bestStage) game.bestStage = game.stage;

        // ★ [밸런스 패치 적용 로직] ★
        // 1. 현재 스테이지에 맞는 '새로운 공식'의 최대 체력을 구한다.
        const newMaxHp = getMonsterMaxHp(game.stage);

        // 2. 만약 저장된 최대 체력이 새 공식보다 크다면? (구버전 데이터라면)
        if (game.maxHp > newMaxHp) {
            game.maxHp = newMaxHp; // 최대 체력 하향 조정
            // 현재 체력도 비율에 맞춰 줄이거나, 그냥 꽉 채운 상태로 리셋해줌 (유저 배려)
            if (game.monsterHp > newMaxHp) {
                game.monsterHp = newMaxHp; 
            }
        }
    } else {
        game.gold = 100;
    }
    updateMonsterAppearance(); 
}
window.resetData = function() { if(confirm("초기화하시겠습니까?")) { localStorage.removeItem('knightMergeSave'); localStorage.removeItem('pixelNick'); location.reload(); } }
