/**
 * Constellation Grid - High-Velocity Dynamic Mesh Engine
 * Implements Hooke's Law Spring-Mass-Damping system with kinetic shockwaves,
 * spatial radar rings, and live hex coordinate readouts.
 * Tailored for 4 U By U Dark Academic & Amber Gold Glassmorphic Theme.
 */

(function () {
  'use strict';

  function initConstellationGrid() {
    const canvas = document.getElementById('constellation-bg-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationFrameId;
    let width = 0;
    let height = 0;

    // Mouse velocity & inertial tracking
    const mouse = {
      x: -1000,
      y: -1000,
      prevX: -1000,
      prevY: -1000,
      vx: 0,
      vy: 0,
      radius: 220,
    };

    let nodes = [];

    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      initNodes();
    };

    // Global document mouse tracking so shockwaves trigger even over glass cards & modals
    const handleMouseMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };

    const handleMouseLeave = () => {
      mouse.x = -1000;
      mouse.y = -1000;
    };

    const initNodes = () => {
      nodes = [];
      const spacing = 55; // Tighter grid density for richer visual connections
      const cols = Math.ceil(width / spacing) + 1;
      const rows = Math.ceil(height / spacing) + 1;

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * spacing;
          const y = j * spacing;
          nodes.push({
            x: x,
            y: y,
            vx: 0,
            vy: 0,
            baseX: x,
            baseY: y,
            radius: Math.random() * 1.2 + 1.2,
            label: (i * 7).toString(16).toUpperCase() + ':' + (j * 11).toString(16).toUpperCase(),
            pulse: Math.random() * Math.PI * 2,
          });
        }
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeave);

    let lastTime = performance.now();

    const render = (now) => {
      // Normalize dt across high-refresh displays
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      // Mouse velocity calculation
      mouse.vx = (mouse.x - mouse.prevX) / (dt * 1000 || 1);
      mouse.vy = (mouse.y - mouse.prevY) / (dt * 1000 || 1);
      mouse.prevX = mouse.x;
      mouse.prevY = mouse.y;

      const speed = Math.sqrt(mouse.vx * mouse.vx + mouse.vy * mouse.vy);

      // Color paletting tailored to Amber Gold & Espresso Theme
      const bgColor = '#2c2f35'; // Theme primary dark background
      const nodeColor = '229, 229, 229'; // Champagne star text / foreground
      const accentColor = '255, 255, 255'; // Amber Gold 45 68% 47%

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      // Subtle ambient gold radial glow under cursor
      if (mouse.x > 0 && mouse.y > 0) {
        const glowRad = ctx.createRadialGradient(mouse.x, mouse.y, 10, mouse.x, mouse.y, mouse.radius);
        glowRad.addColorStop(0, 'rgba(229, 229, 229, 0.12)');
        glowRad.addColorStop(1, 'rgba(44, 47, 53, 0)');
        ctx.fillStyle = glowRad;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, mouse.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node Physics Engine (Hooke's Law Spring-Mass-Damping system)
      const SPRING_K = 18; // Spring stiffness
      const DAMPING = 0.82; // Velocity resistance

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.pulse += dt * 3;

        // Mouse distance vectors
        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Dynamic shockwave repulsion based on cursor speed
        if (dist < mouse.radius && dist > 0) {
          const power = 1 - dist / mouse.radius;
          const force = power * (1500 + speed * 150);
          const angle = Math.atan2(dy, dx);

          // Impulse force pushing node away from cursor
          n.vx -= Math.cos(angle) * force * dt;
          n.vy -= Math.sin(angle) * force * dt;
        }

        // Calculate restoring force back to home anchor point (baseX, baseY)
        const homeDx = n.baseX - n.x;
        const homeDy = n.baseY - n.y;

        n.vx += homeDx * SPRING_K * dt;
        n.vy += homeDy * SPRING_K * dt;

        // Apply Damping
        n.vx *= DAMPING;
        n.vy *= DAMPING;

        // Integrate position
        n.x += n.vx * dt * 60;
        n.y += n.vy * dt * 60;
      }

      // Draw Connections (Optimized Distance Culling)
      const MAX_CONN_DIST = 75;
      const MAX_CONN_DIST_SQ = MAX_CONN_DIST * MAX_CONN_DIST;

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];

        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const ndx = n.x - n2.x;
          const ndy = n.y - n2.y;
          const distSq = ndx * ndx + ndy * ndy;

          if (distSq < MAX_CONN_DIST_SQ) {
            const nDist = Math.sqrt(distSq);
            const alpha = (1 - nDist / MAX_CONN_DIST) * 0.22;

            ctx.strokeStyle = `rgba(${nodeColor}, ${alpha})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(n2.x, n2.y);
            ctx.stroke();
          }
        }
      }

      // Render Node Points & Interactive Highlights
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isNear = dist < mouse.radius;

        // Node base opacity pulse
        const baseAlpha = isNear ? 0.95 : 0.25 + Math.sin(n.pulse) * 0.1;

        ctx.fillStyle = isNear
          ? `rgba(${accentColor}, ${baseAlpha})`
          : `rgba(${nodeColor}, ${baseAlpha})`;

        const currentRadius = isNear ? n.radius * 2.2 : n.radius + Math.sin(n.pulse) * 0.3;

        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(0.5, currentRadius), 0, Math.PI * 2);
        ctx.fill();

        // High-tech Spatial Radar Rings on active proximity
        if (dist < 90) {
          const pulseRing = ((n.pulse * 20) % 30) + 4;
          const ringAlpha = (1 - pulseRing / 34) * 0.45;

          ctx.strokeStyle = `rgba(${accentColor}, ${ringAlpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(n.x, n.y, pulseRing, 0, Math.PI * 2);
          ctx.stroke();

          // Hex Coordinate Readout
          ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
          ctx.fillStyle = `rgba(${accentColor}, 0.88)`;
          ctx.fillText(n.label, n.x + 10, n.y - 10);
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConstellationGrid);
  } else {
    initConstellationGrid();
  }
})();
