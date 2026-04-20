/**
 * Parse YOLO-style bbox_xyxy from Supabase JSON (pixel [x1,y1,x2,y2] or normalized 0–1).
 */
export function parseBboxXyxy(raw: unknown): [number, number, number, number] | null {
  if (raw == null) return null;
  if (Array.isArray(raw) && raw.length >= 4) {
    const a = [Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])];
    if (a.every((n) => Number.isFinite(n))) {
      let [x1, y1, x2, y2] = a;
      if (x2 < x1) [x1, x2] = [x2, x1];
      if (y2 < y1) [y1, y2] = [y2, y1];
      return [x1, y1, x2, y2];
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    const x1 = Number(o.x1 ?? o.xmin ?? o.left);
    const y1 = Number(o.y1 ?? o.ymin ?? o.top);
    const x2 = Number(o.x2 ?? o.xmax ?? o.right);
    const y2 = Number(o.y2 ?? o.ymax ?? o.bottom);
    if ([x1, y1, x2, y2].every((n) => Number.isFinite(n))) {
      let a = x1;
      let b = y1;
      let c = x2;
      let d = y2;
      if (c < a) [a, c] = [c, a];
      if (d < b) [b, d] = [d, b];
      return [a, b, c, d];
    }
  }
  return null;
}

/** Convert bbox to pixel coordinates using frame size (handles normalized 0–1 values). */
export function bboxToPixelRect(
  xyxy: [number, number, number, number],
  frameW: number,
  frameH: number,
): { x: number; y: number; width: number; height: number } {
  const [x1, y1, x2, y2] = xyxy;
  const maxVal = Math.max(x1, y1, x2, y2);
  const normalized = maxVal <= 1.001;
  const sx = normalized ? frameW : 1;
  const sy = normalized ? frameH : 1;
  const px1 = x1 * sx;
  const py1 = y1 * sy;
  const px2 = x2 * sx;
  const py2 = y2 * sy;
  return {
    x: px1,
    y: py1,
    width: Math.max(0, px2 - px1),
    height: Math.max(0, py2 - py1),
  };
}
