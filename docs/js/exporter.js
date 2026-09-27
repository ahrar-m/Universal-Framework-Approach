// exporter.js — SVG / PNG / JSON export and import.
import { blockRect } from './canvas.js';

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 400);
}

function safeName(name) {
  return String(name || 'model').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'model';
}

// Builds a standalone SVG string of the whole model, in world coordinates,
// so it stays crisp at any zoom level.
export function buildSvgString(svgEl, model, opts) {
  const options = opts || {};
  const pad = options.padding === undefined ? 48 : options.padding;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (model.blocks.length) {
    for (const b of model.blocks) {
      const r = blockRect(b);
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
  } else {
    minX = 0; minY = 0; maxX = 800; maxY = 500;
  }
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const width = Math.round(maxX - minX);
  const height = Math.round(maxY - minY);

  const clone = svgEl.cloneNode(true);
  const viewport = clone.querySelector('#viewport');
  if (viewport) viewport.setAttribute('transform', 'translate(0 0) scale(1)');
  // background sized to the model bbox
  const bg = clone.querySelector('rect');
  if (bg) {
    bg.setAttribute('x', String(minX));
    bg.setAttribute('y', String(minY));
    bg.setAttribute('width', String(width));
    bg.setAttribute('height', String(height));
    bg.setAttribute('fill', '#0a0f1e');
    bg.removeAttribute('stroke');
    // keep the blueprint grid over the dark base
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    grid.setAttribute('x', String(minX));
    grid.setAttribute('y', String(minY));
    grid.setAttribute('width', String(width));
    grid.setAttribute('height', String(height));
    grid.setAttribute('fill', 'url(#grid)');
    clone.insertBefore(grid, clone.firstChild.nextSibling);
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', [minX, minY, width, height].join(' '));
  clone.setAttribute('style', 'background:#0a0f1e');

  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = model.name || 'model';
  clone.insertBefore(title, clone.firstChild);

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

export function exportSvg(svgEl, model) {
  const str = buildSvgString(svgEl, model);
  download(safeName(model.name) + '.svg', new Blob([str], { type: 'image/svg+xml;charset=utf-8' }));
}

export function exportPng(svgEl, model, scale) {
  const factor = scale || 3;
  const str = buildSvgString(svgEl, model);
  const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = function () {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * factor));
    canvas.height = Math.max(1, Math.round(img.height * factor));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0f1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(function (png) {
      if (png) download(safeName(model.name) + '@' + factor + 'x.png', png);
    }, 'image/png');
  };
  img.onerror = function () {
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

export function exportJson(model) {
  const text = JSON.stringify(model, null, 2);
  download(safeName(model.name) + '.ufa.json', new Blob([text], { type: 'application/json' }));
}

export function importJson(file, onDone, onError) {
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const parsed = JSON.parse(String(reader.result));
      onDone(parsed);
    } catch (err) {
      onError('That file is not valid JSON model data.');
    }
  };
  reader.onerror = function () { onError('Could not read that file.'); };
  reader.readAsText(file);
}
