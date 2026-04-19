/* app.js – Vehicle Counter Dashboard Logic | Nhóm 10 TGMT */

// ── Clock (hh:mm:ss only) ─────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mn = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('clock').textContent = `${hh}:${mn}:${ss}`;
}
setInterval(updateClock, 1000);
updateClock();


// ── MJPEG Stream Handler ───────────────────────────────────────────────────
// Note: Stream handling is now done automatically by the browser via the <img> tag in index.html


// ── DOM refs ───────────────────────────────────────────────────────────────
const totalEl    = document.getElementById('totalCount');
const countCar   = document.getElementById('countCar');
const countMoto  = document.getElementById('countMoto');
const countTruck = document.getElementById('countTruck');
const countBus   = document.getElementById('countBus');

const statFrame  = document.getElementById('statFrame');
const statRoi    = document.getElementById('statRoiText');

const roiCount   = document.getElementById('roiCount');
const roiBadge   = document.getElementById('roiBadge');
const roiCar     = document.getElementById('roiCar');
const roiMoto    = document.getElementById('roiMoto');
const roiTruck   = document.getElementById('roiTruck');
const roiBus     = document.getElementById('roiBus');

const segCar     = document.getElementById('segCar');
const segMoto    = document.getElementById('segMoto');
const segTruck   = document.getElementById('segTruck');
const segBus     = document.getElementById('segBus');

const btnReset     = document.getElementById('btnReset');
const btnResetZone = document.getElementById('btnResetZone');
const roiCanvas    = document.getElementById('roiCanvas');


// ── Animate number ─────────────────────────────────────────────────────────
function setNum(el, val) {
    const prev = parseInt(el.textContent) || 0;
    if (prev === val) return;
    el.textContent = val;
    if (val > prev) {
        el.animate([{ transform: 'scale(1.2)' }, { transform: 'scale(1)' }],
            { duration: 220, easing: 'ease-out' });
    }
}

function bump(cardId) {
    const el = document.getElementById(cardId);
    if (!el) return;
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 300);
}


// ── Detection Overlay Renderer ─────────────────────────────────────────────
const DET_COLORS = {
    car:        '#3fb950',
    motorcycle: '#3fb950',
    truck:      '#3fb950',
    bus:        '#3fb950',
};

const DET_LABELS = {
    car:        'Car',
    motorcycle: 'Motorbike',
    truck:      'Truck',
    bus:        'Bus',
};

let _detCanvas = null;
let _detCtx    = null;

function initDetCanvas() {
    // Separate canvas for bboxes, so ZoneEditor never clears it
    _detCanvas = document.getElementById('detCanvas');
    _detCtx    = _detCanvas ? _detCanvas.getContext('2d') : null;
}

function drawDetections(dets) {
    if (!_detCtx || !_detCanvas) return;

    const vid = document.getElementById('videoStream');
    const vr  = vid ? vid.getBoundingClientRect() : null;
    if (!vr || vr.width === 0) return;

    // Sync canvas pixel size to its CSS size
    if (_detCanvas.width !== Math.round(vr.width) || _detCanvas.height !== Math.round(vr.height)) {
        _detCanvas.width  = Math.round(vr.width);
        _detCanvas.height = Math.round(vr.height);
    }

    _detCtx.clearRect(0, 0, _detCanvas.width, _detCanvas.height);

    // ── Compute actual video render rect (object-fit: contain has letterboxes) ──
    const FRAME_W = 1280, FRAME_H = 720;
    const vidRatio = FRAME_W / FRAME_H;
    const cW = _detCanvas.width, cH = _detCanvas.height;
    let renderW, renderH, offX, offY;
    if (cW / cH > vidRatio) {
        // Pillarboxed (black left/right)
        renderH = cH;
        renderW = cH * vidRatio;
        offX = (cW - renderW) / 2;
        offY = 0;
    } else {
        // Letterboxed (black top/bottom)
        renderW = cW;
        renderH = cW / vidRatio;
        offX = 0;
        offY = (cH - renderH) / 2;
    }

    const sx = renderW / FRAME_W;
    const sy = renderH / FRAME_H;

    for (const d of dets) {
        const x1 = d.x1 * sx + offX;
        const y1 = d.y1 * sy + offY;
        const x2 = d.x2 * sx + offX;
        const y2 = d.y2 * sy + offY;
        const label = `${DET_LABELS[d.name] || d.name} #${d.tid}`;

        // Box
        _detCtx.strokeStyle = '#3fb950';
        _detCtx.lineWidth   = 2;
        _detCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Label tag
        const pad = 4, fs = 11;
        _detCtx.font = `700 ${fs}px Inter, sans-serif`;
        const tw = _detCtx.measureText(label).width;
        const lx = x1;
        const ly = y1 > 20 ? y1 - (fs + pad * 2 + 1) : y1 + 1;

        _detCtx.fillStyle = '#3fb950';
        _detCtx.beginPath();
        _detCtx.roundRect(lx, ly, tw + pad * 2, fs + pad * 2, 3);
        _detCtx.fill();

        _detCtx.fillStyle = '#000';
        _detCtx.textBaseline = 'top';
        _detCtx.fillText(label, lx + pad, ly + pad);
    }
}

async function fetchDetections() {
    try {
        const res  = await fetch('/api/detections');
        const data = await res.json();
        drawDetections(data.detections || []);
        // Zone is on its own canvas — no need to call _zoneEditor._draw()
    } catch {}
}

setInterval(fetchDetections, 40); // ~25 fps


// ── Poll /api/stats ────────────────────────────────────────────────────────
let prevCounts = { car: 0, motorcycle: 0, truck: 0, bus: 0 };

async function fetchStats() {
    try {
        const res  = await fetch('/api/stats');
        const data = await res.json();

        // has_zone: true → chỉ đếm trong zone | false → đếm toàn frame
        const hasZone = data.has_zone === true;
        const rc = data.counts || {};

        const rCar   = rc.car        || 0;
        const rMoto  = rc.motorcycle || 0;
        const rTruck = rc.truck      || 0;
        const rBus   = rc.bus        || 0;
        const total  = rCar + rMoto + rTruck + rBus;

        // ── Bump animation khi tăng ──
        if (rCar   > prevCounts.car)        bump('cardCar');
        if (rMoto  > prevCounts.motorcycle) bump('cardMoto');
        if (rTruck > prevCounts.truck)      bump('cardTruck');
        if (rBus   > prevCounts.bus)        bump('cardBus');
        prevCounts = { car: rCar, motorcycle: rMoto, truck: rTruck, bus: rBus };

        // ── Cập nhật card phân loại ──
        setNum(countCar,   rCar);
        setNum(countMoto,  rMoto);
        setNum(countTruck, rTruck);
        setNum(countBus,   rBus);

        // ── Zone label: hiển thị mode đang dùng ──
        const zoneLbl = document.getElementById('zoneLabel');
        if (zoneLbl) {
            zoneLbl.textContent = hasZone ? '⭐ Trong zone' : '📹 Toàn bộ frame';
            zoneLbl.style.color = hasZone ? '#f59e0b' : '#3fb950';
        }

        // ── Footer ROI text ──
        const roiSummary = [
            rCar   > 0 ? `${rCar} car`     : '',
            rMoto  > 0 ? `${rMoto} moto`   : '',
            rTruck > 0 ? `${rTruck} truck` : '',
            rBus   > 0 ? `${rBus} bus`     : '',
        ].filter(Boolean).join(', ') || '---';
        if (statRoi) statRoi.textContent = roiSummary;

        // ── Frame counter ──
        setNum(statFrame, data.frame_idx || 0);

        // ── Proportion bar ──
        if (total > 0) {
            segCar.style.width   = (rCar   / total * 100).toFixed(1) + '%';
            segMoto.style.width  = (rMoto  / total * 100).toFixed(1) + '%';
            segTruck.style.width = (rTruck / total * 100).toFixed(1) + '%';
            segBus.style.width   = (rBus   / total * 100).toFixed(1) + '%';
        } else {
            segCar.style.width = segMoto.style.width = segTruck.style.width = segBus.style.width = '0%';
        }

    } catch (err) {
        console.error('Stats fetch error:', err);
    }
}

setInterval(fetchStats, 500);
fetchStats();


// ── Reset counts ───────────────────────────────────────────────────────────
btnReset.addEventListener('click', async () => {
    await fetch('/api/reset', { method: 'POST' });
    prevCounts = { car: 0, motorcycle: 0, truck: 0, bus: 0 };
    fetchStats();
});


// ── Helpers ────────────────────────────────────────────────────────────────
async function api(url, options = {}) {
    const isPost = options.method === 'POST';
    const config = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    };
    if (isPost && options.body) {
        config.body = JSON.stringify(options.body);
    }
    const res = await fetch(url, config);
    return res.json();
}

function showToast(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}


// ── ZoneEditor Class ────────────────────────────────────────────────────────
class ZoneEditor {
    static MAX_POINTS = 4;

    constructor(canvas) {
        this.canvas   = canvas;
        this.ctx      = canvas.getContext('2d');
        this.points   = [];
        this.dragging = null;
        this.editMode = false;
        this.POINT_R  = 7;
        this.DRAG_D   = 16;
        this._bindCanvas();
        this._loadFromServer();
    }

    enterEdit() {
        this.editMode = true;
        this.points   = [];
        this.canvas.classList.add('interactive');
        this._draw();
        this._updateBtns();
    }

    exitEdit() {
        this.editMode = false;
        this.dragging = null;
        this.canvas.classList.remove('interactive');
        this._updateBtns();
    }

    _bindCanvas() {
        const c = this.canvas;
        c.addEventListener('click', e => {
            if (!this.editMode || this.dragging !== null) return;
            if (this.points.length >= ZoneEditor.MAX_POINTS) return;
            this.points.push(this._pos(e));
            this._draw();
            this._updateBtns();
        });
        c.addEventListener('mousedown', e => {
            if (!this.editMode) return;
            const p = this._pos(e);
            const idx = this.points.findIndex(([x, y]) =>
                Math.hypot(x - p[0], y - p[1]) <= this.DRAG_D
            );
            if (idx !== -1) this.dragging = idx;
        });
        c.addEventListener('mousemove', e => {
            const p = this._pos(e);
            
            // Cursor change on hover
            if (this.editMode) {
                const hoverIdx = this.points.findIndex(([x, y]) =>
                    Math.hypot(x - p[0], y - p[1]) <= this.DRAG_D
                );
                c.style.cursor = hoverIdx !== -1 || this.dragging !== null ? 'move' : 'crosshair';
            }

            if (this.dragging === null) return;
            this.points[this.dragging] = p;
            this._draw();
        });
        c.addEventListener('mouseup',    () => { this.dragging = null; });
        c.addEventListener('mouseleave', () => { this.dragging = null; });
    }

    // ── Shared helper: compute video render rect inside canvas (object-fit:contain) ──
    _videoRect() {
        const r = this.canvas.getBoundingClientRect();
        const cW = r.width, cH = r.height;
        const vidRatio = 1280 / 720;
        let renderW, renderH, offX, offY;
        if (cW / cH > vidRatio) {
            renderH = cH; renderW = cH * vidRatio;
            offX = (cW - renderW) / 2; offY = 0;
        } else {
            renderW = cW; renderH = cW / vidRatio;
            offX = 0; offY = (cH - renderH) / 2;
        }
        return { renderW, renderH, offX, offY, cW, cH };
    }

    _pos(e) {
        const r   = this.canvas.getBoundingClientRect();
        const { renderW, renderH, offX, offY } = this._videoRect();
        // Map canvas pixels → 1280x720 frame coords (clamped inside video rect)
        const px  = e.clientX - r.left - offX;
        const py  = e.clientY - r.top  - offY;
        return [
            Math.round(Math.max(0, Math.min(1280, px * 1280 / renderW))),
            Math.round(Math.max(0, Math.min(720,  py * 720  / renderH))),
        ];
    }

    _draw() {
        const { canvas: cv, ctx, points } = this;
        const { renderW, renderH, offX, offY, cW, cH } = this._videoRect();
        cv.width  = cW;
        cv.height = cH;
        ctx.clearRect(0, 0, cW, cH);

        if (!points.length) return;

        // Scale from 1280x720 frame coords → display pixels, with letterbox offset
        const sx = renderW / 1280, sy = renderH / 720;
        const px = ([x, y]) => [x * sx + offX, y * sy + offY];
        const pts = points.map(px);

        // Draw completed polygon
        if (points.length === ZoneEditor.MAX_POINTS) {
            ctx.beginPath();
            ctx.moveTo(...pts[0]);
            pts.slice(1).forEach(p => ctx.lineTo(...p));
            ctx.closePath();
            ctx.fillStyle   = 'rgba(245, 158, 11, 0.15)';
            ctx.fill();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth   = 2;
            ctx.stroke();

            // Center label
            const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
            const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
            ctx.font         = 'bold 11px Inter, sans-serif';
            ctx.fillStyle    = 'rgba(245, 158, 11, 0.9)';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('ROI ZONE', cx, cy);
        }

        // Edit mode extras
        if (this.editMode) {
            if (points.length < ZoneEditor.MAX_POINTS && pts.length > 1) {
                ctx.beginPath();
                ctx.moveTo(...pts[0]);
                pts.slice(1).forEach(p => ctx.lineTo(...p));
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth   = 1.5;
                ctx.setLineDash([6, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            pts.forEach(([x, y], i) => {
                ctx.beginPath();
                ctx.arc(x, y, this.POINT_R + 4, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
                ctx.fill();

                ctx.beginPath();
                ctx.arc(x, y, this.POINT_R, 0, Math.PI * 2);
                ctx.fillStyle   = '#3b82f6';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth   = 2;
                ctx.stroke();

                ctx.font         = 'bold 9px Inter';
                ctx.fillStyle    = '#fff';
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(i + 1, x, y);
            });
        }
    }

    _updateBtns() {
        const btn  = document.getElementById('btnZoneToggle');
        const txt  = document.getElementById('btnZoneText');
        const done = this.points.length === ZoneEditor.MAX_POINTS;

        if (!btn || !txt) return;

        if (!this.editMode) {
            btn.classList.remove('active', 'btn-save-state');
            txt.textContent = this.points.length > 0 ? 'Sửa Zone' : 'Vẽ Zone';
            btn.disabled = false;
        } else {
            btn.classList.add('active');
            if (done) {
                btn.classList.add('btn-save-state');
                txt.textContent = 'Lưu Zone';
                btn.disabled = false;
            } else {
                btn.classList.remove('btn-save-state');
                txt.textContent = `Điểm (${this.points.length}/4)`;
                btn.disabled = true;
            }
        }
    }

    async save() {
        if (this.points.length !== ZoneEditor.MAX_POINTS) return;
        const btn = document.getElementById('btnZoneToggle');
        const txt = document.getElementById('btnZoneText');
        if (btn) btn.disabled = true;
        if (txt) txt.textContent = 'Đang lưu...';
        try {
            const res = await api('/api/zone', { method: 'POST', body: { points: this.points } });
            if (res.status === 'ok') {
                this.exitEdit();
                showToast('Zone đã được lưu!');
                // Polling index might need refresh or backend update is immediate
            }
        } catch (err) {
            showToast('Lưu zone thất bại!', 'error');
            this._updateBtns();
        }
    }

    async reset() {
        try {
            await api('/api/zone', { method: 'DELETE' });
            this.points = [];
            this.dragging = null;
            this.exitEdit();
            this._draw();
            showToast('Đã xóa vùng cấm');
        } catch {
            showToast('Xóa thất bại!', 'error');
        }
    }

    async _loadFromServer() {
        try {
            const res = await api('/api/zone');
            if (res.status === 'ok' && Array.isArray(res.points) && res.points.length === ZoneEditor.MAX_POINTS) {
                this.points = res.points;
            }
        } catch {}
        this._draw();
        this._updateBtns();
    }
}


// ── Initialization ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initDetCanvas();
    const editor = new ZoneEditor(document.getElementById('roiCanvas'));
    window._zoneEditor = editor;

    // Hook up buttons
    document.getElementById('btnZoneToggle').addEventListener('click', () => {
        if (editor.editMode && editor.points.length === ZoneEditor.MAX_POINTS) {
            editor.save();
        } else {
            editor.enterEdit();
        }
    });

    document.getElementById('btnResetZone').addEventListener('click', () => {
        if (confirm('Bạn có chắc muốn xóa thực vùng ROI?')) {
            editor.reset();
        }
    });
});
