combining OS-level fusion + accuracy filtering + a simple Kalman filter

import { useState, useCallback, useMemo } from "react";

// ============================================================
// GPS NOISE REDUCTION UTILITIES (copy these to your RN project)
// ============================================================

class KalmanFilter {
  constructor({ R = 4, Q = 0.5 } = {}) {
    this.R = R; // measurement noise (higher = trust GPS less)
    this.Q = Q; // process noise (higher = allow faster changes)
    this.p = 100;
    this.x = null;
    this.k = 0;
  }

  filter(measurement) {
    if (this.x === null) {
      this.x = measurement;
      return measurement;
    }
    this.p = this.p + this.Q;
    this.k = this.p / (this.p + this.R);
    this.x = this.x + this.k * (measurement - this.x);
    this.p = (1 - this.k) * this.p;
    return this.x;
  }

  reset() {
    this.x = null;
    this.p = 100;
  }
}

class GPSFilter {
  constructor(options = {}) {
    const {
      maxAccuracy = 20,
      maxSpeed = 50,
      kalmanR = 4,
      kalmanQ = 0.5,
      minTimeDelta = 1000,
    } = options;

    this.maxAccuracy = maxAccuracy;   // meters – discard if worse
    this.maxSpeed = maxSpeed;          // m/s – discard if exceeded
    this.minTimeDelta = minTimeDelta;  // ms – ignore too-frequent updates
    this.latFilter = new KalmanFilter({ R: kalmanR, Q: kalmanQ });
    this.lngFilter = new KalmanFilter({ R: kalmanR, Q: kalmanQ });
    this.lastPoint = null;
  }

  static haversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  process(point) {
    // point = { latitude, longitude, accuracy, timestamp }

    // 1. Accuracy gate
    if (point.accuracy && point.accuracy > this.maxAccuracy) {
      return { accepted: false, reason: "accuracy", point };
    }

    // 2. Time delta gate
    if (this.lastPoint) {
      const dt = point.timestamp - this.lastPoint.timestamp;
      if (dt < this.minTimeDelta) {
        return { accepted: false, reason: "too_fast_update", point };
      }

      // 3. Speed gate
      const dist = GPSFilter.haversine(
        this.lastPoint.latitude, this.lastPoint.longitude,
        point.latitude, point.longitude
      );
      const speed = dist / (dt / 1000);
      if (speed > this.maxSpeed) {
        return { accepted: false, reason: "speed", speed, point };
      }
    }

    // 4. Kalman smoothing
    const filtered = {
      latitude: this.latFilter.filter(point.latitude),
      longitude: this.lngFilter.filter(point.longitude),
      accuracy: point.accuracy,
      timestamp: point.timestamp,
    };

    this.lastPoint = { ...point, timestamp: point.timestamp };
    return { accepted: true, raw: point, filtered };
  }

  reset() {
    this.latFilter.reset();
    this.lngFilter.reset();
    this.lastPoint = null;
  }
}

// ============================================================
// INTERACTIVE DEMO
// ============================================================

const generateNoisyPath = (centerLat, centerLng, count, noiseLevel) => {
  const points = [];
  const radius = 0.003;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const noiseLat = (Math.random() - 0.5) * noiseLevel;
    const noiseLng = (Math.random() - 0.5) * noiseLevel;
    const spike = Math.random() < 0.08 ? (Math.random() - 0.5) * noiseLevel * 6 : 0;
    points.push({
      latitude: centerLat + Math.sin(angle) * radius + noiseLat + spike,
      longitude: centerLng + Math.cos(angle) * radius * 1.4 + noiseLng + spike,
      accuracy: 5 + Math.random() * 30,
      timestamp: Date.now() + i * 2000,
    });
  }
  return points;
};

const PRESETS = {
  walking: { maxAccuracy: 20, maxSpeed: 3, kalmanR: 6, kalmanQ: 0.3, label: "Walking" },
  cycling: { maxAccuracy: 25, maxSpeed: 15, kalmanR: 4, kalmanQ: 0.5, label: "Cycling" },
  driving: { maxAccuracy: 30, maxSpeed: 50, kalmanR: 2, kalmanQ: 1.0, label: "Driving" },
};

const toSVG = (points, width, height, padding = 24) => {
  if (!points.length) return [];
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const rangeLat = maxLat - minLat || 0.001;
  const rangeLng = maxLng - minLng || 0.001;
  return points.map((p) => ({
    x: padding + ((p.longitude - minLng) / rangeLng) * (width - padding * 2),
    y: padding + (1 - (p.latitude - minLat) / rangeLat) * (height - padding * 2),
  }));
};

const pathD = (svgPts) => {
  if (svgPts.length < 2) return "";
  return svgPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
};

export default function GPSNoiseDemo() {
  const [preset, setPreset] = useState("walking");
  const [noiseLevel, setNoiseLevel] = useState(0.0012);
  const [pointCount, setPointCount] = useState(80);
  const [seed, setSeed] = useState(0);
  const [showRaw, setShowRaw] = useState(true);
  const [showFiltered, setShowFiltered] = useState(true);
  const [showRejected, setShowRejected] = useState(true);
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const config = PRESETS[preset];

  const { rawPoints, filteredPoints, rejectedPoints, stats } = useMemo(() => {
    const raw = generateNoisyPath(10.823, 106.629, pointCount, noiseLevel);
    const filter = new GPSFilter({ ...config, minTimeDelta: 0 });
    const accepted = [];
    const rejected = [];

    raw.forEach((p) => {
      const result = filter.process(p);
      if (result.accepted) {
        accepted.push({ raw: result.raw, filtered: result.filtered });
      } else {
        rejected.push({ ...p, reason: result.reason });
      }
    });

    const totalDriftRaw = accepted.reduce((sum, p, i, arr) => {
      if (i === 0) return 0;
      return sum + GPSFilter.haversine(
        arr[i - 1].raw.latitude, arr[i - 1].raw.longitude,
        p.raw.latitude, p.raw.longitude
      );
    }, 0);

    const totalDriftFiltered = accepted.reduce((sum, p, i, arr) => {
      if (i === 0) return 0;
      return sum + GPSFilter.haversine(
        arr[i - 1].filtered.latitude, arr[i - 1].filtered.longitude,
        p.filtered.latitude, p.filtered.longitude
      );
    }, 0);

    return {
      rawPoints: accepted.map((a) => a.raw),
      filteredPoints: accepted.map((a) => a.filtered),
      rejectedPoints: rejected,
      stats: {
        total: raw.length,
        accepted: accepted.length,
        rejected: rejected.length,
        rawDist: totalDriftRaw.toFixed(1),
        filteredDist: totalDriftFiltered.toFixed(1),
        reduction: ((1 - totalDriftFiltered / totalDriftRaw) * 100).toFixed(1),
      },
    };
    // eslint-disable-next-line
  }, [preset, noiseLevel, pointCount, seed]);

  const W = 520, H = 400;
  const rawSVG = toSVG(rawPoints, W, H);
  const filteredSVG = toSVG(filteredPoints, W, H);
  const rejectedSVG = toSVG(rejectedPoints, W, H);

  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      background: "#0c0e13",
      color: "#c8ccd4",
      minHeight: "100vh",
      padding: "20px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 22,
          fontWeight: 700,
          color: "#e4e8f0",
          letterSpacing: "-0.5px",
        }}>
          <span style={{ color: "#5eead4" }}>◉</span> GPS Noise Reduction
        </h1>
        <p style={{ fontSize: 11, color: "#5a6072", marginTop: 4 }}>
          Kalman filter + accuracy gate + speed sanity check
        </p>
      </div>

      {/* Controls */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16,
      }}>
        {Object.entries(PRESETS).map(([key, val]) => (
          <button key={key} onClick={() => setPreset(key)} style={{
            padding: "6px 14px",
            fontSize: 11,
            fontFamily: "inherit",
            border: preset === key ? "1px solid #5eead4" : "1px solid #1e2230",
            borderRadius: 6,
            background: preset === key ? "#5eead410" : "#12141b",
            color: preset === key ? "#5eead4" : "#6b7280",
            cursor: "pointer",
            fontWeight: 500,
          }}>
            {val.label}
          </button>
        ))}
        <button onClick={() => setSeed((s) => s + 1)} style={{
          padding: "6px 14px", fontSize: 11, fontFamily: "inherit",
          border: "1px solid #1e2230", borderRadius: 6,
          background: "#12141b", color: "#6b7280", cursor: "pointer",
          marginLeft: "auto",
        }}>
          ↻ Regenerate
        </button>
      </div>

      {/* Sliders */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
        marginBottom: 16,
      }}>
        <div style={{ background: "#12141b", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#5a6072", marginBottom: 6 }}>
            <span>Noise Level</span>
            <span style={{ color: "#f59e42" }}>{(noiseLevel * 1000).toFixed(1)}</span>
          </div>
          <input type="range" min={0.0003} max={0.004} step={0.0001}
            value={noiseLevel} onChange={(e) => setNoiseLevel(+e.target.value)}
            style={{ width: "100%", accentColor: "#f59e42" }} />
        </div>
        <div style={{ background: "#12141b", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#5a6072", marginBottom: 6 }}>
            <span>Points</span>
            <span style={{ color: "#818cf8" }}>{pointCount}</span>
          </div>
          <input type="range" min={20} max={200} step={5}
            value={pointCount} onChange={(e) => setPointCount(+e.target.value)}
            style={{ width: "100%", accentColor: "#818cf8" }} />
        </div>
      </div>

      {/* SVG Map */}
      <div style={{
        background: "#0f1117",
        border: "1px solid #1a1d28",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 16,
        position: "relative",
      }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
          {/* Grid */}
          {Array.from({ length: 9 }).map((_, i) => (
            <g key={i} opacity={0.06}>
              <line x1={0} y1={(H / 8) * i} x2={W} y2={(H / 8) * i} stroke="#5eead4" />
              <line x1={(W / 8) * i} y1={0} x2={(W / 8) * i} y2={H} stroke="#5eead4" />
            </g>
          ))}

          {/* Raw path */}
          {showRaw && rawSVG.length > 1 && (
            <path d={pathD(rawSVG)} fill="none" stroke="#f4405070" strokeWidth={1.5}
              strokeDasharray="3,3" />
          )}
          {showRaw && rawSVG.map((p, i) => (
            <circle key={`r-${i}`} cx={p.x} cy={p.y} r={2.5}
              fill="#f4405060" stroke="none" />
          ))}

          {/* Filtered path */}
          {showFiltered && filteredSVG.length > 1 && (
            <path d={pathD(filteredSVG)} fill="none" stroke="#5eead4" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
          )}
          {showFiltered && filteredSVG.map((p, i) => (
            <circle key={`f-${i}`} cx={p.x} cy={p.y} r={3}
              fill="#5eead4" stroke="#0f1117" strokeWidth={1.5}
              opacity={hoveredIdx === i ? 1 : 0.8}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: "crosshair" }} />
          ))}

          {/* Rejected */}
          {showRejected && rejectedSVG.map((p, i) => (
            <g key={`x-${i}`}>
              <line x1={p.x - 4} y1={p.y - 4} x2={p.x + 4} y2={p.y + 4}
                stroke="#ef444090" strokeWidth={1.5} />
              <line x1={p.x + 4} y1={p.y - 4} x2={p.x - 4} y2={p.y + 4}
                stroke="#ef444090" strokeWidth={1.5} />
            </g>
          ))}
        </svg>
      </div>

      {/* Toggles */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { key: "raw", color: "#f44050", label: "Raw GPS", on: showRaw, set: setShowRaw },
          { key: "flt", color: "#5eead4", label: "Filtered", on: showFiltered, set: setShowFiltered },
          { key: "rej", color: "#ef4444", label: "Rejected", on: showRejected, set: setShowRejected },
        ].map(({ key, color, label, on, set }) => (
          <button key={key} onClick={() => set(!on)} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 12px", fontSize: 11, fontFamily: "inherit",
            border: `1px solid ${on ? color + "60" : "#1e2230"}`,
            borderRadius: 6,
            background: on ? color + "10" : "#12141b",
            color: on ? color : "#4a5060",
            cursor: "pointer",
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: on ? color : "#2a2d38",
            }} />
            {label}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
        marginBottom: 16,
      }}>
        {[
          { label: "Accepted", value: stats.accepted, sub: `/ ${stats.total}`, color: "#5eead4" },
          { label: "Rejected", value: stats.rejected, sub: rejectedPoints.length ? rejectedPoints.reduce((a, p) => { a[p.reason] = (a[p.reason] || 0) + 1; return a; }, {}) : null, color: "#ef4444" },
          { label: "Noise Cut", value: `${stats.reduction}%`, sub: `${stats.rawDist}→${stats.filteredDist}m`, color: "#818cf8" },
        ].map((s, i) => (
          <div key={i} style={{
            background: "#12141b", borderRadius: 8, padding: "12px 14px",
            borderLeft: `3px solid ${s.color}30`,
          }}>
            <div style={{ fontSize: 10, color: "#5a6072", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: s.color }}>{s.value}</div>
            {s.sub && typeof s.sub === "string" && (
              <div style={{ fontSize: 9, color: "#3a3f50", marginTop: 2 }}>{s.sub}</div>
            )}
            {s.sub && typeof s.sub === "object" && (
              <div style={{ fontSize: 9, color: "#3a3f50", marginTop: 2 }}>
                {Object.entries(s.sub).map(([k, v]) => `${k}: ${v}`).join(" · ")}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Config Summary */}
      <div style={{
        background: "#12141b", borderRadius: 8, padding: "12px 14px",
        fontSize: 10, color: "#4a5060", lineHeight: 1.8,
        border: "1px solid #1a1d28",
        marginBottom: 16,
      }}>
        <span style={{ color: "#5a6072" }}>Config → </span>
        <span style={{ color: "#5eead4" }}>maxAccuracy:</span> {config.maxAccuracy}m{" · "}
        <span style={{ color: "#5eead4" }}>maxSpeed:</span> {config.maxSpeed}m/s{" · "}
        <span style={{ color: "#5eead4" }}>kalmanR:</span> {config.kalmanR}{" · "}
        <span style={{ color: "#5eead4" }}>kalmanQ:</span> {config.kalmanQ}
      </div>

      {/* Usage snippet */}
      <div style={{
        background: "#12141b", borderRadius: 8, padding: 14,
        border: "1px solid #1a1d28",
        fontSize: 11, lineHeight: 1.7,
        color: "#6b7280", overflowX: "auto",
      }}>
        <div style={{ fontSize: 10, color: "#5a6072", marginBottom: 8 }}>
          React Native Usage ↓
        </div>
        <pre style={{ margin: 0, fontFamily: "inherit", color: "#8b95a8" }}>{`const filter = new GPSFilter({
  maxAccuracy: ${config.maxAccuracy},
  maxSpeed: ${config.maxSpeed},
  kalmanR: ${config.kalmanR},
  kalmanQ: ${config.kalmanQ},
});

// In your location watcher:
Geolocation.watchPosition(position => {
  const result = filter.process({
    latitude:  position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy:  position.coords.accuracy,
    timestamp: position.timestamp,
  });

  if (result.accepted) {
    updateMap(result.filtered); // ✓ smoothed
  }
});`}</pre>
      </div>
    </div>
  );
}
