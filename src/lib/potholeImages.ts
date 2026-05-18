/**
 * Map list/detail images to preview vs crop. New publishes: full frame in image_url,
 * YOLO crop in frame_image_url. Legacy rows often had crop in image_url and full in frame_image_url.
 */
export function resolvePreviewAndCrop(
  imageUrl: string | null | undefined,
  frameImageUrl: string | null | undefined,
): { preview: string | null; crop: string | null } {
  if (!imageUrl && !frameImageUrl) return { preview: null, crop: null };
  if (!frameImageUrl) return { preview: imageUrl ?? null, crop: null };
  if (!imageUrl) return { preview: frameImageUrl, crop: null };
  const ia = imageUrl.length;
  const ib = frameImageUrl.length;
  if (ib > ia * 1.5) {
    return { preview: frameImageUrl, crop: imageUrl };
  }
  return { preview: imageUrl, crop: frameImageUrl };
}
