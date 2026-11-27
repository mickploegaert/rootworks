import { itemIcon } from '../game/render/sprites/items.ts';
import { RESOURCES, type ResourceId } from '../game/resources/ResourceDefs.ts';

const urls = new Map<ResourceId, string>();
const iconUrl = (id: ResourceId) => {
  let u = urls.get(id);
  if (!u) urls.set(id, (u = itemIcon(id).toCanvas().toDataURL()));
  return u;
};

/** An item's pixel-art icon. With `explain`, hovering shows what the item is and what it is for. */
export function ItemIcon({ id, explain = false }: { id: ResourceId; explain?: boolean }) {
  const r = RESOURCES[id];
  return <img className="item-icon" src={iconUrl(id)} alt={r?.name ?? id} title={explain && r ? `${r.name}: ${r.description}\n\n${r.use}` : r?.name} />;
}

/** The Spark: ROOTWORKS' one currency, a cherry blossom with a golden heart. */
export function Spark() {
  return (
    <svg className="spark-icon" viewBox="-6 -6 12 12" aria-hidden>
      {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-3" rx="2.3" ry="2.9" fill="#f4b3c9" stroke="#8a3a5c" strokeWidth=".6" transform={`rotate(${a})`} />)}
      <circle r="1.5" fill="#f2c062" stroke="#8a5a1c" strokeWidth=".5" />
    </svg>
  );
}
