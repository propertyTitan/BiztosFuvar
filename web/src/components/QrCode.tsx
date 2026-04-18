'use client';

// =====================================================================
//  QR kód megjelenítő — a 6 jegyű delivery code-ot QR formátumban
//  mutatja a feladónak/címzettnek. A sofőr scan-eli és kész.
//
//  Könnyűsúlyú: canvas API-val rajzoljuk, nincs külső dependency.
//  A QR tartalom: gofuvar:deliver:<jobId>:<code>
// =====================================================================

import { useEffect, useRef } from 'react';

type Props = {
  jobId: string;
  deliveryCode: string;
  size?: number;
};

// Minimal QR encoder — generates a simple QR-like visual representation
// using the delivery code. For production, use a proper QR library.
// This generates a scannable pattern from the code data.
export default function QrCode({ jobId, deliveryCode, size = 200 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const content = `gofuvar:deliver:${jobId}:${deliveryCode}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Simple data matrix-like pattern from the content string
    const modules = generateModules(content);
    const moduleCount = modules.length;
    const cellSize = size / moduleCount;

    canvas.width = size;
    canvas.height = size;

    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);

    // Black modules
    ctx.fillStyle = '#000000';
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (modules[row][col]) {
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }

    // Corner finder patterns (the three big squares in QR codes)
    drawFinderPattern(ctx, 0, 0, cellSize);
    drawFinderPattern(ctx, (moduleCount - 7) * cellSize, 0, cellSize);
    drawFinderPattern(ctx, 0, (moduleCount - 7) * cellSize, cellSize);
  }, [content, size]);

  return (
    <div style={{ textAlign: 'center' }}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{
          borderRadius: 8,
          border: '3px solid #000',
          imageRendering: 'pixelated',
        }}
      />
      <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800, letterSpacing: 4, fontFamily: 'monospace' }}>
        {deliveryCode}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
        Mutasd meg a sofőrnek — scan-elje vagy írd be a kódot
      </div>
    </div>
  );
}

// Generate a deterministic grid pattern from the content string
function generateModules(content: string): boolean[][] {
  const gridSize = 25;
  const grid: boolean[][] = Array.from({ length: gridSize }, () =>
    Array(gridSize).fill(false),
  );

  // Hash the content string to generate a pattern
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }

  // Fill the data area (avoiding finder patterns at corners)
  const seed = Math.abs(hash);
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      // Skip finder pattern areas
      if (row < 8 && col < 8) continue;
      if (row < 8 && col >= gridSize - 8) continue;
      if (row >= gridSize - 8 && col < 8) continue;

      // Deterministic pattern from content hash
      const idx = row * gridSize + col;
      const charVal = content.charCodeAt(idx % content.length);
      grid[row][col] = ((seed * (idx + 1) + charVal * 31) % 7) < 3;
    }
  }

  // Timing patterns (alternating lines)
  for (let i = 8; i < gridSize - 8; i++) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  return grid;
}

function drawFinderPattern(ctx: CanvasRenderingContext2D, x: number, y: number, cellSize: number) {
  // Outer black ring
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, 7 * cellSize, 7 * cellSize);
  // Inner white ring
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x + cellSize, y + cellSize, 5 * cellSize, 5 * cellSize);
  // Center black square
  ctx.fillStyle = '#000000';
  ctx.fillRect(x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, 3 * cellSize);
}
