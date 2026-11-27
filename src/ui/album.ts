/** Photos of milestones, kept in the browser beside the saves (small JPEGs; at most one per milestone, 24 in all). */
export interface Photo { id: string; title: string; description: string; image: string | null; day: string }
const KEY = 'rootworks.album.v1';

export function readAlbum(): Photo[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((p): p is Photo => !!p && typeof p.id === 'string' && typeof p.title === 'string').slice(0, 24) : [];
  } catch { return []; }
}

export function addPhoto(p: Photo): void {
  const album = [p, ...readAlbum().filter((x) => x.id !== p.id)].slice(0, 24);
  try { localStorage.setItem(KEY, JSON.stringify(album)); } catch { /* full: keep playing, skip the photo */ }
}
